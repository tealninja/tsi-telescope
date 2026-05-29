/* ============================================================
   Dashboard view — portfolio-snapshot KPIs over the visible
   36-month horizon plus a "projects at risk" diagnostic list.

   Financial row:
     – Total Revenue     (sum of recognized revenue across the horizon)
     – Weighted Revenue  (× win-prob, the risk-adjusted forecast)
     – Total Cost        (sum of cost-line outflows)
     – Gross Margin %    (revenue − cost) ÷ revenue · color-graded

   Resourcing row:
     – Peak FTE          (highest single-month total across all roles)
     – Total Demand      (FTE-months consumed across the horizon)
     – Utilization %     (demand ÷ capacity)
     – Projects at Risk  (count active within 3mo of an over-cap month)

   Below the grid: a list of the at-risk projects with the role
   driving the conflict and the nearest over-cap month. Clicking
   a row opens the project's detail modal.
   ============================================================ */

import { $ } from '../util/dom.js';
import { escapeHtml, fmtMoney, winProbColor } from '../util/format.js';
import { monthLabel, addMonths, monthsBetween } from '../util/dates.js';
import { state, getRole, horizonMonths } from '../state.js';
import {
  computeAllDemand, totalEffectiveDuration
} from '../compute/demand.js';
import { computePortfolioCashflow } from '../compute/cashflow.js';
import { openProjectDetailModal } from './project-detail.js';
import { renderMap } from './map-view.js';

let _mapExpanded = false;
const MAP_LS_KEY = 'tsi_dash_map_expanded_v1';
try {
  const v = localStorage.getItem(MAP_LS_KEY);
  if (v === '1') _mapExpanded = true;
} catch (e) { /* ignore */ }

export function renderDashboard() {
  const horizon = horizonMonths();
  const { demand, projectDemand } = computeAllDemand();
  const cf = computePortfolioCashflow();

  $('#dash-asof').textContent =
    `${monthLabel(horizon[0], false)} → ${monthLabel(horizon[35], false)}`;

  // ---- Financial roll-ups across the visible horizon ----
  let totalRevenue = 0, totalCost = 0;
  for (let i = 0; i < 36; i++) {
    totalRevenue += cf.revenueRecognized[i];
    totalCost    += cf.costOut[i];
  }
  // Risk-weighted revenue: scale each project's recognized revenue by win-prob.
  let weightedRevenue = 0;
  for (const p of state.projects) {
    const pcf = cf.perProject[p.id];
    if (!pcf) continue;
    const wp = (p.winProbability != null ? p.winProbability : 100) / 100;
    for (let i = 0; i < 36; i++) weightedRevenue += pcf.revenueRecognized[i] * wp;
  }
  const grossMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
  const marginClass = grossMargin >= 20 ? 'ok' : grossMargin >= 10 ? 'warn' : 'bad';

  // ---- Resourcing roll-ups ----
  let totalFTEm = 0, totalCap = 0;
  const monthTotalDemand = new Array(36).fill(0);
  const monthTotalCap    = new Array(36).fill(0);
  for (let i = 0; i < 36; i++) {
    for (const r of state.roles) {
      monthTotalDemand[i] += demand[r.id][i];
      monthTotalCap[i]    += (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
      totalFTEm += demand[r.id][i];
      totalCap  += (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
    }
  }
  const peakFTE = Math.max(...monthTotalDemand);
  const peakIdx = monthTotalDemand.indexOf(peakFTE);
  const peakCapAtPeak = monthTotalCap[peakIdx];
  const peakOver = peakFTE > peakCapAtPeak;
  const peakClass = peakOver ? 'bad' : (peakFTE > peakCapAtPeak * 0.85 ? 'warn' : 'ok');
  const utilPct = totalCap > 0 ? (totalFTEm / totalCap) * 100 : 0;
  const utilClass = utilPct > 100 ? 'bad' : utilPct > 85 ? 'warn' : 'ok';

  // ---- Over-cap months (per-role) and the projects in their orbit ----
  const overCapMonths = [];
  const overCapDrivers = {};   // monthIdx -> [{ roleId, demand, cap }]
  for (let i = 0; i < 36; i++) {
    const drivers = [];
    for (const r of state.roles) {
      const d = demand[r.id][i];
      const c = (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
      if (d > c + 0.001) drivers.push({ roleId: r.id, demand: d, cap: c });
    }
    if (drivers.length) {
      overCapMonths.push(i);
      // Sort drivers by absolute shortfall, worst first
      drivers.sort((a,b) => (b.demand - b.cap) - (a.demand - a.cap));
      overCapDrivers[i] = drivers;
    }
  }
  const riskZone = new Set();
  for (const i of overCapMonths) {
    for (let k = i - 3; k <= i + 3; k++) {
      if (k >= 0 && k < 36) riskZone.add(k);
    }
  }
  const atRiskProjects = [];
  for (const p of state.projects) {
    const startIdx = monthsBetween(state.startMonth, p.startMonth);
    const endIdx   = startIdx + totalEffectiveDuration(p);
    let touched = null;
    for (let i = Math.max(0, startIdx); i < Math.min(36, endIdx); i++) {
      if (riskZone.has(i)) {
        // Find nearest over-cap month to this project
        let best = null, bestDist = Infinity;
        for (const oc of overCapMonths) {
          const dist = Math.abs(oc - i);
          if (dist < bestDist) { bestDist = dist; best = oc; }
        }
        if (best != null) { touched = best; break; }
      }
    }
    if (touched != null) {
      atRiskProjects.push({
        project: p,
        startIdx,
        endIdx,
        overCapMonth: touched,
        topDriver: (overCapDrivers[touched] && overCapDrivers[touched][0]) || null
      });
    }
  }
  atRiskProjects.sort((a,b) => a.overCapMonth - b.overCapMonth);

  // ---- Render cards ----
  $('#dash-financial').innerHTML = [
    card('Total Revenue', fmtMoney(totalRevenue, {compact:true}),
         'recognized · ' + state.projects.length + ' projects'),
    card('Risk-Weighted Revenue', fmtMoney(weightedRevenue, {compact:true}),
         '× win probability · expected value', 'teal'),
    card('Total Cost', fmtMoney(totalCost, {compact:true}),
         'cost-line outflows'),
    card('Gross Margin', grossMargin.toFixed(1) + '%',
         'revenue − cost ÷ revenue', marginClass)
  ].join('');

  $('#dash-resourcing').innerHTML = [
    card('Peak FTE', peakFTE.toFixed(1),
         (peakIdx >= 0 ? `<strong>${monthLabel(horizon[peakIdx])}</strong> · cap ${peakCapAtPeak.toFixed(1)}` : '—'),
         peakClass),
    card('Total Demand', totalFTEm.toFixed(0),
         'FTE-months across 36mo'),
    card('Utilization', utilPct.toFixed(0) + '%',
         'demand ÷ capacity', utilClass),
    card('Projects at Risk', atRiskProjects.length,
         atRiskProjects.length === 0 ? 'all within capacity' :
         `${overCapMonths.length} month${overCapMonths.length===1?'':'s'} over cap`,
         atRiskProjects.length > 0 ? 'bad' : 'ok')
  ].join('');

  // ---- Risk list ----
  const body = $('#dash-risk-body');
  if (atRiskProjects.length === 0) {
    body.innerHTML = `<div class="dash-risk-empty">– No projects within 3 months of an over-capacity period.</div>`;
  } else {
    const header = `
      <div class="dash-risk-row" style="border-bottom:2px solid var(--rule);font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:0.08em;font-size:10px">
        <div>Project</div>
        <div>Active Window</div>
        <div>Top Bottleneck</div>
        <div style="text-align:right">Over-Cap Month</div>
      </div>`;
    const rows = atRiskProjects.map(r => {
      const p = r.project;
      const wp = p.winProbability != null ? p.winProbability : 100;
      const wpColor = winProbColor(wp);
      const startKey = addMonths(state.startMonth, Math.max(0, r.startIdx));
      const endKey   = addMonths(state.startMonth, Math.min(35, r.endIdx - 1));
      const driver = r.topDriver ? getRole(r.topDriver.roleId) : null;
      const driverTxt = driver
        ? `${escapeHtml(driver.abbr)} · ${r.topDriver.demand.toFixed(1)}/${r.topDriver.cap.toFixed(1)}`
        : '—';
      const ocKey = addMonths(state.startMonth, r.overCapMonth);
      return `
        <div class="dash-risk-row">
          <div class="dash-risk-name" data-proj="${p.id}">
            ${escapeHtml(p.name)}
            <span style="margin-left:8px;font-size:10px;color:${wpColor};font-weight:700">${wp}%</span>
          </div>
          <div class="dash-risk-window">${monthLabel(startKey)} → ${monthLabel(endKey)}</div>
          <div class="dash-risk-driver">${driverTxt}</div>
          <div class="dash-risk-month">${monthLabel(ocKey)}</div>
        </div>`;
    }).join('');
    body.innerHTML = header + rows;
    body.querySelectorAll('.dash-risk-name').forEach(el => {
      el.addEventListener('click', () => openProjectDetailModal(el.dataset.proj));
    });
  }

  renderMapPanel();
}

function renderMapPanel() {
  const header = $('#dash-map-header');
  const caret  = $('#dash-map-caret');
  const ctrls  = $('#dash-map-controls');
  const body   = $('#dash-map-body');
  const wrap   = $('#dash-map-wrap');
  if (!header || !body || !wrap) return;

  const apply = () => {
    if (_mapExpanded) {
      body.style.display = 'block';
      ctrls.style.display = 'flex';
      caret.textContent = '▾';
      // Defer to next frame so the wrap has its layout dimensions before draw.
      requestAnimationFrame(() => renderMap(wrap));
    } else {
      body.style.display = 'none';
      ctrls.style.display = 'none';
      caret.textContent = '▸';
    }
  };

  if (!header._wired) {
    header._wired = true;
    header.addEventListener('click', (e) => {
      // Ignore clicks on the controls themselves so toggles don't collapse the panel.
      if (e.target.closest('#dash-map-controls')) return;
      _mapExpanded = !_mapExpanded;
      try { localStorage.setItem(MAP_LS_KEY, _mapExpanded ? '1' : '0'); } catch (_) {}
      apply();
    });
  }
  apply();
}

// cls applies to both the top-border accent and the value color, except
// 'teal' which is value-only (kept for the risk-weighted revenue card —
// a teal top-border would conflict with the default teal accent).
function card(label, value, sub, cls) {
  const borderCls = (cls && cls !== 'teal') ? ` ${cls}` : '';
  const valueCls  = cls ? ` ${cls}` : '';
  return `
    <div class="dash-card${borderCls}">
      <div class="dash-label">${escapeHtml(label)}</div>
      <div class="dash-value${valueCls}">${value}</div>
      <div class="dash-sub">${sub}</div>
    </div>`;
}
