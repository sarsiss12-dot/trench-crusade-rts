// Scenario setup: map-placed structures & resource nodes, starting forces at map anchors,
// objectives, and the development stress-test force generator.
import { addRuinGarrisons } from '../units/garrison.js';
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { PI } from '../core/dmath.js';
import { createSquad, createStructure, createNode } from './state.js';
import { addOldCorpse } from './corpses.js';
import { chooseFront } from '../construction/trench.js';
import { factionByRole } from './match.js';

function facingFor(fid, sim) {
  // defenders face north (toward the attacker), attackers face south
  const role = sim.state.factions[fid].role;
  return role === 'defender' ? PI : 0;
}

function addSquad(sim, fid, unit, x, z, rot) {
  const sq = createSquad(sim.state, fid, unit, x, z, rot);
  sim.state.squads.push(sq);
  return sq;
}

function placeForces(sim, fid, forces) {
  const anchors = sim.world.anchors;
  const rot = facingFor(fid, sim);
  const back = rot === PI ? 1 : -1; // extra rows go away from the enemy
  for (const f of forces) {
    const pts = anchors[f.anchor] || [[sim.world.width / 2, sim.world.height / 2]];
    for (let i = 0; i < f.count; i++) {
      const p = pts[i % pts.length];
      const ring = Math.floor(i / pts.length);
      addSquad(sim, fid, f.unit, p[0] + (ring % 2 ? 6 : 0), p[1] + back * ring * 14, rot);
    }
  }
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
  // New Antioch
  const na = [];
  let n = 0;
  const heavies = Math.max(1, Math.floor(half / 80));
  for (let i = 0; i < heavies; i++) { na.push('mech_heavy'); n += 3; }
  while (n + 8 <= half + 4) { na.push('yeoman_rifle'); n += 8; }
  // Black Grail
  const bg = [];
  let m = 0;
  const knights = Math.max(1, Math.floor(half / 60));
  const guards = Math.max(1, Math.floor(half / 45));
  for (let i = 0; i < knights; i++) { bg.push('plague_knight'); m += 3; }
  for (let i = 0; i < guards; i++) { bg.push('corpse_guard'); m += 4; }
  const tn = unitDef('grail_thrall').squadSize;
  while (m + tn <= half + 4) { bg.push('grail_thrall'); m += tn; }
  if (m + 4 <= half) { bg.push('corpse_guard'); m += 4; }
  lay('new_antioch', na, cz + 36, 1);
  lay('black_grail', bg, cz - 40, -1);
}

export function setupScenario(sim, scenario) {
  const { state, world } = sim;
  for (const sd of world.map.structures) {
    const def = STRUCTURES[sd.type];
    let s;
    if (def.kind === 'linear') {
      const towardZ = sd.faction === 'black_grail' ? 1 : -1;
      const front = chooseFront(sd.x1, sd.z1, sd.x2, sd.z2, 0, towardZ);
      s = createStructure(state, sd.type, sd.faction, {
        x1: sd.x1, z1: sd.z1, x2: sd.x2, z2: sd.z2, front,
        built: true, progress: sd.progress !== undefined ? sd.progress : 1, variant: sd.variant,
      });
      if (sd.variant === 'old') s.hp = Math.round(s.maxHp * 0.6);
    } else {
      s = createStructure(state, sd.type, sd.faction, {
        x: sd.x, z: sd.z, rot: sd.rot || 0, built: true,
        objective: !!sd.objective && scenario.objective && scenario.objective.structureType === sd.type,
      });
    }
    state.structures.push(s);
  }
  for (const nd of world.map.nodes) state.nodes.push(createNode(state, nd.type, nd.x, nd.z, nd.amount));
  // bodies of older battles (low-value biomass; they never rise and never decay) — not in the
  // pure battle benchmark (stress), which stays comparable between phases
  if (scenario.mode !== 'stress') for (const d of world.oldDead || []) addOldCorpse(state, sim.rt, d.x, d.z, d.rot);
  if (scenario.mode === 'stress') {
    buildStressForces(sim, state.settings.stressSoldiers || scenario.stress.soldiers);
  } else {
    for (const fid in scenario.forces) placeForces(sim, fid, scenario.forces[fid]);
  }
  // Phase 4: ruin garrisons (neutral, created last so earlier ids stay as they were); the pure
  // battle benchmark (stress) stays comparable between phases without them
  if (scenario.mode !== 'stress') addRuinGarrisons(sim);
  const obj = state.structures.find((s) => s.objective);
  if (obj) {
    state.objectives.push({
      type: 'siege', structureId: obj.id,
      defender: factionByRole(state, 'defender'), attacker: factionByRole(state, 'attacker'),
    });
  }
  // sanity: every unit def referenced exists
  for (const sq of state.squads) unitDef(sq.type);
}
