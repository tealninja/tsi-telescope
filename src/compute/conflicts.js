/* ============================================================
   Conflict / capacity-overflow diagnostics.

   computeProjectConflicts → boolean[36], which months have any
     role over capacity. Used by Gantt to draw coral conflict rings.

   computeTotalSeries → totals across all roles + per-project month
     series. Used by histogram / portfolio charts.

   computeBottleneckSeries → for each month, the worst per-role
     demand/capacity ratio and which role drove it. Used by the
     diagnostic bottleneck strip below the histogram.
   ============================================================ */

import { state } from '../state.js';
import { computeAllDemand } from './demand.js';

export function computeProjectConflicts() {
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

export function computeTotalSeries() {
  const { demand, projectDemand } = computeAllDemand();
  const totalDemand = new Array(36).fill(0);
  const totalCap = new Array(36).fill(0);
  for (let i = 0; i < 36; i++) {
    for (const r of state.roles) {
      totalDemand[i] += demand[r.id][i];
      totalCap[i] += (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
    }
  }
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

export function computeBottleneckSeries() {
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
