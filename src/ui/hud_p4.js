// Phase 4 HUD parts, plugged into ui/hud.js next to hud_p3.js:
//  - CONTROL GROUP slots 1/2/3 (long press = save the selection, tap = select, double tap = select +
//    camera), each with a small summary (squad count + unit icons)
//  - AUTO REINFORCEMENT toggle for the selected squads (the faction default lives in the pause menu)
//  - operational LULL banners ("the front is going quiet" / "the front stirs again")
// Reads state only; acts through game.actions / game.controlGroups (presentation state).
import { el, clear, button, setText, toggleClass } from './dom.js';
import { icon, iconForUnit } from './icons.js';
import { t } from './i18n.js';
import { unitDef } from '../data/units.js';
import { FACTIONS } from '../data/factions.js';
import { EV } from '../core/events.js';
import { GROUP_SLOTS_UI, LONG_PRESS_MS } from '../input/control_groups.js';
import { wantsAutoReinforce } from '../factions/reinforcement.js';
import { commanderView } from '../sim/commander.js';

export function createP4Hud(game, H) {
  const { sim, viewer } = game;
  const fdef = FACTIONS[viewer];
  const cg = game.controlGroups;

  // ------------------------------------------------------------------ control groups 1/2/3
  const box = el('div.cgroups', { title: t('cg.tip') });
  H.root.appendChild(box);
  const slots = [];
  for (let i = 0; i < GROUP_SLOTS_UI; i++) {
    const num = el('b', { text: String(i + 1) });
    const sum = el('i');
    const slot = el('button.cg', { type: 'button', title: t('cg.slot_tip', { n: i + 1 }) }, num, sum);
    let timer = 0, long = false;
    slot.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      long = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        long = true;
        const own = game.selection.ownSquads(sim, viewer);
        if (!own.length) { H.notify('cg.nothing', 'warn', null, 1); return; }
        cg.save(i, own.map((s) => s.id), sim, viewer);
        H.notify('cg.saved', 'good', { n: i + 1 }, 0.3);
        if (game.audio) game.audio.ui('confirm');
        slot.classList.add('flash');
        setTimeout(() => slot.classList.remove('flash'), 500);
        render(true);
      }, LONG_PRESS_MS);
    });
    const cancel = () => clearTimeout(timer);
    slot.addEventListener('pointerleave', cancel);
    slot.addEventListener('pointercancel', cancel);
    slot.addEventListener('pointerup', (e) => {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(timer);
      if (long) return;
      const r = cg.tap(i, performance.now());
      if (r === 'empty') { H.notify('cg.empty_hint', 'info', { n: i + 1 }, 2); return; }
      game.selection.set(cg.ids(i, sim, viewer));
      if (game.audio) game.audio.ui('select');
      if (r === 'focus') { const c = cg.center(i, sim, viewer); if (c) game.lookAt(c[0], c[1]); }
    });
    slot.addEventListener('contextmenu', (e) => e.preventDefault());
    box.appendChild(slot);
    slots.push({ slot, sum });
  }
  let groupsKey = '';
  function render(force) {
    cg.prune(sim, viewer);
    const parts = [];
    for (let i = 0; i < GROUP_SLOTS_UI; i++) { const s = cg.summary(i, sim, viewer); parts.push(s.count + ':' + s.types.join('.')); }
    const key = parts.join('|');
    if (!force && key === groupsKey) return;
    groupsKey = key;
    for (let i = 0; i < GROUP_SLOTS_UI; i++) {
      const s = cg.summary(i, sim, viewer);
      const { slot, sum } = slots[i];
      toggleClass(slot, 'empty', !s.count);
      clear(sum);
      if (s.count) sum.innerHTML = s.types.map((ty) => icon(iconForUnit(unitDef(ty)))).join('') + `<span>${s.count}</span>`;
    }
  }

  // ------------------------------------------------------------------ COMMANDER slot
  // portrait + health (tap: select him, double tap: camera) and the command ability with its
  // recharge; when he has fallen: the replacement timer, or "cannot be replaced"
  const cmdrBox = el('div.cmdr');
  const cmdrFace = el('button.cmdr-face', { type: 'button' });
  const cmdrAb = el('button.cmdr-ab', { type: 'button' });
  cmdrBox.append(cmdrFace, cmdrAb);
  box.appendChild(cmdrBox);
  let lastFaceTap = -1e9, cmdrKey = '';
  cmdrFace.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = commanderView(sim, viewer);
    if (!v || !v.alive) return;
    game.selection.set([v.sqId]);
    if (game.audio) game.audio.ui('select');
    const now = performance.now();
    if (now - lastFaceTap < 350) { const sq = sim.rt.squadById.get(v.sqId); if (sq) game.lookAt(sq.cx, sq.cz); }
    lastFaceTap = now;
  });
  cmdrAb.addEventListener('click', (e) => { e.stopPropagation(); game.actions.commanderAbility(); });
  function renderCommander() {
    const v = commanderView(sim, viewer);
    toggleClass(cmdrBox, 'none', !v);
    if (!v) return;
    const key = [sim.state.match.phase, v.alive, Math.ceil(v.abilityCd), v.abilityActive, Math.ceil(v.replaceIn), v.replaceable, Math.round(v.hp * 20)].join('|');
    if (key === cmdrKey) return;
    cmdrKey = key;
    const u = unitDef(v.unit);
    cmdrFace.innerHTML = icon(iconForUnit(u)) + `<span class="hp"><i style="width:${Math.round(v.hp * 100)}%"></i></span>`;
    cmdrFace.title = t(u.nameKey) + ' — ' + t(v.alive ? 'cmdr.tip' : v.replaceable ? 'cmdr.fallen_tip' : 'cmdr.lost_tip');
    toggleClass(cmdrFace, 'dead', !v.alive);
    const ab = v.ability;
    let label;
    if (!v.alive) label = v.replaceable ? (v.replaceIn > 0 ? t('cmdr.replace_in', { s: Math.ceil(v.replaceIn) }) : t('cmdr.replace_ready')) : t('cmdr.lost');
    else if (v.abilityActive) label = t('cmdr.active');
    else if (v.abilityCd > 0) label = Math.ceil(v.abilityCd) + 's';
    else label = t('ability.' + ab + '.short');
    cmdrAb.innerHTML = icon(ab === 'hold_the_line' ? 'hold_line' : 'commander') + `<i>${label}</i>`;
    cmdrAb.title = t('ability.' + ab) + ' — ' + t('ability.' + ab + '.desc');
    cmdrAb.disabled = !v.alive || v.abilityCd > 0;
    const war = sim.state.match.phase === 'WAR';
    cmdrAb.disabled = !v.alive || v.abilityCd > 0 || !war;
    toggleClass(cmdrAb, 'ready', war && v.alive && v.abilityCd <= 0 && !v.abilityActive);
    toggleClass(cmdrAb, 'active', v.abilityActive);
  }

  // ------------------------------------------------------------------ ECONOMY VIEW toggle
  const qEcon = button('q tog', icon('economy') + `<i>${t('hud.econ_short')}</i>`, () => {
    game.ui.econView = !game.ui.econView;
    refreshEcon();
    if (game.audio) game.audio.ui('select');
  }, t('hud.econ_tip'));
  function refreshEcon() {
    toggleClass(qEcon, 'on', !!game.ui.econView);
    setText(qEcon.querySelector('i'), game.ui.econView ? t('hud.econ_on') : t('hud.econ_short'));
  }
  if (H.quick) H.quick.insertBefore(qEcon, H.quick.lastChild);

  // ------------------------------------------------------------------ squad commands
  function squadCommands(own, out) {
    // SALVAGE AREA: engineers strip every known heap around the tapped point, then go home
    if (own.some((sq) => { const g = unitDef(sq.type).gathers; return !!g && g !== 'corpse'; })) {
      out.push(H.cmd('salvage', t('hud.salvage_area'), () => game.input.startArea('salvage'), { title: t('hud.salvage_tip') }));
    }
    // garrisoned squads: leave the ruin through the nearest doorway
    if (own.some((sq) => sq.order.t === 'garrison')) out.push(H.cmd('garrison', t('hud.ungarrison'), () => game.actions.ungarrison(), { title: t('hud.ungarrison_tip') }));
    if (!fdef.reinforcements) return;
    const re = own.filter((sq) => unitDef(sq.type).combatUnit);
    if (!re.length) return;
    const on = re.every((sq) => wantsAutoReinforce(sim.state, sq));
    out.push(H.cmd('autoreinf', t(on ? 'hud.autoreinf_on' : 'hud.autoreinf_off'), () => {
      game.actions.autoReinforce(on ? 0 : 1);
      setTimeout(() => H.markDirty(), 120);
    }, { on, title: t('hud.autoreinf_tip') }));
  }

  // ------------------------------------------------------------------ events
  function onEvent(ev) {
    switch (ev.type) {
      case EV.PHASE_WARNING:
        if (ev.phase === 'LULL') H.showBanner(t('lull.coming'), 'lull');
        else H.showBanner(t('lull.ending'), 'war');
        break;
      case EV.ABILITY_CAST:
        // fly swarm readability: the side under it is told to get out (only when it is seen)
        if (ev.ability === 'fly_swarm' && ev.faction !== viewer) H.notify('swarm.incoming', 'warn', null, 6);
        break;
      case EV.CIVILIAN_ALARM:
        if (ev.faction === viewer) {
          H.notify(ev.mode === 'flee' ? 'civ.alarm_flee' : 'civ.alarm_shelter', 'warn', null, 8);
          if (game.renderer && game.renderer.overlays) game.renderer.overlays.addMarker('alarm', ev.x, ev.z);
        }
        break;
      case EV.GARRISON_ENTERED:
        if (ev.faction === viewer && game.selection.has(ev.squadId)) H.notify('garrison.entered', 'good', null, 2);
        break;
      case EV.COMMANDER_FALLEN:
        if (ev.faction === viewer) H.showBanner(t(ev.replaceable ? 'cmdr.fallen' : 'cmdr.fallen_final'), 'war');
        else H.notify('cmdr.enemy_fallen', 'good', null, 5);
        cmdrKey = '';
        break;
      case EV.RUIN_COLLAPSED:
        H.notify('ruin.collapsed', ev.holder === viewer ? 'warn' : 'info', { n: ev.killed }, 1);
        break;
      case EV.PHASE_CHANGED:
        if (ev.phase === 'LULL') H.showBanner(t('lull.begins', { s: ev.duration }), 'lull');
        else if (ev.afterLull) H.showBanner(t('lull.over'), 'war');
        break;
      default: break;
    }
  }

  let acc = 0;
  function update(dt) {
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    render(false);
    renderCommander();
  }

  return { squadCommands, onEvent, update, onGroupsChanged: () => render(true) };
}
