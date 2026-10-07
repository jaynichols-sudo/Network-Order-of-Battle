// Today, in "the mix" (apple/Bearings/HomeView.swift and Editorial.swift): the date as an
// eyebrow, a serif headline with the count in amber, the week's five as a strip, then the
// daily five one person at a time (why them, what to remember, a draft, one button), the
// import or refresh nudge, the night-sky compass card, chips for the rest, birthdays, and
// the "worth your time" cards.
import { M, isSample, isStarter, myInitials, firstName, person, persons, weeklyPicks, weeklyDone, runList, deleteSearch, reload, lastBackup, setQuery, memory, messages } from './model.js';
import { esc, fmt, icon, avatar, stack, meAvatar, callout, toneVar, ring, animateRings, Day, menu, $, plural, REDUCED } from './ui.js';
import { createCompass } from './compass.js';
import { perform, showPeople, openPerson, open, openToday } from './actions.js';
import { go } from './nav.js';
import { exportRequested, exportRequestedAt, openURL, fx, prefs } from './platform.js';
import { liveEvents, eventChip } from './events.js';
import { nextTrip, tripChip } from './trips.js';
import { birthdaysCard } from './birthdays.js';
import { reviewYear, yearSeason } from './team.js';

const LINKEDIN_EXPORT = 'https://www.linkedin.com/mypreferences/d/download-my-data';
let compass = null, compassData = null, compassVersion = -1;
/** "Later" sends someone to the back of the line for this session. */
let later = [];
let shownK = '', lastDone = null;

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
function greeting(){
  const h = new Date().getHours();
  const base = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const n = firstName();
  return n ? `${base}, ${n}` : base;
}
const countPhrase = n => n === 1 ? 'One person' : `${n <= 10 ? WORDS[n] : fmt(n)} people`;
/** "Good morning, Jay. Five people need you." with the count picked out in amber. */
export function headline(open, total){
  const g = esc(greeting());
  if (open <= 0) return total ? `${g}. Your week is done.` : `${g}. You’re all caught up.`;
  return `${g}. <span class="count">${esc(countPhrase(open))}</span> ${open === 1 ? 'needs' : 'need'} you.`;
}
function eyebrowLine(){
  const d = new Date().toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric'}).toUpperCase();
  return isSample() ? `${d} · SAMPLE NETWORK` : d;
}

/** The avatar button on Today and elsewhere: it opens the You tab. */
export const accountButton = () => `<button type="button" class="me-btn" data-a="account" aria-label="You: refresh, backup and settings">${meAvatar(myInitials(), 40)}</button>`;
export function accountMenu(){ go('you'); }

/* ---------- the daily five ---------- */
const EYEBROW = {reply: ['WAITING ON YOU', 'var(--needs)'], congrats: ['NEW ROLE', 'var(--good)'], new: ['NEW CONNECTION', 'var(--info)']};
const ACTION = {reply: 'Reply', congrats: 'Congratulate', new: 'Say thanks'};

function openLine(picks){
  const o = picks.filter(p => !weeklyDone(p.k));
  return o.filter(p => !later.includes(p.k)).concat(later.map(k => o.find(p => p.k === k)).filter(Boolean));
}
function progressStrip(picks){
  if (!picks.length) return '';
  const done = picks.filter(p => weeklyDone(p.k)).length;
  return `<div class="pstrip" role="img" aria-label="${done} of ${picks.length} done">${picks.map((_, i) => `<i class="${i < done ? 'on' : i === done ? 'next' : ''}"></i>`).join('')}</div>`;
}
function nextLine(rest){
  const ps = persons(rest.map(w => w.k));
  const names = ps.slice(0, 2).map(p => p.full), more = ps.length - names.length;
  if (more > 0) return `Next: ${names.join(', ')} and ${more} more`;
  return 'Next: ' + (names.length === 2 ? `${names[0]} and ${names[1]}` : names[0] || '');
}
function focusCard(w, p, enter){
  const [tag, color] = EYEBROW[w.kind] || ['WORTH A NOTE', 'var(--violet)'];
  const mem = memory(w.k);
  const recall = (mem && mem.line) || w.why;
  // the draft as a pull quote, without the sign-off
  const me = (prefs.name || '').trim();
  const draft = ((messages(w.k)[0] || {}).text || '').split('\n').map(l => l.trim()).filter(l => l && l !== me && !/^[-–—]\s*\S+$/.test(l)).join(' ');
  const sub = [p.p, p.c].filter(Boolean).join(' · ');
  const n = openLine(weeklyPicks()).length;
  return `<section class="card daily-focus ${enter ? 'enter' : ''}" data-k="${esc(p.k)}">
    <button type="button" class="df-who" data-a="open" data-v="${esc(p.k)}">${avatar(p, 64)}
      <span class="df-text"><span class="eyebrow" style="color:${color}">${tag}</span><b class="serif">${esc(p.full)}</b>${sub ? `<span class="df-sub">${esc(sub)}</span>` : ''}</span></button>
    <p class="df-memory">${esc(recall)}</p>
    ${draft ? `<p class="df-draft serif">“${esc(draft)}”</p>` : ''}
    <div class="df-btns"><button type="button" class="bigpill filled" data-a="write" data-v="${esc(p.k)}">${esc(ACTION[w.kind] || 'Write')}</button>
      <button type="button" class="bigpill" data-a="later" data-v="${esc(p.k)}" ${n < 2 ? 'disabled' : ''}>Later</button></div>
  </section>`;
}
function finished(celebrate){
  const bits = celebrate && !REDUCED() ? `<span class="confetti" aria-hidden="true">${Array.from({length: 18}, (_, i) => { const a = i / 18 * Math.PI * 2, r = 70 + (i % 3) * 26; return `<i style="--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r)}px;background:${['var(--needs)', 'var(--good)', 'var(--info)', 'var(--violet)'][i % 4]}"></i>`; }).join('')}</span>` : '';
  return `<section class="card daily-done ${celebrate ? 'pop' : ''}">${bits}<span class="dd-ic">${icon('seal')}</span><h3 class="serif">This week’s five are done.</h3><p>Fresh picks arrive Monday morning.</p></section>`;
}
function dailyFive(){
  const picks = weeklyPicks();
  if (!picks.length){ lastDone = 0; return ''; }
  const open = openLine(picks), done = picks.length - open.length;
  const celebrate = lastDone != null && lastDone < done && done === picks.length;
  lastDone = done;
  later = later.filter(k => open.some(w => w.k === k));
  const w = open[0], p = w && person(w.k);
  if (!w || !p){ shownK = ''; return finished(celebrate); }
  const enter = shownK && shownK !== w.k; shownK = w.k;
  return focusCard(w, p, enter) + (open.length > 1 ? `<button type="button" class="next-line" data-a="weekly">${esc(nextLine(open.slice(1)))}</button>` : '');
}

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
  return `<p class="eyebrow">YOUR NETWORK · ${fmt(d.total || 0)}</p>${stat(t.w, 'waiting on you', 'waiting', 'big')}<div class="tstat-row">${stat(t.j, 'new jobs', 'jcw')}${d.rel ? stat(t.close, 'close', 'close') : stat(t.n, 'new', 'new')}</div>`;
}

function chips(){
  const out = [];
  const n = M.info.deckCount || 0;
  if (n) out.push(`<button type="button" class="tchip" data-a="catchup">${icon('stack')}<b>${fmt(n)}</b> to catch up</button>`);
  for (const s of M.lists){
    const k = runList(s).length;
    out.push(`<button type="button" class="tchip" data-a="list" data-v="${esc(s.id)}">${icon('pin')}${esc(s.name)} <span class="mono">· ${fmt(k)}</span></button>`);
  }
  for (const e of liveEvents().slice(0, 3)) out.push(eventChip(e));
  const trip = nextTrip(); if (trip) out.push(tripChip(trip));
  if (yearSeason() && !isSample()) out.push(`<button type="button" class="tchip" data-a="year">${icon('sparkles')}Your ${reviewYear()}</button>`);
  out.push(`<button type="button" class="tchip" data-a="notes">${icon('notePlus')}Add meeting notes</button>`);
  out.push(`<button type="button" class="tchip" data-a="explore">${icon('scope')}Explore</button>`);
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
      <header class="today-head"><div><p class="eyebrow date-line"></p><h1 class="headline serif"></h1></div>${accountButton()}</header>
      <div class="strip-slot"></div><div class="five-slot"></div>
      <div class="banner-slot"></div>
      <section class="card night night-card compass-card mini"><button type="button" class="mini-compass" data-a="explore" aria-label="Your network compass. Opens Explore"></button><div class="tstats"></div></section>
      <div class="chips-slot"></div><div class="bday-slot"></div><div class="cards-slot"></div></div>`;
    compass = createCompass({initials: myInitials(), interactive: false, labels: false});
    $('.mini-compass', el).appendChild(compass.el);
    this.ptr(el);
    this.update(el);
  },
  update(el, what){
    const picks = weeklyPicks(), open = picks.filter(p => !weeklyDone(p.k)).length;
    $('.date-line', el).textContent = eyebrowLine();
    $('.headline', el).innerHTML = headline(open, picks.length);
    $('.today-head .me-btn', el).outerHTML = accountButton();
    $('.strip-slot', el).innerHTML = progressStrip(picks);
    $('.five-slot', el).innerHTML = dailyFive();
    $('.banner-slot', el).innerHTML = banner();
    if (compassVersion !== M.version){ compassVersion = M.version; compassData = M.api.compass({}); compass.setData(compassData); compass.setInitials(myInitials()); }
    if (what === 'theme') compass.retheme();
    $('.tstats', el).innerHTML = stats(compassData);
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
    write: k => { fx.tap(); open('message', k); },
    later(k, t){
      fx.tap();
      later = later.filter(x => x !== k).concat(k);
      HomeView.update(t.closest('.screen'));
    },
    notes: () => { fx.tap(); open('notes'); },
    year: () => open('year'),
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
