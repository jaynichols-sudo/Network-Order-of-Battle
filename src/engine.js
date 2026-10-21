// Headless "brain" for the native apps. Runs inside JavaScriptCore on iPhone,
// iPad and Mac and exposes the same classification, scoring and search logic the
// web app uses, as plain JSON in and out. No DOM, no timers.
import {quote} from './quotes.js';
import {
  fmt, isoDay, TODAY, daysAgo, niceDate, h01, hash,
  SEGS, SEGI, BRANCHES, STATUSES, TIERS, SENIORITY, FUNCS, SINCE, SIGNALS, GRADE_OPTS, CERTS,
  classify, roleOf, keyOf, stripRow, rowsFromCSV, relationsFromArchive, mergeImport, sampleNetwork, warmth, parseCSV, slugOf,
} from './core.js';
import { parseQuery, matchNL } from './nlq.js';
import { findAgency, officeOf } from './agencies.js';
import {compileFederal, FEDERAL_AS_OF} from './federal.js';
import { matchOpportunities as matchOpps, opportunityFilters, opportunityRequests as oppRequests, opportunityPage, demoOpportunities as demoOpps, markSeen, agencyFor, mergeOpportunities, SET_ASIDE_PROGRAMS } from './opportunities.js';
import { parseFlight, parseICS, tripsFromEvents, tripsFromFeed, feedCheck } from './flights.js';
import { awardRequests as awardReqs, awardPage, awardAgency, awardInCommand, mergeAwardPages, demoAwards as demoAwardList, dollars, money, AWARD_LINK } from './awards.js';
import { INDUSTRIES, indColor, indShort, setIndustryOverrides, companyKey, UNCLASSIFIED, GOV_IND } from './industry.js';

/* ---------- state ---------- */
const S = {all: [], byK: new Map(), edits: {}, review: {}, targets: [], competitors: [], meta: null, mode: 'sample', coInd: Object.create(null), coLink: Object.create(null), coLoc: Object.create(null), lensPref: null, lens: false, hasRel: false, team: [], prospects: [], pursuits: [], snaps: {}, social: []};
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
const isCooling = r => { const x = r.rx; if (!x || x.m < 8 || (x.o || 0) < 3 || (x.i || 0) < 3) return false; if (mailOf(r) && daysSince(mailOf(r).t) <= 150) return false; const d = daysSince(x.t); return d > 150 && d < 900; };
// the latest email with them (dates, direction and subject only), from the mail sync
const mailOf = r => (r.ed && r.ed.mail && r.ed.mail.t) ? r.ed.mail : null;
// they emailed last, recently, and you haven't written back (in email or on LinkedIn) since
const isMailWaiting = r => { const m = mailOf(r); if (!m || m.dir !== 'i' || daysSince(m.t) > 14) return false;
  const after = [(r.rx && r.rx.dir === 'o' && r.rx.t) || '', (r.ed && r.ed.touched) || '', (r.ed && r.ed.replied) || ''];
  return !after.some(t => t && t >= m.t) && !isWaiting(r); };
const isDue = r => !!(r.ed && r.ed.due && r.ed.due <= TODAY);
// keep-in-touch circles: how often you mean to be in touch, in days
const CIRCLES = {inner: 30, key: 90, wide: 365};
const lastTouch = r => [(r.rx && r.rx.t) || '', (r.ed && r.ed.touched) || '', (mailOf(r) && mailOf(r).t) || ''].reduce((a, b) => (b > a ? b : a), '');
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
    waiting: isWaiting(r) || isMailWaiting(r), mailWaiting: isMailWaiting(r), cooling: isCooling(r), due: isDue(r), anniv: isAnniversary(r.d),
    over: isOverdue(r), touch: lastTouch(r), next: touchDue(r)};
  if (r.x) o.x = r.x;
  if (r.jc) o.jc = r.jc;
  if (r.fs) o.fs = r.fs;
  if (r.pv) o.pv = r.pv;
  // the list view gets a slim copy; the profile asks for the full person
  if (r.rx) o.rx = full ? r.rx : Object.fromEntries(Object.entries(r.rx).filter(([k]) => k !== 's' && k !== 'invn'));
  if (r.ed) o.ed = full || !r.ed.note || r.ed.note.length <= 80 ? r.ed : Object.assign({}, r.ed, {note: r.ed.note.slice(0, 80)});
  if (full){ const ml = mailView(r); if (ml) o.mail = ml; }
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
    case 'waiting': return isWaiting(r) || isMailWaiting(r);
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
    return {name: t.name, note: t.note || '', competitor: isCompetitor(t.name), count: ps.length, stars: ps.filter(r => r.ed && r.ed.star).length, news: ps.filter(r => r.isNew || r.movedNow).length, score: cov.score, lv: cov.lv, gap: gaps[0] || 'Covered at every level', gaps};
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
  return {name, count: ps.length, score: cov.score, lv: cov.lv, gaps, isTarget: !!target, competitor: isCo && isCompetitor(name), note: (target && target.note) || '', isCompany: isCo,
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
    ...(S.hasRel || A.some(mailOf) ? [{id: 'wait', label: 'Waiting on you', value: n(r => isWaiting(r) || isMailWaiting(r)), detail: 'unanswered messages', act: {kind: 'filter', sig: ['waiting']}}] : []),
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
  const waiting = A.filter(r => isWaiting(r) || isMailWaiting(r)).sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)));
  if (waiting.length) out.push({tone: 'coral', icon: 'arrowshape.turn.up.left', title: `${fmt(waiting.length)} ${waiting.length === 1 ? 'person is' : 'people are'} waiting on your reply`, body: `They wrote last and you haven’t answered: ${waiting.slice(0, 2).map(r => fullName(r) + (isWaiting(r) ? '' : ' (by email)')).join(', ')}${waiting.length > 2 ? ` and ${fmt(waiting.length - 2)} more` : ''}.`, people: keys(waiting), act: {kind: 'filter', sig: ['waiting']}});
  const cs = coldSeats();
  if (cs.length){ const c = cs[0]; out.push({tone: 'sky', icon: 'thermometer.snowflake', title: `${fmt(cs.length)} pursuit ${cs.length === 1 ? 'seat is' : 'seats are'} going cold`, body: `${c.name} (${c.role.toLowerCase()} on ${c.pursuit}) ${c.days == null ? 'hasn’t heard from you yet' : 'last heard from you ' + c.days + ' days ago'}${c.daysLeft != null ? `, and it’s due in ${c.daysLeft} days` : ''}.`, people: [...new Set(cs.map(x => x.k))], act: {kind: 'pursuit', id: c.pursuitId}}); }
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
function markReplied(k){ const r = S.byK.get(k); const t = [(r && r.rx && r.rx.t) || '', (r && mailOf(r) && mailOf(r).t) || ''].sort().pop(); if (!r || !t) return {edits: S.edits}; return setEdit(k, {replied: t}); }

/* ---------- email ---------- */
// The phone reads only who, when and the subject line from the user's mailbox and hands
// them over; matching to people happens here. rows: [{name, email, date, dir: 'i'|'o', subject}].
// What's kept per person, in edits.mail (compact, headers only, never a body):
//   t, dir, s   the latest email: day, 'i' (from them) or 'o' (from you), subject
//   ti, si      the last email from them and its subject;  to, so  the last one from you
//   n           how many emails in the last 90 days
//   ev          recent emails as [day, dir, subject], newest first, 180 days, at most MAIL_KEEP
const MAIL_KEEP = 40, MAIL_DAYS = 180;
const mailSubject = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
// Fold new header rows into what's already known. Same day, direction and subject count once.
function mergeMail(cur, add){
  const seen = new Set(), ev = [];
  const old = cur && cur.t ? [[cur.t, cur.dir, cur.s || ''], ...(cur.ev || [])] : [];
  for (const e of [...old, ...add]){
    if (!e || !e[0]) continue;
    const key = e.join('\u0001'); if (seen.has(key)) continue;
    seen.add(key); ev.push([e[0], e[1] === 'o' ? 'o' : 'i', e[2] || '']);
  }
  ev.sort((a, b) => b[0].localeCompare(a[0]) || (a[1] === 'o' ? -1 : 1) - (b[1] === 'o' ? -1 : 1));
  const latest = ev[0]; if (!latest) return null;
  const keep = ev.filter(e => daysSince(e[0]) <= MAIL_DAYS).slice(0, MAIL_KEEP);
  const m = {t: latest[0], dir: latest[1], s: latest[2], n: keep.filter(e => daysSince(e[0]) <= 90).length, ev: keep};
  // the last email each way may be older than what's kept in detail; carry it forward
  const last = (dir, oldT, oldS) => { const e = ev.find(x => x[1] === dir); if (e && e[0] >= (oldT || '')) return [e[0], e[2]]; return oldT ? [oldT, oldS || ''] : null; };
  const li = last('i', cur && cur.ti, cur && cur.si), lo = last('o', cur && cur.to, cur && cur.so);
  if (li){ m.ti = li[0]; if (li[1]) m.si = li[1]; }
  if (lo){ m.to = lo[0]; if (lo[1]) m.so = lo[1]; }
  return m;
}
function applyMail(rows){
  const list = (rows || []).filter(x => x && x.date && (x.email || x.name));
  const keys = matchAttendees(list.map(x => ({email: x.email, name: x.name})));
  const best = new Map();
  list.forEach((x, i) => {
    const k = keys[i]; if (!k) return;
    const b = best.get(k) || {ev: [], em: ''};
    b.ev.push([String(x.date).slice(0, 10), x.dir === 'o' ? 'o' : 'i', mailSubject(x.subject)]);
    if (x.email && !b.em) b.em = String(x.email).toLowerCase();
    best.set(k, b);
  });
  let changed = 0;
  for (const [k, b] of best){
    const r = S.byK.get(k); if (!r) continue;
    const cur = mailOf(r);
    const next = mergeMail(cur, b.ev); if (!next) continue;
    if (cur && JSON.stringify(cur) === JSON.stringify(next)) continue;
    const ed = Object.assign({}, S.edits[k] || {});
    ed.mail = next;
    if (b.em && !r.e && !ed.em) ed.em = b.em;
    S.edits[k] = Object.assign(ed, {updated: TODAY});
    changed++;
  }
  if (changed) rehydrate();
  return {matched: best.size, changed, scanned: list.length};
}
// Email on a profile: the last 5 as timeline events (kind 'email-in' / 'email-out'), the
// last one each way, how many in 90 days, and how many older ones aren't listed.
function mailView(r){
  const m = mailOf(r); if (!m) return null;
  const ev = m.ev || [[m.t, m.dir, m.s || '']];
  const events = ev.slice(0, 5).map(e => ({kind: e[1] === 'o' ? 'email-out' : 'email-in', date: e[0], subject: e[2] || ''}));
  return {lastIn: m.ti || (m.dir === 'i' ? m.t : ''), lastOut: m.to || (m.dir === 'o' ? m.t : ''),
    subjectIn: m.si || (m.dir === 'i' ? m.s || '' : ''), subjectOut: m.so || (m.dir === 'o' ? m.s || '' : ''),
    n90: m.n || 0, events, more: Math.max(0, ev.length - events.length)};
}
// Forget every email detail (the user turned the mail source off).
function clearMail(){
  let n = 0;
  for (const k of Object.keys(S.edits)){ const e = S.edits[k]; if (e.mail || e.em){ delete e.mail; delete e.em; n++; if (Object.keys(e).filter(f => f !== 'updated').length === 0) delete S.edits[k]; } }
  if (n) rehydrate();
  return {cleared: n};
}
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
  take(A.filter(isMailWaiting).sort((a, b) => b.ed.mail.t.localeCompare(a.ed.mail.t)), 'reply', r => `Emailed you ${ago(r.ed.mail.t)}${r.ed.mail.s ? ' about “' + r.ed.mail.s + '”' : ''} and is waiting on a reply.`, 2);
  take(A.filter(isOverdue).sort((a, b) => CIRCLES[a.ed.circle] - CIRCLES[b.ed.circle]), 'circle', r => `In your ${({inner: 'inner circle', key: 'key relationships', wide: 'wider network'})[r.ed.circle]}; ${lastTouch(r) ? 'last in touch ' + ago(lastTouch(r)) : 'not in touch yet'}.`, 2);
  take(A.filter(isDue).sort((a, b) => a.ed.due.localeCompare(b.ed.due)), 'due', r => `You planned to follow up ${r.ed.due < TODAY ? 'on ' + niceDate(r.ed.due) : 'today'}.`, 2);
  { const cs = new Map(); for (const c of coldSeats()) if (!cs.has(c.k)) cs.set(c.k, c); take(A.filter(r => cs.has(r.k)), 'seat', r => { const c = cs.get(r.k); return `In the ${c.role.toLowerCase()} seat on ${c.pursuit}${c.daysLeft != null ? ', due in ' + c.daysLeft + ' days' : ''}. ${c.days == null ? 'You haven’t been in touch yet.' : 'Last in touch ' + c.days + ' days ago.'}`; }, 2); }
  take(A.filter(r => r.movedNow).sort(bySenior), 'congrats', r => `New role${r.p ? ' as ' + r.p : ''}${r.c ? ' at ' + r.c : ''}. A good moment to say congratulations.`, 2);
  take(A.filter(isCooling).sort((a, b) => b.wm.score - a.wm.score), 'cold', r => `You used to talk often; last message ${ago(r.rx.t)}.`, 2);
  { const nudge = new Map(introNudges().map(x => [x.via, x])); take(A.filter(r => nudge.has(r.k)), 'intro', r => { const x = nudge.get(r.k); return `You asked for an intro to ${x.to}${x.co ? ' at ' + x.co : ''} ${ago(x.at)}. A friendly nudge?`; }, 1); }
  { const mv = new Map(moves().map(m => [m.k, m])); take(A.filter(r => mv.has(r.k) && r.wm.score >= 20).sort((a, b) => b.wm.score - a.wm.score), 'move', r => mv.get(r.k).why, 1); }
  take(A.filter(r => isAnniversary(r.d)).sort(bySenior), 'anniv', r => `${new Date().getFullYear() - +r.d.slice(0, 4)} years connected this week.`, 1);
  take(A.filter(r => r.isNew && !(r.rx && r.rx.m)).sort(bySenior), 'new', r => `New connection${r.cl.sen ? ', ' + r.cl.sen.toLowerCase() : ''}. Say thanks while it’s fresh.`, 2);
  // still short: warm people you haven't talked to in a while
  take(A.filter(r => r.wm.score >= 35 && daysSince(lastTouch(r)) > 120).sort((a, b) => b.wm.score - a.wm.score), 'checkin', r => `A good relationship you haven’t touched in ${ago(lastTouch(r)).replace(' ago', '')}.`, 5);
  return out;
}


/* ---------- pursuits ---------- */
// An opportunity (a bid, a deal) at an agency or company, and the people who decide it:
// who you know in each seat, who could fill an empty one, and your warmest ways in.
const PURSUIT_ROLES = [
  ['Executive sponsor', /\bSES\b|senior executive|\bchief\b|\bgeneral\b|admiral|\bdirector\b|\bdeputy\b|commander|\bCIO\b|\bCTO\b|\bCISO\b|vice president|\bVP\b|president/i],
  ['Program manager', /program (manager|director|executive|lead|analyst)|\bPM\b|\bPEO\b|project manager|portfolio/i],
  ['Contracting officer', /contract(ing|s)?\b.*(officer|specialist|manager|lead)|\bKO\b|\bPCO\b|\bACO\b|procurement|acquisition|purchasing|buyer/i],
  ['Mission owner', /operations|\bops\b|mission|division chief|branch chief|commander|site lead|plant|facilit/i],
  ['Security lead', /\bISSM\b|\bISSO\b|\bCISO\b|cyber|security|information assurance|\bRMF\b|authoriz|\bAO\b/i],
  ['Technical lead', /engineer|architect|technical|\bCTO\b|\bIT\b|systems|network|infrastructure|\bOT\b|\bICS\b|SCADA/i],
  // the industry side: who holds the work today, and who you'd bid it with. Filled from the
  // companies named on the pursuit, not from the agency.
  ['Incumbent', null, 'incumbent'],
  ['Teaming partner', null, 'partners'],
];
const STAGES = ['Tracking', 'Pursuing', 'Proposal', 'Submitted', 'Won', 'Lost'];
// What a pursuit at each stage usually wins, when no one has set a number.
const STAGE_PWIN = {Tracking: 10, Pursuing: 25, Proposal: 40, Submitted: 50, Won: 100, Lost: 0};
const isOpen = p => STAGES.indexOf(p.stage) < 4;
const coHit = q => {
  const want = coKey(q);
  return c => { const k = coKey(c); return want.length >= 2 && !!k && (k === want || (want.length >= 4 && (k.startsWith(want + ' ') || k.includes(' ' + want + ' ') || k.endsWith(' ' + want)))); };
};
const atOrg = q => { const hit = coHit(q); return live().filter(r => hit(r.c) || hit(r.cl.agency)); };
const brief = r => ({k: r.k, name: fullName(r), p: r.p || '', band: r.wm.band, score: r.wm.score});
const splitNames = v => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map(x => String(x).trim()).filter(Boolean).slice(0, 12);
/** The companies a company seat is filled from: the incumbent, or the teaming partners. */
const seatCompanies = (p, field) => field === 'incumbent' ? splitNames(p.incumbent).slice(0, 1) : splitNames(p.partners);
const pwinOf = p => p.pwin != null && p.pwin !== '' && isFinite(+p.pwin) ? Math.max(0, Math.min(100, Math.round(+p.pwin))) : STAGE_PWIN[p.stage] ?? 10;
function addPursuit(o){
  const p = {id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: String((o && o.name) || 'New pursuit').trim(),
    agency: String((o && o.agency) || '').trim(), due: (o && o.due) || '', value: (o && o.value) || '', stage: (o && o.stage) || 'Tracking', roles: {}, note: '', created: TODAY};
  for (const f of ['incumbent', 'partners', 'pwin', 'source']) if (o && o[f] != null && o[f] !== '') p[f] = o[f];
  S.pursuits.push(p);
  return p;
}
function updatePursuit(id, patch){
  const p = S.pursuits.find(x => x.id === id); if (!p) return null;
  const was = p.stage;
  for (const f of ['name', 'agency', 'due', 'value', 'stage', 'note', 'incumbent', 'partners']) if (patch && f in patch) p[f] = patch[f];
  if (patch && 'pwin' in patch) { if (patch.pwin == null || patch.pwin === '') delete p.pwin; else p.pwin = Math.max(0, Math.min(100, Math.round(+patch.pwin) || 0)); }
  // remember when it was decided, for the won and lost history
  if (p.stage !== was) { if (p.stage === 'Won' || p.stage === 'Lost') p.closed = TODAY; else delete p.closed; }
  return p;
}
function removePursuit(id){ S.pursuits = S.pursuits.filter(x => x.id !== id); return true; }
function assignRole(id, role, k, on){
  const p = S.pursuits.find(x => x.id === id); if (!p) return null;
  const cur = new Set(p.roles[role] || []);
  if (on === false) cur.delete(k); else cur.add(k);
  p.roles[role] = [...cur];
  if (!p.roles[role].length) delete p.roles[role];
  return p;
}
/** Which teammate owns the relationship in one seat. An empty owner clears it. */
function setSeatOwner(id, role, owner){
  const p = S.pursuits.find(x => x.id === id); if (!p) return null;
  const o = String(owner || '').trim().slice(0, 80);
  p.owners = Object.assign({}, p.owners);
  if (o) p.owners[role] = o; else delete p.owners[role];
  if (!Object.keys(p.owners).length) delete p.owners;
  return p;
}
// A seat goes cold when no one in it has been in touch for this long while the pursuit is open.
const COLD_DAYS = 60, COLD_WINDOW = 120;
/** The seats on an open pursuit whose people you haven't been in touch with lately. */
function coldOf(p){
  if (!isOpen(p)) return [];
  const days = p.due ? -daysSince(p.due) : null;
  if (days != null && (days < 0 || days > COLD_WINDOW)) return [];
  const out = [];
  for (const [role] of PURSUIT_ROLES){
    const rs = (p.roles[role] || []).map(k => S.byK.get(k)).filter(Boolean);
    if (!rs.length) continue;
    const quiet = rs.map(r => ({r, d: daysSince(lastTouch(r))})).sort((a, b) => a.d - b.d);
    if (quiet[0].d <= COLD_DAYS) continue;
    out.push({role, k: quiet[0].r.k, name: fullName(quiet[0].r), days: quiet[0].d >= 99999 ? null : quiet[0].d});
  }
  return out;
}
function pursuitSummary(p){
  const filled = PURSUIT_ROLES.filter(([role]) => (p.roles[role] || []).some(k => S.byK.has(k))).length;
  const people = [...new Set(Object.values(p.roles).flat())].map(k => S.byK.get(k)).filter(Boolean);
  const warm = people.filter(r => ['strong', 'warm'].includes(r.wm.band)).length;
  const days = p.due ? -daysSince(p.due) : null;
  const amount = dollars(p.value);
  return {id: p.id, name: p.name, agency: p.agency, due: p.due, days, value: p.value, stage: p.stage, filled, roles: PURSUIT_ROLES.length, warm, people: people.length,
    pwin: pwinOf(p), pwinSet: p.pwin != null, amount, weighted: Math.round(amount * pwinOf(p) / 100), incumbent: splitNames(p.incumbent)[0] || '', cold: coldOf(p).length,
    next: nextDateOf(p), fiscal: fiscalOf(p.due), competitor: isCompetitor(splitNames(p.incumbent)[0])};
}
function pursuits(){
  return S.pursuits.map(pursuitSummary).sort((a, b) => (STAGES.indexOf(a.stage) > 3) - (STAGES.indexOf(b.stage) > 3) || ((a.due || '9') < (b.due || '9') ? -1 : 1));
}
function pursuit(id){
  const p = S.pursuits.find(x => x.id === id); if (!p) return null;
  const pool = p.agency ? atOrg(p.agency) : [];
  const used = new Set(Object.values(p.roles).flat());
  const cold = new Map(coldOf(p).map(c => [c.role, c]));
  const roles = PURSUIT_ROLES.map(([role, rx, field]) => {
    const people = (p.roles[role] || []).map(k => S.byK.get(k)).filter(Boolean).map(r => Object.assign(brief(r), {last: lastTouch(r)}));
    let suggest = [], companies = [], hint = '';
    if (field){
      companies = seatCompanies(p, field);
      if (!companies.length) hint = field === 'incumbent' ? 'Add the incumbent to see who you know there.' : 'Add teaming partners to see who you know at each.';
      else if (!people.length){
        const hits = companies.map(coHit);
        suggest = live().filter(r => !used.has(r.k) && hits.some(h => h(r.c))).sort((a, b) => b.wm.score - a.wm.score || bySenior(a, b)).slice(0, 3).map(brief);
        if (!suggest.length) hint = `You don’t know anyone at ${companies.join(', ')} yet.`;
      }
    } else if (!people.length) suggest = pool.filter(r => !used.has(r.k) && rx.test(`${r.p} ${r.cl.grade || ''}`))
      .sort((a, b) => b.wm.score - a.wm.score || bySenior(a, b)).slice(0, 3).map(brief);
    const c = cold.get(role);
    return {role, side: field ? 'industry' : 'government', people, suggest, companies, hint, owner: (p.owners && p.owners[role]) || '', cold: !!c, coldDays: c ? c.days : null};
  });
  const ways = p.agency ? introPaths(p.agency) : null;
  return Object.assign(pursuitSummary(p), {note: p.note, stages: STAGES, roleList: roles, partners: splitNames(p.partners), owners: p.owners || {},
    dates: DATE_KINDS.map(([kind, label]) => ({kind, label, date: (kind === 'proposal' ? p.due : p.dates && p.dates[kind]) || ''})),
    bid: bidDecision(p.id), competitors: [splitNames(p.incumbent)[0], ...splitNames(p.partners)].filter(c => c && isCompetitor(c)),
    teammates: S.team.map(t => t.owner), known: pool.length, best: ways ? ways.best : [], team: ways ? ways.team : []});
}
/** Every cold seat on every open pursuit, most urgent first: for Today and the weekly brief. */
function coldSeats(){
  const out = [];
  for (const p of S.pursuits) for (const c of coldOf(p)) out.push(Object.assign({pursuitId: p.id, pursuit: p.name, agency: p.agency, due: p.due, daysLeft: p.due ? -daysSince(p.due) : null}, c));
  return out.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || (b.days ?? 99999) - (a.days ?? 99999));
}

/* ---------- pipeline ---------- */
/** Open pursuits by the fiscal quarter they're due in, soonest first; undated ones last. */
function byQuarter(open){
  const by = new Map();
  for (const r of open){
    const f = fiscalOf(r.due), key = f ? f.fy * 10 + f.q : 99999;
    if (!by.has(key)) by.set(key, {label: f ? f.label : 'No due date', q4: !!(f && f.q4), count: 0, value: 0, weighted: 0});
    const e = by.get(key); e.count++; e.value += r.amount; e.weighted += r.weighted;
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => Object.assign(e, {valueText: money(e.value), weightedText: money(e.weighted)}));
}
// Pursuits as a pipeline: what's open at each stage, weighted by the chance of winning, and
// what's been won and lost. With `withTeam`, teammates' shared pursuits count too.
function pipeline(withTeam){
  const rows = S.pursuits.map(p => ({owner: 'You', mine: true, id: p.id, name: p.name, agency: p.agency, stage: p.stage, due: p.due, value: p.value,
    amount: dollars(p.value), pwin: pwinOf(p), closed: p.closed || ''}));
  if (withTeam) for (const t of S.team) for (const p of t.pursuits || []) rows.push({owner: t.owner, mine: false, id: '', name: p.name, agency: p.agency, stage: p.stage, due: p.due, value: p.value,
    amount: dollars(p.value), pwin: p.pwin != null ? +p.pwin : STAGE_PWIN[p.stage] ?? 10, closed: p.closed || ''});
  for (const r of rows) r.weighted = Math.round(r.amount * r.pwin / 100);
  const stages = STAGES.map(st => {
    const rs = rows.filter(r => r.stage === st);
    const value = rs.reduce((a, r) => a + r.amount, 0), weighted = rs.reduce((a, r) => a + r.weighted, 0);
    return {stage: st, count: rs.length, value, weighted, valueText: money(value), weightedText: money(weighted)};
  });
  const open = rows.filter(r => STAGES.indexOf(r.stage) < 4), won = rows.filter(r => r.stage === 'Won'), lost = rows.filter(r => r.stage === 'Lost');
  const sum = (rs, f) => rs.reduce((a, r) => a + r[f], 0);
  const decided = won.length + lost.length;
  const quarterEnd = isoDay(Date.parse(TODAY) + 91 * 864e5);
  const dueSoon = open.filter(r => r.due && r.due >= TODAY && r.due <= quarterEnd);
  return {stages, open: {count: open.length, value: sum(open, 'amount'), weighted: sum(open, 'weighted'), valueText: money(sum(open, 'amount')), weightedText: money(sum(open, 'weighted'))},
    won: {count: won.length, value: sum(won, 'amount'), valueText: money(sum(won, 'amount'))}, lost: {count: lost.length, value: sum(lost, 'amount'), valueText: money(sum(lost, 'amount'))},
    winRate: decided ? Math.round(won.length / decided * 100) : null,
    dueThisQuarter: {count: dueSoon.length, weighted: sum(dueSoon, 'weighted'), weightedText: money(sum(dueSoon, 'weighted'))},
    history: won.concat(lost).sort((a, b) => (b.closed || b.due || '').localeCompare(a.closed || a.due || '')).slice(0, 20),
    quarters: byQuarter(open),
    rows: rows.sort((a, b) => b.weighted - a.weighted), withTeam: !!withTeam, hasTeam: S.team.length > 0, unpriced: rows.filter(r => !r.amount).length};
}

/* ---------- fiscal year ---------- */
// The federal fiscal year starts October 1: October 2026 is FY27 Q1. Q4 (July to September) is
// when agencies spend what's left of the year's money, so most awards land then.
/** "2027-08-14" → {fy: 2027, q: 4, label: 'FY27 Q4', q4: true}; null for no date. */
function fiscalOf(day){
  const m = /^(\d{4})-(\d{2})/.exec(String(day || '')); if (!m) return null;
  const y = +m[1], mo = +m[2], fy = mo >= 10 ? y + 1 : y, q = mo >= 10 ? 1 : Math.floor((mo - 1) / 3) + 2;
  return {fy, q, label: `FY${String(fy).slice(2)} Q${q}`, q4: q === 4};
}

/* ---------- key dates ---------- */
// The dates that drive a pursuit. "Proposal due" is the pursuit's due date.
const DATE_KINDS = [['industryDay', 'Industry day'], ['questions', 'Questions due'], ['draftRfp', 'Draft RFP'], ['rfp', 'Final RFP'],
  ['proposal', 'Proposal due'], ['orals', 'Orals'], ['award', 'Expected award']];
const DATE_LABEL = Object.fromEntries(DATE_KINDS);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v));
/** Every key date on a pursuit, in date order: [{kind, label, date, days}]. */
function datesOf(p){
  const out = [];
  for (const [kind, label] of DATE_KINDS){
    const date = kind === 'proposal' ? p.due : p.dates && p.dates[kind];
    if (isDay(date)) out.push({kind, label, date, days: -daysSince(date)});
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
/** The next key date that hasn't passed, or null. */
const nextDateOf = p => datesOf(p).find(d => d.date >= TODAY) || null;
/** Sets (or, with an empty day, clears) one key date on a pursuit. */
function setPursuitDate(id, kind, day){
  const p = S.pursuits.find(x => x.id === id); if (!p) return null;
  if (!DATE_LABEL[kind]) throw new Error('Unknown date ' + kind);
  const v = String(day || '').slice(0, 10);
  if (v && !isDay(v)) throw new Error('Use a date like 2026-11-03.');
  if (kind === 'proposal'){ p.due = v; return p; }
  p.dates = Object.assign({}, p.dates);
  if (v) p.dates[kind] = v; else delete p.dates[kind];
  if (!Object.keys(p.dates).length) delete p.dates;
  return p;
}
/** Key dates across open pursuits in the next `days` days, soonest first. */
function upcomingDates(days){
  const until = isoDay(Date.parse(TODAY) + (Math.max(1, +days || 14)) * 864e5), out = [];
  for (const p of S.pursuits) if (isOpen(p)) for (const d of datesOf(p)) if (d.date >= TODAY && d.date <= until) out.push(Object.assign({pursuitId: p.id, pursuit: p.name, agency: p.agency}, d));
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- bid/no-bid ---------- */
// The questions a capture team asks before spending money on a proposal. Northfix suggests an
// answer where your own data can say; you answer the rest, or overrule it.
// [key, question, the gap when the answer is no]
const BID_QUESTIONS = [
  ['customer', 'Do we know the customer?', 'no relationship with the customer'],
  ['deciders', 'Do we know the people who decide?', 'no one in the decision seats'],
  ['incumbent', 'Can the incumbent be beaten?', 'a strong incumbent'],
  ['partner', 'Do we have a teaming partner?', 'no teaming partner'],
  ['eligible', 'Can we bid (right NAICS code and set-aside)?', 'not eligible to bid'],
  ['time', 'Is there enough time to write a strong proposal?', 'not enough time'],
  ['worth', 'Is it worth what it will cost to win?', 'not worth the cost'],
  ['pastPerf', 'Do we have past performance that fits?', 'no past performance that fits'],
];
const BID_ANSWERS = ['yes', 'maybe', 'no'];
/** What your data says for each question it can judge: {key: {answer, why}}. */
function bidSuggestions(p){
  const out = {};
  const pool = p.agency ? atOrg(p.agency) : [];
  const warm = pool.filter(r => r.wm.band === 'strong' || r.wm.band === 'warm').length;
  if (p.agency) out.customer = pool.length >= 5 && warm >= 1 ? {answer: 'yes', why: `You know ${pool.length} at ${p.agency}, ${warm} warm.`}
    : pool.length ? {answer: 'maybe', why: `You know ${pool.length} at ${p.agency}${warm ? `, ${warm} warm` : ', none warm yet'}.`}
    : {answer: 'no', why: `You don’t know anyone at ${p.agency} yet.`};
  const gov = PURSUIT_ROLES.filter(([, rx]) => rx).map(([role]) => role);
  const filled = gov.filter(role => (p.roles[role] || []).some(k => S.byK.has(k)));
  const keySeats = ['Executive sponsor', 'Program manager', 'Contracting officer'].filter(role => filled.includes(role)).length;
  out.deciders = keySeats >= 2 && filled.length >= 3 ? {answer: 'yes', why: `${filled.length} of ${gov.length} government seats filled, including ${keySeats} of the 3 key ones.`}
    : filled.length ? {answer: 'maybe', why: `${filled.length} of ${gov.length} government seats filled.`} : {answer: 'no', why: 'No government seats filled yet.'};
  const inc = splitNames(p.incumbent)[0];
  if (!inc) out.incumbent = {answer: 'yes', why: 'No incumbent listed: new work, or add who holds it today.'};
  else if (isCompetitor(inc)) out.incumbent = {answer: 'maybe', why: `${inc} is a competitor you track. Know where they are weak.`};
  const partners = splitNames(p.partners);
  const partnerSeat = (p.roles['Teaming partner'] || []).some(k => S.byK.has(k));
  out.partner = partners.length && partnerSeat ? {answer: 'yes', why: `${partners.join(', ')}, and you know someone there.`}
    : partners.length ? {answer: 'maybe', why: `${partners.join(', ')} listed, but no one there in the seat yet.`} : {answer: 'no', why: 'No teaming partners listed.'};
  if (isDay(p.due)){
    const d = -daysSince(p.due);
    out.time = d >= 45 ? {answer: 'yes', why: `${d} days to the due date.`} : d >= 21 ? {answer: 'maybe', why: `${d} days to the due date: tight.`}
      : {answer: 'no', why: d >= 0 ? `Only ${d} days to the due date.` : 'The due date has passed.'};
  }
  return out;
}
/** The scorecard for one pursuit: each question with your answer or the suggestion, a score and a recommendation. */
function bidDecision(id){
  const p = S.pursuits.find(x => x.id === id); if (!p) return null;
  const sug = bidSuggestions(p), mine = p.bid || {};
  const questions = BID_QUESTIONS.map(([key, text, gap]) => {
    const own = BID_ANSWERS.includes(mine[key]) ? mine[key] : '';
    const s = sug[key] || null;
    return {key, text, gap, answer: own || (s ? s.answer : ''), mine: own, suggested: s ? s.answer : '', why: s ? s.why : ''};
  });
  const answered = questions.filter(q => q.answer);
  const points = answered.reduce((a, q) => a + (q.answer === 'yes' ? 2 : q.answer === 'maybe' ? 1 : 0), 0);
  const score = answered.length ? Math.round(points / (answered.length * 2) * 100) : null;
  const blocker = questions.find(q => q.key === 'eligible' && q.answer === 'no');
  const noes = answered.filter(q => q.answer === 'no');
  let call, why;
  if (blocker){ call = 'No bid'; why = 'You can’t bid without the right NAICS code or set-aside. Look for a prime to team under.'; }
  else if (answered.length < 4){ call = 'Not enough answers'; why = `Answer at least ${4 - answered.length} more ${answered.length === 3 ? 'question' : 'questions'}.`; }
  else if (score >= 70 && noes.length <= 1){ call = 'Bid'; why = noes.length ? `Strong overall. Fix this first: ${noes[0].gap}.` : 'Strong on every question answered.'; }
  else if (score >= 45){ call = 'Bid with conditions'; why = noes.length ? `Only if you can fix: ${noes.map(q => q.gap).join('; ')}.` : 'Several open questions. Settle them before the next gate.'; }
  else { call = 'No bid'; why = 'Too many gaps for the cost of a proposal. Keep tracking it and build relationships for the next one.'; }
  return {id: p.id, name: p.name, questions, score, answered: answered.length, call, why};
}
/** Sets (or, with '', clears back to the suggestion) your answer to one question. */
function setBidAnswer(id, key, answer){
  const p = S.pursuits.find(x => x.id === id); if (!p) return null;
  if (!BID_QUESTIONS.some(([k]) => k === key)) throw new Error('Unknown question ' + key);
  const a = String(answer || '').toLowerCase();
  if (a && !BID_ANSWERS.includes(a)) throw new Error('Answer yes, maybe or no.');
  p.bid = Object.assign({}, p.bid);
  if (a) p.bid[key] = a; else delete p.bid[key];
  if (!Object.keys(p.bid).length) delete p.bid;
  return bidDecision(id);
}

/* ---------- competitors ---------- */
// Companies you compete with, kept with the watchlist. Named in recompetes and teaming
// partners, on pursuits, and when someone you know goes to work for one.
const isCompetitor = name => { if (!name || !S.competitors.length) return false; const hit = coHit(name); return S.competitors.some(c => hit(c) || coHit(c)(name)); };
function setCompetitor(name, on){
  const n = String(name || '').trim().slice(0, 120); if (!n) return {competitors: S.competitors};
  S.competitors = S.competitors.filter(c => coKey(c) !== coKey(n));
  if (on !== false) S.competitors.push(n);
  return {competitors: S.competitors};
}
/** Each competitor with who you know there, and who joined lately (people to be careful with, or to learn from). */
function competitors(){
  return S.competitors.map(name => {
    const rs = atOrg(name).sort((a, b) => b.wm.score - a.wm.score || bySenior(a, b));
    const joined = rs.filter(r => r.jc && daysAgo(r.jc) <= 180);
    const pursuits = S.pursuits.filter(p => isOpen(p) && (coKey(splitNames(p.incumbent)[0] || '') === coKey(name) || splitNames(p.partners).some(x => coKey(x) === coKey(name)))).map(p => ({id: p.id, name: p.name}));
    return {name, known: rs.length, people: rs.slice(0, 5).map(brief), joined: joined.slice(0, 5).map(r => Object.assign(brief(r), {jc: r.jc})), pursuits,
      line: `${rs.length ? `You know ${rs.length} there` : 'No one there yet'}${joined.length ? `, ${joined.length} joined in the last six months` : ''}.`};
  });
}

/* ---------- weekly capture digest ---------- */
// One plain-English page across every open pursuit, for a Monday capture meeting. opts:
// {awards (recompete pages, optional), notices (SAM.gov matches the app already has, optional)}.
/** "Final RFP" as "final RFP": lowercases a leading word but leaves acronyms. */
const lowerFirst = t => String(t || '').replace(/^[A-Z](?![A-Z])/, c => c.toLowerCase());
function captureDigest(opts){
  const o = opts || {};
  const open = S.pursuits.filter(isOpen);
  const sections = [];
  const dates = upcomingDates(14);
  if (dates.length) sections.push({title: 'Dates in the next two weeks', lines: dates.slice(0, 12).map(d => `${d.pursuit}: ${lowerFirst(d.label)} ${d.days === 0 ? 'today' : d.days === 1 ? 'tomorrow' : `in ${d.days} days`} (${niceDate(d.date)}).`)});
  const cold = coldSeats();
  if (cold.length) sections.push({title: 'Seats going cold', lines: cold.slice(0, 10).map(c => `${c.pursuit}: ${c.name} in the ${lowerFirst(c.role)} seat, ${c.days == null ? 'no contact yet' : `no contact in ${c.days} days`}.`)});
  const empty = open.map(p => ({p, open: PURSUIT_ROLES.filter(([role]) => !(p.roles[role] || []).some(k => S.byK.has(k))).map(([role]) => role)})).filter(x => x.open.length);
  if (empty.length) sections.push({title: 'Empty seats', lines: empty.slice(0, 10).map(x => `${x.p.name}: ${x.open.slice(0, 4).map(lowerFirst).join(', ')}${x.open.length > 4 ? ` and ${x.open.length - 4} more` : ''}.`)});
  const calls = open.map(p => bidDecision(p.id)).filter(b => b && b.call !== 'Bid' && b.call !== 'Not enough answers');
  if (calls.length) sections.push({title: 'Bid decisions to look at', lines: calls.slice(0, 8).map(b => `${b.name}: ${lowerFirst(b.call)}. ${b.why}`)});
  if (Array.isArray(o.awards) && o.awards.length){
    const rc = recompetes(o.awards, {months: 3, limit: 8});
    if (rc.items.length) sections.push({title: 'Contracts ending in the next 90 days', lines: rc.items.map(x => `${x.agency}: ${x.title}, ${x.incumbent}${isCompetitor(x.incumbent) ? ' (competitor)' : ''}, ${x.amountText}, ends ${niceDate(x.end)}.`)});
  }
  if (Array.isArray(o.notices) && o.notices.length){
    const fresh = o.notices.filter(n => n && n.isNew).slice(0, 8);
    if (fresh.length) sections.push({title: 'New on SAM.gov', lines: fresh.map(n => `${n.agency}: ${n.title}${n.due ? `, responses due ${niceDate(n.due)}` : ''}.`)});
  }
  const pl = pipeline(false);
  const head = open.length ? `${open.length} open ${open.length === 1 ? 'pursuit' : 'pursuits'}, ${pl.open.valueText} total, ${pl.open.weightedText} weighted.` : 'No open pursuits yet.';
  const text = [`Capture digest for the week of ${niceDate(TODAY)}`, head, ...sections.flatMap(s => ['', s.title, ...s.lines.map(l => '- ' + l)])].join('\n');
  return {date: TODAY, head, sections, text, empty: !sections.length};
}

/* ---------- pursuit one-pager ---------- */
// Everything a capture lead puts on one page for a gate review: seats, who you know in each,
// the warmest ways in, and the dates. The apps draw it as a PDF.
function pursuitSheet(id){
  const d = pursuit(id); if (!d) return null;
  const name = k => { const r = S.byK.get(k); return r ? fullName(r) : ''; };
  const line = x => [x.p, BAND_LABEL[x.band]].filter(Boolean).join(' · ');
  const seats = d.roleList.map(s => ({role: s.role, side: s.side, owner: s.owner, cold: s.cold,
    people: s.people.map(x => ({name: x.name, detail: line(x), last: x.last ? niceDate(x.last) : ''})),
    status: s.people.length ? (s.cold ? `Cold: no contact in ${s.coldDays == null ? 'a long time' : s.coldDays + ' days'}` : 'Filled')
      : s.suggest.length ? `Open. Could fill: ${s.suggest.map(x => x.name).join(', ')}` : s.hint || 'Open. No one yet.'}));
  const best = d.best.map(b => ({name: name(b.k), why: b.why})).filter(b => b.name);
  const team = d.team.slice(0, 5).map(t => ({name: t.name, detail: `${t.owner} knows them. ${BAND_LABEL[t.b] || ''}`.trim()}));
  const facts = [
    ['Agency', d.agency || 'Not set'], ['Stage', d.stage], ['Due', d.due ? `${niceDate(d.due)}${d.days != null ? ` (${d.days >= 0 ? d.days + ' days left' : -d.days + ' days ago'})` : ''}` : 'Not set'],
    ['Value', d.value || 'Not set'], ['Win chance', `${d.pwin}%${d.pwinSet ? '' : ' (typical for this stage)'}`], ['Incumbent', d.incumbent || 'Not set'],
    ['Teaming partners', d.partners.join(', ') || 'None yet'], ['Seats filled', `${d.filled} of ${d.roles}`], ['You know at the agency', String(d.known)],
  ];
  if (d.fiscal) facts.splice(3, 0, ['Fiscal quarter', d.fiscal.label + (d.fiscal.q4 ? ' (end of year money)' : '')]);
  for (const x of d.dates) if (x.date && x.kind !== 'proposal') facts.push([x.label, niceDate(x.date)]);
  if (d.bid && d.bid.score != null) facts.push(['Bid decision', `${d.bid.call} (${d.bid.score} of 100)`]);
  return {title: d.name, made: TODAY, facts, seats, best, team, note: d.note || '', cold: d.cold,
    footer: `Made with Northfix on ${niceDate(TODAY)}. Private: contains your own relationship notes.`};
}

/* ---------- call plan ---------- */
// The facts for a short plan before talking to someone: what they own, what changed, what
// you last talked about, and what to ask. The iPhone and Mac turn the facts into a plan with
// the on-device model; `plan` is the same thing written without one.
function callPlan(k, pursuitId){
  const r = S.byK.get(k); if (!r) return null;
  const he = r.f || 'They';
  const mem = memory(k);
  const p = pursuitId ? S.pursuits.find(x => x.id === pursuitId) : S.pursuits.find(x => isOpen(x) && Object.values(x.roles).some(ks => ks.includes(k)));
  const seat = p ? (Object.entries(p.roles).find(([, ks]) => ks.includes(k)) || [])[0] || '' : '';
  const facts = [`${fullName(r)}${r.p ? ', ' + r.p : ''}${r.c ? ' at ' + r.c : ''}.`, `Relationship: ${BAND_LABEL[r.wm.band].toLowerCase()}.`];
  const lt = lastTouch(r);
  facts.push(lt ? `Last in touch ${ago(lt)}.` : 'You have not been in touch yet.');
  if (mem && mem.line) facts.push(mem.line);
  if (r.jc && daysAgo(r.jc) <= 365) facts.push(`Changed roles ${ago(r.jc)}.`);
  { const mv = moveOf(r); if (mv) facts.push(mv.why); }
  if (p){
    facts.push(`Pursuit: ${p.name}${p.agency ? ' at ' + p.agency : ''}, stage ${p.stage}${p.due ? ', due ' + niceDate(p.due) : ''}.`);
    if (seat) facts.push(`${he} sits in the ${seat.toLowerCase()} seat.`);
    if (p.incumbent) facts.push(`Incumbent: ${splitNames(p.incumbent)[0]}.`);
  }
  if (r.ed && r.ed.due) facts.push(`You planned to follow up ${r.ed.due <= TODAY ? 'by ' + niceDate(r.ed.due) : 'on ' + niceDate(r.ed.due)}.`);
  const ask = [];
  if (seat === 'Contracting officer') ask.push('Is there a timeline for the solicitation, and how will it be released?');
  else if (seat === 'Program manager') ask.push('What has to go right for the program this year?');
  else if (seat === 'Executive sponsor') ask.push('What outcome would make this a win for the organization?');
  else if (seat === 'Mission owner') ask.push('What slows the mission down today?');
  else if (seat === 'Security lead') ask.push('What is hardest about getting systems authorized right now?');
  else if (seat === 'Technical lead') ask.push('What does the current architecture make hard?');
  else if (seat === 'Incumbent') ask.push('How is the current contract going, and where could a partner help?');
  else if (seat === 'Teaming partner') ask.push('Where do our capabilities fit together on this bid?');
  else ask.push(r.jc && daysAgo(r.jc) <= 365 ? 'How is the new role going, and what is on your plate?' : 'What are you focused on over the next few months?');
  ask.push('Who else should I be talking to?');
  const opener = isWaiting(r) || isMailWaiting(r) ? `Start by answering their last message.`
    : r.jc && daysAgo(r.jc) <= 120 ? `Open with congratulations on the new role.` : lt && daysSince(lt) > 180 ? `Acknowledge it has been a while.` : `Pick up where you left off.`;
  const plan = [`Goal: ${p ? `learn where ${p.name} stands and what ${he} needs` : `catch up and learn what ${he} is working on`}.`, `Open: ${opener}`,
    `Ask: ${ask.join(' ')}`, `Next step: agree on one follow-up before you hang up.`].join('\n');
  const prompt = `Write a short call plan for a business development professional about to talk with a contact. Use only these facts. Four lines: Goal, Open, Ask (two questions), Next step. Plain English, no em dashes.\n\nFacts:\n- ${facts.join('\n- ')}`;
  return {k, name: fullName(r), pursuit: p ? p.name : '', seat, facts, plan, prompt};
}

/* ---------- event attendee lists ---------- */
// A conference attendee or badge-scan list (CSV), matched to your network: who you already
// know there, and who's new. People you don't know yet are kept as prospects, so they fill
// empty seats on org charts. Read on the device only.
function matchAttendeeList(text, event){
  const grid = parseCSV(String(text || '').replace(/^﻿/, ''));
  const norm = h => String(h || '').trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  const hi = grid.findIndex(r => r.map(norm).some(c => ENRICH_COLS.first.includes(c) || ENRICH_COLS.name.includes(c)));
  if (hi < 0) throw new Error('That file has no name columns. Use a CSV with first and last name (or full name), and company if you have it.');
  const H = grid[hi].map(norm);
  const col = {}; for (const [kk, names] of Object.entries(ENRICH_COLS)){ for (const n of names){ const i = H.indexOf(n); if (i >= 0){ col[kk] = i; break; } } }
  const nm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const bySlug = new Map(), byEmail = new Map(), byNameCo = new Map(), byName = new Map();
  for (const r of live()){
    const sl = slugOf(r.u); if (sl) bySlug.set(sl, r.k);
    if (r.e) byEmail.set(r.e.toLowerCase(), r.k);
    const n = nm(`${r.f} ${r.l}`); if (!n) continue;
    byNameCo.set(n + '|' + coKey(r.c), r.k);
    byName.set(n, byName.has(n) ? null : r.k);
  }
  const known = [], fresh = [], seen = new Set();
  let rows = 0;
  for (const g of grid.slice(hi + 1)){
    const get = kk => col[kk] != null ? String(g[col[kk]] || '').trim() : '';
    let full = get('name') || `${get('first')} ${get('last')}`.trim();
    if (full.includes(',') && !get('first')){ const [l, f] = full.split(','); full = `${f.trim()} ${l.trim()}`; }
    if (!full) continue;
    rows++;
    const email = get('email');
    const k = bySlug.get(slugOf(get('linkedin'))) || (email && byEmail.get(email.toLowerCase())) || byNameCo.get(nm(full) + '|' + coKey(get('company'))) || byName.get(nm(full));
    if (k){ if (!seen.has(k)){ seen.add(k); known.push(k); } continue; }
    fresh.push({name: full, p: get('title'), c: get('company'), e: email, li: get('linkedin')});
  }
  const rs = known.map(k => S.byK.get(k)).sort((a, b) => b.wm.score - a.wm.score || bySenior(a, b));
  // the new people, grouped by employer, with what you know there already
  const byCo = new Map();
  for (const x of fresh){ const c = x.c || 'No company listed'; if (!byCo.has(c)) byCo.set(c, []); byCo.get(c).push(x); }
  const companies = [...byCo.entries()].map(([c, xs]) => ({company: c, count: xs.length, people: xs.slice(0, 8).map(x => ({name: x.name, p: x.p})),
    known: c === 'No company listed' ? 0 : atOrg(c).length, target: isTarget(c)})).sort((a, b) => (b.target - a.target) || b.count - a.count).slice(0, 60);
  const added = addProspects(fresh.filter(x => x.c), event ? 'event: ' + String(event).slice(0, 80) : 'event');
  return {event: String(event || '').slice(0, 120), rows, known: rs.map(r => Object.assign(brief(r), {c: r.c || ''})), knownCount: rs.length, newCount: fresh.length, companies, added};
}
/** Tags the people you know from an attendee list with the event's name, so they make a list. */
function tagAttendees(keys, event){
  const tag = String(event || '').trim().slice(0, 60); if (!tag) return {tagged: 0};
  let n = 0;
  for (const k of keys || []){ const r = S.byK.get(k); if (!r) continue; const tags = new Set((r.ed && r.ed.tags) || []); if (!tags.has(tag)){ tags.add(tag); setEdit(k, {tags: [...tags]}); n++; } }
  return {tagged: n};
}

/* ---------- notes from AI apps ---------- */
/**
 * The inbox to leave behind after filing: notes in `now` (the file as it is after filing) that
 * weren't in `filed` (the text that was filed), as file text, or '' when there are none. Claude
 * can add a note while the app files the last ones, and that note must not be deleted.
 */
function inboxRest(filed, now){
  const read = t => { try { const d = typeof t === 'string' ? JSON.parse(t) : t; return d && Array.isArray(d.notes) ? d.notes : []; } catch { return []; } };
  const id = n => n && `${n.k}|${n.at}|${n.text}`;
  const done = new Set(read(filed).map(id));
  const rest = read(now).filter(n => n && !done.has(id(n)));
  return rest.length ? JSON.stringify({kind: 'northfix-ai-inbox', v: 1, notes: rest}) : '';
}
// Notes the AI connector (mcp/server.mjs) left in ai-inbox.json. The app hands the file's text
// here when it opens, saves edits, then deletes the file.
function applyInbox(text){
  let d; try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch { d = null; }
  const list = d && Array.isArray(d.notes) ? d.notes : [];
  let filed = 0;
  const people = new Set();
  for (const n of list.slice(0, 200)){
    if (!n || !S.byK.has(n.k) || !n.text) continue;
    addNote(n.k, String(n.text).slice(0, 480), 'Claude');
    filed++; people.add(n.k);
  }
  return {filed, people: [...people]};
}

/* ---------- recompetes and teaming partners (src/awards.js) ---------- */
// Contract awards from USASpending.gov: what ends soon at the agencies you work, who holds it,
// and who you know at the agency and at the incumbent. The apps fetch; this matches.
/** Federal map rows to ask about: the given names, else the watchlist and open pursuits, else your best-covered agencies. */
function awardAgencies(names){
  const F = fedRows(), out = [];
  const add = a => { if (a && !out.some(x => x.id === a.id)) out.push(a); };
  if (Array.isArray(names) && names.length) for (const n of names) add(agencyFor(n, F));
  else {
    for (const t of S.targets) add(agencyFor(t.name, F));
    for (const p of S.pursuits) if (isOpen(p) && p.agency) add(agencyFor(p.agency, F));
    if (!out.length){ const cov = agencyCoverage(false); for (const r of cov.rows.filter(r => r.known).sort((a, b) => b.known - a.known).slice(0, 5)) add(F.find(a => a.id === r.id)); }
  }
  return out.slice(0, 8);
}
/** The USASpending searches to run: [{agencyId, short, url, body}]. POST each body as JSON. */
function awardRequests(names, months){ return awardReqs(awardAgencies(names), months, TODAY); }
/** Fictional awards for the sample network only, grouped like real answers: [{agencyId, items}]. */
function demoAwardPages(){
  if (S.mode !== 'sample') return [];
  const F = fedRows(), by = new Map();
  for (const x of demoAwardList(TODAY)){ const a = F.find(f => f.short === x.demoShort); if (!a) continue; if (!by.has(a.id)) by.set(a.id, []); by.get(a.id).push(x); }
  return [...by.entries()].map(([agencyId, items]) => ({agencyId, items}));
}
// pages: [{agencyId, items}] where items are awardPage().items
function awardRows(pages){
  const F = fedRows(), out = [], seen = new Set();
  for (const pg of Array.isArray(pages) ? pages : []){
    if (!pg || typeof pg !== 'object') continue;
    const a = F.find(x => x.id === pg.agencyId); if (!a) continue;
    const q = awardAgency(a);
    for (const x of Array.isArray(pg.items) ? pg.items : []){
      if (!x || typeof x !== 'object' || !x.id || seen.has(x.id)) continue;
      if (!x.demo && !awardInCommand(q, x)) continue;
      // no office name and no known office code: it can only be shown as filed under the service
      seen.add(x.id); out.push({a, x, wide: !x.demo && !x.office && q && q.wide ? q.name : ''});
    }
  }
  return out;
}
const peopleAtAgency = () => { const F = fedRows(), by = new Map(); for (const r of live()) for (const a of fedHits(F, r.c, r.cl.agency, r.p)){ const l = by.get(a.id); if (l) l.push(r); else by.set(a.id, [r]); } return by; };
const topPeople = (rs, n) => rs.slice().sort((x, y) => y.wm.score - x.wm.score || bySenior(x, y)).slice(0, n).map(brief);
// USASpending writes names in capitals: "LEIDOS, INC." reads better as "Leidos, Inc.", but short forms stay.
const KEEP_CAPS = /^(LLC|LP|LLP|USA|US|IT|OT|ICS|II|III|IV|NAVFAC|NAVSEA|NAVAIR|NAVWAR|NAVSUP|NIWC|DISA|CISA|USACE|DOD|DOE|DHS|VA|GSA|NASA|AFCEC|AFRL|AFLCMC|AFIMSC|ACC|MICC|DLA|SAIC|CACI|GDIT|KBR|SHI|CDW|WWT|IBM|AWS|BPA|TVA|ERDC|PL\d*|W\d+\w*|N\d+\w*|FA\d+\w*)$/;
const companyName = s => { const t = String(s || '').trim(); if (t !== t.toUpperCase() || t.length <= 4) return t;
  return t.split(/(\s+|-|\/)/).map(w => KEEP_CAPS.test(w.replace(/[.,]/g, '')) ? w : w.toLowerCase().replace(/^([a-z])/, m => m.toUpperCase())).join('').replace(/\b(Of|The|And|For)\b/g, m => m.toLowerCase()).replace(/^./, m => m.toUpperCase()); };
/**
 * Contracts ending in the next `months` months at the agencies you asked about, with who holds
 * each one and who you know at the agency and at the incumbent. opts: {months, min (dollars), limit}.
 */
function recompetes(pages, opts){
  const o = opts || {};
  const months = Math.max(3, Math.min(36, +o.months || 24));
  const until = isoDay(Date.parse(TODAY) + months * 30.44 * 864e5);
  const by = peopleAtAgency();
  const pursuitAt = new Map(); for (const p of S.pursuits){ if (!isOpen(p) || !p.agency) continue; const a = agencyFor(p.agency, fedRows()); if (a && !pursuitAt.has(a.id)) pursuitAt.set(a.id, p); }
  const tracked = new Set(S.pursuits.map(p => p.source).filter(Boolean));
  const out = [];
  for (const {a, x, wide} of awardRows(pages)){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.end || '') || x.end < TODAY || x.end > until) continue;
    if (+o.min > 0 && x.amount < +o.min) continue;
    const ps = by.get(a.id) || [];
    const inc = x.recipient ? live().filter(r => coHit(x.recipient)(r.c)) : [];
    const days = -daysSince(x.end);
    const warm = ps.filter(r => r.wm.band === 'strong' || r.wm.band === 'warm').length;
    const watched = S.targets.some(t => t.name === a.short || t.name === a.name);
    const pursuit = pursuitAt.get(a.id);
    let score = Math.max(0, 40 - Math.floor(days / 15)) + Math.min(30, ps.length * 3) + Math.min(15, warm * 5) + Math.min(15, inc.length * 5) + Math.min(20, Math.log10(Math.max(1, x.amount)) * 2);
    if (watched) score += 15;
    out.push({id: x.id, piid: x.piid, title: x.desc ? x.desc.charAt(0).toUpperCase() + x.desc.slice(1).toLowerCase() : x.piid, incumbent: companyName(x.recipient), amount: x.amount, amountText: money(x.amount),
      start: x.start, end: x.end, days, agency: a.short, agencyName: a.name, agencyId: a.id, office: x.office ? companyName(x.office) : wide ? `filed under ${wide}` : '', naics: x.naics,
      link: x.demo ? '' : AWARD_LINK + encodeURIComponent(x.id), demo: !!x.demo,
      known: ps.length, warm, people: topPeople(ps, 3), incumbentKnown: inc.length, incumbentPeople: topPeople(inc, 3),
      watched, pursuit: pursuit ? pursuit.name : '', pursuitId: pursuit ? pursuit.id : '', tracked: tracked.has(x.id), score: Math.round(score), competitor: isCompetitor(x.recipient),
      line: `${ps.length ? `You know ${ps.length} at ${a.short}` : `No one at ${a.short} yet`}${x.recipient ? `, ${inc.length ? inc.length + ' at ' + companyName(x.recipient) : 'no one at the incumbent'}` : ''}`});
  }
  out.sort((p, q) => q.score - p.score || p.end.localeCompare(q.end));
  const limit = +o.limit > 0 ? +o.limit : 100;
  return {items: out.slice(0, limit), total: out.length, months, value: out.reduce((s, r) => s + r.amount, 0), valueText: money(out.reduce((s, r) => s + r.amount, 0))};
}
/** Makes a pursuit from a recompete: the agency, the end date as the due date, the value and the incumbent. */
function pursueAward(item){
  const x = item || {};
  const existing = x.id && S.pursuits.find(p => p.source === x.id);
  if (existing) return existing;
  return addPursuit({name: String(x.title || x.piid || 'Recompete').slice(0, 120), agency: x.agency || '', due: x.end || '', value: x.amount ? money(x.amount) : '',
    stage: 'Tracking', incumbent: x.incumbent || '', source: x.id || ''});
}
/**
 * The companies that win work at these agencies, biggest first, with who you and your team
 * know at each. opts: {agency (one name to narrow to), limit}.
 */
function teamingPartners(pages, opts){
  const o = opts || {};
  const want = o.agency ? agencyFor(o.agency, fedRows()) : null;
  const by = new Map();
  for (const {a, x} of awardRows(pages)){
    if (want && a.id !== want.id) continue;
    const key = coKey(x.recipient); if (!key) continue;
    if (!by.has(key)) by.set(key, {name: companyName(x.recipient), awards: 0, amount: 0, agencies: new Set(), ending: 0});
    const e = by.get(key); e.awards++; e.amount += x.amount; e.agencies.add(a.short);
    if (x.end && x.end >= TODAY && x.end <= isoDay(Date.parse(TODAY) + 365 * 864e5)) e.ending++;
  }
  const out = [...by.values()].map(e => {
    const hit = coHit(e.name);
    const rs = live().filter(r => hit(r.c));
    const team = teamPaths(hit).slice(0, 3).map(t => ({owner: t.owner, name: t.name, p: t.p, b: t.b}));
    const warm = rs.filter(r => r.wm.band === 'strong' || r.wm.band === 'warm').length;
    return {name: e.name, awards: e.awards, amount: e.amount, amountText: money(e.amount), agencies: [...e.agencies], ending: e.ending,
      known: rs.length, warm, people: topPeople(rs, 3), team, watched: isTarget(e.name), competitor: isCompetitor(e.name),
      line: rs.length ? `You know ${rs.length} there${warm ? ', ' + warm + ' warm' : ''}` : team.length ? `${team[0].owner} knows someone there` : 'No one there yet'};
  });
  out.sort((p, q) => (q.known > 0) - (p.known > 0) || q.amount - p.amount);
  const limit = +o.limit > 0 ? +o.limit : 40;
  return {items: out.slice(0, limit), total: out.length, agency: want ? {id: want.id, short: want.short, name: want.name} : null};
}

/* ---------- the sample network's pursuits ---------- */
// So the sample shows pursuits with filled seats, open seats, a cold seat and a pipeline.
function samplePursuits(){
  const by = q => atOrg(q).sort((a, b) => b.wm.score - a.wm.score);
  const day = n => isoDay(Date.parse(TODAY) + n * 864e5);
  const mk = (o, seats) => {
    const p = {id: 'sample-' + o.key, name: o.name, agency: o.agency, due: o.due, value: o.value, stage: o.stage, roles: {}, note: o.note || '', created: TODAY};
    for (const f of ['incumbent', 'partners', 'pwin', 'closed', 'dates', 'bid']) if (o[f] != null) p[f] = o[f];
    for (const [role, k] of seats) if (k) p.roles[role] = [k];
    return p;
  };
  const nav = by('NAVFAC'), disa = by('DISA'), cisa = by('CISA'), usace = by('USACE'), leidos = atOrg('Leidos'), dragos = atOrg('Dragos'), booz = atOrg('Booz Allen Hamilton'), doe = by('Department of Energy');
  const pickT = (rs, rx) => (rs.find(r => rx.test(r.p)) || rs[0] || {}).k;
  return [
    mk({key: 'navfac', name: 'NAVFAC Southeast utility OT monitoring', agency: 'NAVFAC', due: day(34), value: '$14.2M', stage: 'Pursuing', incumbent: 'Leidos', partners: 'Dragos',
      dates: {industryDay: day(12), questions: day(26), award: day(120)}, bid: {eligible: 'yes', worth: 'yes', pastPerf: 'maybe'},
      note: 'Example pursuit. Sources sought is out; industry day next month.'},
      [['Program manager', pickT(nav, /program|facilit/i)], ['Contracting officer', pickT(nav, /contract/i)], ['Incumbent', (leidos[0] || {}).k], ['Teaming partner', (dragos[0] || {}).k]]),
    mk({key: 'disa', name: 'DISA cross domain services recompete', agency: 'DISA', due: day(78), value: '$48.5M', stage: 'Proposal', pwin: 35, incumbent: 'Booz Allen Hamilton', partners: 'Fortinet, World Wide Technology',
      dates: {rfp: day(9), orals: day(95)}, bid: {eligible: 'yes', incumbent: 'maybe', worth: 'yes', pastPerf: 'yes'}},
      [['Executive sponsor', pickT(disa, /senior executive|director/i)], ['Contracting officer', pickT(disa, /contract/i)], ['Incumbent', (booz[0] || {}).k]]),
    mk({key: 'cisa', name: 'CISA ICS assessment support', agency: 'CISA', due: day(120), value: '$31.7M', stage: 'Tracking', incumbent: 'SAIC'},
      [['Mission owner', pickT(cisa, /branch chief|ics/i)]]),
    mk({key: 'usace', name: 'USACE lock and dam SCADA', agency: 'USACE', due: day(-40), value: '$9.3M', stage: 'Won', closed: day(-20)},
      [['Program manager', pickT(usace, /program/i)], ['Contracting officer', pickT(usace, /contract/i)]]),
    mk({key: 'doe', name: 'DOE grid analytics pilot', agency: 'DOE', due: day(-75), value: '$5.4M', stage: 'Lost', closed: day(-60)},
      [['Program manager', pickT(doe, /program/i)]]),
  ];
}

/* ---------- moves: rotations and transitions ---------- */
// Service members rotate every two to three years; people leaving service say so in their title.
const TRANSITION_RX = /\b(transition(ing)?|skillbridge|skill bridge|terminal leave|retiring|separating|seeking (new )?(opportunit|role|position)|open to (work|new)|available for)\b/i;
const roleSince = r => (r.ed && r.ed.rs) || r.jc || '';
const serving = r => r.cl.status === 'Serving' || (!!r.cl.branch && !!r.cl.grade && r.cl.status !== 'Veteran / Retired' && /^[EOW]-/.test(r.cl.grade));
function moveOf(r){
  if (r.x) return null;
  if (TRANSITION_RX.test(`${r.p || ''} ${r.c || ''}`) && (r.cl.branch || r.cl.seg === 'DoD & Military' || r.cl.seg === 'Federal Civilian'))
    return {kind: 'transition', why: `Says they’re ${/retir/i.test(r.p + r.c) ? 'retiring' : 'transitioning'}. A good moment to help, and to stay close as they land somewhere new.`};
  if (!serving(r)) return null;
  const since = roleSince(r);
  if (!since) return null;
  const months = Math.floor(daysSince(since) / 30.4);
  if (months < 20) return null;
  const est = isoDay(Date.parse(since.length === 7 ? since + '-01' : since) + 36 * 30.4 * 864e5);
  return {kind: 'pcs', months, since, est, why: `In this assignment ${months >= 24 ? Math.round(months / 12 * 10) / 10 + ' years' : months + ' months'}. Most tours run two to three years, so a move is likely ${est <= TODAY ? 'soon' : 'by ' + niceDate(est)}.`};
}
function moves(){
  const out = [];
  for (const r of live()){ const m = moveOf(r); if (m) out.push(Object.assign({k: r.k, name: fullName(r), score: r.wm.score}, m)); }
  return out.sort((a, b) => (a.kind === 'transition' ? 0 : 1) - (b.kind === 'transition' ? 0 : 1) || b.score - a.score || (b.months || 0) - (a.months || 0)).slice(0, 200);
}
const setRoleSince = (k, ym) => setEdit(k, {rs: ym || ''});

/* ---------- quick log (voice) ---------- */
// "Just met Dana Whitfield, he wants pricing by Friday" → a note on Dan, a touch, a follow-up.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function dueIn(text){
  const t = String(text || '').toLowerCase();
  let m;
  if (/\btomorrow\b/.test(t)) return 1;
  if (/\bnext week\b/.test(t)) return 7;
  if (/\bnext month\b/.test(t)) return 30;
  if (/\b(end of|by) (the )?month\b/.test(t)) { const d = new Date(TODAY + 'T12:00:00Z'); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return Math.max(1, Math.round((last - d) / 864e5)); }
  if ((m = t.match(/\bin (\d{1,2}|a|one|two|three) (day|week|month)s?\b/))) { const n = {a: 1, one: 1, two: 2, three: 3}[m[1]] || +m[1]; return n * ({day: 1, week: 7, month: 30})[m[2]]; }
  for (let i = 0; i < 7; i++){
    if (new RegExp(`\\b(by |on |this |next )?${WEEKDAYS[i]}\\b`).test(t)){
      const today = new Date(TODAY + 'T12:00:00Z').getUTCDay();
      let d = (i - today + 7) % 7; if (d === 0) d = 7;
      if (new RegExp(`\\bnext ${WEEKDAYS[i]}\\b`).test(t) && d < 7) d += 7;
      return d;
    }
  }
  if (/\b(follow up|follow-up|send|get back|circle back|call|email)\b/.test(t)) return 3;
  return 0;
}
function quickLog(text, apply){
  const t = String(text || '').trim();
  if (!t) return {people: [], days: 0};
  const r = readNotes(t);
  const people = r.people.slice(0, 3);
  const days = dueIn(t);
  if (apply !== false){
    people.forEach((x, i) => { addNote(x.k, t.slice(0, 480), 'Voice'); touch(x.k); if (i === 0 && days) followUp(x.k, days); });
  }
  return {people: people.map(x => ({k: x.k, name: x.name})), days, due: days ? isoDay(Date.now() + days * 864e5) : ''};
}

/* ---------- intros ---------- */
// "Can you introduce me to…" asks, tracked on the person you asked: asked, made, met.
function addIntro(via, to, co){
  const r = S.byK.get(via); if (!r) return {edits: S.edits};
  const list = ((r.ed && r.ed.intros) || []).slice();
  list.push({id: 'i' + Date.now().toString(36), to: String(to || '').trim(), co: String(co || '').trim(), at: TODAY, st: 'asked'});
  return setEdit(via, {intros: list});
}
function setIntro(via, id, st){
  const r = S.byK.get(via); if (!r) return {edits: S.edits};
  const list = ((r.ed && r.ed.intros) || []).map(x => x.id === id ? Object.assign({}, x, {st, upd: TODAY}) : x).filter(x => st !== 'remove' || x.id !== id);
  return setEdit(via, {intros: list});
}
function intros(){
  const out = [];
  for (const r of live()) for (const x of ((r.ed && r.ed.intros) || [])){
    const days = daysSince(x.upd || x.at);
    out.push(Object.assign({via: r.k, viaName: fullName(r), days, nudge: x.st === 'asked' && days >= 7}, x));
  }
  const order = {asked: 0, made: 1, met: 2, declined: 3};
  return out.sort((a, b) => order[a.st] - order[b.st] || b.days - a.days);
}
const introNudges = () => intros().filter(x => x.nudge);

/* ---------- account trends ---------- */
// Your reach into a company over the last year (from when you connected with each person),
// plus weekly snapshots of the coverage score from the day you start watching it.
function trend(name){
  const ps = unitPeople(name);
  const months = [];
  const now = new Date(TODAY + 'T12:00:00Z');
  for (let i = 11; i >= 0; i--){
    const end = isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    const by = ps.filter(r => !r.d || r.d <= end);
    months.push({m: end.slice(0, 7), known: by.length, senior: by.filter(r => r.cl.lv <= 2).length});
  }
  const cov = coverage(ps);
  return {name, months, snaps: S.snaps[name] || [], now: {score: cov.score, known: ps.length, close: ps.filter(r => r.wm.band === 'strong').length}};
}
function snapshot(){
  let changed = false;
  for (const t of S.targets){
    const list = S.snaps[t.name] || (S.snaps[t.name] = []);
    const last = list[list.length - 1];
    if (last && daysSince(last.d) < 6) continue;
    const ps = unitPeople(t.name), cov = coverage(ps);
    list.push({d: TODAY, score: cov.score, known: ps.length, close: ps.filter(r => r.wm.band === 'strong').length});
    if (list.length > 104) list.splice(0, list.length - 104);
    changed = true;
  }
  return changed;
}
// New and moved people at the companies you watch, senior first.
function targetChanges(){
  const out = [];
  for (const t of S.targets){
    for (const r of unitPeople(t.name).filter(r => r.isNew || r.movedNow).sort(bySenior).slice(0, 5))
      out.push({target: t.name, k: r.k, name: fullName(r), p: r.p || '', kind: r.movedNow ? 'moved' : 'new', senior: r.cl.lv <= 2});
  }
  return out.sort((a, b) => b.senior - a.senior);
}

/* ---------- ask ---------- */
// Plain questions, answered from your own network on the device.
function ask(q){
  const t = String(q || '').trim(), l = t.toLowerCase().replace(/[?.!]+$/, '');
  const list = (rs, why, n) => rs.slice(0, n || 12).map(r => ({k: r.k, why: why(r)}));
  if (!t) return {kind: 'none', answer: '', people: []};
  if (/\b(waiting|owe|reply|respond)\b/.test(l)){
    const rs = live().filter(r => isWaiting(r) || isMailWaiting(r)).sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)));
    return {kind: 'waiting', answer: rs.length ? `${fmt(rs.length)} ${rs.length === 1 ? 'person is' : 'people are'} waiting on you.` : 'No one is waiting on you right now.', people: list(rs, r => isMailWaiting(r) ? `Emailed you ${ago(r.ed.mail.t)}` : `Wrote you ${ago(r.rx.t)}`)};
  }
  if (/\b(new job|changed jobs?|job change|moved|promot|new role)\b/.test(l)){
    const rs = live().filter(r => r.movedNow || (r.jc && daysSince(r.jc) < 120)).sort(bySenior);
    return {kind: 'jobs', answer: `${fmt(rs.length)} ${rs.length === 1 ? 'person has' : 'people have'} a new role lately.`, people: list(rs, r => `${r.p || 'New role'}${r.c ? ' at ' + r.c : ''}`)};
  }
  if (/\b(rotat|pcs|moving|retir|transition|leaving)\b/.test(l)){
    const ms = moves();
    return {kind: 'moves', answer: ms.length ? `${fmt(ms.length)} people are likely to move or are leaving service.` : 'No one looks likely to move soon.', people: ms.slice(0, 12).map(m => ({k: m.k, why: m.why}))};
  }
  if (/\b(cold|lost touch|haven'?t talked|been a while)\b/.test(l)){
    const rs = live().filter(isCooling).sort((a, b) => b.wm.score - a.wm.score);
    return {kind: 'cold', answer: `${fmt(rs.length)} good relationships are going cold.`, people: list(rs, r => `Last in touch ${ago(lastTouch(r))}`)};
  }
  let m = l.match(/\b(?:near|in|around)\s+([a-z .'-]+?)(?:\s+(?:next|this)\s+(?:week|month|trip))?$/);
  if (m && /\b(see|visit|meet|near|around|while i'?m|trip|travel)\b/.test(l)) return {kind: 'city', place: m[1].trim(), answer: '', people: []};
  m = l.match(/\b(?:into|introduce me to|intro to|get me into|way into)\s+(.+)$/);
  if (m){
    const ways = introPaths(m[1]);
    return {kind: 'ways', answer: ways.best.length ? `Your best ways into ${ways.company}:` : `No clear way into ${m[1]} yet.`, people: ways.best.map(b => ({k: b.k, why: b.why}))};
  }
  m = l.match(/\b(?:at|in|from)\s+(.+?)(?:\s+who\s+(?:used to|previously|once)\s+(?:be|been|work(?:ed)?)\s+(?:at|in|with)\s+(.+))?$/);
  if (m && /\bwho\b|\bknow\b|\bpeople\b|\bcontacts?\b/.test(l)){
    let rs = atOrg(m[1]);
    if (m[2]){ const was = coHit(m[2]); rs = rs.filter(r => (r.pv || []).some(v => was(v.c)) || was(r.c)); }
    if (rs.length){
      rs.sort((a, b) => b.wm.score - a.wm.score || bySenior(a, b));
      const name = rs[0].cl.agency && coHit(m[1])(rs[0].cl.agency) ? rs[0].cl.agency : rs[0].c;
      return {kind: 'at', answer: `You know ${fmt(rs.length)} ${rs.length === 1 ? 'person' : 'people'} at ${name}${m[2] ? ' who used to be at ' + m[2] : ''}.`, people: list(rs, r => `${r.p || ''}${r.wm.band !== 'none' ? ' · ' + BAND_LABEL[r.wm.band] : ''}`)};
    }
  }
  const res = search({text: t});
  return {kind: 'search', answer: res.count ? `${fmt(res.count)} ${res.count === 1 ? 'match' : 'matches'}.` : 'Nothing matched that.', people: res.keys.slice(0, 12).map(k => { const r = S.byK.get(k); return {k, why: [r.p, r.c].filter(Boolean).join(' · ')}; })};
}


/* ---------- socials ---------- */
// Your own data downloads from Facebook, Instagram, Snapchat and TikTok, read on the device.
// Facebook and Snapchat carry names; Instagram and TikTok only usernames, matched by handle.
const PLATFORMS = {facebook: 'Facebook', instagram: 'Instagram', snapchat: 'Snapchat', tiktok: 'TikTok'};
const normH = h => String(h || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');
const tsDay = v => { const n = +v; if (n > 1e11) return isoDay(n); if (n > 1e9) return isoDay(n * 1000); const d = Date.parse(v); return isNaN(d) ? '' : isoDay(d); };
// Walks any JSON and pulls out people: {name?, handle?, date?, rel} where rel says follower/following/friend.
function socialEntries(platform, files){
  const out = [];
  const relOf = path => /fans|follower/i.test(path) && !/following/i.test(path) ? 'follower' : /following/i.test(path) ? 'following' : 'friend';
  const walk = (v, path) => {
    if (Array.isArray(v)){ v.forEach(x => walk(x, path)); return; }
    if (!v || typeof v !== 'object') return;
    const keys = Object.keys(v);
    const pick = (...names) => { for (const n of names){ const k = keys.find(x => x.toLowerCase() === n); if (k && typeof v[k] === 'string' && v[k].trim()) return v[k].trim(); } return ''; };
    // Instagram: {string_list_data: [{value, href, timestamp}], title}
    if (Array.isArray(v.string_list_data)){
      for (const d of v.string_list_data){ const h = d.value || v.title || (d.href || '').split('/').filter(Boolean).pop(); if (h) out.push({handle: h, date: tsDay(d.timestamp), rel: relOf(path)}); }
      return;
    }
    const name = pick('name', 'display name', 'displayname', 'display_name');
    const handle = pick('username', 'user name', 'user_name', 'uniqueid', 'unique_id');
    const date = pick('timestamp', 'creation timestamp', 'date', 'added', 'created');
    if ((name || handle) && keys.length <= 8 && !keys.some(k => typeof v[k] === 'object' && v[k] && !Array.isArray(v[k]))){
      if (!/^(you|me)$/i.test(name)) out.push({name, handle, date: tsDay(date || v.timestamp), rel: platform === 'facebook' || platform === 'snapchat' ? 'friend' : relOf(path)});
      return;
    }
    for (const k of keys) walk(v[k], path + '/' + k);
  };
  for (const [fname, text] of Object.entries(files || {})){
    // Facebook: only the friends and followers lists, not activity logs that mention friends
    if (platform === 'facebook' && !/(^|\/)(your_friends|friends(_\d+)?|people_who_followed_you|followers(_\d+)?)\.(json|html?)$/i.test(fname)) continue;
    if (platform === 'instagram' && !/follow/i.test(fname)) continue;
    if (platform === 'snapchat' && !/friend/i.test(fname)) continue;
    // skip lists that aren't relationships (requests sent, removed, blocked)
    if (/request|removed|reject|block|pending|suggest|recent/i.test(fname)) continue;
    if (/\.html?$/i.test(fname) || /^\s*</.test(text)){ out.push(...socialFromHTML(platform, text, fname)); continue; }
    let j; try { j = JSON.parse(text); } catch { continue; }
    walk(j, fname);
  }
  return out;
}
// Meta's download page defaults to HTML. Its friends and followers pages list each person as a
// name (or an Instagram link) followed by the date you connected; that's all that's read here.
const HTML_DATE = /^(?:[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4}|\d{4}-\d{2}-\d{2})\b/;
function htmlLines(html){
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>/gi, (m, href) => `\n@@href ${href}\n`)
    .replace(/<br\s*\/?>|<\/(div|p|li|td|tr|h\d|a|span)>|<(div|p|li|td|tr|h\d)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#039;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function socialFromHTML(platform, html, fname){
  const lines = htmlLines(html), out = [];
  const rel = /fans|follower/i.test(fname) && !/following/i.test(fname) ? 'follower' : /following/i.test(fname) ? 'following' : 'friend';
  const skip = /^(to|from|name|date|your friends|friends|followers|following|close friends|received friend requests|sent friend requests|people you may know|generated by|this file|contains|you have|deleted friends|removed friends)$|^(your friends|followers|following|generated by|this file|contains|you have|received friend|sent friend|people you may|deleted friends|removed friends)/i;
  let href = '';
  for (let i = 0; i < lines.length; i++){
    const l = lines[i];
    if (l.startsWith('@@href ')){ href = l.slice(7); continue; }
    if (!HTML_DATE.test(l) || i === 0) continue;
    // the line before the date is the person (skip the link marker in between)
    let j = i - 1; while (j >= 0 && lines[j].startsWith('@@href ')) j--;
    const prev = j >= 0 ? lines[j] : '';
    if (!prev || HTML_DATE.test(prev) || skip.test(prev) || prev.length > 80) continue;
    const date = tsDay(l.replace(/\s+at\s+/i, ' ').replace(/(\d{4}).*$/, '$1'));
    if (platform === 'instagram' || platform === 'tiktok'){
      const m = /instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/.exec(href) || /tiktok\.com\/@([A-Za-z0-9._]+)/.exec(href);
      out.push({handle: m ? m[1] : prev.replace(/^@/, ''), date, rel});
    } else if (!/^(you|me)$/i.test(prev)) {
      out.push({name: prev, handle: '', date, rel: 'friend'});
    }
    href = '';
  }
  return out;
}
function handleMatch(h){
  const n = normH(h);
  if (n.length < 5) return null;
  if (!S._byHandle){
    const m = new Map();
    const add = (key, k) => { if (key.length < 5) return; m.set(key, m.has(key) && m.get(key) !== k ? null : k); };
    for (const r of live()){
      const f = normH(r.f), l = normH(r.l);
      if (!f || !l) continue;
      for (const c of [f + l, l + f, f[0] + l, f + l[0]]) add(c, r.k);
    }
    S._byHandle = m;
  }
  const base = n.replace(/\d+$/, '').replace(/^(the|its|real|official)/, '').replace(/(official|real)$/, '');
  return S._byHandle.get(n) || S._byHandle.get(base) || null;
}
/** Meta's pages say what dates a download covers. Returns {from, to} when it's a limited range. */
function socialRange(files){
  for (const text of Object.values(files || {})){
    const m = /Contains data you requested from\s*(?:<[^>]*>\s*)*([A-Z][a-z]+ \d{1,2}, \d{4})[^<]*?(?:<[^>]*>\s*)*to\s*(?:<[^>]*>\s*)*([A-Z][a-z]+ \d{1,2}, \d{4})/i.exec(String(text));
    if (m) return {from: m[1], to: m[2]};
  }
  return null;
}
function importSocial(platform, files){
  if (!PLATFORMS[platform]) throw new Error('Unknown platform ' + platform);
  const entries = socialEntries(platform, files);
  const range = socialRange(files);
  if (!entries.length) throw new Error(`No ${PLATFORMS[platform]} friends or followers in that file. Make sure the download includes Connections (Friends or Followers).`);
  S._byHandle = null;
  const nameIdx = new Map(); for (const r of live()){ const n = fold_(`${r.f} ${r.l}`); if (n) nameIdx.set(n, nameIdx.has(n) ? null : r.k); }
  const byHandle = new Map(), byName = new Map();
  S.social.forEach((e, i) => { for (const h of Object.values(e.h || {})) if (h) byHandle.set(normH(h), i); if (e.name) byName.set(fold_(e.name), i); if (e.k) byName.set('k:' + e.k, i); });
  // keep this platform's old list out, so a fresh download replaces it
  for (const e of S.social){ if (e.on) delete e.on[platform]; }
  const merged = new Map();
  for (const x of entries){
    const key = x.handle ? 'h:' + normH(x.handle) : 'n:' + fold_(x.name);
    const m = merged.get(key) || {name: '', handle: '', date: '', rels: new Set()};
    m.name = m.name || x.name; m.handle = m.handle || x.handle; m.date = m.date || x.date; m.rels.add(x.rel);
    merged.set(key, m);
  }
  let matched = 0, added = 0;
  for (const m of merged.values()){
    const k = (m.name && nameIdx.get(fold_(m.name))) || (m.handle && handleMatch(m.handle)) || null;
    let i = m.handle ? byHandle.get(normH(m.handle)) : undefined;
    if (i == null && k) i = byName.get('k:' + k);
    if (i == null && m.name) i = byName.get(fold_(m.name));
    if (i == null){ S.social.push({name: m.name, h: {}, on: {}}); i = S.social.length - 1; added++; }
    const e = S.social[i];
    if (!e.name && m.name) e.name = m.name;
    if (k){ e.k = k; matched++; }
    e.h = e.h || {}; if (m.handle) e.h[platform] = m.handle;
    e.on = e.on || {};
    e.on[platform] = {since: m.date, mutual: m.rels.has('friend') || (m.rels.has('follower') && m.rels.has('following')), rel: [...m.rels].join(',')};
    if (m.handle) byHandle.set(normH(m.handle), i);
    if (m.name) byName.set(fold_(m.name), i);
    if (k) byName.set('k:' + k, i);
  }
  S.social = S.social.filter(e => e.on && Object.keys(e.on).length);
  S.meta = S.meta || {};
  return {platform, entries: merged.size, matched, added, total: S.social.length, range};
}
function clearSocial(platform){
  for (const e of S.social) if (e.on) delete e.on[platform];
  S.social = S.social.filter(e => e.on && Object.keys(e.on).length);
  return true;
}
const socialOf = k => S.social.find(e => e.k === k) || null;
// The whole picture: everyone across LinkedIn and your socials, with the overlaps.
function socials(){
  const per = {}; for (const p of Object.keys(PLATFORMS)) per[p] = 0;
  const people = S.social.map((e, i) => {
    const on = Object.keys(e.on || {});
    on.forEach(p => per[p]++);
    const r = e.k ? S.byK.get(e.k) : null;
    const mutual = on.filter(p => e.on[p].mutual).length;
    return {id: 's' + i, k: e.k || '', name: r ? `${r.f} ${r.l}`.trim() : (e.name || '@' + (Object.values(e.h || {})[0] || '')), on, h: e.h || {}, linkedin: !!r, mutual,
      ties: on.length + (r ? 1 : 0), score: r ? r.wm.score : 0, since: on.map(p => e.on[p].since).filter(Boolean).sort()[0] || ''};
  });
  const li = live().length;
  return {
    platforms: Object.entries(PLATFORMS).map(([id, name]) => ({id, name, n: per[id]})),
    linkedin: li,
    unique: li + people.filter(p => !p.linkedin).length,
    both: people.filter(p => p.linkedin).length,
    socialOnly: people.filter(p => !p.linkedin && p.name && !p.name.startsWith('@')).length,
    handlesOnly: people.filter(p => !p.linkedin && (!p.name || p.name.startsWith('@'))).length,
    strongest: people.filter(p => p.ties >= 3).sort((a, b) => b.ties - a.ties || b.score - a.score).slice(0, 60),
    people: people.sort((a, b) => b.ties - a.ties || b.score - a.score || a.name.localeCompare(b.name)),
  };
}


/* ---------- federal coverage map ---------- */
// Every department, agency and major command, with where you are connected and where
// you are not. "Covered" means someone senior and someone warm; "thin" means you know
// someone there, but not both.
// Which federal agencies a person's employer, agency label or title points to.
function fedHits(F, c, agency, p){
  const co = `${c || ''} ${agency || ''}`;
  let hits = F.filter(a => a.test(co));
  if (!hits.length && p && !/\b(former|retired|ex-)\b/i.test(p)) hits = F.filter(a => a.test(p));
  return hits;
}
// Teammates' people are classified on demand (cached), the same way your own are.
const teamCl = new WeakMap();
const clOfShared = p => { let v = teamCl.get(p); if (!v){ v = classify({f: p.f, l: p.l, c: p.c, p: p.p}); teamCl.set(p, v); } return v; };
const lvOfShared = p => clOfShared(p).lv || 5;
/** The federal map. With `withTeam`, teammates' people count too, and status reflects the whole team. */
function agencyCoverage(withTeam){
  const F = S._fed || (S._fed = compileFederal());
  const by = new Map(F.map(a => [a.id, []]));
  for (const r of live()) for (const a of fedHits(F, r.c, r.cl.agency, r.p)) by.get(a.id).push(r);
  const tby = new Map(F.map(a => [a.id, []]));
  for (const t of S.team) for (const p of t.people) for (const a of fedHits(F, p.c, '', p.p)) tby.get(a.id).push({owner: t.owner, p});
  const statusOf = (n, senior, warm) => !n ? 'none' : senior && warm ? 'covered' : 'thin';
  const gapOf = (n, senior, warm) => !n ? 'No one yet' : !senior ? 'No one senior' : !warm ? 'No warm relationship' : '';
  const rows = F.map(a => {
    const ps = by.get(a.id), tp = tby.get(a.id);
    const senior = ps.filter(r => r.cl.lv <= 2).length, warm = ps.filter(r => r.wm.band === 'strong' || r.wm.band === 'warm').length;
    const teamSenior = tp.filter(x => lvOfShared(x.p) <= 2).length, teamWarm = tp.filter(x => x.p.b === 'strong' || x.p.b === 'warm').length;
    const mine = statusOf(ps.length, senior, warm);
    const n = withTeam ? ps.length + tp.length : ps.length, sn = withTeam ? senior + teamSenior : senior, wn = withTeam ? warm + teamWarm : warm;
    const best = ps.slice().sort((x, y) => y.wm.score - x.wm.score || bySenior(x, y)).slice(0, 3).map(r => r.k);
    const teamBest = tp.slice().sort((x, y) => BAND_RANK[y.p.b] - BAND_RANK[x.p.b] || lvOfShared(x.p) - lvOfShared(y.p)).slice(0, 3)
      .map(x => ({owner: x.owner, name: `${x.p.f} ${x.p.l}`.trim(), p: x.p.p, b: x.p.b}));
    return {id: a.id, dept: a.dept, name: a.name, short: a.short, tags: a.tags, known: ps.length, senior, warm, status: statusOf(n, sn, wn), mine, gap: gapOf(n, sn, wn), best,
      teamKnown: tp.length, teamSenior, teamWarm, teamOwners: new Set(tp.map(x => x.owner)).size, teamBest,
      watched: S.targets.some(t => t.name === a.short || t.name === a.name)};
  });
  const depts = [...new Set(F.map(a => a.dept))].map(d => {
    const rs = rows.filter(r => r.dept === d);
    return {name: d, agencies: rs.length, covered: rs.filter(r => r.status === 'covered').length, thin: rs.filter(r => r.status === 'thin').length, none: rs.filter(r => r.status === 'none').length};
  });
  const count = (st, f = 'status') => rows.filter(r => r[f] === st).length;
  return {rows, depts, totals: {agencies: rows.length, covered: count('covered'), thin: count('thin'), none: count('none')},
    mine: {covered: count('covered', 'mine'), thin: count('thin', 'mine'), none: count('none', 'mine')}, withTeam: !!withTeam, hasTeam: S.team.length > 0};
}

/* ---------- SAM.gov opportunities ---------- */
// The apps fetch notices from SAM.gov with the user's own key; this matches them to the
// federal map and the people you know there (see opportunities.js).
const fedRows = () => S._fed || (S._fed = compileFederal());
const oppCtx = () => ({today: TODAY, F: fedRows(), people: live(), targets: S.targets, pursuits: S.pursuits, fedHits, fullName, agencyOf: n => agencyFor(n, fedRows())});
/** Notices matched to your network, ranked: see opportunities.js for the options. */
function matchOpportunities(list, opts){ return matchOpps(list, opts, oppCtx()); }
/** The searches to run against SAM.gov for these filters, posted in the last `days` days. */
function opportunityRequests(filters, days){ return oppRequests(filters, days, TODAY); }
/** Fictional notices for the sample network only, so the feature shows without a key. */
function demoOpportunities(){ return S.mode === 'sample' ? demoOpps(TODAY) : []; }
/** The seen list to save after showing these ids. */
function markOpportunitiesSeen(seen, ids){ return markSeen(seen, ids); }

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

/* ---------- team ---------- */
// A teammate shares who they know, at which company, and how well, plus their pursuits and
// watchlist. No notes, emails, messages or tags. Shares from the team server arrive already
// decrypted on the device; team pack files added by hand work the same way.
const BAND_RANK = {strong: 3, warm: 2, light: 1, none: 0};
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
function sharePeople(){ return live().map(r => ({f: r.f, l: r.l, c: r.c || '', p: r.p || '', u: r.u || '', b: r.wm ? r.wm.band : 'none'})); }
function teamPack(owner){
  return JSON.stringify({kind: 'bearings-team-pack', v: 1, owner: clip(owner || 'A teammate', 80), made: TODAY, people: sharePeople()});
}
/** Your share for the team server: people, pursuits (with who fills each seat) and watchlist. */
function teamShare(owner){
  const pursuits = S.pursuits.map(p => ({name: p.name, agency: p.agency, stage: p.stage, due: p.due, value: p.value, pwin: p.pwin, incumbent: splitNames(p.incumbent)[0] || '', closed: p.closed || '',
    owners: p.owners || {}, roles: Object.entries(p.roles).flatMap(([role, ks]) => ks.map(k => S.byK.get(k)).filter(Boolean).map(r => ({role, name: fullName(r), p: r.p || '', b: r.wm.band})))}));
  return JSON.stringify({kind: 'bearings-team-share', v: 2, owner: clip(owner || 'A teammate', 80), made: TODAY, people: sharePeople(), pursuits, targets: S.targets.map(t => t.name)});
}
function parseShare(text){
  let d; try { d = typeof text === 'string' ? JSON.parse(text) : text; } catch { d = null; }
  if (!d || (d.kind !== 'bearings-team-pack' && d.kind !== 'bearings-team-share') || !Array.isArray(d.people)) throw new Error('That isn’t a Northfix team pack.');
  const band = b => BAND_RANK[b] != null ? b : 'none';
  const people = d.people.slice(0, 50000).filter(p => p && (p.f || p.l)).map(p => ({f: clip(p.f, 80), l: clip(p.l, 80), c: clip(p.c, 160), p: clip(p.p, 240), u: clip(p.u, 300), b: band(p.b)}));
  const pursuits = (Array.isArray(d.pursuits) ? d.pursuits : []).slice(0, 200).filter(p => p && p.name).map(p => ({name: clip(p.name, 160), agency: clip(p.agency, 160),
    stage: STAGES.includes(p.stage) ? p.stage : 'Tracking', due: clip(p.due, 10), value: clip(p.value, 40),
    pwin: p.pwin != null && isFinite(+p.pwin) ? Math.max(0, Math.min(100, Math.round(+p.pwin))) : null, incumbent: clip(p.incumbent, 160), closed: clip(p.closed, 10),
    owners: Object.fromEntries(Object.entries(p.owners && typeof p.owners === 'object' ? p.owners : {}).slice(0, 20).map(([r, o]) => [clip(r, 60), clip(o, 80)]).filter(([r, o]) => r && o)),
    roles: (Array.isArray(p.roles) ? p.roles : []).slice(0, 60).filter(x => x && x.role && x.name).map(x => ({role: clip(x.role, 60), name: clip(x.name, 160), p: clip(x.p, 240), b: band(x.b)}))}));
  const targets = (Array.isArray(d.targets) ? d.targets : []).slice(0, 500).map(t => clip(t, 160)).filter(Boolean);
  return {owner: clip(d.owner || 'A teammate', 80), made: clip(d.made || TODAY, 10), people, pursuits, targets};
}
function addTeamPack(text){
  const t = parseShare(text);
  S.team = S.team.filter(x => x.owner !== t.owner || x.id).concat([t]);
  return {owner: t.owner, count: t.people.length, packs: teamList()};
}
/** Replaces every share that came from the team server. Packs added by hand stay. */
function setTeamShares(list){
  const kept = S.team.filter(t => !t.id), fresh = [];
  for (const x of Array.isArray(list) ? list : []){
    try { fresh.push(Object.assign(parseShare(x.text), {id: clip(x.id, 64)})); } catch { /* skip a share we can't read */ }
  }
  const ids = new Set(fresh.map(t => t.owner));
  S.team = kept.filter(t => !ids.has(t.owner)).concat(fresh);
  return teamList();
}
function removeTeamPack(owner){ S.team = S.team.filter(t => t.owner !== owner || t.id); return teamList(); }
function teamList(){ return S.team.map(t => ({owner: t.owner, made: t.made, count: t.people.length, id: t.id || '', pursuits: (t.pursuits || []).length, targets: (t.targets || []).length})); }
/** The team at a glance: who's on it, combined federal coverage, every pursuit and the team watchlist. */
function teamOverview(){
  const F = S._fed || (S._fed = compileFederal());
  const agenciesOf = ps => { const set = new Set(); for (const p of ps) for (const a of fedHits(F, p.c, p.agency || '', p.p)) set.add(a.id); return set; };
  const mine = agenciesOf(live().map(r => ({c: r.c, agency: r.cl.agency, p: r.p})));
  const members = S.team.map(t => ({owner: t.owner, id: t.id || '', made: t.made, count: t.people.length,
    strong: t.people.filter(p => p.b === 'strong').length, warm: t.people.filter(p => p.b === 'warm').length,
    agencies: agenciesOf(t.people).size, pursuits: (t.pursuits || []).length}));
  const all = new Set(mine);
  for (const t of S.team) for (const id of agenciesOf(t.people)) all.add(id);
  const key = p => `${String(p.f || '').toLowerCase()} ${String(p.l || '').toLowerCase()}|${coKey(p.c)}`;
  const uniq = new Set(live().map(key));
  for (const t of S.team) for (const p of t.people) uniq.add(key(p));
  const cov = agencyCoverage(true);
  const pursuitsOut = [];
  for (const p of S.pursuits){ const sum = pursuitSummary(p); pursuitsOut.push({owner: 'You', mine: true, id: p.id, name: p.name, agency: p.agency, stage: p.stage, due: p.due, days: sum.days, value: p.value, filled: sum.filled, roles: PURSUIT_ROLES.length, people: [], owners: p.owners || {}}); }
  for (const t of S.team) for (const p of t.pursuits || []) pursuitsOut.push({owner: t.owner, mine: false, id: '', name: p.name, agency: p.agency, stage: p.stage, due: p.due,
    days: p.due ? -daysSince(p.due) : null, value: p.value, filled: new Set(p.roles.map(x => x.role)).size, roles: PURSUIT_ROLES.length, people: p.roles, owners: p.owners || {}});
  pursuitsOut.sort((a, b) => (STAGES.indexOf(a.stage) > 3) - (STAGES.indexOf(b.stage) > 3) || ((a.due || '9') < (b.due || '9') ? -1 : 1));
  const names = new Map();
  for (const t of S.targets) names.set(t.name.toLowerCase(), {name: t.name, owners: ['You']});
  for (const t of S.team) for (const n of t.targets || []){ const k = n.toLowerCase(); if (!names.has(k)) names.set(k, {name: n, owners: []}); const e = names.get(k); if (!e.owners.includes(t.owner)) e.owners.push(t.owner); }
  const targets = [...names.values()].map(e => {
    // a watchlist name can be a company or an agency's short name (DISA, DoD CIO)
    const byName = coHit(e.name), fed = F.find(a => a.short === e.name || a.name === e.name);
    const hit = c => byName(c) || (!!fed && !!c && fed.test(c));
    const me = live().filter(r => hit(r.c) || hit(r.cl.agency)).map(r => ({owner: 'You', k: r.k, name: fullName(r), p: r.p || '', b: r.wm.band}));
    const th = teamPaths(hit).map(x => ({owner: x.owner, name: x.name, p: x.p, b: x.b}));
    const best = me.concat(th).sort((a, b) => BAND_RANK[b.b] - BAND_RANK[a.b]).slice(0, 3);
    return {name: e.name, owners: e.owners, people: me.length + th.length, mine: me.length, team: th.length, best};
  }).sort((a, b) => b.owners.length - a.owners.length || a.people - b.people);
  return {members, me: {count: live().length, agencies: mine.size}, people: uniq.size, agencies: {mine: mine.size, team: all.size, total: F.length},
    coverage: {team: cov.totals, mine: cov.mine}, pursuits: pursuitsOut, targets};
}
/** Made-up teammates for the sample network and screenshots: they know people where you don't. */
function demoTeamShares(){
  const F = S._fed || (S._fed = compileFederal());
  const cov = agencyCoverage(false);
  const gaps = cov.rows.filter(r => r.status !== 'covered');
  const A = live(), firsts = [...new Set(A.map(r => r.f))], lasts = [...new Set(A.map(r => r.l))];
  const titles = ['Program Manager', 'Director, Acquisition', 'Deputy Director', 'Contracting Officer', 'Chief Information Security Officer', 'Branch Chief', 'Senior Engineer', 'Division Chief'];
  const bands = ['strong', 'warm', 'warm', 'light', 'light', 'none'];
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const mates = [['Pat Morgan', 0], ['Alex Reyes', 1], ['Sam Okafor', 2]];
  return mates.map(([owner, i]) => {
    // their own people (new names at the same kinds of employers), plus a few where you have no one
    const people = A.filter((r, j) => j % 7 === i).slice(0, 90).map(r => ({f: pick(firsts), l: pick(lasts), c: r.c || '', p: r.p || '', u: '', b: pick(bands)}));
    for (const g of gaps.filter((r, j) => j % 3 === i).slice(0, 12)) for (let n = 0; n < 1 + Math.floor(rnd() * 3); n++)
      people.push({f: pick(firsts), l: pick(lasts), c: g.name, p: pick(titles), u: '', b: pick(bands)});
    const ag = gaps.filter((r, j) => j % 3 === i)[0];
    const pursuits = [{name: `${ag ? ag.short : 'CISA'} ${['OT visibility pilot', 'zero trust gateway', 'grid resilience study'][i]}`, agency: ag ? ag.short : 'CISA', stage: ['Pursuing', 'Proposal', 'Tracking'][i],
      due: isoDay(Date.parse(TODAY) + (20 + 25 * i) * 864e5), value: ['$1.2M', '$3.8M', '$650K'][i],
      roles: people.filter(p => ag && p.c === ag.name).slice(0, 2).map((p, j) => ({role: ['Program manager', 'Contracting officer'][j], name: `${p.f} ${p.l}`, p: p.p, b: p.b}))}];
    const targets = [ag ? ag.short : 'CISA', pick(['DOE', 'TVA', 'CISA', 'USACE', 'NAVFAC'])];
    return {id: `demo-${i}`, text: JSON.stringify({kind: 'bearings-team-share', v: 2, owner, made: TODAY, people, pursuits, targets})};
  });
}
/** Teammates' people at a company, best first, plus who on the team covers it. */
function teamPaths(hit){
  const out = [];
  for (const t of S.team) for (const p of t.people) if (hit(p.c) || hit(clOfShared(p).agency)) out.push({owner: t.owner, name: `${p.f} ${p.l}`.trim(), c: p.c, p: p.p, u: p.u, b: p.b});
  out.sort((a, b) => BAND_RANK[b.b] - BAND_RANK[a.b] || a.name.localeCompare(b.name));
  return out.slice(0, 40);
}

/* ---------- enrichment files ---------- */
// A CSV exported from ZoomInfo, Seamless.AI, Apollo or any other provider, matched to your
// people by LinkedIn link, then email, then name and company. Read on the device only.
const ENRICH_COLS = {
  first: ['first name', 'firstname', 'contact first name', 'person first name'],
  last: ['last name', 'lastname', 'contact last name', 'person last name'],
  name: ['name', 'full name', 'contact name', 'contact full name', 'person name'],
  email: ['email', 'email address', 'work email', 'business email', 'contact email', 'email 1', 'direct email', 'corporate email'],
  phone: ['direct phone', 'direct phone number', 'direct dial', 'work direct phone', 'contact phone 1', 'phone', 'phone number', 'work phone', 'business phone', 'corporate phone'],
  mobile: ['mobile', 'mobile phone', 'mobile phone number', 'cell', 'cell phone', 'contact mobile phone'],
  title: ['title', 'job title', 'position', 'contact title'],
  company: ['company', 'company name', 'account name', 'organization', 'company name for emails'],
  city: ['city', 'person city', 'contact city', 'city (person)'],
  state: ['state', 'person state', 'contact state', 'state abbr', 'state (person)', 'region'],
  country: ['country', 'person country', 'contact country'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin profile url', 'person linkedin url', 'li profile url', 'linkedin contact profile url', 'contact linkedin url'],
};
function matchEnrichment(text, src){
  const grid = parseCSV(String(text || '').replace(/^\ufeff/, ''));
  const norm = h => String(h || '').trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  const hi = grid.findIndex(r => r.map(norm).some(c => ENRICH_COLS.first.includes(c) || ENRICH_COLS.name.includes(c)));
  if (hi < 0) throw new Error('That file has no name columns. Export people from your provider as a CSV with first and last name, company and email.');
  const H = grid[hi].map(norm);
  const col = {}; for (const [k, names] of Object.entries(ENRICH_COLS)){ for (const n of names){ const i = H.indexOf(n); if (i >= 0){ col[k] = i; break; } } }
  const nm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const bySlug = new Map(), byEmail = new Map(), byNameCo = new Map(), byName = new Map();
  for (const r of S.all){
    const sl = slugOf(r.u); if (sl) bySlug.set(sl, r.k);
    if (r.e) byEmail.set(r.e.toLowerCase(), r.k);
    const n = nm(`${r.f} ${r.l}`); if (!n) continue;
    byNameCo.set(n + '|' + coKey(r.c), r.k);
    byName.set(n, byName.has(n) ? null : r.k);
  }
  const out = {}; let rows = 0; const others = [];
  for (const g of grid.slice(hi + 1)){
    const get = k => col[k] != null ? String(g[col[k]] || '').trim() : '';
    const full = get('name') || `${get('first')} ${get('last')}`.trim();
    if (!full && !get('email') && !get('linkedin')) continue;
    rows++;
    const email = get('email');
    const k = bySlug.get(slugOf(get('linkedin'))) || (email && byEmail.get(email.toLowerCase())) || byNameCo.get(nm(full) + '|' + coKey(get('company'))) || byName.get(nm(full));
    if (!k){ if (full && get('company')) others.push({name: full, p: get('title'), c: get('company'), e: email, li: get('linkedin')}); continue; }
    const e = {email, phone: get('phone'), mobile: get('mobile'), title: get('title'), company: get('company'), city: get('city'), state: get('state'), country: get('country')};
    for (const f of Object.keys(e)) if (!e[f]) delete e[f];
    if (Object.keys(e).length) out[k] = Object.assign(out[k] || {}, e);
  }
  // people you don't know yet fill the empty seats on org charts
  const added = addProspects(others, src || 'file');
  return {rows, matched: Object.keys(out).length, people: out, added};
}
// People you aren't connected to (from an enrichment file or a provider search), kept only to
// fill org charts. list: [{name, p, c, e?, li?}]
function addProspects(list, src){
  const key = x => fold_(x.name) + '|' + coKey(x.c);
  const have = new Map(S.prospects.map(x => [key(x), x]));
  let n = 0;
  for (const x of (list || []).slice(0, 3000)){
    if (!x || !x.name || !x.c) continue;
    const o = {name: String(x.name).trim(), p: String(x.p || '').trim(), c: String(x.c).trim(), src: src || 'file', at: TODAY};
    if (x.e) o.e = String(x.e).trim(); if (x.li) o.li = String(x.li).trim();
    if (!have.has(key(o))) n++;
    have.set(key(o), Object.assign(have.get(key(o)) || {}, o));
  }
  S.prospects = [...have.values()].slice(-5000);
  return n;
}
function clearProspects(q){ const before = S.prospects.length; S.prospects = q ? S.prospects.filter(x => coKey(x.c) !== coKey(q)) : []; return {removed: before - S.prospects.length}; }

/* ---------- memory ---------- */
// What you'd want to remember walking into a room with someone: the last thing you
// noted, the last thing either of you wrote, whether they're waiting on you, and news.
const NOTE_LINE = /^(\d{4}-\d{2}-\d{2})(?:\s*\(([^)]*)\))?:\s*(.+)$/;
function memory(k){
  const r = S.byK.get(k); if (!r) return null;
  const he = r.f || 'They';
  const notes = String((r.ed && r.ed.note) || '').split('\n').map(x => x.trim()).filter(Boolean);
  let last = null;
  for (let i = notes.length - 1; i >= 0 && !last; i--){ const m = notes[i].match(NOTE_LINE); if (m) last = {date: m[1], source: m[2] || '', text: m[3]}; }
  if (!last && notes.length) last = {date: (r.ed && r.ed.updated) || '', source: '', text: notes[notes.length - 1]};
  const x = r.rx || {};
  const msg = x.t ? {date: x.t, mine: x.dir === 'o', text: String(x.s || '').slice(0, 160)} : null;
  const ml = mailOf(r);
  const mail = ml ? {date: ml.t, mine: ml.dir === 'o', subject: ml.s || '', count: ml.n || 1, lastIn: ml.ti || (ml.dir === 'i' ? ml.t : ''), lastOut: ml.to || (ml.dir === 'o' ? ml.t : '')} : null;
  const parts = [];
  const mailNewest = mail && (!last || !last.date || mail.date > last.date) && (!msg || mail.date >= msg.date);
  const mailWaiting = isMailWaiting(r);
  if (mailNewest){
    const subj = mail.subject ? ': “' + mail.subject + '”' : '';
    if (mail.mine) parts.push(`You emailed ${he} ${ago(mail.date)}${subj}.`);
    else parts.push(`${he} emailed you ${ago(mail.date)}${subj}${mailWaiting ? ', you haven’t replied' : ''}.`);
  }
  if (mailNewest && last) parts.push(`Your last note${last.date ? ' (' + niceDate(last.date) + ')' : ''}: ${last.text.length > 90 ? last.text.slice(0, 87).replace(/\s+\S*$/, '') + '…' : last.text}`);
  else if (mailNewest) {}
  else if (last) parts.push(`Last time${last.date ? ' (' + niceDate(last.date) + ')' : ''}: ${last.text.length > 120 ? last.text.slice(0, 117).replace(/\s+\S*$/, '') + '…' : last.text}`);
  else if (msg && msg.text) parts.push(`${msg.mine ? 'You wrote' : he + ' wrote'} ${niceDate(msg.date)}: “${msg.text.length > 90 ? msg.text.slice(0, 87).replace(/\s+\S*$/, '') + '…' : msg.text}”`);
  else if (msg) parts.push(`Last message ${niceDate(msg.date)}.`);
  if (isWaiting(r)) parts.push(`${he} is waiting on your reply.`);
  else if (mailWaiting && !mailNewest) parts.push(`${he} is waiting on your email reply.`);
  { const so = socialOf(k); if (so){ const on = Object.keys(so.on || {}).map(p => PLATFORMS[p]); if (on.length) parts.push(`Also connected on ${on.length > 1 ? on.slice(0, -1).join(', ') + ' and ' + on[on.length - 1] : on[0]}.`); } }
  { const mv = moveOf(r); if (mv) parts.push(mv.kind === 'pcs' ? `Likely to rotate ${mv.est <= TODAY ? 'soon' : 'by ' + niceDate(mv.est)}.` : `${he} is ${/retir/i.test((r.p || '') + (r.c || '')) ? 'retiring' : 'transitioning out'}.`); }
  if (r.jc && daysAgo(r.jc) <= 120) parts.push(`New role${r.p ? ' as ' + r.p : ''}${r.c ? ' at ' + r.c : ''} since ${niceDate(r.jc)}.`);
  if (!parts.length) parts.push(r.d ? `Connected ${niceDate(r.d)}. No notes yet.` : 'No notes yet.');
  return {k, line: parts.join(' '), last, msg, mail, waiting: isWaiting(r) || isMailWaiting(r)};
}

/* ---------- org chart ---------- */
const SRC_ORDER = {you: 0, team: 1, list: 2};
// Who you (and your team) know at a company or agency, by level and function, with the
// seats nobody covers. Reporting lines come from your own edits ("reports to").
function orgChart(q){
  const want = coKey(q);
  if (want.length < 2) return {company: '', levels: [], funcs: [], gaps: [], links: []};
  const hit = c => { const k = coKey(c); return !!k && (k === want || (want.length >= 4 && (k.startsWith(want + ' ') || k.includes(' ' + want + ' ') || k.endsWith(' ' + want)))); };
  const mine = live().filter(r => hit(r.c) || hit(r.cl.agency));
  const cards = mine.map(r => ({k: r.k, name: `${r.f} ${r.l}`.trim(), p: r.p || '', sen: r.cl.sen, func: r.cl.func, band: r.wm.band, score: r.wm.score, src: 'you', rt: (r.ed && r.ed.rt) || ''}));
  // company text per card, for placing people in an agency's offices (kept off the card)
  const coOf = new Map(cards.map((c, i) => [c, [mine[i].c, mine[i].cl.agency].filter(Boolean).join(' / ')]));
  const seen = new Set(cards.map(c => fold_(c.name)));
  for (const t of teamPaths(hit)){
    if (seen.has(fold_(t.name))) continue;
    seen.add(fold_(t.name));
    const role = roleOf(t.p);
    const card = {k: '', name: t.name, p: t.p, sen: role.sen, func: role.func, band: t.b, score: 0, src: 'team', owner: t.owner, rt: ''};
    cards.push(card); coOf.set(card, t.c || '');
  }
  for (const x of S.prospects){
    if (!hit(x.c) || seen.has(fold_(x.name))) continue;
    seen.add(fold_(x.name));
    const role = roleOf(x.p);
    const card = {k: '', name: x.name, p: x.p, sen: role.sen, func: role.func, band: 'none', score: 0, src: 'list', owner: x.src, rt: ''};
    if (x.e) card.e = x.e; if (x.li) card.li = x.li;
    cards.push(card); coOf.set(card, x.c || '');
  }
  const bySeat = (a, b) => (SRC_ORDER[a.src] - SRC_ORDER[b.src]) || b.score - a.score || a.name.localeCompare(b.name);
  const levels = SENIORITY.map(id => ({id, people: cards.filter(c => c.sen === id).sort(bySeat)}));
  const fc = {}; for (const c of cards) fc[c.func] = (fc[c.func] || 0) + 1;
  const funcs = Object.entries(fc).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({id, n}));
  // a function where you know someone, but no one at director level or above
  const top = new Set(cards.filter(c => c.src !== 'list' && SENIORITY.indexOf(c.sen) <= 2).map(c => c.func));
  const gaps = funcs.filter(f => f.id !== 'Other / Unspecified' && !top.has(f.id)).map(f => f.id).slice(0, 6);
  const links = cards.filter(c => c.k && c.rt && cards.some(o => o.k === c.rt)).map(c => ({from: c.k, to: c.rt}));
  const name = (mine[0] && (hit(mine[0].c) ? mine[0].c : mine[0].cl.agency)) || (S.prospects.find(x => hit(x.c)) || {}).c || q;
  const count = src => cards.filter(c => c.src === src).length;
  const out = {company: name, total: cards.length, known: count('you'), team: count('team'), listed: count('list'), levels: levels.filter(l => l.people.length), allLevels: SENIORITY, funcs, gaps, links};
  const ag = findAgency(name) || findAgency(q);
  if (ag) out.structure = officeStructure(ag, cards, coOf, bySeat);
  return out;
}
// The team's shared picture of one agency: the org chart from you and every teammate's share
// (decrypted on this device by setTeamShares; nothing new is sent or stored), with every open
// pursuit there, yours and theirs, and the government seats nobody fills yet, with who on the
// chart could fill each.
function teamAgencyOrg(q){
  const chart = orgChart(q);
  const F = fedRows();
  const ag = agencyFor(q, F);
  const want = coKey(q);
  const atAgency = name => { if (!name) return false; const a = agencyFor(name, F); return ag && a ? a.id === ag.id : coKey(name) === want; };
  const cards = chart.levels.flatMap(l => l.people).filter(c => c.src !== 'list');
  const govSeats = PURSUIT_ROLES.filter(([, rx, field]) => rx && !field);
  const seatList = (name, owner, stage, filledBy) => govSeats.map(([role, rx]) => {
    const holders = filledBy(role);
    const candidates = holders.length ? [] : cards.filter(c => rx.test(c.p || '')).sort((a, b) => BAND_RANK[b.band] - BAND_RANK[a.band] || a.name.localeCompare(b.name)).slice(0, 3)
      .map(c => ({name: c.name, p: c.p, band: c.band, k: c.k || '', via: c.src === 'team' ? c.owner : 'You'}));
    return {pursuit: name, owner, stage, role, filled: holders.length > 0, holders, candidates};
  });
  const pursuitsOut = [];
  for (const p of S.pursuits) if (isOpen(p) && atAgency(p.agency))
    pursuitsOut.push({id: p.id, name: p.name, owner: 'You', stage: p.stage, due: p.due, seats: seatList(p.name, 'You', p.stage, role => (p.roles[role] || []).map(k => S.byK.get(k)).filter(Boolean).map(r => fullName(r)))});
  for (const t of S.team) for (const p of t.pursuits || []) if (STAGES.indexOf(p.stage) < 4 && atAgency(p.agency))
    pursuitsOut.push({id: '', name: p.name, owner: t.owner, stage: p.stage, due: p.due || '', seats: seatList(p.name, t.owner, p.stage, role => (p.roles || []).filter(x => x.role === role).map(x => x.name))});
  const open = pursuitsOut.flatMap(p => p.seats.filter(s => !s.filled));
  const contributors = [{owner: 'You', people: chart.known || 0}].concat(S.team.map(t => ({owner: t.owner, people: cards.filter(c => c.src === 'team' && c.owner === t.owner).length}))).filter(c => c.people > 0);
  return {agency: ag ? {id: ag.id, short: ag.short, name: ag.name} : null, company: chart.company, total: chart.total || 0, known: chart.known || 0, team: chart.team || 0,
    levels: chart.levels || [], gaps: chart.gaps || [], structure: chart.structure || null, contributors, pursuits: pursuitsOut,
    openSeats: open.length, fillable: open.filter(s => s.candidates.length).length};
}
// An agency's top-level offices with the people placed in them (by title, then company).
function officeStructure(ag, cards, coOf, order){
  const a = ag.a;
  const offices = a.offices.map(o => ({code: o.code, name: o.name, people: [], filled: false}));
  for (const c of cards){ const i = officeOf(ag, c.p, coOf.get(c)); if (i >= 0) offices[i].people.push(c); }
  for (const o of offices){ o.people.sort(order); o.filled = o.people.length > 0; }
  return {agency: a.agency, short: a.short, leader: a.leader, asOf: a.asOf, source: a.source, offices};
}
// The structure for an agency even when you know no one there yet; null if it isn't one we map.
function structureFor(q){
  const o = orgChart(q);
  if (o.structure) return o.structure;
  const ag = findAgency(q);
  return ag ? officeStructure(ag, [], new Map(), () => 0) : null;
}
const fold_ = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, '').trim();
const setReportsTo = (k, boss) => setEdit(k, {rt: boss && boss !== k ? boss : ''});

/* ---------- meeting notes ---------- */
// Text from anywhere (a Plaud transcript or summary, an Apple Note, a reMarkable page read
// on the phone): who in your network it mentions, the action items, and a short summary.
function readNotes(text){
  const t = String(text || '').replace(/\r/g, '').replace(/\u00a0/g, ' ').slice(0, 200000);
  const fold = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hay = fold(t);
  const word = c => !!c && /[a-z0-9]/.test(c);
  const found = [];
  for (const r of live()){
    const f = String(r.f || '').trim(), l = String(r.l || '').trim();
    if (f.length < 2 || l.length < 2) continue;
    const full = fold(`${f} ${l}`);
    let i = hay.indexOf(full), n = 0, at = -1;
    while (i >= 0){
      if (!word(hay[i - 1]) && !word(hay[i + full.length])){ n++; if (at < 0) at = i; }
      i = hay.indexOf(full, i + full.length);
    }
    if (n) found.push({k: r.k, name: `${f} ${l}`, first: f, n, at});
  }
  found.sort((a, b) => b.n - a.n || a.at - b.at);
  const people = found.slice(0, 25);
  const whoIn = s => { const x = fold(s); const p = people.find(q => x.includes(fold(q.name))) || people.find(q => new RegExp('\\b' + fold(q.first).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(x)); return p ? p.k : ''; };

  const lines = t.split('\n').map(x => x.trim());
  const head = /^(?:#+\s*)?(?:\*\*)?(action items?|next steps?|follow[- ]?ups?|to[- ]?dos?|tasks|takeaways)(?:\*\*)?\s*:?\s*$/i;
  const sumHead = /^(?:#+\s*)?(?:\*\*)?(summary|overview|key points|meeting summary|highlights)(?:\*\*)?\s*:?\s*$/i;
  const anyHead = /^(?:#+\s+\S|\*\*[^*]{2,60}\*\*\s*:?$|[A-Z][A-Za-z /&]{2,40}:$)/;
  const actions = [];
  let section = '';
  const summary = [];
  let gap = false;
  for (const line of lines){
    if (!line){ gap = true; continue; }
    const wasGap = gap; gap = false;
    if (head.test(line)){ section = 'actions'; continue; }
    if (sumHead.test(line)){ section = 'summary'; continue; }
    if (anyHead.test(line)){ section = ''; continue; }
    const bullet = line.match(/^(?:[-*•▪◦]|\d+[.)]|\[[ x]?\])\s+(.*)$/i);
    const tagged = line.match(/^(?:todo|to-do|action(?: item)?|follow[- ]?up|next step)\s*[:\-–]\s*(.+)$/i);
    // in an action list, a plain line after a blank line means the list is over
    if (section === 'actions' && !bullet && !tagged && wasGap) section = '';
    const txt = tagged ? tagged[1] : (section === 'actions' ? (bullet ? bullet[1] : line) : null);
    if (txt && txt.length > 3 && actions.length < 20) actions.push({text: txt.replace(/\s+/g, ' ').replace(/^\*\*|\*\*$/g, '').slice(0, 200), k: whoIn(txt)});
    else if (section === 'summary' && summary.join(' ').length < 420) summary.push(bullet ? bullet[1] : line);
  }
  const plain = lines.filter(Boolean);
  const title = (plain[0] || '').replace(/^#+\s*/, '').replace(/\*\*/g, '').slice(0, 90);
  let sum = summary.join(' ');
  if (!sum){
    const body = plain.slice(1).filter(x => !head.test(x) && !anyHead.test(x) && !/^(?:[-*•]|\d+[.)])\s/.test(x));
    sum = body.join(' ');
  }
  sum = sum.replace(/\s+/g, ' ').trim();
  if (sum.length > 360) sum = sum.slice(0, 357).replace(/\s+\S*$/, '') + '…';
  return {title, summary: sum, people: people.map(({k, name, n}) => ({k, name, n})), actions, words: t.split(/\s+/).filter(Boolean).length};
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
  if (!data || data.kind !== 'notes-backup' || typeof data.edits !== 'object') throw new Error('That isn’t a Northfix backup file.');
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
  S.competitors = Array.isArray(st.competitors) ? st.competitors.filter(c => typeof c === 'string' && c.trim()) : [];
  S.coInd = Object.assign(Object.create(null), st.companies || {});
  S.coLink = Object.assign(Object.create(null), st.links || {});
  S.coLoc = Object.assign(Object.create(null), st.locations || {});
  S.team = Array.isArray(st.team) ? st.team : [];
  S.prospects = Array.isArray(st.prospects) ? st.prospects : [];
  S.pursuits = Array.isArray(st.pursuits) ? st.pursuits : [];
  S.snaps = (st.snaps && typeof st.snaps === 'object') ? st.snaps : {};
  S.social = Array.isArray(st.social) ? st.social : [];
  S._byHandle = null;
  if ('lens' in st) S.lensPref = st.lens;
  hydrate(st.rows || []);
  return info();
}
function loadSample(){
  const s = sampleNetwork();
  const out = load({mode: 'sample', rows: s.rows, meta: s.meta || {lastImport: TODAY, n: 1}, edits: s.edits || {}, review: {}, targets: SAMPLE_TARGETS.map(name => ({name, added: TODAY})), lens: S.lensPref});
  S.pursuits = samplePursuits();
  return out;
}
// Native apps hand over the raw saved files; parsing them here keeps one source of truth.
function loadFiles(f, lens){
  const p = t => { if (!t) return null; try { return JSON.parse(t); } catch { return null; } };
  const n = p(f.network), e = p(f.edits), rv = p(f.review), tg = p(f.targets), ci = p(f.industries), tm = p(f.team), pr = p(f.prospects), pu = p(f.pursuits), hi = p(f.history), so = p(f.social);
  if (!n || !n.rows) return Object.assign(loadSample(), {empty: true});
  return load({mode: 'live', rows: n.rows, meta: n.meta || {}, edits: (e && e.edits) || {}, review: (rv && rv.review) || {}, targets: (tg && tg.targets) || [], competitors: (tg && tg.competitors) || [],
    companies: (ci && ci.companies) || {}, links: (ci && ci.links) || {}, locations: (ci && ci.locations) || {}, team: (tm && tm.packs) || [], prospects: (pr && pr.prospects) || [], pursuits: (pu && pu.pursuits) || [], snaps: (hi && hi.snaps) || {}, social: (so && so.social) || [], lens});
}
function fileData(name){
  if (name === 'network'){ if (!S.pending) throw new Error('Nothing to save'); const p = S.pending; S.pending = null; return p; }
  if (name === 'edits') return {edits: S.edits, rev: Date.now()};
  if (name === 'review') return {review: S.review};
  if (name === 'targets') return S.competitors.length ? {targets: S.targets, competitors: S.competitors} : {targets: S.targets};
  if (name === 'industries') return {companies: S.coInd, links: S.coLink, locations: S.coLoc};
  if (name === 'team') return {packs: S.team};
  if (name === 'prospects') return {prospects: S.prospects};
  if (name === 'pursuits') return {pursuits: S.pursuits};
  if (name === 'history') return {snaps: S.snaps};
  if (name === 'social') return {social: S.social};
  throw new Error('Unknown file ' + name);
}
function clearNotes(){ S.edits = {}; S.review = {}; S.targets = []; S.competitors = []; S.coInd = Object.create(null); S.coLink = Object.create(null); S.coLoc = Object.create(null); return true; }
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
function person(k){ const r = S.byK.get(k); if (!r) return null; const so = socialOf(k); return Object.assign(vm(r, true), {links: {profile: links.person(r), salesNav: links.snPerson(r)}}, so ? {social: {on: so.on, h: so.h}} : {}); }
/* ---------- flights and travel feeds (src/flights.js) ---------- */
// One event: is it a flight, and where do you land? Null when it isn't one.
function flightInfo(title, location, notes){ return parseFlight(title, location, notes); }
// Many at once ([[title, location, notes], …]), so the iPhone asks once per calendar scan.
function flightInfos(list){ return (list || []).map(x => Array.isArray(x) ? parseFlight(x[0], x[1], x[2]) : null); }
// A TripIt (or any iCalendar) feed's text → trips. home: {lat, lon, name} or null.
function feedTrips(icsText, home){ return tripsFromFeed(icsText, home || null); }
// Calendar events the app read itself ({uid, start, end (ms), startDay, endDay, allDay, title, location, notes}) → trips.
function eventTrips(events, home, opts){ return tripsFromEvents(events, home || null, opts || {}); }
function icsEvents(icsText){ return parseICS(icsText); }

function constants(){
  return {industries: INDUSTRIES.map(i => ({id: i.id, short: i.short, color: i.color})), seniority: SENIORITY, funcs: FUNCS, segs: SEGS.map(s => ({id: s.id, short: s.short, color: segColor(s.id)})),
    branches: BRANCHES, statuses: STATUSES, tiers: TIERS, certs: CERTS.map(c => c[0]), since: SINCE, signals: SIGNALS_UI, grades: GRADE_OPTS, bands: BAND_LABEL, unclassified: UNCLASSIFIED, gov: GOV_IND};
}

const api = {load, loadSample, loadFiles, clearNotes, clusters, placeClues, setCompanyLocation, companyPlaces, messages, matchAttendees, alsoAt, setLens, info, people, person, search, facets, home, payoff, targets, unit, addTargetCandidates, toggleTarget, setTargetNote, orgs,
  industries, industry, setCompanyIndustry, setCompanyLink, ranks, deck, deckCount, reviewed, radar, compass, startFromContacts, introPaths, weekly, touch, setCircle, setEdit, followUp, markReplied, addNote,
  importTexts, importSnapshot, yearInReview, teamPack, teamShare, addTeamPack, setTeamShares, removeTeamPack, teamList, teamOverview, demoTeamShares, matchEnrichment, readNotes, memory, applyMail, clearMail, addProspects, clearProspects, addPursuit, updatePursuit, removePursuit, assignRole, setSeatOwner, pursuits, pursuit, coldSeats, pipeline, pursuitSheet, callPlan, matchAttendeeList, tagAttendees,
  applyInbox, inboxRest, fiscalOf, setPursuitDate, upcomingDates, bidDecision, setBidAnswer, setCompetitor, competitors, captureDigest, setAsidePrograms: () => SET_ASIDE_PROGRAMS.map(([id, label]) => ({id, label})), awardRequests, awardPage, mergeAwardPages, demoAwardPages, recompetes, pursueAward, teamingPartners, federalAsOf: () => FEDERAL_AS_OF, moves, setRoleSince, quickLog, addIntro, setIntro, intros, trend, snapshot, targetChanges, ask, importSocial, clearSocial, socials, agencyCoverage, matchOpportunities, opportunityFilters, opportunityRequests, opportunityPage, demoOpportunities, markOpportunitiesSeen, orgChart, structureFor, setReportsTo, backup, restore, exportCSV, reminders, watch, constants, quote,
  teamAgencyOrg,
  flightInfo, flightInfos, feedTrips, feedCheck, eventTrips, icsEvents, mergeOpportunities};
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
