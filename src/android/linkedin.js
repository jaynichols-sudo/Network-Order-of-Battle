// One-tap import for members in the EEA and Switzerland, through LinkedIn's official
// Member Data Portability API (see server/linkedin-connect). Hidden everywhere else.
import { CapacitorHttp } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import api from '../engine.js';

/* global __LINKEDIN_CONNECT_URL__ */
const HELPER = typeof __LINKEDIN_CONNECT_URL__ === 'string' ? __LINKEDIN_CONNECT_URL__.replace(/\/+$/, '') : '';
const REGIONS = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT',
  'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH']);
const DOMAINS = ['CONNECTIONS', 'INBOX', 'INVITATIONS'];

function region(){
  for (const l of navigator.languages || [navigator.language]){
    try { const r = new Intl.Locale(l).region; if (r) return r; } catch {}
  }
  return '';
}
export const linkedInAvailable = () => HELPER.startsWith('https://') && REGIONS.has(region());

let pending = null;
/** Called for every bearings:// link the app is opened with; true if it was LinkedIn's answer. */
export function handleLinkedInUrl(url){
  if (!/^bearings:\/\/linkedin/i.test(url || '') || !pending) return false;
  Browser.close().catch(() => {});
  const q = new URLSearchParams((url.split('#')[1] || ''));
  const p = pending; pending = null;
  if (q.get('state') !== p.state) p.reject(new Error('The LinkedIn sign-in didn’t match. Please try again.'));
  else if (q.get('error')) p.reject(new Error(/cancel/i.test(q.get('error')) ? 'cancelled' : q.get('error')));
  else if (!q.get('token')) p.reject(new Error('LinkedIn didn’t send access. Please try again.'));
  else p.resolve(q.get('token'));
  return true;
}

function signIn(){
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const state = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return new Promise((resolve, reject) => {
    pending = {state, resolve, reject};
    Browser.open({url: `${HELPER}/start?state=${state}`}).catch(e => { pending = null; reject(e); });
    // if the browser is closed without an answer, stop waiting
    Browser.addListener('browserFinished', () => setTimeout(() => { if (pending && pending.state === state){ pending = null; reject(new Error('cancelled')); } }, 800)).catch(() => {});
  });
}

async function download(token, progress){
  const out = {};
  for (const domain of DOMAINS){
    progress(domain === 'CONNECTIONS' ? 'Getting your connections…' : domain === 'INBOX' ? 'Getting your messages…' : 'Getting your invitations…');
    const rows = [];
    let start = 0;
    for (let guard = 0; guard < 2000; guard++){
      const res = await CapacitorHttp.get({url: 'https://api.linkedin.com/rest/memberSnapshotData', params: {q: 'criteria', domain, start: String(start)},
        headers: {Authorization: `Bearer ${token}`, 'Linkedin-Version': '202312', 'X-Restli-Protocol-Version': '2.0.0'}});
      const json = typeof res.data === 'string' ? (() => { try { return JSON.parse(res.data); } catch { return {}; } })() : (res.data || {});
      if (res.status === 404 || /no data found/i.test(json.message || '')) break;
      if (res.status === 401 || res.status === 403) throw new Error('LinkedIn didn’t allow access to your data. Please connect again.');
      if (res.status !== 200) throw new Error(`LinkedIn returned an error (${res.status}). Please try again in a minute.`);
      for (const el of json.elements || []) for (const item of el.snapshotData || []) rows.push(Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v == null ? '' : String(v)])));
      const next = ((json.paging && json.paging.links) || []).find(l => l.rel === 'next');
      const n = next && +new URLSearchParams((next.href || '').split('?')[1] || '').get('start');
      if (!n || n <= start) break;
      start = n;
    }
    out[domain] = rows;
  }
  return out;
}

/** Signs in to LinkedIn and returns the engine's import plan, like a file would. */
export async function readFromLinkedIn(progress){
  const token = await signIn();
  const domains = await download(token, progress);
  progress('Reading…');
  return api.importSnapshot(domains, 'android');
}
