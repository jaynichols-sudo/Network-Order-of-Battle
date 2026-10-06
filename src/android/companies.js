// Companies: your watchlist with coverage rings, industries, everyone by company,
// a company page, an industry page, and "Ways in" (who can get you into a company).
// Ports CompaniesView.swift, IndustriesView.swift and IntroFinder.swift.
import { M, persons, person, isTarget, toggleTarget, setTargetNote, setCompanyIndustry, setCompanyLink, setCompanyLocation, show } from './model.js';
import { esc, fmt, icon, ring, animateRings, mixBar, segmented, empty, menu, Day, $, plural } from './ui.js';
import { registerRoute, openSheet, closeSheet, setPageTitle } from './nav.js';
import { openPerson, openUnit, openIndustry, showPeople, register, open } from './actions.js';
import { personRow } from './people.js';
import { openURL, fx, prefs, ls } from './platform.js';
import { openMessage } from './sheets.js';

let mode = ls.get('bearings.companies') || 'watchlist';
let gov = false, shownUnc = 25;
register('companiesMode', m => { mode = m; ls.set('bearings.companies', m); });

const industryOptions = () => (M.constants.industries || []).filter(i => i.id !== M.constants.unclassified);
function knowLine(t){ let s = `You know ${fmt(t.count)}`; if (t.stars > 0) s += `, ${t.stars} starred`; if (t.news > 0) s += `, ${t.news} new or moved`; return s; }

function watchlist(){
  if (!M.targets.length) return empty('scope', 'No watchlist yet', 'Pick the companies you’re working. Bearings shows where you don’t know anyone senior yet.', '<button type="button" class="btn prominent" data-a="add">Add a company</button>');
  return `<div class="card list">${M.targets.map(t => `<button type="button" class="row trow" data-a="unit" data-v="${esc(t.name)}">${ring(t.score, 50)}<span class="trow-main"><b>${esc(t.name)}</b><span class="muted">${esc(knowLine(t))}</span><span class="small ${t.gaps.length ? 'bad' : 'good'}">${esc(t.gap)}</span></span>${icon('chevR', 'chev')}</button>`).join('')}
    <button type="button" class="row act accent" data-a="add">${icon('plusCircle')}<span>${M.info.lens ? 'Add a company, agency or command' : 'Add a company'}</span></button></div>
    <p class="foot">Coverage shows whether you know someone at each level: executive, director, manager and staff.</p>`;
}
function treemap(tiles){
  // labels only where they fit, like the iPhone: the full name on big tiles, the short one on smaller
  const W = Math.min(innerWidth, 760) - 48, H = 240;
  return `<div class="treemap">${tiles.map(t => { const w = W * t.w / 100, h = H * t.h / 100;
    const label = w > 46 && h > 30 ? `<span class="tile-in"><b>${esc(w > 120 && h > 50 ? t.id : t.short)}</b>${h > 46 ? `<span class="mono">${fmt(t.n)}</span>` : ''}</span>` : '';
    return `<button type="button" class="tile" data-a="industry" data-v="${esc(t.id)}" style="left:${t.x}%;top:${t.y}%;width:calc(${t.w}% - 2px);height:calc(${t.h}% - 2px);--tc:${esc(t.color)}" aria-label="${esc(t.id)}, ${t.n}">${label}</button>`; }).join('')}</div>`;
}
const pickerRow = (company, count, current) => `<button type="button" class="row pick" data-a="pickInd" data-v="${esc(company)}" data-cur="${esc(current)}"><span class="pick-main"><span>${esc(company)}</span><span class="muted small">${esc(current ? `${current}, ${plural(count, 'person', 'people')}` : plural(count, 'person', 'people'))}</span></span><span class="accent strong">${current ? 'Change' : 'Pick'}</span></button>`;
function industries(){
  const d = M.api.industries({gov});
  const stat = (v, l) => `<div class="stat"><b class="mono">${esc(v)}</b><span class="muted small">${esc(l)}</span></div>`;
  return `<div class="card stats3">${stat(fmt(d.summary.industries), 'industries')}${stat(fmt(d.summary.outside), 'outside government')}${stat(d.summary.classifiedPct + '%', 'sorted')}</div>
    <div class="sec-h row-between"><span>${gov ? 'Whole network by industry' : 'Private sector by industry'}</span>${d.govCount > 0 ? `<button type="button" class="link small" data-a="gov">${gov ? 'Hide government' : `Show government (${fmt(d.govCount)})`}</button>` : ''}</div>
    <div class="card pad-s">${treemap(d.tiles)}</div>
    <p class="sec-h">Every industry</p>
    <div class="card list">${d.list.map(r => `<button type="button" class="row irow" data-a="industry" data-v="${esc(r.id)}"><span class="irow-main"><span class="irow-top"><i class="dot" style="background:${esc(r.color)}"></i><b>${esc(r.id)}</b><span class="mono">${fmt(r.count)}</span><span class="mono muted small pct">${r.pct}%</span></span>
      <span class="muted small one">${esc(`${plural(r.companies, 'company', 'companies')}${r.top.length ? ': ' + r.top.join(', ') : ''}`)}</span>${mixBar(r.mix)}</span>${icon('chevR', 'chev')}</button>`).join('')}</div>
    ${d.unclassified.length ? `<p class="sec-h">Needs an industry</p><div class="card list">${d.unclassified.slice(0, shownUnc).map(([c, n]) => pickerRow(c, n, '')).join('')}${d.unclassified.length > shownUnc ? `<button type="button" class="row act accent" data-a="moreUnc"><span>Show ${Math.min(25, d.unclassified.length - shownUnc)} more</span></button>` : ''}</div>
      <p class="foot">${fmt(d.unclassifiedTotal)} companies. Tag a company once and everyone there, now and in future imports, follows.${d.tagged > 0 ? ` ${fmt(d.tagged)} tagged by you so far.` : ''}</p>` : ''}
    ${d.guesses.length ? `<p class="sec-h">Best guesses to check</p><div class="card list">${d.guesses.slice(0, 20).map(([c, n, ind]) => pickerRow(c, n, ind)).join('')}</div><p class="foot">We guessed these from the company name. Fix any that are wrong.</p>` : ''}`;
}
function allCompanies(){
  const o = M.api.orgs({text: '', filters: {}});
  const bars = items => { const max = Math.max(1, (items[0] || [0, 1])[1]); return `<div class="card list">${items.map(([n, c, col]) => `<button type="button" class="row brow" data-a="unit" data-v="${esc(n)}"><span class="brow-main"><span class="brow-top"><span class="one">${esc(n)}</span><span class="mono muted">${fmt(c)}</span></span><span class="bar"><i style="width:${Math.max(2, c / max * 100)}%;background:${esc(col || '#8F89A8')}"></i></span></span>${icon('chevR', 'chev')}</button>`).join('')}</div>`; };
  return `<p class="sec-h">Companies</p>${bars(o.companies)}${o.agencies.length ? `<p class="sec-h">Agencies and commands</p>${bars(o.agencies)}` : ''}`;
}

export const CompaniesView = {
  mount(el){
    el.innerHTML = `<div class="scr"><header class="scr-head"><h1>Companies</h1><div class="tools"><button type="button" class="pill-btn soft" data-a="ways">${icon('waysIn')}Ways in</button></div></header><div class="seg-wrap"></div><div class="co-body"></div></div>`;
    this.update(el);
  },
  update(el){
    $('.seg-wrap', el).innerHTML = segmented('mode', [['watchlist', 'Watchlist'], ['industries', 'Industries'], ['all', 'All']], mode);
    $('.co-body', el).innerHTML = mode === 'watchlist' ? watchlist() : mode === 'industries' ? industries() : allCompanies();
    animateRings(el);
  },
  handlers: {
    mode(v, t){ fx.select(); mode = v; ls.set('bearings.companies', v); CompaniesView.update(t.closest('.screen')); },
    unit: v => openUnit(v),
    industry: v => openIndustry(v),
    add: () => openAddTarget(),
    ways: () => openIntro(''),
    gov(_, t){ gov = !gov; CompaniesView.update(t.closest('.screen')); },
    moreUnc(_, t){ shownUnc += 25; CompaniesView.update(t.closest('.screen')); },
    pickInd: (company, t) => pickIndustry(t, company, t.dataset.cur),
  },
};
export function pickIndustry(anchor, company, current){
  menu(anchor, industryOptions().map(i => ({label: i.id, on: i.id === current, run: async () => { await setCompanyIndustry(company, i.id); show(`${company}: ${i.id}`); }})));
}

/* ---------- add to the watchlist ---------- */
export function openAddTarget(){
  let q = '';
  const render = body => {
    const items = M.api.addTargetCandidates(q), trimmed = q.trim();
    const list = $('.add-list', body);
    list.innerHTML = `${trimmed && !items.some(([n]) => n.toLowerCase() === trimmed.toLowerCase()) && !isTarget(trimmed) ? `<div class="card list"><button type="button" class="row act accent" data-a="addName" data-v="${esc(trimmed)}">${icon('plus')}<span>Add “${esc(trimmed)}”</span></button></div>` : ''}
      <p class="sec-h">${q ? 'Matches' : 'Where you know the most people'}</p>
      <div class="card list">${items.map(([n, c]) => `<button type="button" class="row" data-a="addName" data-v="${esc(n)}"><span class="grow">${esc(n)}</span><span class="mono muted">${fmt(c)}</span><span class="accent">${icon('plusCircle')}</span></button>`).join('') || '<p class="muted pad">No matches</p>'}</div>`;
  };
  openSheet({
    title: 'Add to your watchlist', left: ['Done'], full: true,
    mount(body){ body.innerHTML = `<label class="searchbox">${icon('search')}<input type="search" data-in="q" placeholder="Search, or type a new name" autocomplete="off"></label><div class="add-list"></div>`; render(body); },
    handlers: {
      q(v, t){ q = v; render(t.closest('.sheet-body')); },
      async addName(name, t){ const body = t.closest('.sheet-body'); await toggleTarget(name); render(body); },
    },
  });
}
register('addTarget', openAddTarget);

/* ---------- a company page ---------- */
registerRoute('unit', name => {
  const st = {editLink: false, link: '', editPlace: false, place: '', note: null};
  const view = {
    title: name,
    mount(body){ this.render(body); },
    update(body){ this.render(body); },
    render(body){
      const u = M.api.unit(name);
      if (st.note == null) st.note = u.note || '';
      const sc = body.scrollTop;
      const rung = r => { const ps = persons(r.keys); return `<p class="sec-h row-between"><span>${esc(r.label)}</span><span class="mono">${r.keys.length}</span></p><div class="card list">${ps.length ? ps.slice(0, 40).map(p => personRow(p)).join('') : '<p class="muted pad">Nobody yet</p>'}${ps.length > 40 ? `<p class="muted pad">and ${ps.length - 40} more</p>` : ''}</div>`; };
      const alumni = (u.alumni || []).slice(0, 25).map(a => { const p = person(a.k); return p ? personRow(p, {sub: `Was ${a.was || 'here'}, until ${Day.nice(a.until)}`}) : ''; }).join('');
      body.innerHTML = `<div class="unit">
        <div class="unit-head">${ring(u.score, 72)}<div><h1>${esc(u.name)}</h1><p class="muted">${esc(`You know ${plural(u.count, 'person', 'people')} here. Coverage ${u.score}%.`)}</p></div></div>
        <div class="card list actions">
          <button type="button" class="row act ${u.isTarget ? '' : 'accent'}" data-a="target">${icon(u.isTarget ? 'minusCircle' : 'plusCircle')}<span>${u.isTarget ? 'Remove from watchlist' : 'Add to watchlist'}</span></button>
          <button type="button" class="row act" data-a="inPeople">${icon('people')}<span>Show in People</span></button>
          <button type="button" class="row act" data-a="ways">${icon('waysIn')}<span>Find a way in</span></button>
          ${u.isCompany ? `<button type="button" class="row act" data-a="ind">${icon('tag')}<span class="grow">Industry</span><span class="muted">${esc(u.industry.set || `Automatic: ${u.industry.auto}`)}</span></button>` : ''}
        </div>
        <p class="sec-h">On LinkedIn</p><div class="card list actions">
          <button type="button" class="row act" data-a="url" data-v="${esc(u.links.company)}">${icon('ext')}<span>${u.links.companyExact ? 'Company page' : 'Find company page'}</span></button>
          <button type="button" class="row act" data-a="url" data-v="${esc(u.links.peopleAt)}">${icon('ext')}<span>Your connections there</span></button>
          ${prefs.salesnav ? `<button type="button" class="row act" data-a="url" data-v="${esc(u.links.salesNav)}">${icon('globe')}<span>Sales Navigator</span></button>` : ''}
          ${st.editLink ? `<div class="pad"><input type="url" class="field" data-in="link" data-enter="saveLink" value="${esc(st.link)}" placeholder="https://www.linkedin.com/company/…" autocapitalize="none"><div class="btn-row left"><button type="button" class="btn prominent small" data-a="saveLink">Save</button><button type="button" class="btn small" data-a="cancelLink">Cancel</button></div></div>`
            : `<button type="button" class="row act accent" data-a="editLink"><span>${u.links.companyExact ? 'Change page link' : 'Save the exact page'}</span></button>`}
        </div>
        <p class="sec-h">Location</p><div class="card pad">${st.editPlace ? `<input type="text" class="field" data-in="place" data-enter="savePlace" value="${esc(st.place)}" placeholder="City, like Jacksonville, FL or Stuttgart"><div class="btn-row left"><button type="button" class="btn prominent small" data-a="savePlace">Save</button><button type="button" class="btn small" data-a="cancelPlace">Cancel</button></div>`
          : u.location ? `<div class="lrow"><span class="muted">Everyone here</span><span>${esc(u.location.name)}</span></div><div class="btn-row left"><button type="button" class="link" data-a="editPlace">Change location</button><button type="button" class="link danger" data-a="clearPlace">Clear location</button></div>`
          : `<button type="button" class="link" data-a="editPlace">${icon('mappin')}Set a location for everyone here</button>`}</div>
        <p class="foot">Handy for a command, base or office where everyone works in one place. It shows them on the Map. A location you set on a person still wins.</p>
        <div class="card pad gaps">${u.gaps.length ? u.gaps.map(g => `<p class="bad">${icon('alert')}${esc(g)}</p>`).join('') : `<p class="good">${icon('checkCircle')}Covered at every level</p>`}</div>
        ${u.rungs.map(rung).join('')}
        ${alumni ? `<p class="sec-h">Used to work here</p><div class="card list">${alumni}</div><p class="foot">People who were here at an earlier refresh and have since moved on. Often the best way in.</p>` : ''}
        ${u.isTarget ? `<p class="sec-h">Notes</p><div class="card"><textarea class="field" rows="4" data-in="note" placeholder="What you’re working on here, who to meet next">${esc(st.note)}</textarea></div>` : ''}
      </div>`;
      body.scrollTop = sc;
      animateRings(body);
    },
    handlers: {
      open: k => openPerson(k),
      url: v => openURL(v),
      async target(_, t){ await toggleTarget(name); view.render(t.closest('.page-body')); },
      inPeople(){ const u = M.api.unit(name); showPeople(M.info.lens && !u.isCompany ? {agency: name} : {company: name}); },
      ways: () => openIntro(name),
      ind(_, t){ const u = M.api.unit(name); menu(t, [{label: `Automatic: ${u.industry.auto}`, on: !u.industry.set, run: () => setCompanyIndustry(name, '')}, ...industryOptions().map(i => ({label: i.id, on: i.id === u.industry.set, run: () => setCompanyIndustry(name, i.id)}))]); },
      editLink(_, t){ const u = M.api.unit(name); st.editLink = true; st.link = u.links.companyExact ? u.links.company : ''; view.render(t.closest('.page-body')); },
      cancelLink(_, t){ st.editLink = false; view.render(t.closest('.page-body')); },
      link: v => { st.link = v; },
      async saveLink(_, t){ const b = t.closest('.page-body'); if (await setCompanyLink(name, st.link)){ st.editLink = false; view.render(b); } },
      editPlace(_, t){ const u = M.api.unit(name); st.editPlace = true; st.place = u.location ? u.location.name : ''; view.render(t.closest('.page-body')); },
      cancelPlace(_, t){ st.editPlace = false; view.render(t.closest('.page-body')); },
      place: v => { st.place = v; },
      async savePlace(_, t){ const b = t.closest('.page-body'); if (await setCompanyLocation(name, st.place)){ st.editPlace = false; view.render(b); } },
      clearPlace: () => setCompanyLocation(name, ''),
      note(v){ st.note = v; clearTimeout(st.nt); st.nt = setTimeout(() => setTargetNote(name, v), 600); },
    },
  };
  return view;
});

/* ---------- an industry page ---------- */
registerRoute('industry', id => ({
  title: 'Industry',
  mount(body){ this.update(body); },
  update(body){
    const d = M.api.industry(id);
    this.title = d.short; const pg = body.closest('.page'); if (pg) setPageTitle(pg, d.short);
    let s = `${plural(d.count, 'person', 'people')} at ${plural(d.companies, 'company', 'companies')}`;
    if (d.vets > 0) s += `, ${fmt(d.vets)} veterans`; if (d.stars > 0) s += `, ${fmt(d.stars)} starred`;
    const senior = persons(d.senior);
    body.innerHTML = `<div class="unit"><div class="unit-head"><i class="dot xl" style="background:${esc(d.color)}"></i><div><h1>${esc(d.id)}</h1><p class="muted">${esc(s)}</p></div></div>
      <div class="card list actions"><button type="button" class="row act" data-a="inPeople">${icon('people')}<span>Show in People</span></button></div>
      <p class="sec-h">Seniority</p><div class="card stats4">${[[1, 'Exec'], [2, 'Director'], [3, 'Manager'], [4, 'Staff']].map(([i, l]) => `<div class="stat"><b class="mono">${fmt(d.mix[i] || 0)}</b><span class="muted small">${l}</span></div>`).join('')}</div>
      ${senior.length ? `<p class="sec-h">Most senior</p><div class="card list">${senior.map(p => personRow(p)).join('')}</div>` : ''}
      ${d.top.length ? `<p class="sec-h">Top companies</p><div class="card list">${d.top.map(([n, c]) => `<button type="button" class="row" data-a="unit" data-v="${esc(n)}"><span class="grow">${esc(n)}</span><span class="mono muted">${fmt(c)}</span>${icon('chevR', 'chev')}</button>`).join('')}</div>` : ''}
      ${d.funcs.length ? `<p class="sec-h">What they do</p><div class="card list">${d.funcs.map(([n, c]) => `<div class="row static"><span class="grow">${esc(n)}</span><span class="mono muted">${fmt(c)}</span></div>`).join('')}</div>` : ''}</div>`;
  },
  handlers: {open: k => openPerson(k), unit: v => openUnit(v), inPeople: () => showPeople({ind: [id]})},
}));

/* ---------- ways in ---------- */
export function openIntro(initial = ''){
  let q = initial, t0 = 0;
  const results = body => {
    const out = $('.intro-out', body);
    if (q.trim().length < 2){
      out.innerHTML = `<p class="muted pad">Type a company, agency or command. Bearings finds who works there now, who used to, and who you’re close to nearby in the same field.</p>`;
      return;
    }
    const p = M.api.introPaths(q);
    const sugg = M.api.addTargetCandidates(q).slice(0, 6).filter(([n]) => n !== p.company);
    if (!p.now.length && !p.alumni.length && !p.sector.length){
      out.innerHTML = empty('waysIn', 'No paths yet', `No one in your network works or worked at “${q}”. Try a shorter name.`) + suggestions(sugg);
      return;
    }
    const parts = []; if (p.now.length) parts.push(`${p.now.length} there now`); if (p.alumni.length) parts.push(`${p.alumni.length} used to be`); if (p.sector.length) parts.push(`${p.sector.length} close in the same field`);
    const section = (title, keys) => { const ps = persons(keys); return ps.length ? `<p class="sec-h">${esc(title)} (${ps.length})</p><div class="card list">${ps.map(x => personRow(x)).join('')}</div>` : ''; };
    out.innerHTML = `<div class="intro-head"><h2>${esc(p.company)}</h2><p class="muted">${esc(parts.join(', '))}</p></div>
      ${p.best.length ? `<p class="sec-h">Best ways in</p><div class="card list">${p.best.map(b => { const x = person(b.k); return x ? `<div class="best">${personRow(x)}<p class="muted why">${esc(b.why)}</p><button type="button" class="btn small" data-a="ask" data-v="${esc(b.k)}">${icon('pencil')}Ask for an intro</button></div>` : ''; }).join('')}</div>` : ''}
      ${section('Work there now', p.now)}
      ${p.alumni.length ? `<p class="sec-h">Used to work there (${p.alumni.length})</p><div class="card list">${p.alumni.map(a => { const x = person(a.k); return x ? personRow(x, {sub: a.was || a.until ? `Was ${a.was || 'there'}${a.until ? `, until ${Day.nice(a.until)}` : ''}` : ''}) : ''; }).join('')}</div>` : ''}
      ${section(p.ind ? `Close to you in ${p.ind}` : 'Close to you nearby', p.sector)}
      ${suggestions(sugg)}`;
    out.__company = p.company;
  };
  const suggestions = s => s.length ? `<p class="sec-h">Suggestions</p><div class="card list">${s.map(([n, c]) => `<button type="button" class="row" data-a="sugg" data-v="${esc(n)}"><span class="grow">${esc(n)}</span><span class="mono muted">${fmt(c)}</span></button>`).join('')}</div>` : '';
  openSheet({
    title: 'Find a way in', right: ['Done'], full: true,
    mount(body){
      body.innerHTML = `<label class="searchbox">${icon('search')}<input type="search" data-in="q" value="${esc(q)}" placeholder="Company, like Dominion Energy" autocomplete="off" autocorrect="off"></label><div class="intro-out"></div>`;
      results(body);
      if (!q) setTimeout(() => { const i = $('input', body); if (i) i.focus(); }, 300);
    },
    handlers: {
      q(v, t){ q = v; clearTimeout(t0); const b = t.closest('.sheet-body'); t0 = setTimeout(() => results(b), 250); },
      sugg(v, t){ q = v; const b = t.closest('.sheet-body'); $('input', b).value = v; results(b); },
      open(k){ closeSheet(); openPerson(k); },
      ask(k, t){ const out = t.closest('.intro-out'); openMessage(k, {intro: (out && out.__company) || q}); },
    },
  });
}
register('intro', openIntro);
