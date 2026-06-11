/* ============================================================
   Storage seam — the ONLY module that knows how data is persisted.

   Model: a single shared plan in Cloudflare KV, fronted by a worker
   /api/state endpoint, with localStorage as a write-through cache and
   offline fallback.

     · saveStateBlob()  writes localStorage synchronously (instant, and
       survives page-unload) and schedules a debounced PUT to the server.
     · loadStateBlob()  reads the local cache synchronously, so first
       paint never waits on the network.
     · fetchRemoteBlob() pulls the shared copy from the server (used at
       boot and by the poll loop in boot.js).

   The rest of the app (state.js + views + compute) calls
   loadStateBlob() / saveStateBlob() and is agnostic to the backend.
   ============================================================ */

const STORAGE_KEY = 'tsi_resource_planner_v6';
const API_URL     = '/api/state';
const PUT_DEBOUNCE_MS = 800;

/* updatedAt of the blob this client last wrote or adopted. The poll loop
   compares the server's updatedAt against this to decide whether the
   shared copy is genuinely newer (vs. our own echo). */
let _lastUpdatedAt = 0;

export function lastUpdatedAt() { return _lastUpdatedAt; }

/* Called when the poll loop adopts a remote blob, so we don't treat the
   freshly-adopted copy as "newer" on the next tick. */
export function markAdopted(blob) {
  _lastUpdatedAt = (blob && blob.updatedAt) || 0;
}

/* ---------- Local cache (synchronous) ---------- */

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

let _putTimer    = null;
let _pendingBlob = null;

export function saveStateBlob(blob) {
  // Stamp the write so peers can order changes (last-write-wins).
  blob.updatedAt = Date.now();
  _lastUpdatedAt = blob.updatedAt;

  // 1. Write-through to localStorage immediately — instant for this tab,
  //    and the safety net for the beforeunload save.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch (e) {
    console.error('saveStateBlob (local) failed', e);
  }

  // 2. Debounce a push to the shared backend so a burst of edits
  //    collapses into one PUT.
  _pendingBlob = blob;
  clearTimeout(_putTimer);
  _putTimer = setTimeout(flushToRemote, PUT_DEBOUNCE_MS);
}

/* Push any pending blob to the server now. Returns a promise. Safe to
   call when nothing is pending (resolves immediately). Used by the
   debounce timer and by the beforeunload handler. */
export function flushToRemote() {
  clearTimeout(_putTimer);
  _putTimer = null;
  if (_pendingBlob == null) return Promise.resolve();
  const body = JSON.stringify(_pendingBlob);
  _pendingBlob = null;
  return fetch(API_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true   // let the PUT finish even if the page is unloading
  }).catch(e => console.error('flushToRemote failed', e));
}

/* ---------- Shared backend ---------- */

export async function fetchRemoteBlob() {
  try {
    const res = await fetch(API_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();   // the blob, or null if the server is empty
  } catch (e) {
    console.error('fetchRemoteBlob failed', e);
    return null;
  }
}

export function clearStateBlob() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  // The reset path re-seeds and calls saveStateBlob() right after, which
  // pushes the fresh state to the server — so a reset propagates to peers.
}

export { STORAGE_KEY };
