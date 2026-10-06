// Plain logic behind events, trips and birthdays: no DOM, no plugins, so it can be
// tested in Node. Ports the rules in Events.swift, CalendarService.swift (trips) and
// AppModel.swift / Geo.swift (birthdays). Dates are local "YYYY-MM-DD" strings.

export const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const parseDay = s => { if (!s || s.length < 10) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
/** Whole days from a to b (b later is positive). */
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return ymd(d); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const monDay = s => { const d = parseDay(s); return d ? `${MON[d.getMonth()]} ${d.getDate()}` : ''; };
/** "Oct 6" or "Oct 6 to Oct 8". */
export const whenText = (start, end) => start === end || !end ? monDay(start) : `${monDay(start)} to ${monDay(end)}`;
/** How a message says when you'll be there: "tomorrow", "this Thursday", "next week". */
export function whenPhrase(start, end, today){
  const days = daysBetween(today, start);
  if (days <= 0) return 'this week';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `this ${WDAY[parseDay(start).getDay()]}`;
  if (days < 14) return 'next week';
  return `on ${whenText(start, end)}`;
}

/* ---------- events ---------- */
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const eventOn = (e, today) => today >= e.start && today <= addDays(e.end, 1);
export const eventUpcoming = (e, today) => today < e.start;
export const eventRecent = (e, today) => !eventOn(e, today) && !eventUpcoming(e, today) && daysBetween(e.end, today) < 22;

/** Followed up if you ticked it, messaged them since the event started, or logged a touch
 *  after the day you added them (adding someone you met logs a touch for that day). */
export function followedUp(m, e, p){
  if (m.followed) return true;
  if (!m.k || !p) return false;
  const since = e.start, metDay = (m.at || '').slice(0, 10);
  const touched = (p.ed && p.ed.touched) || '';
  return (!!(p.rx && p.rx.t) && p.rx.t >= since && p.rx.dir === 'o') || (touched >= since && touched > metDay);
}
export const toFollowUp = (e, personOf) => (e.met || []).filter(m => !followedUp(m, e, m.k ? personOf(m.k) : null));

/** A pasted or exported attendee list: one person per line, a name, an email, or both. */
export function parseAttendees(text){
  const emailRx = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)){
    const line = raw.trim(); if (!line) continue;
    const em = line.match(emailRx), email = em ? em[0] : '';
    const cells = line.split(/[,\t;]/).map(c => c.replace(/^[\s"]+|[\s"]+$/g, '')).filter(c => c && !c.includes('@'));
    if (cells[0] && cells[0].toLowerCase().includes('name') && cells.length > 1 && !out.length && !email) continue; // a header row
    let name = cells[0] || '';
    // "First, Last" spread over two columns
    if (cells.length >= 2 && !name.includes(' ') && !cells[1].includes(' ') && /^\p{Lu}/u.test(cells[1])){ name += ' ' + cells[1]; cells.shift(); }
    if (email || name.includes(' ')) out.push({email, name});
  }
  return out;
}

export const linkedInSearch = m => 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent([m.name, m.company].filter(Boolean).join(' '));

/* ---------- trips ---------- */
export function miles(a, b){
  const R = 3958.8, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** People placed within `radius` miles of a trip, warmest first, then closest. Rough
 *  (area-code-only) places are left out, as on the iPhone. */
export function nearby(trip, places, personOf, radius = 50){
  const out = [];
  for (const [k, pl] of Object.entries(places || {})){
    if (pl.prec && pl.prec !== 'city') continue;
    const p = personOf(k); if (!p || p.x) continue;
    const d = miles(trip, pl);
    if (d <= radius) out.push({p, place: pl, d});
  }
  return out.sort((a, b) => (b.p.score || 0) - (a.p.score || 0) || a.d - b.d);
}
export const activeTrips = (trips, today) => (trips || []).filter(t => t.end >= today).sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
/** The trip to show on Today: under way, or starting within 30 days. */
export const soonTrip = (trips, today) => activeTrips(trips, today).find(t => daysBetween(today, t.start) <= 30) || null;

/* ---------- birthdays ---------- */
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** "MM-dd" for each person matched to a Contacts card with a birthday. Same matching as
 *  the map: email first, then a unique full name (or the same name at the same company). */
export function birthdaysFromContacts(rows, contacts){
  const byEmail = new Map(), byName = new Map();
  for (const c of contacts || []){
    for (const e of c.emails || []) if (e.address) byEmail.set(e.address.toLowerCase(), c);
    const n = norm(`${(c.name && c.name.given) || ''} ${(c.name && c.name.family) || ''}`);
    if (n.includes(' ')){ const l = byName.get(n) || []; l.push(c); byName.set(n, l); }
  }
  const out = {};
  for (const r of rows){
    if (r.x) continue;
    let card = r.e ? byEmail.get(r.e.toLowerCase()) : null;
    if (!card){ const l = byName.get(norm(`${r.f} ${r.l}`)); if (l && l.length === 1) card = l[0]; else if (l) card = l.find(c => norm(c.organization && c.organization.company) === norm(r.c)); }
    const b = card && card.birthday;
    if (b && b.month && b.day) out[r.k] = String(b.month).padStart(2, '0') + '-' + String(b.day).padStart(2, '0');
  }
  return out;
}
/** The next date (YYYY-MM-DD) for a "MM-dd" birthday, today or later. Feb 29 falls on Mar 1 in other years. */
export function nextBirthday(md, today){
  const [m, d] = String(md || '').split('-').map(Number); if (!m || !d) return '';
  const t = parseDay(today);
  for (const y of [t.getFullYear(), t.getFullYear() + 1]){
    const dt = new Date(y, m - 1, d), s = ymd(dt);
    if (s >= today) return s;
  }
  return '';
}
export function upcomingBirthdays(births, personOf, today, within = 7){
  const limit = addDays(today, within), out = [];
  for (const [k, md] of Object.entries(births || {})){
    const p = personOf(k); if (!p || p.x) continue;
    const date = nextBirthday(md, today);
    if (date && date <= limit) out.push({p, date});
  }
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.p.full || '').localeCompare(b.p.full || ''));
}
export function birthdayLabel(date, today){
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  const d = parseDay(date);
  return `${WDAY[d.getDay()].slice(0, 3)}, ${MON[d.getMonth()]} ${d.getDate()}`;
}
