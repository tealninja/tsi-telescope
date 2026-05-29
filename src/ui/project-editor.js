/* ============================================================
   Project editor modal — open/close, form builder (basics +
   billing schedule + cost lines + per-phase loading curves),
   plus all the wire/refresh helpers that keep the modal's
   inline tables in sync with the working copy of the project.

   The modal works on a deep copy of the project; readProjectForm
   pulls scalar fields back into that copy on save. The save
   handler in openProjectModal commits it to state.projects.
   ============================================================ */

import { $, $$ } from '../util/dom.js';
import { escapeHtml, fmtMoney, winProbStageLabel } from '../util/format.js';
import { monthKey } from '../util/dates.js';
import { deepCopy, deepCopyMilestones, uid } from '../util/clone.js';
import {
  state, getPhase, getTemplate, getLocation, getProject, saveState
} from '../state.js';
import { totalEffectiveDuration } from '../compute/demand.js';
import {
  buildDetailedScheduleSection, wireDetailedSchedule,
  snapshotPhases, rebuildDetailedAfterPhaseChange
} from './detailed-schedule.js';
import { renderMiniMap } from './map-view.js';
import {
  DEFAULT_MILESTONE_SCHED, DEFAULT_COST_SCHED
} from '../defaults.js';
import { renderAll } from '../boot.js';
import { toast } from '../util/dom.js';

/* ---------- Project modal ---------- */

let currentProjectId = null;

export function openProjectModal(projectId) {
  currentProjectId = projectId;
  const isNew = !projectId;
  let p;
  if (isNew) {
    const tpl = state.templates[0];
    p = {
      id: uid('proj'),
      name: 'New Project',
      client: '',
      location: '',
      locationId: 'us',
      templateId: tpl.id,
      startMonth: monthKey(new Date()),
      notes: '',
      phases: deepCopy(tpl.phases),
      detailedLoading: tpl.detailedLoading ? deepCopy(tpl.detailedLoading) : {}
    };
  } else {
    p = deepCopy(getProject(projectId));
    if (!p.locationId) p.locationId = 'us';
  }

  $('#modal-project-title').textContent = isNew ? 'New Project' : 'Edit: ' + p.name;
  const body = $('#modal-project-body');
  body.innerHTML = buildProjectForm(p);
  $('#modal-project').classList.add('open');

  wireProjectForm(p);
  $('#modal-project-save').onclick = () => {
    const out = readProjectForm(p);
    if (!out.name.trim()) { alert('Name required'); return; }
    if (isNew) state.projects.push(out);
    else {
      const idx = state.projects.findIndex(x => x.id === out.id);
      state.projects[idx] = out;
    }
    saveState();
    closeProjectModal();
    renderAll();
    toast(isNew ? 'Project created' : 'Project saved');
  };
}

export function closeProjectModal() {
  $('#modal-project').classList.remove('open');
  currentProjectId = null;
}
$('#modal-project-close').addEventListener('click', closeProjectModal);
$('#modal-project-cancel').addEventListener('click', closeProjectModal);

function buildProjectForm(p) {
  const tplOptions = state.templates.map(t =>
    `<option value="${t.id}" ${t.id===p.templateId?'selected':''}>${escapeHtml(t.name)}</option>`
  ).join('');
  const locOptions = state.locations.map(l =>
    `<option value="${l.id}" ${l.id===p.locationId?'selected':''}>${escapeHtml(l.name)} (${l.multiplier.toFixed(2)}×)</option>`
  ).join('');

  const loc = getLocation(p.locationId);
  const mult = loc ? loc.multiplier : 1.0;

  let phasesHTML = '<table class="phase-table"><thead><tr>' +
    '<th style="width:30px">#</th>' +
    '<th>Phase</th>' +
    '<th style="width:120px">Base Dur (months)</th>' +
    '<th style="width:120px">Effective (months)</th>' +
    '</tr></thead><tbody>';
  p.phases.forEach((ph, idx) => {
    const phMeta = getPhase(ph.phaseId);
    const effDur = ph.duration > 0 ? Math.max(1, Math.round(ph.duration * mult)) : 0;
    phasesHTML += `
      <tr data-phase-idx="${idx}">
        <td class="mono">${idx+1}</td>
        <td class="phase-name">
          <span class="phase-color-dot" style="background:${phMeta?phMeta.color:'#999'}"></span>${escapeHtml(phMeta?phMeta.name:ph.phaseId)}
        </td>
        <td><input type="number" min="0" step="1" class="ph-duration" value="${ph.duration}"></td>
        <td><span class="eff-dur mono" style="color:var(--teal);font-weight:600">${effDur}</span></td>
      </tr>
    `;
  });
  phasesHTML += '</tbody></table>';

  const wp = p.winProbability != null ? p.winProbability : 100;
  const totalBase = p.phases.reduce((a,x)=>a+x.duration,0);

  return `
    <div class="modal-tabs">
      <div class="modal-tab active" data-pftab="details">Details</div>
      <div class="modal-tab" data-pftab="financials">Financials</div>
      <div class="modal-tab" data-pftab="resources">Resources</div>
      <div class="modal-tab" data-pftab="location">Location</div>
    </div>

    <div class="pftab active" id="pftab-details">
      <div class="field-row">
        <div class="field"><label>Project Name</label><input type="text" id="pf-name" value="${escapeHtml(p.name)}"></div>
        <div class="field"><label>Client</label><input type="text" id="pf-client" value="${escapeHtml(p.client||'')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Template</label>
          <select id="pf-template">${tplOptions}</select>
          <div class="helper">Changing template reloads phases + the resource grid from the template defaults.</div>
        </div>
        <div class="field"><label>Start Month (YYYY-MM)</label>
          <input type="month" id="pf-start" value="${p.startMonth}">
        </div>
      </div>
      <div class="field-row">
        <div class="field" style="flex:2"><label>Win Probability (Pipeline Stage)</label>
          <div style="display:flex;gap:10px;align-items:center">
            <input type="range" id="pf-winprob" min="0" max="100" step="5" value="${wp}" style="flex:1">
            <input type="number" id="pf-winprob-num" min="0" max="100" step="5" value="${wp}" class="mono" style="width:70px;text-align:right">
            <span style="color:var(--ink-mute)">%</span>
          </div>
          <div class="helper" id="pf-winprob-stage">${winProbStageLabel(wp)}</div>
        </div>
        <div class="field"><label>Risk-Weighted Revenue</label>
          <input type="text" id="pf-weighted-rev" readonly value="${fmtMoney((p.contractValue||0) * wp / 100)}" style="background:var(--warm-white);font-family:var(--font-mono);font-weight:600;color:var(--ink-strong)">
          <div class="helper">Contract × win prob — used for portfolio forecasting</div>
        </div>
      </div>
      <div class="field"><label>Notes</label><textarea id="pf-notes" rows="3">${escapeHtml(p.notes||'')}</textarea></div>
    </div>

    <div class="pftab" id="pftab-financials">
      <div class="section-label" style="margin-top:0">Commercial · Contract &amp; Billing</div>
      ${buildBillingSection(p)}
    </div>

    <div class="pftab" id="pftab-resources">
      <div class="field-row">
        <div class="field"><label>Total Effective Duration</label>
          <input type="text" id="pf-total" readonly value="${totalEffectiveDuration(p)} mo (${totalBase} base × ${mult.toFixed(2)})" style="background:var(--warm-white);font-family:var(--font-mono);font-weight:600;color:var(--ink-strong)">
          <div class="helper">Effective = base × the location's speed multiplier.</div>
        </div>
      </div>
      <div class="section-label" style="margin-top:8px">Phases · Duration</div>
      <div id="pf-phases">${phasesHTML}</div>

      <div class="section-label" style="margin-top:20px">Resource Allocation · FTE per Role per Month</div>
      <div id="pf-detailed">${buildDetailedScheduleSection(p, 'pf')}</div>
    </div>

    <div class="pftab" id="pftab-location">
      <div class="field-row">
        <div class="field"><label>Location (city/region)</label>
          <input type="text" id="pf-location" value="${escapeHtml(p.location||'')}">
          <div class="helper">Free-text label shown on cards. Example: "Spokane, WA".</div>
        </div>
        <div class="field"><label>Country / Region</label>
          <select id="pf-loc-id">${locOptions}</select>
          <div class="helper">Applies a speed multiplier to all phase durations.</div>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Latitude</label>
          <input type="number" id="pf-lat" step="0.0001" min="-90" max="90" value="${p.lat != null ? p.lat : ''}" class="mono" placeholder="e.g. 47.6588">
          <div class="helper">Decimal degrees. Auto-fills from the chosen country if blank.</div>
        </div>
        <div class="field"><label>Longitude</label>
          <input type="number" id="pf-lng" step="0.0001" min="-180" max="180" value="${p.lng != null ? p.lng : ''}" class="mono" placeholder="e.g. -117.4260">
        </div>
      </div>
      <div class="section-label">Pin Preview</div>
      <div class="mini-map-wrap" id="pf-minimap"></div>
      <div class="helper" style="margin-top:6px">Highlighted pin = this project. Other portfolio pins shown faintly for context.</div>
    </div>
  `;
}

/* ---------- Billing section builder ---------- */
function buildBillingSection(p) {
  const cv = p.contractValue || 0;
  const bm = p.billingMode || 'milestone';
  const ms = p.milestones || [];
  const pctSum = ms.reduce((a,m)=>a+(m.percent||0), 0);
  const sumStatusColor = Math.abs(pctSum - 100) < 0.01 ? 'var(--succ-green)' : 'var(--coral)';
  const sumStatusText = Math.abs(pctSum - 100) < 0.01 ? 'OK' : (pctSum > 100 ? 'exceeds 100%' : 'short of 100%');

  // Build anchor option list: 'start', phases in this project, then '_end'
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });

  let milestonesHTML = '';
  if (bm === 'milestone' || bm === 'accrual_poc') {
    milestonesHTML = `
      <div id="pf-milestone-block" style="margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <div class="section-label" style="margin:0">Milestone Schedule</div>
          <div style="font-size:11px"><span style="color:var(--ink-mute)">Sum:</span> <span id="pf-pct-sum" style="color:${sumStatusColor};font-weight:700;font-family:var(--font-mono)">${pctSum.toFixed(1)}%</span> <span id="pf-pct-status" style="color:${sumStatusColor};font-size:10px">${sumStatusText}</span></div>
        </div>
        <table class="phase-table" style="width:100%">
          <thead>
            <tr>
              <th>Milestone Name</th>
              <th style="width:180px">Anchor</th>
              <th style="width:100px">Offset (mo)</th>
              <th style="width:90px">Percent</th>
              <th style="width:120px">$ Amount</th>
              <th style="width:40px"></th>
            </tr>
          </thead>
          <tbody id="pf-ms-tbody">
            ${ms.map((m, i) => renderMilestoneRow(m, i, anchorOpts, cv)).join('')}
          </tbody>
        </table>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button type="button" class="btn ghost small" id="pf-add-ms">+ Add Milestone</button>
          <button type="button" class="btn ghost small" id="pf-load-default-ms">Load Default 10/30/30/20/10</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="field-row">
      <div class="field"><label>Total Contract Value (USD)</label>
        <input type="number" id="pf-cv" min="0" step="10000" value="${cv}" class="mono">
        <div class="helper" id="pf-cv-display">${fmtMoney(cv)}</div>
      </div>
      <div class="field"><label>Billing Mode</label>
        <select id="pf-billing-mode">
          <option value="milestone" ${bm==='milestone'?'selected':''}>Milestone · Cash (revenue lumpy on payment date)</option>
          <option value="accrual_poc" ${bm==='accrual_poc'?'selected':''}>Milestone + Accrual POC (cash lumpy, revenue smooth)</option>
          <option value="monthly" ${bm==='monthly'?'selected':''}>Continuous Monthly (cash = revenue, evenly spread)</option>
        </select>
        <div class="helper">${bm === 'milestone' ? 'Cash and revenue recognized together at milestone payment dates.' : bm === 'accrual_poc' ? 'Cash flows on milestone dates; revenue earned smoothly proportional to FTE-months consumed (percentage of completion).' : 'Total value divided evenly across the project duration. No milestone schedule used.'}</div>
      </div>
    </div>
    ${milestonesHTML}
    ${buildCostSection(p)}
  `;
}

function buildCostSection(p) {
  const costs = p.costLines || [];
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });
  const totalCost = costs.reduce((a,c) => a + (c.amount||0), 0);
  const cv = p.contractValue || 0;
  const grossMargin = cv > 0 ? ((cv - totalCost) / cv * 100) : 0;
  const marginColor = grossMargin >= 20 ? 'var(--succ-green)' : grossMargin >= 10 ? 'var(--amber)' : 'var(--coral)';

  return `
    <div id="pf-cost-block" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <div class="section-label" style="margin:0">Cost Outflows · $ at month anchored to phase</div>
        <div style="font-size:11px;display:flex;gap:14px">
          <span><span style="color:var(--ink-mute)">Total cost:</span> <span id="pf-cost-total" class="mono" style="font-weight:700;color:var(--coral)">${fmtMoney(totalCost)}</span></span>
          <span><span style="color:var(--ink-mute)">Gross margin:</span> <span id="pf-margin" class="mono" style="font-weight:700;color:${marginColor}">${cv > 0 ? grossMargin.toFixed(1)+'%' : '—'}</span></span>
        </div>
      </div>
      <table class="phase-table" style="width:100%">
        <thead>
          <tr>
            <th>Cost Item</th>
            <th style="width:180px">Anchor</th>
            <th style="width:100px">Offset (mo)</th>
            <th style="width:140px">$ Amount</th>
            <th style="width:40px"></th>
          </tr>
        </thead>
        <tbody id="pf-cl-tbody">
          ${costs.map((c, i) => renderCostRow(c, i, anchorOpts)).join('')}
        </tbody>
      </table>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button type="button" class="btn ghost small" id="pf-add-cl">+ Add Cost Line</button>
        <button type="button" class="btn ghost small" id="pf-load-default-cl">Load Standard Cost Lines</button>
      </div>
    </div>
  `;
}

function renderCostRow(c, i, anchorOpts) {
  const opts = anchorOpts.map(a => `<option value="${a.value}" ${a.value===c.anchor?'selected':''}>${escapeHtml(a.label)}</option>`).join('');
  return `
    <tr data-cl-idx="${i}">
      <td><input type="text" class="cl-name" value="${escapeHtml(c.name||'')}"></td>
      <td><select class="cl-anchor">${opts}</select></td>
      <td><input type="number" class="cl-offset mono" step="1" value="${c.offsetMonths||0}"></td>
      <td><input type="number" class="cl-amount mono" step="10000" min="0" value="${c.amount||0}" style="text-align:right"></td>
      <td style="text-align:center"><button type="button" class="btn danger small cl-del">×</button></td>
    </tr>
  `;
}

function renderMilestoneRow(m, i, anchorOpts, cv) {
  const pct = m.percent || 0;
  const amount = cv > 0 ? (cv * pct / 100) : 0;
  const opts = anchorOpts.map(a => `<option value="${a.value}" ${a.value===m.anchor?'selected':''}>${escapeHtml(a.label)}</option>`).join('');
  return `
    <tr data-ms-idx="${i}">
      <td><input type="text" class="ms-name" value="${escapeHtml(m.name||'')}"></td>
      <td><select class="ms-anchor">${opts}</select></td>
      <td><input type="number" class="ms-offset mono" step="1" value="${m.offsetMonths||0}"></td>
      <td><input type="number" class="ms-pct mono" step="1" min="0" max="100" value="${pct}" style="text-align:right"></td>
      <td><span class="ms-amount mono" style="font-weight:600;color:var(--ink-strong)">${fmtMoney(amount)}</span></td>
      <td style="text-align:center"><button type="button" class="btn danger small ms-del">×</button></td>
    </tr>
  `;
}

function wireProjectForm(p) {
  const tplSel = $('#pf-template');
  tplSel.addEventListener('change', () => {
    if (!confirm('Loading a template will replace this project\'s phases with the template defaults. Continue?\n\nNote: contract value, billing schedule, and cost lines will also be reset to the template defaults.')) {
      tplSel.value = p.templateId; return;
    }
    p.templateId = tplSel.value;
    const tpl = getTemplate(p.templateId);
    p.phases = deepCopy(tpl.phases);
    p.detailedLoading = tpl.detailedLoading ? deepCopy(tpl.detailedLoading) : {};
    if (tpl.defaultContractValue != null) p.contractValue = tpl.defaultContractValue;
    if (tpl.billingMode) p.billingMode = tpl.billingMode;
    if (tpl.milestones) p.milestones = deepCopyMilestones(tpl.milestones);
    if (tpl.costLines) p.costLines = deepCopyMilestones(tpl.costLines);
    const body = $('#modal-project-body');
    body.innerHTML = buildProjectForm(p);
    wireProjectForm(p);
  });

  const locSel = $('#pf-loc-id');
  locSel.addEventListener('change', () => {
    p.locationId = locSel.value;
    // Auto-fill lat/lng with the new location's centroid if the user
    // hasn't typed anything specific. Useful when picking a country
    // from the dropdown — markers land in roughly the right place.
    const newLoc = getLocation(p.locationId);
    if (newLoc && newLoc.lat != null && newLoc.lng != null) {
      const latInp = $('#pf-lat'), lngInp = $('#pf-lng');
      if (latInp && (latInp.value === '' || confirm('Move project pin to ' + newLoc.name + ' centroid?'))) {
        latInp.value = newLoc.lat;
        lngInp.value = newLoc.lng;
        p.lat = newLoc.lat;
        p.lng = newLoc.lng;
      }
    }
    updateEffDurs(p);
  });

  wireProjectFormPhases(p);
  wireBillingForm(p);
  wireWinProbForm(p);
  wireDetailedSchedule(p, 'pf');
  wireModalTabs(p);
  wireMiniMap(p);
}

function wireModalTabs(p) {
  const body = $('#modal-project-body');
  body.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.pftab;
      body.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      body.querySelectorAll('.pftab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      body.querySelector('#pftab-' + target).classList.add('active');
      if (target === 'location') refreshMiniMap(p);
    });
  });
}

function wireMiniMap(p) {
  // Re-draw the mini map whenever lat/lng change so the highlighted
  // pin tracks the working copy in real time.
  const lat = $('#pf-lat'), lng = $('#pf-lng');
  if (!lat || !lng) return;
  [lat, lng].forEach(inp => {
    inp.addEventListener('input', () => {
      const a = parseFloat(lat.value), b = parseFloat(lng.value);
      p.lat = Number.isFinite(a) ? a : null;
      p.lng = Number.isFinite(b) ? b : null;
      refreshMiniMap(p);
    });
  });
}

function refreshMiniMap(p) {
  const wrap = $('#pf-minimap');
  if (!wrap) return;
  renderMiniMap(wrap, { project: p });
}

function wireWinProbForm(p) {
  const slider = $('#pf-winprob');
  const num = $('#pf-winprob-num');
  const stage = $('#pf-winprob-stage');
  const wrev = $('#pf-weighted-rev');
  if (!slider || !num) return;
  const sync = (v) => {
    v = Math.max(0, Math.min(100, parseInt(v || '0', 10)));
    p.winProbability = v;
    slider.value = v;
    num.value = v;
    if (stage) stage.textContent = winProbStageLabel(v);
    if (wrev) wrev.value = fmtMoney((p.contractValue||0) * v / 100);
  };
  slider.addEventListener('input', () => sync(slider.value));
  num.addEventListener('input', () => sync(num.value));
}

/* ---------- Billing form wiring ---------- */
function wireBillingForm(p) {
  const cvInp = $('#pf-cv');
  const bmSel = $('#pf-billing-mode');

  if (cvInp) {
    cvInp.addEventListener('input', () => {
      p.contractValue = Math.max(0, parseFloat(cvInp.value || '0'));
      const dispEl = $('#pf-cv-display');
      if (dispEl) dispEl.textContent = fmtMoney(p.contractValue);
      refreshMilestoneAmounts(p);
      refreshCostTotals(p);
      const wrev = $('#pf-weighted-rev');
      if (wrev) wrev.value = fmtMoney(p.contractValue * (p.winProbability != null ? p.winProbability : 100) / 100);
    });
  }
  if (bmSel) {
    bmSel.addEventListener('change', () => {
      p.billingMode = bmSel.value;
      // Re-render billing section since milestone block visibility depends on mode
      // Find the billing block parent (.section-label "Commercial..." + next siblings)
      // Easier: re-render whole form
      const body = $('#modal-project-body');
      body.innerHTML = buildProjectForm(p);
      wireProjectForm(p);
    });
  }
  wireMilestoneRows(p);
  const addBtn = $('#pf-add-ms');
  if (addBtn) addBtn.addEventListener('click', () => {
    if (!p.milestones) p.milestones = [];
    p.milestones.push({ name: 'New Milestone', anchor: 'start', offsetMonths: 0, percent: 0 });
    refreshMilestoneTable(p);
  });
  const defBtn = $('#pf-load-default-ms');
  if (defBtn) defBtn.addEventListener('click', () => {
    if (!confirm('Replace current milestone schedule with the default 10/30/30/20/10 schedule?')) return;
    p.milestones = deepCopyMilestones(DEFAULT_MILESTONE_SCHED);
    refreshMilestoneTable(p);
  });

  // Cost line wiring
  wireCostRows(p);
  const addCl = $('#pf-add-cl');
  if (addCl) addCl.addEventListener('click', () => {
    if (!p.costLines) p.costLines = [];
    p.costLines.push({ name: 'New Cost Line', anchor: 'fab', offsetMonths: 0, amount: 0 });
    refreshCostTable(p);
  });
  const loadCl = $('#pf-load-default-cl');
  if (loadCl) loadCl.addEventListener('click', () => {
    if (!confirm('Replace current cost lines with the standard schedule (Design / Equipment / Installation / Commissioning)?')) return;
    p.costLines = deepCopyMilestones(DEFAULT_COST_SCHED);
    refreshCostTable(p);
  });
}

function wireCostRows(p) {
  $$('#pf-cl-tbody tr').forEach(tr => {
    const idx = parseInt(tr.dataset.clIdx, 10);
    tr.querySelector('.cl-name').addEventListener('input', (e) => {
      p.costLines[idx].name = e.target.value;
    });
    tr.querySelector('.cl-anchor').addEventListener('change', (e) => {
      p.costLines[idx].anchor = e.target.value;
    });
    tr.querySelector('.cl-offset').addEventListener('input', (e) => {
      p.costLines[idx].offsetMonths = parseInt(e.target.value || '0', 10);
    });
    tr.querySelector('.cl-amount').addEventListener('input', (e) => {
      p.costLines[idx].amount = Math.max(0, parseFloat(e.target.value || '0'));
      refreshCostTotals(p);
    });
    tr.querySelector('.cl-del').addEventListener('click', () => {
      p.costLines.splice(idx, 1);
      refreshCostTable(p);
    });
  });
}

function refreshCostTable(p) {
  const tbody = $('#pf-cl-tbody');
  if (!tbody) return;
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });
  tbody.innerHTML = (p.costLines || []).map((c, i) => renderCostRow(c, i, anchorOpts)).join('');
  wireCostRows(p);
  refreshCostTotals(p);
}

function refreshCostTotals(p) {
  const total = (p.costLines || []).reduce((a, c) => a + (c.amount||0), 0);
  const cv = p.contractValue || 0;
  const margin = cv > 0 ? ((cv - total) / cv * 100) : 0;
  const totEl = $('#pf-cost-total');
  const mgEl = $('#pf-margin');
  if (totEl) totEl.textContent = fmtMoney(total);
  if (mgEl) {
    mgEl.textContent = cv > 0 ? margin.toFixed(1) + '%' : '—';
    mgEl.style.color = margin >= 20 ? 'var(--succ-green)' : margin >= 10 ? 'var(--amber)' : 'var(--coral)';
  }
}

function wireMilestoneRows(p) {
  $$('#pf-ms-tbody tr').forEach(tr => {
    const idx = parseInt(tr.dataset.msIdx, 10);
    tr.querySelector('.ms-name').addEventListener('input', (e) => {
      p.milestones[idx].name = e.target.value;
    });
    tr.querySelector('.ms-anchor').addEventListener('change', (e) => {
      p.milestones[idx].anchor = e.target.value;
    });
    tr.querySelector('.ms-offset').addEventListener('input', (e) => {
      p.milestones[idx].offsetMonths = parseInt(e.target.value || '0', 10);
    });
    tr.querySelector('.ms-pct').addEventListener('input', (e) => {
      const v = Math.max(0, Math.min(100, parseFloat(e.target.value || '0')));
      p.milestones[idx].percent = v;
      refreshMilestoneAmounts(p);
      refreshMilestoneSum(p);
    });
    tr.querySelector('.ms-del').addEventListener('click', () => {
      p.milestones.splice(idx, 1);
      refreshMilestoneTable(p);
    });
  });
}

function refreshMilestoneTable(p) {
  const tbody = $('#pf-ms-tbody');
  if (!tbody) return;
  const usedPhaseIds = p.phases.map(ph => ph.phaseId);
  const anchorOpts = ['start', ...usedPhaseIds, '_end'].map(a => {
    let label;
    if (a === 'start') label = '— project start —';
    else if (a === '_end') label = '— project end —';
    else { const ph = getPhase(a); label = ph ? ph.name + ' complete' : a; }
    return { value: a, label };
  });
  const cv = p.contractValue || 0;
  tbody.innerHTML = (p.milestones || []).map((m, i) => renderMilestoneRow(m, i, anchorOpts, cv)).join('');
  wireMilestoneRows(p);
  refreshMilestoneSum(p);
}

function refreshMilestoneAmounts(p) {
  const cv = p.contractValue || 0;
  $$('#pf-ms-tbody tr').forEach((tr, i) => {
    const m = p.milestones[i];
    const amt = cv > 0 ? cv * (m.percent || 0) / 100 : 0;
    const el = tr.querySelector('.ms-amount');
    if (el) el.textContent = fmtMoney(amt);
  });
}

function refreshMilestoneSum(p) {
  const ms = p.milestones || [];
  const sum = ms.reduce((a,m) => a + (m.percent||0), 0);
  const sumEl = $('#pf-pct-sum');
  const statusEl = $('#pf-pct-status');
  if (!sumEl || !statusEl) return;
  const ok = Math.abs(sum - 100) < 0.01;
  const color = ok ? 'var(--succ-green)' : 'var(--coral)';
  sumEl.textContent = sum.toFixed(1) + '%';
  sumEl.style.color = color;
  statusEl.textContent = ok ? 'OK' : (sum > 100 ? 'exceeds 100%' : 'short of 100%');
  statusEl.style.color = color;
}

function wireProjectFormPhases(p) {
  // On `change` (not `input`) so the user finishes typing before we
  // resize the detailed grid — otherwise every keystroke would rebuild.
  $$('#pf-phases .ph-duration').forEach(inp => {
    inp.addEventListener('input', () => {
      // Live effective-duration display feedback only; no rebuild.
      const v = Math.max(0, parseInt(inp.value || '0', 10));
      const tr = inp.closest('tr');
      const phaseIdx = parseInt(tr.dataset.phaseIdx, 10);
      p.phases[phaseIdx].duration = v;
      updateEffDurs(p);
    });
    inp.addEventListener('change', () => {
      // Commit: snapshot the OLD layout (with old durations now lost), so we
      // rebuild using the snapshot captured on focus. We use the focus
      // snapshot rather than recomputing.
      const snap = inp._phaseSnap || snapshotPhases(p);
      delete inp._phaseSnap;
      rebuildDetailedAfterPhaseChange(p, snap);
      // Re-render the detailed grid in place.
      const wrap = $('#pf-detailed');
      if (wrap) {
        wrap.innerHTML = buildDetailedScheduleSection(p, 'pf');
        wireDetailedSchedule(p, 'pf');
      }
    });
    inp.addEventListener('focus', () => {
      // Capture the layout BEFORE the user starts editing, so the change
      // handler has access to the old durations.
      inp._phaseSnap = snapshotPhases(p);
    });
  });
}

function updateEffDurs(p) {
  const loc = getLocation(p.locationId);
  const mult = loc ? loc.multiplier : 1.0;
  $$('#pf-phases tr[data-phase-idx]').forEach(tr => {
    const idx = parseInt(tr.dataset.phaseIdx, 10);
    const base = p.phases[idx].duration;
    const eff = base > 0 ? Math.max(1, Math.round(base * mult)) : 0;
    const el = tr.querySelector('.eff-dur');
    if (el) el.textContent = eff;
  });
  const totalBase = p.phases.reduce((a,x)=>a+x.duration,0);
  const totalEff = totalEffectiveDuration(p);
  const t = $('#pf-total');
  if (t) t.value = totalEff + ' mo (' + totalBase + ' base × ' + mult.toFixed(2) + ')';
}

function readProjectForm(p) {
  p.name = $('#pf-name').value;
  p.client = $('#pf-client').value;
  p.location = $('#pf-location').value;
  p.templateId = $('#pf-template').value;
  p.locationId = $('#pf-loc-id').value;
  p.startMonth = $('#pf-start').value;
  p.notes = $('#pf-notes').value;
  const lat = parseFloat($('#pf-lat').value);
  const lng = parseFloat($('#pf-lng').value);
  p.lat = Number.isFinite(lat) ? lat : null;
  p.lng = Number.isFinite(lng) ? lng : null;
  return p;
}
