// Squad strength as the game counts it (Phase 4 fix). A walking replacement ('joining') is in the
// world — visible, can be shot, killed, infected — but it is NOT part of the squad until it has
// physically reached it (REINFORCEMENT_JOINED): no aggregate HP, no alive count, no cover / trench
// post, no combat strength. The UI shows it separately as "+N en route".

const OUT = { alive: 0, hp: 0, joining: 0, joiningHp: 0 };

/** { alive, hp, joining, joiningHp } — 'rising' counts as present (a Thrall getting up). */
export function squadCounts(sq, out = OUT) {
  out.alive = 0; out.hp = 0; out.joining = 0; out.joiningHp = 0;
  for (const m of sq.members) {
    if (m.state === 'alive' || m.state === 'rising') { out.alive++; out.hp += m.hp > 0 ? m.hp : 0; }
    else if (m.state === 'joining') { out.joining++; out.joiningHp += m.hp > 0 ? m.hp : 0; }
  }
  return out;
}

/** Members that count for the squad right now (fighting strength). */
export function presentMembers(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}
