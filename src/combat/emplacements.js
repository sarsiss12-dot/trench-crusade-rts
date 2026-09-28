// Emplacements (Phase 4): the New Antioch FIELD GUN and the Black Grail organic nests (Viscera
// Cannon nest, Corruption Belcher nest). Data: data/emplacements.js.
// A gun position is a built structure with a crew abstraction:
//  - it traverses slowly toward its target (st.aim, rad/s) and fires only when laid on it
//  - 'shell' weapons LOB a round: a scheduled blast (state.effects kind 'shell') lands after the
//    flight time with scatter around the aim point — craters, suppression, structure damage,
//    (organic) infection; resolved by sim/abilities.js like every other blast
//  - 'cloud' weapons spew a short-lived corrosive cloud (plague_cloud effect) on the target
//  - minimum range (a field gun cannot hit what is at its wheels), supply per round (New Antioch),
//    and enemies close to the gun keep the crew from serving it (weak up close)
//  - only visible targets (operational reorganisation windows never stop the guns)
// Deterministic: plain state on the structure (cooldown, aim, targetId, tk), rng from state.
import { STRUCTURES } from '../data/structures.js';
import { EMPLACEMENT_WEAPONS } from '../data/emplacements.js';
import { ABILITIES } from '../data/abilities.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { EV } from '../core/events.js';
import { rngFloat } from '../core/rng.js';
import { dist, dsin, dcos, headingOf, turnToward, wrapAngle } from '../core/dmath.js';
import { TICK_RATE, TARGET_INTERVAL } from '../sim/constants.js';
import { distanceToStructure } from '../units/orders.js';

const DT = 1 / TICK_RATE;
const LAID = 0.06; // rad: close enough to fire

export function emplacementWeapon(st) {
  const d = STRUCTURES[st.type];
  return d && d.emplacement ? EMPLACEMENT_WEAPONS[d.emplacement] : null;
}

function aliveCount(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}

/** Enemies within the crew radius stop the crew serving the gun (weak up close). */
function crewThreatened(sim, st, w) {
  if (!w.crewThreatR) return false;
  const R = w.crewThreatR;
  for (const sq of sim.state.squads) {
    if (!areHostile(st.faction, sq.faction) || dist(sq.cx, sq.cz, st.x, st.z) > R + 12) continue;
    for (const m of sq.members) if (m.state === 'alive' && dist(m.x, m.z, st.x, st.z) <= R) return true;
  }
  return false;
}

function inArc(st, def, x, z) {
  if (!def.arc || def.arc >= 360) return true;
  return Math.abs(wrapAngle(headingOf(x - st.x, z - st.z) - st.rot)) <= (def.arc * Math.PI) / 360;
}

/**
 * Pick a target: the thickest visible enemy group, or (field gun) a visible enemy structure.
 * Records WHY nothing could be engaged (st.gs, "why can't I?" in the HUD): a visible enemy only
 * inside the minimum range ('min_range') or only outside the laid sector ('traverse').
 */
function pickTarget(sim, st, def, w) {
  const { state } = sim;
  const bit = 1 << FACTIONS[st.faction].index;
  let best = null, bestS = Infinity, kind = '';
  let tooClose = 0, outArc = 0;
  for (const e of state.squads) {
    if (!areHostile(st.faction, e.faction) || !(e.visibleTo & bit)) continue;
    const n = aliveCount(e);
    if (!n) continue;
    const d = dist(st.x, st.z, e.cx, e.cz);
    if (d > w.range) continue;
    if (d < w.minRange) { tooClose++; continue; }
    if (!inArc(st, def, e.cx, e.cz)) { outArc++; continue; }
    const s = d * 0.25 - n * 3;
    if (s < bestS || (s === bestS && best && e.id < best.id)) { bestS = s; best = e; kind = 'squad'; }
  }
  if (w.targetStructures) {
    for (const o of state.structures) {
      if (!areHostile(st.faction, o.faction) || !(o.visibleTo & bit) || o.hp <= 0) continue;
      const d = distanceToStructure(o, st.x, st.z);
      if (d > w.range || d < w.minRange || !inArc(st, def, o.x, o.z)) continue;
      const s = d * 0.25 - (o.objective ? 30 : 16);
      if (s < bestS || (s === bestS && best && o.id < best.id)) { bestS = s; best = o; kind = 'struct'; }
    }
  }
  st.targetId = best ? best.id : 0;
  st.tk = kind;
  st.gs = best ? '' : tooClose ? 'min_range' : outArc ? 'traverse' : 'no_target';
  return best;
}

function resolveTarget(sim, st) {
  if (!st.targetId) return null;
  const t = st.tk === 'struct' ? sim.rt.structById.get(st.targetId) : sim.rt.squadById.get(st.targetId);
  if (!t) return null;
  const bit = 1 << FACTIONS[st.faction].index;
  if (!(t.visibleTo & bit)) return null;
  if (st.tk === 'squad' && !aliveCount(t)) return null;
  return t;
}

function fire(sim, st, w, t) {
  const { state } = sim;
  const tx = st.tk === 'struct' ? t.x : t.cx, tz = st.tk === 'struct' ? t.z : t.cz;
  const f = state.factions[st.faction];
  if (w.supplyPerShot > 0) {
    if ((f.resources.supply || 0) < w.supplyPerShot) {
      if (state.tick - (st.dryT === undefined ? -1e9 : st.dryT) > 30 * TICK_RATE) {
        st.dryT = state.tick;
        sim.events.push({ type: EV.NOTICE, faction: st.faction, key: 'gun.no_supply', x: st.x, z: st.z });
      }
      st.cooldown = TICK_RATE; // try again in a second
      st.gs = 'no_supply';
      return;
    }
    f.resources.supply -= w.supplyPerShot;
  }
  const d = dist(st.x, st.z, tx, tz);
  const a = rngFloat(state.rng.main) * 6.283185307179586;
  const r = (w.scatter || 0) + d * (w.scatterPerM || 0) * rngFloat(state.rng.main);
  const lx = tx + dsin(a) * r, lz = tz + dcos(a) * r;
  const mx = st.x + dsin(st.aim) * 2.2, mz = st.z + dcos(st.aim) * 2.2;
  st.shots = (st.shots || 0) + 1;
  f.stats.gunShots = (f.stats.gunShots || 0) + 1;
  if (w.kind === 'shell') {
    const flight = (w.flightBase || 0.8) + d * (w.flightPerM || 0);
    state.effects.push({
      id: state.nextId++, kind: 'shell', ability: w.id, faction: st.faction, owner: st.faction,
      x: lx, z: lz, radius: w.blast.blastRadius, start: state.tick, next: state.tick + Math.max(1, Math.round(flight * TICK_RATE)),
      blast: w.blast, src: st.id,
    });
    sim.events.push({ type: EV.STRUCTURE_FIRE, struct: st.id, faction: st.faction, weapon: w.id, x: mx, z: mz, tx: lx, tz: lz, hit: false, target: 0, tsq: 0, shell: 1, flight });
  } else if (w.kind === 'cloud') {
    const c = w.cloud;
    const def = ABILITIES[c.ability];
    state.effects.push({
      id: state.nextId++, kind: 'plague_cloud', ability: c.ability, faction: st.faction, owner: st.faction,
      x: lx, z: lz, radius: c.radius, start: state.tick, end: state.tick + Math.round(c.duration * TICK_RATE), next: state.tick,
      emplacement: 1,
    });
    void def;
    sim.events.push({ type: EV.STRUCTURE_FIRE, struct: st.id, faction: st.faction, weapon: w.id, x: mx, z: mz, tx: lx, tz: lz, hit: false, target: 0, tsq: 0, gas: 1 });
  }
  st.cooldown = Math.round(w.reload * TICK_RATE * (1 + (rngFloat(state.rng.main) - 0.5) * (w.reloadJitter || 0)));
}

/** Per tick (WAR only): every built emplacement acquires, traverses, fires. */
export function updateEmplacements(sim) {
  const { state } = sim;
  if (state.match.phase !== 'WAR') return;
  for (const st of state.structures) {
    if (!st.built) continue;
    const w = emplacementWeapon(st);
    if (!w) continue;
    const def = STRUCTURES[st.type];
    if (st.aim === undefined) st.aim = st.rot;
    if (st.cooldown > 0) st.cooldown--;
    // re-laying the gun (REORIENT): out of action until the crew has it bedded in again
    if (st.relayUntil > state.tick) { st.gs = 'relay'; st.aim = turnToward(st.aim, st.rot, w.traverse * DT); continue; }
    let t = resolveTarget(sim, st);
    if (!t || (state.tick + st.id) % TARGET_INTERVAL === 0) t = pickTarget(sim, st, def, w);
    if (!t) continue;
    const tx = st.tk === 'struct' ? t.x : t.cx, tz = st.tk === 'struct' ? t.z : t.cz;
    // still in its range band after moving?
    const d = dist(st.x, st.z, tx, tz);
    if (d < w.minRange || d > w.range + 4) { st.targetId = 0; continue; }
    const want = headingOf(tx - st.x, tz - st.z);
    st.aim = turnToward(st.aim, want, w.traverse * DT);
    if (st.cooldown > 0 || Math.abs(wrapAngle(want - st.aim)) > LAID) continue;
    if (crewThreatened(sim, st, w)) { st.gs = 'crew'; continue; }
    st.gs = '';
    fire(sim, st, w, t);
  }
}
