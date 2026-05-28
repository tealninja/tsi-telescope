/* ============================================================
   DOM helpers — thin shortcuts and shared UI primitives.
   ============================================================ */

export const $  = sel => document.querySelector(sel);
export const $$ = sel => Array.from(document.querySelectorAll(sel));

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> t.classList.remove('show'), 2400);
}

export function hideTip() { $('#tooltip').style.display = 'none'; }
