/* ============================================================
   TSI RESOURCE BURDEN PLANNER · v2
   Single-file HTML app. State persisted to localStorage.
   ============================================================ */

import { monthKey } from './util/dates.js';
import { $, $$, toast } from './util/dom.js';
import { deepCopy, deepCopyMilestones, uid } from './util/clone.js';
import {
  DEFAULT_ROLES, DEFAULT_PHASES, DEFAULT_LOCATIONS, DEFAULT_TEMPLATES,
  DEFAULT_MILESTONE_SCHED, DEFAULT_COST_SCHED,
  defaultLoading
} from './defaults.js';
import {
  state, setState, STORAGE_KEY,
  getTemplate,
  saveState, loadState, seedSampleProjects
} from './state.js';
import { renderRoles } from './ui/roles-view.js';
import { renderLocations } from './ui/locations-view.js';
import { renderCapacity } from './ui/capacity-view.js';
import { openProjectModal } from './ui/project-editor.js';
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
      }
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
  localStorage.removeItem(STORAGE_KEY);
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
  saveState();
  renderAll();
  toast('Reset to defaults');
});

$('#btn-new-project').addEventListener('click', () => openProjectModal(null));

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
  state.locations.push({ id: uid('loc'), name, multiplier: mult, notes: '' });
  saveState(); renderLocations();
});

/* ---------- Roles view top-level button ---------- */
$('#btn-new-role').addEventListener('click', () => {
  const name = prompt('Role name?');
  if (!name) return;
  const r = { id: uid('role'), name, abbr: name.slice(0,3).toUpperCase(), color: '#888888' };
  state.roles.push(r);
  state.capacity[r.id] = new Array(36).fill(0);
  for (const t of state.templates) for (const ph of t.phases) ph.loading[r.id] = defaultLoading(0,0,0);
  for (const p of state.projects) for (const ph of p.phases) ph.loading[r.id] = defaultLoading(0,0,0);
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
   BOOT
   ============================================================ */

if (!loadState()) {
  seedSampleProjects();
  saveState();
} else {
  for (const r of state.roles) {
    if (!state.capacity[r.id]) state.capacity[r.id] = new Array(36).fill(0);
  }
}
renderAll();

window.addEventListener('beforeunload', saveState);

