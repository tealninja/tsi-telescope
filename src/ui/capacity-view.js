/* ============================================================
   Capacity view — monthly headcount per role per month over
   the rolling 36-month horizon. Year-spanning header row +
   single integer input per cell. No conflict math here; this
   feeds the cap-vs-dem view.
   ============================================================ */

import { $ } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { parseMonth } from '../util/dates.js';
import { state, horizonMonths, saveState } from '../state.js';

const FIT_KEY = 'tsi_cap_fit_width_v1';

function capFitWidthDefault() {
  // Default: ON for narrow viewports, OFF on desktop.
  if (typeof window !== 'undefined' && window.innerWidth && window.innerWidth <= 800) return true;
  return false;
}

export function capFitWidth() {
  try {
    const v = localStorage.getItem(FIT_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (_) {}
  return capFitWidthDefault();
}

export function setCapFitWidth(on) {
  try { localStorage.setItem(FIT_KEY, on ? '1' : '0'); } catch (_) {}
  applyCapFitWidthClass();
}

function applyCapFitWidthClass() {
  const wrap = $('.capacity-table-wrap');
  if (wrap) wrap.classList.toggle('fit-width', capFitWidth());
}

export function renderCapacity() {
  const table = $('#capacity-table');
  const horizon = horizonMonths();

  for (const r of state.roles) {
    if (!state.capacity[r.id]) state.capacity[r.id] = new Array(36).fill(0);
    while (state.capacity[r.id].length < 36) state.capacity[r.id].push(0);
  }

  let yearRow = '<tr><th class="role-head" rowspan="2">Role</th>';
  let monthRow = '<tr>';
  let currentYear = null;
  let yrSpan = 0;
  const yrSpans = [];
  for (let i = 0; i < 36; i++) {
    const d = parseMonth(horizon[i]);
    const y = d.getFullYear();
    if (y !== currentYear) {
      if (currentYear !== null) yrSpans.push({y: currentYear, span: yrSpan});
      currentYear = y;
      yrSpan = 1;
    } else { yrSpan++; }
  }
  yrSpans.push({y: currentYear, span: yrSpan});
  for (const ys of yrSpans) {
    yearRow += `<th colspan="${ys.span}" class="yr-divider">${ys.y}</th>`;
  }
  yearRow += '</tr>';

  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 0; i < 36; i++) {
    const d = parseMonth(horizon[i]);
    const isYrStart = d.getMonth() === 0;
    monthRow += `<th ${isYrStart && i>0 ? 'class="yr-divider"':''}>${mNames[d.getMonth()]}</th>`;
  }
  monthRow += '</tr>';

  let body = '';
  for (const r of state.roles) {
    body += `<tr><td class="role-name" style="border-left:3px solid ${r.color}">${escapeHtml(r.name)}</td>`;
    for (let i = 0; i < 36; i++) {
      const d = parseMonth(horizon[i]);
      const isYrStart = d.getMonth() === 0;
      const v = state.capacity[r.id][i];
      body += `<td ${isYrStart && i>0 ? 'class="yr-divider"':''}><input type="number" min="0" step="1" data-role="${r.id}" data-midx="${i}" value="${v}"></td>`;
    }
    body += '</tr>';
  }

  table.innerHTML = '<thead>' + yearRow + monthRow + '</thead><tbody>' + body + '</tbody>';

  table.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const r = inp.dataset.role;
      const i = parseInt(inp.dataset.midx, 10);
      state.capacity[r][i] = Math.max(0, parseFloat(inp.value || '0'));
      saveState();
    });
  });

  applyCapFitWidthClass();
}
