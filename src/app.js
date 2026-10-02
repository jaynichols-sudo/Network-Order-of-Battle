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
import { parseQuery, matchNL } from './nlq.js';
import { createWeb } from './web.js';
import { INDUSTRIES, indColor, indShort, setIndustryOverrides, companyKey, UNCLASSIFIED, GOV_IND } from './industry.js';

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
const S = {all: [], edits: {}, review: {}, targets: [], meta: null, mode: 'sample', rev: null, tab: 'sitrep', mapMode: 'scope', unitsMode: 'targets', sort: 'new', shown: 60, sel: null, deck: 'week', pending: null, syncNote: '', nl: null, nlChips: [], cards: [], coInd: {}, uncShown: 25};
const F = {q: '', seg: new Set, branch: new Set, status: new Set, tier: new Set, sen: new Set, func: new Set, ind: new Set, cert: new Set, sig: new Set, agency: '', company: '', since: '', removed: false};
let VIEW = [];

function hydrate(rows){
  const imp = (S.meta && S.meta.n) || 0;
  setIndustryOverrides(S.coInd);
  S.all = rows.map(r => {
    const k = r.k || keyOf(r);
    const ed = S.edits[k];
    const cl = classify(r, ed);
    const isNew = S.mode === 'sample' ? !!r._new : (imp > 1 && r.fi === imp);
    const lastImp = S.meta && S.meta.lastImport;
    const movedNow = !!r.jc && (S.mode === 'sample' ? daysAgo(r.jc) < 8 : r.jc === lastImp);
    const hay = [r.f, r.l, r.p, r.c, cl.agency, cl.rank, cl.grade, cl.branch, cl.ind, ed && ed.note, ed && (ed.tags || []).join(' ')].join(' ').toLowerCase();
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
    case 'jcw': return r.movedNow;
    case 'anniv': return isAnniversary(r.d);
  }
  return true;
}
const SIGNALS_UI = [...SIGNALS, ['jcw', 'Moved this refresh'], ['anniv', 'Anniversary this week']];
function isAnniversary(d){
  if (!d || d.length < 10) return false;
  const now = new Date(), y = now.getFullYear();
  if (+d.slice(0, 4) >= y) return false;
  const then = new Date(y, +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.abs(then - now) / 864e5 <= 3.5;
}
function match(r, skip){
  if (!F.removed && r.x) return false;
  if (S.nl){ if (!matchNL(S.nl, r)) return false; for (const s of S.nl.sig) if (!sigOk(r, s)) return false; }
  const c = r.cl;
  if (skip !== 'seg' && F.seg.size && !F.seg.has(c.seg)) return false;
  if (skip !== 'branch' && F.branch.size && !F.branch.has(c.branch)) return false;
  if (skip !== 'status' && F.status.size && !F.status.has(c.status)) return false;
  if (skip !== 'tier' && F.tier.size && !F.tier.has(c.tier)) return false;
  if (skip !== 'sen' && F.sen.size && !F.sen.has(c.sen)) return false;
  if (skip !== 'func' && F.func.size && !F.func.has(c.func)) return false;
  if (skip !== 'ind' && F.ind.size && !F.ind.has(c.ind)) return false;
  if (skip !== 'cert' && F.cert.size && !c.certs.some(x => F.cert.has(x))) return false;
  if (skip !== 'sig' && F.sig.size) for (const s of F.sig) if (!sigOk(r, s)) return false;
  if (skip !== 'agency' && F.agency && c.agency !== F.agency) return false;
  if (skip !== 'company' && F.company && (r.c || '') !== F.company) return false;
  if (skip !== 'since' && !sinceOk(r)) return false;
  if (F.q){ for (const t of F.q.toLowerCase().split(/\s+/)) if (t && !r.hay.includes(t)) return false; }
  return true;
}
const activeCount = () => F.seg.size + F.branch.size + F.status.size + F.tier.size + F.sen.size + F.func.size + F.ind.size + F.cert.size + F.sig.size + (F.agency ? 1 : 0) + (F.company ? 1 : 0) + (F.since ? 1 : 0) + (F.removed ? 1 : 0);

/* ---------- render orchestration ---------- */
function render(){
  VIEW = S.all.filter(r => match(r));
  renderHeader(); renderStats(); renderActive(); renderBadge();
  renderTab();
  if (Sheet.kind === 'filters') renderFilterSheet(true);
}
function renderTab(){
  if (S.tab === 'sitrep') renderSitrep();
  if (S.tab === 'map'){ renderMapCtl(); if (S.mapMode === 'scope') Radar.update(); else { Web.update(VIEW.filter(r => F.removed || !r.x), SEGS.map(s => s.id)); Replay.bounds(); } }
  if (S.tab === 'units') renderUnits();
  if (S.tab === 'people') renderPeople(true);
  if (S.tab === 'review') Deck.render();
}
function renderMapCtl(){
  $$('#mapCtl button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.map === S.mapMode)));
  $$('[data-sub]').forEach(el => { el.hidden = el.dataset.sub !== S.mapMode; });
  $('#mapHint').textContent = S.mapMode === 'scope' ? 'Closer to the center is more senior. Tap a sector to zoom, pinch to zoom further.' : 'Pinch or scroll to zoom, drag to pan. Tap a cluster to open it, long-press a person to peek.';
}
function setMapMode(m){
  S.mapMode = m; fx.select();
  try { localStorage.setItem('oob.map', m); } catch {}
  renderMapCtl();
  Radar.setActive(S.tab === 'map' && m === 'scope'); Web.setActive(S.tab === 'map' && m === 'web');
  renderTab();
}
function setTab(t, {silent} = {}){
  if (!silent && t !== S.tab) fx.select();
  S.tab = t;
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('.view').forEach(v => { const on = v.dataset.view === t; if (on && v.hidden){ v.hidden = false; v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); } else if (!on) v.hidden = true; });
  document.body.classList.toggle('tab-review', t === 'review');
  document.body.classList.toggle('tab-sitrep', t === 'sitrep');
  try { localStorage.setItem('oob.tab', t); } catch {}
  if (t === 'map') renderMapCtl();
  Radar.setActive(t === 'map' && S.mapMode === 'scope'); Web.setActive(t === 'map' && S.mapMode === 'web');
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
  for (const c of S.nlChips) parts.push(['nl', c, c]);
  if (F.q) parts.push(['q', '', `“${F.q}”`]);
  for (const g of ['seg', 'ind', 'branch', 'status', 'tier', 'sen', 'func', 'cert']) for (const v of F[g]) parts.push([g, v, v]);
  for (const v of F.sig) parts.push(['sig', v, (SIGNALS_UI.find(s => s[0] === v) || [, v])[1]]);
  if (F.agency) parts.push(['agency', '', F.agency]);
  if (F.company) parts.push(['company', '', F.company]);
  if (F.since) parts.push(['since', '', SINCE.find(s => s[0] === F.since)[1]]);
  if (F.removed) parts.push(['removed', '', 'Including removed']);
  $('#active').innerHTML = parts.map(([g, v, l]) => `<button type="button" class="achip${g === 'nl' ? ' nl' : ''}" data-rm="${g}" data-v="${esc(v)}" aria-label="Remove filter ${esc(l)}">${g === 'nl' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h3l3-7 4 14 3-7h3"/></svg>' : ''}${esc(l)}${ICON.x}</button>`).join('') + (parts.length > 1 ? '<button type="button" class="achip clear" data-act="clear">Clear all</button>' : '');
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
  function kick(){ const ta = (view.s > 1.05 || (viewTo && viewTo.s > 1.05)) ? 'none' : 'pan-y'; if (cv.style.touchAction !== ta) cv.style.touchAction = ta; if (active && !raf) raf = requestAnimationFrame(frame); }

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
  // pinch to zoom, drag to pan once zoomed, wheel on desktop, long-press to peek
  const ptrs = new Map(); let gest = null, suppress = false, pressT = 0;
  const loc = e => { const rc = cv.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top]; };
  cv.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, loc(e)); viewTo = null;
    if (ptrs.size === 1){
      const [x, y] = loc(e); gest = {type: 'pan', x, y, v: {...view}, moved: false};
      clearTimeout(pressT);
      pressT = setTimeout(() => { if (gest && !gest.moved){ const {best} = pick(e); if (best){ suppress = true; Peek.show(best.r.k); } } }, 480);
    } else if (ptrs.size === 2){
      clearTimeout(pressT); cv.setPointerCapture(e.pointerId);
      const [a, b] = [...ptrs.values()];
      gest = {type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v: {...view}};
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId) || !gest) return;
    ptrs.set(e.pointerId, loc(e));
    if (gest.type === 'pan' && ptrs.size === 1){
      const [x, y] = loc(e), dx = x - gest.x, dy = y - gest.y;
      if (Math.hypot(dx, dy) > 7){ gest.moved = true; clearTimeout(pressT); }
      if (gest.moved && view.s > 1.05){ cv.setPointerCapture(e.pointerId); view.cx = gest.v.cx - dx / (view.s * R); view.cy = gest.v.cy - dy / (view.s * R); suppress = true; kick(); }
    } else if (gest.type === 'pinch' && ptrs.size === 2){
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const sNew = Math.max(1, Math.min(6, gest.v.s * d / gest.d));
      const wx = (gest.mid[0] - W / 2) / (gest.v.s * R) + gest.v.cx, wy = (gest.mid[1] - H / 2) / (gest.v.s * R) + gest.v.cy;
      view = {s: sNew, cx: sNew <= 1.001 ? 0 : wx - (mid[0] - W / 2) / (sNew * R), cy: sNew <= 1.001 ? 0 : wy - (mid[1] - H / 2) / (sNew * R)};
      suppress = true; tip.hidden = true; kick();
    }
  });
  const pup = e => {
    clearTimeout(pressT); ptrs.delete(e.pointerId);
    if (ptrs.size === 1){ const [p] = [...ptrs.values()]; gest = {type: 'pan', x: p[0], y: p[1], v: {...view}, moved: true}; return; }
    if (!ptrs.size){ gest = null; if (view.s < 1.03 && zoomSeg){ zoomSeg = null; chip.hidden = true; view = {cx: 0, cy: 0, s: 1}; kick(); } }
  };
  cv.addEventListener('pointerup', pup); cv.addEventListener('pointercancel', pup);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = loc(e), sNew = Math.max(1, Math.min(6, view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))));
    const wx = (x - W / 2) / (view.s * R) + view.cx, wy = (y - H / 2) / (view.s * R) + view.cy;
    view = {s: sNew, cx: sNew <= 1.001 ? 0 : wx - (x - W / 2) / (sNew * R), cy: sNew <= 1.001 ? 0 : wy - (y - H / 2) / (sNew * R)};
    viewTo = null; if (sNew <= 1.001 && zoomSeg){ zoomSeg = null; chip.hidden = true; }
    kick();
  }, {passive: false});
  cv.addEventListener('click', ev => {
    if (suppress){ suppress = false; return; }
    const {best, wedge, center} = pick(ev);
    tip.hidden = true;
    if (W < 640 && !zoomSeg && view.s < 1.05 && wedge && !center){ zoomTo(wedge.seg); return; }
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

/* ---------- web (constellation) ---------- */
const Web = createWeb({
  canvas: $('#web'), wrap: $('#webWrap'), tip: $('#webTip'), chip: $('#webChip'), yearEl: $('#webYear'),
  segColor: s => segColor(s), segShort: s => (SEGS[SEGI[s]] || {short: 'Other'}).short,
  onOpen: k => { fx.tap(); openProfile(k); }, onPeek: r => Peek.show(r.k), onTap: () => fx.tap(),
  reduced: REDUCED, esc, fmt,
});
const Replay = (() => {
  const range = $('#webYearRange'), label = $('#webYearLabel'), btn = $('#webPlay');
  let timer = 0, min = 2010, max = new Date().getFullYear();
  function bounds(){
    const yrs = Web.years(S.all.filter(r => !r.x)) || [min, max];
    min = yrs[0]; max = Math.max(yrs[1], new Date().getFullYear());
    range.min = min; range.max = max + 1; if (!range.dataset.touched) range.value = max + 1;
  }
  function set(v, quiet){
    v = +v; range.value = v;
    const all = v > max;
    label.textContent = all ? 'All years' : `Through ${v}`;
    Web.setYear(all ? null : v);
    if (!quiet) fx.tap();
  }
  function stop(){ clearInterval(timer); timer = 0; btn.classList.remove('on'); btn.setAttribute('aria-label', 'Replay how your network grew'); }
  function play(){
    if (timer){ stop(); return; }
    bounds(); let y = min; set(y, true);
    btn.classList.add('on'); btn.setAttribute('aria-label', 'Stop replay');
    timer = setInterval(() => { y++; if (y > max + 1){ stop(); return; } set(y, y <= max ? false : true); if (y > max) stop(); }, REDUCED ? 300 : 850);
  }
  range.addEventListener('input', () => { range.dataset.touched = '1'; stop(); set(range.value); });
  btn.addEventListener('click', play);
  return {bounds, stop};
})();

/* ---------- peek (long-press preview) ---------- */
const Peek = (() => {
  const el = $('#peek');
  function show(k){
    const r = S.all.find(x => x.k === k); if (!r) return;
    buzz(ImpactStyle.Medium);
    const c = r.cl, star = r.ed && r.ed.star;
    const chips = [c.grade ? `${c.branch || ''} ${c.grade}`.trim() : c.branch, c.agency, c.ind !== GOV_IND && c.ind !== UNCLASSIFIED ? c.ind : '', c.status, c.func].filter(Boolean).slice(0, 4);
    el.innerHTML = `<div class="peek-card">${avatar(r)}<div class="peek-main"><b>${esc(r.f)} ${esc(r.l)}</b><span>${esc(r.p || '')}</span><span class="dim">${esc(r.c || '')}</span><div class="chips">${chips.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div></div></div>
      <div class="peek-actions"><button type="button" class="btn" data-peek-star="${esc(k)}">${star ? '★ Starred' : '☆ Star'}</button><button type="button" class="btn primary" data-peek-open="${esc(k)}">Open profile</button></div>`;
    el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  function hide(){ el.hidden = true; el.classList.remove('show'); }
  document.addEventListener('pointerdown', e => { if (!el.hidden && !e.target.closest('#peek')) setTimeout(hide, 0); }, true);
  return {show, hide};
})();

/* ---------- swipe and long-press on people rows ---------- */
(() => {
  const list = $('#people'); let sw = null;
  list.addEventListener('pointerdown', e => {
    const b = e.target.closest('.person'); if (!b || e.button > 0) return;
    sw = {b, li: b.parentElement, x: e.clientX, y: e.clientY, dx: 0, mode: null, armed: false, k: b.dataset.open};
    sw.t = setTimeout(() => { if (sw && !sw.mode){ sw.mode = 'peek'; Peek.show(sw.k); } }, 480);
  });
  list.addEventListener('pointermove', e => {
    if (!sw) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.mode){
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3){ sw.mode = 'swipe'; clearTimeout(sw.t); try { sw.b.setPointerCapture(e.pointerId); } catch {} sw.b.classList.add('dragging'); }
      else if (Math.abs(dy) > 10){ clearTimeout(sw.t); sw = null; return; }
    }
    if (sw.mode !== 'swipe') return;
    sw.dx = Math.max(-140, Math.min(140, dx));
    sw.b.style.transform = `translateX(${sw.dx}px)`;
    sw.li.classList.toggle('sw-r', sw.dx > 0); sw.li.classList.toggle('sw-l', sw.dx < 0);
    const armed = Math.abs(sw.dx) > 80;
    if (armed !== sw.armed){ sw.armed = armed; sw.li.classList.toggle('armed', armed); if (armed) fx.tap(); }
  });
  const end = async () => {
    if (!sw) return; clearTimeout(sw.t);
    const s = sw; sw = null;
    if (s.mode === 'peek'){ suppressClick(); return; }
    if (s.mode !== 'swipe') return;
    suppressClick();
    s.b.classList.remove('dragging'); s.b.style.transform = '';
    setTimeout(() => s.li.classList.remove('sw-r', 'sw-l', 'armed'), 250);
    if (s.dx > 80){ const on = !(S.edits[s.k] && S.edits[s.k].star); on ? fx.star() : fx.unstar(); await setEdit(s.k, {star: on}, {quiet: true}); const r = S.all.find(x => x.k === s.k); if (r){ s.li.outerHTML = personRow(r); } toast(on ? 'Starred' : 'Removed star'); }
    else if (s.dx < -80){ openProfile(s.k, {focusNotes: true}); }
  };
  list.addEventListener('pointerup', end); list.addEventListener('pointercancel', end);
})();
let clickBlockUntil = 0;
function suppressClick(){ clickBlockUntil = Date.now() + 350; }

/* ---------- target accounts and unit pages ---------- */
const LADDER = [[1, 'Exec, flag, SES, O-6'], [2, 'Director, O-4 to O-5, GS-15, E-9'], [3, 'Manager, O-1 to O-3, GS-13/14, senior NCO'], [4, 'Staff and individual contributors']];
function unitPeople(name){
  const n = name.toLowerCase();
  return S.all.filter(r => !r.x && (r.cl.agency === name || r.c === name || (n.length > 3 && (r.c || '').toLowerCase().includes(n))));
}
function coverage(ps){
  const lv = [0, 0, 0, 0, 0]; ps.forEach(r => lv[Math.min(4, Math.max(1, r.cl.lv))]++);
  const score = (lv[1] ? 40 : 0) + Math.min(lv[2], 2) / 2 * 30 + Math.min(lv[3], 3) / 3 * 20 + Math.min(lv[4], 3) / 3 * 10;
  return {lv, score: Math.round(score)};
}
function gapsOf(cov){
  const g = [];
  if (!cov.lv[1]) g.push('No exec, flag or SES-level contact');
  if (cov.lv[2] < 2) g.push(cov.lv[2] ? 'Only one director-level contact' : 'No director-level contact');
  if (!cov.lv[3]) g.push('No manager-level contact');
  return g;
}
function ringSVG(score, size = 64){
  const r = size / 2 - 5, C = 2 * Math.PI * r, col = score >= 75 ? 'var(--ok)' : score >= 45 ? 'var(--amber)' : 'var(--coral)';
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="Coverage ${score} percent"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="rgba(150,180,220,.14)" stroke-width="5"/><circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C * (1 - score / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="filter:drop-shadow(0 0 6px ${col})"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central">${score}</text></svg>`;
}
function animateRings(root){ requestAnimationFrame(() => requestAnimationFrame(() => $$('.ring .arc', root).forEach(a => { a.style.strokeDashoffset = a.dataset.off; }))); }
const SAMPLE_TARGETS = ['NAVFAC', 'USACE', 'DISA', 'Duke Energy', 'CISA'];
const isTarget = name => S.targets.some(t => t.name === name);
let targetsT = 0;
function saveTargets(){ if (S.mode !== 'live') return; clearTimeout(targetsT); targetsT = setTimeout(() => Store.write('targets.json', {targets: S.targets}).catch(() => {}), 400); }

function renderUnits(){
  $$('#unitsCtl button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.units === S.unitsMode)));
  $$('[data-usub]').forEach(el => { el.hidden = el.dataset.usub !== S.unitsMode; });
  if (S.unitsMode === 'orgs') renderOrgs();
  if (S.unitsMode === 'branches') renderRanks();
  if (S.unitsMode === 'industries') renderIndustries();
  if (S.unitsMode !== 'targets') return;
  const box = $('#targets');
  const cards = S.targets.map(t => {
    const ps = unitPeople(t.name), cov = coverage(ps), gaps = gapsOf(cov);
    const stars = ps.filter(r => r.ed && r.ed.star).length, news = ps.filter(r => r.isNew || r.movedNow).length;
    const seg = ps.length ? segColor(ps[0].cl.seg) : 'var(--ink-3)';
    return `<button type="button" class="tcard" data-unit="${esc(t.name)}" style="--seg:${seg}">${ringSVG(cov.score)}<span class="tmain"><b>${esc(t.name)}</b><span>${fmt(ps.length)} ${ps.length === 1 ? 'contact' : 'contacts'}${stars ? `, ${stars} starred` : ''}${news ? `, <em>${news} new or moved</em>` : ''}</span><span class="tgap">${esc(gaps[0] || 'Covered at every level')}</span></span><span class="ladder-mini">${[1, 2, 3, 4].map(l => `<i style="--n:${Math.min(cov.lv[l], 8)}"></i>`).join('')}</span></button>`;
  });
  box.innerHTML = cards.join('') + `<button type="button" class="tcard add" data-act="add-target"><span class="plus">+</span><span class="tmain"><b>Add a target</b><span>Pick an agency, command or company you're working</span></span></button>`;
  if (!S.targets.length) box.insertAdjacentHTML('afterbegin', '<p class="muted" style="grid-column:1/-1">Target accounts show how well you\'re connected at each level of the organizations you\'re selling into, and where the gaps are.</p>');
  animateRings(box);
}
function openUnit(name){
  const ps = unitPeople(name).sort((a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn);
  const cov = coverage(ps), gaps = gapsOf(cov), target = S.targets.find(t => t.name === name);
  const isCo = S.all.some(r => r.c === name) && !S.all.some(r => r.cl.agency === name);
  const indCount = new Map(); ps.forEach(r => indCount.set(r.cl.ind, (indCount.get(r.cl.ind) || 0) + 1));
  const autoInd = ([...indCount.entries()].sort((a, b) => b[1] - a[1])[0] || [UNCLASSIFIED])[0];
  const rows = LADDER.map(([lv, label]) => {
    const at = ps.filter(r => Math.min(4, Math.max(1, r.cl.lv)) === lv);
    const shown = at.slice(0, 14);
    return `<div class="rung${at.length ? '' : ' gap'}"><div class="rung-h"><span>${label}</span><b>${at.length}</b></div><div class="rung-people">${shown.map(r => `<button type="button" class="mini" data-open="${esc(r.k)}" data-back="${esc(name)}" title="${esc(r.f + ' ' + r.l)}">${avatar(r)}<span>${esc(r.f)} ${esc((r.l || '')[0] || '')}.${r.cl.grade ? ` <em>${esc(r.cl.grade)}</em>` : ''}</span></button>`).join('')}${at.length > shown.length ? `<span class="more">+${at.length - shown.length}</span>` : ''}${at.length ? '' : '<span class="muted">Nobody yet</span>'}</div></div>`;
  }).join('');
  Sheet.open('unit', `
    <div class="sh-head"><div class="unit-top">${ringSVG(cov.score, 84)}<div><h2>${esc(name)}</h2><p>${fmt(ps.length)} ${ps.length === 1 ? 'contact' : 'contacts'}, coverage ${cov.score}%</p></div></div><button type="button" class="x" data-act="close" aria-label="Close">${ICON.x}</button></div>
    ${isCo ? `<label class="unit-ind">Industry<select class="fsel sm" data-co-ind="${esc(name)}">${indOpts(S.coInd[companyKey(name)] || '', 'Auto: ' + autoInd)}</select></label>` : `<p class="unit-ind muted">${esc(autoInd)}</p>`}
    <div class="row"><button type="button" class="btn${target ? '' : ' primary'}" data-toggle-target="${esc(name)}">${target ? 'Remove from targets' : '+ Add to targets'}</button><button type="button" class="btn" data-unit-people="${esc(name)}">Show in People</button></div>
    ${gaps.length ? `<div class="gaps">${gaps.map(g => `<p><span>!</span>${esc(g)}</p>`).join('')}</div>` : '<div class="gaps ok"><p><span>✓</span>Covered at every level</p></div>'}
    <div class="ladder">${rows}</div>
    ${target ? `<label class="form full" style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--ink-2)">Account notes<textarea id="unitNote" data-unit-note="${esc(name)}" placeholder="Program, contract vehicle, next step">${esc(target.note || '')}</textarea></label>` : ''}`);
  animateRings(Sheet.body);
}
function showAddTarget(q = ''){
  const counts = new Map();
  for (const r of S.all){ if (r.x) continue; if (r.cl.agency) counts.set(r.cl.agency, (counts.get(r.cl.agency) || 0) + 1); if (r.c) counts.set(r.c, (counts.get(r.c) || 0) + 1); }
  const ql = q.toLowerCase();
  const list = [...counts.entries()].filter(([n]) => !isTarget(n) && (!ql || n.toLowerCase().includes(ql))).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const html = head('Add a target', 'Agencies, commands and companies in your network, most connected first.') +
    `<label class="search" style="background:rgba(4,10,20,.5)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input id="targetQ" type="search" value="${esc(q)}" placeholder="Search, or type a new name" autocomplete="off" autofocus></label>
    <ul class="pick">${list.map(([n, c]) => `<li><button type="button" data-add-target="${esc(n)}"><span>${esc(n)}</span><em>${fmt(c)}</em><b>+</b></button></li>`).join('')}${q && !counts.has(q) && !isTarget(q) ? `<li><button type="button" data-add-target="${esc(q)}"><span>Add “${esc(q)}”</span><em>new</em><b>+</b></button></li>` : ''}</ul>`;
  if (Sheet.kind === 'add-target'){ const ul = $('.pick', Sheet.body); ul.outerHTML = html.slice(html.indexOf('<ul class="pick">')); }
  else Sheet.open('add-target', html);
}
function toggleTarget(name){
  if (isTarget(name)){ S.targets = S.targets.filter(t => t.name !== name); fx.unstar(); toast(`Removed ${name} from targets`); }
  else { S.targets.push({name, added: TODAY}); fx.star(); toast(`Added ${name} to targets`); }
  saveTargets(); renderBadge();
  if (S.tab === 'units') renderUnits();
  if (S.tab === 'sitrep') renderSitrep();
}

/* ---------- industries ---------- */
let coIndT = 0;
function saveIndustries(){ if (S.mode !== 'live') return; clearTimeout(coIndT); coIndT = setTimeout(() => Store.write('industries.json', {companies: S.coInd}).catch(() => {}), 400); }
function setCompanyIndustry(company, ind){
  const key = companyKey(company); if (!key) return;
  if (ind) S.coInd[key] = ind; else delete S.coInd[key];
  saveIndustries();
  hydrate(S.all.map(stripRow)); render();
}
const indOpts = (cur, auto) => `<option value="">${esc(auto)}</option>` + INDUSTRIES.filter(i => i.id !== UNCLASSIFIED).map(i => `<option value="${esc(i.id)}"${cur === i.id ? ' selected' : ''}>${esc(i.id)}</option>`).join('');
function senMix(ps){ const lv = [0, 0, 0, 0, 0]; ps.forEach(r => lv[Math.min(4, Math.max(1, r.cl.lv))]++); return lv; }
function mixBar(lv, total){
  const cols = ['', 'var(--amber)', '#FFD58A', 'var(--sky)', 'rgba(150,180,220,.35)'];
  return `<span class="mix" aria-hidden="true">${[1, 2, 3, 4].map(l => lv[l] ? `<i style="flex:${lv[l]};background:${cols[l]}"></i>` : '').join('')}</span>`;
}
function unclassifiedCompanies(rows){
  const m = new Map();
  for (const r of rows){ if (r.x || r.cl.ind !== UNCLASSIFIED || !r.c) continue; m.set(r.c, (m.get(r.c) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function renderIndustries(){
  const base = VIEW.filter(r => !r.x);
  const by = new Map();
  for (const r of base){ if (!by.has(r.cl.ind)) by.set(r.cl.ind, []); by.get(r.cl.ind).push(r); }
  const list = [...by.entries()].sort((a, b) => (a[0] === UNCLASSIFIED) - (b[0] === UNCLASSIFIED) || b[1].length - a[1].length);
  const max = Math.max(1, ...list.filter(([k]) => k !== UNCLASSIFIED).map(([, v]) => v.length));
  const total = base.length || 1;
  const priv = base.filter(r => r.cl.ind !== GOV_IND).length;
  const unc = by.get(UNCLASSIFIED) || [];
  const known = total - unc.length;
  $('#indSummary').innerHTML = `
    <div class="isum"><b>${fmt(list.filter(([k]) => k !== UNCLASSIFIED).length)}</b><span>industries</span></div>
    <div class="isum"><b>${fmt(priv)}</b><span>outside government</span></div>
    <div class="isum"><b>${Math.round(known / total * 100)}%</b><span>classified</span></div>`;
  const govN = (by.get(GOV_IND) || []).length;
  $('#indTree').innerHTML = treemap(list.filter(([k]) => k !== UNCLASSIFIED && (S.indGov || k !== GOV_IND)).map(([k, v]) => [k, v.length]));
  $('#indTreeHead').innerHTML = `<span>${S.indGov ? 'Whole network by industry' : 'Private sector by industry'}</span>${govN ? `<button type="button" class="achip" data-act="ind-gov">${S.indGov ? 'Hide' : 'Show'} government (${fmt(govN)})</button>` : ''}`;
  $('#indList').innerHTML = list.map(([k, ps]) => {
    const lv = senMix(ps), cos = new Set(ps.map(r => r.c).filter(Boolean)).size;
    const top = topCompanies(ps, 2).map(([c]) => c).join(', ');
    return `<li><button type="button" data-ind="${esc(k)}" style="--c:${indColor(k)}"><span class="ihead"><i class="dot"></i><span class="n">${esc(k)}</span><span class="c">${fmt(ps.length)}<em>${Math.round(ps.length / total * 100)}%</em></span></span><span class="t"><i data-w="${k === UNCLASSIFIED ? 100 : (ps.length / max * 100).toFixed(1)}"></i></span><span class="isub">${fmt(cos)} ${cos === 1 ? 'company' : 'companies'}${top ? ': ' + esc(top) : ''}</span>${mixBar(lv)}</button></li>`;
  }).join('') || '<li class="empty">Nothing in this view</li>';
  requestAnimationFrame(() => requestAnimationFrame(() => $$('#indList i[data-w]').forEach(i => { i.style.width = i.dataset.w + '%'; })));
  const uc = unclassifiedCompanies(S.all), ucPeople = uc.reduce((a, [, n]) => a + n, 0);
  $('#uncMeta').textContent = uc.length ? `${fmt(uc.length)} ${uc.length === 1 ? 'company' : 'companies'}, ${fmt(ucPeople)} ${ucPeople === 1 ? 'person' : 'people'}. Tag a company once and everyone there, now and in future imports, follows.` : 'Every company in your network has an industry. Nice.';
  const shown = uc.slice(0, S.uncShown || 25);
  $('#uncList').innerHTML = shown.map(([c, n]) => `<li><span class="n">${esc(c)}</span><em>${fmt(n)}</em><select class="fsel sm" data-co-ind="${esc(c)}" aria-label="Industry for ${esc(c)}">${indOpts('', 'Pick industry')}</select></li>`).join('') + (uc.length > shown.length ? `<li class="more"><button type="button" class="btn" data-act="unc-more">Show ${fmt(Math.min(25, uc.length - shown.length))} more</button></li>` : '');
  $('#uncPanel').hidden = !uc.length && !Object.keys(S.coInd).length;
  const tagged = Object.keys(S.coInd).length;
  $('#uncTagged').textContent = tagged ? `${fmt(tagged)} ${tagged === 1 ? 'company' : 'companies'} tagged by you` : '';
}
function topCompanies(ps, n){ const m = new Map(); ps.forEach(r => { if (r.c) m.set(r.c, (m.get(r.c) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }
// Squarified treemap, drawn as absolutely positioned tiles in percent units.
function treemap(items){
  if (!items.length) return '';
  const W0 = 100, H0 = 100, total = items.reduce((a, [, v]) => a + v, 0);
  const nodes = items.map(([k, v]) => ({k, v, a: v / total * W0 * H0}));
  const out = []; let x = 0, y = 0, w = W0, h = H0, row = [];
  const worst = (r, side) => { const s = r.reduce((a, n) => a + n.a, 0); let m = 0; for (const n of r){ const q = Math.max(side * side * n.a / (s * s), (s * s) / (side * side * n.a)); if (q > m) m = q; } return m; };
  const layout = (r) => {
    const s = r.reduce((a, n) => a + n.a, 0);
    if (w >= h){ const cw = s / h; let cy = y; for (const n of r){ const ch = n.a / cw; out.push({...n, x, y: cy, w: cw, h: ch}); cy += ch; } x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; for (const n of r){ const cw = n.a / rh; out.push({...n, x: cx, y, w: cw, h: rh}); cx += cw; } y += rh; h -= rh; }
  };
  for (const n of nodes){
    const side = Math.min(w, h);
    if (!row.length || worst(row.concat(n), side) <= worst(row, side)) row.push(n);
    else { layout(row); row = [n]; }
  }
  if (row.length) layout(row);
  return out.map((t, i) => `<button type="button" class="tile" data-ind="${esc(t.k)}" style="left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%;--c:${indColor(t.k)};--i:${i}" title="${esc(t.k)}: ${fmt(t.v)}">${t.h > 11 && t.w > 7 ? `<span>${esc(t.w > 30 && t.h > 22 ? t.k : indShort(t.k))}</span>` : ''}<b>${fmt(t.v)}</b></button>`).join('');
}
function openIndustry(id){
  const ps = S.all.filter(r => !r.x && r.cl.ind === id).sort((a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn);
  const lv = senMix(ps), cos = topCompanies(ps, 12), maxc = cos.length ? cos[0][1] : 1;
  const fn = new Map(); ps.forEach(r => fn.set(r.cl.func, (fn.get(r.cl.func) || 0) + 1));
  const fns = [...fn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const vets = ps.filter(r => r.cl.status === 'Veteran / Retired').length, stars = ps.filter(r => r.ed && r.ed.star).length;
  const senior = ps.filter(r => r.cl.lv <= 2).slice(0, 10);
  Sheet.open('industry', `
    <div class="sh-head"><div class="unit-top"><span class="ind-badge" style="--c:${indColor(id)}">${esc(indShort(id).slice(0, 2).toUpperCase())}</span><div><h2>${esc(id)}</h2><p>${fmt(ps.length)} ${ps.length === 1 ? 'person' : 'people'} at ${fmt(new Set(ps.map(r => r.c).filter(Boolean)).size)} companies${vets ? `, ${fmt(vets)} veterans` : ''}${stars ? `, ${fmt(stars)} starred` : ''}</p></div></div><button type="button" class="x" data-act="close" aria-label="Close">${ICON.x}</button></div>
    <div class="row"><button type="button" class="btn primary" data-ind-people="${esc(id)}">Show in People</button></div>
    <h3 class="sect">Seniority</h3>
    <div class="lvls">${[['Exec', 1], ['Director', 2], ['Manager', 3], ['Staff', 4]].map(([l, i]) => `<div><b>${fmt(lv[i])}</b><span>${l}</span></div>`).join('')}</div>
    ${senior.length ? `<h3 class="sect">Most senior</h3><div class="rung-people">${senior.map(r => `<button type="button" class="mini" data-open="${esc(r.k)}" title="${esc(r.p || '')}">${avatar(r)}<span>${esc(r.f)} ${esc(r.l)}<em>${esc(r.c || '')}</em></span></button>`).join('')}</div>` : ''}
    ${cos.length ? `<h3 class="sect">Top companies</h3><ol class="bars">${cos.map(([c, n]) => `<li><button type="button" data-unit="${esc(c)}"><span class="n">${esc(c)}</span><span class="c">${fmt(n)}</span><span class="t"><i style="width:${(n / maxc * 100).toFixed(1)}%;background:${indColor(id)};color:${indColor(id)}"></i></span></button></li>`).join('')}</ol>` : ''}
    ${fns.length ? `<h3 class="sect">What they do</h3><div class="chips">${fns.map(([f, n]) => `<span class="chip">${esc(f)}<em>${fmt(n)}</em></span>`).join('')}</div>` : ''}`);
}

/* ---------- sitrep ---------- */
const ICONS = {
  review: '<path d="M7 4h10a2 2 0 0 1 2 2v14l-7-4-7 4V6a2 2 0 0 1 2-2z"/>',
  move: '<path d="M4 12h12M12 6l6 6-6 6"/>',
  new: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
  first: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  gap: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
  cake: '<path d="M4 20h16M5 20v-7h14v7M8 13V9M12 13V9M16 13V9M8 6.5v.01M12 6.5v.01M16 6.5v.01"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  grid: '<rect x="3.5" y="3.5" width="10" height="10" rx="1.5"/><rect x="15.5" y="3.5" width="5" height="7" rx="1.5"/><rect x="15.5" y="12.5" width="5" height="8" rx="1.5"/><rect x="3.5" y="15.5" width="10" height="5" rx="1.5"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z"/><circle cx="8" cy="8" r="1.4"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
};
const fullName = r => `${r.cl.grade && /^O-([3-9]|10)$/.test(r.cl.grade) && r.cl.status !== 'Veteran / Retired' ? shortRank(r) + ' ' : ''}${r.f} ${r.l}`;
function shortRank(r){ const m = {'O-10': 'Gen', 'O-9': 'Lt Gen', 'O-8': 'Maj Gen', 'O-7': 'Brig Gen', 'O-6': 'Col', 'O-5': 'Lt Col', 'O-4': 'Maj', 'O-3': 'Capt'}; const nav = {'O-6': 'CAPT', 'O-5': 'CDR', 'O-4': 'LCDR', 'O-3': 'LT'}; return (/Navy|Coast/.test(r.cl.branch) ? nav[r.cl.grade] : m[r.cl.grade]) || r.cl.grade; }
function buildCards(){
  const A = S.all.filter(r => !r.x), cards = [];
  const bySenior = (a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn;
  const names = (rs, n = 2) => rs.slice(0, n).map(r => fullName(r)).join(', ') + (rs.length > n ? ` and ${fmt(rs.length - n)} more` : '');
  const rq = Deck.count();
  if (rq) cards.push({tone: 'coral', icon: 'review', title: `${fmt(rq)} to review`, body: 'New connections and job changes from your last refresh. Swipe through them in a couple of minutes.', people: A.filter(r => r.isNew || r.movedNow).sort(bySenior), act: {kind: 'tab', tab: 'review'}});
  const moved = A.filter(r => r.movedNow).sort(bySenior), senMoved = moved.filter(r => r.cl.lv <= 2);
  if (senMoved.length){
    const top = senMoved[0];
    cards.push({tone: 'sky', icon: 'move', title: `${fmt(senMoved.length)} senior ${senMoved.length === 1 ? 'contact' : 'contacts'} changed jobs`, body: `${fullName(top)} is now ${top.p || 'in a new role'}${top.c ? ' at ' + top.c : ''}.${senMoved.length > 1 ? ' Also ' + names(senMoved.slice(1), 2) + '.' : ''}`, people: senMoved, act: {kind: 'filter', sig: ['jcw']}});
  } else if (moved.length) cards.push({tone: 'sky', icon: 'move', title: `${fmt(moved.length)} ${moved.length === 1 ? 'contact' : 'contacts'} changed jobs`, body: names(moved, 3) + '.', people: moved, act: {kind: 'filter', sig: ['jcw']}});
  const fresh = A.filter(r => r.isNew).sort(bySenior);
  if (fresh.length) cards.push({tone: 'amber', icon: 'new', title: `${fmt(fresh.length)} new ${fresh.length === 1 ? 'connection' : 'connections'}`, body: `Most senior: ${names(fresh, 2)}.`, people: fresh, act: {kind: 'filter', sig: ['new']}});
  // first contact at an organization
  const orgs = new Map();
  for (const r of A){ const o = r.cl.agency || r.c; if (!o) continue; if (!orgs.has(o)) orgs.set(o, []); orgs.get(o).push(r); }
  const firsts = [...orgs.entries()].filter(([, rs]) => rs.every(r => r.isNew)).sort((a, b) => Math.min(...a[1].map(r => r.cl.lv)) - Math.min(...b[1].map(r => r.cl.lv))).slice(0, 2);
  for (const [o, rs] of firsts) cards.push({tone: 'violet', icon: 'first', title: `First ${rs.length === 1 ? 'contact' : 'contacts'} at ${o}`, body: `${names(rs.sort(bySenior), 2)}. ${isTarget(o) ? 'It’s on your target list.' : 'Tap to see the unit and add it as a target.'}`, people: rs, act: {kind: 'unit', name: o}});
  // target coverage gaps
  if (S.targets.length){
    const weak = S.targets.map(t => { const ps = unitPeople(t.name), cov = coverage(ps); return {t, ps, cov, gaps: gapsOf(cov)}; }).filter(x => x.gaps.length).sort((a, b) => a.cov.score - b.cov.score).slice(0, 3);
    for (const w of weak) cards.push({tone: 'amber', icon: 'gap', title: `${w.t.name}: ${w.gaps[0].replace(/^No /, 'no ').replace(/^Only/, 'only')}`, body: `${fmt(w.ps.length)} ${w.ps.length === 1 ? 'contact' : 'contacts'}, coverage ${w.cov.score}%. ${w.gaps.length > 1 ? w.gaps.slice(1).join('. ') + '.' : ''}`, people: w.ps.sort(bySenior), act: {kind: 'unit', name: w.t.name}, ring: w.cov.score});
  } else cards.push({tone: 'amber', icon: 'target', title: 'Pick your target accounts', body: 'Choose the agencies, commands and companies you’re selling into. Sitrep will flag where you have no senior contact.', people: [], act: {kind: 'units'}});
  const anniv = A.filter(r => isAnniversary(r.d)).sort((a, b) => (a.d || '').localeCompare(b.d || ''));
  if (anniv.length){ const y = new Date().getFullYear(); cards.push({tone: 'green', icon: 'cake', title: `${fmt(anniv.length)} connection ${anniv.length === 1 ? 'anniversary' : 'anniversaries'} this week`, body: 'An easy reason to say hello: ' + anniv.slice(0, 2).map(r => `${fullName(r)} (${y - +r.d.slice(0, 4)} ${y - +r.d.slice(0, 4) === 1 ? 'year' : 'years'})`).join(', ') + (anniv.length > 2 ? ` and ${anniv.length - 2} more.` : '.'), people: anniv, act: {kind: 'filter', sig: ['anniv']}}); }
  const quiet = A.filter(r => r.ed && r.ed.star && (!r.ed.updated || daysAgo(r.ed.updated) > 45));
  if (quiet.length) cards.push({tone: 'amber', icon: 'star', title: `Check in with ${fmt(quiet.length)} starred ${quiet.length === 1 ? 'contact' : 'contacts'}`, body: 'No note from you in over six weeks: ' + names(quiet, 2) + '.', people: quiet, act: {kind: 'filter', sig: ['star']}});
  const dod = A.filter(r => r.cl.seg === 'DoD & Military').length, vets = A.filter(r => r.cl.status === 'Veteran / Retired').length, orgN = orgs.size;
  const indM = new Map(); A.forEach(r => { if (r.cl.ind !== GOV_IND && r.cl.ind !== UNCLASSIFIED) indM.set(r.cl.ind, (indM.get(r.cl.ind) || 0) + 1); });
  const topInd = [...indM.entries()].sort((a, b) => b[1] - a[1]);
  if (topInd.length) cards.push({tone: 'violet', icon: 'grid', title: `Outside government: ${fmt(topInd.length)} industries`, body: 'Biggest: ' + topInd.slice(0, 3).map(([k, n]) => `${k} (${fmt(n)})`).join(', ') + '.', people: [], act: {kind: 'industries'}, bars: topInd.slice(0, 6)});
  const uc = unclassifiedCompanies(S.all);
  if (uc.length){ const n = uc.reduce((a, [, v]) => a + v, 0); cards.push({tone: 'coral', icon: 'tag', title: `${fmt(uc.length)} ${uc.length === 1 ? 'company needs' : 'companies need'} an industry`, body: `${fmt(n)} ${n === 1 ? 'person isn’t' : 'people aren’t'} in an industry yet. Biggest: ${uc.slice(0, 3).map(([c]) => c).join(', ')}. Tag each company once and it sticks.`, people: [], act: {kind: 'industries'}}); }
  cards.push({tone: 'sky', icon: 'pulse', title: `${fmt(A.length)} contacts across ${fmt(orgN)} organizations`, body: `${fmt(dod)} DoD and military, ${fmt(vets)} veterans, ${fmt(A.filter(r => r.cl.seg === 'Federal Civilian').length)} federal civilian. Open the Web to see how they cluster.`, people: [], act: {kind: 'web'}});
  return cards;
}
function stack(ps){
  if (!ps.length) return '';
  const show = ps.slice(0, 5);
  return `<span class="stack">${show.map(r => avatar(r)).join('')}${ps.length > 5 ? `<span class="av more">+${fmt(ps.length - 5)}</span>` : ''}</span>`;
}
let sitrepAnimated = false;
function renderSitrep(){
  const last = S.meta && S.meta.lastImport;
  const A = S.all.filter(r => !r.x);
  $('#sitrepSub').textContent = `${dtg()}. ${fmt(A.length)} contacts${last ? `, refreshed ${niceDate(last)}` : ''}.`;
  const hist = (S.meta && S.meta.imports || []).map(i => i.total);
  $('#sitrepSpark').innerHTML = sparkPath(hist, 160, 44);
  S.cards = buildCards();
  const anim = !sitrepAnimated && !REDUCED; sitrepAnimated = true;
  $('#cards').innerHTML = S.cards.map((c, i) => `<button type="button" class="scard t-${c.tone}${anim ? ' in' : ''}" style="--i:${i}" data-card="${i}"><span class="sic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[c.icon]}</svg></span><span class="sbody"><b>${esc(c.title)}</b><span>${esc(c.body)}</span>${stack(c.people)}${c.bars ? `<span class="ibar">${c.bars.map(([k, n]) => `<i style="flex:${n};background:${indColor(k)}" title="${esc(k)}"></i>`).join('')}</span>` : ''}</span>${c.ring != null ? ringSVG(c.ring, 48) : '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'}</button>`).join('');
  animateRings($('#cards'));
}
function dtg(){ const d = new Date(), p = n => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; }
function sparkPath(vals, w, h){
  if (!vals || vals.length < 2) return '';
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const pts = vals.map((v, i) => [i * (w - 8) / (vals.length - 1) + 4, h - 6 - (v - mn) / rg * (h - 14)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const l = pts[pts.length - 1];
  return `<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB547" stop-opacity=".35"/><stop offset="1" stop-color="#FFB547" stop-opacity="0"/></linearGradient></defs><path d="${d} L${l[0].toFixed(1)} ${h} L4 ${h}Z" fill="url(#sg)" stroke="none"/><path d="${d}" stroke="#FFB547" stroke-width="1.8" fill="none"/><circle cx="${l[0]}" cy="${l[1]}" r="3.2" fill="#FFB547" stroke="none"/><text x="${w - 4}" y="${h - 3}" text-anchor="end" fill="#9DAEC6" font-size="10.5" stroke="none" font-family="IBM Plex Sans">+${fmt(vals[vals.length - 1] - vals[0])} since ${vals.length} refreshes ago</text>`;
}
function runCard(i){
  const c = S.cards[i]; if (!c) return; fx.select();
  const a = c.act;
  if (a.kind === 'tab') setTab(a.tab);
  else if (a.kind === 'unit') openUnit(a.name);
  else if (a.kind === 'units'){ S.unitsMode = 'targets'; setTab('units'); setTimeout(() => showAddTarget(), 250); }
  else if (a.kind === 'web'){ S.mapMode = 'web'; setTab('map'); }
  else if (a.kind === 'industries'){ S.unitsMode = 'industries'; setTab('units'); }
  else if (a.kind === 'filter'){ for (const k of Object.keys(F)) F[k] = F[k] instanceof Set ? new Set : (k === 'removed' ? false : ''); S.nl = null; S.nlChips = []; $('#q').value = ''; for (const s of a.sig || []) F.sig.add(s); render(); setTab('people'); }
}

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
  bars($('#coList'), top(co), 'unit', k => segColor(coSeg[k]));
  bars($('#agList'), top(ag), 'unit', k => segColor(agSeg[k]));
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
  for (const r of S.all){ if (!match(r, 'sig')) continue; for (const [s] of SIGNALS_UI) if (sigOk(r, s)) sigCounts[s] = (sigCounts[s] || 0) + 1; }
  const html = head('Filters', 'Combine as many as you like. Counts update as you go.') + `
    <div class="fgroup"><h3>Segment</h3>${facet('seg', SEGS.map(s => s.id), r => r.cl.seg)}</div>
    <div class="fgroup"><h3>Industry</h3>${facet('ind', INDUSTRIES.map(i => i.id), r => r.cl.ind)}</div>
    <div class="fgroup"><h3>Military branch</h3>${facet('branch', BRANCHES, r => r.cl.branch)}</div>
    <div class="fgroup"><h3>Service status</h3>${facet('status', STATUSES, r => r.cl.status)}</div>
    <div class="fgroup"><h3>Rank or grade</h3>${facet('tier', TIERS.map(t => t[0]), r => r.cl.tier)}</div>
    <div class="fgroup"><h3><label for="fAgency">Agency or command</label></h3><select class="fsel" id="fAgency">${selectOpts('agency', r => r.cl.agency, F.agency, 'All agencies and commands')}</select></div>
    <div class="fgroup"><h3><label for="fCompany">Company</label></h3><select class="fsel" id="fCompany">${selectOpts('company', r => r.c, F.company, 'All companies')}</select></div>
    <div class="fgroup"><h3>Seniority</h3>${facet('sen', SENIORITY, r => r.cl.sen)}</div>
    <div class="fgroup"><h3>Function</h3>${facet('func', FUNCS, r => r.cl.func)}</div>
    <div class="fgroup"><h3>Certifications</h3>${facet('cert', CERTS.map(c => c[0]), r => r.cl.certs)}</div>
    <div class="fgroup"><h3><label for="fSince">Connected</label></h3><select class="fsel" id="fSince">${SINCE.map(([v, l]) => `<option value="${v}"${F.since === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="fgroup"><h3>Signals</h3><div class="chips">${SIGNALS_UI.map(([v, l]) => `<button type="button" class="chip${F.sig.has(v) ? ' on' : ''}${sigCounts[v] ? '' : ' zero'}" data-g="sig" data-v="${v}">${l}<em>${fmt(sigCounts[v] || 0)}</em></button>`).join('')}</div></div>
    <label class="switch">Include people no longer in your export<input type="checkbox" id="fRemoved"${F.removed ? ' checked' : ''}></label>
    <div class="sheet-foot"><button type="button" class="btn" data-act="clear">Clear all</button><button type="button" class="btn primary block" data-act="close">Show ${fmt(VIEW.length)} ${VIEW.length === 1 ? 'person' : 'people'}</button></div>`;
  if (update){ const st = Sheet.body.scrollTop; Sheet.body.innerHTML = html; Sheet.body.scrollTop = st; }
  else Sheet.open('filters', html);
}

function openProfile(k, {focusNotes, back} = {}){
  const r = S.all.find(x => x.k === k); if (!r) return;
  Peek.hide();
  S.sel = k; Radar.redraw();
  const c = r.cl, ed = r.ed || {};
  const opt = (vals, cur, auto) => `<option value="">${auto}</option>` + vals.map(v => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}"${cur === val ? ' selected' : ''}>${esc(lab)}</option>`; }).join('');
  const link = S.mode === 'sample' ? '<span class="muted">Sample contact, no LinkedIn profile</span>' : r.u ? `<button type="button" class="btn" data-link="${esc(r.u)}">${ICON.ext}LinkedIn profile</button>` : '';
  const hist = (r.pv || []).map(h => `<li>${esc(h.p || '—')}<br><small>${esc(h.c || '—')}, until ${niceDate(h.until)}</small></li>`).join('');
  Sheet.open('profile', `
    ${back ? `<button type="button" class="backlink" data-unit="${esc(back)}">${ICON.back}${esc(back)}</button>` : ''}
    <div class="sh-head"><div class="prof-top">${avatar(r)}<div><h2>${esc(r.f)} ${esc(r.l)}</h2><p>${esc(r.p || '')}</p><p style="color:var(--ink)">${esc(r.c || '')}</p></div></div><button type="button" class="x" data-act="close" aria-label="Close">${ICON.x}</button></div>
    <div class="row"><button type="button" class="btn${ed.star ? ' primary' : ''}" data-act="toggle-star" data-k="${esc(k)}">${ed.star ? '★ Starred' : '☆ Star'}</button>${link}${r.e ? `<button type="button" class="btn" data-copy="${esc(r.e)}">Copy email</button>` : ''}</div>
    <dl class="kv">
      <dt>Segment</dt><dd><span style="color:${segColor(c.seg)}">●</span> ${esc(c.seg)}</dd>
      <dt>Branch</dt><dd>${esc(c.branch || '—')}</dd>
      <dt>Status</dt><dd>${esc(c.status || '—')}</dd>
      <dt>Rank</dt><dd>${c.grade ? `${c.rank && c.rank !== c.grade ? esc(c.rank) + ' ' : ''}<span class="grade">${esc(c.grade)}</span>` : '—'}</dd>
      <dt>Industry</dt><dd><span style="color:${indColor(c.ind)}">●</span> ${esc(c.ind)}${c.indHow === 'you' ? ' <span class="muted">(set by you)</span>' : ''}</dd>
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
      <label class="full">Industry<select id="eInd">${indOpts(ed.ind || (r.c && S.coInd[companyKey(r.c)]) || '', 'Auto: ' + (c.indHow === 'you' && !ed.ind ? 'set for company' : c.ind))}</select></label>
      ${r.c ? `<label class="check full"><input type="checkbox" id="eIndCo" ${ed.ind ? '' : 'checked'}> Apply to everyone at ${esc(r.c)}</label>` : ''}
      <label class="full">Rank title<input id="eRank" type="text" value="${esc(ed.rank || '')}" placeholder="${esc(c.rank || 'e.g. Colonel, USMC (Ret.)')}"></label>
      <label class="full">Tags, separated by commas<input id="eTags" type="text" value="${esc((ed.tags || []).join(', '))}" placeholder="e.g. NAVFAC target, warm intro"></label>
      <label class="full">Notes<textarea id="eNote" placeholder="How you know them, last touch, next step">${esc(ed.note || '')}</textarea></label>
      <div class="row full"><button type="submit" class="btn primary">Save changes</button><span class="muted" id="edMsg">${S.mode === 'live' ? '' : 'Sample data: changes are not saved.'}</span></div>
    </form>`);
  if (focusNotes) setTimeout(() => { const n = $('#eNote'); if (n){ n.scrollIntoView({block: 'center', behavior: REDUCED ? 'auto' : 'smooth'}); n.focus({preventScroll: true}); } }, 340);
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
  const indV = $('#eInd').value, toCo = $('#eIndCo') && $('#eIndCo').checked, rr = S.all.find(x => x.k === k);
  if (toCo && rr && rr.c){ const key = companyKey(rr.c); if (indV) S.coInd[key] = indV; else delete S.coInd[key]; saveIndustries(); }
  const patch = {ind: toCo ? '' : indV, seg: $('#eSeg').value, branch: $('#eBranch').value, status: $('#eStatus').value, grade: $('#eGrade').value, rank: $('#eRank').value.trim().slice(0, 80), tags: $('#eTags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20), note: $('#eNote').value.slice(0, 4000)};
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
    if (wasSample){ S.edits = {}; S.review = {}; S.targets = []; S.coInd = {}; await saveEdits(); await saveReview(); }
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
  const cols = ['First Name', 'Last Name', 'Company', 'Position', 'Segment', 'Industry', 'Agency / Command', 'Branch', 'Status', 'Rank', 'Grade', 'Rank Tier', 'Seniority', 'Function', 'Certifications', 'Clearance Mentioned', 'Connected On', 'First Seen', 'Job Change', 'LinkedIn URL', 'Email', 'Tags', 'Notes', 'Starred'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const csv = [cols.join(',')].concat(sorted().map(r => { const c = r.cl, e = r.ed || {}; return [r.f, r.l, r.c, r.p, c.seg, c.ind, c.agency, c.branch, c.status, c.rank, c.grade, c.tier, c.sen, c.func, c.certs.join('; '), c.clr ? 'Yes' : '', r.d, r.fs, r.jc || '', S.mode === 'sample' ? '' : r.u, r.e, (e.tags || []).join('; '), e.note, e.star ? 'Yes' : ''].map(q).join(','); })).join('\n');
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
    const [e, rv, tg, ci] = await Promise.all([Store.read('edits.json'), Store.read('review.json'), Store.read('targets.json').catch(() => ({})), Store.read('industries.json').catch(() => ({}))]);
    S.targets = (tg && tg.data && tg.data.targets) || [];
    S.coInd = (ci && ci.data && ci.data.companies) || {};
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
function clearAll(){ for (const k of Object.keys(F)) F[k] = F[k] instanceof Set ? new Set : (k === 'removed' ? false : ''); S.nl = null; S.nlChips = []; $('#q').value = ''; render(); }
document.addEventListener('click', async e => {
  if (Date.now() < clickBlockUntil){ e.preventDefault(); e.stopPropagation(); return; }
  const t = e.target.closest('button, .drop'); if (!t) return;
  const d = t.dataset;
  if (d.map){ if (d.map !== S.mapMode) setMapMode(d.map); return; }
  if (d.units){ S.unitsMode = d.units; fx.select(); try { localStorage.setItem('oob.units', d.units); } catch {} renderUnits(); return; }
  if (d.card !== undefined){ runCard(+d.card); return; }
  if (d.addTarget){ toggleTarget(d.addTarget); showAddTarget($('#targetQ') ? $('#targetQ').value : ''); return; }
  if (d.toggleTarget){ toggleTarget(d.toggleTarget); openUnit(d.toggleTarget); return; }
  if (d.unitPeople){ const n = d.unitPeople; clearAll(); if (S.all.some(r => r.cl.agency === n)) F.agency = n; else F.company = n; Sheet.close(); render(); setTab('people'); return; }
  if (d.peekStar){ const k = d.peekStar, on = !(S.edits[k] && S.edits[k].star); on ? fx.star() : fx.unstar(); await setEdit(k, {star: on}); Peek.show(k); return; }
  if (d.peekOpen){ Peek.hide(); openProfile(d.peekOpen); return; }
  if (d.open && d.back){ fx.tap(); openProfile(d.open, {back: d.back}); return; }
  if (d.unit){ fx.select(); openUnit(d.unit); return; }
  if (d.ind){ fx.select(); openIndustry(d.ind); return; }
  if (d.indPeople){ const v = d.indPeople; clearAll(); F.ind.add(v); Sheet.close(); render(); setTab('people'); return; }
  if (t.id === 'drop'){ $('#file').click(); return; }
  if (d.g){ const s = F[d.g]; s.has(d.v) ? s.delete(d.v) : s.add(d.v); fx.select(); render(); return; }
  if (d.rm){ const g = d.rm; if (g === 'nl' || g === 'q'){ $('#q').value = ''; S.nl = null; S.nlChips = []; F.q = ''; } else if (F[g] instanceof Set) F[g].delete(d.v); else if (g === 'removed') F.removed = false; else F[g] = ''; fx.tap(); render(); return; }
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
    case 'add-target': fx.tap(); showAddTarget(); return;
    case 'ind-gov': S.indGov = !S.indGov; fx.select(); renderIndustries(); return;
    case 'unc-more': S.uncShown = (S.uncShown || 25) + 25; renderIndustries(); return;
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
  else if (t.dataset && t.dataset.coInd !== undefined && t.value){ const co = t.dataset.coInd, v = t.value; const li = t.closest('li'); if (li) li.classList.add('done'); fx.star(); toast(`${co}: ${v}`); setTimeout(() => setCompanyIndustry(co, v), li ? 260 : 0); if (Sheet.kind === 'unit') setTimeout(() => openUnit(co), 300); }
  else if (t.id === 'fRemoved'){ F.removed = t.checked; render(); }
  else if (t.id === 'pHaptics'){ prefs.haptics = t.checked; savePrefs(); fx.tap(); }
  else if (t.id === 'pSound'){ prefs.sound = t.checked; savePrefs(); fx.select(); }
  else if (t.id === 'file' && t.files[0]){ handleFile(t.files[0]); t.value = ''; }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'targetQ'){ clearTimeout(t._t); t._t = setTimeout(() => showAddTarget(t.value), 120); }
  else if (t.id === 'unitNote'){ const tg = S.targets.find(x => x.name === t.dataset.unitNote); if (tg){ tg.note = t.value.slice(0, 4000); saveTargets(); } }
});
document.addEventListener('submit', e => { if (e.target.id === 'edForm'){ e.preventDefault(); saveProfileForm(e.target); } });
function applySearch(text){
  const agencies = [...new Set(S.all.map(r => r.cl.agency).filter(Boolean))];
  const {nl, rest, chips} = parseQuery(text || '', agencies);
  S.nl = nl; S.nlChips = chips; F.q = nl ? rest : (text || '').trim();
  render();
}
let qT; $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => applySearch(e.target.value), 180); });
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.target.blur(); if (S.tab === 'sitrep' || S.tab === 'review') setTab('people'); } });
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
  S.targets = SAMPLE_TARGETS.map(name => ({name, added: TODAY}));
  let startTab = 'sitrep';
  try { startTab = localStorage.getItem('oob.tab') || 'sitrep'; const m = localStorage.getItem('oob.map'); if (m === 'web' || m === 'scope') S.mapMode = m; const u = localStorage.getItem('oob.units'); if (['targets', 'industries', 'orgs', 'branches'].includes(u)) S.unitsMode = u; } catch {}
  VIEW = S.all.filter(r => match(r));
  setTab(['sitrep', 'map', 'units', 'people', 'review'].includes(startTab) ? startTab : 'sitrep', {silent: true});
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
