// In-match HUD (DOM overlay): resources, phase timer, game speed, quick selection stack,
// context-sensitive selection info (incl. active cover) + command bar, build menu, production,
// placement/ability mode bar, notices, box-selection rectangle. Compact dark-gothic, touch-first
// (44px+ targets), portrait and landscape. Reads state only; acts through game actions/input.
import { el, clear, button, setText, setWidth, toggleClass } from './dom.js';
import { icon, iconForUnit, iconForStructure } from './icons.js';
import { t, formatClock } from './i18n.js';
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { sideDef, isOrganic, isPlagueImmune, baseFaction } from '../data/factions.js';
import { ABILITIES } from '../data/abilities.js';
import { WEAPONS } from '../data/weapons.js';
import { COVER_TYPES, COVER_IDS } from '../data/cover.js';
import { PLAYER_FORMATIONS } from '../units/formation.js';
import { EV } from '../core/events.js';
import { TICK_RATE, INFECTION_MAX } from '../sim/constants.js';
import { isSquadAlive } from '../sim/state.js';
import { isCorpseKnownTo, isStructureVisibleTo, isSoldierVisibleTo } from '../sim/perception.js';
import { canAfford } from '../economy/economy.js';
import { trenchSlotCount, trenchCoverStrength, trenchNetwork, networkCapacity } from '../construction/trench.js';
import { allCombatSquadIds, squadIdsWithRole, multiSelectView } from '../input/selection.js';
import { unitCost, unlockedBySpec } from '../sim/specialities.js';
import { structureCost } from '../construction/construction.js';
import { createP3Hud } from './hud_p3.js';
import { createP4Hud } from './hud_p4.js';
import { fixFor, requirementText } from './reasons.js';
import { lensItems, netPerMinute } from './lens.js';
import { mudLevelAt, mudSpeedAt } from '../sim/weather.js';
import { MUD_LEVELS } from '../data/weather.js';

function costText(cost) {
  if (!cost) return '';
  return Object.keys(cost).map((k) => `${icon(k, 'sm')}${Math.ceil(cost[k])}`).join(' ');
}

function coverLevel(idx) {
  const c = COVER_TYPES[COVER_IDS[idx || 0]];
  return c ? c.level : 0;
}

export function createHud(game) {
  const { session, sim, viewer } = game;
  const fdef = sideDef(viewer);
  const root = el('div.hud' + (isOrganic(viewer) ? '.bg' : '.na'));
  let p3 = null; // Phase 3 panels (created at the end, see hud_p3.js)
  let p4 = null; // Phase 4 parts (control groups, auto reinforcement, lull banners — hud_p4.js)
  game.env.root.appendChild(root);

  // ------------------------------------------------------------------ top bar
  const resBox = el('div.res');
  const resNodes = {};
  const resList = fdef.hudResources || fdef.resources;
  for (const k of resList) {
    const v = el('b');
    const n = el('span.r', { title: t('res.' + k) + ' — ' + t('res.' + k + '.tip'), html: icon(k) }, v);
    // Phase 4.1 RESOURCE LENS: a tap shows where it comes from on the map (camera stays put);
    // a second tap closes it
    n.addEventListener('click', () => toggleLens(k));
    n.dataset.res = k;
    resNodes[k] = v;
    resBox.appendChild(n);
  }
  const phaseName = el('span.pn');
  const phaseTime = el('span.pt');
  // siege objective: the Church Bastion's condition (attackers only see what they last saw)
  const objBar = el('div.bar.objbar', null, el('i'));
  // the scenario objective (whatever structure / side holds it — Phase 5A)
  const objSt = sim.state.structures.find((x) => x.objective);
  const objType = objSt ? objSt.type : 'bastion';
  const objBox = el('div.obj', { title: t('struct.' + objType) + (objSt && objSt.faction !== viewer ? ' · ' + t('side.enemy') : ''), html: icon(iconForStructure(objType), 'sm') }, objBar);
  if (!objSt) objBox.style.display = 'none';
  const phaseBox = el('div.phase', null, phaseName, phaseTime, objBox);
  const speedBox = el('div.speed');
  const speedBtns = {};
  for (const v of [0, 1, 2, 4]) {
    const b = button('sp', v === 0 ? icon('pause') : v + '×', () => game.setSpeed(v), v === 0 ? t('hud.pause') : t('hud.speed') + ' ' + v + '×');
    speedBtns[v] = b;
    speedBox.appendChild(b);
  }
  const menuBtn = button('menubtn', icon('menu'), () => game.env.onPause && game.env.onPause(), t('hud.menu'));
  const crest = el('span.crest', { html: icon(fdef.card.icon), title: t('faction.' + baseFaction(viewer) + '.full') });
  const top = el('div.hud-top', null, el('div.tl', null, crest, resBox), phaseBox, el('div.tr', null, speedBox, menuBtn));
  root.appendChild(top);

  // minimap slot (filled by the minimap module)
  const minimapSlot = el('div.mm-slot');
  root.appendChild(minimapSlot);

  // ------------------------------------------------------------------ quick stack (right)
  const quick = el('div.quick');
  const qAll = button('q', icon('all') + `<i>${t('hud.all')}</i>`, () => selectIds(allCombatSquadIds(sim, viewer)), t('hud.all'));
  const bg = isOrganic(viewer);
  const qEng = fdef.buildList.length ? button('q', icon(bg ? 'gang' : 'engineer') + `<i>${t(bg ? 'hud.gangs' : 'hud.engineers')}</i>`, () => selectIds(squadIdsWithRole(sim, viewer, 'builder')), t(bg ? 'hud.gangs' : 'hud.engineers')) : null;
  // box / multi-select modes carry a label and an explicit ON state (Phase 4: the old multi-select
  // glyph was read as a "copy" button)
  const qBox = button('q tog', icon('box') + `<i>${t('hud.box_short')}</i>`, () => { game.ui.boxMode = !game.ui.boxMode; refreshToggles(); }, t('hud.box'));
  const qMulti = button('q tog', icon('multi') + `<i>${t('hud.multi_short')}</i>`, () => { game.ui.multi = !game.ui.multi; refreshToggles(); }, t('hud.multi_tip'));
  const qHome = button('q', icon('home'), () => game.home(), t('hud.home'));
  quick.append(qAll);
  if (qEng) quick.append(qEng);
  quick.append(qBox, qMulti, qHome);
  root.appendChild(quick);

  function selectIds(ids) {
    game.selection.set(ids);
    if (game.audio) game.audio.ui('select');
  }
  function refreshToggles() {
    toggleClass(qBox, 'on', game.ui.boxMode);
    const mv = multiSelectView(game.ui.multi);
    toggleClass(qMulti, 'on', mv.on);
    setText(qBox.querySelector('i'), game.ui.boxMode ? t('hud.on') : t('hud.box_short'));
    setText(qMulti.querySelector('i'), t(mv.labelKey));
    dirty = true;
  }

  // ------------------------------------------------------------------ resource lens (Phase 4.1)
  const lensBox = el('div.lens');
  root.appendChild(lensBox);
  const samples = {}; // res -> [{ t, v }] own stockpile samples (income meter)
  let sampleAcc = 0, lensAcc = 0;
  function resValue(k) {
    const f = sim.state.factions[viewer];
    if (k === 'corpses') { let n = 0; for (const c of sim.state.corpses) if (isCorpseKnownTo(c, viewer)) n++; return n; }
    if (k === 'population') return f.population || 0;
    if (k === 'pestilence') return f.pestilence || 0;
    return f.resources[k] || 0;
  }
  function toggleLens(k) {
    game.ui.lens = game.ui.lens === k ? null : k;
    for (const n of resBox.querySelectorAll('.r')) toggleClass(n, 'lens-on', n.dataset.res === game.ui.lens);
    renderLens(true);
    if (game.audio) game.audio.ui('select');
  }
  function renderLens(rebuild) {
    const k = game.ui.lens;
    if (!k) { game.frame.lens = null; toggleClass(lensBox, 'open', false); clear(lensBox); return; }
    const items = lensItems(sim, viewer, k);
    game.frame.lens = { res: k, items };
    if (rebuild) {
      clear(lensBox);
      lensBox.append(
        el('div.lh', { html: `${icon(k, 'sm')}<b>${t('lens.title', { res: t('res.' + k) })}</b>` }, button('lx', icon('deselect', 'sm'), () => toggleLens(k), t('lens.close'))),
        el('div.lt', { text: t('res.' + k + '.tip') }),
        el('div.li'),
      );
    }
    const counts = {};
    for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
    const parts = Object.keys(counts).map((kk) => `${t('lens.src.' + kk)} ${counts[kk]}`);
    const rate = netPerMinute(samples[k] || []);
    const txt = (parts.length ? parts.join(' · ') : t('lens.none')) + (k !== 'corpses' ? ' — ' + t('lens.income', { v: (rate >= 0 ? '+' : '') + rate.toFixed(1) }) : '');
    setText(lensBox.querySelector('.li'), txt);
    toggleClass(lensBox, 'open', true);
  }
  function updateLens(dt) {
    sampleAcc += dt;
    if (sampleAcc >= 1) {
      sampleAcc = 0;
      const now = sim.state.tick / TICK_RATE; // game time: pausing / speed-up keep the rate honest
      for (const k of [...resList, 'population', 'pestilence']) {
        const a = samples[k] || (samples[k] = []);
        if (a.length && a[a.length - 1].t === now) continue;
        a.push({ t: now, v: resValue(k) });
        while (a.length > 40) a.shift();
      }
    }
    lensAcc += dt;
    if (game.ui.lens && lensAcc >= 0.5) { lensAcc = 0; renderLens(false); }
  }

  // ------------------------------------------------------------------ bottom panel
  const info = el('div.selinfo');
  const cmds = el('div.cmds');
  const modebar = el('div.modebar');
  const buildMenu = el('div.popup.buildmenu');
  const bottom = el('div.hud-bottom', null, buildMenu, info, modebar, cmds);
  root.appendChild(bottom);
  let buildOpen = false;

  const notices = el('div.notices');
  const banner = el('div.banner');
  const boxRect = el('div.boxsel');
  const hint = el('div.hint');
  root.append(notices, banner, boxRect, hint);

  // ------------------------------------------------------------------ build menu
  // Phase 3: build menu tabs (defence / economy / support) and speciality-locked entries
  let buildTab = fdef.buildTabs ? fdef.buildTabs[0] : '';
  function renderBuildMenu() {
    clear(buildMenu);
    if (fdef.buildTabs) {
      const tabs = el('div.bmtabs');
      for (const tab of fdef.buildTabs) {
        tabs.appendChild(button('bmtab' + (tab === buildTab ? ' on' : ''), t('build.tab.' + tab), () => { buildTab = tab; renderBuildMenu(); }, t('build.tab.' + tab)));
      }
      buildMenu.appendChild(tabs);
    }
    for (const stype of fdef.buildList) {
      const def = STRUCTURES[stype];
      if (fdef.buildTabs && (def.cat || 'defense') !== buildTab) continue;
      const locked = !unlockedBySpec(sim.state, viewer, def);
      const cost = def.kind === 'linear' ? structureCost(sim.state, viewer, stype, 1) : def.cost;
      const per = def.kind === 'linear' ? '/m' : '';
      const b = button('bm' + (locked ? ' locked' : ''), `${icon(locked ? 'lock' : iconForStructure(stype))}<span class="n">${t('struct.' + stype)}</span><span class="c">${locked ? t('build.spec') : costText(cost) + per}</span><span class="d">${t('struct.' + stype + '.desc')}</span>`, () => {
        if (!unlockedBySpec(sim.state, viewer, def)) { notify('build.spec', 'warn'); return; }
        if (def.requires && !hasBuilt(def.requires)) { notify('build.requires_x', 'warn', { struct: t('struct.' + def.requires) }); return; }
        buildOpen = false;
        toggleClass(buildMenu, 'open', false);
        game.input.startPlacement(stype);
      }, t('struct.' + stype + '.desc'));
      b.dataset.stype = stype;
      b.dataset.locked = locked ? '1' : '';
      buildMenu.appendChild(b);
    }
  }
  renderBuildMenu();
  let specSig = '';

  function hasBuilt(type) {
    return sim.state.structures.some((x) => x.faction === viewer && x.type === type && x.built);
  }

  function toggleBuildMenu(force) {
    if (!fdef.buildList.length) return;
    buildOpen = force !== undefined ? force : !buildOpen;
    if (buildOpen) renderBuildMenu(); // speciality locks may have changed
    toggleClass(buildMenu, 'open', buildOpen);
    if (buildOpen && game.audio) game.audio.ui('click');
  }

  // ------------------------------------------------------------------ command bar
  let dirty = true;
  let lastKey = '';
  function cmd(name, label, fn, opts = {}) {
    const b = button('cmd' + (opts.on ? ' on' : '') + (opts.warn ? ' warn' : ''), icon(name) + (label ? `<i>${label}</i>` : ''), fn, opts.title || label);
    if (opts.disabled) b.disabled = true;
    b.dataset.cmd = name;
    return b;
  }

  function selectionKey() {
    const ids = [...game.selection.squads].sort((a, b) => a - b).join(',');
    return ids + '|' + game.selection.struct + '|' + game.mode.kind + '|' + game.ui.attackMove + '|' + sim.state.match.phase + '|' + buildOpen + '|' + commandState();
  }

  /** State of the selected things that changes which commands exist (queue, site, damage, losses). */
  function commandState() {
    let k = '';
    const st = game.selection.struct ? game.knownStructure(game.selection.struct) : null;
    if (st && st.faction === viewer) k += (st.built ? 'b' : 'u') + (st.queue && st.queue.length ? 'q' : '') + (st.hp < st.maxHp ? 'd' : '');
    let short = false, formation = '';
    for (const id of game.selection.squads) {
      const sq = sim.rt.squadById.get(id);
      if (!sq || sq.faction !== viewer) continue;
      if (!formation) formation = sq.formation;
      if (sq.members.length < unitDef(sq.type).squadSize) short = true;
    }
    return k + (short ? 'r' : '') + formation;
  }

  function renderCommands() {
    renderCommandButtons();
    // the build menu belongs to a Build button: without one on the bar it cannot stay open
    if (buildOpen && !cmds.querySelector('[data-cmd="build"]')) buildOpen = false;
  }

  function renderCommandButtons() {
    clear(cmds);
    const own = game.selection.ownSquads(sim, viewer);
    const st = game.selection.struct ? game.knownStructure(game.selection.struct) : null;
    if (own.length) {
      const hasBuilder = own.some((sq) => unitDef(sq.type).roles.indexOf('builder') >= 0);
      const hasCombat = own.some((sq) => unitDef(sq.type).combatUnit);
      cmds.append(cmd('stop', t('hud.stop'), () => game.actions.stop()));
      if (hasCombat) {
        cmds.append(cmd('attack_move', t('hud.attack_move'), () => {
          game.ui.attackMove = !game.ui.attackMove;
          dirty = true;
        }, { on: game.ui.attackMove }));
      }
      const f = own[0].formation;
      const fi = PLAYER_FORMATIONS.indexOf(f);
      cmds.append(cmd('formation', t('formation.' + f), () => {
        game.actions.formation(PLAYER_FORMATIONS[(fi + 1) % PLAYER_FORMATIONS.length]);
        setTimeout(() => { dirty = true; }, 120);
      }, { title: t('hud.formation') }));
      const rc = sideDef(viewer).reinforcements;
      if (rc && own.some((sq) => sq.members.length < unitDef(sq.type).squadSize)) {
        // the squad holds its ground; paid replacements walk up from the rear
        const rcost = { manpower: rc.manpower, supply: rc.supply };
        cmds.append(cmd('reinforce', `${t('hud.reinforce_req')}<br><small>${costText(rcost)}/${t('hud.per_soldier')}</small>`, () => game.actions.reinforce(), { title: t('hud.reinforce_tip') }));
      }
      if (hasBuilder) {
        const gang = own.some((sq) => unitDef(sq.type).gathers === 'corpse');
        cmds.append(cmd('build', t('hud.build'), () => toggleBuildMenu(), { on: buildOpen }));
        if (!gang) cmds.append(cmd('repair', t('hud.repair'), () => game.input.startRepair()));
        cmds.append(cmd('gather', t(gang ? 'hud.haul' : 'hud.gather'), () => game.input.startGather(), { title: t(gang ? 'hud.haul_tip' : 'hud.gather') }));
      }
      if (p3) { const extra = []; p3.squadCommands(own, extra); cmds.append(...extra); }
      if (p4) { const extra = []; p4.squadCommands(own, extra); cmds.append(...extra); }
      return; // Phase 4.1: clearing the selection is the info card's small X, not a command slot
    }
    if (st) {
      const def = STRUCTURES[st.type];
      if (st.faction === viewer) {
        if (st.built && def.trains) {
          for (const u of def.trains) {
            const ud = unitDef(u);
            // speciality-locked units stay visible (what a doctrine would give) but locked
            const lockedSpec = !unlockedBySpec(sim.state, viewer, ud) || (def.trainsSpec && def.trainsSpec[u] && !sim.state.factions[viewer].spec.includes(def.trainsSpec[u]));
            const req = lockedSpec ? requirementText('units', u) || t('train.spec') : '';
            const b = cmd(lockedSpec ? 'lock' : iconForUnit(ud), `${t(ud.nameKey)}<br><small>${lockedSpec ? req : costText(unitCost(sim.state, viewer, u))}</small>`, () => game.actions.train(st, u), { title: lockedSpec ? req + ' — ' + t(ud.descKey) : t(ud.descKey) });
            b.dataset.unit = u;
            b.classList.add('train');
            if (lockedSpec) b.classList.add('locked');
            cmds.append(b);
          }
          if (st.queue && st.queue.length) cmds.append(cmd('cancel', t('hud.cancel'), () => game.actions.cancelTrain(st)));
          cmds.append(cmd('rally', t('hud.rally'), () => game.input.startRally(st)));
        }
        if (!st.built && def.buildable) cmds.append(cmd('cancel', t('hud.cancel'), () => { game.actions.cancelBuild(st); game.selection.clear(); }));
        if (sideDef(viewer).buildList.length && (st.hp < st.maxHp || !st.built) && def.kind !== 'area') {
          cmds.append(cmd('repair', t('hud.repair'), () => game.actions.assistWithNearest(st)));
        }
      }
      if (p3) { const extra = []; p3.structCommands(st, extra); cmds.append(...extra); }
      if (p4) { const extra = []; p4.structCommands(st, extra); cmds.append(...extra); }
      return;
    }
    if (game.selection.squads.size) return; // enemy squad inspected: nothing to command
    // nothing selected: faction-level actions
    if (fdef.buildList.length) cmds.append(cmd('build', t('hud.build'), () => toggleBuildMenu(), { on: buildOpen }));
    if (p3) { const extra = []; p3.factionCommands(extra); cmds.append(...extra); }
    for (const a of fdef.abilities) {
      const locked = !unlockedBySpec(sim.state, viewer, ABILITIES[a]);
      const b = cmd(locked ? 'lock' : a, t(ABILITIES[a].nameKey), () => game.input.startAbility(a), { title: t(ABILITIES[a].descKey) + '\n' + abilityStats(a) });
      b.dataset.ability = a;
      b.classList.add('ability');
      if (locked) b.classList.add('locked');
      cmds.append(b);
    }
  }

  /** Readable ability summary from data (damage, infection, duration, radius, cooldown, cost). */
  function abilityStats(id) {
    const a = ABILITIES[id];
    const cd = game.actions.abilityCooldown ? game.actions.abilityCooldown(id) : a.cooldown;
    const parts = [];
    if (a.effect === 'swarm') {
      parts.push(t('ab.dps', { v: a.dps }));
      parts.push(t('ab.infect', { v: a.infectInterval }));
      parts.push(t('ab.acc', { v: Math.round(a.accuracyDebuff * 100) }));
      parts.push(t('ab.duration', { v: a.duration }));
      parts.push(t('ab.ignores_cover'));
    } else if (a.effect === 'plague_cloud') {
      parts.push(t('ab.dps', { v: a.dps }));
      parts.push(t('ab.infect', { v: a.infectInterval }));
      if (a.maxStacks) parts.push(t('ab.max_stacks', { v: a.maxStacks }));
      parts.push(t('ab.duration', { v: a.duration }));
      parts.push(t('ab.pestilence_cost', { v: a.pestilenceCost }));
    } else if (a.effect === 'purge' || a.effect === 'tide') {
      if (a.duration) parts.push(t('ab.duration', { v: a.duration }));
    } else {
      parts.push(t('ab.shells', { n: a.shells, d: a.damage }));
      if (a.suppress) parts.push(t('ab.suppress', { v: a.suppress.seconds }));
      if (a.craters) parts.push(t('ab.craters'));
      parts.push(t('ab.delay', { v: a.delay }));
    }
    parts.push(t('ab.radius', { v: a.radius }));
    parts.push(t('ab.cooldown', { v: Math.round(cd) }));
    parts.push(costText(a.cost));
    return parts.join(' · ');
  }

  // ------------------------------------------------------------------ mode bar
  function renderModebar() {
    clear(modebar);
    const m = game.mode;
    let text = '';
    const btns = [];
    if (m.kind === 'place') {
      const def = STRUCTURES[m.stype];
      if (def.kind === 'linear') {
        text = !m.p1 ? t('hud.place_linear') : !m.p2 ? t('hud.place_linear_end') : t('hud.place_confirm');
        if (m.p1 && (m.p2 || m.hover)) text += ' · ' + t('hud.length', { m: (m.len || 0).toFixed(1) });
      } else if (m.reorient) text = t('gun.reorient_tip', { m: def.relay ? def.relay.material : 0, s: def.relay ? def.relay.sec : 0 });
      else text = m.pinned ? t('hud.place_hint') : t('hud.place_building');
      // Phase 4.1: a firing structure shows its arc; the "why" comes with its fix
      if (def.kind !== 'linear' && (def.arc || def.emplacement) && (def.arc || 360) < 360) text += ' · ' + t('hud.place_arc', { a: def.arc });
      if (m.reason) {
        text += ' — ' + t(m.reason);
        const fix = fixFor(sim, viewer, { reason: m.reason, stype: m.stype });
        if (fix) text += '<br><small>' + t('why.fix', { s: fix }) + '</small>';
      } else if (m.cost) text += ' — ' + costText(m.cost);
      // corpse mound: bodies inside its processing area (filled in by update from the overlay)
      if (def.harvestRadius && !m.linear) text += '<br><small class="mprev"></small>';
      // no 45° rotate button: tap pins the ghost, a drag around it turns it freely
      const ok = cmd('confirm', '', () => game.input.confirmPlacement(), { title: t('hud.confirm') });
      if (!m.valid) ok.disabled = true;
      ok.classList.add('ok');
      btns.push(ok);
    } else if (m.kind === 'ability') text = t('hud.ability_hint') + ' — <b>' + t(ABILITIES[m.id].nameKey) + '</b><br><small>' + abilityStats(m.id) + '</small>';
    else if (m.kind === 'rally') text = t('hud.rally_hint');
    else if (m.kind === 'repair') text = t('hud.repair_hint');
    else if (m.kind === 'gather') text = t(game.selection.ownSquads(sim, viewer).some((sq) => unitDef(sq.type).gathers === 'corpse') ? 'hud.haul_hint' : 'hud.gather_hint');
    else if (m.kind === 'area') text = t(m.area === 'forage' ? 'hud.forage_hint' : m.area === 'sanitize' ? 'hud.sanitize_hint' : m.area === 'salvage' ? 'hud.salvage_hint' : 'hud.herd_hint');
    else if (game.ui.attackMove) text = t('hud.attack_move');
    if (!text) { toggleClass(modebar, 'open', false); return; }
    toggleClass(modebar, 'open', true);
    modebar.append(el('span.mt', { html: text }));
    for (const b of btns) modebar.append(b);
    modebar.append(cmd('cancel', '', () => {
      // in build mode ✕ drops this spot and stays in build mode (a second ✕ leaves)
      if (game.mode.kind === 'place') game.input.cancelSpot();
      else if (game.mode.kind !== 'normal') game.input.cancelMode();
      game.ui.attackMove = false;
      dirty = true;
    }, { title: game.mode.kind === 'place' ? t('hud.place_cancel') : t('hud.cancel') }));
  }

  // ------------------------------------------------------------------ selection info (live)
  function statusOf(sq) {
    if (sq.members.some((m) => m.postId)) return t('hud.in_trench');
    if (sq.target && sq.engaged) return t('hud.fighting');
    if (sq.working || sq.order.t === 'build' || sq.order.t === 'repair' || sq.order.t === 'gather') return t('hud.working');
    if (sq.order.t === 'move' || sq.order.t === 'attack') return t('hud.moving');
    return t('hud.idle');
  }

  /** Small X at the card's top right (≥ 44 px hit area): clears the selection only. */
  function closeX() {
    const b = el('button.selx', { type: 'button', title: t('hud.close_card'), 'aria-label': t('hud.close_card') }, el('b', { html: icon('deselect', 'sm') }));
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      game.selection.clear();
      if (game.audio) game.audio.ui('select');
      dirty = true;
    });
    return b;
  }

  /** Elite card lines: role, passive name + radius, short description (Phase 4.1). */
  function eliteRows(def) {
    const e = def.elite;
    if (!e) return [];
    const r = def.aura && def.aura.radius ? def.aura.radius : def.marksman && WEAPONS[def.weapon] ? WEAPONS[def.weapon].range : 0;
    const head = el('div.elite', { html: `<b>${t('elite.tag')}</b><span>${t('elite.role.' + e.role)}</span><span class="pn">${t('elite.passive')}: ${t('elite.passive.' + e.passive)}${r ? ' · ' + t('elite.radius', { r }) : ''}</span>` });
    return [head, el('div.edesc', { text: t('elite.passive.' + e.passive + '.desc') })];
  }

  function renderInfo() {
    clear(info);
    info.appendChild(closeX());
    const own = game.selection.ownSquads(sim, viewer);
    const st = game.selection.struct ? game.knownStructure(game.selection.struct) : null;
    if (own.length === 1 || (!own.length && game.selection.squads.size === 1 && !st)) {
      const sq = own[0] || sim.rt.squadById.get([...game.selection.squads][0]);
      if (!sq) return;
      const def = unitDef(sq.type);
      const enemy = sq.faction !== viewer;
      // Phase 5A mirror match: the same unit names on both sides — the enemy's are marked
      const mirror = enemy && baseFaction(sq.faction) === baseFaction(viewer) ? t('side.enemy') + ' · ' : '';
      const head = el('div.ih', { html: `${icon(iconForUnit(def))}<span class="nm">${mirror}${t(def.nameKey)}</span>` }, el('span.cnt'), el('span.st'));
      if (enemy) head.classList.add('enemy');
      const hp = el('div.bar.hp', null, el('i'));
      const rows = [head, el('div.row', { html: icon('cover', 'sm') }, hp)];
      if (!enemy && sq.ammoMax > 0) rows.push(el('div.row', { html: icon('ammo', 'sm') }, el('div.bar.ammo', null, el('i'))));
      if (!isPlagueImmune(sq.faction)) rows.push(el('div.row.infrow', { html: icon('infection', 'sm') }, el('div.bar.inf', null, el('i')), el('span.inft')));
      if (!enemy) rows.push(el('div.cov'));
      rows.push(...eliteRows(def));
      info.append(...rows);
      info.dataset.kind = 'squad';
      info.dataset.id = sq.id;
      toggleClass(info, 'open', true);
      return;
    }
    if (own.length > 1) {
      const counts = new Map();
      for (const sq of own) counts.set(sq.type, (counts.get(sq.type) || 0) + 1);
      const types = [...counts.entries()].map(([ty, n]) => `<span class="ty">${icon(iconForUnit(unitDef(ty)), 'sm')}${n}</span>`).join('');
      info.append(el('div.ih', { html: `<span class="nm">${t('hud.squads', { n: own.length })}</span><span class="tys">${types}</span>` }, el('span.cnt')));
      info.append(el('div.row', { html: icon('cover', 'sm') }, el('div.bar.hp', null, el('i'))));
      info.append(el('div.cov'));
      info.dataset.kind = 'multi';
      toggleClass(info, 'open', true);
      return;
    }
    if (st) {
      const def = STRUCTURES[st.type];
      const nameKey = st.faction === 'neutral' && !def.garrison ? (st.type === 'trench' ? 'struct.neutral_trench' : 'struct.neutral_wire') : 'struct.' + st.type;
      const smirror = st.faction !== viewer && st.faction !== 'neutral' && baseFaction(st.faction) === baseFaction(viewer) ? t('side.enemy') + ' · ' : '';
      const head = el('div.ih', { html: `${icon(iconForStructure(st.type))}<span class="nm">${smirror}${t(nameKey)}</span>` }, el('span.st'));
      if (st.faction !== viewer && st.faction !== 'neutral') head.classList.add('enemy');
      info.append(head, el('div.row', null, el('div.bar.hp', null, el('i'))));
      if (st.faction === viewer && def.buildable) info.append(el('div.sdesc', { text: t('struct.' + st.type + '.desc') }));
      if (p3) p3.structInfo(st, info);
      if (p4) p4.structInfo(st, info);
      if (def.trains && st.faction === viewer) info.append(el('div.queue')); // never an enemy's production
      info.dataset.kind = 'struct';
      info.dataset.id = st.id;
      toggleClass(info, 'open', true);
      return;
    }
    clear(info);
    info.dataset.kind = '';
    toggleClass(info, 'open', false);
  }

  function updateInfo() {
    const kind = info.dataset.kind;
    if (!kind) return;
    if (kind === 'squad') {
      const sq = sim.rt.squadById.get(Number(info.dataset.id));
      if (!sq) return;
      const def = unitDef(sq.type);
      let hp = 0, alive = 0, lvl = 0, idx = 0, enRoute = 0;
      for (const m of sq.members) {
        if (m.state === 'joining') { enRoute++; continue; } // walking replacements: "+N en route"
        if (m.state !== 'alive' && m.state !== 'rising') continue;
        alive++; hp += Math.max(0, m.hp);
        const l = coverLevel(m.cover);
        if (l > lvl) { lvl = l; idx = m.cover; }
      }
      setText(info.querySelector('.cnt'), `${alive}/${def.squadSize}` + (enRoute && sq.faction === viewer ? ' ' + t('hud.en_route', { n: enRoute }) : ''));
      setText(info.querySelector('.st'), sq.faction === viewer ? statusOf(sq) : t('hud.enemy'));
      setWidth(info.querySelector('.hp i'), hp / (def.hp * def.squadSize));
      const ammo = info.querySelector('.ammo i');
      if (ammo) { setWidth(ammo, sq.ammoMax ? sq.ammo / sq.ammoMax : 0); toggleClass(ammo.parentNode, 'low', sq.ammo < sq.ammoMax * 0.25); }
      const cov = info.querySelector('.cov');
      if (cov) {
        let txt = t('hud.cover') + ': ' + t(COVER_TYPES[COVER_IDS[idx]].key);
        if (sq.faction === viewer && sq.reinf) txt += ' · ' + t(sq.reinf.cut ? 'hud.reinf_cut' : sq.reinf.wait ? 'hud.reinf_wait' : 'hud.reinf_on');
        // Phase 4.1: wet ground / mud under the squad (movement penalty)
        const lvl = mudLevelAt(sim.state, sq.cx, sq.cz);
        if (lvl > 0) txt += ' · ' + t('mud.tip', { lvl: t('mud.' + MUD_LEVELS[lvl]), p: Math.round(mudSpeedAt(sim.state, sq.cx, sq.cz) * 100) });
        setText(cov, txt);
        cov.dataset.level = String(lvl);
      }
      // visible sickness: infected soldiers and average stacks (seen soldiers only for enemies)
      const ib = info.querySelector('.inf i');
      if (ib) {
        let n = 0, stacks = 0, seen = 0;
        for (const m of sq.members) {
          if (m.state !== 'alive') continue;
          if (sq.faction !== viewer && !isSoldierVisibleTo(sim, sq, m, viewer)) continue;
          seen++;
          if (m.infection > 0) { n++; stacks += m.infection; }
        }
        setWidth(ib, seen ? stacks / (seen * INFECTION_MAX) : 0);
        const row = info.querySelector('.infrow');
        toggleClass(row, 'none', n === 0);
        setText(info.querySelector('.inft'), n ? t('hud.infected', { n, avg: (stacks / n).toFixed(1) }) : t('hud.healthy'));
      }
    } else if (kind === 'multi') {
      const own = game.selection.ownSquads(sim, viewer);
      let hp = 0, max = 0, alive = 0, inCover = 0;
      for (const sq of own) {
        const def = unitDef(sq.type);
        max += def.hp * def.squadSize;
        for (const m of sq.members) {
          if (m.state !== 'alive') continue;
          alive++; hp += m.hp;
          if (coverLevel(m.cover) >= 2) inCover++;
        }
      }
      setText(info.querySelector('.cnt'), t('hud.soldiers', { n: alive }));
      setWidth(info.querySelector('.hp i'), max ? hp / max : 0);
      setText(info.querySelector('.cov'), t('hud.cover') + ': ' + inCover + '/' + alive);
    } else if (kind === 'struct') {
      const st = game.knownStructure(Number(info.dataset.id));
      if (!st) return;
      const live = !st.memory && (st.faction === viewer || st.faction === 'neutral' || isStructureVisibleTo(st, viewer));
      let status = '';
      if (!st.built) status = t('struct.under_construction') + ' ' + Math.floor(st.progress * 100) + '%';
      else if (st.type === 'trench') {
        // the whole connected network (several squads share it)
        const segs = st.faction === viewer || st.faction === 'neutral' ? trenchNetwork(sim.state.structures, st, viewer) : [st];
        const cap = networkCapacity(sim.state, segs, viewer, null);
        status = `${cap.used}/${cap.total || trenchSlotCount(st)} · ${t('hud.cover')} ${Math.round(trenchCoverStrength(st) * 100)}%`;
      }
      else if (live && st.maxHp) {
        const r = st.hp / st.maxHp;
        if (r < 0.33) status = t('hud.stage_critical');
        else if (r < 0.66) status = t('hud.stage_damaged');
      }
      if (!live) status = t('hud.last_known');
      setText(info.querySelector('.st'), status);
      setWidth(info.querySelector('.hp i'), live ? st.hp / st.maxHp : 1);
      if (p3 && live) p3.updateStructInfo(st, info);
      if (p4 && live) p4.updateStructInfo(st, info);
      const q = info.querySelector('.queue');
      if (q) {
        const key = (st.queue || []).map((it) => it.unit).join(',');
        if (q.dataset.key !== key) {
          q.dataset.key = key;
          q.innerHTML = (st.queue || []).map((it, i) => `<span class="qi${i ? '' : ' first'}">${icon(iconForUnit(unitDef(it.unit)), 'sm')}<i></i></span>`).join('');
        }
        const first = q.querySelector('.first i');
        if (first && st.queue.length) setWidth(first, 1 - st.queue[0].remaining / st.queue[0].total);
      }
    }
  }

  // ------------------------------------------------------------------ live top bar
  function updateTop() {
    const f = sim.state.factions[viewer];
    for (const k in resNodes) {
      if (k === 'corpses') {
        let n = 0;
        for (const c of sim.state.corpses) if (isCorpseKnownTo(c, viewer)) n++;
        setText(resNodes[k], n);
      } else setText(resNodes[k], Math.floor(f.resources[k] || 0));
    }
    const ph = session.phase();
    const known = game.renderer.knownStructures ? game.renderer.knownStructures() : sim.state.structures;
    let obj = null;
    for (const st of known) if (st.objective) { obj = st; break; }
    // unknown to the viewer yet (attacker before scouting): shown as unscouted, never as a live value
    setWidth(objBar.firstChild, obj ? obj.hp / obj.maxHp : 1);
    toggleClass(objBar, 'low', !!obj && obj.hp / obj.maxHp < 0.35);
    toggleClass(objBox, 'stale', !obj || !!obj.memory);
    setText(phaseName, t('phase.' + ph));
    const left = session.phaseTimeLeft();
    // endless war: elapsed war time with an infinity mark instead of a countdown
    setText(phaseTime, ph === 'ENDED' ? '' : left < 0 ? '∞ ' + formatClock(Math.max(0, (sim.state.tick - sim.state.match.prepEndTick) / 20)) : formatClock(left));
    toggleClass(phaseBox, 'prep', ph === 'PREPARATION');
    toggleClass(phaseBox, 'war', ph === 'WAR');
    toggleClass(phaseBox, 'lull', ph === 'LULL');
    // affordability of train / build / ability buttons
    for (const b of cmds.querySelectorAll('.train')) b.classList.toggle('poor', b.classList.contains('locked') || !canAfford(f.resources, unitCost(sim.state, viewer, b.dataset.unit)));
    for (const b of cmds.querySelectorAll('.ability')) {
      const a = b.dataset.ability;
      const st = f.abilities[a];
      const cd = st ? Math.max(0, (st.readyTick - sim.state.tick) / TICK_RATE) : 0;
      const pestShort = ABILITIES[a].requiresPestilence && (f.pestilence || 0) < ABILITIES[a].requiresPestilence;
      b.classList.toggle('poor', b.classList.contains('locked') || pestShort || !canAfford(f.resources, ABILITIES[a].cost) || cd > 0 || ph !== 'WAR');
      let badge = b.querySelector('.cd');
      if (cd > 0) {
        if (!badge) { badge = el('span.cd'); b.appendChild(badge); }
        setText(badge, Math.ceil(cd));
      } else if (badge) badge.remove();
    }
    for (const b of buildMenu.querySelectorAll('.bm')) {
      const def = STRUCTURES[b.dataset.stype];
      const cost = def.kind === 'linear' ? structureCost(sim.state, viewer, b.dataset.stype, def.minLen) : def.cost;
      b.classList.toggle('poor', !!b.dataset.locked || !canAfford(f.resources, cost) || (def.requires && !hasBuilt(def.requires)));
    }
    // a doctrine was chosen: locks change (menu + command bar)
    const sig = (f.spec || []).join(',');
    if (sig !== specSig) { specSig = sig; if (buildOpen) renderBuildMenu(); dirty = true; }
    // reinforcement request button: progress of walking replacements
    const rb = cmds.querySelector('[data-cmd="reinforce"]');
    if (rb) {
      const own = game.selection.ownSquads(sim, viewer);
      let want = 0, walking = 0, cut = false, waiting = false;
      for (const sq of own) {
        want += Math.max(0, unitDef(sq.type).squadSize - sq.members.length);
        for (const m of sq.members) if (m.state === 'joining') walking++;
        if (sq.reinf) { cut = cut || !!sq.reinf.cut; waiting = waiting || !!sq.reinf.wait; }
      }
      let badge = rb.querySelector('.cd');
      const txt = cut ? '✕' : walking ? walking + '→' : want ? '+' + want : '';
      if (txt) {
        if (!badge) { badge = el('span.cd'); rb.appendChild(badge); }
        setText(badge, txt);
      } else if (badge) badge.remove();
      rb.classList.toggle('poor', cut || waiting || !canAfford(f.resources, { manpower: fdef.reinforcements.manpower, supply: fdef.reinforcements.supply }));
    }
  }

  function refreshSpeed() {
    for (const v in speedBtns) toggleClass(speedBtns[v], 'on', Number(v) === session.speed);
  }
  refreshSpeed();

  // ------------------------------------------------------------------ notices
  const lastNotice = new Map();
  function notify(key, level = 'info', params, throttle = 1.2, fix = '') {
    const now = performance.now() / 1000;
    const k = key + (params ? JSON.stringify(params) : '');
    if (lastNotice.has(k) && now - lastNotice.get(k) < throttle) return;
    lastNotice.set(k, now);
    const n = el('div.notice.' + level, { text: t(key, params) });
    // Phase 4.1 "why can't I?": the fix travels with the refusal (ui/reasons.js)
    if (fix) { n.appendChild(el('small.fix', { text: t('why.fix', { s: fix }) })); n.classList.add('why'); }
    notices.prepend(n);
    while (notices.childNodes.length > 4) notices.lastChild.remove();
    const life = fix ? 1.8 : 1;
    setTimeout(() => n.classList.add('fade'), (level === 'warn' ? 1600 : 2600) * life);
    setTimeout(() => n.remove(), (level === 'warn' ? 2200 : 3300) * life);
  }

  function showBanner(text, cls = '') {
    banner.className = 'banner show ' + cls;
    banner.textContent = text;
    clearTimeout(showBanner.tm);
    showBanner.tm = setTimeout(() => { banner.className = 'banner'; }, 3200);
  }

  function onEvent(ev) {
    switch (ev.type) {
      case EV.PHASE_CHANGED:
        if (ev.phase === 'WAR' && !ev.afterLull) showBanner(t('notice.war_begins'), 'war');
        dirty = true;
        break;
      case EV.COMMAND_REJECTED:
        if (ev.faction === viewer) notify(ev.reason, 'warn', null, 1.5, fixFor(sim, viewer, ev));
        break;
      case EV.TRAIN_COMPLETED:
        if (ev.faction === viewer) notify(fdef.emergingProduction ? 'notice.unit_raised' : 'notice.unit_ready', 'good', { unit: t(unitDef(ev.unit).nameKey) });
        break;
      case EV.STRUCTURE_COMPLETED:
        if (ev.faction === viewer) notify('notice.structure_done', 'good', { struct: t('struct.' + ev.stype) }, 0.3);
        break;
      case EV.STRUCTURE_DESTROYED:
        if (ev.faction === viewer && !ev.cancelled) notify('notice.structure_lost', 'bad', { struct: t('struct.' + ev.stype) }, 0.3);
        break;
      case EV.SQUAD_DESTROYED:
        if (ev.faction === viewer) notify('notice.squad_lost', 'bad', { unit: t(unitDef(ev.unit).nameKey) }, 2);
        break;
      case EV.STRUCTURE_DAMAGED: {
        const st = sim.rt.structById.get(ev.id);
        if (st && st.objective && st.faction === viewer) notify('notice.objective_attacked', 'bad', null, 20);
        break;
      }
      case EV.SOLDIER_RISING:
        if (ev.faction === viewer) notify('notice.dead_rise', 'good', null, 15);
        break;
      case EV.ABILITY_CAST:
        if (ev.faction !== viewer && ev.ability === 'artillery_barrage') notify('notice.enemy_barrage', 'bad', null, 8);
        if (ev.faction !== viewer && ev.ability === 'mortar_barrage') notify('notice.enemy_mortar', 'bad', null, 8);
        if (ev.faction !== viewer && ev.ability === 'fly_swarm') notify('notice.enemy_swarm', 'bad', null, 8);
        break;
      case EV.NOTICE:
        if (ev.faction === viewer) {
          const good = ev.key === 'reinf.complete' || ev.key === 'reinf.dispatched' || ev.key === 'evac.arrived' || ev.key === 'sanitize.done' || ev.key === 'pen.slaughtered';
          const params = ev.n !== undefined || ev.res || ev.s !== undefined ? { n: ev.n, s: ev.s, res: ev.res ? t('res.' + ev.res) : '' } : null;
          notify(ev.key, good ? 'good' : ev.key === 'settle.lost' ? 'bad' : 'warn', params, 3, fixFor(sim, viewer, ev));
        }
        break;
      default: break;
    }
    if (p3) p3.onEvent(ev);
    if (p4) p4.onEvent(ev);
  }

  // ------------------------------------------------------------------ box selection rectangle
  function showBox(x0, y0, x1, y1) {
    const r = game.canvas.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const ox = r.left - rr.left, oy = r.top - rr.top;
    boxRect.style.display = 'block';
    boxRect.style.left = ox + Math.min(x0, x1) + 'px';
    boxRect.style.top = oy + Math.min(y0, y1) + 'px';
    boxRect.style.width = Math.abs(x1 - x0) + 'px';
    boxRect.style.height = Math.abs(y1 - y0) + 'px';
  }
  function hideBox() {
    boxRect.style.display = 'none';
  }

  // ------------------------------------------------------------------ per frame
  let acc = 0;
  let lastSelVersion = -1;
  let prepHintShown = false;
  let lastMulti = false;
  function update(dt) {
    // multi-select is one-shot: the input layer switches it off after one tap / box
    if (!!game.ui.multi !== lastMulti) { lastMulti = !!game.ui.multi; refreshToggles(); }
    const key = selectionKey();
    if (key !== lastKey || dirty || game.selection.version !== lastSelVersion) {
      lastKey = key;
      if (p3 && game.selection.version !== lastSelVersion) p3.onSelectionChanged();
      lastSelVersion = game.selection.version;
      dirty = false;
      renderCommands();
      renderModebar();
      renderInfo();
      toggleClass(buildMenu, 'open', buildOpen && fdef.buildList.length > 0);
      acc = 1; // refresh live values now
    }
    acc += dt;
    if (acc >= 0.2) {
      acc = 0;
      updateTop();
      updateInfo();
      if (game.mode.kind === 'place') renderModebarLive();
    }
    if (p3) p3.update(dt);
    if (p4) p4.update(dt);
    updateLens(dt);
    if (!prepHintShown && session.phase() === 'PREPARATION') {
      prepHintShown = true;
      setText(hint, t(fdef.prepHintKey || 'hud.prep_hint'));
      hint.classList.add('show');
      setTimeout(() => hint.classList.remove('show'), 9000);
    }
    // the hint gives way as soon as the player acts (it sits where the panels open)
    if (hint.classList.contains('show') && (game.selection.squads.size || game.selection.struct || buildOpen || game.mode.kind !== 'normal')) {
      hint.classList.remove('show');
    }
  }

  // cheap live refresh of the placement text (length / validity) without rebuilding buttons
  let lastPlaceKey = '';
  function renderModebarLive() {
    const m = game.mode;
    const k = [m.p1, m.p2, m.valid, m.reason, (m.len || 0).toFixed(1), m.pinned, m.hidden].join('|');
    if (k !== lastPlaceKey) { lastPlaceKey = k; renderModebar(); }
    // corpse mound preview: "in range: N usable bodies" (counted by the range overlay)
    const mp = modebar.querySelector('.mprev');
    if (mp) {
      const ri = game.renderer && game.renderer.overlays && game.renderer.overlays.rangeInfo ? game.renderer.overlays.rangeInfo() : null;
      setText(mp, ri && ri.preview ? t('range.in_area', { n: ri.preview.usable }) : '');
    }
  }

  function destroy() {
    root.remove();
  }

  // Phase 3 panels (engineer strip, specialities, Pestilence, population, settlements, trenches)
  p3 = createP3Hud(game, {
    root, resBox, quick, bottom, notify, cmd, showBanner, toggleLens,
    markDirty() { dirty = true; },
  });
  p4 = createP4Hud(game, {
    root, resBox, quick, bottom, notify, cmd, showBanner, toggleLens,
    markDirty() { dirty = true; },
  });

  return {
    root, minimapSlot, update, onEvent, notify, showBox, hideBox, destroy,
    onModeChanged() { dirty = true; if (game.mode.kind !== 'normal') { buildOpen = false; } },
    onSpeedChanged: refreshSpeed,
    onGroupsChanged() { if (p4) p4.onGroupsChanged(); },
    toggleBuildMenu,
    showBanner,
  };
}
