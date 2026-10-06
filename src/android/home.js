// Home: greeting, the Monday brief, the compass, pinned lists, a nudge banner,
// and the "worth your time" cards. Ports HomeView.swift, Compass.swift (CompassCard),
// WeeklyBrief.swift (WeeklyCard) and SavedSearches.swift.
import { M, isSample, isStarter, firstName, myInitials, persons, weeklyPicks, weeklyDone, runList, deleteSearch, reload, lastBackup, setQuery } from './model.js';
import { esc, fmt, icon, stack, ring, animateRings, meAvatar, callout, toneVar, Day, menu, $, $$, plural } from './ui.js';
import { createCompass } from './compass.js';
import { perform, showPeople, showSector, openPerson, openIndustry, open, GOV_SEGS } from './actions.js';
import { exportRequested, exportRequestedAt, openURL, fx, prefs } from './platform.js';

const LINKEDIN_EXPORT = 'https://www.linkedin.com/mypreferences/d/download-my-data';
let compass = null, compassData = null, compassVersion = -1;

function greeting(){
  const h = new Date().getHours();
  const base = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return firstName() ? `${base}, ${firstName()}` : base;
}
function subline(){
  if (isSample()) return 'You’re looking around a sample network.';
  if (isStarter()) return `${fmt(M.info.count)} people from your contacts`;
  return `${fmt(M.info.count)} people${M.info.lastImport ? `, refreshed ${Day.nice(M.info.lastImport)}` : ''}`;
}

export function accountMenu(t){
  menu(t, [
    {label: isSample() ? 'Import connections' : 'Refresh connections', icon: 'download', run: () => open('import')},
    ...(isSample() ? [] : [{label: 'Back up notes', icon: 'drive', run: () => open('backup')}]),
    'sep',
    {label: 'Settings', icon: 'gear', run: () => open('settings')},
  ]);
}
export const accountButton = () => `<button type="button" class="me-btn" data-a="account" aria-label="Account, refresh and settings">${meAvatar(myInitials(), 34)}</button>`;

/* ---------- pieces ---------- */
function weeklyCard(){
  const picks = weeklyPicks();
  if (!picks.length) return '';
  const done = picks.filter(p => weeklyDone(p.k)).length, all = done >= picks.length;
  const names = persons(picks.filter(p => !weeklyDone(p.k)).map(p => p.k)).slice(0, 3).map(p => p.f);
  const C = 2 * Math.PI * 20, off = C * (1 - done / Math.max(1, picks.length));
  return `<button type="button" class="card weekly ${all ? '' : 'hot'}" data-a="weekly">
    <span class="wk-ring"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" class="ring-bg"/><circle cx="24" cy="24" r="20" class="wk-arc" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg><b class="mono">${done}/${picks.length}</b></span>
    <span class="wk-text"><b>${all ? 'Your week is done' : `Your week: ${picks.length - done} to reach out to`}</b><span>${esc(all ? 'Nice work. A new five arrive Monday morning.' : names.join(', ') + '. A reason and a draft for each.')}</span></span>
    ${icon('chevR', 'chev')}</button>`;
}

function signals(d){
  const t = d.tally || {};
  const chip = (v, label, color, kind, act) => `<button type="button" class="sig ${v ? '' : 'off'}" data-a="sig" data-v="${act}" ${v ? '' : 'disabled'} aria-label="${fmt(v)} ${label}"><span class="sig-dot ${kind}" style="--dc:${color}"><i></i></span><b class="mono">${fmt(v)}</b><span>${label}</span></button>`;
  return `<div class="sigs">${chip(t.w, 'waiting on you', 'var(--amber)', 'glow', 'waiting')}${t.o ? chip(t.o, 'overdue', 'var(--violet)', 'ring', 'overdue') : ''}${chip(t.j, 'new jobs', 'var(--info)', 'ring', 'jcw')}${chip(t.n, 'new connections', 'var(--accent)', 'ring', 'new')}${d.rel ? chip(t.close, 'close', 'var(--good)', '', 'close') : ''}</div>`;
}
function sectorPanel(d, w){
  const parts = [];
  if (d.rel) parts.push(w.close === 0 ? 'No one close yet' : `${w.close} close`);
  if (w.flagged > 0) parts.push(`${w.flagged} worth a look now`);
  const line = parts.length ? parts.join(', ') + '.' : 'Closer to the middle means more senior.';
  return `<div class="sector-panel"><div class="sp-head"><i class="dot lg" style="background:${esc(w.color)}"></i><h3>${esc(w.id)}</h3><span class="mono muted">${fmt(w.n)}</span></div>
    <p class="muted">${esc(line)}</p>
    <div class="btn-row"><button type="button" class="btn prominent" data-a="sectorPeople" data-v="${esc(w.id)}">${icon('people')}See everyone</button>${GOV_SEGS.includes(w.id) ? '' : `<button type="button" class="btn" data-a="sectorCos" data-v="${esc(w.id)}">${icon('building')}Companies</button>`}</div>
    <p class="hint">Tap a dot to open someone.</p></div>`;
}
function sectorStrip(d){
  const f = compass && compass.focus();
  return `<div class="strip">${d.wedges.slice().sort((a, b) => b.n - a.n).map(w => `<button type="button" class="pill ${f === w.id ? 'on' : ''}" style="--pc:${esc(w.color)}" data-a="sector" data-v="${esc(w.id)}"><i class="dot" style="background:${esc(w.color)}"></i><b>${esc(w.short)}</b><span class="mono">${fmt(w.n)}</span></button>`).join('')}</div>`;
}
function listsStrip(){
  if (!M.lists.length) return '';
  return `<section><h2 class="h2">Your lists</h2><div class="strip lists">${M.lists.map(s => {
    const keys = runList(s), ps = persons(keys.slice(0, 4));
    return `<div class="card list-card" data-a="list" data-v="${esc(s.id)}" role="button" tabindex="0"><b class="lc-name">${esc(s.name)}</b><span class="lc-n mono">${fmt(keys.length)}</span>${ps.length ? stack(ps, 22) : '<span class="muted small">No one yet</span>'}<button type="button" class="lc-more" data-a="listMenu" data-v="${esc(s.id)}" aria-label="More">${icon('more')}</button></div>`;
  }).join('')}</div></section>`;
}
function banner(){
  if (M.error) return callout({ic: 'warn', tint: 'var(--bad)', title: 'Couldn’t load', text: M.error});
  if (isStarter()){
    const at = exportRequestedAt();
    if (at) return callout({ic: 'mail', tint: 'var(--info)', title: 'Watch for LinkedIn’s email', text: `You asked for your LinkedIn data ${Day.ago(at.toISOString().slice(0, 10))}. When the email arrives, download the file and open it with Bearings. Your notes and stars come along.`, button: 'I have the file', act: 'import'});
    return callout({ic: 'download', tint: 'var(--accent)', title: 'This is your contacts. Add LinkedIn for the full picture', text: 'LinkedIn adds everyone you’re connected to, who you message, and who changed jobs.', button: 'Ask LinkedIn for my data', act: 'askLinkedIn'});
  }
  if (isSample()) return callout({ic: 'download', tint: 'var(--accent)', title: 'See your own network', text: 'Import your LinkedIn connections. It takes about three minutes and stays private to you.', button: 'Import connections', act: 'import'});
  const days = Day.since(M.info.lastImport);
  if (days != null && days >= 7) return callout({ic: 'refresh', tint: 'var(--accent)', title: 'Time for a refresh', text: `It’s been ${days} days. A new LinkedIn export picks up job changes and new connections.`, button: 'Refresh now', act: 'import'});
  return '';
}
function homeCard(c, i){
  const ps = persons((c.people || []).slice(0, 6));
  const bars = c.bars && c.bars.length ? (() => { const total = Math.max(1, c.bars.reduce((a, b) => a + b[1], 0)); return `<span class="bars">${c.bars.map(([, n, col]) => `<i style="flex:${n / total};background:${esc(col)}"></i>`).join('')}</span>`; })() : '';
  return `<button type="button" class="card hcard ${c.hero ? 'hero' : ''}" style="--tone:${toneVar(c.tone)}" data-a="card" data-v="${i}">
    <span class="hc-ic">${icon(CARD_ICONS[c.icon] || 'sparkles')}</span>
    <span class="hc-main"><b>${esc(c.title)}</b><span class="muted">${esc(c.body)}</span>${ps.length ? stack(ps, 26) : ''}${bars}</span>
    ${c.ring != null ? ring(c.ring, 46) : icon('chevR', 'chev')}</button>`;
}
const CARD_ICONS = {'circle.circle': 'circleKey', 'rectangle.stack': 'stack', bell: 'bell', 'arrowshape.turn.up.left': 'reply', snowflake: 'snow', briefcase: 'briefcase', 'person.badge.plus': 'personPlus', flag: 'flag', scope: 'scope', gift: 'gift', star: 'star', 'square.grid.2x2': 'grid', tag: 'tag', externaldrive: 'drive', 'chart.pie': 'pie'};

/* ---------- the view ---------- */
export const HomeView = {
  mount(el){
    el.innerHTML = `<div class="scr home">
      <header class="home-head"><div><h1 class="greet"></h1><p class="muted sub"></p></div>${accountButton()}</header>
      <div class="weekly-slot"></div>
      <section class="card compass-card"><div class="compass-wrap">
        <button type="button" class="glass-chip whole" data-a="whole" hidden>${icon('collapse')}Whole network</button>
        <button type="button" class="glass-circle share-btn" data-a="share" aria-label="Share a picture of your network">${icon('share')}</button>
      </div><div class="compass-under"></div><div class="compass-strip"></div></section>
      <div class="lists-slot"></div><div class="banner-slot"></div><div class="cards-slot"></div></div>`;
    compass = createCompass({initials: myInitials(), onOpen: k => { fx.tap(); openPerson(k); }, onTapSector: () => fx.tap(), onFocus: () => this.compassUI(el)});
    $('.compass-wrap', el).prepend(compass.el);
    this.ptr(el);
    this.update(el);
  },
  update(el, what){
    $('.greet', el).textContent = greeting();
    $('.sub', el).textContent = subline();
    $('.home-head .me-btn', el).outerHTML = accountButton();
    $('.weekly-slot', el).innerHTML = weeklyCard();
    if (compassVersion !== M.version){ compassVersion = M.version; compassData = M.api.compass({}); compass.setData(compassData); compass.setInitials(myInitials()); }
    if (what === 'theme') compass.retheme();
    this.compassUI(el);
    $('.lists-slot', el).innerHTML = listsStrip();
    $('.banner-slot', el).innerHTML = banner();
    const cards = M.home.cards || [];
    $('.cards-slot', el).innerHTML = cards.length
      ? `<h2 class="h2">Worth your time</h2><div class="cards">${cards.map(homeCard).join('')}</div>`
      : (M.loaded && !isSample() ? callout({ic: 'checkCircle', tint: 'var(--good)', title: 'You’re all caught up', text: 'Nobody’s waiting on you and no follow-ups are due. A good day to reach out to someone you haven’t talked to in a while.', button: 'Find someone', act: 'findCold'}) : '');
    animateRings(el);
  },
  compassUI(el){
    if (!compassData) return;
    const f = compass.focus(), w = f && compassData.wedges.find(x => x.id === f);
    $('.whole', el).hidden = !w; $('.share-btn', el).hidden = !!w;
    $('.compass-under', el).innerHTML = w ? sectorPanel(compassData, w) : signals(compassData);
    const strip = $('.compass-strip', el), sl = strip.firstElementChild ? strip.firstElementChild.scrollLeft : 0;
    strip.innerHTML = sectorStrip(compassData);
    strip.firstElementChild.scrollLeft = sl;
  },
  onShow(){ if (compass) compass.retheme(); },
  ptr(el){
    // pull down at the top of Home to reload from disk
    let y0 = null, dy = 0;
    const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = icon('refresh'); el.prepend(ind);
    el.addEventListener('touchstart', e => { y0 = el.scrollTop <= 0 && !e.target.closest('.compass, .strip') ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
    el.addEventListener('touchmove', e => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) return; const p = Math.min(1, dy / 90); ind.style.opacity = p; ind.style.transform = `translateY(${p * 46}px) rotate(${p * 270}deg)`; }, {passive: true});
    el.addEventListener('touchend', async () => { if (y0 == null) return; y0 = null; if (dy >= 90){ fx.tap(); ind.classList.add('spin'); await reload(); } ind.classList.remove('spin'); ind.style.opacity = 0; ind.style.transform = ''; });
  },
  handlers: {
    account: (_, t) => accountMenu(t),
    weekly: () => open('weekly'),
    share: () => { fx.tap(); open('share'); },
    whole: () => { fx.tap(); compass.setFocus(null); },
    sector: v => { fx.tap(); compass.setFocus(compass.focus() === v ? null : v); },
    sectorPeople: v => showSector(v),
    sectorCos: v => openIndustry(v),
    sig: v => { fx.tap(); if (v === 'close') showPeople({rel: ['Close']}); else perform({kind: 'filter', sig: [v]}); },
    card: i => perform((M.home.cards[+i] || {}).act),
    import: () => open('import'),
    askLinkedIn: () => { openURL(LINKEDIN_EXPORT); exportRequested(); HomeView.update(document.querySelector('.screen[data-tab="home"]')); },
    findCold: () => showPeople({sig: ['cold']}),
    list(id){ const s = M.lists.find(x => x.id === id); if (!s) return; fx.tap(); showPeople(s.filters, s.text); setQuery({sort: s.sort}); },
    listMenu(id, t, e){ e.stopPropagation(); const s = M.lists.find(x => x.id === id); if (s) menu(t, [{label: `Unpin “${s.name}”`, icon: 'pin', danger: true, run: () => deleteSearch(id)}]); },
  },
};
export { prefs, lastBackup };
