// Constellation view: people cluster around their company or command; you sit at the center.
// Pinch or scroll to zoom, drag to pan, tap a cluster to open it up, long-press a person to peek.
import { hash } from './core.js';

const TAU = Math.PI * 2;
const ease = p => 1 - Math.pow(1 - p, 3);
const h01 = (s, salt) => (hash(salt + s) % 100000) / 100000;

export function createWeb(opts){
  const {canvas: cv, wrap, tip, chip, yearEl, segColor, segShort, onOpen, onPeek, onTap, reduced, esc, fmt} = opts;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, active = false, raf = 0;
  let hubs = [], people = [], byHub = new Map();
  let cam = {x: 0, y: 0, s: 1}, camFrom = null, camTo = null, camT0 = 0;
  let burst = null, year = null, dirty = true, lastData = null;
  const sprites = {};

  function sprite(color){
    if (sprites[color]) return sprites[color];
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.15, color); gr.addColorStop(0.45, color + '55'); gr.addColorStop(1, color + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return (sprites[color] = c);
  }
  function resize(){
    const w = wrap.clientWidth, h = w < 640 ? Math.round(w * 1.15) : Math.round(Math.min(Math.max(w * 0.62, 460), 680));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === W && h === H) return false;
    W = w; H = h; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    return true;
  }
  const toScreen = (x, y) => [W / 2 + (x - cam.x) * cam.s, H / 2 + (y - cam.y) * cam.s];
  const toWorld = (sx, sy) => [(sx - W / 2) / cam.s + cam.x, (sy - H / 2) / cam.s + cam.y];

  /* ----- layout ----- */
  function build(rows, segOrder){
    const groups = new Map();
    for (const r of rows){
      const key = r.cl.agency || r.c || 'No company listed';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    let list = [...groups.entries()].map(([name, ps]) => ({name, ps})).sort((a, b) => b.ps.length - a.ps.length || a.name.localeCompare(b.name));
    const MAX = W < 640 ? 26 : 40;
    const keep = list.slice(0, MAX), rest = list.slice(MAX);
    const other = new Map();
    for (const g of rest) for (const r of g.ps){ const sh = segShort(r.cl.seg), k = sh === 'Other' ? 'Other orgs' : 'Other ' + sh; if (!other.has(k)) other.set(k, []); other.get(k).push(r); }
    list = keep.concat([...other.entries()].map(([name, ps]) => ({name, ps, other: true})));
    // majority segment for color and placement
    for (const h of list){
      const cnt = {}; for (const r of h.ps) cnt[r.cl.seg] = (cnt[r.cl.seg] || 0) + 1;
      h.seg = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
      h.ps.sort((a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn);
    }
    // segment wedges around the center
    const segs = segOrder.filter(s => list.some(h => h.seg === s));
    const segW = segs.map(s => Math.sqrt(list.filter(h => h.seg === s).reduce((a, h) => a + h.ps.length, 0)) + 2);
    const tw = segW.reduce((a, b) => a + b, 0) || 1;
    let a = -Math.PI / 2; const segA = {};
    segs.forEach((s, i) => { const span = segW[i] / tw * TAU; segA[s] = {a0: a, span}; a += span; });
    const prev = new Map(hubs.map(h => [h.name, h]));
    const counter = {};
    const out = list.map(h => {
      const j = counter[h.seg] = (counter[h.seg] || 0) + 1;
      const sa = segA[h.seg];
      const ang = sa.a0 + sa.span * (0.5 + (h01(h.name, 'ang') - 0.5) * 0.8);
      const dist = 210 + Math.sqrt(j) * 120 + h01(h.name, 'd') * 60;
      const p = prev.get(h.name);
      return {name: h.name, seg: h.seg, ps: h.ps, other: !!h.other, ax: Math.cos(ang) * dist, ay: Math.sin(ang) * dist,
        x: p ? p.x : Math.cos(ang) * dist * 0.2, y: p ? p.y : Math.sin(ang) * dist * 0.2, r: p ? p.r : 4, rt: 0, color: segColor(h.seg)};
    });
    // settle: pull to anchors, push apart, keep a ring around the center
    const rad = h => 14 + Math.sqrt(h.ps.length) * 6;
    const P = out.map(h => ({x: h.ax, y: h.ay, R: rad(h)}));
    for (let it = 0; it < 220; it++){
      for (let i = 0; i < P.length; i++){
        const pi = P[i]; pi.x += (out[i].ax - pi.x) * 0.02; pi.y += (out[i].ay - pi.y) * 0.02;
        for (let k = i + 1; k < P.length; k++){
          const pk = P[k], dx = pk.x - pi.x, dy = pk.y - pi.y, d = Math.hypot(dx, dy) || 0.01, min = pi.R + pk.R + 46;
          if (d < min){ const push = (min - d) / 2, ux = dx / d, uy = dy / d; pi.x -= ux * push; pi.y -= uy * push; pk.x += ux * push; pk.y += uy * push; }
        }
        const d0 = Math.hypot(pi.x, pi.y) || 0.01, minC = 120 + pi.R;
        if (d0 < minC){ pi.x *= minC / d0; pi.y *= minC / d0; }
      }
    }
    out.forEach((h, i) => { h.tx = P[i].x; h.ty = P[i].y; h.R = P[i].R; h.fx = h.x; h.fy = h.y; });
    hubs = out;
    // people orbit their hub in rings
    const prevP = new Map(people.map(p => [p.r.k, p]));
    people = []; byHub = new Map();
    const now = performance.now();
    for (const h of hubs){
      const arr = [];
      let ring = 0, idx = 0, cap = 0;
      const start = h01(h.name, 'rot') * TAU;
      for (const r of h.ps){
        if (idx >= cap){ ring++; idx = 0; cap = Math.max(6, Math.floor(TAU * (h.R + 4 + ring * 9) / 9)); }
        const ang = start + idx / cap * TAU + ring * 0.37; idx++;
        const o = prevP.get(r.k);
        const p = {r, h, ang, ring, a: o ? o.a : 0, at: 1, af: o ? o.a : 0, t0: now + (reduced ? 0 : h01(r.k, 'w') * 260), color: segColor(r.cl.seg), sx: 0, sy: 0};
        arr.push(p); people.push(p);
      }
      byHub.set(h.name, arr);
    }
    if (burst && !hubs.find(h => h.name === burst)) setBurst(null, true);
    applyYear(true);
  }
  function applyYear(silent){
    const cut = year ? `${year}-12-31` : null;
    const now = performance.now();
    for (const h of hubs){
      const vis = cut ? h.ps.filter(r => (r.d || '0') <= cut).length : h.ps.length;
      h.vis = vis; h.rf = h.r; h.rt = vis ? 14 + Math.sqrt(vis) * 6 : 0; h.t0 = now;
    }
    for (const p of people){ const on = !cut || (p.r.d || '0') <= cut; p.af = p.a; p.at = on ? 1 : 0; p.t0 = Math.max(p.t0, now - 1) + (silent ? 0 : 0); }
    for (const h of hubs){ h.fx = h.x; h.fy = h.y; h.t0h = now; }
    dirty = true; kick();
  }
  function fit(){
    const vis = hubs.filter(h => h.vis > 0);
    if (!vis.length) return {x: 0, y: 0, s: 1};
    let x0 = -60, x1 = 60, y0 = -60, y1 = 60;
    for (const h of vis){ x0 = Math.min(x0, h.tx - h.R - 30); x1 = Math.max(x1, h.tx + h.R + 30); y0 = Math.min(y0, h.ty - h.R - 30); y1 = Math.max(y1, h.ty + h.R + 40); }
    const s = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.94;
    return {x: (x0 + x1) / 2, y: (y0 + y1) / 2, s: Math.max(0.12, Math.min(2.2, s))};
  }
  function flyTo(target){ camFrom = {...cam}; camTo = target; camT0 = performance.now(); if (reduced){ cam = {...camTo}; camTo = null; } kick(); }
  function setBurst(name, quiet){
    burst = name;
    const h = name && hubs.find(x => x.name === name);
    chip.hidden = !h;
    if (h){
      chip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>${esc(h.name)} <span style="color:var(--ink-2);font-weight:500">${fmt(h.vis)}</span>`;
      const span = (h.R + 9 * Math.ceil(h.ps.length / 10) + 40) * 1.9 * 2;
      flyTo({x: h.tx, y: h.ty, s: Math.min(5, Math.min(W, H) / span)});
    } else if (!quiet) flyTo(fit());
    dirty = true; kick();
  }

  /* ----- frame ----- */
  function kick(){ if (active && !raf) raf = requestAnimationFrame(frame); }
  function frame(now){
    raf = 0; if (!active || document.hidden) return;
    if (resize() && W > 0 && !burst){ cam = fit(); camTo = null; }
    let moving = false;
    if (camTo){ const p = Math.min(1, (now - camT0) / 700), e = ease(p); cam = {x: camFrom.x + (camTo.x - camFrom.x) * e, y: camFrom.y + (camTo.y - camFrom.y) * e, s: camFrom.s * Math.pow(camTo.s / camFrom.s, e)}; if (p >= 1){ cam = {...camTo}; camTo = null; } else moving = true; }
    for (const h of hubs){
      const p = reduced ? 1 : Math.min(1, (now - (h.t0h || 0)) / 900), e = ease(p);
      h.x = h.fx + (h.tx - h.fx) * e; h.y = h.fy + (h.ty - h.fy) * e;
      const q = reduced ? 1 : Math.min(1, (now - (h.t0 || 0)) / 600);
      h.r = (h.rf ?? h.r) + (h.rt - (h.rf ?? h.r)) * ease(q);
      if (p < 1 || q < 1) moving = true;
    }
    for (const p of people){
      const q = reduced ? 1 : Math.max(0, Math.min(1, (now - p.t0) / 500));
      p.a = p.af + (p.at - p.af) * ease(q);
      if (q < 1) moving = true;
    }
    draw(now);
    if (moving || dirty){ dirty = false; raf = requestAnimationFrame(frame); }
  }

  function draw(){
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const [cx, cy] = toScreen(0, 0);
    // links from you to each organization
    for (const h of hubs){
      if (h.r < 0.5) continue;
      const [hx, hy] = toScreen(h.x, h.y);
      const mx = (cx + hx) / 2, my = (cy + hy) / 2, nx = -(hy - cy) * 0.12, ny = (hx - cx) * 0.12;
      ctx.strokeStyle = h.color; ctx.globalAlpha = burst && burst !== h.name ? 0.05 : 0.16; ctx.lineWidth = Math.max(1, Math.log2(h.vis + 1) * 0.8);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(mx + nx, my + ny, hx, hy); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
    // hubs
    for (const h of hubs){
      if (h.r < 0.5) continue;
      const [hx, hy] = toScreen(h.x, h.y), rr = h.r * cam.s, dim = burst && burst !== h.name;
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.fillStyle = h.color + '22'; ctx.strokeStyle = h.color + (h.name === burst ? 'ee' : '88');
      ctx.lineWidth = h.name === burst ? 2 : 1;
      ctx.beginPath(); ctx.arc(hx, hy, rr, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;
    // people
    const dot = Math.max(1.4, Math.min(4.2, 2.6 * Math.sqrt(cam.s)));
    ctx.globalCompositeOperation = 'lighter';
    for (const p of people){
      if (p.a < 0.02) continue;
      const h = p.h, spread = h.name === burst ? 1.9 : 1;
      const pr = (h.r + 4 + p.ring * 9 * spread) * (h.r / Math.max(h.R, 1) > 0 ? 1 : 0);
      const wx = h.x + Math.cos(p.ang) * pr, wy = h.y + Math.sin(p.ang) * pr;
      const [sx, sy] = toScreen(wx, wy); p.sx = sx; p.sy = sy;
      if (sx < -8 || sy < -8 || sx > W + 8 || sy > H + 8) continue;
      const dim = burst && burst !== h.name ? 0.18 : 1;
      const star = p.r.ed && p.r.ed.star;
      const sz = dot * (star || p.r.isNew ? 2.6 : 2) * (h.name === burst ? 1.25 : 1);
      ctx.globalAlpha = p.a * dim;
      ctx.drawImage(sprite(p.color), sx - sz, sy - sz, sz * 2, sz * 2);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // stars and new rings
    for (const p of people){
      if (p.a < 0.5 || (burst && burst !== p.h.name)) continue;
      const star = p.r.ed && p.r.ed.star;
      if (!star && !p.r.isNew) continue;
      ctx.strokeStyle = p.r.isNew ? 'rgba(255,107,91,.9)' : 'rgba(255,181,71,.9)';
      ctx.beginPath(); ctx.arc(p.sx, p.sy, dot * 2.2, 0, TAU); ctx.stroke();
    }
    // labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const placed = [];
    const order = hubs.slice().sort((a, b) => (b.name === burst) - (a.name === burst) || b.vis - a.vis);
    for (const h of order){
      if (h.r < 0.5) continue;
      const rr = h.r * cam.s; if (rr < 9 && h.name !== burst) continue;
      const [hx, hy] = toScreen(h.x, h.y);
      const dim = burst && burst !== h.name;
      const name = h.name.length > 26 ? h.name.slice(0, 25) + '…' : h.name;
      const ly = hy + rr + (h.name === burst ? 9 * Math.ceil(h.vis / 10) * cam.s + 12 : 8) + Math.min(28, (h.ps.length > 6 ? 18 : 10) * cam.s);
      ctx.font = `600 ${Math.round(Math.max(11, Math.min(15, 10 + rr / 10)))}px "Chakra Petch", sans-serif`;
      const lw = ctx.measureText(name).width / 2 + 4, box = [hx - lw, ly - 2, hx + lw, ly + 30];
      if (placed.some(q => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
      placed.push(box);
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,17,31,.85)'; ctx.strokeText(name, hx, ly); ctx.fillStyle = '#E8EEF8'; ctx.fillText(name, hx, ly);
      ctx.font = '500 11px "IBM Plex Sans", sans-serif'; ctx.fillStyle = h.color; ctx.fillText(fmt(h.vis), hx, ly + 16);
    }
    ctx.globalAlpha = 1;
    // names inside an opened cluster
    if (burst){
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '500 12px "IBM Plex Sans", sans-serif';
      const list = (byHub.get(burst) || []).filter(p => p.a > 0.5).slice(0, cam.s > 1.6 ? 40 : 18);
      for (const p of list){
        const label = `${p.r.f} ${p.r.l}${p.r.cl.grade ? ' · ' + p.r.cl.grade : ''}`;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,17,31,.9)'; ctx.strokeText(label, p.sx + 8, p.sy); ctx.fillStyle = '#C9D6E8'; ctx.fillText(label, p.sx + 8, p.sy);
      }
    }
    // you
    const yr = Math.max(14, 30 * Math.min(1.4, cam.s));
    ctx.fillStyle = '#0B1729'; ctx.beginPath(); ctx.arc(cx, cy, yr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,71,.85)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#E8EEF8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${Math.round(yr * 0.5)}px "Chakra Petch", sans-serif`;
    ctx.fillText('YOU', cx, cy + 1);
  }

  /* ----- input: pan, pinch, wheel, tap, long-press ----- */
  const ptrs = new Map(); let gesture = null, pressT = 0, moved = false;
  function hitTest(sx, sy){
    let best = null, bd = 12 * 12;
    for (const p of people){ if (p.a < 0.5 || (burst && burst !== p.h.name)) continue; const d = (p.sx - sx) ** 2 + (p.sy - sy) ** 2; if (d < bd){ bd = d; best = p; } }
    let hub = null;
    for (const h of hubs){ if (h.r < 0.5) continue; const [hx, hy] = toScreen(h.x, h.y); const rr = h.r * cam.s + (h.name === burst ? 9 * Math.ceil(h.vis / 10) * cam.s * 1.9 : 6); if ((hx - sx) ** 2 + (hy - sy) ** 2 < rr * rr){ hub = h; break; } }
    return {person: best, hub};
  }
  const local = e => { const rc = cv.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, local(e));
    moved = false; camTo = null;
    if (ptrs.size === 1){
      const [x, y] = local(e); gesture = {type: 'pan', x, y, cam: {...cam}};
      clearTimeout(pressT);
      pressT = setTimeout(() => { if (!moved){ const {person} = hitTest(x, y); if (person){ moved = true; onPeek(person.r); } } }, 480);
    } else if (ptrs.size === 2){
      clearTimeout(pressT);
      const [a, b] = [...ptrs.values()];
      gesture = {type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], cam: {...cam}};
    }
  });
  cv.addEventListener('pointermove', e => {
    const pt = local(e);
    if (!ptrs.has(e.pointerId)){
      if (e.pointerType === 'mouse'){ const {person, hub} = hitTest(pt[0], pt[1]); showTip(person, hub, pt); cv.style.cursor = person ? 'pointer' : hub ? 'zoom-in' : 'grab'; }
      return;
    }
    ptrs.set(e.pointerId, pt);
    if (gesture && gesture.type === 'pan' && ptrs.size === 1){
      const dx = pt[0] - gesture.x, dy = pt[1] - gesture.y;
      if (Math.hypot(dx, dy) > 6){ moved = true; clearTimeout(pressT); }
      if (moved){ cam.x = gesture.cam.x - dx / cam.s; cam.y = gesture.cam.y - dy / cam.s; dirty = true; kick(); tip.hidden = true; }
    } else if (gesture && gesture.type === 'pinch' && ptrs.size === 2){
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const s = Math.max(0.1, Math.min(6, gesture.cam.s * d / gesture.d));
      const wx = (gesture.mid[0] - W / 2) / gesture.cam.s + gesture.cam.x, wy = (gesture.mid[1] - H / 2) / gesture.cam.s + gesture.cam.y;
      cam = {s, x: wx - (mid[0] - W / 2) / s, y: wy - (mid[1] - H / 2) / s};
      moved = true; dirty = true; kick();
    }
  });
  const up = e => {
    clearTimeout(pressT);
    const wasSingle = ptrs.size === 1;
    ptrs.delete(e.pointerId);
    if (ptrs.size === 1){ const [p] = [...ptrs.values()]; gesture = {type: 'pan', x: p[0], y: p[1], cam: {...cam}}; return; }
    if (ptrs.size) return;
    gesture = null;
    if (wasSingle && !moved && e.type === 'pointerup'){
      const [x, y] = local(e);
      const {person, hub} = hitTest(x, y);
      if (person && (burst === person.h.name || cam.s > 1.3)){ onOpen(person.r.k); return; }
      if (hub){ onTap(); setBurst(burst === hub.name ? null : hub.name); return; }
      if (burst){ onTap(); setBurst(null); }
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = local(e), k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
    const [wx, wy] = toWorld(x, y), s = Math.max(0.1, Math.min(6, cam.s * k));
    cam = {s, x: wx - (x - W / 2) / s, y: wy - (y - H / 2) / s}; camTo = null; dirty = true; kick();
  }, {passive: false});
  function showTip(person, hub, [x, y]){
    if (person){ const r = person.r; tip.innerHTML = `<b>${esc(r.f)} ${esc(r.l)}</b><span>${esc(r.p || '')}</span>`; }
    else if (hub){ tip.innerHTML = `<b>${esc(hub.name)}</b><span>${fmt(hub.vis)} ${hub.vis === 1 ? 'person' : 'people'}. Click to open.</span>`; }
    else { tip.hidden = true; return; }
    tip.hidden = false; tip.style.left = Math.min(x + 16, W - 270) + 'px'; tip.style.top = Math.min(y + 14, H - 80) + 'px';
  }
  chip.addEventListener('click', () => { onTap(); setBurst(null); });
  window.addEventListener('resize', () => { if (active && resize()){ dirty = true; kick(); } });
  document.addEventListener('visibilitychange', kick);

  return {
    update(rows, segOrder){
      lastData = [rows, segOrder];
      if (!active) return;
      resize(); build(rows, segOrder);
      if (!burst) flyTo(fit());
      kick();
    },
    setActive(on){
      active = on;
      if (on){ W = 0; resize(); if (lastData) { build(...lastData); if (!burst){ cam = fit(); } } dirty = true; kick(); }
    },
    setYear(y){ year = y; yearEl.textContent = y ? String(y) : ''; yearEl.classList.toggle('show', !!y); applyYear(); },
    years(rows){ const ys = rows.map(r => +(r.d || '').slice(0, 4)).filter(Boolean); return ys.length ? [Math.min(...ys), Math.max(...ys)] : null; },
    redraw(){ dirty = true; kick(); },
  };
}
