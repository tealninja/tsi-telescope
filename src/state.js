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
import { loadStateBlob, saveStateBlob, STORAGE_KEY as STORAGE_KEY_SEAM } from './api/storage.js';
import { stageForWinProb } from './util/stages.js';

export const STORAGE_KEY = STORAGE_KEY_SEAM;

/* ============================================================
   TYPES — JSDoc for now, rename to .ts during a future port.
   These describe the shape of state.* objects so reviewers (and
   the upcoming D1 schema) have a single source of truth.
   ============================================================ */

/**
 * @typedef {Object} TSIRole
 * @property {string} id
 * @property {string} name
 * @property {string} abbr
 * @property {string} color
 */

/**
 * @typedef {Object} TSIPhase
 * @property {string} id
 * @property {string} name
 * @property {string} color
 */

/**
 * @typedef {Object} TSILocation
 * @property {string} id
 * @property {string} name
 * @property {number} multiplier   speed multiplier on phase durations
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} [notes]
 */

/**
 * @typedef {Object} TSILoading      — legacy per-phase simple curve
 * @property {number} peak           — % FTE at the flat section
 * @property {number} rampUp         — months to ramp up
 * @property {number} rampDown       — months to ramp down
 */

/**
 * @typedef {Object} TSIProjectPhase
 * @property {string} phaseId
 * @property {number} duration       — base months (pre-location-multiplier)
 * @property {Object<string, TSILoading>} [loading]   — legacy, kept for safety
 */

/**
 * @typedef {Object} TSIMilestone
 * @property {string} name
 * @property {string} anchor         — 'start' | '_end' | phaseId
 * @property {number} offsetMonths
 * @property {number} percent        — for milestones
 */

/**
 * @typedef {Object} TSICostLine
 * @property {string} name
 * @property {string} anchor
 * @property {number} offsetMonths
 * @property {number} amount         — USD outflow
 */

/**
 * @typedef {Object} TSIProject      — same record from sales and planner POV
 * @property {string} id
 * @property {string} name
 * @property {string} [client]
 * @property {string} [location]     — free text "Spokane, WA"
 * @property {string} [locationId]   — FK to location
 * @property {string} templateId
 * @property {string} startMonth     — 'YYYY-MM'
 * @property {string} [notes]        — planner-side notes
 * @property {TSIProjectPhase[]} phases
 * @property {number} contractValue
 * @property {string} billingMode    — 'milestone' | 'monthly' | 'accrual_poc'
 * @property {TSIMilestone[]} milestones
 * @property {TSICostLine[]} costLines
 * @property {boolean} pinned
 * @property {number} winProbability — 0..100
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {Object<string, number[]>} [detailedLoading]
 * — CRM-lite columns (sales team owns these; live in same record)
 * @property {string} [stage]        — 'lead'|'qualified'|'proposal'|'loi'|'awarded'|'booked'
 * @property {string} [salesOwner]
 * @property {string} [expectedCloseMonth]
 * @property {string} [pipelineNotes]
 */

/**
 * @typedef {Object} TSITemplate
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {number} [defaultContractValue]
 * @property {string} [billingMode]
 * @property {TSIProjectPhase[]} phases
 * @property {TSIMilestone[]} [milestones]
 * @property {TSICostLine[]} [costLines]
 * @property {Object<string, number[]>} [detailedLoading]
 */

/**
 * @typedef {Object} TSIState
 * @property {string} startMonth
 * @property {TSIRole[]} roles
 * @property {TSIPhase[]} phases
 * @property {TSITemplate[]} templates
 * @property {TSILocation[]} locations
 * @property {TSIProject[]} projects
 * @property {Object<string, number[]>} capacity   — roleId -> [36 values]
 */

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
  saveStateBlob(state);
}

export function loadState() {
  try {
    const loaded = loadStateBlob();
    if (!loaded) return false;
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
      if (!p.stage) p.stage = stageForWinProb(p.winProbability);
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
      stage: stageForWinProb(winProb != null ? winProb : 100),
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

/* ============================================================
   ACTIONS — every state mutation that views need.

   View modules should call these instead of poking at state.projects,
   state.templates, state.capacity directly. Gives us a single seam
   where, later, we can:
     – auto-save (debounced) after each mutation
     – push to a D1 worker endpoint
     – notify subscribers (for a future framework)
     – stamp updated_at + updated_by on each touched record
   ============================================================ */

/** @param {TSIProject} p */
export function addProject(p)        { state.projects.push(p); }
/** @param {TSIProject} p */
export function replaceProject(p) {
  const i = state.projects.findIndex(x => x.id === p.id);
  if (i >= 0) state.projects[i] = p;
}
/** @param {string} id */
export function removeProject(id) {
  state.projects = state.projects.filter(p => p.id !== id);
}

/** @param {TSITemplate} t */
export function addTemplate(t)       { state.templates.push(t); }
/** @param {TSITemplate} t */
export function replaceTemplate(t) {
  const i = state.templates.findIndex(x => x.id === t.id);
  if (i >= 0) state.templates[i] = t;
}
/** @param {string} id */
export function removeTemplate(id) {
  state.templates = state.templates.filter(t => t.id !== id);
}

/** @param {TSILocation} loc */
export function addLocation(loc)     { state.locations.push(loc); }
/** @param {string} id */
export function removeLocation(id) {
  state.locations = state.locations.filter(l => l.id !== id);
}

/** @param {TSIRole} r */
export function addRole(r) {
  state.roles.push(r);
  state.capacity[r.id] = new Array(36).fill(0);
}
/** @param {string} id */
export function removeRole(id) {
  state.roles = state.roles.filter(r => r.id !== id);
  delete state.capacity[id];
  for (const t of state.templates) for (const ph of t.phases) {
    if (ph.loading) delete ph.loading[id];
  }
  for (const p of state.projects) for (const ph of p.phases) {
    if (ph.loading) delete ph.loading[id];
  }
}

/** @param {string} roleId @param {number} monthIdx @param {number} value */
export function setCapacity(roleId, monthIdx, value) {
  if (!state.capacity[roleId]) state.capacity[roleId] = new Array(36).fill(0);
  state.capacity[roleId][monthIdx] = Math.max(0, value);
}
