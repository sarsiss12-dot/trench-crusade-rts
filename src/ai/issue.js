// AI command submission: identical pipeline to player commands (kept separate from the
// dispatcher to avoid circular imports between ai.js and faction AI modules).
import { enqueueCommand } from '../sim/commands.js';

export function aiIssue(sim, cmd) {
  return enqueueCommand(sim, { ...cmd, source: 'ai' });
}
