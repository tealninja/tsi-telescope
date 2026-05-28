/* ============================================================
   Project + portfolio cashflow computation.

   billingMode:
     'milestone'  — cash hits in the month each milestone resolves; revenue = cash
     'monthly'    — total contract value spread evenly across effective duration; cash = revenue
     'accrual_poc'— revenue smooth as % of FTE-months consumed × contract value;
                    cash from milestones if defined, otherwise mirrors revenue

   Anchor resolution (milestones + cost lines):
     'start'  -> project start month
     '_end' / 'end' -> month immediately after final phase
     phaseId  -> month at which that phase completes (startKey + duration)
   offsetMonths is added to the resolved anchor month.

   projectPhaseBoundaries returns map: phaseId -> { startIdx, endIdx,
   startKey, endKey }. If multiple phases share an id, the first wins
   (templates don't repeat phases). Also includes synthetic '_start'
   and '_end' entries for the project envelope.
   ============================================================ */

import { addMonths, monthsBetween } from '../util/dates.js';
import { state } from '../state.js';
import { effectivePhaseDurations, totalEffectiveDuration, computeAllDemand } from './demand.js';

export function projectPhaseBoundaries(proj) {
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
  out['_start'] = { startIdx: monthsBetween(state.startMonth, proj.startMonth), endIdx: monthsBetween(state.startMonth, proj.startMonth) };
  out['_end']   = { startIdx: monthsBetween(state.startMonth, cursor), endIdx: monthsBetween(state.startMonth, cursor) };
  return out;
}

export function computeProjectCashflow(proj) {
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

export function computePortfolioCashflow() {
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
