/* ============================================================
   Locations view — list with multiplier + notes editing,
   delete (reassigns dependent projects to USA baseline).
   ============================================================ */

import { $ } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { state, getLocation, saveState } from '../state.js';
import { renderAll } from '../boot.js';

export function renderLocations() {
  const list = $('#location-list');
  list.innerHTML = `
    <table class="phase-table" style="width:100%">
      <thead><tr>
        <th style="width:200px">Location</th>
        <th style="width:90px">Multiplier</th>
        <th style="width:90px">Lat</th>
        <th style="width:90px">Lng</th>
        <th>Notes</th>
        <th style="width:80px"></th>
      </tr></thead>
      <tbody>
        ${state.locations.map(l => `
          <tr data-lid="${l.id}">
            <td><input type="text" data-lf="name" value="${escapeHtml(l.name)}"></td>
            <td>
              <input type="number" data-lf="multiplier" step="0.05" min="0.1" max="3.0" value="${l.multiplier}" class="mono" style="font-weight:600;color:var(--teal);text-align:center">
            </td>
            <td><input type="number" data-lf="lat" step="0.01" min="-90"  max="90"  value="${l.lat != null ? l.lat : ''}" class="mono" style="text-align:right"></td>
            <td><input type="number" data-lf="lng" step="0.01" min="-180" max="180" value="${l.lng != null ? l.lng : ''}" class="mono" style="text-align:right"></td>
            <td><input type="text" data-lf="notes" value="${escapeHtml(l.notes||'')}"></td>
            <td style="text-align:center"><button class="btn danger small" data-ldel="${l.id}">Del</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="margin-top:14px;padding:14px;background:var(--warm-white);border-left:3px solid var(--teal);border-radius:2px">
      <div class="eyebrow">How it works</div>
      <ul class="tsi-bullets" style="margin-top:6px">
        <li>Each phase duration in a project is multiplied by the location multiplier.</li>
        <li>A 10-month design phase × 0.7 (Vietnam) → 7-month effective duration.</li>
        <li>Ramp-up and ramp-down months scale proportionally.</li>
        <li>Role loadings (peak %) are unchanged — only the duration shifts.</li>
        <li>Minimum 1 month for any non-zero phase, regardless of multiplier.</li>
      </ul>
    </div>
  `;
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const tr = inp.closest('tr');
      const lid = tr.dataset.lid;
      const field = inp.dataset.lf;
      const loc = getLocation(lid);
      if (field === 'multiplier') {
        const v = Math.max(0.1, Math.min(3.0, parseFloat(inp.value || '1')));
        loc.multiplier = v;
        inp.value = v;
      } else if (field === 'lat' || field === 'lng') {
        const v = parseFloat(inp.value);
        loc[field] = Number.isFinite(v) ? v : null;
      } else {
        loc[field] = inp.value;
      }
      saveState();
    });
  });
  list.querySelectorAll('[data-ldel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const lid = btn.dataset.ldel;
      const loc = getLocation(lid);
      const usedBy = state.projects.filter(p => p.locationId === lid);
      if (usedBy.length > 0) {
        if (!confirm(`Delete location "${loc.name}"? ${usedBy.length} project(s) use it — they will be moved to USA (1.0×).`)) return;
        for (const p of usedBy) p.locationId = 'us';
      } else {
        if (!confirm(`Delete location "${loc.name}"?`)) return;
      }
      state.locations = state.locations.filter(x => x.id !== lid);
      saveState(); renderLocations(); renderAll();
    });
  });
}
