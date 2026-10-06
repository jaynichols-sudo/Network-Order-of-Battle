// Headless "brain" for the native apps. Runs inside JavaScriptCore on iPhone,
// iPad and Mac and exposes the same classification, scoring and search logic the
// web app uses, as plain JSON in and out. No DOM, no timers.
import {
  fmt, isoDay, TODAY, daysAgo, niceDate, h01, hash,
  SEGS, SEGI, BRANCHES, STATUSES, TIERS, SENIORITY, FUNCS, SINCE, SIGNALS, GRADE_OPTS, CERTS,
  classify, keyOf, stripRow, rowsFromCSV, relationsFromArchive, mergeImport, sampleNetwork, warmth,
} from './core.js';
import { parseQuery, matchNL } from './nlq.js';
import { INDUSTRIES, indColor, indShort, setIndustryOverrides, companyKey, UNCLASSIFIED, GOV_IND } from './industry.js';

/* ---------- state ---------- */
const S = {all: [], byK: new Map(), edits: {}, review: {}, targets: [], meta: null, mode: 'sample', coInd: Object.create(null), coLink: Object.create(null), coLoc: Object.create(null), lensPref: null, lens: false, hasRel: false, team: []};
const SEG_COLORS = ['#7A9A1E', '#3E7BE0', '#1E9E8F', '#7556E8', '#C79100', '#D9467F', '#E0683A', '#A07C50', '#6B7F99', '#5B6B83'];
const segColor = seg => SEG_COLORS[SEGI[seg] ?? 9];
const GOV_SEGS3 = ['DoD & Military', 'Federal Civilian', 'State & Local'];
const groupOf = r => S.lens && r.cl.ind === GOV_IND ? (GOV_SEGS3.includes(r.cl.seg) ? r.cl.seg : 'Federal Civilian') : r.cl.ind;
const groupList = () => [
  ...(S.lens ? GOV_SEGS3.map(id => ({id, short: SEGS[SEGI[id]].short, color: segColor(id), key: 'seg'})) : []),
  ...INDUSTRIES.filter(i => !S.lens || i.id !== GOV_IND).map(i => ({id: i.id, short: i.short, color: i.color, key: 'ind'})),
];
const groupColor = g => GOV_SEGS3.includes(g) ? segColor(g) : indColor(g);
const BAND_LABEL = {strong: 'Close', warm: 'Warm', light: 'Light touch', none: 'No real contact'};
const SIGNALS_UI = [...SIGNALS, ['jcw', 'Changed jobs this refresh'], ['anniv', 'Anniversary this week'], ['due', 'Follow-up due'], ['waiting', 'Waiting on your reply'], ['overdue', 'Overdue to reach out'], ['circle', 'In a circle'], ['cold', 'Going cold'], ['never', 'Never messaged']];
const SAMPLE_TARGETS = ['NAVFAC', 'USACE', 'DISA', 'Duke Energy', 'CISA'];

const daysSince = d => d ? Math.floor((Date.parse(TODAY) - Date.parse(d)) / 864e5) : 99999;
const isWaiting = r => !!(r.rx && r.rx.dir === 'i' && r.rx.o && daysSince(r.rx.t) <= 45 && !(r.ed && r.ed.replied === r.rx.t));
const isCooling = r => { const x = r.rx; if (!x || x.m < 8 || (x.o || 0) < 3 || (x.i || 0) < 3) return false; const d = daysSince(x.t); return d > 150 && d < 900; };
const isDue = r => !!(r.ed && r.ed.due && r.ed.due <= TODAY);
// keep-in-touch circles: how often you mean to be in touch, in days
const CIRCLES = {inner: 30, key: 90, wide: 365};
const lastTouch = r => { const a = (r.rx && r.rx.t) || '', b = (r.ed && r.ed.touched) || ''; return a > b ? a : b; };
const isOverdue = r => { const c = r.ed && CIRCLES[r.ed.circle]; return !!c && !r.x && daysSince(lastTouch(r)) > c; };
const touchDue = r => { const c = r.ed && CIRCLES[r.ed.circle]; if (!c) return ''; const t = lastTouch(r); return t ? isoDay(Date.parse(t) + c * 864e5) : TODAY; };
const addDays = n => isoDay(Date.now() + n * 864e5);
function isAnniversary(d){
  if (!d || d.length < 10) return false;
  const now = new Date(), y = now.getFullYear();
  if (+d.slice(0, 4) >= y) return false;
  const then = new Date(y, +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.abs(then - now) / 864e5 <= 3.5;
}
function ago(d){ const n = daysSince(d); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? `${n} days ago` : n < 60 ? `${Math.round(n / 7)} weeks ago` : n < 730 ? `${Math.round(n / 30.4)} months ago` : `${Math.round(n / 365)} years ago`; }
function shortRank(r){ const m = {'O-10': 'Gen', 'O-9': 'Lt Gen', 'O-8': 'Maj Gen', 'O-7': 'Brig Gen', 'O-6': 'Col', 'O-5': 'Lt Col', 'O-4': 'Maj', 'O-3': 'Capt'}; const nav = {'O-6': 'CAPT', 'O-5': 'CDR', 'O-4': 'LCDR', 'O-3': 'LT'}; return (/Navy|Coast/.test(r.cl.branch) ? nav[r.cl.grade] : m[r.cl.grade]) || r.cl.grade; }
const fullName = r => `${S.lens && r.cl.grade && /^O-([3-9]|10)$/.test(r.cl.grade) && r.cl.status !== 'Veteran / Retired' ? shortRank(r) + ' ' : ''}${r.f} ${r.l}`;
const live = () => S.all.filter(r => !r.x);

function hydrate(rows){
  const imp = (S.meta && S.meta.n) || 0;
  setIndustryOverrides(S.coInd);
  let anyRel = false;
  const lastImp = S.meta && S.meta.lastImport;
  S.all = rows.map(r => {
    const k = r.k || keyOf(r);
    const ed = S.edits[k];
    const cl = classify(r, ed);
    const isNew = S.mode === 'sample' ? !!r._new : (imp > 1 && r.fi === imp);
    const movedNow = !!r.jc && (S.mode === 'sample' ? daysAgo(r.jc) < 8 : r.jc === lastImp);
    const hay = [r.f, r.l, r.p, r.c, cl.agency, cl.rank, cl.grade, cl.branch, cl.ind, ed && ed.note, ed && (ed.tags || []).join(' ')].join(' ').toLowerCase();
    const wm = warmth(r.rx, TODAY); if (r.rx) anyRel = true;
    return Object.assign({}, r, {k, cl, ed: ed || null, isNew, movedNow, hay, wm});
  });
  S.byK = new Map(S.all.map(r => [r.k, r]));
  S.hasRel = anyRel;
  applyLens();
}
function autoLens(){
  const A = live(); if (!A.length) return false;
  const fed = A.filter(r => r.cl.seg === 'DoD & Military' || r.cl.seg === 'Federal Civilian' || r.cl.status === 'Veteran / Retired' || r.cl.branch).length;
  return fed >= 60 || fed / A.length >= 0.04;
}
function applyLens(){ S.lens = S.lensPref == null ? autoLens() : !!S.lensPref; }
const rehydrate = () => hydrate(S.all.map(stripRow));

/* ---------- people as JSON for the UI ---------- */
function vm(r, full){
  const c = r.cl;
  const o = {k: r.k, f: r.f || '', l: r.l || '', name: fullName(r), u: r.u || '', e: r.e || '', c: r.c || '', p: r.p || '', d: r.d || '',
    cl: {seg: c.seg, branch: c.branch, status: c.status, rank: c.rank, grade: c.grade, tier: c.tier, gn: c.gn, sen: c.sen, func: c.func, agency: c.agency, certs: c.certs, clr: !!c.clr, lv: c.lv, ind: c.ind, indHow: c.indHow || ''},
    group: groupOf(r), color: groupColor(groupOf(r)), indColor: indColor(c.ind), indShort: indShort(c.ind),
    band: r.wm.band, score: r.wm.score, isNew: !!r.isNew, moved: !!r.movedNow,
    waiting: isWaiting(r), cooling: isCooling(r), due: isDue(r), anniv: isAnniversary(r.d),
    over: isOverdue(r), touch: lastTouch(r), next: touchDue(r)};
  if (r.x) o.x = r.x;
  if (r.jc) o.jc = r.jc;
  if (r.fs) o.fs = r.fs;
  if (r.pv) o.pv = r.pv;
  // the list view gets a slim copy; the profile asks for the full person
  if (r.rx) o.rx = full ? r.rx : Object.fromEntries(Object.entries(r.rx).filter(([k]) => k !== 's' && k !== 'invn'));
  if (r.ed) o.ed = full || !r.ed.note || r.ed.note.length <= 80 ? r.ed : Object.assign({}, r.ed, {note: r.ed.note.slice(0, 80)});
  return o;
}

/* ---------- filtering and search ---------- */
const blankF = () => ({q: '', rel: [], seg: [], branch: [], status: [], tier: [], sen: [], func: [], ind: [], cert: [], sig: [], agency: '', company: '', since: '', removed: false});
function sinceOk(F, r){
  if (!F.since) return true;
  const d = daysAgo(r.d);
  if (F.since === 'o1') return d > 365;
  if (F.since === 'o5') return d > 1825;
  return d <= +F.since;
}
function sigOk(r, s){
  switch (s){
    case 'new': return r.isNew;
    case 'jc': return !!r.jc;
    case 'star': return !!(r.ed && r.ed.star);
    case 'notes': return !!(r.ed && (r.ed.note || (r.ed.tags && r.ed.tags.length)));
    case 'email': return !!r.e;
    case 'gov': return /\.(gov|mil)$/i.test(r.e || '');
    case 'clr': return r.cl.clr;
    case 'jcw': return r.movedNow;
    case 'anniv': return isAnniversary(r.d);
    case 'due': return isDue(r);
    case 'waiting': return isWaiting(r);
    case 'overdue': return isOverdue(r);
    case 'circle': return !!(r.ed && CIRCLES[r.ed.circle]);
    case 'cold': return isCooling(r);
    case 'never': return !(r.rx && r.rx.m);
  }
  return true;
}
function compile(input){
  const F = Object.assign(blankF(), (input && input.filters) || {});
  const text = ((input && input.text) || '').trim();
  let nl = null, chips = [];
  if (text){
    const agencies = [...new Set(S.all.map(r => r.cl.agency).filter(Boolean))];
    const t = text.toLowerCase();
    const literal = t.length >= 4 && S.all.some(r => (r.c || '').toLowerCase().includes(t) || `${r.f} ${r.l}`.toLowerCase().includes(t));
    const parsed = literal ? {nl: null, rest: t, chips: []} : parseQuery(text, agencies);
    nl = parsed.nl; chips = parsed.chips; F.q = nl ? parsed.rest : text;
  }
  const has = (arr, v) => arr.includes(v);
  const match = (r, skip) => {
    if (!F.removed && r.x) return false;
    if (nl){ if (!matchNL(nl, r)) return false; for (const s of nl.sig) if (!sigOk(r, s)) return false; }
    const c = r.cl;
    if (skip !== 'seg' && F.seg.length && !has(F.seg, c.seg)) return false;
    if (skip !== 'branch' && F.branch.length && !has(F.branch, c.branch)) return false;
    if (skip !== 'status' && F.status.length && !has(F.status, c.status)) return false;
    if (skip !== 'tier' && F.tier.length && !has(F.tier, c.tier)) return false;
    if (skip !== 'sen' && F.sen.length && !has(F.sen, c.sen)) return false;
    if (skip !== 'func' && F.func.length && !has(F.func, c.func)) return false;
    if (skip !== 'ind' && F.ind.length && !has(F.ind, c.ind)) return false;
    if (skip !== 'rel' && F.rel.length && !has(F.rel, BAND_LABEL[r.wm.band])) return false;
    if (skip !== 'cert' && F.cert.length && !c.certs.some(x => has(F.cert, x))) return false;
    if (skip !== 'sig' && F.sig.length) for (const s of F.sig) if (!sigOk(r, s)) return false;
    if (skip !== 'agency' && F.agency && c.agency !== F.agency) return false;
    if (skip !== 'company' && F.company && (r.c || '') !== F.company) return false;
    if (skip !== 'since' && !sinceOk(F, r)) return false;
    if (F.q){ for (const t of F.q.toLowerCase().split(/\s+/)) if (t && !r.hay.includes(t)) return false; }
    return true;
  };
  return {F, match, chips};
}
const SORTS = {
  new: (a, b) => (b.d || '').localeCompare(a.d || ''),
  name: (a, b) => (a.l || '').localeCompare(b.l || '') || (a.f || '').localeCompare(b.f || ''),
  rank: (a, b) => b.cl.gn - a.cl.gn || (a.l || '').localeCompare(b.l || ''),
  level: (a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn,
  warm: (a, b) => b.wm.score - a.wm.score || ((b.rx && b.rx.t) || '').localeCompare((a.rx && a.rx.t) || ''),
};
function search(input){
  const {match, chips} = compile(input);
  const list = S.all.filter(r => match(r)).sort(SORTS[(input && input.sort) || 'new'] || SORTS.new);
  return {keys: list.map(r => r.k), chips, count: list.length};
}
function facets(input){
  const {F, match} = compile(input);
  const count = (group, getter) => {
    const m = new Map();
    for (const r of S.all){ if (!match(r, group)) continue; const v = getter(r); if (Array.isArray(v)) v.forEach(x => m.set(x, (m.get(x) || 0) + 1)); else if (v) m.set(v, (m.get(v) || 0) + 1); }
    return m;
  };
  const list = (group, values, getter) => { const m = count(group, getter); return values.filter(v => m.get(v) || F[group].includes(v)).map(v => [v, m.get(v) || 0]); };
  const sel = (group, getter) => { const m = count(group, getter); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };
  const sigCounts = {};
  for (const r of S.all){ if (!match(r, 'sig')) continue; for (const [s] of SIGNALS_UI) if (sigOk(r, s)) sigCounts[s] = (sigCounts[s] || 0) + 1; }
  return {
    total: S.all.filter(r => match(r)).length,
    sig: SIGNALS_UI.filter(([v]) => S.lens || !['gov', 'clr'].includes(v)).map(([v, l]) => [v, l, sigCounts[v] || 0]),
    rel: S.hasRel ? list('rel', Object.values(BAND_LABEL), r => BAND_LABEL[r.wm.band]) : [],
    ind: list('ind', INDUSTRIES.map(i => i.id), r => r.cl.ind).map(([v, n]) => [v, n, indColor(v)]),
    sen: list('sen', SENIORITY, r => r.cl.sen),
    func: list('func', FUNCS, r => r.cl.func),
    cert: list('cert', CERTS.map(c => c[0]), r => r.cl.certs),
    company: sel('company', r => r.c).slice(0, 300),
    seg: S.lens ? list('seg', SEGS.map(s => s.id), r => r.cl.seg).map(([v, n]) => [v, n, segColor(v)]) : [],
    branch: S.lens ? list('branch', BRANCHES, r => r.cl.branch) : [],
    status: S.lens ? list('status', STATUSES, r => r.cl.status) : [],
    tier: S.lens ? list('tier', TIERS.map(t => t[0]), r => r.cl.tier) : [],
    agency: S.lens ? sel('agency', r => r.cl.agency).slice(0, 300) : [],
    since: SINCE,
  };
}

/* ---------- companies and coverage ---------- */
const ladder = () => S.lens
  ? [[1, 'Executives, flag officers, SES, O-6'], [2, 'Directors, O-4 to O-5, GS-15, E-9'], [3, 'Managers, O-1 to O-3, GS-13/14, senior NCOs'], [4, 'Staff and individual contributors']]
  : [[1, 'Executives and VPs'], [2, 'Directors'], [3, 'Managers'], [4, 'Staff and individual contributors']];
function unitPeople(name){
  const n = name.toLowerCase();
  return S.all.filter(r => !r.x && (r.cl.agency === name || r.c === name || (n.length > 3 && (r.c || '').toLowerCase().includes(n))));
}
function coverage(ps){
  const lv = [0, 0, 0, 0, 0]; ps.forEach(r => lv[Math.min(4, Math.max(1, r.cl.lv))]++);
  const score = (lv[1] ? 40 : 0) + Math.min(lv[2], 2) / 2 * 30 + Math.min(lv[3], 3) / 3 * 20 + Math.min(lv[4], 3) / 3 * 10;
  return {lv, score: Math.round(score)};
}
function gapsOf(cov){
  const g = [];
  if (!cov.lv[1]) g.push(S.lens ? 'No exec, flag or SES-level contact' : 'No executive or VP contact');
  if (cov.lv[2] < 2) g.push(cov.lv[2] ? 'Only one director-level contact' : 'No director-level contact');
  if (!cov.lv[3]) g.push('No manager-level contact');
  return g;
}
const isTarget = name => S.targets.some(t => t.name === name);
const bySenior = (a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn;
function targets(){
  return S.targets.map(t => {
    const ps = unitPeople(t.name), cov = coverage(ps), gaps = gapsOf(cov);
    return {name: t.name, note: t.note || '', count: ps.length, stars: ps.filter(r => r.ed && r.ed.star).length, news: ps.filter(r => r.isNew || r.movedNow).length, score: cov.score, lv: cov.lv, gap: gaps[0] || 'Covered at every level', gaps};
  });
}
const LI = 'https://www.linkedin.com';
const liExact = name => Object.hasOwn(S.coLink, companyKey(name)) && !!S.coLink[companyKey(name)];
const links = {
  person: r => r.u ? r.u : S.mode === 'sample' ? '' : `${LI}/search/results/people/?keywords=${encodeURIComponent(`${r.f} ${r.l} ${r.c || ''}`.trim())}`,
  company: name => (liExact(name) && S.coLink[companyKey(name)]) || `${LI}/search/results/companies/?keywords=${encodeURIComponent(name)}`,
  peopleAt: name => `${LI}/search/results/people/?keywords=${encodeURIComponent(name)}&network=%5B%22F%22%5D`,
  snPerson: r => `${LI}/sales/search/people?keywords=${encodeURIComponent(`${r.f} ${r.l} ${r.c || ''}`.trim())}`,
  snCompany: name => `${LI}/sales/search/company?keywords=${encodeURIComponent(name)}`,
};
function unit(name){
  const ps = unitPeople(name).sort(bySenior);
  const loc = companyLocation(name);
  const cov = coverage(ps), gaps = gapsOf(cov), target = S.targets.find(t => t.name === name);
  const isCo = S.all.some(r => r.c === name) && !S.all.some(r => r.cl.agency === name);
  const indCount = new Map(); ps.forEach(r => indCount.set(r.cl.ind, (indCount.get(r.cl.ind) || 0) + 1));
  const autoInd = ([...indCount.entries()].sort((a, b) => b[1] - a[1])[0] || [UNCLASSIFIED])[0];
  return {name, count: ps.length, score: cov.score, lv: cov.lv, gaps, isTarget: !!target, note: (target && target.note) || '', isCompany: isCo,
    industry: {auto: autoInd, set: S.coInd[companyKey(name)] || ''},
    rungs: ladder().map(([lv, label]) => ({lv, label, keys: ps.filter(r => Math.min(4, Math.max(1, r.cl.lv)) === lv).map(r => r.k)})),
    links: {company: links.company(name), companyExact: liExact(name), peopleAt: links.peopleAt(name), salesNav: links.snCompany(name)},
    location: loc, alumni: alumniOf(name).map(a => ({k: a.r.k, was: a.was, until: a.until}))};
}
// People who used to be at a company or command (seen in an earlier refresh) and have since moved on.
function alumniOf(name){
  const n = name.toLowerCase(), out = [];
  for (const r of S.all){
    if (r.x || !r.pv || !r.pv.length) continue;
    if ((r.c || '').toLowerCase() === n || r.cl.agency === name) continue;
    const hit = r.pv.find(v => { const c = (v.c || '').toLowerCase(); return c && (c === n || (n.length > 3 && c.includes(n))); });
    if (hit) out.push({r, was: hit.p || '', until: hit.until || ''});
  }
  return out.sort((a, b) => bySenior(a.r, b.r));
}

/* ---------- ready-made messages ---------- */
// Short, friendly starting points. The person edits before sending; nothing is sent from here.
function messages(k, ctx){
  const r = S.byK.get(k); if (!r) return [];
  ctx = ctx || {};
  const first = r.f || 'there', me = ctx.me ? `\n\n${ctx.me}` : '';
  const co = r.c || '', title = r.p || '';
  const out = [];
  const add = (id, label, text) => out.push({id, label, text: text + me});
  if (ctx.intro) add('introTo', `Intro to ${ctx.intro}`, `Hi ${first}, I hope you’re well. I’m looking to connect with the right people at ${ctx.intro}${co && co !== ctx.intro ? '' : ' in your organization'} and thought of you first. Would you be open to a quick introduction, or pointing me to who I should talk to? Happy to send a short note you can forward.`);
  if (ctx.event) add('event', `Great to meet at ${ctx.event}`, `Hi ${first}, great to meet you at ${ctx.event}. I enjoyed our conversation and would like to keep it going. Do you have time for a quick call in the next couple of weeks?`);
  if (ctx.trip) add('trip', `Visiting ${ctx.trip.city}`, `Hi ${first}, I’ll be in ${ctx.trip.city} ${ctx.trip.when}. Any chance you have time for a coffee while I’m in town? It would be great to catch up.`);
  if (ctx.meeting) add('after', 'After our meeting', `Hi ${first}, thanks for the time today. I appreciated the conversation about ${ctx.meeting}. I’ll follow up on what we discussed and keep you posted.`);
  if (r.movedNow || r.jc) add('congrats', 'Congratulations on the new role', `Hi ${first}, congratulations on the new role${title ? ` as ${title}` : ''}${co ? ` at ${co}` : ''}! Well deserved. I’d love to hear how it’s going once you’ve settled in.`);
  if (isAnniversary(r.d)){ const y = new Date().getFullYear() - +r.d.slice(0, 4); add('anniv', `${y} ${y === 1 ? 'year' : 'years'} connected`, `Hi ${first}, LinkedIn tells me we’ve been connected for ${y} ${y === 1 ? 'year' : 'years'} now. Hope all is well${co ? ` at ${co}` : ''}. What are you working on these days?`); }
  if (isCooling(r)) add('cold', 'It’s been a while', `Hi ${first}, it’s been a while since we last talked and I wanted to check in. How are things${co ? ` at ${co}` : ''}? Would be good to catch up soon.`);
  if (r.isNew) add('new', 'Thanks for connecting', `Hi ${first}, thanks for connecting. I’d welcome the chance to learn more about your work${co ? ` at ${co}` : ''}. Open to a quick call sometime in the next few weeks?`);
  add('checkin', 'Just checking in', `Hi ${first}, hope you’re doing well. I was thinking about our last conversation and wanted to see how things are going${co ? ` at ${co}` : ''}.`);
  add('intro', 'Ask for an introduction', `Hi ${first}, I’m hoping to connect with the right person${co ? ` at ${co}` : ''} about a project I’m working on. Would you be open to pointing me in the right direction or making a quick introduction?`);
  return out;
}

/* ---------- calendar matching ---------- */
// Matches meeting attendees ({email, name}) to people in the network. Email first, then a unique full name.
function matchAttendees(list){
  const byEmail = new Map(), byName = new Map();
  for (const r of S.all){
    if (r.x) continue;
    if (r.e) byEmail.set(r.e.toLowerCase(), r.k);
    const n = `${r.f} ${r.l}`.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    if (n) byName.set(n, byName.has(n) ? null : r.k);
  }
  return (list || []).map(a => {
    const e = (a.email || '').toLowerCase();
    if (e && byEmail.has(e)) return byEmail.get(e);
    let n = (a.name || '').replace(/\(.*?\)/g, '');
    if (n.includes(',')){ const [l, f] = n.split(','); n = `${f} ${l}`; }
    n = n.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    return (n && byName.get(n)) || null;
  });
}
// Everyone at the companies of the given people, for "who else do you know there".
function alsoAt(keys){
  const cos = new Set(keys.map(k => S.byK.get(k)).filter(Boolean).map(r => r.cl.agency || r.c).filter(Boolean));
  const out = {};
  for (const c of cos) out[c] = unitPeople(c).filter(r => !keys.includes(r.k)).sort(bySenior).slice(0, 6).map(r => r.k);
  return out;
}

function addTargetCandidates(q){
  const counts = new Map();
  for (const r of S.all){ if (r.x) continue; if (r.cl.agency) counts.set(r.cl.agency, (counts.get(r.cl.agency) || 0) + 1); if (r.c) counts.set(r.c, (counts.get(r.c) || 0) + 1); }
  const ql = (q || '').toLowerCase();
  return [...counts.entries()].filter(([n]) => !isTarget(n) && (!ql || n.toLowerCase().includes(ql))).sort((a, b) => b[1] - a[1]).slice(0, 60);
}
function toggleTarget(name){
  if (isTarget(name)) S.targets = S.targets.filter(t => t.name !== name);
  else S.targets.push({name, added: TODAY});
  return {targets: S.targets, on: isTarget(name)};
}
function setTargetNote(name, note){ const t = S.targets.find(x => x.name === name); if (t) t.note = String(note || '').slice(0, 4000); return {targets: S.targets}; }
function orgs(input){
  const {match} = compile(input);
  const co = new Map(), coSeg = {}, ag = new Map(), agSeg = {};
  for (const r of S.all){
    if (!match(r)) continue;
    if (r.c){ co.set(r.c, (co.get(r.c) || 0) + 1); coSeg[r.c] = r.cl.ind; }
    if (r.cl.agency){ ag.set(r.cl.agency, (ag.get(r.cl.agency) || 0) + 1); agSeg[r.cl.agency] = r.cl.seg; }
  }
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 60);
  return {companies: top(co).map(([k, n]) => [k, n, indColor(coSeg[k])]), agencies: S.lens ? top(ag).map(([k, n]) => [k, n, segColor(agSeg[k])]) : []};
}

/* ---------- industries ---------- */
function senMix(ps){ const lv = [0, 0, 0, 0, 0]; ps.forEach(r => lv[Math.min(4, Math.max(1, r.cl.lv))]++); return lv; }
function topCompanies(ps, n){ const m = new Map(); ps.forEach(r => { if (r.c) m.set(r.c, (m.get(r.c) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); }
function unclassifiedCompanies(){
  const m = new Map();
  for (const r of S.all){ if (r.x || r.cl.ind !== UNCLASSIFIED || !r.c) continue; m.set(r.c, (m.get(r.c) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function guessedCompanies(){
  const m = new Map();
  for (const r of S.all){ if (r.x || r.cl.indHow !== 'guess' || !r.c) continue; const g = m.get(r.c) || {n: 0, ind: r.cl.ind}; g.n++; m.set(r.c, g); }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
}
// Squarified treemap in a 0..100 square.
function treemap(items){
  if (!items.length) return [];
  const total = items.reduce((a, [, v]) => a + v, 0);
  const nodes = items.map(([k, v]) => ({k, v, a: v / total * 10000}));
  const out = []; let x = 0, y = 0, w = 100, h = 100, row = [];
  const worst = (r, side) => { const s = r.reduce((a, n) => a + n.a, 0); let m = 0; for (const n of r){ const q = Math.max(side * side * n.a / (s * s), (s * s) / (side * side * n.a)); if (q > m) m = q; } return m; };
  const layout = r => {
    const s = r.reduce((a, n) => a + n.a, 0);
    if (w >= h){ const cw = s / h; let cy = y; for (const n of r){ const ch = n.a / cw; out.push({...n, x, y: cy, w: cw, h: ch}); cy += ch; } x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; for (const n of r){ const cw = n.a / rh; out.push({...n, x: cx, y, w: cw, h: rh}); cx += cw; } y += rh; h -= rh; }
  };
  for (const n of nodes){ const side = Math.min(w, h); if (!row.length || worst(row.concat(n), side) <= worst(row, side)) row.push(n); else { layout(row); row = [n]; } }
  if (row.length) layout(row);
  return out.map(t => ({id: t.k, n: t.v, x: t.x, y: t.y, w: t.w, h: t.h, color: indColor(t.k), short: indShort(t.k)}));
}
function industries(opts){
  const includeGov = !!(opts && opts.gov);
  const base = live(), by = new Map();
  for (const r of base){ if (!by.has(r.cl.ind)) by.set(r.cl.ind, []); by.get(r.cl.ind).push(r); }
  const list = [...by.entries()].sort((a, b) => (a[0] === UNCLASSIFIED) - (b[0] === UNCLASSIFIED) || b[1].length - a[1].length);
  const total = base.length || 1, unc = by.get(UNCLASSIFIED) || [];
  return {
    summary: {industries: list.filter(([k]) => k !== UNCLASSIFIED).length, outside: base.filter(r => r.cl.ind !== GOV_IND).length, classifiedPct: Math.round((total - unc.length) / total * 100)},
    govCount: (by.get(GOV_IND) || []).length,
    tiles: treemap(list.filter(([k]) => k !== UNCLASSIFIED && (includeGov || k !== GOV_IND)).map(([k, v]) => [k, v.length])),
    list: list.map(([k, ps]) => ({id: k, color: indColor(k), short: indShort(k), count: ps.length, pct: Math.round(ps.length / total * 100), companies: new Set(ps.map(r => r.c).filter(Boolean)).size, top: topCompanies(ps, 2).map(([c]) => c), mix: senMix(ps)})),
    unclassified: unclassifiedCompanies().slice(0, 400),
    unclassifiedTotal: unclassifiedCompanies().length,
    guesses: guessedCompanies().slice(0, 200).map(([c, g]) => [c, g.n, g.ind]),
    tagged: Object.keys(S.coInd).length,
  };
}
function industry(id){
  const ps = live().filter(r => r.cl.ind === id).sort(bySenior);
  const fn = new Map(); ps.forEach(r => fn.set(r.cl.func, (fn.get(r.cl.func) || 0) + 1));
  return {id, color: indColor(id), short: indShort(id), count: ps.length, companies: new Set(ps.map(r => r.c).filter(Boolean)).size,
    vets: ps.filter(r => r.cl.status === 'Veteran / Retired').length, stars: ps.filter(r => r.ed && r.ed.star).length,
    mix: senMix(ps), senior: ps.filter(r => r.cl.lv <= 2).slice(0, 12).map(r => r.k), top: topCompanies(ps, 12),
    funcs: [...fn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)};
}
function setCompanyIndustry(company, ind){
  const key = companyKey(company); if (!key) return {companies: S.coInd, links: S.coLink};
  if (ind) S.coInd[key] = ind; else delete S.coInd[key];
  rehydrate();
  return {companies: S.coInd, links: S.coLink};
}
// A location for everyone at a company, agency or command: {name, lat, lon}, or null to clear.
function setCompanyLocation(company, loc){
  const key = companyKey(company); if (!key) throw new Error('No company name');
  if (loc && loc.name && isFinite(loc.lat) && isFinite(loc.lon)) S.coLoc[key] = {name: String(loc.name).slice(0, 80), lat: +loc.lat, lon: +loc.lon};
  else delete S.coLoc[key];
  return true;
}
// People placed by their company's or command's location. Agency wins over the raw company name.
function companyPlaces(){
  const out = {};
  if (!Object.keys(S.coLoc).length) return out;
  for (const r of S.all){
    if (r.x) continue;
    const l = (r.cl.agency && S.coLoc[companyKey(r.cl.agency)]) || (r.c && S.coLoc[companyKey(r.c)]);
    if (l) out[r.k] = l;
  }
  return out;
}
const companyLocation = company => S.coLoc[companyKey(company)] || null;
function setCompanyLink(company, url){
  const key = companyKey(company), v = String(url || '').trim();
  if (v && !/^https?:\/\/([a-z]+\.)?linkedin\.com\/(company|school|showcase)\/[^\s]+/i.test(v)) throw new Error('That doesn’t look like a LinkedIn company page address');
  if (v) S.coLink[key] = v.split('?')[0]; else delete S.coLink[key];
  return {companies: S.coInd, links: S.coLink};
}

/* ---------- ranks (federal view) ---------- */
function ranks(input){
  const {match} = compile(input);
  const base = S.all.filter(r => match(r, 'branch') && match(r, 'tier') && r.cl.branch);
  const m = {}; let max = 0;
  for (const r of base){ const k = r.cl.tier + '|' + r.cl.branch; m[k] = (m[k] || 0) + 1; max = Math.max(max, m[k]); }
  return {branches: BRANCHES, max, rows: TIERS.map(([t, g]) => ({tier: t, sub: g, cells: BRANCHES.map(b => m[t + '|' + b] || 0), total: base.filter(r => r.cl.tier === t).length})),
    totals: BRANCHES.map(b => base.filter(r => r.cl.branch === b).length), total: base.length};
}

/* ---------- home ---------- */
function stats(){
  const A = live(), n = fn => A.reduce((a, r) => a + (fn(r) ? 1 : 0), 0);
  const newCount = n(r => r.isNew), dueCount = n(r => isDue(r));
  return [
    {id: 'all', label: 'People', value: A.length, detail: newCount ? `+${fmt(newCount)} new this refresh` : 'in your network', up: newCount > 0, act: {kind: 'tab', tab: 'people'}},
    {id: 'jc', label: 'Changed jobs', value: n(r => !!r.jc), detail: 'new title or company', act: {kind: 'filter', sig: ['jc']}},
    ...(S.hasRel ? [{id: 'wait', label: 'Waiting on you', value: n(r => isWaiting(r)), detail: 'unanswered messages', act: {kind: 'filter', sig: ['waiting']}}] : []),
    {id: 'star', label: 'Starred', value: n(r => r.ed && r.ed.star), detail: 'your shortlist', act: {kind: 'filter', sig: ['star']}},
    {id: 'due', label: 'Follow-ups', value: dueCount, detail: dueCount ? 'due now' : 'none due', act: {kind: 'filter', sig: ['due']}},
    ...(S.lens ? [
      {id: 'dod', label: 'Military and DoD', value: n(r => r.cl.seg === 'DoD & Military'), detail: 'serving, civilians, commands', act: {kind: 'filter', seg: ['DoD & Military']}},
      {id: 'vet', label: 'Veterans', value: n(r => r.cl.status === 'Veteran / Retired'), detail: 'at any employer', act: {kind: 'filter', status: ['Veteran / Retired']}},
    ] : [
      {id: 'ind', label: 'Industries', value: new Set(A.map(r => r.cl.ind).filter(i => i !== UNCLASSIFIED)).size, detail: 'see the breakdown', act: {kind: 'industries'}},
    ]),
  ];
}
function cards(opts){
  const lastBackup = (opts && opts.lastBackup) || '';
  const A = live(), out = [];
  const names = (rs, n = 2) => rs.slice(0, n).map(r => fullName(r)).join(', ') + (rs.length > n ? ` and ${fmt(rs.length - n)} more` : '');
  const keys = rs => rs.map(r => r.k);
  const rq = deckCount();
  const overdue = A.filter(isOverdue).sort((a, b) => (CIRCLES[a.ed.circle] - CIRCLES[b.ed.circle]) || lastTouch(a).localeCompare(lastTouch(b)));
  if (overdue.length) out.push({tone: 'amber', icon: 'circle.circle', hero: !rq, title: `${fmt(overdue.length)} ${overdue.length === 1 ? 'person in your circles is' : 'people in your circles are'} overdue`, body: `Time to reach out: ${names(overdue, 2)}.`, people: keys(overdue), act: {kind: 'filter', sig: ['overdue']}});
  if (rq) out.push({tone: 'coral', icon: 'rectangle.stack', hero: true, title: `Catch up on ${fmt(rq)} ${rq === 1 ? 'person' : 'people'}`, body: 'New connections and job changes since your last refresh. Swipe right to star, left to skip. Takes a couple of minutes.', people: keys(A.filter(r => r.isNew || r.movedNow).sort(bySenior)), act: {kind: 'tab', tab: 'catchup'}});
  const due = A.filter(r => isDue(r)).sort((a, b) => (a.ed.due || '').localeCompare(b.ed.due || ''));
  if (due.length) out.push({tone: 'violet', icon: 'bell', title: `${fmt(due.length)} ${due.length === 1 ? 'follow-up' : 'follow-ups'} due`, body: `You planned to reach out to ${names(due, 2)}.`, people: keys(due), act: {kind: 'filter', sig: ['due']}});
  const waiting = A.filter(r => isWaiting(r)).sort((a, b) => b.rx.t.localeCompare(a.rx.t));
  if (waiting.length) out.push({tone: 'coral', icon: 'arrowshape.turn.up.left', title: `${fmt(waiting.length)} ${waiting.length === 1 ? 'person is' : 'people are'} waiting on your reply`, body: `They wrote last and you haven’t answered: ${names(waiting, 2)}.`, people: keys(waiting), act: {kind: 'filter', sig: ['waiting']}});
  const cooling = A.filter(r => isCooling(r)).sort((a, b) => b.wm.score - a.wm.score || a.cl.lv - b.cl.lv);
  if (cooling.length) out.push({tone: 'sky', icon: 'snowflake', title: `${fmt(cooling.length)} good ${cooling.length === 1 ? 'relationship is' : 'relationships are'} going cold`, body: `You used to talk regularly but it’s been a while: ${cooling.slice(0, 2).map(r => `${fullName(r)} (${ago(r.rx.t)})`).join(', ')}${cooling.length > 2 ? ` and ${fmt(cooling.length - 2)} more` : ''}.`, people: keys(cooling), act: {kind: 'filter', sig: ['cold']}});
  const moved = A.filter(r => r.movedNow).sort(bySenior), senMoved = moved.filter(r => r.cl.lv <= 2);
  if (senMoved.length){
    const top = senMoved[0];
    out.push({tone: 'sky', icon: 'briefcase', title: `${fmt(senMoved.length)} senior ${senMoved.length === 1 ? 'person' : 'people'} changed jobs`, body: `${fullName(top)} is now ${top.p || 'in a new role'}${top.c ? ' at ' + top.c : ''}.${senMoved.length > 1 ? ' Also ' + names(senMoved.slice(1), 2) + '.' : ''} A good moment to say congratulations.`, people: keys(senMoved), act: {kind: 'filter', sig: ['jcw']}});
  } else if (moved.length) out.push({tone: 'sky', icon: 'briefcase', title: `${fmt(moved.length)} ${moved.length === 1 ? 'person' : 'people'} changed jobs`, body: names(moved, 3) + '.', people: keys(moved), act: {kind: 'filter', sig: ['jcw']}});
  const fresh = A.filter(r => r.isNew).sort(bySenior);
  if (fresh.length) out.push({tone: 'amber', icon: 'person.badge.plus', title: `${fmt(fresh.length)} new ${fresh.length === 1 ? 'connection' : 'connections'}`, body: `Most senior: ${names(fresh, 2)}.`, people: keys(fresh), act: {kind: 'filter', sig: ['new']}});
  const orgsM = new Map();
  for (const r of A){ const o = r.cl.agency || r.c; if (!o) continue; if (!orgsM.has(o)) orgsM.set(o, []); orgsM.get(o).push(r); }
  const firsts = [...orgsM.entries()].filter(([, rs]) => rs.every(r => r.isNew)).sort((a, b) => Math.min(...a[1].map(r => r.cl.lv)) - Math.min(...b[1].map(r => r.cl.lv))).slice(0, 2);
  for (const [o, rs] of firsts) out.push({tone: 'violet', icon: 'flag', title: `Your first ${rs.length === 1 ? 'contact' : 'contacts'} at ${o}`, body: `${names(rs.sort(bySenior), 2)}. ${isTarget(o) ? 'It’s on your watchlist.' : 'Open the company to add it to your watchlist.'}`, people: keys(rs), act: {kind: 'unit', name: o}});
  if (S.targets.length){
    const weak = S.targets.map(t => { const ps = unitPeople(t.name), cov = coverage(ps); return {t, ps, cov, gaps: gapsOf(cov)}; }).filter(x => x.gaps.length).sort((a, b) => a.cov.score - b.cov.score).slice(0, 3);
    for (const w of weak) out.push({tone: 'amber', icon: 'scope', title: `${w.t.name}: ${w.gaps[0].replace(/^No /, 'no ').replace(/^Only/, 'only')}`, body: `You know ${fmt(w.ps.length)} ${w.ps.length === 1 ? 'person' : 'people'} there. ${w.gaps.length > 1 ? w.gaps.slice(1).join('. ') + '.' : ''}`.trim(), people: keys(w.ps.sort(bySenior)), act: {kind: 'unit', name: w.t.name}, ring: w.cov.score});
  } else out.push({tone: 'amber', icon: 'scope', title: 'Start a watchlist', body: 'Pick the companies you’re working. Home will tell you where you don’t know anyone senior yet.', people: [], act: {kind: 'addTarget'}});
  let anniv = A.filter(r => isAnniversary(r.d)).sort((a, b) => (a.d || '').localeCompare(b.d || ''));
  if (anniv.length > 15){ const y = new Date().getFullYear(); anniv = anniv.filter(r => (y - +r.d.slice(0, 4)) % 5 === 0); }
  if (anniv.length){ const y = new Date().getFullYear(); out.push({tone: 'green', icon: 'gift', title: `${fmt(anniv.length)} connection ${anniv.length === 1 ? 'anniversary' : 'anniversaries'} this week`, body: 'An easy reason to say hello: ' + anniv.slice(0, 2).map(r => `${fullName(r)} (${y - +r.d.slice(0, 4)} ${y - +r.d.slice(0, 4) === 1 ? 'year' : 'years'})`).join(', ') + (anniv.length > 2 ? ` and ${anniv.length - 2} more.` : '.'), people: keys(anniv), act: {kind: 'filter', sig: ['anniv']}}); }
  const quiet = A.filter(r => r.ed && r.ed.star && !r.ed.due && (!r.ed.updated || daysAgo(r.ed.updated) > 45));
  if (quiet.length) out.push({tone: 'amber', icon: 'star', title: `Check in with ${fmt(quiet.length)} starred ${quiet.length === 1 ? 'person' : 'people'}`, body: 'You haven’t added a note in over six weeks: ' + names(quiet, 2) + '.', people: keys(quiet), act: {kind: 'filter', sig: ['star']}});
  const indM = new Map(); A.forEach(r => { if ((!S.lens || r.cl.ind !== GOV_IND) && r.cl.ind !== UNCLASSIFIED) indM.set(r.cl.ind, (indM.get(r.cl.ind) || 0) + 1); });
  const topInd = [...indM.entries()].sort((a, b) => b[1] - a[1]);
  if (topInd.length) out.push({tone: 'violet', icon: 'square.grid.2x2', title: `You know people in ${fmt(topInd.length)} industries${S.lens ? ' outside government' : ''}`, body: 'Biggest: ' + topInd.slice(0, 3).map(([k, n]) => `${k} (${fmt(n)})`).join(', ') + '.', people: [], act: {kind: 'industries'}, bars: topInd.slice(0, 7).map(([k, n]) => [k, n, indColor(k)])});
  const uc = unclassifiedCompanies();
  if (uc.length){ const n = uc.reduce((a, [, v]) => a + v, 0); out.push({tone: 'coral', icon: 'tag', title: `${fmt(uc.length)} ${uc.length === 1 ? 'company needs' : 'companies need'} an industry`, body: `${fmt(n)} ${n === 1 ? 'person isn’t' : 'people aren’t'} sorted yet. Biggest: ${uc.slice(0, 3).map(([c]) => c).join(', ')}. Pick an industry once per company and it sticks.`, people: [], act: {kind: 'industries'}}); }
  const nNotes = Object.keys(S.edits).length;
  if (S.mode === 'live' && nNotes >= 5 && daysSince(lastBackup) > 30) out.push({tone: 'green', icon: 'externaldrive', title: 'Back up your notes', body: `You have notes, stars or follow-ups on ${fmt(nNotes)} people. Save a backup file somewhere safe. It takes one tap.`, people: [], act: {kind: 'backup'}});
  if (S.lens){ const dod = A.filter(r => r.cl.seg === 'DoD & Military').length, vets = A.filter(r => r.cl.status === 'Veteran / Retired').length; out.push({tone: 'sky', icon: 'chart.pie', title: `${fmt(A.length)} people across ${fmt(orgsM.size)} organizations`, body: `${fmt(dod)} military and DoD, ${fmt(vets)} veterans, ${fmt(A.filter(r => r.cl.seg === 'Federal Civilian').length)} federal civilian. Open Explore to see how they group.`, people: [], act: {kind: 'tab', tab: 'explore'}}); }
  else out.push({tone: 'sky', icon: 'chart.pie', title: `${fmt(A.length)} people across ${fmt(orgsM.size)} companies`, body: 'Open Explore to see who you know where.', people: [], act: {kind: 'tab', tab: 'explore'}});
  return out;
}
function home(opts){ return {stats: stats(), cards: cards(opts)}; }
function payoff(){
  const A = live();
  const inds = new Map(); A.forEach(r => { if (r.cl.ind !== UNCLASSIFIED) inds.set(r.cl.ind, (inds.get(r.cl.ind) || 0) + 1); });
  const top = [...inds.entries()].sort((a, b) => b[1] - a[1]);
  return {total: A.length, companies: new Set(A.map(r => r.c).filter(Boolean)).size, execs: A.filter(r => r.cl.lv === 1).length, dirs: A.filter(r => r.cl.lv === 2).length,
    industries: top.length, top: top.slice(0, 5).map(([k, n]) => [k, n, indColor(k)]), sample: A.slice().sort(bySenior).slice(0, 7).map(r => r.k)};
}

/* ---------- catch-up deck ---------- */
const deckMarker = () => 'w' + ((S.meta && S.meta.n) || (S.meta && S.meta.lastImport) || 0);
function deck(mode){
  if (mode === 'all') return S.all.filter(r => !r.x && !S.review[r.k + ':all']).sort((a, b) => hash(a.k + 'deck') - hash(b.k + 'deck')).map(r => r.k);
  const mk = deckMarker();
  return S.all.filter(r => !r.x && (r.isNew || r.movedNow) && S.review[r.k] !== mk).map(r => r.k);
}
function deckCount(){ const mk = deckMarker(); return S.all.filter(r => !r.x && (r.isNew || r.movedNow) && S.review[r.k] !== mk).length; }
function reviewed(k, mode){ S.review[mode === 'all' ? k + ':all' : k] = mode === 'all' ? 'all' : deckMarker(); return {review: S.review}; }

/* ---------- radar layout ---------- */
function radar(input){
  const {match} = compile(input);
  const inView = S.all.filter(r => match(r) && !r.x);
  const G = groupList(), gi = Object.fromEntries(G.map((g, i) => [g.id, i]));
  const counts = G.map(() => 0); for (const r of inView){ const i = gi[groupOf(r)]; if (i != null) counts[i]++; }
  const present = G.map((s, i) => ({s, i, n: counts[i]})).filter(p => p.n);
  const wts = present.map(p => Math.max(Math.pow(p.n, 0.55), 2.2)), tw = wts.reduce((a, b) => a + b, 0) || 1;
  const BANDS = [0.15, 0.37, 0.58, 0.79, 1.0];
  let a = -Math.PI / 2;
  const wedges = present.map((p, j) => { const span = wts[j] / tw * Math.PI * 2; const w = {id: p.s.id, short: p.s.short, color: p.s.color, a0: a, a1: a + span, n: p.n, i: p.i}; a += span; return w; });
  const byI = new Map(wedges.map(w => [w.i, w]));
  const dots = [];
  for (const r of inView){
    const w = byI.get(gi[groupOf(r)]); if (!w) continue;
    const span = w.a1 - w.a0, pad = Math.min(0.02, span * 0.15);
    const t = w.a0 + pad + h01(r.k, 'a') * (span - 2 * pad);
    const band = Math.min(Math.max(r.cl.lv, 1), 4) - 1;
    const rr = BANDS[band] + (0.1 + 0.8 * h01(r.k, 'r')) * (BANDS[band + 1] - BANDS[band]);
    dots.push({k: r.k, x: +(Math.cos(t) * rr).toFixed(4), y: +(Math.sin(t) * rr).toFixed(4), c: w.color, big: !!(r.isNew || (r.ed && r.ed.star))});
  }
  return {wedges: wedges.map(({i, ...w}) => w), dots, bands: BANDS};
}

/* ---------- compass (home) ---------- */
// You in the middle. Distance is how close you are (or seniority, without messages);
// direction is the sector. Flags: w waiting on you, j new job, n new connection, s starred.
function compass(input){
  const {match} = compile(input || {});
  const inView = S.all.filter(r => match(r) && !r.x);
  const G = groupList(), gi = Object.fromEntries(G.map((g, i) => [g.id, i]));
  const counts = G.map(() => 0); for (const r of inView){ const i = gi[groupOf(r)]; if (i != null) counts[i]++; }
  const present = G.map((s, i) => ({s, i, n: counts[i]})).filter(p => p.n);
  const wts = present.map(p => Math.max(Math.pow(p.n, 0.6), 2.4)), tw = wts.reduce((a, b) => a + b, 0) || 1;
  let a = -Math.PI / 2;
  const wedges = present.map((p, j) => { const span = wts[j] / tw * Math.PI * 2; const w = {id: p.s.id, short: p.s.short, color: p.s.color, a0: a, a1: a + span, n: p.n, i: p.i, close: 0, flagged: 0}; a += span; return w; });
  const byI = new Map(wedges.map(w => [w.i, w]));
  const rel = S.hasRel;
  const RINGS = rel ? [[0.34, 'Close'], [0.58, 'Warm'], [0.80, 'Light'], [1.0, 'Not in touch']] : [[0.30, 'Executives'], [0.55, 'Directors'], [0.78, 'Managers'], [1.0, 'Everyone else']];
  const dots = [], tally = {w: 0, o: 0, j: 0, n: 0, s: 0, close: 0};
  for (const r of inView){
    const w = byI.get(gi[groupOf(r)]); if (!w) continue;
    const span = w.a1 - w.a0, pad = Math.min(0.03, span * 0.12);
    const t = w.a0 + pad + h01(r.k, 'a') * (span - 2 * pad);
    let rr;
    if (rel){
      const sc = r.wm.score;
      rr = sc >= 60 ? 0.10 + (100 - sc) / 40 * 0.22 : sc >= 35 ? 0.36 + (59 - sc) / 24 * 0.20 : sc >= 12 ? 0.60 + (34 - sc) / 22 * 0.18 : 0.82 + h01(r.k, 'r') * 0.15;
      rr += (h01(r.k, 'j') - 0.5) * 0.03;
    } else {
      const band = Math.min(Math.max(r.cl.lv, 1), 4) - 1, lo = [0.1, 0.32, 0.57, 0.80][band], hi = RINGS[band][0] - 0.02;
      rr = lo + h01(r.k, 'r') * (hi - lo);
    }
    rr = Math.max(0.09, Math.min(0.98, rr));
    const f = isWaiting(r) ? 'w' : isOverdue(r) ? 'o' : r.movedNow ? 'j' : r.isNew ? 'n' : (r.ed && r.ed.star) ? 's' : '';
    if (f) { tally[f]++; w.flagged++; }
    if (rel && r.wm.score >= 60) { tally.close++; w.close++; }
    const dot = {k: r.k, a: +t.toFixed(3), r: +rr.toFixed(3), c: w.color}; if (f) dot.f = f;
    dots.push(dot);
  }
  return {wedges: wedges.map(({i, ...w}) => w), dots, rings: RINGS.map(([r, label]) => ({r, label})), rel, total: dots.length, tally};
}

/* ---------- clusters (constellation) ---------- */
// People gather around their company or command; groups sit in wedges by industry or segment.
function clusters(input, opts){
  const {match} = compile(input);
  const rows = S.all.filter(r => match(r) && !r.x);
  const TAU = Math.PI * 2;
  const segOrder = groupList().map(g => g.id);
  const groups = new Map();
  for (const r of rows){ const key = r.cl.agency || r.c || 'No company listed'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  let list = [...groups.entries()].map(([name, ps]) => ({name, ps})).sort((a, b) => b.ps.length - a.ps.length || a.name.localeCompare(b.name));
  const MAX = (opts && opts.max) || 40;
  const keep = list.slice(0, MAX), rest = list.slice(MAX), other = new Map();
  for (const g of rest) for (const r of g.ps){ const gi = groupList().find(x => x.id === groupOf(r)); const sh = gi ? gi.short : 'Other'; const k = sh === 'Other' ? 'Other orgs' : 'Other ' + sh; if (!other.has(k)) other.set(k, []); other.get(k).push(r); }
  list = keep.concat([...other.entries()].map(([name, ps]) => ({name, ps, other: true})));
  for (const h of list){
    const cnt = {}; for (const r of h.ps){ const g = groupOf(r); cnt[g] = (cnt[g] || 0) + 1; }
    h.seg = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    h.ps.sort((a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn);
  }
  const segs = segOrder.filter(sg => list.some(h => h.seg === sg));
  const segW = segs.map(sg => Math.sqrt(list.filter(h => h.seg === sg).reduce((a, h) => a + h.ps.length, 0)) + 2);
  const tw = segW.reduce((a, b) => a + b, 0) || 1;
  let a = -Math.PI / 2; const segA = {};
  segs.forEach((sg, i) => { const span = segW[i] / tw * TAU; segA[sg] = {a0: a, span}; a += span; });
  const counter = {};
  const hubs = list.map(h => {
    const j = counter[h.seg] = (counter[h.seg] || 0) + 1, sa = segA[h.seg];
    const ang = sa.a0 + sa.span * (0.5 + (h01(h.name, 'ang') - 0.5) * 0.8);
    const dist = 210 + Math.sqrt(j) * 120 + h01(h.name, 'd') * 60;
    return {name: h.name, seg: h.seg, ps: h.ps, other: !!h.other, ax: Math.cos(ang) * dist, ay: Math.sin(ang) * dist, R: 14 + Math.sqrt(h.ps.length) * 6};
  });
  const P = hubs.map(h => ({x: h.ax, y: h.ay, R: h.R}));
  for (let it = 0; it < 220; it++){
    for (let i = 0; i < P.length; i++){
      const pi = P[i]; pi.x += (hubs[i].ax - pi.x) * 0.02; pi.y += (hubs[i].ay - pi.y) * 0.02;
      for (let k = i + 1; k < P.length; k++){
        const pk = P[k], dx = pk.x - pi.x, dy = pk.y - pi.y, d = Math.hypot(dx, dy) || 0.01, min = pi.R + pk.R + 46;
        if (d < min){ const push = (min - d) / 2, ux = dx / d, uy = dy / d; pi.x -= ux * push; pi.y -= uy * push; pk.x += ux * push; pk.y += uy * push; }
      }
      const d0 = Math.hypot(pi.x, pi.y) || 0.01, minC = 120 + pi.R;
      if (d0 < minC){ pi.x *= minC / d0; pi.y *= minC / d0; }
    }
  }
  const people = [];
  const outHubs = hubs.map((h, i) => {
    const x = P[i].x, y = P[i].y;
    let ring = 0, idx = 0, cap = 0;
    const start = h01(h.name, 'rot') * TAU;
    for (const r of h.ps){
      if (idx >= cap){ ring++; idx = 0; cap = Math.max(6, Math.floor(TAU * (h.R + 4 + ring * 9) / 9)); }
      const ang = start + idx / cap * TAU + ring * 0.37; idx++;
      const rr = h.R + 4 + ring * 9;
      people.push({k: r.k, h: i, x: +(x + Math.cos(ang) * rr).toFixed(1), y: +(y + Math.sin(ang) * rr).toFixed(1), c: groupColor(groupOf(r)), y0: +(r.d || '0').slice(0, 4) || 0, star: !!(r.ed && r.ed.star), w: r.wm.band});
    }
    return {name: h.name, seg: h.seg, color: groupColor(h.seg), other: h.other, n: h.ps.length, x: +x.toFixed(1), y: +y.toFixed(1), R: +h.R.toFixed(1)};
  });
  const years = people.map(p => p.y0).filter(Boolean);
  return {hubs: outHubs, people, minYear: years.length ? Math.min(...years) : 0, maxYear: years.length ? Math.max(...years) : 0};
}

/* ---------- places ---------- */
// Clues in titles and company names, like "Greensboro, NC" or "Raleigh". Weak, so it's the last resort.
function placeClues(){
  const out = [];
  for (const r of S.all){
    if (r.x) continue;
    const t = `${r.p || ''} | ${r.c || ''}`;
    const m = t.match(/\b([A-Z][a-zA-Z.]+(?: [A-Z][a-zA-Z.]+){0,2}),\s*([A-Z]{2})\b/);
    if (m) out.push([r.k, m[1], m[2]]);
  }
  return out;
}

/* ---------- edits ---------- */
function setEdit(k, patch){
  const cur = Object.assign({}, S.edits[k] || {}, patch || {});
  for (const f of Object.keys(cur)) if (cur[f] === '' || cur[f] === false || cur[f] == null || (Array.isArray(cur[f]) && !cur[f].length) || f === 'updated') delete cur[f];
  if (Object.keys(cur).length) S.edits[k] = Object.assign({updated: TODAY}, cur); else delete S.edits[k];
  rehydrate();
  return {edits: S.edits};
}
const followUp = (k, days) => setEdit(k, {due: days ? addDays(days) : ''});
function markReplied(k){ const r = S.byK.get(k); if (!r || !r.rx || !r.rx.t) return {edits: S.edits}; return setEdit(k, {replied: r.rx.t}); }
function addNote(k, text, source){
  const r = S.byK.get(k); if (!r) return {edits: S.edits};
  const cur = (r.ed && r.ed.note) || '';
  return setEdit(k, {note: ((cur ? cur + '\n' : '') + `${TODAY}${source ? ' (' + source + ')' : ''}: ${String(text).slice(0, 500)}`).slice(-4000)});
}

const touch = k => setEdit(k, {touched: TODAY});
const setCircle = (k, c) => setEdit(k, {circle: CIRCLES[c] ? c : ''});

/* ---------- Monday brief ---------- */
// Five people worth reaching out to this week, each with one plain reason. The
// app saves the week's picks so the list stays put while you work through it.
function weekly(skip){
  const avoid = new Set(skip || []);
  const A = live().filter(r => !avoid.has(r.k));
  const seen = new Set(), out = [];
  const take = (list, kind, why, max) => {
    let n = 0;
    for (const r of list){
      if (out.length >= 5 || n >= max) break;
      if (seen.has(r.k)) continue;
      seen.add(r.k); n++;
      out.push({k: r.k, kind, why: why(r)});
    }
  };
  take(A.filter(isWaiting).sort((a, b) => b.rx.t.localeCompare(a.rx.t)), 'reply', r => `Wrote you ${ago(r.rx.t)} and is waiting on a reply.`, 2);
  take(A.filter(isOverdue).sort((a, b) => CIRCLES[a.ed.circle] - CIRCLES[b.ed.circle]), 'circle', r => `In your ${({inner: 'inner circle', key: 'key relationships', wide: 'wider network'})[r.ed.circle]}; ${lastTouch(r) ? 'last in touch ' + ago(lastTouch(r)) : 'not in touch yet'}.`, 2);
  take(A.filter(isDue).sort((a, b) => a.ed.due.localeCompare(b.ed.due)), 'due', r => `You planned to follow up ${r.ed.due < TODAY ? 'on ' + niceDate(r.ed.due) : 'today'}.`, 2);
  take(A.filter(r => r.movedNow).sort(bySenior), 'congrats', r => `New role${r.p ? ' as ' + r.p : ''}${r.c ? ' at ' + r.c : ''}. A good moment to say congratulations.`, 2);
  take(A.filter(isCooling).sort((a, b) => b.wm.score - a.wm.score), 'cold', r => `You used to talk often; last message ${ago(r.rx.t)}.`, 2);
  take(A.filter(r => isAnniversary(r.d)).sort(bySenior), 'anniv', r => `${new Date().getFullYear() - +r.d.slice(0, 4)} years connected this week.`, 1);
  take(A.filter(r => r.isNew && !(r.rx && r.rx.m)).sort(bySenior), 'new', r => `New connection${r.cl.sen ? ', ' + r.cl.sen.toLowerCase() : ''}. Say thanks while it’s fresh.`, 2);
  // still short: warm people you haven't talked to in a while
  take(A.filter(r => r.wm.score >= 35 && daysSince(lastTouch(r)) > 120).sort((a, b) => b.wm.score - a.wm.score), 'checkin', r => `A good relationship you haven’t touched in ${ago(lastTouch(r)).replace(' ago', '')}.`, 5);
  return out;
}

/* ---------- intro finder ---------- */
// "Who can get me into X?": people there now, people who used to be, and people
// you're close to in the same sector, with the best few paths first.
const coKey = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(the|inc|llc|ltd|corp|corporation|co|company|incorporated|plc|gmbh|lp|llp|group|holdings)\b/g, ' ').replace(/\s+/g, ' ').trim();
function introPaths(q){
  const want = coKey(q);
  if (want.length < 2) return {company: '', ind: '', now: [], alumni: [], sector: [], best: [], team: []};
  const hit = c => { const k = coKey(c); return !!k && (k === want || (want.length >= 4 && (k.startsWith(want + ' ') || k.includes(' ' + want + ' ') || k.endsWith(' ' + want)))); };
  const A = live();
  const warmFirst = (a, b) => b.wm.score - a.wm.score || a.cl.lv - b.cl.lv;
  const now = A.filter(r => hit(r.c) || hit(r.cl.agency)).sort(warmFirst);
  const nowSet = new Set(now.map(r => r.k));
  const alumni = [];
  for (const r of A){
    if (nowSet.has(r.k)) continue;
    const p = (r.pv || []).find(x => hit(x.c));
    if (p) alumni.push({r, was: p.p || '', until: p.until || ''});
  }
  alumni.sort((a, b) => warmFirst(a.r, b.r));
  const counts = {}; for (const r of now) counts[r.cl.ind] = (counts[r.cl.ind] || 0) + 1;
  const ind = S.coInd[q] || Object.entries(counts).filter(([i]) => i !== UNCLASSIFIED).sort((a, b) => b[1] - a[1]).map(([i]) => i)[0] || '';
  const sector = ind ? A.filter(r => !nowSet.has(r.k) && r.cl.ind === ind && r.wm.score >= 35 && !alumni.some(a => a.r.k === r.k)).sort(warmFirst).slice(0, 12) : [];
  const best = [];
  for (const r of now.filter(r => r.wm.score >= 35).slice(0, 3)) best.push({k: r.k, why: `Works there now. ${BAND_LABEL[r.wm.band]}${r.rx && r.rx.t ? ', last talked ' + niceDate(r.rx.t) : ''}.`});
  for (const a of alumni.filter(a => a.r.wm.score >= 35).slice(0, 2)) best.push({k: a.r.k, why: `Used to work there${a.was ? ' as ' + a.was : ''}. ${BAND_LABEL[a.r.wm.band]}.`});
  if (best.length < 3) for (const r of now.filter(r => r.wm.score < 35).sort((a, b) => a.cl.lv - b.cl.lv).slice(0, 3 - best.length)) best.push({k: r.k, why: `Works there now${r.cl.sen ? ', ' + r.cl.sen.toLowerCase() : ''}. You haven’t talked much yet.`});
  if (best.length < 3) for (const r of sector.slice(0, 3 - best.length)) best.push({k: r.k, why: `Close to you in ${ind}. Likely knows people there.`});
  const name = (now[0] && (hit(now[0].c) ? now[0].c : now[0].cl.agency)) || (alumni[0] && (alumni[0].r.pv || []).find(x => hit(x.c))?.c) || q;
  return {company: name, ind, now: now.slice(0, 50).map(r => r.k), alumni: alumni.slice(0, 30).map(a => ({k: a.r.k, was: a.was, until: a.until})), sector: sector.map(r => r.k), best: best.slice(0, 4), team: teamPaths(hit)};
}

/* ---------- import ---------- */
function importTexts(t, device){
  if (!t || !t.connections) throw new Error('No Connections.csv in that file. Request the export with “Connections” selected.');
  const rows = rowsFromCSV(t.connections);
  const rel = {messages: t.messages || '', invitations: t.invitations || '', endGiven: t.endGiven || '', endRecv: t.endRecv || '', recGiven: t.recGiven || '', recRecv: t.recRecv || ''};
  if (Object.values(rel).some(Boolean)) rows.rel = relationsFromArchive(rel, rows);
  const plan = mergeImport(rows, S.mode === 'live' ? S.all : null, S.mode === 'live' ? S.meta : null);
  const out = plan.rows.map(stripRow).map(r => { delete r._new; return r; });
  plan.meta.count = out.length; plan.meta.rev = Date.now() + '-' + Math.random().toString(36).slice(2, 8); plan.meta.device = device || 'ios';
  S.pending = {meta: plan.meta, rows: out};
  const wasStarter = S.mode === 'starter';
  if (wasStarter) carryStarterNotes(out);
  return {stats: plan.stats, wasSample: S.mode === 'sample', wasStarter};
}

/* ---------- team packs ---------- */
// A teammate shares a pack: who they know, at which company, and how well. No notes, emails,
// messages or tags. Packs stay on your device and only feed "Ways in".
const BAND_RANK = {strong: 3, warm: 2, light: 1, none: 0};
function teamPack(owner){
  const people = live().map(r => ({f: r.f, l: r.l, c: r.c || '', p: r.p || '', u: r.u || '', b: r.wm ? r.wm.band : 'none'}));
  return JSON.stringify({kind: 'bearings-team-pack', v: 1, owner: String(owner || 'A teammate').slice(0, 80), made: TODAY, people});
}
function addTeamPack(text){
  let d; try { d = JSON.parse(text); } catch { d = null; }
  if (!d || d.kind !== 'bearings-team-pack' || !Array.isArray(d.people)) throw new Error('That isn’t a Bearings team pack.');
  const owner = String(d.owner || 'A teammate').slice(0, 80);
  const people = d.people.slice(0, 50000).filter(p => p && (p.f || p.l)).map(p => ({f: String(p.f || '').slice(0, 80), l: String(p.l || '').slice(0, 80),
    c: String(p.c || '').slice(0, 160), p: String(p.p || '').slice(0, 240), u: String(p.u || '').slice(0, 300), b: BAND_RANK[p.b] != null ? p.b : 'none'}));
  S.team = S.team.filter(t => t.owner !== owner).concat([{owner, made: String(d.made || TODAY).slice(0, 10), people}]);
  return {owner, count: people.length, packs: teamList()};
}
function removeTeamPack(owner){ S.team = S.team.filter(t => t.owner !== owner); return teamList(); }
function teamList(){ return S.team.map(t => ({owner: t.owner, made: t.made, count: t.people.length})); }
/** Teammates' people at a company, best first, plus who on the team covers it. */
function teamPaths(hit){
  const out = [];
  for (const t of S.team) for (const p of t.people) if (hit(p.c)) out.push({owner: t.owner, name: `${p.f} ${p.l}`.trim(), c: p.c, p: p.p, u: p.u, b: p.b});
  out.sort((a, b) => BAND_RANK[b.b] - BAND_RANK[a.b] || a.name.localeCompare(b.name));
  return out.slice(0, 40);
}

/* ---------- year in review ---------- */
// A shareable look back at the year: who joined your network, the job changes you caught,
// who you talked with and who you reconnected with. Counts only, for the card.
function yearInReview(year){
  const y = String(year || TODAY.slice(0, 4));
  const inYear = d => !!d && String(d).slice(0, 4) === y;
  const A = live();
  const joined = A.filter(r => inYear(r.d));
  const moved = A.filter(r => inYear(r.jc));
  const talked = A.filter(r => r.rx && inYear(r.rx.t));
  const reconnected = A.filter(r => r.ed && (inYear(r.ed.touched) || inYear(r.ed.replied)));
  const notes = A.filter(r => r.ed && inYear(r.ed.updated)).length;
  const months = Array(12).fill(0); for (const r of joined) months[+r.d.slice(5, 7) - 1]++;
  const sectors = new Map(); for (const r of joined){ const g = groupOf(r); sectors.set(g, (sectors.get(g) || 0) + 1); }
  const topSectors = [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({id, n, color: groupColor(id)}));
  const topCompanies = topCompanies_(joined, 3);
  const closest = talked.slice().sort((a, b) => b.wm.score - a.wm.score).slice(0, 5).map(r => r.k);
  const best = months.indexOf(Math.max(...months));
  return {year: +y, total: A.length, joined: joined.length, moved: moved.length, talked: talked.length, reconnected: reconnected.length, notes,
    months, busiestMonth: joined.length ? best + 1 : 0, topSectors, topCompanies, closest, hasRel: S.hasRel};
}
const topCompanies_ = (ps, n) => topCompanies(ps, n).map(([name, k]) => ({name, n: k}));

/* ---------- LinkedIn's Member Data Portability API (EEA and Switzerland) ---------- */
// The snapshot API returns the same columns as the export's CSV files, as JSON rows per
// domain. Turning them back into CSV text lets the one import path handle both.
const SNAPSHOT_FILES = {CONNECTIONS: 'connections', INBOX: 'messages', INVITATIONS: 'invitations'};
function snapshotCSV(rows){
  if (!Array.isArray(rows) || !rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r || {})))];
  const q = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.map(q).join(',')].concat(rows.map(r => cols.map(c => q(r && r[c])).join(','))).join('\n');
}
function importSnapshot(domains, device){
  const t = {};
  for (const [dom, name] of Object.entries(SNAPSHOT_FILES)){ const csv = snapshotCSV(domains && domains[dom]); if (csv) t[name] = csv; }
  if (!t.connections) throw new Error('LinkedIn didn’t send any connections. Try again in a minute, or use the export file instead.');
  return importTexts(t, device);
}

/* ---------- starter network from the phone's contacts ---------- */
// Instant value while the LinkedIn export is on its way. People come from the
// address book (name, company, title, email); the LinkedIn import replaces them
// later and carries any notes or stars across by email or name.
function startFromContacts(list){
  if (S.mode === 'live') throw new Error('You already have a network from LinkedIn.');
  const seen = new Set(), rows = [];
  for (const c of list || []){
    const f = String(c.f || '').trim(), l = String(c.l || '').trim();
    if (!f && !l) continue;
    const r = {f, l, c: String(c.c || '').trim(), p: String(c.p || '').trim(), e: String(c.e || '').trim().toLowerCase(), fs: TODAY, fi: 1};
    r.k = keyOf(r);
    if (seen.has(r.k)) continue; seen.add(r.k);
    rows.push(stripRow(r));
  }
  if (!rows.length) throw new Error('None of your contacts have a name to work with.');
  const meta = {lastImport: TODAY, n: 1, count: rows.length, rev: Date.now() + '-' + Math.random().toString(36).slice(2, 8), device: 'ios', source: 'contacts'};
  S.pending = {meta, rows};
  return {count: rows.length, companies: new Set(rows.map(r => (r.c || '').toLowerCase()).filter(Boolean)).size, wasSample: S.mode === 'sample'};
}
function carryStarterNotes(incoming){
  const nm = r => `${r.f || ''} ${r.l || ''}`.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const byEmail = new Map(), byName = new Map();
  for (const r of incoming){
    if (r.e) byEmail.set(r.e.toLowerCase(), r.k);
    const n = nm(r); if (!n) continue;
    byName.set(n, byName.has(n) ? null : r.k);
  }
  const moved = {}, review = {}, carried = new Set();
  for (const r of S.all){
    const to = (r.e && byEmail.get(r.e.toLowerCase())) || byName.get(nm(r));
    if (!to) continue;
    carried.add(r.k);
    if (S.edits[r.k]) moved[to] = Object.assign({}, S.edits[to] || {}, S.edits[r.k]);
    if (S.review[r.k]) review[to] = S.review[r.k];
  }
  // anything that didn't match stays too, so no note is ever thrown away
  for (const [k, e] of Object.entries(S.edits)) if (!carried.has(k) && !moved[k]) moved[k] = e;
  for (const [k, v] of Object.entries(S.review)) if (!carried.has(k) && !(k in review)) review[k] = v;
  S.edits = moved; S.review = review;
  // contacts you'd written notes on who aren't LinkedIn connections stay in the network, marked
  // as not in the export, so their notes are still there to find
  for (const r of S.all) if (!carried.has(r.k) && moved[r.k]) incoming.push(Object.assign(stripRow(r), {x: TODAY}));
}

/* ---------- backup, restore, export ---------- */
function backup(){ return JSON.stringify({app: 'order-of-battle', kind: 'notes-backup', version: 1, created: new Date().toISOString(), edits: S.edits, targets: S.targets, companies: S.coInd, links: S.coLink, locations: S.coLoc, review: S.review}); }
function restore(text){
  const data = JSON.parse(text);
  if (!data || data.kind !== 'notes-backup' || typeof data.edits !== 'object') throw new Error('That isn’t a Bearings backup file.');
  let added = 0, kept = 0;
  for (const [k, e] of Object.entries(data.edits || {})){
    const cur = S.edits[k];
    if (!cur){ S.edits[k] = e; added++; }
    else if ((e.updated || '') > (cur.updated || '')){ S.edits[k] = Object.assign({}, cur, e); added++; }
    else kept++;
  }
  for (const t of data.targets || []) if (t && t.name && !S.targets.some(x => x.name === t.name)) S.targets.push(t);
  for (const [k, v] of Object.entries(data.companies || {})) if (!Object.hasOwn(S.coInd, k)) S.coInd[k] = v;
  for (const [k, v] of Object.entries(data.links || {})) if (!Object.hasOwn(S.coLink, k)) S.coLink[k] = v;
  for (const [k, v] of Object.entries(data.locations || {})) if (!Object.hasOwn(S.coLoc, k)) S.coLoc[k] = v;
  for (const [k, v] of Object.entries(data.review || {})) if (!Object.hasOwn(S.review, k)) S.review[k] = v;
  rehydrate();
  return {edits: S.edits, targets: S.targets, companies: S.coInd, links: S.coLink, review: S.review, added, kept};
}
function exportCSV(keys){
  const cols = ['First Name', 'Last Name', 'Company', 'Position', 'Segment', 'Industry', 'Agency / Command', 'Branch', 'Status', 'Rank', 'Grade', 'Rank Tier', 'Seniority', 'Function', 'Certifications', 'Clearance Mentioned', 'Connected On', 'First Seen', 'Job Change', 'LinkedIn URL', 'Email', 'Tags', 'Notes', 'Starred'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const list = keys ? keys.map(k => S.byK.get(k)).filter(Boolean) : live();
  return [cols.join(',')].concat(list.map(r => { const c = r.cl, e = r.ed || {}; return [r.f, r.l, r.c, r.p, c.seg, c.ind, c.agency, c.branch, c.status, c.rank, c.grade, c.tier, c.sen, c.func, c.certs.join('; '), c.clr ? 'Yes' : '', r.d, r.fs, r.jc || '', S.mode === 'sample' ? '' : r.u, r.e, (e.tags || []).join('; '), e.note, e.star ? 'Yes' : ''].map(q).join(','); })).join('\n');
}

/* ---------- reminders and watch ---------- */
function reminders(){
  return S.all.filter(r => r.ed && r.ed.due && !r.x).map(r => ({k: r.k, due: r.ed.due, title: `Follow up with ${r.f} ${r.l}`, body: [r.p, r.c].filter(Boolean).join(' at ') || 'You planned to reach out today.'}));
}
function watch(name){
  const A = live(), pick = new Map();
  const add = (rs, flag) => { for (const r of rs){ const e = pick.get(r.k) || {r, f: new Set()}; e.f.add(flag); pick.set(r.k, e); } };
  add(A.filter(isWaiting), 'w');
  add(A.filter(r => r.ed && r.ed.due), 'd');
  add(A.filter(isCooling), 'c');
  add(A.filter(r => r.movedNow), 'j');
  add(A.filter(r => r.isNew).sort(bySenior).slice(0, 60), 'n');
  add(A.filter(r => isAnniversary(r.d)), 'a');
  add(A.filter(r => r.ed && r.ed.star), 's');
  for (const r of A.filter(r => r.wm && r.wm.score > 0).sort((a, b) => b.wm.score - a.wm.score)){ if (pick.size >= 300) break; if (!pick.has(r.k)) add([r], 'k'); }
  const y = new Date().getFullYear();
  const people = [...pick.values()].slice(0, 400).map(({r, f}) => {
    const o = {k: r.k, n: fullName(r), ti: r.p || '', co: r.c || '', f: [...f].join('')};
    if (r.wm && r.wm.band && r.wm.band !== 'none'){ o.b = r.wm.band; o.sc = r.wm.score; }
    if (r.rx && r.rx.t){ o.lt = r.rx.t; o.dir = r.rx.dir; o.m = r.rx.m; if (r.rx.s) o.sn = String(r.rx.s).slice(0, 140); }
    if (r.ed){ if (r.ed.due) o.due = r.ed.due; if (r.ed.star) o.st = 1; if (r.ed.note) o.no = r.ed.note.slice(-240); }
    if (f.has('a') && r.d) o.yr = y - +r.d.slice(0, 4);
    if (r.d) o.cd = r.d;
    return o;
  });
  return {v: 1, gen: new Date().toISOString(), today: TODAY, sample: S.mode === 'sample', name: name || '', total: A.length, people};
}

/* ---------- loading ---------- */
function info(){
  return {mode: S.mode, count: live().length, removed: S.all.length - live().length, hasRel: S.hasRel, lens: S.lens, lensAuto: autoLens(), lensPref: S.lensPref,
    lastImport: (S.meta && S.meta.lastImport) || '', relImport: (S.meta && S.meta.rel) || '', imports: (S.meta && S.meta.imports) || [], rev: (S.meta && S.meta.rev) || '',
    deckCount: deckCount(), today: TODAY, edits: Object.keys(S.edits).length, targets: S.targets.length};
}
function load(st){
  S.mode = st.mode === 'sample' ? 'sample' : (st.meta && st.meta.source === 'contacts') ? 'starter' : 'live';
  S.meta = st.meta || {};
  S.edits = st.edits || {};
  S.review = st.review || {};
  S.targets = st.targets || [];
  S.coInd = Object.assign(Object.create(null), st.companies || {});
  S.coLink = Object.assign(Object.create(null), st.links || {});
  S.coLoc = Object.assign(Object.create(null), st.locations || {});
  S.team = Array.isArray(st.team) ? st.team : [];
  if ('lens' in st) S.lensPref = st.lens;
  hydrate(st.rows || []);
  return info();
}
function loadSample(){
  const s = sampleNetwork();
  return load({mode: 'sample', rows: s.rows, meta: s.meta || {lastImport: TODAY, n: 1}, edits: s.edits || {}, review: {}, targets: SAMPLE_TARGETS.map(name => ({name, added: TODAY})), lens: S.lensPref});
}
// Native apps hand over the raw saved files; parsing them here keeps one source of truth.
function loadFiles(f, lens){
  const p = t => { if (!t) return null; try { return JSON.parse(t); } catch { return null; } };
  const n = p(f.network), e = p(f.edits), rv = p(f.review), tg = p(f.targets), ci = p(f.industries), tm = p(f.team);
  if (!n || !n.rows) return Object.assign(loadSample(), {empty: true});
  return load({mode: 'live', rows: n.rows, meta: n.meta || {}, edits: (e && e.edits) || {}, review: (rv && rv.review) || {}, targets: (tg && tg.targets) || [],
    companies: (ci && ci.companies) || {}, links: (ci && ci.links) || {}, locations: (ci && ci.locations) || {}, team: (tm && tm.packs) || [], lens});
}
function fileData(name){
  if (name === 'network'){ if (!S.pending) throw new Error('Nothing to save'); const p = S.pending; S.pending = null; return p; }
  if (name === 'edits') return {edits: S.edits, rev: Date.now()};
  if (name === 'review') return {review: S.review};
  if (name === 'targets') return {targets: S.targets};
  if (name === 'industries') return {companies: S.coInd, links: S.coLink, locations: S.coLoc};
  if (name === 'team') return {packs: S.team};
  throw new Error('Unknown file ' + name);
}
function clearNotes(){ S.edits = {}; S.review = {}; S.targets = []; S.coInd = Object.create(null); S.coLink = Object.create(null); S.coLoc = Object.create(null); return true; }
function setLens(pref){ S.lensPref = pref == null ? null : !!pref; applyLens(); return info(); }
// Leaves out empty values so a big network crosses to the app quickly; the app fills in defaults.
const lean = o => {
  if (Array.isArray(o)) return o.map(lean);
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)){
    if (v === '' || v === false || v == null || (Array.isArray(v) && !v.length)) continue;
    out[k] = typeof v === 'object' ? lean(v) : v;
  }
  return out;
};
function people(){ return S.all.map(r => lean(vm(r))); }
function person(k){ const r = S.byK.get(k); if (!r) return null; return Object.assign(vm(r, true), {links: {profile: links.person(r), salesNav: links.snPerson(r)}}); }
function constants(){
  return {industries: INDUSTRIES.map(i => ({id: i.id, short: i.short, color: i.color})), seniority: SENIORITY, funcs: FUNCS, segs: SEGS.map(s => ({id: s.id, short: s.short, color: segColor(s.id)})),
    branches: BRANCHES, statuses: STATUSES, tiers: TIERS, certs: CERTS.map(c => c[0]), since: SINCE, signals: SIGNALS_UI, grades: GRADE_OPTS, bands: BAND_LABEL, unclassified: UNCLASSIFIED, gov: GOV_IND};
}

const api = {load, loadSample, loadFiles, clearNotes, clusters, placeClues, setCompanyLocation, companyPlaces, messages, matchAttendees, alsoAt, setLens, info, people, person, search, facets, home, payoff, targets, unit, addTargetCandidates, toggleTarget, setTargetNote, orgs,
  industries, industry, setCompanyIndustry, setCompanyLink, ranks, deck, deckCount, reviewed, radar, compass, startFromContacts, introPaths, weekly, touch, setCircle, setEdit, followUp, markReplied, addNote,
  importTexts, importSnapshot, yearInReview, teamPack, addTeamPack, removeTeamPack, teamList, backup, restore, exportCSV, reminders, watch, constants};
// Every call goes through here: JSON string in, JSON string out, errors as {error}.
globalThis.Bearings = {
  call(name, argsJSON){
    try {
      const fn = api[name]; if (!fn) throw new Error('Unknown engine call ' + name);
      const args = argsJSON ? JSON.parse(argsJSON) : [];
      const out = fn(...args);
      return JSON.stringify({ok: out === undefined ? null : out});
    } catch (e) { return JSON.stringify({error: (e && e.message) || String(e)}); }
  },
  fileJSON(name){ return JSON.stringify(fileData(name)); },
};
export default api;
