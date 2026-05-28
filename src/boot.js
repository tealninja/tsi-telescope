/* ============================================================
   TSI RESOURCE BURDEN PLANNER · v2
   Single-file HTML app. State persisted to localStorage.
   ============================================================ */

import { monthKey, parseMonth, monthLabel, addMonths, monthsBetween } from './util/dates.js';

const STORAGE_KEY = 'tsi_resource_planner_v6';

/* ---------- Default data ---------- */

const DEFAULT_ROLES = [
  { id: 'pm',       name: 'Project Management',         abbr: 'PM',  color: '#19446C' },
  { id: 'mech',     name: 'Design Eng (Mechanical)',    abbr: 'MEC', color: '#00929F' },
  { id: 'proc_eng', name: 'Design Eng (Process)',       abbr: 'PRC', color: '#4A7A9C' },
  { id: 'controls', name: 'Controls / E&I Engineering', abbr: 'EIC', color: '#6E5B8B' },
  { id: 'procure',  name: 'Procurement',                abbr: 'PRO', color: '#809848' },
  { id: 'qa',       name: 'QA / QC',                    abbr: 'QA',  color: '#C4A230' },
  { id: 'install',  name: 'Installation Supervision',   abbr: 'INS', color: '#C05234' },
  { id: 'commiss',  name: 'Commissioning',              abbr: 'COM', color: '#6E8C34' },
  { id: 'docs',     name: 'Documentation / Tech Writing', abbr: 'DOC', color: '#646464' }
];

const DEFAULT_PHASES = [
  { id: 'sales',     name: 'Sales / Proposal',  color: '#19446C' },
  { id: 'pm',        name: 'Project Setup',     color: '#00929F' },
  { id: 'design',    name: 'Design',            color: '#4A7A9C' },
  { id: 'feed',      name: 'FEED / Study',      color: '#6E5B8B' },
  { id: 'procure',   name: 'Procurement',       color: '#809848' },
  { id: 'fab',       name: 'Fabrication',       color: '#C4A230' },
  { id: 'install',   name: 'Installation',      color: '#C05234' },
  { id: 'commiss',   name: 'Commissioning',     color: '#6E8C34' },
  { id: 'warranty',  name: 'Warranty',          color: '#646464' },
  { id: 'deliverable', name: 'Final Deliverable', color: '#EADE86' }
];

const DEFAULT_LOCATIONS = [
  { id: 'us',     name: 'USA / North America', multiplier: 1.00, notes: 'Baseline. Standard procurement lead times, OSHA compliance, in-house QA travel.' },
  { id: 'vn_sea', name: 'Vietnam / SE Asia',   multiplier: 0.70, notes: 'Faster execution. Lower-cost local fab, parallel labor, shorter customs clearance. Use Austwood/local partners.' },
  { id: 'eu',     name: 'Europe (EU)',         multiplier: 1.10, notes: 'CE marking, machinery directive overhead, ATEX where applicable. Engineering similar to US, regulatory adds ~10%.' },
  { id: 'uk',     name: 'United Kingdom',      multiplier: 1.20, notes: 'Slower procurement post-Brexit, UKCA compliance. Engineering similar to US.' },
  { id: 'br_sa',  name: 'Brazil / South America', multiplier: 1.15, notes: 'INMETRO certification, longer customs, currency hedging in commercial phase.' }
];

function defaultLoading(peak, rampUp, rampDown) {
  return { peak: peak||0, rampUp: rampUp||0, rampDown: rampDown||0 };
}

function buildLoad(roleLoads) {
  const out = {};
  for (const r of DEFAULT_ROLES) {
    out[r.id] = roleLoads[r.id] || defaultLoading(0,0,0);
  }
  return out;
}

/* ---------- Default milestone billing schedules ----------
   Each milestone has:
     name: string label
     anchor: 'start' | 'end' | phaseId (e.g. 'design', 'fab', 'install', 'commiss')
     offsetMonths: integer offset from the anchor's end (default 0 = at anchor completion).
                   For 'start' use 0; for phase anchors, offset 0 = month after phase ends.
     percent: 0..100  (must sum to 100)
*/

// Standard turnkey EPC schedule: 10/30/30/20/10
const DEFAULT_MILESTONE_SCHED = [
  { name: 'Kickoff',              anchor: 'start',   offsetMonths: 0, percent: 10 },
  { name: 'Design Complete',      anchor: 'design',  offsetMonths: 0, percent: 30 },
  { name: 'Fabrication Complete', anchor: 'fab',     offsetMonths: 0, percent: 30 },
  { name: 'Installation Complete',anchor: 'install', offsetMonths: 0, percent: 20 },
  { name: 'PAC (Final Acceptance)',anchor: 'commiss',offsetMonths: 0, percent: 10 }
];

// FEED-style schedule: 25/50/25 over phases
const FEED_MILESTONE_SCHED = [
  { name: 'Kickoff',              anchor: 'start',       offsetMonths: 0, percent: 25 },
  { name: 'FEED Complete',        anchor: 'feed',        offsetMonths: 0, percent: 50 },
  { name: 'Deliverable Accepted', anchor: 'deliverable', offsetMonths: 0, percent: 25 }
];

// Retrofit: 30/50/20
const RETROFIT_MILESTONE_SCHED = [
  { name: 'Kickoff',              anchor: 'start',   offsetMonths: 0, percent: 30 },
  { name: 'Fabrication Complete', anchor: 'fab',     offsetMonths: 0, percent: 50 },
  { name: 'Commissioning Complete',anchor: 'commiss',offsetMonths: 0, percent: 20 }
];

/* ---------- Default cost outflow schedules ----------
   Cost line items behave like reverse milestones: a $ outflow at a date anchored to
   project start, end, or a phase's completion.
   amount is in USD (always positive in the data model; the cashflow engine subtracts).
*/

// Standard turnkey: equipment payment to vendor near fab complete is the big one,
// plus modest engineering subcontractor spend during design, and travel/commissioning toward the end.
const DEFAULT_COST_SCHED = [
  { name: 'Design subcontract / consultants', anchor: 'design',  offsetMonths: 0, amount: 0 },
  { name: 'Equipment / vendor payments',       anchor: 'fab',     offsetMonths: 0, amount: 0 },
  { name: 'Installation labor & travel',       anchor: 'install', offsetMonths: 0, amount: 0 },
  { name: 'Commissioning travel / spares',     anchor: 'commiss', offsetMonths: 0, amount: 0 }
];

// FEED: lean cost structure — mostly direct labor (not separately captured) + minimal subcontractor
const FEED_COST_SCHED = [
  { name: 'Subcontractor / 3rd-party studies', anchor: 'feed', offsetMonths: 0, amount: 0 }
];

// Retrofit: equipment + installation
const RETROFIT_COST_SCHED = [
  { name: 'Equipment / vendor payments', anchor: 'fab',     offsetMonths: 0, amount: 0 },
  { name: 'Installation labor & travel', anchor: 'commiss', offsetMonths: 0, amount: 0 }
];

const DEFAULT_TEMPLATES = [
  {
    id: 'feed', name: 'FEED Study / Engineering Study',
    description: 'Front-End Engineering Design study. Design-heavy, no fabrication or installation. Ends in a deliverable package (P&IDs, datasheets, equipment list, cost estimate).',
    defaultContractValue: 450000,
    billingMode: 'milestone',
    milestones: deepCopyMilestones(FEED_MILESTONE_SCHED),
    costLines: deepCopyMilestones(FEED_COST_SCHED),
    phases: [
      { phaseId: 'sales',       duration: 2, loading: buildLoad({
          pm: defaultLoading(15, 0, 1), mech: defaultLoading(15, 0, 1),
          proc_eng: defaultLoading(20, 0, 1), docs: defaultLoading(15, 0, 0)
      })},
      { phaseId: 'pm',          duration: 1, loading: buildLoad({
          pm: defaultLoading(50, 0, 0), docs: defaultLoading(30, 0, 0),
          proc_eng: defaultLoading(20, 0, 0)
      })},
      { phaseId: 'feed',        duration: 4, loading: buildLoad({
          pm: defaultLoading(60, 1, 1), mech: defaultLoading(100, 1, 1),
          proc_eng: defaultLoading(130, 1, 1), controls: defaultLoading(60, 1, 1),
          procure: defaultLoading(30, 0, 1), qa: defaultLoading(15, 0, 1),
          docs: defaultLoading(60, 1, 1)
      })},
      { phaseId: 'deliverable', duration: 1, loading: buildLoad({
          pm: defaultLoading(70, 0, 1), mech: defaultLoading(40, 0, 1),
          proc_eng: defaultLoading(50, 0, 1), controls: defaultLoading(30, 0, 1),
          docs: defaultLoading(90, 0, 1)
      })}
    ]
  },
  {
    id: 'dryer_small', name: 'Dryer System (Small/Standard)',
    description: 'Single-drum dryer system, conventional scope. Typical for sub-15 t/h.',
    defaultContractValue: 3500000,
    billingMode: 'milestone',
    milestones: deepCopyMilestones(DEFAULT_MILESTONE_SCHED),
    costLines: deepCopyMilestones(DEFAULT_COST_SCHED),
    phases: [
      { phaseId: 'sales',    duration: 3, loading: buildLoad({
          pm: defaultLoading(15, 1, 1), mech: defaultLoading(20, 1, 1),
          proc_eng: defaultLoading(10, 0, 1), procure: defaultLoading(5, 0, 0),
          docs: defaultLoading(15, 0, 1)
      })},
      { phaseId: 'pm',       duration: 1, loading: buildLoad({
          pm: defaultLoading(40, 0, 0), procure: defaultLoading(15, 0, 0),
          docs: defaultLoading(20, 0, 0)
      })},
      { phaseId: 'design',   duration: 4, loading: buildLoad({
          pm: defaultLoading(50, 1, 1), mech: defaultLoading(90, 1, 1),
          proc_eng: defaultLoading(80, 1, 1), controls: defaultLoading(70, 1, 1),
          qa: defaultLoading(20, 1, 1), docs: defaultLoading(40, 1, 1)
      })},
      { phaseId: 'procure',  duration: 3, loading: buildLoad({
          pm: defaultLoading(40, 0, 1), procure: defaultLoading(85, 1, 1),
          mech: defaultLoading(30, 0, 1), qa: defaultLoading(40, 1, 1),
          controls: defaultLoading(20, 0, 1), docs: defaultLoading(20, 0, 0)
      })},
      { phaseId: 'fab',      duration: 5, loading: buildLoad({
          pm: defaultLoading(50, 1, 1), mech: defaultLoading(30, 0, 1),
          procure: defaultLoading(40, 0, 1), qa: defaultLoading(80, 1, 1),
          controls: defaultLoading(40, 1, 1), docs: defaultLoading(20, 0, 0)
      })},
      { phaseId: 'install',  duration: 3, loading: buildLoad({
          pm: defaultLoading(60, 1, 1), install: defaultLoading(100, 1, 1),
          mech: defaultLoading(30, 0, 1), qa: defaultLoading(40, 1, 1),
          controls: defaultLoading(50, 1, 1), docs: defaultLoading(20, 0, 0)
      })},
      { phaseId: 'commiss',  duration: 2, loading: buildLoad({
          pm: defaultLoading(50, 1, 1), commiss: defaultLoading(100, 1, 1),
          install: defaultLoading(30, 0, 1), controls: defaultLoading(60, 1, 1),
          proc_eng: defaultLoading(40, 1, 1), docs: defaultLoading(30, 0, 1)
      })},
      { phaseId: 'warranty', duration: 12, loading: buildLoad({
          pm: defaultLoading(8, 1, 2), commiss: defaultLoading(5, 0, 2),
          docs: defaultLoading(5, 0, 1)
      })}
    ]
  },
  {
    id: 'dryer_large', name: 'Dryer System (Large/Complex)',
    description: 'Multi-drum or large single-drum dryer with full APC train, advanced controls integration.',
    defaultContractValue: 14000000,
    billingMode: 'milestone',
    milestones: deepCopyMilestones(DEFAULT_MILESTONE_SCHED),
    costLines: deepCopyMilestones(DEFAULT_COST_SCHED),
    phases: [
      { phaseId: 'sales',    duration: 5, loading: buildLoad({
          pm: defaultLoading(25, 1, 1), mech: defaultLoading(30, 1, 1),
          proc_eng: defaultLoading(20, 1, 1), procure: defaultLoading(10, 0, 1),
          controls: defaultLoading(10, 0, 1), docs: defaultLoading(20, 0, 1)
      })},
      { phaseId: 'pm',       duration: 2, loading: buildLoad({
          pm: defaultLoading(70, 1, 0), procure: defaultLoading(25, 0, 0),
          docs: defaultLoading(30, 1, 0)
      })},
      { phaseId: 'design',   duration: 7, loading: buildLoad({
          pm: defaultLoading(70, 1, 1), mech: defaultLoading(180, 1, 2),
          proc_eng: defaultLoading(140, 1, 2), controls: defaultLoading(110, 1, 1),
          qa: defaultLoading(30, 1, 1), docs: defaultLoading(70, 1, 1)
      })},
      { phaseId: 'procure',  duration: 5, loading: buildLoad({
          pm: defaultLoading(70, 1, 1), procure: defaultLoading(140, 1, 1),
          mech: defaultLoading(50, 0, 1), qa: defaultLoading(60, 1, 1),
          controls: defaultLoading(40, 1, 1), docs: defaultLoading(30, 0, 0)
      })},
      { phaseId: 'fab',      duration: 8, loading: buildLoad({
          pm: defaultLoading(80, 1, 2), mech: defaultLoading(60, 1, 1),
          procure: defaultLoading(60, 1, 2), qa: defaultLoading(130, 1, 1),
          controls: defaultLoading(70, 1, 1), docs: defaultLoading(30, 0, 1)
      })},
      { phaseId: 'install',  duration: 5, loading: buildLoad({
          pm: defaultLoading(100, 1, 1), install: defaultLoading(200, 1, 1),
          mech: defaultLoading(60, 1, 1), qa: defaultLoading(70, 1, 1),
          controls: defaultLoading(100, 1, 1), docs: defaultLoading(30, 0, 1)
      })},
      { phaseId: 'commiss',  duration: 3, loading: buildLoad({
          pm: defaultLoading(80, 1, 1), commiss: defaultLoading(170, 1, 1),
          install: defaultLoading(50, 0, 1), controls: defaultLoading(110, 1, 1),
          proc_eng: defaultLoading(70, 1, 1), docs: defaultLoading(50, 1, 1)
      })},
      { phaseId: 'warranty', duration: 18, loading: buildLoad({
          pm: defaultLoading(12, 1, 2), commiss: defaultLoading(8, 0, 2),
          docs: defaultLoading(8, 0, 1)
      })}
    ]
  },
  {
    id: 'torre_demo', name: 'Torreactor Demo / Pilot',
    description: 'Demonstration-scale Torreactor unit. Higher process engineering and commissioning loading; longer warranty for data collection.',
    defaultContractValue: 8000000,
    billingMode: 'milestone',
    milestones: deepCopyMilestones(DEFAULT_MILESTONE_SCHED),
    costLines: deepCopyMilestones(DEFAULT_COST_SCHED),
    phases: [
      { phaseId: 'sales',    duration: 4, loading: buildLoad({
          pm: defaultLoading(20, 1, 1), mech: defaultLoading(25, 1, 1),
          proc_eng: defaultLoading(40, 1, 1), procure: defaultLoading(5, 0, 0),
          docs: defaultLoading(20, 1, 1)
      })},
      { phaseId: 'pm',       duration: 1, loading: buildLoad({
          pm: defaultLoading(50, 0, 0), procure: defaultLoading(20, 0, 0),
          docs: defaultLoading(25, 0, 0)
      })},
      { phaseId: 'design',   duration: 5, loading: buildLoad({
          pm: defaultLoading(60, 1, 1), mech: defaultLoading(120, 1, 1),
          proc_eng: defaultLoading(140, 1, 1), controls: defaultLoading(80, 1, 1),
          qa: defaultLoading(25, 1, 1), docs: defaultLoading(50, 1, 1)
      })},
      { phaseId: 'procure',  duration: 3, loading: buildLoad({
          pm: defaultLoading(50, 0, 1), procure: defaultLoading(100, 1, 1),
          mech: defaultLoading(40, 0, 1), qa: defaultLoading(50, 1, 1),
          controls: defaultLoading(30, 0, 1), docs: defaultLoading(20, 0, 0)
      })},
      { phaseId: 'fab',      duration: 5, loading: buildLoad({
          pm: defaultLoading(60, 1, 1), mech: defaultLoading(50, 1, 1),
          procure: defaultLoading(45, 1, 1), qa: defaultLoading(90, 1, 1),
          controls: defaultLoading(50, 1, 1), docs: defaultLoading(25, 0, 0)
      })},
      { phaseId: 'install',  duration: 3, loading: buildLoad({
          pm: defaultLoading(70, 1, 1), install: defaultLoading(120, 1, 1),
          mech: defaultLoading(40, 0, 1), qa: defaultLoading(50, 1, 1),
          controls: defaultLoading(70, 1, 1), docs: defaultLoading(25, 0, 0)
      })},
      { phaseId: 'commiss',  duration: 4, loading: buildLoad({
          pm: defaultLoading(70, 1, 1), commiss: defaultLoading(130, 1, 1),
          install: defaultLoading(40, 0, 1), controls: defaultLoading(80, 1, 1),
          proc_eng: defaultLoading(90, 1, 1), docs: defaultLoading(40, 1, 1)
      })},
      { phaseId: 'warranty', duration: 12, loading: buildLoad({
          pm: defaultLoading(10, 1, 2), commiss: defaultLoading(15, 1, 2),
          proc_eng: defaultLoading(10, 0, 1), docs: defaultLoading(8, 0, 1)
      })}
    ]
  },
  {
    id: 'torre_comm', name: 'Torreactor Commercial Plant',
    description: 'Commercial-scale Torreactor (multi-line). Heaviest engineering load across portfolio; longest warranty.',
    defaultContractValue: 35000000,
    billingMode: 'milestone',
    milestones: deepCopyMilestones(DEFAULT_MILESTONE_SCHED),
    costLines: deepCopyMilestones(DEFAULT_COST_SCHED),
    phases: [
      { phaseId: 'sales',    duration: 6, loading: buildLoad({
          pm: defaultLoading(30, 1, 1), mech: defaultLoading(35, 1, 1),
          proc_eng: defaultLoading(55, 1, 1), procure: defaultLoading(10, 0, 1),
          controls: defaultLoading(15, 0, 1), docs: defaultLoading(25, 1, 1)
      })},
      { phaseId: 'pm',       duration: 2, loading: buildLoad({
          pm: defaultLoading(80, 1, 0), procure: defaultLoading(30, 0, 0),
          docs: defaultLoading(40, 1, 0)
      })},
      { phaseId: 'design',   duration: 9, loading: buildLoad({
          pm: defaultLoading(90, 1, 1), mech: defaultLoading(220, 1, 2),
          proc_eng: defaultLoading(200, 1, 2), controls: defaultLoading(140, 1, 1),
          qa: defaultLoading(40, 1, 1), docs: defaultLoading(90, 1, 1)
      })},
      { phaseId: 'procure',  duration: 6, loading: buildLoad({
          pm: defaultLoading(90, 1, 1), procure: defaultLoading(180, 1, 1),
          mech: defaultLoading(70, 0, 1), qa: defaultLoading(80, 1, 1),
          controls: defaultLoading(60, 1, 1), docs: defaultLoading(40, 0, 0)
      })},
      { phaseId: 'fab',      duration: 10, loading: buildLoad({
          pm: defaultLoading(100, 1, 2), mech: defaultLoading(80, 1, 2),
          procure: defaultLoading(80, 1, 2), qa: defaultLoading(160, 1, 2),
          controls: defaultLoading(90, 1, 1), docs: defaultLoading(40, 0, 1)
      })},
      { phaseId: 'install',  duration: 6, loading: buildLoad({
          pm: defaultLoading(120, 1, 1), install: defaultLoading(260, 1, 2),
          mech: defaultLoading(80, 1, 1), qa: defaultLoading(90, 1, 1),
          controls: defaultLoading(130, 1, 1), docs: defaultLoading(40, 0, 1)
      })},
      { phaseId: 'commiss',  duration: 5, loading: buildLoad({
          pm: defaultLoading(100, 1, 1), commiss: defaultLoading(220, 1, 1),
          install: defaultLoading(70, 0, 2), controls: defaultLoading(150, 1, 1),
          proc_eng: defaultLoading(120, 1, 1), docs: defaultLoading(60, 1, 1)
      })},
      { phaseId: 'warranty', duration: 24, loading: buildLoad({
          pm: defaultLoading(15, 1, 3), commiss: defaultLoading(20, 1, 3),
          proc_eng: defaultLoading(12, 1, 2), docs: defaultLoading(10, 0, 1)
      })}
    ]
  },
  {
    id: 'retrofit', name: 'Retrofit / Upgrade',
    description: 'Modification or upgrade to existing installation. Compressed schedule, no commissioning ramp.',
    defaultContractValue: 1800000,
    billingMode: 'milestone',
    milestones: deepCopyMilestones(RETROFIT_MILESTONE_SCHED),
    costLines: deepCopyMilestones(RETROFIT_COST_SCHED),
    phases: [
      { phaseId: 'sales',    duration: 2, loading: buildLoad({
          pm: defaultLoading(15, 0, 1), mech: defaultLoading(20, 0, 1),
          proc_eng: defaultLoading(15, 0, 1), procure: defaultLoading(5, 0, 0),
          docs: defaultLoading(10, 0, 0)
      })},
      { phaseId: 'pm',       duration: 1, loading: buildLoad({
          pm: defaultLoading(40, 0, 0), procure: defaultLoading(15, 0, 0),
          docs: defaultLoading(20, 0, 0)
      })},
      { phaseId: 'design',   duration: 3, loading: buildLoad({
          pm: defaultLoading(40, 1, 1), mech: defaultLoading(70, 1, 1),
          proc_eng: defaultLoading(50, 1, 1), controls: defaultLoading(50, 1, 1),
          qa: defaultLoading(15, 0, 1), docs: defaultLoading(30, 1, 1)
      })},
      { phaseId: 'procure',  duration: 2, loading: buildLoad({
          pm: defaultLoading(35, 0, 1), procure: defaultLoading(60, 1, 1),
          mech: defaultLoading(20, 0, 1), qa: defaultLoading(30, 0, 1),
          controls: defaultLoading(20, 0, 1), docs: defaultLoading(15, 0, 0)
      })},
      { phaseId: 'fab',      duration: 3, loading: buildLoad({
          pm: defaultLoading(40, 0, 1), mech: defaultLoading(25, 0, 1),
          procure: defaultLoading(30, 0, 1), qa: defaultLoading(60, 1, 1),
          controls: defaultLoading(30, 0, 1), docs: defaultLoading(15, 0, 0)
      })},
      { phaseId: 'install',  duration: 2, loading: buildLoad({
          pm: defaultLoading(50, 0, 1), install: defaultLoading(90, 1, 1),
          mech: defaultLoading(25, 0, 1), qa: defaultLoading(30, 0, 1),
          controls: defaultLoading(45, 1, 1), docs: defaultLoading(15, 0, 0)
      })},
      { phaseId: 'commiss',  duration: 1, loading: buildLoad({
          pm: defaultLoading(40, 0, 0), commiss: defaultLoading(80, 0, 0),
          install: defaultLoading(25, 0, 0), controls: defaultLoading(50, 0, 0),
          proc_eng: defaultLoading(30, 0, 0), docs: defaultLoading(25, 0, 0)
      })},
      { phaseId: 'warranty', duration: 6, loading: buildLoad({
          pm: defaultLoading(6, 0, 1), commiss: defaultLoading(4, 0, 1),
          docs: defaultLoading(4, 0, 1)
      })}
    ]
  }
];

/* ---------- State ---------- */

let state = {
  startMonth: monthKey(new Date()),
  roles: deepCopy(DEFAULT_ROLES),
  phases: deepCopy(DEFAULT_PHASES),
  templates: deepCopy(DEFAULT_TEMPLATES),
  locations: deepCopy(DEFAULT_LOCATIONS),
  projects: [],
  capacity: {}
};

/* ---------- Utilities ---------- */

function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
function deepCopyMilestones(arr) { return arr.map(m => Object.assign({}, m)); }
function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2,9); }

function horizonMonths() {
  const out = [];
  for (let i=0; i<36; i++) out.push(addMonths(state.startMonth, i));
  return out;
}

function getPhase(id) { return state.phases.find(p => p.id === id); }
function getRole(id)  { return state.roles.find(r => r.id === id); }
function getTemplate(id) { return state.templates.find(t => t.id === id); }
function getLocation(id) { return state.locations.find(l => l.id === id); }
function getProject(id) { return state.projects.find(p => p.id === id); }

/* ---------- Load curve calculation ---------- */
function computeLoadCurve(N, peak, rampUp, rampDown) {
  if (N <= 0 || peak <= 0) return new Array(Math.max(0,N)).fill(0);
  let R = Math.max(0, Math.min(rampUp, N));
  let D = Math.max(0, Math.min(rampDown, N - R));
  if (R + D > N) { const s = N/(R+D); R = Math.floor(R*s); D = N - R; }
  const flat = N - R - D;
  const out = [];
  for (let i = 0; i < R; i++) {
    const t = (i + 0.5) / R;
    out.push(peak * t);
  }
  for (let i = 0; i < flat; i++) out.push(peak);
  for (let i = 0; i < D; i++) {
    const t = 1 - (i + 0.5) / D;
    out.push(peak * t);
  }
  return out;
}

/* ---------- Compute effective phase durations applying location multiplier ----------
   We round to nearest integer month, with a minimum of 1 month for any non-zero phase.
*/
function effectivePhaseDurations(project) {
  const loc = getLocation(project.locationId);
  const mult = loc ? loc.multiplier : 1.0;
  return project.phases.map(ph => {
    if (ph.duration <= 0) return 0;
    const scaled = ph.duration * mult;
    return Math.max(1, Math.round(scaled));
  });
}

/* ---------- Compute demand per role per month across portfolio ---------- */
function computeAllDemand() {
  const demand = {};
  for (const r of state.roles) demand[r.id] = new Array(36).fill(0);
  const projectDemand = {};

  for (const proj of state.projects) {
    projectDemand[proj.id] = {};
    for (const r of state.roles) projectDemand[proj.id][r.id] = new Array(36).fill(0);

    const effDurs = effectivePhaseDurations(proj);
    let cursor = proj.startMonth;
    proj.phases.forEach((ph, phIdx) => {
      const N = effDurs[phIdx];
      for (const r of state.roles) {
        const ld = ph.loading[r.id] || defaultLoading(0,0,0);
        // Ramp months also scale with location? Yes — scaled durations need scaled ramps proportionally.
        const origDur = ph.duration || 1;
        const rampUpScaled = N > 0 ? Math.round(ld.rampUp * (N / origDur)) : 0;
        const rampDownScaled = N > 0 ? Math.round(ld.rampDown * (N / origDur)) : 0;
        const curve = computeLoadCurve(N, ld.peak, rampUpScaled, rampDownScaled);
        for (let k = 0; k < N; k++) {
          const mKey = addMonths(cursor, k);
          const mIdx = monthsBetween(state.startMonth, mKey);
          if (mIdx >= 0 && mIdx < 36) {
            const fte = curve[k] / 100;
            demand[r.id][mIdx] += fte;
            projectDemand[proj.id][r.id][mIdx] += fte;
          }
        }
      }
      cursor = addMonths(cursor, N);
    });
  }

  return { demand, projectDemand };
}

function totalEffectiveDuration(p) {
  return effectivePhaseDurations(p).reduce((a,b)=>a+b,0);
}

/* ---------- Compute the absolute month index when each phase ENDS, relative to state.startMonth ----------
   Useful for resolving milestone anchors.
   Returns map: phaseId -> { startIdx, endIdx } (one entry per phase; if multiple of same id, the first wins,
   which is fine since templates don't repeat phases)
*/
function projectPhaseBoundaries(proj) {
  const effDurs = effectivePhaseDurations(proj);
  const out = {};
  let cursor = proj.startMonth;
  proj.phases.forEach((ph, i) => {
    const startKey = cursor;
    const startIdx = monthsBetween(state.startMonth, startKey);
    const endKey = addMonths(cursor, effDurs[i]);
    const endIdx = monthsBetween(state.startMonth, endKey);
    if (!out[ph.phaseId]) {
      out[ph.phaseId] = { startIdx, endIdx, startKey, endKey };
    }
    cursor = endKey;
  });
  // also project start/end
  out['_start'] = { startIdx: monthsBetween(state.startMonth, proj.startMonth), endIdx: monthsBetween(state.startMonth, proj.startMonth) };
  out['_end']   = { startIdx: monthsBetween(state.startMonth, cursor), endIdx: monthsBetween(state.startMonth, cursor) };
  return out;
}

/* ---------- Compute a project's monthly cashflow ----------
   Returns:
     { cashIn[36]: number,        // cash received in each month
       revenueRecognized[36]: number,  // revenue recognized in each month
       cumCash[36], cumRevenue[36] }

   billingMode:
     'milestone' — cash hits in the month each milestone resolves
     'monthly'   — total spread evenly across effective duration (cash = revenue)
     'accrual_poc' — revenue smooth (% of FTE-months consumed × contract value); cash from milestones if defined,
                     otherwise mirrors revenue

   Anchor resolution:
     'start' -> project start month
     'end'   -> month immediately after final phase
     phaseId -> month at which that phase completes (startKey + duration)
   offsetMonths is added to the anchor month.
*/
function computeProjectCashflow(proj) {
  const cashIn = new Array(36).fill(0);
  const revenueRecognized = new Array(36).fill(0);
  const costOut = new Array(36).fill(0);
  const netCash = new Array(36).fill(0);
  const cumCash = new Array(36).fill(0);
  const cumRevenue = new Array(36).fill(0);
  const cumCost = new Array(36).fill(0);
  const cumNet = new Array(36).fill(0);

  const cv = (proj.contractValue != null) ? proj.contractValue : 0;
  const boundaries = projectPhaseBoundaries(proj);
  const bm = proj.billingMode || 'milestone';

  // ---- CASH IN ----
  if (cv > 0) {
    if (bm === 'monthly') {
      const effDur = totalEffectiveDuration(proj);
      if (effDur > 0) {
        const startIdx = monthsBetween(state.startMonth, proj.startMonth);
        const per = cv / effDur;
        for (let k = 0; k < effDur; k++) {
          const mi = startIdx + k;
          if (mi >= 0 && mi < 36) cashIn[mi] += per;
        }
      }
    } else {
      const ms = proj.milestones || [];
      const totalPct = ms.reduce((a,m)=>a+(m.percent||0), 0);
      const scale = totalPct > 0 ? (100 / totalPct) : 1;
      for (const milestone of ms) {
        const pct = (milestone.percent || 0) * (totalPct === 100 ? 1 : scale);
        const amount = cv * pct / 100;
        let anchorKey;
        const a = milestone.anchor;
        if (a === 'start') anchorKey = proj.startMonth;
        else if (a === '_end' || a === 'end') anchorKey = addMonths(state.startMonth, boundaries._end.endIdx);
        else {
          const b = boundaries[a];
          if (!b) continue;
          anchorKey = addMonths(addMonths(state.startMonth, b.endIdx), -1);
        }
        const targetKey = addMonths(anchorKey, milestone.offsetMonths || 0);
        const mi = monthsBetween(state.startMonth, targetKey);
        if (mi >= 0 && mi < 36) cashIn[mi] += amount;
      }
    }

    // ---- REVENUE RECOGNIZED ----
    if (bm === 'milestone') {
      for (let i = 0; i < 36; i++) revenueRecognized[i] = cashIn[i];
    } else if (bm === 'monthly') {
      for (let i = 0; i < 36; i++) revenueRecognized[i] = cashIn[i];
    } else if (bm === 'accrual_poc') {
      const { projectDemand } = computeAllDemand();
      const projDem = projectDemand[proj.id];
      const monthlyFTE = new Array(36).fill(0);
      let totalFTEm = 0;
      for (let i = 0; i < 36; i++) {
        for (const r of state.roles) monthlyFTE[i] += (projDem[r.id][i] || 0);
        totalFTEm += monthlyFTE[i];
      }
      if (totalFTEm > 0) {
        for (let i = 0; i < 36; i++) revenueRecognized[i] = cv * (monthlyFTE[i] / totalFTEm);
      } else {
        const effDur = totalEffectiveDuration(proj);
        if (effDur > 0) {
          const startIdx = monthsBetween(state.startMonth, proj.startMonth);
          const per = cv / effDur;
          for (let k = 0; k < effDur; k++) {
            const mi = startIdx + k;
            if (mi >= 0 && mi < 36) revenueRecognized[mi] = per;
          }
        }
      }
    }
  }

  // ---- COST OUT (reverse milestones with $ amounts) ----
  const costs = proj.costLines || [];
  for (const cl of costs) {
    const amount = cl.amount || 0;
    if (amount <= 0) continue;
    let anchorKey;
    const a = cl.anchor;
    if (a === 'start') anchorKey = proj.startMonth;
    else if (a === '_end' || a === 'end') anchorKey = addMonths(state.startMonth, boundaries._end.endIdx);
    else {
      const b = boundaries[a];
      if (!b) continue;
      anchorKey = addMonths(addMonths(state.startMonth, b.endIdx), -1);
    }
    const targetKey = addMonths(anchorKey, cl.offsetMonths || 0);
    const mi = monthsBetween(state.startMonth, targetKey);
    if (mi >= 0 && mi < 36) costOut[mi] += amount;
  }

  // ---- Net + Cumulative ----
  let c = 0, r = 0, co = 0, n = 0;
  for (let i = 0; i < 36; i++) {
    netCash[i] = cashIn[i] - costOut[i];
    c += cashIn[i]; cumCash[i] = c;
    r += revenueRecognized[i]; cumRevenue[i] = r;
    co += costOut[i]; cumCost[i] = co;
    n += netCash[i]; cumNet[i] = n;
  }

  return { cashIn, revenueRecognized, costOut, netCash, cumCash, cumRevenue, cumCost, cumNet };
}

/* ---------- Compute portfolio cashflow (sum across projects) ---------- */
function computePortfolioCashflow() {
  const cashIn = new Array(36).fill(0);
  const revenueRecognized = new Array(36).fill(0);
  const costOut = new Array(36).fill(0);
  const netCash = new Array(36).fill(0);
  const perProject = {};
  for (const p of state.projects) {
    const cf = computeProjectCashflow(p);
    perProject[p.id] = cf;
    for (let i = 0; i < 36; i++) {
      cashIn[i] += cf.cashIn[i];
      revenueRecognized[i] += cf.revenueRecognized[i];
      costOut[i] += cf.costOut[i];
      netCash[i] += cf.netCash[i];
    }
  }
  const cumCash = new Array(36).fill(0);
  const cumRevenue = new Array(36).fill(0);
  const cumCost = new Array(36).fill(0);
  const cumNet = new Array(36).fill(0);
  let c = 0, r = 0, co = 0, n = 0;
  for (let i = 0; i < 36; i++) {
    c += cashIn[i]; cumCash[i] = c;
    r += revenueRecognized[i]; cumRevenue[i] = r;
    co += costOut[i]; cumCost[i] = co;
    n += netCash[i]; cumNet[i] = n;
  }
  return { cashIn, revenueRecognized, costOut, netCash, cumCash, cumRevenue, cumCost, cumNet, perProject };
}

/* ---------- Currency formatting ---------- */
function fmtMoney(n, opts) {
  opts = opts || {};
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (opts.compact || abs >= 1e6) {
    if (abs >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (n/1e3).toFixed(0) + 'k';
  }
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* ---------- Win-probability → pipeline stage label and color ---------- */
function winProbStageLabel(p) {
  if (p >= 100) return '✓ Booked / Contract signed (100%)';
  if (p >= 85)  return 'Awarded · finalizing contract (' + p + '%)';
  if (p >= 65)  return 'Verbal / LOI · high confidence (' + p + '%)';
  if (p >= 40)  return 'Active proposal · in negotiation (' + p + '%)';
  if (p >= 20)  return 'Qualified opportunity (' + p + '%)';
  if (p >= 5)   return 'Early lead · low confidence (' + p + '%)';
  return 'Cold / parked (' + p + '%)';
}
function winProbColor(p) {
  if (p >= 85)  return '#6E8C34';  // green
  if (p >= 50)  return '#00929F';  // teal
  if (p >= 25)  return '#C4A230';  // amber
  return '#C05234';                 // coral
}

/* ---------- Persistence ---------- */

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Save failed', e); }
}
function loadState() {
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
    }
    if (!state.locations) state.locations = deepCopy(DEFAULT_LOCATIONS);
    return true;
  } catch (e) {
    console.error('Load failed', e);
    return false;
  }
}

/* ---------- Seed sample data ---------- */

function seedSampleProjects() {
  const today = new Date();
  const m0 = monthKey(today);

  function seed(name, client, location, locationId, templateId, startMonth, notes, contractValue, winProb) {
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
      winProbability: winProb != null ? winProb : 100
    };
  }

  state.projects = [
    seed('Northwest Pellet Co. — Dryer #2', 'Northwest Pellet Co.', 'Spokane, WA', 'us',
         'dryer_small', addMonths(m0, -2),
         'Standard drum dryer, mid-tier complexity. Contract signed Q1.', 3500000, 100),
    seed('Austwood Vietnam — Torreactor', 'Austwood', 'Binh Phuoc, Vietnam', 'vn_sea',
         'torre_comm', addMonths(m0, 1),
         'Commercial Torreactor, local fab partner. LOI received, finalizing terms.', 28000000, 75),
    seed('Lighthouse Green Fuels', 'Alfanar', 'Stockton-on-Tees, UK', 'uk',
         'torre_comm', addMonths(m0, 4),
         'UK SAF feedstock torrefaction. Active in PQQ stage with consortium.', 42000000, 40),
    seed('TBD FEED — European Customer', 'Confidential', 'Germany', 'eu',
         'feed', addMonths(m0, 2),
         'FEED study for a torrefaction plant. NDA signed, scoping discussions ongoing.', 480000, 60)
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
   UI WIRING
   ============================================================ */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> t.classList.remove('show'), 2400);
}

/* ---------- Tab switching ---------- */
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const v = tab.dataset.view;
    $$('.view').forEach(view => view.classList.remove('active'));
    $('#view-'+v).classList.add('active');
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
      state = obj;
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
  state = {
    startMonth: monthKey(new Date()),
    roles: deepCopy(DEFAULT_ROLES),
    phases: deepCopy(DEFAULT_PHASES),
    templates: deepCopy(DEFAULT_TEMPLATES),
    locations: deepCopy(DEFAULT_LOCATIONS),
    projects: [],
    capacity: {}
  };
  seedSampleProjects();
  saveState();
  renderAll();
  toast('Reset to defaults');
});

/* ============================================================
   PROJECTS VIEW
   ============================================================ */

function renderProjects() {
  const grid = $('#project-grid');
  grid.innerHTML = '';

  for (const p of state.projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const tpl = getTemplate(p.templateId);
    const loc = getLocation(p.locationId);
    const effDur = totalEffectiveDuration(p);
    const endMonth = addMonths(p.startMonth, effDur);
    const wp = p.winProbability != null ? p.winProbability : 100;
    const wpColor = winProbColor(wp);
    card.innerHTML = `
      <div class="project-card-actions">
        <button class="btn small danger" data-act="del" data-id="${p.id}">Del</button>
      </div>
      <div class="project-card-tags">
        <span class="tag template">${tpl ? escapeHtml(tpl.name) : 'custom'}</span>
        ${loc ? `<span class="tag location">${escapeHtml(loc.name)}</span>` : ''}
        ${loc && loc.multiplier !== 1.0 ? `<span class="tag multiplier">${loc.multiplier.toFixed(2)}×</span>` : ''}
        <span class="tag" style="background:${wpColor};color:#fff">${wp}% · ${wp >= 100 ? 'booked' : wp >= 85 ? 'awarded' : wp >= 65 ? 'LOI' : wp >= 40 ? 'proposal' : wp >= 20 ? 'qualified' : 'lead'}</span>
        ${p.pinned ? '<span class="tag" style="background:var(--coral);color:#fff">🔒 locked</span>' : ''}
      </div>
      <div class="project-card-name">${escapeHtml(p.name)}</div>
      <div class="project-card-meta">${escapeHtml(p.client || '—')} · ${escapeHtml(p.location || '')}</div>
      <div class="project-card-dates">
        <span>${monthLabel(p.startMonth)}</span>
        <span style="color:var(--teal)">→</span>
        <span>${monthLabel(endMonth)}</span>
        <span style="color:var(--gray)">${effDur} mo</span>
      </div>
      <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:baseline;font-size:11px">
        <span style="color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Contract</span>
        <span class="mono" style="font-weight:600;color:var(--ink-strong)">${fmtMoney(p.contractValue || 0, {compact:true})}</span>
      </div>
      ${wp < 100 ? `
      <div style="margin-top:4px;display:flex;justify-content:space-between;align-items:baseline;font-size:11px">
        <span style="color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Risk-weighted</span>
        <span class="mono" style="font-weight:600;color:${wpColor}">${fmtMoney((p.contractValue||0) * wp / 100, {compact:true})}</span>
      </div>` : ''}
    `;
    card.addEventListener('click', (e) => {
      if (e.target.dataset.act === 'del') {
        e.stopPropagation();
        if (confirm(`Delete project "${p.name}"?`)) {
          state.projects = state.projects.filter(x => x.id !== p.id);
          saveState(); renderAll();
        }
        return;
      }
      openProjectModal(p.id);
    });
    grid.appendChild(card);
  }

  // Add card
  const add = document.createElement('div');
  add.className = 'project-card add';
  add.innerHTML = '<div><div style="font-family:var(--font-display);font-size:32px;line-height:1">+</div><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;margin-top:6px;font-weight:600">New Project</div></div>';
  add.addEventListener('click', () => openProjectModal(null));
  grid.appendChild(add);

  renderKPIs();
}

function renderKPIs() {
  const row = $('#kpi-row');
  row.innerHTML = '';

  const { demand } = computeAllDemand();
  const horizon = horizonMonths();

  let totalFTEMonths = 0;
  const peakByMonth = new Array(36).fill(0);
  for (const r of state.roles) {
    for (let i = 0; i < 36; i++) {
      totalFTEMonths += demand[r.id][i];
      peakByMonth[i] += demand[r.id][i];
    }
  }
  const peakMonthIdx = peakByMonth.indexOf(Math.max(...peakByMonth));
  const peakMonth = horizon[peakMonthIdx];
  const peakFTE = peakByMonth[peakMonthIdx];

  let totalCap = 0, overMonths = 0;
  for (let i = 0; i < 36; i++) {
    let monthCap = 0, monthDem = 0;
    for (const r of state.roles) {
      const cap = (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
      totalCap += cap;
      monthCap += cap;
      monthDem += demand[r.id][i];
    }
    if (monthDem > monthCap) overMonths++;
  }

  const utilPct = totalCap > 0 ? (totalFTEMonths / totalCap * 100) : 0;

  const cards = [
    { label: 'Projects', value: state.projects.length, sub: 'in portfolio' },
    { label: 'Demand', value: totalFTEMonths.toFixed(0), sub: 'FTE-months · 36mo' },
    { label: 'Peak Load', value: peakFTE.toFixed(1), sub: 'FTE in ' + (peakMonthIdx >= 0 ? monthLabel(peakMonth) : '—') },
    { label: 'Utilization', value: utilPct.toFixed(0) + '%',
      sub: 'demand ÷ capacity',
      cls: utilPct > 100 ? 'bad' : utilPct > 85 ? 'warn' : 'ok' },
    { label: 'Over-Alloc', value: overMonths,
      sub: 'months exceed capacity',
      cls: overMonths > 6 ? 'bad' : overMonths > 0 ? 'warn' : 'ok' }
  ];

  for (const c of cards) {
    const el = document.createElement('div');
    el.className = 'kpi-card ' + (c.cls || '');
    el.innerHTML = `
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value ${c.cls||''}">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    `;
    row.appendChild(el);
  }
}

/* ---------- Project modal ---------- */

let currentProjectId = null;

function openProjectModal(projectId) {
  currentProjectId = projectId;
  const isNew = !projectId;
  let p;
  if (isNew) {
    const tpl = state.templates[0];
    p = {
      id: uid('proj'),
      name: 'New Project',
      client: '',
      location: '',
      locationId: 'us',
      templateId: tpl.id,
      startMonth: monthKey(new Date()),
      notes: '',
      phases: deepCopy(tpl.phases)
    };
  } else {
    p = deepCopy(getProject(projectId));
    if (!p.locationId) p.locationId = 'us';
  }

  $('#modal-project-title').textContent = isNew ? 'New Project' : 'Edit: ' + p.name;
  const body = $('#modal-project-body');
  body.innerHTML = buildProjectForm(p);
  $('#modal-project').classList.add('open');

  wireProjectForm(p);
  $('#modal-project-save').onclick = () => {
    const out = readProjectForm(p);
    if (!out.name.trim()) { alert('Name required'); return; }
    if (isNew) state.projects.push(out);
    else {
      const idx = state.projects.findIndex(x => x.id === out.id);
      state.projects[idx] = out;
    }
    saveState();
    closeProjectModal();
    renderAll();
    toast(isNew ? 'Project created' : 'Project saved');
  };
}

function closeProjectModal() {
  $('#modal-project').classList.remove('open');
  currentProjectId = null;
}
$('#modal-project-close').addEventListener('click', closeProjectModal);
$('#modal-project-cancel').addEventListener('click', closeProjectModal);

function buildProjectForm(p) {
  const tplOptions = state.templates.map(t =>
    `<option value="${t.id}" ${t.id===p.templateId?'selected':''}>${escapeHtml(t.name)}</option>`
  ).join('');
  const locOptions = state.locations.map(l =>
    `<option value="${l.id}" ${l.id===p.locationId?'selected':''}>${escapeHtml(l.name)} (${l.multiplier.toFixed(2)}×)</option>`
  ).join('');

  const loc = getLocation(p.locationId);
  const mult = loc ? loc.multiplier : 1.0;

  let phasesHTML = '<table class="phase-table"><thead><tr>' +
    '<th style="width:30px">#</th>' +
    '<th>Phase</th>' +
    '<th style="width:95px">Base Dur (mo)</th>' +
    '<th style="width:95px">Effective (mo)</th>' +
    '<th>Role Loading (Peak% / Ramp Up / Ramp Down)</th>' +
    '</tr></thead><tbody>';
  p.phases.forEach((ph, idx) => {
    const phMeta = getPhase(ph.phaseId);
    const effDur = ph.duration > 0 ? Math.max(1, Math.round(ph.duration * mult)) : 0;
    phasesHTML += `
      <tr data-phase-idx="${idx}">
        <td>${idx+1}</td>
        <td class="phase-name">
          <span class="phase-color-dot" style="background:${phMeta?phMeta.color:'#999'}"></span>${escapeHtml(phMeta?phMeta.name:ph.phaseId)}
        </td>
        <td><input type="number" min="0" step="1" class="ph-duration" value="${ph.duration}"></td>
        <td><span class="eff-dur mono" style="color:var(--teal);font-weight:600">${effDur}</span></td>
        <td>
          <details>
            <summary>Edit loading (${countActiveRoles(ph.loading)} roles active)</summary>
            <div class="role-load-grid">
              <div class="head">Role</div>
              <div class="head">Peak %</div>
              <div class="head">Ramp Up (mo)</div>
              <div class="head">Ramp Down (mo)</div>
              ${state.roles.map(r => {
                const ld = ph.loading[r.id] || defaultLoading(0,0,0);
                return `
                  <div>${escapeHtml(r.name)}</div>
                  <div><input type="number" min="0" step="1" class="rl" data-role="${r.id}" data-field="peak" value="${ld.peak}"></div>
                  <div><input type="number" min="0" step="1" class="rl" data-role="${r.id}" data-field="rampUp" value="${ld.rampUp}"></div>
                  <div><input type="number" min="0" step="1" class="rl" data-role="${r.id}" data-field="rampDown" value="${ld.rampDown}"></div>
                `;
              }).join('')}
            </div>
          </details>
        </td>
      </tr>
    `;
  });
  phasesHTML += '</tbody></table>';

  return `
    <div class="field-row">
      <div class="field"><label>Project Name</label><input type="text" id="pf-name" value="${escapeHtml(p.name)}"></div>
      <div class="field"><label>Client</label><input type="text" id="pf-client" value="${escapeHtml(p.client||'')}"></div>
      <div class="field"><label>Location (city/region)</label><input type="text" id="pf-location" value="${escapeHtml(p.location||'')}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Template</label>
        <select id="pf-template">${tplOptions}</select>
        <div class="helper">Changing template will reload phases from defaults.</div>
      </div>
      <div class="field"><label>Country / Region</label>
        <select id="pf-loc-id">${locOptions}</select>
        <div class="helper">Applies a speed multiplier to all phase durations.</div>
      </div>
      <div class="field"><label>Start Month (YYYY-MM)</label>
        <input type="month" id="pf-start" value="${p.startMonth}">
      </div>
      <div class="field"><label>Total Effective Duration</label>
        <input type="text" id="pf-total" readonly value="${totalEffectiveDuration(p)} mo (${p.phases.reduce((a,x)=>a+x.duration,0)} base × ${mult.toFixed(2)})" style="background:var(--warm-white);font-family:var(--font-mono);font-weight:600;color:var(--ink-strong)">
      </div>
    </div>
    <div class="field-row">
      <div class="field" style="flex:2"><label>Win Probability (Pipeline Stage)</label>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="range" id="pf-winprob" min="0" max="100" step="5" value="${p.winProbability != null ? p.winProbability : 100}" style="flex:1">
          <input type="number" id="pf-winprob-num" min="0" max="100" step="5" value="${p.winProbability != null ? p.winProbability : 100}" class="mono" style="width:70px;text-align:right">
          <span style="color:var(--ink-mute)">%</span>
        </div>
        <div class="helper" id="pf-winprob-stage">${winProbStageLabel(p.winProbability != null ? p.winProbability : 100)}</div>
      </div>
      <div class="field"><label>Risk-Weighted Revenue</label>
        <input type="text" id="pf-weighted-rev" readonly value="${fmtMoney((p.contractValue||0) * (p.winProbability != null ? p.winProbability : 100) / 100)}" style="background:var(--warm-white);font-family:var(--font-mono);font-weight:600;color:var(--ink-strong)">
        <div class="helper">Contract × win prob — used for portfolio forecasting</div>
      </div>
    </div>
    <div class="field"><label>Notes</label><textarea id="pf-notes" rows="2">${escapeHtml(p.notes||'')}</textarea></div>

    <div class="section-label" style="margin-top:20px">Commercial · Contract &amp; Billing</div>
    ${buildBillingSection(p)}

    <div class="section-label" style="margin-top:20px">Phases · Role Loading Curves</div>
    <div id="pf-phases">${phasesHTML}</div>
  `;
}

/* ---------- Billing section builder ---------- */
function buildBillingSection(p) {
  const cv = p.contractValue || 0;
  const bm = p.billingMode || 'milestone';
  const ms = p.milestones || [];
  const pctSum = ms.reduce((a,m)=>a+(m.percent||0), 0);
  const sumStatusColor = Math.abs(pctSum - 100) < 0.01 ? 'var(--succ-green)' : 'var(--coral)';
  const sumStatusText = Math.abs(pctSum - 100) < 0.01 ? 'OK' : (pctSum > 100 ? 'exceeds 100%' : 'short of 100%');

  // Build anchor option list: 'start', phases in this project, then '_end'
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });

  let milestonesHTML = '';
  if (bm === 'milestone' || bm === 'accrual_poc') {
    milestonesHTML = `
      <div id="pf-milestone-block" style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <div class="section-label" style="margin:0">Milestone Schedule</div>
          <div style="font-size:11px"><span style="color:var(--ink-mute)">Sum:</span> <span id="pf-pct-sum" style="color:${sumStatusColor};font-weight:700;font-family:var(--font-mono)">${pctSum.toFixed(1)}%</span> <span id="pf-pct-status" style="color:${sumStatusColor};font-size:10px">${sumStatusText}</span></div>
        </div>
        <table class="phase-table" style="width:100%">
          <thead>
            <tr>
              <th>Milestone Name</th>
              <th style="width:180px">Anchor</th>
              <th style="width:100px">Offset (mo)</th>
              <th style="width:90px">Percent</th>
              <th style="width:120px">$ Amount</th>
              <th style="width:40px"></th>
            </tr>
          </thead>
          <tbody id="pf-ms-tbody">
            ${ms.map((m, i) => renderMilestoneRow(m, i, anchorOpts, cv)).join('')}
          </tbody>
        </table>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button type="button" class="btn ghost small" id="pf-add-ms">+ Add Milestone</button>
          <button type="button" class="btn ghost small" id="pf-load-default-ms">Load Default 10/30/30/20/10</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="field-row">
      <div class="field"><label>Total Contract Value (USD)</label>
        <input type="number" id="pf-cv" min="0" step="10000" value="${cv}" class="mono">
        <div class="helper" id="pf-cv-display">${fmtMoney(cv)}</div>
      </div>
      <div class="field"><label>Billing Mode</label>
        <select id="pf-billing-mode">
          <option value="milestone" ${bm==='milestone'?'selected':''}>Milestone · Cash (revenue lumpy on payment date)</option>
          <option value="accrual_poc" ${bm==='accrual_poc'?'selected':''}>Milestone + Accrual POC (cash lumpy, revenue smooth)</option>
          <option value="monthly" ${bm==='monthly'?'selected':''}>Continuous Monthly (cash = revenue, evenly spread)</option>
        </select>
        <div class="helper">${bm === 'milestone' ? 'Cash and revenue recognized together at milestone payment dates.' : bm === 'accrual_poc' ? 'Cash flows on milestone dates; revenue earned smoothly proportional to FTE-months consumed (percentage of completion).' : 'Total value divided evenly across the project duration. No milestone schedule used.'}</div>
      </div>
    </div>
    ${milestonesHTML}
    ${buildCostSection(p)}
  `;
}

function buildCostSection(p) {
  const costs = p.costLines || [];
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });
  const totalCost = costs.reduce((a,c) => a + (c.amount||0), 0);
  const cv = p.contractValue || 0;
  const grossMargin = cv > 0 ? ((cv - totalCost) / cv * 100) : 0;
  const marginColor = grossMargin >= 20 ? 'var(--succ-green)' : grossMargin >= 10 ? 'var(--amber)' : 'var(--coral)';

  return `
    <div id="pf-cost-block" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <div class="section-label" style="margin:0">Cost Outflows · $ at month anchored to phase</div>
        <div style="font-size:11px;display:flex;gap:14px">
          <span><span style="color:var(--ink-mute)">Total cost:</span> <span id="pf-cost-total" class="mono" style="font-weight:700;color:var(--coral)">${fmtMoney(totalCost)}</span></span>
          <span><span style="color:var(--ink-mute)">Gross margin:</span> <span id="pf-margin" class="mono" style="font-weight:700;color:${marginColor}">${cv > 0 ? grossMargin.toFixed(1)+'%' : '—'}</span></span>
        </div>
      </div>
      <table class="phase-table" style="width:100%">
        <thead>
          <tr>
            <th>Cost Item</th>
            <th style="width:180px">Anchor</th>
            <th style="width:100px">Offset (mo)</th>
            <th style="width:140px">$ Amount</th>
            <th style="width:40px"></th>
          </tr>
        </thead>
        <tbody id="pf-cl-tbody">
          ${costs.map((c, i) => renderCostRow(c, i, anchorOpts)).join('')}
        </tbody>
      </table>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button type="button" class="btn ghost small" id="pf-add-cl">+ Add Cost Line</button>
        <button type="button" class="btn ghost small" id="pf-load-default-cl">Load Standard Cost Lines</button>
      </div>
    </div>
  `;
}

function renderCostRow(c, i, anchorOpts) {
  const opts = anchorOpts.map(a => `<option value="${a.value}" ${a.value===c.anchor?'selected':''}>${escapeHtml(a.label)}</option>`).join('');
  return `
    <tr data-cl-idx="${i}">
      <td><input type="text" class="cl-name" value="${escapeHtml(c.name||'')}"></td>
      <td><select class="cl-anchor">${opts}</select></td>
      <td><input type="number" class="cl-offset mono" step="1" value="${c.offsetMonths||0}"></td>
      <td><input type="number" class="cl-amount mono" step="10000" min="0" value="${c.amount||0}" style="text-align:right"></td>
      <td style="text-align:center"><button type="button" class="btn danger small cl-del">×</button></td>
    </tr>
  `;
}

function renderMilestoneRow(m, i, anchorOpts, cv) {
  const pct = m.percent || 0;
  const amount = cv > 0 ? (cv * pct / 100) : 0;
  const opts = anchorOpts.map(a => `<option value="${a.value}" ${a.value===m.anchor?'selected':''}>${escapeHtml(a.label)}</option>`).join('');
  return `
    <tr data-ms-idx="${i}">
      <td><input type="text" class="ms-name" value="${escapeHtml(m.name||'')}"></td>
      <td><select class="ms-anchor">${opts}</select></td>
      <td><input type="number" class="ms-offset mono" step="1" value="${m.offsetMonths||0}"></td>
      <td><input type="number" class="ms-pct mono" step="1" min="0" max="100" value="${pct}" style="text-align:right"></td>
      <td><span class="ms-amount mono" style="font-weight:600;color:var(--ink-strong)">${fmtMoney(amount)}</span></td>
      <td style="text-align:center"><button type="button" class="btn danger small ms-del">×</button></td>
    </tr>
  `;
}

function countActiveRoles(loading) {
  return Object.values(loading).filter(l => l.peak > 0).length;
}

function wireProjectForm(p) {
  const tplSel = $('#pf-template');
  tplSel.addEventListener('change', () => {
    if (!confirm('Loading a template will replace this project\'s phases with the template defaults. Continue?\n\nNote: contract value, billing schedule, and cost lines will also be reset to the template defaults.')) {
      tplSel.value = p.templateId; return;
    }
    p.templateId = tplSel.value;
    const tpl = getTemplate(p.templateId);
    p.phases = deepCopy(tpl.phases);
    if (tpl.defaultContractValue != null) p.contractValue = tpl.defaultContractValue;
    if (tpl.billingMode) p.billingMode = tpl.billingMode;
    if (tpl.milestones) p.milestones = deepCopyMilestones(tpl.milestones);
    if (tpl.costLines) p.costLines = deepCopyMilestones(tpl.costLines);
    const body = $('#modal-project-body');
    body.innerHTML = buildProjectForm(p);
    wireProjectForm(p);
  });

  const locSel = $('#pf-loc-id');
  locSel.addEventListener('change', () => {
    p.locationId = locSel.value;
    updateEffDurs(p);
  });

  wireProjectFormPhases(p);
  wireBillingForm(p);
  wireWinProbForm(p);
}

function wireWinProbForm(p) {
  const slider = $('#pf-winprob');
  const num = $('#pf-winprob-num');
  const stage = $('#pf-winprob-stage');
  const wrev = $('#pf-weighted-rev');
  if (!slider || !num) return;
  const sync = (v) => {
    v = Math.max(0, Math.min(100, parseInt(v || '0', 10)));
    p.winProbability = v;
    slider.value = v;
    num.value = v;
    if (stage) stage.textContent = winProbStageLabel(v);
    if (wrev) wrev.value = fmtMoney((p.contractValue||0) * v / 100);
  };
  slider.addEventListener('input', () => sync(slider.value));
  num.addEventListener('input', () => sync(num.value));
}

/* ---------- Billing form wiring ---------- */
function wireBillingForm(p) {
  const cvInp = $('#pf-cv');
  const bmSel = $('#pf-billing-mode');

  if (cvInp) {
    cvInp.addEventListener('input', () => {
      p.contractValue = Math.max(0, parseFloat(cvInp.value || '0'));
      const dispEl = $('#pf-cv-display');
      if (dispEl) dispEl.textContent = fmtMoney(p.contractValue);
      refreshMilestoneAmounts(p);
      refreshCostTotals(p);
      const wrev = $('#pf-weighted-rev');
      if (wrev) wrev.value = fmtMoney(p.contractValue * (p.winProbability != null ? p.winProbability : 100) / 100);
    });
  }
  if (bmSel) {
    bmSel.addEventListener('change', () => {
      p.billingMode = bmSel.value;
      // Re-render billing section since milestone block visibility depends on mode
      // Find the billing block parent (.section-label "Commercial..." + next siblings)
      // Easier: re-render whole form
      const body = $('#modal-project-body');
      body.innerHTML = buildProjectForm(p);
      wireProjectForm(p);
    });
  }
  wireMilestoneRows(p);
  const addBtn = $('#pf-add-ms');
  if (addBtn) addBtn.addEventListener('click', () => {
    if (!p.milestones) p.milestones = [];
    p.milestones.push({ name: 'New Milestone', anchor: 'start', offsetMonths: 0, percent: 0 });
    refreshMilestoneTable(p);
  });
  const defBtn = $('#pf-load-default-ms');
  if (defBtn) defBtn.addEventListener('click', () => {
    if (!confirm('Replace current milestone schedule with the default 10/30/30/20/10 schedule?')) return;
    p.milestones = deepCopyMilestones(DEFAULT_MILESTONE_SCHED);
    refreshMilestoneTable(p);
  });

  // Cost line wiring
  wireCostRows(p);
  const addCl = $('#pf-add-cl');
  if (addCl) addCl.addEventListener('click', () => {
    if (!p.costLines) p.costLines = [];
    p.costLines.push({ name: 'New Cost Line', anchor: 'fab', offsetMonths: 0, amount: 0 });
    refreshCostTable(p);
  });
  const loadCl = $('#pf-load-default-cl');
  if (loadCl) loadCl.addEventListener('click', () => {
    if (!confirm('Replace current cost lines with the standard schedule (Design / Equipment / Installation / Commissioning)?')) return;
    p.costLines = deepCopyMilestones(DEFAULT_COST_SCHED);
    refreshCostTable(p);
  });
}

function wireCostRows(p) {
  $$('#pf-cl-tbody tr').forEach(tr => {
    const idx = parseInt(tr.dataset.clIdx, 10);
    tr.querySelector('.cl-name').addEventListener('input', (e) => {
      p.costLines[idx].name = e.target.value;
    });
    tr.querySelector('.cl-anchor').addEventListener('change', (e) => {
      p.costLines[idx].anchor = e.target.value;
    });
    tr.querySelector('.cl-offset').addEventListener('input', (e) => {
      p.costLines[idx].offsetMonths = parseInt(e.target.value || '0', 10);
    });
    tr.querySelector('.cl-amount').addEventListener('input', (e) => {
      p.costLines[idx].amount = Math.max(0, parseFloat(e.target.value || '0'));
      refreshCostTotals(p);
    });
    tr.querySelector('.cl-del').addEventListener('click', () => {
      p.costLines.splice(idx, 1);
      refreshCostTable(p);
    });
  });
}

function refreshCostTable(p) {
  const tbody = $('#pf-cl-tbody');
  if (!tbody) return;
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });
  tbody.innerHTML = (p.costLines || []).map((c, i) => renderCostRow(c, i, anchorOpts)).join('');
  wireCostRows(p);
  refreshCostTotals(p);
}

function refreshCostTotals(p) {
  const total = (p.costLines || []).reduce((a, c) => a + (c.amount||0), 0);
  const cv = p.contractValue || 0;
  const margin = cv > 0 ? ((cv - total) / cv * 100) : 0;
  const totEl = $('#pf-cost-total');
  const mgEl = $('#pf-margin');
  if (totEl) totEl.textContent = fmtMoney(total);
  if (mgEl) {
    mgEl.textContent = cv > 0 ? margin.toFixed(1) + '%' : '—';
    mgEl.style.color = margin >= 20 ? 'var(--succ-green)' : margin >= 10 ? 'var(--amber)' : 'var(--coral)';
  }
}

function wireMilestoneRows(p) {
  $$('#pf-ms-tbody tr').forEach(tr => {
    const idx = parseInt(tr.dataset.msIdx, 10);
    tr.querySelector('.ms-name').addEventListener('input', (e) => {
      p.milestones[idx].name = e.target.value;
    });
    tr.querySelector('.ms-anchor').addEventListener('change', (e) => {
      p.milestones[idx].anchor = e.target.value;
    });
    tr.querySelector('.ms-offset').addEventListener('input', (e) => {
      p.milestones[idx].offsetMonths = parseInt(e.target.value || '0', 10);
    });
    tr.querySelector('.ms-pct').addEventListener('input', (e) => {
      const v = Math.max(0, Math.min(100, parseFloat(e.target.value || '0')));
      p.milestones[idx].percent = v;
      refreshMilestoneAmounts(p);
      refreshMilestoneSum(p);
    });
    tr.querySelector('.ms-del').addEventListener('click', () => {
      p.milestones.splice(idx, 1);
      refreshMilestoneTable(p);
    });
  });
}

function refreshMilestoneTable(p) {
  const tbody = $('#pf-ms-tbody');
  if (!tbody) return;
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });
  const cv = p.contractValue || 0;
  tbody.innerHTML = (p.milestones || []).map((m, i) => renderMilestoneRow(m, i, anchorOpts, cv)).join('');
  wireMilestoneRows(p);
  refreshMilestoneSum(p);
}

function refreshMilestoneAmounts(p) {
  const cv = p.contractValue || 0;
  $$('#pf-ms-tbody tr').forEach((tr, i) => {
    const m = p.milestones[i];
    const amt = cv > 0 ? cv * (m.percent || 0) / 100 : 0;
    const el = tr.querySelector('.ms-amount');
    if (el) el.textContent = fmtMoney(amt);
  });
}

function refreshMilestoneSum(p) {
  const ms = p.milestones || [];
  const sum = ms.reduce((a,m) => a + (m.percent||0), 0);
  const sumEl = $('#pf-pct-sum');
  const statusEl = $('#pf-pct-status');
  if (!sumEl || !statusEl) return;
  const ok = Math.abs(sum - 100) < 0.01;
  const color = ok ? 'var(--succ-green)' : 'var(--coral)';
  sumEl.textContent = sum.toFixed(1) + '%';
  sumEl.style.color = color;
  statusEl.textContent = ok ? 'OK' : (sum > 100 ? 'exceeds 100%' : 'short of 100%');
  statusEl.style.color = color;
}

function wireProjectFormPhases(p) {
  $$('#pf-phases .ph-duration').forEach(inp => {
    inp.addEventListener('input', () => {
      const v = Math.max(0, parseInt(inp.value || '0', 10));
      const tr = inp.closest('tr');
      const phaseIdx = parseInt(tr.dataset.phaseIdx, 10);
      p.phases[phaseIdx].duration = v;
      updateEffDurs(p);
    });
  });
  $$('#pf-phases .rl').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const phaseIdx = parseInt(tr.dataset.phaseIdx, 10);
      const roleId = inp.dataset.role;
      const field = inp.dataset.field;
      const v = Math.max(0, parseFloat(inp.value || '0'));
      if (!p.phases[phaseIdx].loading[roleId]) p.phases[phaseIdx].loading[roleId] = defaultLoading(0,0,0);
      p.phases[phaseIdx].loading[roleId][field] = v;
    });
  });
}

function updateEffDurs(p) {
  const loc = getLocation(p.locationId);
  const mult = loc ? loc.multiplier : 1.0;
  $$('#pf-phases tr[data-phase-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.phaseIdx, 10);
    const base = p.phases[idx].duration;
    const eff = base > 0 ? Math.max(1, Math.round(base * mult)) : 0;
    const el = tr.querySelector('.eff-dur');
    if (el) el.textContent = eff;
  });
  const totalBase = p.phases.reduce((a,x)=>a+x.duration,0);
  const totalEff = totalEffectiveDuration(p);
  const t = $('#pf-total');
  if (t) t.value = totalEff + ' mo (' + totalBase + ' base × ' + mult.toFixed(2) + ')';
}

function readProjectForm(p) {
  p.name = $('#pf-name').value;
  p.client = $('#pf-client').value;
  p.location = $('#pf-location').value;
  p.templateId = $('#pf-template').value;
  p.locationId = $('#pf-loc-id').value;
  p.startMonth = $('#pf-start').value;
  p.notes = $('#pf-notes').value;
  return p;
}

$('#btn-new-project').addEventListener('click', () => openProjectModal(null));

/* ============================================================
   CAPACITY VIEW
   ============================================================ */

function renderCapacity() {
  const table = $('#capacity-table');
  const horizon = horizonMonths();

  for (const r of state.roles) {
    if (!state.capacity[r.id]) state.capacity[r.id] = new Array(36).fill(0);
    while (state.capacity[r.id].length < 36) state.capacity[r.id].push(0);
  }

  let yearRow = '<tr><th class="role-head" rowspan="2">Role</th>';
  let monthRow = '<tr>';
  let currentYear = null;
  let yrSpan = 0;
  const yrSpans = [];
  for (let i = 0; i < 36; i++) {
    const d = parseMonth(horizon[i]);
    const y = d.getFullYear();
    if (y !== currentYear) {
      if (currentYear !== null) yrSpans.push({y: currentYear, span: yrSpan});
      currentYear = y;
      yrSpan = 1;
    } else { yrSpan++; }
  }
  yrSpans.push({y: currentYear, span: yrSpan});
  for (const ys of yrSpans) {
    yearRow += `<th colspan="${ys.span}" class="yr-divider">${ys.y}</th>`;
  }
  yearRow += '</tr>';

  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 0; i < 36; i++) {
    const d = parseMonth(horizon[i]);
    const isYrStart = d.getMonth() === 0;
    monthRow += `<th ${isYrStart && i>0 ? 'class="yr-divider"':''}>${mNames[d.getMonth()]}</th>`;
  }
  monthRow += '</tr>';

  let body = '';
  for (const r of state.roles) {
    body += `<tr><td class="role-name" style="border-left:3px solid ${r.color}">${escapeHtml(r.name)}</td>`;
    for (let i = 0; i < 36; i++) {
      const d = parseMonth(horizon[i]);
      const isYrStart = d.getMonth() === 0;
      const v = state.capacity[r.id][i];
      body += `<td ${isYrStart && i>0 ? 'class="yr-divider"':''}><input type="number" min="0" step="1" data-role="${r.id}" data-midx="${i}" value="${v}"></td>`;
    }
    body += '</tr>';
  }

  table.innerHTML = '<thead>' + yearRow + monthRow + '</thead><tbody>' + body + '</tbody>';

  table.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const r = inp.dataset.role;
      const i = parseInt(inp.dataset.midx, 10);
      state.capacity[r][i] = Math.max(0, parseFloat(inp.value || '0'));
      saveState();
    });
  });
}

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

/* ============================================================
   GANTT VIEW
   ============================================================ */

/* Gantt visible-range state */
let _ganttRange = { sIdx: 0, eIdx: 35 };

function renderGantt() {
  const wrap = $('#gantt-wrap');
  const colW = parseInt($('#gantt-zoom').value, 10);
  const labelW = 260;
  const rowH = 36;
  const headerH = 56;
  const sIdx = _ganttRange.sIdx;
  const eIdx = _ganttRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const horizon = horizonMonths();
  const projects = state.projects;
  const height = headerH + projects.length * rowH + 30;
  const width = labelW + visN * colW;

  // Brand colors
  const DEEP_BLUE = '#19446C';
  const TEAL = '#00929F';
  const WARM_WHITE = '#FAF8F4';
  const CHARCOAL = '#404040';
  const CORAL = '#C05234';
  const LINE = '#E5E1D6';

  // Helper: month idx to x position (visible-space)
  const xAt = (i) => labelW + (i - sIdx) * colW;

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  // Header: years bar
  let lastYear = null, yearStartX = labelW;
  for (let i = sIdx; i <= eIdx + 1; i++) {
    const d = i <= eIdx ? parseMonth(horizon[i]) : null;
    const y = d ? d.getFullYear() : null;
    if (y !== lastYear || i > eIdx) {
      if (lastYear !== null) {
        const x = xAt(i);
        svg += `<rect x="${yearStartX}" y="0" width="${x - yearStartX}" height="24" fill="${DEEP_BLUE}" stroke="#fff" stroke-width="1"/>`;
        svg += `<text x="${yearStartX + 10}" y="17" fill="${WARM_WHITE}" font-size="12" font-family="Inter" font-weight="700" letter-spacing="1.5">${lastYear}</text>`;
      }
      yearStartX = xAt(i);
      lastYear = y;
    }
  }
  // Months
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    const isYrStart = d.getMonth() === 0;
    svg += `<rect x="${x}" y="24" width="${colW}" height="32" fill="${(i-sIdx)%2?WARM_WHITE:'#fff'}" stroke="${LINE}"/>`;
    svg += `<text x="${x + colW/2}" y="44" text-anchor="middle" fill="${CHARCOAL}" font-size="10" font-family="Inter" font-weight="500">${mNames[d.getMonth()]}</text>`;
    if (isYrStart && i > sIdx) {
      svg += `<line x1="${x}" y1="24" x2="${x}" y2="${height}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
    }
  }

  // Label column header
  svg += `<rect x="0" y="0" width="${labelW}" height="${headerH}" fill="${DEEP_BLUE}"/>`;
  svg += `<text x="16" y="20" fill="${TEAL}" font-size="10" font-family="Inter" font-weight="700" letter-spacing="1.5">PROJECT</text>`;
  svg += `<text x="16" y="44" fill="${WARM_WHITE}" font-size="13" font-family="DM Serif Display" font-weight="400">Portfolio Timeline</text>`;

  // Row backgrounds and gridlines
  for (let r = 0; r < projects.length; r++) {
    const y = headerH + r * rowH;
    svg += `<rect x="0" y="${y}" width="${labelW}" height="${rowH}" fill="${r%2?WARM_WHITE:'#fff'}"/>`;
    svg += `<line x1="0" y1="${y + rowH}" x2="${width}" y2="${y + rowH}" stroke="${LINE}"/>`;
  }
  // Vertical month grid
  for (let i = sIdx; i <= eIdx + 1; i++) {
    const x = xAt(i);
    svg += `<line x1="${x}" y1="${headerH}" x2="${x}" y2="${headerH + projects.length * rowH}" stroke="#F2EFE4"/>`;
  }

  // Today line
  const todayIdx = monthsBetween(state.startMonth, monthKey(new Date()));
  if (todayIdx >= sIdx && todayIdx <= eIdx) {
    const x = xAt(todayIdx) + colW/2;
    svg += `<line x1="${x}" y1="${24}" x2="${x}" y2="${height-30}" stroke="${CORAL}" stroke-width="2" stroke-dasharray="4 3"/>`;
    svg += `<text x="${x}" y="${height-12}" text-anchor="middle" font-size="10" fill="${CORAL}" font-family="Inter" font-weight="700" letter-spacing="0.5">TODAY</text>`;
  }

  // Bars
  projects.forEach((p, pi) => {
    const y = headerH + pi * rowH;
    const truncName = p.name.length > 30 ? p.name.slice(0,28) + '…' : p.name;
    const loc = getLocation(p.locationId);
    const locTag = loc && loc.multiplier !== 1.0 ? ` · ${loc.multiplier.toFixed(2)}×` : '';
    // Pinned indicator (lock glyph)
    const pinX = labelW - 18;
    if (p.pinned) {
      svg += `<text class="gantt-pin" data-proj="${p.id}" x="${pinX}" y="${y+22}" font-size="14" fill="${CORAL}" font-weight="700" style="cursor:pointer">🔒</text>`;
    } else {
      svg += `<text class="gantt-pin" data-proj="${p.id}" x="${pinX}" y="${y+22}" font-size="14" fill="${CHARCOAL}" opacity="0.25" style="cursor:pointer">🔓</text>`;
    }
    // Win probability pill (left of lock icon)
    const wp = (p.winProbability != null) ? p.winProbability : 100;
    const wpColor = winProbColor(wp);
    const pillW = 38;
    const pillX = pinX - pillW - 6;
    svg += `<rect x="${pillX}" y="${y+10}" width="${pillW}" height="16" rx="8" fill="${wpColor}" opacity="${wp >= 100 ? 1.0 : 0.85}"/>`;
    svg += `<text x="${pillX + pillW/2}" y="${y+22}" text-anchor="middle" font-size="10" font-family="Inter" fill="#fff" font-weight="700">${wp}%</text>`;
    svg += `<text x="14" y="${y+15}" font-size="12" font-family="Inter" font-weight="600" fill="${DEEP_BLUE}">${escapeHtml(truncName)}</text>`;
    svg += `<text x="14" y="${y+29}" font-size="10" font-family="Inter" fill="${CHARCOAL}">${escapeHtml(p.client||'')}${escapeHtml(locTag)}</text>`;
    // Transparent drag handle covering the label area (so users can grab any part of the row)
    svg += `<rect class="gantt-bar gantt-bar-handle" data-proj="${p.id}" data-phase="_label" data-start="${p.startMonth}" data-dur="0" data-basedur="0" x="0" y="${y+2}" width="${labelW - 24}" height="${rowH - 4}" fill="transparent" style="cursor:${p.pinned ? 'not-allowed' : 'grab'}"/>`;

    let cursor = p.startMonth;
    const effDurs = effectivePhaseDurations(p);
    p.phases.forEach((ph, phIdx) => {
      const N_phase = effDurs[phIdx];
      const startIdx = monthsBetween(state.startMonth, cursor);
      const endIdx = startIdx + N_phase;
      const phMeta = getPhase(ph.phaseId);
      const color = phMeta ? phMeta.color : '#888';
      const visStart = Math.max(sIdx, startIdx);
      const visEnd = Math.min(eIdx + 1, endIdx);
      if (visEnd > visStart) {
        const x = xAt(visStart);
        const w = (visEnd - visStart) * colW;
        const barY = y + 6;
        const barH = rowH - 12;
        svg += `<rect class="gantt-bar" data-proj="${p.id}" data-phase="${ph.phaseId}" data-start="${cursor}" data-dur="${N_phase}" data-basedur="${ph.duration}" x="${x}" y="${barY}" width="${w}" height="${barH}" fill="${color}" stroke="${DEEP_BLUE}" stroke-width="0.5" rx="1.5"/>`;
        if (w > 70) {
          const phName = phMeta?phMeta.name:ph.phaseId;
          svg += `<text x="${x+10}" y="${barY + barH/2 + 4}" font-size="10" font-family="Inter" fill="#fff" font-weight="600">${escapeHtml(phName)} · ${N_phase}mo</text>`;
        } else if (w > 30) {
          svg += `<text x="${x + w/2}" y="${barY + barH/2 + 4}" text-anchor="middle" font-size="10" font-family="Inter" fill="#fff" font-weight="600">${N_phase}</text>`;
        }
      }
      cursor = addMonths(cursor, N_phase);
    });
  });

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}" stroke-width="1"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  // Compute conflict map (which projects have phases over capacity)
  const conflicts = computeProjectConflicts();

  // Add a conflict ring overlay for phases inside conflicting months
  wrap.querySelectorAll('.gantt-bar').forEach(bar => {
    if (bar.classList.contains('gantt-bar-handle')) return; // skip the transparent label handle
    const projId = bar.dataset.proj;
    const start = bar.dataset.start;
    const dur = parseInt(bar.dataset.dur, 10);
    const startMi = monthsBetween(state.startMonth, start);
    let hasConflict = false;
    for (let k = 0; k < dur; k++) {
      if (conflicts[startMi + k]) { hasConflict = true; break; }
    }
    if (hasConflict) {
      bar.setAttribute('stroke', '#C05234');
      bar.setAttribute('stroke-width', '2.5');
    }
  });

  // Hook up drag (per project — dragging shifts startMonth horizontally OR reorders vertically)
  wireGanttDrag(wrap, colW, sIdx, rowH, headerH);

  // Pin toggle
  wrap.querySelectorAll('.gantt-pin').forEach(p => {
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      const proj = getProject(p.dataset.proj);
      if (!proj) return;
      proj.pinned = !proj.pinned;
      saveState();
      renderGantt();
      toast(`${proj.name}: ${proj.pinned ? 'locked' : 'unlocked'}`);
    });
  });

  renderGanttLegend();
  // Render companion charts (resources + cashflow) below the Gantt
  renderGanttResources();
  renderGanttCashflow();
}

/* ---------- Compute which absolute month indices have any role over capacity ---------- */
function computeProjectConflicts() {
  const { demand } = computeAllDemand();
  const conflicts = new Array(36).fill(false);
  for (let i = 0; i < 36; i++) {
    for (const r of state.roles) {
      const cap = (state.capacity[r.id] || [])[i] || 0;
      if (demand[r.id][i] > cap + 0.001) { conflicts[i] = true; break; }
    }
  }
  return conflicts;
}

/* ---------- Gantt drag (shift horizontally / reorder vertically) ---------- */
let _ganttDragState = null;
let _ganttGlobalListenersAttached = false;

function wireGanttDrag(wrap, colW, sIdx, rowH, headerH) {
  const bars = Array.from(wrap.querySelectorAll('.gantt-bar'));
  bars.forEach(bar => {
    bar.addEventListener('mouseenter', () => {
      const proj = getProject(bar.dataset.proj);
      bar.style.cursor = (proj && proj.pinned) ? 'not-allowed' : 'grab';
    });
    bar.addEventListener('mousemove', (e) => {
      if (!_ganttDragState) showGanttTip(e, bar);
    });
    bar.addEventListener('mouseleave', () => {
      if (!_ganttDragState) hideTip();
    });

    bar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const projId = bar.dataset.proj;
      const proj = getProject(projId);
      if (!proj) return;
      if (proj.pinned) return;
      const projIdx = state.projects.findIndex(p => p.id === projId);
      _ganttDragState = {
        projId,
        projIdx,
        origStartMonth: proj.startMonth,
        downX: e.clientX,
        downY: e.clientY,
        colW,
        rowH,
        headerH,
        sIdx,
        moved: false,
        mode: null,          // 'shift' | 'reorder' — locked once threshold crossed
        deltaMonths: 0,
        targetIdx: projIdx,  // for reorder
        wrapEl: wrap
      };
      bar.style.cursor = 'grabbing';
      hideTip();
      const projBars = bars.filter(b => b.dataset.proj === projId);
      _ganttDragState.projBars = projBars;
      projBars.forEach(b => b.setAttribute('opacity', '0.5'));
    });
  });

  if (!_ganttGlobalListenersAttached) {
    document.addEventListener('mousemove', onGanttMouseMove);
    document.addEventListener('mouseup', onGanttMouseUp);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _ganttDragState) {
        cancelGanttDrag();
      }
    });
    _ganttGlobalListenersAttached = true;
  }
}

function cancelGanttDrag() {
  if (!_ganttDragState) return;
  const ds = _ganttDragState;
  _ganttDragState = null;
  hideTip();
  ds.projBars.forEach(b => {
    b.setAttribute('opacity', '1.0');
    b.removeAttribute('transform');
  });
  // Also remove any drop-indicator we drew
  const di = document.getElementById('gantt-drop-indicator');
  if (di) di.remove();
}

function onGanttMouseMove(e) {
  if (!_ganttDragState) return;
  const ds = _ganttDragState;
  const dx = e.clientX - ds.downX;
  const dy = e.clientY - ds.downY;

  // Decide mode if not yet locked
  if (!ds.mode) {
    const TH = 6;
    if (Math.abs(dx) > TH || Math.abs(dy) > TH) {
      ds.mode = (Math.abs(dy) > Math.abs(dx)) ? 'reorder' : 'shift';
      ds.moved = true;
    } else {
      return;
    }
  }

  if (ds.mode === 'shift') {
    const deltaMonths = Math.round(dx / ds.colW);
    if (deltaMonths !== ds.deltaMonths) {
      ds.deltaMonths = deltaMonths;
      ds.projBars.forEach(b => {
        b.setAttribute('transform', `translate(${deltaMonths * ds.colW},0)`);
      });
    }
    const newStart = addMonths(ds.origStartMonth, ds.deltaMonths);
    const tip = $('#tooltip');
    tip.innerHTML = `
      <div><strong>${escapeHtml(getProject(ds.projId).name)}</strong></div>
      <div style="font-size:10px;color:#aaa;margin-bottom:6px">↔ shift mode</div>
      <div class="tooltip-row"><span>New start</span><span>${monthLabel(newStart)}</span></div>
      <div class="tooltip-row"><span>Shift</span><span>${ds.deltaMonths >= 0 ? '+' : ''}${ds.deltaMonths} mo</span></div>
      <div style="font-size:10px;color:#aaa;margin-top:4px">Release to apply · Esc to cancel</div>
    `;
    tip.style.display = 'block';
    tip.style.left = (e.pageX + 14) + 'px';
    tip.style.top = (e.pageY + 14) + 'px';
    return;
  }

  // REORDER MODE
  // Vertical translate
  ds.projBars.forEach(b => {
    b.setAttribute('transform', `translate(0,${dy})`);
    b.setAttribute('opacity', '0.7');
  });

  // Figure out which row index we'd land at
  const fromIdx = ds.projIdx;
  const proposedIdx = Math.max(0, Math.min(state.projects.length - 1,
    Math.round(fromIdx + dy / ds.rowH)));
  ds.targetIdx = proposedIdx;

  // Draw a drop-indicator line
  let di = document.getElementById('gantt-drop-indicator');
  if (!di) {
    // SVG line element — locate the SVG root
    const svg = ds.wrapEl.querySelector('svg');
    if (svg) {
      const ns = 'http://www.w3.org/2000/svg';
      di = document.createElementNS(ns, 'line');
      di.setAttribute('id', 'gantt-drop-indicator');
      di.setAttribute('stroke', '#00929F');
      di.setAttribute('stroke-width', '3');
      di.setAttribute('stroke-dasharray', '4 2');
      di.setAttribute('pointer-events', 'none');
      svg.appendChild(di);
    }
  }
  if (di) {
    // Place the line at the boundary between rows
    // If dragging down: indicator goes below proposed target. If up: above.
    const insertY = ds.headerH + proposedIdx * ds.rowH + (proposedIdx > fromIdx ? ds.rowH : 0);
    const svg = ds.wrapEl.querySelector('svg');
    const svgWidth = parseFloat(svg.getAttribute('width'));
    di.setAttribute('x1', 0);
    di.setAttribute('x2', svgWidth);
    di.setAttribute('y1', insertY);
    di.setAttribute('y2', insertY);
  }

  const tip = $('#tooltip');
  const targetProj = state.projects[proposedIdx];
  tip.innerHTML = `
    <div><strong>${escapeHtml(getProject(ds.projId).name)}</strong></div>
    <div style="font-size:10px;color:#aaa;margin-bottom:6px">↕ reorder mode</div>
    <div class="tooltip-row"><span>From row</span><span>#${fromIdx + 1}</span></div>
    <div class="tooltip-row"><span>To row</span><span>#${proposedIdx + 1}</span></div>
    ${targetProj && targetProj.id !== ds.projId ? `<div class="tooltip-row"><span>${proposedIdx > fromIdx ? 'After' : 'Before'}</span><span>${escapeHtml(targetProj.name.length > 24 ? targetProj.name.slice(0,22)+'…' : targetProj.name)}</span></div>` : ''}
    <div style="font-size:10px;color:#aaa;margin-top:4px">Release to apply · Esc to cancel</div>
  `;
  tip.style.display = 'block';
  tip.style.left = (e.pageX + 14) + 'px';
  tip.style.top = (e.pageY + 14) + 'px';
}

function onGanttMouseUp(e) {
  if (!_ganttDragState) return;
  const ds = _ganttDragState;
  _ganttDragState = null;
  hideTip();
  ds.projBars.forEach(b => {
    b.setAttribute('opacity', '1.0');
    b.removeAttribute('transform');
    b.style.cursor = 'grab';
  });
  const di = document.getElementById('gantt-drop-indicator');
  if (di) di.remove();

  // Treat as click → open editor
  if (!ds.moved) {
    openProjectModal(ds.projId);
    return;
  }
  if (ds.mode === 'shift') {
    if (ds.deltaMonths === 0) { openProjectModal(ds.projId); return; }
    const proj = getProject(ds.projId);
    if (!proj) return;
    proj.startMonth = addMonths(ds.origStartMonth, ds.deltaMonths);
    saveState();
    renderAll();
    toast(`${proj.name}: shifted to ${monthLabel(proj.startMonth)}`);
    return;
  }
  if (ds.mode === 'reorder') {
    if (ds.targetIdx === ds.projIdx) return;
    // Move project from projIdx → targetIdx
    const [moved] = state.projects.splice(ds.projIdx, 1);
    state.projects.splice(ds.targetIdx, 0, moved);
    saveState();
    renderAll();
    toast(`${moved.name}: moved to position #${ds.targetIdx + 1}`);
    return;
  }
}

// (Esc cancel handled in wireGanttDrag's global listeners)

function showGanttTip(e, bar) {
  if (bar.classList.contains('gantt-bar-handle')) {
    // Just show a simple "drag to shift" hint for the row handle
    const tip = $('#tooltip');
    const proj = getProject(bar.dataset.proj);
    if (!proj) return;
    const wp = proj.winProbability != null ? proj.winProbability : 100;
    tip.innerHTML = `
      <div><strong>${escapeHtml(proj.name)}</strong>${proj.pinned ? ' 🔒' : ''}</div>
      <div style="font-size:10px;color:#aaa;margin-top:4px">${proj.pinned ? '🔒 Locked — click lock icon to unlock' : '↔ drag horizontally to shift start · ↕ drag vertically to reorder · click for editor · click lock to pin'}</div>
      ${proj.contractValue ? `<div class="tooltip-row" style="margin-top:6px"><span>Contract / weighted</span><span>${fmtMoney(proj.contractValue,{compact:true})} / ${fmtMoney(proj.contractValue*wp/100,{compact:true})}</span></div>` : ''}
      <div class="tooltip-row" style="color:${winProbColor(wp)}"><span>Win probability</span><span>${wp}%</span></div>
    `;
    tip.style.display = 'block';
    tip.style.left = (e.pageX + 14) + 'px';
    tip.style.top = (e.pageY + 14) + 'px';
    return;
  }
  const tip = $('#tooltip');
  const proj = getProject(bar.dataset.proj);
  const ph = getPhase(bar.dataset.phase);
  const start = bar.dataset.start;
  const dur = parseInt(bar.dataset.dur, 10);
  const baseDur = parseInt(bar.dataset.basedur, 10);
  const end = addMonths(start, dur);
  const loc = getLocation(proj.locationId);
  const wp = proj.winProbability != null ? proj.winProbability : 100;
  tip.innerHTML = `
    <div><strong>${escapeHtml(proj.name)}</strong>${proj.pinned ? ' 🔒' : ''}</div>
    <div style="font-size:10px;color:#aaa;margin-bottom:6px">${escapeHtml(proj.client||'')} · ${loc?escapeHtml(loc.name):''}</div>
    <div class="tooltip-row"><span>Phase</span><span>${escapeHtml(ph.name)}</span></div>
    <div class="tooltip-row"><span>Window</span><span>${monthLabel(start)} → ${monthLabel(end)}</span></div>
    <div class="tooltip-row"><span>Base / Effective</span><span>${baseDur} → ${dur} mo</span></div>
    ${loc && loc.multiplier !== 1.0 ? `<div class="tooltip-row"><span>Multiplier</span><span>${loc.multiplier.toFixed(2)}×</span></div>` : ''}
    <div class="tooltip-row" style="color:${winProbColor(wp)}"><span>Win probability</span><span>${wp}%</span></div>
    ${proj.contractValue ? `<div class="tooltip-row"><span>Contract / risk-weighted</span><span>${fmtMoney(proj.contractValue,{compact:true})} / ${fmtMoney(proj.contractValue*wp/100,{compact:true})}</span></div>` : ''}
    <div style="font-size:10px;color:#aaa;margin-top:6px">Drag to shift · click for editor · drag label vertically to reorder</div>
  `;
  tip.style.display = 'block';
  tip.style.left = (e.pageX + 14) + 'px';
  tip.style.top = (e.pageY + 14) + 'px';
}
function hideTip() { $('#tooltip').style.display = 'none'; }

function renderGanttLegend() {
  const leg = $('#gantt-legend');
  // Only show phases actually in use
  const usedPhases = new Set();
  for (const p of state.projects) for (const ph of p.phases) usedPhases.add(ph.phaseId);
  leg.innerHTML = state.phases.filter(p => usedPhases.has(p.id)).map(p =>
    `<div class="legend-item"><span class="legend-swatch" style="background:${p.color}"></span>${escapeHtml(p.name)}</div>`
  ).join('');
}

/* ---------- Collapse state for Gantt companion charts ---------- */
let _ganttResourcesCollapsed = false;
let _ganttCashflowCollapsed = false;
let _ganttResourcesMode = 'project';  // 'project' | 'role'
let _ganttResourcesWeighted = false;
let _ganttCashflowMode = 'project';   // 'project' | 'total'
let _ganttCashflowWeighted = false;

/* ---------- Gantt companion: Portfolio Resources (stacked by project) ---------- */
function renderGanttResources() {
  const wrap = $('#gantt-resources-wrap');
  const leg = $('#gantt-resources-legend');
  if (!wrap || _ganttResourcesCollapsed) return;
  const { projectDemand, projectTotal, demand, totalDemand, totalCap } = computeTotalSeries();
  const horizon = horizonMonths();
  const sIdx = _ganttRange.sIdx, eIdx = _ganttRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 70;
  const padTop = 28;
  const chartH = 200;
  const padBottom = 36;
  const width = labelW + visN * colW + 24;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234';

  // Compute weighted versions if needed
  const weighted = _ganttResourcesWeighted;
  const wp = (pId) => {
    const p = getProject(pId);
    if (!p) return 1;
    const w = (p.winProbability != null ? p.winProbability : 100) / 100;
    return w;
  };

  // Per-project weighted demand
  const pTotal = {};      // per-project per-month total FTE
  const pByRole = {};     // per-role weighted demand
  for (const r of state.roles) pByRole[r.id] = new Array(36).fill(0);
  for (const p of state.projects) {
    const w = weighted ? wp(p.id) : 1;
    pTotal[p.id] = new Array(36);
    for (let i = 0; i < 36; i++) pTotal[p.id][i] = projectTotal[p.id][i] * w;
    for (const r of state.roles) {
      const projDemR = projectDemand[p.id][r.id];
      for (let i = 0; i < 36; i++) pByRole[r.id][i] += projDemR[i] * w;
    }
  }
  // Stack totals & maxes
  let maxStack = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    let s = 0;
    for (const p of state.projects) s += pTotal[p.id][i];
    if (s > maxStack) maxStack = s;
    if (totalCap[i] > maxStack) maxStack = totalCap[i];
  }
  if (maxStack === 0) maxStack = 1;
  const yMax = Math.ceil(maxStack * 1.1);

  // Update subtitle
  const subtitle = $('#gantt-resources-subtitle');
  if (subtitle) {
    const modeLabel = _ganttResourcesMode === 'project' ? 'stacked by project' : 'stacked by role';
    subtitle.textContent = modeLabel + (weighted ? ' (× win prob)' : '');
  }

  const orderedProjects = projectStackOrder();

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  const yTicks = 4;
  for (let t = 0; t <= yTicks; t++) {
    const v = yMax * t / yTicks;
    const y = padTop + chartH - (v / yMax) * chartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 10}" y="${y+4}" text-anchor="end" font-size="10" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 10}" y="${padTop - 6}" text-anchor="end" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">FTE</text>`;

  // Excess shading vs capacity
  for (let i = sIdx; i <= eIdx; i++) {
    let stack = 0;
    for (const p of state.projects) stack += pTotal[p.id][i];
    const cap = totalCap[i];
    if (stack > cap && cap >= 0) {
      const x = xAt(i);
      const yStack = padTop + chartH - (stack / yMax) * chartH;
      const yCap = padTop + chartH - (cap / yMax) * chartH;
      svg += `<rect x="${x+1}" y="${yStack}" width="${colW-2}" height="${yCap - yStack}" fill="${CORAL}" fill-opacity="0.20"/>`;
    }
  }

  // Year separators / month labels
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = visN <= 18 ? 1 : (visN <= 24 ? 2 : 3);
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
      svg += `<text x="${x+5}" y="${padTop - 6}" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if ((i - sIdx) % labelEvery === 0) {
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 14}" text-anchor="middle" font-size="9" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  const barW = Math.max(6, colW - 6);

  if (_ganttResourcesMode === 'project') {
    // Stacked bars by project (longest first)
    for (let i = sIdx; i <= eIdx; i++) {
      let yCursor = padTop + chartH;
      for (const proj of orderedProjects) {
        const v = pTotal[proj.id][i];
        const segH = (v / yMax) * chartH;
        if (segH > 0) {
          const c = projectColor(proj.id);
          svg += `<rect class="gantt-res-bar" data-midx="${i}" data-proj="${proj.id}" x="${xAt(i) + 3}" y="${yCursor - segH}" width="${barW}" height="${segH}" fill="${c}" stroke="#ffffff" stroke-width="0.5"/>`;
          yCursor -= segH;
        }
      }
    }
  } else {
    // Stacked bars by role
    for (let i = sIdx; i <= eIdx; i++) {
      let yCursor = padTop + chartH;
      for (const r of state.roles) {
        const v = pByRole[r.id][i];
        const segH = (v / yMax) * chartH;
        if (segH > 0) {
          svg += `<rect class="gantt-res-bar-role" data-midx="${i}" data-role="${r.id}" x="${xAt(i) + 3}" y="${yCursor - segH}" width="${barW}" height="${segH}" fill="${r.color}" stroke="#ffffff" stroke-width="0.5"/>`;
          yCursor -= segH;
        }
      }
    }
  }

  // Capacity step line
  let pathD = '';
  for (let i = sIdx; i <= eIdx; i++) {
    const x1 = xAt(i);
    const x2 = x1 + colW;
    const y = padTop + chartH - (totalCap[i] / yMax) * chartH;
    if (i === sIdx) pathD += `M ${x1} ${y}`;
    else pathD += ` L ${x1} ${y}`;
    pathD += ` L ${x2} ${y}`;
  }
  svg += `<path d="${pathD}" fill="none" stroke="${CORAL}" stroke-width="2" stroke-dasharray="6 3"/>`;

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  // Legend
  if (leg) {
    if (_ganttResourcesMode === 'project') {
      leg.innerHTML = orderedProjects.map(p => {
        const w = p.winProbability != null ? p.winProbability : 100;
        return `<div class="legend-item" data-proj="${p.id}" style="cursor:pointer"><span class="legend-swatch" style="background:${projectColor(p.id)}"></span>${escapeHtml(p.name)}<span style="color:var(--ink-mute);font-size:10px;margin-left:4px">${weighted ? '×'+w+'%' : ''}</span></div>`;
      }).join('') + `<div class="legend-item"><span class="legend-swatch" style="background:${CORAL};border-style:dashed"></span>Capacity</div>`;
      leg.querySelectorAll('[data-proj]').forEach(el => el.addEventListener('click', () => openProjectDetailModal(el.dataset.proj)));
    } else {
      leg.innerHTML = state.roles.map(r =>
        `<div class="legend-item"><span class="legend-swatch" style="background:${r.color}"></span>${escapeHtml(r.name)}</div>`
      ).join('') + `<div class="legend-item"><span class="legend-swatch" style="background:${CORAL};border-style:dashed"></span>Capacity</div>`;
    }
  }

  // Tooltips
  wrap.querySelectorAll('.gantt-res-bar').forEach(b => {
    b.style.cursor = 'pointer';
    b.addEventListener('click', () => openProjectDetailModal(b.dataset.proj));
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const rows = [];
      for (const p of orderedProjects) {
        const v = pTotal[p.id][midx];
        if (v > 0.01) rows.push({ name: p.name, v, c: projectColor(p.id), isCurrent: p.id === b.dataset.proj, wp: p.winProbability != null ? p.winProbability : 100 });
      }
      const tot = rows.reduce((a,r)=>a+r.v, 0);
      const cap = totalCap[midx];
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong>${weighted ? ' · risk-weighted' : ''}</div>
        ${rows.map(rr => `<div class="tooltip-row" style="${rr.isCurrent?'font-weight:600;color:#fff':''}"><span><span style="display:inline-block;width:8px;height:8px;background:${rr.c};margin-right:5px"></span>${escapeHtml(rr.name)}${weighted ? ` (${rr.wp}%)` : ''}</span><span>${rr.v.toFixed(2)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Demand</strong></span><span><strong>${tot.toFixed(2)} FTE</strong></span></div>
        <div class="tooltip-row"><span>Capacity</span><span>${cap.toFixed(1)}</span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });

  wrap.querySelectorAll('.gantt-res-bar-role').forEach(b => {
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const role = getRole(b.dataset.role);
      const rows = [];
      let tot = 0;
      for (const r of state.roles) {
        const v = pByRole[r.id][midx];
        tot += v;
        if (v > 0.01) rows.push({ name: r.name, v, c: r.color });
      }
      const cap = totalCap[midx];
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong>${weighted ? ' · risk-weighted' : ''}</div>
        <div style="font-size:10px;color:#aaa;margin:2px 0 6px">Hover: ${escapeHtml(role.name)}</div>
        ${rows.map(rr => `<div class="tooltip-row"><span><span style="display:inline-block;width:8px;height:8px;background:${rr.c};margin-right:5px"></span>${escapeHtml(rr.name)}</span><span>${rr.v.toFixed(2)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Demand</strong></span><span><strong>${tot.toFixed(2)} FTE</strong></span></div>
        <div class="tooltip-row"><span>Capacity</span><span>${cap.toFixed(1)}</span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });
}

/* ---------- Gantt companion: Portfolio Cashflow (revenue, cost, net per project) ---------- */
function renderGanttCashflow() {
  const wrap = $('#gantt-cashflow-wrap');
  if (!wrap || _ganttCashflowCollapsed) return;
  const cfRaw = computePortfolioCashflow();
  const horizon = horizonMonths();
  const sIdx = _ganttRange.sIdx, eIdx = _ganttRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 80;
  const padTop = 32;
  const chartH = 220;
  const padBottom = 32;
  const width = labelW + visN * colW + 36;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;
  const xCenter = (i) => xAt(i) + colW / 2;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234', SAGE = '#809848', TEAL = '#00929F', SUCC = '#6E8C34';

  // Build weighted (or unweighted) per-project series + portfolio rollup
  const weighted = _ganttCashflowWeighted;
  const perProject = {};
  const cashIn = new Array(36).fill(0);
  const costOut = new Array(36).fill(0);
  const netCash = new Array(36).fill(0);
  const cumNet = new Array(36).fill(0);
  for (const p of state.projects) {
    const w = weighted ? ((p.winProbability != null ? p.winProbability : 100) / 100) : 1;
    const src = cfRaw.perProject[p.id];
    const ci = new Array(36), co = new Array(36), cc = new Array(36), cco = new Array(36);
    let acc_c = 0, acc_co = 0;
    for (let i = 0; i < 36; i++) {
      ci[i] = src.cashIn[i] * w;
      co[i] = src.costOut[i] * w;
      acc_c += ci[i]; cc[i] = acc_c;
      acc_co += co[i]; cco[i] = acc_co;
      cashIn[i] += ci[i];
      costOut[i] += co[i];
    }
    perProject[p.id] = { cashIn: ci, costOut: co, cumCash: cc, cumCost: cco };
  }
  let acc = 0;
  for (let i = 0; i < 36; i++) {
    netCash[i] = cashIn[i] - costOut[i];
    acc += netCash[i]; cumNet[i] = acc;
  }
  const cf = { cashIn, costOut, netCash, cumNet, perProject };

  // Update subtitle
  const subtitle = $('#gantt-cashflow-subtitle');
  if (subtitle) {
    const modeLabel = _ganttCashflowMode === 'project' ? 'stacked by project (revenue / cost)' : 'total net per month';
    subtitle.textContent = modeLabel + (weighted ? ' · risk-weighted' : '');
  }

  // Y-range calculation depends on mode
  let maxPos = 0, maxNeg = 0;
  if (_ganttCashflowMode === 'project') {
    for (let i = sIdx; i <= eIdx; i++) {
      if (cashIn[i] > maxPos) maxPos = cashIn[i];
      if (costOut[i] > maxNeg) maxNeg = costOut[i];
    }
  } else {
    // Total net mode: positive net stacks above zero, negative net below zero
    for (let i = sIdx; i <= eIdx; i++) {
      if (netCash[i] > maxPos) maxPos = netCash[i];
      if (-netCash[i] > maxNeg) maxNeg = -netCash[i];
    }
  }

  // Cumulative net axis bounds
  let cumMin = 0, cumMax = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    if (cumNet[i] > cumMax) cumMax = cumNet[i];
    if (cumNet[i] < cumMin) cumMin = cumNet[i];
  }

  if (maxPos === 0 && maxNeg === 0) {
    wrap.innerHTML = `<div style="padding:30px;text-align:center;color:var(--gray);font-size:13px">No cashflow data — set contract values and milestones to see this chart.</div>`;
    const leg = $('#gantt-cashflow-legend');
    if (leg) leg.innerHTML = '';
    return;
  }

  const yMaxPos = niceCeil(maxPos > 0 ? maxPos * 1.1 : 1);
  const yMaxNeg = niceCeil(maxNeg > 0 ? maxNeg * 1.1 : 0.0001);
  const totalSpan = yMaxPos + yMaxNeg;
  const y0 = padTop + (yMaxPos / totalSpan) * chartH;
  const yPosFor = (v) => y0 - (v / yMaxPos) * (yMaxPos / totalSpan) * chartH;
  const yNegFor = (v) => y0 + (v / yMaxNeg) * (yMaxNeg / totalSpan) * chartH;

  const cumSpan = Math.max(Math.abs(cumMax), Math.abs(cumMin), 1);
  const yCumMax = niceCeil(cumSpan * 1.1);
  const yCumFor = (v) => {
    if (v >= 0) return y0 - (v / yCumMax) * (yMaxPos / totalSpan) * chartH;
    return y0 + (Math.abs(v) / yCumMax) * (yMaxNeg / totalSpan) * chartH;
  };

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  // Zero line
  svg += `<line x1="${labelW}" y1="${y0}" x2="${width - 20}" y2="${y0}" stroke="${DEEP_BLUE}" stroke-width="1.5"/>`;

  // Y-axis labels
  const posTicks = 3, negTicks = 2;
  for (let t = 0; t <= posTicks; t++) {
    const v = yMaxPos * t / posTicks;
    const y = yPosFor(v);
    svg += `<line x1="${labelW}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="${LINE}" stroke-width="${t===0?0:1}" stroke-dasharray="${t===0?'':'2 3'}"/>`;
    svg += `<text x="${labelW - 8}" y="${y+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${CHARCOAL}">${fmtMoney(v, {compact:true})}</text>`;
  }
  for (let t = 1; t <= negTicks; t++) {
    const v = yMaxNeg * t / negTicks;
    const y = yNegFor(v);
    svg += `<line x1="${labelW}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="${LINE}" stroke-dasharray="2 3"/>`;
    svg += `<text x="${labelW - 8}" y="${y+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${CORAL}">−${fmtMoney(v, {compact:true})}</text>`;
  }
  const topLabel = _ganttCashflowMode === 'project' ? '$ in' : '$ net +';
  const botLabel = _ganttCashflowMode === 'project' ? '$ out' : '$ net −';
  svg += `<text x="${labelW - 8}" y="${padTop - 6}" text-anchor="end" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${topLabel}</text>`;
  svg += `<text x="${labelW - 8}" y="${padTop + chartH + 14}" text-anchor="end" font-size="10" font-family="Inter" fill="${CORAL}" font-weight="700">${botLabel}</text>`;

  // Right-axis cumulative net labels
  svg += `<text x="${width - 6}" y="${padTop - 6}" text-anchor="end" font-size="10" font-family="Inter" fill="${TEAL}" font-weight="700">cum net</text>`;
  for (let t = 1; t <= 3; t++) {
    const v = yCumMax * t / 3;
    const yp = yCumFor(v);
    svg += `<text x="${width - 6}" y="${yp+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${TEAL}">${fmtMoney(v, {compact:true})}</text>`;
    if (cumMin < 0) {
      const yn = yCumFor(-v);
      svg += `<text x="${width - 6}" y="${yn+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${TEAL}">−${fmtMoney(v, {compact:true})}</text>`;
    }
  }

  // Year separators / month labels
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = visN <= 18 ? 1 : (visN <= 24 ? 2 : 3);
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>`;
      svg += `<text x="${x+4}" y="${padTop - 6}" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if ((i - sIdx) % labelEvery === 0) {
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 14}" text-anchor="middle" font-size="9" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  const orderedProjects = projectStackOrder();
  const barW = Math.max(6, colW - 6);

  if (_ganttCashflowMode === 'project') {
    // Stack revenue above zero and costs below zero, by project
    for (let i = sIdx; i <= eIdx; i++) {
      let posCursor = 0;
      for (const proj of orderedProjects) {
        const v = cf.perProject[proj.id].cashIn[i];
        if (v <= 0) continue;
        const segH = (v / totalSpan) * chartH;
        const yTop = yPosFor(posCursor + v);
        const c = projectColor(proj.id);
        svg += `<rect class="gantt-cf-bar" data-midx="${i}" data-proj="${proj.id}" data-kind="rev" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${c}" stroke="#ffffff" stroke-width="0.5"/>`;
        posCursor += v;
      }
      let negCursor = 0;
      for (const proj of orderedProjects) {
        const v = cf.perProject[proj.id].costOut[i];
        if (v <= 0) continue;
        const segH = (v / totalSpan) * chartH;
        const yTop = yNegFor(negCursor);
        const c = projectColor(proj.id);
        svg += `<rect class="gantt-cf-bar" data-midx="${i}" data-proj="${proj.id}" data-kind="cost" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${c}" fill-opacity="0.85" stroke="${CORAL}" stroke-width="0.8" stroke-dasharray="2 1.5"/>`;
        negCursor += v;
      }
    }
  } else {
    // Total net mode: one bar per month, green when net >= 0, coral when net < 0
    for (let i = sIdx; i <= eIdx; i++) {
      const v = cf.netCash[i];
      if (Math.abs(v) < 0.01) continue;
      if (v >= 0) {
        const segH = (v / totalSpan) * chartH;
        const yTop = yPosFor(v);
        svg += `<rect class="gantt-cf-bar-net" data-midx="${i}" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${SUCC}" stroke="#ffffff" stroke-width="0.5"/>`;
      } else {
        const segH = (Math.abs(v) / totalSpan) * chartH;
        const yTop = y0;
        svg += `<rect class="gantt-cf-bar-net" data-midx="${i}" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${CORAL}" stroke="#ffffff" stroke-width="0.5"/>`;
      }
    }
  }

  // Cumulative net line (right-axis)
  let cumPath = '';
  for (let i = sIdx; i <= eIdx; i++) {
    const v = cf.cumNet[i];
    const x = xCenter(i);
    const y = yCumFor(v);
    if (i === sIdx) cumPath += `M ${x} ${y}`;
    else cumPath += ` L ${x} ${y}`;
  }
  if (cumPath) svg += `<path d="${cumPath}" fill="none" stroke="${TEAL}" stroke-width="2.5"/>`;

  // Today line
  const todayIdx = monthsBetween(state.startMonth, monthKey(new Date()));
  if (todayIdx >= sIdx && todayIdx <= eIdx) {
    const x = xCenter(todayIdx);
    svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${CORAL}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.7"/>`;
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  // Project-bar tooltips
  wrap.querySelectorAll('.gantt-cf-bar').forEach(b => {
    b.style.cursor = 'pointer';
    b.addEventListener('click', () => openProjectDetailModal(b.dataset.proj));
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const proj = getProject(b.dataset.proj);
      const kind = b.dataset.kind;
      const v = parseFloat(b.dataset.v);
      const cfp = cf.perProject[b.dataset.proj];
      const w = proj.winProbability != null ? proj.winProbability : 100;
      tip.innerHTML = `
        <div><strong>${escapeHtml(proj.name)}</strong>${weighted ? ` <span style="color:${winProbColor(w)}">${w}%</span>` : ''}</div>
        <div style="font-size:10px;color:#aaa;margin-bottom:6px">${monthLabel(horizon[midx], false)}${weighted ? ' · risk-weighted' : ''}</div>
        <div class="tooltip-row"><span>${kind==='rev'?'Revenue (cash in)':'Cost (cash out)'}</span><span>${fmtMoney(v)}</span></div>
        <div class="tooltip-row"><span>Project cum cash</span><span>${fmtMoney(cfp.cumCash[midx])}</span></div>
        <div class="tooltip-row"><span>Project cum cost</span><span>${fmtMoney(cfp.cumCost[midx])}</span></div>
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Portfolio cum net</strong></span><span><strong>${fmtMoney(cf.cumNet[midx])}</strong></span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });

  // Total-net bar tooltips
  wrap.querySelectorAll('.gantt-cf-bar-net').forEach(b => {
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const v = parseFloat(b.dataset.v);
      // Breakdown: per-project revenue and cost contribution this month
      const rows = [];
      for (const p of orderedProjects) {
        const rev = cf.perProject[p.id].cashIn[midx];
        const co = cf.perProject[p.id].costOut[midx];
        const net = rev - co;
        if (Math.abs(net) > 0.01) rows.push({ name: p.name, c: projectColor(p.id), net });
      }
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong>${weighted ? ' · risk-weighted' : ''}</div>
        <div class="tooltip-row" style="font-weight:600;${v>=0?'color:#A8D9A8':'color:#FFB29A'}"><span>Total net</span><span>${fmtMoney(v)}</span></div>
        <div class="tooltip-row"><span>Revenue this month</span><span>${fmtMoney(cf.cashIn[midx])}</span></div>
        <div class="tooltip-row"><span>Cost this month</span><span>${fmtMoney(cf.costOut[midx])}</span></div>
        ${rows.length > 0 ? '<div style="border-top:1px solid #444;margin-top:5px;padding-top:5px;font-size:10px;color:#aaa">Per-project net contribution:</div>' : ''}
        ${rows.map(r => `<div class="tooltip-row"><span><span style="display:inline-block;width:8px;height:8px;background:${r.c};margin-right:5px"></span>${escapeHtml(r.name)}</span><span style="${r.net >= 0 ? 'color:#A8D9A8' : 'color:#FFB29A'}">${fmtMoney(r.net)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Portfolio cum net</strong></span><span><strong>${fmtMoney(cf.cumNet[midx])}</strong></span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });

  // Legend
  const leg = $('#gantt-cashflow-legend');
  if (leg) {
    const totalRev = cf.cashIn.slice(sIdx, eIdx+1).reduce((a,b)=>a+b, 0);
    const totalCost = cf.costOut.slice(sIdx, eIdx+1).reduce((a,b)=>a+b, 0);
    const totalNet = totalRev - totalCost;
    let entries;
    if (_ganttCashflowMode === 'project') {
      entries = `
        <div class="legend-item"><span class="legend-swatch" style="background:${SAGE}"></span>Revenue (above zero)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${CORAL};opacity:0.6"></span>Cost (below zero)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${TEAL}"></span>Cumulative net</div>
      `;
    } else {
      entries = `
        <div class="legend-item"><span class="legend-swatch" style="background:${SUCC}"></span>Net positive month</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${CORAL}"></span>Net negative month</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${TEAL}"></span>Cumulative net</div>
      `;
    }
    leg.innerHTML = entries + `
      <div class="legend-item" style="margin-left:auto;font-family:var(--font-mono);font-weight:600">Visible: ${fmtMoney(totalRev, {compact:true})} rev − ${fmtMoney(totalCost, {compact:true})} cost = <span style="color:${totalNet >= 0 ? 'var(--succ-green)' : 'var(--coral)'}">${fmtMoney(totalNet, {compact:true})}</span> net${weighted ? ' (×wp)' : ''}</div>
    `;
  }
}

/* ---------- Wire Gantt companion collapse + initial render ---------- */
function setGanttCompanionVisible() {
  $('#gantt-resources-body').style.display = _ganttResourcesCollapsed ? 'none' : '';
  $('#gantt-cashflow-body').style.display = _ganttCashflowCollapsed ? 'none' : '';
  $('#gantt-resources-caret').textContent = _ganttResourcesCollapsed ? '▸' : '▾';
  $('#gantt-cashflow-caret').textContent = _ganttCashflowCollapsed ? '▸' : '▾';
}
$('#gantt-resources-header').addEventListener('click', () => {
  _ganttResourcesCollapsed = !_ganttResourcesCollapsed;
  setGanttCompanionVisible();
  if (!_ganttResourcesCollapsed) renderGanttResources();
});
$('#gantt-cashflow-header').addEventListener('click', () => {
  _ganttCashflowCollapsed = !_ganttCashflowCollapsed;
  setGanttCompanionVisible();
  if (!_ganttCashflowCollapsed) renderGanttCashflow();
});

// Resources mode toggle (project / role)
$$('#gantt-resources-mode .hist-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();  // don't bubble up to the panel-header's collapse click
    $$('#gantt-resources-mode .hist-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _ganttResourcesMode = btn.dataset.mode;
    renderGanttResources();
  });
});
// Resources weighting toggle
$('#gantt-resources-weighted').addEventListener('click', (e) => e.stopPropagation());
$('#gantt-resources-weighted').addEventListener('change', (e) => {
  _ganttResourcesWeighted = e.target.checked;
  renderGanttResources();
});

// Cashflow mode toggle (project / total)
$$('#gantt-cashflow-mode .hist-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    $$('#gantt-cashflow-mode .hist-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _ganttCashflowMode = btn.dataset.mode;
    renderGanttCashflow();
  });
});
$('#gantt-cashflow-weighted').addEventListener('click', (e) => e.stopPropagation());
$('#gantt-cashflow-weighted').addEventListener('change', (e) => {
  _ganttCashflowWeighted = e.target.checked;
  renderGanttCashflow();
});

$('#gantt-zoom').addEventListener('change', renderGantt);

// Gantt range sliders
function wireGanttRange() {
  const startInp = $('#gantt-range-start');
  const endInp = $('#gantt-range-end');
  const onRange = () => {
    let s = parseInt(startInp.value, 10);
    let e = parseInt(endInp.value, 10);
    if (s > e) { const t = s; s = e; e = t; }
    if (e - s < 1) e = Math.min(35, s + 1);
    _ganttRange.sIdx = s;
    _ganttRange.eIdx = e;
    renderGantt();
  };
  startInp.addEventListener('input', onRange);
  endInp.addEventListener('input', onRange);
  $('#gantt-range-reset').addEventListener('click', () => {
    _ganttRange.sIdx = 0; _ganttRange.eIdx = 35;
    startInp.value = 0; endInp.value = 35;
    renderGantt();
  });
}
wireGanttRange();

/* ============================================================
   HISTOGRAM VIEW  ·  multi-mode (role / project-bar / project-area)
   ============================================================ */

let histMode = 'role';   // 'role' | 'project-bar' | 'project-area'
let histShowCap = true;
let _histRange = { sIdx: 0, eIdx: 35 };

/* Deterministic project color (independent of role palette).
   Uses a small TSI-derived palette and rotates through it.
*/
const PROJECT_COLOR_PALETTE = [
  '#19446C',  // deep blue
  '#00929F',  // teal
  '#809848',  // sage
  '#C4A230',  // amber
  '#C05234',  // coral
  '#6E5B8B',  // muted purple
  '#4A7A9C',  // process blue
  '#6E8C34',  // succ green
  '#9B7E46',  // tan
  '#3E6B8E',  // steel blue
  '#A05634',  // burnt rust
  '#5C7E2A'   // olive
];
function projectColor(projectId) {
  // FNV-1a hash for stable but well-distributed color assignment from project id
  let h = 2166136261;
  for (let i = 0; i < projectId.length; i++) {
    h ^= projectId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PROJECT_COLOR_PALETTE[(h >>> 0) % PROJECT_COLOR_PALETTE.length];
}

/* Compute total demand per month across all roles (sum), and total capacity per month. */
function computeTotalSeries() {
  const { demand, projectDemand } = computeAllDemand();
  const totalDemand = new Array(36).fill(0);
  const totalCap = new Array(36).fill(0);
  for (let i = 0; i < 36; i++) {
    for (const r of state.roles) {
      totalDemand[i] += demand[r.id][i];
      totalCap[i] += (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
    }
  }
  // Project total demand (summed across roles, per month)
  const projectTotal = {};
  for (const p of state.projects) {
    projectTotal[p.id] = new Array(36).fill(0);
    for (const r of state.roles) {
      for (let i = 0; i < 36; i++) {
        projectTotal[p.id][i] += projectDemand[p.id][r.id][i];
      }
    }
  }
  return { totalDemand, totalCap, projectDemand, demand, projectTotal };
}

/* Compute per-role bottleneck ratio: for each month, the maximum
   (role_demand / role_capacity) across roles. Returns array + which
   role drove the worst ratio in that month.
*/
function computeBottleneckSeries() {
  const { demand } = computeAllDemand();
  const ratios = new Array(36).fill(0);
  const drivers = new Array(36).fill(null);
  for (let i = 0; i < 36; i++) {
    let maxR = 0; let driver = null;
    for (const r of state.roles) {
      const d = demand[r.id][i];
      const c = (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
      if (d === 0) continue;
      const ratio = c > 0 ? d / c : (d > 0 ? 999 : 0);
      if (ratio > maxR) { maxR = ratio; driver = r; }
    }
    ratios[i] = maxR;
    drivers[i] = driver;
  }
  return { ratios, drivers };
}

/* Project sort order: longest projects at the bottom (largest area first)
   so shorter studies sit on top where they remain visible.
*/
function projectStackOrder() {
  return [...state.projects].sort((a,b) => {
    const da = totalEffectiveDuration(a);
    const db = totalEffectiveDuration(b);
    if (da !== db) return db - da;        // longer first (bottom)
    return a.name.localeCompare(b.name);  // stable tiebreak
  });
}

function renderHistogram() {
  // Update title and legend depending on mode
  const titleEl = $('#hist-title');
  if (histMode === 'role') titleEl.textContent = 'Stacked Histogram · FTE by Role';
  else if (histMode === 'project-bar') titleEl.textContent = 'Stacked Histogram · FTE by Project';
  else titleEl.textContent = 'Stacked Area · FTE by Project (Smooth Ribbons)';

  if (histMode === 'role') renderHistogramByRole();
  else if (histMode === 'project-bar') renderHistogramByProjectBars();
  else renderHistogramByProjectArea();

  renderBottleneckStrip();
}

/* ---------- Mode 1: Stacked bars by role (original) ---------- */
function renderHistogramByRole() {
  const wrap = $('#hist-wrap');
  const { demand, totalCap } = computeTotalSeries();
  const horizon = horizonMonths();
  const sIdx = _histRange.sIdx, eIdx = _histRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 70;
  const padTop = 56;
  const chartH = 320;
  const padBottom = 56;
  const width = labelW + visN * colW + 24;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', WARM_WHITE = '#FAF8F4', CORAL = '#C05234';

  let maxStack = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    let s = 0;
    for (const r of state.roles) s += demand[r.id][i];
    if (s > maxStack) maxStack = s;
  }
  if (histShowCap) {
    for (let i = sIdx; i <= eIdx; i++) if (totalCap[i] > maxStack) maxStack = totalCap[i];
  }
  if (maxStack === 0) maxStack = 1;
  const yMax = Math.ceil(maxStack * 1.1);

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  const yTicks = 5;
  for (let t = 0; t <= yTicks; t++) {
    const v = yMax * t / yTicks;
    const y = padTop + chartH - (v / yMax) * chartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 10}" y="${y+4}" text-anchor="end" font-size="11" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 10}" y="${padTop - 14}" text-anchor="end" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700" letter-spacing="0.5">FTE</text>`;

  if (histShowCap) {
    for (let i = sIdx; i <= eIdx; i++) {
      let stack = 0;
      for (const r of state.roles) stack += demand[r.id][i];
      const cap = totalCap[i];
      if (stack > cap && cap >= 0) {
        const x = xAt(i);
        const yStack = padTop + chartH - (stack / yMax) * chartH;
        const yCap = padTop + chartH - (cap / yMax) * chartH;
        svg += `<rect x="${x+1}" y="${yStack}" width="${colW-2}" height="${yCap - yStack}" fill="${CORAL}" fill-opacity="0.20"/>`;
      }
    }
  }

  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = visN <= 18 ? 1 : (visN <= 24 ? 2 : 3);
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    const isYrStart = d.getMonth() === 0;
    if (isYrStart) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
      svg += `<text x="${x+5}" y="${padTop - 6}" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if ((i - sIdx) % labelEvery === 0) {
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 18}" text-anchor="middle" font-size="10" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  const barW = Math.max(6, colW - 6);
  for (let i = sIdx; i <= eIdx; i++) {
    let yCursor = padTop + chartH;
    let monthTotal = 0;
    for (const r of state.roles) {
      const v = demand[r.id][i];
      monthTotal += v;
      const segH = (v / yMax) * chartH;
      if (segH > 0) {
        svg += `<rect class="hist-bar" data-midx="${i}" data-role="${r.id}" data-fte="${v.toFixed(2)}" x="${xAt(i) + 3}" y="${yCursor - segH}" width="${barW}" height="${segH}" fill="${r.color}" stroke="#ffffff" stroke-width="0.5"/>`;
        yCursor -= segH;
      }
    }
    if (monthTotal > 0.01 && visN <= 24) {
      svg += `<text x="${xAt(i) + colW/2}" y="${padTop + chartH - (monthTotal/yMax)*chartH - 5}" text-anchor="middle" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${monthTotal.toFixed(1)}</text>`;
    }
  }

  if (histShowCap) {
    let pathD = '';
    for (let i = sIdx; i <= eIdx; i++) {
      const x1 = xAt(i);
      const x2 = x1 + colW;
      const y = padTop + chartH - (totalCap[i] / yMax) * chartH;
      if (i === sIdx) pathD += `M ${x1} ${y}`;
      else pathD += ` L ${x1} ${y}`;
      pathD += ` L ${x2} ${y}`;
    }
    svg += `<path d="${pathD}" fill="none" stroke="${CORAL}" stroke-width="2.5" stroke-dasharray="6 3"/>`;
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.hist-bar').forEach(bar => {
    bar.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(bar.dataset.midx, 10);
      const r = getRole(bar.dataset.role);
      const rows = [];
      let tot = 0;
      for (const role of state.roles) {
        const v = demand[role.id][midx];
        tot += v;
        if (v > 0.01) rows.push({name: role.name, v});
      }
      const cap = totalCap[midx];
      const over = tot - cap;
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong></div>
        <div style="font-size:10px;color:#aaa;margin:2px 0 6px">Hover: ${escapeHtml(r.name)} = ${parseFloat(bar.dataset.fte).toFixed(2)} FTE</div>
        ${rows.map(rr => `<div class="tooltip-row"><span>${escapeHtml(rr.name)}</span><span>${rr.v.toFixed(2)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Demand</strong></span><span><strong>${tot.toFixed(2)} FTE</strong></span></div>
        <div class="tooltip-row"><span>Capacity</span><span>${cap.toFixed(1)} HC</span></div>
        <div class="tooltip-row" style="color:${over>0?'#FFB29A':'#A8D9A8'}"><span>${over>0?'Over':'Under'}</span><span>${Math.abs(over).toFixed(2)}</span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    bar.addEventListener('mouseleave', hideTip);
  });

  $('#hist-legend').innerHTML = state.roles.map(r =>
    `<div class="legend-item"><span class="legend-swatch" style="background:${r.color}"></span>${escapeHtml(r.name)}</div>`
  ).join('') + (histShowCap ? `<div class="legend-item"><span class="legend-swatch" style="background:${CORAL};border-style:dashed"></span>Total Capacity</div><div class="legend-item"><span class="legend-swatch" style="background:rgba(192,82,52,0.20)"></span>Excess Burden</div>` : '');
}

/* ---------- Mode 2: Stacked bars by project ---------- */
function renderHistogramByProjectBars() {
  const wrap = $('#hist-wrap');
  const { totalDemand, totalCap, projectTotal } = computeTotalSeries();
  const horizon = horizonMonths();
  const sIdx = _histRange.sIdx, eIdx = _histRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 70;
  const padTop = 56;
  const chartH = 320;
  const padBottom = 56;
  const width = labelW + visN * colW + 24;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234';

  let maxStack = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    if (totalDemand[i] > maxStack) maxStack = totalDemand[i];
    if (histShowCap && totalCap[i] > maxStack) maxStack = totalCap[i];
  }
  if (maxStack === 0) maxStack = 1;
  const yMax = Math.ceil(maxStack * 1.1);

  const orderedProjects = projectStackOrder();

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  const yTicks = 5;
  for (let t = 0; t <= yTicks; t++) {
    const v = yMax * t / yTicks;
    const y = padTop + chartH - (v / yMax) * chartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 10}" y="${y+4}" text-anchor="end" font-size="11" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 10}" y="${padTop - 14}" text-anchor="end" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700" letter-spacing="0.5">FTE</text>`;

  if (histShowCap) {
    for (let i = sIdx; i <= eIdx; i++) {
      const stack = totalDemand[i];
      const cap = totalCap[i];
      if (stack > cap && cap >= 0) {
        const x = xAt(i);
        const yStack = padTop + chartH - (stack / yMax) * chartH;
        const yCap = padTop + chartH - (cap / yMax) * chartH;
        svg += `<rect x="${x+1}" y="${yStack}" width="${colW-2}" height="${yCap - yStack}" fill="${CORAL}" fill-opacity="0.20"/>`;
      }
    }
  }

  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = visN <= 18 ? 1 : (visN <= 24 ? 2 : 3);
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
      svg += `<text x="${x+5}" y="${padTop - 6}" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if ((i - sIdx) % labelEvery === 0) {
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 18}" text-anchor="middle" font-size="10" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  const barW = Math.max(6, colW - 6);
  for (let i = sIdx; i <= eIdx; i++) {
    let yCursor = padTop + chartH;
    let monthTotal = 0;
    for (const proj of orderedProjects) {
      const v = projectTotal[proj.id][i];
      monthTotal += v;
      const segH = (v / yMax) * chartH;
      if (segH > 0) {
        const c = projectColor(proj.id);
        svg += `<rect class="hist-bar-proj" data-midx="${i}" data-proj="${proj.id}" data-fte="${v.toFixed(2)}" x="${xAt(i) + 3}" y="${yCursor - segH}" width="${barW}" height="${segH}" fill="${c}" stroke="#ffffff" stroke-width="0.5"/>`;
        yCursor -= segH;
      }
    }
    if (monthTotal > 0.01 && visN <= 24) {
      svg += `<text x="${xAt(i) + colW/2}" y="${padTop + chartH - (monthTotal/yMax)*chartH - 5}" text-anchor="middle" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${monthTotal.toFixed(1)}</text>`;
    }
  }

  if (histShowCap) {
    let pathD = '';
    for (let i = sIdx; i <= eIdx; i++) {
      const x1 = xAt(i);
      const x2 = x1 + colW;
      const y = padTop + chartH - (totalCap[i] / yMax) * chartH;
      if (i === sIdx) pathD += `M ${x1} ${y}`;
      else pathD += ` L ${x1} ${y}`;
      pathD += ` L ${x2} ${y}`;
    }
    svg += `<path d="${pathD}" fill="none" stroke="${CORAL}" stroke-width="2.5" stroke-dasharray="6 3"/>`;
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.hist-bar-proj').forEach(bar => {
    bar.style.cursor = 'pointer';
    bar.addEventListener('mousemove', (e) => showProjectHistTip(e, bar, totalDemand, totalCap, projectTotal, horizon));
    bar.addEventListener('mouseleave', hideTip);
    bar.addEventListener('click', () => openProjectDetailModal(bar.dataset.proj));
  });

  renderProjectLegend();
}

function showProjectHistTip(e, bar, totalDemand, totalCap, projectTotal, horizon) {
  const tip = $('#tooltip');
  const midx = parseInt(bar.dataset.midx, 10);
  const proj = getProject(bar.dataset.proj);
  const orderedProjects = projectStackOrder();
  const rows = [];
  for (const p of orderedProjects) {
    const v = projectTotal[p.id][midx];
    if (v > 0.01) rows.push({ name: p.name, v, c: projectColor(p.id), isCurrent: p.id === proj.id });
  }
  const tot = totalDemand[midx];
  const cap = totalCap[midx];
  const over = tot - cap;
  tip.innerHTML = `
    <div><strong>${monthLabel(horizon[midx], false)}</strong></div>
    <div style="font-size:10px;color:#aaa;margin:2px 0 6px">Click bar for project role breakdown</div>
    ${rows.map(rr => `<div class="tooltip-row" style="${rr.isCurrent?'font-weight:600;color:#fff':''}"><span><span style="display:inline-block;width:8px;height:8px;background:${rr.c};margin-right:5px"></span>${escapeHtml(rr.name)}</span><span>${rr.v.toFixed(2)}</span></div>`).join('')}
    <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Demand</strong></span><span><strong>${tot.toFixed(2)} FTE</strong></span></div>
    <div class="tooltip-row"><span>Capacity</span><span>${cap.toFixed(1)} HC</span></div>
    <div class="tooltip-row" style="color:${over>0?'#FFB29A':'#A8D9A8'}"><span>${over>0?'Over':'Under'}</span><span>${Math.abs(over).toFixed(2)}</span></div>
  `;
  tip.style.display = 'block';
  tip.style.left = (e.pageX + 14) + 'px';
  tip.style.top = (e.pageY + 14) + 'px';
}

/* ---------- Mode 3: Stacked area by project (smooth ribbons) ---------- */
function renderHistogramByProjectArea() {
  const wrap = $('#hist-wrap');
  const { totalDemand, totalCap, projectTotal } = computeTotalSeries();
  const horizon = horizonMonths();
  const sIdx = _histRange.sIdx, eIdx = _histRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 70;
  const padTop = 56;
  const chartH = 320;
  const padBottom = 56;
  const width = labelW + visN * colW + 24;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;
  const xCenter = (i) => xAt(i) + colW/2;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234';

  let maxStack = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    if (totalDemand[i] > maxStack) maxStack = totalDemand[i];
    if (histShowCap && totalCap[i] > maxStack) maxStack = totalCap[i];
  }
  if (maxStack === 0) maxStack = 1;
  const yMax = Math.ceil(maxStack * 1.1);
  const yFor = (val) => padTop + chartH - (val / yMax) * chartH;

  const orderedProjects = projectStackOrder();

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  const yTicks = 5;
  for (let t = 0; t <= yTicks; t++) {
    const v = yMax * t / yTicks;
    const y = padTop + chartH - (v / yMax) * chartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 10}" y="${y+4}" text-anchor="end" font-size="11" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 10}" y="${padTop - 14}" text-anchor="end" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700" letter-spacing="0.5">FTE</text>`;

  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = visN <= 18 ? 1 : (visN <= 24 ? 2 : 3);
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2" stroke-dasharray="2 3" opacity="0.6"/>`;
      svg += `<text x="${x+5}" y="${padTop - 6}" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if ((i - sIdx) % labelEvery === 0) {
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 18}" text-anchor="middle" font-size="10" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  // Build sliced arrays of stacked tops/bottoms for visible window only
  const stacks = [];
  const projBottoms = [];
  let runningBase = new Array(visN).fill(0);
  for (const proj of orderedProjects) {
    const bottom = [...runningBase];
    const top = new Array(visN);
    for (let k = 0; k < visN; k++) {
      const i = sIdx + k;
      top[k] = runningBase[k] + projectTotal[proj.id][i];
    }
    projBottoms.push(bottom);
    stacks.push(top);
    runningBase = top;
  }

  // Use a localized xCenter that maps visible-index k -> screen x
  const xCenterVis = (k) => labelW + k * colW + colW/2;

  orderedProjects.forEach((proj, idx) => {
    const top = stacks[idx];
    const bot = projBottoms[idx];
    const path = buildRibbonPath(top, bot, xCenterVis, yFor, visN);
    const color = projectColor(proj.id);
    svg += `<path class="hist-area-proj" data-proj="${proj.id}" d="${path}" fill="${color}" fill-opacity="0.85" stroke="#ffffff" stroke-width="0.6"/>`;
  });

  // Excess burden shading where demand > cap (visible range only)
  if (histShowCap) {
    let segs = [];
    let segStart = null;
    for (let i = sIdx; i <= eIdx; i++) {
      if (totalDemand[i] > totalCap[i]) {
        if (segStart === null) segStart = i;
      } else if (segStart !== null) {
        segs.push([segStart, i-1]);
        segStart = null;
      }
    }
    if (segStart !== null) segs.push([segStart, eIdx]);

    for (const [a, b] of segs) {
      const topPts = [], botPts = [];
      for (let i = a; i <= b; i++) {
        topPts.push([xCenter(i), yFor(totalDemand[i])]);
        botPts.push([xCenter(i), yFor(totalCap[i])]);
      }
      if (topPts.length > 0) {
        const startX = xCenter(a) - colW/2;
        const endX = xCenter(b) + colW/2;
        topPts.unshift([startX, yFor(totalDemand[a])]);
        topPts.push([endX, yFor(totalDemand[b])]);
        botPts.unshift([startX, yFor(totalCap[a])]);
        botPts.push([endX, yFor(totalCap[b])]);
      }
      let d = `M ${topPts[0][0]} ${topPts[0][1]}`;
      for (let k = 1; k < topPts.length; k++) d += ` L ${topPts[k][0]} ${topPts[k][1]}`;
      for (let k = botPts.length - 1; k >= 0; k--) d += ` L ${botPts[k][0]} ${botPts[k][1]}`;
      d += ' Z';
      svg += `<path d="${d}" fill="${CORAL}" fill-opacity="0.22" stroke="${CORAL}" stroke-width="0.5" stroke-opacity="0.4"/>`;
    }
  }

  // Capacity step line
  if (histShowCap) {
    let pathD = '';
    for (let i = sIdx; i <= eIdx; i++) {
      const x1 = xAt(i);
      const x2 = x1 + colW;
      const y = padTop + chartH - (totalCap[i] / yMax) * chartH;
      if (i === sIdx) pathD += `M ${x1} ${y}`;
      else pathD += ` L ${x1} ${y}`;
      pathD += ` L ${x2} ${y}`;
    }
    svg += `<path d="${pathD}" fill="none" stroke="${CORAL}" stroke-width="2.5" stroke-dasharray="6 3"/>`;
  }

  // Invisible hover columns (visible range)
  for (let i = sIdx; i <= eIdx; i++) {
    svg += `<rect class="area-hover" data-midx="${i}" x="${xAt(i)}" y="${padTop}" width="${colW}" height="${chartH}" fill="transparent"/>`;
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.hist-area-proj').forEach(p => {
    p.style.cursor = 'pointer';
    p.addEventListener('click', () => openProjectDetailModal(p.dataset.proj));
    p.addEventListener('mouseenter', () => {
      p.setAttribute('fill-opacity', '1.0');
      p.setAttribute('stroke', '#19446C');
      p.setAttribute('stroke-width', '1.5');
    });
    p.addEventListener('mouseleave', () => {
      p.setAttribute('fill-opacity', '0.85');
      p.setAttribute('stroke', '#ffffff');
      p.setAttribute('stroke-width', '0.6');
    });
  });

  wrap.querySelectorAll('.area-hover').forEach(h => {
    h.addEventListener('mousemove', (e) => showProjectHistTip(e, h, totalDemand, totalCap, projectTotal, horizon));
    h.addEventListener('mouseleave', hideTip);
  });

  renderProjectLegend();
}

/* Build a smoothed closed ribbon path for stacked-area mode.
   Uses cardinal-spline-style midpoint smoothing for natural worm shape.
*/
function buildRibbonPath(topVals, botVals, xCenter, yFor, N) {
  // Top points along chart
  const topPts = topVals.map((v,i) => [xCenter(i), yFor(v)]);
  const botPts = botVals.map((v,i) => [xCenter(i), yFor(v)]);

  // Build smooth path top
  let d = `M ${topPts[0][0]} ${topPts[0][1]}`;
  for (let i = 0; i < topPts.length - 1; i++) {
    const p0 = topPts[Math.max(0, i-1)];
    const p1 = topPts[i];
    const p2 = topPts[i+1];
    const p3 = topPts[Math.min(topPts.length-1, i+2)];
    // Catmull-Rom -> Bezier control points (tension 0.5)
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  // Reverse path bottom
  d += ` L ${botPts[botPts.length-1][0]} ${botPts[botPts.length-1][1]}`;
  for (let i = botPts.length - 1; i > 0; i--) {
    const p0 = botPts[Math.min(botPts.length-1, i+1)];
    const p1 = botPts[i];
    const p2 = botPts[i-1];
    const p3 = botPts[Math.max(0, i-2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  d += ' Z';
  return d;
}

/* ---------- Project legend (with "open detail" buttons) ---------- */
function renderProjectLegend() {
  const CORAL = '#C05234';
  const orderedProjects = projectStackOrder();
  const items = orderedProjects.map(p => {
    const c = projectColor(p.id);
    const loc = getLocation(p.locationId);
    const locTag = loc && loc.multiplier !== 1.0 ? ` · ${loc.multiplier.toFixed(2)}×` : '';
    return `<div class="legend-item" style="cursor:pointer" data-detail-proj="${p.id}" title="Click for role breakdown">
      <span class="legend-swatch" style="background:${c}"></span>${escapeHtml(p.name)}<span style="color:var(--ink-mute);font-size:10px;margin-left:4px">${escapeHtml(locTag)}</span>
    </div>`;
  }).join('');
  const capLegend = histShowCap
    ? `<div class="legend-item"><span class="legend-swatch" style="background:${CORAL};border-style:dashed"></span>Total Capacity</div><div class="legend-item"><span class="legend-swatch" style="background:rgba(192,82,52,0.22)"></span>Excess Burden</div>`
    : '';
  $('#hist-legend').innerHTML = items + capLegend;

  $$('#hist-legend [data-detail-proj]').forEach(el => {
    el.addEventListener('click', () => openProjectDetailModal(el.dataset.detailProj));
  });
}

/* ---------- Bottleneck strip (per-role worst ratio) ---------- */
function renderBottleneckStrip() {
  const wrap = $('#bottleneck-wrap');
  const horizon = horizonMonths();
  const { ratios, drivers } = computeBottleneckSeries();
  const sIdx = _histRange.sIdx, eIdx = _histRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 70;
  const padTop = 28;
  const chartH = 64;
  const padBottom = 24;
  const width = labelW + visN * colW + 24;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040';
  const OK = '#6E8C34', WATCH = '#C4A230', BAD = '#C05234';

  function ratioColor(r) {
    if (r <= 0.85) return OK;
    if (r <= 1.0)  return WATCH;
    return BAD;
  }

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  svg += `<line x1="${labelW}" y1="${padTop + chartH}" x2="${width-20}" y2="${padTop + chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
  const yOne = padTop + chartH - (1.0 / 1.5) * chartH;
  svg += `<line x1="${labelW}" y1="${yOne}" x2="${width-20}" y2="${yOne}" stroke="${BAD}" stroke-width="1" stroke-dasharray="3 3"/>`;
  svg += `<text x="${labelW - 10}" y="${yOne + 4}" text-anchor="end" font-size="10" font-family="Inter" fill="${BAD}" font-weight="600">1.0×</text>`;
  svg += `<text x="${labelW - 10}" y="${padTop + chartH + 4}" text-anchor="end" font-size="10" font-family="Inter" fill="${CHARCOAL}">0</text>`;
  svg += `<text x="${labelW - 10}" y="${padTop + 10}" text-anchor="end" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">Ratio</text>`;

  const barW = Math.max(6, colW - 6);
  for (let i = sIdx; i <= eIdx; i++) {
    const r = ratios[i];
    if (r === 0) continue;
    const clamped = Math.min(r, 1.5);
    const segH = (clamped / 1.5) * chartH;
    const x = xAt(i) + 3;
    const y = padTop + chartH - segH;
    const color = ratioColor(r);
    svg += `<rect class="bn-bar" data-midx="${i}" x="${x}" y="${y}" width="${barW}" height="${segH}" fill="${color}" stroke="#ffffff" stroke-width="0.5"/>`;
  }

  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1" opacity="0.5"/>`;
      svg += `<text x="${x+5}" y="${padTop + chartH + 16}" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.bn-bar').forEach(bar => {
    bar.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(bar.dataset.midx, 10);
      const r = ratios[midx];
      const driver = drivers[midx];
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong></div>
        <div class="tooltip-row"><span>Worst ratio</span><span>${r.toFixed(2)}×</span></div>
        <div class="tooltip-row"><span>Driven by</span><span>${driver ? escapeHtml(driver.name) : '—'}</span></div>
        <div style="font-size:10px;color:#aaa;margin-top:4px">${r > 1.0 ? '⚠ Over capacity in this role' : r > 0.85 ? 'At watch level (>85%)' : 'Healthy headroom'}</div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    bar.addEventListener('mouseleave', hideTip);
  });

  $('#bottleneck-legend').innerHTML = `
    <div class="legend-item"><span class="legend-swatch" style="background:${OK}"></span>Healthy (≤0.85×)</div>
    <div class="legend-item"><span class="legend-swatch" style="background:${WATCH}"></span>Watch (0.85–1.0×)</div>
    <div class="legend-item"><span class="legend-swatch" style="background:${BAD}"></span>Over (>1.0×)</div>
    <div class="legend-item" style="margin-left:auto;font-style:italic">Each bar = the most stressed role for that month.</div>
  `;
}

/* ---------- Mode buttons wiring ---------- */
$$('.hist-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.hist-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    histMode = btn.dataset.mode;
    renderHistogram();
  });
});
$('#hist-cap-toggle').addEventListener('change', (e) => {
  histShowCap = e.target.checked;
  renderHistogram();
});

// Histogram range sliders
function wireHistRange() {
  const startInp = $('#hist-range-start');
  const endInp = $('#hist-range-end');
  const onRange = () => {
    let s = parseInt(startInp.value, 10);
    let e = parseInt(endInp.value, 10);
    if (s > e) { const t = s; s = e; e = t; }
    if (e - s < 1) e = Math.min(35, s + 1);
    _histRange.sIdx = s;
    _histRange.eIdx = e;
    renderHistogram();
  };
  startInp.addEventListener('input', onRange);
  endInp.addEventListener('input', onRange);
  $('#hist-range-reset').addEventListener('click', () => {
    _histRange.sIdx = 0; _histRange.eIdx = 35;
    startInp.value = 0; endInp.value = 35;
    renderHistogram();
  });
}
wireHistRange();

/* ---------- Project detail modal (role breakdown) ---------- */
/* ============================================================
   PROJECT DETAIL MODAL — two stacked charts (Resources + Cashflow)
   with shared x-axis and horizontal zoom.
   ============================================================ */

// Cached so the zoom slider doesn't re-build everything
let _detailProjectId = null;
let _detailZoom = { startIdx: 0, endIdx: 35 };  // inclusive month-idx range visible

function openProjectDetailModal(projectId) {
  const proj = getProject(projectId);
  if (!proj) return;
  _detailProjectId = projectId;

  // Initial zoom: clip to where the project actually exists, with 1-month padding on each side
  const projStartIdx = monthsBetween(state.startMonth, proj.startMonth);
  const projEndIdx = projStartIdx + totalEffectiveDuration(proj);
  _detailZoom.startIdx = Math.max(0, projStartIdx - 1);
  _detailZoom.endIdx = Math.min(35, projEndIdx + 1);
  if (_detailZoom.endIdx <= _detailZoom.startIdx) {
    _detailZoom.startIdx = 0; _detailZoom.endIdx = 35;
  }

  buildDetailModalShell(proj);
  renderDetailCharts();
  $('#modal-project-detail').classList.add('open');
}

function buildDetailModalShell(proj) {
  const { projectDemand } = computeAllDemand();
  const projDem = projectDemand[proj.id];
  const horizon = horizonMonths();
  const cf = computeProjectCashflow(proj);

  // Project metrics
  let peakFTE = 0, peakMonth = null;
  const totalsByMonth = new Array(36).fill(0);
  for (let i = 0; i < 36; i++) {
    for (const r of state.roles) totalsByMonth[i] += projDem[r.id][i];
    if (totalsByMonth[i] > peakFTE) { peakFTE = totalsByMonth[i]; peakMonth = horizon[i]; }
  }
  const totalFTEMonths = totalsByMonth.reduce((a,b)=>a+b, 0);
  const totalCash = cf.cashIn.reduce((a,b)=>a+b, 0);
  const totalCost = cf.costOut.reduce((a,b)=>a+b, 0);
  const totalNet = totalCash - totalCost;
  const peakCashMonth = (() => {
    let mx = 0, m = null;
    for (let i = 0; i < 36; i++) { if (cf.cashIn[i] > mx) { mx = cf.cashIn[i]; m = horizon[i]; } }
    return { mx, m };
  })();

  const loc = getLocation(proj.locationId);
  const tpl = getTemplate(proj.templateId);
  const billingModeLabel = ({
    'milestone': 'Milestone (cash basis)',
    'accrual_poc': 'Milestone + Accrual POC',
    'monthly': 'Continuous Monthly'
  })[proj.billingMode || 'milestone'];

  // Role totals
  const roleTotals = state.roles.map(r => {
    const total = projDem[r.id].reduce((a,b)=>a+b, 0);
    const peak = Math.max(...projDem[r.id]);
    return { role: r, total, peak };
  }).filter(rt => rt.total > 0).sort((a,b) => b.total - a.total);

  $('#modal-project-detail-title').textContent = proj.name;
  const wp = proj.winProbability != null ? proj.winProbability : 100;
  const wpColor = winProbColor(wp);
  $('#modal-project-detail-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1.1fr 1fr;gap:18px;margin-bottom:18px">
      <div>
        <div class="eyebrow">Project</div>
        <div style="font-family:var(--font-display);font-size:22px;color:var(--ink-strong);margin:2px 0 6px;line-height:1.15">${escapeHtml(proj.name)}</div>
        <div style="font-size:13px;color:var(--gray)">${escapeHtml(proj.client||'—')} · ${escapeHtml(proj.location||'')}</div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="tag template">${tpl ? escapeHtml(tpl.name) : 'custom'}</span>
          ${loc ? `<span class="tag location">${escapeHtml(loc.name)}</span>` : ''}
          ${loc && loc.multiplier !== 1.0 ? `<span class="tag multiplier">${loc.multiplier.toFixed(2)}×</span>` : ''}
          <span class="tag" style="background:var(--succ-green);color:#fff">${escapeHtml(billingModeLabel)}</span>
          <span class="tag" style="background:${wpColor};color:#fff">${wp}% — ${wp >= 100 ? 'booked' : wp >= 85 ? 'awarded' : wp >= 65 ? 'LOI' : wp >= 40 ? 'proposal' : wp >= 20 ? 'qualified' : 'lead'}</span>
        </div>
      </div>
      <div>
        <div class="kpi-row" style="grid-template-columns:1fr 1fr 1fr;margin:0;gap:10px">
          <div class="kpi-card"><div class="kpi-label">Contract / Weighted</div><div class="kpi-value" style="font-size:22px">${fmtMoney(proj.contractValue || 0, {compact:true})}</div><div class="kpi-sub" style="color:${wpColor}">risk-weighted ${fmtMoney((proj.contractValue||0) * wp / 100, {compact:true})}</div></div>
          <div class="kpi-card"><div class="kpi-label">Peak Load</div><div class="kpi-value" style="font-size:24px">${peakFTE.toFixed(1)}</div><div class="kpi-sub">FTE · ${peakMonth ? monthLabel(peakMonth) : '—'}</div></div>
          <div class="kpi-card"><div class="kpi-label">Total Burden</div><div class="kpi-value" style="font-size:24px">${totalFTEMonths.toFixed(0)}</div><div class="kpi-sub">FTE-months</div></div>
        </div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:14px;flex-wrap:wrap">
      <div class="section-label" style="margin:0">Resource Load &amp; Cashflow · ${monthLabel(horizon[_detailZoom.startIdx], false)} → ${monthLabel(horizon[_detailZoom.endIdx], false)}</div>
      <div style="display:flex;gap:14px;align-items:center;font-size:11px;color:var(--gray)">
        <span>Zoom:</span>
        <input type="range" id="detail-zoom-start" min="0" max="35" step="1" value="${_detailZoom.startIdx}" style="width:140px">
        <input type="range" id="detail-zoom-end" min="0" max="35" step="1" value="${_detailZoom.endIdx}" style="width:140px">
        <button class="btn ghost small" id="detail-zoom-reset">Reset</button>
        <button class="btn ghost small" id="detail-zoom-fit">Fit Project</button>
      </div>
    </div>

    <div id="detail-charts" style="background:#fff;border:1px solid var(--rule-soft);padding:8px;overflow-x:auto"></div>

    <div class="section-label" style="margin-top:18px">Role Contribution Totals</div>
    <table class="phase-table" style="width:100%">
      <thead><tr><th>Role</th><th style="width:130px;text-align:right">Total FTE-mo</th><th style="width:130px;text-align:right">Peak FTE</th><th style="width:90px;text-align:right">% of total</th></tr></thead>
      <tbody>
        ${roleTotals.map(rt => `
          <tr>
            <td><span class="phase-color-dot" style="background:${rt.role.color}"></span>${escapeHtml(rt.role.name)}</td>
            <td style="text-align:right" class="mono">${rt.total.toFixed(2)}</td>
            <td style="text-align:right" class="mono">${rt.peak.toFixed(2)}</td>
            <td style="text-align:right;color:var(--gray)" class="mono">${totalFTEMonths > 0 ? (rt.total/totalFTEMonths*100).toFixed(0) + '%' : '0%'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="section-label" style="margin-top:18px">Cashflow Summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
      <div class="kpi-card"><div class="kpi-label">Total Cash In</div><div class="kpi-value" style="font-size:20px;color:var(--succ-green)">${fmtMoney(totalCash, {compact:true})}</div><div class="kpi-sub">revenue · 36mo horizon</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Cost Out</div><div class="kpi-value" style="font-size:20px;color:var(--coral)">${fmtMoney(totalCost, {compact:true})}</div><div class="kpi-sub">${proj.contractValue > 0 ? (totalCost/proj.contractValue*100).toFixed(0)+'% of contract' : '—'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Net (rev − cost)</div><div class="kpi-value" style="font-size:20px;color:${totalNet >= 0 ? 'var(--teal)' : 'var(--crit-red)'}">${fmtMoney(totalNet, {compact:true})}</div><div class="kpi-sub">${proj.contractValue > 0 ? (totalNet/proj.contractValue*100).toFixed(0)+'% margin' : '—'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Booked vs Contract</div><div class="kpi-value" style="font-size:20px">${(proj.contractValue||0) > 0 ? (totalCash/(proj.contractValue)*100).toFixed(0)+'%' : '—'}</div><div class="kpi-sub">peak month ${peakCashMonth.m ? monthLabel(peakCashMonth.m) : '—'}</div></div>
    </div>

    <div style="margin-top:18px;display:flex;gap:8px;justify-content:flex-end">
      <button class="btn ghost" id="modal-project-detail-edit">Open Full Project Editor</button>
    </div>
  `;

  $('#modal-project-detail-edit').onclick = () => {
    $('#modal-project-detail').classList.remove('open');
    openProjectModal(proj.id);
  };

  // Wire zoom sliders
  const startInp = $('#detail-zoom-start');
  const endInp = $('#detail-zoom-end');
  const onZoom = () => {
    let s = parseInt(startInp.value, 10);
    let e = parseInt(endInp.value, 10);
    if (s > e) { const t = s; s = e; e = t; }
    if (e - s < 1) e = Math.min(35, s + 1);
    _detailZoom.startIdx = s;
    _detailZoom.endIdx = e;
    // Update header label text
    const lbl = $('#modal-project-detail-body .section-label');
    if (lbl) lbl.textContent = `Resource Load & Cashflow · ${monthLabel(horizon[s], false)} → ${monthLabel(horizon[e], false)}`;
    renderDetailCharts();
  };
  startInp.addEventListener('input', onZoom);
  endInp.addEventListener('input', onZoom);

  $('#detail-zoom-reset').onclick = () => {
    _detailZoom.startIdx = 0; _detailZoom.endIdx = 35;
    startInp.value = 0; endInp.value = 35;
    onZoom();
  };
  $('#detail-zoom-fit').onclick = () => {
    const ps = monthsBetween(state.startMonth, proj.startMonth);
    const pe = ps + totalEffectiveDuration(proj);
    _detailZoom.startIdx = Math.max(0, ps - 1);
    _detailZoom.endIdx = Math.min(35, pe + 1);
    startInp.value = _detailZoom.startIdx; endInp.value = _detailZoom.endIdx;
    onZoom();
  };
}

/* Render the two stacked charts in the modal */
function renderDetailCharts() {
  const proj = getProject(_detailProjectId);
  if (!proj) return;
  const horizon = horizonMonths();
  const { projectDemand } = computeAllDemand();
  const projDem = projectDemand[proj.id];
  const cf = computeProjectCashflow(proj);
  const sIdx = _detailZoom.startIdx;
  const eIdx = _detailZoom.endIdx;
  const visN = eIdx - sIdx + 1;

  // Chart geometry
  const labelW = 70;
  const padTop = 32;
  const fteChartH = 180;
  const cashChartH = 160;
  const axisH = 40;
  const gap = 12;
  const minColW = 22;
  const maxColW = 90;
  // Available width target: use about 920px when modal is wide; allow horizontal scroll if exceeded
  const targetWidth = 920;
  const availForCols = targetWidth - labelW - 20;
  let colW = Math.max(minColW, Math.min(maxColW, Math.floor(availForCols / visN)));
  const width = labelW + visN * colW + 20;
  const fteTop = padTop;
  const cashTop = padTop + fteChartH + gap + axisH;
  const totalH = padTop + fteChartH + gap + axisH + cashChartH + 20;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', WARM_WHITE = '#FAF8F4', CORAL = '#C05234', TEAL = '#00929F', SAGE = '#809848', AMBER = '#C4A230';

  // FTE chart data
  const totalsByMonth = new Array(36).fill(0);
  for (let i = 0; i < 36; i++) for (const r of state.roles) totalsByMonth[i] += projDem[r.id][i];
  let visibleMaxFTE = 0;
  for (let i = sIdx; i <= eIdx; i++) if (totalsByMonth[i] > visibleMaxFTE) visibleMaxFTE = totalsByMonth[i];
  const yMaxFTE = visibleMaxFTE > 0 ? Math.ceil(visibleMaxFTE * 1.15 * 10) / 10 : 1;

  // Cash chart data (in zoom window): revenue (cash in) + cost (cash out) + cumulative net + revenue line (for accrual_poc)
  let visibleMaxRev = 0;
  let visibleMaxCost = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    if (cf.cashIn[i] > visibleMaxRev) visibleMaxRev = cf.cashIn[i];
    if (cf.costOut[i] > visibleMaxCost) visibleMaxCost = cf.costOut[i];
  }
  if ((proj.billingMode||'milestone') === 'accrual_poc') {
    for (let i = sIdx; i <= eIdx; i++) if (cf.revenueRecognized[i] > visibleMaxRev) visibleMaxRev = cf.revenueRecognized[i];
  }
  const yMaxRev = visibleMaxRev > 0 ? niceCeil(visibleMaxRev * 1.15) : 1;
  const yMaxCost = visibleMaxCost > 0 ? niceCeil(visibleMaxCost * 1.15) : 0.0001;
  // Combined visible "max cash" used for axis sizing
  const yMaxCash = Math.max(yMaxRev, yMaxCost);
  // Cumulative net axis (separate right axis): bounded by visible cum net min/max
  let visibleCumMin = 0, visibleCumMax = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    if (cf.cumNet[i] > visibleCumMax) visibleCumMax = cf.cumNet[i];
    if (cf.cumNet[i] < visibleCumMin) visibleCumMin = cf.cumNet[i];
  }
  const cumSpan = Math.max(Math.abs(visibleCumMax), Math.abs(visibleCumMin), 1);
  const yMaxCum = niceCeil(cumSpan * 1.1);
  const hasCost = visibleMaxCost > 0.01;

  function xCol(i) { return labelW + (i - sIdx) * colW; }
  function xCenter(i) { return xCol(i) + colW/2; }

  let svg = `<svg width="${width}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${totalH}" fill="#ffffff"/>`;

  // ---- FTE CHART ----
  // Y grid
  const fteTicks = 4;
  for (let t = 0; t <= fteTicks; t++) {
    const v = yMaxFTE * t / fteTicks;
    const y = fteTop + fteChartH - (v / yMaxFTE) * fteChartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 8}" y="${y+4}" text-anchor="end" font-size="10" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 8}" y="${fteTop - 8}" text-anchor="end" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">FTE</text>`;
  svg += `<text x="${labelW + 4}" y="${fteTop - 8}" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="600">Resource Load (stacked by role)</text>`;

  // Stacked bars by role
  const barW = Math.max(4, colW - 4);
  for (let i = sIdx; i <= eIdx; i++) {
    let yCursor = fteTop + fteChartH;
    for (const r of state.roles) {
      const v = projDem[r.id][i];
      const segH = (v / yMaxFTE) * fteChartH;
      if (segH > 0) {
        svg += `<rect class="d-fte-bar" data-midx="${i}" data-role="${r.id}" data-v="${v.toFixed(2)}" x="${xCol(i) + 2}" y="${yCursor - segH}" width="${barW}" height="${segH}" fill="${r.color}" stroke="#fff" stroke-width="0.5"/>`;
        yCursor -= segH;
      }
    }
  }

  // ---- SHARED X-AXIS BAND (months) ----
  const axisTop = fteTop + fteChartH;
  const axisBot = axisTop + axisH;
  svg += `<rect x="${labelW}" y="${axisTop}" width="${width - labelW - 20}" height="${axisH}" fill="${WARM_WHITE}"/>`;
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xCol(i);
    const isYrStart = d.getMonth() === 0;
    // Vertical separator
    if (isYrStart) {
      svg += `<line x1="${x}" y1="${fteTop}" x2="${x}" y2="${cashTop + cashChartH}" stroke="${DEEP_BLUE}" stroke-width="1.2" opacity="0.7"/>`;
    }
    // Month label
    const showMonth = (visN <= 18) || (i % Math.max(1, Math.floor(visN / 18)) === 0);
    if (showMonth) {
      svg += `<text x="${x + colW/2}" y="${axisTop + 14}" text-anchor="middle" font-size="10" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
      svg += `<text x="${x + colW/2}" y="${axisTop + 28}" text-anchor="middle" font-size="9" font-family="Inter" fill="${DEEP_BLUE}" font-weight="600">${String(d.getFullYear()).slice(2)}</text>`;
    }
  }

  // ---- PHASE STRIP within the axis band: shows which phase each month belongs to ----
  // Compute phase per month within this project
  const effDurs = effectivePhaseDurations(proj);
  let cursor = proj.startMonth;
  proj.phases.forEach((ph, phIdx) => {
    const phMeta = getPhase(ph.phaseId);
    const phStart = monthsBetween(state.startMonth, cursor);
    const phEnd = phStart + effDurs[phIdx];
    const visPhStart = Math.max(phStart, sIdx);
    const visPhEnd = Math.min(phEnd, eIdx + 1);
    if (visPhEnd > visPhStart) {
      const x = xCol(visPhStart);
      const w = (visPhEnd - visPhStart) * colW;
      const color = phMeta ? phMeta.color : '#888';
      // Thin colored strip just under FTE chart, inside the axis band
      svg += `<rect x="${x}" y="${axisTop + 32}" width="${w}" height="6" fill="${color}" opacity="0.85"/>`;
      // Phase label if wide enough
      if (w > 60) {
        svg += `<text x="${x + w/2}" y="${axisTop + 37}" text-anchor="middle" font-size="8" font-family="Inter" fill="#fff" font-weight="700" letter-spacing="0.4">${escapeHtml(phMeta ? phMeta.name.toUpperCase() : ph.phaseId)}</text>`;
      }
    }
    cursor = addMonths(cursor, effDurs[phIdx]);
  });

  // ---- CASH CHART (with zero crossing if any costs exist) ----
  // Split cashChartH between positive (revenue) above zero and negative (cost) below zero
  // proportionally to their magnitudes.
  const posSpan = yMaxRev;
  const negSpan = hasCost ? yMaxCost : 0;
  const totalSpan = posSpan + negSpan;
  const posH = totalSpan > 0 ? (posSpan / totalSpan) * cashChartH : cashChartH;
  const negH = cashChartH - posH;
  const yZero = cashTop + posH;
  // Y position helpers
  const yPosCash = (v) => yZero - (v / posSpan) * posH;
  const yNegCash = (v) => yZero + (v / Math.max(negSpan, 0.0001)) * negH;
  // Cumulative net (right axis): zero shares the same yZero; scale = yMaxCum
  const yCumNet = (v) => {
    if (v >= 0) return yZero - (v / yMaxCum) * posH;
    return yZero + (Math.abs(v) / yMaxCum) * negH;
  };

  // Y grid
  const cashTicks = 3;
  for (let t = 0; t <= cashTicks; t++) {
    const v = posSpan * t / cashTicks;
    const y = yPosCash(v);
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 8}" y="${y+4}" text-anchor="end" font-size="10" font-family="Inter" fill="${CHARCOAL}">${fmtMoney(v, {compact:true})}</text>`;
  }
  if (hasCost) {
    for (let t = 1; t <= 2; t++) {
      const v = negSpan * t / 2;
      const y = yNegCash(v);
      svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${LINE}" stroke-dasharray="2 3"/>`;
      svg += `<text x="${labelW - 8}" y="${y+4}" text-anchor="end" font-size="10" font-family="Inter" fill="${CORAL}">−${fmtMoney(v, {compact:true})}</text>`;
    }
  }
  svg += `<text x="${labelW - 8}" y="${cashTop - 8}" text-anchor="end" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">$ in / out</text>`;
  svg += `<text x="${labelW + 4}" y="${cashTop - 8}" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="600">Cashflow (${escapeHtml(({'milestone':'milestone cash','accrual_poc':'milestone cash + accrual revenue','monthly':'continuous monthly'})[proj.billingMode||'milestone'])}${hasCost ? ', with cost outflows' : ''})</text>`;

  // Right-axis cumulative net labels
  for (let t = 1; t <= 3; t++) {
    const v = yMaxCum * t / 3;
    const yp = yCumNet(v);
    svg += `<text x="${width - 16}" y="${yp+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${TEAL}" font-weight="500">${fmtMoney(v, {compact:true})}</text>`;
    if (visibleCumMin < 0) {
      const yn = yCumNet(-v);
      svg += `<text x="${width - 16}" y="${yn+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${TEAL}" font-weight="500">−${fmtMoney(v, {compact:true})}</text>`;
    }
  }
  svg += `<text x="${width - 16}" y="${cashTop - 8}" text-anchor="end" font-size="10" font-family="Inter" fill="${TEAL}" font-weight="700">cum net</text>`;

  // Revenue bars (positive, above zero)
  for (let i = sIdx; i <= eIdx; i++) {
    const v = cf.cashIn[i];
    if (v <= 0) continue;
    const segH = (v / posSpan) * posH;
    const x = xCol(i) + 2;
    const y = yZero - segH;
    svg += `<rect class="d-cash-bar" data-midx="${i}" data-kind="rev" data-v="${v}" x="${x}" y="${y}" width="${barW}" height="${segH}" fill="${SAGE}" stroke="#fff" stroke-width="0.5"/>`;
    if ((proj.billingMode || 'milestone') !== 'monthly' && segH > 12) {
      svg += `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" font-size="9" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${fmtMoney(v,{compact:true})}</text>`;
    }
  }

  // Cost bars (negative, below zero)
  for (let i = sIdx; i <= eIdx; i++) {
    const v = cf.costOut[i];
    if (v <= 0) continue;
    const segH = (v / Math.max(negSpan, 0.0001)) * negH;
    const x = xCol(i) + 2;
    const y = yZero;
    svg += `<rect class="d-cost-bar" data-midx="${i}" data-kind="cost" data-v="${v}" x="${x}" y="${y}" width="${barW}" height="${segH}" fill="${CORAL}" fill-opacity="0.85" stroke="#fff" stroke-width="0.5"/>`;
    if (segH > 12) {
      svg += `<text x="${x + barW/2}" y="${y + segH + 11}" text-anchor="middle" font-size="9" font-family="Inter" fill="${CORAL}" font-weight="700">−${fmtMoney(v,{compact:true})}</text>`;
    }
  }

  // Zero baseline emphasis
  svg += `<line x1="${labelW}" y1="${yZero}" x2="${width-20}" y2="${yZero}" stroke="${DEEP_BLUE}" stroke-width="1.5"/>`;

  // Revenue recognized line (accrual_poc only)
  if ((proj.billingMode || 'milestone') === 'accrual_poc') {
    let revPath = '';
    let first = true;
    for (let i = sIdx; i <= eIdx; i++) {
      const v = cf.revenueRecognized[i];
      const y = yPosCash(v);
      const x = xCenter(i);
      if (first) { revPath += `M ${x} ${y}`; first = false; }
      else revPath += ` L ${x} ${y}`;
    }
    if (revPath) svg += `<path d="${revPath}" fill="none" stroke="${AMBER}" stroke-width="2" stroke-dasharray="4 3"/>`;
  }

  // Cumulative NET line (right-axis scale)
  let cumPath = '';
  for (let i = sIdx; i <= eIdx; i++) {
    const v = cf.cumNet[i];
    const y = yCumNet(v);
    const x = xCenter(i);
    if (i === sIdx) cumPath += `M ${x} ${y}`;
    else cumPath += ` L ${x} ${y}`;
  }
  if (cumPath) svg += `<path d="${cumPath}" fill="none" stroke="${TEAL}" stroke-width="2.5"/>`;

  // Milestone markers on cash chart
  if ((proj.billingMode || 'milestone') !== 'monthly') {
    const boundaries = projectPhaseBoundaries(proj);
    const ms = proj.milestones || [];
    for (const m of ms) {
      const a = m.anchor;
      let anchorKey;
      if (a === 'start') anchorKey = proj.startMonth;
      else if (a === '_end') anchorKey = addMonths(state.startMonth, boundaries._end.endIdx);
      else {
        const b = boundaries[a];
        if (!b) continue;
        anchorKey = addMonths(addMonths(state.startMonth, b.endIdx), -1);
      }
      const targetKey = addMonths(anchorKey, m.offsetMonths || 0);
      const mi = monthsBetween(state.startMonth, targetKey);
      if (mi < sIdx || mi > eIdx) continue;
      const x = xCenter(mi);
      svg += `<line x1="${x}" y1="${cashTop - 4}" x2="${x}" y2="${cashTop + 4}" stroke="${DEEP_BLUE}" stroke-width="2"/>`;
      svg += `<circle cx="${x}" cy="${cashTop - 8}" r="3.5" fill="${CORAL}" stroke="${DEEP_BLUE}" stroke-width="1"/>`;
    }
  }

  // Today line (if in window)
  const todayIdx = monthsBetween(state.startMonth, monthKey(new Date()));
  if (todayIdx >= sIdx && todayIdx <= eIdx) {
    const x = xCenter(todayIdx);
    svg += `<line x1="${x}" y1="${fteTop}" x2="${x}" y2="${cashTop + cashChartH}" stroke="${CORAL}" stroke-width="2" stroke-dasharray="4 3" opacity="0.8"/>`;
    svg += `<text x="${x}" y="${fteTop - 14}" text-anchor="middle" font-size="9" font-family="Inter" fill="${CORAL}" font-weight="700">TODAY</text>`;
  }

  // Outer border
  svg += `<rect x="0" y="0" width="${width}" height="${totalH}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';

  $('#detail-charts').innerHTML = svg;

  // Tooltips
  $$('#detail-charts .d-fte-bar').forEach(b => {
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const mi = parseInt(b.dataset.midx, 10);
      const role = getRole(b.dataset.role);
      const rows = [];
      let tot = 0;
      for (const rr of state.roles) {
        const v = projDem[rr.id][mi];
        tot += v;
        if (v > 0.01) rows.push({ name: rr.name, v });
      }
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[mi], false)}</strong></div>
        <div style="font-size:10px;color:#aaa;margin:2px 0 6px">Hover: ${escapeHtml(role.name)} = ${parseFloat(b.dataset.v).toFixed(2)} FTE</div>
        ${rows.map(r => `<div class="tooltip-row"><span>${escapeHtml(r.name)}</span><span>${r.v.toFixed(2)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Total</strong></span><span><strong>${tot.toFixed(2)} FTE</strong></span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });

  $$('#detail-charts .d-cash-bar').forEach(b => {
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const mi = parseInt(b.dataset.midx, 10);
      const v = parseFloat(b.dataset.v);
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[mi], false)}</strong></div>
        <div class="tooltip-row"><span>Cash in (revenue)</span><span>${fmtMoney(v)}</span></div>
        <div class="tooltip-row"><span>Cash out (cost)</span><span>${fmtMoney(cf.costOut[mi])}</span></div>
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Cum net</strong></span><span><strong>${fmtMoney(cf.cumNet[mi])}</strong></span></div>
        <div class="tooltip-row"><span>% of contract billed</span><span>${(proj.contractValue||0) > 0 ? (cf.cumCash[mi]/proj.contractValue*100).toFixed(1)+'%' : '—'}</span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });
  $$('#detail-charts .d-cost-bar').forEach(b => {
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const mi = parseInt(b.dataset.midx, 10);
      const v = parseFloat(b.dataset.v);
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[mi], false)}</strong></div>
        <div class="tooltip-row" style="color:#FFB29A"><span>Cost out</span><span>−${fmtMoney(v)}</span></div>
        <div class="tooltip-row"><span>Revenue this month</span><span>${fmtMoney(cf.cashIn[mi])}</span></div>
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Cum net</strong></span><span><strong>${fmtMoney(cf.cumNet[mi])}</strong></span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });
}

/* Nice ceiling helper for money axis */
function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / exp;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
}

$('#modal-project-detail-close').addEventListener('click', () => {
  $('#modal-project-detail').classList.remove('open');
});

/* ============================================================
   CAP VS DEM VIEW
   ============================================================ */

function renderCapVDem() {
  const sel = $('#cvd-role-select');
  if (sel.options.length !== state.roles.length) {
    sel.innerHTML = state.roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    sel.onchange = drawCVD;
  }
  drawCVD();
  renderOverTable();
}

function drawCVD() {
  const roleId = $('#cvd-role-select').value || state.roles[0].id;
  const role = getRole(roleId);
  const { demand } = computeAllDemand();
  const horizon = horizonMonths();
  const dem = demand[roleId];
  const cap = state.capacity[roleId] || new Array(36).fill(0);

  const wrap = $('#cvd-wrap');
  const N = 36;
  const colW = 34;
  const labelW = 70;
  const padTop = 64;
  const chartH = 280;
  const padBottom = 50;
  const width = labelW + N * colW + 24;
  const height = padTop + chartH + padBottom;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234';

  const maxDem = Math.max(...dem, 0);
  const maxCap = Math.max(...cap, 0);
  const yMax = Math.ceil(Math.max(maxDem, maxCap) * 1.15) || 1;

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  const yTicks = 5;
  for (let t = 0; t <= yTicks; t++) {
    const v = yMax * t / yTicks;
    const y = padTop + chartH - (v / yMax) * chartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 10}" y="${y+4}" text-anchor="end" font-size="11" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 10}" y="${padTop - 14}" text-anchor="end" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">FTE / HC</text>`;
  svg += `<text x="${labelW + 8}" y="${padTop - 30}" font-size="16" font-family="DM Serif Display" font-weight="400" fill="${DEEP_BLUE}">${escapeHtml(role.name)}</text>`;

  // Over-allocation shaded regions
  for (let i = 0; i < N; i++) {
    if (dem[i] > cap[i]) {
      const x = labelW + i * colW;
      const yCap = padTop + chartH - (cap[i] / yMax) * chartH;
      const yDem = padTop + chartH - (dem[i] / yMax) * chartH;
      svg += `<rect x="${x+3}" y="${yDem}" width="${colW-6}" height="${yCap - yDem}" fill="${CORAL}" fill-opacity="0.22"/>`;
    }
  }

  // Demand bars
  for (let i = 0; i < N; i++) {
    const v = dem[i];
    const segH = (v / yMax) * chartH;
    if (segH > 0.5) {
      const x = labelW + i*colW + 5;
      const y = padTop + chartH - segH;
      svg += `<rect class="cvd-bar" data-midx="${i}" data-d="${v.toFixed(2)}" data-c="${cap[i].toFixed(1)}" x="${x}" y="${y}" width="${colW - 10}" height="${segH}" fill="${DEEP_BLUE}" stroke="#fff" stroke-width="0.5" rx="1"/>`;
    }
  }

  // Capacity step line
  let pathD = '';
  for (let i = 0; i < N; i++) {
    const x1 = labelW + i * colW;
    const x2 = labelW + (i+1) * colW;
    const y = padTop + chartH - (cap[i] / yMax) * chartH;
    if (i === 0) pathD += `M ${x1} ${y}`;
    else pathD += ` L ${x1} ${y}`;
    pathD += ` L ${x2} ${y}`;
  }
  svg += `<path d="${pathD}" fill="none" stroke="${CORAL}" stroke-width="2.5" stroke-dasharray="6 3"/>`;

  // Year markers
  for (let i = 0; i < N; i++) {
    const d = parseMonth(horizon[i]);
    const x = labelW + i * colW;
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
      svg += `<text x="${x+5}" y="${padTop - 6}" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if (i % 3 === 0) {
      const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 18}" text-anchor="middle" font-size="10" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.cvd-bar').forEach(bar => {
    bar.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(bar.dataset.midx, 10);
      const d = parseFloat(bar.dataset.d), c = parseFloat(bar.dataset.c);
      const over = d - c;
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong></div>
        <div class="tooltip-row"><span>Demand</span><span>${d.toFixed(2)} FTE</span></div>
        <div class="tooltip-row"><span>Capacity</span><span>${c.toFixed(1)} HC</span></div>
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px;color:${over>0?'#FFB29A':'#A8D9A8'}">
          <span><strong>${over > 0 ? 'Over' : 'Under'}</strong></span>
          <span><strong>${Math.abs(over).toFixed(2)}</strong></span>
        </div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    bar.addEventListener('mouseleave', hideTip);
  });
}

function renderOverTable() {
  const { demand } = computeAllDemand();
  const horizon = horizonMonths();
  const rows = [];
  for (const r of state.roles) {
    let overMonths = 0, peakOver = 0, peakMonth = '';
    for (let i = 0; i < 36; i++) {
      const c = (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
      const d = demand[r.id][i];
      if (d > c) {
        overMonths++;
        const o = d - c;
        if (o > peakOver) { peakOver = o; peakMonth = horizon[i]; }
      }
    }
    rows.push({ role: r, overMonths, peakOver, peakMonth });
  }
  const table = `
    <table class="phase-table" style="width:100%">
      <thead><tr>
        <th>Role</th><th>Over-Alloc Months</th><th>Peak Over (FTE)</th><th>Peak Month</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td><span class="phase-color-dot" style="background:${row.role.color}"></span>${escapeHtml(row.role.name)}</td>
            <td style="text-align:center" class="mono">${row.overMonths}</td>
            <td style="text-align:center" class="mono">${row.peakOver.toFixed(2)}</td>
            <td style="text-align:center" class="mono">${row.peakMonth ? monthLabel(row.peakMonth) : '—'}</td>
            <td style="text-align:center;color:${row.overMonths === 0 ? 'var(--succ-green)' : row.overMonths > 6 ? 'var(--coral)' : 'var(--amber)'};font-weight:700">
              ${row.overMonths === 0 ? 'OK' : row.overMonths > 6 ? 'CRITICAL' : 'WATCH'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  $('#over-table').innerHTML = table;
}

/* ============================================================
   TEMPLATES VIEW
   ============================================================ */

function renderTemplates() {
  const list = $('#template-list');
  list.innerHTML = state.templates.map(t => {
    const total = t.phases.reduce((a,x)=>a+x.duration,0);
    return `
      <div style="border:1px solid var(--rule);margin-bottom:14px;background:var(--bg-panel);border-radius:2px;border-left:3px solid var(--teal)">
        <div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--rule-soft);gap:14px">
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-display);font-weight:400;font-size:20px;color:var(--ink-strong);line-height:1.15">${escapeHtml(t.name)}</div>
            <div style="font-size:12px;color:var(--gray);margin-top:3px">${t.phases.length} phases · ${total} months base</div>
            ${t.description ? `<div style="font-size:12px;color:var(--charcoal);margin-top:6px;line-height:1.45">${escapeHtml(t.description)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn ghost small" data-tpl-edit="${t.id}">Edit</button>
            <button class="btn ghost small" data-tpl-clone="${t.id}">Clone</button>
            <button class="btn danger small" data-tpl-del="${t.id}">Delete</button>
          </div>
        </div>
        <div style="padding:10px 18px;display:flex;gap:5px;flex-wrap:wrap">
          ${t.phases.map(ph => {
            const pm = getPhase(ph.phaseId);
            return `<span style="background:${pm?pm.color:'#888'};color:#fff;padding:4px 10px;font-size:10px;font-weight:600;letter-spacing:0.03em;border-radius:2px">${escapeHtml(pm?pm.name:ph.phaseId)} · ${ph.duration}mo</span>`;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-tpl-edit]').forEach(btn => {
    btn.addEventListener('click', () => openTemplateModal(btn.dataset.tplEdit));
  });
  list.querySelectorAll('[data-tpl-clone]').forEach(btn => {
    btn.addEventListener('click', () => cloneTemplate(btn.dataset.tplClone));
  });
  list.querySelectorAll('[data-tpl-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tplId = btn.dataset.tplDel;
      const t = getTemplate(tplId);
      if (!confirm(`Delete template "${t.name}"? Projects using it will keep their phase data.`)) return;
      state.templates = state.templates.filter(x => x.id !== tplId);
      saveState(); renderTemplates();
    });
  });
}

function cloneTemplate(srcId) {
  const src = getTemplate(srcId);
  const name = prompt('Name for the new template?', src.name + ' (copy)');
  if (!name) return;
  const t = deepCopy(src);
  t.id = uid('tpl');
  t.name = name;
  state.templates.push(t);
  saveState();
  renderTemplates();
  toast(`Template "${name}" created`);
  openTemplateModal(t.id);
}

$('#btn-new-template').addEventListener('click', () => {
  const name = prompt('Template name?', 'New Template');
  if (!name) return;
  // Build a starter template with the standard 8-phase shape, zero loadings
  const starterPhaseIds = ['sales','pm','design','procure','fab','install','commiss','warranty'];
  const t = {
    id: uid('tpl'),
    name,
    description: '',
    phases: starterPhaseIds.map(pid => ({
      phaseId: pid,
      duration: 2,
      loading: buildLoad({})
    }))
  };
  state.templates.push(t);
  saveState();
  renderTemplates();
  openTemplateModal(t.id);
});

$('#btn-clone-template').addEventListener('click', () => {
  // Open clone modal
  const sel = $('#clone-source');
  sel.innerHTML = state.templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  $('#clone-name').value = '';
  $('#modal-clone').classList.add('open');
});
$('#modal-clone-close').addEventListener('click', () => $('#modal-clone').classList.remove('open'));
$('#modal-clone-cancel').addEventListener('click', () => $('#modal-clone').classList.remove('open'));
$('#modal-clone-do').addEventListener('click', () => {
  const name = $('#clone-name').value.trim();
  if (!name) { alert('Name required'); return; }
  const srcId = $('#clone-source').value;
  const src = getTemplate(srcId);
  const t = deepCopy(src);
  t.id = uid('tpl');
  t.name = name;
  state.templates.push(t);
  saveState();
  $('#modal-clone').classList.remove('open');
  renderTemplates();
  toast(`Template "${name}" created`);
});

let currentTplId = null;
function openTemplateModal(tplId) {
  currentTplId = tplId;
  const t = deepCopy(getTemplate(tplId));
  $('#modal-template-title').textContent = 'Edit Template: ' + t.name;
  const body = $('#modal-template-body');

  // Phase options for adding new phases
  const phaseOpts = state.phases.map(ph =>
    `<option value="${ph.id}">${escapeHtml(ph.name)}</option>`
  ).join('');

  let phasesHTML = '<table class="phase-table"><thead><tr>' +
    '<th style="width:30px">#</th>' +
    '<th>Phase</th>' +
    '<th style="width:90px">Duration (mo)</th>' +
    '<th>Role Loading</th>' +
    '<th style="width:80px"></th>' +
    '</tr></thead><tbody id="tpl-phases-body">';
  t.phases.forEach((ph, idx) => {
    phasesHTML += renderTemplatePhaseRow(t, ph, idx);
  });
  phasesHTML += '</tbody></table>';

  body.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Template Name</label><input type="text" id="tf-name" value="${escapeHtml(t.name)}"></div>
    </div>
    <div class="field"><label>Description</label><textarea id="tf-description" rows="2">${escapeHtml(t.description||'')}</textarea></div>

    <div class="section-label" style="margin-top:18px">Phases · Default Role Loading</div>
    ${phasesHTML}

    <div style="margin-top:14px;display:flex;gap:8px;align-items:center">
      <select id="tf-add-phase-id" style="width:auto;flex:0 0 auto;max-width:240px">${phaseOpts}</select>
      <input type="number" id="tf-add-phase-dur" min="1" value="2" placeholder="months" style="width:80px;flex:0 0 80px">
      <button class="btn ghost small" id="tf-add-phase">+ Add Phase</button>
    </div>
  `;

  $('#modal-template').classList.add('open');

  wireTemplateModal(t);

  $('#modal-template-save').onclick = () => {
    t.name = $('#tf-name').value;
    t.description = $('#tf-description').value;
    const idx = state.templates.findIndex(x => x.id === t.id);
    state.templates[idx] = t;
    saveState();
    closeTemplateModal();
    renderTemplates();
    toast('Template saved');
  };
}

function renderTemplatePhaseRow(t, ph, idx) {
  const phMeta = getPhase(ph.phaseId);
  return `
    <tr data-phase-idx="${idx}">
      <td class="mono">${idx+1}</td>
      <td class="phase-name">
        <span class="phase-color-dot" style="background:${phMeta?phMeta.color:'#999'}"></span>${escapeHtml(phMeta?phMeta.name:ph.phaseId)}
      </td>
      <td><input type="number" min="0" step="1" class="t-duration" value="${ph.duration}"></td>
      <td>
        <details>
          <summary>Edit loading (${countActiveRoles(ph.loading)} roles active)</summary>
          <div class="role-load-grid">
            <div class="head">Role</div>
            <div class="head">Peak %</div>
            <div class="head">Ramp Up (mo)</div>
            <div class="head">Ramp Down (mo)</div>
            ${state.roles.map(r => {
              const ld = ph.loading[r.id] || defaultLoading(0,0,0);
              return `
                <div>${escapeHtml(r.name)}</div>
                <div><input type="number" min="0" step="1" class="t-rl" data-role="${r.id}" data-field="peak" value="${ld.peak}"></div>
                <div><input type="number" min="0" step="1" class="t-rl" data-role="${r.id}" data-field="rampUp" value="${ld.rampUp}"></div>
                <div><input type="number" min="0" step="1" class="t-rl" data-role="${r.id}" data-field="rampDown" value="${ld.rampDown}"></div>
              `;
            }).join('')}
          </div>
        </details>
      </td>
      <td style="text-align:center;display:flex;gap:2px;justify-content:center;padding:4px">
        <button class="btn ghost small t-up" data-idx="${idx}" title="Move up">↑</button>
        <button class="btn ghost small t-down" data-idx="${idx}" title="Move down">↓</button>
        <button class="btn danger small t-del" data-idx="${idx}" title="Delete">×</button>
      </td>
    </tr>
  `;
}

function wireTemplateModal(t) {
  const body = $('#modal-template-body');

  body.querySelectorAll('.t-duration').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      t.phases[idx].duration = Math.max(0, parseInt(inp.value || '0', 10));
    });
  });
  body.querySelectorAll('.t-rl').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      const roleId = inp.dataset.role;
      const field = inp.dataset.field;
      const v = Math.max(0, parseFloat(inp.value || '0'));
      if (!t.phases[idx].loading[roleId]) t.phases[idx].loading[roleId] = defaultLoading(0,0,0);
      t.phases[idx].loading[roleId][field] = v;
    });
  });
  body.querySelectorAll('.t-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i > 0) {
        [t.phases[i-1], t.phases[i]] = [t.phases[i], t.phases[i-1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  body.querySelectorAll('.t-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i < t.phases.length - 1) {
        [t.phases[i+1], t.phases[i]] = [t.phases[i], t.phases[i+1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  body.querySelectorAll('.t-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (!confirm(`Remove phase ${i+1}?`)) return;
      t.phases.splice(i, 1);
      rebuildTemplatePhases(t);
    });
  });

  $('#tf-add-phase').addEventListener('click', () => {
    const phaseId = $('#tf-add-phase-id').value;
    const dur = Math.max(1, parseInt($('#tf-add-phase-dur').value || '1', 10));
    t.phases.push({ phaseId, duration: dur, loading: buildLoad({}) });
    rebuildTemplatePhases(t);
  });
}

function rebuildTemplatePhases(t) {
  const tbody = $('#tpl-phases-body');
  tbody.innerHTML = t.phases.map((ph, idx) => renderTemplatePhaseRow(t, ph, idx)).join('');
  // Rewire just the phase-related stuff (keep the add-phase form button wired - that one's outside)
  // Easier to re-call wireTemplateModal but it would double-wire the add button. Instead, re-wire only phase rows.
  $$('#tpl-phases-body .t-duration').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      t.phases[idx].duration = Math.max(0, parseInt(inp.value || '0', 10));
    });
  });
  $$('#tpl-phases-body .t-rl').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      const roleId = inp.dataset.role;
      const field = inp.dataset.field;
      const v = Math.max(0, parseFloat(inp.value || '0'));
      if (!t.phases[idx].loading[roleId]) t.phases[idx].loading[roleId] = defaultLoading(0,0,0);
      t.phases[idx].loading[roleId][field] = v;
    });
  });
  $$('#tpl-phases-body .t-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i > 0) {
        [t.phases[i-1], t.phases[i]] = [t.phases[i], t.phases[i-1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  $$('#tpl-phases-body .t-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i < t.phases.length - 1) {
        [t.phases[i+1], t.phases[i]] = [t.phases[i], t.phases[i+1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  $$('#tpl-phases-body .t-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (!confirm(`Remove phase ${i+1}?`)) return;
      t.phases.splice(i, 1);
      rebuildTemplatePhases(t);
    });
  });
}

function closeTemplateModal() {
  $('#modal-template').classList.remove('open');
  currentTplId = null;
}
$('#modal-template-close').addEventListener('click', closeTemplateModal);
$('#modal-template-cancel').addEventListener('click', closeTemplateModal);

/* ============================================================
   LOCATIONS VIEW
   ============================================================ */

function renderLocations() {
  const list = $('#location-list');
  list.innerHTML = `
    <table class="phase-table" style="width:100%">
      <thead><tr>
        <th style="width:240px">Location</th>
        <th style="width:120px">Multiplier</th>
        <th>Notes</th>
        <th style="width:80px"></th>
      </tr></thead>
      <tbody>
        ${state.locations.map(l => `
          <tr data-lid="${l.id}">
            <td><input type="text" data-lf="name" value="${escapeHtml(l.name)}"></td>
            <td>
              <input type="number" data-lf="multiplier" step="0.05" min="0.1" max="3.0" value="${l.multiplier}" class="mono" style="font-weight:600;color:var(--teal);text-align:center">
            </td>
            <td><input type="text" data-lf="notes" value="${escapeHtml(l.notes||'')}"></td>
            <td style="text-align:center"><button class="btn danger small" data-ldel="${l.id}">Del</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="margin-top:14px;padding:14px;background:var(--warm-white);border-left:3px solid var(--teal);border-radius:2px">
      <div class="eyebrow">How it works</div>
      <ul class="tsi-bullets" style="margin-top:6px">
        <li>Each phase duration in a project is multiplied by the location multiplier.</li>
        <li>A 10-month design phase × 0.7 (Vietnam) → 7-month effective duration.</li>
        <li>Ramp-up and ramp-down months scale proportionally.</li>
        <li>Role loadings (peak %) are unchanged — only the duration shifts.</li>
        <li>Minimum 1 month for any non-zero phase, regardless of multiplier.</li>
      </ul>
    </div>
  `;
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const tr = inp.closest('tr');
      const lid = tr.dataset.lid;
      const field = inp.dataset.lf;
      const loc = getLocation(lid);
      if (field === 'multiplier') {
        const v = Math.max(0.1, Math.min(3.0, parseFloat(inp.value || '1')));
        loc.multiplier = v;
        inp.value = v;
      } else {
        loc[field] = inp.value;
      }
      saveState();
    });
  });
  list.querySelectorAll('[data-ldel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const lid = btn.dataset.ldel;
      const loc = getLocation(lid);
      const usedBy = state.projects.filter(p => p.locationId === lid);
      if (usedBy.length > 0) {
        if (!confirm(`Delete location "${loc.name}"? ${usedBy.length} project(s) use it — they will be moved to USA (1.0×).`)) return;
        for (const p of usedBy) p.locationId = 'us';
      } else {
        if (!confirm(`Delete location "${loc.name}"?`)) return;
      }
      state.locations = state.locations.filter(x => x.id !== lid);
      saveState(); renderLocations(); renderAll();
    });
  });
}

$('#btn-new-location').addEventListener('click', () => {
  const name = prompt('Location name?', 'New Location');
  if (!name) return;
  const mult = parseFloat(prompt('Speed multiplier (1.0 = baseline; 0.7 = 30% faster; 1.2 = 20% slower)?', '1.0'));
  if (!mult || mult <= 0) return;
  state.locations.push({ id: uid('loc'), name, multiplier: mult, notes: '' });
  saveState(); renderLocations();
});

/* ============================================================
   ROLES VIEW
   ============================================================ */

function renderRoles() {
  const list = $('#role-list');
  list.innerHTML = `
    <table class="phase-table" style="width:100%">
      <thead><tr><th style="width:60px">Color</th><th>Name</th><th style="width:90px">Abbr</th><th style="width:140px">ID</th><th style="width:80px"></th></tr></thead>
      <tbody>
        ${state.roles.map((r, i) => `
          <tr data-rid="${r.id}">
            <td><input type="color" value="${r.color}" data-rf="color" style="padding:0;width:50px;height:28px;border:1px solid var(--rule);cursor:pointer"></td>
            <td><input type="text" value="${escapeHtml(r.name)}" data-rf="name"></td>
            <td><input type="text" value="${escapeHtml(r.abbr)}" data-rf="abbr"></td>
            <td><code style="font-size:11px;color:var(--ink-mute)">${r.id}</code></td>
            <td style="text-align:center"><button class="btn danger small" data-rdel="${r.id}">Del</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const tr = inp.closest('tr');
      const rid = tr.dataset.rid;
      const field = inp.dataset.rf;
      const role = getRole(rid);
      role[field] = inp.value;
      saveState();
      if (field === 'color') renderRoles();
    });
  });
  list.querySelectorAll('[data-rdel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.rdel;
      if (!confirm('Delete this role from all templates, projects, and capacity? This cannot be undone.')) return;
      state.roles = state.roles.filter(r => r.id !== rid);
      delete state.capacity[rid];
      for (const t of state.templates) for (const ph of t.phases) delete ph.loading[rid];
      for (const p of state.projects) for (const ph of p.phases) delete ph.loading[rid];
      saveState(); renderAll();
    });
  });
}

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

/* ============================================================
   HELPERS
   ============================================================ */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function renderAll() {
  renderProjects();
  // Also re-render whichever view is currently active (Gantt, Histogram, etc.)
  const activeTab = document.querySelector('.tab.active');
  if (!activeTab) return;
  const v = activeTab.dataset.view;
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

