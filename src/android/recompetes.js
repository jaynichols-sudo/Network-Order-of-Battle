// Recompetes and teaming partners from USASpending.gov (the iPhone's Recompetes screen). The
// phone asks USASpending's public award search, with no key, for contracts at the agencies on
// your watchlist and open pursuits, at most once a day. Only the agency name is sent. The engine
// (src/awards.js) reads the answers and says who you know at the agency and at the incumbent.
import { CapacitorHttp } from '@capacitor/core';
import { M, isSample, persons, pursueAward, toggleTarget, show } from './model.js';
import { esc, fmt, icon, stack, empty, segmented, flag, Day } from './ui.js';
import { registerRoute, openSheet, closeSheet, push, refreshVisible } from './nav.js';
import { openPerson, openUnit, register } from './actions.js';
import { personRow } from './people.js';
import { NATIVE, ls, openURL, fx } from './platform.js';

const FRESH = 24 * 3600e3;
const FETCH_MONTHS = 24;
export const PRIVACY = 'Contract data from USASpending.gov. Only the agency name is sent.';
const CACHE = 'bearings.awards.cache', MONTHS = 'bearings.awards.months', TAB = 'bearings.awards.tab';

/* ---------- saved state ---------- */
const st = {pages: [], at: +ls.get(CACHE + '.at') || 0, sig: '', busy: null, error: '', cacheLoaded: false, demo: false};
const tryOr = (fn, fb) => { try { return fn(); } catch (e) { console.error(e); return fb; } };
function loadCache(){
  if (st.cacheLoaded) return;
  st.cacheLoaded = true;
  const c = ls.json(CACHE, null);
  if (c && Array.isArray(c.pages)){ st.pages = c.pages; st.sig = c.sig || ''; }
}
function saveCache(){ try { ls.set(CACHE, JSON.stringify({pages: st.pages, sig: st.sig})); ls.set(CACHE + '.at', String(st.at)); } catch { /* full storage: keep it in memory */ } }
/** Which agencies the requests are for, so a new watchlist entry or pursuit asks again. */
const sigOf = reqs => reqs.map(r => r.agencyId).join(',');

/* ---------- fetching ---------- */
async function postJSON(url, body){
  if (NATIVE){
    try {
      const r = await CapacitorHttp.post({url, headers: {'Content-Type': 'application/json', Accept: 'application/json'}, data: body, responseType: 'text', connectTimeout: 20000, readTimeout: 40000});
      return {status: r.status, text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {})};
    } catch { /* fall through to fetch */ }
  }
  const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body)});
  return {status: r.status, text: await r.text()};
}
/** Fetches at most once a day (or when forced or the agencies changed). Never throws. Resolves true when something changed. */
export function refreshAwards(force = false){
  if (isSample()){
    const first = !st.demo;
    if (first){ st.pages = tryOr(() => M.api.demoAwardPages(), []); st.demo = true; st.error = ''; }
    return Promise.resolve(first);
  }
  // just left the sample network: drop its demo awards
  if (st.demo){ st.pages = []; st.demo = false; st.cacheLoaded = false; }
  if (st.busy) return st.busy;
  st.busy = (async () => {
    loadCache();
    const reqs = tryOr(() => M.api.awardRequests([], FETCH_MONTHS), []);
    if (!reqs.length){ const had = st.pages.length > 0; st.pages = []; st.sig = ''; return had; }
    const sig = sigOf(reqs);
    if (!force && sig === st.sig && Date.now() - st.at < FRESH) return false;
    const got = []; let err = '', answered = false;
    for (const r of reqs){
      try {
        const res = await postJSON(r.url, r.body);
        const page = M.api.awardPage(res.text);
        if (page.error){ err = page.error; if (page.code === 'rate') break; continue; }
        if (res.status >= 400){ err = `USASpending.gov didn’t answer (error ${res.status}). Northfix will try again later.`; continue; }
        got.push({agencyId: r.agencyId, items: page.items}); answered = true;
      } catch { err = 'Couldn’t reach USASpending.gov. Check your connection and try again.'; }
    }
    st.at = Date.now(); ls.set(CACHE + '.at', String(st.at));
    st.error = answered ? '' : err;
    if (!answered) return true;
    st.pages = got; st.sig = sig; saveCache();
    return true;
  })().catch(e => { console.error(e); return false; }).finally(() => { st.busy = null; });
  return st.busy;
}
const months = () => [12, 18, 24].includes(+ls.get(MONTHS)) ? +ls.get(MONTHS) : 24;
export const recompeteList = (m = months()) => tryOr(() => M.api.recompetes(st.pages, {months: m}), null);
export const partnerList = () => tryOr(() => M.api.teamingPartners(st.pages, {}), null);
const recompete = id => { const r = recompeteList(36); return r ? r.items.find(x => x.id === id) || null : null; };

/* ---------- pieces ---------- */
const endText = x => `Ends ${Day.nice(x.end)}${x.days != null ? ` · in ${x.days} days` : ''}`;
function recRow(x){
  const ps = persons(x.people.map(p => p.k).concat(x.incumbentPeople.map(p => p.k)));
  return `<button type="button" class="row opp-row" data-a="rec" data-v="${esc(x.id)}">
    <span class="hl-main"><span class="eyebrow mono ${x.days <= 180 ? 'needs' : 'accent'}">${esc([x.agency, x.amountText].join(' · ').toUpperCase())}${x.watched ? ` ${icon('starFill', 'opp-star')}` : ''}</span>
      <b class="serif">${esc(x.title)}</b>
      <span class="muted small">${esc(`Incumbent: ${x.incumbent || 'Not listed'} · ${endText(x)}`)}</span>
      <span class="opp-who">${ps.length ? stack(ps, 22) : ''}<span class="muted small">${esc(x.line)}</span></span>
      ${x.tracked ? `<span class="small strong info">${icon('target')}Tracked as a pursuit</span>` : x.pursuit ? `<span class="small strong info">${icon('target')}${esc(x.pursuit)}</span>` : ''}</span>${icon('chevR', 'chev')}</button>`;
}
function partnerRow(x, i){
  const ps = persons(x.people.map(p => p.k));
  const bits = [`${fmt(x.awards)} ${x.awards === 1 ? 'award' : 'awards'}`, x.amountText, x.agencies.join(', '), x.ending ? `${fmt(x.ending)} ending this year` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="row opp-row" data-a="partner" data-v="${i}">
    <span class="hl-main"><b>${esc(x.name)}${x.watched ? ` ${icon('starFill', 'opp-star')}` : ''}</b><span class="muted small">${esc(bits)}</span>
      <span class="opp-who">${ps.length ? stack(ps, 22) : ''}<span class="small ${x.known ? 'good strong' : 'muted'}">${esc(x.line)}</span></span></span>${icon('chevR', 'chev')}</button>`;
}

/* ---------- the screen ---------- */
registerRoute('recompetes', () => {
  let tab = ls.get(TAB) === 'partners' ? 'partners' : 'recompetes';
  const view = {
    title: 'Recompetes',
    mount(body){ this.update(body); refreshAwards().then(ch => { if (ch && body.isConnected) this.update(body); }); },
    update(body){
      const last = st.at && !isSample() ? ` Last checked ${Day.ago(new Date(st.at).toLocaleDateString('en-CA'))}.` : '';
      const busy = !!st.busy && !st.pages.length;
      let main = '';
      if (busy) main = '<p class="foot">Checking USASpending.gov…</p>';
      else if (tab === 'recompetes'){
        const m = months(), r = recompeteList(m);
        main = `<div class="seg-wrap">${segmented('months', [['12', '12 months'], ['18', '18 months'], ['24', '24 months']], String(m))}</div>
          <div class="card pad opp-head top12"><p class="eyebrow mono muted">${esc(`ENDING IN THE NEXT ${m} MONTHS`)}</p>
            <p><b class="serif big">${fmt(r ? r.total : 0)}</b> <span class="muted">${r && r.total === 1 ? 'contract' : 'contracts'} at the agencies you work${r && r.value ? `, ${esc(r.valueText)} in all` : ''}</span></p>
            ${st.error ? `<p class="small bad">${esc(st.error)}</p>` : ''}</div>
          ${r && r.items.length ? `<div class="card list">${r.items.map(recRow).join('')}</div>` : `<p class="foot">${st.pages.length ? 'Nothing ending in this window. Try a longer one.' : 'No contract data yet. Add agencies to your watchlist or a pursuit, then use Check now.'}</p>`}`;
      } else {
        const r = partnerList();
        main = `<div class="card pad opp-head"><p class="eyebrow mono muted">WHO WINS WORK WHERE YOU DO</p>
            <p><b class="serif big">${fmt(r ? r.total : 0)}</b> <span class="muted">${r && r.total === 1 ? 'company' : 'companies'} holding contracts at the agencies you work</span></p>
            ${st.error ? `<p class="small bad">${esc(st.error)}</p>` : ''}</div>
          ${r && r.items.length ? `<div class="card list">${r.items.map(partnerRow).join('')}</div>` : '<p class="foot">No contract data yet. Use Check now.</p>'}`;
      }
      body.innerHTML = `<div class="seg-wrap">${segmented('tab', [['recompetes', 'Recompetes'], ['partners', 'Teaming partners']], tab)}</div>
        ${main}
        <p class="foot">${esc(isSample() ? 'These are sample contracts with made-up numbers, matched to the sample network. Import your own network to see real ones.' : `Northfix asks USASpending.gov at most once a day, straight from this phone, about the agencies on your watchlist and open pursuits.${last}`)}</p>
        <p class="lock-note">${icon('lock')}${esc(PRIVACY)}</p>
        ${isSample() ? '' : `<div class="btn-row left"><button type="button" class="btn small" data-a="check" ${st.busy ? 'disabled' : ''}>${icon('refresh')}Check now</button></div>`}`;
    },
    handlers: {
      tab(v, t){ fx.select(); tab = v; ls.set(TAB, v); view.update(t.closest('.page-body')); },
      months(v, t){ fx.select(); ls.set(MONTHS, v); view.update(t.closest('.page-body')); },
      rec: id => { fx.tap(); push('recompete', id); },
      partner(i){ const r = partnerList(), x = r && r.items[+i]; if (x){ fx.tap(); openPartner(x); } },
      open: k => openPerson(k),
      async check(_, t){ const body = t.closest('.page-body'); t.disabled = true; const p = refreshAwards(true); view.update(body); await p; if (body.isConnected) view.update(body); },
    },
  };
  return view;
});

/* ---------- one recompete ---------- */
registerRoute('recompete', id => {
  const view = {
    title: 'Recompete',
    mount(body){ this.update(body); if (!recompete(id)) refreshAwards().then(() => { if (body.isConnected) this.update(body); }); },
    update(body){
      const x = recompete(id);
      if (!x){ body.innerHTML = '<p class="foot">This contract is no longer in the next three years of USASpending.gov data.</p>'; return; }
      const ps = persons(x.people.map(p => p.k)), inc = persons(x.incumbentPeople.map(p => p.k));
      const lrow = (k, v) => v ? `<div class="lrow"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>` : '';
      body.innerHTML = `<div class="opp-detail">
        <div class="card pad"><p class="eyebrow mono ${x.days <= 180 ? 'needs' : 'accent'}">${esc(`${x.agency} · ${endText(x)}`.toUpperCase())}</p>
          <h1 class="serif">${esc(x.title)}</h1><p class="muted">${esc(x.agencyName + (x.office ? `, ${x.office}` : ''))}</p>
          ${x.demo ? `<p class="small info">${icon('alert')}A sample contract. The numbers are made up.</p>` : ''}
          ${x.link ? `<button type="button" class="btn block top12" data-a="url" data-v="${esc(x.link)}">${icon('ext')}Open on USASpending.gov</button>` : ''}</div>
        <div class="card list actions">
          <button type="button" class="row act accent" data-a="track">${icon('target')}<span>${x.tracked ? 'Open the pursuit' : 'Track as a pursuit'}</span>${icon('chevR', 'chev')}</button>
          ${x.pursuitId && !x.tracked ? `<button type="button" class="row act" data-a="pursuit">${icon('target')}<span>${esc(`Your pursuit at ${x.agency}: ${x.pursuit}`)}</span>${icon('chevR', 'chev')}</button>` : ''}</div>
        <p class="sec-h">${esc(`People you know at ${x.agency}`)}</p><div class="card list">
          ${ps.length ? ps.map(p => personRow(p)).join('') : `<p class="muted pad">${esc(`No one at ${x.agency} yet.`)}</p>`}
          ${x.known > ps.length ? `<button type="button" class="row act" data-a="unit" data-v="${esc(x.agency)}">${icon('people')}<span>${esc(`See all ${fmt(x.known)} at ${x.agency}`)}</span>${icon('chevR', 'chev')}</button>` : ''}</div>
        ${x.incumbent ? `<p class="sec-h">${esc(`People you know at ${x.incumbent}`)}</p><div class="card list">
          ${inc.length ? inc.map(p => personRow(p)).join('') : `<p class="muted pad">${esc(`No one at ${x.incumbent} yet.`)}</p>`}
          ${x.incumbentKnown > inc.length ? `<button type="button" class="row act" data-a="unit" data-v="${esc(x.incumbent)}">${icon('people')}<span>${esc(`See all ${fmt(x.incumbentKnown)} at ${x.incumbent}`)}</span>${icon('chevR', 'chev')}</button>` : ''}</div>` : ''}
        <p class="foot">${esc(x.line)}</p>
        <p class="sec-h">Details</p><div class="card pad">
          ${lrow('Incumbent', x.incumbent)}${lrow('Value', x.amountText)}${lrow('Started', x.start ? Day.nice(x.start) : '')}${lrow('Ends', x.end ? Day.nice(x.end) : '')}${lrow('Award number', x.piid)}${lrow('NAICS', x.naics)}</div>
        <p class="lock-note">${icon('lock')}${esc(PRIVACY)}</p></div>`;
    },
    handlers: {
      open: k => openPerson(k),
      url: v => openURL(v),
      unit: v => openUnit(v),
      pursuit(){ const x = recompete(id); if (x && x.pursuitId) push('pursuit', x.pursuitId); },
      async track(){
        const x = recompete(id); if (!x) return;
        const was = x.tracked;
        const pid = await pursueAward(x);
        if (!pid) return;
        if (!was){ fx.success(); show(isSample() ? 'Tracking it. Sample data: pursuits aren’t saved.' : 'Tracking it as a pursuit'); }
        push('pursuit', pid);
      },
    },
  };
  return view;
});

/* ---------- one teaming partner ---------- */
function openPartner(x){
  const ps = persons(x.people.map(p => p.k));
  openSheet({
    title: x.name, left: ['Close'], full: true,
    mount(body){
      body.innerHTML = `<div class="card pad"><p class="eyebrow mono muted">${esc(`${fmt(x.awards)} ${x.awards === 1 ? 'AWARD' : 'AWARDS'} · ${x.amountText}`)}</p>
          <p class="muted">${esc(`Holds work at ${x.agencies.join(', ')}.${x.ending ? ` ${fmt(x.ending)} ${x.ending === 1 ? 'contract ends' : 'contracts end'} in the next year.` : ''}`)}</p></div>
        <p class="sec-h">${esc(`People you know at ${x.name}`)}</p><div class="card list">
          ${ps.length ? ps.map(p => personRow(p)).join('') : `<p class="muted pad">${esc(`No one at ${x.name} yet.`)}</p>`}
          ${x.known > ps.length ? `<button type="button" class="row act" data-a="unit">${icon('people')}<span>${esc(`See all ${fmt(x.known)}`)}</span>${icon('chevR', 'chev')}</button>` : ''}</div>
        ${x.team.length ? `<p class="sec-h">Through your team</p><div class="card list">${x.team.map(t => `<div class="row static"><span class="grow"><b>${esc(t.name)}</b><span class="muted small">${esc([t.p, `${t.owner} knows them`].filter(Boolean).join(' · '))}</span></span></div>`).join('')}</div>` : ''}
        <div class="card list actions top12">
          ${x.known ? `<button type="button" class="row act" data-a="unit">${icon('building')}<span>${esc(`Open ${x.name}`)}</span>${icon('chevR', 'chev')}</button>` : ''}
          ${x.watched ? `<div class="row static act">${flag('On your watchlist', 'var(--amber)')}</div>` : `<button type="button" class="row act accent" data-a="watch">${icon('star')}<span>${esc(`Watch ${x.name}`)}</span></button>`}</div>
        <p class="lock-note">${icon('lock')}${esc(PRIVACY)}</p>`;
    },
    handlers: {
      open(k){ closeSheet(); openPerson(k); },
      unit(){ closeSheet(); openUnit(x.name); },
      async watch(_, t){ await toggleTarget(x.name); x.watched = true; t.outerHTML = `<div class="row static act">${flag('On your watchlist', 'var(--amber)')}</div>`; refreshVisible('targets'); },
    },
  });
}

register('recompetes', () => push('recompetes'));
register('recompete', id => push('recompete', id));
