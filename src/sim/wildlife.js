// Wildlife & livestock (Phase 3). Ordinary animals live in map habitats (bounded population, slow
// respawn — an RTS abstraction, not a breeding simulator), wander in small herds, shy away from
// soldiers and bolt from the Black Grail and from shellfire. New Antioch drovers herd them alive
// into livestock pens (sustained food; emergency slaughter), Black Grail work gangs forage them
// (carcass -> biomass). Plain data in state.animals; cheap steering (no pathfinding), updated
// every WILDLIFE.updateEvery ticks with spatial queries only.
import { SPECIES, WILDLIFE } from '../data/animals.js';
import { STRUCTURES } from '../data/structures.js';
import { sideBit, sideDef } from '../data/factions.js';
import { unitDef } from '../data/units.js';
import { PESTILENCE } from '../data/specialities.js';
import { EV } from '../core/events.js';
import { rngFloat, rngInt } from '../core/rng.js';
import { dist, dsin, dcos, datan2, TAU, turnToward } from '../core/dmath.js';
import { DT, TICK_RATE } from './constants.js';
import { isPointPassable } from '../world/nav.js';
import { pointGridQuery } from './runtime.js';
import { addCarcass } from './corpses.js';
import { pestGain, isPlagueSide, plagueFaction } from '../factions/pestilence.js';
import { specValue, specRule } from './specialities.js';

// Phase 5A: 'the Grail' here is any side whose faction runs the plague economy (per SIDE: a mirror
// match has two hunters; each kill credits the killer's side)
function huntsFlesh(side) {
  const d = sideDef(side);
  return !!(d && d.pestilence);
}

function habitatDef(sim, id) {
  for (const h of sim.world.habitats) if (h.id === id) return h;
  return null;
}

function pickSpecies(rng, h) {
  let total = 0;
  for (const k in h.species) total += h.species[k];
  let r = rngFloat(rng) * total;
  for (const k in h.species) {
    r -= h.species[k];
    if (r < 0) return k;
  }
  return Object.keys(h.species)[0];
}

function spawnAnimal(sim, h, sp, inside) {
  const { state } = sim;
  if (state.animals.length >= WILDLIFE.maxTotal) return null;
  const rng = state.rng.eco;
  const nav = sim.rt.nav;
  let x = h.x, z = h.z;
  for (let k = 0; k < 8; k++) {
    const a = rngFloat(rng) * TAU;
    const rr = inside ? h.r * 0.85 * Math.sqrt(rngFloat(rng)) : h.r * (0.8 + 0.2 * rngFloat(rng));
    const px = h.x + dsin(a) * rr, pz = h.z + dcos(a) * rr;
    if (isPointPassable(nav, px, pz)) { x = px; z = pz; break; }
  }
  const an = {
    id: state.nextId++, sp, x, z, rot: rngFloat(rng) * TAU, vx: 0, vz: 0,
    hp: SPECIES[sp].hp, st: 'wild', hab: h.id, pen: 0, by: 0,
    tx: x, tz: z, wait: state.tick + rngInt(rng, 60), panic: 0, shy: 0, px: 0, pz: 0,
    visibleTo: 0, seenBy: 0,
  };
  state.animals.push(an);
  return an;
}

/** Initial herds (deterministic from the match seed). */
export function setupWildlife(sim) {
  const { state, world } = sim;
  state.animals = [];
  state.habitats = world.habitats.map((h) => ({ id: h.id, next: 0 }));
  for (const h of world.habitats) {
    for (let i = 0; i < h.start; i++) spawnAnimal(sim, h, pickSpecies(state.rng.eco, h), true);
  }
  // presentation sandbox (model gallery): one of each species on a row
  const lineup = sim.scenario && sim.scenario.galleryAnimals;
  const pts = world.anchors && world.anchors.gallery_animals;
  if (lineup && pts) {
    lineup.forEach((sp, i) => {
      const p = pts[i % pts.length];
      const an = spawnAnimal(sim, { id: '', x: p[0], z: p[1], r: 0.5 }, sp, true);
      if (an) { an.x = p[0]; an.z = p[1]; an.tx = p[0]; an.tz = p[1]; an.rot = 0.6; }
    });
  }
}

export function animalById(state, id) {
  for (const a of state.animals) if (a.id === id) return a;
  return null;
}

// ------------------------------------------------------------------ death / damage

/** Kill an animal. cause 'slaughter' leaves no carcass (butchered for food). */
export function killAnimal(sim, a, byFaction, cause) {
  const { state } = sim;
  const i = state.animals.indexOf(a);
  if (i < 0) return;
  state.animals.splice(i, 1);
  const def = SPECIES[a.sp];
  if (a.hab) {
    for (const hs of state.habitats || []) {
      if (hs.id === a.hab) hs.next = Math.max(hs.next, state.tick + WILDLIFE.respawnAfterDeathSec * TICK_RATE);
    }
  }
  if (isPlagueSide(state, byFaction)) {
    pestGain(sim, PESTILENCE.gain.animalKill, 'animals', byFaction);
    state.factions[byFaction].stats.animalsKilled++;
  }
  if (cause !== 'slaughter') {
    const eater = isPlagueSide(state, byFaction) ? byFaction : plagueFaction(state);
    const bio = def.biomass * (eater ? specValue(state, eater, 'corpseBiomass', 1) : 1);
    addCarcass(sim, a.x, a.z, a.rot, a.sp, bio, a.visibleTo);
  }
  sim.events.push({ type: EV.ANIMAL_KILLED, id: a.id, sp: a.sp, x: a.x, z: a.z, by: byFaction || '', cause: cause || '' });
}

export function damageAnimal(sim, a, dmg, byFaction, cause) {
  a.hp -= dmg;
  if (a.hp <= 0) killAnimal(sim, a, byFaction, cause);
  else if (a.st !== 'penned') { a.panic = sim.state.tick + WILDLIFE.panicSec * TICK_RATE; }
}

/** Shellfire: animals close to the blast die / are hurt, everything within earshot bolts. */
export function animalsBlast(sim, x, z, R, damage, byFaction) {
  const { state } = sim;
  const P = WILDLIFE.blastPanicR;
  for (let i = state.animals.length - 1; i >= 0; i--) {
    const a = state.animals[i];
    const d = dist(a.x, a.z, x, z);
    if (d > P) continue;
    if (d < R) { damageAnimal(sim, a, damage * (1 - d / R), byFaction, 'blast'); if (state.animals[i] !== a) continue; }
    if (a.st === 'penned') continue;
    if (a.st === 'herded') { a.st = 'wild'; a.by = 0; }
    const dd = d || 1;
    a.px = (a.x - x) / dd; a.pz = (a.z - z) / dd;
    a.panic = state.tick + WILDLIFE.panicSec * TICK_RATE;
  }
}

// ------------------------------------------------------------------ senses

const SENSE = { gx: 0, gz: 0, gd: 1e9, sx: 0, sz: 0, sd: 1e9, grail: false, gang: false };

function sense(sim, a) {
  const { state } = sim;
  SENSE.gd = 1e9; SENSE.sd = 1e9; SENSE.grail = false; SENSE.gang = false;
  pointGridQuery(sim.rt.soldierGrid, a.x, a.z, WILDLIFE.grailR, (m, sq, d2) => {
    if (m.state !== 'alive') return;
    const def = unitDef(sq.type);
    if (huntsFlesh(sq.faction)) {
      const gangR = specRule(state, sq.faction, 'pounce') ? 4 : 9;
      if (def.combatUnit) {
        if (d2 < SENSE.gd) { SENSE.gd = d2; SENSE.gx = m.x; SENSE.gz = m.z; SENSE.grail = true; }
      } else if (d2 <= gangR * gangR && d2 < SENSE.sd) { SENSE.sd = d2; SENSE.sx = m.x; SENSE.sz = m.z; SENSE.gang = true; }
    } else if (def.roles.indexOf('civilian') < 0 && d2 <= WILDLIFE.crowdR * WILDLIFE.crowdR && d2 < SENSE.sd) {
      SENSE.sd = d2; SENSE.sx = m.x; SENSE.sz = m.z;
    }
  });
  const tick = state.tick;
  if (SENSE.grail && a.st !== 'penned') {
    const d = Math.sqrt(SENSE.gd) || 1;
    a.px = (a.x - SENSE.gx) / d; a.pz = (a.z - SENSE.gz) / d;
    a.panic = tick + WILDLIFE.panicSec * TICK_RATE;
    if (a.st === 'herded') { a.st = 'wild'; a.by = 0; }
  } else if (SENSE.sd < 1e9 && a.st === 'wild') {
    const d = Math.sqrt(SENSE.sd) || 1;
    a.px = (a.x - SENSE.sx) / d; a.pz = (a.z - SENSE.sz) / d;
    a.shy = tick + 2 * TICK_RATE;
  }
}

// ------------------------------------------------------------------ steering

const LOC = [0, 0];

/** Pen interior point (local rect) for penned animals to mill around. */
function penPoint(st, u, v, out) {
  const def = STRUCTURES[st.type];
  const hw = def.footprint.w * 0.5 - 1.2, hd = def.footprint.d * 0.5 - 1.2;
  const lx = (u * 2 - 1) * hw, lz = (v * 2 - 1) * hd;
  const s = dsin(st.rot), c = dcos(st.rot);
  out[0] = st.x - lx * c + lz * s;
  out[1] = st.z + lx * s + lz * c;
  return out;
}

function step(sim, a, tx, tz, speed, dt) {
  const nav = sim.rt.nav;
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const px = a.x, pz = a.z;
  if (d > 0.05) {
    const s = Math.min(d, speed * dt);
    const nx = a.x + (dx / d) * s, nz = a.z + (dz / d) * s;
    if (isPointPassable(nav, nx, nz)) { a.x = nx; a.z = nz; }
    else if (isPointPassable(nav, nx, a.z)) a.x = nx;
    else if (isPointPassable(nav, a.x, nz)) a.z = nz;
    else { a.tx = a.x; a.tz = a.z; a.wait = 0; } // blocked: choose another spot next time
  }
  a.x = Math.max(4, Math.min(sim.world.width - 4, a.x));
  a.z = Math.max(4, Math.min(sim.world.height - 4, a.z));
  a.vx = a.x - px; a.vz = a.z - pz;
  if (a.vx * a.vx + a.vz * a.vz > 1e-6) a.rot = turnToward(a.rot, datan2(a.vx, a.vz), 4 * dt);
  return d;
}

export function updateWildlife(sim) {
  const { state, rt } = sim;
  const every = WILDLIFE.updateEvery;
  if (state.tick % every !== 0) return;
  const dt = DT * every;
  const rng = state.rng.eco;
  const tick = state.tick;
  for (let i = state.animals.length - 1; i >= 0; i--) {
    const a = state.animals[i];
    const def = SPECIES[a.sp];
    if ((tick + a.id) % 10 < every) sense(sim, a);
    // a Grail soldier touching a panicked / penned animal mauls it
    if ((a.panic > tick || a.st === 'penned') && (tick + a.id) % 10 < every) {
      let mauled = null;
      pointGridQuery(rt.soldierGrid, a.x, a.z, 1.8, (m, sq) => {
        if (!mauled && huntsFlesh(sq.faction) && m.state === 'alive' && unitDef(sq.type).combatUnit) mauled = sq.faction;
      });
      if (mauled) {
        damageAnimal(sim, a, WILDLIFE.grailMaulDps * 0.5, mauled, 'maul');
        if (state.animals[i] !== a) continue;
      }
    }
    let tx = a.tx, tz = a.tz, speed = def.speed;
    if (a.panic > tick && a.st !== 'penned') {
      tx = a.x + a.px * 6; tz = a.z + a.pz * 6; speed = def.flee;
    } else if (a.st === 'herded') {
      const hsq = rt.squadById.get(a.by);
      if (!hsq || !hsq.civ) { a.st = 'wild'; a.by = 0; continue; }
      // follow the drover a couple of metres behind
      const k = (a.id % 5) * 0.7;
      const hd = dsin(hsq.rot), hc = dcos(hsq.rot);
      tx = hsq.cx - hd * (2.5 + k) + hc * ((a.id % 3) - 1) * 1.2;
      tz = hsq.cz - hc * (2.5 + k) - hd * ((a.id % 3) - 1) * 1.2;
      const far = dist(a.x, a.z, tx, tz);
      speed = far > 6 ? Math.min(def.flee, 3.4) : far > 2 ? def.speed * 1.8 : def.speed;
    } else if (a.st === 'penned') {
      const pen = rt.structById.get(a.pen);
      if (!pen) { a.st = 'wild'; a.pen = 0; continue; }
      if (tick >= a.wait || dist(a.x, a.z, a.tx, a.tz) < 0.4) {
        penPoint(pen, rngFloat(rng), rngFloat(rng), LOC);
        a.tx = LOC[0]; a.tz = LOC[1];
        a.wait = tick + Math.round((WILDLIFE.wanderSec[0] + rngFloat(rng) * (WILDLIFE.wanderSec[1] - WILDLIFE.wanderSec[0])) * TICK_RATE);
      }
      tx = a.tx; tz = a.tz;
      speed = a.panic > tick ? def.speed * 2.2 : def.speed * 0.7;
    } else {
      if (a.shy > tick) { tx = a.x + a.px * 3; tz = a.z + a.pz * 3; speed = def.speed * 1.6; }
      else if (tick >= a.wait && dist(a.x, a.z, a.tx, a.tz) < 0.5) {
        const h = habitatDef(sim, a.hab);
        const cx = h ? h.x : a.x, cz = h ? h.z : a.z, r = h ? h.r : 12;
        // herds drift together: sometimes toward a herd-mate, else a random spot of the habitat
        const ang = rngFloat(rng) * TAU, rr = r * 0.8 * Math.sqrt(rngFloat(rng));
        a.tx = cx + dsin(ang) * rr; a.tz = cz + dcos(ang) * rr;
        a.wait = tick + Math.round((WILDLIFE.wanderSec[0] + rngFloat(rng) * (WILDLIFE.wanderSec[1] - WILDLIFE.wanderSec[0])) * TICK_RATE);
      } else if (tick < a.wait && dist(a.x, a.z, a.tx, a.tz) < 0.5) { a.vx = 0; a.vz = 0; continue; } // grazing
      tx = a.tx; tz = a.tz;
    }
    step(sim, a, tx, tz, speed, dt);
  }
  if (tick % 100 === 0) respawn(sim);
}

/** A habitat below its cap slowly gets strays back (never an instant replacement). */
function respawn(sim) {
  const { state } = sim;
  const rng = state.rng.eco;
  for (const hs of state.habitats || []) {
    if (state.tick < hs.next) continue;
    const h = habitatDef(sim, hs.id);
    if (!h) continue;
    let n = 0;
    for (const a of state.animals) if (a.hab === h.id && a.st === 'wild') n++;
    const [lo, hi] = WILDLIFE.respawnSec;
    hs.next = state.tick + Math.round((lo + rngFloat(rng) * (hi - lo)) * TICK_RATE);
    if (n >= h.cap || state.animals.length >= WILDLIFE.maxTotal) continue;
    spawnAnimal(sim, h, pickSpecies(rng, h), false);
  }
}

// ------------------------------------------------------------------ queries for workers

/** Known, living animal nearest to (fx,fz) within r that `faction` may forage (Black Grail). */
export function forageAnimal(sim, faction, fx, fz, r) {
  const bit = sideBit(faction);
  let best = null, bd = r;
  for (const a of sim.state.animals) {
    if (!(a.visibleTo & bit)) continue; // animals move: only what the faction sees right now
    const d = dist(a.x, a.z, fx, fz);
    if (d < bd || (d === bd && best && a.id < best.id)) { bd = d; best = a; }
  }
  return best;
}

/** Free livestock (wild, pen-able species) a drover of `faction` knows about near (fx,fz). */
export function herdableAnimal(sim, faction, fx, fz, r, taken) {
  const bit = sideBit(faction);
  let best = null, bd = r;
  for (const a of sim.state.animals) {
    if (a.st !== 'wild' || !SPECIES[a.sp].livestock || !(a.seenBy & bit) || a.panic > sim.state.tick) continue;
    if (taken && taken.has(a.id)) continue;
    const d = dist(a.x, a.z, fx, fz);
    if (d < bd || (d === bd && best && a.id < best.id)) { bd = d; best = a; }
  }
  return best;
}

export function pennedCount(state, penId) {
  let n = 0;
  for (const a of state.animals) if (a.st === 'penned' && a.pen === penId) n++;
  return n;
}

export function penFoodRate(state, penId) {
  let r = 0;
  for (const a of state.animals) if (a.st === 'penned' && a.pen === penId) r += SPECIES[a.sp].foodRate;
  return r;
}

/** Emergency slaughter: half the pen (at least one) becomes food now; the herd's future yield drops. */
export function slaughterPen(sim, pen, fid) {
  const { state } = sim;
  // EMERGENCY: the whole herd — food now, nothing left for the Grail to take
  const list = state.animals.filter((a) => a.st === 'penned' && a.pen === pen.id).sort((a, b) => a.id - b.id);
  let food = 0, k = 0;
  for (const a of list) {
    food += SPECIES[a.sp].food;
    killAnimal(sim, a, fid, 'slaughter');
    k++;
  }
  state.factions[fid].resources.food = (state.factions[fid].resources.food || 0) + food;
  return { killed: k, food };
}

/** A pen is lost: its animals scatter back into the wild (nearest habitat takes them). */
export function releasePen(sim, penId) {
  for (const a of sim.state.animals) {
    if (a.pen !== penId) continue;
    a.st = 'wild'; a.pen = 0;
    a.panic = sim.state.tick + WILDLIFE.panicSec * TICK_RATE;
    a.px = dsin(a.rot); a.pz = dcos(a.rot);
  }
}
