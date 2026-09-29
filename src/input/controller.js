// Input controller: binds DOM pointer / wheel / keyboard events to the gesture recognizer and maps
// gestures to camera moves, selection and player actions. Touch-first: every action is reachable
// with taps (no right-click assumption); mouse + keyboard add shortcuts on desktop.
// Interaction modes: normal | place (construction) | ability | rally | repair | gather | attackMove.
import { sideFacing } from '../sim/sides.js';
import { baseFaction } from '../data/factions.js';
import { createGestures } from './gestures.js';
import { pickSquad, pickStructure, pickNodeAt, boxSelect, squadsOfTypeOnScreen } from './pick.js';
import { allCombatSquadIds, squadIdsWithRole, completeAreaSelect } from './selection.js';
import { corpseView } from '../sim/corpse_view.js';
import { pickGround, panCamera, zoomAt, cameraPitch, worldPerPixel } from '../render/camera.js';
import { STRUCTURES } from '../data/structures.js';
import { ABILITIES } from '../data/abilities.js';
import { unitDef } from '../data/units.js';
import { PLAYER_FORMATIONS } from '../units/formation.js';
import { snapToTrenchEndpoint } from '../construction/trench.js';
import { isPointVisibleTo } from '../sim/perception.js';
import { specValue } from '../sim/specialities.js';
import { ENGINEERING } from '../data/economy.js';

// area commands (Phase 3): radius shown while choosing the spot (the simulation owns the rule)
const AREA_R = { forage: 34, sanitize: 16, salvage: ENGINEERING.salvageAreaR };

const TAP_RADIUS_CSS = 26;
const G = [0, 0, 0];

export function createInputController(canvas, game) {
  const cam = game.camera;
  const sim = game.session.sim;
  const viewer = game.session.viewer;
  const keys = new Set();
  const ui = game.ui; // shared UI toggles { areaSelect (one-shot), multiSelect (sticky), attackMove }
  let pxScale = 1; // device px per CSS px

  const ground = (x, z) => game.renderer.groundAt(x, z);
  const known = () => game.renderer.knownStructures();

  function groundAt(sx, sy) {
    return pickGround(cam, sx, sy, G) ? G : null;
  }

  /** A body in sight near (x,z) for Grail work gangs (bodies out of sight are never picked). */
  function pickCorpse(x, z) {
    if (!game.selection.ownSquads(sim, viewer).some((sq) => unitDef(sq.type).gathers === 'corpse')) return null;
    let best = null, bd = 4; // Phase 4.1: generous for fingers
    for (const c of sim.state.corpses) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd && isPointVisibleTo(sim, viewer, c.x, c.z)) { bd = d; best = c; }
    }
    return best;
  }

  function hasCapability(role) {
    return game.selection.ownSquads(sim, viewer).some((sq) => unitDef(sq.type).roles.indexOf(role) >= 0);
  }

  // ------------------------------------------------------------------ modes
  function setMode(m) {
    game.mode = m || { kind: 'normal' };
    game.frame.placement = null;
    game.frame.abilityTarget = null;
    game.frame.areaTarget = null;
    if (game.hud) game.hud.onModeChanged();
  }

  /** Area commands: forage (Grail gangs), sanitize (engineers), herd area (a selected pen). */
  function startArea(kind, st) {
    let radius = AREA_R[kind] || 20;
    if (kind === 'forage') radius *= specValue(sim.state, viewer, 'forageRadius', 1);
    if (kind === 'herd' && st) radius = STRUCTURES[st.type].pen ? STRUCTURES[st.type].pen.herdRadius : radius;
    setMode({ kind: 'area', area: kind, sid: st ? st.id : 0, radius });
  }

  function updateAreaTarget(sx, sy) {
    const m = game.mode;
    const g = groundAt(sx, sy);
    if (!g) return;
    let valid = true;
    if (m.area === 'herd') {
      const st = sim.rt.structById.get(m.sid);
      valid = !!st && Math.hypot(st.x - g[0], st.z - g[2]) <= 160;
    }
    game.frame.areaTarget = { kind: m.area, x: g[0], z: g[2], r: m.radius, valid };
  }

  function startPlacement(stype) {
    const def = STRUCTURES[stype];
    if (!def || !def.buildable || def.builder !== baseFaction(viewer)) return;
    const linear = def.kind === 'linear';
    setMode({
      kind: 'place', stype, linear, p1: null, p2: null,
      x: cam.tx, z: cam.tz, rot: sideFacing(game.session.sim, viewer), // toward the enemy from the side's region
      pinned: false, valid: false, reason: '', drawing: false,
    });
    if (!linear) updatePlacement();
  }

  function clampLinear(def, p1, x, z, out) {
    const dx = x - p1[0], dz = z - p1[1];
    const len = Math.hypot(dx, dz);
    if (len > def.maxLen) { out[0] = p1[0] + (dx / len) * def.maxLen; out[1] = p1[1] + (dz / len) * def.maxLen; }
    else { out[0] = x; out[1] = z; }
    return out;
  }

  /** Re-lay an existing limited-arc gun: the placement flow without moving it (Phase 4.1). */
  function startReorient(st) {
    if (!st || st.faction !== viewer) return;
    setMode({ kind: 'place', stype: st.type, linear: false, reorient: st.id, x: st.x, z: st.z, rot: st.rot || 0, pinned: true, valid: true, reason: '', drawing: false });
    updatePlacement();
  }

  function updatePlacement() {
    const m = game.mode;
    if (m.kind !== 'place') return;
    const def = STRUCTURES[m.stype];
    if (m.reorient) {
      m.valid = true; m.reason = ''; m.cost = def.relay ? { material: def.relay.material } : null;
      game.frame.placement = { stype: m.stype, valid: true, params: { x: m.x, z: m.z, rot: m.rot }, reorient: m.reorient };
      if (game.hud) game.hud.onModeChanged();
      return;
    }
    if (!m.linear && m.hidden) { game.frame.placement = null; if (game.hud) game.hud.onModeChanged(); return; }
    if (m.linear) {
      if (!m.p1) { game.frame.placement = null; return; }
      const p2 = m.p2 || m.hover;
      if (!p2) {
        game.frame.placement = null;
        return;
      }
      const raw = { x1: m.p1[0], z1: m.p1[1], x2: p2[0], z2: p2[1] };
      const v = game.actions.validate(m.stype, raw);
      m.valid = v.ok;
      m.reason = v.ok ? '' : v.reason;
      m.cost = v.cost || null;
      m.len = Math.hypot(raw.x2 - raw.x1, raw.z2 - raw.z1);
      game.frame.placement = { stype: m.stype, valid: v.ok, params: v.ok ? v.params : { ...raw, front: 1 } };
    } else {
      const raw = { x: m.x, z: m.z, rot: m.rot };
      const v = game.actions.validate(m.stype, raw);
      m.valid = v.ok;
      m.reason = v.ok ? '' : v.reason;
      m.cost = v.cost || def.cost;
      game.frame.placement = { stype: m.stype, valid: v.ok, params: raw };
    }
    if (game.hud) game.hud.onModeChanged();
  }

  function placementPoint(sx, sy, isEnd) {
    const m = game.mode;
    const g = groundAt(sx, sy);
    if (!g) return;
    const def = STRUCTURES[m.stype];
    if (m.linear) {
      // tapping far from the pending start point restarts the line there
      const restart = m.p1 && !m.p2 && Math.hypot(g[0] - m.p1[0], g[2] - m.p1[1]) > def.maxLen * 1.6;
      if (!m.p1 || !isEnd || restart) {
        const s = m.stype === 'trench' ? snapToTrenchEndpoint(sim.state.structures, viewer, g[0], g[2], 2.5) : null;
        m.p1 = s ? [s[0], s[1]] : [g[0], g[2]];
        m.p2 = null;
      } else {
        m.p2 = clampLinear(def, m.p1, g[0], g[2], [0, 0]);
      }
    } else if (m.reorient) {
      // re-laying: a tap turns the gun toward the tapped point (it never moves)
      if (Math.hypot(g[0] - m.x, g[2] - m.z) > 2) m.rot = Math.atan2(g[0] - m.x, g[2] - m.z);
    } else {
      // tap PINS the ghost there; a drag on / around it then turns it (placement rotation)
      m.x = g[0]; m.z = g[2];
      m.pinned = true;
      m.hidden = false;
    }
    updatePlacement();
  }

  /** ✕ in build mode: drop this spot but stay in BUILD MODE (a second ✕ leaves it). */
  function cancelSpot() {
    const m = game.mode;
    if (m.kind !== 'place' || m.reorient) { setMode(null); return; }
    if (m.linear) {
      if (!m.p1) { setMode(null); return; }
      m.p1 = null; m.p2 = null; m.hover = null;
    } else {
      if (!m.pinned && m.hidden) { setMode(null); return; }
      m.pinned = false;
      m.hidden = true; // touch: the next tap places a new ghost (mouse: it follows the pointer)
    }
    updatePlacement();
  }

  /** Radius around a pinned ghost in which a drag turns it (generous for fingers). */
  function rotateGrab(def) {
    return Math.max(def.footprint.w, def.footprint.d) * 0.8 + 9;
  }

  function confirmPlacement() {
    const m = game.mode;
    if (m.kind !== 'place') return false;
    if (m.linear && (!m.p1 || !m.p2)) return false;
    if (m.reorient) {
      const st = sim.rt.structById.get(m.reorient);
      if (st) game.actions.reorient(st, m.rot);
      setMode(null);
      return true;
    }
    if (!m.linear && m.hidden) return false;
    const params = m.linear ? { x1: m.p1[0], z1: m.p1[1], x2: m.p2[0], z2: m.p2[1] } : { x: m.x, z: m.z, rot: m.rot };
    const ok = game.actions.build(m.stype, params);
    if (!ok) return false;
    if (m.linear) {
      // chain: the next segment starts where this one ended
      m.p1 = [m.p2[0], m.p2[1]];
      m.p2 = null;
      m.hover = null;
      updatePlacement();
    } else setMode(null);
    return true;
  }

  function rotatePlacement() {
    const m = game.mode;
    if (m.kind !== 'place' || m.linear) return;
    m.rot = (m.rot + Math.PI / 4) % (Math.PI * 2);
    updatePlacement();
  }

  function startAbility(id) {
    const def = ABILITIES[id];
    if (!def) return;
    setMode({ kind: 'ability', id, radius: def.radius });
  }

  function updateAbilityTarget(sx, sy) {
    const m = game.mode;
    const g = groundAt(sx, sy);
    if (!g) return;
    const why = game.actions.abilityCheck(m.id, g[0], g[2]);
    game.frame.abilityTarget = { x: g[0], z: g[2], radius: m.radius, valid: !why };
  }

  // ------------------------------------------------------------------ taps
  /** Resource heap under a tap: generous for fingers (Phase 4 mobile salvage UX). */
  function nodeAt(sx, sy, gx, gz, info, wide) {
    const touch = !info || info.type !== 'mouse';
    return pickNodeAt(sim, viewer, cam, ground, sx, sy, gx, gz, touch || wide, pxScale, game.settings.touchAssist);
  }

  function radiusPx() {
    return TAP_RADIUS_CSS * pxScale * (game.settings.touchAssist ? 1.3 : 1);
  }

  function selectSquads(ids, additive) {
    if (additive) game.selection.add(ids);
    else game.selection.set(ids);
    if (game.audio) game.audio.ui('select');
  }

  function normalTap(sx, sy, info) {
    const own = game.selection.ownSquads(sim, viewer);
    const additive = info.shift || info.ctrl || ui.multiSelect;
    const hit = pickSquad(sim, viewer, cam, ground, sx, sy, radiusPx());
    if (hit) {
      const sq = hit.sq;
      if (sq.faction === viewer) {
        game.selection.tapOwn(sq.id, additive);
        if (game.audio) game.audio.ui('select');
      } else if (own.length && !ui.inspect) {
        game.actions.attack('squad', sq.id, sq.cx, sq.cz);
        ui.attackMove = false;
      } else selectSquads([sq.id], false);
      return;
    }
    const g = groundAt(sx, sy);
    if (!g) return;
    const gx = g[0], gz = g[2];
    const st = pickStructure(sim, viewer, gx, gz, 0.8, null, known());
    if (st) {
      const def = STRUCTURES[st.type];
      if (st.faction === viewer) {
        if (own.length) {
          const needsWork = !st.built || st.hp < st.maxHp;
          if (needsWork && (hasCapability('builder') || hasCapability('repairer')) && game.actions.assist(st)) return;
          if (st.type === 'trench' && game.actions.enterTrench(st.id, gx, gz)) return;
          if (def.kind === 'linear') { game.actions.moveTo(gx, gz, ui.attackMove); ui.attackMove = false; return; }
        }
        game.selection.setStruct(st.id);
        if (game.audio) game.audio.ui('select');
        return;
      }
      if (st.faction === 'neutral') {
        if (own.length) {
          if (st.type === 'trench' && game.actions.enterTrench(st.id, gx, gz)) return;
          if (def.garrison) {
            // a ruin: line squads garrison it, engineers repair it, others just walk there
            if (game.actions.garrison(st)) return;
            if (hasCapability('repairer') && st.hp < st.maxHp && !st.collapsed && game.actions.assist(st)) return;
          }
          game.actions.moveTo(gx, gz, ui.attackMove);
          ui.attackMove = false;
          return;
        }
        game.selection.setStruct(st.id);
        return;
      }
      if (own.length) {
        // out of sight: advance on the remembered spot — the same whether or not it still stands,
        // so a tap can never test the fog; in sight: attack it
        if (st.memory) game.actions.moveTo(st.x, st.z, true);
        else game.actions.attack('struct', st.id, st.x, st.z);
        return;
      }
      game.selection.setStruct(st.id);
      if (game.audio) game.audio.ui('select');
      return;
    }
    const body = own.length ? pickCorpse(gx, gz) : null;
    if (body) { game.actions.haul(body); return; }
    const node = own.length && hasCapability('gatherer') ? nodeAt(sx, sy, gx, gz, info) : null;
    if (node) { game.actions.gather(node); return; }
    if (own.length) {
      game.actions.moveTo(gx, gz, ui.attackMove);
      ui.attackMove = false;
      if (game.hud) game.hud.onModeChanged();
      return;
    }
    if (!additive) game.selection.clear();
    // Phase 4.1: a tap on a body with nothing selected tells what the viewer knows about it
    // (Grail: state + seconds to rise; others: only the coarse risk) — sim/corpse_view.js
    const cinfo = corpseInfoAt(gx, gz);
    if (cinfo && game.notify) game.notify(cinfo.key, cinfo.level, cinfo.params);
  }

  function corpseInfoAt(x, z) {
    let best = null, bd = 4;
    for (const c of sim.state.corpses) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d >= bd) continue;
      const v = corpseView(sim, viewer, c);
      if (v) { bd = d; best = v; }
    }
    if (!best) return null;
    const key = { infected: 'corpse.infected', scheduled: 'corpse.scheduled', gathering: 'corpse.infected', turn: 'corpse.turn', purified: 'corpse.purified', risk: 'corpse.na_risk', imminent: 'corpse.na_imminent' }[best.st];
    return { key, level: best.st === 'purified' ? 'good' : 'warn', params: { s: best.secs } };
  }

  function modeTap(sx, sy, info) {
    const m = game.mode;
    switch (m.kind) {
      case 'place':
        placementPoint(sx, sy, !!m.p1);
        return;
      case 'ability': {
        const g = groundAt(sx, sy);
        if (!g) return;
        // touch has no hover preview: the first tap shows the area, a tap inside it confirms
        const prev = game.frame.abilityTarget;
        const confirming = prev && Math.hypot(prev.x - g[0], prev.z - g[2]) < Math.max(3, m.radius * 0.6);
        if (info.type !== 'mouse' && !confirming) { updateAbilityTarget(sx, sy); return; }
        if (game.actions.ability(m.id, g[0], g[2])) setMode(null);
        return;
      }
      case 'rally': {
        const g = groundAt(sx, sy);
        const st = sim.rt.structById.get(m.sid);
        if (g && st) game.actions.setRally(st, g[0], g[2]);
        setMode(null);
        return;
      }
      case 'repair': {
        const g = groundAt(sx, sy);
        const st = g ? pickStructure(sim, viewer, g[0], g[2], 1, (s) => s.faction === viewer, known()) : null;
        if (st && game.actions.assist(st)) setMode(null);
        return;
      }
      case 'gather': {
        const g = groundAt(sx, sy);
        const c = g ? pickCorpse(g[0], g[2]) : null;
        if (c) { if (game.actions.haul(c)) setMode(null); return; }
        const n = nodeAt(sx, sy, g ? g[0] : undefined, g ? g[2] : undefined, info, true);
        if (n && game.actions.gather(n)) setMode(null);
        return;
      }
      case 'area': {
        const g = groundAt(sx, sy);
        if (!g) return;
        let ok = false;
        if (m.area === 'forage') ok = game.actions.forage(g[0], g[2]);
        else if (m.area === 'sanitize') ok = game.actions.sanitize(g[0], g[2]);
        else if (m.area === 'salvage') ok = game.actions.salvageArea(g[0], g[2]);
        else if (m.area === 'herd') {
          const st = sim.rt.structById.get(m.sid);
          ok = !!st && game.actions.herdArea(st, g[0], g[2]);
        }
        if (ok) setMode(null);
        return;
      }
      default:
        normalTap(sx, sy, info);
    }
  }

  // ------------------------------------------------------------------ gestures
  let drawDrag = false, moveDrag = false, rotateDrag = false;
  let face = null; // facing drag in progress { x0, z0, x1, z1, attackMove }
  const FACE_MIN = 2.5; // world metres: shorter drags give a plain move
  const handlers = {
    wantsFace(x, y, info) {
      if (game.mode.kind !== 'normal' || ui.areaSelect) return false;
      if (!game.selection.ownSquads(sim, viewer).length) return false;
      if (!groundAt(x, y)) return false;
      // a double tap on an own squad keeps selecting its type
      if (info.button === 0 && pickSquad(sim, viewer, cam, ground, x, y, radiusPx(), (sq) => sq.faction === viewer)) return false;
      return true;
    },
    onFaceStart(x, y) {
      cam.vx = 0; cam.vz = 0;
      const g = groundAt(x, y);
      if (!g) { face = null; return; }
      face = { x0: g[0], z0: g[2], x1: g[0], z1: g[2], attackMove: ui.attackMove };
      game.frame.faceArrow = { ...face, valid: true };
    },
    onFace(x, y) {
      if (!face) return;
      const g = groundAt(x, y);
      if (!g) return;
      face.x1 = g[0]; face.z1 = g[2];
      const len = Math.hypot(face.x1 - face.x0, face.z1 - face.z0);
      game.frame.faceArrow = { ...face, valid: len >= FACE_MIN };
    },
    onFaceEnd() {
      const f = face;
      face = null;
      game.frame.faceArrow = null;
      if (!f) return;
      const dx = f.x1 - f.x0, dz = f.z1 - f.z0;
      const len = Math.hypot(dx, dz);
      // heading convention of the simulation: 0 = +z, atan2(dx, dz)
      game.actions.moveTo(f.x0, f.z0, f.attackMove, len >= FACE_MIN ? Math.atan2(dx, dz) : undefined);
      ui.attackMove = false;
      if (game.hud) game.hud.onModeChanged();
    },
    onFaceCancel() {
      face = null;
      game.frame.faceArrow = null;
    },
    wantsBox(info) {
      return game.mode.kind === 'normal' && (ui.areaSelect || (info.type === 'mouse' && info.shift));
    },
    onTap(x, y, info) {
      if (info.button === 2) {
        // desktop convenience: right click = context command for the selection, cancel modes
        if (game.mode.kind !== 'normal') { setMode(null); return; }
        const own = game.selection.ownSquads(sim, viewer);
        if (own.length) { const saved = ui.inspect; ui.inspect = false; normalTapCommandOnly(x, y); ui.inspect = saved; }
        return;
      }
      modeTap(x, y, info);
    },
    onDoubleTap(x, y, info) {
      if (game.mode.kind !== 'normal') { modeTap(x, y, info); return; }
      const hit = pickSquad(sim, viewer, cam, ground, x, y, radiusPx(), (sq) => sq.faction === viewer);
      if (hit) selectSquads(squadsOfTypeOnScreen(sim, viewer, cam, ground, hit.sq.type), info.shift);
      else normalTap(x, y, info);
    },
    onLongPress(x, y) {
      // long press = attack-move for a selection in normal mode; anything else lets the press
      // continue as a drag (pan, trench drawing, ghost move, box) or a slow tap
      if (game.mode.kind !== 'normal' || ui.areaSelect) return false;
      const own = game.selection.ownSquads(sim, viewer);
      const g = groundAt(x, y);
      if (!own.length || !g) return false;
      game.actions.moveTo(g[0], g[2], true);
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(18);
      return true;
    },
    onDragStart(x, y, info) {
      cam.vx = 0; cam.vz = 0;
      drawDrag = false; moveDrag = false;
      if (info.pan) return; // finger left after a pinch: camera only
      const m = game.mode;
      if (m.kind === 'place' && info.button === 0) {
        if (m.linear) {
          drawDrag = true;
          m.drawing = true;
          const g = groundAt(x, y);
          if (g) {
            const s = m.stype === 'trench' ? snapToTrenchEndpoint(sim.state.structures, viewer, g[0], g[2], 2.5) : null;
            m.p1 = s ? [s[0], s[1]] : [g[0], g[2]];
            m.p2 = null;
          }
        } else {
          const g = groundAt(x, y);
          const def = STRUCTURES[m.stype];
          const d = g ? Math.hypot(g[0] - m.x, g[2] - m.z) : Infinity;
          // a PINNED ghost (or a gun being re-laid): a drag on / around it turns it freely with a
          // live firing arc; elsewhere the drag pans the camera. An unpinned ghost (mouse, before
          // the first click) is still dragged along when the drag starts on it.
          if ((m.pinned || m.reorient) && !m.hidden && d < rotateGrab(def)) rotateDrag = true;
          else if (!m.pinned && !m.hidden && d < Math.max(def.footprint.w, def.footprint.d) * 0.8 + 2) { moveDrag = true; m.pinned = true; }
        }
      }
    },
    onDrag(dx, dy, x, y) {
      const m = game.mode;
      if (drawDrag && m.kind === 'place') {
        const g = groundAt(x, y);
        if (g && m.p1) { m.p2 = clampLinear(STRUCTURES[m.stype], m.p1, g[0], g[2], [0, 0]); updatePlacement(); }
        return;
      }
      if (rotateDrag && m.kind === 'place') {
        const g = groundAt(x, y);
        if (g && Math.hypot(g[0] - m.x, g[2] - m.z) > 1.2) { m.rot = Math.atan2(g[0] - m.x, g[2] - m.z); updatePlacement(); }
        return;
      }
      if (moveDrag && m.kind === 'place') {
        const g = groundAt(x, y);
        if (g) { m.x = g[0]; m.z = g[2]; updatePlacement(); }
        return;
      }
      panCamera(cam, dx, dy);
    },
    onDragEnd(vx, vy) {
      if (drawDrag) { drawDrag = false; if (game.mode.kind === 'place') game.mode.drawing = false; updatePlacement(); return; }
      if (moveDrag) { moveDrag = false; return; }
      if (rotateDrag) { rotateDrag = false; return; }
      // inertia: screen velocity -> world velocity (same mapping as panCamera)
      const k = worldPerPixel(cam);
      const pitch = cameraPitch(cam);
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
      const f = 1 / Math.max(0.35, Math.sin(pitch));
      const sp = Math.hypot(vx, vy);
      if (sp < 60) return;
      const lim = Math.min(1, 2600 / sp);
      cam.vx = (-vx * c - vy * s * f) * k * lim;
      cam.vz = (vx * s - vy * c * f) * k * lim;
    },
    onBoxStart(x, y) {
      if (game.hud) game.hud.showBox(x / pxScale, y / pxScale, x / pxScale, y / pxScale);
    },
    onBox(x0, y0, x1, y1) {
      if (game.hud) game.hud.showBox(x0 / pxScale, y0 / pxScale, x1 / pxScale, y1 / pxScale);
    },
    onBoxCancel() {
      if (game.hud) game.hud.hideBox();
    },
    onBoxEnd(x0, y0, x1, y1) {
      if (game.hud) game.hud.hideBox();
      const ids = boxSelect(sim, viewer, cam, ground, x0, y0, x1, y1);
      game.selection.applyBox(ids, ui.multiSelect || keys.has('Shift'), ui.multiSelect);
      completeAreaSelect(ui); // one-shot even for an empty box: the next drag is camera pan
      if (game.hud && game.hud.onSelectionModesChanged) game.hud.onSelectionModesChanged();
      if (ids.length && game.audio) game.audio.ui('select');
    },
    onPinchStart() {
      cam.vx = 0; cam.vz = 0;
    },
    onPinch(scale, cx, cy, dcx, dcy) {
      if (scale > 0) zoomAt(cam, 1 / scale, cx, cy);
      panCamera(cam, dcx, dcy);
    },
    onWheel(dy, x, y) {
      zoomAt(cam, Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0012), x, y);
    },
    onHover(x, y) {
      game.pointer = [x, y];
      const m = game.mode;
      if (m.kind === 'place') {
        const g = groundAt(x, y);
        if (!g) return;
        if (m.linear) { if (m.p1 && !m.p2) { m.hover = clampLinear(STRUCTURES[m.stype], m.p1, g[0], g[2], [0, 0]); updatePlacement(); } }
        else if (!m.pinned && !m.reorient) { m.x = g[0]; m.z = g[2]; m.hidden = false; updatePlacement(); }
        return;
      }
      if (m.kind === 'ability') { updateAbilityTarget(x, y); return; }
      if (m.kind === 'area') { updateAreaTarget(x, y); return; }
      const hit = pickSquad(sim, viewer, cam, ground, x, y, radiusPx());
      if (hit) { game.frame.hover = { k: 'squad', id: hit.sq.id }; canvas.style.cursor = hit.sq.faction === viewer ? 'pointer' : 'crosshair'; return; }
      const g = groundAt(x, y);
      const st = g ? pickStructure(sim, viewer, g[0], g[2], 0.8, null, known()) : null;
      if (st && st.faction !== 'neutral') { game.frame.hover = { k: 'struct', id: st.id }; canvas.style.cursor = 'pointer'; return; }
      game.frame.hover = null;
      canvas.style.cursor = ui.attackMove ? 'crosshair' : 'default';
    },
  };

  /** Right-click style command: never changes the selection. */
  function normalTapCommandOnly(sx, sy) {
    const hit = pickSquad(sim, viewer, cam, ground, sx, sy, radiusPx(), (sq) => sq.faction !== viewer);
    if (hit) { game.actions.attack('squad', hit.sq.id, hit.sq.cx, hit.sq.cz); return; }
    const g = groundAt(sx, sy);
    if (!g) return;
    const st = pickStructure(sim, viewer, g[0], g[2], 0.8, null, known());
    if (st && st.memory) { game.actions.moveTo(st.x, st.z, true); return; }
    if (st && st.faction !== viewer && st.faction !== 'neutral') { game.actions.attack('struct', st.id, st.x, st.z); return; }
    if (st && (st.type === 'trench') && game.actions.enterTrench(st.id, g[0], g[2])) return;
    if (st && STRUCTURES[st.type].garrison && game.actions.garrison(st)) return;
    if (st && st.faction === viewer && (!st.built || st.hp < st.maxHp) && game.actions.assist(st)) return;
    const body = pickCorpse(g[0], g[2]);
    if (body) { game.actions.haul(body); return; }
    const node = hasCapability('gatherer') ? nodeAt(sx, sy, g[0], g[2], { type: 'mouse' }) : null;
    if (node) { game.actions.gather(node); return; }
    game.actions.moveTo(g[0], g[2], ui.attackMove);
    ui.attackMove = false;
  }

  const gestures = createGestures(handlers, { scale: () => pxScale });

  // ------------------------------------------------------------------ DOM binding
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    pxScale = canvas.width / Math.max(1, r.width);
    return [(e.clientX - r.left) * pxScale, (e.clientY - r.top) * (canvas.height / Math.max(1, r.height))];
  }

  function inf(e) {
    return { button: e.button, type: e.pointerType || 'mouse', shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
  }

  const listeners = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  on(canvas, 'pointerdown', (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const [x, y] = toCanvas(e);
    gestures.down(e.pointerId, x, y, e.timeStamp, inf(e));
    if (game.audio) game.audio.unlock();
  });
  on(canvas, 'pointermove', (e) => {
    const [x, y] = toCanvas(e);
    gestures.move(e.pointerId, x, y, e.timeStamp);
  });
  on(canvas, 'pointerup', (e) => {
    const [x, y] = toCanvas(e);
    gestures.up(e.pointerId, x, y, e.timeStamp);
  });
  on(canvas, 'pointercancel', (e) => gestures.cancel(e.pointerId, e.timeStamp));
  on(canvas, 'lostpointercapture', (e) => gestures.cancel(e.pointerId, e.timeStamp));
  on(canvas, 'contextmenu', (e) => e.preventDefault());
  on(canvas, 'wheel', (e) => {
    e.preventDefault();
    const [x, y] = toCanvas(e);
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    gestures.wheel(dy, x, y, { ctrl: e.ctrlKey });
  }, { passive: false });
  on(canvas, 'pointerleave', () => { if (!gestures.count) game.frame.hover = null; });

  function typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  on(window, 'keydown', (e) => {
    if (typing(e) || ui.menuOpen) return; // a menu over the match owns the keyboard
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const own = game.selection.ownSquads(sim, viewer);
    if (/^[1-9]$/.test(k)) {
      // control groups (shared with the HUD slots 1/2/3): Ctrl+N saves, N selects, N twice focuses
      const i = Number(k) - 1;
      const cg = game.controlGroups;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const n = cg.save(i, own.map((s) => s.id), sim, viewer);
        if (n && game.hud) game.hud.notify('cg.saved', 'good', { n: i + 1 });
        if (game.hud && game.hud.onGroupsChanged) game.hud.onGroupsChanged();
      } else {
        const r = cg.tap(i, performance.now());
        if (r !== 'empty') {
          selectSquads(cg.ids(i, sim, viewer), e.shiftKey);
          if (r === 'focus') { const c = cg.center(i, sim, viewer); if (c) game.lookAt(c[0], c[1]); }
        }
      }
      return;
    }
    switch (k) {
      case 'Escape':
        if (game.mode.kind !== 'normal') setMode(null);
        else if (ui.attackMove) { ui.attackMove = false; if (game.hud) game.hud.onModeChanged(); }
        else game.selection.clear();
        break;
      case ' ': game.home(); e.preventDefault(); break;
      case 'a': if (own.length) { ui.attackMove = true; if (game.hud) game.hud.onModeChanged(); } break;
      case 's': game.actions.stop(); break;
      case 'q': selectSquads(allCombatSquadIds(sim, viewer), e.shiftKey); break;
      case 'e': selectSquads(squadIdsWithRole(sim, viewer, 'builder'), e.shiftKey); break;
      case 'b': if (game.hud) game.hud.toggleBuildMenu(); break;
      case 'r': if (game.mode.kind === 'place') rotatePlacement(); else game.actions.reinforce(); break;
      case 'f': {
        const sq = own[0];
        if (sq) {
          const i = PLAYER_FORMATIONS.indexOf(sq.formation);
          game.actions.formation(PLAYER_FORMATIONS[(i + 1) % PLAYER_FORMATIONS.length]);
        }
        break;
      }
      case 'Enter': confirmPlacement(); break;
      case 'p': case 'Pause': game.togglePause(); break;
      case ']': game.speedStep(1); break;
      case '[': game.speedStep(-1); break;
      case '+': case '=': zoomAt(cam, 0.85, cam.width / 2, cam.height / 2); break;
      case '-': zoomAt(cam, 1.18, cam.width / 2, cam.height / 2); break;
      case 'F1': case '`': game.toggleDebug(); e.preventDefault(); break;
      default: break;
    }
  });
  on(window, 'keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  on(window, 'blur', () => { keys.clear(); gestures.reset(); });

  function update(dt, now) {
    gestures.tick(now);
    let dx = 0, dy = 0;
    if (keys.has('ArrowLeft')) dx += 1;
    if (keys.has('ArrowRight')) dx -= 1;
    if (keys.has('ArrowUp')) dy += 1;
    if (keys.has('ArrowDown')) dy -= 1;
    if (dx || dy) {
      const speed = 700 * pxScale; // px/s of equivalent drag
      panCamera(cam, dx * speed * dt, dy * speed * dt);
    }
    // keep ability ring / hover current when the camera moves under a still mouse
    if (game.pointer && game.mode.kind === 'ability') updateAbilityTarget(game.pointer[0], game.pointer[1]);
  }

  function destroy() {
    for (const [t, type, fn, opts] of listeners) t.removeEventListener(type, fn, opts);
    listeners.length = 0;
  }

  return {
    update, destroy, setMode, startPlacement, confirmPlacement, rotatePlacement, startAbility,
    startRally(st) { setMode({ kind: 'rally', sid: st.id }); },
    startRepair() { setMode({ kind: 'repair' }); },
    startGather() { setMode({ kind: 'gather' }); },
    startArea,
    cancelMode() { setMode(null); },
    cancelSpot, startReorient,
    gestures,
  };
}
