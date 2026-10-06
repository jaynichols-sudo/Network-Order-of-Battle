// People: natural-language search, sort, filters, pinned searches, and the rows
// used everywhere a person is listed. Ports PeopleView.swift and FilterSheet.swift.
import { M, person, persons, setQuery, facets, filterCount, blankFilters, saveSearch, exportCSV } from './model.js';
import { esc, fmt, icon, avatar, flag, bandVar, bandLabel, Day, menu, prompt, empty, $, plural } from './ui.js';
import { openSheet, setSheetButton, wire } from './nav.js';
import { openPerson, register } from './actions.js';
import { fx } from './platform.js';

/* ---------- a person row ---------- */
export function flagFor(p){
  if (p.waiting) return flag('Reply', 'var(--amber)');
  if (p.due) return flag('Follow up', 'var(--violet)');
  if (p.over) return flag('Overdue', 'var(--violet)');
  if (p.moved) return flag('New job', 'var(--info)');
  if (p.isNew) return flag('New', 'var(--good)');
  if (p.x) return flag('Removed', 'var(--text2)');
  return '';
}
export function personRow(p, {lens = M.info.lens, sub = '', act = 'open'} = {}){
  if (!p) return '';
  const t = p.rx && p.rx.t;
  const tag = flagFor(p) || (lens && p.cl.grade ? `<span class="grade mono">${esc(p.cl.grade)}</span>`
    : p.indShort && p.cl.ind !== 'Unclassified' ? `<span class="meta-ind"><i class="dot sm" style="background:${esc(p.indColor)}"></i>${esc(p.indShort)}</span>` : '');
  const detail = [p.p, p.c].filter(Boolean).join(' · ');
  return `<button type="button" class="row prow" data-a="${act}" data-v="${esc(p.k)}" aria-label="${esc(p.full)}${p.p ? ', ' + esc(p.p) : ''}${p.c ? ', ' + esc(p.c) : ''}${t ? `, ${esc(bandLabel(p.band))}, last message ${esc(Day.ago(t))}` : ''}">
    ${avatar(p, 42)}
    <span class="prow-main"><b class="prow-name">${esc(p.full)}</b>${detail ? `<span class="prow-detail">${esc(detail)}</span>` : ''}${sub ? `<span class="prow-sub">${esc(sub)}</span>` : ''}</span>
    <span class="prow-meta">${tag}${t ? `<span class="meta-msg"><i class="dot" style="background:${bandVar(p.band)}"></i><span class="mono">${esc(Day.short(t))}</span></span>` : ''}</span></button>`;
}
export const rowsCard = (ps, opts) => ps.length ? `<div class="card list">${ps.map(p => personRow(p, opts)).join('')}</div>` : '';

/* ---------- active filter tokens ---------- */
const SIG = {new: 'New since last refresh', jc: 'Job change', star: 'Starred', notes: 'Has notes', email: 'Has email', gov: '.gov / .mil email', clr: 'Clearance', jcw: 'Changed jobs this refresh', anniv: 'Anniversary this week', due: 'Follow-up due', waiting: 'Waiting on your reply', cold: 'Going cold', never: 'Never messaged', overdue: 'Overdue to reach out', circle: 'In a circle'};
function tokens(){
  const f = M.q.filters, out = [];
  for (const v of [...f.sig].sort()) out.push(['sig', v, SIG[v] || v]);
  for (const g of ['rel', 'ind', 'sen', 'func', 'seg', 'branch', 'status', 'tier', 'cert']) for (const v of [...f[g]].sort()) out.push([g, v, v]);
  if (f.company) out.push(['company', f.company, f.company]);
  if (f.agency) out.push(['agency', f.agency, f.agency]);
  if (f.since) out.push(['since', f.since, ((M.constants.since || []).find(s => s[0] === f.since) || [0, 'Connected'])[1]]);
  if (f.removed) out.push(['removed', '', 'Including removed']);
  return out;
}
function removeToken(g, v){
  const f = JSON.parse(JSON.stringify(M.q.filters));
  if (Array.isArray(f[g])) f[g] = f[g].filter(x => x !== v); else if (g === 'removed') f.removed = false; else f[g] = '';
  setQuery({filters: f});
}

/* the pill row: one tap for the views you use most */
const QUICK = [['all', 'All', {}], ['waiting', 'Reply', {sig: ['waiting']}], ['jcw', 'New jobs', {sig: ['jcw']}], ['star', 'Starred', {sig: ['star']}], ['close', 'Close', {rel: ['Close']}], ['new', 'New', {sig: ['new']}]];
function quickOn(id){
  const f = M.q.filters, n = filterCount(f), q = QUICK.find(x => x[0] === id); if (!q) return false;
  const want = q[2], keys = Object.keys(want);
  if (!keys.length) return n === 0;
  return n === 1 && keys.every(g => f[g].length === 1 && f[g][0] === want[g][0]);
}
function pills(){
  const qs = QUICK.filter(([id]) => id !== 'close' || M.info.hasRel);
  const n = filterCount(M.q.filters);
  return `<div class="fpills">${qs.map(([id, l]) => `<button type="button" class="fpill ${quickOn(id) ? 'on' : ''}" data-a="quick" data-v="${id}">${esc(l)}</button>`).join('')}
    <button type="button" class="fpill round ${n && !QUICK.some(([id]) => id !== 'all' && quickOn(id)) ? 'on' : ''}" data-a="filters" aria-label="Filters">${icon('filter')}${n ? `<b class="badge">${n}</b>` : ''}</button></div>`;
}

const SORTS = [['new', 'Newest connections'], ['name', 'Last name'], ['level', 'Most senior'], ['warm', 'Closest relationships'], ['rank', 'Rank']];
const PAGE = 80;

/* ---------- the People tab ---------- */
export const PeopleView = {
  shown: PAGE,
  mount(el){
    el.innerHTML = `<div class="scr">
      <header class="scr-head"><h1>People</h1><div class="tools"><span class="count"></span>
        <button type="button" class="tool" data-a="sort" aria-label="Sort, pin and export">${icon('sort')}</button></div></header>
      <label class="searchbox white">${icon('search')}<input type="search" data-in="q" placeholder="Names, companies, or “navy o-5 and up”" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Search your network"><button type="button" class="clear" data-a="clearQ" aria-label="Clear search" hidden>${icon('x')}</button></label>
      <div class="pills-slot"></div><div class="people-body"></div><div class="sentinel"></div></div>`;
    this.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && this.shown < M.results.length){ this.shown += PAGE; this.renderList(el, true); } }, {root: el, rootMargin: '600px'});
    this.io.observe($('.sentinel', el));
    register('peopleScrollTop', () => { el.scrollTop = 0; this.shown = PAGE; });
    this.update(el);
  },
  update(el){
    const input = $('input[data-in="q"]', el);
    if (document.activeElement !== input && input.value !== M.q.text) input.value = M.q.text;
    $('.clear', el).hidden = !M.q.text;
    $('.scr-head .count', el).textContent = fmt(M.results.length);
    const ps = $('.pills-slot', el), sl = ps.firstElementChild ? ps.firstElementChild.scrollLeft : 0;
    ps.innerHTML = pills(); ps.firstElementChild.scrollLeft = sl;
    this.renderList(el);
  },
  renderList(el, append = false){
    const body = $('.people-body', el);
    const keys = M.results;
    if (!append){
      const toks = QUICK.some(([id]) => quickOn(id)) ? [] : tokens();
      const chips = M.chips.map(c => `<span class="chip on">${icon('sparkles')}${esc(c)}</span>`).join('') + toks.map(([g, v, l]) => `<button type="button" class="chip on" data-a="untoken" data-v="${esc(g + '\u0001' + v)}">${esc(l)}${icon('x')}</button>`).join('');
      body.innerHTML = `${chips ? `<div class="chips-scroll">${chips}${toks.length + (M.chips.length ? 1 : 0) > 1 ? '<button type="button" class="link" data-a="clearAll">Clear all</button>' : ''}</div>` : ''}
        ${keys.length ? `<div class="card list plist">${persons(keys.slice(0, this.shown)).map(p => personRow(p)).join('')}</div>` : empty('search', 'No one matches', 'Remove a filter or clear the search.')}`;
    } else {
      const list = $('.plist', body); if (!list) return;
      const have = list.children.length;
      list.insertAdjacentHTML('beforeend', persons(keys.slice(have, this.shown)).map(p => personRow(p)).join(''));
    }
  },
  handlers: {
    open: k => openPerson(k),
    q(v, t){ clearTimeout(PeopleView.qt); PeopleView.qt = setTimeout(() => { PeopleView.shown = PAGE; setQuery({text: v}); const sc = t.closest('.screen'); if (sc) sc.scrollTop = 0; }, 160); },
    clearQ(){ PeopleView.shown = PAGE; setQuery({text: ''}); },
    clearAll(){ PeopleView.shown = PAGE; setQuery({text: '', filters: blankFilters()}); },
    untoken(v){ const [g, val] = v.split('\u0001'); removeToken(g, val); },
    filters: () => openFilters(),
    quick(id){ fx.select(); const q = QUICK.find(x => x[0] === id); if (!q) return; PeopleView.shown = PAGE; setQuery({filters: Object.assign(blankFilters(), JSON.parse(JSON.stringify(q[2])))}); },
    sort(_, t){
      const sorts = SORTS.filter(([s]) => (s !== 'rank' || M.info.lens) && (s !== 'warm' || M.info.hasRel));
      menu(t, [{header: 'Sort by'}, ...sorts.map(([s, l]) => ({label: l, on: M.q.sort === s, run: () => setQuery({sort: s})})), 'sep',
        {label: 'Pin this search to Today', icon: 'pin', disabled: !M.q.text && !filterCount(M.q.filters), run: pinSearch},
        {label: 'Export this list', icon: 'share', run: () => exportCSV(M.results)}]);
    },
  },
};
async function pinSearch(){
  const t = M.q.text;
  const name = await prompt({title: 'Name this list', message: 'It stays up to date every time you refresh.', placeholder: 'Navy O-5 and up', value: t ? t[0].toUpperCase() + t.slice(1) : '', ok: 'Pin to Today'});
  if (name == null) return;
  saveSearch(name.trim() || 'My list');
}

/* ---------- filters ---------- */
export function openFilters(){
  let fc = null;
  const chipSection = (title, items, group) => `<section class="fsec"><h3>${esc(title)}</h3>${items.length ? `<div class="chips-wrap">${items.map(it => {
    const [value, a, b] = it, sig = group === 'sig', label = sig ? a : value, count = sig ? b : a, color = sig ? null : b;
    const on = M.q.filters[group].includes(value);
    return `<button type="button" class="chip ${on ? 'on' : ''} ${!count && !on ? 'faint' : ''}" data-a="tog" data-v="${esc(group + '\u0001' + value)}">${color ? `<i class="dot" style="background:${esc(color)}"></i>` : ''}${esc(label)}<span class="n mono">${fmt(count)}</span></button>`;
  }).join('')}</div>` : '<p class="muted">None in this view</p>'}</section>`;
  const select = (title, group, items, all) => `<section class="fsec"><h3>${esc(title)}</h3><div class="select"><select data-ch="sel" data-g="${group}"><option value="">${esc(all)}</option>${
    (M.q.filters[group] && !items.some(i => i[0] === M.q.filters[group]) ? `<option selected>${esc(M.q.filters[group])}</option>` : '') +
    items.map(([v, n]) => `<option value="${esc(v)}" ${M.q.filters[group] === v ? 'selected' : ''}>${esc(v)} (${fmt(n)})</option>`).join('')}</select>${icon('chevD')}</div></section>`;
  const render = (body, sheet) => {
    const st = body.parentElement.scrollTop;
    fc = facets();
    const L = M.info.lens;
    body.innerHTML = [
      chipSection('Quick picks', fc.sig, 'sig'),
      fc.rel.length ? chipSection('How well you know them', fc.rel, 'rel') : '',
      chipSection('Industry', fc.ind, 'ind'),
      chipSection('Seniority', fc.sen, 'sen'),
      chipSection('What they do', fc.func, 'func'),
      select('Company', 'company', fc.company, 'All companies'),
      L ? chipSection('Federal segment', fc.seg, 'seg') + chipSection('Military branch', fc.branch, 'branch') + chipSection('Service', fc.status, 'status') + chipSection('Rank or grade', fc.tier, 'tier') + select('Agency or command', 'agency', fc.agency, 'All agencies and commands') : '',
      fc.cert.length ? chipSection('Certifications', fc.cert, 'cert') : '',
      `<section class="fsec"><h3>Connected</h3><div class="select"><select data-ch="since">${(M.constants.since || []).map(([v, l]) => `<option value="${esc(v)}" ${M.q.filters.since === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${icon('chevD')}</div>
       <label class="toggle-row"><span>Include people no longer in your export</span><input type="checkbox" class="switch" data-ch="removed" ${M.q.filters.removed ? 'checked' : ''}></label></section>`,
    ].join('');
    body.parentElement.scrollTop = st;
    if (sheet) setSheetButton(sheet, 'r', `Show ${fmt(fc.total)}`);
  };
  const patch = fn => { const f = JSON.parse(JSON.stringify(M.q.filters)); fn(f); setQuery({filters: f}); };
  openSheet({
    title: 'Filters', full: true,
    left: ['Clear all', () => { fx.tap(); setQuery({filters: blankFilters()}); }],
    right: ['Done', s => s.close()],
    mount(body, sheet){ this.sheet = sheet; render(body, sheet); },
    update(body, what, sheet){ if (what === 'search' || what === 'all') render(body, sheet); },
    handlers: {
      tog(v){ fx.tap(); const [g, val] = v.split('\u0001'); patch(f => { f[g] = f[g].includes(val) ? f[g].filter(x => x !== val) : f[g].concat(val); }); },
      sel(v, t){ patch(f => { f[t.dataset.g] = v; }); },
      since(v){ patch(f => { f.since = v; }); },
      removed(v){ patch(f => { f.removed = !!v; }); },
    },
  });
}
