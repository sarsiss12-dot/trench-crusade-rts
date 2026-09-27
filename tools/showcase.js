#!/usr/bin/env node
// Visual showcase (optional, needs Playwright + Chromium, like browser_smoke.js): stages scenes in
// the real renderer and writes screenshots to test-output/showcase-*.png — Phase 2 (structures &
// walls, artillery + craters, mortar, fly swarm, gore, facing arrow) and Phase 3 (settlement,
// farm, pen, quarry, animals, sector overlay, new units, flamethrower, Great Pestilence, HUD:
// engineer beam / trench squad panel / speciality cards, supply convoy).
// Usage: node tools/showcase.js [name-filter]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './serve.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'test-output');
const require = createRequire(import.meta.url);
let pw = null;
for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright', join(process.env.HOME || '', '.npm-global/lib/node_modules/playwright'), '/usr/lib/node_modules/playwright'].filter(Boolean)) {
  try { pw = require(c); break; } catch { /* next */ }
}
if (!pw) { console.log('Playwright not found — skipping'); process.exit(0); }
mkdirSync(out, { recursive: true });
const server = createStaticServer(root);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const only = process.argv[2] || '';

async function scene(name, url, stage, shots) {
  if (only && !name.includes(only)) return;
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.TC && TC.game && TC.game.renderer.frameStats.drawCalls > 0, null, { timeout: 60000, polling: 250 });
  if (stage) await page.evaluate(stage);
  // waits are in SIMULATION ticks (software GL runs a few frames per second)
  for (const [label, ticks, fn] of shots) {
    if (fn) await page.evaluate(fn);
    const until = await page.evaluate((n) => TC.game.sim.state.tick + n, ticks);
    await page.waitForFunction((u) => TC.game.sim.state.tick >= u, until, { timeout: 240000, polling: 100 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `showcase-${name}-${label}.png`) });
  }
  console.log(`${errors.length ? 'ERR ' : 'ok  '} ${name}${errors.length ? '\n     ' + errors.slice(0, 4).join('\n     ') : ''}`);
  await ctx.close();
}

// in-page helpers: the dev build serves the source modules, so the page's own module instances
// are imported (same URLs) and act on the running simulation
const HELPERS = `
  const st = await import('/src/sim/state.js');
  const rt = await import('/src/sim/runtime.js');
  const cmds = await import('/src/sim/commands.js');
  const g = TC.game, sim = g.sim;
  window.__add = (type, faction, params) => {
    const s = st.createStructure(sim.state, type, faction, { built: true, ...params });
    sim.state.structures.push(s); sim.rt.structById.set(s.id, s); rt.structuresChanged(sim);
    return s;
  };
  window.__spawn = (faction, unit, x, z, rot) => {
    const q = st.createSquad(sim.state, faction, unit, x, z, rot || 0, {});
    sim.state.squads.push(q); sim.rt.squadById.set(q.id, q); for (const m of q.members) sim.rt.soldierIndex.set(m.id, q);
    q.cx = x; q.cz = z; return q;
  };
  window.__cmd = (c) => cmds.enqueueCommand(sim, c);
`;

await scene('structures', base + '?autostart=1&seed=3&prep=600&fog=0', `(async () => { ${HELPERS}
  __add('aid_station', 'new_antioch', { x: 128, z: 440, rot: Math.PI });
  __add('workshop', 'new_antioch', { x: 146, z: 442, rot: Math.PI });
  __add('ammo_dump', 'new_antioch', { x: 164, z: 440, rot: Math.PI });
  __add('signal_post', 'new_antioch', { x: 178, z: 440, rot: Math.PI });
  __add('muster_point', 'new_antioch', { x: 194, z: 442, rot: Math.PI });
  __add('low_sandbags', 'new_antioch', { x1: 124, z1: 428, x2: 136, z2: 428, front: 1 });
  __add('breastwork', 'new_antioch', { x1: 140, z1: 428, x2: 152, z2: 428, front: 1 });
  __add('timber_wall', 'new_antioch', { x1: 156, z1: 428, x2: 166, z2: 428, front: 1 });
  __add('fortified_wall', 'new_antioch', { x1: 170, z1: 428, x2: 180, z2: 428, front: 1 });
  __add('fortified_wall', 'new_antioch', { x1: 183, z1: 428, x2: 193, z2: 428, front: 1 });
  __add('bone_barricade', 'black_grail', { x1: 140, z1: 414, x2: 150, z2: 414, front: 1 });
  __add('corpse_mound', 'black_grail', { x: 128, z: 404, rot: 0 });
  __add('plague_pit', 'black_grail', { x: 150, z: 402, rot: 0 });
  __add('fly_nest', 'black_grail', { x: 170, z: 404, rot: 0 });
  __add('grail_altar', 'black_grail', { x: 192, z: 404, rot: 0.3 });
  g.lookAt(160, 424); g.camera.dist = 62; g.camera.yaw = 0.2;
})()`, [['overview', 10], ['altar', 10, () => { TC.game.lookAt(192, 404); TC.game.camera.dist = 22; TC.game.camera.yaw = 0.3; }],
  ['altar_side', 10, () => { TC.game.lookAt(192, 404); TC.game.camera.dist = 22; TC.game.camera.yaw = 1.9; }],
  ['na', 10, () => { TC.game.lookAt(160, 441); TC.game.camera.dist = 40; TC.game.camera.yaw = 3.3; }],
  ['walls', 10, () => { TC.game.lookAt(158, 428); TC.game.camera.dist = 30; TC.game.camera.yaw = 3.3; }],
  ['grail', 10, () => { TC.game.lookAt(150, 404); TC.game.camera.dist = 34; TC.game.camera.yaw = 3.1; }]]);

await scene('artillery', base + '?autostart=1&seed=3&prep=0', `(async () => { ${HELPERS}
  sim.state.factions.new_antioch.resources.supply = 2000;
  for (let i = 0; i < 4; i++) __spawn('black_grail', 'grail_thrall', 150 + i * 7, 360, 0);
  __spawn('new_antioch', 'yeoman_rifle', 160, 392, Math.PI); // spotters: the barrage needs vision
  g.lookAt(160, 368); g.camera.dist = 58; g.camera.yaw = 0.15;
  setTimeout(() => __cmd({ type: 'USE_ABILITY', faction: 'new_antioch', ability: 'artillery_barrage', x: 160, z: 360 }), 900);
})()`, [['impact', 76], ['blast', 6], ['after', 60], ['craters', 160], ['crater_close', 4, () => { TC.game.lookAt(160, 360); TC.game.camera.dist = 24; TC.game.camera.yaw = 0.5; }]]);

await scene('mortar', base + '?autostart=1&seed=3&prep=0', `(async () => { ${HELPERS}
  sim.state.factions.new_antioch.resources.supply = 2000;
  for (let i = 0; i < 3; i++) __spawn('black_grail', 'corpse_guard', 150 + i * 8, 370, 0);
  __spawn('new_antioch', 'yeoman_rifle', 160, 398, Math.PI);
  g.lookAt(160, 378); g.camera.dist = 46; g.camera.yaw = 0.15;
  setTimeout(() => __cmd({ type: 'USE_ABILITY', faction: 'new_antioch', ability: 'mortar_barrage', x: 160, z: 370 }), 900);
})()`, [['rounds', 44], ['more', 12], ['after', 80]]);

await scene('swarm', base + '?autostart=1&seed=3&prep=0&fog=0&faction=black_grail', `(async () => { ${HELPERS}
  sim.state.factions.black_grail.resources.biomass = 2000;
  __spawn('new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  __spawn('new_antioch', 'yeoman_rifle', 170, 424, Math.PI);
  __spawn('black_grail', 'grail_thrall', 160, 402, 0);
  g.lookAt(163, 418); g.camera.dist = 40; g.camera.yaw = Math.PI + 0.2;
  setTimeout(() => __cmd({ type: 'USE_ABILITY', faction: 'black_grail', ability: 'fly_swarm', x: 164, z: 421 }), 300);
})()`, [['cloud', 40], ['infected', 120]]);

await scene('gore', base + '?view=duel', null, [['start', 40], ['fight', 140], ['after', 240]]);

await scene('facing', base + '?autostart=1&seed=3&prep=600&fog=0', `(async () => {
  const g = TC.game;
  const own = g.sim.state.squads.filter((q) => q.faction === 'new_antioch' && q.type === 'yeoman_rifle').slice(0, 2);
  g.selection.set(own.map((q) => q.id));
  g.frame.faceArrow = { x0: 150, z0: 450, x1: 142, z1: 440, valid: true };
  g.lookAt(150, 452); g.camera.dist = 50;
})()`, [['arrow', 10]]);

// ------------------------------------------------------------------ Phase 3 scenes
const P3 = `
  window.__settle = (secId, pop) => {
    const sec = sim.state.sectors.find((x) => x.id === secId);
    const s = __add('settlement', 'new_antioch', { x: sec.x, z: sec.z, rot: Math.PI });
    sec.sid = s.id; s.pop = pop; s.threat = -100000; s.found = 0;
    return s;
  };
  window.__animal = (sp, x, z) => {
    const sd = { sheep: 40, goat: 35, pig: 60, cattle: 120, mule: 90, dog: 30 };
    const a = { id: sim.state.nextId++, sp, x, z, rot: Math.random() * 6, vx: 0, vz: 0, hp: sd[sp], st: 'wild', hab: '', pen: 0, by: 0, tx: x, tz: z, wait: sim.state.tick + 400, panic: 0, shy: 0, px: 0, pz: 0, visibleTo: 0, seenBy: 0 };
    sim.state.animals.push(a); return a;
  };
`;

await scene('p3_settlement', base + '?autostart=1&seed=3&prep=900&fog=0', `(async () => { ${HELPERS} ${P3}
  const s1 = __settle('hamlet_w', 14);
  __add('farm', 'new_antioch', { x: 78, z: 440, rot: 0 });
  const pen = __add('livestock_pen', 'new_antioch', { x: 118, z: 446, rot: 0 });
  for (let i = 0; i < 5; i++) { const a = __animal(['sheep', 'cattle', 'goat', 'pig', 'sheep'][i], 116 + (i % 3) * 2.5, 444 + Math.floor(i / 3) * 2.5); a.st = 'penned'; a.pen = pen.id; }
  for (let i = 0; i < 6; i++) __animal(['sheep', 'sheep', 'cattle', 'goat', 'dog', 'mule'][i], 132 + i * 3, 418 + (i % 2) * 3);
  __spawn('new_antioch', 'yeoman_rifle', 140, 440, Math.PI); // a picket that keeps the grazing herd in sight
  const s2 = __settle('quarry_w', 10);
  __add('quarry', 'new_antioch', { x: 40, z: 400, rot: 0 });
  g.lookAt(100, 436); g.camera.dist = 60; g.camera.yaw = 0.25;
})()`, [['overview', 160], ['village', 10, () => { TC.game.lookAt(100, 432); TC.game.camera.dist = 26; TC.game.camera.yaw = 0.5; }],
  ['pen', 10, () => { TC.game.lookAt(118, 446); TC.game.camera.dist = 20; TC.game.camera.yaw = 2.6; }],
  ['herd', 10, () => { TC.game.lookAt(140, 421); TC.game.camera.dist = 22; TC.game.camera.yaw = 0.9; }],
  ['farm', 60, () => { TC.game.lookAt(78, 440); TC.game.camera.dist = 26; TC.game.camera.yaw = 3.4; }],
  ['quarry', 10, () => { TC.game.lookAt(40, 402); TC.game.camera.dist = 24; TC.game.camera.yaw = 0.5; }],
  ['sectors', 4, () => { TC.game.input.startPlacement('settlement'); TC.game.lookAt(150, 420); TC.game.camera.dist = 150; TC.game.camera.yaw = 0; }]]);

await scene('p3_units', base + '?autostart=1&seed=3&prep=900&fog=0', `(async () => { ${HELPERS}
  sim.state.factions.new_antioch.spec = ['na_faith', null, null];
  const na = ['combat_medic', 'trench_cleric', 'shock_flamer', 'na_lieutenant', 'civilians'];
  na.forEach((u, i) => __spawn('new_antioch', u, 142 + i * 6, 442, 0.4));
  const bg = ['herald', 'amalgam', 'lord_of_tumours', 'grail_thrall'];
  bg.forEach((u, i) => __spawn('black_grail', u, 146 + i * 7, 430, 3.4));
  g.lookAt(156, 438); g.camera.dist = 24; g.camera.yaw = 0.25;
})()`, [['lineup', 20], ['na_close', 10, () => { TC.game.lookAt(150, 442); TC.game.camera.dist = 12; TC.game.camera.yaw = 0.1; }],
  ['bg_close', 10, () => { TC.game.lookAt(157, 430); TC.game.camera.dist = 14; TC.game.camera.yaw = 3.2; }]]);

await scene('p3_flame', base + '?autostart=1&seed=3&prep=0&fog=0', `(async () => { ${HELPERS}
  __spawn('new_antioch', 'shock_flamer', 160, 452, Math.PI);
  __add('wire', 'new_antioch', { x1: 146, z1: 444, x2: 172, z2: 444, front: 1 });
  __spawn('black_grail', 'grail_thrall', 157, 428, 0);
  __spawn('black_grail', 'grail_thrall', 165, 426, 0);
  setTimeout(() => __cmd({ type: 'MOVE', faction: 'black_grail', squadIds: sim.state.squads.filter((q) => q.faction === 'black_grail' && q.type === 'grail_thrall' && q.cz < 440).map((q) => q.id), x: 160, z: 452, attackMove: true }), 100);
  g.lookAt(160, 443); g.camera.dist = 24; g.camera.yaw = 0.35;
})()`, [['contact', 110], ['fire', 16], ['after', 90]]);

await scene('p3_plague', base + '?autostart=1&seed=3&prep=0&fog=0', `(async () => { ${HELPERS}
  // seen from the defenders' side: the Great Pestilence falls on a New Antioch picket
  const f = sim.state.factions.black_grail;
  f.resources.biomass = 2000; f.pestilence = 100; f.pestTier = 4;
  __spawn('new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  __spawn('new_antioch', 'yeoman_rifle', 172, 424, Math.PI);
  __spawn('black_grail', 'herald', 166, 386, 0);
  g.lookAt(166, 418); g.camera.dist = 40; g.camera.yaw = 0.3;
  setTimeout(() => __cmd({ type: 'USE_ABILITY', faction: 'black_grail', ability: 'great_pestilence', x: 166, z: 422 }), 300);
})()`, [['cloud', 50], ['sick', 160], ['close', 10, () => { TC.game.lookAt(164, 421); TC.game.camera.dist = 16; TC.game.camera.yaw = 0.5; }]]);

await scene('p3_hud', base + '?autostart=1&seed=3&prep=900&fog=0', `(async () => { ${HELPERS}
  const t1 = sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch');
  const rifles = sim.state.squads.filter((q) => q.type === 'yeoman_rifle').slice(0, 2);
  __cmd({ type: 'ENTER_TRENCH', faction: 'new_antioch', squadIds: rifles.map((q) => q.id), sid: t1.id });
  // software GL renders a few frames per second: keep the (wall-clock) highlight up long enough to be captured
  const eh = await import('/src/ui/engineer_highlight.js');
  g.engineerHighlights = eh.createEngineerHighlights(30);
  g.lookAt(150, 470); g.camera.dist = 50; g.camera.yaw = 0;
})()`, [['engineer', 30, () => { TC.game.actions.build('wire', { x1: 120, z1: 452, x2: 132, z2: 452 }); }],
  ['beam', 6, () => {
    const sim = TC.game.sim, eng = sim.state.squads.find((q) => q.faction === 'new_antioch' && q.order && q.order.t === 'build');
    if (eng) { TC.game.lookAt(eng.cx * 0.8 + 126 * 0.2, eng.cz * 0.8 + 452 * 0.2 - 2); TC.game.camera.dist = 34; TC.game.camera.yaw = 0.2; }
  }],
  ['trench', 30, () => { const t = TC.game.sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch'); TC.game.selection.setStruct(t.id); setTimeout(() => { const b = document.querySelector('.cmd.badge'); if (b) b.click(); }, 400); }],
  ['spec', 10, () => { TC.game.selection.clear(); document.querySelector('.q.spec').click(); setTimeout(() => { const c = document.querySelector('.speccard'); if (c) c.click(); }, 300); }]]);

await scene('p3_convoy', base + '?autostart=1&seed=3&prep=900&fog=0', `(async () => { ${HELPERS} ${P3}
  const s = __settle('fertile_c', 12);
  s.stock.food = 70; s.stock.material = 20;
  g.lookAt(160, 440); g.camera.dist = 40; g.camera.yaw = 0.2;
})()`, [['cart', 120], ['cart_close', 30, () => { const c = TC.game.sim.state.convoys[0]; if (c) { TC.game.lookAt(c.x, c.z); TC.game.camera.dist = 14; TC.game.camera.yaw = 1.2; } }]]);

await browser.close();
server.close();
