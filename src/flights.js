// Flights and travel feeds: spots a flight in a calendar event (Flighty, TripIt, airline
// emails turned into events), reads iCalendar feeds (a TripIt feed URL, or any .ics), and
// turns them into trips placed at the city you land in. Plain JS, no DOM, no network:
// the apps fetch the feed on the device and hand the text over.
import { airport, airportByCity } from './airports.js';

/* ---------- airlines ---------- */
const AIRLINES = {AA: 'American', UA: 'United', DL: 'Delta', WN: 'Southwest', B6: 'JetBlue', AS: 'Alaska', NK: 'Spirit', F9: 'Frontier', G4: 'Allegiant', HA: 'Hawaiian', SY: 'Sun Country', MX: 'Breeze', XP: 'Avelo',
  '9E': 'Endeavor', OH: 'PSA', MQ: 'Envoy', YX: 'Republic', OO: 'SkyWest', QX: 'Horizon', G7: 'GoJet', ZW: 'Air Wisconsin', C5: 'CommuteAir', PT: 'Piedmont', YV: 'Mesa',
  AC: 'Air Canada', WS: 'WestJet', BA: 'British Airways', AF: 'Air France', KL: 'KLM', LH: 'Lufthansa', LX: 'Swiss', OS: 'Austrian', SN: 'Brussels Airlines', EI: 'Aer Lingus', IB: 'Iberia', VS: 'Virgin Atlantic', AZ: 'ITA Airways', TP: 'TAP Air Portugal', SK: 'SAS', AY: 'Finnair', FI: 'Icelandair', EW: 'Eurowings', U2: 'easyJet', FR: 'Ryanair',
  EK: 'Emirates', QR: 'Qatar Airways', EY: 'Etihad', TK: 'Turkish Airlines', LY: 'El Al', SV: 'Saudia', ET: 'Ethiopian', AI: 'Air India',
  SQ: 'Singapore Airlines', CX: 'Cathay Pacific', JL: 'Japan Airlines', NH: 'ANA', KE: 'Korean Air', OZ: 'Asiana', CI: 'China Airlines', BR: 'EVA Air', CA: 'Air China', MU: 'China Eastern', CZ: 'China Southern', QF: 'Qantas', NZ: 'Air New Zealand', PR: 'Philippine Airlines',
  AM: 'Aeromexico', Y4: 'Volaris', VB: 'Viva Aerobus', AV: 'Avianca', CM: 'Copa', LA: 'LATAM'};
// codes that also read as US states, Delaware or times ("CA 2026", "9 AM 2"): need other signs of a flight
const AMBIGUOUS = new Set(['CA', 'LA', 'AS', 'OH', 'AZ', 'AM', 'PR', 'AI', 'SV', 'FR', 'MX', 'PT']);
const NAMES = [['american airlines', 'AA'], ['american', 'AA'], ['united airlines', 'UA'], ['united', 'UA'], ['delta air lines', 'DL'], ['delta', 'DL'], ['southwest airlines', 'WN'], ['southwest', 'WN'], ['jetblue', 'B6'], ['alaska airlines', 'AS'], ['alaska', 'AS'],
  ['spirit airlines', 'NK'], ['spirit', 'NK'], ['frontier airlines', 'F9'], ['frontier', 'F9'], ['allegiant', 'G4'], ['hawaiian airlines', 'HA'], ['hawaiian', 'HA'], ['sun country', 'SY'], ['breeze', 'MX'], ['avelo', 'XP'],
  ['air canada', 'AC'], ['westjet', 'WS'], ['british airways', 'BA'], ['air france', 'AF'], ['klm', 'KL'], ['lufthansa', 'LH'], ['swiss', 'LX'], ['aer lingus', 'EI'], ['iberia', 'IB'], ['virgin atlantic', 'VS'], ['emirates', 'EK'], ['qatar airways', 'QR'], ['etihad', 'EY'], ['turkish airlines', 'TK'],
  ['singapore airlines', 'SQ'], ['cathay pacific', 'CX'], ['japan airlines', 'JL'], ['korean air', 'KE'], ['qantas', 'QF'], ['aeromexico', 'AM'], ['copa', 'CM'], ['avianca', 'AV']];
const NAME_RE = new RegExp(`\\b(${NAMES.map(n => n[0].replace(/ /g, '\\s+')).join('|')})(?:\\s+air(?:lines|ways)?)?\\s*(?:flight|flt)?\\s*(?:#|no\\.?|number)?\\s*(\\d{1,4})\\b(?!\\s*(?:am|pm|:|\\/|-\\d))`, 'i');
const CONTEXT = /✈|🛫|🛬|\bflight\b|\bflt\b|\bairlines?\b|\bairways\b|\bdepart|\barriv|→|->|\bgate\b|\bseat\b|\bboarding\b|\bterminal\b|\bconfirmation\b|\bnonstop\b|\blayover\b/i;
const CODE_RE = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{1,4})(?![0-9]|\s*(?:AM|PM|am|pm|:\d))/g;

function flightNumber(text, context){
  CODE_RE.lastIndex = 0;
  for (let m; (m = CODE_RE.exec(text));){
    const code = m[1];
    if (!AIRLINES[code]) continue;
    if (AMBIGUOUS.has(code) && !context) continue;
    return {carrier: code, number: String(+m[2])};
  }
  return null;
}
// "Delta 2087", "United flight 92", "American Airlines #1234"
function namedFlight(text){
  const n = String(text || '').match(NAME_RE);
  if (!n) return null;
  const name = n[1].toLowerCase().replace(/\s+/g, ' '), hit = NAMES.find(x => x[0] === name);
  return hit ? {carrier: hit[1], number: String(+n[2]), yearish: +n[2] >= 1990 && +n[2] <= 2040} : null;
}

/* ---------- airports in text ---------- */
const ARROW = '(?:→|⟶|➔|➜|->|=>|—|–|-|>|✈️?|✈|\\bto\\b|\\/)';
const ROUTE_RE = new RegExp(`(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])\\s*(?:\\)\\s*)?${ARROW}\\s*(?:[^()\\n]{0,40}?\\(\\s*)?([A-Z]{3})(?![A-Za-z])`, 'g');
function routeCodes(text){
  ROUTE_RE.lastIndex = 0;
  for (let m; (m = ROUTE_RE.exec(text));){
    if (m[1] !== m[2] && airport(m[1]) && airport(m[2])) return [m[1], m[2]];
    ROUTE_RE.lastIndex = m.index + 1;
  }
  // "Charlotte (CLT) … San Diego (SAN)"
  const paren = [...text.matchAll(/\(([A-Z]{3})\)/g)].map(m => m[1]).filter(c => airport(c));
  if (paren.length >= 2 && paren[0] !== paren[paren.length - 1]) return [paren[0], paren[paren.length - 1]];
  return null;
}
// "Arrive: San Diego (SAN)", "arr SAN 10:10am", "Departs CLT"
function labelledCode(text, word){
  const re = new RegExp(`\\b${word}[a-z]*\\b[:\\s]*([^\\n]{0,48})`, 'gi');
  for (const m of text.matchAll(re)){
    for (const c of m[1].matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)) if (airport(c[1])) return c[1];
  }
  return null;
}
// "Charlotte, NC to San Diego, CA", "Flight to San Diego (AA 1234)", "Flight from Boston to Denver"
const MONTH = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b\.?(?:\s+\d{1,2}\b)?/gi;
const cleanCity = s => String(s || '').replace(/\([^)]*\)/g, ' ').split(/\s+(?:•|\||·|-|–|—|on|at|via|for)\s+|[•|·]/)[0].replace(/\b(?:19|20)\d\d\b/g, '').replace(MONTH, '').replace(/[\s,]+$/, '').trim();
function cityAirport(text, exact = false){
  const t = cleanCity(text);
  if (!t) return null;
  const hit = airportByCity(t);
  if (hit || exact) return hit;
  // try the first one to four words ("San Diego for the conference")
  const words = t.split(/\s+/);
  for (let n = Math.min(4, words.length); n >= 1; n--){ const a = airportByCity(words.slice(0, n).join(' ')); if (a) return a; }
  return null;
}
function cityRoute(text){
  const m = String(text || '').match(/(?:^|\bfrom\s+|^\s*(?:flight|trip)?\s*:?\s*)([^\n]*?)\s+to\s+([^\n]+)$/i) || String(text || '').match(/\bto\s+([^\n]+)$/i);
  if (!m) return null;
  const to = cityAirport(m.length > 2 ? m[2] : m[1]);
  const from = m.length > 2 ? cityAirport(m[1].replace(/^.*\bfrom\s+/i, '').replace(/^\s*(?:flight|trip)\s*:?\s*/i, '')) : null;
  return to ? {from, to} : null;
}

const pt = a => a ? {code: a.code, city: a.name, lat: a.lat, lon: a.lon, tz: a.tz} : null;

/**
 * Is this calendar event a flight? Returns {carrier, airline, number, flight ("AA 1234"),
 * from, to (airport codes), fromCity, toCity, lat, lon (where you land), fromLat, fromLon, tz}
 * or null. Liberal: "✈ CLT → SAN • AA 1234", "Flight to San Diego (AA 1234)", "AA1234 CLT to SAN",
 * "UA 92", "Delta 2087 to Atlanta", with the route in the title, the location or the notes.
 */
export function parseFlight(title, location, notes){
  const T = String(title || ''), L = String(location || ''), N = String(notes || '').slice(0, 4000);
  const all = `${T}\n${L}\n${N}`;
  const context = CONTEXT.test(all);
  let num = flightNumber(T, context || /[A-Z]{3}\s*(?:→|->|-|to)\s*[A-Z]{3}/.test(T)) || flightNumber(L, context) || (context ? flightNumber(N.slice(0, 600), true) : null);
  const named = num ? null : namedFlight(T) || (context ? namedFlight(L) || namedFlight(N.slice(0, 600)) : null);
  if (named && (context || !named.yearish)) num = named;
  let codes = routeCodes(T) || routeCodes(L);
  let from = codes ? airport(codes[0]) : null, to = codes ? airport(codes[1]) : null;
  const flighty = /✈|🛫|🛬|\bflight\b|\bflt\b/i.test(T);
  if (!to && (num || flighty || named)){
    const r = cityRoute(T.replace(/\(([A-Z0-9]{2})\s?\d{1,4}\)/g, ' ').replace(/^\s*(?:✈️?|🛫)\s*/, ''));
    if (r){ to = r.to; from = from || r.from; }
  }
  if (!to && (num || flighty)){
    // the notes of an airline email or TripIt segment: "arr SAN", "Arrive: San Diego (SAN)"
    const codesN = routeCodes(N);
    if (codesN){ from = from || airport(codesN[0]); to = airport(codesN[1]); }
    else {
      const a = labelledCode(N, 'arr'); if (a) to = airport(a);
      const d = labelledCode(N, 'dep'); if (d && !from) from = airport(d);
    }
  }
  if (!from && to && (num || flighty)){
    // the notes again, for where you leave from
    const codesN = routeCodes(N);
    if (codesN && codesN[1] === to.code) from = airport(codesN[0]);
    else { const d = labelledCode(N, 'dep'); if (d && d !== to.code) from = airport(d); }
  }
  if (!from && (num || to)){
    // Flighty and airline events often put the departure airport in the location
    const l = [...L.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)].map(m => airport(m[1])).find(a => a && (!to || a.code !== to.code));
    if (l) from = l;
  }
  if (!num && !(codes && (from || to)) && !(flighty && to)) return null;
  if (from && to && from.code === to.code) to = null;
  const f = {carrier: num ? num.carrier : '', airline: num ? AIRLINES[num.carrier] : '', number: num ? num.number : '', flight: num ? `${num.carrier} ${num.number}` : '',
    from: from ? from.code : '', to: to ? to.code : '', fromCity: from ? from.name : '', toCity: to ? to.name : ''};
  if (to){ f.lat = to.lat; f.lon = to.lon; f.tz = to.tz; }
  if (from){ f.fromLat = from.lat; f.fromLon = from.lon; f.fromTz = from.tz; }
  return f;
}

/* ---------- iCalendar ---------- */
const WINDOWS_TZ = {'eastern standard time': 'America/New_York', 'central standard time': 'America/Chicago', 'mountain standard time': 'America/Denver', 'us mountain standard time': 'America/Phoenix', 'pacific standard time': 'America/Los_Angeles', 'alaskan standard time': 'America/Anchorage', 'hawaiian standard time': 'Pacific/Honolulu', 'gmt standard time': 'Europe/London', 'w. europe standard time': 'Europe/Berlin', 'romance standard time': 'Europe/Paris', 'central europe standard time': 'Europe/Budapest', 'tokyo standard time': 'Asia/Tokyo', 'utc': 'UTC'};
const fmtCache = new Map();
function offsetAt(ms, tz){
  let f = fmtCache.get(tz);
  if (f === undefined){
    try { f = new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'}); }
    catch { f = null; }
    fmtCache.set(tz, f);
  }
  if (!f) return null;
  const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUTC - Math.floor(ms / 1000) * 1000;
}
/** Wall-clock time in a time zone → epoch ms. Unknown zones are read as the device's own time. */
function zoned(y, mo, d, h, mi, s, tzRaw){
  const tz = WINDOWS_TZ[String(tzRaw).toLowerCase()] || String(tzRaw).replace(/^\/+/, '').replace(/^.*?((?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Indian)\/[A-Za-z_\/-]+).*$/, '$1');
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const o1 = offsetAt(guess, tz);
  if (o1 == null) return new Date(y, mo - 1, d, h, mi, s).getTime();
  let t = guess - o1;
  const o2 = offsetAt(t, tz);
  if (o2 != null && o2 !== o1) t = guess - o2;
  return t;
}
const pad = n => String(n).padStart(2, '0');
const ymdLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDay = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };

/** One DTSTART/DTEND value → {ms, day ("YYYY-MM-DD", as written for zoned and floating times), allDay}. */
function icsTime(value, params){
  const v = String(value || '').trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const day = `${y}-${mo}-${d}`;
  if (h == null) return {ms: new Date(+y, +mo - 1, +d).getTime(), day, allDay: true};
  if (z) { const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)); return {ms, day: ymdLocal(ms), allDay: false}; }
  if (params.TZID) return {ms: zoned(+y, +mo, +d, +h, +mi, +(s || 0), params.TZID), day, allDay: false, tz: params.TZID};
  return {ms: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)).getTime(), day, allDay: false};
}
function duration(v){
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60e3 + +(m[6] || 0) * 1e3;
  return m[1] === '-' ? -ms : ms;
}
const unescape = s => String(s || '').replace(/\\([nN,;\\])/g, (_, c) => c === 'n' || c === 'N' ? '\n' : c);

/**
 * iCalendar text → [{uid, start, end (epoch ms), startDay, endDay ("YYYY-MM-DD", endDay inclusive),
 * allDay, title, location, notes}], sorted by start. Handles folded lines, all-day dates, TZID
 * and UTC times, DURATION, and escaped commas and semicolons. Cancelled events are left out.
 */
export function parseICS(text){
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let ev = null, depth = 0;
  for (const line of lines){
    if (/^BEGIN:VEVENT\s*$/i.test(line)){ ev = {}; depth = 0; continue; }
    if (!ev) continue;
    if (/^BEGIN:/i.test(line)){ depth++; continue; }       // VALARM and friends
    if (/^END:VEVENT\s*$/i.test(line)){ const e = finish(ev); if (e) out.push(e); ev = null; continue; }
    if (/^END:/i.test(line)){ depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    // NAME;PARAM=a;PARAM="b:c":value
    let i = 0, q = false;
    for (; i < line.length; i++){ const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
    if (i >= line.length) continue;
    const head = line.slice(0, i), value = line.slice(i + 1);
    const [name, ...ps] = head.split(';');
    const params = {};
    for (const p of ps){ const j = p.indexOf('='); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ''); }
    const key = name.toUpperCase();
    if (!(key in ev)) ev[key] = {value, params};
  }
  return out.sort((a, b) => a.start - b.start);
}
function finish(ev){
  if (ev.STATUS && /CANCELLED/i.test(ev.STATUS.value)) return null;
  const s = ev.DTSTART && icsTime(ev.DTSTART.value, ev.DTSTART.params);
  if (!s) return null;
  let e = ev.DTEND && icsTime(ev.DTEND.value, ev.DTEND.params);
  if (!e){
    const d = ev.DURATION ? duration(ev.DURATION.value) : 0;
    if (s.allDay){ const days = Math.max(1, Math.round(d / 864e5) || 1); e = {ms: s.ms + days * 864e5, day: addDay(s.day, days), allDay: true}; }
    else e = {ms: s.ms + d, day: d ? ymdLocal(s.ms + d) : s.day, allDay: false};
  }
  const allDay = s.allDay;
  let endDay = allDay ? addDay(e.day, -1) : e.day;
  if (endDay < s.day) endDay = s.day;
  return {uid: ev.UID ? unescape(ev.UID.value) : `${s.ms}-${unescape(ev.SUMMARY && ev.SUMMARY.value).slice(0, 40)}`,
    start: s.ms, end: Math.max(s.ms, allDay ? e.ms - 1 : e.ms), startDay: s.day, endDay, allDay,
    title: unescape(ev.SUMMARY && ev.SUMMARY.value).trim(), location: unescape(ev.LOCATION && ev.LOCATION.value).trim(), notes: unescape(ev.DESCRIPTION && ev.DESCRIPTION.value).trim(),
    tz: s.tz || ''};
}

/* ---------- trips ---------- */
function miles(a, b){
  const R = 3958.8, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const hasPt = p => p && typeof p.lat === 'number' && typeof p.lon === 'number' && isFinite(p.lat) && isFinite(p.lon);
const normCity = s => String(s || '').split(',')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameCity = (a, b) => hasPt(a) && hasPt(b) ? miles(a, b) < 60 : normCity(a.city) === normCity(b.city);
const slug = s => normCity(s).replace(/ /g, '-') || 'trip';
const HOUR = 36e5, DAY = 864e5;

/** Where a multi-day event (a TripIt trip, a conference) is: "City, ST to City, ST" → the second,
 *  else its location, else its title. Unknown cities come back without lat/lon for the app to look up. */
function spanPlace(e){
  const title = e.title || '', loc = e.location || '';
  const to = title.match(/\bto\s+(.+)$/i);
  const tries = [to && to[1], loc, title];
  for (const [i, t] of tries.entries()){ const a = t && cityAirport(t, i === 2); if (a) return {city: a.name, lat: a.lat, lon: a.lon, tz: a.tz}; }
  const text = cleanCity((to && to[1]) || loc || '');
  // a street address or a hotel name isn't a city; a "City, ST" or "City, Country" usually is
  if (text && /^[^,\d]{2,40},\s*[^,\d]{2,40}$/.test(text) && !/https?:|\bzoom\b|\bteams\b/i.test(text)) return {city: text, lat: null, lon: null};
  return null;
}
const flightOut = (f, e) => ({flight: f.flight, carrier: f.carrier, airline: f.airline, number: f.number, from: f.from, to: f.to, fromCity: f.fromCity, toCity: f.toCity, dep: e.start, arr: e.end, depDay: e.startDay, arrDay: e.endDay, tz: f.tz || '', fromTz: f.fromTz || ''});

/**
 * Calendar or feed events → trips {id, city, lat, lon, start, end ("YYYY-MM-DD"), startMs, endMs,
 * source, flights:[…], land:{at, tz, flight, airport} | null}. Flights place a trip where you land
 * (connections under six hours are skipped), multi-day events like TripIt trips give its dates,
 * and trips to your home city are left out. `home` is {lat, lon} or null; without one, home is
 * where most of your journeys start. Options: {flightsOnly} skips multi-day events, {source}.
 */
export function tripsFromEvents(events, home, opts = {}){
  const source = opts.source || 'feed';
  const evs = (events || []).filter(e => e && typeof e.start === 'number').slice().sort((a, b) => a.start - b.start);
  const flights = [];
  for (const e of evs){
    const f = parseFlight(e.title, e.location, e.notes);
    if (f && (f.to || f.from)) flights.push({e, f});
  }
  // a connection: the next flight leaves the airport you just landed at within six hours
  const connects = (a, b) => b && a.f.to && b.f.from === a.f.to && b.e.start - a.e.end < 6 * HOUR && b.e.start >= a.e.end - HOUR;
  // where journeys start: the inferred home airport(s)
  const starts = new Map();
  flights.forEach((x, i) => { if (!x.f.from || (i > 0 && connects(flights[i - 1], x))) return; starts.set(x.f.from, (starts.get(x.f.from) || 0) + 1); });
  let homeCode = '', best = 0;
  for (const [c, n] of starts) if (n > best){ best = n; homeCode = c; }
  const homeAir = homeCode ? airport(homeCode) : null;
  const H = hasPt(home) ? home : null;
  // people fly from airports up to about 100 miles from home (Greensboro to Charlotte)
  const isHome = (p, reach = 75) => hasPt(p) && ((H && miles(p, H) < reach) || (homeAir && (!H || miles(homeAir, H) < 150) && miles(p, homeAir) < 40));

  const trips = [];
  // trips from flights
  let chain = [];
  flights.forEach((x, i) => {
    chain.push(x);
    const next = flights[i + 1];
    if (connects(x, next)) return;
    const to = x.f.to && airport(x.f.to);
    const legs = chain; chain = [];
    if (!to) return;
    if (isHome(to, 100)){
      // flying home: the flight belongs to the trip you're leaving
      const fromA = legs[0].f.from && airport(legs[0].f.from);
      const t = fromA && [...trips].reverse().find(t => sameCity(t, fromA) && t.startMs <= legs[0].e.start + HOUR);
      if (t){ for (const l of legs) t.flights.push(flightOut(l.f, l.e)); t.endMs = Math.max(t.endMs, legs[0].e.start); t.end = t.end > legs[0].e.startDay ? t.end : legs[0].e.startDay; }
      return;
    }
    const t = {city: to.name, lat: to.lat, lon: to.lon, startMs: x.e.end, endMs: x.e.end, start: x.e.endDay, end: x.e.endDay, flights: legs.map(l => flightOut(l.f, l.e)),
      land: {at: x.e.end, tz: to.tz, flight: x.f.flight, airport: to.code}};
    // you stay until the next flight out of here (within a month)
    const out = flights.slice(i + 1).find(y => y.e.start >= x.e.end && y.e.start - x.e.end < 31 * DAY);
    if (out && out.f.from){ const fa = airport(out.f.from); if (fa && miles(fa, to) < 60){ t.endMs = out.e.start; t.end = out.e.startDay; } }
    trips.push(t);
  });
  // trips from multi-day events (TripIt's trip entries, a conference with a city)
  const spans = [];
  if (!opts.flightsOnly){
    const flightIds = new Set(flights.map(x => x.e));
    for (const e of evs){
      if (flightIds.has(e)) continue;
      if (!(e.allDay || e.end - e.start >= 20 * HOUR)) continue;
      const p = spanPlace(e);
      if (!p || isHome(p) || (H && H.name && !hasPt(p) && normCity(H.name) === normCity(p.city))) continue;
      spans.push({city: p.city, lat: p.lat, lon: p.lon, startMs: e.start, endMs: e.end, start: e.startDay, end: e.endDay, flights: [], land: null, uid: e.uid});
    }
  }
  // a flight trip inside a span becomes part of it
  const merged = spans;
  for (const t of trips){
    const s = merged.find(s => sameCity(s, t) && t.startMs <= s.endMs + DAY && t.endMs >= s.startMs - DAY);
    if (s){
      s.flights.push(...t.flights);
      if (!hasPt(s)){ s.lat = t.lat; s.lon = t.lon; s.city = t.city; }
      if (!s.land && t.land) s.land = t.land;
      if (t.startMs < s.startMs){ s.startMs = t.startMs; s.start = t.start; }
      if (t.endMs > s.endMs){ s.endMs = t.endMs; s.end = t.end; }
    } else merged.push(t);
  }
  merged.sort((a, b) => a.startMs - b.startMs);
  // back-to-back pieces of the same trip (36 hours or less apart) become one
  const done = [];
  for (const t of merged){
    const last = done[done.length - 1];
    if (last && sameCity(last, t) && t.startMs - last.endMs < 36 * HOUR){
      last.flights.push(...t.flights);
      if (!last.land && t.land) last.land = t.land;
      if (t.endMs > last.endMs){ last.endMs = t.endMs; last.end = t.end; }
      continue;
    }
    done.push(t);
  }
  return done.map(t => {
    const seen = new Set();
    const fl = t.flights.filter(f => { const k = `${f.flight}|${f.from}|${f.to}|${f.dep}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.dep - b.dep);
    return {id: `${source}-${slug(t.city)}-${t.start}`, city: t.city, lat: hasPt(t) ? t.lat : null, lon: hasPt(t) ? t.lon : null,
      start: t.start, end: t.end < t.start ? t.start : t.end, startMs: t.startMs, endMs: Math.max(t.startMs, t.endMs), source, flights: fl, land: t.land || null};
  });
}

/** A TripIt (or any iCalendar) feed's text → trips, as in tripsFromEvents. */
export function tripsFromFeed(icsText, home){
  return tripsFromEvents(parseICS(icsText), home, {source: 'feed'});
}

/**
 * Whether a fetched travel feed is safe to save over the last good copy. status: the HTTP
 * status (0 when unknown); text: the body. {ok: true}, or {ok: false, code, error} where code is
 * 'gone' (the link was revoked: 401, 403, 404, 410), 'down' (offline or a server error),
 * 'notcal' (not a calendar) or 'partial' (cut off mid-download).
 */
export function feedCheck(text, status, name){
  const who = name || 'your travel feed', st = +status || 0, t = typeof text === 'string' ? text : '';
  if ([401, 403, 404, 410].includes(st)) return {ok: false, code: 'gone', error: `${who} says this feed link no longer works. Copy the link again from ${who === 'TripIt' ? 'TripIt (Settings, Calendar feed)' : 'the app that made it'}.`};
  if (st >= 400 || (!st && !t)) return {ok: false, code: 'down', error: `Couldn’t reach ${who} at the last check. Northfix will try again later.`};
  if (!/BEGIN:VCALENDAR/i.test(t)) return {ok: false, code: 'notcal', error: `That link didn’t return a calendar. Copy the feed link from ${who} again.`};
  if (!/END:VCALENDAR\s*$/i.test(t)) return {ok: false, code: 'partial', error: `${who} sent back part of the feed. Northfix kept the last full copy and will try again later.`};
  return {ok: true};
}
