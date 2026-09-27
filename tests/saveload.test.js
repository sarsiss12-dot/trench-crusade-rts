import { test, assert } from './harness.js';
import { serializeSave, deserializeSave, hashState, SAVE_FORMAT, migrateSave, encodeState } from '../src/save/codec.js';
import { simulationFromState, stateHash } from '../src/sim/simulation.js';
import { createStorage } from '../src/save/storage.js';
import { makeSim, run } from './helpers.js';
import { STATE_VERSION } from '../src/sim/constants.js';

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] || null,
    get length() { return m.size; },
    _map: m,
  };
}

test('versioned save roundtrip preserves state exactly', () => {
  const sim = makeSim({ controllers: { new_antioch: 'ai', black_grail: 'ai' } });
  run(sim, 30);
  const str = serializeSave(sim.state, { name: 'test' });
  const obj = JSON.parse(str);
  assert.equal(obj.format, SAVE_FORMAT);
  assert.equal(obj.version, STATE_VERSION);
  const { state, meta } = deserializeSave(str);
  assert.equal(meta.name, 'test');
  assert.equal(hashState(state), hashState(sim.state));
  assert.ok(state.fog.seen[0] instanceof Uint8Array);
  assert.ok(state.infection.v instanceof Uint8Array);
  const sim2 = simulationFromState(state);
  assert.equal(stateHash(sim2), stateHash(sim));
});

test('save contains no renderer / runtime state', () => {
  const sim = makeSim();
  const str = serializeSave(sim.state);
  for (const bad of ['"rt"', '"world"', '"gl"', 'WebGL', '"mesh"', '"texture"', '"nav"', '"events"']) {
    assert.ok(str.indexOf(bad) < 0, 'save contains ' + bad);
  }
});

test('migration layer upgrades older saves; rejects unknown/future versions', () => {
  const sim = makeSim();
  const s = JSON.parse(encodeState(sim.state));
  delete s.effects; delete s.pending; delete s.commandSeq;
  for (const sq of s.squads) { delete sq.hordeBonus; for (const m of sq.members) delete m.killer; }
  s.version = 0;
  const upgraded = migrateSave({ format: SAVE_FORMAT, version: 0, state: s, meta: {} });
  assert.equal(upgraded.version, STATE_VERSION);
  assert.ok(Array.isArray(upgraded.state.effects));
  assert.equal(upgraded.state.squads[0].hordeBonus, 0);
  assert.throws(() => migrateSave({ format: SAVE_FORMAT, version: 99, state: {} }));
  assert.throws(() => migrateSave({ format: 'nope', version: 1, state: {} }));
  assert.throws(() => deserializeSave('{"broken":'));
});

test('storage: slots, autosave and sandbox isolation (stress mode never touches campaign saves)', () => {
  const ls = fakeLocalStorage();
  const storage = createStorage(ls);
  const sim = makeSim();
  assert.ok(storage.save('slot1', sim.state, { label: 'A' }).ok);
  const list = storage.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].slot, 'slot1');
  const loaded = storage.load('slot1');
  assert.equal(hashState(loaded.state), hashState(sim.state));
  // sandbox (stress) state is refused for campaign slots
  sim.state.settings.sandbox = true;
  const r = storage.save('slot1', sim.state);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'save.sandbox');
  assert.equal(hashState(storage.load('slot1').state).toString().length > 0, true);
  // unavailable storage degrades gracefully
  const broken = createStorage({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {}, key() { return null; }, length: 0 });
  assert.equal(broken.save('slot1', makeSim().state).ok, false);
  assert.equal(broken.load('slot1'), null);
  assert.deepEqual(broken.list(), []);
});
