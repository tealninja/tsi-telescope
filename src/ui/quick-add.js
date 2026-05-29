/* ============================================================
   Quick Add modal — minimal data entry for adding projects fast.

   Five fields: Name, Client, Template, Start Month, Contract Value.
   Stage defaults to Booked (committed work) — adjustable. Template
   inheritance fills in phases, detailed FTE allocation, milestones,
   cost lines, billing mode, default contract value.

   Live "months elapsed / remaining" preview helps catch typos in
   the start month (e.g. for a project that started last August,
   the preview reads "started 4 months ago, 14 months remaining").
   ============================================================ */

import { $ } from '../util/dom.js';
import {
  state, getTemplate, addProject, saveState
} from '../state.js';
import { uid, deepCopy, deepCopyMilestones } from '../util/clone.js';
import { monthKey, monthsBetween, addMonths, monthLabel } from '../util/dates.js';
import { escapeHtml, fmtMoney } from '../util/format.js';
import {
  DEFAULT_MILESTONE_SCHED, DEFAULT_COST_SCHED
} from '../defaults.js';
import { STAGES, winProbForStage } from '../util/stages.js';
import { renderAll } from '../boot.js';
import { toast } from '../util/dom.js';

export function openQuickAddModal() {
  const modal = $('#modal-quick-add');
  if (!modal) return;
  build();
  wire();
  modal.classList.add('open');
  // Focus the name field for fast typing.
  requestAnimationFrame(() => { const n = $('#qa-name'); if (n) n.focus(); });
}

function closeModal() {
  $('#modal-quick-add').classList.remove('open');
}

function build() {
  const body = $('#modal-quick-add-body');
  const tplOpts = state.templates.map(t =>
    `<option value="${t.id}" ${t.id === state.templates[0].id ? 'selected' : ''}>${escapeHtml(t.name)} (${fmtMoney(t.defaultContractValue || 0, {compact:true})})</option>`
  ).join('');
  const stageOpts = STAGES.map(s =>
    `<option value="${s.id}" ${s.id === 'booked' ? 'selected' : ''}>${escapeHtml(s.label)} · ${s.winProb}%</option>`
  ).join('');
  const today = monthKey(new Date());

  body.innerHTML = `
    <div class="field"><label>Project Name</label>
      <input type="text" id="qa-name" placeholder="e.g. Drax Selby — Dryer 4">
    </div>
    <div class="field"><label>Client</label>
      <input type="text" id="qa-client" placeholder="e.g. Drax Group">
    </div>
    <div class="field-row">
      <div class="field"><label>Template</label>
        <select id="qa-template">${tplOpts}</select>
        <div class="helper">Phases, FTE allocation, milestones, costs inherited from this.</div>
      </div>
      <div class="field"><label>Stage</label>
        <select id="qa-stage">${stageOpts}</select>
        <div class="helper">Booked = sold/committed work. Pre-sale stages count weighted by win-prob.</div>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Start Month</label>
        <input type="month" id="qa-start" value="${today}">
        <div class="helper" id="qa-elapsed">Starting this month.</div>
      </div>
      <div class="field"><label>Contract Value</label>
        <input type="number" id="qa-value" step="1000" placeholder="auto from template" class="mono">
        <div class="helper">Blank = use template default.</div>
      </div>
    </div>
  `;
}

function wire() {
  const start = $('#qa-start');
  const elapsed = $('#qa-elapsed');
  const template = $('#qa-template');
  const valueInp = $('#qa-value');

  function refreshElapsed() {
    const sm = start.value;
    if (!sm) { elapsed.textContent = ''; return; }
    const todayKey = monthKey(new Date());
    const dm = monthsBetween(todayKey, sm);
    const tpl = getTemplate(template.value);
    const baseDur = tpl ? tpl.phases.reduce((a, p) => a + (p.duration || 0), 0) : 0;
    if (dm > 0) {
      elapsed.textContent = `Starts in ${dm} month${dm === 1 ? '' : 's'} · ${baseDur} mo total duration.`;
    } else if (dm === 0) {
      elapsed.textContent = `Starting this month · ${baseDur} mo total duration.`;
    } else {
      const passed = -dm;
      const remaining = Math.max(0, baseDur - passed);
      elapsed.textContent = `Started ${passed} month${passed === 1 ? '' : 's'} ago · ${remaining} mo remaining of ${baseDur} mo total.`;
    }
  }

  function refreshValueHint() {
    const tpl = getTemplate(template.value);
    if (tpl && tpl.defaultContractValue && !valueInp.value) {
      valueInp.placeholder = String(tpl.defaultContractValue);
    }
  }

  start.addEventListener('input', refreshElapsed);
  start.addEventListener('change', refreshElapsed);
  template.addEventListener('change', () => { refreshElapsed(); refreshValueHint(); });
  refreshElapsed();
  refreshValueHint();

  $('#modal-quick-add-cancel').onclick = closeModal;
  $('#modal-quick-add-close').onclick = closeModal;
  $('#modal-quick-add-save').onclick = handleSave;
  // Submit on Enter from any input.
  $('#modal-quick-add-body').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      handleSave();
    }
  });
}

function handleSave() {
  const name = $('#qa-name').value.trim();
  if (!name) { alert('Name required'); return; }
  const client = $('#qa-client').value.trim();
  const tplId = $('#qa-template').value;
  const tpl = getTemplate(tplId);
  if (!tpl) { alert('Pick a template'); return; }
  const stage = $('#qa-stage').value;
  const startMonth = $('#qa-start').value || monthKey(new Date());
  const rawValue = $('#qa-value').value.trim();
  const contractValue = rawValue
    ? Math.max(0, parseFloat(rawValue) || 0)
    : (tpl.defaultContractValue || 0);

  // Default location: first location with multiplier 1.0 (US baseline), else first.
  const baseLoc = state.locations.find(l => l.multiplier === 1.0) || state.locations[0];

  const p = {
    id: uid('proj'),
    name,
    client,
    location: baseLoc ? baseLoc.name : '',
    locationId: baseLoc ? baseLoc.id : null,
    templateId: tplId,
    startMonth,
    notes: '',
    phases: deepCopy(tpl.phases),
    contractValue,
    billingMode: tpl.billingMode || 'milestone',
    milestones: deepCopyMilestones(tpl.milestones || DEFAULT_MILESTONE_SCHED),
    costLines: deepCopyMilestones(tpl.costLines || DEFAULT_COST_SCHED),
    pinned: false,
    stage,
    winProbability: winProbForStage(stage),
    lat: baseLoc ? baseLoc.lat : null,
    lng: baseLoc ? baseLoc.lng : null,
    detailedLoading: tpl.detailedLoading ? deepCopy(tpl.detailedLoading) : {}
  };

  addProject(p);
  saveState();
  closeModal();
  renderAll();
  toast(`Added "${name}" as ${stage}`);
}
