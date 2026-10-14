// Contract awards from USASpending.gov, matched to your network: contracts that end soon at
// the agencies you work (recompetes), who holds them now, and which companies win work
// there (teaming partners). The apps fetch from USASpending's public API, straight from the
// device, with no key. The only thing sent is the agency name. This file builds the
// requests and reads the answers. No network calls here.
//
// API: https://api.usaspending.gov/docs/endpoints
//   POST https://api.usaspending.gov/api/v2/search/spending_by_award/
//   body: {filters: {award_type_codes, time_period: [{start_date, end_date}], agencies: [{type, tier, name}]},
//          fields: [...], sort, order, limit, page}
//   answer: {results: [{"Award ID", "Recipient Name", "Start Date", "End Date", "Award Amount",
//            "Awarding Agency", "Awarding Sub Agency", "Description", generated_internal_id, …}],
//            page_metadata: {page, hasNext}}

export const AWARDS_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
export const AWARD_LINK = 'https://www.usaspending.gov/award/';
const CONTRACT_CODES = ['A', 'B', 'C', 'D'];
export const AWARD_FIELDS = ['Award ID', 'Recipient Name', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency',
  'Awarding Office', 'Description', 'NAICS', 'generated_internal_id'];

/* ---------- which agency to ask for ---------- */
// USASpending files awards under a department (toptier) and an agency (subtier). Commands
// that buy through a service file under that service, so those are asked for as the service
// and narrowed by the awarding office's name when the answer comes back.
const SUBTIER = {
  Army: 'Department of the Army', Navy: 'Department of the Navy', USMC: 'Department of the Navy', 'Air Force': 'Department of the Air Force',
  'Space Force': 'Department of the Air Force', USACE: 'U.S. Army Corps of Engineers', ARCYBER: 'Department of the Army', AMC: 'Department of the Army',
  IMCOM: 'Department of the Army', AFC: 'Department of the Army', ACC: 'Department of the Army', 'PEO EIS': 'Department of the Army', ERDC: 'Department of the Army',
  NAVFAC: 'Department of the Navy', NAVSEA: 'Department of the Navy', NAVAIR: 'Department of the Navy', NAVWAR: 'Department of the Navy', NAVSUP: 'Department of the Navy',
  FLTCYBER: 'Department of the Navy', CNIC: 'Department of the Navy', MARCORSYSCOM: 'Department of the Navy', MARFORCYBER: 'Department of the Navy', MCICOM: 'Department of the Navy',
  AFCEC: 'Department of the Air Force', AFMC: 'Department of the Air Force', AFLCMC: 'Department of the Air Force', AFRL: 'Department of the Air Force', '16 AF': 'Department of the Air Force',
  AFIMSC: 'Department of the Air Force', SSC: 'Department of the Air Force', NGB: 'Department of the Army',
  DISA: 'Defense Information Systems Agency', DLA: 'Defense Logistics Agency', DTRA: 'Defense Threat Reduction Agency', DCMA: 'Defense Contract Management Agency',
  DCAA: 'Defense Contract Audit Agency', DCSA: 'Defense Counterintelligence and Security Agency', DARPA: 'Defense Advanced Research Projects Agency', MDA: 'Missile Defense Agency',
  DHA: 'Defense Health Agency', DIA: 'Defense Intelligence Agency', WHS: 'Washington Headquarters Services', SOCOM: 'U.S. Special Operations Command', TRANSCOM: 'U.S. Transportation Command',
  CISA: 'Cybersecurity and Infrastructure Security Agency', TSA: 'Transportation Security Administration', FEMA: 'Federal Emergency Management Agency', USCG: 'U.S. Coast Guard',
  CBP: 'U.S. Customs and Border Protection', ICE: 'U.S. Immigration and Customs Enforcement', USSS: 'U.S. Secret Service', USCIS: 'U.S. Citizenship and Immigration Services',
  FLETC: 'Federal Law Enforcement Training Center', NNSA: 'National Nuclear Security Administration', BPA: 'Bonneville Power Administration', WAPA: 'Western Area Power Administration',
  FERC: 'Federal Energy Regulatory Commission', USBR: 'Bureau of Reclamation', BLM: 'Bureau of Land Management', NPS: 'National Park Service', USGS: 'U.S. Geological Survey',
  BIA: 'Bureau of Indian Affairs', FWS: 'U.S. Fish and Wildlife Service', NIST: 'National Institute of Standards and Technology', NOAA: 'National Oceanic and Atmospheric Administration',
  Census: 'U.S. Census Bureau', USPTO: 'U.S. Patent and Trademark Office', FAA: 'Federal Aviation Administration', FHWA: 'Federal Highway Administration',
  FTA: 'Federal Transit Administration', FRA: 'Federal Railroad Administration', PHMSA: 'Pipeline and Hazardous Materials Safety Administration', MARAD: 'Maritime Administration',
  IRS: 'Internal Revenue Service', 'Fiscal Service': 'Bureau of the Fiscal Service', Mint: 'U.S. Mint', BEP: 'Bureau of Engraving and Printing',
  OCC: 'Comptroller of the Currency', FBI: 'Federal Bureau of Investigation', DEA: 'Drug Enforcement Administration', ATF: 'Bureau of Alcohol, Tobacco, Firearms and Explosives',
  USMS: 'U.S. Marshals Service', BOP: 'Federal Prison System / Bureau of Prisons', CDC: 'Centers for Disease Control and Prevention', NIH: 'National Institutes of Health',
  FDA: 'Food and Drug Administration', CMS: 'Centers for Medicare and Medicaid Services', USFS: 'Forest Service', RUS: 'Rural Utilities Service',
  VHA: 'Veterans Affairs, Department of', VBA: 'Veterans Affairs, Department of', 'VA OIT': 'Veterans Affairs, Department of',
};
const TOPTIER = {
  OSD: 'Department of Defense', 'DoD CIO': 'Department of Defense', 'Joint Staff': 'Department of Defense', CDAO: 'Department of Defense', DIU: 'Department of Defense',
  DHS: 'Department of Homeland Security', 'DHS S&T': 'Department of Homeland Security', DOE: 'Department of Energy', CESER: 'Department of Energy', OE: 'Department of Energy',
  EM: 'Department of Energy', SWPA: 'Department of Energy', SEPA: 'Department of Energy', INL: 'Department of Energy', Sandia: 'Department of Energy', LANL: 'Department of Energy',
  LLNL: 'Department of Energy', ORNL: 'Department of Energy', PNNL: 'Department of Energy', NREL: 'Department of Energy', Argonne: 'Department of Energy', SRS: 'Department of Energy',
  NRC: 'Nuclear Regulatory Commission', TVA: 'Tennessee Valley Authority', EPA: 'Environmental Protection Agency', GSA: 'General Services Administration',
  NASA: 'National Aeronautics and Space Administration', FCC: 'Federal Communications Commission', SEC: 'Securities and Exchange Commission', SBA: 'Small Business Administration',
  OPM: 'Office of Personnel Management', NSF: 'National Science Foundation', SSA: 'Social Security Administration', DOI: 'Department of the Interior', BSEE: 'Department of the Interior',
  BOEM: 'Department of the Interior', DOC: 'Department of Commerce', BIS: 'Department of Commerce', NTIA: 'Department of Commerce', DOT: 'Department of Transportation',
  Treasury: 'Department of the Treasury', DOJ: 'Department of Justice', VA: 'Department of Veterans Affairs', HHS: 'Department of Health and Human Services',
  ASPR: 'Department of Health and Human Services', USDA: 'Department of Agriculture', State: 'Department of State', ED: 'Department of Education', DOL: 'Department of Labor',
  HUD: 'Department of Housing and Urban Development',
};
// Offices that narrow a service-wide answer to one command.
const OFFICE_RX = {
  NAVFAC: /NAVFAC|NAVAL FACILITIES/i, NAVSEA: /NAVSEA|NAVAL SEA|NAVAL SURFACE WARFARE|NSWC|NUWC|SUPSHIP/i, NAVAIR: /NAVAIR|NAVAL AIR/i,
  NAVWAR: /NAVWAR|NIWC|SPAWAR|NAVAL INFORMATION WARFARE/i, NAVSUP: /NAVSUP|FLEET LOGISTICS|NAVAL SUPPLY/i, MARCORSYSCOM: /MARCORSYSCOM|MARINE CORPS SYSTEMS/i,
  MCICOM: /MARINE CORPS (INSTALLATIONS|BASE|AIR STATION)|MCB |MCAS /i, CNIC: /NAVAL (STATION|BASE|SUPPORT ACTIVITY)|CNIC|INSTALLATIONS COMMAND/i,
  AFCEC: /AFCEC|CIVIL ENGINEER CENTER/i, AFLCMC: /AFLCMC|LIFE CYCLE/i, AFRL: /AFRL|RESEARCH LAB/i, AFIMSC: /AFIMSC|INSTALLATION CONTRACTING|MISSION SUPPORT CENTER/i,
  SSC: /SPACE SYSTEMS COMMAND|SMC|SPACE AND MISSILE/i, AMC: /ARMY MATERIEL|AMCOM|TACOM|CECOM|JMC/i, ACC: /ARMY CONTRACTING COMMAND|ACC-/i,
  'PEO EIS': /PEO EIS|ENTERPRISE INFORMATION SYSTEMS/i, ERDC: /ERDC|ENGINEER RESEARCH/i, IMCOM: /MICC|INSTALLATION MANAGEMENT|MISSION AND INSTALLATION CONTRACTING/i,
  ARCYBER: /ARCYBER|ARMY CYBER/i, NGB: /NATIONAL GUARD|NGB|USPFO/i, USMC: /MARINE/i, 'Space Force': /SPACE/i,
};
/** What to ask USASpending for, for one federal map row: {tier, name, office?}. */
export function awardAgency(a){
  if (!a) return null;
  if (SUBTIER[a.short]) return {tier: 'subtier', name: SUBTIER[a.short], office: OFFICE_RX[a.short] || null};
  if (TOPTIER[a.short]) return {tier: 'toptier', name: TOPTIER[a.short], office: null};
  return {tier: 'subtier', name: a.name.replace(/\s*\(HQ\)\s*$/, ''), office: null};
}

/* ---------- the requests ---------- */
const isoOf = ms => { const z = new Date(ms); return z.getFullYear() + '-' + String(z.getMonth() + 1).padStart(2, '0') + '-' + String(z.getDate()).padStart(2, '0'); };
/**
 * The searches to run: one POST body per agency (at most 8), for contracts whose period of
 * performance runs into the next `months` months, biggest first. `agencies` are federal map
 * rows. Each comes back with the agency's id so the answer can be matched to it.
 */
export function awardRequests(agencies, months, today){
  const m = Math.max(3, Math.min(36, +months || 24));
  const from = today || isoOf(Date.now());
  const to = isoOf(Date.parse(from + 'T12:00:00') + m * 30.44 * 864e5);
  const seen = new Set(), out = [];
  for (const a of agencies || []){
    const q = awardAgency(a); if (!q) continue;
    const key = q.tier + '|' + q.name + '|' + (q.office ? a.short : '');
    if (seen.has(key)) continue; seen.add(key);
    out.push({agencyId: a.id, short: a.short, url: AWARDS_URL, body: {
      filters: {award_type_codes: CONTRACT_CODES, time_period: [{start_date: from, end_date: to}], agencies: [{type: 'awarding', tier: q.tier, name: q.name}]},
      fields: AWARD_FIELDS, sort: 'Award Amount', order: 'desc', limit: 100, page: 1}});
    if (out.length >= 8) break;
  }
  return out;
}

/* ---------- reading an answer ---------- */
const str = v => v == null ? '' : typeof v === 'object' ? String(v.description || v.name || v.code || '') : String(v);
const dayOf = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };
/** One USASpending answer (the response text): slim awards, or a plain-English error. */
export function awardPage(text){
  let j;
  try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { return {items: [], more: false, error: 'USASpending.gov sent back something Northfix couldn’t read. Try again later.'}; }
  if (!j || typeof j !== 'object') return {items: [], more: false, error: 'USASpending.gov sent back an empty answer.'};
  if (j.detail || j.message || j.error){
    const msg = str(j.detail || j.message || j.error);
    if (/throttl|rate|too many/i.test(msg)) return {items: [], more: false, error: 'USASpending.gov is busy. Northfix will try again later.', code: 'rate'};
    return {items: [], more: false, error: `USASpending.gov said: ${msg.slice(0, 200)}`};
  }
  const list = Array.isArray(j.results) ? j.results : [];
  const items = list.filter(x => x && (x['Award ID'] || x.generated_internal_id)).map(x => {
    const naics = x.NAICS && typeof x.NAICS === 'object' ? x.NAICS : {code: x.NAICS || '', description: ''};
    return {id: str(x.generated_internal_id || x['Award ID']).slice(0, 120), piid: str(x['Award ID']).slice(0, 60), recipient: str(x['Recipient Name']).slice(0, 160),
      start: dayOf(x['Start Date']), end: dayOf(x['End Date']), amount: +x['Award Amount'] || 0, agency: str(x['Awarding Agency']).slice(0, 160),
      sub: str(x['Awarding Sub Agency']).slice(0, 160), office: str(x['Awarding Office']).slice(0, 160), desc: str(x.Description).replace(/\s+/g, ' ').trim().slice(0, 300),
      naics: str(naics.code).slice(0, 6), naicsName: str(naics.description).slice(0, 120), demo: !!x.demo};
  });
  return {items, more: !!(j.page_metadata && j.page_metadata.hasNext)};
}

/* ---------- money ---------- */
/** "$1.2M", "650K", "3,800,000", "$2.5 billion" as a number of dollars; 0 when unreadable. */
export function dollars(v){
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v || '').toLowerCase().replace(/[$,\s]/g, '');
  const m = /^(\d+(?:\.\d+)?)(k|thousand|m|mm|million|b|bn|billion)?$/.exec(s);
  if (!m) return 0;
  const mult = {k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9}[m[2]] || 1;
  return Math.round(+m[1] * mult);
}
/** 1840000 as "$1.8M". */
export function money(n){
  const v = +n || 0;
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e11 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}

/* ---------- the sample network ---------- */
// Clearly fictional awards for the sample network, so App Review and the website demo see
// recompetes and teaming partners without going online. Dates move with today. Every award
// number starts with SAMPLE.
const DEMO = [
  ['NAVFAC', 'Department of Defense', 'Department of the Navy', 'NAVFAC SOUTHEAST', 'Leidos', 'Base operating support, utility control systems cybersecurity', 14200000, -1300, 140, '541512'],
  ['NAVFAC', 'Department of Defense', 'Department of the Navy', 'NAVFAC ATLANTIC', 'Jacobs', 'Facility related control systems assessment and authorization', 6900000, -900, 330, '541330'],
  ['DISA', 'Department of Defense', 'Defense Information Systems Agency', 'IT CONTRACTING DIVISION - PL8', 'Booz Allen Hamilton', 'Cross domain enterprise services engineering', 48500000, -1600, 210, '541519'],
  ['DISA', 'Department of Defense', 'Defense Information Systems Agency', 'IT CONTRACTING DIVISION - PL8', 'Peraton', 'Zero trust gateway sustainment', 22400000, -700, 470, '541512'],
  ['USACE', 'Department of Defense', 'U.S. Army Corps of Engineers', 'W075 ENDIST SAVANNAH', 'Parsons', 'Lock and dam SCADA operations and maintenance', 9300000, -1100, 95, '541330'],
  ['CISA', 'Department of Homeland Security', 'Cybersecurity and Infrastructure Security Agency', 'CISA ACQUISITION DIVISION', 'SAIC', 'Industrial control system assessment support', 31700000, -1450, 260, '541690'],
  ['CISA', 'Department of Homeland Security', 'Cybersecurity and Infrastructure Security Agency', 'CISA ACQUISITION DIVISION', 'General Dynamics Information Technology', 'Continuous diagnostics and mitigation, OT dashboard', 17800000, -1000, 600, '541512'],
  ['DOE', 'Department of Energy', 'Department of Energy', 'HEADQUARTERS PROCUREMENT SERVICES', 'ManTech', 'Grid resilience and OT security analytics', 5400000, -800, 180, '541715'],
  ['BPA', 'Department of Energy', 'Bonneville Power Administration', 'BONNEVILLE POWER ADMINISTRATION', 'CACI International', 'Hydroelectric site network segmentation', 3100000, -600, 400, '541512'],
];
export function demoAwards(today){
  const t = Date.parse((today || isoOf(Date.now())) + 'T12:00:00');
  return DEMO.map(([short, agency, sub, office, recipient, desc, amount, start, end, naics], i) => ({
    id: `sample-award-${i + 1}`, piid: `SAMPLE-${short.replace(/\W/g, '')}-${20 + i}-C-${4001 + i}`, recipient, start: isoOf(t + start * 864e5), end: isoOf(t + end * 864e5),
    amount, agency, sub, office, desc, naics, naicsName: '', demo: true, demoShort: short}));
}
