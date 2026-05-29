/* ============================================================
   Resource demand computation.

   Given the portfolio in state, integrates ramp-up / peak /
   ramp-down loading curves per role per phase, scaled by each
   project's location multiplier, into FTE values per role per
   month across the 36-month rolling horizon.

   Midpoint convention on ramps: a 1-month ramp at 100% peak
   yields 50% of peak in that month.
   ============================================================ */

import { addMonths, monthsBetween } from '../util/dates.js';
import { state, getLocation } from '../state.js';
import { defaultLoading } from '../defaults.js';
import { stageCountsInLoad } from '../util/stages.js';

export function computeLoadCurve(N, peak, rampUp, rampDown) {
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

/* Effective per-phase durations after the location multiplier is applied.
   We round to nearest integer month, with a minimum of 1 month for any
   non-zero phase. */
export function effectivePhaseDurations(project) {
  const loc = getLocation(project.locationId);
  const mult = loc ? loc.multiplier : 1.0;
  return project.phases.map(ph => {
    if (ph.duration <= 0) return 0;
    const scaled = ph.duration * mult;
    return Math.max(1, Math.round(scaled));
  });
}

/* Nearest-neighbor resampler used when a detailed FTE array is held in
   BASE-month units but needs to be applied over EFFECTIVE-month units
   (location multiplier ≠ 1). Step values are preserved exactly rather
   than smoothed — user-entered per-month allocations are piecewise
   stepwise data, not a continuous signal. */
export function resampleArray(arr, newLen) {
  const N1 = arr.length;
  if (N1 === newLen) return arr.slice();
  if (newLen <= 0) return [];
  if (N1 === 0) return new Array(newLen).fill(0);
  const out = new Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = Math.min(N1 - 1, Math.floor(i * N1 / newLen));
    out[i] = arr[idx];
  }
  return out;
}

/* Total BASE-month duration (sum of phase.duration before location scaling).
   Used as the length of detailedLoading arrays. */
export function totalBaseDuration(target) {
  return target.phases.reduce((a, ph) => a + (ph.duration || 0), 0);
}

export function computeAllDemand() {
  const demand = {};
  for (const r of state.roles) demand[r.id] = new Array(36).fill(0);
  const projectDemand = {};

  for (const proj of state.projects) {
    projectDemand[proj.id] = {};
    for (const r of state.roles) projectDemand[proj.id][r.id] = new Array(36).fill(0);
    // Complete / cancelled projects keep their record but drop out of load.
    if (proj.stage && !stageCountsInLoad(proj.stage)) continue;

    const effDurs = effectivePhaseDurations(proj);
    const effTotal = effDurs.reduce((a,b) => a + b, 0);
    if (effTotal <= 0) continue;
    if (!proj.detailedLoading) continue;

    // Per-role: take the base-month array, resample (nearest-neighbor)
    // onto the effective duration, then write into the demand grid.
    const startIdx = monthsBetween(state.startMonth, proj.startMonth);
    for (const r of state.roles) {
      const baseArr = proj.detailedLoading[r.id];
      if (!Array.isArray(baseArr) || baseArr.length === 0) continue;
      const arr = resampleArray(baseArr, effTotal);
      for (let k = 0; k < arr.length; k++) {
        const mIdx = startIdx + k;
        if (mIdx >= 0 && mIdx < 36) {
          demand[r.id][mIdx] += arr[k];
          projectDemand[proj.id][r.id][mIdx] += arr[k];
        }
      }
    }
  }

  return { demand, projectDemand };
}

/* One-time migration: ensure every project and template has a
   detailedLoading array. For data that still carries legacy
   per-phase peak/rampUp/rampDown values, generate the array from
   those curves. Legacy values are left in place but unused. */
export function migrateAllToDetailed() {
  for (const t of (state.templates || [])) {
    if (!t.detailedLoading || Object.keys(t.detailedLoading).length === 0) {
      t.detailedLoading = detailedFromSimple(t);
    }
  }
  for (const p of (state.projects || [])) {
    if (!p.detailedLoading || Object.keys(p.detailedLoading).length === 0) {
      p.detailedLoading = detailedFromSimple(p);
    }
  }
}

/* Build a base-month FTE array per role from a target's phase-based
   simple curves. Used to seed the detailed-mode editor when the user
   first switches a project or template from simple to detailed. */
export function detailedFromSimple(target) {
  const out = {};
  for (const r of state.roles) {
    out[r.id] = [];
    for (const ph of target.phases) {
      const ld = ph.loading[r.id] || defaultLoading(0,0,0);
      const N = ph.duration || 0;
      const curve = computeLoadCurve(N, ld.peak, ld.rampUp, ld.rampDown);
      // curve is in percent of an FTE; the demand grid divides by 100.
      // For the editor (FTE units), pre-divide.
      for (const v of curve) out[r.id].push(v / 100);
    }
  }
  return out;
}

export function totalEffectiveDuration(p) {
  return effectivePhaseDurations(p).reduce((a,b)=>a+b,0);
}

/* Project sort order for stacked charts: longest projects at the bottom
   (largest area first) so shorter studies sit on top where they remain
   visible. Stable name tiebreak. */
export function projectStackOrder() {
  return [...state.projects].sort((a,b) => {
    const da = totalEffectiveDuration(a);
    const db = totalEffectiveDuration(b);
    if (da !== db) return db - da;
    return a.name.localeCompare(b.name);
  });
}
