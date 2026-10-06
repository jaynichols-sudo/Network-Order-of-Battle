// The compass: you in the middle, everyone you know around you. Distance is how
// close you are, direction is their sector. A sweep arm lights people up as it
// passes; people waiting on you glow amber and new jobs pulse. A port of Compass.swift.
import { palette, rgba, meAvatar, REDUCED } from './ui.js';
import { hash } from '../core.js';

const TAU = Math.PI * 2;
const ANGLE_BUCKETS = 48, BANDS = 6, PERIOD = 7;
const normA = a => { const x = a % TAU; return x < 0 ? x + TAU : x; };
const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

export function wedgeAt(data, angle){
  for (const w of data.wedges){
    let a = angle;
    while (a < w.a0) a += TAU;
    while (a >= w.a0 + TAU) a -= TAU;
    if (a < w.a1) return w;
  }
  return null;
}
const dotSize = total => total > 2500 ? 1.9 : total > 900 ? 2.4 : 3.1;

/** Dots grouped into a few hundred paths so a frame stays cheap with thousands of people. */
function buildCache(data, cx, cy, r, dot){
  const map = new Map(), flagged = [];
  for (const d of data.dots){
    const x = cx + Math.cos(d.a) * d.r * r, y = cy + Math.sin(d.a) * d.r * r;
    if (d.f && flagged.length < 500){ flagged.push({d, x, y, color: d.c || '#8F89A8'}); continue; }
    const ab = Math.floor(normA(d.a) / TAU * ANGLE_BUCKETS) % ANGLE_BUCKETS;
    const bb = Math.min(BANDS - 1, Math.floor(d.r * BANDS));
    const id = (d.c || '#8F89A8') + '|' + ab + '|' + bb;
    let b = map.get(id);
    if (!b){ b = {color: d.c || '#8F89A8', angle: (ab + 0.5) / ANGLE_BUCKETS * TAU, band: bb / BANDS, path: new Path2D()}; map.set(id, b); }
    b.path.moveTo(x + dot, y); b.path.arc(x, y, dot, 0, TAU);
  }
  return {buckets: [...map.values()], flagged};
}

/**
 * Draws one frame. `view` is {scale, ox, oy} (the zoom), `focus` a wedge or null.
 * Coordinates are CSS pixels; the caller has already scaled the context for the screen.
 */
export function drawCompass(ctx, data, size, {t = 0, still = false, reduced = false, focus = null, view = {scale: 1, ox: 0, oy: 0}, pal = palette(), cache = null, reveal = 1}){
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  const dot = dotSize(data.total);
  cache = cache || buildCache(data, cx, cy, r, dot);
  const sweep = reduced && !still ? -Math.PI / 2 : ((t % PERIOD) / PERIOD) * TAU - Math.PI / 2;
  const glow = a => { if (reduced && !still) return 1; let behind = (sweep - a) % TAU; if (behind < 0) behind += TAU; return Math.exp(-behind / 2.2); };
  const inFocus = a => !focus || (wedgeAt(data, a) || {}).id === focus.id;
  const prim = pal.dark ? '255,255,255' : '0,0,0';

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, TAU); ctx.clip();
  ctx.translate(cx + view.ox, cy + view.oy); ctx.scale(view.scale, view.scale); ctx.translate(-cx, -cy);

  // grid
  const faint = `rgba(${prim},${pal.dark ? 0.08 : 0.06})`;
  const disk = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  disk.addColorStop(0, rgba(pal.amber, pal.dark ? 0.10 : 0.07)); disk.addColorStop(1, rgba(pal.amber, 0));
  ctx.fillStyle = disk; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  data.rings.forEach((ring, i) => {
    const last = i === data.rings.length - 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * ring.r, 0, TAU);
    ctx.setLineDash(last ? [] : [3, 4]); ctx.lineWidth = last ? 1.2 : 1;
    ctx.strokeStyle = last ? `rgba(${prim},0.18)` : faint; ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const w of data.wedges){ ctx.moveTo(cx + Math.cos(w.a0) * r * 0.12, cy + Math.sin(w.a0) * r * 0.12); ctx.lineTo(cx + Math.cos(w.a0) * r, cy + Math.sin(w.a0) * r); }
  ctx.strokeStyle = faint; ctx.lineWidth = 0.8; ctx.stroke();
  if (focus){
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, focus.a0, focus.a1); ctx.closePath();
    ctx.fillStyle = rgba(focus.color, 0.10); ctx.fill();
  }

  // sweep
  if (!(reduced && !still)){
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, sweep - 0.9, sweep); ctx.closePath();
    const strength = pal.dark ? 0.20 : 0.16;
    if (ctx.createConicGradient){
      const g = ctx.createConicGradient(sweep - 0.9, cx, cy);
      g.addColorStop(0, rgba(pal.amber, 0)); g.addColorStop(0.9 / TAU, rgba(pal.amber, strength)); g.addColorStop(0.9 / TAU + 0.0001, rgba(pal.amber, 0)); g.addColorStop(1, rgba(pal.amber, 0));
      ctx.fillStyle = g;
    } else ctx.fillStyle = rgba(pal.amber, strength / 2);
    ctx.fill();
    const tip = [cx + Math.cos(sweep) * r, cy + Math.sin(sweep) * r];
    const lg = ctx.createLinearGradient(cx, cy, tip[0], tip[1]);
    lg.addColorStop(0, rgba(pal.amber, 0.1)); lg.addColorStop(1, rgba(pal.amber, 0.9));
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip[0], tip[1]); ctx.strokeStyle = lg; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // dots, a bucket at a time
  const base = pal.dark ? 0.42 : 0.5;
  for (const b of cache.buckets){
    if (b.band >= reveal) continue;
    const dim = focus && !inFocus(b.angle) ? 0.25 : 1;
    ctx.globalAlpha = (base + (1 - base) * glow(b.angle)) * dim;
    ctx.fillStyle = b.color; ctx.fill(b.path);
  }
  ctx.globalAlpha = 1;

  // flagged people
  for (const it of cache.flagged){
    if (it.d.r >= reveal) continue;
    const {x, y} = it, dim = inFocus(it.d.a) ? 1 : 0.3;
    const circle = (rad) => { ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); };
    switch (it.d.f){
      case 'w': {
        const halo = dot * 3.4, g = ctx.createRadialGradient(x, y, 0, x, y, halo);
        g.addColorStop(0, rgba(pal.amber, 0.55 * dim)); g.addColorStop(1, rgba(pal.amber, 0));
        ctx.fillStyle = g; circle(halo); ctx.fill();
        ctx.fillStyle = rgba(pal.amber, dim); circle(dot * 1.5); ctx.fill();
        break;
      }
      case 'o': {
        const s = dot * 1.4;
        ctx.fillStyle = rgba(pal.violet, dim); circle(s); ctx.fill();
        ctx.setLineDash([2, 2]); ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(pal.violet, 0.75 * dim); circle(s + 2.4); ctx.stroke(); ctx.setLineDash([]);
        break;
      }
      case 'j': {
        const phase = reduced || still ? 0.4 : (((t + (hash(it.d.k) % 100) / 50) % 2.2) / 2.2);
        ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(pal.info, (1 - phase) * 0.8 * dim); circle(dot * (1.6 + phase * 4)); ctx.stroke();
        ctx.fillStyle = rgba(pal.info, dim); circle(dot * 1.4); ctx.fill();
        break;
      }
      case 'n': {
        const s = dot * 1.4;
        ctx.fillStyle = rgba(it.color, dim); circle(s); ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = rgba(it.color, 0.6 * dim); circle(s + 2); ctx.stroke();
        break;
      }
      default: {
        const s = dot * 1.3;
        ctx.fillStyle = rgba(it.color, dim); circle(s); ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(pal.amber, 0.9 * dim); circle(s + 1.8); ctx.stroke();
      }
    }
  }

  // labels: ring names, and pills for the biggest sectors
  if (!focus){
    ctx.font = '500 9px "Geist Mono", ui-monospace, monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = rgba(pal.text2, 0.85);
    for (const ring of data.rings.slice(0, -1)) ctx.fillText(ring.label.toUpperCase(), cx + 4, cy - r * ring.r + 2);
    ctx.font = '600 11px Geist, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const placed = [];
    for (const w of data.wedges.slice().sort((a, b) => b.n - a.n).slice(0, 6)){
      if (w.a1 - w.a0 <= 0.32) continue;
      const mid = (w.a0 + w.a1) / 2, px = cx + Math.cos(mid) * r * 0.84, py = cy + Math.sin(mid) * r * 0.84;
      const tw = ctx.measureText(w.short).width, th = 13;
      const rect = {x: px - tw / 2 - 7, y: py - th / 2 - 3, w: tw + 14, h: th + 6};
      if (placed.some(p => p.x < rect.x + rect.w && rect.x < p.x + p.w && p.y < rect.y + rect.h && rect.y < p.y + p.h)) continue;
      placed.push(rect);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.h / 2) : ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = pal.dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(w.color, 0.45); ctx.stroke();
      ctx.fillStyle = w.color; ctx.fillText(w.short, px, py + 0.5);
    }
  }
  ctx.restore();
  return cache;
}

/** The interactive compass element: canvas, the "you" avatar, zoom and taps. */
export function createCompass({initials = '', interactive = true, onOpen = () => {}, onFocus = () => {}, onTapSector = null} = {}){
  const el = document.createElement('div');
  el.className = 'compass';
  el.innerHTML = `<canvas></canvas><div class="compass-me">${meAvatar(initials, 46, 2)}</div>`;
  const cv = el.querySelector('canvas'), me = el.querySelector('.compass-me');
  const ctx = cv.getContext('2d');
  let data = {wedges: [], dots: [], rings: [], total: 0, tally: {}}, cache = null, cacheKey = '';
  let size = 0, dpr = 1, focusId = null, raf = 0, visible = false, alive = true;
  let view = {scale: 1, ox: 0, oy: 0}, anim = null, pal = palette();

  const focused = () => focusId ? data.wedges.find(w => w.id === focusId) || null : null;
  function target(){
    const w = focused(); if (!w) return {scale: 1, ox: 0, oy: 0};
    const r = size / 2 - 6, span = w.a1 - w.a0, mid = (w.a0 + w.a1) / 2;
    const scale = Math.min(3.2, Math.max(1.7, 1.6 / Math.max(0.25, span)));
    return {scale, ox: -Math.cos(mid) * 0.6 * r * scale, oy: -Math.sin(mid) * 0.6 * r * scale};
  }
  function resize(){
    const w = Math.round(el.clientWidth); if (!w) return;
    const d = Math.min(window.devicePixelRatio || 1, 3);
    if (w === size && d === dpr) return;
    size = w; dpr = d; cv.width = w * d; cv.height = w * d; cv.style.width = cv.style.height = w + 'px';
    cache = null; view = target(); frame(performance.now());
  }
  function frame(now){
    if (!size) return;
    if (anim){
      const p = Math.min(1, (now - anim.t0) / 550), e = ease(p);
      view = {scale: anim.from.scale + (anim.to.scale - anim.from.scale) * e, ox: anim.from.ox + (anim.to.ox - anim.from.ox) * e, oy: anim.from.oy + (anim.to.oy - anim.from.oy) * e};
      if (p >= 1) anim = null;
    }
    const key = `${data.total}|${data.dots.length && data.dots[0].k}|${size}`;
    if (key !== cacheKey) { cache = null; cacheKey = key; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    cache = drawCompass(ctx, data, size, {t: now / 1000, reduced: REDUCED(), focus: focused(), view, pal, cache});
  }
  function loop(now){ raf = 0; if (!alive) return; frame(now); if (running()) raf = requestAnimationFrame(loop); }
  const running = () => visible && !document.hidden && (!REDUCED() || anim);
  function kick(){ if (!raf && alive){ if (running()) raf = requestAnimationFrame(loop); else frame(performance.now()); } }

  const ro = new ResizeObserver(resize); ro.observe(el);
  const io = new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); kick(); }); io.observe(el);
  const onVis = () => kick(); document.addEventListener('visibilitychange', onVis);

  function setFocus(id, {silent = false} = {}){
    if (id === focusId) return;
    focusId = id;
    const to = target();
    if (REDUCED()) view = to; else anim = {from: Object.assign({}, view), to, t0: performance.now()};
    me.classList.toggle('hidden', !!id);
    el.classList.toggle('zoomed', !!id);
    if (!silent) onFocus(id);
    kick();
  }

  if (interactive){
    el.addEventListener('click', e => {
      const rect = cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const cx = size / 2, cy = size / 2, r = size / 2 - 6;
      // undo the zoom to find where the tap lands on the unscaled compass
      const lx = (x - cx - view.ox) / view.scale + cx, ly = (y - cy - view.oy) / view.scale + cy;
      const f = focused();
      const fromCenter = Math.hypot(lx - cx, ly - cy);
      if (!f && fromCenter < 26) return;
      if (f){
        let best = null, bestD = 20 / view.scale;
        for (const d of data.dots){
          const px = cx + Math.cos(d.a) * d.r * r, py = cy + Math.sin(d.a) * d.r * r, dist = Math.hypot(px - lx, py - ly);
          if (dist < bestD && (wedgeAt(data, d.a) || {}).id === f.id){ bestD = dist; best = d.k; }
        }
        if (best){ onOpen(best); return; }
      }
      if (fromCenter > r * 1.02 || (f && fromCenter < 30 / view.scale)){ setFocus(null); return; }
      const w = wedgeAt(data, Math.atan2(ly - cy, lx - cx));
      if (w){ onTapSector && onTapSector(); setFocus(focusId === w.id ? null : w.id); }
    });
  }

  return {
    el,
    setData(d){ data = d; cache = null; cacheKey = ''; if (focusId && !data.wedges.some(w => w.id === focusId)) setFocus(null); kick(); },
    setFocus, focus: () => focusId,
    setInitials(s){ me.innerHTML = meAvatar(s, 46, 2); },
    retheme(){ pal = palette(); kick(); },
    destroy(){ alive = false; ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); if (raf) cancelAnimationFrame(raf); },
  };
}
