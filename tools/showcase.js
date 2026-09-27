#!/usr/bin/env node
// Visual showcase (optional, needs Playwright + Chromium, like browser_smoke.js): stages Phase 2
// scenes in the real renderer and writes screenshots to test-output/showcase-*.png —
// structures & walls, artillery + craters, mortar, fly swarm, gore at point-blank, facing arrow.
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

await browser.close();
server.close();
