/* ============================================================
   Storage seam — the ONLY module that knows how data is persisted.

   Today: browser localStorage under a single JSON key.
   Soon:  D1 via a worker /api/state endpoint, with localStorage as
          a write-through cache and offline fallback.

   The rest of the app (state.js + views + compute) calls
   loadStateBlob() / saveStateBlob() and is agnostic to the backend.
   ============================================================ */

const STORAGE_KEY = 'tsi_resource_planner_v6';

export function loadStateBlob() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('loadStateBlob failed', e);
    return null;
  }
}

export function saveStateBlob(blob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch (e) {
    console.error('saveStateBlob failed', e);
  }
}

export function clearStateBlob() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

export { STORAGE_KEY };
