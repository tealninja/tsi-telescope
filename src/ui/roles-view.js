/* ============================================================
   Roles view — list, color, abbr, delete. Role additions are
   wired from boot.js (the masthead-level "+ New Role" button).
   ============================================================ */

import { $ } from '../util/dom.js';
import { escapeHtml } from '../util/format.js';
import { state, getRole, saveState } from '../state.js';
import { renderAll } from '../boot.js';

export function renderRoles() {
  const list = $('#role-list');
  list.innerHTML = `
    <table class="phase-table" style="width:100%">
      <thead><tr><th style="width:60px">Color</th><th>Name</th><th style="width:90px">Abbr</th><th style="width:140px">ID</th><th style="width:80px"></th></tr></thead>
      <tbody>
        ${state.roles.map((r, i) => `
          <tr data-rid="${r.id}">
            <td><input type="color" value="${r.color}" data-rf="color" style="padding:0;width:50px;height:28px;border:1px solid var(--rule);cursor:pointer"></td>
            <td><input type="text" value="${escapeHtml(r.name)}" data-rf="name"></td>
            <td><input type="text" value="${escapeHtml(r.abbr)}" data-rf="abbr"></td>
            <td><code style="font-size:11px;color:var(--ink-mute)">${r.id}</code></td>
            <td style="text-align:center"><button class="btn danger small" data-rdel="${r.id}">Del</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  list.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const tr = inp.closest('tr');
      const rid = tr.dataset.rid;
      const field = inp.dataset.rf;
      const role = getRole(rid);
      role[field] = inp.value;
      saveState();
      if (field === 'color') renderRoles();
    });
  });
  list.querySelectorAll('[data-rdel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = btn.dataset.rdel;
      if (!confirm('Delete this role from all templates, projects, and capacity? This cannot be undone.')) return;
      state.roles = state.roles.filter(r => r.id !== rid);
      delete state.capacity[rid];
      for (const t of state.templates) for (const ph of t.phases) delete ph.loading[rid];
      for (const p of state.projects) for (const ph of p.phases) delete ph.loading[rid];
      saveState(); renderAll();
    });
  });
}
