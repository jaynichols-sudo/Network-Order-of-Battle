// Explore: the Scope radar, Clusters (people around their company), the Map, and
// Ranks in the federal view. Ports ExploreView.swift, ClustersView.swift and MapView.swift.
import { M, persons, person, isSample, locate } from './model.js';
import { esc, fmt, icon, segmented, palette, rgba, empty, callout, $, plural, REDUCED } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { openPerson, openUnit, showPeople, showSector } from './actions.js';
import { personRow } from './people.js';
import { accountButton, accountMenu } from './home.js';
import { fx, ls } from './platform.js';
import { loadGeo, lookup, miles } from '../geo.js';
import L from 'leaflet';

const TAU = Math.PI * 2;
let mode = ls.get('bearings.explore') || 'scope';
let radar = null, clusters = null, map = null;

/* ---------- canvas helper ---------- */
function canvasBox(el, {height, square = false, draw}){
  const cv = document.createElement('canvas'); el.appendChild(cv);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    const w = el.clientWidth; if (!w) return false;
    const h = square ? w : height;
    const d = Math.min(window.devicePixelRatio || 1, 3);
    if (w === W && h === H && d === dpr) return false;
    W = w; H = h; dpr = d; cv.width = w * d; cv.height = h * d; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    return true;
  };
  const paint = now => { if (!W) resize(); if (!W) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); draw(ctx, W, H, now); };
  const ro = new ResizeObserver(() => { if (resize()) paint(performance.now()); }); ro.observe(el);
  return {cv, ctx, paint, size: () => [W, H], destroy: () => ro.disconnect()};
}
function loopWhileVisible(el, tick){
  let raf = 0, vis = false, alive = true;
  const run = now => { raf = 0; if (!alive) return; tick(now); if (vis && !document.hidden && !REDUCED()) raf = requestAnimationFrame(run); };
  const kick = () => { if (!raf && alive) raf = requestAnimationFrame(run); };
  const io = new IntersectionObserver(es => { vis = es.some(e => e.isIntersecting); if (vis) kick(); }); io.observe(el);
  const onv = () => kick(); document.addEventListener('visibilitychange', onv);
  return {kick, stop(){ alive = false; io.disconnect(); document.removeEventListener('visibilitychange', onv); if (raf) cancelAnimationFrame(raf); }};
}

/* ---------- scope radar ---------- */
function createRadar(host){
  let data = M.api.radar({text: M.q.text, filters: M.q.filters}), paths = null, key = '';
  const wrap = document.createElement('div'); wrap.className = 'radar'; host.appendChild(wrap);
  const box = canvasBox(wrap, {square: true, draw(ctx, W, H, now){
    const pal = palette(), size = Math.min(W, H), r = size / 2 - 8, cx = W / 2, cy = H / 2;
    const k = `${data.dots.length}|${W}`;
    if (k !== key){
      key = k; paths = new Map();
      const base = data.dots.length > 2500 ? 2.2 : data.dots.length > 900 ? 2.8 : 3.5;
      for (const d of data.dots){ const x = cx + d.x * r, y = cy + d.y * r, s = d.big ? base * 1.6 : base; let p = paths.get(d.c); if (!p){ p = new Path2D(); paths.set(d.c, p); } p.moveTo(x + s, y); p.arc(x, y, s, 0, TAU); }
    }
    const line = rgba(pal.text2, 0.25), last = data.bands.length - 1;
    data.bands.forEach((b, i) => { if (!i) return; ctx.beginPath(); ctx.arc(cx, cy, r * b, 0, TAU); ctx.setLineDash(i === last ? [] : [2, 5]); ctx.strokeStyle = i === last ? rgba(pal.text2, 0.4) : line; ctx.lineWidth = 1; ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.beginPath(); for (const w of data.wedges){ ctx.moveTo(cx + Math.cos(w.a0) * r * 0.15, cy + Math.sin(w.a0) * r * 0.15); ctx.lineTo(cx + Math.cos(w.a0) * r, cy + Math.sin(w.a0) * r); }
    ctx.strokeStyle = line; ctx.stroke();
    if (!REDUCED()){
      const sweep = ((now / 1000) % 6) / 6 * TAU - Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, sweep - 0.8, sweep); ctx.closePath();
      const a = [cx + Math.cos(sweep - 0.8) * r, cy + Math.sin(sweep - 0.8) * r], b = [cx + Math.cos(sweep) * r, cy + Math.sin(sweep) * r];
      const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]); g.addColorStop(0, rgba(pal.amber, 0)); g.addColorStop(1, rgba(pal.amber, pal.dark ? 0.16 : 0.2));
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(b[0], b[1]); ctx.strokeStyle = rgba(pal.amber, 0.85); ctx.lineWidth = 1.5; ctx.stroke();
    }
    for (const [c, p] of paths){ ctx.fillStyle = c; ctx.fill(p); }
  }});
  const loop = loopWhileVisible(wrap, now => box.paint(now));
  box.cv.addEventListener('click', e => {
    const rect = box.cv.getBoundingClientRect(), [W, H] = box.size(), r = Math.min(W, H) / 2 - 8;
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bd = 18;
    for (const d of data.dots){ const dd = Math.hypot(W / 2 + d.x * r - x, H / 2 + d.y * r - y); if (dd < bd){ bd = dd; best = d.k; } }
    if (best){ fx.tap(); openPerson(best); }
  });
  return {
    data: () => data,
    refresh(){ data = M.api.radar({text: M.q.text, filters: M.q.filters}); key = ''; box.paint(performance.now()); loop.kick(); },
    destroy(){ loop.stop(); box.destroy(); },
  };
}
function radarLegend(d){
  return `<div class="card list">${d.wedges.slice().sort((a, b) => b.n - a.n).map(w => `<button type="button" class="row" data-a="sector" data-v="${esc(w.id)}"><i class="dot lg" style="background:${esc(w.color)}"></i><span class="grow">${esc(w.id)}</span><span class="mono muted">${fmt(w.n)}</span>${icon('chevR', 'chev')}</button>`).join('')}</div>`;
}

/* ---------- clusters ---------- */
function createClusters(host, onFocus){
  const d = M.api.clusters({text: M.q.text, filters: M.q.filters}, {max: 40});
  const wrap = document.createElement('div'); wrap.className = 'clusters'; host.appendChild(wrap);
  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'glass-chip whole'; chip.innerHTML = icon('collapse') + 'Whole network'; chip.hidden = true; wrap.appendChild(chip);
  let fitScale = 1, fitCenter = {x: 0, y: 0}, zoom = 1, pan = {x: 0, y: 0}, focus = null, year = d.maxYear || 0;
  let settle = REDUCED() ? 1 : 0, settleT0 = performance.now(), fly = null;
  const fit = (W, H) => {
    if (!d.hubs.length) return 1;
    let x0 = -60, x1 = 60, y0 = -60, y1 = 60;
    for (const h of d.hubs){ const ext = h.R + 9 * Math.ceil(h.n / 10) + 20; x0 = Math.min(x0, h.x - ext); x1 = Math.max(x1, h.x + ext); y0 = Math.min(y0, h.y - ext); y1 = Math.max(y1, h.y + ext); }
    fitCenter = {x: (x0 + x1) / 2, y: (y0 + y1) / 2};
    return Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.96;
  };
  const cam = () => { const s = fitScale * zoom; return {s, ox: pan.x - fitCenter.x * s, oy: pan.y - fitCenter.y * s}; };
  const visibleCount = i => d.people.reduce((a, p) => a + (p.h === i && (!p.y0 || p.y0 <= year) ? 1 : 0), 0);
  const box = canvasBox(wrap, {height: 520, draw(ctx, W, H, now){
    const pal = palette();
    if (fitScale === 1 && W) fitScale = fit(W, H);
    if (settle < 1){ const p = Math.min(1, (now - settleT0) / 1100); settle = Math.min(1, 1 - Math.pow(1 - p, 3) + Math.sin(p * Math.PI) * 0.06); if (p >= 1) settle = 1; }
    if (fly){ const p = Math.min(1, (now - fly.t0) / 550), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; zoom = fly.z0 + (fly.z1 - fly.z0) * e; pan = {x: fly.p0.x + (fly.p1.x - fly.p0.x) * e, y: fly.p0.y + (fly.p1.y - fly.p0.y) * e}; if (p >= 1) fly = null; }
    const c = cam(), t = settle, scale = c.s * (0.12 + 0.88 * t), ox = c.ox * t, oy = c.oy * t;
    const S = (x, y) => [W / 2 + x * scale + ox, H / 2 + y * scale + oy];
    ctx.globalAlpha = Math.max(0, Math.min(1, t * 1.4));
    const [cx, cy] = S(0, 0);
    ctx.beginPath(); for (const h of d.hubs){ const [x, y] = S(h.x, h.y); ctx.moveTo(cx, cy); ctx.lineTo(x, y); }
    ctx.strokeStyle = rgba(pal.text2, pal.dark ? 0.22 : 0.18); ctx.lineWidth = 0.6; ctx.stroke();
    d.hubs.forEach((h, i) => {
      const [x, y] = S(h.x, h.y), r = Math.max(1, h.R * scale);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(h.color, focus === i ? 0.42 : 0.28)); g.addColorStop(1, rgba(h.color, 0.08));
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = focus === i ? 1.5 : 0.8; ctx.strokeStyle = rgba(h.color, focus === i ? 0.8 : 0.35); ctx.stroke();
    });
    const dotR = Math.max(1.4, Math.min(4.5, 2.2 * scale * 1.4));
    const by = new Map(), star = new Path2D();
    for (const p of d.people){
      if (p.y0 && p.y0 > year) continue;
      const [x, y] = S(p.x, p.y); if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      let path = by.get(p.c); if (!path){ path = new Path2D(); by.set(p.c, path); }
      path.moveTo(x + dotR, y); path.arc(x, y, dotR, 0, TAU);
      if (p.star){ star.moveTo(x + dotR + 1.5, y); star.arc(x, y, dotR + 1.5, 0, TAU); }
    }
    for (const [col, path] of by){ ctx.fillStyle = col; ctx.fill(path); }
    ctx.strokeStyle = pal.amber; ctx.lineWidth = 1.2; ctx.stroke(star);
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.fillStyle = pal.amber; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 11, 0, TAU); ctx.strokeStyle = rgba(pal.amber, 0.5); ctx.lineWidth = 2; ctx.stroke();
    // labels: biggest groups first, skipping any that would overlap one already placed
    const placed = [], order = d.hubs.map((_, i) => i).sort((a, b) => d.hubs[b].n - d.hubs[a].n);
    ctx.textBaseline = 'middle';
    order.forEach((i, rank) => {
      const h = d.hubs[i], r = h.R * scale;
      if (!(rank < 6 || r > 22 || focus === i || scale > 1.8)) return;
      const n = visibleCount(i); if (!n) return;
      const [x, y] = S(h.x, h.y);
      const name = h.name.length > 24 ? h.name.slice(0, 23) + '…' : h.name;
      ctx.font = '600 11px Geist, sans-serif'; const tw = ctx.measureText(name).width;
      ctx.font = '500 10px "Geist Mono", monospace'; const nw = ctx.measureText('  ' + n).width;
      const w = tw + nw + 16, hh = 22, rx = x - w / 2, ry = y - r - 8 - hh;
      if (focus !== i && placed.some(p => rx - 4 < p.x + p.w && p.x < rx + w + 4 && ry - 3 < p.y + p.h && p.y < ry + hh + 3)) return;
      placed.push({x: rx, y: ry, w, h: hh});
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(rx, ry, w, hh, hh / 2) : ctx.rect(rx, ry, w, hh);
      ctx.fillStyle = pal.dark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.88)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(h.color, 0.5); ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '600 11px Geist, sans-serif'; ctx.fillStyle = pal.text; ctx.fillText(name, rx + 8, ry + hh / 2 + 0.5);
      ctx.font = '500 10px "Geist Mono", monospace'; ctx.fillStyle = pal.text2; ctx.fillText('  ' + n, rx + 8 + tw, ry + hh / 2 + 0.5);
    });
    ctx.globalAlpha = 1;
  }});
  const busy = () => settle < 1 || !!fly || drag.active;
  let raf = 0;
  const kick = () => { if (raf) return; raf = requestAnimationFrame(function run(now){ raf = 0; box.paint(now); if (busy()) raf = requestAnimationFrame(run); }); };
  kick();
  const showChip = () => { chip.hidden = !(focus != null || zoom !== 1 || pan.x || pan.y); };
  chip.addEventListener('click', () => { fx.tap(); flyTo(1, {x: 0, y: 0}); focus = null; onFocus(null); showChip(); });
  function flyTo(z1, p1){ if (REDUCED()){ zoom = z1; pan = p1; kick(); return; } fly = {t0: performance.now(), z0: zoom, z1, p0: Object.assign({}, pan), p1}; kick(); }
  // gestures: drag to pan, two fingers to pinch, tap a group to fly in, tap a person to open them
  const pts = new Map(); const drag = {active: false, moved: false, startPan: null, startZoom: 1, startDist: 0, startMid: null, x0: 0, y0: 0};
  box.cv.style.touchAction = 'none';
  box.cv.addEventListener('pointerdown', e => { box.cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, {x: e.clientX, y: e.clientY}); drag.active = true; drag.moved = false; drag.startPan = Object.assign({}, pan); drag.startZoom = zoom; drag.x0 = e.clientX; drag.y0 = e.clientY; if (pts.size === 2){ const [a, b] = [...pts.values()]; drag.startDist = Math.hypot(a.x - b.x, a.y - b.y); } fly = null; kick(); });
  box.cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pts.size >= 2){ const [a, b] = [...pts.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y); if (drag.startDist) zoom = Math.min(12, Math.max(0.5, drag.startZoom * dist / drag.startDist)); drag.moved = true; }
    else { const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; if (Math.hypot(dx, dy) > 4) drag.moved = true; if (drag.moved) pan = {x: drag.startPan.x + dx, y: drag.startPan.y + dy}; }
    showChip();
  });
  const up = e => {
    const was = pts.has(e.pointerId); pts.delete(e.pointerId);
    if (pts.size === 1){ const [a] = [...pts.values()]; drag.x0 = a.x; drag.y0 = a.y; drag.startPan = Object.assign({}, pan); drag.startZoom = zoom; return; }
    if (pts.size) return;
    drag.active = false;
    if (was && !drag.moved) tap(e);
    showChip(); kick();
  };
  box.cv.addEventListener('pointerup', up); box.cv.addEventListener('pointercancel', up);
  box.cv.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.min(12, Math.max(0.5, zoom * (e.deltaY < 0 ? 1.12 : 0.89))); showChip(); kick(); }, {passive: false});
  function tap(e){
    const rect = box.cv.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, [W, H] = box.size();
    const c = cam(), S = (px, py) => [W / 2 + px * c.s + c.ox, H / 2 + py * c.s + c.oy];
    if (c.s > 0.9){
      let best = null, bd = 14;
      for (const p of d.people){ if (p.y0 && p.y0 > year) continue; const [sx, sy] = S(p.x, p.y), dd = Math.hypot(sx - x, sy - y); if (dd < bd){ bd = dd; best = p.k; } }
      if (best){ fx.tap(); openPerson(best); return; }
    }
    for (let i = 0; i < d.hubs.length; i++){
      const h = d.hubs[i], [sx, sy] = S(h.x, h.y), reach = (h.R + 9 * Math.ceil(h.n / 10) + 10) * c.s;
      if (Math.hypot(sx - x, sy - y) < Math.max(reach, 22)){
        fx.tap(); focus = i; onFocus(h);
        const span = (h.R + 9 * Math.ceil(h.n / 10) + 40) * 2, target = Math.min(6, Math.min(W, H) / span);
        flyTo(target / fitScale, {x: -(h.x - fitCenter.x) * target, y: -(h.y - fitCenter.y) * target});
        showChip(); return;
      }
    }
  }
  return {
    d, setYear(y){ year = y; kick(); },
    hub: () => focus != null ? d.hubs[focus] : null,
    destroy(){ box.destroy(); if (raf) cancelAnimationFrame(raf); },
    kick,
  };
}

/* ---------- map ---------- */
const MAP = {center: null, centerName: '', radius: 50};
function placeGroups(){
  const by = new Map();
  for (const [k, pl] of Object.entries(M.places)){
    const p = person(k); if (!p || p.x) continue;
    let g = by.get(pl.name); if (!g){ g = {name: pl.name, lat: pl.lat, lon: pl.lon, rough: !!pl.prec && pl.prec !== 'city', people: []}; by.set(pl.name, g); }
    g.people.push(p);
  }
  for (const g of by.values()) g.people.sort((a, b) => b.score - a.score || a.cl.lv - b.cl.lv);
  return [...by.values()];
}
function mapSection(){
  const groups = placeGroups();
  const card = (g, detail) => `<button type="button" class="card place" data-a="place" data-v="${esc(g.name)}"><span class="place-top"><b>${esc(g.name)}</b><span class="muted">${esc(plural(g.people.length, 'person', 'people'))}${detail ? ', ' + esc(detail) : ''}</span>${icon('chevR', 'chev')}</span><span class="place-names muted small">${esc(g.people.slice(0, 4).map(p => p.full).join(', '))}${g.people.length > 4 ? ` and ${fmt(g.people.length - 4)} more` : ''}</span></button>`;
  let list = '';
  if (MAP.center){
    const near = groups.filter(g => !g.rough).map(g => Object.assign(g, {d: miles(MAP.center, g)})).filter(g => g.d <= MAP.radius).sort((a, b) => a.d - b.d);
    const total = near.reduce((a, g) => a + g.people.length, 0);
    list = `<div class="row-between pad-x"><h3 class="h3">${esc(`${plural(total, 'person', 'people')} within ${MAP.radius} miles${MAP.centerName ? ' of ' + MAP.centerName : ''}`)}</h3><button type="button" class="link" data-a="mapClear">Clear</button></div>
      ${near.length ? near.map(g => card(g, g.d < 1 ? 'here' : `${Math.round(g.d)} mi`)).join('') : '<p class="muted pad-x">Nobody you know is placed nearby yet. Try a wider distance, or set people’s locations from their profiles.</p>'}`;
  } else {
    const top = groups.sort((a, b) => b.people.length - a.people.length).slice(0, 12);
    list = top.length ? `<h3 class="h3 pad-x">Where your people are</h3>${top.map(g => card(g, g.rough ? 'roughly placed' : '')).join('')}` : '';
  }
  const explain = !isSample() && !M.placesBuilt ? callout({ic: 'contactCheck', tint: 'var(--info)', title: 'Find out where people are', text: 'LinkedIn’s export doesn’t say where people live. Bearings can work it out on this phone from their cards in your Contacts (address, then phone area code). Nothing leaves your phone.', button: M.locating ? 'Working…' : 'Use my Contacts', act: 'locate'}) : '';
  return `<div class="map-controls"><label class="searchbox">${icon('search')}<input type="search" data-ch="mapSearch" placeholder="Where are you headed?" enterkeyhint="search" autocomplete="off"><button type="button" class="tool small" data-a="nearMe" aria-label="People near me">${icon('location')}</button></label>
    ${MAP.center ? segmented('radius', [['25', '25 mi'], ['50', '50 mi'], ['100', '100 mi'], ['250', '250 mi']], String(MAP.radius)) : ''}</div>
    <div class="map-box card"><div id="leaflet"></div></div>${explain}<div class="map-list">${list}</div>
    <p class="foot">${isSample() ? 'Sample network: locations are made up.' : `${fmt(Object.keys(M.places).length)} of ${fmt(M.info.count)} people placed. Set anyone’s location from their profile, or a whole company from its page. Place data from GeoNames and Google’s libphonenumber.`}</p>`;
}
function drawMap(el){
  const box = $('#leaflet', el); if (!box) return;
  if (map && map.box !== box){ map.m.remove(); map = null; }
  if (!map){
    const m = L.map(box, {zoomControl: true, attributionControl: true, worldCopyJump: true}).setView([37.5, -92], 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '© OpenStreetMap contributors'}).addTo(m);
    map = {m, box, layer: L.layerGroup().addTo(m), circle: null};
  }
  setTimeout(() => map && map.m.invalidateSize(), 60);
  map.layer.clearLayers();
  for (const g of placeGroups()){
    const n = g.people.length, size = n >= 50 ? 44 : n >= 10 ? 36 : 28;
    const ic = L.divIcon({className: 'geo-pin', html: `<span class="${g.rough ? 'rough' : ''}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">${n}</span>`, iconSize: [size, size]});
    L.marker([g.lat, g.lon], {icon: ic, title: `${g.name}, ${n}`}).on('click', () => openPlace(g.name)).addTo(map.layer);
  }
  if (map.circle){ map.m.removeLayer(map.circle); map.circle = null; }
  if (MAP.center) map.circle = L.circle([MAP.center.lat, MAP.center.lon], {radius: MAP.radius * 1609.344, color: '#FFB020', weight: 1.5, fillColor: '#FFB020', fillOpacity: 0.12}).addTo(map.m);
}
function openPlace(name){
  const g = placeGroups().find(x => x.name === name); if (!g) return;
  openSheet({title: g.name, right: ['Done'], full: true,
    mount(body){ body.innerHTML = `<p class="sec-h">${plural(g.people.length, 'person', 'people')}${g.rough ? ', roughly placed' : ''}</p><div class="card list">${g.people.slice(0, 300).map(p => personRow(p)).join('')}</div>`; },
    handlers: {open(k){ closeSheet(); openPerson(k); }}});
}

/* ---------- ranks ---------- */
function ranks(){
  const d = M.api.ranks({text: M.q.text, filters: M.q.filters});
  return `<div class="card ranks-wrap"><table class="ranks"><thead><tr><th class="l">Tier</th>${d.branches.map(b => `<th>${esc(b.replace(' / ', '/'))}</th>`).join('')}<th>Total</th></tr></thead><tbody>
    ${d.rows.map(r => `<tr><th class="l"><b>${esc(r.tier)}</b>${r.sub ? `<span class="muted">${esc(r.sub)}</span>` : ''}</th>${r.cells.map((n, i) => `<td><button type="button" class="cell ${n ? '' : 'zero'}" ${n ? `data-a="rankCell" data-v="${esc(r.tier + '\u0001' + d.branches[i])}"` : 'disabled'} style="--a:${n ? (0.12 + 0.7 * Math.sqrt(n / Math.max(1, d.max))).toFixed(3) : 0.04}">${n ? fmt(n) : '·'}</button></td>`).join('')}<td class="mono">${fmt(r.total)}</td></tr>`).join('')}
    <tr class="tot"><th class="l">Total</th>${d.totals.map(n => `<td class="mono">${fmt(n)}</td>`).join('')}<td class="mono strong">${fmt(d.total)}</td></tr></tbody></table></div>`;
}

/* ---------- the view ---------- */
function teardown(){ if (radar){ radar.destroy(); radar = null; } if (clusters){ clusters.destroy(); clusters = null; } }
export const ExploreView = {
  mount(el){
    el.innerHTML = `<div class="scr"><header class="scr-head"><h1>Explore</h1><div class="tools">${accountButton()}</div></header><div class="seg-wrap"></div><div class="ex-body"></div></div>`;
    this.update(el);
  },
  update(el, what){
    if (!M.info.lens && mode === 'ranks') mode = 'scope';
    $('.scr-head .me-btn', el).outerHTML = accountButton();
    $('.seg-wrap', el).innerHTML = segmented('mode', [['scope', 'Scope'], ['clusters', 'Clusters'], ['map', 'Map'], ...(M.info.lens ? [['ranks', 'Ranks']] : [])], mode);
    const body = $('.ex-body', el);
    if (what === 'person' && mode !== 'map') return; // a single edit doesn't move anyone on these views
    teardown();
    if (mode === 'scope'){
      body.innerHTML = `<p class="muted small pad-x">More senior people sit closer to the middle. Tap a dot to open someone.</p><div class="radar-host"></div><div class="legend"></div>`;
      radar = createRadar($('.radar-host', body));
      $('.legend', body).innerHTML = radarLegend(radar.data());
    } else if (mode === 'clusters'){
      body.innerHTML = `<p class="muted small pad-x">People cluster around their company or command. Pinch to zoom, tap a group to fly in, tap a person to open them.</p><div class="card clusters-host"></div><div class="replay"></div><div class="hub-panel"></div>`;
      clusters = createClusters($('.clusters-host', body), h => { $('.hub-panel', body).innerHTML = h ? `<div class="card hub row-between"><i class="dot lg" style="background:${esc(h.color)}"></i><div class="grow"><b>${esc(h.name)}</b><p class="muted small">${esc(`${plural(h.n, 'person', 'people')} · ${h.seg}`)}</p></div>${h.other ? '' : `<button type="button" class="btn prominent small" data-a="unit" data-v="${esc(h.name)}">Open</button>`}</div>` : ''; });
      const d = clusters.d;
      if (d.maxYear > d.minYear) $('.replay', body).innerHTML = `<div class="replay-row"><button type="button" class="tool" data-a="play" aria-label="Replay how your network grew">${icon('play')}</button><input type="range" min="${d.minYear}" max="${d.maxYear}" step="1" value="${d.maxYear}" data-in="year" aria-label="Year"><b class="mono yr">${d.maxYear}</b></div>`;
    } else if (mode === 'map'){
      body.innerHTML = mapSection();
      drawMap(body);
    } else body.innerHTML = ranks();
  },
  onHide(){ playing = false; },
  handlers: {
    account: (_, t) => accountMenu(t),
    mode(v, t){ fx.select(); mode = v; ls.set('bearings.explore', v); ExploreView.update(t.closest('.screen')); },
    sector: v => showSector(v),
    unit: v => openUnit(v),
    year(v, t){ const y = +v; if (clusters) clusters.setYear(y); const b = t.parentElement.querySelector('.yr'); if (b) b.textContent = y; },
    play(_, t){
      if (!clusters) return;
      if (playing){ playing = false; t.innerHTML = icon('play'); return; }
      const d = clusters.d, range = t.parentElement.querySelector('input'), lab = t.parentElement.querySelector('.yr');
      playing = true; t.innerHTML = icon('pause');
      let y = d.minYear;
      const step = () => { if (!playing || !clusters) return; range.value = y; lab.textContent = y; clusters.setYear(y); if (y >= d.maxYear){ playing = false; t.innerHTML = icon('play'); return; } y++; setTimeout(step, 650); };
      step();
    },
    async mapSearch(v, t){
      const q = (v || '').trim(); if (!q) return;
      await loadGeo(); const hit = lookup(q);
      if (!hit){ import_show(`Couldn’t find “${q}”. Try a city and state, like Tampa, FL.`); return; }
      MAP.center = {lat: hit.lat, lon: hit.lon}; MAP.centerName = hit.name;
      const el = t.closest('.screen'); ExploreView.update(el); if (map) map.m.setView([hit.lat, hit.lon], MAP.radius > 100 ? 6 : 8);
    },
    nearMe(_, t){
      if (!navigator.geolocation){ import_show('Location isn’t available here. Search for a city instead.'); return; }
      const el = t.closest('.screen');
      navigator.geolocation.getCurrentPosition(p => { MAP.center = {lat: p.coords.latitude, lon: p.coords.longitude}; MAP.centerName = ''; ExploreView.update(el); if (map) map.m.setView([MAP.center.lat, MAP.center.lon], 8); },
        () => import_show('Location isn’t available. Allow it in settings, or search for a city.'), {maximumAge: 600000, timeout: 15000});
    },
    radius(v, t){ MAP.radius = +v; fx.select(); ExploreView.update(t.closest('.screen')); },
    mapClear(_, t){ MAP.center = null; MAP.centerName = ''; ExploreView.update(t.closest('.screen')); if (map) map.m.setView([37.5, -92], 3); },
    place: v => openPlace(v),
    locate: () => locate(),
    rankCell(v){ const [tier, branch] = v.split('\u0001'); showPeople({tier: [tier], branch: [branch]}); },
  },
};
let playing = false;
import { show as import_show } from './model.js';
