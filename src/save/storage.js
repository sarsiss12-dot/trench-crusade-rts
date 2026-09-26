// Save slots on top of a Storage-like object (browser local storage in the app, a fake in tests).
// All storage access is wrapped: private windows / blocked storage degrade to "no saves".
// Sandbox (stress-test) states can never be written into campaign slots.
import { serializeSave, deserializeSave } from './codec.js';

export function createStorage(backend, opts = {}) {
  const prefix = opts.prefix || 'tcrts.campaign.';
  const allowSandbox = !!opts.allowSandbox;
  const indexKey = prefix + 'index';

  function readIndex() {
    try {
      const raw = backend.getItem(indexKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeIndex(list) {
    backend.setItem(indexKey, JSON.stringify(list));
  }

  return {
    prefix,
    save(slot, state, meta = {}) {
      if (state && state.settings && state.settings.sandbox && !allowSandbox) return { ok: false, reason: 'save.sandbox' };
      try {
        const m = { ...meta, tick: state.tick, scenarioId: state.scenarioId, phase: state.match.phase };
        const str = serializeSave(state, m);
        backend.setItem(prefix + 'slot.' + slot, str);
        const list = readIndex().filter((e) => e.slot !== slot);
        list.push({ slot, meta: m });
        writeIndex(list);
        return { ok: true, bytes: str.length };
      } catch {
        return { ok: false, reason: 'save.storage_error' };
      }
    },
    load(slot) {
      try {
        const raw = backend.getItem(prefix + 'slot.' + slot);
        if (!raw) return null;
        return deserializeSave(raw);
      } catch {
        return null;
      }
    },
    list() {
      return readIndex();
    },
    remove(slot) {
      try {
        backend.removeItem(prefix + 'slot.' + slot);
        writeIndex(readIndex().filter((e) => e.slot !== slot));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Separate namespace for development/stress sessions. */
export function createSandboxStorage(backend) {
  return createStorage(backend, { prefix: 'tcrts.sandbox.', allowSandbox: true });
}
