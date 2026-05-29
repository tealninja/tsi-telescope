/* ============================================================
   Histogram view  ·  three modes (role bars / project bars /
   smoothed project areas using Catmull-Rom ribbons), capacity
   overlay, excess-burden shading, plus the per-role-driver
   bottleneck strip below.
   ============================================================ */

import { $, $$, hideTip } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { monthLabel, parseMonth } from '../util/dates.js';
import { state, getRole, horizonMonths } from '../state.js';
import { projectStackOrder } from '../compute/demand.js';
import { computeTotalSeries, computeBottleneckSeries } from '../compute/conflicts.js';
import { projectColor } from '../util/palette.js';
import { openProjectDetailModal } from './project-detail.js';

/* ============================================================
   HISTOGRAM VIEW  ·  multi-mode (role / project-bar / project-area)
   ============================================================ */

let histMode = 'role';   // 'role' | 'project-bar' | 'project-area'
let histShowCap = true;
let _histRange = { sIdx: 0, eIdx: 35 };

/* Compute a column width that makes the chart exactly fill its wrap
   element. We previously sized to a fixed 900px target, which caused
   horizontal overflow once the visible range covered all 36 months on
   anything but a wide desktop. Floor to integer pixels for crisp bars;
   tiny floor below 4 just to keep things visible on a phone. */
function fitColW(wrapEl, visN, labelW = 70, padRight = 24) {
  const ww = (wrapEl && wrapEl.clientWidth) || 800;
  const inner = Math.max(120, ww - labelW - padRight);
  return Math.max(4, Math.floor(inner / Math.max(1, visN)));
}


export function renderHistogram() {
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
  const colW = fitColW(wrap, visN);
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
  const colW = fitColW(wrap, visN);
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
  const colW = fitColW(wrap, visN);
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
  const colW = fitColW(wrap, visN);
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
