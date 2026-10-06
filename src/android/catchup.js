// Catch Up: new connections and job changes as a swipeable deck. Right to star,
// left to skip, with a flick counting even if the card didn't travel far.
// Ports CatchUpView.swift.
import { M, person, reviewed, isSample } from './model.js';
import { esc, fmt, icon, avatar, Day, bandLabel, segmented, empty, $, REDUCED } from './ui.js';
import { openPerson, perform } from './actions.js';
import { go } from './nav.js';
import { fx } from './platform.js';
import { accountButton, accountMenu } from './home.js';

const S = {mode: 'week', queue: [], index: 0, done: 0, starred: 0, key: '', busy: false};

function build(){
  S.queue = M.api.deck(S.mode); S.index = 0; S.done = 0; S.starred = 0;
  S.key = `${S.mode}-${M.info.lastImport}-${M.info.mode}`;
}

function deckCard(p){
  const c = p.cl, L = M.info.lens;
  const raw = (L ? [c.seg, c.agency, c.branch ? (c.grade ? `${c.branch} ${c.grade}` : c.branch) : '', c.status, c.func]
    : [c.ind === 'Unclassified' ? '' : c.ind, c.sen, c.func, c.status === 'Veteran / Retired' ? 'Veteran' : '']).filter(Boolean);
  const chips = [...new Set(raw)].slice(0, 5);
  const was = (p.pv || [])[0];
  const foot = was ? `<b>New job.</b> Was ${esc(was.p || 'unknown title')} at ${esc(was.c || 'unknown company')}` : p.isNew ? `<b>New connection.</b> Connected ${esc(Day.nice(p.d))}` : `Connected ${esc(Day.nice(p.d))}`;
  return `<div class="dc-top">${avatar(p, 96)}<i class="dot lg" style="background:${esc(p.color)}"></i></div>
    <div class="dc-who"><h2>${esc(p.full)}</h2>${p.p ? `<p class="dc-title">${esc(p.p)}</p>` : ''}${p.c ? `<p class="dc-co">${esc(p.c)}</p>` : ''}
      ${p.rx && p.rx.t ? `<p class="muted small">Last message ${esc(Day.ago(p.rx.t))}, ${esc(bandLabel(p.band).toLowerCase())}</p>` : ''}</div>
    <div class="chips-wrap">${chips.map(t => `<span class="chip static">${esc(t)}</span>`).join('')}</div>
    <div class="dc-spacer"></div>
    <div class="dc-foot ${was ? 'job' : p.isNew ? 'new' : ''}">${foot}</div>
    <span class="stamp star">STAR</span><span class="stamp skip">SKIP</span>`;
}

function finished(){
  const dots = Array.from({length: 14}, (_, i) => { const a = i / 14 * Math.PI * 2; return `<i style="--x:${(Math.cos(a) * 92).toFixed(1)}px;--y:${(Math.sin(a) * 92).toFixed(1)}px;background:${['var(--amber)', 'var(--info)', 'var(--good)', 'var(--violet)'][i % 4]}"></i>`; }).join('');
  return `<div class="finish"><div class="burst">${dots}<span class="burst-bg"></span><span class="burst-ic">${icon('check')}</span></div>
    <h2>${fmt(S.done)} ${S.done === 1 ? 'person' : 'people'} caught up</h2>
    <p class="muted">${S.starred > 0 ? `You starred ${S.starred}. They’re easy to find in People.` : 'Nothing starred this round. Your network’s up to date.'}</p>
    <div class="finish-btns">${S.starred > 0 ? '<button type="button" class="btn prominent big" data-a="seeStarred">See who you starred</button>' : ''}<button type="button" class="btn big" data-a="homeBack">Back to Home</button></div></div>`;
}

export const CatchUpView = {
  mount(el){
    el.classList.add('fill');
    el.innerHTML = `<div class="scr catch"><header class="scr-head"><h1>Catch Up</h1><div class="tools">${accountButton()}</div></header>
      <div class="seg-wrap"></div><div class="deck-area"></div></div>`;
    build();
    this.update(el);
  },
  update(el, what){
    if (S.busy) return;
    if (S.key !== `${S.mode}-${M.info.lastImport}-${M.info.mode}`) build();
    $('.scr-head .me-btn', el).outerHTML = accountButton();
    $('.seg-wrap', el).innerHTML = segmented('mode', [['week', 'Since last refresh'], ['all', 'Everyone']], S.mode);
    const area = $('.deck-area', el);
    if (S.index >= S.queue.length){
      area.innerHTML = S.done > 0 ? finished() : `<div class="deck-empty">${empty('checkCircle', S.mode === 'week' ? 'All caught up' : 'You’ve seen everyone', S.mode === 'week' ? 'New connections and job changes from your next refresh will show up here.' : 'Every person in your network has been through here.')}</div>`;
      if (S.done > 0 && S.index >= S.queue.length && !area.__celebrated){ area.__celebrated = true; fx.success(); }
      return;
    }
    area.__celebrated = false;
    area.innerHTML = `<div class="deck-progress"><div class="dp-row"><b class="mono">${S.index + 1} of ${S.queue.length}</b>${S.starred ? `<span class="mono amber">${icon('starFill')}${S.starred}</span>` : ''}</div><div class="progress"><i style="width:${(S.index / Math.max(1, S.queue.length) * 100).toFixed(1)}%"></i></div></div>
      <div class="deck"></div>
      <div class="deck-btns"><button type="button" class="dbtn skip" data-a="skip" aria-label="Skip">${icon('x')}</button><button type="button" class="dbtn open" data-a="openTop" aria-label="Open profile">${icon('card')}</button><button type="button" class="dbtn star" data-a="starTop" aria-label="Star">${icon('starFill')}</button></div>`;
    const deck = $('.deck', area);
    const vis = S.queue.slice(S.index, S.index + 3);
    vis.slice().reverse().forEach((k, ri) => {
      const i = vis.length - 1 - ri, p = person(k); if (!p) return;
      const c = document.createElement('div');
      c.className = 'dcard' + (i === 0 ? ' top' : '');
      c.style.transform = `translateY(${i * 14}px) scale(${1 - i * 0.05})`;
      c.style.zIndex = 10 - i;
      c.innerHTML = deckCard(p);
      if (i > 0) c.setAttribute('aria-hidden', 'true');
      else { c.setAttribute('role', 'button'); c.setAttribute('aria-label', `${p.full}. Swipe right to star, left to skip`); }
      deck.appendChild(c);
      if (i === 0) drag(c, k);
    });
  },
  handlers: {
    account: (_, t) => accountMenu(t),
    mode(v){ if (v === S.mode) return; fx.select(); S.mode = v; build(); CatchUpView.update(document.querySelector('.screen[data-tab="catchup"]')); },
    skip: () => decide(false),
    starTop: () => decide(true),
    openTop: () => { if (S.index < S.queue.length) openPerson(S.queue[S.index]); },
    seeStarred(){ S.done = 0; S.starred = 0; perform({kind: 'filter', sig: ['star']}); },
    homeBack(){ S.done = 0; S.starred = 0; go('home'); CatchUpView.update(document.querySelector('.screen[data-tab="catchup"]')); },
  },
};

function drag(card, k){
  let x0 = 0, y0 = 0, dx = 0, dy = 0, down = false, moved = false, armed = 0, samples = [];
  const set = () => {
    const lift = Math.min(1, Math.abs(dx) / 120);
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 16}deg) scale(${1 + lift * 0.02})`;
    const a = Math.max(0, Math.min(1, dx / 90)), b = Math.max(0, Math.min(1, -dx / 90));
    card.querySelector('.stamp.star').style.cssText = `opacity:${a};transform:rotate(-10deg) scale(${0.8 + 0.2 * a})`;
    card.querySelector('.stamp.skip').style.cssText = `opacity:${b};transform:rotate(10deg) scale(${0.8 + 0.2 * b})`;
  };
  card.addEventListener('pointerdown', e => { if (S.busy) return; down = true; moved = false; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; samples = [[performance.now(), 0, 0]]; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; });
  card.addEventListener('pointermove', e => {
    if (!down) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    samples.push([performance.now(), dx, dy]); if (samples.length > 6) samples.shift();
    const side = dx > 110 ? 1 : dx < -110 ? -1 : 0;
    if (side !== armed){ armed = side; if (side) fx.tap(); }
    set();
  });
  const end = () => {
    if (!down) return; down = false; armed = 0;
    if (!moved){ card.style.transition = ''; openPerson(k); return; }
    const [t0, ax, ay] = samples[0], dt = Math.max(16, performance.now() - t0);
    const vx = (dx - ax) / dt, vy = (dy - ay) / dt;           // px per ms
    const flingX = dx + vx * 220, flingY = dy + vy * 220;     // where it was heading
    if (dx > 110 || flingX > 320) decide(true, flingY);
    else if (dx < -110 || flingX < -320) decide(false, flingY);
    else { card.style.transition = 'transform .45s cubic-bezier(.3,1.5,.5,1)'; dx = dy = 0; set(); }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function decide(star, flingY){
  if (S.busy || S.index >= S.queue.length) return;
  const el = document.querySelector('.screen[data-tab="catchup"]');
  const card = el && el.querySelector('.dcard.top');
  const k = S.queue[S.index];
  S.busy = true;
  S.done++;
  const p = person(k);
  if (star && !(p && p.starred)) S.starred++;
  if (card){
    const dy = flingY == null ? 60 : Math.max(-300, Math.min(300, flingY));
    card.style.transition = REDUCED() ? 'transform .15s linear, opacity .15s' : 'transform .28s ease-out';
    card.style.transform = `translate(${star ? 700 : -700}px, ${dy}px) rotate(${star ? 24 : -24}deg)`;
    const s = card.querySelector(star ? '.stamp.star' : '.stamp.skip'); if (s) s.style.opacity = 1;
  }
  setTimeout(async () => {
    S.index++; S.busy = false;
    CatchUpView.update(el);
    await reviewed(k, S.mode, star);
  }, 260);
}
