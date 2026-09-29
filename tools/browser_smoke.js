#!/usr/bin/env node
// Browser smoke test (optional, needs Playwright + Chromium): boots the real game in headless
// Chromium (WebGL2 via SwiftShader if no GPU), checks menus, both sides, touch input, the stress
// mode and the single-file build for runtime errors, and writes screenshots to test-output/.
// Usage: node tools/browser_smoke.js [name-filter]   (set PLAYWRIGHT_MODULE=/path/to/playwright if not local)
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStaticServer } from './serve.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const out = join(root, 'test-output');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', join(process.env.HOME || '', '.npm-global/lib/node_modules/playwright'), '/usr/lib/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try next */ }
  }
  return null;
}

const pw = loadPlaywright();
if (!pw) {
  console.log('Playwright not found — skipping browser smoke test. Install with: npm i -D playwright && npx playwright install chromium');
  process.exit(0);
}

mkdirSync(out, { recursive: true });
const server = createStaticServer(root);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/index.html`;
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

let failures = 0;
const only = process.argv[2] || '';
async function check(name, url, opts = {}) {
  if (only && !name.includes(only)) return;
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 720 }, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  if (opts.init) await page.addInitScript(opts.init);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !(opts.expectErrors && opts.expectErrors.test(m.text()))) errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForTimeout(opts.wait || 6000);
  let info = {};
  try {
    if (opts.act) await opts.act(page);
    info = await page.evaluate(() => {
      const g = window.TC && window.TC.game;
      return g ? { tick: g.sim.state.tick, phase: g.sim.state.match.phase, squads: g.sim.state.squads.length, draw: g.renderer.frameStats.drawCalls } : { menu: window.TC && window.TC.menu && window.TC.menu.current };
    });
  } catch (e) {
    errors.push('check: ' + e.message);
  }
  await page.screenshot({ path: join(out, name + '.png') });
  const ok = errors.length === 0 && (!opts.expectGame || (info.tick > 0 && info.draw > 0));
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${JSON.stringify(info)}${errors.length ? '\n     ' + errors.slice(0, 5).join('\n     ') : ''}`);
  await ctx.close();
}

await check('menu', base, { wait: 2500 });
await check('new-antioch', base + '?autostart=1&seed=3&prep=20', { expectGame: true });
await check('black-grail-portrait', base + '?autostart=1&faction=black_grail&seed=3&prep=20', { expectGame: true, viewport: { width: 390, height: 844 }, dpr: 2, touch: true });
await check('touch-select-move', base + '?autostart=1&seed=3&prep=60', {
  expectGame: true, touch: true, viewport: { width: 844, height: 390 }, dpr: 2,
  act: async (page) => {
    // tap the "All" quick button then tap the ground: squads must receive a move order
    await page.tap('.quick .q');
    await page.waitForTimeout(300);
    const box = await page.evaluate(() => { const r = TC.game.canvas.getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.42]; });
    await page.touchscreen.tap(box[0], box[1]);
    // the command is applied on the next simulation tick; software GL can take seconds per frame
    const moving = await page.waitForFunction(
      () => TC.game.selection.ownSquads(TC.game.sim, TC.game.viewer).filter((s) => s.order.t === 'move').length,
      null, { timeout: 15000, polling: 200 },
    ).then((h) => h.jsonValue()).catch(() => 0);
    if (moving < 1) throw new Error('touch move order not issued');
  },
});
await check('context-loss-recovers', base + '?autostart=1&seed=3&quality=low', {
  expectGame: true,
  act: async (page) => {
    // mobile app switch / driver reset: the match must come back with the same simulation
    const before = await page.evaluate(() => ({ tick: TC.game.sim.state.tick, game: TC.game }));
    const old = await page.evaluateHandle(() => TC.game);
    await page.evaluate(() => TC.game.renderer.gl.getExtension('WEBGL_lose_context').loseContext());
    await page.waitForFunction((o) => TC.game && TC.game !== o && TC.game.running && TC.game.renderer.frameStats.drawCalls > 0, old, { timeout: 30000, polling: 250 });
    const after = await page.evaluate(() => TC.game.sim.state.tick);
    if (after < before.tick) throw new Error('simulation state was not kept across the context loss');
  },
});
await check('start-failure-recovers', base + '?autostart=1&seed=3&quality=balanced', {
  expectGame: true,
  expectErrors: /webgl\.unavailable/,
  init: () => {
    // the first match context is refused (driver trouble): the player gets a way on, not a dead end
    const orig = HTMLCanvasElement.prototype.getContext;
    let n = 0;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (type === 'webgl2' && ++n === 2) return null;
      return orig.call(this, type, ...rest);
    };
  },
  act: async (page) => {
    await page.waitForSelector('.fatal .big.primary', { timeout: 15000 });
    await page.click('.fatal .big.primary'); // retry on low quality
    // (the first simulated tick can lag the first drawn frame on a software rasterizer)
    await page.waitForFunction(() => TC.game && TC.game.renderer.frameStats.drawCalls > 0 && TC.game.sim.state.tick > 0, null, { timeout: 30000, polling: 250 });
    const q = await page.evaluate(() => TC.settings.quality);
    if (q !== 'low') throw new Error('retry did not switch to low quality');
  },
});
// Phase 5A: Match Setup (mobile portrait) — Free Setup, Black Grail DEFENDER vs New Antioch
await check('match-setup-portrait', base, {
  wait: 2500, viewport: { width: 390, height: 844 }, dpr: 2, touch: true,
  act: async (page) => {
    await page.evaluate(() => TC.menu.showNewGame());
    await page.waitForTimeout(300);
    const pick = (step, sel) => page.evaluate(([i, q]) => { const el = document.querySelectorAll('.setupstep')[i].querySelector(q); if (!el) throw new Error('missing ' + q); el.click(); }, [step, sel]);
    await pick(0, '.opt.big2:nth-child(2)'); // FREE SETUP
    await page.waitForTimeout(200);
    if ((await page.evaluate(() => document.querySelectorAll('.card.locked').length)) < 4) throw new Error('locked planned-faction cards missing');
    await pick(2, '.card.black_grail'); // your faction
    await pick(3, '.card.new_antioch'); // enemy faction
    await pick(4, '.opt.big2:nth-child(1)'); // DEFENDER
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(out, 'match-setup-portrait-form.png'), fullPage: true });
    const summary = await page.evaluate(() => document.querySelector('.summary b').textContent);
    if (!/KÂSE|GRAIL/.test(summary)) throw new Error('summary: ' + summary);
    await page.evaluate(() => document.querySelector('.menu .mlist .big.primary').click());
    await page.waitForFunction(() => TC.game && TC.game.sim.state.tick > 0 && TC.game.renderer.frameStats.drawCalls > 0, null, { timeout: 30000, polling: 250 });
    const who = await page.evaluate(() => { const g = TC.game; const f = g.sim.state.factions[g.viewer]; return [g.viewer, f.role, f.region, g.sim.state.settings.setupMode]; });
    if (who.join() !== 'black_grail,defender,south,free') throw new Error('setup not applied: ' + who.join());
    await page.waitForTimeout(2500);
  },
});
await check('reverse-na-attacker', base + '?autostart=1&setup=free&pf=new_antioch&ef=black_grail&role=attacker&seed=3&prep=20', { expectGame: true });
await check('na-mirror', base + '?autostart=1&setup=free&pf=new_antioch&ef=new_antioch&role=attacker&seed=3&prep=20', { expectGame: true });
await check('bg-mirror-portrait', base + '?autostart=1&setup=free&pf=black_grail&ef=black_grail&role=defender&seed=3&prep=20', { expectGame: true, viewport: { width: 390, height: 844 }, dpr: 2, touch: true });
await check('open-battle', base + '?autostart=1&setup=free&scenario=open_battle&pf=black_grail&ef=new_antioch&role=attacker&seed=3&prep=20', { expectGame: true });
await check('stress-160', base + '?stress=160&quality=low', { expectGame: true, wait: 8000 });
await check('gallery', base + '?view=gallery', { expectGame: true });
const dist = join(root, 'dist', 'index.html');
if (existsSync(dist)) await check('dist-single-file', pathToFileURL(dist).href + '?autostart=1&seed=3', { expectGame: true });

await browser.close();
server.close();
console.log(failures ? `${failures} browser check(s) failed` : 'all browser checks passed', `— screenshots in ${out}`);
process.exit(failures ? 1 : 0);
