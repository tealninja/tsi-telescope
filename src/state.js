/* ============================================================
   Application state — single source of truth.

   Holds the live state object plus localStorage persistence,
   lookup helpers, the rolling-horizon view, and seed data.

   The `state` binding is exported live; mutations from
   consumers (state.projects.push(...), state.capacity[r] = ...)
   propagate normally. To replace state wholesale (import,
   reset), call setState(newObj) — consumers see the new
   binding automatically via ES module live exports.
   ============================================================ */

import { monthKey, addMonths } from './util/dates.js';
import { deepCopy, deepCopyMilestones, uid } from './util/clone.js';
import {
  DEFAULT_ROLES, DEFAULT_PHASES, DEFAULT_LOCATIONS, DEFAULT_TEMPLATES,
  DEFAULT_MILESTONE_SCHED, DEFAULT_COST_SCHED
} from './defaults.js';

export const STORAGE_KEY = 'tsi_resource_planner_v6';

export let state = {
  startMonth: monthKey(new Date()),
  roles: deepCopy(DEFAULT_ROLES),
  phases: deepCopy(DEFAULT_PHASES),
  templates: deepCopy(DEFAULT_TEMPLATES),
  locations: deepCopy(DEFAULT_LOCATIONS),
  projects: [],
  capacity: {}
};

export function setState(newObj) {
  state = newObj;
}

export function horizonMonths() {
  const out = [];
  for (let i = 0; i < 36; i++) out.push(addMonths(state.startMonth, i));
  return out;
}

export function getPhase(id)    { return state.phases.find(p => p.id === id); }
export function getRole(id)     { return state.roles.find(r => r.id === id); }
export function getTemplate(id) { return state.templates.find(t => t.id === id); }
export function getLocation(id) { return state.locations.find(l => l.id === id); }
export function getProject(id)  { return state.projects.find(p => p.id === id); }

export function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Save failed', e); }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const loaded = JSON.parse(raw);
    state = Object.assign({
      startMonth: monthKey(new Date()),
      roles: deepCopy(DEFAULT_ROLES),
      phases: deepCopy(DEFAULT_PHASES),
      templates: deepCopy(DEFAULT_TEMPLATES),
      locations: deepCopy(DEFAULT_LOCATIONS),
      projects: [],
      capacity: {}
    }, loaded);
    // Backfill locations if missing on imported projects
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
      if (p.lat == null || p.lng == null) {
        const loc = state.locations && state.locations.find(l => l.id === p.locationId);
        const def = DEFAULT_LOCATIONS.find(l => l.id === p.locationId);
        const src = (loc && loc.lat != null) ? loc : def;
        if (src) { p.lat = src.lat; p.lng = src.lng; }
      }
    }
    if (!state.locations) state.locations = deepCopy(DEFAULT_LOCATIONS);
    // Backfill lat/lng on stored locations from defaults if missing.
    for (const l of state.locations) {
      if (l.lat == null || l.lng == null) {
        const def = DEFAULT_LOCATIONS.find(d => d.id === l.id);
        if (def) { l.lat = def.lat; l.lng = def.lng; }
      }
    }
    return true;
  } catch (e) {
    console.error('Load failed', e);
    return false;
  }
}

export function seedSampleProjects() {
  const today = new Date();
  const m0 = monthKey(today);

  function seed(name, client, location, locationId, templateId, startMonth, notes, contractValue, winProb, lat, lng) {
    const tpl = getTemplate(templateId);
    return {
      id: uid('proj'),
      name, client, location, locationId, templateId, startMonth, notes,
      phases: deepCopy(tpl.phases),
      contractValue: contractValue,
      billingMode: tpl.billingMode || 'milestone',
      milestones: deepCopyMilestones(tpl.milestones || DEFAULT_MILESTONE_SCHED),
      costLines: deepCopyMilestones(tpl.costLines || DEFAULT_COST_SCHED),
      pinned: false,
      winProbability: winProb != null ? winProb : 100,
      lat, lng
    };
  }

  state.projects = [
    seed('Northwest Pellet Co. — Dryer #2', 'Northwest Pellet Co.', 'Spokane, WA', 'us',
         'dryer_small', addMonths(m0, -2),
         'Standard drum dryer, mid-tier complexity. Contract signed Q1.', 3500000, 100,
         47.6588, -117.4260),
    seed('Austwood Vietnam — Torreactor', 'Austwood', 'Binh Phuoc, Vietnam', 'vn_sea',
         'torre_comm', addMonths(m0, 1),
         'Commercial Torreactor, local fab partner. LOI received, finalizing terms.', 28000000, 75,
         11.7512, 107.0245),
    seed('Lighthouse Green Fuels', 'Alfanar', 'Stockton-on-Tees, UK', 'uk',
         'torre_comm', addMonths(m0, 4),
         'UK SAF feedstock torrefaction. Active in PQQ stage with consortium.', 42000000, 40,
         54.5614, -1.3175),
    seed('TBD FEED — European Customer', 'Confidential', 'Germany', 'eu',
         'feed', addMonths(m0, 2),
         'FEED study for a torrefaction plant. NDA signed, scoping discussions ongoing.', 480000, 60,
         51.1657, 10.4515)
  ];

  for (const r of state.roles) {
    state.capacity[r.id] = new Array(36).fill(2);
  }
  state.capacity['pm']        = new Array(36).fill(3);
  state.capacity['mech']      = new Array(36).fill(4);
  state.capacity['proc_eng']  = new Array(36).fill(3);
  state.capacity['controls']  = new Array(36).fill(2);
  state.capacity['install']   = new Array(36).fill(2);
  state.capacity['commiss']   = new Array(36).fill(2);
  state.capacity['docs']      = new Array(36).fill(1);
}
