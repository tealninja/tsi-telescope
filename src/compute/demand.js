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

export function computeAllDemand() {
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
        // Ramp months also scale with location: scaled durations need scaled ramps proportionally.
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
