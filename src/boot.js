/* ============================================================
   TSI RESOURCE BURDEN PLANNER · v2
   Single-file HTML app. State persisted to localStorage.
   ============================================================ */

import { monthKey, parseMonth, monthLabel, addMonths, monthsBetween } from './util/dates.js';
import { fmtMoney, winProbStageLabel, winProbColor, niceCeil, escapeHtml } from './util/format.js';
import { $, $$, toast, hideTip } from './util/dom.js';
import { PROJECT_COLOR_PALETTE, projectColor } from './util/palette.js';
import { deepCopy, deepCopyMilestones, uid } from './util/clone.js';
import {
  DEFAULT_ROLES, DEFAULT_PHASES, DEFAULT_LOCATIONS, DEFAULT_TEMPLATES,
  DEFAULT_MILESTONE_SCHED, FEED_MILESTONE_SCHED, RETROFIT_MILESTONE_SCHED,
  DEFAULT_COST_SCHED, FEED_COST_SCHED, RETROFIT_COST_SCHED,
  defaultLoading, buildLoad
} from './defaults.js';
import {
  state, setState, STORAGE_KEY,
  horizonMonths, getPhase, getRole, getTemplate, getLocation, getProject,
  saveState, loadState, seedSampleProjects
} from './state.js';
import {
  computeLoadCurve, effectivePhaseDurations, computeAllDemand,
  totalEffectiveDuration, projectStackOrder
} from './compute/demand.js';
import {
  projectPhaseBoundaries, computeProjectCashflow, computePortfolioCashflow
} from './compute/cashflow.js';
import {
  computeProjectConflicts, computeTotalSeries, computeBottleneckSeries
} from './compute/conflicts.js';
import { renderRoles } from './ui/roles-view.js';
import { renderLocations } from './ui/locations-view.js';
import { renderCapacity } from './ui/capacity-view.js';
import { openProjectModal } from './ui/project-editor.js';
import { renderProjects } from './ui/projects-view.js';
import { renderTemplates } from './ui/templates-view.js';



/* ============================================================
   UI WIRING
   ============================================================ */

/* ---------- Tab switching ---------- */
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const v = tab.dataset.view;
    $$('.view').forEach(view => view.classList.remove('active'));
    $('#view-'+v).classList.add('active');
    if (v === 'projects')  renderProjects();
    if (v === 'capacity')  renderCapacity();
    if (v === 'gantt')     renderGantt();
    if (v === 'histogram') renderHistogram();
    if (v === 'capvdem')   renderCapVDem();
    if (v === 'templates') renderTemplates();
    if (v === 'locations') renderLocations();
    if (v === 'roles')     renderRoles();
  });
});

/* ---------- Export / Import / Reset ---------- */
$('#btn-export').addEventListener('click', () => {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tsi_resource_plan_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported plan to JSON');
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const obj = JSON.parse(ev.target.result);
      setState(obj);
      if (!state.locations) state.locations = deepCopy(DEFAULT_LOCATIONS);
      for (const p of state.projects) {
        if (!p.locationId) p.locationId = 'us';
        if (p.contractValue == null) {
          const tpl = getTemplate(p.templateId);
          p.contractValue = (tpl && tpl.defaultContractValue) || 0;
        }
        if (!p.billingMode) p.billingMode = 'milestone';
        if (!p.milestones) {
          const tpl = getTemplate(p.templateId);
          p.milestones = deepCopyMilestones((tpl && tpl.milestones) || DEFAULT_MILESTONE_SCHED);
        }
        if (!p.costLines) {
          const tpl = getTemplate(p.templateId);
          p.costLines = deepCopyMilestones((tpl && tpl.costLines) || DEFAULT_COST_SCHED);
        }
        if (p.pinned == null) p.pinned = false;
        if (p.winProbability == null) p.winProbability = 100;
      }
      saveState();
      renderAll();
      toast('Imported plan');
    } catch (err) {
      alert('Import failed: invalid JSON');
    }
  };
  reader.readAsText(f);
  e.target.value = '';
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Reset to TSI defaults? All projects and capacity entries will be cleared.')) return;
  localStorage.removeItem(STORAGE_KEY);
  setState({
    startMonth: monthKey(new Date()),
    roles: deepCopy(DEFAULT_ROLES),
    phases: deepCopy(DEFAULT_PHASES),
    templates: deepCopy(DEFAULT_TEMPLATES),
    locations: deepCopy(DEFAULT_LOCATIONS),
    projects: [],
    capacity: {}
  });
  seedSampleProjects();
  saveState();
  renderAll();
  toast('Reset to defaults');
});

$('#btn-new-project').addEventListener('click', () => openProjectModal(null));

/* ============================================================
   CAPACITY VIEW
   ============================================================ */

$('#btn-cap-fill').addEventListener('click', () => {
  for (const r of state.roles) {
    const arr = state.capacity[r.id] || new Array(36).fill(0);
    const firstIdx = arr.findIndex(v => v > 0);
    if (firstIdx >= 0) {
      const v = arr[firstIdx];
      for (let i = firstIdx + 1; i < 36; i++) arr[i] = v;
    }
    state.capacity[r.id] = arr;
  }
  saveState();
  renderCapacity();
  toast('Capacity filled right from first non-zero');
});

$('#btn-cap-zero').addEventListener('click', () => {
  if (!confirm('Zero all capacity entries?')) return;
  for (const r of state.roles) state.capacity[r.id] = new Array(36).fill(0);
  saveState(); renderCapacity();
});

/* ============================================================
   GANTT VIEW
   ============================================================ */

/* Gantt visible-range state */
let _ganttRange = { sIdx: 0, eIdx: 35 };

function renderGantt() {
  const wrap = $('#gantt-wrap');
  const colW = parseInt($('#gantt-zoom').value, 10);
  const labelW = 260;
  const rowH = 36;
  const headerH = 56;
  const sIdx = _ganttRange.sIdx;
  const eIdx = _ganttRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const horizon = horizonMonths();
  const projects = state.projects;
  const height = headerH + projects.length * rowH + 30;
  const width = labelW + visN * colW;

  // Brand colors
  const DEEP_BLUE = '#19446C';
  const TEAL = '#00929F';
  const WARM_WHITE = '#FAF8F4';
  const CHARCOAL = '#404040';
  const CORAL = '#C05234';
  const LINE = '#E5E1D6';

  // Helper: month idx to x position (visible-space)
  const xAt = (i) => labelW + (i - sIdx) * colW;

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  // Header: years bar
  let lastYear = null, yearStartX = labelW;
  for (let i = sIdx; i <= eIdx + 1; i++) {
    const d = i <= eIdx ? parseMonth(horizon[i]) : null;
    const y = d ? d.getFullYear() : null;
    if (y !== lastYear || i > eIdx) {
      if (lastYear !== null) {
        const x = xAt(i);
        svg += `<rect x="${yearStartX}" y="0" width="${x - yearStartX}" height="24" fill="${DEEP_BLUE}" stroke="#fff" stroke-width="1"/>`;
        svg += `<text x="${yearStartX + 10}" y="17" fill="${WARM_WHITE}" font-size="12" font-family="Inter" font-weight="700" letter-spacing="1.5">${lastYear}</text>`;
      }
      yearStartX = xAt(i);
      lastYear = y;
    }
  }
  // Months
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    const isYrStart = d.getMonth() === 0;
    svg += `<rect x="${x}" y="24" width="${colW}" height="32" fill="${(i-sIdx)%2?WARM_WHITE:'#fff'}" stroke="${LINE}"/>`;
    svg += `<text x="${x + colW/2}" y="44" text-anchor="middle" fill="${CHARCOAL}" font-size="10" font-family="Inter" font-weight="500">${mNames[d.getMonth()]}</text>`;
    if (isYrStart && i > sIdx) {
      svg += `<line x1="${x}" y1="24" x2="${x}" y2="${height}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
    }
  }

  // Label column header
  svg += `<rect x="0" y="0" width="${labelW}" height="${headerH}" fill="${DEEP_BLUE}"/>`;
  svg += `<text x="16" y="20" fill="${TEAL}" font-size="10" font-family="Inter" font-weight="700" letter-spacing="1.5">PROJECT</text>`;
  svg += `<text x="16" y="44" fill="${WARM_WHITE}" font-size="13" font-family="DM Serif Display" font-weight="400">Portfolio Timeline</text>`;

  // Row backgrounds and gridlines
  for (let r = 0; r < projects.length; r++) {
    const y = headerH + r * rowH;
    svg += `<rect x="0" y="${y}" width="${labelW}" height="${rowH}" fill="${r%2?WARM_WHITE:'#fff'}"/>`;
    svg += `<line x1="0" y1="${y + rowH}" x2="${width}" y2="${y + rowH}" stroke="${LINE}"/>`;
  }
  // Vertical month grid
  for (let i = sIdx; i <= eIdx + 1; i++) {
    const x = xAt(i);
    svg += `<line x1="${x}" y1="${headerH}" x2="${x}" y2="${headerH + projects.length * rowH}" stroke="#F2EFE4"/>`;
  }

  // Today line
  const todayIdx = monthsBetween(state.startMonth, monthKey(new Date()));
  if (todayIdx >= sIdx && todayIdx <= eIdx) {
    const x = xAt(todayIdx) + colW/2;
    svg += `<line x1="${x}" y1="${24}" x2="${x}" y2="${height-30}" stroke="${CORAL}" stroke-width="2" stroke-dasharray="4 3"/>`;
    svg += `<text x="${x}" y="${height-12}" text-anchor="middle" font-size="10" fill="${CORAL}" font-family="Inter" font-weight="700" letter-spacing="0.5">TODAY</text>`;
  }

  // Bars
  projects.forEach((p, pi) => {
    const y = headerH + pi * rowH;
    const truncName = p.name.length > 30 ? p.name.slice(0,28) + '…' : p.name;
    const loc = getLocation(p.locationId);
    const locTag = loc && loc.multiplier !== 1.0 ? ` · ${loc.multiplier.toFixed(2)}×` : '';
    // Pinned indicator (lock glyph)
    const pinX = labelW - 18;
    if (p.pinned) {
      svg += `<text class="gantt-pin" data-proj="${p.id}" x="${pinX}" y="${y+22}" font-size="14" fill="${CORAL}" font-weight="700" style="cursor:pointer">🔒</text>`;
    } else {
      svg += `<text class="gantt-pin" data-proj="${p.id}" x="${pinX}" y="${y+22}" font-size="14" fill="${CHARCOAL}" opacity="0.25" style="cursor:pointer">🔓</text>`;
    }
    // Win probability pill (left of lock icon)
    const wp = (p.winProbability != null) ? p.winProbability : 100;
    const wpColor = winProbColor(wp);
    const pillW = 38;
    const pillX = pinX - pillW - 6;
    svg += `<rect x="${pillX}" y="${y+10}" width="${pillW}" height="16" rx="8" fill="${wpColor}" opacity="${wp >= 100 ? 1.0 : 0.85}"/>`;
    svg += `<text x="${pillX + pillW/2}" y="${y+22}" text-anchor="middle" font-size="10" font-family="Inter" fill="#fff" font-weight="700">${wp}%</text>`;
    svg += `<text x="14" y="${y+15}" font-size="12" font-family="Inter" font-weight="600" fill="${DEEP_BLUE}">${escapeHtml(truncName)}</text>`;
    svg += `<text x="14" y="${y+29}" font-size="10" font-family="Inter" fill="${CHARCOAL}">${escapeHtml(p.client||'')}${escapeHtml(locTag)}</text>`;
    // Transparent drag handle covering the label area (so users can grab any part of the row)
    svg += `<rect class="gantt-bar gantt-bar-handle" data-proj="${p.id}" data-phase="_label" data-start="${p.startMonth}" data-dur="0" data-basedur="0" x="0" y="${y+2}" width="${labelW - 24}" height="${rowH - 4}" fill="transparent" style="cursor:${p.pinned ? 'not-allowed' : 'grab'}"/>`;

    let cursor = p.startMonth;
    const effDurs = effectivePhaseDurations(p);
    p.phases.forEach((ph, phIdx) => {
      const N_phase = effDurs[phIdx];
      const startIdx = monthsBetween(state.startMonth, cursor);
      const endIdx = startIdx + N_phase;
      const phMeta = getPhase(ph.phaseId);
      const color = phMeta ? phMeta.color : '#888';
      const visStart = Math.max(sIdx, startIdx);
      const visEnd = Math.min(eIdx + 1, endIdx);
      if (visEnd > visStart) {
        const x = xAt(visStart);
        const w = (visEnd - visStart) * colW;
        const barY = y + 6;
        const barH = rowH - 12;
        svg += `<rect class="gantt-bar" data-proj="${p.id}" data-phase="${ph.phaseId}" data-start="${cursor}" data-dur="${N_phase}" data-basedur="${ph.duration}" x="${x}" y="${barY}" width="${w}" height="${barH}" fill="${color}" stroke="${DEEP_BLUE}" stroke-width="0.5" rx="1.5"/>`;
        if (w > 70) {
          const phName = phMeta?phMeta.name:ph.phaseId;
          svg += `<text x="${x+10}" y="${barY + barH/2 + 4}" font-size="10" font-family="Inter" fill="#fff" font-weight="600">${escapeHtml(phName)} · ${N_phase}mo</text>`;
        } else if (w > 30) {
          svg += `<text x="${x + w/2}" y="${barY + barH/2 + 4}" text-anchor="middle" font-size="10" font-family="Inter" fill="#fff" font-weight="600">${N_phase}</text>`;
        }
      }
      cursor = addMonths(cursor, N_phase);
    });
  });

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}" stroke-width="1"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  // Compute conflict map (which projects have phases over capacity)
  const conflicts = computeProjectConflicts();

  // Add a conflict ring overlay for phases inside conflicting months
  wrap.querySelectorAll('.gantt-bar').forEach(bar => {
    if (bar.classList.contains('gantt-bar-handle')) return; // skip the transparent label handle
    const projId = bar.dataset.proj;
    const start = bar.dataset.start;
    const dur = parseInt(bar.dataset.dur, 10);
    const startMi = monthsBetween(state.startMonth, start);
    let hasConflict = false;
    for (let k = 0; k < dur; k++) {
      if (conflicts[startMi + k]) { hasConflict = true; break; }
    }
    if (hasConflict) {
      bar.setAttribute('stroke', '#C05234');
      bar.setAttribute('stroke-width', '2.5');
    }
  });

  // Hook up drag (per project — dragging shifts startMonth horizontally OR reorders vertically)
  wireGanttDrag(wrap, colW, sIdx, rowH, headerH);

  // Pin toggle
  wrap.querySelectorAll('.gantt-pin').forEach(p => {
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      const proj = getProject(p.dataset.proj);
      if (!proj) return;
      proj.pinned = !proj.pinned;
      saveState();
      renderGantt();
      toast(`${proj.name}: ${proj.pinned ? 'locked' : 'unlocked'}`);
    });
  });

  renderGanttLegend();
  // Render companion charts (resources + cashflow) below the Gantt
  renderGanttResources();
  renderGanttCashflow();
}

/* ---------- Gantt drag (shift horizontally / reorder vertically) ---------- */
let _ganttDragState = null;
let _ganttGlobalListenersAttached = false;

function wireGanttDrag(wrap, colW, sIdx, rowH, headerH) {
  const bars = Array.from(wrap.querySelectorAll('.gantt-bar'));
  bars.forEach(bar => {
    bar.addEventListener('mouseenter', () => {
      const proj = getProject(bar.dataset.proj);
      bar.style.cursor = (proj && proj.pinned) ? 'not-allowed' : 'grab';
    });
    bar.addEventListener('mousemove', (e) => {
      if (!_ganttDragState) showGanttTip(e, bar);
    });
    bar.addEventListener('mouseleave', () => {
      if (!_ganttDragState) hideTip();
    });

    bar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const projId = bar.dataset.proj;
      const proj = getProject(projId);
      if (!proj) return;
      if (proj.pinned) return;
      const projIdx = state.projects.findIndex(p => p.id === projId);
      _ganttDragState = {
        projId,
        projIdx,
        origStartMonth: proj.startMonth,
        downX: e.clientX,
        downY: e.clientY,
        colW,
        rowH,
        headerH,
        sIdx,
        moved: false,
        mode: null,          // 'shift' | 'reorder' — locked once threshold crossed
        deltaMonths: 0,
        targetIdx: projIdx,  // for reorder
        wrapEl: wrap
      };
      bar.style.cursor = 'grabbing';
      hideTip();
      const projBars = bars.filter(b => b.dataset.proj === projId);
      _ganttDragState.projBars = projBars;
      projBars.forEach(b => b.setAttribute('opacity', '0.5'));
    });
  });

  if (!_ganttGlobalListenersAttached) {
    document.addEventListener('mousemove', onGanttMouseMove);
    document.addEventListener('mouseup', onGanttMouseUp);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _ganttDragState) {
        cancelGanttDrag();
      }
    });
    _ganttGlobalListenersAttached = true;
  }
}

function cancelGanttDrag() {
  if (!_ganttDragState) return;
  const ds = _ganttDragState;
  _ganttDragState = null;
  hideTip();
  ds.projBars.forEach(b => {
    b.setAttribute('opacity', '1.0');
    b.removeAttribute('transform');
  });
  // Also remove any drop-indicator we drew
  const di = document.getElementById('gantt-drop-indicator');
  if (di) di.remove();
}

function onGanttMouseMove(e) {
  if (!_ganttDragState) return;
  const ds = _ganttDragState;
  const dx = e.clientX - ds.downX;
  const dy = e.clientY - ds.downY;

  // Decide mode if not yet locked
  if (!ds.mode) {
    const TH = 6;
    if (Math.abs(dx) > TH || Math.abs(dy) > TH) {
      ds.mode = (Math.abs(dy) > Math.abs(dx)) ? 'reorder' : 'shift';
      ds.moved = true;
    } else {
      return;
    }
  }

  if (ds.mode === 'shift') {
    const deltaMonths = Math.round(dx / ds.colW);
    if (deltaMonths !== ds.deltaMonths) {
      ds.deltaMonths = deltaMonths;
      ds.projBars.forEach(b => {
        b.setAttribute('transform', `translate(${deltaMonths * ds.colW},0)`);
      });
    }
    const newStart = addMonths(ds.origStartMonth, ds.deltaMonths);
    const tip = $('#tooltip');
    tip.innerHTML = `
      <div><strong>${escapeHtml(getProject(ds.projId).name)}</strong></div>
      <div style="font-size:10px;color:#aaa;margin-bottom:6px">↔ shift mode</div>
      <div class="tooltip-row"><span>New start</span><span>${monthLabel(newStart)}</span></div>
      <div class="tooltip-row"><span>Shift</span><span>${ds.deltaMonths >= 0 ? '+' : ''}${ds.deltaMonths} mo</span></div>
      <div style="font-size:10px;color:#aaa;margin-top:4px">Release to apply · Esc to cancel</div>
    `;
    tip.style.display = 'block';
    tip.style.left = (e.pageX + 14) + 'px';
    tip.style.top = (e.pageY + 14) + 'px';
    return;
  }

  // REORDER MODE
  // Vertical translate
  ds.projBars.forEach(b => {
    b.setAttribute('transform', `translate(0,${dy})`);
    b.setAttribute('opacity', '0.7');
  });

  // Figure out which row index we'd land at
  const fromIdx = ds.projIdx;
  const proposedIdx = Math.max(0, Math.min(state.projects.length - 1,
    Math.round(fromIdx + dy / ds.rowH)));
  ds.targetIdx = proposedIdx;

  // Draw a drop-indicator line
  let di = document.getElementById('gantt-drop-indicator');
  if (!di) {
    // SVG line element — locate the SVG root
    const svg = ds.wrapEl.querySelector('svg');
    if (svg) {
      const ns = 'http://www.w3.org/2000/svg';
      di = document.createElementNS(ns, 'line');
      di.setAttribute('id', 'gantt-drop-indicator');
      di.setAttribute('stroke', '#00929F');
      di.setAttribute('stroke-width', '3');
      di.setAttribute('stroke-dasharray', '4 2');
      di.setAttribute('pointer-events', 'none');
      svg.appendChild(di);
    }
  }
  if (di) {
    // Place the line at the boundary between rows
    // If dragging down: indicator goes below proposed target. If up: above.
    const insertY = ds.headerH + proposedIdx * ds.rowH + (proposedIdx > fromIdx ? ds.rowH : 0);
    const svg = ds.wrapEl.querySelector('svg');
    const svgWidth = parseFloat(svg.getAttribute('width'));
    di.setAttribute('x1', 0);
    di.setAttribute('x2', svgWidth);
    di.setAttribute('y1', insertY);
    di.setAttribute('y2', insertY);
  }

  const tip = $('#tooltip');
  const targetProj = state.projects[proposedIdx];
  tip.innerHTML = `
    <div><strong>${escapeHtml(getProject(ds.projId).name)}</strong></div>
    <div style="font-size:10px;color:#aaa;margin-bottom:6px">↕ reorder mode</div>
    <div class="tooltip-row"><span>From row</span><span>#${fromIdx + 1}</span></div>
    <div class="tooltip-row"><span>To row</span><span>#${proposedIdx + 1}</span></div>
    ${targetProj && targetProj.id !== ds.projId ? `<div class="tooltip-row"><span>${proposedIdx > fromIdx ? 'After' : 'Before'}</span><span>${escapeHtml(targetProj.name.length > 24 ? targetProj.name.slice(0,22)+'…' : targetProj.name)}</span></div>` : ''}
    <div style="font-size:10px;color:#aaa;margin-top:4px">Release to apply · Esc to cancel</div>
  `;
  tip.style.display = 'block';
  tip.style.left = (e.pageX + 14) + 'px';
  tip.style.top = (e.pageY + 14) + 'px';
}

function onGanttMouseUp(e) {
  if (!_ganttDragState) return;
  const ds = _ganttDragState;
  _ganttDragState = null;
  hideTip();
  ds.projBars.forEach(b => {
    b.setAttribute('opacity', '1.0');
    b.removeAttribute('transform');
    b.style.cursor = 'grab';
  });
  const di = document.getElementById('gantt-drop-indicator');
  if (di) di.remove();

  // Treat as click → open editor
  if (!ds.moved) {
    openProjectModal(ds.projId);
    return;
  }
  if (ds.mode === 'shift') {
    if (ds.deltaMonths === 0) { openProjectModal(ds.projId); return; }
    const proj = getProject(ds.projId);
    if (!proj) return;
    proj.startMonth = addMonths(ds.origStartMonth, ds.deltaMonths);
    saveState();
    renderAll();
    toast(`${proj.name}: shifted to ${monthLabel(proj.startMonth)}`);
    return;
  }
  if (ds.mode === 'reorder') {
    if (ds.targetIdx === ds.projIdx) return;
    // Move project from projIdx → targetIdx
    const [moved] = state.projects.splice(ds.projIdx, 1);
    state.projects.splice(ds.targetIdx, 0, moved);
    saveState();
    renderAll();
    toast(`${moved.name}: moved to position #${ds.targetIdx + 1}`);
    return;
  }
}

// (Esc cancel handled in wireGanttDrag's global listeners)

function showGanttTip(e, bar) {
  if (bar.classList.contains('gantt-bar-handle')) {
    // Just show a simple "drag to shift" hint for the row handle
    const tip = $('#tooltip');
    const proj = getProject(bar.dataset.proj);
    if (!proj) return;
    const wp = proj.winProbability != null ? proj.winProbability : 100;
    tip.innerHTML = `
      <div><strong>${escapeHtml(proj.name)}</strong>${proj.pinned ? ' 🔒' : ''}</div>
      <div style="font-size:10px;color:#aaa;margin-top:4px">${proj.pinned ? '🔒 Locked — click lock icon to unlock' : '↔ drag horizontally to shift start · ↕ drag vertically to reorder · click for editor · click lock to pin'}</div>
      ${proj.contractValue ? `<div class="tooltip-row" style="margin-top:6px"><span>Contract / weighted</span><span>${fmtMoney(proj.contractValue,{compact:true})} / ${fmtMoney(proj.contractValue*wp/100,{compact:true})}</span></div>` : ''}
      <div class="tooltip-row" style="color:${winProbColor(wp)}"><span>Win probability</span><span>${wp}%</span></div>
    `;
    tip.style.display = 'block';
    tip.style.left = (e.pageX + 14) + 'px';
    tip.style.top = (e.pageY + 14) + 'px';
    return;
  }
  const tip = $('#tooltip');
  const proj = getProject(bar.dataset.proj);
  const ph = getPhase(bar.dataset.phase);
  const start = bar.dataset.start;
  const dur = parseInt(bar.dataset.dur, 10);
  const baseDur = parseInt(bar.dataset.basedur, 10);
  const end = addMonths(start, dur);
  const loc = getLocation(proj.locationId);
  const wp = proj.winProbability != null ? proj.winProbability : 100;
  tip.innerHTML = `
    <div><strong>${escapeHtml(proj.name)}</strong>${proj.pinned ? ' 🔒' : ''}</div>
    <div style="font-size:10px;color:#aaa;margin-bottom:6px">${escapeHtml(proj.client||'')} · ${loc?escapeHtml(loc.name):''}</div>
    <div class="tooltip-row"><span>Phase</span><span>${escapeHtml(ph.name)}</span></div>
    <div class="tooltip-row"><span>Window</span><span>${monthLabel(start)} → ${monthLabel(end)}</span></div>
    <div class="tooltip-row"><span>Base / Effective</span><span>${baseDur} → ${dur} mo</span></div>
    ${loc && loc.multiplier !== 1.0 ? `<div class="tooltip-row"><span>Multiplier</span><span>${loc.multiplier.toFixed(2)}×</span></div>` : ''}
    <div class="tooltip-row" style="color:${winProbColor(wp)}"><span>Win probability</span><span>${wp}%</span></div>
    ${proj.contractValue ? `<div class="tooltip-row"><span>Contract / risk-weighted</span><span>${fmtMoney(proj.contractValue,{compact:true})} / ${fmtMoney(proj.contractValue*wp/100,{compact:true})}</span></div>` : ''}
    <div style="font-size:10px;color:#aaa;margin-top:6px">Drag to shift · click for editor · drag label vertically to reorder</div>
  `;
  tip.style.display = 'block';
  tip.style.left = (e.pageX + 14) + 'px';
  tip.style.top = (e.pageY + 14) + 'px';
}

function renderGanttLegend() {
  const leg = $('#gantt-legend');
  // Only show phases actually in use
  const usedPhases = new Set();
  for (const p of state.projects) for (const ph of p.phases) usedPhases.add(ph.phaseId);
  leg.innerHTML = state.phases.filter(p => usedPhases.has(p.id)).map(p =>
    `<div class="legend-item"><span class="legend-swatch" style="background:${p.color}"></span>${escapeHtml(p.name)}</div>`
  ).join('');
}

/* ---------- Collapse state for Gantt companion charts ---------- */
let _ganttResourcesCollapsed = false;
let _ganttCashflowCollapsed = false;
let _ganttResourcesMode = 'project';  // 'project' | 'role'
let _ganttResourcesWeighted = false;
let _ganttCashflowMode = 'project';   // 'project' | 'total'
let _ganttCashflowWeighted = false;

/* ---------- Gantt companion: Portfolio Resources (stacked by project) ---------- */
function renderGanttResources() {
  const wrap = $('#gantt-resources-wrap');
  const leg = $('#gantt-resources-legend');
  if (!wrap || _ganttResourcesCollapsed) return;
  const { projectDemand, projectTotal, demand, totalDemand, totalCap } = computeTotalSeries();
  const horizon = horizonMonths();
  const sIdx = _ganttRange.sIdx, eIdx = _ganttRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 70;
  const padTop = 28;
  const chartH = 200;
  const padBottom = 36;
  const width = labelW + visN * colW + 24;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234';

  // Compute weighted versions if needed
  const weighted = _ganttResourcesWeighted;
  const wp = (pId) => {
    const p = getProject(pId);
    if (!p) return 1;
    const w = (p.winProbability != null ? p.winProbability : 100) / 100;
    return w;
  };

  // Per-project weighted demand
  const pTotal = {};      // per-project per-month total FTE
  const pByRole = {};     // per-role weighted demand
  for (const r of state.roles) pByRole[r.id] = new Array(36).fill(0);
  for (const p of state.projects) {
    const w = weighted ? wp(p.id) : 1;
    pTotal[p.id] = new Array(36);
    for (let i = 0; i < 36; i++) pTotal[p.id][i] = projectTotal[p.id][i] * w;
    for (const r of state.roles) {
      const projDemR = projectDemand[p.id][r.id];
      for (let i = 0; i < 36; i++) pByRole[r.id][i] += projDemR[i] * w;
    }
  }
  // Stack totals & maxes
  let maxStack = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    let s = 0;
    for (const p of state.projects) s += pTotal[p.id][i];
    if (s > maxStack) maxStack = s;
    if (totalCap[i] > maxStack) maxStack = totalCap[i];
  }
  if (maxStack === 0) maxStack = 1;
  const yMax = Math.ceil(maxStack * 1.1);

  // Update subtitle
  const subtitle = $('#gantt-resources-subtitle');
  if (subtitle) {
    const modeLabel = _ganttResourcesMode === 'project' ? 'stacked by project' : 'stacked by role';
    subtitle.textContent = modeLabel + (weighted ? ' (× win prob)' : '');
  }

  const orderedProjects = projectStackOrder();

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  const yTicks = 4;
  for (let t = 0; t <= yTicks; t++) {
    const v = yMax * t / yTicks;
    const y = padTop + chartH - (v / yMax) * chartH;
    svg += `<line x1="${labelW}" y1="${y}" x2="${width-20}" y2="${y}" stroke="${t===0?DEEP_BLUE:LINE}" stroke-width="${t===0?1.5:1}"/>`;
    svg += `<text x="${labelW - 10}" y="${y+4}" text-anchor="end" font-size="10" font-family="Inter" fill="${CHARCOAL}">${v.toFixed(1)}</text>`;
  }
  svg += `<text x="${labelW - 10}" y="${padTop - 6}" text-anchor="end" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">FTE</text>`;

  // Excess shading vs capacity
  for (let i = sIdx; i <= eIdx; i++) {
    let stack = 0;
    for (const p of state.projects) stack += pTotal[p.id][i];
    const cap = totalCap[i];
    if (stack > cap && cap >= 0) {
      const x = xAt(i);
      const yStack = padTop + chartH - (stack / yMax) * chartH;
      const yCap = padTop + chartH - (cap / yMax) * chartH;
      svg += `<rect x="${x+1}" y="${yStack}" width="${colW-2}" height="${yCap - yStack}" fill="${CORAL}" fill-opacity="0.20"/>`;
    }
  }

  // Year separators / month labels
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = visN <= 18 ? 1 : (visN <= 24 ? 2 : 3);
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1.2"/>`;
      svg += `<text x="${x+5}" y="${padTop - 6}" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if ((i - sIdx) % labelEvery === 0) {
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 14}" text-anchor="middle" font-size="9" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  const barW = Math.max(6, colW - 6);

  if (_ganttResourcesMode === 'project') {
    // Stacked bars by project (longest first)
    for (let i = sIdx; i <= eIdx; i++) {
      let yCursor = padTop + chartH;
      for (const proj of orderedProjects) {
        const v = pTotal[proj.id][i];
        const segH = (v / yMax) * chartH;
        if (segH > 0) {
          const c = projectColor(proj.id);
          svg += `<rect class="gantt-res-bar" data-midx="${i}" data-proj="${proj.id}" x="${xAt(i) + 3}" y="${yCursor - segH}" width="${barW}" height="${segH}" fill="${c}" stroke="#ffffff" stroke-width="0.5"/>`;
          yCursor -= segH;
        }
      }
    }
  } else {
    // Stacked bars by role
    for (let i = sIdx; i <= eIdx; i++) {
      let yCursor = padTop + chartH;
      for (const r of state.roles) {
        const v = pByRole[r.id][i];
        const segH = (v / yMax) * chartH;
        if (segH > 0) {
          svg += `<rect class="gantt-res-bar-role" data-midx="${i}" data-role="${r.id}" x="${xAt(i) + 3}" y="${yCursor - segH}" width="${barW}" height="${segH}" fill="${r.color}" stroke="#ffffff" stroke-width="0.5"/>`;
          yCursor -= segH;
        }
      }
    }
  }

  // Capacity step line
  let pathD = '';
  for (let i = sIdx; i <= eIdx; i++) {
    const x1 = xAt(i);
    const x2 = x1 + colW;
    const y = padTop + chartH - (totalCap[i] / yMax) * chartH;
    if (i === sIdx) pathD += `M ${x1} ${y}`;
    else pathD += ` L ${x1} ${y}`;
    pathD += ` L ${x2} ${y}`;
  }
  svg += `<path d="${pathD}" fill="none" stroke="${CORAL}" stroke-width="2" stroke-dasharray="6 3"/>`;

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  // Legend
  if (leg) {
    if (_ganttResourcesMode === 'project') {
      leg.innerHTML = orderedProjects.map(p => {
        const w = p.winProbability != null ? p.winProbability : 100;
        return `<div class="legend-item" data-proj="${p.id}" style="cursor:pointer"><span class="legend-swatch" style="background:${projectColor(p.id)}"></span>${escapeHtml(p.name)}<span style="color:var(--ink-mute);font-size:10px;margin-left:4px">${weighted ? '×'+w+'%' : ''}</span></div>`;
      }).join('') + `<div class="legend-item"><span class="legend-swatch" style="background:${CORAL};border-style:dashed"></span>Capacity</div>`;
      leg.querySelectorAll('[data-proj]').forEach(el => el.addEventListener('click', () => openProjectDetailModal(el.dataset.proj)));
    } else {
      leg.innerHTML = state.roles.map(r =>
        `<div class="legend-item"><span class="legend-swatch" style="background:${r.color}"></span>${escapeHtml(r.name)}</div>`
      ).join('') + `<div class="legend-item"><span class="legend-swatch" style="background:${CORAL};border-style:dashed"></span>Capacity</div>`;
    }
  }

  // Tooltips
  wrap.querySelectorAll('.gantt-res-bar').forEach(b => {
    b.style.cursor = 'pointer';
    b.addEventListener('click', () => openProjectDetailModal(b.dataset.proj));
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const rows = [];
      for (const p of orderedProjects) {
        const v = pTotal[p.id][midx];
        if (v > 0.01) rows.push({ name: p.name, v, c: projectColor(p.id), isCurrent: p.id === b.dataset.proj, wp: p.winProbability != null ? p.winProbability : 100 });
      }
      const tot = rows.reduce((a,r)=>a+r.v, 0);
      const cap = totalCap[midx];
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong>${weighted ? ' · risk-weighted' : ''}</div>
        ${rows.map(rr => `<div class="tooltip-row" style="${rr.isCurrent?'font-weight:600;color:#fff':''}"><span><span style="display:inline-block;width:8px;height:8px;background:${rr.c};margin-right:5px"></span>${escapeHtml(rr.name)}${weighted ? ` (${rr.wp}%)` : ''}</span><span>${rr.v.toFixed(2)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Demand</strong></span><span><strong>${tot.toFixed(2)} FTE</strong></span></div>
        <div class="tooltip-row"><span>Capacity</span><span>${cap.toFixed(1)}</span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });

  wrap.querySelectorAll('.gantt-res-bar-role').forEach(b => {
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const role = getRole(b.dataset.role);
      const rows = [];
      let tot = 0;
      for (const r of state.roles) {
        const v = pByRole[r.id][midx];
        tot += v;
        if (v > 0.01) rows.push({ name: r.name, v, c: r.color });
      }
      const cap = totalCap[midx];
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong>${weighted ? ' · risk-weighted' : ''}</div>
        <div style="font-size:10px;color:#aaa;margin:2px 0 6px">Hover: ${escapeHtml(role.name)}</div>
        ${rows.map(rr => `<div class="tooltip-row"><span><span style="display:inline-block;width:8px;height:8px;background:${rr.c};margin-right:5px"></span>${escapeHtml(rr.name)}</span><span>${rr.v.toFixed(2)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Demand</strong></span><span><strong>${tot.toFixed(2)} FTE</strong></span></div>
        <div class="tooltip-row"><span>Capacity</span><span>${cap.toFixed(1)}</span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });
}

/* ---------- Gantt companion: Portfolio Cashflow (revenue, cost, net per project) ---------- */
function renderGanttCashflow() {
  const wrap = $('#gantt-cashflow-wrap');
  if (!wrap || _ganttCashflowCollapsed) return;
  const cfRaw = computePortfolioCashflow();
  const horizon = horizonMonths();
  const sIdx = _ganttRange.sIdx, eIdx = _ganttRange.eIdx;
  const visN = eIdx - sIdx + 1;
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
  const labelW = 80;
  const padTop = 32;
  const chartH = 220;
  const padBottom = 32;
  const width = labelW + visN * colW + 36;
  const height = padTop + chartH + padBottom;
  const xAt = (i) => labelW + (i - sIdx) * colW;
  const xCenter = (i) => xAt(i) + colW / 2;

  const DEEP_BLUE = '#19446C', CHARCOAL = '#404040', LINE = '#E5E1D6', CORAL = '#C05234', SAGE = '#809848', TEAL = '#00929F', SUCC = '#6E8C34';

  // Build weighted (or unweighted) per-project series + portfolio rollup
  const weighted = _ganttCashflowWeighted;
  const perProject = {};
  const cashIn = new Array(36).fill(0);
  const costOut = new Array(36).fill(0);
  const netCash = new Array(36).fill(0);
  const cumNet = new Array(36).fill(0);
  for (const p of state.projects) {
    const w = weighted ? ((p.winProbability != null ? p.winProbability : 100) / 100) : 1;
    const src = cfRaw.perProject[p.id];
    const ci = new Array(36), co = new Array(36), cc = new Array(36), cco = new Array(36);
    let acc_c = 0, acc_co = 0;
    for (let i = 0; i < 36; i++) {
      ci[i] = src.cashIn[i] * w;
      co[i] = src.costOut[i] * w;
      acc_c += ci[i]; cc[i] = acc_c;
      acc_co += co[i]; cco[i] = acc_co;
      cashIn[i] += ci[i];
      costOut[i] += co[i];
    }
    perProject[p.id] = { cashIn: ci, costOut: co, cumCash: cc, cumCost: cco };
  }
  let acc = 0;
  for (let i = 0; i < 36; i++) {
    netCash[i] = cashIn[i] - costOut[i];
    acc += netCash[i]; cumNet[i] = acc;
  }
  const cf = { cashIn, costOut, netCash, cumNet, perProject };

  // Update subtitle
  const subtitle = $('#gantt-cashflow-subtitle');
  if (subtitle) {
    const modeLabel = _ganttCashflowMode === 'project' ? 'stacked by project (revenue / cost)' : 'total net per month';
    subtitle.textContent = modeLabel + (weighted ? ' · risk-weighted' : '');
  }

  // Y-range calculation depends on mode
  let maxPos = 0, maxNeg = 0;
  if (_ganttCashflowMode === 'project') {
    for (let i = sIdx; i <= eIdx; i++) {
      if (cashIn[i] > maxPos) maxPos = cashIn[i];
      if (costOut[i] > maxNeg) maxNeg = costOut[i];
    }
  } else {
    // Total net mode: positive net stacks above zero, negative net below zero
    for (let i = sIdx; i <= eIdx; i++) {
      if (netCash[i] > maxPos) maxPos = netCash[i];
      if (-netCash[i] > maxNeg) maxNeg = -netCash[i];
    }
  }

  // Cumulative net axis bounds
  let cumMin = 0, cumMax = 0;
  for (let i = sIdx; i <= eIdx; i++) {
    if (cumNet[i] > cumMax) cumMax = cumNet[i];
    if (cumNet[i] < cumMin) cumMin = cumNet[i];
  }

  if (maxPos === 0 && maxNeg === 0) {
    wrap.innerHTML = `<div style="padding:30px;text-align:center;color:var(--gray);font-size:13px">No cashflow data — set contract values and milestones to see this chart.</div>`;
    const leg = $('#gantt-cashflow-legend');
    if (leg) leg.innerHTML = '';
    return;
  }

  const yMaxPos = niceCeil(maxPos > 0 ? maxPos * 1.1 : 1);
  const yMaxNeg = niceCeil(maxNeg > 0 ? maxNeg * 1.1 : 0.0001);
  const totalSpan = yMaxPos + yMaxNeg;
  const y0 = padTop + (yMaxPos / totalSpan) * chartH;
  const yPosFor = (v) => y0 - (v / yMaxPos) * (yMaxPos / totalSpan) * chartH;
  const yNegFor = (v) => y0 + (v / yMaxNeg) * (yMaxNeg / totalSpan) * chartH;

  const cumSpan = Math.max(Math.abs(cumMax), Math.abs(cumMin), 1);
  const yCumMax = niceCeil(cumSpan * 1.1);
  const yCumFor = (v) => {
    if (v >= 0) return y0 - (v / yCumMax) * (yMaxPos / totalSpan) * chartH;
    return y0 + (Math.abs(v) / yCumMax) * (yMaxNeg / totalSpan) * chartH;
  };

  let svg = `<svg class="chart-svg" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  // Zero line
  svg += `<line x1="${labelW}" y1="${y0}" x2="${width - 20}" y2="${y0}" stroke="${DEEP_BLUE}" stroke-width="1.5"/>`;

  // Y-axis labels
  const posTicks = 3, negTicks = 2;
  for (let t = 0; t <= posTicks; t++) {
    const v = yMaxPos * t / posTicks;
    const y = yPosFor(v);
    svg += `<line x1="${labelW}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="${LINE}" stroke-width="${t===0?0:1}" stroke-dasharray="${t===0?'':'2 3'}"/>`;
    svg += `<text x="${labelW - 8}" y="${y+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${CHARCOAL}">${fmtMoney(v, {compact:true})}</text>`;
  }
  for (let t = 1; t <= negTicks; t++) {
    const v = yMaxNeg * t / negTicks;
    const y = yNegFor(v);
    svg += `<line x1="${labelW}" y1="${y}" x2="${width - 20}" y2="${y}" stroke="${LINE}" stroke-dasharray="2 3"/>`;
    svg += `<text x="${labelW - 8}" y="${y+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${CORAL}">−${fmtMoney(v, {compact:true})}</text>`;
  }
  const topLabel = _ganttCashflowMode === 'project' ? '$ in' : '$ net +';
  const botLabel = _ganttCashflowMode === 'project' ? '$ out' : '$ net −';
  svg += `<text x="${labelW - 8}" y="${padTop - 6}" text-anchor="end" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${topLabel}</text>`;
  svg += `<text x="${labelW - 8}" y="${padTop + chartH + 14}" text-anchor="end" font-size="10" font-family="Inter" fill="${CORAL}" font-weight="700">${botLabel}</text>`;

  // Right-axis cumulative net labels
  svg += `<text x="${width - 6}" y="${padTop - 6}" text-anchor="end" font-size="10" font-family="Inter" fill="${TEAL}" font-weight="700">cum net</text>`;
  for (let t = 1; t <= 3; t++) {
    const v = yCumMax * t / 3;
    const yp = yCumFor(v);
    svg += `<text x="${width - 6}" y="${yp+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${TEAL}">${fmtMoney(v, {compact:true})}</text>`;
    if (cumMin < 0) {
      const yn = yCumFor(-v);
      svg += `<text x="${width - 6}" y="${yn+4}" text-anchor="end" font-size="9" font-family="Inter" fill="${TEAL}">−${fmtMoney(v, {compact:true})}</text>`;
    }
  }

  // Year separators / month labels
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labelEvery = visN <= 18 ? 1 : (visN <= 24 ? 2 : 3);
  for (let i = sIdx; i <= eIdx; i++) {
    const d = parseMonth(horizon[i]);
    const x = xAt(i);
    if (d.getMonth() === 0) {
      svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${DEEP_BLUE}" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>`;
      svg += `<text x="${x+4}" y="${padTop - 6}" font-size="10" font-family="Inter" fill="${DEEP_BLUE}" font-weight="700">${d.getFullYear()}</text>`;
    }
    if ((i - sIdx) % labelEvery === 0) {
      svg += `<text x="${x + colW/2}" y="${padTop + chartH + 14}" text-anchor="middle" font-size="9" font-family="Inter" fill="${CHARCOAL}">${mNames[d.getMonth()]}</text>`;
    }
  }

  const orderedProjects = projectStackOrder();
  const barW = Math.max(6, colW - 6);

  if (_ganttCashflowMode === 'project') {
    // Stack revenue above zero and costs below zero, by project
    for (let i = sIdx; i <= eIdx; i++) {
      let posCursor = 0;
      for (const proj of orderedProjects) {
        const v = cf.perProject[proj.id].cashIn[i];
        if (v <= 0) continue;
        const segH = (v / totalSpan) * chartH;
        const yTop = yPosFor(posCursor + v);
        const c = projectColor(proj.id);
        svg += `<rect class="gantt-cf-bar" data-midx="${i}" data-proj="${proj.id}" data-kind="rev" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${c}" stroke="#ffffff" stroke-width="0.5"/>`;
        posCursor += v;
      }
      let negCursor = 0;
      for (const proj of orderedProjects) {
        const v = cf.perProject[proj.id].costOut[i];
        if (v <= 0) continue;
        const segH = (v / totalSpan) * chartH;
        const yTop = yNegFor(negCursor);
        const c = projectColor(proj.id);
        svg += `<rect class="gantt-cf-bar" data-midx="${i}" data-proj="${proj.id}" data-kind="cost" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${c}" fill-opacity="0.85" stroke="${CORAL}" stroke-width="0.8" stroke-dasharray="2 1.5"/>`;
        negCursor += v;
      }
    }
  } else {
    // Total net mode: one bar per month, green when net >= 0, coral when net < 0
    for (let i = sIdx; i <= eIdx; i++) {
      const v = cf.netCash[i];
      if (Math.abs(v) < 0.01) continue;
      if (v >= 0) {
        const segH = (v / totalSpan) * chartH;
        const yTop = yPosFor(v);
        svg += `<rect class="gantt-cf-bar-net" data-midx="${i}" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${SUCC}" stroke="#ffffff" stroke-width="0.5"/>`;
      } else {
        const segH = (Math.abs(v) / totalSpan) * chartH;
        const yTop = y0;
        svg += `<rect class="gantt-cf-bar-net" data-midx="${i}" data-v="${v}" x="${xAt(i) + 3}" y="${yTop}" width="${barW}" height="${segH}" fill="${CORAL}" stroke="#ffffff" stroke-width="0.5"/>`;
      }
    }
  }

  // Cumulative net line (right-axis)
  let cumPath = '';
  for (let i = sIdx; i <= eIdx; i++) {
    const v = cf.cumNet[i];
    const x = xCenter(i);
    const y = yCumFor(v);
    if (i === sIdx) cumPath += `M ${x} ${y}`;
    else cumPath += ` L ${x} ${y}`;
  }
  if (cumPath) svg += `<path d="${cumPath}" fill="none" stroke="${TEAL}" stroke-width="2.5"/>`;

  // Today line
  const todayIdx = monthsBetween(state.startMonth, monthKey(new Date()));
  if (todayIdx >= sIdx && todayIdx <= eIdx) {
    const x = xCenter(todayIdx);
    svg += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${padTop+chartH}" stroke="${CORAL}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.7"/>`;
  }

  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${DEEP_BLUE}"/>`;
  svg += '</svg>';
  wrap.innerHTML = svg;

  // Project-bar tooltips
  wrap.querySelectorAll('.gantt-cf-bar').forEach(b => {
    b.style.cursor = 'pointer';
    b.addEventListener('click', () => openProjectDetailModal(b.dataset.proj));
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const proj = getProject(b.dataset.proj);
      const kind = b.dataset.kind;
      const v = parseFloat(b.dataset.v);
      const cfp = cf.perProject[b.dataset.proj];
      const w = proj.winProbability != null ? proj.winProbability : 100;
      tip.innerHTML = `
        <div><strong>${escapeHtml(proj.name)}</strong>${weighted ? ` <span style="color:${winProbColor(w)}">${w}%</span>` : ''}</div>
        <div style="font-size:10px;color:#aaa;margin-bottom:6px">${monthLabel(horizon[midx], false)}${weighted ? ' · risk-weighted' : ''}</div>
        <div class="tooltip-row"><span>${kind==='rev'?'Revenue (cash in)':'Cost (cash out)'}</span><span>${fmtMoney(v)}</span></div>
        <div class="tooltip-row"><span>Project cum cash</span><span>${fmtMoney(cfp.cumCash[midx])}</span></div>
        <div class="tooltip-row"><span>Project cum cost</span><span>${fmtMoney(cfp.cumCost[midx])}</span></div>
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Portfolio cum net</strong></span><span><strong>${fmtMoney(cf.cumNet[midx])}</strong></span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });

  // Total-net bar tooltips
  wrap.querySelectorAll('.gantt-cf-bar-net').forEach(b => {
    b.addEventListener('mousemove', (e) => {
      const tip = $('#tooltip');
      const midx = parseInt(b.dataset.midx, 10);
      const v = parseFloat(b.dataset.v);
      // Breakdown: per-project revenue and cost contribution this month
      const rows = [];
      for (const p of orderedProjects) {
        const rev = cf.perProject[p.id].cashIn[midx];
        const co = cf.perProject[p.id].costOut[midx];
        const net = rev - co;
        if (Math.abs(net) > 0.01) rows.push({ name: p.name, c: projectColor(p.id), net });
      }
      tip.innerHTML = `
        <div><strong>${monthLabel(horizon[midx], false)}</strong>${weighted ? ' · risk-weighted' : ''}</div>
        <div class="tooltip-row" style="font-weight:600;${v>=0?'color:#A8D9A8':'color:#FFB29A'}"><span>Total net</span><span>${fmtMoney(v)}</span></div>
        <div class="tooltip-row"><span>Revenue this month</span><span>${fmtMoney(cf.cashIn[midx])}</span></div>
        <div class="tooltip-row"><span>Cost this month</span><span>${fmtMoney(cf.costOut[midx])}</span></div>
        ${rows.length > 0 ? '<div style="border-top:1px solid #444;margin-top:5px;padding-top:5px;font-size:10px;color:#aaa">Per-project net contribution:</div>' : ''}
        ${rows.map(r => `<div class="tooltip-row"><span><span style="display:inline-block;width:8px;height:8px;background:${r.c};margin-right:5px"></span>${escapeHtml(r.name)}</span><span style="${r.net >= 0 ? 'color:#A8D9A8' : 'color:#FFB29A'}">${fmtMoney(r.net)}</span></div>`).join('')}
        <div class="tooltip-row" style="border-top:1px solid #444;margin-top:5px;padding-top:5px"><span><strong>Portfolio cum net</strong></span><span><strong>${fmtMoney(cf.cumNet[midx])}</strong></span></div>
      `;
      tip.style.display = 'block';
      tip.style.left = (e.pageX + 14) + 'px';
      tip.style.top = (e.pageY + 14) + 'px';
    });
    b.addEventListener('mouseleave', hideTip);
  });

  // Legend
  const leg = $('#gantt-cashflow-legend');
  if (leg) {
    const totalRev = cf.cashIn.slice(sIdx, eIdx+1).reduce((a,b)=>a+b, 0);
    const totalCost = cf.costOut.slice(sIdx, eIdx+1).reduce((a,b)=>a+b, 0);
    const totalNet = totalRev - totalCost;
    let entries;
    if (_ganttCashflowMode === 'project') {
      entries = `
        <div class="legend-item"><span class="legend-swatch" style="background:${SAGE}"></span>Revenue (above zero)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${CORAL};opacity:0.6"></span>Cost (below zero)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${TEAL}"></span>Cumulative net</div>
      `;
    } else {
      entries = `
        <div class="legend-item"><span class="legend-swatch" style="background:${SUCC}"></span>Net positive month</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${CORAL}"></span>Net negative month</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${TEAL}"></span>Cumulative net</div>
      `;
    }
    leg.innerHTML = entries + `
      <div class="legend-item" style="margin-left:auto;font-family:var(--font-mono);font-weight:600">Visible: ${fmtMoney(totalRev, {compact:true})} rev − ${fmtMoney(totalCost, {compact:true})} cost = <span style="color:${totalNet >= 0 ? 'var(--succ-green)' : 'var(--coral)'}">${fmtMoney(totalNet, {compact:true})}</span> net${weighted ? ' (×wp)' : ''}</div>
    `;
  }
}

/* ---------- Wire Gantt companion collapse + initial render ---------- */
function setGanttCompanionVisible() {
  $('#gantt-resources-body').style.display = _ganttResourcesCollapsed ? 'none' : '';
  $('#gantt-cashflow-body').style.display = _ganttCashflowCollapsed ? 'none' : '';
  $('#gantt-resources-caret').textContent = _ganttResourcesCollapsed ? '▸' : '▾';
  $('#gantt-cashflow-caret').textContent = _ganttCashflowCollapsed ? '▸' : '▾';
}
$('#gantt-resources-header').addEventListener('click', () => {
  _ganttResourcesCollapsed = !_ganttResourcesCollapsed;
  setGanttCompanionVisible();
  if (!_ganttResourcesCollapsed) renderGanttResources();
});
$('#gantt-cashflow-header').addEventListener('click', () => {
  _ganttCashflowCollapsed = !_ganttCashflowCollapsed;
  setGanttCompanionVisible();
  if (!_ganttCashflowCollapsed) renderGanttCashflow();
});

// Resources mode toggle (project / role)
$$('#gantt-resources-mode .hist-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();  // don't bubble up to the panel-header's collapse click
    $$('#gantt-resources-mode .hist-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _ganttResourcesMode = btn.dataset.mode;
    renderGanttResources();
  });
});
// Resources weighting toggle
$('#gantt-resources-weighted').addEventListener('click', (e) => e.stopPropagation());
$('#gantt-resources-weighted').addEventListener('change', (e) => {
  _ganttResourcesWeighted = e.target.checked;
  renderGanttResources();
});

// Cashflow mode toggle (project / total)
$$('#gantt-cashflow-mode .hist-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    $$('#gantt-cashflow-mode .hist-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _ganttCashflowMode = btn.dataset.mode;
    renderGanttCashflow();
  });
});
$('#gantt-cashflow-weighted').addEventListener('click', (e) => e.stopPropagation());
$('#gantt-cashflow-weighted').addEventListener('change', (e) => {
  _ganttCashflowWeighted = e.target.checked;
  renderGanttCashflow();
});

$('#gantt-zoom').addEventListener('change', renderGantt);

// Gantt range sliders
function wireGanttRange() {
  const startInp = $('#gantt-range-start');
  const endInp = $('#gantt-range-end');
  const onRange = () => {
    let s = parseInt(startInp.value, 10);
    let e = parseInt(endInp.value, 10);
    if (s > e) { const t = s; s = e; e = t; }
    if (e - s < 1) e = Math.min(35, s + 1);
    _ganttRange.sIdx = s;
    _ganttRange.eIdx = e;
    renderGantt();
  };
  startInp.addEventListener('input', onRange);
  endInp.addEventListener('input', onRange);
  $('#gantt-range-reset').addEventListener('click', () => {
    _ganttRange.sIdx = 0; _ganttRange.eIdx = 35;
    startInp.value = 0; endInp.value = 35;
    renderGantt();
  });
}
wireGanttRange();

/* ============================================================
   HISTOGRAM VIEW  ·  multi-mode (role / project-bar / project-area)
   ============================================================ */

let histMode = 'role';   // 'role' | 'project-bar' | 'project-area'
let histShowCap = true;
let _histRange = { sIdx: 0, eIdx: 35 };


function renderHistogram() {
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
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
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
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
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
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
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
  const colW = Math.max(22, Math.min(60, Math.floor(900 / visN)));
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

/* ---------- Project detail modal (role breakdown) ---------- */
/* ============================================================
   PROJECT DETAIL MODAL — two stacked charts (Resources + Cashflow)
   with shared x-axis and horizontal zoom.
   ============================================================ */

// Cached so the zoom slider doesn't re-build everything
let _detailProjectId = null;
let _detailZoom = { startIdx: 0, endIdx: 35 };  // inclusive month-idx range visible

function openProjectDetailModal(projectId) {
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

/* ============================================================
   CAP VS DEM VIEW
   ============================================================ */

function renderCapVDem() {
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
  const colW = 34;
  const labelW = 70;
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


/* ============================================================
   LOCATIONS VIEW
   ============================================================ */

$('#btn-new-location').addEventListener('click', () => {
  const name = prompt('Location name?', 'New Location');
  if (!name) return;
  const mult = parseFloat(prompt('Speed multiplier (1.0 = baseline; 0.7 = 30% faster; 1.2 = 20% slower)?', '1.0'));
  if (!mult || mult <= 0) return;
  state.locations.push({ id: uid('loc'), name, multiplier: mult, notes: '' });
  saveState(); renderLocations();
});

/* ============================================================
   ROLES VIEW
   ============================================================ */

$('#btn-new-role').addEventListener('click', () => {
  const name = prompt('Role name?');
  if (!name) return;
  const r = { id: uid('role'), name, abbr: name.slice(0,3).toUpperCase(), color: '#888888' };
  state.roles.push(r);
  state.capacity[r.id] = new Array(36).fill(0);
  for (const t of state.templates) for (const ph of t.phases) ph.loading[r.id] = defaultLoading(0,0,0);
  for (const p of state.projects) for (const ph of p.phases) ph.loading[r.id] = defaultLoading(0,0,0);
  saveState(); renderRoles();
});

/* ============================================================
   HELPERS
   ============================================================ */

export function renderAll() {
  renderProjects();
  // Also re-render whichever view is currently active (Gantt, Histogram, etc.)
  const activeTab = document.querySelector('.tab.active');
  if (!activeTab) return;
  const v = activeTab.dataset.view;
  if (v === 'capacity')  renderCapacity();
  if (v === 'gantt')     renderGantt();
  if (v === 'histogram') renderHistogram();
  if (v === 'capvdem')   renderCapVDem();
  if (v === 'templates') renderTemplates();
  if (v === 'locations') renderLocations();
  if (v === 'roles')     renderRoles();
}

/* ============================================================
   BOOT
   ============================================================ */

if (!loadState()) {
  seedSampleProjects();
  saveState();
} else {
  for (const r of state.roles) {
    if (!state.capacity[r.id]) state.capacity[r.id] = new Array(36).fill(0);
  }
}
renderAll();

window.addEventListener('beforeunload', saveState);

