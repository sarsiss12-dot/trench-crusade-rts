// Menus (DOM): main menu, new war setup (side, war length, quality), load, stress test,
// settings, controls help, setting notes (canon vs gameplay abstraction, from data), pause and
// end-of-match screens. Screens are rebuilt on demand; all text goes through i18n.
import { el, clear, button } from './dom.js';
import { icon } from './icons.js';
import { t, formatClock, getLanguage } from './i18n.js';
import { MATCH_LENGTH_OPTIONS, DEV_MATCH_LENGTHS, LULL_OPTIONS, SCENARIOS } from '../data/scenarios.js';
import { AI_DIFFICULTY } from '../data/ai.js';
import { UNITS } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, FACTION_ORDER, PLANNED_FACTIONS, sideDef } from '../data/factions.js';
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

  // ------------------------------------------------------------------ new war: MATCH SETUP
  // Phase 5A flow (one scrolling screen, numbered steps — thumb-friendly on a phone):
  //   1 SETUP MODE (Lore / Free) · 2 SCENARIO · 3 YOUR FACTION · 4 ENEMY FACTION · 5 YOUR ROLE ·
  //   6 AI DIFFICULTY · 7 WAR LENGTH · 8 RULES + SUMMARY + START
  // LORE SETUP: a scenario preset fixes who defends / attacks (the classic New Antioch siege);
  // the player only picks which side to play. FREE SETUP: any playable faction for each side
  // (mirror matches allowed) and either role. Planned factions show as locked cards (no fake
  // content). The setup is plain data handed to the simulation (sim/sides.js resolveSides).
  function showNewGame() {
    // Phase 4.1: 30 / 60 / 120 / 180 / ENDLESS (5 and 15 only in development builds)
    const lengths = env.dev ? [...DEV_MATCH_LENGTHS, ...MATCH_LENGTH_OPTIONS] : MATCH_LENGTH_OPTIONS;
    const saved = S.warMinutes;
    const last = S.lastSetup || {};
    const cfg = {
      mode: last.mode === 'free' ? 'free' : 'lore',
      scenarioId: SCENARIOS[last.scenarioId] ? last.scenarioId : 'siege_default',
      playerFaction: FACTIONS[last.playerFaction] ? last.playerFaction : (FACTIONS[S.lastFaction] ? S.lastFaction : 'new_antioch'),
      enemyFaction: FACTIONS[last.enemyFaction] ? last.enemyFaction : 'black_grail',
      playerRole: last.playerRole === 'attacker' ? 'attacker' : 'defender',
      aiDifficulty: AI_DIFFICULTY[last.aiDifficulty] ? last.aiDifficulty : 'normal',
      warMinutes: lengths.includes(saved) ? saved : 30,
      quality: S.quality || 'balanced',
      lulls: S.lulls !== undefined ? S.lulls : 'auto',
    };
    const playable = FACTION_ORDER.filter((f) => FACTIONS[f]);
    const scenariosFor = (mode) => Object.values(SCENARIOS).filter((sc) => (sc.setupModes || []).indexOf(mode) >= 0);
    const fname = (fid) => t('faction.' + fid + '.full');
    const roleName = (r) => t(r === 'attacker' ? 'menu.role_attacker' : 'menu.role_defender');
    /** The resolved match: { playerFaction, playerRole, enemyFaction, enemyRole } for the summary. */
    function resolved() {
      const sc = SCENARIOS[cfg.scenarioId];
      if (cfg.mode === 'lore' && sc.lore) {
        const role = sc.lore.defender === cfg.playerFaction ? 'defender' : 'attacker';
        const other = role === 'defender' ? 'attacker' : 'defender';
        return { playerFaction: sc.lore[role], playerRole: role, enemyFaction: sc.lore[other], enemyRole: other };
      }
      return {
        playerFaction: cfg.playerFaction, playerRole: cfg.playerRole,
        enemyFaction: cfg.enemyFaction, enemyRole: cfg.playerRole === 'attacker' ? 'defender' : 'attacker',
      };
    }

    function step(n, label, body) {
      return el('div.setupstep', null, el('div.stephead', { html: `<i>${n}</i><span>${label}</span>` }), body);
    }

    function factionCard(fid, on, onPick, roleText) {
      const d = FACTIONS[fid];
      const c = button('card ' + fid + (on ? ' on' : ''),
        `<span class="cico">${icon(d.card.icon)}</span><b>${fname(fid)}</b>` +
        (roleText ? `<em>${roleText}</em>` : '') +
        `<span class="ident">${t(d.card.identityKey)}</span>` +
        `<span class="facts"><small>${t('setup.economy')}: ${t(d.card.economyKey)}</small><small>${t('setup.style')}: ${t(d.card.styleKey)}</small><small class="ok">${t('setup.status_ready')}</small></span>`,
        onPick);
      return c;
    }

    function lockedCard(pf) {
      const c = el('div.card.locked', { html: `<span class="cico">${icon('lock')}</span><b>${t(pf.nameKey)}</b><em>${t('setup.coming_soon')}</em><span class="facts"><small>${t('setup.status_locked', { phase: pf.phase })}</small></span>` });
      c.setAttribute('aria-disabled', 'true');
      return c;
    }

    function render() {
      show('new', (p) => {
        p.append(header(t('setup.title'), showMain));
        const r = resolved();
        // 1 SETUP MODE
        p.append(step(1, t('setup.mode'), el('div.opts.wide', null,
          button('opt big2' + (cfg.mode === 'lore' ? ' on' : ''), `${icon('cross')}<b>${t('setup.mode_lore')}</b><small>${t('setup.mode_lore_tip')}</small>`, () => {
            cfg.mode = 'lore';
            if (!scenariosFor('lore').some((sc) => sc.id === cfg.scenarioId)) cfg.scenarioId = scenariosFor('lore')[0].id;
            render();
          }),
          button('opt big2' + (cfg.mode === 'free' ? ' on' : ''), `${icon('doctrine')}<b>${t('setup.mode_free')}</b><small>${t('setup.mode_free_tip')}</small>`, () => {
            cfg.mode = 'free';
            if (!scenariosFor('free').some((sc) => sc.id === cfg.scenarioId)) cfg.scenarioId = scenariosFor('free')[0].id;
            render();
          }))));
        // 2 SCENARIO
        const scBox = el('div.cards');
        for (const sc of scenariosFor(cfg.mode)) {
          const tag = sc.lore ? `<em>${t('setup.lore_preset')}</em>` : `<em>${t('setup.victory.' + sc.victory)}</em>`;
          scBox.append(button('card scen' + (sc.id === cfg.scenarioId ? ' on' : ''),
            `<span class="cico">${icon(sc.victory === 'siege' ? 'bastion' : 'attack')}</span><b>${t(sc.nameKey)}</b>${tag}<span>${t(sc.descKey)}</span>`,
            () => { cfg.scenarioId = sc.id; render(); }));
        }
        p.append(step(2, t('setup.scenario'), scBox));
        const sc = SCENARIOS[cfg.scenarioId];
        if (cfg.mode === 'lore' && sc.lore) {
          // Lore preset: roles are fixed by the scenario; the player picks WHICH side to play
          const cards = el('div.cards');
          for (const role of sc.slots || ['defender', 'attacker']) {
            const fid = sc.lore[role];
            cards.append(factionCard(fid, r.playerFaction === fid && r.playerRole === role, () => { cfg.playerFaction = fid; render(); }, roleName(role)));
          }
          p.append(step(3, t('setup.play_as'), cards));
          p.append(el('p.note.left', { text: t('setup.lore_note') }));
        } else {
          // 3 YOUR FACTION
          const mine = el('div.cards');
          for (const fid of playable) mine.append(factionCard(fid, cfg.playerFaction === fid, () => { cfg.playerFaction = fid; render(); }));
          for (const pf of PLANNED_FACTIONS) mine.append(lockedCard(pf));
          p.append(step(3, t('setup.your_faction'), mine));
          // 4 ENEMY FACTION (mirror allowed)
          const foe = el('div.cards');
          for (const fid of playable) foe.append(factionCard(fid, cfg.enemyFaction === fid, () => { cfg.enemyFaction = fid; render(); }, fid === cfg.playerFaction ? t('setup.mirror') : ''));
          for (const pf of PLANNED_FACTIONS) foe.append(lockedCard(pf));
          p.append(step(4, t('setup.enemy_faction'), foe));
          // 5 YOUR ROLE: two big buttons
          p.append(step(5, t('setup.your_role'), el('div.opts.wide', null,
            button('opt big2' + (cfg.playerRole === 'defender' ? ' on' : ''), `${icon('bastion')}<b>${t('menu.role_defender')}</b><small>${t('setup.role_defender_tip')}</small>`, () => { cfg.playerRole = 'defender'; render(); }),
            button('opt big2' + (cfg.playerRole === 'attacker' ? ' on' : ''), `${icon('attack')}<b>${t('menu.role_attacker')}</b><small>${t('setup.role_attacker_tip')}</small>`, () => { cfg.playerRole = 'attacker'; render(); }))));
        }
        // 6 AI DIFFICULTY
        p.append(step(cfg.mode === 'lore' ? 4 : 6, t('setup.ai'), choice('', Object.keys(AI_DIFFICULTY).map((k) => [k, t('setup.ai.' + k)]), cfg.aiDifficulty, (v) => { cfg.aiDifficulty = v; })));
        // 7 WAR LENGTH
        p.append(step(cfg.mode === 'lore' ? 5 : 7, t('menu.length'), choice('', lengths.map((m) => [m, m === 'endless' ? t('menu.endless') : t('menu.minutes', { n: m })]), cfg.warMinutes, (v) => { cfg.warMinutes = v; render(); })));
        // 8 RULES + SUMMARY + START
        const rules = el('div', null,
          choice(t('menu.lulls'), LULL_OPTIONS.map((v) => [v, t('lulls.' + v)]), cfg.lulls, (v) => { cfg.lulls = v; }),
          choice(t('menu.quality'), ['low', 'balanced', 'high'].map((q) => [q, t('quality.' + q)]), cfg.quality, (v) => { cfg.quality = v; }));
        p.append(step(cfg.mode === 'lore' ? 6 : 8, t('setup.rules'), rules));
        const len = cfg.warMinutes === 'endless' ? t('menu.endless') : t('menu.minutes', { n: cfg.warMinutes });
        const summary = t('setup.summary', {
          pf: t('faction.' + r.playerFaction).toUpperCase(), pr: roleName(r.playerRole).toUpperCase(),
          ef: t('faction.' + r.enemyFaction).toUpperCase(), er: roleName(r.enemyRole).toUpperCase(), len: len.toUpperCase(),
        });
        p.append(el('div.summary', null, el('small', { text: t(sc.nameKey) + (r.playerFaction === r.enemyFaction ? ' · ' + t('setup.mirror') : '') }), el('b', { text: summary })));
        p.append(el('div.mlist', null, button('big primary', icon('play') + t('menu.start'), () => {
          const setup = { mode: cfg.mode, scenarioId: cfg.scenarioId, playerFaction: r.playerFaction, enemyFaction: r.enemyFaction, playerRole: r.playerRole };
          S.lastSetup = { ...setup, aiDifficulty: cfg.aiDifficulty };
          S.lastFaction = r.playerFaction; S.warMinutes = cfg.warMinutes; S.quality = cfg.quality; S.lulls = cfg.lulls;
          env.saveSettings();
          env.startMatch({ setup, aiDifficulty: cfg.aiDifficulty, warMinutes: cfg.warMinutes, lulls: cfg.lulls });
        })));
      });
    }
    render();
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
          el('span.sn', { html: `${icon((sideDef(m.faction || 'new_antioch') || FACTIONS.new_antioch).card.icon)}<b>${s.slot === 'auto' ? t('menu.continue') : s.slot}</b>` }),
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
      list.append(
        button('big danger', icon('cancel') + t('menu.quit'), () => env.quit()),
      );
      p.append(list);
    });
  }

  function showEnd(game, ev) {
    const viewer = game.viewer;
    const win = ev.winner === viewer;
    const draw = !ev.winner;
    const f = game.sim.state.factions[viewer].stats;
    const dur = (game.sim.state.match.endTick || game.sim.state.tick) / TICK_RATE;
    show('end', (p) => {
      p.append(el('div.endtitle' + (win ? '.win' : draw ? '' : '.lose'), { text: win ? t('end.victory') : draw ? t('end.draw') : t('end.defeat') }));
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
