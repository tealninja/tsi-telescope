/* ============================================================
   Projects view — card grid for the portfolio + KPI row.
   Each card opens the project editor modal; delete is inline.
   KPIs roll up demand and capacity over the visible horizon.
   ============================================================ */

import { $ } from '../util/dom.js';
import { escapeHtml, fmtMoney, winProbColor } from '../util/format.js';
import { addMonths, monthLabel } from '../util/dates.js';
import { state, getTemplate, getLocation, horizonMonths, saveState } from '../state.js';
import { totalEffectiveDuration, computeAllDemand } from '../compute/demand.js';
import { openProjectModal } from './project-editor.js';
import { renderAll } from '../boot.js';

export function renderProjects() {
  const grid = $('#project-grid');
  grid.innerHTML = '';

  for (const p of state.projects) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const tpl = getTemplate(p.templateId);
    const loc = getLocation(p.locationId);
    const effDur = totalEffectiveDuration(p);
    const endMonth = addMonths(p.startMonth, effDur);
    const wp = p.winProbability != null ? p.winProbability : 100;
    const wpColor = winProbColor(wp);
    card.innerHTML = `
      <div class="project-card-actions">
        <button class="btn small danger" data-act="del" data-id="${p.id}">Del</button>
      </div>
      <div class="project-card-tags">
        <span class="tag template">${tpl ? escapeHtml(tpl.name) : 'custom'}</span>
        ${loc ? `<span class="tag location">${escapeHtml(loc.name)}</span>` : ''}
        ${loc && loc.multiplier !== 1.0 ? `<span class="tag multiplier">${loc.multiplier.toFixed(2)}×</span>` : ''}
        <span class="tag" style="background:${wpColor};color:#fff">${wp}% · ${wp >= 100 ? 'booked' : wp >= 85 ? 'awarded' : wp >= 65 ? 'LOI' : wp >= 40 ? 'proposal' : wp >= 20 ? 'qualified' : 'lead'}</span>
        ${p.pinned ? '<span class="tag" style="background:var(--coral);color:#fff">🔒 locked</span>' : ''}
      </div>
      <div class="project-card-name">${escapeHtml(p.name)}</div>
      <div class="project-card-meta">${escapeHtml(p.client || '—')} · ${escapeHtml(p.location || '')}</div>
      <div class="project-card-dates">
        <span>${monthLabel(p.startMonth)}</span>
        <span style="color:var(--teal)">→</span>
        <span>${monthLabel(endMonth)}</span>
        <span style="color:var(--gray)">${effDur} mo</span>
      </div>
      <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:baseline;font-size:11px">
        <span style="color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Contract</span>
        <span class="mono" style="font-weight:600;color:var(--ink-strong)">${fmtMoney(p.contractValue || 0, {compact:true})}</span>
      </div>
      ${wp < 100 ? `
      <div style="margin-top:4px;display:flex;justify-content:space-between;align-items:baseline;font-size:11px">
        <span style="color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em;font-weight:600">Risk-weighted</span>
        <span class="mono" style="font-weight:600;color:${wpColor}">${fmtMoney((p.contractValue||0) * wp / 100, {compact:true})}</span>
      </div>` : ''}
    `;
    card.addEventListener('click', (e) => {
      if (e.target.dataset.act === 'del') {
        e.stopPropagation();
        if (confirm(`Delete project "${p.name}"?`)) {
          state.projects = state.projects.filter(x => x.id !== p.id);
          saveState(); renderAll();
        }
        return;
      }
      openProjectModal(p.id);
    });
    grid.appendChild(card);
  }

  const add = document.createElement('div');
  add.className = 'project-card add';
  add.innerHTML = '<div><div style="font-family:var(--font-display);font-size:32px;line-height:1">+</div><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;margin-top:6px;font-weight:600">New Project</div></div>';
  add.addEventListener('click', () => openProjectModal(null));
  grid.appendChild(add);

  renderKPIs();
}

export function renderKPIs() {
  const row = $('#kpi-row');
  row.innerHTML = '';

  const { demand } = computeAllDemand();
  const horizon = horizonMonths();

  let totalFTEMonths = 0;
  const peakByMonth = new Array(36).fill(0);
  for (const r of state.roles) {
    for (let i = 0; i < 36; i++) {
      totalFTEMonths += demand[r.id][i];
      peakByMonth[i] += demand[r.id][i];
    }
  }
  const peakMonthIdx = peakByMonth.indexOf(Math.max(...peakByMonth));
  const peakMonth = horizon[peakMonthIdx];
  const peakFTE = peakByMonth[peakMonthIdx];

  let totalCap = 0, overMonths = 0;
  for (let i = 0; i < 36; i++) {
    let monthCap = 0, monthDem = 0;
    for (const r of state.roles) {
      const cap = (state.capacity[r.id] && state.capacity[r.id][i]) || 0;
      totalCap += cap;
      monthCap += cap;
      monthDem += demand[r.id][i];
    }
    if (monthDem > monthCap) overMonths++;
  }

  const utilPct = totalCap > 0 ? (totalFTEMonths / totalCap * 100) : 0;

  const cards = [
    { label: 'Projects', value: state.projects.length, sub: 'in portfolio' },
    { label: 'Demand', value: totalFTEMonths.toFixed(0), sub: 'FTE-months · 36mo' },
    { label: 'Peak Load', value: peakFTE.toFixed(1), sub: 'FTE in ' + (peakMonthIdx >= 0 ? monthLabel(peakMonth) : '—') },
    { label: 'Utilization', value: utilPct.toFixed(0) + '%',
      sub: 'demand ÷ capacity',
      cls: utilPct > 100 ? 'bad' : utilPct > 85 ? 'warn' : 'ok' },
    { label: 'Over-Alloc', value: overMonths,
      sub: 'months exceed capacity',
      cls: overMonths > 6 ? 'bad' : overMonths > 0 ? 'warn' : 'ok' }
  ];

  for (const c of cards) {
    const el = document.createElement('div');
    el.className = 'kpi-card ' + (c.cls || '');
    el.innerHTML = `
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value ${c.cls||''}">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    `;
    row.appendChild(el);
  }
}
