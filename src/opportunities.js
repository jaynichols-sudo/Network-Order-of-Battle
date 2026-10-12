// SAM.gov opportunities matched to your network. The phone fetches notices from SAM.gov's
// public Get Opportunities API (v2) with the user's own key; this file reads the results,
// maps each buying office to an agency on the federal map, and says who you know there.
// No network calls here: the apps do those, straight from the device to SAM.gov.
//
// API: https://open.gsa.gov/api/get-opportunities-public-api/
//   GET https://api.sam.gov/opportunities/v2/search?api_key=…&postedFrom=MM/dd/yyyy&postedTo=MM/dd/yyyy&limit=…&offset=…
//   optional: ptype (one notice type), ncode (one NAICS code)
//   answer: {totalRecords, limit, offset, opportunitiesData: [{noticeId, title, solicitationNumber,
//            fullParentPathName "DEPT OF DEFENSE.DEPT OF THE NAVY.NAVFAC…", postedDate, type,
//            responseDeadLine, naicsCode, uiLink, award, typeOfSetAsideDescription, …}]}
import { findAgency, officeOf, norm } from './agencies.js';

export const SAM_URL = 'https://api.sam.gov/opportunities/v2/search';

/* ---------- notice types ---------- */
// [code SAM.gov's ptype uses, plain label, how SAM.gov writes it in `type`]
export const NOTICE_TYPES = [
  ['r', 'Sources sought', /sources sought/i],
  ['p', 'Presolicitation', /pre-?solicitation/i],
  ['k', 'Combined solicitation', /combined synopsis/i],
  ['o', 'Solicitation', /solicitation/i],
  ['s', 'Special notice', /special notice/i],
  ['a', 'Award', /award/i],
  ['u', 'Justification', /justification|j&a/i],
  ['i', 'Intent to bundle', /bundl/i],
  ['g', 'Surplus sale', /surplus/i],
];
const TYPE_LABEL = Object.fromEntries(NOTICE_TYPES.map(([c, l]) => [c, l]));
export const DEFAULT_TYPES = ['r', 'p', 'k', 'o', 's'];
/** The one-letter code for SAM.gov's `type` text ("Sources Sought", "Combined Synopsis/Solicitation"). */
export function typeCode(t){
  const s = String(t || '').trim();
  if (/^[a-z]$/i.test(s)) return s.toLowerCase();
  // order matters: "Combined Synopsis/Solicitation" and "Presolicitation" before plain "Solicitation"
  for (const [c, , rx] of NOTICE_TYPES) if (rx.test(s)) return c;
  return 's';
}

/* ---------- filters ---------- */
const splitList = v => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map(x => String(x).trim()).filter(Boolean);
/** NAICS codes (2 to 6 digits), keywords and notice types, cleaned up from what the user typed. */
export function opportunityFilters(input){
  const f = input || {};
  const naics = [...new Set(splitList(f.naics).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 2 && x.length <= 6))].slice(0, 12);
  const keywords = [...new Set(splitList(f.keywords).map(x => x.replace(/\s+/g, ' ').slice(0, 60)))].slice(0, 12);
  const known = new Set(NOTICE_TYPES.map(t => t[0]));
  let types = [...new Set(splitList(f.types).map(x => x.toLowerCase()).filter(x => known.has(x)))];
  if (!types.length) types = DEFAULT_TYPES.slice();
  return {naics, keywords, types};
}

/* ---------- the requests ---------- */
const mdy = iso => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const isoOf = ms => { const z = new Date(ms); return z.getFullYear() + '-' + String(z.getMonth() + 1).padStart(2, '0') + '-' + String(z.getDate()).padStart(2, '0'); };
/**
 * The searches to run, as query parameters (without api_key). SAM.gov limits how many
 * searches a key can run each day, so this asks for as few as it can: one search, or one per
 * full six-digit NAICS code when there are three or fewer. Everything else is filtered here.
 */
export function opportunityRequests(filters, days, today){
  const f = opportunityFilters(filters);
  const n = Math.max(1, Math.min(90, +days || 14));
  const to = today || isoOf(Date.now());
  const from = isoOf(Date.parse(to + 'T12:00:00') - n * 864e5);
  const base = {postedFrom: mdy(from), postedTo: mdy(to), limit: 1000, offset: 0};
  if (f.types.length === 1) base.ptype = f.types[0];
  const six = f.naics.filter(x => x.length === 6);
  if (six.length && six.length === f.naics.length && six.length <= 3) return six.map(ncode => Object.assign({}, base, {ncode}));
  return [base];
}

/* ---------- reading an answer ---------- */
const KEEP = ['noticeId', 'title', 'solicitationNumber', 'fullParentPathName', 'department', 'subTier', 'office', 'postedDate', 'type', 'baseType',
  'responseDeadLine', 'naicsCode', 'classificationCode', 'uiLink', 'typeOfSetAsideDescription', 'active'];
function slim(o){
  const out = {};
  // every field as text, so the apps can read them without guessing types
  for (const k of KEEP) if (o[k] != null && o[k] !== '' && typeof o[k] !== 'object') out[k] = String(o[k]).slice(0, 400);
  const a = o.award;
  if (a && typeof a === 'object' && (a.amount || (a.awardee && a.awardee.name) || a.date)) out.award = {amount: a.amount != null ? String(a.amount) : '', date: String(a.date || ''), awardee: String((a.awardee && a.awardee.name) || '')};
  if (o.demo) out.demo = true;
  return out;
}
/** One SAM.gov answer (the response text): the slim notices, the total, or a plain-English error. */
export function opportunityPage(text){
  let j;
  try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { return {total: 0, items: [], error: 'SAM.gov sent back something Northfix couldn’t read. Try again later.'}; }
  if (!j || typeof j !== 'object') return {total: 0, items: [], error: 'SAM.gov sent back an empty answer.'};
  const err = j.error || (j.errorCode || j.errorMessage ? {code: j.errorCode, message: j.errorMessage} : null) || (j.code && j.message && !j.opportunitiesData ? j : null);
  if (err){
    const code = String(err.code || ''), msg = String(err.message || err.description || '');
    if (/API_KEY|key/i.test(code + ' ' + msg)) return {total: 0, items: [], error: 'SAM.gov didn’t accept that API key. Copy it again from your SAM.gov account (Account Details, Public API Key).', code: 'key'};
    if (/OVER_RATE|rate|limit/i.test(code + ' ' + msg)) return {total: 0, items: [], error: 'SAM.gov’s daily search limit for this key is used up. Northfix will try again later.', code: 'rate'};
    return {total: 0, items: [], error: `SAM.gov said: ${msg || code || 'something went wrong'}`};
  }
  const list = Array.isArray(j.opportunitiesData) ? j.opportunitiesData : Array.isArray(j) ? j : [];
  return {total: +j.totalRecords || list.length, items: list.filter(o => o && o.noticeId).map(slim)};
}

/* ---------- which agency ---------- */
// SAM.gov writes offices in capitals with its own short forms. These catch the ones the
// federal map's aliases miss; the rest are matched against the map itself.
const SAM_ALIASES = [
  [/NAVFAC|NAVAL FACILITIES ENGINEERING/, 'NAVFAC'],
  [/\bUSACE\b|CORPS OF ENGINEERS|\bENGINEER (DISTRICT|DIVISION)\b|\bENDIST\b|\bENDIV\b|\bUSAED\b/, 'USACE'],
  [/\bDISA\b|DEFENSE INFORMATION SYSTEMS/, 'DISA'],
  [/\bCISA\b|CYBERSECURITY AND INFRASTRUCTURE SECURITY/, 'CISA'],
  [/\bNAVSEA\b|NAVAL SEA SYSTEMS/, 'NAVSEA'],
  [/\bNAVAIR\b|NAVAL AIR (SYSTEMS|WARFARE)/, 'NAVAIR'],
  [/\bNAVWAR\b|\bNIWC\b|\bSPAWAR\b|NAVAL INFORMATION WARFARE/, 'NAVWAR'],
  [/\bNAVSUP\b|NAVAL SUPPLY/, 'NAVSUP'],
  [/\bMARCORSYSCOM\b|MARINE CORPS SYSTEMS COMMAND/, 'MARCORSYSCOM'],
  [/\bAFCEC\b|AIR FORCE CIVIL ENGINEER/, 'AFCEC'],
  [/\bAFLCMC\b|LIFE CYCLE MANAGEMENT CENTER/, 'AFLCMC'],
  [/\bAFRL\b|AIR FORCE RESEARCH LAB/, 'AFRL'],
  [/\bDLA\b|DEFENSE LOGISTICS AGENCY/, 'DLA'],
  [/\bUSCG\b|COAST GUARD/, 'USCG'],
  [/\bNNSA\b|NATIONAL NUCLEAR SECURITY/, 'NNSA'],
  [/CYBERSECURITY,? ENERGY SECURITY/, 'CESER'],
  [/BONNEVILLE POWER/, 'BPA'],
  [/WESTERN AREA POWER/, 'WAPA'],
  [/TENNESSEE VALLEY AUTHORITY/, 'TVA'],
  [/BUREAU OF RECLAMATION/, 'USBR'],
  [/\bFEMA\b|FEDERAL EMERGENCY MANAGEMENT/, 'FEMA'],
  [/\bTSA\b|TRANSPORTATION SECURITY ADMIN/, 'TSA'],
  [/VETERANS HEALTH ADMIN|\bVHA\b|\bVISN\b/, 'VHA'],
  [/FOREST SERVICE|USDA-FS/, 'USFS'],
];
/** "ENERGY, DEPARTMENT OF" as "Department of ENERGY", "DEPT OF THE NAVY" as "Department of THE NAVY". */
const readable = s => String(s || '').replace(/^\s*(.+?),\s*DEPARTMENT OF\s*$/i, 'Department of $1').replace(/\bDEPT\.? OF\b/gi, 'Department of').replace(/\bU\.? ?S\.? /g, 'US ');
const titleCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase())
  .replace(/\b(Of|The|And|For|In|At)\b/g, m => m.toLowerCase())
  .replace(/\b(Us|It|Ot|Ics|Dod|Doe|Dhs|Va|Navfac|Usace|Disa|Cisa|Nasa|Gsa|Afb|Ii|Iii|Iv)\b|\b[a-z]*\d[a-z\d]*\b/gi, m => m.toUpperCase()).replace(/^./, m => m.toUpperCase());
function pathOf(o){
  const p = o.fullParentPathName || [o.department, o.subTier, o.office].filter(Boolean).join('.');
  return String(p || '').split('.').map(x => x.trim()).filter(Boolean);
}
/** The federal map row a notice's office belongs to, and which part of the path said so. */
export function samAgency(o, F){
  const segs = pathOf(o);
  for (let i = segs.length - 1; i >= 0; i--){
    const raw = segs[i].toUpperCase();
    for (const [rx, short] of SAM_ALIASES){ if (rx.test(raw)){ const a = F.find(x => x.short === short); if (a) return {a, i, segs}; } }
    const r = readable(segs[i]);
    const hit = F.find(x => x.test(r));
    if (hit) return {a: hit, i, segs};
  }
  return {a: null, i: -1, segs};
}
/** USACE "ENGINEER DISTRICT SAVANNAH" as "Savannah District", so the org chart's offices match. */
const officeText = s => String(s || '').replace(/\b(?:US ARMY )?(?:ENGINEER DISTRICT|ENDIST|USAED)\s+(.+)$/i, '$1 District').replace(/[_-]+/g, ' ');

/* ---------- matching ---------- */
const dayOf = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };
const daysUntil = (d, today) => d ? Math.round((Date.parse(d + 'T12:00:00') - Date.parse(today + 'T12:00:00')) / 864e5) : null;
const BAND_RANK = {strong: 3, warm: 2, light: 1, none: 0};
const lowerHay = o => `${o.title || ''} ${o.solicitationNumber || ''} ${o.fullParentPathName || ''}`.toLowerCase();

/**
 * Notices matched to your network. `list` is slim notices (opportunityPage().items, or the
 * demo set); `opts` takes the filters (naics, keywords, types), `seen` (ids already shown;
 * leave it out on the first run so nothing counts as new), `agency` (only notices at the
 * agency or command this name points to), `all` (keep notices where you know no one), and
 * `limit`. `ctx` is the engine's view of your network (see engine.js).
 */
export function matchOpportunities(list, opts, ctx){
  const o = opts || {};
  const f = opportunityFilters(o);
  const today = ctx.today;
  const F = ctx.F;
  const seen = Array.isArray(o.seen) ? new Set(o.seen) : null;
  const want = o.agency ? ctx.agencyOf(o.agency) : null;
  if (o.agency && !want) return {items: [], total: 0, matched: 0, newCount: 0, ids: [], alerts: [], types: {}, agency: null};

  // who you know at each agency, once
  const by = new Map();
  for (const r of ctx.people) for (const a of ctx.fedHits(F, r.c, r.cl.agency, r.p)){ const l = by.get(a.id); if (l) l.push(r); else by.set(a.id, [r]); }
  const watchedIds = new Set();
  for (const t of ctx.targets){ const a = ctx.agencyOf(t.name); if (a) watchedIds.add(a.id); }
  const pursuitOf = new Map();
  for (const p of ctx.pursuits){ if (!p.agency || ['Won', 'Lost'].includes(p.stage)) continue; const a = ctx.agencyOf(p.agency); if (a && !pursuitOf.has(a.id)) pursuitOf.set(a.id, p); }

  const kws = f.keywords.map(k => k.toLowerCase());
  const seenIds = new Set();
  const out = [];
  const typeCounts = {};
  for (const n of (Array.isArray(list) ? list : [])){
    if (!n || !n.noticeId || seenIds.has(n.noticeId)) continue;
    seenIds.add(n.noticeId);
    const kind = typeCode(n.type || n.baseType);
    if (!f.types.includes(kind)) continue;
    if (f.naics.length && !f.naics.some(c => String(n.naicsCode || '').startsWith(c))) continue;
    if (kws.length){ const h = lowerHay(n); if (!kws.some(k => h.includes(k))) continue; }
    const due = dayOf(n.responseDeadLine), days = daysUntil(due, today);
    if (days != null && days < 0) continue;
    if (n.active === 'No') continue;
    const {a, i, segs} = samAgency(n, F);
    if (want && (!a || a.id !== want.id)) continue;
    const ps = a ? (by.get(a.id) || []) : [];
    const watched = !!a && watchedIds.has(a.id);
    const pursuit = a ? pursuitOf.get(a.id) : null;
    if (!o.all && !want && !ps.length && !watched && !pursuit) continue;
    // the office: the org chart's name for it when it has one, else SAM.gov's last part, readable
    // the office: SAM.gov's last part, readable, unless it only repeats the agency
    const last = segs[segs.length - 1] || '';
    const office = segs.length > 1 && !(a && i === segs.length - 1 && norm(readable(last)) === norm(a.name)) ? titleCase(last) : '';
    // and the part of the org chart it sits in, with how many you know there
    let area = '', officeKnown = 0;
    const chart = a ? findAgency(a.name) || findAgency(a.short) : null;
    if (chart){
      const oi = officeOf(chart, officeText(segs.slice(Math.max(0, i)).join(' ')), '');
      if (oi >= 0){
        area = chart.a.offices[oi].name.replace(/\s*\(.*\)\s*$/, '');
        officeKnown = ps.filter(r => officeOf(chart, r.p, r.c) === oi).length;
      }
    }
    const top = ps.slice().sort((x, y) => y.wm.score - x.wm.score || BAND_RANK[y.wm.band] - BAND_RANK[x.wm.band] || x.cl.lv - y.cl.lv).slice(0, 3)
      .map(r => ({k: r.k, name: ctx.fullName(r), p: r.p || '', band: r.wm.band, score: r.wm.score}));
    const senior = ps.filter(r => r.cl.lv <= 2).length, warm = ps.filter(r => r.wm.band === 'strong' || r.wm.band === 'warm').length;
    const isNew = !!seen && !seen.has(n.noticeId);
    // ranking: a close deadline, people you know (warm ones count more), watched, a pursuit
    let score = 0;
    if (days != null) score += Math.max(0, 30 - days);
    score += Math.min(40, ps.length * 4) + Math.min(20, warm * 5) + Math.min(10, senior * 2) + Math.min(10, officeKnown * 5);
    if (watched) score += 25;
    if (pursuit) score += 30;
    if (isNew) score += 5;
    typeCounts[kind] = (typeCounts[kind] || 0) + 1;
    out.push({
      id: n.noticeId, title: titleFix(n.title), sol: n.solicitationNumber || '', kind, type: TYPE_LABEL[kind] || 'Notice',
      agency: a ? a.short : titleCase(segs[1] || segs[0] || ''), agencyName: a ? a.name : titleCase(segs[1] || segs[0] || ''), agencyId: a ? a.id : '', dept: a ? a.dept : titleCase(readable(segs[0] || '')),
      office, area, path: segs.join(' › '), posted: dayOf(n.postedDate), due, days, naics: String(n.naicsCode || ''), setAside: n.typeOfSetAsideDescription || '',
      link: n.uiLink || (n.noticeId ? `https://sam.gov/opp/${encodeURIComponent(n.noticeId)}/view` : ''), award: n.award || null,
      known: ps.length, senior, warm, officeKnown, people: top, watched, pursuit: pursuit ? pursuit.name : '', pursuitId: pursuit ? pursuit.id : '',
      isNew, demo: !!n.demo, score, line: knownLine(ps.length, warm, officeKnown, area),
    });
  }
  out.sort((x, y) => y.score - x.score || (x.due || '9999') .localeCompare(y.due || '9999') || x.title.localeCompare(y.title));
  const alerts = out.filter(x => x.isNew && (x.known >= 3 || x.watched || !!x.pursuit)).slice(0, 5).map(x => ({id: x.id, title: alertTitle(x), body: alertBody(x)}));
  const limit = +o.limit > 0 ? +o.limit : 200;
  return {items: out.slice(0, limit), total: seenIds.size, matched: out.length, newCount: out.filter(x => x.isNew).length, ids: out.map(x => x.id), alerts, types: typeCounts,
    agency: want ? {id: want.id, short: want.short, name: want.name} : null};
}
/** SAM.gov titles are often all capitals; those read better in title case. */
function titleFix(t){
  const s = String(t || 'Untitled notice').trim();
  return s.length > 12 && s === s.toUpperCase() ? titleCase(s) : s;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function knownLine(n, warm, officeKnown, area){
  if (!n) return 'You don’t know anyone there yet';
  let s = `You know ${plural(n, 'person', 'people')} there`;
  if (officeKnown && area) s += `, ${officeKnown} in ${area}`;
  else if (warm) s += `, ${warm} warm`;
  return s;
}
const alertTitle = x => `${x.type} at ${x.agency}`;
function alertBody(x){
  const who = x.people.slice(0, 2).map(p => p.name).join(' and ');
  const due = x.due ? ` Due ${niceDue(x.due)}.` : '';
  return `${x.title}.${due} ${x.known ? `You know ${plural(x.known, 'person', 'people')} there${who ? `, like ${who}` : ''}.` : x.pursuit ? `It’s on your pursuit ${x.pursuit}.` : 'You watch this agency.'}`.trim();
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDue = d => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
/** Keeps the seen list short: the ids shown now plus the most recent of the rest. */
export function markSeen(seen, ids){
  const s = [...new Set([...(Array.isArray(ids) ? ids : []), ...(Array.isArray(seen) ? seen : [])])];
  return s.slice(0, 3000);
}

/* ---------- the sample network ---------- */
// Clearly fictional notices for the sample network, so App Review and the website demo see
// the feature without a key. Dates move with today. Every number starts with SAMPLE.
const DEMO = [
  ['r', 'OT Cybersecurity Monitoring for Shore Utility Control Systems', 'DEPT OF DEFENSE.DEPT OF THE NAVY.NAVFAC.NAVFAC SOUTHEAST', 3, 12, '541512', 'Total Small Business Set-Aside (FAR 19.5)'],
  ['k', 'Cross Domain Solution Sustainment, Enterprise Services', 'DEPT OF DEFENSE.DEFENSE INFORMATION SYSTEMS AGENCY (DISA).IT CONTRACTING DIVISION - PL8', 2, 21, '541519', ''],
  ['p', 'SCADA Modernization, Lock and Dam Control Systems', 'DEPT OF DEFENSE.DEPT OF THE ARMY.US ARMY CORPS OF ENGINEERS.ENGINEER DISTRICT SAVANNAH', 5, 30, '541330', 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside (FAR 19.14)'],
  ['r', 'Industrial Control System Assessment Support for Critical Infrastructure Partners', 'HOMELAND SECURITY, DEPARTMENT OF.CYBERSECURITY AND INFRASTRUCTURE SECURITY AGENCY.CISA ACQUISITION DIVISION', 1, 9, '541690', ''],
  ['o', 'Unidirectional Gateway Hardware and Support, Hydroelectric Sites', 'ENERGY, DEPARTMENT OF.BONNEVILLE POWER ADMINISTRATION.BONNEVILLE POWER ADMINISTRATION', 4, 18, '334290', ''],
  ['s', 'Industry Day: Grid Resilience and OT Security', 'ENERGY, DEPARTMENT OF.ENERGY, DEPARTMENT OF.HEADQUARTERS PROCUREMENT SERVICES', 2, 14, '541715', ''],
  ['a', 'Network Segmentation for Cutter Engineering Systems', 'HOMELAND SECURITY, DEPARTMENT OF.US COAST GUARD.C5I SERVICE CENTER', 6, null, '541512', ''],
];
const DEMO_TYPE = {r: 'Sources Sought', p: 'Presolicitation', k: 'Combined Synopsis/Solicitation', o: 'Solicitation', s: 'Special Notice', a: 'Award Notice'};
const DEMO_SOL = ['N69450', 'HC1028', 'W912HN', '70QS0126', '89503', '89243', '70Z0G1'];
export function demoOpportunities(today){
  const t = Date.parse((today || isoOf(Date.now())) + 'T12:00:00');
  return DEMO.map(([kind, title, path, ago, due, naics, setAside], i) => {
    const o = {noticeId: `sample-${String(i + 1).padStart(4, '0')}`, title, solicitationNumber: `SAMPLE-${DEMO_SOL[i]}-26-${kind === 'a' ? 'C' : 'R'}-${1001 + i}`,
      fullParentPathName: path, postedDate: isoOf(t - ago * 864e5), type: DEMO_TYPE[kind], naicsCode: naics,
      uiLink: 'https://sam.gov/search/?index=opp', typeOfSetAsideDescription: setAside, active: 'Yes', demo: true};
    if (kind === 'a') o.award = {amount: '1840000', date: isoOf(t - ago * 864e5), awardee: {name: 'Sample Systems LLC'}};
    if (due != null) o.responseDeadLine = isoOf(t + due * 864e5) + 'T17:00:00-04:00';
    return slim(o);
  });
}

/** The federal map row a name points to: a watchlist entry, a pursuit's agency, a unit page. */
export function agencyFor(name, F){
  const s = String(name || '').trim();
  if (!s) return null;
  const exact = F.find(a => a.short === s || a.name === s);
  if (exact) return exact;
  const hit = F.find(a => a.test(s));
  if (hit) return hit;
  const up = s.toUpperCase();
  const al = SAM_ALIASES.find(([rx]) => rx.test(up));
  return al ? F.find(a => a.short === al[1]) || null : null;
}
