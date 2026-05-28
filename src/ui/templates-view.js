/* ============================================================
   Templates view + template editor modal + clone-template modal.
   Templates own the default phase sequence, role-loading curves,
   billing schedule, and cost lines for each project shape.
   ============================================================ */

import { $, $$, toast } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { deepCopy, uid } from '../util/clone.js';
import { state, getPhase, getTemplate, saveState } from '../state.js';
import { buildLoad, defaultLoading } from '../defaults.js';
import { detailedFromSimple } from '../compute/demand.js';
import {
  buildDetailedScheduleSection, wireDetailedSchedule
} from './detailed-schedule.js';

export function renderTemplates() {
  const list = $('#template-list');
  list.innerHTML = state.templates.map(t => {
    const total = t.phases.reduce((a,x)=>a+x.duration,0);
    return `
      <div style="border:1px solid var(--rule);margin-bottom:14px;background:var(--bg-panel);border-radius:2px;border-left:3px solid var(--teal)">
        <div style="padding:14px 18px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--rule-soft);gap:14px">
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-display);font-weight:400;font-size:20px;color:var(--ink-strong);line-height:1.15">${escapeHtml(t.name)}</div>
            <div style="font-size:12px;color:var(--gray);margin-top:3px">${t.phases.length} phases · ${total} months base</div>
            ${t.description ? `<div style="font-size:12px;color:var(--charcoal);margin-top:6px;line-height:1.45">${escapeHtml(t.description)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn ghost small" data-tpl-edit="${t.id}">Edit</button>
            <button class="btn ghost small" data-tpl-clone="${t.id}">Clone</button>
            <button class="btn danger small" data-tpl-del="${t.id}">Delete</button>
          </div>
        </div>
        <div style="padding:10px 18px;display:flex;gap:5px;flex-wrap:wrap">
          ${t.phases.map(ph => {
            const pm = getPhase(ph.phaseId);
            return `<span style="background:${pm?pm.color:'#888'};color:#fff;padding:4px 10px;font-size:10px;font-weight:600;letter-spacing:0.03em;border-radius:2px">${escapeHtml(pm?pm.name:ph.phaseId)} · ${ph.duration}mo</span>`;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-tpl-edit]').forEach(btn => {
    btn.addEventListener('click', () => openTemplateModal(btn.dataset.tplEdit));
  });
  list.querySelectorAll('[data-tpl-clone]').forEach(btn => {
    btn.addEventListener('click', () => cloneTemplate(btn.dataset.tplClone));
  });
  list.querySelectorAll('[data-tpl-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tplId = btn.dataset.tplDel;
      const t = getTemplate(tplId);
      if (!confirm(`Delete template "${t.name}"? Projects using it will keep their phase data.`)) return;
      state.templates = state.templates.filter(x => x.id !== tplId);
      saveState(); renderTemplates();
    });
  });
}

function cloneTemplate(srcId) {
  const src = getTemplate(srcId);
  const name = prompt('Name for the new template?', src.name + ' (copy)');
  if (!name) return;
  const t = deepCopy(src);
  t.id = uid('tpl');
  t.name = name;
  state.templates.push(t);
  saveState();
  renderTemplates();
  toast(`Template "${name}" created`);
  openTemplateModal(t.id);
}

$('#btn-new-template').addEventListener('click', () => {
  const name = prompt('Template name?', 'New Template');
  if (!name) return;
  // Build a starter template with the standard 8-phase shape, zero loadings
  const starterPhaseIds = ['sales','pm','design','procure','fab','install','commiss','warranty'];
  const t = {
    id: uid('tpl'),
    name,
    description: '',
    phases: starterPhaseIds.map(pid => ({
      phaseId: pid,
      duration: 2,
      loading: buildLoad({})
    }))
  };
  state.templates.push(t);
  saveState();
  renderTemplates();
  openTemplateModal(t.id);
});

$('#btn-clone-template').addEventListener('click', () => {
  // Open clone modal
  const sel = $('#clone-source');
  sel.innerHTML = state.templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  $('#clone-name').value = '';
  $('#modal-clone').classList.add('open');
});
$('#modal-clone-close').addEventListener('click', () => $('#modal-clone').classList.remove('open'));
$('#modal-clone-cancel').addEventListener('click', () => $('#modal-clone').classList.remove('open'));
$('#modal-clone-do').addEventListener('click', () => {
  const name = $('#clone-name').value.trim();
  if (!name) { alert('Name required'); return; }
  const srcId = $('#clone-source').value;
  const src = getTemplate(srcId);
  const t = deepCopy(src);
  t.id = uid('tpl');
  t.name = name;
  state.templates.push(t);
  saveState();
  $('#modal-clone').classList.remove('open');
  renderTemplates();
  toast(`Template "${name}" created`);
});

let currentTplId = null;
function openTemplateModal(tplId) {
  currentTplId = tplId;
  const t = deepCopy(getTemplate(tplId));
  $('#modal-template-title').textContent = 'Edit Template: ' + t.name;
  renderTemplateModalBody(t);
  $('#modal-template').classList.add('open');
}

/* Render the modal body from the in-memory working copy. Used both
   on initial open and after the mode toggle, so detailed edits are
   preserved across mode switches. */
function renderTemplateModalBody(t) {
  const body = $('#modal-template-body');
  const phaseOpts = state.phases.map(ph =>
    `<option value="${ph.id}">${escapeHtml(ph.name)}</option>`
  ).join('');

  let phasesHTML = '<table class="phase-table"><thead><tr>' +
    '<th style="width:30px">#</th>' +
    '<th>Phase</th>' +
    '<th style="width:90px">Duration (mo)</th>' +
    '<th>Role Loading</th>' +
    '<th style="width:80px"></th>' +
    '</tr></thead><tbody id="tpl-phases-body">';
  t.phases.forEach((ph, idx) => {
    phasesHTML += renderTemplatePhaseRow(t, ph, idx);
  });
  phasesHTML += '</tbody></table>';

  body.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Template Name</label><input type="text" id="tf-name" value="${escapeHtml(t.name)}"></div>
    </div>
    <div class="field"><label>Description</label><textarea id="tf-description" rows="2">${escapeHtml(t.description||'')}</textarea></div>

    <div class="section-label" style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
      <span>Phases · Default Role Loading</span>
      <div style="display:flex;gap:6px;border:1px solid var(--rule);border-radius:2px;overflow:hidden">
        <button type="button" class="btn ghost small tf-mode-btn${(t.loadingMode||'simple')==='simple'?' active':''}" data-mode="simple" style="border-radius:0">Simple Curves</button>
        <button type="button" class="btn ghost small tf-mode-btn${t.loadingMode==='detailed'?' active':''}" data-mode="detailed" style="border-radius:0">Detailed Monthly</button>
      </div>
    </div>
    ${phasesHTML}

    <div style="margin-top:14px;display:flex;gap:8px;align-items:center">
      <select id="tf-add-phase-id" style="width:auto;flex:0 0 auto;max-width:240px">${phaseOpts}</select>
      <input type="number" id="tf-add-phase-dur" min="1" value="2" placeholder="months" style="width:80px;flex:0 0 80px">
      <button class="btn ghost small" id="tf-add-phase">+ Add Phase</button>
    </div>

    <div id="tf-detailed">${t.loadingMode === 'detailed' ? buildDetailedScheduleSection(t, 'tf') : ''}</div>
  `;

  wireTemplateModal(t);
  if (t.loadingMode === 'detailed') wireDetailedSchedule(t, 'tf');
  body.querySelectorAll('.tf-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.mode;
      const curMode = t.loadingMode || 'simple';
      if (newMode === curMode) return;
      if (newMode === 'detailed') {
        if (!t.detailedLoading || Object.keys(t.detailedLoading).length === 0) {
          t.detailedLoading = detailedFromSimple(t);
        }
        t.loadingMode = 'detailed';
      } else {
        const hasData = t.detailedLoading && Object.values(t.detailedLoading)
          .some(arr => Array.isArray(arr) && arr.some(v => Number(v) > 0));
        if (hasData && !confirm('Switch back to simple curves? The detailed allocation is kept in the template but ignored at compute time.')) return;
        t.loadingMode = 'simple';
      }
      // Re-render the body from the in-memory `t` so detailed edits survive.
      renderTemplateModalBody(t);
    });
  });

  $('#modal-template-save').onclick = () => {
    t.name = $('#tf-name').value;
    t.description = $('#tf-description').value;
    const idx = state.templates.findIndex(x => x.id === t.id);
    state.templates[idx] = t;
    saveState();
    closeTemplateModal();
    renderTemplates();
    toast('Template saved');
  };
}

function renderTemplatePhaseRow(t, ph, idx) {
  const phMeta = getPhase(ph.phaseId);
  return `
    <tr data-phase-idx="${idx}">
      <td class="mono">${idx+1}</td>
      <td class="phase-name">
        <span class="phase-color-dot" style="background:${phMeta?phMeta.color:'#999'}"></span>${escapeHtml(phMeta?phMeta.name:ph.phaseId)}
      </td>
      <td><input type="number" min="0" step="1" class="t-duration" value="${ph.duration}"></td>
      <td>
        <details ${countActiveRoles(ph.loading) > 0 ? 'open' : ''}>
          <summary>Edit loading (${countActiveRoles(ph.loading)} roles active)</summary>
          <div class="role-load-grid">
            <div class="head">Role</div>
            <div class="head">Peak %</div>
            <div class="head">Ramp Up (mo)</div>
            <div class="head">Ramp Down (mo)</div>
            ${state.roles.map(r => {
              const ld = ph.loading[r.id] || defaultLoading(0,0,0);
              return `
                <div>${escapeHtml(r.name)}</div>
                <div><input type="number" min="0" step="1" class="t-rl" data-role="${r.id}" data-field="peak" value="${ld.peak}"></div>
                <div><input type="number" min="0" step="1" class="t-rl" data-role="${r.id}" data-field="rampUp" value="${ld.rampUp}"></div>
                <div><input type="number" min="0" step="1" class="t-rl" data-role="${r.id}" data-field="rampDown" value="${ld.rampDown}"></div>
              `;
            }).join('')}
          </div>
        </details>
      </td>
      <td style="text-align:center;display:flex;gap:2px;justify-content:center;padding:4px">
        <button class="btn ghost small t-up" data-idx="${idx}" title="Move up">↑</button>
        <button class="btn ghost small t-down" data-idx="${idx}" title="Move down">↓</button>
        <button class="btn danger small t-del" data-idx="${idx}" title="Delete">×</button>
      </td>
    </tr>
  `;
}

function wireTemplateModal(t) {
  const body = $('#modal-template-body');

  body.querySelectorAll('.t-duration').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      t.phases[idx].duration = Math.max(0, parseInt(inp.value || '0', 10));
    });
  });
  body.querySelectorAll('.t-rl').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      const roleId = inp.dataset.role;
      const field = inp.dataset.field;
      const v = Math.max(0, parseFloat(inp.value || '0'));
      if (!t.phases[idx].loading[roleId]) t.phases[idx].loading[roleId] = defaultLoading(0,0,0);
      t.phases[idx].loading[roleId][field] = v;
    });
  });
  body.querySelectorAll('.t-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i > 0) {
        [t.phases[i-1], t.phases[i]] = [t.phases[i], t.phases[i-1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  body.querySelectorAll('.t-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i < t.phases.length - 1) {
        [t.phases[i+1], t.phases[i]] = [t.phases[i], t.phases[i+1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  body.querySelectorAll('.t-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (!confirm(`Remove phase ${i+1}?`)) return;
      t.phases.splice(i, 1);
      rebuildTemplatePhases(t);
    });
  });

  $('#tf-add-phase').addEventListener('click', () => {
    const phaseId = $('#tf-add-phase-id').value;
    const dur = Math.max(1, parseInt($('#tf-add-phase-dur').value || '1', 10));
    t.phases.push({ phaseId, duration: dur, loading: buildLoad({}) });
    rebuildTemplatePhases(t);
  });
}

function rebuildTemplatePhases(t) {
  const tbody = $('#tpl-phases-body');
  tbody.innerHTML = t.phases.map((ph, idx) => renderTemplatePhaseRow(t, ph, idx)).join('');
  // Rewire just the phase-related stuff (keep the add-phase form button wired - that one's outside)
  // Easier to re-call wireTemplateModal but it would double-wire the add button. Instead, re-wire only phase rows.
  $$('#tpl-phases-body .t-duration').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      t.phases[idx].duration = Math.max(0, parseInt(inp.value || '0', 10));
    });
  });
  $$('#tpl-phases-body .t-rl').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const idx = parseInt(tr.dataset.phaseIdx, 10);
      const roleId = inp.dataset.role;
      const field = inp.dataset.field;
      const v = Math.max(0, parseFloat(inp.value || '0'));
      if (!t.phases[idx].loading[roleId]) t.phases[idx].loading[roleId] = defaultLoading(0,0,0);
      t.phases[idx].loading[roleId][field] = v;
    });
  });
  $$('#tpl-phases-body .t-up').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i > 0) {
        [t.phases[i-1], t.phases[i]] = [t.phases[i], t.phases[i-1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  $$('#tpl-phases-body .t-down').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i < t.phases.length - 1) {
        [t.phases[i+1], t.phases[i]] = [t.phases[i], t.phases[i+1]];
        rebuildTemplatePhases(t);
      }
    });
  });
  $$('#tpl-phases-body .t-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (!confirm(`Remove phase ${i+1}?`)) return;
      t.phases.splice(i, 1);
      rebuildTemplatePhases(t);
    });
  });
}

function closeTemplateModal() {
  $('#modal-template').classList.remove('open');
  currentTplId = null;
}
$('#modal-template-close').addEventListener('click', closeTemplateModal);
$('#modal-template-cancel').addEventListener('click', closeTemplateModal);
