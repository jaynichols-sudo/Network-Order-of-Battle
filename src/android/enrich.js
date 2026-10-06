// Enrichment on Android: look people up with your own ZoomInfo or Seamless.AI account, or
// import a CSV exported from any provider. Results live in enrichment.json, separate from your
// network, and never change it. Same providers and rules as the iPhone app.
import { CapacitorHttp } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { M, persons, show, saveEnriched } from './model.js';
import { esc, icon, fmt, Day, segmented } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { register } from './actions.js';
import { ls, fx, openURL } from './platform.js';
import { Secrets } from './secrets.js';
import { allow } from './pro.js';

/* global __CONNECT_URL__ */
const HELPER = typeof __CONNECT_URL__ === 'string' ? __CONNECT_URL__.replace(/\/+$/, '') : '';
export const PROVIDERS = {off: 'Off', zoominfo: 'ZoomInfo', seamless: 'Seamless.AI'};
export const SOURCE = {zoominfo: 'ZoomInfo', seamless: 'Seamless.AI', file: 'your enrichment file'};
export const provider = () => ls.get('bearings.enrich') || 'off';
const setProvider = v => ls.set('bearings.enrich', v);

export async function configured(p = provider()){
  if (p === 'zoominfo') return !!(await Secrets.get('zi.user')) && (!!(await Secrets.get('zi.pass')) || (!!(await Secrets.get('zi.client')) && !!(await Secrets.get('zi.key'))));
  if (p === 'seamless') return !!(await Secrets.get('sm.access')) || !!(await Secrets.get('sm.key'));
  return false;
}

const str = v => (v == null || v === '' ? undefined : String(v));
async function http(opts){
  const r = await CapacitorHttp.request(Object.assign({headers: {}}, opts, {headers: Object.assign({'Content-Type': 'application/json'}, opts.headers)}));
  const data = typeof r.data === 'string' ? (() => { try { return JSON.parse(r.data); } catch { return {}; } })() : (r.data || {});
  return {status: r.status, data};
}

/* ---------- ZoomInfo: username + password, or PKI (client ID + private key, RS256) ---------- */
let ziJwt = null;
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = s => b64url(new TextEncoder().encode(s));
/** PKCS#1 keys ("BEGIN RSA PRIVATE KEY") get the PKCS#8 wrapper WebCrypto needs. */
function pkcs8(pem){
  const der = Uint8Array.from(atob(pem.split(/\r?\n/).filter(l => !l.startsWith('-----')).join('').replace(/\s+/g, '')), c => c.charCodeAt(0));
  if (!/BEGIN RSA PRIVATE KEY/.test(pem)) return der;
  const len = n => n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const oct = [0x04, ...len(der.length)];
  const inner = [0x02, 0x01, 0x00, ...alg, ...oct];
  return Uint8Array.from([0x30, ...len(inner.length + der.length), ...inner, ...der]);
}
export async function ziClientJWT(user, client, pem){
  let key;
  try { key = await crypto.subtle.importKey('pkcs8', pkcs8(pem), {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']); }
  catch { throw new Error('Couldn’t read that private key. ZoomInfo PKI keys are RSA keys in PEM form; paste the whole key.'); }
  const iat = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({alg: 'RS256', typ: 'JWT'}));
  const body = b64urlText(JSON.stringify({aud: 'enterprise_api', iss: 'api-client@zoominfo.com', username: user, client_id: client, iat, exp: iat + 300}));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
async function ziToken(c = null, fresh = false){
  if (!fresh && ziJwt && ziJwt.until > Date.now()) return ziJwt.token;
  c = c || {user: await Secrets.get('zi.user'), pass: await Secrets.get('zi.pass'), client: await Secrets.get('zi.client'), key: await Secrets.get('zi.key')};
  const pki = !!(c.client && c.key);
  if (!c.user || (!pki && !c.pass)) throw new Error('Add your ZoomInfo API username and password, or client ID and private key, in Settings.');
  const r = pki
    ? await http({method: 'POST', url: 'https://api.zoominfo.com/authenticate', headers: {Authorization: `Bearer ${await ziClientJWT(c.user, c.client, c.key)}`}})
    : await http({method: 'POST', url: 'https://api.zoominfo.com/authenticate', data: {username: c.user, password: c.pass}});
  if (r.status !== 200 || !r.data.jwt) throw new Error(r.status === 401 || r.status === 403
    ? (pki ? 'ZoomInfo didn’t accept that client ID and key. Check they belong to this username.' : 'ZoomInfo didn’t accept that username and password. API access may need to be turned on for your account.')
    : `Couldn’t sign in to ZoomInfo (${r.status}).`);
  ziJwt = {token: r.data.jwt, until: Date.now() + 55 * 60 * 1000};
  return ziJwt.token;
}
const ZI_FIELDS = ['id', 'firstName', 'lastName', 'email', 'phone', 'mobilePhone', 'jobTitle', 'companyName', 'city', 'state', 'country'];
async function zoominfo(qs){
  const out = {}, today = Day.today();
  for (let i = 0; i < qs.length; i += 25){
    const chunk = qs.slice(i, i + 25);
    const input = chunk.map(q => Object.assign({firstName: q.f, lastName: q.l, companyName: q.c}, q.e ? {emailAddress: q.e} : {}));
    const req = async fresh => http({method: 'POST', url: 'https://api.zoominfo.com/enrich/contact', headers: {Authorization: `Bearer ${await ziToken(null, fresh)}`}, data: {matchPersonInput: input, outputFields: ZI_FIELDS}});
    let r = await req(false);
    if (r.status === 401) r = await req(true);
    if (r.status !== 200) throw new Error(r.status === 429 ? 'ZoomInfo’s rate limit was reached. Try again in a minute.' : `ZoomInfo returned an error (${r.status}). ${r.data.message || ''}`);
    ((r.data.data && r.data.data.result) || []).forEach((res, j) => {
      const d = res && res.data && res.data[0]; if (!d || !chunk[j]) return;
      out[chunk[j].k] = clean({src: 'zoominfo', at: today, email: str(d.email), phone: str(d.phone), mobile: str(d.mobilePhone), title: str(d.jobTitle),
        company: str(d.companyName) || str(d.company && d.company.name), city: str(d.city), state: str(d.state), country: str(d.country)});
    });
  }
  return out;
}

/* ---------- Seamless.AI: sign in through the helper (OAuth), or an API key ---------- */
let pending = null;
export const seamlessSignInAvailable = () => HELPER.startsWith('https://');
/** Called for every bearings:// link; true if it was Seamless.AI's answer. */
export function handleSeamlessUrl(url){
  if (!/^bearings:\/\/seamless/i.test(url || '') || !pending) return false;
  Browser.close().catch(() => {});
  const q = new URLSearchParams(url.split('#')[1] || '');
  const p = pending; pending = null;
  if (q.get('state') !== p.state) p.reject(new Error('The Seamless.AI sign-in didn’t match. Please try again.'));
  else if (q.get('error')) p.reject(new Error(/cancel|denied/i.test(q.get('error')) ? 'cancelled' : q.get('error')));
  else if (!q.get('token')) p.reject(new Error('Seamless.AI didn’t send access. Please try again.'));
  else p.resolve({token: q.get('token'), refresh: q.get('refresh') || '', expires: +q.get('expires') || 10800});
  return true;
}
async function smSave(access, refresh, expires){
  await Secrets.set('sm.access', access);
  if (refresh) await Secrets.set('sm.refresh', refresh);
  await Secrets.set('sm.until', String(Date.now() + (expires - 120) * 1000));
}
export async function seamlessSignIn(){
  const state = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(16).padStart(2, '0')).join('');
  const r = await new Promise((resolve, reject) => {
    pending = {state, resolve, reject};
    Browser.open({url: `${HELPER}/seamless/start?state=${state}`}).catch(e => { pending = null; reject(e); });
    Browser.addListener('browserFinished', () => setTimeout(() => { if (pending && pending.state === state){ pending = null; reject(new Error('cancelled')); } }, 800)).catch(() => {});
  });
  await smSave(r.token, r.refresh, r.expires);
}
export async function seamlessSignOut(){ for (const k of ['sm.access', 'sm.refresh', 'sm.until']) await Secrets.set(k, ''); }
async function smAuth(){
  const access = await Secrets.get('sm.access');
  if (access){
    if (Date.now() < +(await Secrets.get('sm.until'))) return {Authorization: `Bearer ${access}`};
    const refresh = await Secrets.get('sm.refresh');
    if (!refresh || !HELPER) return {Authorization: `Bearer ${access}`};
    const r = await http({method: 'POST', url: `${HELPER}/seamless/refresh`, data: {refresh_token: refresh}});
    if (r.status !== 200 || !r.data.access_token){ await seamlessSignOut(); throw new Error('Your Seamless.AI sign-in expired. Sign in again in Settings.'); }
    await smSave(r.data.access_token, r.data.refresh_token, +r.data.expires_in || 10800);
    return {Authorization: `Bearer ${r.data.access_token}`};
  }
  const key = await Secrets.get('sm.key');
  if (!key) throw new Error('Sign in with Seamless.AI in Settings first.');
  return {Token: key};
}
const SM = 'https://api.seamless.ai/api/client/v1';
async function seamless(qs){
  const out = {}, today = Day.today();
  for (let i = 0; i < qs.length; i += 100){
    const chunk = qs.slice(i, i + 100);
    const contacts = chunk.map(q => Object.assign({contactName: `${q.f} ${q.l}`.trim(), companyName: q.c}, q.p ? {title: q.p} : {}, q.e ? {email: q.e} : {}, q.u ? {liProfileUrl: q.u} : {}));
    const r = await http({method: 'POST', url: `${SM}/contacts/research`, headers: await smAuth(), data: {contacts}});
    if ((r.status !== 200 && r.status !== 202) || !Array.isArray(r.data.requestIds)) throw new Error(r.status === 401 ? 'Seamless.AI didn’t accept your sign-in.' : r.status === 402 || r.status === 403 ? 'Seamless.AI says this needs more credits or API access on your plan.' : `Seamless.AI returned an error (${r.status}).`);
    const owner = {}; r.data.requestIds.forEach((id, j) => { if (chunk[j]) owner[id] = chunk[j].k; });
    const waiting = new Set(r.data.requestIds);
    for (let n = 0; n < 30 && waiting.size; n++){
      await new Promise(res => setTimeout(res, 2000));
      const p = await http({method: 'GET', url: `${SM}/contacts/research/poll`, params: {requestIds: [...waiting].sort().join(',')}, headers: await smAuth()});
      if (p.status !== 200) continue;
      for (const item of p.data.data || []){
        const s = String(item.status || '').toLowerCase();
        if (!item.requestId || ['pending', 'processing', 'in_progress'].includes(s)) continue;
        waiting.delete(item.requestId);
        const c = item.contact, k = owner[item.requestId]; if (!c || !k) continue;
        const loc = c.contactLocation || {};
        out[k] = clean({src: 'seamless', at: today, email: str(c.email), phone: str(c.contactPhone1), title: str(c.title), company: str(c.company), city: str(loc.city), state: str(loc.stateAbbr) || str(loc.state), country: str(loc.country)});
      }
    }
  }
  return out;
}

function clean(e){ for (const k of Object.keys(e)) if (e[k] === undefined || e[k] === '') delete e[k]; return e; }

/** Looks people up with the chosen provider and keeps what it finds. */
export async function enrich(keys){
  if (!allow('enrich')) return null;
  const p = provider();
  if (p === 'off' || !(await configured(p))){ show('Add your ZoomInfo or Seamless.AI account in Settings first.'); openEnrichSettings(); return null; }
  const qs = persons(keys).map(x => ({k: x.k, f: x.f, l: x.l, c: x.c, p: x.p, e: x.e, u: x.u}));
  try {
    const found = p === 'zoominfo' ? await zoominfo(qs) : await seamless(qs);
    await saveEnriched(found);
    const n = Object.keys(found).length;
    show(n ? `${PROVIDERS[p]} found ${fmt(n)} of ${fmt(qs.length)}` : `${PROVIDERS[p]} didn’t find a match.`);
    return n;
  } catch (e) { show((e && e.message) || String(e)); return null; }
}

/** A CSV from ZoomInfo, Seamless.AI, Apollo or anyone, matched on this phone. */
export async function importEnrichmentFile(file){
  try {
    const m = M.api.matchEnrichment(await file.text());
    const today = Day.today(), found = {};
    for (const [k, r] of Object.entries(m.people)) found[k] = clean(Object.assign({src: 'file', at: today}, r));
    await saveEnriched(found);
    fx.success();
    show(`Matched ${fmt(m.matched)} of ${fmt(m.rows)} people in the file`);
  } catch (e) { show('Couldn’t read that file: ' + ((e && e.message) || e)); }
}

/* ---------- screens ---------- */
/** On a person's details page: what was found, and a button to look them up. */
export function enrichSection(p){
  const e = M.enriched[p.k], prov = provider();
  if (!e && prov === 'off') return '';
  const loc = e ? [e.city, e.state].filter(Boolean).join(', ') : '';
  const row = (a, ic, label, v) => `<button type="button" class="row act" data-a="${a}" data-v="${esc(v)}" aria-label="${esc(`${label}, ${v}`)}">${icon(ic)}<span class="grow"><span class="muted small">${esc(label)}</span><br>${esc(v)}</span></button>`;
  return `<p class="sec-h">${e ? esc(`From ${SOURCE[e.src] || e.src}, ${Day.nice(e.at)}`) : 'Enrich'}</p><div class="card list">
    ${e && e.email ? row('enrichMail', 'mail', 'Email', e.email) : ''}
    ${e && e.phone ? row('enrichCall', 'bubbles', 'Phone', e.phone) : ''}
    ${e && e.mobile ? row('enrichCall', 'bubbles', 'Mobile', e.mobile) : ''}
    ${loc ? `<div class="row static">${icon('mappin')}<span class="grow">${esc(loc)}</span></div>` : ''}
    ${e && e.title && e.company && !(e.title === p.p && e.company === p.c) ? `<div class="row static">${icon('briefcase')}<span class="grow"><span class="info small">${esc(`${SOURCE[e.src] || e.src} shows a different role`)}</span><br>${esc(`${e.title} at ${e.company}`)}</span></div>` : ''}
    ${prov !== 'off' ? `<button type="button" class="row act" data-a="enrichOne">${icon('sparkles')}<span>${e ? 'Look up again' : `Look up with ${esc(PROVIDERS[prov])}`}</span></button>` : ''}
  </div>${!e && prov === 'seamless' ? '<p class="foot">Uses one Seamless.AI research credit.</p>' : ''}`;
}
export const enrichHandlers = k => ({
  enrichOne: async (_, t) => { t.disabled = true; t.querySelector('span').textContent = 'Looking up…'; await enrich([k]); },
  enrichMail: v => openURL('mailto:' + v),
  enrichCall: v => openURL('tel:' + v.replace(/[^\d+]/g, '')),
});

export function openEnrichSettings(){
  const st = {p: provider(), pki: false, status: '', busy: false, smIn: false, user: '', client: ''};
  const render = async body => {
    st.smIn = !!(await Secrets.get('sm.access'));
    if (!st.loaded){ st.user = await Secrets.get('zi.user'); st.client = await Secrets.get('zi.client'); st.pki = !!st.client; st.loaded = true; }
    const hasPass = !!(await Secrets.get('zi.pass')), hasKey = !!(await Secrets.get('zi.key')), hasSmKey = !!(await Secrets.get('sm.key'));
    body.innerHTML = `<div class="card pad">${segmented('prov', Object.entries(PROVIDERS), st.p)}</div>
      ${st.p === 'zoominfo' ? `<div class="card form">
        <input type="text" class="field" data-in="user" value="${esc(st.user)}" placeholder="API username" autocapitalize="none" autocomplete="username" aria-label="API username">
        ${segmented('pki', [['0', 'Password'], ['1', 'Client ID and key']], st.pki ? '1' : '0')}
        ${st.pki ? `<input type="text" class="field" data-in="client" value="${esc(st.client)}" placeholder="Client ID" autocapitalize="none" aria-label="Client ID">
          <textarea class="field mono" rows="4" data-in="key" placeholder="${hasKey ? 'Private key (saved)' : 'Private key: paste the whole PEM'}" autocapitalize="none" spellcheck="false" aria-label="Private key"></textarea>`
        : `<input type="password" class="field" data-in="pass" placeholder="${hasPass ? 'API password (saved)' : 'API password'}" autocomplete="current-password" aria-label="API password">`}
        <button type="button" class="btn prominent block" data-a="saveZi" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Checking…' : 'Save and test'}</button></div>` : ''}
      ${st.p === 'seamless' ? `<div class="card list">
        ${seamlessSignInAvailable() ? (st.smIn ? `<div class="row static">${icon('checkCircle')}<span class="grow">Signed in to Seamless.AI</span></div><button type="button" class="row act bad" data-a="smOut">${icon('x')}<span>Sign out of Seamless.AI</span></button>`
          : `<button type="button" class="row act" data-a="smIn" ${st.busy ? 'disabled' : ''}>${icon('lock')}<span>${st.busy ? 'Opening Seamless.AI…' : 'Sign in with Seamless.AI'}</span></button>`) : ''}
      </div><p class="sec-h">Or use an API key</p><div class="card form"><input type="password" class="field" data-in="smKey" placeholder="${hasSmKey ? 'API key (saved)' : 'API key'}" aria-label="Seamless.AI API key"><button type="button" class="btn block" data-a="saveSmKey">Save key</button></div>` : ''}
      ${st.status ? `<p class="foot" role="status">${esc(st.status)}</p>` : ''}
      ${st.p !== 'off' ? `<div class="card list"><button type="button" class="row act bad" data-a="forget">${icon('x')}<span>Remove saved credentials</span></button></div>` : ''}
      <p class="foot">${st.p === 'seamless' ? 'Uses your own Seamless.AI account: sign in on Seamless.AI’s page (Bearings never sees your password). Each person looked up uses one research credit.' : 'Uses your own account to fill in work email, phone, current title and city for the people you choose. ZoomInfo’s API needs API access on your contract.'} Only the names, companies and titles you choose to look up are sent, and only when you ask. Sign-ins are encrypted on this phone and never synced.</p>
      <p class="sec-h">No account?</p><div class="card list"><button type="button" class="row act" data-a="file">${icon('download')}<span>Import an enrichment file</span></button></div>
      <p class="foot">Export a CSV from any provider (ZoomInfo, Seamless.AI, Apollo). It’s matched to your people on this phone.</p>`;
  };
  const inputs = {pass: '', key: '', smKey: ''};
  openSheet({
    title: 'ZoomInfo and Seamless.AI', right: ['Done'], full: true,
    mount: body => { render(body); },
    handlers: {
      prov(v, t){ if (v !== 'off' && !allow('enrich')) return; st.p = v; setProvider(v); st.status = ''; fx.select(); render(t.closest('.sheet-body')); },
      pki(v, t){ st.pki = v === '1'; render(t.closest('.sheet-body')); },
      user: v => { st.user = v.trim(); }, client: v => { st.client = v.trim(); },
      pass: v => { inputs.pass = v; }, key: v => { inputs.key = v.trim(); }, smKey: v => { inputs.smKey = v.trim(); },
      async saveZi(_, t){
        const body = t.closest('.sheet-body');
        st.busy = true; st.status = ''; await render(body);
        try {
          const c = {user: st.user, pass: st.pki ? '' : (inputs.pass || await Secrets.get('zi.pass')), client: st.pki ? st.client : '', key: st.pki ? (inputs.key || await Secrets.get('zi.key')) : ''};
          await ziToken(c, true);
          await Secrets.set('zi.user', c.user); await Secrets.set('zi.pass', c.pass); await Secrets.set('zi.client', c.client); await Secrets.set('zi.key', c.key);
          inputs.pass = ''; inputs.key = '';
          st.status = 'Connected to ZoomInfo.'; fx.success();
        } catch (e) { st.status = (e && e.message) || String(e); }
        st.busy = false; render(body);
      },
      async smIn(_, t){
        const body = t.closest('.sheet-body');
        st.busy = true; await render(body);
        try { await seamlessSignIn(); st.status = 'Connected to Seamless.AI.'; fx.success(); }
        catch (e) { if (!/cancel/i.test((e && e.message) || '')) st.status = (e && e.message) || String(e); }
        st.busy = false; render(body);
      },
      async smOut(_, t){ await seamlessSignOut(); st.status = 'Signed out.'; render(t.closest('.sheet-body')); },
      async saveSmKey(_, t){ if (!inputs.smKey) return; await Secrets.set('sm.key', inputs.smKey); inputs.smKey = ''; st.status = 'Saved. Look someone up from their profile to check it.'; render(t.closest('.sheet-body')); },
      async forget(_, t){
        for (const k of ['zi.user', 'zi.pass', 'zi.client', 'zi.key', 'sm.key']) await Secrets.set(k, '');
        await seamlessSignOut(); ziJwt = null; st.user = ''; st.client = ''; st.status = 'Removed.';
        render(t.closest('.sheet-body'));
      },
      file(){ closeSheet(); pickEnrichmentFile(); },
    },
  });
}

export function pickEnrichmentFile(){
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.csv,text/csv,text/comma-separated-values';
  i.onchange = () => { const f = i.files && i.files[0]; if (f) importEnrichmentFile(f); };
  i.click();
}
register('enrichSettings', openEnrichSettings);
register('enrichFile', pickEnrichmentFile);
