import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import {
  esc, fmt, isoDay, TODAY, daysAgo, niceDate, h01, hash,
  SEGS, SEGI, BRANCHES, STATUSES, TIERS, SENIORITY, FUNCS, SINCE, SIGNALS, GRADE_OPTS, CERTS,
  classify, keyOf, stripRow, readFile, mergeImport, sampleNetwork,
} from './core.js';

const CloudStore = registerPlugin('CloudStore');
const NATIVE = Capacitor.isNativePlatform();
const PLATFORM = Capacitor.getPlatform();
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Segment colors tuned to glow on navy */
const SEG_COLORS = ['#B7D25A', '#66A8FF', '#43D0C0', '#A58BFF', '#FFD166', '#FF6FA8', '#FF8A5C', '#D8B48A', '#8FA3BF', '#5B6B83'];
const segColor = seg => SEG_COLORS[SEGI[seg] ?? 9];
const initials = r => ((r.f || '?')[0] + (r.l || '')[0] || '').toUpperCase();
const ICON = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

/* ---------- preferences, haptics, sound ---------- */
const prefs = {haptics: true, sound: true};
try { Object.assign(prefs, JSON.parse(localStorage.getItem('oob.prefs') || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem('oob.prefs', JSON.stringify(prefs)); } catch {} };
let actx = null;
function tone(notes, {type = 'sine', gain = 0.05, dur = 0.12, gap = 0.07} = {}){
  if (!prefs.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime + 0.01;
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0 + i * gap);
      g.gain.setValueAtTime(0, t0 + i * gap);
      g.gain.linearRampToValueAtTime(gain, t0 + i * gap + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * gap + dur);
      o.connect(g).connect(actx.destination); o.start(t0 + i * gap); o.stop(t0 + i * gap + dur + 0.02);
    });
  } catch {}
}
const buzz = (style) => { if (NATIVE && prefs.haptics) Haptics.impact({style}).catch(() => {}); };
const fx = {
  tap(){ buzz(ImpactStyle.Light); },
  select(){ buzz(ImpactStyle.Light); tone([1320], {gain: 0.018, dur: 0.05}); },
  star(){ buzz(ImpactStyle.Medium); tone([880, 1320], {gain: 0.05}); },
  unstar(){ buzz(ImpactStyle.Light); tone([660], {gain: 0.03, dur: 0.08}); },
  skip(){ buzz(ImpactStyle.Light); tone([420], {type: 'triangle', gain: 0.035, dur: 0.07}); },
  success(){ if (NATIVE && prefs.haptics) Haptics.notification({type: NotificationType.Success}).catch(() => {}); tone([660, 880, 1320], {gain: 0.045, gap: 0.09, dur: 0.18}); },
};

/* ---------- state ---------- */
const S = {all: [], edits: {}, review: {}, meta: null, mode: 'sample', rev: null, tab: 'map', sort: 'new', shown: 60, sel: null, deck: 'week', pending: null, syncNote: ''};
const F = {q: '', seg: new Set, branch: new Set, status: new Set, tier: new Set, sen: new Set, func: new Set, cert: new Set, sig: new Set, agency: '', company: '', since: '', removed: false};
let VIEW = [];

function hydrate(rows){
  const imp = (S.meta && S.meta.n) || 0;
  S.all = rows.map(r => {
    const k = r.k || keyOf(r);
    const ed = S.edits[k];
    const cl = classify(r, ed);
    const isNew = S.mode === 'sample' ? !!r._new : (imp > 1 && r.fi === imp);
    const lastImp = S.meta && S.meta.lastImport;
    const movedNow = !!r.jc && (S.mode === 'sample' ? daysAgo(r.jc) < 8 : r.jc === lastImp);
    const hay = [r.f, r.l, r.p, r.c, cl.agency, cl.rank, cl.grade, cl.branch, ed && ed.note, ed && (ed.tags || []).join(' ')].join(' ').toLowerCase();
    return Object.assign({}, r, {k, cl, ed: ed || null, isNew, movedNow, hay});
  });
}

/* ---------- filtering ---------- */
function sinceOk(r){
  if (!F.since) return true;
  const d = daysAgo(r.d);
  if (F.since === 'o1') return d > 365;
  if (F.since === 'o5') return d > 1825;
  return d <= +F.since;
}
function sigOk(r, s){
  switch (s){
    case 'new': return r.isNew;
    case 'jc': return !!r.jc;
    case 'star': return !!(r.ed && r.ed.star);
    case 'notes': return !!(r.ed && (r.ed.note || (r.ed.tags && r.ed.tags.length)));
    case 'email': return !!r.e;
    case 'gov': return /\.(gov|mil)$/i.test(r.e || '');
    case 'clr': return r.cl.clr;
  }
  return true;
}
function match(r, skip){
  if (!F.removed && r.x) return false;
  const c = r.cl;
  if (skip !== 'seg' && F.seg.size && !F.seg.has(c.seg)) return false;
  if (skip !== 'branch' && F.branch.size && !F.branch.has(c.branch)) return false;
  if (skip !== 'status' && F.status.size && !F.status.has(c.status)) return false;
  if (skip !== 'tier' && F.tier.size && !F.tier.has(c.tier)) return false;
  if (skip !== 'sen' && F.sen.size && !F.sen.has(c.sen)) return false;
  if (skip !== 'func' && F.func.size && !F.func.has(c.func)) return false;
  if (skip !== 'cert' && F.cert.size && !c.certs.some(x => F.cert.has(x))) return false;
  if (skip !== 'sig' && F.sig.size) for (const s of F.sig) if (!sigOk(r, s)) return false;
  if (skip !== 'agency' && F.agency && c.agency !== F.agency) return false;
  if (skip !== 'company' && F.company && (r.c || '') !== F.company) return false;
  if (skip !== 'since' && !sinceOk(r)) return false;
  if (F.q){ for (const t of F.q.toLowerCase().split(/\s+/)) if (t && !r.hay.includes(t)) return false; }
  return true;
}
const activeCount = () => F.seg.size + F.branch.size + F.status.size + F.tier.size + F.sen.size + F.func.size + F.cert.size + F.sig.size + (F.agency ? 1 : 0) + (F.company ? 1 : 0) + (F.since ? 1 : 0) + (F.removed ? 1 : 0);

/* ---------- render orchestration ---------- */
function render(){
  VIEW = S.all.filter(r => match(r));
  renderHeader(); renderStats(); renderActive(); renderBadge();
  renderTab();
  if (Sheet.kind === 'filters') renderFilterSheet(true);
}
function renderTab(){
  if (S.tab === 'map') Radar.update();
  if (S.tab === 'ranks') renderRanks();
  if (S.tab === 'orgs') renderOrgs();
  if (S.tab === 'people') renderPeople(true);
  if (S.tab === 'review') Deck.render();
}
function setTab(t, {silent} = {}){
  if (!silent && t !== S.tab) fx.select();
  S.tab = t;
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('.view').forEach(v => { const on = v.dataset.view === t; if (on && v.hidden){ v.hidden = false; v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); } else if (!on) v.hidden = true; });
  document.body.classList.toggle('tab-review', t === 'review');
  try { localStorage.setItem('oob.tab', t); } catch {}
  Radar.setActive(t === 'map');
  renderTab();
}

/* ---------- header, stats, chips ---------- */
function renderHeader(){
  const active = S.all.filter(r => !r.x).length;
  const last = S.meta && S.meta.lastImport;
  $('#sub').textContent = `${fmt(active)} contacts${last ? ', refreshed ' + niceDate(last) : ''}`;
  const sync = $('#sync');
  const due = last && daysAgo(last) >= 7;
  const label = Store.kind === 'icloud' ? 'iCloud' : Store.kind === 'device' ? 'On device' : 'Browser';
  sync.className = 'sync' + (due ? ' due' : Store.kind === 'icloud' ? ' on' : '');
  sync.innerHTML = `<i></i><span>${due ? 'Refresh due' : label}</span>`;
  sync.title = due ? `Last refreshed ${niceDate(last)}. Import this week's export.` : `Saved: ${label}`;
  const b = $('#banner');
  if (S.syncNote){ b.hidden = false; b.innerHTML = `<strong>Syncing</strong><span>${esc(S.syncNote)}</span>`; }
  else if (S.mode === 'live') b.hidden = true;
  else { b.hidden = false; b.innerHTML = `<strong>Sample network</strong><span>These are generated examples so you can explore. Import your LinkedIn export to load your real connections.</span><button class="btn primary" type="button" data-act="import">Import my connections</button>`; }
}

const countAnim = new Map();
function animateNumber(el, to){
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (REDUCED || from === to){ el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 650;
  const id = Symbol(); countAnim.set(el, id);
  const step = now => {
    if (countAnim.get(el) !== id) return;
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function renderStats(){
  const n = fn => VIEW.reduce((a, r) => a + (fn(r) ? 1 : 0), 0);
  const total = S.all.filter(r => !r.x).length;
  const newCount = n(r => r.isNew);
  const tiles = [
    {id: 'all', l: 'In view', v: VIEW.length, d: activeCount() || F.q ? `of ${fmt(total)}` : newCount ? `+${fmt(newCount)} this week` : 'whole network', up: !activeCount() && newCount > 0, act: 'clear'},
    {id: 'dod', l: 'DoD and military', v: n(r => r.cl.seg === 'DoD & Military'), d: 'serving, civilians, commands', act: 'seg:DoD & Military'},
    {id: 'vet', l: 'Veterans', v: n(r => r.cl.status === 'Veteran / Retired'), d: 'any employer', act: 'status:Veteran / Retired'},
    {id: 'fed', l: 'Federal civilian', v: n(r => r.cl.seg === 'Federal Civilian'), d: 'non-DoD agencies', act: 'seg:Federal Civilian'},
    {id: 'jc', l: 'Moved jobs', v: n(r => !!r.jc), d: 'title or company changed', act: 'sig:jc'},
    {id: 'star', l: 'Starred', v: n(r => r.ed && r.ed.star), d: 'your shortlist', act: 'sig:star'},
  ];
  const box = $('#stats');
  if (!box.children.length) box.innerHTML = tiles.map(t => `<button class="stat" type="button" data-stat="${t.id}"><span class="v" data-v="0">0</span><span class="l"></span><span class="d"></span></button>`).join('');
  tiles.forEach(t => {
    const el = box.querySelector(`[data-stat="${t.id}"]`);
    el.dataset.kpi = t.act;
    const [g, val] = t.act.split(/:(.+)/);
    el.classList.toggle('on', g !== 'clear' && F[g] && F[g].size === 1 && F[g].has(val));
    animateNumber(el.querySelector('.v'), t.v);
    el.querySelector('.l').textContent = t.l;
    const d = el.querySelector('.d'); d.textContent = t.d; d.classList.toggle('up', !!t.up);
  });
}
function renderActive(){
  const parts = [];
  if (F.q) parts.push(['q', '', `“${F.q}”`]);
  for (const g of ['seg', 'branch', 'status', 'tier', 'sen', 'func', 'cert']) for (const v of F[g]) parts.push([g, v, v]);
  for (const v of F.sig) parts.push(['sig', v, (SIGNALS.find(s => s[0] === v) || [, v])[1]]);
  if (F.agency) parts.push(['agency', '', F.agency]);
  if (F.company) parts.push(['company', '', F.company]);
  if (F.since) parts.push(['since', '', SINCE.find(s => s[0] === F.since)[1]]);
  if (F.removed) parts.push(['removed', '', 'Including removed']);
  $('#active').innerHTML = parts.map(([g, v, l]) => `<button type="button" class="achip" data-rm="${g}" data-v="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)}${ICON.x}</button>`).join('') + (parts.length > 1 ? '<button type="button" class="achip clear" data-act="clear">Clear all</button>' : '');
  const n = activeCount(); const b = $('#fcount'); b.hidden = !n; b.textContent = n;
}

/* ---------- radar ---------- */
const Radar = (() => {
  const cv = $('#radar'), ctx = cv.getContext('2d'), wrap = $('#scope'), tip = $('#tip'), chip = $('#zoomChip');
  let W = 0, H = 0, dpr = 1, R = 0, active = false, raf = 0;
  const dots = new Map();          // k -> {x,y,fx,fy,tx,ty,a,fa,ta,t0,delay,c,r}
  let wedges = [], view = {cx: 0, cy: 0, s: 1}, viewFrom = null, viewTo = null, viewT0 = 0;
  let zoomSeg = null, sweep = -Math.PI / 2, lastNow = 0, bootT0 = 0, booted = false;
  const sprites = {};
  const BANDS = [0.15, 0.37, 0.58, 0.79, 1.0];
  const ease = p => 1 - Math.pow(1 - p, 3);

  function sprite(color){
    if (sprites[color]) return sprites[color];
    const c = document.createElement('canvas'); c.width = c.height = 48;
    const g = c.getContext('2d'), gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.07, color); gr.addColorStop(0.22, color + 'aa'); gr.addColorStop(0.5, color + '22'); gr.addColorStop(1, color + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
    return (sprites[color] = c);
  }
  function resize(){
    const w = wrap.clientWidth;
    const h = w < 640 ? Math.round(w * 1.02) : Math.round(Math.min(Math.max(w * 0.62, 420), 640));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === W && h === H) return;
    W = w; H = h; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    R = Math.min(W, H) / 2 - (W < 640 ? 18 : 64);
  }
  const toScreen = (x, y) => [W / 2 + (x - view.cx) * view.s * R, H / 2 + (y - view.cy) * view.s * R];

  function layout(){
    const inView = VIEW.filter(r => F.removed || !r.x);
    const counts = SEGS.map(s => inView.filter(r => r.cl.seg === s.id).length);
    const present = SEGS.map((s, i) => ({s, i, n: counts[i]})).filter(p => p.n);
    const wts = present.map(p => Math.max(Math.pow(p.n, 0.55), 2.2));
    const tw = wts.reduce((a, b) => a + b, 0) || 1;
    let a = -Math.PI / 2;
    wedges = present.map((p, j) => { const span = wts[j] / tw * Math.PI * 2; const w = {seg: p.s.id, i: p.i, a0: a, a1: a + span, n: p.n, dens: Math.max(0.3, Math.min(1, Math.sqrt(45 / (p.n / span))))}; a += span; return w; });
    const byI = new Map(wedges.map(w => [w.i, w]));
    const now = performance.now();
    const seen = new Set();
    for (const r of inView){
      const w = byI.get(SEGI[r.cl.seg]); if (!w) continue;
      const span = w.a1 - w.a0, pad = Math.min(0.02, span * 0.15);
      const t = w.a0 + pad + h01(r.k, 'a') * (span - 2 * pad);
      const band = Math.min(Math.max(r.cl.lv, 1), 4) - 1;
      const rr = BANDS[band] + (0.1 + 0.8 * h01(r.k, 'r')) * (BANDS[band + 1] - BANDS[band]);
      const tx = Math.cos(t) * rr, ty = Math.sin(t) * rr;
      let d = dots.get(r.k);
      if (!d){ d = {x: 0, y: 0, a: 0, fx: 0, fy: 0, fa: 0}; dots.set(r.k, d); }
      d.fx = d.x; d.fy = d.y; d.fa = d.a; d.tx = tx; d.ty = ty; d.ta = 1; d.t0 = now; d.delay = REDUCED ? 0 : h01(r.k, 'd') * 180;
      d.c = segColor(r.cl.seg); d.r = r; d.dens = w.dens; d.ang = Math.atan2(ty, tx);
      d.big = r.isNew || (r.ed && r.ed.star);
      seen.add(r.k);
    }
    for (const [k, d] of dots) if (!seen.has(k)){ d.fx = d.x; d.fy = d.y; d.fa = d.a; d.tx = d.x * 1.08; d.ty = d.y * 1.08; d.ta = 0; d.t0 = now; d.delay = 0; }
    if (zoomSeg && !wedges.find(w => w.seg === zoomSeg)) zoomTo(null);
    else if (zoomSeg) zoomTo(zoomSeg, true);
    renderLegend(counts);
  }
  function wedgeView(w){
    const pts = [];
    for (let i = 0; i <= 16; i++){ const t = w.a0 + (w.a1 - w.a0) * i / 16; pts.push([Math.cos(t), Math.sin(t)], [Math.cos(t) * 0.15, Math.sin(t) * 0.15]); }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min(3.4, Math.min((W - 40) / ((x1 - x0) * R), (H - 70) / ((y1 - y0) * R)));
    return {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + 0.02, s: Math.max(1, s)};
  }
  function zoomTo(seg, quiet){
    zoomSeg = seg;
    const w = seg && wedges.find(x => x.seg === seg);
    viewFrom = {...view}; viewTo = w ? wedgeView(w) : {cx: 0, cy: 0, s: 1}; viewT0 = performance.now();
    if (REDUCED){ view = {...viewTo}; viewTo = null; }
    chip.hidden = !w;
    if (w){ const vis = VIEW.filter(r => r.cl.seg === seg).length; chip.innerHTML = `${ICON.back}${esc(seg)} <span style="color:var(--ink-2);font-weight:500">${fmt(vis)}</span>`; }
    if (!quiet) fx.tap();
    kick();
  }
  function renderLegend(counts){
    $('#legend').innerHTML = SEGS.map((s, i) => counts[i] || F.seg.has(s.id) ? `<button type="button" class="${F.seg.has(s.id) ? 'on' : ''}" data-g="seg" data-v="${esc(s.id)}"><i style="background:${SEG_COLORS[i]};color:${SEG_COLORS[i]}"></i>${esc(s.id)} <em>${fmt(counts[i])}</em></button>` : '').join('');
  }

  function frame(now){
    raf = 0;
    if (!active || document.hidden) return;
    const dt = Math.min(64, now - (lastNow || now)); lastNow = now;
    if (!bootT0) bootT0 = now;
    // boot: one fast sweep reveals the scope, then a calm 6 s rotation
    const bootP = REDUCED ? 1 : Math.min(1, (now - bootT0) / 1500);
    if (!booted){ sweep = -Math.PI / 2 + ease(bootP) * Math.PI * 2; if (bootP >= 1) booted = true; }
    else if (!REDUCED) sweep += dt / 6000 * Math.PI * 2;
    if (viewTo){ const p = Math.min(1, (now - viewT0) / 650), e = ease(p); view = {cx: viewFrom.cx + (viewTo.cx - viewFrom.cx) * e, cy: viewFrom.cy + (viewTo.cy - viewFrom.cy) * e, s: viewFrom.s + (viewTo.s - viewFrom.s) * e}; if (p >= 1){ view = {...viewTo}; viewTo = null; } }
    draw(now, bootP);
    if (!REDUCED || viewTo || anyMoving(now)) raf = requestAnimationFrame(frame);
  }
  function anyMoving(now){ for (const d of dots.values()) if (now - d.t0 - d.delay < 750) return true; return false; }
  function kick(){ if (active && !raf) raf = requestAnimationFrame(frame); }

  function draw(now, bootP){
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const [cx, cy] = toScreen(0, 0), S_ = view.s * R;
    // rings and spokes
    ctx.lineWidth = 1;
    for (let i = 1; i < BANDS.length; i++){
      ctx.beginPath(); ctx.arc(cx, cy, BANDS[i] * S_, 0, Math.PI * 2);
      ctx.strokeStyle = i === BANDS.length - 1 ? 'rgba(150,180,220,.32)' : 'rgba(150,180,220,.13)';
      ctx.setLineDash(i === BANDS.length - 1 ? [] : [2, 5]); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(150,180,220,.28)';
    for (let d = 0; d < 360; d += 5){ const t = d * Math.PI / 180, len = d % 30 === 0 ? 9 : 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(t) * S_, cy + Math.sin(t) * S_); ctx.lineTo(cx + Math.cos(t) * (S_ - len), cy + Math.sin(t) * (S_ - len)); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(150,180,220,.12)';
    for (const w of wedges){ ctx.beginPath(); ctx.moveTo(cx + Math.cos(w.a0) * BANDS[0] * S_, cy + Math.sin(w.a0) * BANDS[0] * S_); ctx.lineTo(cx + Math.cos(w.a0) * S_, cy + Math.sin(w.a0) * S_); ctx.stroke(); }
    if (zoomSeg){ const w = wedges.find(x => x.seg === zoomSeg); if (w){ ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, S_, w.a0, w.a1); ctx.closePath(); ctx.fillStyle = 'rgba(255,181,71,.045)'; ctx.fill(); } }
    // sweep wedge
    if (!REDUCED){
      const trail = 0.9;
      if (ctx.createConicGradient){
        const g = ctx.createConicGradient(sweep - trail, cx, cy);
        g.addColorStop(0, 'rgba(255,181,71,0)'); g.addColorStop(trail / (Math.PI * 2), 'rgba(255,181,71,.13)'); g.addColorStop(trail / (Math.PI * 2) + 0.0001, 'rgba(255,181,71,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, S_, sweep - trail, sweep); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.strokeStyle = 'rgba(255,200,110,.75)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * S_, cy + Math.sin(sweep) * S_); ctx.stroke(); ctx.lineWidth = 1;
    }
    // dots
    const n = dots.size, base = (n > 2500 ? 2.2 : n > 900 ? 2.9 : 3.6) * Math.min(1.8, Math.sqrt(view.s));
    ctx.globalCompositeOperation = 'lighter';
    const swN = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    for (const [k, d] of dots){
      const p = Math.min(1, Math.max(0, (now - d.t0 - d.delay) / 700)), e = REDUCED ? 1 : ease(p);
      d.x = d.fx + (d.tx - d.fx) * e; d.y = d.fy + (d.ty - d.fy) * e; d.a = d.fa + (d.ta - d.fa) * e;
      if (d.a < 0.01){ if (d.ta === 0 && p >= 1) dots.delete(k); continue; }
      // reveal during boot, then ping when the sweep passes
      const ang = ((d.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (!booted){ const rev = ((ang + Math.PI / 2) % (Math.PI * 2)) / (Math.PI * 2); if (rev > bootP) continue; }
      let behind = swN - ang; if (behind < 0) behind += Math.PI * 2;
      const ping = REDUCED ? 0.4 : Math.max(0, 1 - behind / 2.2);
      const [sx, sy] = toScreen(d.x, d.y);
      if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) continue;
      const size = base * (d.big ? 1.4 : 1) * (2.2 + ping * 1.6);
      ctx.globalAlpha = d.a * (d.dens || 1) * (0.3 + 0.7 * ping);
      ctx.drawImage(sprite(d.c), sx - size, sy - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // starred / new rings, selected marker
    for (const d of dots.values()){
      if (d.a < 0.5 || !d.big) continue;
      const [sx, sy] = toScreen(d.x, d.y);
      ctx.strokeStyle = d.r.isNew ? 'rgba(255,107,91,.85)' : 'rgba(255,181,71,.8)';
      ctx.beginPath(); ctx.arc(sx, sy, base * 2.4, 0, Math.PI * 2); ctx.stroke();
    }
    if (S.sel){ const d = dots.get(S.sel); if (d){ const [sx, sy] = toScreen(d.x, d.y); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, base * 3.4, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; } }
    // center
    const cr = Math.max(18, BANDS[0] * S_ - 6);
    ctx.fillStyle = '#0B1729'; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,71,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#E8EEF8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(Math.min(22, cr * 0.42))}px "Chakra Petch", sans-serif`;
    ctx.fillText('YOU', cx, cy - cr * 0.16);
    ctx.font = `500 ${Math.round(Math.min(12, cr * 0.22))}px "IBM Plex Sans", sans-serif`; ctx.fillStyle = '#9DAEC6';
    ctx.fillText(fmt(VIEW.filter(r => F.removed || !r.x).length), cx, cy + cr * 0.3);
    // sector labels (wide screens, full view)
    if (W >= 640 && view.s < 1.05){
      for (const w of wedges){
        const mid = (w.a0 + w.a1) / 2, span = w.a1 - w.a0; if (span < 0.13) continue;
        const lx = cx + Math.cos(mid) * (S_ + 14), ly = cy + Math.sin(mid) * (S_ + 14);
        const c = Math.cos(mid), s = Math.sin(mid);
        ctx.textAlign = Math.abs(c) < 0.2 ? 'center' : c > 0 ? 'left' : 'right';
        ctx.textBaseline = s > 0.5 ? 'top' : s < -0.5 ? 'bottom' : 'middle';
        ctx.font = '600 13.5px "Chakra Petch", sans-serif'; ctx.fillStyle = F.seg.has(w.seg) ? '#FFB547' : '#E8EEF8';
        ctx.fillText(SEGS[w.i].short, lx, ly);
        ctx.font = '500 11.5px "IBM Plex Sans", sans-serif'; ctx.fillStyle = SEG_COLORS[w.i];
        const off = ctx.textBaseline === 'top' ? 16 : ctx.textBaseline === 'bottom' ? -16 : 15;
        ctx.fillText(fmt(w.n), lx, ly + off);
      }
    }
  }

  function pick(ev){
    const rc = cv.getBoundingClientRect(), x = ev.clientX - rc.left, y = ev.clientY - rc.top;
    let best = null, bd = 14 * 14;
    for (const d of dots.values()){ if (d.ta === 0 || d.a < 0.4) continue; const [sx, sy] = toScreen(d.x, d.y); const dd = (sx - x) ** 2 + (sy - y) ** 2; if (dd < bd){ bd = dd; best = d; } }
    const [cx, cy] = toScreen(0, 0), dist = Math.hypot(x - cx, y - cy);
    let t = Math.atan2(y - cy, x - cx); if (t < -Math.PI / 2) t += Math.PI * 2;
    const wedge = dist > BANDS[0] * view.s * R && dist < view.s * R + 60 ? wedges.find(w => t >= w.a0 && t < w.a1) : null;
    return {best, x, y, wedge, center: dist < BANDS[0] * view.s * R};
  }
  cv.addEventListener('pointermove', ev => {
    if (ev.pointerType !== 'mouse') return;
    const {best, x, y, wedge} = pick(ev);
    if (!best){ tip.hidden = true; cv.style.cursor = wedge ? 'zoom-in' : 'crosshair'; return; }
    const r = best.r, c = r.cl;
    tip.innerHTML = `<b>${esc(r.f)} ${esc(r.l)}</b><span>${esc(r.p || '')}</span><br><span>${esc(r.c || '')}${c.grade ? ' · ' + esc(c.grade) : ''}</span>`;
    tip.hidden = false; cv.style.cursor = 'pointer';
    tip.style.left = Math.min(x + 16, W - 270) + 'px'; tip.style.top = Math.min(y + 14, H - 90) + 'px';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  cv.addEventListener('click', ev => {
    const {best, wedge, center} = pick(ev);
    tip.hidden = true;
    if (W < 640 && !zoomSeg && wedge && !center){ zoomTo(wedge.seg); return; }
    if (best){ fx.tap(); openProfile(best.r.k); return; }
    if (center || (zoomSeg && (!wedge || wedge.seg === zoomSeg))){ if (zoomSeg) zoomTo(null); return; }
    if (wedge) zoomTo(wedge.seg);
  });
  chip.addEventListener('click', () => zoomTo(null));
  window.addEventListener('resize', () => { W = 0; kick(); });
  document.addEventListener('visibilitychange', () => { lastNow = 0; kick(); });
  return {
    update(){ resize(); layout(); kick(); },
    setActive(on){ active = on; lastNow = 0; if (on){ W = 0; kick(); } },
    redraw: kick,
  };
})();

/* ---------- ranks ---------- */
function renderRanks(){
  const base = S.all.filter(r => match(r, 'branch') && match(r, 'tier') && r.cl.branch);
  const m = {}; let max = 0;
  for (const r of base){ const k = r.cl.tier + '|' + r.cl.branch; m[k] = (m[k] || 0) + 1; max = Math.max(max, m[k]); }
  const head = `<thead><tr><th style="text-align:left;padding-left:14px">Tier</th>${BRANCHES.map(b => `<th scope="col">${esc(b.replace(' / ', '/'))}</th>`).join('')}<th>Total</th></tr></thead>`;
  const body = TIERS.map(([t, g]) => {
    const tot = base.filter(r => r.cl.tier === t).length;
    return `<tr${t === 'SES' || t === 'Rank not stated' ? ' class="sep"' : ''}><th scope="row">${esc(t)}${g ? `<small>${esc(g)}</small>` : ''}</th>${BRANCHES.map(b => {
      const n = m[t + '|' + b] || 0, a = n ? Math.round(10 + 80 * Math.sqrt(n / max)) : 0;
      return `<td><button type="button" class="${n ? (a > 62 ? 'hot' : '') : 'z'}" style="--a:${a}" data-cell="${esc(t)}|${esc(b)}" aria-label="${esc(t)}, ${esc(b)}: ${n}">${n || '·'}</button></td>`;
    }).join('')}<td class="tot">${fmt(tot)}</td></tr>`;
  }).join('');
  $('#ranks').innerHTML = `<table class="oob">${head}<tbody>${body}<tr class="sep"><th scope="row">Total</th>${BRANCHES.map(b => `<td class="tot">${fmt(base.filter(r => r.cl.branch === b).length)}</td>`).join('')}<td class="tot">${fmt(base.length)}</td></tr></tbody></table>`;
  const st = {}; base.forEach(r => st[r.cl.status || 'Unstated'] = (st[r.cl.status || 'Unstated'] || 0) + 1);
  $('#ranksMeta').textContent = Object.entries(st).map(([k, v]) => `${k} ${fmt(v)}`).join(', ') || 'No service ties in this view';
}

/* ---------- orgs ---------- */
function bars(el, entries, attr, colorOf){
  if (!entries.length){ el.innerHTML = '<li class="empty">Nothing in this view</li>'; return; }
  const max = entries[0][1];
  el.innerHTML = entries.map(([k, n]) => `<li><button type="button" data-${attr}="${esc(k)}"><span class="n">${esc(k)}</span><span class="c">${fmt(n)}</span><span class="t"><i data-w="${(n / max * 100).toFixed(1)}" style="background:${colorOf(k)};color:${colorOf(k)}"></i></span></button></li>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => $$('i[data-w]', el).forEach(i => { i.style.width = i.dataset.w + '%'; })));
}
function renderOrgs(){
  const co = new Map(), coSeg = {}, ag = new Map(), agSeg = {};
  for (const r of VIEW){
    if (r.c){ co.set(r.c, (co.get(r.c) || 0) + 1); coSeg[r.c] = r.cl.seg; }
    if (r.cl.agency){ ag.set(r.cl.agency, (ag.get(r.cl.agency) || 0) + 1); agSeg[r.cl.agency] = r.cl.seg; }
  }
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25);
  bars($('#coList'), top(co), 'company', k => segColor(coSeg[k]));
  bars($('#agList'), top(ag), 'agency', k => segColor(agSeg[k]));
}

/* ---------- people ---------- */
function sorted(){
  const by = {
    new: (a, b) => (b.d || '').localeCompare(a.d || ''),
    name: (a, b) => (a.l || '').localeCompare(b.l || '') || (a.f || '').localeCompare(b.f || ''),
    rank: (a, b) => b.cl.gn - a.cl.gn || (a.l || '').localeCompare(b.l || ''),
    level: (a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn,
  }[S.sort];
  return VIEW.slice().sort(by);
}
const avatar = (r, extra = '') => `<span class="av${r.ed && r.ed.star ? ' star' : ''}${extra}" style="background:${segColor(r.cl.seg)}">${esc(initials(r))}</span>`;
function personRow(r){
  const c = r.cl;
  const flags = (r.isNew ? '<span class="flag new">New</span>' : '') + (r.movedNow ? '<span class="flag jc">Moved</span>' : '') + (r.x ? '<span class="flag rm">Removed</span>' : '');
  const side = c.grade ? `<span class="grade">${esc(c.grade)}</span><span class="psub">${esc(c.branch || c.status || '')}</span>` : `<span class="psub">${esc(c.branch ? c.branch + ', ' + (c.status || '') : c.sen)}</span>`;
  return `<li><button type="button" class="person" data-open="${esc(r.k)}">${avatar(r)}<span class="pmain"><span class="pname">${esc(r.f)} ${esc(r.l)}${flags}</span><span class="ptitle">${esc(r.p || '—')}</span><span class="ptitle" style="color:var(--ink-3)">${esc(r.c || '')}</span></span><span class="pside">${side}</span></button></li>`;
}
let peopleList = [];
function renderPeople(reset){
  if (reset){ peopleList = sorted(); S.shown = 60; }
  $$('#sortCtl button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.sort === S.sort)));
  $('#peopleCount').textContent = `${fmt(peopleList.length)} ${peopleList.length === 1 ? 'person' : 'people'}`;
  const ul = $('#people');
  if (!peopleList.length){ ul.innerHTML = '<li class="empty"><b>No one matches</b>Remove a filter or clear the search.</li>'; return; }
  ul.innerHTML = peopleList.slice(0, S.shown).map(personRow).join('');
}
new IntersectionObserver(es => {
  if (es.some(e => e.isIntersecting) && S.tab === 'people' && S.shown < peopleList.length){
    const from = S.shown; S.shown += 60;
    $('#people').insertAdjacentHTML('beforeend', peopleList.slice(from, S.shown).map(personRow).join(''));
  }
}, {rootMargin: '400px'}).observe($('#sentinel'));

/* ---------- review deck ---------- */
const Deck = (() => {
  let queue = [], idx = 0;
  const marker = () => S.deck === 'week' ? 'w' + ((S.meta && S.meta.n) || S.meta && S.meta.lastImport || 0) : 'all';
  function build(){
    const mk = marker();
    if (S.deck === 'week') queue = S.all.filter(r => !r.x && (r.isNew || r.movedNow) && S.review[r.k] !== mk);
    else queue = S.all.filter(r => !r.x && !S.review[r.k + ':all']).sort((a, b) => hash(a.k + 'deck') - hash(b.k + 'deck'));
    idx = 0;
  }
  function count(){ const mk = marker(); return S.all.filter(r => !r.x && (r.isNew || r.movedNow) && S.review[r.k] !== 'w' + ((S.meta && S.meta.n) || S.meta && S.meta.lastImport || 0)).length; }
  function cardHTML(r, cls){
    const c = r.cl;
    const chips = [c.seg, c.agency, c.branch && (c.grade ? `${c.branch} ${c.grade}` : c.branch), c.status, c.func].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
    const was = r.pv && r.pv[0] ? `<div class="was"><b style="color:var(--sky)">Moved.</b> Was ${esc(r.pv[0].p || 'unknown title')} at ${esc(r.pv[0].c || 'unknown company')}</div>` : r.isNew ? `<div class="was" style="background:rgba(255,107,91,.08);border-color:rgba(255,107,91,.25)"><b style="color:var(--coral)">New connection.</b> Connected ${niceDate(r.d)}</div>` : `<div class="was">Connected ${niceDate(r.d)}</div>`;
    return `<article class="card ${cls}" data-k="${esc(r.k)}"><span class="stamp yes">STAR</span><span class="stamp no">SKIP</span>${avatar(r)}<div><h3>${esc(r.f)} ${esc(r.l)}</h3><div class="ct">${esc(r.p || '')}</div><div class="cc">${esc(r.c || '')}</div></div><div class="chips">${chips.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>${was}</article>`;
  }
  function render(){
    if (!queue.length || idx === 0) build();
    $$('#deckCtl button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.deck === S.deck)));
    const deck = $('#deck'), left = queue.length - idx;
    $('#deckMeta').textContent = left ? `${fmt(left)} to review` : '';
    $('#deckActions').hidden = !left;
    if (!left){
      deck.innerHTML = S.deck === 'week'
        ? '<div class="deck-done"><div><b>All caught up</b>New connections and job changes from your next weekly import will show up here.</div></div>'
        : '<div class="deck-done"><div><b>Whole network reviewed</b>Every contact has been through the deck.</div></div>';
      return;
    }
    deck.innerHTML = queue.slice(idx, idx + 3).map((r, i) => cardHTML(r, i === 0 ? 'top' : 'back' + i)).reverse().join('');
    bindTop();
  }
  function bindTop(){
    const card = $('#deck .card.top'); if (!card) return;
    let sx = 0, sy = 0, dx = 0, dy = 0, drag = false;
    const yes = $('.stamp.yes', card), no = $('.stamp.no', card);
    card.addEventListener('pointerdown', e => { drag = true; sx = e.clientX; sy = e.clientY; card.setPointerCapture(e.pointerId); card.classList.add('dragging'); });
    card.addEventListener('pointermove', e => {
      if (!drag) return; dx = e.clientX - sx; dy = e.clientY - sy;
      card.style.transform = `translate(${dx}px,${dy}px) rotate(${dx / 18}deg)`;
      yes.style.opacity = Math.max(0, Math.min(1, dx / 90)); no.style.opacity = Math.max(0, Math.min(1, -dx / 90));
    });
    const end = () => {
      if (!drag) return; drag = false; card.classList.remove('dragging');
      if (dx > 100) decide('star'); else if (dx < -100) decide('skip');
      else if (dy < -110 || (Math.abs(dx) < 6 && Math.abs(dy) < 6)) { card.style.transform = ''; yes.style.opacity = no.style.opacity = 0; openProfile(card.dataset.k); }
      else { card.style.transform = ''; yes.style.opacity = no.style.opacity = 0; }
      dx = dy = 0;
    };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
  }
  async function decide(kind){
    const r = queue[idx]; if (!r) return;
    const card = $('#deck .card.top');
    if (card){ card.style.transform = `translate(${kind === 'star' ? 600 : -600}px,40px) rotate(${kind === 'star' ? 24 : -24}deg)`; card.style.opacity = 0; }
    if (kind === 'star'){ fx.star(); if (!(r.ed && r.ed.star)) await setEdit(r.k, {star: true}, {quiet: true}); } else fx.skip();
    S.review[S.deck === 'week' ? r.k : r.k + ':all'] = marker();
    saveReview();
    idx++;
    setTimeout(() => { render(); renderBadge(); }, REDUCED ? 0 : 260);
  }
  return {render, decide, reset(){ queue = []; idx = 0; }, count, current: () => queue[idx]};
})();
function renderBadge(){ const n = Deck.count(); const b = $('#reviewBadge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }

/* ---------- sheets ---------- */
const Sheet = (() => {
  const el = $('#sheet'), body = $('#sheetBody'), scrim = $('#scrim'), grip = $('#sheetGrip');
  let kind = null, lastFocus = null;
  function open(k, html){
    kind = k; lastFocus = document.activeElement;
    body.innerHTML = html; body.scrollTop = 0;
    el.hidden = false; scrim.hidden = false;
    requestAnimationFrame(() => { el.classList.add('show'); scrim.classList.add('show'); });
    const f = body.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 300);
  }
  function close(){
    if (!kind) return;
    kind = null; S.sel = null; Radar.redraw();
    el.classList.remove('show'); scrim.classList.remove('show'); el.style.transform = '';
    setTimeout(() => { if (!kind){ el.hidden = true; scrim.hidden = true; body.innerHTML = ''; } }, 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  scrim.addEventListener('click', close);
  let sy = 0, dy = 0, dragging = false;
  const start = e => { if (innerWidth > 820) return; if (e.target.closest('input,textarea,select,button')) return; if (e.currentTarget === body && body.scrollTop > 0) return; dragging = true; sy = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; el.classList.add('dragging'); };
  const move = e => { if (!dragging) return; dy = Math.max(0, (e.touches ? e.touches[0].clientY : e.clientY) - sy); if (dy > 0 && e.cancelable && e.currentTarget === body) e.preventDefault(); el.style.transform = `translateY(${dy}px)`; };
  const end = () => { if (!dragging) return; dragging = false; el.classList.remove('dragging'); if (dy > 110){ fx.tap(); close(); } else el.style.transform = ''; };
  for (const t of [grip, body]){ t.addEventListener('touchstart', start, {passive: true}); t.addEventListener('touchmove', move, {passive: false}); t.addEventListener('touchend', end); }
  grip.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') start(e); });
  window.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') move(e); });
  window.addEventListener('pointerup', end);
  return {open, close, get kind(){ return kind; }, body};
})();
const head = (title, sub) => `<div class="sh-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button type="button" class="x" data-act="close" aria-label="Close">${ICON.x}</button></div>`;

function facet(group, values, getter, opts = {}){
  const counts = new Map();
  for (const r of S.all){ if (!match(r, group)) continue; const v = getter(r); if (Array.isArray(v)) v.forEach(x => counts.set(x, (counts.get(x) || 0) + 1)); else if (v) counts.set(v, (counts.get(v) || 0) + 1); }
  const set = F[group];
  const list = values.filter(v => counts.get(v) || set.has(v) || opts.keep);
  if (!list.length) return '<p class="muted">None in this view</p>';
  return `<div class="chips">${list.map(v => { const c = counts.get(v) || 0; const dot = group === 'seg' ? `<i style="background:${segColor(v)}"></i>` : ''; return `<button type="button" class="chip${set.has(v) ? ' on' : ''}${c ? '' : ' zero'}" data-g="${group}" data-v="${esc(v)}">${dot}${esc(opts.label ? opts.label(v) : v)}<em>${fmt(c)}</em></button>`; }).join('')}</div>`;
}
function selectOpts(group, getter, current, allLabel){
  const counts = new Map();
  for (const r of S.all){ if (!match(r, group)) continue; const v = getter(r); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
  const keys = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  if (current && !counts.has(current)) keys.unshift(current);
  return `<option value="">${allLabel}</option>` + keys.map(k => `<option value="${esc(k)}"${k === current ? ' selected' : ''}>${esc(k)} (${fmt(counts.get(k) || 0)})</option>`).join('');
}
function renderFilterSheet(update){
  const sigCounts = {};
  for (const r of S.all){ if (!match(r, 'sig')) continue; for (const [s] of SIGNALS) if (sigOk(r, s)) sigCounts[s] = (sigCounts[s] || 0) + 1; }
  const html = head('Filters', 'Combine as many as you like. Counts update as you go.') + `
    <div class="fgroup"><h3>Segment</h3>${facet('seg', SEGS.map(s => s.id), r => r.cl.seg)}</div>
    <div class="fgroup"><h3>Military branch</h3>${facet('branch', BRANCHES, r => r.cl.branch)}</div>
    <div class="fgroup"><h3>Service status</h3>${facet('status', STATUSES, r => r.cl.status)}</div>
    <div class="fgroup"><h3>Rank or grade</h3>${facet('tier', TIERS.map(t => t[0]), r => r.cl.tier)}</div>
    <div class="fgroup"><h3><label for="fAgency">Agency or command</label></h3><select class="fsel" id="fAgency">${selectOpts('agency', r => r.cl.agency, F.agency, 'All agencies and commands')}</select></div>
    <div class="fgroup"><h3><label for="fCompany">Company</label></h3><select class="fsel" id="fCompany">${selectOpts('company', r => r.c, F.company, 'All companies')}</select></div>
    <div class="fgroup"><h3>Seniority</h3>${facet('sen', SENIORITY, r => r.cl.sen)}</div>
    <div class="fgroup"><h3>Function</h3>${facet('func', FUNCS, r => r.cl.func)}</div>
    <div class="fgroup"><h3>Certifications</h3>${facet('cert', CERTS.map(c => c[0]), r => r.cl.certs)}</div>
    <div class="fgroup"><h3><label for="fSince">Connected</label></h3><select class="fsel" id="fSince">${SINCE.map(([v, l]) => `<option value="${v}"${F.since === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="fgroup"><h3>Signals</h3><div class="chips">${SIGNALS.map(([v, l]) => `<button type="button" class="chip${F.sig.has(v) ? ' on' : ''}${sigCounts[v] ? '' : ' zero'}" data-g="sig" data-v="${v}">${l}<em>${fmt(sigCounts[v] || 0)}</em></button>`).join('')}</div></div>
    <label class="switch">Include people no longer in your export<input type="checkbox" id="fRemoved"${F.removed ? ' checked' : ''}></label>
    <div class="sheet-foot"><button type="button" class="btn" data-act="clear">Clear all</button><button type="button" class="btn primary block" data-act="close">Show ${fmt(VIEW.length)} ${VIEW.length === 1 ? 'person' : 'people'}</button></div>`;
  if (update){ const st = Sheet.body.scrollTop; Sheet.body.innerHTML = html; Sheet.body.scrollTop = st; }
  else Sheet.open('filters', html);
}

function openProfile(k){
  const r = S.all.find(x => x.k === k); if (!r) return;
  S.sel = k; Radar.redraw();
  const c = r.cl, ed = r.ed || {};
  const opt = (vals, cur, auto) => `<option value="">${auto}</option>` + vals.map(v => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}"${cur === val ? ' selected' : ''}>${esc(lab)}</option>`; }).join('');
  const link = S.mode === 'sample' ? '<span class="muted">Sample contact, no LinkedIn profile</span>' : r.u ? `<button type="button" class="btn" data-link="${esc(r.u)}">${ICON.ext}LinkedIn profile</button>` : '';
  const hist = (r.pv || []).map(h => `<li>${esc(h.p || '—')}<br><small>${esc(h.c || '—')}, until ${niceDate(h.until)}</small></li>`).join('');
  Sheet.open('profile', `
    <div class="sh-head"><div class="prof-top">${avatar(r)}<div><h2>${esc(r.f)} ${esc(r.l)}</h2><p>${esc(r.p || '')}</p><p style="color:var(--ink)">${esc(r.c || '')}</p></div></div><button type="button" class="x" data-act="close" aria-label="Close">${ICON.x}</button></div>
    <div class="row"><button type="button" class="btn${ed.star ? ' primary' : ''}" data-act="toggle-star" data-k="${esc(k)}">${ed.star ? '★ Starred' : '☆ Star'}</button>${link}${r.e ? `<button type="button" class="btn" data-copy="${esc(r.e)}">Copy email</button>` : ''}</div>
    <dl class="kv">
      <dt>Segment</dt><dd><span style="color:${segColor(c.seg)}">●</span> ${esc(c.seg)}</dd>
      <dt>Branch</dt><dd>${esc(c.branch || '—')}</dd>
      <dt>Status</dt><dd>${esc(c.status || '—')}</dd>
      <dt>Rank</dt><dd>${c.grade ? `${c.rank && c.rank !== c.grade ? esc(c.rank) + ' ' : ''}<span class="grade">${esc(c.grade)}</span>` : '—'}</dd>
      <dt>Agency or cmd</dt><dd>${esc(c.agency || '—')}</dd>
      <dt>Seniority</dt><dd>${esc(c.sen)}</dd>
      <dt>Function</dt><dd>${esc(c.func)}</dd>
      <dt>Certifications</dt><dd>${esc(c.certs.join(', ') || '—')}${c.clr ? ', clearance mentioned' : ''}</dd>
      <dt>Connected</dt><dd>${niceDate(r.d)}</dd>
      <dt>First seen</dt><dd>${niceDate(r.fs)}${r.x ? `, missing from export since ${niceDate(r.x)}` : ''}</dd>
      ${r.e ? `<dt>Email</dt><dd>${esc(r.e)}</dd>` : ''}
    </dl>
    ${hist ? `<h3 class="sect">Job history from your exports</h3><ul class="hist">${hist}</ul>` : ''}
    <h3 class="sect">Corrections and notes</h3>
    <form class="form" id="edForm" data-k="${esc(k)}">
      <label>Segment<select id="eSeg">${opt(SEGS.map(s => s.id), ed.seg || '', 'Auto: ' + c.seg)}</select></label>
      <label>Branch<select id="eBranch">${opt([...BRANCHES, ['__none', 'None']], ed.branch || '', 'Auto')}</select></label>
      <label>Status<select id="eStatus">${opt([...STATUSES, ['__none', 'None']], ed.status || '', 'Auto')}</select></label>
      <label>Grade<select id="eGrade">${opt([...GRADE_OPTS, ['__none', 'None']], ed.grade || '', 'Auto')}</select></label>
      <label class="full">Rank title<input id="eRank" type="text" value="${esc(ed.rank || '')}" placeholder="${esc(c.rank || 'e.g. Colonel, USMC (Ret.)')}"></label>
      <label class="full">Tags, separated by commas<input id="eTags" type="text" value="${esc((ed.tags || []).join(', '))}" placeholder="e.g. NAVFAC target, warm intro"></label>
      <label class="full">Notes<textarea id="eNote" placeholder="How you know them, last touch, next step">${esc(ed.note || '')}</textarea></label>
      <div class="row full"><button type="submit" class="btn primary">Save changes</button><span class="muted" id="edMsg">${S.mode === 'live' ? '' : 'Sample data: changes are not saved.'}</span></div>
    </form>`);
}
async function setEdit(k, patch, {quiet} = {}){
  const cur = Object.assign({}, S.edits[k] || {}, patch);
  for (const f of Object.keys(cur)) if (cur[f] === '' || cur[f] === false || cur[f] == null || (Array.isArray(cur[f]) && !cur[f].length) || f === 'updated') delete cur[f];
  if (Object.keys(cur).length) S.edits[k] = Object.assign({updated: TODAY}, cur); else delete S.edits[k];
  hydrate(S.all.map(stripRow));
  if (S.mode === 'live') await saveEdits();
  if (!quiet) render(); else { VIEW = S.all.filter(r => match(r)); renderStats(); }
}
async function saveProfileForm(form){
  const k = form.dataset.k;
  const patch = {seg: $('#eSeg').value, branch: $('#eBranch').value, status: $('#eStatus').value, grade: $('#eGrade').value, rank: $('#eRank').value.trim().slice(0, 80), tags: $('#eTags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20), note: $('#eNote').value.slice(0, 4000)};
  const msg = $('#edMsg'); msg.textContent = 'Saving…';
  try { await setEdit(k, patch); fx.success(); toast(S.mode === 'live' ? (Store.kind === 'icloud' ? 'Saved and syncing to iCloud' : 'Saved') : 'Sample data: not saved'); openProfile(k); }
  catch (e) { msg.textContent = `Couldn’t save: ${(e && e.message) || 'unknown error'}. Try again.`; }
}

function showImport(){
  Sheet.open('import', head('Import weekly export', 'New people are added, title and company moves are logged, and anyone missing from the file is kept but marked removed.') + `
    <button type="button" class="drop" id="drop"><b>Choose your LinkedIn file</b><span class="muted">The .zip from LinkedIn, or Connections.csv inside it</span></button>
    <div id="impOut"></div><p class="muted" id="impMsg"></p>`);
}
async function handleFile(file){
  if (Sheet.kind !== 'import') showImport();
  $('#impMsg').textContent = 'Reading ' + file.name + '…';
  try {
    const rows = await readFile(file);
    const plan = mergeImport(rows, S.mode === 'live' ? S.all : null, S.mode === 'live' ? S.meta : null); S.pending = plan;
    const st = plan.stats;
    $('#impOut').innerHTML = `<div class="diff"><div><div class="v">${fmt(st.total)}</div><div class="l">Connections</div></div><div><div class="v" style="color:var(--coral)">${fmt(st.added)}</div><div class="l">${st.first ? 'Loaded' : 'New'}</div></div><div><div class="v" style="color:var(--sky)">${fmt(st.changed)}</div><div class="l">Job changes</div></div><div><div class="v">${fmt(st.removed)}</div><div class="l">No longer listed</div></div></div><div class="row" style="margin-top:14px"><button type="button" class="btn primary block" data-act="commit">Save to my network</button></div>`;
    $('#impMsg').textContent = `Read ${fmt(rows.length)} rows from ${file.name}.`;
  } catch (e) { $('#impOut').innerHTML = `<p class="err">${esc(e.message || String(e))}</p>`; $('#impMsg').textContent = ''; }
}
async function commitImport(){
  const plan = S.pending; if (!plan) return;
  const btn = $('[data-act="commit"]'); if (btn) btn.disabled = true;
  try {
    const wasSample = S.mode === 'sample';
    await persist(plan); S.mode = 'live';
    if (wasSample){ S.edits = {}; S.review = {}; await saveEdits(); await saveReview(); }
    S.meta = plan.meta; hydrate(plan.rows); S.pending = null; Deck.reset();
    Sheet.close(); render(); fx.success();
    const st = plan.stats;
    toast(st.first ? `Loaded ${fmt(st.total)} connections` : `${fmt(st.added)} new, ${fmt(st.changed)} moved. Open Review to go through them.`);
  } catch (e) {
    if (btn) btn.disabled = false;
    $('#impMsg').innerHTML = `<span class="err">Save failed: ${esc((e && e.message) || 'unknown error')}</span>`;
  }
}
function showMenu(){
  Sheet.open('menu', head('Settings and help') + `
    <label class="switch">Haptic feedback${NATIVE ? '' : ' <span class="muted">(phone only)</span>'}<input type="checkbox" id="pHaptics"${prefs.haptics ? ' checked' : ''}></label>
    <label class="switch">Sounds<input type="checkbox" id="pSound"${prefs.sound ? ' checked' : ''}></label>
    <button type="button" class="btn" data-act="export">Export this view as CSV</button>
    <h3 class="sect">Weekly refresh</h3>
    <ol class="steps">
      <li>On LinkedIn, open <b>Me, Settings and Privacy, Data privacy, Get a copy of your data</b>.</li>
      <li>Choose <b>Want something in particular?</b>, tick <b>Connections</b> only, and request the archive.</li>
      <li>LinkedIn emails you when it is ready. Download the zip.</li>
      <li>Tap the import button at the top and pick the zip. On iPhone you can also open it in Files or Mail, tap Share, and choose Order of Battle.</li>
    </ol>
    <p class="muted">Import on any one of your Apple devices and iCloud carries it to the others. Branch, rank and segment are worked out from each person's title and company, so use a profile's corrections panel to fix anything that is off.</p>`);
}

/* ---------- toast, export ---------- */
let toastT = 0;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.hidden = false; t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }
async function exportView(){
  const cols = ['First Name', 'Last Name', 'Company', 'Position', 'Segment', 'Agency / Command', 'Branch', 'Status', 'Rank', 'Grade', 'Rank Tier', 'Seniority', 'Function', 'Certifications', 'Clearance Mentioned', 'Connected On', 'First Seen', 'Job Change', 'LinkedIn URL', 'Email', 'Tags', 'Notes', 'Starred'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [cols.join(',')].concat(sorted().map(r => { const c = r.cl, e = r.ed || {}; return [r.f, r.l, r.c, r.p, c.seg, c.agency, c.branch, c.status, c.rank, c.grade, c.tier, c.sen, c.func, c.certs.join('; '), c.clr ? 'Yes' : '', r.d, r.fs, r.jc || '', S.mode === 'sample' ? '' : r.u, r.e, (e.tags || []).join('; '), e.note, e.star ? 'Yes' : ''].map(q).join(','); })).join('\n');
  const name = `order-of-battle-${TODAY}.csv`;
  try {
    if (NATIVE){ const w = await Filesystem.writeFile({path: name, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8}); await Share.share({title: 'Order of Battle export', files: [w.uri], dialogTitle: 'Export connections'}); }
    else { const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
  } catch (e) { if (!/cancel/i.test((e && e.message) || '')) toast('Export failed: ' + ((e && e.message) || 'unknown error')); }
}

/* ---------- storage ---------- */
const Store = {
  kind: NATIVE ? 'device' : 'browser',
  async init(){ if (PLATFORM === 'ios'){ try { const st = await CloudStore.status(); this.kind = st.icloud ? 'icloud' : 'device'; } catch { this.kind = 'device'; } } },
  async read(name){
    if (PLATFORM === 'ios'){ const r = await CloudStore.read({name}); if (r.pending) return {pending: true}; return {data: r.data ? JSON.parse(r.data) : null}; }
    if (NATIVE){ try { const r = await Filesystem.readFile({path: name, directory: Directory.Data, encoding: Encoding.UTF8}); return {data: JSON.parse(r.data)}; } catch { return {data: null}; } }
    try { const v = localStorage.getItem('oob.' + name); return {data: v ? JSON.parse(v) : null}; } catch { return {data: null}; }
  },
  async write(name, obj){
    const data = JSON.stringify(obj);
    if (PLATFORM === 'ios') return CloudStore.write({name, data});
    if (NATIVE) return Filesystem.writeFile({path: name, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true});
    try { localStorage.setItem('oob.' + name, data); } catch { throw new Error('This browser blocked local storage, so the data can’t be saved here.'); }
  },
};
async function saveEdits(){ await Store.write('edits.json', {edits: S.edits, rev: Date.now()}); }
let reviewT = 0;
function saveReview(){ if (S.mode !== 'live') return; clearTimeout(reviewT); reviewT = setTimeout(() => Store.write('review.json', {review: S.review}).catch(() => {}), 600); }
async function persist(plan){
  const rows = plan.rows.map(stripRow).map(r => { delete r._new; return r; });
  plan.meta.count = rows.length; plan.meta.rev = Date.now() + '-' + Math.random().toString(36).slice(2, 8); plan.meta.device = PLATFORM;
  $('#impMsg').textContent = Store.kind === 'icloud' ? 'Saving to iCloud…' : 'Saving…';
  await Store.write('network.json', {meta: plan.meta, rows});
  S.rev = plan.meta.rev;
}
let loading = false;
async function loadStore(opts = {}){
  if (loading) return; loading = true;
  try {
    const n = await Store.read('network.json');
    if (n.pending){ S.syncNote = 'Downloading your network from iCloud. This can take a minute on a new device.'; renderHeader(); setTimeout(() => loadStore(), 6000); return; }
    S.syncNote = '';
    if (!n.data || !n.data.rows){ render(); return; }
    const [e, rv] = await Promise.all([Store.read('edits.json'), Store.read('review.json')]);
    const nextEdits = (e.data && e.data.edits) || {}, nextReview = (rv.data && rv.data.review) || {};
    if (opts.onlyIfChanged && S.mode === 'live' && n.data.meta && n.data.meta.rev === S.rev && JSON.stringify(nextEdits) === JSON.stringify(S.edits)){ S.review = nextReview; return; }
    S.edits = nextEdits; S.review = nextReview;
    S.meta = n.data.meta || {}; S.rev = S.meta.rev; S.mode = 'live';
    hydrate(n.data.rows); Deck.reset(); render();
    if (opts.announce) toast('Up to date');
  } catch (err) {
    const b = $('#banner'); b.hidden = false;
    b.innerHTML = `<strong>Couldn’t load</strong><span>Your saved network didn’t load (${esc((err && err.message) || 'unknown error')}). Close and reopen the app to try again.</span>`;
  } finally { loading = false; }
}
function b64ToBytes(b64){ const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function openIncoming(url){
  if (!/\.(zip|csv)(\?|$)/i.test(url)) return;
  try {
    const r = await Filesystem.readFile({path: url});
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
    handleFile(new File([b64ToBytes(typeof r.data === 'string' ? r.data : '')], name, {type: /\.zip$/i.test(name) ? 'application/zip' : 'text/csv'}));
  } catch (e) { showImport(); $('#impOut').innerHTML = `<p class="err">Couldn’t open that file (${esc((e && e.message) || 'unknown error')}). Choose it from the import sheet instead.</p>`; }
}

/* ---------- pull to refresh ---------- */
(() => {
  const ptr = $('#ptr'); let y0 = null, dy = 0;
  document.addEventListener('touchstart', e => { y0 = (window.scrollY <= 0 && !Sheet.kind && !e.target.closest('.card,#radar,.stats,.active,.scrollx')) ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
  document.addEventListener('touchmove', e => {
    if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) return;
    const p = Math.min(1, dy / 90);
    ptr.style.opacity = p; ptr.style.transform = `translateY(${-30 + p * 40}px)`;
    $('.ptr-text', ptr).textContent = p >= 1 ? 'Release to sync' : 'Pull to sync';
    $('.ptr-ring', ptr).style.transform = `rotate(${p * 300}deg)`;
  }, {passive: true});
  document.addEventListener('touchend', async () => {
    if (y0 == null) return; y0 = null;
    if (dy >= 90){ fx.tap(); ptr.classList.add('spin'); $('.ptr-text', ptr).textContent = 'Syncing'; await loadStore({announce: S.mode === 'live'}); }
    ptr.classList.remove('spin'); ptr.style.opacity = 0; ptr.style.transform = '';
  });
})();

/* ---------- events ---------- */
function clearAll(){ for (const k of Object.keys(F)) F[k] = F[k] instanceof Set ? new Set : (k === 'removed' ? false : ''); $('#q').value = ''; render(); }
document.addEventListener('click', async e => {
  const t = e.target.closest('button, .drop'); if (!t) return;
  const d = t.dataset;
  if (t.id === 'drop'){ $('#file').click(); return; }
  if (d.g){ const s = F[d.g]; s.has(d.v) ? s.delete(d.v) : s.add(d.v); fx.select(); render(); return; }
  if (d.rm){ const g = d.rm; if (F[g] instanceof Set) F[g].delete(d.v); else if (g === 'q'){ F.q = ''; $('#q').value = ''; } else if (g === 'removed') F.removed = false; else F[g] = ''; fx.tap(); render(); return; }
  if (d.kpi){ fx.select(); if (d.kpi === 'clear'){ clearAll(); return; } const [g, v] = d.kpi.split(/:(.+)/); const s = F[g]; if (s.size === 1 && s.has(v)) s.clear(); else { s.clear(); s.add(v); } render(); return; }
  if (d.cell){ const [tier, b] = d.cell.split('|'); F.tier = new Set([tier]); F.branch = new Set([b]); fx.select(); render(); setTab('people'); return; }
  if (d.company !== undefined){ F.company = F.company === d.company ? '' : d.company; fx.select(); render(); setTab('people'); return; }
  if (d.agency !== undefined){ F.agency = F.agency === d.agency ? '' : d.agency; fx.select(); render(); setTab('people'); return; }
  if (d.open){ fx.tap(); openProfile(d.open); return; }
  if (d.tab){ setTab(d.tab); return; }
  if (d.sort){ S.sort = d.sort; fx.select(); renderPeople(true); return; }
  if (d.deck){ S.deck = d.deck; Deck.reset(); fx.select(); Deck.render(); return; }
  if (d.link){ if (NATIVE) Browser.open({url: d.link}); else window.open(d.link, '_blank', 'noopener'); return; }
  if (d.copy){ try { await navigator.clipboard.writeText(d.copy); toast('Email copied'); } catch { toast(d.copy); } return; }
  switch (d.act){
    case 'close': Sheet.close(); return;
    case 'clear': fx.tap(); clearAll(); return;
    case 'import': showImport(); return;
    case 'commit': commitImport(); return;
    case 'export': exportView(); return;
    case 'deck-star': Deck.decide('star'); return;
    case 'deck-skip': Deck.decide('skip'); return;
    case 'deck-open': { const r = Deck.current(); if (r) openProfile(r.k); return; }
    case 'toggle-star': { const k = d.k, on = !(S.edits[k] && S.edits[k].star); on ? fx.star() : fx.unstar(); await setEdit(k, {star: on}); openProfile(k); return; }
  }
  if (t.id === 'btnImport') showImport();
  else if (t.id === 'btnMenu') showMenu();
  else if (t.id === 'btnFilter'){ fx.tap(); renderFilterSheet(false); }
  else if (t.id === 'sync'){ if (S.meta && S.meta.lastImport && daysAgo(S.meta.lastImport) >= 7) showImport(); else { fx.tap(); await loadStore({announce: S.mode === 'live'}); } }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fAgency'){ F.agency = t.value; render(); }
  else if (t.id === 'fCompany'){ F.company = t.value; render(); }
  else if (t.id === 'fSince'){ F.since = t.value; render(); }
  else if (t.id === 'fRemoved'){ F.removed = t.checked; render(); }
  else if (t.id === 'pHaptics'){ prefs.haptics = t.checked; savePrefs(); fx.tap(); }
  else if (t.id === 'pSound'){ prefs.sound = t.checked; savePrefs(); fx.select(); }
  else if (t.id === 'file' && t.files[0]){ handleFile(t.files[0]); t.value = ''; }
});
document.addEventListener('submit', e => { if (e.target.id === 'edForm'){ e.preventDefault(); saveProfileForm(e.target); } });
let qT; $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { F.q = e.target.value.trim(); render(); }, 160); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && Sheet.kind) Sheet.close();
  if (S.tab === 'review' && !Sheet.kind && !e.target.closest('input,textarea,select')){ if (e.key === 'ArrowRight') Deck.decide('star'); if (e.key === 'ArrowLeft') Deck.decide('skip'); }
});
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#drop'); if (d){ e.preventDefault(); d.classList.add('over'); } }));
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d){ e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); } });

/* ---------- boot ---------- */
(async () => {
  const sample = sampleNetwork();
  S.edits = sample.edits; S.meta = sample.meta; hydrate(sample.rows);
  let startTab = 'map'; try { startTab = localStorage.getItem('oob.tab') || 'map'; } catch {}
  VIEW = S.all.filter(r => match(r));
  setTab(['map', 'ranks', 'orgs', 'people', 'review'].includes(startTab) ? startTab : 'map', {silent: true});
  render();
  await Store.init(); renderHeader();
  await loadStore();
  if (NATIVE){
    App.addListener('resume', () => loadStore({onlyIfChanged: true}));
    App.addListener('appUrlOpen', ({url}) => openIncoming(url));
    if (PLATFORM === 'ios'){ let t; CloudStore.addListener('changed', () => { clearTimeout(t); t = setTimeout(() => loadStore({onlyIfChanged: true}), 1500); }); }
    try { const launch = await App.getLaunchUrl(); if (launch && launch.url) openIncoming(launch.url); } catch {}
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => Radar.redraw());
})();
