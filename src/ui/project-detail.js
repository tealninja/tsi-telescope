/* ============================================================
   Project detail modal — two stacked charts (FTE + Cashflow)
   sharing an x-axis with horizontal zoom, plus milestone markers
   and a Fit-Project / Reset / range-slider control row.

   _detailProjectId is the project currently displayed; _detailZoom
   is the visible month-index range, so the zoom slider can redraw
   without rebuilding the modal shell.
   ============================================================ */

import { $, $$, hideTip } from '../util/dom.js';
import { escapeHtml, fmtMoney, winProbColor, niceCeil } from '../util/format.js';
import { monthKey, monthLabel, addMonths, monthsBetween, parseMonth } from '../util/dates.js';
import {
  state, getProject, getRole, getPhase, getTemplate, getLocation, horizonMonths
} from '../state.js';
import {
  computeAllDemand, effectivePhaseDurations, totalEffectiveDuration
} from '../compute/demand.js';
import { computeProjectCashflow, projectPhaseBoundaries } from '../compute/cashflow.js';

/* ---------- Project detail modal (role breakdown) ---------- */
/* ============================================================
   PROJECT DETAIL MODAL — two stacked charts (Resources + Cashflow)
   with shared x-axis and horizontal zoom.
   ============================================================ */

// Cached so the zoom slider doesn't re-build everything
let _detailProjectId = null;
let _detailZoom = { startIdx: 0, endIdx: 35 };  // inclusive month-idx range visible

export function openProjectDetailModal(projectId) {
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

$('#modal-project-detail-close').addEventListener('click', () => {
  $('#modal-project-detail').classList.remove('open');
});
