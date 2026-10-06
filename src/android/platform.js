// Everything that touches the device: saved files, preferences, haptics, sharing,
// notifications, contacts and links. Every plugin call is guarded so the same
// build runs in a plain browser (where it falls back to localStorage and no-ops).
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Contacts } from '@capacitor-community/contacts';

export const NATIVE = Capacitor.isNativePlatform();
export const PLATFORM = Capacitor.getPlatform();

const ls = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k){ try { localStorage.removeItem(k); } catch {} },
  json(k, fallback){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
};
export { ls };

/* ---------- preferences ---------- */
// Same key and shape the earlier Android app used ("oob.prefs"), so settings carry over.
const DEFAULT_PREFS = {haptics: true, sound: true, theme: 'system', name: '', lens: null, notify: true, salesnav: false, mondayBrief: true, useCase: ''};
export const prefs = Object.assign({}, DEFAULT_PREFS, ls.json('oob.prefs', {}));
export const savePrefs = () => ls.set('oob.prefs', JSON.stringify(prefs));

/* ---------- saved files ---------- */
// The phone app keeps the same JSON files as the iPhone app (network.json, edits.json,
// review.json, targets.json, industries.json, places.json) in the app's private data folder.
export const Store = {
  async read(name){
    if (NATIVE){
      try { const r = await Filesystem.readFile({path: name, directory: Directory.Data, encoding: Encoding.UTF8}); return typeof r.data === 'string' ? r.data : null; }
      catch { return null; }
    }
    return ls.get('oob.' + name);
  },
  async write(name, text){
    if (NATIVE) return Filesystem.writeFile({path: name, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true});
    if (!ls.set('oob.' + name, text)) throw new Error('This browser blocked local storage, so changes can’t be saved here.');
  },
};

/* ---------- one-time move from the earlier Android app ---------- */
// The earlier app already saved its data in the engine's file format, in the same
// folder, under the same names. What changes is where a few settings live, so this
// copies those once and checks the saved files still read.
export async function migrate(){
  if (ls.get('bearings.v2')) return {ran: false};
  const report = {ran: true, files: {}};
  for (const f of ['network.json', 'edits.json', 'review.json', 'targets.json', 'industries.json', 'places.json']){
    const t = await Store.read(f);
    if (t == null){ report.files[f] = 'none'; continue; }
    try { JSON.parse(t); report.files[f] = 'ok'; }
    catch { report.files[f] = 'unreadable'; }
  }
  // edits written by the old app sometimes kept a bare {edits} without rev; the engine reads both
  // old settings: theme and name live in the same prefs object; backup date and onboarding flag move here
  const backup = ls.get('oob.backup'); if (backup && !ls.get('bearings.lastBackup')) ls.set('bearings.lastBackup', backup);
  if (ls.get('oob.onboarded') && !ls.get('bearings.onboarded')) ls.set('bearings.onboarded', '1');
  // an old network means this person already went through the old welcome
  if (report.files['network.json'] === 'ok') ls.set('bearings.onboarded', '1');
  const tab = ls.get('oob.tab'); if (tab && ['home', 'people', 'companies', 'explore', 'catchup'].includes(tab)) ls.set('bearings.tab', tab);
  ls.set('bearings.v2', new Date().toISOString());
  return report;
}

/* ---------- haptics ---------- */
const haptic = fn => { if (!prefs.haptics) return; if (NATIVE) fn().catch(() => {}); };
export const fx = {
  tap: () => haptic(() => Haptics.impact({style: ImpactStyle.Light})),
  star: () => haptic(() => Haptics.impact({style: ImpactStyle.Medium})),
  success: () => haptic(() => Haptics.notification({type: NotificationType.Success})),
  select: () => haptic(() => Haptics.selectionChanged ? Haptics.selectionChanged() : Haptics.impact({style: ImpactStyle.Light})),
};

/* ---------- links, clipboard, sharing ---------- */
export function openURL(url){
  if (!url) return;
  if (NATIVE){
    // LinkedIn links hand off to the LinkedIn app when it's installed
    if (/^(mailto:|https:\/\/(www\.)?linkedin\.com\/in\/)/.test(url)){ window.open(url, '_system'); return; }
    Browser.open({url}).catch(() => window.open(url, '_system'));
  } else window.open(url, '_blank', 'noopener');
}
export async function copy(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}
export async function shareText(text, title = 'Bearings'){
  if (NATIVE){ try { await Share.share({title, text, dialogTitle: title}); return true; } catch { return false; } }
  if (navigator.share){ try { await navigator.share({title, text}); return true; } catch { return false; } }
  await copy(text); return 'copied';
}
/** Writes a file to the cache folder and opens the share sheet; in a browser it downloads. */
export async function shareFile(name, data, {type = 'application/json', base64 = false, title = 'Bearings'} = {}){
  if (NATIVE){
    const w = await Filesystem.writeFile({path: name, data, directory: Directory.Cache, ...(base64 ? {} : {encoding: Encoding.UTF8})});
    await Share.share({title, files: [w.uri], dialogTitle: title});
    return true;
  }
  const blob = base64 ? new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], {type}) : new Blob([data], {type});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

/* ---------- incoming files ("Open with" / "Share to Bearings") ---------- */
export async function readIncoming(url){
  const r = await Filesystem.readFile({path: url});
  const b64 = typeof r.data === 'string' ? r.data : '';
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  let name = decodeURIComponent((url.split('/').pop() || 'file').split('?')[0]);
  const zip = out[0] === 0x50 && out[1] === 0x4B;
  if (!/\.(zip|csv)$/i.test(name)) name = zip ? 'LinkedIn data.zip' : 'Connections.csv';
  return new File([out], name, {type: zip ? 'application/zip' : 'text/csv'});
}

/* ---------- app lifecycle ---------- */
export function onAppEvents({resume, url, back}){
  if (!NATIVE) return;
  App.addListener('resume', () => resume && resume()).catch(() => {});
  App.addListener('appUrlOpen', e => url && url(e.url)).catch(() => {});
  App.addListener('backButton', e => { if (back && back()) return; if (!e.canGoBack) App.minimizeApp().catch(() => {}); }).catch(() => {});
  App.getLaunchUrl().then(l => { if (l && l.url && url) url(l.url); }).catch(() => {});
}
export function statusBar(dark){
  if (!NATIVE) return;
  StatusBar.setStyle({style: dark ? Style.Dark : Style.Light}).catch(() => {});
}

/* ---------- notifications ---------- */
// ids: 1 refresh nudge, 2 Monday brief, 3 and 4 the LinkedIn export reminders, 10+ follow-ups,
// and 2.1 billion and up for the morning-after nudge for each event
const N_EVENT0 = 2100000000;
const N_REFRESH = 1, N_MONDAY = 2, N_EXPORT1 = 3, N_EXPORT2 = 4;
export async function askNotify(){
  if (!NATIVE || !prefs.notify) return false;
  try { let p = await LocalNotifications.checkPermissions(); if (p.display !== 'granted') p = await LocalNotifications.requestPermissions(); return p.display === 'granted'; }
  catch { return false; }
}
async function granted(){ if (!NATIVE) return false; try { return (await LocalNotifications.checkPermissions()).display === 'granted'; } catch { return false; } }
async function cancelIds(ids){ if (ids.length) await LocalNotifications.cancel({notifications: ids.map(id => ({id}))}).catch(() => {}); }

export async function scheduleFollowUps(reminders, lastImport, live){
  if (!NATIVE) return;
  try {
    const pend = await LocalNotifications.getPending();
    await cancelIds(pend.notifications.map(n => n.id).filter(id => (id >= 10 && id < N_EVENT0) || id === N_REFRESH));
    if (!prefs.notify || !live || !(await granted())) return;
    const at9 = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 9, 0, 0); };
    const now = Date.now(), list = [];
    for (const r of reminders){
      const at = at9(r.due); if (at.getTime() <= now) continue;
      list.push({id: (hashId(r.k) % 2000000000) + 10, title: r.title, body: r.body, schedule: {at, allowWhileIdle: true}, extra: {k: r.k}, actionTypeId: 'FOLLOW'});
    }
    list.sort((a, b) => a.schedule.at - b.schedule.at);
    if (lastImport){
      const [y, m, d] = lastImport.split('-').map(Number);
      let at = new Date(y, m - 1, d + 7, 10, 0, 0); if (at.getTime() <= now) at = new Date(now + 864e5);
      list.unshift({id: N_REFRESH, title: 'Time to refresh your network', body: 'Grab a fresh LinkedIn export to catch job changes and new connections.', schedule: {at}, extra: {refresh: true}});
    }
    if (list.length) await LocalNotifications.schedule({notifications: list.slice(0, 60)});
  } catch {}
}
function hashId(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Every Monday at 7:30, while the brief is on. */
export async function scheduleMonday(){
  if (!NATIVE) return;
  try {
    await cancelIds([N_MONDAY]);
    if (!prefs.mondayBrief || !prefs.notify) return;
    if (!(await askNotify())) return;
    await LocalNotifications.schedule({notifications: [{id: N_MONDAY, title: 'Your week in Bearings', body: 'Five people worth reaching out to, with a reason and a draft for each. About ten minutes.',
      schedule: {on: {weekday: 2, hour: 7, minute: 30}, allowWhileIdle: true}, extra: {weekly: true}}]});
  } catch {}
}

/** After asking LinkedIn for your data: a nudge in 20 minutes and another the next morning. */
export async function exportRequested(){
  ls.set('bearings.exportRequested', String(Date.now()));
  if (!NATIVE) return;
  try {
    if (!(await askNotify())) return;
    await cancelIds([N_EXPORT1, N_EXPORT2]);
    const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 30, 0, 0);
    await LocalNotifications.schedule({notifications: [
      {id: N_EXPORT1, title: 'Your LinkedIn data may be ready', body: 'Look for an email from LinkedIn, download the file, then open it with Bearings. The quick version usually arrives in about 10 minutes.', schedule: {at: new Date(Date.now() + 20 * 60000), allowWhileIdle: true}, extra: {refresh: true}},
      {id: N_EXPORT2, title: 'Your full LinkedIn archive should be in', body: 'The full archive, with messages, takes up to a day. Open the email from LinkedIn and open the zip with Bearings to see who you talk to.', schedule: {at: next, allowWhileIdle: true}, extra: {refresh: true}},
    ]});
  } catch {}
}
export function exportRequestedAt(){ const t = +ls.get('bearings.exportRequested'); return t > 0 ? new Date(t) : null; }
export function clearExportReminder(){ ls.del('bearings.exportRequested'); if (NATIVE) cancelIds([N_EXPORT1, N_EXPORT2]); }

/** The morning after an event at 9: who still needs a follow-up. */
export async function scheduleEventNudge(e){
  if (!NATIVE) return;
  try {
    const id = N_EVENT0 + (hashId(e.id) % 1000000);
    await cancelIds([id]);
    if (!prefs.notify) return;
    const [y, m, d] = e.end.split('-').map(Number), at = new Date(y, m - 1, d + 1, 9, 0, 0);
    if (at.getTime() <= Date.now()) return;
    if (!(await askNotify())) return;
    const n = (e.met || []).length;
    await LocalNotifications.schedule({notifications: [{id, title: `Follow up from ${e.name}`,
      body: n ? `You met ${n} ${n === 1 ? 'person' : 'people'}. A short note this week makes the connection stick.` : 'Who did you meet? Add them while it’s fresh, then send a quick note.',
      schedule: {at, allowWhileIdle: true}, extra: {event: e.id}}]});
  } catch {}
}
export async function cancelEventNudge(eventId){ if (NATIVE) await cancelIds([N_EVENT0 + (hashId(eventId) % 1000000)]).catch(() => {}); }

export function onNotification(handler){
  if (!NATIVE) return;
  LocalNotifications.registerActionTypes({types: [{id: 'FOLLOW', actions: [{id: 'done', title: 'Done'}, {id: 'snooze', title: 'Snooze a week'}]}]}).catch(() => {});
  LocalNotifications.addListener('localNotificationActionPerformed', a => handler(a)).catch(() => {});
}

/* ---------- contacts ---------- */
export async function contactsAllowed(){
  if (!NATIVE) return false;
  try { const p = await Contacts.checkPermissions(); return p.contacts === 'granted' || p.contacts === 'limited'; } catch { return false; }
}
async function askContacts(){
  if (!NATIVE) throw new Error('Reading your contacts works in the phone app.');
  const p = await Contacts.requestPermissions();
  if (p.contacts !== 'granted' && p.contacts !== 'limited') throw new Error('Bearings needs access to Contacts for this. You can turn it on in Android Settings under Apps, Bearings, Permissions.');
}
/** Raw cards with names, company, emails, phones and addresses, for placing people on the map. */
export async function readContactCards(){
  await askContacts();
  const {contacts} = await Contacts.getContacts({projection: {name: true, organization: true, phones: true, emails: true, postalAddresses: true, birthday: true}});
  return contacts || [];
}
/** The starter network: name, company, title and email for each person in the phone. */
export async function readStarterContacts(){
  await askContacts();
  const {contacts} = await Contacts.getContacts({projection: {name: true, organization: true, emails: true}});
  const all = [], work = [];
  for (const c of contacts || []){
    const n = c.name || {};
    let f = (n.given || '').trim(), l = (n.family || '').trim();
    if (!f && !l && n.display){ const parts = n.display.trim().split(/\s+/); f = parts.shift() || ''; l = parts.join(' '); }
    if (!f && !l) continue;
    const org = c.organization || {};
    const row = {f, l, c: (org.company || '').trim(), p: (org.jobTitle || '').trim(), e: ((c.emails || [])[0] || {}).address || ''};
    all.push(row);
    if (row.c || row.p) work.push(row);
  }
  // people with a company or title make a truer picture of a professional network
  return work.length >= 15 ? work : all;
}
