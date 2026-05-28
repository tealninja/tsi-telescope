/* ============================================================
   Small general-purpose helpers: deep clone, milestone clone,
   and unique-id generator.
   ============================================================ */

export function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

// Milestones/cost lines are flat objects — Object.assign is cheaper than JSON round-trip.
export function deepCopyMilestones(arr) { return arr.map(m => Object.assign({}, m)); }

export function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2,9); }
