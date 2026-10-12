// Bearings Team on Android: the client for the team server (server/team/worker.js).
// The contract is docs/team.md. Every team name, profile and share is encrypted on this
// phone with the team key before it leaves; the key travels only inside invite links,
// after the #, and is kept here with the app's other secrets.
import { M, isSample, saveFile, refreshAll, show } from './model.js';
import { Store, ls } from './platform.js';
import { Secrets } from './secrets.js';

/* global __TEAM_URL__ */
export const TEAM_URL = typeof __TEAM_URL__ === 'string' ? __TEAM_URL__.replace(/\/+$/, '') : '';
export const teamEnabled = () => !!TEAM_URL;

const DAY = 864e5, AUTO_SYNC = 6 * 3600e3;
const STATE = 'bearings.team', CACHE = 'team-shares.json';

/* ---------- local state ---------- */
// Non-secret parts in local storage, so screens can read them right away:
// {url, teamId, memberId, role, lastSync, teamName, myName, myTitle, readOnly, plan}.
// The sign-in token and the team key live in Secrets.
let state = ls.json(STATE, null);
const saveState = () => { if (state) ls.set(STATE, JSON.stringify(state)); else ls.del(STATE); ls.set('bearings.teamPro', state && !state.readOnly ? '1' : '0'); };
export const teamState = () => state;
export const onTeam = () => !!(state && state.teamId && TEAM_URL);
export const isAdmin = () => !!state && (state.role === 'owner' || state.role === 'admin');

/* ---------- encoding ---------- */
const enc = new TextEncoder(), dec = new TextDecoder();
function b64(bytes){
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s){
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pipe(bytes, stream){
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/* ---------- crypto ---------- */
// base64(0x01 | 12-byte nonce | AES-256-GCM(deflate-raw(UTF-8 JSON)) with its 16-byte tag)
const importKey = keyText => {
  const raw = unb64(keyText);
  if (raw.length !== 32) throw new Error('That team key isn’t valid.');
  return crypto.subtle.importKey('raw', raw, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
};
export const newKey = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function encrypt(keyText, value){
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  const packed = await pipe(enc.encode(json), new CompressionStream('deflate-raw'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await importKey(keyText), packed));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return b64(out);
}
/** Decrypts to the JSON text. Throws if the key is wrong or the data was changed. */
export async function decryptText(keyText, text){
  const all = unb64(text);
  if (all[0] !== 1 || all.length < 13 + 16) throw new Error('Unknown encryption format.');
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: all.subarray(1, 13)}, await importKey(keyText), all.subarray(13));
  return dec.decode(await pipe(new Uint8Array(plain), new DecompressionStream('deflate-raw')));
}
export const decrypt = async (keyText, text) => JSON.parse(await decryptText(keyText, text));

/* ---------- the server ---------- */
class TeamError extends Error { constructor(status, message){ super(message); this.status = status; } }
async function api(method, path, body, {auth = true, base} = {}){
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth){ const t = await Secrets.get('team.token'); if (!t) throw new TeamError(401, 'Sign in to your team first.'); headers.Authorization = `Bearer ${t}`; }
  let res;
  try { res = await fetch((base || (state && state.url) || TEAM_URL) + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store'}); }
  catch { throw new TeamError(0, 'Couldn’t reach the team server. Check your connection and try again.'); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok){
    const err = new TeamError(res.status, (data && data.error) || `The team server didn’t accept that (${res.status}).`);
    // a revoked token means you were removed or the team was deleted
    if (res.status === 401 && auth && state){ await wipe(); err.message = 'You’re no longer on this team. It may have been deleted, or you were removed.'; err.gone = true; }
    throw err;
  }
  return data;
}

async function key(){ const k = await Secrets.get('team.key'); if (!k) throw new Error('This phone doesn’t have the team key. Join again with an invite link.'); return k; }
async function begin(r, keyText, teamName, myName, myTitle){
  await Secrets.set('team.token', r.token);
  await Secrets.set('team.key', keyText);
  state = {url: TEAM_URL, teamId: r.team.id, memberId: r.member.id, role: r.member.role, lastSync: 0, teamName, myName, myTitle, readOnly: false, plan: 'trial'};
  saveState();
}
/** Forgets the team on this phone and takes the server shares out of the engine. */
async function wipe(){
  state = null; saveState();
  await Secrets.set('team.token', ''); await Secrets.set('team.key', '');
  await Store.write(CACHE, JSON.stringify({v: 1, shares: {}})).catch(() => {});
  try { M.api.setTeamShares([]); } catch {}
  await saveFile('team', 'team.json');
  refreshAll();
}

const profileOf = (name, title) => ({name: String(name || '').trim().slice(0, 120), title: String(title || '').trim().slice(0, 160)});

/* ---------- starting and joining ---------- */
export async function createTeam(teamName, myName, myTitle){
  if (!TEAM_URL) throw new Error('Bearings Team isn’t set up in this build.');
  const k = newKey(), p = profileOf(myName, myTitle);
  const r = await api('POST', '/v1/teams', {name: await encrypt(k, {name: teamName.trim()}), profile: await encrypt(k, p)}, {auth: false, base: TEAM_URL});
  await begin(r, k, teamName.trim(), p.name, p.title);
  await sync({quiet: true}).catch(e => show(e.message));
  return state;
}

/** Reads an invite from a pasted link: the https invite link or the bearings:// hand-off. */
export function parseInvite(text){
  const s = String(text || '').trim();
  let m = /\/join\/([A-Za-z0-9]{10})\/?(?:\?[^#]*)?#(?:.*&)?k=([A-Za-z0-9_-]{43})/.exec(s);
  if (m) return {code: m[1], key: m[2]};
  m = /^bearings:\/\/team\/join\?(.*)$/i.exec(s);
  if (m){ const q = new URLSearchParams(m[1]); const code = q.get('code') || '', k = q.get('k') || ''; if (/^[A-Za-z0-9]{10}$/.test(code) && /^[A-Za-z0-9_-]{43}$/.test(k)) return {code, key: k}; }
  return null;
}
export async function checkInvite(code){ return api('GET', `/v1/invites/${encodeURIComponent(code)}`, undefined, {auth: false, base: TEAM_URL}); }
export async function joinFromLink(code, keyText, myName, myTitle){
  if (!TEAM_URL) throw new Error('Bearings Team isn’t set up in this build.');
  if (onTeam()) throw new Error('You’re already on a team. Leave it first to join another.');
  await importKey(keyText);
  await checkInvite(code);
  const p = profileOf(myName, myTitle);
  const r = await api('POST', '/v1/join', {code, profile: await encrypt(keyText, p)}, {auth: false, base: TEAM_URL});
  await begin(r, keyText, '', p.name, p.title);
  await teamInfo().catch(() => {});
  await sync({quiet: true}).catch(e => show(e.message));
  return state;
}

/* ---------- the team ---------- */
/** The team with its name and every member's profile decrypted. */
export async function teamInfo(){
  const r = await api('GET', '/v1/team');
  const k = await key();
  const open = async (text, fallback) => { try { return await decrypt(k, text); } catch { return fallback; } };
  const team = Object.assign({}, r.team, {name: ((await open(r.team.name, {})).name) || 'Your team'});
  const members = [];
  for (const m of r.members){ const p = await open(m.profile, {}); members.push(Object.assign({}, m, profileOf(p.name || 'Someone', p.title))); }
  state.role = r.me.role; state.teamName = team.name; state.readOnly = !!team.readOnly; state.plan = team.plan;
  saveState();
  return {team, me: r.me, members, invites: r.invites || []};
}
export const inviteLink = (code, keyText) => `${(state && state.url) || TEAM_URL}/join/${code}#k=${keyText}`;
export async function invite({role = 'member', uses = 10, days = 14} = {}){
  const r = await api('POST', '/v1/invites', {role, uses, days});
  return Object.assign(r, {link: inviteLink(r.code, await key())});
}
export async function linkFor(code){ return inviteLink(code, await key()); }
export const revokeInvite = code => api('DELETE', `/v1/invites/${encodeURIComponent(code)}`);
export const removeMember = id => api('DELETE', `/v1/members/${encodeURIComponent(id)}`);
export async function setRole(id, role){
  await api('PATCH', `/v1/members/${encodeURIComponent(id)}`, {role});
  if (role === 'owner' && state){ state.role = 'admin'; saveState(); }
}
export async function updateProfile(myName, myTitle){
  const p = profileOf(myName, myTitle);
  await api('PUT', '/v1/me', {profile: await encrypt(await key(), p)});
  state.myName = p.name; state.myTitle = p.title; saveState();
}
/** Leaves the team: the server deletes your share, and this phone forgets the team. */
export async function leave(){
  if (!state) return;
  try { await api('DELETE', `/v1/members/${encodeURIComponent(state.memberId)}`); }
  catch (e) { if (!e.gone) throw e; return; }
  await wipe();
}
/** Deletes the team and everything about it on the server (owner only). */
export async function deleteTeam(){
  try { await api('DELETE', '/v1/team'); }
  catch (e) { if (!e.gone) throw e; return; }
  await wipe();
}

/* ---------- billing (owners) ---------- */
export const billing = () => api('GET', '/v1/billing');
export const checkout = seats => api('POST', '/v1/billing/checkout', {seats});
export const portal = () => api('POST', '/v1/billing/portal');

/* ---------- sync ---------- */
async function readCache(){
  try { const c = JSON.parse((await Store.read(CACHE)) || 'null'); return (c && c.shares) || {}; } catch { return {}; }
}
let syncing = null;
export const isSyncing = () => !!syncing;
/** Uploads your share, downloads teammates' changed shares, and hands them to the engine. */
export function sync(opts = {}){
  if (!syncing) syncing = run(opts).finally(() => { syncing = null; });
  return syncing;
}
async function run({quiet = false} = {}){
  if (!onTeam()) return null;
  const k = await key();
  const info = await teamInfo();
  let uploaded = false;
  // the sample network isn't yours to share; a read-only team can't take new shares
  if (!isSample() && !state.readOnly){
    try { await api('PUT', '/v1/share', {body: await encrypt(k, M.api.teamShare(state.myName || 'A teammate'))}); uploaded = true; }
    catch (e) { if (e.status === 402){ state.readOnly = true; saveState(); } else throw e; }
  }
  const list = await api('GET', '/v1/shares');
  const old = await readCache(), next = {};
  let failed = 0;
  for (const s of list){
    if (s.member === state.memberId) continue;
    const c = old[s.member];
    if (c && c.updated === s.updated && c.text){ next[s.member] = c; continue; }
    try {
      const r = await api('GET', `/v1/shares/${encodeURIComponent(s.member)}`);
      next[s.member] = {updated: r.updated, text: await decryptText(k, r.body)};
    } catch (e) { if (e.gone) throw e; failed++; }
  }
  // only current members' shares are kept; a removed member's share goes with them
  await Store.write(CACHE, JSON.stringify({v: 1, shares: next})).catch(() => {});
  M.api.setTeamShares(Object.entries(next).map(([id, v]) => ({id, text: v.text})));
  await saveFile('team', 'team.json');
  state.lastSync = Date.now(); saveState();
  refreshAll();
  if (!quiet) show(failed ? `Synced. ${failed} ${failed === 1 ? 'share' : 'shares'} couldn’t be read.` : 'Team synced');
  return {info, uploaded, shares: Object.keys(next).length, failed};
}
/** At start and on resume: puts cached shares back (the sample network doesn't save team.json) and syncs if it's been 6 hours. */
export async function autoSync(){
  if (!onTeam()) return;
  if (isSample()){
    const c = await readCache();
    const shares = Object.entries(c).map(([id, v]) => ({id, text: v.text}));
    if (shares.length){ try { M.api.setTeamShares(shares); refreshAll(); } catch {} }
  }
  if (Date.now() - (state.lastSync || 0) > AUTO_SYNC) sync({quiet: true}).catch(e => console.warn('team sync', e && e.message));
}

/* ---------- small helpers for screens ---------- */
export function planLine(team){
  if (!team) return '';
  if (team.readOnly) return team.plan === 'canceled' ? 'Read-only: the subscription ended' : 'Read-only: the trial ended';
  if (team.plan === 'trial'){ const n = Math.max(0, Math.ceil((team.trialEnds - Date.now()) / DAY)); return `Free trial, ${n} ${n === 1 ? 'day' : 'days'} left`; }
  if (team.plan === 'past_due') return 'Team, payment due';
  return 'Team';
}
export function ago(ms){
  if (!ms) return 'never';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`;
}
