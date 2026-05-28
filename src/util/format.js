/* ============================================================
   Formatting helpers — pure functions, no state dependencies.
   ============================================================ */

export function fmtMoney(n, opts) {
  opts = opts || {};
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (opts.compact || abs >= 1e6) {
    if (abs >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (n/1e3).toFixed(0) + 'k';
  }
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/* Win-probability → pipeline stage label and color */
export function winProbStageLabel(p) {
  if (p >= 100) return '✓ Booked / Contract signed (100%)';
  if (p >= 85)  return 'Awarded · finalizing contract (' + p + '%)';
  if (p >= 65)  return 'Verbal / LOI · high confidence (' + p + '%)';
  if (p >= 40)  return 'Active proposal · in negotiation (' + p + '%)';
  if (p >= 20)  return 'Qualified opportunity (' + p + '%)';
  if (p >= 5)   return 'Early lead · low confidence (' + p + '%)';
  return 'Cold / parked (' + p + '%)';
}

export function winProbColor(p) {
  if (p >= 85)  return '#6E8C34';  // green
  if (p >= 50)  return '#00929F';  // teal
  if (p >= 25)  return '#C4A230';  // amber
  return '#C05234';                 // coral
}

/* Nice ceiling helper for chart axes (rounds up to 1/2/5 × 10^n) */
export function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / exp;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
