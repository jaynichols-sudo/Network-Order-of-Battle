// Turns a plain-English search like "navy o-5 and up in cyber" into structured filters.
// Whatever isn't recognized is left as free text for the normal search.
import { gradeNum } from './core.js';

const BRANCH = [
  [/\b(marine corps|marines?|usmc)\b/, 'Marine Corps'],
  [/\b(space force|ussf|guardians?)\b/, 'Space Force'],
  [/\b(air force|usaf|airmen)\b/, 'Air Force'],
  [/\b(coast guard|uscg)\b/, 'Coast Guard'],
  [/\b(national guard|guard)\b/, 'National Guard'],
  [/\b(navy|usn|naval|sailors?)\b/, 'Navy'],
  [/\b(army|soldiers?)\b/, 'Army'],
  [/\b(joint|dod agenc(?:y|ies)|osd|combatant commands?)\b/, 'Joint / DoD'],
];
const SEG = [
  [/\b(utilit(?:y|ies)|power companies|electric(?:al)? utilit\w*|energy companies)\b/, 'Utilities & Energy'],
  [/\b(primes?|contractors?|defense industry|dib|integrators?)\b/, 'Gov & Defense Contractors'],
  [/\b(vendors?|ot vendors?|ics vendors?|cyber vendors?)\b/, 'OT/ICS & Cyber Vendors'],
  [/\b(channel|resellers?|vars?|distributors?)\b/, 'Channel & Integrators'],
  [/\b(fed(?:eral)? civ(?:ilian)?|civilian agenc(?:y|ies)|federal agenc(?:y|ies))\b/, 'Federal Civilian'],
  [/\b(state(?: and| &)? local|state|county|city|municipal)\b/, 'State & Local'],
  [/\b(labs?|national labs?|academia|universit(?:y|ies)|researchers?)\b/, 'Labs & Academia'],
  [/\b(recruiters?|staffing)\b/, 'Recruiting & Staffing'],
  [/\b(military|dod)\b/, 'DoD & Military'],
];
const FUNC = [
  [/\b(cyber\w*|security|infosec|ciso)\b/, 'Cybersecurity'],
  [/\b(contracting(?: officers?)?|contract specialists?|kos?|acquisition|procurement)\b/, 'Acquisition & Contracting'],
  [/\b(sales|bd|business development|capture)\b/, 'Sales & BD'],
  [/\b(program managers?|pms?|project managers?)\b/, 'Program Management'],
  [/\b(engineers?|architects?|scientists?)\b/, 'Engineering & Technical'],
  [/\b(it|network|infrastructure)\b/, 'IT & Infrastructure'],
  [/\b(policy|compliance|regulatory)\b/, 'Policy & Compliance'],
  [/\b(ops|operations|logistics|maintenance)\b/, 'Operations & Logistics'],
];
const STATUS = [
  [/\b(veterans?|vets?|retired|retirees?)\b/, 'Veteran / Retired'],
  [/\b(serving|active duty|active|in uniform)\b/, 'Serving'],
  [/\b(reserv(?:e|es|ists?))\b/, 'Reserve / Guard'],
  [/\b(dod civilians?|civilians?)\b/, 'DoD Civilian'],
];
const SIG = [
  [/\b(new(?: connections?)?|this week)\b/, 'new'],
  [/\b(moved|job changes?|changed jobs|new jobs?)\b/, 'jc'],
  [/\b(starred|favorites?|stars?|shortlist)\b/, 'star'],
  [/\b(cleared|clearances?|ts\/sci|top secret)\b/, 'clr'],
  [/\b(anniversar(?:y|ies))\b/, 'anniv'],
];
const TIER = [
  [/\b(flag officers?|generals?|admirals?|flags?|stars? and up)\b/, 'Flag / General'],
  [/\b(field grade)\b/, 'Field grade'],
  [/\b(company grade|junior officers?)\b/, 'Company grade'],
  [/\b(senior enlisted|senior ncos?|sergeants major|master chiefs?)\b/, 'Senior enlisted'],
  [/\b(ncos?|enlisted)\b/, 'Enlisted / NCO'],
  [/\b(warrants?|warrant officers?)\b/, 'Warrant'],
  [/\b(ses|senior executives?)\b/, 'SES'],
];
const SEN = [
  [/\b(c-?suite|ceos?|ctos?|cisos?|founders?|owners?|chiefs?)\b/, 'C-suite / Owner'],
  [/\b(vps?|vice presidents?)\b/, 'VP'],
  [/\b(directors?|heads? of)\b/, 'Director / Head'],
  [/\b(managers?)\b/, 'Manager / Lead'],
];
const IND = [
  [/\b(banks?|banking|bankers?|financial services|finance companies|fintech|wealth management|credit unions?|investment firms?)\b/, 'Financial Services'],
  [/\b(insurance(?: companies)?|insurers?)\b/, 'Insurance'],
  [/\b(health ?care|hospitals?|health systems?|pharma\w*|biotech|medical|life sciences)\b/, 'Healthcare & Life Sciences'],
  [/\b(software(?: companies)?|saas|tech companies|big tech|cloud (?:companies|providers))\b/, 'Software & Cloud'],
  [/\b(consulting firms?|consultanc(?:y|ies)|big four|it services|resellers?|vars?)\b/, 'IT Services & Consulting'],
  [/\b(telecom\w*|telcos?|carriers|hardware|networking companies|semiconductors?)\b/, 'Hardware, Telecom & Networking'],
  [/\b(manufactur\w*|industrial|factories|automotive)\b/, 'Industrial & Manufacturing'],
  [/\b(construction|engineering firms?|a&e|architects?)\b/, 'Engineering & Construction'],
  [/\b(real estate|realtors?|brokers)\b/, 'Real Estate'],
  [/\b(law firms?|lawyers?|attorneys?|legal|accounting firms?|cpas?|accountants?)\b/, 'Legal & Accounting'],
  [/\b(non-?profits?|charit(?:y|ies)|associations?|churches)\b/, 'Nonprofit & Associations'],
  [/\b(retail\w*|consumer|cpg|food(?: and beverage)?|restaurants?|grocery)\b/, 'Retail, Consumer & Food'],
  [/\b(transportation|logistics|trucking|airlines?|railroads?|shipping|freight)\b/, 'Transportation & Logistics'],
  [/\b(travel|hospitality|hotels?|tourism)\b/, 'Travel & Hospitality'],
  [/\b(media|marketing agencies|advertising|journalists?|press)\b/, 'Media & Marketing'],
  [/\b(self-?employed|freelancers?|startups?|entrepreneurs?)\b/, 'Self-Employed & Startups'],
  [/\b(between roles|job seekers?|open to work|unemployed)\b/, 'Retired or Between Roles'],
  [/\b(unclassified|no industry|unknown industry)\b/, 'Unclassified'],
  [/\b(private sector|commercial)\b/, '__private'],
  [/\b(government|public sector|gov)\b/, 'Government & Military'],
  [/\b(defense contractors?|defense industry|gov(?:ernment)? contractors?|defense companies)\b/, 'Defense & Gov Contracting'],
  [/\b(energy companies|utilit(?:y|ies)|oil and gas|oil & gas|power companies)\b/, 'Energy & Utilities'],
  [/\b(cyber ?security (?:companies|vendors|firms)|security vendors|cyber companies)\b/, 'Cybersecurity'],
  [/\b(universit(?:y|ies)|colleges?|schools?|academia|research labs?|national labs?)\b/, 'Education & Research'],
  [/\b(staffing (?:firms|agencies)|recruiting firms|recruiters?)\b/, 'Staffing & Recruiting'],
];
const RANKWORD = [
  [/\b(ltcs?|lt ?cols?|lieutenant colonels?)\b/, 'O-5'], [/\b(colonels?|cols?)\b/, 'O-6'], [/\b(majors?|majs?)\b/, 'O-4'],
  [/\b(commanders?|cdrs?)\b/, 'O-5'], [/\b(lcdrs?|lieutenant commanders?)\b/, 'O-4'], [/\b(navy captains?)\b/, 'O-6'],
];
const UP = String.raw`\s*(\+|and up|or above|or higher|and above|plus|or more senior)?`;
const STOP = /\b(in|at|and|or|the|of|with|who|are|people|contacts?|connections?|show|me|all|my|from|for|any|work(?:ing|s)?|to|a|an)\b/g;

export function parseQuery(text, agencies = []){
  let t = ' ' + text.toLowerCase().replace(/[“”"]/g, ' ') + ' ';
  const nl = {branch: [], seg: [], func: [], status: [], sig: [], tier: [], sen: [], agency: [], ind: [], minGrade: 0, grades: []};
  const chips = [];
  const take = (re, fn) => { t = t.replace(new RegExp(re.source, 'g'), (...m) => { fn(m); return ' '; }); };
  // grades first so "o-5+" is not split
  take(new RegExp(String.raw`\b([oew])-?(\d{1,2})` + UP, 'i'), m => {
    const g = m[1].toUpperCase() + '-' + (+m[2]);
    if (m[3]){ nl.minGrade = Math.max(nl.minGrade, gradeNum(g)); nl.minGradeMax = m[1].toUpperCase(); chips.push(`${g} and up`); }
    else { nl.grades.push(g); chips.push(g); }
  });
  take(new RegExp(String.raw`\bgs-?(\d{1,2})` + UP, 'i'), m => {
    const g = 'GS-' + (+m[1]);
    if (m[2]){ nl.minGrade = Math.max(nl.minGrade, gradeNum(g)); chips.push(`${g} and up`); } else { nl.grades.push(g); chips.push(g); }
  });
  for (const [re, g] of RANKWORD) take(new RegExp(re.source + UP), m => {
    const up = m[m.length - 3];
    if (up){ nl.minGrade = Math.max(nl.minGrade, gradeNum(g)); chips.push(`${g} and up`); } else { nl.grades.push(g); chips.push(g); }
  });
  const sets = [[IND, 'ind'], [TIER, 'tier'], [SEN, 'sen'], [BRANCH, 'branch'], [STATUS, 'status'], [SIG, 'sig'], [FUNC, 'func'], [SEG, 'seg']];
  const SIGLABEL = {new: 'New', jc: 'Moved jobs', star: 'Starred', clr: 'Clearance', anniv: 'Anniversaries'};
  for (const [list, key] of sets){
    for (const [re, val] of list){
      let hit = false; take(re, () => { hit = true; });
      if (hit && !nl[key].includes(val)){ nl[key].push(val); chips.push(key === 'sig' ? SIGLABEL[val] : val === '__private' ? 'Private sector' : val); }
    }
  }
  for (const a of agencies){
    const re = new RegExp(String.raw`\b${a.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\b`);
    if (a.length > 2 && re.test(t)){ t = t.replace(re, ' '); nl.agency.push(a); chips.push(a); }
  }
  const rest = t.replace(STOP, ' ').replace(/[^a-z0-9&.\-' ]/g, ' ').replace(/\s+/g, ' ').trim();
  const structured = chips.length > 0;
  return {nl: structured ? nl : null, rest, chips};
}

export function matchNL(nl, r){
  if (!nl) return true;
  const c = r.cl;
  if (nl.branch.length && !nl.branch.includes(c.branch)) return false;
  if (nl.seg.length && !nl.seg.includes(c.seg)) return false;
  if (nl.func.length && !nl.func.includes(c.func)) return false;
  if (nl.status.length && !nl.status.includes(c.status)) return false;
  if (nl.tier.length && !nl.tier.includes(c.tier)) return false;
  if (nl.sen.length && !nl.sen.includes(c.sen)) return false;
  if (nl.agency.length && !nl.agency.includes(c.agency)) return false;
  if (nl.ind && nl.ind.length){
    const want = nl.ind.filter(x => x !== '__private');
    const priv = nl.ind.includes('__private') && c.ind !== 'Government & Military';
    if (!(want.includes(c.ind) || priv)) return false;
  }
  if (nl.grades.length && !nl.grades.includes(c.grade)) return false;
  if (nl.minGrade){
    if (!c.grade || c.gn < nl.minGrade) return false;
    // "O-5 and up" stays within officer grades; GS thresholds also admit SES
    if (nl.minGradeMax === 'O' && !/^O-/.test(c.grade)) return false;
  }
  return true;
}
