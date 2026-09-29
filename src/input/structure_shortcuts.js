// Data-driven structure selection shortcuts. Slots belong to the exact starting structures tagged
// by a package; no map scan or "first three buildings" inference is used.
export function structureQuickSlots(state, viewer) {
  const out = {};
  for (const st of state.structures) {
    if (st.faction !== viewer || !st.quickSlot || st.hp <= 0) continue;
    if (!out[st.quickSlot] || st.id < out[st.quickSlot].id) out[st.quickSlot] = st;
  }
  return out;
}

/** Selection only. Deliberately receives no camera and cannot focus, pan, zoom or rotate it. */
export function selectStructureShortcut(game, slot) {
  const st = structureQuickSlots(game.sim.state, game.viewer)[slot];
  if (!st) return false;
  game.selection.setStruct(st.id);
  if (game.audio) game.audio.ui('select');
  if (game.hud && game.hud.markDirty) game.hud.markDirty();
  return true;
}
