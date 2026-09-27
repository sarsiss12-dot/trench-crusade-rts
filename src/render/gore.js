// Presentation-only gore planning (DOM / GL free, unit-tested): which death trauma a kill shows,
// bounded pools for detached limbs and blood pools, and limb ballistics. Inputs are fog-filtered
// DEATH events (cause, overkill, blast force) and a hash of the soldier id — never the gameplay
// RNG, and nothing here feeds back into the simulation. Quality only changes density / bounds.
import { hash32 } from '../core/rng.js';

// bone indices (models/humans.js BONE) — duplicated as plain numbers to keep this module pure
const B = { HEAD: 2, UARM_L: 3, LARM_L: 4, UARM_R: 5, LARM_R: 6, ULEG_L: 7, LLEG_L: 8, ULEG_R: 9, LLEG_R: 10, WEAPON: 11 };

/** Limb chains: bones that leave the body together; root = the joint the limb tears from. */
export const CHAINS = Object.freeze({
  arm_l: { mask: (1 << B.UARM_L) | (1 << B.LARM_L), root: B.UARM_L },
  arm_r: { mask: (1 << B.UARM_R) | (1 << B.LARM_R), root: B.UARM_R },
  leg_l: { mask: (1 << B.ULEG_L) | (1 << B.LLEG_L), root: B.ULEG_L },
  leg_r: { mask: (1 << B.ULEG_R) | (1 << B.LLEG_R), root: B.ULEG_R },
  head: { mask: 1 << B.HEAD, root: B.HEAD },
  forearm_l: { mask: 1 << B.LARM_L, root: B.LARM_L },
  forearm_r: { mask: 1 << B.LARM_R, root: B.LARM_R },
  shin_l: { mask: 1 << B.LLEG_L, root: B.LLEG_L },
  shin_r: { mask: 1 << B.LLEG_R, root: B.LLEG_R },
});

export const GORE_QUALITY = Object.freeze({
  // limbs: detached limb instances alive at once; pools: persistent blood pools / stains;
  // chance: dismemberment probability scale; burst: blood particle scale
  low: { limbs: 12, pools: 48, chance: 0.6, burst: 0.5, limbLife: 14 },
  balanced: { limbs: 32, pools: 110, chance: 1, burst: 1, limbLife: 30 },
  high: { limbs: 64, pools: 190, chance: 1, burst: 1.5, limbLife: 55 },
});

function unit(h) {
  return (h >>> 0) / 4294967296;
}

/**
 * Death trauma for a DEATH event. Returns { kind, chains: [...chain ids], lost: bone mask }.
 * kind: 'collapse' | 'limb' | 'head' | 'explosive' | 'catastrophic'.
 *  - rifle: almost always a plain collapse (a rare head shot on big overkill)
 *  - heavy MG / shotgun: low chance of limb trauma
 *  - melee: blades take limbs / heads now and then, heavy weapons more
 *  - explosive: close to the centre -> high chance, huge overkill -> catastrophic
 *  - plague / swarm: disease kills leave the body whole
 */
export function planDeath(ev, quality = 'balanced') {
  const q = GORE_QUALITY[quality] || GORE_QUALITY.balanced;
  const h = hash32(ev.id | 0, 0x60e);
  const r = unit(h), r2 = unit(hash32(ev.id | 0, 0x61f));
  const ov = ev.ov || 0, force = ev.force || 0;
  const cause = ev.cause || 'other';
  let pLimb = 0, pHead = 0, pCat = 0;
  switch (cause) {
    case 'rifle': pHead = ov > 0.6 ? 0.06 : 0.01; pLimb = 0.01; break;
    case 'shotgun': pLimb = 0.07 + Math.min(0.1, ov * 0.1); pHead = 0.03; break;
    case 'mg': pLimb = 0.08 + Math.min(0.08, ov * 0.08); pHead = 0.02; break;
    case 'melee': pLimb = 0.12 + Math.min(0.2, ov * 0.25); pHead = 0.06 + Math.min(0.1, ov * 0.1); pCat = ov > 1.2 ? 0.1 : 0; break;
    case 'explosive':
      if (force > 0.7) { pLimb = 0.55; pCat = ov > 1.0 ? 0.55 : 0.2; }
      else if (force > 0.4) { pLimb = 0.35; pCat = ov > 1.5 ? 0.25 : 0.04; }
      else pLimb = 0.08;
      break;
    default: break; // plague, swarm, other
  }
  if (cause !== 'plague' && cause !== 'swarm' && ov > 2.2) pCat = Math.max(pCat, 0.8);
  pLimb *= q.chance; pHead *= q.chance; pCat *= q.chance;
  const pick = (list) => list[hash32(ev.id | 0, 0x71) % list.length];
  if (r < pCat) {
    const chains = ['leg_l', 'leg_r', 'arm_l', 'arm_r'].filter((_, i) => (h >>> (i + 3)) & 1 || i === (h & 3));
    if (r2 < 0.5) chains.push('head');
    return result('catastrophic', chains);
  }
  if (r < pCat + pHead) return result('head', ['head']);
  if (r < pCat + pHead + pLimb) {
    if (cause === 'explosive') {
      const two = r2 < 0.45;
      const a = pick(['leg_l', 'leg_r', 'arm_l', 'arm_r']);
      const chains = [a];
      if (two) chains.push(a === 'leg_l' ? 'leg_r' : a === 'leg_r' ? 'arm_l' : a === 'arm_l' ? 'leg_l' : 'leg_r');
      return result('explosive', chains);
    }
    return result('limb', [pick(cause === 'melee' ? ['arm_l', 'arm_r', 'forearm_l', 'forearm_r'] : ['forearm_l', 'forearm_r', 'arm_l', 'arm_r', 'shin_l', 'shin_r'])]);
  }
  return result('collapse', []);
}

function result(kind, chains) {
  let lost = 0;
  for (const c of chains) lost |= CHAINS[c].mask;
  return { kind, chains, lost };
}

/** Bounded ring pool: acquire() always succeeds by recycling the oldest entry. */
export function createRingPool(cap, make) {
  const items = [];
  for (let i = 0; i < cap; i++) items.push(make(i));
  let head = 0;
  let serial = 0;
  return {
    cap,
    items,
    acquire() {
      // prefer a free slot, else the oldest (head)
      for (let k = 0; k < cap; k++) {
        const i = (head + k) % cap;
        if (!items[i].active) { head = (i + 1) % cap; items[i].active = true; items[i].serial = ++serial; return items[i]; }
      }
      let oldest = 0;
      for (let i = 1; i < cap; i++) if (items[i].serial < items[oldest].serial) oldest = i;
      items[oldest].serial = ++serial;
      items[oldest].active = true;
      return items[oldest];
    },
    activeCount() {
      let n = 0;
      for (const it of items) if (it.active) n++;
      return n;
    },
  };
}

/** Detached limbs: bounded pool of ballistic pieces (no gameplay collision, ground approximation). */
export function createLimbPool(quality = 'balanced') {
  const q = GORE_QUALITY[quality] || GORE_QUALITY.balanced;
  return createRingPool(q.limbs, () => ({
    active: false, serial: 0, age: 0, life: q.limbLife,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 1, az: 0, ang: 0, spin: 0, rest: false,
    rx: 0, ry: 0, rz: 0, // attach point at the moment of tearing (world)
    chain: '', mask: 0, root: 0, bio: false, trail: 0, visual: null,
  }));
}

/**
 * Integrate one limb (pure): gravity, air drag, tumbling, bounce + slide on the ground height
 * ground(x,z). Returns false once its life is over (the slot is then free).
 */
export function stepLimb(l, dt, ground) {
  l.age += dt;
  if (l.age >= l.life) { l.active = false; return false; }
  if (l.rest) return true;
  l.vy -= 9.8 * dt;
  const drag = Math.exp(-0.25 * dt);
  l.vx *= drag; l.vz *= drag;
  l.x += l.vx * dt; l.y += l.vy * dt; l.z += l.vz * dt;
  l.ang += l.spin * dt;
  const gy = ground(l.x, l.z) + 0.06;
  if (l.y <= gy) {
    l.y = gy;
    if (Math.abs(l.vy) > 1.2) {
      l.vy = -l.vy * 0.28; l.vx *= 0.5; l.vz *= 0.5; l.spin *= 0.5;
    } else {
      l.vx = 0; l.vy = 0; l.vz = 0; l.spin = 0; l.rest = true;
    }
  }
  return true;
}

/** Blood pools / corpse stains: bounded, grow then persist, fade out when recycled or old. */
export function createPoolSet(quality = 'balanced') {
  const q = GORE_QUALITY[quality] || GORE_QUALITY.balanced;
  const pool = createRingPool(q.pools, () => ({ active: false, serial: 0, x: 0, z: 0, size: 0, max: 0, grow: 0, age: 0, life: 0, rot: 0, bio: false, a: 0 }));
  return {
    pool,
    add(x, z, max, bio, grow = 0.35, life = 150, rot = 0) {
      const p = pool.acquire();
      p.x = x; p.z = z; p.size = Math.min(0.2, max); p.max = max; p.grow = grow;
      p.age = 0; p.life = life; p.rot = rot; p.bio = !!bio; p.a = 0.85;
      return p;
    },
    step(dt) {
      for (const p of pool.items) {
        if (!p.active) continue;
        p.age += dt;
        if (p.size < p.max) p.size = Math.min(p.max, p.size + p.grow * dt);
        if (p.age > p.life) p.active = false;
      }
    },
  };
}
