/* ============================================================
   Map view  ·  natural-earth projection of the project portfolio.

   Two render entry points:
     renderMap(container)       — full map for the Dashboard panel
                                  (drag-pan + wheel-zoom via d3.zoom,
                                  color-by selector, graticule toggle)
     renderMiniMap(container,   — small zoomed map for the project
                   { project })   editor's Location tab; highlights the
                                  working-copy project's pin.

   World boundaries: world-atlas TopoJSON from jsdelivr, cached in
   localStorage after first fetch so reloads work offline.
   ============================================================ */

import { $, hideTip } from '../util/dom.js';
import { escapeHtml, fmtMoney, winProbColor, winProbStageLabel } from '../util/format.js';
import { state, getTemplate, getLocation } from '../state.js';
import { projectColor } from '../util/palette.js';
import { openProjectDetailModal } from './project-detail.js';

const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const CACHE_KEY = 'tsi_world_topo_v1';
let _worldCache = null;
let _loading    = null;

// Persisted-across-renders user state for the full map.
let _colorBy   = 'winprob';
let _showGrat  = false;
let _zoomXfm   = null;   // last zoom transform — restored on re-render

export function renderMap(containerSel, opts = {}) {
  const wrap = (typeof containerSel === 'string') ? $(containerSel) : containerSel;
  if (!wrap) return;
  wireControlsOnce();
  withWorld(topo => draw(wrap, topo, { mode: 'full', ...opts }));
}

export function renderMiniMap(containerSel, opts = {}) {
  const wrap = (typeof containerSel === 'string') ? $(containerSel) : containerSel;
  if (!wrap) return;
  withWorld(topo => draw(wrap, topo, { mode: 'mini', ...opts }));
}

/* ---------- world data fetch + cache ---------- */
function withWorld(cb) {
  if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
    cb(null);
    return;
  }
  if (_worldCache) { cb(_worldCache); return; }
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      _worldCache = JSON.parse(cached);
      cb(_worldCache);
      return;
    }
  } catch (e) { /* fall through */ }
  if (!_loading) {
    _loading = fetch(WORLD_URL)
      .then(r => r.json())
      .then(topo => {
        _worldCache = topo;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(topo)); } catch (e) {}
        return topo;
      })
      .catch(err => { console.error('World fetch failed', err); return null; });
  }
  _loading.then(topo => cb(topo));
}

/* ---------- core draw ---------- */
function draw(wrap, topo, opts) {
  const w = wrap.clientWidth  || (opts.mode === 'mini' ? 360 : 800);
  const h = wrap.clientHeight || (opts.mode === 'mini' ? 220 : 460);
  wrap.innerHTML = '';

  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${w} ${h}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  if (!topo) {
    svg.append('text').attr('x', w/2).attr('y', h/2)
      .attr('text-anchor', 'middle')
      .attr('fill', '#888').attr('font-size', 12)
      .text('Map data failed to load.');
    return;
  }

  const projection = d3.geoNaturalEarth1().fitSize([w, h], { type: 'Sphere' });
  const path = d3.geoPath(projection);
  const land = topojson.feature(topo, topo.objects.countries);

  const gRoot = svg.append('g');
  gRoot.append('path').datum({ type: 'Sphere' }).attr('class', 'map-sphere').attr('d', path);
  if (opts.mode === 'full' && _showGrat) {
    gRoot.append('path').datum(d3.geoGraticule10()).attr('class', 'map-graticule').attr('d', path);
  }
  gRoot.append('path').datum(land).attr('class', 'map-land').attr('d', path);

  const gMarkers = gRoot.append('g').attr('class', 'map-markers');
  drawMarkers(gMarkers, projection, opts);

  if (opts.mode === 'full') {
    const zoom = d3.zoom()
      .scaleExtent([1, 12])
      .on('zoom', (e) => { gRoot.attr('transform', e.transform); _zoomXfm = e.transform; });
    svg.call(zoom);
    if (_zoomXfm) svg.call(zoom.transform, _zoomXfm);
    renderLegend();
  } else if (opts.project && opts.project.lat != null && opts.project.lng != null) {
    // Mini: center on the project at a fixed zoom factor.
    const [cx, cy] = projection([opts.project.lng, opts.project.lat]) || [w/2, h/2];
    const k = 2.4;
    const tx = w/2 - cx * k;
    const ty = h/2 - cy * k;
    gRoot.attr('transform', `translate(${tx},${ty}) scale(${k})`);
  }
}

function drawMarkers(g, projection, opts) {
  const isMini = opts.mode === 'mini';
  const all = state.projects.filter(p => p.lat != null && p.lng != null);
  const highlight = (isMini && opts.project) ? opts.project : null;

  const values = all.map(p => Math.max(0, p.contractValue || 0));
  const maxVal = Math.max(1, ...values);
  const rScale = v => isMini
    ? 3 + 5  * Math.sqrt(v / maxVal)
    : 4 + 12 * Math.sqrt(v / maxVal);

  for (const p of all) {
    if (highlight && p.id === highlight.id) continue;   // highlight drawn separately
    const pt = projection([p.lng, p.lat]);
    if (!pt) continue;
    const r = rScale(p.contractValue || 0);
    const color = markerColor(p);
    const c = g.append('circle')
      .attr('class', 'map-marker' + (p.pinned ? ' pinned' : ''))
      .attr('cx', pt[0]).attr('cy', pt[1]).attr('r', r)
      .attr('fill', color)
      .attr('fill-opacity', isMini ? 0.35 : 0.88);
    if (!isMini) {
      c.on('mouseover', (e) => showMarkerTip(e, p))
       .on('mousemove', moveTip)
       .on('mouseout', hideTip)
       .on('click', () => openProjectDetailModal(p.id));
    }
  }

  // Highlight last so it's on top.
  if (highlight && highlight.lat != null && highlight.lng != null) {
    const pt = projection([highlight.lng, highlight.lat]);
    if (pt) {
      const wp = highlight.winProbability != null ? highlight.winProbability : 100;
      g.append('circle')
        .attr('cx', pt[0]).attr('cy', pt[1]).attr('r', 11)
        .attr('fill', 'none')
        .attr('stroke', winProbColor(wp))
        .attr('stroke-width', 2.5);
      g.append('circle')
        .attr('cx', pt[0]).attr('cy', pt[1]).attr('r', 5)
        .attr('fill', markerColor(highlight));
    }
  }
}

function markerColor(p) {
  if (_colorBy === 'template') {
    const tpl = getTemplate(p.templateId);
    if (tpl) {
      let h = 0;
      for (let i = 0; i < tpl.id.length; i++) h = (h * 31 + tpl.id.charCodeAt(i)) | 0;
      const palette = ['#19446C','#00929F','#809848','#C4A230','#C05234','#6E5B8B','#4A7A9C'];
      return palette[Math.abs(h) % palette.length];
    }
    return projectColor(p.id);
  }
  if (_colorBy === 'value') {
    const v = p.contractValue || 0;
    if (v >= 25e6) return '#19446C';
    if (v >= 10e6) return '#00929F';
    if (v >= 3e6)  return '#809848';
    if (v >= 1e6)  return '#C4A230';
    return '#C05234';
  }
  const wp = p.winProbability != null ? p.winProbability : 100;
  return winProbColor(wp);
}

/* ---------- tooltip + controls + legend ---------- */
function showMarkerTip(e, p) {
  const tip = $('#tooltip');
  if (!tip) return;
  const wp = p.winProbability != null ? p.winProbability : 100;
  const tpl = getTemplate(p.templateId);
  const loc = getLocation(p.locationId);
  tip.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px">${escapeHtml(p.name)}</div>
    <div style="font-size:11px;color:#C8D1D6;margin-bottom:4px">${escapeHtml(p.client || '')}${p.location ? ' · ' + escapeHtml(p.location) : ''}</div>
    <div style="font-size:11px">${tpl ? escapeHtml(tpl.name) : ''} ${loc ? '· ' + escapeHtml(loc.name) : ''}</div>
    <div style="font-family:var(--font-mono);font-size:12px;margin-top:4px">${fmtMoney(p.contractValue||0, {compact:true})}</div>
    <div style="font-size:11px;color:${winProbColor(wp)};margin-top:2px">${escapeHtml(winProbStageLabel(wp))}</div>
  `;
  tip.style.display = 'block';
  moveTip(e);
}

function moveTip(e) {
  const tip = $('#tooltip');
  if (!tip) return;
  tip.style.left = (e.pageX + 14) + 'px';
  tip.style.top  = (e.pageY + 14) + 'px';
}

function wireControlsOnce() {
  const sel = $('#map-color-by');
  if (sel && !sel._wired) {
    sel._wired = true;
    sel.value = _colorBy;
    sel.addEventListener('change', () => {
      _colorBy = sel.value;
      const wrap = $('#dash-map-wrap');
      if (wrap) renderMap(wrap);
    });
  }
  const grat = $('#map-graticule');
  if (grat && !grat._wired) {
    grat._wired = true;
    grat.checked = _showGrat;
    grat.addEventListener('change', () => {
      _showGrat = grat.checked;
      const wrap = $('#dash-map-wrap');
      if (wrap) renderMap(wrap);
    });
  }
  const reset = $('#map-reset-view');
  if (reset && !reset._wired) {
    reset._wired = true;
    reset.addEventListener('click', () => {
      _zoomXfm = null;
      const wrap = $('#dash-map-wrap');
      if (wrap) renderMap(wrap);
    });
  }
}

function renderLegend() {
  const leg = $('#map-legend');
  if (!leg) return;
  if (_colorBy === 'winprob') {
    leg.innerHTML = [
      ['#6E8C34', '≥85% · awarded/booked'],
      ['#00929F', '50–84% · verbal / LOI'],
      ['#C4A230', '25–49% · qualified / proposal'],
      ['#C05234', '< 25% · early lead / cold'],
    ].map(([c, l]) =>
      `<div class="legend-item"><span class="legend-swatch" style="background:${c}"></span>${l}</div>`
    ).join('') + `<div class="legend-item" style="margin-left:14px;color:var(--gray)">– marker size ∝ √(contract value)</div>`;
  } else if (_colorBy === 'value') {
    leg.innerHTML = [
      ['#19446C', '≥ $25M'],
      ['#00929F', '$10–25M'],
      ['#809848', '$3–10M'],
      ['#C4A230', '$1–3M'],
      ['#C05234', '< $1M'],
    ].map(([c, l]) =>
      `<div class="legend-item"><span class="legend-swatch" style="background:${c}"></span>${l}</div>`
    ).join('');
  } else {
    leg.innerHTML = state.templates.map(t => {
      let h = 0;
      for (let i = 0; i < t.id.length; i++) h = (h * 31 + t.id.charCodeAt(i)) | 0;
      const palette = ['#19446C','#00929F','#809848','#C4A230','#C05234','#6E5B8B','#4A7A9C'];
      const c = palette[Math.abs(h) % palette.length];
      return `<div class="legend-item"><span class="legend-swatch" style="background:${c}"></span>${escapeHtml(t.name)}</div>`;
    }).join('');
  }
}
