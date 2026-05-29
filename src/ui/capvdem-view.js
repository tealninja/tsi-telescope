/* ============================================================
   Capacity vs Demand view — per-role line chart of demand against
   the capacity ceiling, with over-allocation shading and a summary
   table of months that exceed capacity.
   ============================================================ */

import { $, hideTip } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { monthLabel, parseMonth } from '../util/dates.js';
import { state, getRole, horizonMonths } from '../state.js';
import { computeAllDemand } from '../compute/demand.js';

/* ============================================================
   CAP VS DEM VIEW
   ============================================================ */

export function renderCapVDem() {
  const sel = $('#cvd-role-select');
  if (sel.options.length !== state.roles.length) {
    sel.innerHTML = state.roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    sel.onchange = drawCVD;
  }
  drawCVD();
  renderOverTable();
}

function drawCVD() {
  const roleId = $('#cvd-role-select').value || state.roles[0].id;
  const role = getRole(roleId);
  const { demand } = computeAllDemand();
  const horizon = horizonMonths();
  const dem = demand[roleId];
  const cap = state.capacity[roleId] || new Array(36).fill(0);

  const wrap = $('#cvd-wrap');
  const N = 36;
  const labelW = 70;
  const padRight = 24;
  const ww = (wrap && wrap.clientWidth) || 800;
  const colW = Math.max(4, Math.floor(Math.max(120, ww - labelW - padRight) / N));
  const padTop = 64;
  const chartH = 280;
  const padBottom = 50;
  const width = labelW + N * colW + 24;
  const height = padTop + chartH + padBottom;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234';

  const maxDem = Math.max(...dem, 0);
  const maxCap = Math.max(...cap, 0);
  const yMax = Math.ceil(Math.max(maxDem, maxCap) * 1.15) || 1;

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  const yTicks = 5;
  for (let t = 0; t <= yTicks; t++) {
    const v = yMax * t / yTicks;
    const y = padTop + chartH - (v / yMax) * chartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 10}" y="${y+4}" text-anchor="end" font-size="11" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 10}" y="${padTop - 14}" text-anchor="end" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">FTE / HC</text>`;
  svg += `<text x="${labelW + 8}" y="${padTop - 30}" font-size="16" font-family="DM Serif Display" font-weight="400" fill="${DEEP_BLUE}">${escapeHtml(role.name)}</text>`;

  // Over-allocation shaded regions
  for (let i = 0; i < N; i++) {
    if (dem[i] > cap[i]) {
      const x = labelW + i * colW;
      const yCap = padTop + chartH - (cap[i] / yMax) * chartH;
      const yDem = padTop + chartH - (dem[i] / yMax) * chartH;
      svg += `<rect x="${x+3}" y="${yDem}" width="${colW-6}" height="${yCap - yDem}" fill="${CORAL}" fill-opacity="0.22"/>`;
    }
  }

  // Demand bars
  for (let i = 0; i < N; i++) {
    const v = dem[i];
    const segH = (v / yMax) * chartH;
    if (segH > 0.5) {
      const x = labelW + i*colW + 5;
      const y = padTop + chartH - segH;
      svg += `<rect class="cvd-bar" data-midx="${i}" data-d="${v.toFixed(2)}" data-c="${cap[i].toFixed(1)}" x="${x}" y="${y}" width="${colW - 10}" height="${segH}" fill="${DEEP_BLUE}" stroke="#fff" stroke-width="0.5" rx="1"/>`;
    }
  }

  // Capacity step line
  let pathD = '';
  for (let i = 0; i < N; i++) {
    const x1 = labelW + i * colW;
    const x2 = labelW + (i+1) * colW;
    const y = padTop + chartH - (cap[i] / yMax) * chartH;
    if (i === 0) pathD += `M ${x1} ${y}`;
    else pathD += ` L ${x1} ${y}`;
    pathD += ` L ${x2} ${y}`;
  }
  svg += `<path d="${pathD}" fill="none" stroke="${CORAL}" stroke-width="2.5" stroke-dasharray="6 3"/>`;

  // Year markers
  for (let i = 0; i < N; i++) {
    const d = parseMonth(horizon[i]);
    const x = labelW + i * colW;
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
      svg += `<text x="${x+5}" y="${padTop - 6}" font-size="11" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if (i % 3 === 0) {
      const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 18}" text-anchor="middle" font-size="10" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  wrap.querySelectorAll('.cvd-bar').forEach(bar => {
    bar.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(bar.dataset.midx, 10);
      const d = parseFloat(bar.dataset.d), c = parseFloat(bar.dataset.c);
      const over = d - c;
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong></div>
        <div class="tooltip-row"><span>Demand</span><span>${d.toFixed(2)} FTE</span></div>
        <div class="tooltip-row"><span>Capacity</span><span>${c.toFixed(1)} HC</span></div>
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px;color:${over>0?'#FFB29A':'#A8D9A8'}">
          <span><strong>${over > 0 ? 'Over' : 'Under'}</strong></span>
          <span><strong>${Math.abs(over).toFixed(2)}</strong></span>
        </div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    bar.addEventListener('mouseleave', hideTip);
  });
}

function renderOverTable() {
  const { demand } = computeAllDemand();
  const horizon = horizonMonths();
  const rows = [];
  for (const r of state.roles) {
    let overMonths = 0, peakOver = 0, peakMonth = '';
    for (let i = 0; i < 36; i++) {
      const c = (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
      const d = demand[r.id][i];
      if (d > c) {
        overMonths++;
        const o = d - c;
        if (o > peakOver) { peakOver = o; peakMonth = horizon[i]; }
      }
    }
    rows.push({ role: r, overMonths, peakOver, peakMonth });
  }
  const table = `
    <table class="phase-table" style="width:100%">
      <thead><tr>
        <th>Role</th><th>Over-Alloc Months</th><th>Peak Over (FTE)</th><th>Peak Month</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            <td><span class="phase-color-dot" style="background:${row.role.color}"></span>${escapeHtml(row.role.name)}</td>
            <td style="text-align:center" class="mono">${row.overMonths}</td>
            <td style="text-align:center" class="mono">${row.peakOver.toFixed(2)}</td>
            <td style="text-align:center" class="mono">${row.peakMonth ? monthLabel(row.peakMonth) : '—'}</td>
            <td style="text-align:center;color:${row.overMonths === 0 ? 'var(--succ-green)' : row.overMonths > 6 ? 'var(--coral)' : 'var(--amber)'};font-weight:700">
              ${row.overMonths === 0 ? 'OK' : row.overMonths > 6 ? 'CRITICAL' : 'WATCH'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  $('#over-table').innerHTML = table;
}
