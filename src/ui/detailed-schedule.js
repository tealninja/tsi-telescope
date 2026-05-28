/* ============================================================
   Detailed monthly schedule editor — shared between the project
   and template editors.

   Renders a role × base-month grid (capacity-builder style). Each
   cell is an FTE value (decimal, e.g. 0.5 = half a person, 1.0 =
   one full FTE for that month). Phase column blocks are colored
   by phase, with month-number headers and a phase-name strip.

   `target` is either a project or a template (deep-copied working
   copy held by the modal). It must have:
     – phases:        [{ phaseId, duration, loading }]
     – loadingMode:   'simple' | 'detailed'
     – detailedLoading: { roleId: number[] }  (length = sum of durations)

   The caller wires up a mode toggle and is responsible for calling
   buildDetailedScheduleSection() + wireDetailedSchedule() on render
   and for resizing detailedLoading arrays when phase durations
   change (helper resizeDetailedToPhases() handles that).
   ============================================================ */

import { escapeHtml } from '../util/format.js';
import { state, getPhase } from '../state.js';
import {
  totalBaseDuration, detailedFromSimple, resampleArray
} from '../compute/demand.js';

/* HTML for the detailed grid. The caller pastes this into the modal.
   Empty/zero cells stay blank so users can see at a glance where the
   allocation actually is. */
export function buildDetailedScheduleSection(target, prefix) {
  const totalM = totalBaseDuration(target);
  ensureDetailedLoading(target);

  let phaseHeader = '';
  let monthHeader = '';
  let cursor = 0;
  for (const ph of target.phases) {
    const phMeta = getPhase(ph.phaseId);
    const color = phMeta ? phMeta.color : '#888';
    const name  = phMeta ? phMeta.name  : ph.phaseId;
    const dur = ph.duration || 0;
    if (dur <= 0) continue;
    phaseHeader += `<th colspan="${dur}" class="ds-phase-head" style="background:${color}">${escapeHtml(name)} · ${dur}mo</th>`;
    for (let k = 0; k < dur; k++) {
      monthHeader += `<th class="ds-month-head${k === 0 && cursor > 0 ? ' ds-phase-divider' : ''}">${cursor + k + 1}</th>`;
    }
    cursor += dur;
  }

  let bodyHTML = '';
  for (const r of state.roles) {
    const arr = target.detailedLoading[r.id] || new Array(totalM).fill(0);
    let cells = '';
    let col = 0;
    for (const ph of target.phases) {
      const dur = ph.duration || 0;
      const phMeta = getPhase(ph.phaseId);
      const bg = phMeta ? phMeta.color + '14' : '#88888814';  // 8% alpha as hex pair
      for (let k = 0; k < dur; k++) {
        const v = arr[col] != null ? arr[col] : 0;
        const isDivider = k === 0 && col > 0;
        const showVal = v !== 0 ? formatCell(v) : '';
        cells += `<td class="ds-cell${isDivider ? ' ds-phase-divider' : ''}" style="background:${bg}"><input type="number" min="0" step="0.1" class="ds-input" data-role="${r.id}" data-col="${col}" value="${showVal}" inputmode="decimal" placeholder=""></td>`;
        col++;
      }
    }
    // Row-total cell (sum of FTE-months for this role across the project)
    const total = arr.reduce((a,b)=>a + (Number(b)||0), 0);
    bodyHTML += `
      <tr>
        <td class="ds-role-name" style="border-left:3px solid ${r.color}">${escapeHtml(r.name)}</td>
        ${cells}
        <td class="ds-row-total mono">${total.toFixed(1)}</td>
      </tr>`;
  }

  // Column totals (per-month FTE across all roles)
  let totalsRow = '<tr><td class="ds-role-name" style="color:var(--gray);text-transform:uppercase;letter-spacing:0.08em;font-size:10px;font-weight:700">Per-Month Total</td>';
  for (let col = 0; col < totalM; col++) {
    let sum = 0;
    for (const r of state.roles) {
      const a = target.detailedLoading[r.id];
      if (a && a[col] != null) sum += Number(a[col]) || 0;
    }
    totalsRow += `<td class="ds-col-total mono" data-col="${col}">${sum !== 0 ? sum.toFixed(1) : ''}</td>`;
  }
  const grandTotal = state.roles.reduce((s, r) => {
    const a = target.detailedLoading[r.id] || [];
    return s + a.reduce((aa, v) => aa + (Number(v) || 0), 0);
  }, 0);
  totalsRow += `<td class="ds-row-total mono" style="background:var(--warm-white)">${grandTotal.toFixed(1)}</td></tr>`;

  return `
    <div class="ds-wrap">
      <div class="ds-toolbar">
        <div class="eyebrow" style="margin:0">Detailed Monthly Allocation · FTE per Role per Base Month</div>
        <div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--gray)">
          <button class="btn ghost small" id="${prefix}-ds-regen">Regenerate from Simple Curves</button>
          <button class="btn ghost small" id="${prefix}-ds-clear">Clear All</button>
          <span>tab/arrow to move · empty = 0</span>
        </div>
      </div>
      <div class="ds-table-wrap">
        <table class="ds-table">
          <thead>
            <tr><th class="ds-role-head" rowspan="2">Role</th>${phaseHeader}<th class="ds-row-total-head" rowspan="2">FTE-mo</th></tr>
            <tr>${monthHeader}</tr>
          </thead>
          <tbody>
            ${bodyHTML}
            ${totalsRow}
          </tbody>
        </table>
      </div>
      <div class="helper" style="margin-top:8px">
        Decimal FTE per month. 0.5 = half a person. Location speed multipliers resample this curve onto the effective duration at compute time, so values stay anchored to base months.
      </div>
    </div>`;
}

export function wireDetailedSchedule(target, prefix, onChange) {
  const wrap = document.querySelector('.ds-wrap');
  if (!wrap) return;

  ensureDetailedLoading(target);

  wrap.querySelectorAll('.ds-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const r = inp.dataset.role;
      const col = parseInt(inp.dataset.col, 10);
      const raw = inp.value.trim();
      const v = raw === '' ? 0 : Math.max(0, parseFloat(raw) || 0);
      if (!target.detailedLoading[r]) target.detailedLoading[r] = new Array(totalBaseDuration(target)).fill(0);
      target.detailedLoading[r][col] = v;
      refreshTotals(target, wrap);
      if (onChange) onChange();
    });
    inp.addEventListener('keydown', (e) => {
      // Arrow keys move focus between cells (like a spreadsheet).
      const key = e.key;
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)) return;
      e.preventDefault();
      const r = inp.dataset.role;
      const col = parseInt(inp.dataset.col, 10);
      const roleIdx = state.roles.findIndex(x => x.id === r);
      const totalM = totalBaseDuration(target);
      let nr = roleIdx, nc = col;
      if (key === 'ArrowUp') nr = Math.max(0, nr - 1);
      if (key === 'ArrowDown') nr = Math.min(state.roles.length - 1, nr + 1);
      if (key === 'ArrowLeft') nc = Math.max(0, nc - 1);
      if (key === 'ArrowRight') nc = Math.min(totalM - 1, nc + 1);
      const next = wrap.querySelector(`.ds-input[data-role="${state.roles[nr].id}"][data-col="${nc}"]`);
      if (next) { next.focus(); next.select(); }
    });
  });

  const regen = document.getElementById(`${prefix}-ds-regen`);
  if (regen) regen.addEventListener('click', () => {
    if (!confirm('Regenerate detailed allocation from the simple per-phase curves? Any manual edits in detailed mode will be overwritten.')) return;
    target.detailedLoading = detailedFromSimple(target);
    if (onChange) onChange();
  });
  const clear = document.getElementById(`${prefix}-ds-clear`);
  if (clear) clear.addEventListener('click', () => {
    if (!confirm('Clear every cell to zero?')) return;
    target.detailedLoading = {};
    ensureDetailedLoading(target);
    if (onChange) onChange();
  });
}

/* When phase durations change while in detailed mode, resize each role's
   array to match the new total. The caller decides whether to call this
   directly or to first ask the user. Strategy: per-phase block resize via
   nearest-neighbor resampling. Preserves the SHAPE of each phase's curve. */
export function resizeDetailedToPhases(target, oldPhaseDurs) {
  if (!target.detailedLoading) return;
  const newDurs = target.phases.map(p => p.duration || 0);
  const oldTotal = oldPhaseDurs.reduce((a,b)=>a+b, 0);
  const newTotal = newDurs.reduce((a,b)=>a+b, 0);
  if (oldTotal === newTotal) return;  // no resize needed at the total level

  for (const r of state.roles) {
    const oldArr = target.detailedLoading[r.id] || new Array(oldTotal).fill(0);
    const newArr = [];
    // Walk the OLD array per-phase and resample each block to the new
    // block size. Assumes phases haven't been reordered (just resized).
    let oldCursor = 0;
    for (let i = 0; i < newDurs.length; i++) {
      const oldDur = oldPhaseDurs[i] || 0;
      const newDur = newDurs[i] || 0;
      const block = oldArr.slice(oldCursor, oldCursor + oldDur);
      const resized = resampleArray(block, newDur);
      for (const v of resized) newArr.push(v);
      oldCursor += oldDur;
    }
    target.detailedLoading[r.id] = newArr;
  }
}

function ensureDetailedLoading(target) {
  if (!target.detailedLoading) target.detailedLoading = {};
  const N = totalBaseDuration(target);
  for (const r of state.roles) {
    const a = target.detailedLoading[r.id];
    if (!Array.isArray(a)) {
      target.detailedLoading[r.id] = new Array(N).fill(0);
    } else if (a.length !== N) {
      // Trim or pad to match phase totals; preserves leading values.
      if (a.length > N) target.detailedLoading[r.id] = a.slice(0, N);
      else target.detailedLoading[r.id] = a.concat(new Array(N - a.length).fill(0));
    }
  }
}

function refreshTotals(target, wrap) {
  const totalM = totalBaseDuration(target);
  // Per-row totals
  wrap.querySelectorAll('tr').forEach(tr => {
    const roleCell = tr.querySelector('.ds-role-name');
    if (!roleCell) return;
    const total = tr.querySelector('.ds-row-total');
    if (!total) return;
    let sum = 0;
    tr.querySelectorAll('.ds-input').forEach(inp => {
      sum += Number(inp.value) || 0;
    });
    total.textContent = sum.toFixed(1);
  });
  // Per-column totals
  for (let col = 0; col < totalM; col++) {
    let sum = 0;
    for (const r of state.roles) {
      const a = target.detailedLoading[r.id];
      if (a && a[col] != null) sum += Number(a[col]) || 0;
    }
    const cell = wrap.querySelector(`.ds-col-total[data-col="${col}"]`);
    if (cell) cell.textContent = sum !== 0 ? sum.toFixed(1) : '';
  }
}

function formatCell(v) {
  if (v === 0) return '';
  // Drop trailing zeros: 1.0 → 1, 0.5 → 0.5, 0.25 → 0.25
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return String(Number(v.toFixed(2)));
}
