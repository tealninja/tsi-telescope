/* ============================================================
   TSI RESOURCE BURDEN PLANNER · v2
   Single-file HTML app. State persisted to localStorage.
   ============================================================ */

import { monthKey } from './util/dates.js';
import { $, $$, toast } from './util/dom.js';
import { deepCopy, deepCopyMilestones, uid } from './util/clone.js';
import {
  DEFAULT_ROLES, DEFAULT_PHASES, DEFAULT_LOCATIONS, DEFAULT_TEMPLATES,
  DEFAULT_MILESTONE_SCHED, DEFAULT_COST_SCHED
} from './defaults.js';
import {
  state, setState,
  getTemplate,
  saveState, loadState, seedSampleProjects,
  addLocation, addRole
} from './state.js';
import {
  clearStateBlob, fetchRemoteBlob, flushToRemote, lastUpdatedAt, markAdopted
} from './api/storage.js';
import { stageForWinProb } from './util/stages.js';
import { migrateAllToDetailed } from './compute/demand.js';
import { renderRoles } from './ui/roles-view.js';
import { renderLocations } from './ui/locations-view.js';
import { renderCapacity } from './ui/capacity-view.js';
import { openProjectModal } from './ui/project-editor.js';
import { openQuickAddModal } from './ui/quick-add.js';
import { renderProjects } from './ui/projects-view.js';
import { renderTemplates } from './ui/templates-view.js';
import { renderCapVDem } from './ui/capvdem-view.js';
import { renderHistogram } from './ui/histogram-view.js';
import { renderGantt } from './ui/gantt-view.js';
import { renderDashboard } from './ui/dashboard-view.js';



/* ============================================================
   UI WIRING
   ============================================================ */

/* ---------- Tab switching ---------- */
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const v = tab.dataset.view;
    $$('.view').forEach(view => view.classList.remove('active'));
    $('#view-'+v).classList.add('active');
    if (v === 'dashboard') renderDashboard();
    if (v === 'projects')  renderProjects();
    if (v === 'capacity')  renderCapacity();
    if (v === 'gantt')     renderGantt();
    if (v === 'histogram') renderHistogram();
    if (v === 'capvdem')   renderCapVDem();
    if (v === 'templates') renderTemplates();
    if (v === 'locations') renderLocations();
    if (v === 'roles')     renderRoles();
  });
});

/* ---------- Export / Import / Reset ---------- */
$('#btn-export').addEventListener('click', () => {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tsi_resource_plan_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported plan to JSON');
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const obj = JSON.parse(ev.target.result);
      setState(obj);
      if (!state.locations) state.locations = deepCopy(DEFAULT_LOCATIONS);
      for (const p of state.projects) {
        if (!p.locationId) p.locationId = 'us';
        if (p.contractValue == null) {
          const tpl = getTemplate(p.templateId);
          p.contractValue = (tpl && tpl.defaultContractValue) || 0;
        }
        if (!p.billingMode) p.billingMode = 'milestone';
        if (!p.milestones) {
          const tpl = getTemplate(p.templateId);
          p.milestones = deepCopyMilestones((tpl && tpl.milestones) || DEFAULT_MILESTONE_SCHED);
        }
        if (!p.costLines) {
          const tpl = getTemplate(p.templateId);
          p.costLines = deepCopyMilestones((tpl && tpl.costLines) || DEFAULT_COST_SCHED);
        }
        if (p.pinned == null) p.pinned = false;
        if (p.winProbability == null) p.winProbability = 100;
        if (!p.stage) p.stage = stageForWinProb(p.winProbability);
        if (p.lat == null || p.lng == null) {
          const loc = state.locations.find(l => l.id === p.locationId);
          const def = DEFAULT_LOCATIONS.find(l => l.id === p.locationId);
          const src = (loc && loc.lat != null) ? loc : def;
          if (src) { p.lat = src.lat; p.lng = src.lng; }
        }
      }
      migrateAllToDetailed();
      saveState();
      renderAll();
      toast('Imported plan');
    } catch (err) {
      alert('Import failed: invalid JSON');
    }
  };
  reader.readAsText(f);
  e.target.value = '';
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Reset to TSI defaults? All projects and capacity entries will be cleared.')) return;
  clearStateBlob();
  setState({
    startMonth: monthKey(new Date()),
    roles: deepCopy(DEFAULT_ROLES),
    phases: deepCopy(DEFAULT_PHASES),
    templates: deepCopy(DEFAULT_TEMPLATES),
    locations: deepCopy(DEFAULT_LOCATIONS),
    projects: [],
    capacity: {}
  });
  seedSampleProjects();
  migrateAllToDetailed();
  saveState();
  renderAll();
  toast('Reset to defaults');
});

$('#btn-new-project').addEventListener('click', () => openProjectModal(null));
$('#btn-quick-add').addEventListener('click', () => openQuickAddModal());

/* ---------- Capacity view top-level buttons ---------- */
$('#btn-cap-fill').addEventListener('click', () => {
  for (const r of state.roles) {
    const arr = state.capacity[r.id] || new Array(36).fill(0);
    const firstIdx = arr.findIndex(v => v > 0);
    if (firstIdx >= 0) {
      const v = arr[firstIdx];
      for (let i = firstIdx + 1; i < 36; i++) arr[i] = v;
    }
    state.capacity[r.id] = arr;
  }
  saveState();
  renderCapacity();
  toast('Capacity filled right from first non-zero');
});

$('#btn-cap-zero').addEventListener('click', () => {
  if (!confirm('Zero all capacity entries?')) return;
  for (const r of state.roles) state.capacity[r.id] = new Array(36).fill(0);
  saveState(); renderCapacity();
});

/* ---------- Locations view top-level button ---------- */
$('#btn-new-location').addEventListener('click', () => {
  const name = prompt('Location name?', 'New Location');
  if (!name) return;
  const mult = parseFloat(prompt('Speed multiplier (1.0 = baseline; 0.7 = 30% faster; 1.2 = 20% slower)?', '1.0'));
  if (!mult || mult <= 0) return;
  addLocation({ id: uid('loc'), name, multiplier: mult, notes: '' });
  saveState(); renderLocations();
});

/* ---------- Roles view top-level button ---------- */
$('#btn-new-role').addEventListener('click', () => {
  const name = prompt('Role name?');
  if (!name) return;
  addRole({ id: uid('role'), name, abbr: name.slice(0,3).toUpperCase(), color: '#888888' });
  saveState(); renderRoles();
});

/* Re-renders the projects grid + KPIs, plus whichever view is currently
   active. Imported by view modules that mutate state (e.g. delete project,
   save edits) so the rest of the UI catches up. */
export function renderAll() {
  // Re-render projects (used for the card grid + KPI row) always, so any
  // tab that toggles back to it sees fresh data. Then re-render whichever
  // view is currently active so the user's screen catches up.
  renderProjects();
  const activeTab = document.querySelector('.tab.active');
  if (!activeTab) return;
  const v = activeTab.dataset.view;
  if (v === 'dashboard') renderDashboard();
  if (v === 'capacity')  renderCapacity();
  if (v === 'gantt')     renderGantt();
  if (v === 'histogram') renderHistogram();
  if (v === 'capvdem')   renderCapVDem();
  if (v === 'templates') renderTemplates();
  if (v === 'locations') renderLocations();
  if (v === 'roles')     renderRoles();
}

/* ============================================================
   SHARED-STATE SYNC

   The plan lives in Cloudflare KV behind /api/state; localStorage is a
   write-through cache. Boot paints from the local cache instantly, then
   reconciles with the shared copy. A poll loop keeps peers roughly live.
   Concurrency is last-write-wins, ordered by the blob's updatedAt stamp.
   ============================================================ */

const POLL_INTERVAL_MS = 8000;

/* True while the user is mid-edit, so the poll loop never yanks the
   ground out from under them. Covers open modals and focused inputs. */
function isEditing() {
  if (document.querySelector('.modal-overlay.open')) return true;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
             el.tagName === 'SELECT' || el.isContentEditable)) return true;
  return false;
}

/* Replace in-memory state with a blob from the server, running it through
   the same backfill/migration as a local load. Does NOT save — the server
   copy is already canonical, and re-saving would echo back as a new write. */
function adoptRemote(blob) {
  loadState(blob);
  migrateAllToDetailed();
  markAdopted(blob);
  renderAll();
}

/* One-shot reconcile with the server. */
async function syncFromRemote() {
  const remote = await fetchRemoteBlob();
  const remoteAt = (remote && remote.updatedAt) || 0;
  if (!remote) {
    saveState();                 // server empty → seed it from our copy
  } else if (remoteAt > lastUpdatedAt()) {
    adoptRemote(remote);         // shared copy is newer → take it
  } else if (lastUpdatedAt() > remoteAt) {
    saveState();                 // our copy is newer → push it up
  }                              // else: already in sync
}

async function pollSync() {
  if (isEditing()) return;       // don't clobber an in-progress edit
  const remote = await fetchRemoteBlob();
  if (remote && (remote.updatedAt || 0) > lastUpdatedAt()) adoptRemote(remote);
}

/* ============================================================
   BOOT
   ============================================================ */

if (!loadState()) {
  seedSampleProjects();
} else {
  for (const r of state.roles) {
    if (!state.capacity[r.id]) state.capacity[r.id] = new Array(36).fill(0);
  }
  // Seed the sync watermark from the local copy's stamp so syncFromRemote
  // can tell whether the server is genuinely ahead of us.
  markAdopted(state);
}
// Convert any legacy per-phase peak/rampUp/rampDown curves into the
// detailed monthly grid so the rest of the app has a single source of truth.
migrateAllToDetailed();
renderAll();

// Reconcile with the shared copy (adopt if newer, seed/push if not), then
// start polling for peers' changes. Deliberately after first paint so the
// UI never blocks on the network.
syncFromRemote().finally(() => {
  setInterval(pollSync, POLL_INTERVAL_MS);
});

window.addEventListener('beforeunload', () => {
  saveState();      // stamp + cache locally and queue the push
  flushToRemote();  // send it now (keepalive) — the timer won't fire on unload
});

// Re-render charts on window resize (rotate / browser-window change) so
// the responsive colW math picks up the new wrap width. Debounced so it
// fires once when the user finishes resizing instead of on every pixel.
let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    const activeTab = document.querySelector('.tab.active');
    if (!activeTab) return;
    const v = activeTab.dataset.view;
    // Only redraw views whose charts depend on container width.
    if (v === 'dashboard') renderDashboard();
    if (v === 'histogram') renderHistogram();
    if (v === 'capvdem')   renderCapVDem();
    if (v === 'gantt')     renderGantt();
  }, 200);
});

