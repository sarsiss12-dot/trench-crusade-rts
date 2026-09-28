// EFFECT RANGE VISUALIZATION (Phase 4.1, presentation only). One reusable module draws what an
// effect reaches, only on SELECTION / PLACEMENT / INSPECTION (never permanently, never for every
// unit on the field):
//  - support aura (elites): thin ring + barely-there fill           (decal shape 13)
//  - processing area (corpse mound, altar / pit, consecrated ground): ring + light fill (14)
//  - firing arc (field gun / pillbox / MG post): cone from the minimum range out (15)
//  - detection (vision of a lookout): fainter dashed ring            (16)
// plus the WORLD-SPACE CORPSE STATE badges (17) — batched ground decals, no DOM — and the corpse
// mound placement preview (which bodies inside the 22 m processing area are usable).
// Everything goes through the viewer's perception: enemy auras only for squads the viewer sees,
// corpse information per sim/corpse_view.js (Grail: precise; others: limited, in sight only).
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { WEAPONS } from '../data/weapons.js';
import { EMPLACEMENT_WEAPONS } from '../data/emplacements.js';
import { isSquadVisibleTo } from '../sim/perception.js';
import { specValue } from '../sim/specialities.js';
import { corpseView, moundPreview } from '../sim/corpse_view.js';

export const RS = { AURA: 13, PROCESS: 14, ARC: 15, DETECT: 16, CORPSE: 17 };

const AURA_COL = {
  command: [0.95, 0.8, 0.42], sanctified: [0.96, 0.9, 0.68], tumour: [0.6, 0.72, 0.28], fly: [0.46, 0.58, 0.22],
};
const PROCESS_COL = [0.72, 0.62, 0.38];
const INFECT_COL = [0.5, 0.66, 0.2];
const CONSECRATE_COL = [0.95, 0.88, 0.6];
const ARC_COL = [0.95, 0.72, 0.38];
const DETECT_COL = [0.7, 0.8, 0.9];
const CORPSE_COL = {
  infected: [0.55, 0.75, 0.25], scheduled: [0.8, 0.85, 0.3], gathering: [0.8, 0.85, 0.3], turn: [0.92, 0.32, 0.2],
  purified: [0.96, 0.9, 0.62], risk: [0.95, 0.62, 0.2], imminent: [0.95, 0.25, 0.16],
};
const CORPSE_KIND = { infected: 1, scheduled: 2, gathering: 2, turn: 3, purified: 4, risk: 5, imminent: 6 };
const URGENT = { scheduled: 1, gathering: 1, turn: 1, imminent: 1 };
const MAX_CORPSE_BADGES = 64;

/** Firing geometry of a structure type: { range, min, half (rad) } or null. */
export function firingArcOf(stype) {
  const d = STRUCTURES[stype];
  if (!d) return null;
  const w = d.emplacement ? EMPLACEMENT_WEAPONS[d.emplacement] : d.weapon ? WEAPONS[d.weapon] : null;
  if (!w) return null;
  const arc = d.arc || 360;
  return { range: w.range, min: w.minRange || 0, half: Math.min(Math.PI, (arc * Math.PI) / 360) };
}

/** Processing / effect radius of a structure type for a faction (0 when none). */
export function processRadiusOf(sim, stype, fid) {
  const d = STRUCTURES[stype];
  if (!d) return 0;
  if (d.harvestRadius) return d.harvestRadius * specValue(sim.state, fid, 'moundHarvest', 1);
  return 0;
}

export function createRangeViz() {
  const badges = []; // reused scratch

  /** Ranges of one structure (selected, or a placement ghost at x,z,rot). */
  function structureRanges(api, sim, stype, fid, x, z, rot, alpha) {
    const { mark, ground } = api;
    const d = STRUCTURES[stype];
    const y = ground(x, z);
    const pr = processRadiusOf(sim, stype, fid);
    if (pr) mark(x, z, y, pr, 0, PROCESS_COL[0], PROCESS_COL[1], PROCESS_COL[2], 0.85 * alpha, RS.PROCESS, 0, 0, 1, 0.12);
    if (d.infectionSource) {
      const r = d.infectionSource.radius * (stype === 'plague_pit' ? specValue(sim.state, fid, 'pitRadius', 1) : 1);
      mark(x, z, y, r, 0, INFECT_COL[0], INFECT_COL[1], INFECT_COL[2], 0.7 * alpha, RS.PROCESS, 0, 0, 1, 0.12);
    }
    const fa = firingArcOf(stype);
    if (fa) mark(x, z, y, fa.range, rot || 0, ARC_COL[0], ARC_COL[1], ARC_COL[2], 0.8 * alpha, RS.ARC, fa.half, fa.min / fa.range, 1, 0.14);
    if (d.vision >= 60 && !fa) mark(x, z, y, d.vision, 0, DETECT_COL[0], DETECT_COL[1], DETECT_COL[2], 0.55 * alpha, RS.DETECT, 0, 0, 1, 0.1);
  }

  /** Auras / reach of a selected squad (elites). */
  function squadRanges(api, sim, sq, t) {
    const { mark, ground } = api;
    const def = unitDef(sq.type);
    const x = sq.cx, z = sq.cz, y = ground(x, z);
    const a = def.aura;
    if (a && a.radius) {
      const col = AURA_COL[a.kind] || AURA_COL.command;
      mark(x, z, y, a.radius, 0, col[0], col[1], col[2], 0.8, RS.AURA, 0, 0, 1, 0.1);
      if (a.consecrate) mark(x, z, y, a.consecrate, t * 0.1, CONSECRATE_COL[0], CONSECRATE_COL[1], CONSECRATE_COL[2], 0.45, RS.PROCESS, 0, 0, 1, 0.1);
    }
    if (def.marksman) {
      const w = WEAPONS[def.weapon];
      if (w) mark(x, z, y, w.range, 0, DETECT_COL[0], DETECT_COL[1], DETECT_COL[2], 0.6, RS.DETECT, 0, 0, 1, 0.1);
    }
  }

  function corpseBadges(api, sim, viewer, camera, t, preview) {
    const { mark, ground, zoomK } = api;
    const near = camera.dist < 80;
    badges.length = 0;
    const R2 = Math.pow(Math.max(90, camera.dist * 1.6), 2);
    for (const c of sim.state.corpses) {
      if (!c.infected && !c.blessed) continue;
      const dx = c.x - camera.tx, dz = c.z - camera.tz;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      const v = corpseView(sim, viewer, c);
      if (!v) continue;
      if (!URGENT[v.st] && !near && !preview) continue; // no spam at strategic zoom
      badges.push({ c, v, d2: URGENT[v.st] ? d2 * 0.25 : d2 });
    }
    badges.sort((a, b) => a.d2 - b.d2 || a.c.id - b.c.id);
    const n = Math.min(MAX_CORPSE_BADGES, badges.length);
    const size = Math.min(1.8, 0.75 * zoomK);
    for (let i = 0; i < n; i++) {
      const { c, v } = badges[i];
      const col = CORPSE_COL[v.st];
      const pulse = v.st === 'imminent' || (v.st === 'turn' && v.p > 0.8) ? 0.7 + 0.3 * Math.sin(t * 9) : 1;
      mark(c.x, c.z, ground(c.x, c.z), size, 0, col[0], col[1], col[2], 0.95 * pulse, RS.CORPSE, CORPSE_KIND[v.st], v.p, 1, 0.3);
    }
    return n;
  }

  /**
   * Draw for this frame. api: { mark, ground, zoomK }. frame: selection (Set of squad ids),
   * selectedStruct (known structure or null), placement ({ stype, params, valid }) or null.
   * Returns a small summary for the HUD (mound preview counts).
   */
  function draw(api, sim, frame, viewer, camera, t, sst) {
    const { mark, ground } = api;
    const out = { preview: null, badges: 0 };
    const sel = frame.selection;
    if (sel && sel.size) {
      for (const id of sel) {
        const sq = sim.rt.squadById.get(id);
        if (!sq || !isSquadVisibleTo(sq, viewer)) continue;
        const def = unitDef(sq.type);
        if (def.aura || def.marksman) squadRanges(api, sim, sq, t);
      }
    }
    if (sst && sst.faction === viewer) structureRanges(api, sim, sst.type, viewer, sst.x, sst.z, sst.rot, 1);
    const pl = frame.placement;
    let preview = false;
    if (pl && pl.params && STRUCTURES[pl.stype] && STRUCTURES[pl.stype].kind !== 'linear') {
      const p = pl.params;
      structureRanges(api, sim, pl.stype, viewer, p.x, p.z, p.rot || 0, pl.valid ? 1 : 0.6);
      const pr = processRadiusOf(sim, pl.stype, viewer);
      if (pr && STRUCTURES[pl.stype].harvestRadius) {
        preview = true;
        const mp = moundPreview(sim, viewer, p.x, p.z, pr);
        // usable bodies get a check mark; infected ones (reserved for rising) show their state badge
        for (const it of mp.list) if (it.ok) mark(it.c.x, it.c.z, ground(it.c.x, it.c.z), 0.9, 0, 0.62, 0.86, 0.4, 0.95, RS.CORPSE, 7, 0, 1, 0.3);
        out.preview = { usable: mp.usable, infected: mp.infected, r: pr };
      }
    }
    // a selected own corpse mound: the same bodies-in-reach view
    if (!preview && sst && sst.faction === viewer && STRUCTURES[sst.type].harvestRadius) {
      preview = true;
      const mp = moundPreview(sim, viewer, sst.x, sst.z, processRadiusOf(sim, sst.type, viewer));
      for (const it of mp.list) if (it.ok) mark(it.c.x, it.c.z, ground(it.c.x, it.c.z), 0.8, 0, 0.62, 0.86, 0.4, 0.85, RS.CORPSE, 7, 0, 1, 0.3);
    }
    out.badges = corpseBadges(api, sim, viewer, camera, t, preview);
    return out;
  }

  return { draw };
}
