// Scenario setup (Phase 5A: side / role generic).
//  1. each SIDE's starting package (data/packages.js: faction + role), authored for one region and
//     moved into the side's start region (sides.js placeInRegion) — slot order, deterministic ids
//  2. the map's neutral structures (old trenches / wire), resource nodes, older battles' dead
//  3. forces: the package's (from the region's generic anchors), or the scenario's by ROLE
//     (gallery), or the stress generator (by content faction data, per side)
//  4. objectives: the scenario names them by ROLE ("defenderPrimaryObjective"); the side holding
//     that role marks its package's primary HQ as the objective — whatever its faction
import { addRuinGarrisons } from '../units/garrison.js';
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { sideDef } from '../data/factions.js';
import { startingPackage } from '../data/packages.js';
import { PI } from '../core/dmath.js';
import { createSquad, createStructure, createNode } from './state.js';
import { addOldCorpse } from './corpses.js';
import { chooseFront } from '../construction/trench.js';
import { placeInRegion, sideFacing, sideAnchors } from './sides.js';

function addSquad(sim, fid, unit, x, z, rot) {
  const sq = createSquad(sim.state, fid, unit, x, z, rot);
  sim.state.squads.push(sq);
  return sq;
}

/** Facing of a side's troops: toward the enemy from its start region. */
function facingFor(sim, fid) {
  return sideFacing(sim, fid);
}

function placeForces(sim, fid, forces) {
  const anchors = sideAnchors(sim, fid);
  const all = sim.world.anchors || {};
  const rot = facingFor(sim, fid);
  const back = Math.abs(rot - PI) < 1e-6 ? 1 : -1; // extra rows go away from the enemy
  for (const f of forces) {
    const pts = anchors[f.anchor] || all[f.anchor] || [[sim.world.width / 2, sim.world.height / 2]];
    for (let i = 0; i < f.count; i++) {
      const p = pts[i % pts.length];
      const ring = Math.floor(i / pts.length);
      addSquad(sim, fid, f.unit, p[0] + (ring % 2 ? 6 : 0), p[1] + back * ring * 14, rot);
    }
  }
}

/** Stress composition of one side from its faction data (FACTIONS[x].stress), `half` soldiers. */
function stressList(fid, half) {
  const spec = sideDef(fid).stress;
  const list = [];
  let n = 0;
  for (const e of spec.fixed || []) {
    const cnt = Math.max(1, Math.floor(half / e.per));
    const size = unitDef(e.unit).squadSize;
    for (let i = 0; i < cnt; i++) { list.push(e.unit); n += size; }
  }
  const fs = unitDef(spec.fill).squadSize;
  while (n + fs <= half + 4) { list.push(spec.fill); n += fs; }
  if (spec.tail) {
    const ts = unitDef(spec.tail).squadSize;
    if (n + ts <= half) { list.push(spec.tail); n += ts; }
  }
  return list;
}

export function buildStressForces(sim, soldiers) {
  const half = Math.round(soldiers / 2);
  const W = sim.world.width;
  const cz = sim.scenario.stress.centerZ;
  const lay = (fid, list, z, dir) => {
    const perRow = Math.max(1, Math.min(10, Math.ceil(list.length / Math.ceil(list.length / 10))));
    list.forEach((unit, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const cnt = Math.min(perRow, list.length - row * perRow);
      const x = W / 2 + (col - (cnt - 1) / 2) * 19;
      addSquad(sim, fid, unit, Math.max(30, Math.min(W - 30, x)), z + dir * row * 16, dir > 0 ? PI : 0);
    });
  };
  // each side on its own half of the stress line (south region below the centre, north above);
  // build every list first, then lay them in the classic order (southern side first)
  const plans = sim.state.sides.map((sd) => {
    const south = sim.state.factions[sd.id].region === 'south';
    return { id: sd.id, list: stressList(sd.id, half), z: south ? cz + 36 : cz - 40, dir: south ? 1 : -1, south };
  });
  plans.sort((a, b) => (a.south === b.south ? 0 : a.south ? -1 : 1));
  for (const p of plans) lay(p.id, p.list, p.z, p.dir);
}

function addStructure(sim, owner, sd, extra) {
  const { state } = sim;
  const def = STRUCTURES[sd.type];
  let s;
  if (def.kind === 'linear') {
    // the protected side faces the enemy: a side's front is its facing; neutral relics face north
    const rot = sideDef(owner) ? facingFor(sim, owner) : PI;
    const towardZ = Math.abs(rot - PI) < 1e-6 ? -1 : 1;
    const front = chooseFront(sd.x1, sd.z1, sd.x2, sd.z2, 0, towardZ);
    s = createStructure(state, sd.type, owner, {
      x1: sd.x1, z1: sd.z1, x2: sd.x2, z2: sd.z2, front,
      built: true, progress: sd.progress !== undefined ? sd.progress : 1, variant: sd.variant,
    });
    if (sd.variant === 'old') s.hp = Math.round(s.maxHp * 0.6);
  } else {
    s = createStructure(state, sd.type, owner, {
      x: sd.x, z: sd.z, rot: sd.rot || 0, built: true, objective: !!extra.objective,
      quickSlot: sd.quickSlot,
    });
  }
  state.structures.push(s);
  return s;
}

export function setupScenario(sim, scenario) {
  const { state, world } = sim;
  // roles whose PRIMARY HQ is a scenario objective (e.g. siege: 'defender')
  const objRoles = {};
  for (const o of scenario.objectives || []) if (o.type === 'primary_hq') objRoles[o.owner] = o.id;
  const packages = {};
  for (const sd of state.sides) {
    const pkg = startingPackage(sd.faction, sd.role);
    packages[sd.id] = pkg;
    for (const item of pkg.structures) {
      const p = placeInRegion(world, item, pkg.authored, sd.region);
      addStructure(sim, sd.id, p, { objective: !!item.primary && !!objRoles[sd.role] });
    }
  }
  for (const sd of world.map.structures) addStructure(sim, sd.faction, sd, {});
  // Scenario features are authored by ROLE, optionally gated by the faction holding that role.
  // They are battlefield rules, never normal faction build-list entries (e.g. an Iron Wall sector).
  for (const feature of scenario.features || []) {
    if (!feature || feature.kind !== 'structure_group') continue;
    const holder = state.sides.find((s) => s.role === feature.owner);
    if (!holder || (feature.requiresFaction && holder.faction !== feature.requiresFaction)) continue;
    const region = state.factions[holder.id].region;
    for (const item of feature.items || []) {
      const p = placeInRegion(world, item, feature.authored || region, region);
      addStructure(sim, holder.id, p, {});
    }
  }
  for (const nd of world.map.nodes) state.nodes.push(createNode(state, nd.type, nd.x, nd.z, nd.amount));
  // bodies of older battles (low-value biomass; they never rise and never decay) — not in the
  // pure battle benchmark (stress), which stays comparable between phases
  if (scenario.mode !== 'stress') for (const d of world.oldDead || []) addOldCorpse(state, sim.rt, d.x, d.z, d.rot);
  if (scenario.mode === 'stress') {
    buildStressForces(sim, state.settings.stressSoldiers || scenario.stress.soldiers);
  } else {
    for (const sd of state.sides) {
      if (scenario.packageForces !== false) placeForces(sim, sd.id, packages[sd.id].forces);
      const byRole = scenario.forces && scenario.forces[sd.role];
      if (byRole) placeForces(sim, sd.id, byRole);
    }
  }
  // Phase 4: ruin garrisons (neutral, created last so earlier ids stay as they were); the pure
  // battle benchmark (stress) stays comparable between phases without them
  if (scenario.mode !== 'stress') addRuinGarrisons(sim);
  // objectives by side (plain data: which structure, whose, which role)
  for (const s of state.structures) {
    if (!s.objective) continue;
    const f = state.factions[s.faction];
    state.objectives.push({
      id: objRoles[f.role] || 'objective', type: scenario.victory || 'siege', structureId: s.id,
      side: s.faction, role: f.role,
    });
  }
  // sanity: every unit def referenced exists
  for (const sq of state.squads) unitDef(sq.type);
}
