// Context movement speed (Phase 4.1). Most units move at def.speed. A unit with def.speeds (the
// Black Grail work gang) moves faster only in its labour contexts:
//  - HUNT: running down an animal on a forage / hunt order (never while fighting, chasing an enemy
//    squad, scouting or on a plain move)
//  - CARRY: hauling biomass back to a drop-off (no carry penalty — the way home is quicker)
// Pure function of plain state (deterministic).
export function moveSpeed(sq, def) {
  const sp = def.speeds;
  if (!sp) return def.speed;
  const o = sq.order;
  if (o.t !== 'gather' || sq.melee || sq.engaged || (sq.target && sq.target.k === 'squad')) return def.speed;
  if (o.mode === 'forage' && o.phase === 'hunt' && o.aid && sp.hunt) return sp.hunt;
  if (o.phase === 'to_drop' && sq.carry > 0 && sp.carry) return sp.carry;
  return def.speed;
}
