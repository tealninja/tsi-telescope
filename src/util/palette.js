/* ============================================================
   Project color palette — deterministic per-project color.
   Used by Gantt, Gantt companion charts, and histogram views.
   ============================================================ */

export const PROJECT_COLOR_PALETTE = [
  '#19446C',  // deep blue
  '#00929F',  // teal
  '#809848',  // sage
  '#C4A230',  // amber
  '#C05234',  // coral
  '#6E5B8B',  // muted purple
  '#4A7A9C',  // process blue
  '#6E8C34',  // succ green
  '#9B7E46',  // tan
  '#3E6B8E',  // steel blue
  '#A05634',  // burnt rust
  '#5C7E2A'   // olive
];

// FNV-1a hash for stable but well-distributed color assignment from project id.
export function projectColor(projectId) {
  let h = 2166136261;
  for (let i = 0; i < projectId.length; i++) {
    h ^= projectId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PROJECT_COLOR_PALETTE[(h >>> 0) % PROJECT_COLOR_PALETTE.length];
}
