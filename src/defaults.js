/* ============================================================
   TSI default data: roles, phases, locations, milestone/cost
   schedules, and project templates. Pure data + the small
   helpers used to construct them.
   ============================================================ */

import { deepCopyMilestones } from './util/clone.js';

export const DEFAULT_ROLES = [
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

export const DEFAULT_PHASES = [
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

export const DEFAULT_LOCATIONS = [
  { id: 'us',     name: 'USA / North America', multiplier: 1.00, lat:  39.83, lng:  -98.58, notes: 'Baseline. Standard procurement lead times, OSHA compliance, in-house QA travel.' },
  { id: 'vn_sea', name: 'Vietnam / SE Asia',   multiplier: 0.70, lat:  16.05, lng:  108.20, notes: 'Faster execution. Lower-cost local fab, parallel labor, shorter customs clearance. Use Austwood/local partners.' },
  { id: 'eu',     name: 'Europe (EU)',         multiplier: 1.10, lat:  51.16, lng:   10.45, notes: 'CE marking, machinery directive overhead, ATEX where applicable. Engineering similar to US, regulatory adds ~10%.' },
  { id: 'uk',     name: 'United Kingdom',      multiplier: 1.20, lat:  54.00, lng:   -2.00, notes: 'Slower procurement post-Brexit, UKCA compliance. Engineering similar to US.' },
  { id: 'br_sa',  name: 'Brazil / South America', multiplier: 1.15, lat: -10.00, lng: -55.00, notes: 'INMETRO certification, longer customs, currency hedging in commercial phase.' }
];

export function defaultLoading(peak, rampUp, rampDown) {
  return { peak: peak||0, rampUp: rampUp||0, rampDown: rampDown||0 };
}

export function buildLoad(roleLoads) {
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
export const DEFAULT_MILESTONE_SCHED = [
  { name: 'Kickoff',              anchor: 'start',   offsetMonths: 0, percent: 10 },
  { name: 'Design Complete',      anchor: 'design',  offsetMonths: 0, percent: 30 },
  { name: 'Fabrication Complete', anchor: 'fab',     offsetMonths: 0, percent: 30 },
  { name: 'Installation Complete',anchor: 'install', offsetMonths: 0, percent: 20 },
  { name: 'PAC (Final Acceptance)',anchor: 'commiss',offsetMonths: 0, percent: 10 }
];

// FEED-style schedule: 25/50/25 over phases
export const FEED_MILESTONE_SCHED = [
  { name: 'Kickoff',              anchor: 'start',       offsetMonths: 0, percent: 25 },
  { name: 'FEED Complete',        anchor: 'feed',        offsetMonths: 0, percent: 50 },
  { name: 'Deliverable Accepted', anchor: 'deliverable', offsetMonths: 0, percent: 25 }
];

// Retrofit: 30/50/20
export const RETROFIT_MILESTONE_SCHED = [
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
export const DEFAULT_COST_SCHED = [
  { name: 'Design subcontract / consultants', anchor: 'design',  offsetMonths: 0, amount: 0 },
  { name: 'Equipment / vendor payments',       anchor: 'fab',     offsetMonths: 0, amount: 0 },
  { name: 'Installation labor & travel',       anchor: 'install', offsetMonths: 0, amount: 0 },
  { name: 'Commissioning travel / spares',     anchor: 'commiss', offsetMonths: 0, amount: 0 }
];

// FEED: lean cost structure — mostly direct labor (not separately captured) + minimal subcontractor
export const FEED_COST_SCHED = [
  { name: 'Subcontractor / 3rd-party studies', anchor: 'feed', offsetMonths: 0, amount: 0 }
];

// Retrofit: equipment + installation
export const RETROFIT_COST_SCHED = [
  { name: 'Equipment / vendor payments', anchor: 'fab',     offsetMonths: 0, amount: 0 },
  { name: 'Installation labor & travel', anchor: 'commiss', offsetMonths: 0, amount: 0 }
];

export const DEFAULT_TEMPLATES = [
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
