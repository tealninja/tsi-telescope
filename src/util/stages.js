/* ============================================================
   Lifecycle stages for projects.

   `stage` is the single source of truth — sales picks one in the
   Pipeline / Quick Add UI, planner picks one in the project editor.
   Win-probability auto-fills from the stage by default; the planner
   can override per-project for unusual cases.

   `complete` and `cancelled` are terminal states that DROP OUT of
   demand math (they no longer consume FTE).
   ============================================================ */

export const STAGES = [
  { id: 'lead',      label: 'Lead',      short: 'Lead',     winProb: 5,   color: '#C05234' },
  { id: 'qualified', label: 'Qualified', short: 'Qual',     winProb: 20,  color: '#C4A230' },
  { id: 'proposal',  label: 'Proposal',  short: 'Prop',     winProb: 40,  color: '#C4A230' },
  { id: 'loi',       label: 'LOI',       short: 'LOI',      winProb: 65,  color: '#00929F' },
  { id: 'awarded',   label: 'Awarded',   short: 'Awarded',  winProb: 85,  color: '#6E8C34' },
  { id: 'booked',    label: 'Booked',    short: 'Booked',   winProb: 100, color: '#19446C' },
  { id: 'complete',  label: 'Complete',  short: 'Done',     winProb: 0,   color: '#646464' },
  { id: 'cancelled', label: 'Cancelled', short: 'Cancel',   winProb: 0,   color: '#8B1A0A' }
];

const BY_ID = Object.fromEntries(STAGES.map(s => [s.id, s]));

export function stageInfo(id) {
  return BY_ID[id] || null;
}

export function stageColor(id) {
  return BY_ID[id] ? BY_ID[id].color : '#888';
}

export function stageLabel(id) {
  return BY_ID[id] ? BY_ID[id].label : id;
}

/* Default win-probability for a stage. The planner can override. */
export function winProbForStage(id) {
  return BY_ID[id] ? BY_ID[id].winProb : 100;
}

/* Reverse mapping — used when migrating projects that have winProbability
   but no stage yet (i.e. data that pre-dates the stage column). */
export function stageForWinProb(wp) {
  if (wp == null) return 'booked';
  if (wp >= 100) return 'booked';
  if (wp >= 85)  return 'awarded';
  if (wp >= 65)  return 'loi';
  if (wp >= 40)  return 'proposal';
  if (wp >= 20)  return 'qualified';
  return 'lead';
}

/* Terminal states drop out of the demand grid. */
export function stageCountsInLoad(id) {
  return id !== 'complete' && id !== 'cancelled';
}

/* Pre-sale stages (everything that isn't booked / complete / cancelled).
   Used for the dashboard split: booked = committed; pre-sale = upside. */
export function stageIsPreSale(id) {
  return id === 'lead' || id === 'qualified' || id === 'proposal' || id === 'loi' || id === 'awarded';
}
