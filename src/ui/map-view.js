/* ============================================================
   Map view  ·  orthographic D3 globe with project markers.

   World boundaries come from world-atlas (TopoJSON), fetched
   on first render and cached in localStorage so subsequent
   reloads work offline.

   Interaction:
     – drag to rotate (azimuthal yaw + clamped pitch)
     – scroll to zoom (scales projection radius)
     – click marker → open the project's detail modal
     – hover marker → tooltip with name, location, contract,
       win-prob stage

   Markers:
     – sized by sqrt(contractValue) so big projects don't
       swamp the small ones visually
     – colored by win-prob / template / contract value
       (chosen via the "Color by" selector)
     – pinned projects get a darker stroke
     – hidden when on the far side of the globe (back hemisphere)
   ============================================================ */

import { $, $$, hideTip } from '../util/dom.js';
import { escapeHtml, fmtMoney, winProbColor, winProbStageLabel } from '../util/format.js';
import { state, getTemplate, getLocation } from '../state.js';
import { projectColor } from '../util/palette.js';
import { openProjectDetailModal } from './project-detail.js';

const WORLD_URL   = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const CACHE_KEY   = 'tsi_world_topo_v1';
let _worldCache   = null;     // resolved TopoJSON object
let _loading      = null;     // in-flight fetch promise (deduped)
let _rotation     = [-10, -20, 0];
let _scale        = null;     // computed at first render from container size
let _colorBy      = 'winprob';
let _showGratic   = true;

export function renderMap() {
  const wrap = $('#map-wrap');
  if (!wrap) return;

  // Re-attach control handlers idempotently on every render — they're cheap
  // and this view re-renders every time it's tabbed to or state changes.
  wireControlsOnce();

  // No D3 available? Show a status message and bail.
  if (typeof d3 === 'undefined' || typeof topojson === 'undefined') {
    wrap.innerHTML = `<div class="map-status">– d3 / topojson failed to load. Check network or the &lt;script&gt; tags in index.html.</div>`;
    return;
  }

  if (_worldCache) {
    draw(wrap, _worldCache);
    return;
  }

  // Try cached topojson first
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      _worldCache = JSON.parse(cached);
      draw(wrap, _worldCache);
      return;
    }
  } catch (e) { /* fall through to fetch */ }

  wrap.innerHTML = `<div class="map-status">– Loading world boundaries…</div>`;
  if (!_loading) {
    _loading = fetch(WORLD_URL)
      .then(r => r.json())
      .then(topo => {
        _worldCache = topo;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(topo)); } catch (e) { /* quota */ }
        return topo;
      })
      .catch(err => {
        console.error('World fetch failed', err);
        return null;
      });
  }
  _loading.then(topo => {
    if (!topo) {
      wrap.innerHTML = `<div class="map-status">– Failed to load world boundaries. Markers only:</div>`;
      drawMarkersOnly(wrap);
      return;
    }
    draw(wrap, topo);
  });
}

function wireControlsOnce() {
  const sel = $('#map-color-by');
  if (sel && !sel._wired) {
    sel._wired = true;
    sel.addEventListener('change', () => {
      _colorBy = sel.value;
      renderMap();
    });
  }
  const grat = $('#map-graticule');
  if (grat && !grat._wired) {
    grat._wired = true;
    grat.addEventListener('change', () => {
      _showGratic = grat.checked;
      renderMap();
    });
  }
  const reset = $('#map-reset-view');
  if (reset && !reset._wired) {
    reset._wired = true;
    reset.addEventListener('click', () => {
      _rotation = [-10, -20, 0];
      _scale = null;
      renderMap();
    });
  }
}

function draw(wrap, topo) {
  const w = wrap.clientWidth || 800;
  const h = wrap.clientHeight || 640;
  const cx = w / 2, cy = h / 2;
  if (_scale == null) _scale = Math.min(w, h) * 0.42;

  const projection = d3.geoOrthographic()
    .scale(_scale)
    .translate([cx, cy])
    .rotate(_rotation)
    .clipAngle(90);
  const path = d3.geoPath(projection);

  const land = topojson.feature(topo, topo.objects.countries);
  const graticule = d3.geoGraticule10();
  const sphere = { type: 'Sphere' };

  // Build SVG fresh — this view re-renders on every interaction.
  wrap.innerHTML = '';
  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${w} ${h}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const gWorld = svg.append('g');
  gWorld.append('path').datum(sphere).attr('class','map-sphere').attr('d', path);
  if (_showGratic) {
    gWorld.append('path').datum(graticule).attr('class','map-graticule').attr('d', path);
  }
  gWorld.append('path').datum(land).attr('class','map-land').attr('d', path);

  const gMarkers = svg.append('g').attr('class','map-markers');

  drawMarkers(gMarkers, projection, w, h);
  renderLegend();

  // ---- Drag to rotate ----
  let dragging = false;
  svg.call(d3.drag()
    .on('start', () => { dragging = true; svg.classed('dragging', true); hideTip(); })
    .on('drag',  (e) => {
      _rotation[0] += e.dx * 0.3;
      _rotation[1] -= e.dy * 0.3;
      _rotation[1] = Math.max(-89, Math.min(89, _rotation[1]));
      projection.rotate(_rotation);
      gWorld.selectAll('.map-sphere').attr('d', path);
      gWorld.selectAll('.map-graticule').attr('d', path);
      gWorld.selectAll('.map-land').attr('d', path);
      drawMarkers(gMarkers, projection, w, h);
    })
    .on('end', () => { dragging = false; svg.classed('dragging', false); })
  );

  // ---- Wheel to zoom ----
  svg.on('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
    _scale = Math.max(80, Math.min(2400, _scale * factor));
    projection.scale(_scale);
    gWorld.selectAll('.map-sphere').attr('d', path);
    gWorld.selectAll('.map-graticule').attr('d', path);
    gWorld.selectAll('.map-land').attr('d', path);
    drawMarkers(gMarkers, projection, w, h);
  }, { passive: false });
}

function drawMarkersOnly(wrap) {
  // No basemap available — still place markers on a blank background so
  // the view isn't useless. Uses an equirectangular projection so all
  // markers are visible at once (no back-hemisphere clipping).
  const w = wrap.clientWidth || 800;
  const h = wrap.clientHeight || 640;
  wrap.innerHTML = '';
  const svg = d3.select(wrap).append('svg')
    .attr('viewBox', `0 0 ${w} ${h}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');
  const projection = d3.geoEquirectangular().fitSize([w, h], { type:'Sphere' });
  const gMarkers = svg.append('g').attr('class','map-markers');
  drawMarkers(gMarkers, projection, w, h);
  renderLegend();
}

function drawMarkers(g, projection, w, h) {
  g.selectAll('*').remove();

  const center = projection.invert ? projection.invert([w/2, h/2]) : null;
  const visible = state.projects.filter(p => p.lat != null && p.lng != null);

  // Marker size: sqrt of contract value so 1B doesn't dwarf 1M.
  const values = visible.map(p => Math.max(0, p.contractValue || 0));
  const maxVal = Math.max(1, ...values);
  const rScale = v => 4 + 12 * Math.sqrt(v / maxVal);

  for (const p of visible) {
    const point = projection([p.lng, p.lat]);
    if (!point) continue;

    // Hide markers on the back of the globe (only when we have a real center)
    if (center) {
      const dist = d3.geoDistance([p.lng, p.lat], center);
      if (dist > Math.PI / 2) continue;
    }

    const r = rScale(p.contractValue || 0);
    const color = markerColor(p);
    const circle = g.append('circle')
      .attr('class', 'map-marker' + (p.pinned ? ' pinned' : ''))
      .attr('cx', point[0])
      .attr('cy', point[1])
      .attr('r', r)
      .attr('fill', color)
      .attr('fill-opacity', 0.88);

    circle.on('mouseover', (e) => showMarkerTip(e, p))
          .on('mousemove', (e) => moveTip(e))
          .on('mouseout', hideTip)
          .on('click', () => openProjectDetailModal(p.id));
  }
}

function markerColor(p) {
  if (_colorBy === 'template') {
    const tpl = getTemplate(p.templateId);
    if (tpl) {
      // Hash the template id to a stable palette entry.
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
  // default: winprob
  const wp = p.winProbability != null ? p.winProbability : 100;
  return winProbColor(wp);
}

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
    // template — pull live from state.templates
    leg.innerHTML = state.templates.map(t => {
      let h = 0;
      for (let i = 0; i < t.id.length; i++) h = (h * 31 + t.id.charCodeAt(i)) | 0;
      const palette = ['#19446C','#00929F','#809848','#C4A230','#C05234','#6E5B8B','#4A7A9C'];
      const c = palette[Math.abs(h) % palette.length];
      return `<div class="legend-item"><span class="legend-swatch" style="background:${c}"></span>${escapeHtml(t.name)}</div>`;
    }).join('');
  }
}
