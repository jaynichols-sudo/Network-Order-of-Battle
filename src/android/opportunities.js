// SAM.gov opportunities matched to your network (Opportunities.swift on the iPhone). The phone
// asks SAM.gov's public Get Opportunities API for notices posted in the last 14 days, with the
// user's own key, at most every six hours. The engine (src/opportunities.js) maps each office to
// an agency on the federal map and says who you know there. No Northfix server is involved.
import { CapacitorHttp } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { M, isSample, persons, toggleTarget } from './model.js';
import { esc, fmt, icon, stack, empty, Day } from './ui.js';
import { registerRoute, openSheet, push, refreshVisible } from './nav.js';
import { open, openPerson, openUnit, register } from './actions.js';
import { personRow } from './people.js';
import { openNewPursuit } from './pursuits.js';
import { NATIVE, ls, openURL, fx, prefs } from './platform.js';
import { Secrets } from './secrets.js';

const SAM_URL = 'https://api.sam.gov/opportunities/v2/search';
const KEY_PAGE = 'https://sam.gov/profile/details';
const FRESH = 6 * 3600e3;
export const TYPES = [['r', 'Sources sought'], ['p', 'Presolicitation'], ['k', 'Combined solicitation'], ['o', 'Solicitation'], ['s', 'Special notice'], ['a', 'Award']];
const DEFAULT_TYPES = ['r', 'p', 'k', 'o', 's'];

/* ---------- settings and saved state ---------- */
// The key is encrypted on this phone (secrets.js); filters, the cache and the seen list are local.
const SET = 'bearings.sam', CACHE = 'bearings.sam.cache', SEEN = 'bearings.sam.seen', SEEN_PREV = 'bearings.sam.seenPrev';
export const samPrefs = () => Object.assign({naics: '', keywords: '', types: DEFAULT_TYPES, notify: true}, ls.json(SET, {}));
const saveSamPrefs = p => ls.set(SET, JSON.stringify(p));
const filters = () => { const p = samPrefs(); return {naics: p.naics, keywords: p.keywords, types: p.types}; };
let hasKey = false;
Secrets.get('sam.key').then(k => { hasKey = !!k; if (hasKey && M.loaded) refreshVisible('sam'); });
export const available = () => isSample() || hasKey;

const st = {notices: [], match: null, key: '', busy: null, error: '', at: +ls.get(CACHE + '.at') || 0, cacheLoaded: false};
const tryOr = (fn, fb) => { try { return fn(); } catch (e) { console.error(e); return fb; } };
function loadCache(){
  if (st.cacheLoaded) return;
  st.cacheLoaded = true;
  const c = ls.json(CACHE, null);
  if (c && Array.isArray(c.items)) st.notices = c.items;
}
function saveCache(){ try { ls.set(CACHE, JSON.stringify({items: st.notices})); ls.set(CACHE + '.at', String(st.at)); } catch { /* full storage: keep it in memory */ } }

/** Matches the saved notices to the network again, when the network or filters changed. */
function rematch(force = false){
  const p = samPrefs();
  const key = [isSample(), M.version, M.targets.length, st.notices.length, p.naics, p.keywords, p.types.join('')].join('|');
  if (!force && key === st.key && st.match) return st.match;
  const opts = filters();
  const prev = ls.json(SEEN_PREV, null);
  if (!isSample() && Array.isArray(prev)) opts.seen = prev;
  st.match = tryOr(() => M.api.matchOpportunities(st.notices, opts), null);
  st.key = key;
  return st.match;
}
export const match = () => available() ? rematch() : null;
export const lastError = () => st.error;
export const opportunity = id => { const m = match(); return m ? m.items.find(x => x.id === id) || null : null; };

/* ---------- fetching ---------- */
async function getText(url){
  if (NATIVE){
    try {
      const r = await CapacitorHttp.get({url, responseType: 'text', headers: {Accept: 'application/json'}, connectTimeout: 20000, readTimeout: 40000});
      return {status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {})};
    } catch { /* fall through to fetch */ }
  }
  const r = await fetch(url, {headers: {Accept: 'application/json'}});
  return {status: r.status, text: await r.text()};
}
/** Fetches at most every six hours (or when forced), then matches. Never throws. */
export function refreshOpportunities(force = false){
  if (isSample()){
    // the demo set only changes with the day, so this is "changed" just the first time
    const first = !st.notices.length || !st.notices[0].demo;
    if (first) st.notices = tryOr(() => M.api.demoOpportunities(), []);
    rematch(first);
    return Promise.resolve(first);
  }
  // just left the sample network: drop its demo notices
  if (st.notices.some(n => n.demo)){ st.notices = []; st.cacheLoaded = false; st.match = null; }
  if (st.busy) return st.busy;
  st.busy = (async () => {
    const key = await Secrets.get('sam.key');
    hasKey = !!key;
    if (!key){ st.notices = []; st.match = null; return false; }
    loadCache();
    if (!force && Date.now() - st.at < FRESH){ rematch(); return false; }
    const reqs = tryOr(() => M.api.opportunityRequests(filters(), 14), []);
    let got = [], err = '', answered = false;
    for (const r of reqs){
      const q = new URLSearchParams(Object.assign({api_key: key}, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))));
      try {
        const res = await getText(`${SAM_URL}?${q}`);
        const page = M.api.opportunityPage(res.text);
        if (page.error){ err = page.error; if (page.code === 'key' || page.code === 'rate') break; continue; }
        if (res.status >= 400){ err = `SAM.gov didn’t answer (error ${res.status}). Northfix will try again later.`; continue; }
        got = got.concat(page.items); answered = true;
      } catch { err = 'Couldn’t reach SAM.gov. Check your connection and try again.'; }
    }
    // a failed check still waits six hours, so a bad key doesn't use up the daily limit
    st.at = Date.now(); ls.set(CACHE + '.at', String(st.at));
    st.error = answered ? '' : err;
    if (!answered){ rematch(true); return true; }
    st.notices = got; saveCache();
    // what counts as new: anything not seen before this check
    const prior = ls.json(SEEN, null);
    if (Array.isArray(prior)) ls.set(SEEN_PREV, JSON.stringify(prior)); else ls.del(SEEN_PREV);
    const m = rematch(true);
    if (m){
      ls.set(SEEN, JSON.stringify(tryOr(() => M.api.markOpportunitiesSeen(prior || [], m.ids), m.ids)));
      if (Array.isArray(prior)) notify(m.alerts);
    }
    return true;
  })().catch(e => { console.error(e); return false; }).finally(() => { st.busy = null; });
  return st.busy;
}
function filtersChanged(){ st.at = 0; ls.set(CACHE + '.at', '0'); }
function clearAll(){ st.notices = []; st.match = null; st.error = ''; st.at = 0; for (const k of [CACHE, CACHE + '.at', SEEN, SEEN_PREV]) ls.del(k); }

/** A notification for new notices at agencies you watch or where you know three or more people. */
const N_SAM0 = 2050000000;
const hashId = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
async function notify(alerts){
  if (!NATIVE || !alerts || !alerts.length || !prefs.notify || !samPrefs().notify || isSample()) return;
  try {
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    await LocalNotifications.schedule({notifications: alerts.slice(0, 3).map(a => ({id: N_SAM0 + (hashId(a.id) % 40000000), title: a.title, body: a.body, extra: {opportunity: a.id}}))});
  } catch {}
}

/* ---------- pieces ---------- */
function dueText(o){
  if (o.days == null || !o.due) return '';
  if (o.days === 0) return 'Due today';
  if (o.days === 1) return 'Due tomorrow';
  return `Due ${Day.nice(o.due)}`;
}
export function oppRow(o, act = 'opp'){
  const top = [o.agency, o.type, dueText(o)].filter(Boolean).join(' · ').toUpperCase();
  const ps = persons(o.people.map(p => p.k));
  return `<button type="button" class="row opp-row" data-a="${act}" data-v="${esc(o.id)}">
    <span class="hl-main"><span class="eyebrow mono ${o.days != null && o.days <= 7 ? 'needs' : 'accent'}">${o.isNew ? '<i class="dot sm opp-new" aria-label="New"></i>' : ''}${esc(top)}${o.watched ? ` ${icon('starFill', 'opp-star')}` : ''}</span>
      <b class="serif">${esc(o.title)}</b>
      <span class="opp-who">${ps.length ? stack(ps, 22) : ''}<span class="muted small">${esc(o.line)}</span></span>
      ${o.pursuit ? `<span class="small strong info">${icon('target')}${esc(o.pursuit)}</span>` : ''}</span>${icon('chevR', 'chev')}</button>`;
}

/* ---------- Today: new at agencies you know ---------- */
let slot = null;
export function opportunitiesCard(el){
  slot = el;
  const m = match(), items = m ? m.items.slice(0, 3) : [];
  el.innerHTML = items.length ? `<section class="card list watch-card opp-card">
      <div class="card-head static"><p class="eyebrow mono muted">NEW AT AGENCIES YOU KNOW</p><button type="button" class="link small" data-a="oppAll">All</button></div>
      ${items.map(o => oppRow(o)).join('')}
      ${isSample() ? '<p class="foot">Sample notices. Add your SAM.gov key in Settings to see real ones.</p>' : ''}
    </section>` : '';
  refreshOpportunities().then(changed => { if (changed && slot && slot.isConnected) opportunitiesCard(slot); });
}
export const oppHandlers = {
  oppAll: () => { fx.tap(); push('opportunities'); },
  opp: id => { fx.tap(); push('opportunity', id); },
};

/* ---------- the list ---------- */
registerRoute('opportunities', () => {
  const view = {
    title: 'Opportunities', kind: 'all',
    mount(body){ this.update(body); refreshOpportunities().then(ch => { if (ch && body.isConnected) this.update(body); }); },
    update(body){
      if (!available()){
        body.innerHTML = empty('building', 'Add your SAM.gov key', 'Northfix can show new SAM.gov notices at the agencies where you know people. It uses your own free SAM.gov key.', '<button type="button" class="btn prominent" data-a="settings">Open SAM.gov settings</button>')
          + `<div class="card list top12"><button type="button" class="row act" data-a="recompetes">${icon('calClock')}<span>Recompetes and teaming partners</span>${icon('chevR', 'chev')}</button></div><p class="foot">No key needed. Contract data from USASpending.gov. Only the agency name is sent.</p>`;
        return;
      }
      const m = match();
      if (!m){ body.innerHTML = '<p class="foot">Loading…</p>'; return; }
      const kinds = TYPES.filter(([c]) => m.types[c]);
      const rows = m.items.filter(o => view.kind === 'all' || o.kind === view.kind);
      const last = st.at && !isSample() ? ` Last checked ${Day.ago(new Date(st.at).toLocaleDateString('en-CA'))}.` : '';
      body.innerHTML = `<div class="card pad opp-head"><p class="eyebrow mono muted">SAM.GOV, LAST 14 DAYS</p>
          <p><b class="serif big">${fmt(m.matched)}</b> <span class="muted">${m.matched === 1 ? 'notice at an agency you know or watch' : 'notices at agencies you know or watch'}</span></p>
          ${m.newCount ? `<p class="small strong needs">${fmt(m.newCount)} new since the last check</p>` : ''}
          ${st.error ? `<p class="small bad">${esc(st.error)}</p>` : ''}</div>
        ${kinds.length > 1 ? `<div class="tchips opp-kinds">${[['all', 'All types']].concat(kinds).map(([c, l]) => `<button type="button" class="tchip ${view.kind === c ? 'on' : ''}" data-a="kind" data-v="${c}">${esc(l)}${c !== 'all' ? ` <span class="mono">· ${fmt(m.types[c])}</span>` : ''}</button>`).join('')}</div>` : ''}
        ${rows.length ? `<div class="card list">${rows.map(o => oppRow(o)).join('')}</div>` : `<p class="foot">${m.total ? 'Nothing at agencies you know with these filters.' : 'No notices yet. Use Check now.'}</p>`}
        <p class="foot">${isSample() ? 'These are sample notices with made-up numbers, matched to the sample network. Add your own SAM.gov key in Settings to see real ones.' : `Northfix checks SAM.gov at most every 6 hours, straight from this phone, and matches notices to the people you know here. Nothing goes to a Northfix server.${last}`}</p>
        <div class="btn-row left">${isSample() ? '' : `<button type="button" class="btn small" data-a="check">${icon('refresh')}Check now</button>`}<button type="button" class="btn small" data-a="settings">${icon('gear')}SAM.gov settings</button></div>
        <div class="card list top12"><button type="button" class="row act" data-a="recompetes">${icon('calClock')}<span>Recompetes and teaming partners</span>${icon('chevR', 'chev')}</button></div>
        <p class="foot">Contracts ending soon at the agencies you work, and who holds them. Contract data from USASpending.gov. Only the agency name is sent.</p>`;
    },
    handlers: {
      opp: id => { fx.tap(); push('opportunity', id); },
      kind(v, t){ fx.select(); view.kind = v; view.update(t.closest('.page-body')); },
      settings: () => openSamSettings(),
      recompetes: () => { fx.tap(); push('recompetes'); },
      async check(_, t){ const body = t.closest('.page-body'); t.disabled = true; await refreshOpportunities(true); view.update(body); },
    },
  };
  return view;
});

/* ---------- one notice ---------- */
registerRoute('opportunity', id => {
  const view = {
    title: 'Notice',
    mount(body){ this.update(body); if (!opportunity(id)) refreshOpportunities().then(() => { if (body.isConnected) this.update(body); }); },
    update(body){
      const o = opportunity(id);
      if (!o){ body.innerHTML = '<p class="foot">This notice is no longer in the last 14 days of SAM.gov.</p>'; return; }
      const ps = persons(o.people.map(p => p.k));
      const amt = o.award && +o.award.amount > 0 ? (+o.award.amount).toLocaleString('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}) : '';
      const lrow = (k, v) => v ? `<div class="lrow"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>` : '';
      body.innerHTML = `<div class="opp-detail">
        <div class="card pad"><p class="eyebrow mono ${o.days != null && o.days <= 7 ? 'needs' : 'accent'}">${esc([o.type, dueText(o)].filter(Boolean).join(' · ').toUpperCase())}</p>
          <h1 class="serif">${esc(o.title)}</h1><p class="muted">${esc(o.agencyName + (o.office ? `, ${o.office}` : ''))}</p>
          ${o.demo ? `<p class="small info">${icon('alert')}A sample notice. The number is made up.</p>` : ''}
          ${o.link ? `<button type="button" class="btn prominent block top12" data-a="url" data-v="${esc(o.link)}">${icon('ext')}Open on SAM.gov</button>` : ''}</div>
        <p class="sec-h">People you know there</p><div class="card list">
          ${ps.length ? ps.map(p => personRow(p)).join('') : `<p class="muted pad">${esc(o.pursuit ? `No one yet. It’s on your pursuit ${o.pursuit}.` : 'No one yet. You watch this agency.')}</p>`}
          ${o.known > ps.length ? `<button type="button" class="row act" data-a="unit">${icon('people')}<span>See all ${fmt(o.known)} at ${esc(o.agency)}</span>${icon('chevR', 'chev')}</button>` : ''}</div>
        <p class="foot">${esc(o.line)}</p>
        <div class="card list actions">
          <button type="button" class="row act" data-a="ways">${icon('waysIn')}<span>Find a way in</span></button>
          ${o.pursuitId ? `<button type="button" class="row act" data-a="pursuit">${icon('target')}<span>${esc(`Pursuit: ${o.pursuit}`)}</span>${icon('chevR', 'chev')}</button>` : `<button type="button" class="row act" data-a="pursue">${icon('target')}<span>Start a pursuit for this</span></button>`}
          ${!o.watched && o.agencyId ? `<button type="button" class="row act accent" data-a="watch">${icon('star')}<span>${esc(`Watch ${o.agency}`)}</span></button>` : ''}</div>
        <p class="sec-h">Details</p><div class="card pad">
          ${lrow('Notice number', o.sol)}${lrow('Posted', Day.nice(o.posted))}${lrow('Responses due', o.due ? Day.nice(o.due) : '')}${lrow('NAICS', o.naics)}${lrow('Set-aside', o.setAside)}
          ${o.award ? lrow('Awarded to', o.award.awardee) + lrow('Amount', amt) : ''}${lrow('Part of', o.area)}
          <p class="muted small top8">${esc(o.path)}</p></div></div>`;
    },
    handlers: {
      open: k => openPerson(k),
      url: v => openURL(v),
      unit(){ const o = opportunity(id); if (o) openUnit(o.agency); },
      ways(){ const o = opportunity(id); if (o) open('intro', o.agency); },
      pursuit(){ const o = opportunity(id); if (o) push('pursuit', o.pursuitId); },
      pursue(){ const o = opportunity(id); if (o){ fx.tap(); openNewPursuit(o.agency); } },
      async watch(_, t){ const o = opportunity(id); if (!o) return; await toggleTarget(o.agency); rematch(true); view.update(t.closest('.page-body')); },
    },
  };
  return view;
});

/* ---------- on an agency's page ---------- */
/** "Open on SAM.gov: N" for a company page, when the name is an agency on the federal map. */
export function samSection(name){
  if (!available()) return '';
  if (!st.notices.length) refreshOpportunities().then(ch => { if (ch) refreshVisible('sam'); });
  const m = tryOr(() => M.api.matchOpportunities(st.notices, Object.assign(filters(), {agency: name, all: true})), null);
  if (!m || !m.items.length) return '';
  return `<p class="sec-h">Open on SAM.gov: ${fmt(m.items.length)}</p><div class="card list">${m.items.slice(0, 5).map(o => oppRow(o)).join('')}
    ${m.items.length > 5 ? `<button type="button" class="row act" data-a="oppAll">${icon('chevR')}<span>All opportunities</span></button>` : ''}</div>`;
}

/* ---------- settings ---------- */
export function openSamSettings(){
  const s = {key: '', status: '', busy: false, dirty: false};
  const render = async body => {
    hasKey = !!(await Secrets.get('sam.key'));
    const p = samPrefs();
    const toggle = (c, l) => `<label class="toggle-row"><span>${esc(l)}</span><input type="checkbox" class="switch" data-ch="type" data-k="${c}" ${p.types.includes(c) ? 'checked' : ''}></label>`;
    body.innerHTML = `<div class="card form">
        <input type="password" class="field" data-in="key" placeholder="${hasKey ? 'Public API key (saved)' : 'Public API key'}" autocapitalize="none" autocomplete="off" spellcheck="false" aria-label="SAM.gov public API key">
        <button type="button" class="btn prominent block" data-a="save" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Checking SAM.gov…' : 'Save and check'}</button></div>
      ${s.status ? `<p class="foot" role="status">${esc(s.status)}</p>` : ''}
      ${hasKey ? `<p class="sec-h">What to look for</p><div class="card form">
          <input type="text" class="field" data-in="naics" value="${esc(p.naics)}" placeholder="NAICS codes (optional), like 541512, 541330" inputmode="numeric" aria-label="NAICS codes">
          <input type="text" class="field" data-in="keywords" value="${esc(p.keywords)}" placeholder="Keywords (optional), like SCADA, control systems" autocapitalize="none" aria-label="Keywords"></div>
        <p class="sec-h">Notice types</p><div class="card list">${TYPES.map(([c, l]) => toggle(c, l)).join('')}</div>
        <div class="card list"><label class="toggle-row"><span>Notify me about new ones<small class="muted">At an agency you watch, or where you know 3 or more people</small></span><input type="checkbox" class="switch" data-ch="notify" ${p.notify ? 'checked' : ''}></label>
          <button type="button" class="row act bad" data-a="forget">${icon('x')}<span>Remove key</span></button></div>
        <p class="foot">Your key and searches go straight from this phone to SAM.gov. Northfix looks at notices posted in the last 14 days, at most every 6 hours, and matches them to the people you know on this phone. Leave NAICS and keywords empty to see everything at agencies you know.</p>`
      : `<div class="card list"><button type="button" class="row act" data-a="getKey">${icon('ext')}<span>Get a free key on SAM.gov</span></button></div>
        <p class="foot">Your key and searches go straight from this phone to SAM.gov. To get a free key, sign in at SAM.gov, open Account Details, and choose Public API Key. You’ll need your password to see it. Copy it, then paste it here. It’s encrypted on this phone and never synced.</p>`}`;
  };
  const setPref = patch => { saveSamPrefs(Object.assign(samPrefs(), patch)); s.dirty = true; };
  openSheet({
    title: 'SAM.gov opportunities', right: ['Done'], full: true,
    mount: body => { render(body); },
    destroy(){ if (s.dirty){ filtersChanged(); refreshOpportunities(true).then(() => refreshVisible('sam')); } },
    handlers: {
      key: v => { s.key = v.trim(); },
      naics: v => setPref({naics: v}),
      keywords: v => setPref({keywords: v}),
      type(v, t){
        const p = samPrefs(), c = t.dataset.k;
        let types = v ? [...new Set(p.types.concat(c))] : p.types.filter(x => x !== c);
        if (!types.length){ types = [c]; t.checked = true; }
        setPref({types: TYPES.map(x => x[0]).filter(x => types.includes(x))}); fx.select();
      },
      notify(v){ saveSamPrefs(Object.assign(samPrefs(), {notify: !!v})); fx.select(); },
      getKey: () => openURL(KEY_PAGE),
      async save(_, t){
        const body = t.closest('.sheet-body');
        if (!s.key) return;
        await Secrets.set('sam.key', s.key); s.key = ''; hasKey = true;
        if (isSample()){ s.status = 'Saved. You’re on the sample network, so Northfix shows sample notices until you import your own.'; render(body); return; }
        s.busy = true; s.status = ''; await render(body);
        await refreshOpportunities(true);
        const m = match();
        s.status = st.error || `Connected. ${fmt((m && m.matched) || 0)} ${m && m.matched === 1 ? 'notice' : 'notices'} at agencies you know or watch.`;
        if (!st.error) fx.success();
        s.busy = false; render(body); refreshVisible('sam');
      },
      async forget(_, t){ await Secrets.set('sam.key', ''); hasKey = false; clearAll(); s.status = 'Removed.'; s.dirty = false; render(t.closest('.sheet-body')); refreshVisible('sam'); },
    },
  });
}
register('samSettings', openSamSettings);
register('opportunities', () => push('opportunities'));
register('opportunity', id => push('opportunity', id));
