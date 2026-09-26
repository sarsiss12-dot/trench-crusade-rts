import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert } from './harness.js';
import { UNITS } from '../src/data/units.js';
import { STRUCTURES } from '../src/data/structures.js';
import { ABILITIES } from '../src/data/abilities.js';
import { FACTIONS } from '../src/data/factions.js';
import { encodeState, decodeState } from '../src/save/codec.js';
import { CMD, makeCommand } from '../src/sim/commands.js';
import { makeSim, run } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(root);
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function importsOf(file) {
  const src = sources.get(file);
  const res = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    if (m[1].startsWith('.')) res.push(resolve(dirname(file), m[1]));
  }
  return res;
}

const SIM_DIRS = ['core', 'data', 'world', 'sim', 'units', 'combat', 'construction', 'economy', 'factions', 'ai', 'save'];
const PRESENTATION_DIRS = ['render', 'ui', 'input', 'audio', 'app'];
const topDir = (f) => relative(root, f).split(/[\\/]/)[0];

test('no circular module dependencies', () => {
  const graph = new Map(files.map((f) => [f, importsOf(f)]));
  const state = new Map();
  const stack = [];
  let cycle = null;
  function dfs(f) {
    if (cycle) return;
    state.set(f, 1);
    stack.push(f);
    for (const d of graph.get(f) || []) {
      if (!graph.has(d)) continue;
      if (state.get(d) === 1) { cycle = stack.slice(stack.indexOf(d)).concat(d).map((x) => relative(root, x)); return; }
      if (!state.get(d)) dfs(d);
    }
    stack.pop();
    state.set(f, 2);
  }
  for (const f of files) if (!state.get(f)) dfs(f);
  assert.ok(!cycle, 'cycle: ' + (cycle && cycle.join(' -> ')));
});

test('all relative imports resolve to existing files', () => {
  for (const f of files) {
    for (const d of importsOf(f)) assert.ok(sources.has(d), relative(root, f) + ' imports missing ' + relative(root, d));
  }
});

test('simulation never depends on render/ui/input/audio/app', () => {
  for (const f of files) {
    if (SIM_DIRS.indexOf(topDir(f)) < 0) continue;
    for (const d of importsOf(f)) {
      assert.ok(PRESENTATION_DIRS.indexOf(topDir(d)) < 0, relative(root, f) + ' imports presentation module ' + relative(root, d));
    }
  }
});

test('no uncontrolled randomness / engine-dependent math / DOM in simulation code', () => {
  const forbidden = [
    /Math\.random\s*\(/, /Math\.(sin|cos|tan|atan|atan2|exp|log|pow|hypot|asin|acos|cbrt)\s*\(/,
    /Date\.now\s*\(/, /performance\.now\s*\(/, /\bdocument\./, /\bwindow\./, /WebGL/, /localStorage/,
  ];
  for (const f of files) {
    if (SIM_DIRS.indexOf(topDir(f)) < 0) continue;
    const src = sources.get(f).replace(/\/\/[^\n]*/g, '');
    for (const re of forbidden) assert.ok(!re.test(src), relative(root, f) + ' uses forbidden ' + re);
  }
});

test('Math.random is not used anywhere (visual randomness uses seeded visual RNG)', () => {
  for (const f of files) {
    const src = sources.get(f).replace(/\/\/[^\n]*/g, '');
    assert.ok(!/Math\.random\s*\(/.test(src), relative(root, f) + ' uses Math.random');
  }
});

test('bundler constraints: no default exports, no dynamic imports', () => {
  for (const f of files) {
    const src = sources.get(f);
    assert.ok(!/export\s+default\b/.test(src), relative(root, f) + ' has export default');
    assert.ok(!/\bimport\s*\(/.test(src), relative(root, f) + ' uses dynamic import()');
  }
});

test('modular: domain directories exist and no giant single file', () => {
  for (const d of ['core', 'sim', 'render', 'world', 'units', 'combat', 'economy', 'construction', 'factions', 'ai', 'input', 'ui', 'audio', 'data', 'save']) {
    assert.ok(files.some((f) => topDir(f) === d), 'missing domain dir ' + d);
  }
  for (const f of files) {
    const lines = sources.get(f).split('\n').length;
    assert.less(lines, 1900, relative(root, f) + ' is too large (' + lines + ' lines)');
  }
});

test('GameState is JSON serializable through the save codec (typed arrays included)', () => {
  const sim = makeSim({ controllers: { new_antioch: 'ai', black_grail: 'ai' } });
  run(sim, 5);
  const json = encodeState(sim.state);
  assert.ok(typeof json === 'string' && json.length > 1000);
  const back = decodeState(json);
  assert.equal(encodeState(back), json);
  assert.ok(back.fog.vis[0] instanceof Uint8Array, 'typed arrays restored');
  // no functions / class instances inside state
  const walkObj = (o, path) => {
    if (o === null || typeof o !== 'object') {
      assert.ok(typeof o !== 'function', 'function at ' + path);
      return;
    }
    if (ArrayBuffer.isView(o)) return;
    const proto = Object.getPrototypeOf(o);
    assert.ok(proto === Object.prototype || proto === Array.prototype, 'non-plain object at ' + path);
    for (const k of Object.keys(o)) walkObj(o[k], path + '.' + k);
  };
  walkObj(sim.state, 'state');
});

test('commands are plain serializable data', () => {
  const cmds = [
    makeCommand(CMD.MOVE, 'new_antioch', { squadIds: [1, 2], x: 10, z: 20, attackMove: true }),
    makeCommand(CMD.ATTACK, 'new_antioch', { squadIds: [1], tk: 'squad', tid: 9 }),
    makeCommand(CMD.BUILD, 'new_antioch', { squadIds: [3], stype: 'trench', x1: 1, z1: 2, x2: 9, z2: 2 }),
    makeCommand(CMD.USE_ABILITY, 'black_grail', { ability: 'fly_swarm', x: 5, z: 6 }),
  ];
  for (const c of cmds) {
    assert.deepEqual(JSON.parse(JSON.stringify(c)), c);
    for (const k in c) assert.ok(typeof c[k] !== 'function' && !(c[k] && typeof c[k] === 'object' && !Array.isArray(c[k])), 'field ' + k);
  }
  for (const k of ['MOVE', 'ATTACK', 'STOP', 'BUILD', 'REPAIR', 'GATHER', 'DELIVER', 'ASSIST_BUILD', 'SET_RALLY', 'TRAIN', 'USE_ABILITY', 'FORMATION', 'ENTER_TRENCH']) {
    assert.ok(CMD[k], 'command type ' + k);
  }
});

test('data: every unit/structure/ability/faction declares lore status (canon vs abstraction)', () => {
  const all = [...Object.values(UNITS), ...Object.values(STRUCTURES), ...Object.values(ABILITIES), ...Object.values(FACTIONS)];
  for (const d of all) {
    assert.ok(d.lore && ['canon', 'canon-inspired', 'abstraction'].indexOf(d.lore.status) >= 0, 'lore status for ' + d.id);
  }
});

test('data: combatUnit flag is explicit on every unit; engineers are not combat units', () => {
  for (const u of Object.values(UNITS)) assert.ok(typeof u.combatUnit === 'boolean', u.id);
  assert.equal(UNITS.combat_engineer.combatUnit, false);
  assert.equal(UNITS.yeoman_rifle.combatUnit, true);
});

test('AI modules act only through commands (no direct state mutators)', () => {
  for (const f of files) {
    if (topDir(f) !== 'ai') continue;
    const bad = importsOf(f).filter((d) => /sim[\\/](state|runtime|production|abilities)\.js$|units[\\/](orders|movement)\.js$|combat[\\/]combat\.js$/.test(d));
    assert.equal(bad.length, 0, relative(root, f) + ' imports mutators ' + bad.map((b) => relative(root, b)).join(','));
  }
});

test('bundler constraint: imports / re-exports only at the top of each file', () => {
  for (const f of files) {
    const lines = sources.get(f).split('\n');
    let seenCode = false, inImport = false, inComment = false;
    for (const raw of lines) {
      const l = raw.trim();
      if (inComment) { if (l.includes('*/')) inComment = false; continue; }
      if (l.startsWith('/*')) { if (!l.includes('*/')) inComment = true; continue; }
      if (!l || l.startsWith('//')) continue;
      if (inImport) { if (/from\s+['"]/.test(l)) inImport = false; continue; }
      const isImport = /^import[\s{*]/.test(l) || /^export\s+(\{[^}]*\}|\*)\s+from\s/.test(l);
      if (isImport) {
        assert.ok(!seenCode, relative(root, f) + ' has an import after code: ' + l);
        if (!/from\s+['"]|^import\s+['"]/.test(l)) inImport = true;
      } else seenCode = true;
    }
  }
});

test('DOM-free presentation logic stays testable (session, actions, gestures, selection, picking)', () => {
  const domFree = ['app/session.js', 'app/actions.js', 'input/gestures.js', 'input/selection.js', 'input/pick.js', 'render/fog_memory.js'];
  for (const rel of domFree) {
    const f = files.find((x) => relative(root, x).split('\\').join('/') === rel);
    assert.ok(f, 'missing ' + rel);
    const src = sources.get(f).replace(/\/\/[^\n]*/g, '');
    assert.ok(!/\bdocument\.|\bwindow\.|localStorage/.test(src), rel + ' touches the DOM');
  }
});
