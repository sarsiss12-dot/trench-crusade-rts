// Phase 3 HUD parts, plugged into ui/hud.js: ENGINEER STATUS strip (tap = select + pulse, double tap = camera),
// SPECIALITY cards (3 big cards, irreversible, through a plain command), PESTILENCE meter (Grail),
// POPULATION / manpower rate (New Antioch), settlement and livestock-pen panels (Evacuate,
// Slaughter, Herd area), trench OCCUPANCY badge + squad cards (the main way to pick squads out of
// a trench on a phone). Reads state only (fog-safe views); acts through game.actions / input.
import { el, clear, button, setText, setWidth, toggleClass } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { UNITS, unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { ABILITIES } from '../data/abilities.js';
import { FACTIONS } from '../data/factions.js';
import { SPECIALITIES, SPEC_TIERS, PESTILENCE } from '../data/specialities.js';
import { EV } from '../core/events.js';
import { availableTier, specList, tierUnlocked } from '../sim/specialities.js';
import { builderStatus } from '../units/engineers.js';
import { popCap, settlementRates, settlementSafe, isRemote } from '../economy/settlements.js';
import { sectorOfSettlement } from '../economy/sectors.js';
import { trenchPanelData } from './trench_panel.js';
import { autoReinforceOn, positionOf } from '../factions/reinforcement.js';

const STATUS_CLASS = {
  idle: 'ok', moving: 'mv', building: 'wk', repairing: 'wk', danger: 'dg', sanitizing: 'wk', hauling: 'wk', salvaging: 'wk',
  searching: 'mv', hunting: 'wk', collecting: 'wk', carrying: 'mv', delivering: 'wk', fleeing: 'dg',
};

function nowSec() {
  return performance.now() / 1000;
}

export function createP3Hud(game, H) {
  const { sim, viewer } = game;
  const fdef = FACTIONS[viewer];
  const root = H.root;
  const bg = viewer === 'black_grail';

  // ------------------------------------------------------------------ top bar additions
  let popNode = null, pestNode = null, pestBar = null, pestTier = null;
  if (fdef.population) {
    popNode = el('b');
    const chip = el('span.r.pop', { title: t('res.population') + ' — ' + t('res.population.tip'), html: icon('population') }, popNode);
    chip.dataset.res = 'population';
    chip.addEventListener('click', () => H.toggleLens('population'));
    H.resBox.appendChild(chip);
  }
  if (fdef.pestilence) {
    pestNode = el('b');
    pestTier = el('i.pt');
    pestBar = el('div.pestbar', null, el('i'));
    for (const tier of PESTILENCE.tiers) if (tier.at > 0 && tier.at < 100) pestBar.appendChild(el('span.tick', { style: { left: tier.at + '%' } }));
    const chip = el('span.r.pest', { title: t('res.pestilence') + ' — ' + t('res.pestilence.tip'), html: icon('pestilence') }, pestNode, pestTier, pestBar);
    chip.dataset.res = 'pestilence';
    chip.addEventListener('click', () => H.toggleLens('pestilence'));
    H.resBox.appendChild(chip);
  }
  // speciality button (quick stack, top of it)
  const specBadge = el('span.cd');
  const specBtn = button('q spec', icon('doctrine') + `<i>${t('spec.title')}</i>`, () => openSpec(), t('spec.title'));
  specBtn.appendChild(specBadge);
  H.quick.append(specBtn);

  // ------------------------------------------------------------------ engineer strip
  const strip = el('div.engstrip', { title: t('hud.engineers_strip') });
  root.appendChild(strip);
  let stripKey = '';
  const chips = new Map();
  function builders() {
    const res = [];
    for (const sq of sim.state.squads) {
      if (sq.faction !== viewer || !unitDef(sq.type).roles.includes('builder')) continue;
      if (!sq.members.some((m) => m.state === 'alive')) continue;
      res.push(sq);
    }
    return res;
  }
  function renderStrip() {
    const list = builders();
    const key = list.map((s) => s.id).join(',');
    if (key !== stripKey) {
      stripKey = key;
      clear(strip);
      chips.clear();
      for (const sq of list) {
        const lbl = el('i');
        // Phase 4.1: a tap SELECTS without moving the camera (a world pulse / screen-edge pointer
        // shows where it is); a double tap brings the camera there
        let lastTap = 0;
        const b = button('eng', icon(bg ? 'gang' : 'engineer'), () => {
          const now = nowSec();
          const dbl = now - lastTap < 0.35;
          lastTap = now;
          game.selection.set([sq.id]);
          if (dbl) game.lookAt(sq.cx, sq.cz);
          else if (game.renderer && game.renderer.overlays && game.renderer.overlays.ping) game.renderer.overlays.ping(sq.id);
          if (game.audio) game.audio.ui('select');
        }, t(unitDef(sq.type).nameKey) + ' — ' + t('eng.pulse_tip'));
        b.appendChild(lbl);
        strip.appendChild(b);
        chips.set(sq.id, { b, lbl });
      }
    }
    const now = nowSec();
    for (const sq of list) {
      const c = chips.get(sq.id);
      if (!c) continue;
      const st = builderStatus(sim, sq);
      setText(c.lbl, t('eng.' + st) + (sq.bq && sq.bq.length ? ' +' + sq.bq.length : ''));
      c.b.dataset.st = STATUS_CLASS[st] || 'ok';
      toggleClass(c.b, 'hl', game.engineerHighlights ? game.engineerHighlights.isHighlighted(sq.id, now) : false);
      toggleClass(c.b, 'sel', game.selection.has(sq.id));
    }
    toggleClass(strip, 'empty', list.length === 0);
  }

  // ------------------------------------------------------------------ speciality modal
  const modal = el('div.specmodal');
  root.appendChild(modal);
  let picked = null;
  function specName(id) {
    return t('spec.' + id);
  }
  function unlockNames(o) {
    const out = [];
    for (const u of (o.unlocks && o.unlocks.units) || []) out.push(t(UNITS[u] ? UNITS[u].nameKey : u));
    for (const s of (o.unlocks && o.unlocks.structures) || []) out.push(t('struct.' + s));
    for (const a of (o.unlocks && o.unlocks.abilities) || []) out.push(t(ABILITIES[a] ? ABILITIES[a].nameKey : a));
    return out;
  }
  function openSpec() {
    picked = null;
    renderSpec();
    modal.classList.add('open');
    if (game.audio) game.audio.ui('click');
  }
  function closeSpec() {
    modal.classList.remove('open');
  }
  function renderSpec() {
    clear(modal);
    const tiers = SPECIALITIES[viewer] || [];
    const chosen = specList(sim.state, viewer);
    const open = availableTier(sim.state, viewer);
    const box = el('div.specbox');
    box.appendChild(el('div.spechead', null, el('b', { text: t('spec.title') }), button('cmd', icon('cancel'), closeSpec, t('hud.cancel'))));
    // earlier / later tiers at a glance
    const path = el('div.specpath');
    tiers.forEach((opts, i) => {
      const id = chosen[i];
      const txt = id ? specName(id) : tierUnlocked(sim.state, i) ? t('spec.none') : t('spec.locked_at', { p: Math.round(SPEC_TIERS[i].at * 100) });
      path.appendChild(el('span.tierchip' + (id ? '.done' : i === open ? '.open' : ''), { html: `<b>${t('spec.tier.' + i)}</b> ${txt}` }));
    });
    box.appendChild(path);
    if (open < 0) {
      box.appendChild(el('div.specnote', { text: chosen.every((x) => x) ? '' : t('spec.locked') }));
    } else {
      const cards = el('div.speccards');
      for (const o of tiers[open]) {
        const pts = t('spec.' + o.id + '.p').split('|').map((p) => `<li>${p}</li>`).join('');
        const un = unlockNames(o);
        const lore = o.lore && o.lore.status ? `<span class="lore ${o.lore.status}">${o.lore.status}</span>` : '';
        const card = button('speccard' + (picked === o.id ? ' on' : ''), `<b class="n">${specName(o.id)}</b><i class="th">${t('spec.' + o.id + '.theme')}</i><ul>${pts}</ul>${un.length ? `<small class="un">${t('spec.unlocks', { list: un.join(', ') })}</small>` : ''}${lore}`, () => {
          picked = o.id;
          renderSpec();
        }, specName(o.id));
        cards.appendChild(card);
      }
      box.appendChild(el('div.spectier', { text: t('spec.tier.' + open) }));
      box.appendChild(cards);
      const ok = button('cmd ok wide', icon('confirm') + `<i>${t('spec.confirm')}</i>`, () => {
        if (!picked) return;
        game.actions.chooseSpec(open, picked);
        closeSpec();
      }, t('spec.confirm'));
      if (!picked) ok.disabled = true;
      box.appendChild(ok);
    }
    modal.appendChild(box);
  }
  modal.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === modal) closeSpec(); });

  // ------------------------------------------------------------------ trench squad panel
  const tpanel = el('div.popup.trenchpanel');
  H.bottom.prepend(tpanel);
  let tpSeg = 0;
  function openTrenchPanel(segId) {
    tpSeg = segId;
    renderTrenchPanel(true);
    toggleClass(tpanel, 'open', true);
  }
  function closeTrenchPanel() {
    tpSeg = 0;
    toggleClass(tpanel, 'open', false);
  }
  let tpKey = '';
  function renderTrenchPanel(force) {
    if (!tpSeg) return;
    const d = trenchPanelData(sim, viewer, tpSeg);
    if (!d) { closeTrenchPanel(); return; }
    // Phase 4.1: positional auto reinforcement of everyone in this position ("AUTO REINFORCE ALL")
    const reinfIds = FACTIONS[viewer].reinforcements ? d.cards.map((c) => sim.rt.squadById.get(c.id)).filter((q) => q && unitDef(q.type).combatUnit && positionOf(q)) : [];
    const allOn = reinfIds.length > 0 && reinfIds.every((q) => autoReinforceOn(q) || !q.posId);
    const key = d.cards.map((c) => c.id).join(',') + '|' + reinfIds.length + (allOn ? 'A' : 'a');
    if (force || key !== tpKey) {
      tpKey = key;
      clear(tpanel);
      tpanel.appendChild(el('div.tphead', null,
        el('b', { html: icon(d.kind === 'garrison' ? 'garrison' : 'squads', 'sm') + t(d.titleKey || 'hud.trench_squads') }),
        el('span.tpcap', { text: d.used < 0 ? (d.enemySeen ? t('hud.garrison_enemy') : '?') + `/${d.total}` : `${d.used}/${d.total}` }),
        d.kind === 'garrison' && d.used > 0 ? button('cmd', icon('cancel') + `<i>${t('hud.ungarrison')}</i>`, () => { game.selection.set(d.cards.map((c) => c.id)); game.actions.ungarrison(); }, t('hud.ungarrison_tip')) : null,
        d.cards.length > 1 ? button('cmd', icon('all') + `<i>${t('hud.all')}</i>`, () => game.selection.set(d.cards.map((c) => c.id)), t('hud.all')) : null,
        reinfIds.length ? button('cmd' + (allOn ? ' on' : ''), icon('autoreinf') + `<i>${t(allOn ? 'hud.autoreinf_all_on' : 'hud.autoreinf_all_off')}</i>`, () => {
          game.actions.autoReinforce(allOn ? 0 : 1, reinfIds.map((q) => q.id));
          setTimeout(() => renderTrenchPanel(true), 150);
        }, t('hud.autoreinf_all_tip')) : null,
        button('cmd', icon('cancel'), closeTrenchPanel, t('hud.cancel'))));
      const list = el('div.tplist');
      for (const c of d.cards) {
        const card = button('tpcard', `${icon(c.icon)}<span class="n">${t(c.nameKey)}</span><span class="cnt"></span><div class="bar hp"><i></i></div><div class="bar ammo"><i></i></div><div class="bar inf"><i></i></div>`, () => {
          if (game.ui.multi) { game.selection.toggle(c.id); game.ui.multi = false; } // one-shot
          else game.selection.set([c.id]);
          if (game.audio) game.audio.ui('select');
        }, t(c.nameKey));
        card.dataset.id = c.id;
        list.appendChild(card);
      }
      if (!d.cards.length) list.appendChild(el('div.specnote', { text: d.kind === 'garrison' ? t(d.collapsed ? 'garrison.collapsed' : d.used < 0 ? (d.enemySeen ? 'hud.garrison_enemy_seen' : 'hud.garrison_unknown') : 'hud.garrison_empty') : '—' }));
      tpanel.appendChild(list);
    }
    for (const c of d.cards) {
      const card = tpanel.querySelector(`[data-id="${c.id}"]`);
      if (!card) continue;
      setText(card.querySelector('.cnt'), `${c.alive}/${c.max}` + (c.enRoute ? ' ' + t('hud.en_route', { n: c.enRoute }) : ''));
      setWidth(card.querySelector('.hp i'), c.hp);
      const ab = card.querySelector('.ammo');
      toggleClass(ab, 'none', c.ammo < 0);
      setWidth(ab.firstChild, Math.max(0, c.ammo));
      const ib = card.querySelector('.inf');
      toggleClass(ib, 'none', c.infected === 0);
      setWidth(ib.firstChild, c.infection);
      toggleClass(card, 'sel', game.selection.has(c.id));
    }
  }

  // ------------------------------------------------------------------ commands (hooks for hud.js)
  const armed = new Map(); // confirm-by-second-tap buttons (evacuate / slaughter)
  function confirmCmd(key, name, label, title, fn) {
    const now = nowSec();
    const on = armed.has(key) && now - armed.get(key) < 3;
    return H.cmd(name, on ? t('spec.confirm').split(' ')[0] + '?' : label, () => {
      if (armed.has(key) && nowSec() - armed.get(key) < 3) { armed.delete(key); fn(); } else { armed.set(key, nowSec()); H.markDirty(); setTimeout(H.markDirty, 3100); }
    }, { title, warn: on });
  }

  /** Extra buttons for own selected squads. */
  function squadCommands(own, out) {
    const gang = own.some((sq) => unitDef(sq.type).gathers === 'corpse');
    const sanit = own.some((sq) => unitDef(sq.type).roles.includes('sanitizer'));
    if (gang) out.push(H.cmd('forage', t('hud.forage'), () => game.input.startArea('forage'), { title: t('hud.forage_tip') }));
    if (sanit) out.push(H.cmd('sanitize', t('hud.sanitize'), () => game.input.startArea('sanitize'), { title: t('hud.sanitize_tip') }));
  }

  /** Extra buttons for a selected own structure. */
  function structCommands(st, out) {
    const def = STRUCTURES[st.type];
    if ((st.type === 'trench' || STRUCTURES[st.type].garrison) && (st.faction === viewer || st.faction === 'neutral')) {
      const d = trenchPanelData(sim, viewer, st.id);
      if (d) {
        const label = d.kind === 'garrison'
          ? t('hud.garrison_badge', { n: d.used < 0 ? '?' : d.used, cap: d.total })
          : t('hud.trench_badge', { n: d.count, s: d.used, cap: d.total });
        const b = H.cmd(d.kind === 'garrison' ? 'garrison' : 'squads', label, () => (tpSeg === st.id ? closeTrenchPanel() : openTrenchPanel(st.id)), { title: t('hud.trench_squads'), on: tpSeg === st.id });
        b.classList.add('badge');
        out.push(b);
      }
    }
    if (st.faction !== viewer || !st.built) return;
    if (def.settlement && !st.evac && st.pop > 0) out.push(confirmCmd('evac' + st.id, 'evacuate', t('hud.evacuate'), t('hud.evacuate_tip'), () => game.actions.evacuate(st)));
    if (def.pen) {
      out.push(H.cmd('herd', t('hud.herd_area'), () => game.input.startArea('herd', st), { title: t('hud.herd_area_tip') }));
      out.push(confirmCmd('slaughter' + st.id, 'slaughter', t('hud.slaughter'), t('hud.slaughter_tip'), () => game.actions.slaughter(st)));
    }
  }

  /** Faction-level buttons (nothing selected): sanitation by the nearest free engineer. */
  function factionCommands(out) {
    if (!bg && fdef.buildList.length) out.push(H.cmd('sanitize', t('hud.sanitize'), () => game.input.startArea('sanitize'), { title: t('hud.sanitize_tip') }));
  }

  /** Info rows for a selected own settlement / pen (live values filled by updateStructInfo). */
  function structInfo(st, info) {
    const def = STRUCTURES[st.type];
    if (st.faction !== viewer) return;
    if (def.settlement) {
      const sec = sectorOfSettlement(sim.state, st.id);
      if (sec) info.appendChild(el('div.row.sector', { html: `${icon('farm', 'sm')}<span>${t('sector.' + sec.kind)} · ${t('sector.rich.' + sec.rich)}</span>` }));
      info.appendChild(el('div.row.p3pop', { html: icon('population', 'sm') }, el('span')));
      info.appendChild(el('div.row.p3prod', { html: icon('food', 'sm') }, el('span')));
      info.appendChild(el('div.row.p3stat', null, el('span')));
    } else if (def.pen) {
      info.appendChild(el('div.row.p3pen', { html: icon('herd', 'sm') }, el('span')));
    } else if (def.farm || def.quarry) {
      info.appendChild(el('div.row.p3stat', null, el('span')));
    }
  }

  const R = { food: 0, material: 0, supply: 0 };
  function updateStructInfo(st, info) {
    const def = STRUCTURES[st.type];
    if (st.faction !== viewer) return;
    const put = (sel, txt) => { const n = info.querySelector(sel + ' span'); if (n) setText(n, txt); };
    if (def.settlement) {
      put('.p3pop', t('hud.settle_pop', { n: Math.round(st.pop || 0), cap: popCap(sim, st) }));
      settlementRates(sim, st, R);
      const parts = [];
      if (R.food > 0.001) parts.push(`${t('res.food')} ${(R.food * 60).toFixed(1)}`);
      if (R.material > 0.001) parts.push(`${t('res.material')} ${(R.material * 60).toFixed(1)}`);
      if (R.supply > 0.001) parts.push(`${t('res.supply')} ${(R.supply * 60).toFixed(1)}`);
      put('.p3prod', t('hud.settle_prod', { list: parts.length ? parts.join(' · ') + ' /dk' : '—' }));
      let status = '';
      if (st.evac) status = t('hud.settle_evac');
      else if (!settlementSafe(sim, st)) status = t('hud.settle_threat');
      else if (!(st.pop > 0)) status = t('hud.settle_found');
      else if (isRemote(sim, st)) {
        const s = st.stock || {};
        status = t('hud.settle_remote') + ' · ' + t('hud.settle_stock', { list: `${Math.floor(s.food || 0)}/${Math.floor(s.material || 0)}/${Math.floor(s.supply || 0)}` });
      }
      put('.p3stat', status);
    } else if (def.pen) {
      let n = 0;
      for (const a of sim.state.animals) if (a.st === 'penned' && a.pen === st.id) n++;
      put('.p3pen', t('hud.pen_animals', { n, cap: def.pen.capacity }));
    } else if (def.farm || def.quarry) {
      const host = st.host ? sim.rt.structById.get(st.host) : null;
      put('.p3stat', host ? t('struct.' + host.type) : '—');
    }
  }

  // ------------------------------------------------------------------ events
  function onEvent(ev) {
    switch (ev.type) {
      case EV.ENGINEER_ASSIGNED:
        if (ev.faction === viewer) {
          const sq = sim.rt.squadById.get(ev.squadId);
          if (sq) H.notify(ev.queued ? 'notice.engineer_queued' : 'notice.engineer_assigned', 'info', { unit: t(unitDef(sq.type).nameKey) }, 1);
        }
        break;
      case EV.SPEC_CHOSEN:
        if (ev.faction === viewer) { H.notify('spec.chosen', 'good', { name: specName(ev.id) }, 0.5); H.markDirty(); }
        break;
      case EV.PESTILENCE_TIER:
        if (ev.faction === viewer) {
          const name = t('pest.' + PESTILENCE.tiers[ev.tier].id);
          if (ev.up) H.showBanner(t('pest.tier_up', { tier: name }), 'war');
          else H.notify('pest.tier_down', 'warn', { tier: name }, 2);
        }
        break;
      case EV.EVACUATION:
        if (ev.faction === viewer) H.notify('notice.evacuating', 'warn', null, 2);
        break;
      case EV.CONVOY_LOST:
        if (ev.faction === viewer) H.notify('notice.convoy_lost', 'bad', null, 4);
        break;
      case EV.WOUNDED:
        if (ev.faction === viewer) H.notify('notice.wounded', 'warn', null, 12);
        break;
      case EV.REVIVED:
        if (ev.faction === viewer) H.notify('notice.revived', 'good', null, 6);
        break;
      case EV.REINFORCEMENT_JOINED:
        // the replacement is now counted: a short ring where he stepped in; a notice for a watched squad
        if (ev.faction === viewer) {
          if (game.renderer && game.renderer.overlays) game.renderer.overlays.addMarker('join', ev.x, ev.z);
          if (game.selection.squads.has(ev.squadId)) H.notify('reinf.joined', 'good', null, 3);
        }
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ per frame
  let acc = 0, lastOpen = -2;
  function update(dt) {
    acc += dt;
    if (acc < 0.25) return;
    acc = 0;
    const f = sim.state.factions[viewer];
    if (popNode) {
      const pop = f.econ && f.econ.pop ? f.econ.pop : f.population || 0;
      const rate = f.econ ? f.econ.lastManpowerRate || 0 : 0;
      setText(popNode, `${Math.round(pop)}`);
      popNode.parentNode.title = t('res.population') + ' — ' + t('hud.pop_rate', { v: rate.toFixed(1) });
    }
    if (pestNode) {
      const v = f.pestilence || 0;
      setText(pestNode, Math.floor(v));
      setText(pestTier, t('pest.' + PESTILENCE.tiers[f.pestTier || 0].id));
      setWidth(pestBar.firstChild, v / PESTILENCE.max);
      toggleClass(pestNode.parentNode, 'great', v >= PESTILENCE.max - 1e-6);
    }
    const open = availableTier(sim.state, viewer);
    toggleClass(specBtn, 'ready', open >= 0);
    setText(specBadge, open >= 0 ? ['I', 'II', 'III'][open] : '');
    if (open !== lastOpen) {
      lastOpen = open;
      if (open >= 0 && sim.state.tick > 0) H.notify('spec.available', 'good', null, 5);
      if (modal.classList.contains('open')) renderSpec();
    }
    renderStrip();
    if (tpSeg) renderTrenchPanel(false);
  }

  function onSelectionChanged() {
    const st = game.selection.struct ? sim.rt.structById.get(game.selection.struct) : null;
    if (!st || st.id !== tpSeg) closeTrenchPanel();
  }

  return { squadCommands, structCommands, factionCommands, structInfo, updateStructInfo, onEvent, update, onSelectionChanged, openSpec, closeSpec };
}
