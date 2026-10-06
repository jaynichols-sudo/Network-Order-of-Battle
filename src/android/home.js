// Today: the date and how many people need you, a callout when there is one, the
// compass card (tap it for Explore), the week's five as a "Needs you" card, a row of
// chips (catch up, your lists), and the "worth your time" cards. Ports HomeView.swift,
// Compass.swift (CompassCard), WeeklyBrief.swift (WeeklyCard) and SavedSearches.swift.
import { M, isSample, isStarter, myInitials, person, persons, weeklyPicks, weeklyDone, runList, deleteSearch, reload, lastBackup, setQuery } from './model.js';
import { esc, fmt, icon, avatar, stack, meAvatar, callout, toneVar, ring, animateRings, Day, menu, $, plural } from './ui.js';
import { createCompass } from './compass.js';
import { perform, showPeople, openPerson, open, openToday } from './actions.js';
import { go } from './nav.js';
import { exportRequested, exportRequestedAt, openURL, fx, prefs } from './platform.js';
import { liveEvents, eventChip } from './events.js';
import { nextTrip, tripChip } from './trips.js';
import { birthdaysCard } from './birthdays.js';

const LINKEDIN_EXPORT = 'https://www.linkedin.com/mypreferences/d/download-my-data';
let compass = null, compassData = null, compassVersion = -1;

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export function headline(open){
  if (open <= 0) return 'You’re all caught up.';
  if (open === 1) return 'One person needs you this week.';
  return `${open <= 10 ? WORDS[open] : fmt(open)} people need you this week.`;
}
const dateLine = () => new Date().toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric'});

/** The avatar button on Today and elsewhere: it opens the You tab. */
export const accountButton = () => `<button type="button" class="me-btn" data-a="account" aria-label="You: refresh, backup and settings">${meAvatar(myInitials(), 40)}</button>`;
export function accountMenu(){ go('you'); }

/* ---------- pieces ---------- */
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

function stats(d){
  const t = d.tally || {};
  const stat = (v, label, act, cls = '') => `<button type="button" class="tstat ${cls}" data-a="sig" data-v="${act}" ${v ? '' : 'disabled'} aria-label="${fmt(v)} ${label}"><b class="mono">${fmt(v)}</b><span>${label}</span></button>`;
  return `${stat(t.w, 'waiting on you', 'waiting', 'big')}<div class="tstat-row">${stat(t.j, 'new jobs', 'jcw')}${d.rel ? stat(t.close, 'close', 'close') : stat(t.n, 'new', 'new')}</div>`;
}

const ACTION = {reply: 'Reply', congrats: 'Congrats', due: 'Follow up', new: 'Thank', circle: 'Say hi', cold: 'Say hi', anniv: 'Say hi', checkin: 'Say hi'};
function needsYou(){
  const picks = weeklyPicks();
  if (!picks.length) return '';
  const done = picks.filter(p => weeklyDone(p.k)).length;
  const rows = picks.map(w => {
    const p = person(w.k); if (!p) return '';
    const d = weeklyDone(w.k), label = ACTION[w.kind] || 'Write';
    return `<div class="nrow ${d ? 'done' : ''}"><button type="button" class="nrow-main" data-a="open" data-v="${esc(p.k)}">${avatar(p, 40, {star: false})}<span class="nrow-text"><b>${esc(p.full)}</b><span>${esc(w.why)}</span></span></button>
      ${d ? `<span class="pill-btn good">${icon('check')}Done</span>` : `<button type="button" class="pill-btn ${w.kind === 'reply' ? 'primary' : 'soft'}" data-a="write" data-v="${esc(p.k)}">${esc(label)}</button>`}</div>`;
  }).join('');
  return `<section class="card needs"><button type="button" class="card-head" data-a="weekly"><h2>Needs you</h2><span class="card-meta">${done} of ${picks.length} done${icon('chevR', 'chev')}</span></button>${rows}</section>`;
}

function chips(){
  const out = [];
  const n = M.info.deckCount || 0;
  out.push(`<button type="button" class="tchip" data-a="catchup">${icon('stack')}${n ? `<b>${fmt(n)}</b> to catch up` : 'Catch up'}</button>`);
  for (const s of M.lists){
    const k = runList(s).length;
    out.push(`<button type="button" class="tchip" data-a="list" data-v="${esc(s.id)}">${icon('pin')}${esc(s.name)} <span class="mono">· ${fmt(k)}</span></button>`);
  }
  for (const e of liveEvents().slice(0, 3)) out.push(eventChip(e));
  const trip = nextTrip(); if (trip) out.push(tripChip(trip));
  return `<div class="tchips">${out.join('')}</div>`;
}

const CARD_ICONS = {'circle.circle': 'circleKey', 'rectangle.stack': 'stack', bell: 'bell', 'arrowshape.turn.up.left': 'reply', snowflake: 'snow', briefcase: 'briefcase', 'person.badge.plus': 'personPlus', flag: 'flag', scope: 'scope', gift: 'gift', star: 'star', 'square.grid.2x2': 'grid', tag: 'tag', externaldrive: 'drive', 'chart.pie': 'pie'};
function worthRow(c, i){
  const ps = persons((c.people || []).slice(0, 6));
  const bars = c.bars && c.bars.length ? (() => { const total = Math.max(1, c.bars.reduce((a, b) => a + b[1], 0)); return `<span class="bars">${c.bars.map(([, n, col]) => `<i style="flex:${n / total};background:${esc(col)}"></i>`).join('')}</span>`; })() : '';
  return `<button type="button" class="row wrow" style="--tone:${toneVar(c.tone)}" data-a="card" data-v="${i}">
    <span class="hc-ic">${icon(CARD_ICONS[c.icon] || 'sparkles')}</span>
    <span class="wrow-main"><b>${esc(c.title)}</b><span>${esc(c.body)}</span>${ps.length ? stack(ps, 26) : ''}${bars}</span>
    ${c.ring != null ? ring(c.ring, 38) : icon('chevR', 'chev')}</button>`;
}
function worth(){
  const cards = M.home.cards || [];
  if (cards.length) return `<section class="card list worth"><div class="card-head static"><h2>Worth your time</h2></div>${cards.map(worthRow).join('')}</section>`;
  return M.loaded && !isSample() ? callout({ic: 'checkCircle', tint: 'var(--good)', title: 'Nothing else waiting', text: 'No follow-ups are due. A good day to reach out to someone you haven’t talked to in a while.', button: 'Find someone', act: 'findCold'}) : '';
}

/* ---------- the view ---------- */
export const HomeView = {
  mount(el){
    el.innerHTML = `<div class="scr home">
      <header class="today-head"><div><p class="date-line"></p><h1 class="headline"></h1></div>${accountButton()}</header>
      <div class="banner-slot"></div>
      <section class="card compass-card mini"><button type="button" class="mini-compass" data-a="explore" aria-label="Open Explore"></button><div class="tstats"></div></section>
      <div class="needs-slot"></div><div class="chips-slot"></div><div class="bday-slot"></div><div class="cards-slot"></div></div>`;
    compass = createCompass({initials: myInitials(), interactive: false, labels: false});
    $('.mini-compass', el).appendChild(compass.el);
    this.ptr(el);
    this.update(el);
  },
  update(el, what){
    const picks = weeklyPicks(), open = picks.filter(p => !weeklyDone(p.k)).length;
    $('.date-line', el).textContent = dateLine();
    $('.headline', el).textContent = headline(open);
    $('.today-head .me-btn', el).outerHTML = accountButton();
    $('.banner-slot', el).innerHTML = banner();
    if (compassVersion !== M.version){ compassVersion = M.version; compassData = M.api.compass({}); compass.setData(compassData); compass.setInitials(myInitials()); }
    if (what === 'theme') compass.retheme();
    $('.tstats', el).innerHTML = stats(compassData);
    $('.needs-slot', el).innerHTML = needsYou();
    $('.chips-slot', el).innerHTML = chips();
    $('.bday-slot', el).innerHTML = birthdaysCard();
    $('.cards-slot', el).innerHTML = worth();
    animateRings(el);
  },
  onShow(){ if (compass) compass.retheme(); },
  ptr(el){
    // pull down at the top of Today to reload from disk
    let y0 = null, dy = 0;
    const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = icon('refresh'); el.prepend(ind);
    el.addEventListener('touchstart', e => { y0 = el.scrollTop <= 0 && !e.target.closest('.tchips') ? e.touches[0].clientY : null; dy = 0; }, {passive: true});
    el.addEventListener('touchmove', e => { if (y0 == null) return; dy = e.touches[0].clientY - y0; if (dy <= 0) return; const p = Math.min(1, dy / 90); ind.style.opacity = p; ind.style.transform = `translateY(${p * 46}px) rotate(${p * 270}deg)`; }, {passive: true});
    el.addEventListener('touchend', async () => { if (y0 == null) return; y0 = null; if (dy >= 90){ fx.tap(); ind.classList.add('spin'); await reload(); } ind.classList.remove('spin'); ind.style.opacity = 0; ind.style.transform = ''; });
  },
  handlers: {
    account: () => go('you'),
    explore: () => { fx.tap(); openToday('explore'); },
    catchup: () => { fx.tap(); openToday('catchup'); },
    weekly: () => open('weekly'),
    open: k => openPerson(k),
    write: k => open('message', k),
    sig: v => { fx.tap(); if (v === 'close') showPeople({rel: ['Close']}); else perform({kind: 'filter', sig: [v]}); },
    card: i => perform((M.home.cards[+i] || {}).act),
    import: () => open('import'),
    askLinkedIn: () => { openURL(LINKEDIN_EXPORT); exportRequested(); HomeView.update(document.querySelector('.screen[data-tab="home"]')); },
    findCold: () => showPeople({sig: ['cold']}),
    list(id){ runSavedList(id); },
    event: id => { fx.tap(); open('event', id); },
    trip: id => { fx.tap(); open('trip', id); },
    birthdays: () => open('birthdays'),
  },
};
export function runSavedList(id){ const s = M.lists.find(x => x.id === id); if (!s) return; fx.tap(); showPeople(s.filters, s.text); setQuery({sort: s.sort}); }
export function listMenu(id, t){ const s = M.lists.find(x => x.id === id); if (s) menu(t, [{label: `Unpin “${s.name}”`, icon: 'pin', danger: true, run: () => deleteSearch(id)}]); }
export { prefs, lastBackup, plural };
