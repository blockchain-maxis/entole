import type { RecordStore } from '@entole/core/records';

/** Where the person's own records live in the browser. Per-browser and
 * per-origin, like the rest of the web app's local state — clearing site data
 * clears them, and the same account in another browser starts empty. */
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const deviceRecordStore: RecordStore = {
  get: async (key) => storage()?.getItem(key) ?? null,
  set: async (key, value) => void storage()?.setItem(key, value),
  remove: async (key) => void storage()?.removeItem(key),
};
