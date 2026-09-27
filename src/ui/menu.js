// Menus (DOM): main menu, new war setup (side, war length, quality), load, stress test,
// settings, controls help, setting notes (canon vs gameplay abstraction, from data), pause and
// end-of-match screens. Screens are rebuilt on demand; all text goes through i18n.
import { el, clear, button } from './dom.js';
import { icon } from './icons.js';
import { t, formatClock, getLanguage } from './i18n.js';
import { MATCH_LENGTH_OPTIONS, LULL_OPTIONS } from '../data/scenarios.js';
import { AUTO_REINF_MODES } from '../factions/reinforcement.js';
import { UNITS } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS } from '../data/factions.js';
import { ABILITIES } from '../data/abilities.js';
import { SPECIALITIES } from '../data/specialities.js';
import { SECTOR_KINDS } from '../data/economy.js';
import { SPECIES } from '../data/animals.js';
import { TICK_RATE } from '../sim/constants.js';

const LORE_SOURCES = [
  ['Trench Crusade — The Principality of New Antioch (official lore)', 'https://www.trenchcrusade.com/lore/the-principality-of-new-antioch/'],
  ['Trench Crusade — The Cult of the Black Grail (official lore)', 'https://www.trenchcrusade.com/lore/the-cult-of-the-black-grail/'],
  ['Trench Companion — New Antioch warband', 'https://trench-companion.com/compendium/warbands/new-antioch'],
  ['Trench Companion — Cult of the Black Grail warband', 'https://trench-companion.com/compendium/warbands/cult-of-the-black-grail'],
];

export function createMenu(env) {
  const root = el('div.menu');
  env.root.appendChild(root);
  const panel = el('div.panel');
  const backdrop = el('div.backdrop');
  root.append(backdrop, panel);
  const S = env.settings;
  let current = null;

  function show(name, build) {
    current = name;
    clear(panel);
    root.classList.add('open');
    root.dataset.screen = name;
    build(panel);
  }

  function hide() {
    root.classList.remove('open');
    current = null;
  }

  function header(title, back) {
    const h = el('div.mh', null, el('h2', { text: title }));
    if (back) h.prepend(button('back', icon('cancel'), back, t('menu.back')));
    return h;
  }

  function choice(label, options, value, onPick) {
    const row = el('div.choice', null, el('label', { text: label }));
    const box = el('div.opts');
    for (const [v, txt] of options) {
      const b = button('opt' + (v === value ? ' on' : ''), txt, () => {
        for (const x of box.children) x.classList.remove('on');
        b.classList.add('on');
        onPick(v);
      });
      box.appendChild(b);
    }
    row.appendChild(box);
    return row;
  }

  // ------------------------------------------------------------------ main
  function showMain() {
    show('main', (p) => {
      const saves = env.storage ? env.storage.list() : [];
      const auto = saves.find((s) => s.slot === 'auto');
      p.append(
        el('div.title', null,
          el('div.sigil', { html: icon('cross') }),
          el('h1', { text: t('app.title') }),
          el('p.sub', { text: t('app.subtitle') })),
      );
      const list = el('div.mlist');
      if (auto) list.append(button('big primary', icon('play') + t('menu.continue'), () => env.loadSlot('auto')));
      list.append(
        button('big' + (auto ? '' : ' primary'), icon('cross') + t('menu.new_game'), showNewGame),
        button('big', icon('save') + t('menu.load'), showLoad),
        button('big', icon('bug') + t('menu.stress'), showStress),
        button('big', icon('menu') + t('menu.settings'), () => showSettings(showMain)),
        button('big', icon('eye') + t('menu.gallery'), () => env.startGallery()),
        button('big', icon('grail') + t('menu.lore'), () => showLore(showMain)),
        button('big', icon('move') + t('menu.help'), () => showHelp(showMain)),
      );
      p.append(list, el('p.disclaimer', { text: t('menu.disclaimer') }));
    });
  }

  // ------------------------------------------------------------------ new war
  function showNewGame() {
    const cfg = { faction: S.lastFaction || 'new_antioch', warMinutes: S.warMinutes || 15, quality: S.quality || 'balanced', lulls: S.lulls !== undefined ? S.lulls : 'auto' };
    show('new', (p) => {
      p.append(header(t('menu.new_game'), showMain));
      const cards = el('div.cards');
      for (const fid of ['new_antioch', 'black_grail']) {
        const role = fid === 'new_antioch' ? t('menu.role_defender') : t('menu.role_attacker');
        const c = button('card ' + fid + (cfg.faction === fid ? ' on' : ''),
          `<span class="cico">${icon(fid === 'new_antioch' ? 'cross' : 'grail')}</span><b>${t('faction.' + fid + '.full')}</b><em>${role}</em><span>${t(fid === 'new_antioch' ? 'menu.na_blurb' : 'menu.bg_blurb')}</span>`,
          () => {
            cfg.faction = fid;
            for (const x of cards.children) x.classList.remove('on');
            c.classList.add('on');
          });
        cards.appendChild(c);
      }
      p.append(el('div.choice', null, el('label', { text: t('menu.faction') })), cards);
      p.append(choice(t('menu.length'), MATCH_LENGTH_OPTIONS.map((m) => [m, t('menu.minutes', { n: m })]), cfg.warMinutes, (v) => { cfg.warMinutes = v; }));
      p.append(choice(t('menu.lulls'), LULL_OPTIONS.map((v) => [v, t('lulls.' + v)]), cfg.lulls, (v) => { cfg.lulls = v; }));
      p.append(choice(t('menu.quality'), ['low', 'balanced', 'high'].map((q) => [q, t('quality.' + q)]), cfg.quality, (v) => { cfg.quality = v; }));
      p.append(el('div.mlist', null, button('big primary', icon('play') + t('menu.start'), () => {
        S.lastFaction = cfg.faction; S.warMinutes = cfg.warMinutes; S.quality = cfg.quality; S.lulls = cfg.lulls;
        env.saveSettings();
        env.startMatch({ faction: cfg.faction, warMinutes: cfg.warMinutes, lulls: cfg.lulls });
      })));
    });
  }

  // ------------------------------------------------------------------ load
  function showLoad(back = showMain) {
    show('load', (p) => {
      p.append(header(t('menu.load'), back));
      const saves = env.storage ? env.storage.list() : [];
      if (!saves.length) p.append(el('p.empty', { text: t('menu.no_saves') }));
      const list = el('div.saves');
      for (const s of saves.slice().reverse()) {
        const m = s.meta || {};
        const when = formatClock((m.tick || 0) / TICK_RATE);
        const row = el('div.save', null,
          el('span.sn', { html: `${icon(m.faction === 'black_grail' ? 'grail' : 'cross')}<b>${s.slot === 'auto' ? t('menu.continue') : s.slot}</b>` }),
          el('span.sm', { text: t('menu.saved_at', { phase: t('phase.' + (m.phase || 'WAR')), time: when }) }),
          button('opt', icon('play'), () => env.loadSlot(s.slot), t('menu.load')),
          button('opt danger', icon('cancel'), () => { env.storage.remove(s.slot); showLoad(back); }, t('menu.delete')));
        list.appendChild(row);
      }
      p.append(list);
    });
  }

  // ------------------------------------------------------------------ stress test
  function showStress() {
    let q = S.quality || 'balanced';
    show('stress', (p) => {
      p.append(header(t('stress.title'), showMain));
      p.append(choice(t('menu.quality'), ['low', 'balanced', 'high'].map((v) => [v, t('quality.' + v)]), q, (v) => { q = v; }));
      const list = el('div.mlist');
      for (const n of [160, 320, 480]) {
        list.append(button('big', `${icon('all')}${n} <small>${t('menu.stress_desc', { n })}</small>`, () => env.startStress(n, q)));
      }
      p.append(list);
    });
  }

  // ------------------------------------------------------------------ settings
  function showSettings(back) {
    show('settings', (p) => {
      p.append(header(t('menu.settings'), back));
      p.append(choice(t('menu.language'), [['tr', 'Türkçe'], ['en', 'English']], getLanguage(), (v) => { S.language = v; env.saveSettings(); env.applyLanguage(v); showSettings(back); }));
      p.append(choice(t('menu.quality'), ['low', 'balanced', 'high'].map((v) => [v, t('quality.' + v)]), S.quality || 'balanced', (v) => { S.quality = v; env.saveSettings(); }));
      p.append(choice(t('menu.sound'), [[true, t('menu.on')], [false, t('menu.off')]], S.sound !== false, (v) => { S.sound = v; env.saveSettings(); env.applyAudio(); }));
      p.append(choice(t('menu.volume'), [[0.3, '30%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']], S.volume !== undefined ? S.volume : 0.8, (v) => { S.volume = v; env.saveSettings(); env.applyAudio(); }));
      // separate mix levels: the score never drowns the gunfire unless the player wants it to
      p.append(choice(t('menu.sfx'), [[0.4, '40%'], [0.7, '70%'], [1, '100%']], S.sfxVolume !== undefined ? S.sfxVolume : 1, (v) => { S.sfxVolume = v; env.saveSettings(); env.applyAudio(); }));
      p.append(choice(t('menu.music'), [[0, t('menu.off')], [0.25, '25%'], [0.5, '50%'], [0.8, '80%']], S.musicVolume !== undefined ? S.musicVolume : 0.5, (v) => { S.musicVolume = v; env.saveSettings(); env.applyAudio(); }));
      p.append(choice('UI', [[1, '100%'], [1.15, '115%'], [1.3, '130%']], S.uiScale || 1, (v) => { S.uiScale = v; env.saveSettings(); env.applyUiScale(); }));
      p.append(choice(t('menu.debug'), [[true, t('menu.on')], [false, t('menu.off')]], !!S.debug, (v) => { S.debug = v; env.saveSettings(); env.applyDebug(); }));
    });
  }

  // ------------------------------------------------------------------ help / lore
  function showHelp(back) {
    show('help', (p) => {
      p.append(header(t('help.title'), back));
      p.append(el('div.help', null,
        el('h3', { html: icon('move') + ' Touch' }), el('p', { text: t('help.touch') }),
        el('h3', { html: icon('menu') + ' Mouse / Keyboard' }), el('p', { text: t('help.mouse') })));
    });
  }

  function showLore(back) {
    const badge = (st) => `<span class="lore ${st}">${st === 'canon' ? (getLanguage() === 'tr' ? 'Kanon' : 'Canon') : st === 'canon-inspired' ? (getLanguage() === 'tr' ? 'Kanondan esinli' : 'Canon-inspired') : (getLanguage() === 'tr' ? 'Oyun soyutlaması' : 'Gameplay abstraction')}</span>`;
    show('lore', (p) => {
      p.append(header(t('lore.title'), back));
      const list = el('div.lorelist');
      const rows = [];
      for (const f of Object.values(FACTIONS)) rows.push([t(f.nameKey), f.lore]);
      for (const u of Object.values(UNITS)) rows.push([t(u.nameKey), u.lore]);
      for (const s of Object.values(STRUCTURES)) rows.push([t(s.nameKey), s.lore]);
      for (const a of Object.values(ABILITIES)) rows.push([t(a.nameKey), a.lore]);
      // Phase 3: specialities (per faction, per tier), resource sectors, animals
      for (const fid of Object.keys(SPECIALITIES)) for (const tier of SPECIALITIES[fid]) for (const o of tier) rows.push([t('spec.' + o.id), o.lore]);
      for (const k of Object.values(SECTOR_KINDS)) rows.push([t(k.nameKey), k.lore]);
      for (const a of Object.values(SPECIES)) rows.push([t(a.nameKey), a.lore]);
      for (const [name, lore] of rows) {
        list.append(el('div.lr', { html: `<b>${name}</b>${badge(lore.status)}${lore.ref ? `<small>${lore.ref}</small>` : ''}` }));
      }
      p.append(el('p.note', { text: t('menu.disclaimer') }), list);
      const src = el('div.sources', null, el('h3', { text: 'Sources' }));
      for (const [n, u] of LORE_SOURCES) src.append(el('a', { href: u, target: '_blank', rel: 'noopener', text: n }));
      p.append(src);
    });
  }

  // ------------------------------------------------------------------ in-match: pause / end
  function showPause(game) {
    show('pause', (p) => {
      p.append(el('div.mh', null, el('h2', { text: t('menu.paused') })));
      const list = el('div.mlist');
      list.append(
        button('big primary', icon('play') + t('menu.resume'), () => env.resume()),
        button('big', icon('save') + t('menu.save'), () => {
          const r = game.save('manual');
          game.notify(r.ok ? 'notice.saved' : r.reason || 'notice.save_failed', r.ok ? 'good' : 'warn');
          env.resume();
        }),
        button('big', icon('save') + t('menu.load'), () => showLoad(() => showPause(game))),
        button('big', icon('menu') + t('menu.settings'), () => showSettings(() => showPause(game))),
        button('big', icon('move') + t('menu.help'), () => showHelp(() => showPause(game))),
      );
      // auto reinforcement default of the player's side (a match command: applies on resume)
      const f = game.sim.state.factions[game.viewer];
      if (game.actions.autoReinforceDefault && f && FACTIONS[game.viewer].reinforcements && game.sim.state.match.phase !== 'ENDED') {
        let mode = game.ui.autoReinfPending || f.autoReinf || 'off';
        const b = button('big', icon('autoreinf') + t('menu.autoreinf') + ': <b>' + t('autoreinf.' + mode) + '</b>', () => {
          mode = AUTO_REINF_MODES[(AUTO_REINF_MODES.indexOf(mode) + 1) % AUTO_REINF_MODES.length];
          game.ui.autoReinfPending = mode;
          game.actions.autoReinforceDefault(mode);
          b.innerHTML = icon('autoreinf') + t('menu.autoreinf') + ': <b>' + t('autoreinf.' + mode) + '</b>';
        });
        list.append(b);
      }
      list.append(
        button('big danger', icon('cancel') + t('menu.quit'), () => env.quit()),
      );
      p.append(list);
    });
  }

  function showEnd(game, ev) {
    const viewer = game.viewer;
    const win = ev.winner === viewer;
    const f = game.sim.state.factions[viewer].stats;
    const dur = (game.sim.state.match.endTick || game.sim.state.tick) / TICK_RATE;
    show('end', (p) => {
      p.append(el('div.endtitle' + (win ? '.win' : '.lose'), { text: win ? t('end.victory') : t('end.defeat') }));
      p.append(el('p.reason', { text: t('end.reason.' + ev.reason) }));
      p.append(el('p.stats', { text: t('end.stats', f) }));
      p.append(el('p.stats', { text: t('end.duration', { t: formatClock(dur) }) }));
      p.append(el('div.mlist', null,
        button('big', icon('eye') + t('end.watch'), () => hide()),
        button('big primary', icon('cross') + t('end.again'), () => env.restart()),
        button('big', icon('menu') + t('end.menu'), () => env.quit())));
    });
  }

  return { showMain, showNewGame, showLoad, showStress, showSettings, showHelp, showLore, showPause, showEnd, hide, get current() { return current; }, root };
}
