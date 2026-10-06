// App-wide state. Owns the engine and the saved files, and turns user actions into
// engine calls plus saves. The same engine (src/engine.js) runs the iPhone app.
import api from '../engine.js';
import JSZip from 'jszip';
import { Store, prefs, savePrefs, ls, fx, askNotify, scheduleFollowUps, scheduleMonday, clearExportReminder, readStarterContacts, readContactCards, contactsAllowed, shareFile } from './platform.js';
import { loadGeo, lookup, city, placesFromContacts } from '../geo.js';
import { birthdaysFromContacts } from './eventkit.js';
import { hash } from '../core.js';

const B = () => globalThis.Bearings;
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
let emitT = 0;
export const emit = (what = 'all') => { cancelAnimationFrame(emitT); emitT = requestAnimationFrame(() => listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } })); };

export const blankFilters = () => ({rel: [], seg: [], branch: [], status: [], tier: [], sen: [], func: [], ind: [], cert: [], sig: [], agency: '', company: '', since: '', removed: false});
export const filterCount = f => ['rel', 'seg', 'branch', 'status', 'tier', 'sen', 'func', 'ind', 'cert', 'sig'].reduce((a, k) => a + f[k].length, 0) + (f.agency ? 1 : 0) + (f.company ? 1 : 0) + (f.since ? 1 : 0) + (f.removed ? 1 : 0);

export const M = {
  api,
  info: {mode: 'sample', count: 0, deckCount: 0, hasRel: false, lens: false, lastImport: '', rev: '', edits: 0},
  people: [], byKey: new Map(), home: {stats: [], cards: []}, constants: null, targets: [],
  q: {text: '', filters: blankFilters(), sort: 'new'}, results: [], chips: [],
  lists: ls.json('bearings.lists', []),
  places: {}, found: {}, placesBuilt: '', locating: false,
  events: [], trips: ls.json('bearings.trips', []), births: {},
  error: '', loaded: false, version: 0,
};
export const isSample = () => M.info.mode === 'sample';
export const isStarter = () => M.info.mode === 'starter';
export const person = k => M.byKey.get(k);
export const persons = keys => keys.map(k => M.byKey.get(k)).filter(Boolean);
export const firstName = () => (prefs.name || '').trim().split(/\s+/)[0] || '';
export const myInitials = () => (prefs.name || '').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase();
export const lastBackup = () => ls.get('bearings.lastBackup') || '';

let toastFn = () => {};
export const setToast = fn => { toastFn = fn; };
export const show = msg => toastFn(msg);

/* ---------- people records ---------- */
// The engine leaves out empty values; fill them in so screens never check for undefined.
const CL0 = {seg: '', branch: '', status: '', rank: '', grade: '', tier: '', gn: 0, sen: '', func: '', agency: '', certs: [], clr: false, lv: 4, ind: '', indHow: ''};
export function norm(p){
  if (!p) return p;
  p.f = p.f || ''; p.l = p.l || ''; p.c = p.c || ''; p.p = p.p || ''; p.d = p.d || ''; p.e = p.e || ''; p.u = p.u || '';
  p.name = p.name || `${p.f} ${p.l}`.trim();
  p.cl = Object.assign({}, CL0, p.cl || {});
  p.band = p.band || 'none'; p.score = p.score || 0; p.touch = p.touch || ''; p.next = p.next || '';
  p.color = p.color || '#8F89A8'; p.indColor = p.indColor || '#8F89A8'; p.indShort = p.indShort || '';
  for (const f of ['isNew', 'moved', 'waiting', 'cooling', 'due', 'anniv', 'over']) p[f] = !!p[f];
  p.starred = !!(p.ed && p.ed.star);
  p.full = `${p.f} ${p.l}`.trim();
  p.initials = ((p.f[0] || '?') + (p.l[0] || '')).toUpperCase();
  return p;
}

/* ---------- loading ---------- */
export async function reload(){
  const texts = {};
  for (const [key, file] of [['network', 'network.json'], ['edits', 'edits.json'], ['review', 'review.json'], ['targets', 'targets.json'], ['industries', 'industries.json']]){
    const t = await Store.read(file); if (t) texts[key] = t;
  }
  try { M.info = api.loadFiles(texts, prefs.lens); M.error = ''; }
  catch (e) { M.error = `Your saved network didn’t load (${(e && e.message) || e}). Close and reopen the app to try again.`; try { M.info = api.loadSample(); } catch {} }
  try { const pf = JSON.parse((await Store.read('places.json')) || 'null'); M.found = (pf && pf.people) || {}; M.placesBuilt = (pf && pf.built) || ''; M.births = (pf && pf.births) || {}; } catch { M.found = {}; M.births = {}; }
  try { const ev = JSON.parse((await Store.read('events.json')) || '[]'); M.events = Array.isArray(ev) ? ev.filter(e => e && e.id && e.start) : []; } catch { M.events = []; }
  if (!M.constants) M.constants = api.constants();
  refreshAll();
  M.loaded = true;
}
export function loadSample(){ M.info = api.loadSample(); refreshAll(); }

export function refreshAll(){
  M.people = api.people().map(norm);
  M.byKey = new Map(M.people.map(p => [p.k, p]));
  refreshSummary();
  runSearch();
  mergePlaces();
  M.version++;
  reschedule();
  emit('all');
}
function refreshSummary(){
  M.info = api.info();
  try { M.home = api.home({lastBackup: lastBackup()}); } catch (e) { console.error(e); }
  M.targets = api.targets();
}
export function refreshPerson(k){
  const p = api.person(k);
  if (p){ delete p.links; norm(p); M.byKey.set(k, p); const i = M.people.findIndex(x => x.k === k); if (i >= 0) M.people[i] = p; }
  refreshSummary();
  runSearch();
  mergePlaces();
  M.version++;
  reschedule();
  emit('person');
}
/** The full record (message snippet, full notes) and links for a profile. */
export function full(k){ const p = api.person(k); return p ? norm(p) : null; }

let remT = 0;
function reschedule(){ clearTimeout(remT); remT = setTimeout(() => { try { scheduleFollowUps(api.reminders(), M.info.lastImport, M.info.mode === 'live'); } catch {} }, 900); }

/* ---------- search ---------- */
export function runSearch(){
  try {
    const r = api.search({text: M.q.text, filters: M.q.filters, sort: M.q.sort});
    M.results = r.keys; M.chips = r.chips;
  } catch (e) { M.results = []; M.chips = []; }
}
export function setQuery(patch){ Object.assign(M.q, patch); runSearch(); emit('search'); }
export function facets(){ return api.facets({text: M.q.text, filters: M.q.filters}); }

/* ---------- saving ---------- */
async function saveFile(engineName, file){
  if (isSample()) return;
  try { await Store.write(file, B().fileJSON(engineName)); }
  catch (e) { show('Couldn’t save: ' + ((e && e.message) || e)); }
}
const saveAll = async () => { for (const [n, f] of [['edits', 'edits.json'], ['review', 'review.json'], ['targets', 'targets.json'], ['industries', 'industries.json']]) await saveFile(n, f); };

async function edit(k, fn){
  try { fn(); await saveFile('edits', 'edits.json'); refreshPerson(k); }
  catch (e) { show((e && e.message) || String(e)); }
}
export async function toggleStar(k){
  const on = !(person(k) && person(k).starred);
  on ? fx.star() : fx.tap();
  await edit(k, () => api.setEdit(k, {star: on}));
}
const niceDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}); };
const plusDays = n => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
export async function followUp(k, days){
  await edit(k, () => api.followUp(k, days));
  if (days > 0){ fx.star(); show(`We’ll remind you on ${niceDay(plusDays(days))}`); askNotify(); }
  else { fx.tap(); show('Follow-up cleared'); }
}
export async function markReplied(k){ fx.success(); await edit(k, () => api.markReplied(k)); show('Marked as replied'); }
export const CIRCLES = {inner: {title: 'Inner circle', cadence: 'Every month', icon: 'circleInner'}, key: {title: 'Key relationships', cadence: 'Every quarter', icon: 'circleKey'}, wide: {title: 'Wider network', cadence: 'Once a year', icon: 'circleWide'}};
export async function setCircle(k, c){
  fx.tap();
  await edit(k, () => api.setCircle(k, c || ''));
  if (c) show(`${CIRCLES[c].title}: ${CIRCLES[c].cadence.toLowerCase()}`);
}
export async function touched(k){
  fx.success();
  await edit(k, () => api.touch(k));
  const p = person(k);
  show(p && p.next ? `Logged. Next check-in ${niceDay(p.next)}` : 'Logged');
}
export async function addNote(k, text, source = ''){ await edit(k, () => api.addNote(k, text, source)); }
/** You met someone at an event: a note on their timeline and a logged touch. */
export async function metAt(k, text, source){ await edit(k, () => { api.addNote(k, text, source); api.touch(k); }); }

/* ---------- events and trips ---------- */
// Events live in events.json next to the other files (the iPhone app uses the same name);
// trips you add yourself are a small list in local storage, like the iPhone's settings.
export async function saveEvents(){
  try { await Store.write('events.json', JSON.stringify(M.events)); }
  catch (e) { show('Couldn’t save: ' + ((e && e.message) || e)); }
  emit('events');
}
export function saveTrips(){ ls.set('bearings.trips', JSON.stringify(M.trips)); emit('trips'); }
export async function setLocation(k, query){
  const q = (query || '').trim();
  if (!q){ await edit(k, () => api.setEdit(k, {loc: '', lat: null, lon: null})); show('Location cleared'); return true; }
  await loadGeo();
  const hit = lookup(q);
  if (!hit){ show(`Couldn’t find “${q}”. Try a city and state, like Tampa, FL.`); return false; }
  await edit(k, () => api.setEdit(k, {loc: hit.name, lat: hit.lat, lon: hit.lon}));
  fx.success(); show(`Location set to ${hit.name}`);
  return true;
}
export async function saveProfile(k, patch, companyIndustry){
  try {
    const p = Object.assign({}, patch);
    if (companyIndustry){ api.setCompanyIndustry(companyIndustry.company, companyIndustry.ind); await saveFile('industries', 'industries.json'); p.ind = ''; }
    api.setEdit(k, p);
    await saveFile('edits', 'edits.json');
    companyIndustry ? refreshAll() : refreshPerson(k);
    fx.success();
    show(isSample() ? 'Sample data: changes aren’t saved' : 'Saved');
  } catch (e) { show('Couldn’t save: ' + ((e && e.message) || e)); }
}

/* ---------- companies ---------- */
export const isTarget = name => M.targets.some(t => t.name === name);
export async function toggleTarget(name){
  const r = api.toggleTarget(name);
  r.on ? fx.star() : fx.tap();
  show(r.on ? `Added ${name} to your watchlist` : `Removed ${name} from your watchlist`);
  await saveFile('targets', 'targets.json');
  refreshSummary(); M.version++; emit('targets');
}
export async function setTargetNote(name, note){ api.setTargetNote(name, note); await saveFile('targets', 'targets.json'); }
export async function setCompanyIndustry(company, ind){
  try { api.setCompanyIndustry(company, ind); await saveFile('industries', 'industries.json'); refreshAll(); }
  catch (e) { show((e && e.message) || String(e)); }
}
export async function setCompanyLink(company, url){
  try { api.setCompanyLink(company, url); await saveFile('industries', 'industries.json'); fx.success(); show(url ? 'Saved. That link opens the exact page now.' : 'Removed the saved page'); M.version++; emit('unit'); return true; }
  catch (e) { show((e && e.message) || String(e)); return false; }
}
export async function setCompanyLocation(company, query){
  const q = (query || '').trim();
  let loc = null;
  if (q){ await loadGeo(); const hit = lookup(q); if (!hit){ show(`Couldn’t find “${q}”. Try a city and state or country.`); return false; } loc = {name: hit.name, lat: hit.lat, lon: hit.lon}; }
  try {
    api.setCompanyLocation(company, loc);
    await saveFile('industries', 'industries.json');
    mergePlaces(); fx.success(); M.version++; emit('unit');
    show(q ? `Placed everyone at ${company}` : `Location cleared for ${company}`);
    return true;
  } catch (e) { show((e && e.message) || String(e)); return false; }
}

/* ---------- places ---------- */
const SAMPLE_SPOTS = [['Washington, DC', 38.8951, -77.0364], ['Arlington, VA', 38.8816, -77.091], ['Norfolk, VA', 36.8468, -76.2852], ['Raleigh, NC', 35.7721, -78.6386], ['Greensboro, NC', 36.0726, -79.792], ['Jacksonville, NC', 34.7541, -77.4302], ['Fayetteville, NC', 35.0527, -78.8784], ['Tampa, FL', 27.9475, -82.4584], ['San Diego, CA', 32.7157, -117.1647], ['Colorado Springs, CO', 38.8339, -104.8214], ['Huntsville, AL', 34.7304, -86.5861], ['San Antonio, TX', 29.4241, -98.4936], ['Charleston, SC', 32.7765, -79.9311], ['Chattanooga, TN', 35.0456, -85.3097], ['Atlanta, GA', 33.749, -84.388], ['Honolulu, HI', 21.3069, -157.8583], ['London, United Kingdom', 51.5085, -0.1257], ['Stuttgart, Germany', 48.7823, 9.177]];
/** Your own settings win: the person first, then their company or office. Then Contacts. */
export function mergePlaces(){
  const out = {};
  if (isSample()){ for (const p of M.people){ if (p.x) continue; const h = hash(p.k); if (h % 10 < 7){ const s = SAMPLE_SPOTS[Math.floor(h / 10) % SAMPLE_SPOTS.length]; out[p.k] = {name: s[0], lat: s[1], lon: s[2], prec: 'city', src: 'sample'}; } } }
  else Object.assign(out, M.found);
  try { for (const [k, l] of Object.entries(api.companyPlaces())) out[k] = {name: l.name, lat: l.lat, lon: l.lon, prec: 'city', src: 'company'}; } catch {}
  for (const p of M.people){ const e = p.ed; if (e && e.loc && e.lat != null && e.lon != null) out[p.k] = {name: e.loc, lat: +e.lat, lon: +e.lon, prec: 'city', src: 'you'}; }
  M.places = out;
}
/** Works out where people are from the phone's contacts (address, then phone area code). */
export async function locate(){
  if (M.locating) return;
  if (isSample()){ show('Import your own network first.'); return; }
  M.locating = true; emit('places');
  try {
    const [cards] = await Promise.all([readContactCards(), loadGeo()]);
    const rows = M.people.map(p => ({k: p.k, f: p.f, l: p.l, c: p.c, e: p.e, x: p.x}));
    const {places, matched} = placesFromContacts(rows, cards);
    // last resort, as on the iPhone: a city in someone's title or company, like "Greensboro, NC"
    try { for (const [k, name, st] of api.placeClues()){ if (places[k]) continue; const c = city(name, st, 'US'); if (c) places[k] = {name: `${name}, ${st}`, lat: c.lat, lon: c.lon, prec: 'city', src: 'title'}; } } catch {}
    const births = birthdaysFromContacts(rows, cards);
    M.found = places; M.births = births; M.placesBuilt = new Date().toISOString().slice(0, 10);
    await Store.write('places.json', JSON.stringify({v: 1, built: M.placesBuilt, matched, people: places, births})).catch(() => {});
    mergePlaces(); fx.success();
    show(`Found a location for ${Object.keys(M.places).length.toLocaleString()} people`);
  } catch (e) { show((e && e.message) || 'Couldn’t read contacts'); }
  M.locating = false; M.version++; emit('places');
}

/* ---------- catch up ---------- */
export async function reviewed(k, mode, star){
  if (star && !(person(k) && person(k).starred)){ fx.star(); api.setEdit(k, {star: true}); await saveFile('edits', 'edits.json'); }
  else fx.tap();
  api.reviewed(k, mode);
  await saveFile('review', 'review.json');
  refreshPerson(k);
}

/* ---------- lens ---------- */
export function setLens(on){
  prefs.lens = on; savePrefs();
  M.info = api.setLens(on);
  if (!(on == null ? M.info.lensAuto : on)){ const f = M.q.filters; f.seg = []; f.branch = []; f.status = []; f.tier = []; f.agency = ''; if (M.q.sort === 'rank') M.q.sort = 'new'; }
  refreshAll();
}

/* ---------- saved searches ---------- */
const writeLists = () => ls.set('bearings.lists', JSON.stringify(M.lists));
export function saveSearch(name){
  M.lists.push({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, text: M.q.text, filters: JSON.parse(JSON.stringify(M.q.filters)), sort: M.q.sort});
  writeLists(); fx.success(); show(`Pinned “${name}” to Today`); emit('lists');
}
export function deleteSearch(id){ M.lists = M.lists.filter(s => s.id !== id); writeLists(); emit('lists'); }
export function runList(s){ try { return api.search({text: s.text, filters: Object.assign(blankFilters(), s.filters), sort: s.sort}).keys; } catch { return []; } }

/* ---------- messages ---------- */
export function messages(k, ctx = {}){
  const me = (prefs.name || '').trim();
  try { return api.messages(k, Object.assign({}, ctx, me ? {me} : {})); } catch { return []; }
}

/* ---------- Monday brief ---------- */
export function weekStart(){
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const weekKey = () => `weekly-${M.info.mode}-${weekStart()}`;
export function weeklyPicks(){
  const saved = ls.json(weekKey(), null);
  if (saved && saved.length) return saved.filter(p => person(p.k));
  let picks = []; try { picks = api.weekly([]); } catch {}
  if (picks.length) ls.set(weekKey(), JSON.stringify(picks));
  return picks;
}
export function replacePick(k, list){
  const sk = 'weekly-skipped-' + weekStart();
  const skip = [...new Set(list.map(p => p.k).concat(ls.json(sk, [])))];
  ls.set(sk, JSON.stringify(skip));
  let more = []; try { more = api.weekly(skip); } catch {}
  const out = list.filter(p => p.k !== k);
  if (more[0]) out.push(more[0]);
  ls.set(weekKey(), JSON.stringify(out));
  return out;
}
/** Done this week: messaged them or logged a touch since Monday. */
export function weeklyDone(k){
  const p = person(k); if (!p) return false;
  const since = weekStart();
  // only your own message or a logged touch counts; their message to you doesn't
  return ((p.ed && p.ed.touched) || '') >= since || (!!(p.rx && p.rx.t) && p.rx.t >= since && p.rx.dir === 'o');
}

/* ---------- import ---------- */
const FILES = {messages: /(^|\/)messages\.csv$/i, invitations: /(^|\/)invitations\.csv$/i, endGiven: /(^|\/)endorsement_given_info\.csv$/i, endRecv: /(^|\/)endorsement_received_info\.csv$/i, recGiven: /(^|\/)recommendations_given\.csv$/i, recRecv: /(^|\/)recommendations_received\.csv$/i};
/** Reads a LinkedIn zip (or a bare Connections.csv) and returns the engine's import plan. */
export async function readImport(file){
  const buf = new Uint8Array(await file.arrayBuffer());
  const texts = {};
  if (buf[0] === 0x50 && buf[1] === 0x4B){
    const zip = await JSZip.loadAsync(buf);
    const files = Object.values(zip.files);
    const find = rx => files.find(f => !f.dir && rx.test(f.name));
    const conn = find(/(^|\/)connections\.csv$/i);
    if (!conn) throw new Error('No Connections.csv inside that zip. Request the export with “Connections” selected.');
    texts.connections = await conn.async('string');
    for (const [k, rx] of Object.entries(FILES)){ const f = find(rx); if (f) texts[k] = await f.async('string'); }
  } else texts.connections = new TextDecoder().decode(buf);
  return api.importTexts(texts, 'android');
}
export async function commitImport(plan){
  await Store.write('network.json', B().fileJSON('network'));
  if (plan.wasSample){ api.clearNotes(); await saveAll(); M.found = {}; M.births = {}; await Store.write('places.json', JSON.stringify({v: 1, built: '', people: {}})).catch(() => {}); }
  if (plan.wasStarter){ await saveFile('edits', 'edits.json'); await saveFile('review', 'review.json'); clearExportReminder(); }
  ls.set('bearings.onboarded', '1');
  await reload();
  if (await contactsAllowed()) locate();
  fx.success();
}
/** Maps the people in the phone's contacts right away, while the LinkedIn export is on its way. */
export async function startFromContacts(){
  const list = await readStarterContacts();
  if (!list.length) throw new Error('There’s no one in your contacts to map yet.');
  const r = api.startFromContacts(list);
  await Store.write('network.json', B().fileJSON('network'));
  if (r.wasSample){ api.clearNotes(); await saveAll(); }
  ls.set('bearings.onboarded', '1');
  await reload();
  locate();
  fx.success();
  return r;
}

/* ---------- backup, restore, export ---------- */
const today = () => new Date().toISOString().slice(0, 10);
export async function backup(){
  try {
    await shareFile(`bearings-notes-${today()}.json`, api.backup(), {title: 'Save your backup'});
    ls.set('bearings.lastBackup', today());
    refreshSummary(); emit('home');
  } catch (e) { if (!/cancel/i.test((e && e.message) || '')) show('Backup failed: ' + ((e && e.message) || e)); }
}
export async function restore(file){
  try {
    const r = api.restore(await file.text());
    await saveAll(); refreshAll(); fx.success();
    show(`Restored ${r.added.toLocaleString()} ${r.added === 1 ? 'person’s notes' : 'people’s notes'}${r.kept > 0 ? `, kept ${r.kept.toLocaleString()} newer` : ''}`);
  } catch (e) { show('Couldn’t restore: ' + ((e && e.message) || e)); }
}
export async function exportCSV(keys){
  try { await shareFile(`bearings-${today()}.csv`, api.exportCSV(keys || null), {type: 'text/csv', title: 'Export connections'}); }
  catch (e) { if (!/cancel/i.test((e && e.message) || '')) show('Export failed: ' + ((e && e.message) || e)); }
}
export { scheduleMonday };
