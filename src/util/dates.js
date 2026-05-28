/* ============================================================
   Date helpers — pure functions, no state dependencies.
   Month keys are 'YYYY-MM' strings.
   ============================================================ */

export function monthKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

export function parseMonth(k) {
  const [y,m] = k.split('-').map(Number);
  return new Date(y, m-1, 1);
}

export function monthLabel(k, short=true) {
  const d = parseMonth(k);
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return short ? `${mNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
               : `${mNames[d.getMonth()]} ${d.getFullYear()}`;
}

export function addMonths(k, n) {
  const d = parseMonth(k);
  d.setMonth(d.getMonth() + n);
  return monthKey(d);
}

export function monthsBetween(a, b) {
  const da = parseMonth(a), db = parseMonth(b);
  return (db.getFullYear()-da.getFullYear())*12 + (db.getMonth()-da.getMonth());
}
