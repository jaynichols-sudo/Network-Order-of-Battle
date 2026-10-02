import { inferIndustry } from './industry.js';
import JSZip from 'jszip';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt = n => Number(n || 0).toLocaleString('en-US');
export const isoDay = d => { const z = new Date(d); return z.getFullYear() + '-' + String(z.getMonth()+1).padStart(2,'0') + '-' + String(z.getDate()).padStart(2,'0'); };
export const TODAY = isoDay(new Date());
export const daysAgo = s => s ? (Date.now() - new Date(s + 'T12:00:00').getTime()) / 864e5 : Infinity;
export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const niceDate = s => { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${+d} ${MON[+m-1]} ${y}`; };
export function hash(str){ let h = 2166136261; for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export const h01 = (s, salt) => (hash(salt + s) % 100000) / 100000;

/* ---------- taxonomy ---------- */
export const SEGS = [
  {id:'DoD & Military', short:'DoD & Mil', c:'--s1'},
  {id:'Federal Civilian', short:'Fed Civ', c:'--s2'},
  {id:'State & Local', short:'State/Local', c:'--s3'},
  {id:'Gov & Defense Contractors', short:'Contractors', c:'--s4'},
  {id:'Utilities & Energy', short:'Utilities', c:'--s5'},
  {id:'OT/ICS & Cyber Vendors', short:'OT/Cyber', c:'--s6'},
  {id:'Channel & Integrators', short:'Channel', c:'--s7'},
  {id:'Labs & Academia', short:'Labs/Acad', c:'--s8'},
  {id:'Recruiting & Staffing', short:'Recruiting', c:'--s9'},
  {id:'Other Commercial', short:'Other', c:'--s10'},
];
export const SEGI = Object.fromEntries(SEGS.map((s,i)=>[s.id,i]));
export const COMMERCIAL = new Set(['Gov & Defense Contractors','Utilities & Energy','OT/ICS & Cyber Vendors','Channel & Integrators','Labs & Academia','Recruiting & Staffing','Other Commercial']);
export const BRANCHES = ['Marine Corps','Army','Navy','Air Force','Space Force','Coast Guard','National Guard','Joint / DoD'];
export const STATUSES = ['Serving','Reserve / Guard','DoD Civilian','Veteran / Retired'];
export const TIERS = [
  ['Flag / General','O-7 to O-10'],['Field grade','O-4 to O-6'],['Company grade','O-1 to O-3'],['Warrant','W-1 to W-5'],
  ['Senior enlisted','E-7 to E-9'],['Enlisted / NCO','E-1 to E-6'],['SES','Senior Executive Service'],['GS-13 to 15','incl. NH-03/04'],['GS-12 & below',''],['Rank not stated','']
];
export const SENIORITY = ['C-suite / Owner','VP','Director / Head','Manager / Lead','Individual contributor'];
export const FUNCS = ['Acquisition & Contracting','Cybersecurity','Sales & BD','Program Management','Engineering & Technical','IT & Infrastructure','Policy & Compliance','Operations & Logistics','Marketing & Comms','Recruiting & HR','Finance & Legal','Consulting & Advisory','Executive Leadership','Military Operations','Other / Unspecified'];
export const SINCE = [['','Any time'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['365','Last 12 months'],['o1','Over 1 year ago'],['o5','Over 5 years ago']];
export const SIGNALS = [['new','New since last refresh'],['jc','Job change detected'],['star','Starred'],['notes','Has tags or notes'],['email','Has email'],['gov','.gov / .mil email'],['clr','Clearance mentioned']];

const BRANCH_RX = [
  ['National Guard', [/\b(National Guard|Air National Guard|Army National Guard)\b/i, /\b(ARNG|NGB|ANG)\b/]],
  ['Marine Corps', [/\b(Marine Corps|U\.?\s?S\.? Marines|Marines|Marine Aircraft|Marine Forces|MARFOR[A-Z]*|MARCORSYSCOM|MARSOC|MARCENT|HMX-1|Camp Lejeune|Cherry Point|(?:former|ex-|retired) Marine|Marine veteran)\b/i, /\b(USMC|USMCR|MCAS|MCSC|I{1,3} MEF|MEF)\b/]],
  ['Space Force', [/\b(Space Forces?|Space Systems Command)\b/i, /\b(USSF|SSC)\b/]],
  ['Coast Guard', [/\bCoast Guard\b/i, /\bUSCG\b/]],
  ['Air Force', [/\b(Air Forces?|AFB|PACAF|USAFE)\b/i, /\b(USAF|AFRL|AFLCMC|AFCEC|AFCYBER|AFMC|AFGSC|AFSOC|AFRC)\b/]],
  ['Army', [/\b(U\.?S\.? Army|Army Corps of Engineers|Army Futures Command|Army Cyber|Army)\b/i, /\b(USACE|ARCYBER|TRADOC|FORSCOM|DEVCOM|CECOM|NETCOM|USAR)\b/]],
  ['Navy', [/\b(U\.?S\.? Navy|Navy|Naval)\b/i, /\b(USN|USNR|NAVSEA|NAVAIR|NAVWAR|NAVFAC|NAVSUP|NAVIFOR|SPAWAR|NIWC|ONR|FLTCYBER)\b/]],
  ['Joint / DoD', [/\b(Department of Defense|Dept\.? of Defense|Defense Information Systems Agency|Defense Logistics Agency|Missile Defense Agency|Defense Health Agency|Joint Staff|Pentagon|Cyber Command|Office of the Secretary of Defense|Defense Counterintelligence)\b/i, /\b(DoD|DOD|DISA|DLA|DTRA|DCSA|DCMA|DCAA|DIA|NSA|USCYBERCOM|CYBERCOM|JFHQ|OSD|OUSD|DARPA|DIU|MDA|USSOCOM|SOCOM|INDOPACOM|EUCOM|CENTCOM|NORTHCOM|NORAD|SOUTHCOM|AFRICOM|TRANSCOM|STRATCOM|SPACECOM|CDAO|NGA|NRO)\b/]],
];
const VET_RX = /\bveteran\b|\bretired\b|\(ret\.?\)|\bret\.?\)|,\s*ret\.?\b|\bformer (?:marine|soldier|sailor|airman|army|navy|air force|usmc|naval officer|military)|\bex-(?:marine|military|army|navy|usaf|usmc)|\b(?:marine|army|navy|air force|coast guard) vet\b/i;
const RES_RX = /\b(reserve|reservist|USMCR|USAR|USNR|USAFR|IRR|drilling)\b/i;

// rank table: first match wins. g = grade or fn(branch) -> grade; req = needs a detected branch
const NAVAL = b => b === 'Navy' || b === 'Coast Guard';
const RANKS = [
  {re:/\b(SgtMaj|Sgt\.? ?Maj\.?|Sergeant Major|Command Sergeant Major|MGySgt|Master Gunnery Sergeant|CMSgt|Chief Master Sergeant|MCPO|FLTCM|CMDCM|Master Chief(?: Petty Officer)?|SEAC)\b/, r:'Senior Enlisted (E-9)', g:'E-9'},
  {re:/(?:^|\| )(SGM|CSM)\b(?![^|]*(?:scrum|pmp|pmi|safe|agile))/i, r:'Sergeant Major', g:'E-9', req:1, pos:1},
  {re:/\b(LtGen|LTG|Lt\.? ?Gen\.?|Lieutenant General)\b/, r:'Lieutenant General', g:'O-9'},
  {re:/\b(MajGen|Maj\.? ?Gen\.?|Major General)\b/, r:'Major General', g:'O-8'},
  {re:/\b(BGen|BrigGen|Brig\.? ?Gen\.?|Brigadier General)\b/, r:'Brigadier General', g:'O-7'},
  {re:/\b(MG)\b/, r:'Major General', g:'O-8', req:1},
  {re:/\b(BG)\b/, r:'Brigadier General', g:'O-7', req:1},
  {re:/\b(VADM|Vice Admiral)\b/, r:'Vice Admiral', g:'O-9'},
  {re:/\b(RADM|Rear Admiral)\b/, r:'Rear Admiral', g:'O-8'},
  {re:/\b(RDML)\b/, r:'Rear Admiral (LH)', g:'O-7'},
  {re:/\b(ADM|Admiral)\b/, r:'Admiral', g:'O-10', req:1},
  {re:/\b(GEN)\b/, r:'General', g:'O-10', req:1},
  {re:/\bCommanding General\b/i, r:'General Officer', g:'O-7', req:1},
  {re:/\b(LtCol|LTC|Lt\.? ?Col\.?|Lieutenant Colonel)\b/, r:'Lieutenant Colonel', g:'O-5'},
  {re:/\b(Colonel|COL|Col\.?)\b/, r:'Colonel', g:'O-6'},
  {re:/\b(LCDR|Lieutenant Commander)\b/, r:'Lieutenant Commander', g:'O-4'},
  {re:/\b(CDR)\b/, r:'Commander', g:'O-5'},
  {re:/\bCommander\b(?!,? (?:of|for)\b)/, r:'Commander', g:b => NAVAL(b) ? 'O-5' : null, req:1},
  {re:/\b(CAPT)\b/, r:'Captain', g:b => (b && !NAVAL(b)) ? 'O-3' : 'O-6', req:1},
  {re:/\b(Capt\.?|CPT|Captain)\b/, r:'Captain', g:b => NAVAL(b) ? 'O-6' : 'O-3', req:1},
  {re:/\b(Maj\.?|MAJ)\b/, r:'Major', g:'O-4'},
  {re:/\bMajor\b(?! (?:Account|Accounts|Gift|Gifts|Project|Projects|Program|Programs|League|Deal|Deals|Market|Markets|Customer|Customers))/, r:'Major', g:'O-4', req:1},
  {re:/\b(LTJG|LT\(?JG\)?)\b/, r:'Lieutenant (jg)', g:'O-2'},
  {re:/\b(1stLt|1LT|1st ?Lt\.?|First Lieutenant)\b/, r:'First Lieutenant', g:'O-2'},
  {re:/\b(2ndLt|2LT|2nd ?Lt\.?|Second Lieutenant)\b/, r:'Second Lieutenant', g:'O-1'},
  {re:/\b(ENS|Ensign)\b/, r:'Ensign', g:'O-1', req:1},
  {re:/\b(LT|Lieutenant)\b/, r:'Lieutenant', g:b => NAVAL(b) ? 'O-3' : 'O-2', req:1},
  {re:/\b(?:CWO|CW|Chief Warrant Officer)[- ]?([2-5])\b/, r:'Chief Warrant Officer', g:(b,m) => 'W-' + m[1]},
  {re:/\b(CWO|Chief Warrant Officer)\b/, r:'Chief Warrant Officer', g:'W-3'},
  {re:/\b(WO-?1|WO|Warrant Officer)\b/, r:'Warrant Officer', g:'W-1'},
  {re:/\b(1stSgt|1SG|First Sergeant|SMSgt|Senior Master Sergeant|SCPO|Senior Chief(?: Petty Officer)?)\b/, r:'Senior NCO (E-8)', g:'E-8'},
  {re:/\b(MSG)\b/, r:'Master Sergeant', g:'E-8', req:1},
  {re:/\b(MSgt|Master Sergeant)\b/, r:'Master Sergeant', g:b => b === 'Air Force' || b === 'Space Force' ? 'E-7' : 'E-8'},
  {re:/\b(GySgt|Gunnery Sergeant|SFC|Sergeant First Class|Chief Petty Officer)\b/, r:'Senior NCO (E-7)', g:'E-7'},
  {re:/\b(CPO)\b/, r:'Chief Petty Officer', g:'E-7', req:1},
  {re:/\b(TSgt|Technical Sergeant|SSG|PO1|Petty Officer First Class)\b/, r:'NCO (E-6)', g:'E-6'},
  {re:/\b(SSgt|Staff Sergeant)\b/, r:'Staff Sergeant', g:b => b === 'Air Force' || b === 'Space Force' ? 'E-5' : 'E-6'},
  {re:/\b(LCpl|Lance Corporal|PFC|A1C|Airman First Class)\b/, r:'Junior Enlisted', g:'E-3'},
  {re:/\b(Sgt\.?|SGT|Sergeant|PO2|Petty Officer Second Class)\b/, r:'Sergeant / PO2', g:'E-5'},
  {re:/\b(Cpl|CPL|Corporal|SrA|Senior Airman|PO3|Petty Officer Third Class)\b/, r:'Corporal / PO3', g:'E-4'},
  {re:/\b(SPC)\b/, r:'Specialist', g:'E-4', req:1},
];
export function gradeTier(g){
  if (!g) return 'Rank not stated';
  if (g === 'SES') return 'SES';
  const [k, n] = [g[0], parseInt(g.split('-').pop(), 10)];
  if (k === 'O') return n >= 7 ? 'Flag / General' : n >= 4 ? 'Field grade' : 'Company grade';
  if (k === 'W') return 'Warrant';
  if (k === 'E') return n >= 7 ? 'Senior enlisted' : 'Enlisted / NCO';
  if (g.startsWith('GS') || g.startsWith('NH')) { if (g.startsWith('NH')) return n >= 3 ? 'GS-13 to 15' : 'GS-12 & below'; return n >= 13 ? 'GS-13 to 15' : 'GS-12 & below'; }
  return 'Rank not stated';
}
export function gradeNum(g){
  if (!g) return 0;
  if (g === 'SES') return 29;
  const n = parseInt(g.split('-').pop(), 10) || 0;
  if (g[0] === 'O') return 20 + n;
  if (g[0] === 'W') return 14 + n;
  if (g[0] === 'E') return 4 + n * .5;
  if (g.startsWith('NH')) return 10 + n * 1.5;
  if (g.startsWith('GS')) return n * .8;
  return 0;
}
export const GRADE_OPTS = ['O-10','O-9','O-8','O-7','O-6','O-5','O-4','O-3','O-2','O-1','W-5','W-4','W-3','W-2','W-1','E-9','E-8','E-7','E-6','E-5','E-4','E-3','E-2','E-1','SES','GS-15','GS-14','GS-13','GS-12','GS-11','GS-9','GS-7'];

// agencies & commands: label, segment, company/position regex
const AG = [
  ['USACE','DoD & Military',/\b(USACE|Army Corps of Engineers|Corps of Engineers)\b/i],
  ['NAVFAC','DoD & Military',/\bNAVFAC\b/i],['NAVSEA','DoD & Military',/\bNAVSEA\b/i],['NAVAIR','DoD & Military',/\bNAVAIR\b/i],
  ['NAVWAR / NIWC','DoD & Military',/\b(NAVWAR|NIWC|SPAWAR)\b/i],['MARCORSYSCOM','DoD & Military',/\b(MARCORSYSCOM|Marine Corps Systems Command)\b/i],
  ['DISA','DoD & Military',/\b(DISA|Defense Information Systems Agency)\b/],['DLA','DoD & Military',/\b(DLA|Defense Logistics Agency)\b/],
  ['NSA','DoD & Military',/\b(NSA|National Security Agency)\b/],['DIA','DoD & Military',/\b(DIA|Defense Intelligence Agency)\b/],
  ['U.S. Cyber Command','DoD & Military',/\b(USCYBERCOM|CYBERCOM|Cyber Command|ARCYBER|FLTCYBER|MARFORCYBER|AFCYBER)\b/i],
  ['DARPA','DoD & Military',/\bDARPA\b/],['DIU','DoD & Military',/\b(DIU|Defense Innovation Unit)\b/],
  ['AFRL','DoD & Military',/\b(AFRL|Air Force Research Lab)/i],['AFCEC','DoD & Military',/\bAFCEC\b/],
  ['Space Systems Command','DoD & Military',/\b(Space Systems Command|SSC)\b/],['DCSA','DoD & Military',/\bDCSA\b/],['DCMA','DoD & Military',/\bDCMA\b/],
  ['Defense Health Agency','DoD & Military',/\b(DHA|Defense Health Agency)\b/],['Missile Defense Agency','DoD & Military',/\b(MDA|Missile Defense Agency)\b/],
  ['SOCOM','DoD & Military',/\b(USSOCOM|SOCOM|MARSOC|SOCPAC|Special Operations Command)\b/i],['Combatant Command','DoD & Military',/\b(INDOPACOM|EUCOM|CENTCOM|NORTHCOM|NORAD|SOUTHCOM|AFRICOM|TRANSCOM|STRATCOM|SPACECOM)\b/],
  ['OSD / Pentagon','DoD & Military',/\b(OSD|OUSD|Office of the Secretary of Defense|Pentagon|Joint Staff|CDAO)\b/],
  ['CISA','Federal Civilian',/\b(CISA|Cybersecurity and Infrastructure Security Agency)\b/],
  ['DHS','Federal Civilian',/\b(DHS|Homeland Security|FEMA|TSA|CBP|USCIS|Secret Service)\b/],
  ['DOE / NNSA','Federal Civilian',/\b(DOE|NNSA|Department of Energy|Dept\.? of Energy|CESER|Office of Electricity)\b/],
  ['NRC','Federal Civilian',/\b(NRC|Nuclear Regulatory Commission)\b/],['FERC','Federal Civilian',/\b(FERC|Federal Energy Regulatory Commission)\b/],
  ['TVA','Federal Civilian',/\b(TVA|Tennessee Valley Authority)\b/],
  ['Power Marketing Admins','Federal Civilian',/\b(BPA|Bonneville Power|WAPA|Western Area Power|Southwestern Power Administration|Southeastern Power Administration)\b/i],
  ['VA','Federal Civilian',/\b(Veterans Affairs|VA Medical|Veterans Health Administration)\b/i],
  ['DOJ / FBI','Federal Civilian',/\b(FBI|DOJ|Department of Justice|Federal Bureau of Investigation|DEA|ATF|U\.?S\.? Marshals)\b/],
  ['DOT / FAA','Federal Civilian',/\b(FAA|Federal Aviation Administration|U\.?S\.? Department of Transportation|USDOT|PHMSA)\b/],
  ['GSA','Federal Civilian',/\b(GSA|General Services Administration)\b/],['NASA','Federal Civilian',/\bNASA\b/],
  ['Treasury / IRS','Federal Civilian',/\b(Department of the Treasury|U\.?S\.? Treasury|IRS|Internal Revenue Service)\b/],
  ['SBA','Federal Civilian',/\b(Small Business Administration|SBA)\b/],
  ['State / USAID','Federal Civilian',/\b(Department of State|State Department|USAID)\b/],
  ['HHS','Federal Civilian',/\b(HHS|Health and Human Services|Centers for Disease Control|NIH|FDA)\b/],
  ['Commerce / NIST','Federal Civilian',/\b(NIST|Department of Commerce|NOAA|NTIA|Census Bureau)\b/],
  ['Interior','Federal Civilian',/\b(Department of the Interior|Bureau of Reclamation|USGS|Bureau of Land Management|National Park Service)\b/],
  ['EPA','Federal Civilian',/\b(EPA|Environmental Protection Agency)\b/],['USDA','Federal Civilian',/\b(USDA|Department of Agriculture)\b/],
  ['Congress / GAO','Federal Civilian',/\b(U\.?S\.? Senate|House of Representatives|U\.?S\.? Congress|GAO|Government Accountability Office)\b/],
  ['Intelligence Community','Federal Civilian',/\b(CIA|ODNI|Central Intelligence Agency)\b/],
  ['Other Federal','Federal Civilian',/\b(U\.?S\.? Department of|United States Department of|Federal Government|U\.?S\.? Government|USG)\b/i],
];
const SEG_RX = [
  ['Labs & Academia', /\b(University|College|Institute of Technology|National Laborator(?:y|ies)|National Lab|Idaho National|INL|ORNL|Oak Ridge|PNNL|Pacific Northwest National|Sandia|Los Alamos|Lawrence Livermore|NREL|Argonne|Brookhaven|SRNL|MITRE|Lincoln Laborator|Applied Physics Lab|JHU ?APL|Aerospace Corporation|RAND|EPRI|Electric Power Research|Software Engineering Institute|Battelle|SwRI|Georgia Tech Research)\b/i],
  ['State & Local', /\b(State of [A-Z][a-z]+|Commonwealth of|County|City of|Town of|Municipal|Port Authority|Public Schools|School District|Department of Information Technology|State Police|Emergency Management|NCDIT|NCDOT|Governor)\b/],
  ['OT/ICS & Cyber Vendors', /\b(Waterfall|Dragos|Nozomi|Claroty|Armis|Forescout|TXOne|Owl Cyber|Fortinet|Palo Alto Networks|Tenable|Rapid7|CrowdStrike|Mandiant|SentinelOne|Zscaler|Splunk|Siemens|Rockwell Automation|Schneider Electric|Honeywell|ABB|Emerson|GE Vernova|Hitachi Energy|Yokogawa|Belden|Moxa|Industrial Defender|Verve Industrial|Xage|Shift5|SCADAfence|Radiflow|OTORIO|OPSWAT|Bayshore|Cylus|Okta|Check Point|Trellix|Proofpoint|Axonius|Tanium|Sygnia|Cisco|Juniper|Arctic Wolf|Darktrace|Elastic|Netskope|Illumio|Veracode|Recorded Future|Exodigo|EnerKnol)\b/i],
  ['Channel & Integrators', /\b(Carahsoft|SHI International|SHI\b|CDW|World Wide Technology|WWT|Iron Bow|immixGroup|immix|GuidePoint|Optiv|Presidio|Insight Public Sector|ePlus|DLT Solutions|Four Inc|Trace3|Arrow Electronics|TD SYNNEX|Ingram Micro|Merlin Cyber|August Schell|Thundercat|Sirius Federal|Reseller|Distributor)\b/i],
  ['Gov & Defense Contractors', /\b(Lockheed|Raytheon|RTX|Northrop|General Dynamics|GDIT|Boeing|BAE Systems|Leidos|SAIC|Booz Allen|CACI|ManTech|Peraton|L3Harris|Huntington Ingalls|HII|Parsons|KBR|Amentum|Jacobs|Accenture Federal|Deloitte Government|Textron|Sierra Nevada|Anduril|Palantir|Shield AI|Bell Textron|Sikorsky|Oshkosh Defense|Leonardo DRS|Mercury Systems|Telos|Unisys Federal|Maximus|V2X|Vectrus|Guidehouse|ICF|Serco|AECOM|Black & Veatch|Burns & McDonnell|Fluor|Bechtel|Kiewit|Tetra Tech|Sev1Tech|Govini|Applied Insight|Iron EagleX|Two Six|SOSi|Credence|Chugach|Akima|Arcfield|Peraton)\b/i],
  ['Utilities & Energy', /\b(Duke Energy|Dominion|Southern Company|Georgia Power|Alabama Power|Exelon|Constellation|NextEra|FPL|AEP|American Electric Power|Xcel|PG&E|Edison|Entergy|FirstEnergy|PPL|Ameren|Evergy|Eversource|National Grid|ConEd|Con Edison|DTE|Consumers Energy|CenterPoint|Vistra|NRG|Tri-State|Oglethorpe|Santee Cooper|ERCOT|PJM|MISO|ISO New England|NYISO|CAISO|NERC|SERC|WECC|ElectriCities|NCEMC|Electric Cooperative|Electric Membership|Electric|Power|Energy|Utility|Utilities|Cooperative|Nuclear|Generation|Transmission|Water|Natural Gas|Pipeline|Midstream|Renewables|Solar)\b/i],
  ['Recruiting & Staffing', /\b(Recruit\w*|Staffing|Talent Solutions|Headhunter|Executive Search|Robert Half|TEKsystems|Kforce|ClearanceJobs|Insight Global|Randstad|Aerotek)\b/i],
];
const SEN_RX = [
  ['VP', /\b(vice president|vp|svp|evp|avp)\b/i],
  ['C-suite / Owner', /\b(chief (?:[\w&-]+ ){0,3}officer|chief executive|ceo|cto|cio|ciso|coo|cfo|cro|cmo|cso|president|founder|co-founder|owner|managing partner|managing director|executive director)\b/i],
  ['Director / Head', /\b(director|head of|dir\.|deputy chief|chief of staff)\b/i],
  ['Manager / Lead', /\b(manager|mgr|lead|supervisor|team lead|branch chief|section chief|division chief|chief of)\b/i],
];
const FUNC_RX = [
  ['Acquisition & Contracting', /\b(contracting officer|contract specialist|contracts? manager|contracting|(?<!talent )acquisition|procurement|purchasing|buyer|sourcing|small business (?:specialist|professional|liaison)|osbp|sadbu|1102)\b|\b(KO|PCO|ACO|COR)\b/i],
  ['Recruiting & HR', /\b(recruit\w*|talent|human resources|hr|people operations|staffing)\b/i],
  ['Cybersecurity', /\b(cyber\w*|security|ciso|infosec|isso|issm|soc|threat|vulnerab\w*|penetration|red team|zero trust|rmf|grc|incident response|forensic\w*|ics|ot security|scada|nerc cip|cip compliance)\b/i],
  ['Sales & BD', /\b(sales|account executive|account manager|business development|bd|capture|partner(?:ship)?s?|channel|alliances?|customer success|go-to-market|gtm|revenue|solutions? consultant|territory|federal sales)\b/i],
  ['Program Management', /\b(program manager|project manager|program management|pmp|peo|portfolio manager|program director|product manager|apm|dpm)\b/i],
  ['Engineering & Technical', /\b(engineer\w*|architect|developer|scientist|technical|technologist|r&d|research\w*|automation)\b/i],
  ['IT & Infrastructure', /\b(information technology|network\w*|systems administrator|sysadmin|infrastructure|cloud|data center|help ?desk|devops|software|it specialist)\b|\bIT\b/i],
  ['Policy & Compliance', /\b(policy|regulatory|compliance|legislative|government affairs|government relations|public affairs|advocacy|standards|audit\w*)\b/i],
  ['Operations & Logistics', /\b(operations|logistics|maintenance|facilities|facility|plant|supply chain|field service|installation|readiness|operator|dispatcher|lineman|avionics|crew chief)\b/i],
  ['Marketing & Comms', /\b(marketing|communications|brand|content|social media|pr|events)\b/i],
  ['Finance & Legal', /\b(finance|financial|accounting|accountant|cfo|controller|budget|comptroller|counsel|attorney|legal|paralegal|lawyer)\b/i],
  ['Consulting & Advisory', /\b(consultant|consulting|advisor|adviser|advisory|analyst)\b/i],
  ['Executive Leadership', /\b(ceo|president|founder|owner|chief|managing director|general manager|executive director|commanding officer|commander|partner|principal)\b/i],
];
export const CERTS = [['CISSP',/\bCISSP\b/],['CISM',/\bCISM\b/],['CCSP',/\bCCSP\b/],['GICSP',/\bGICSP\b/],['GRID / GCIP',/\b(GRID|GCIP)\b/],['PMP',/\bPMP\b/],['Security+',/Security\+|Sec\+/],['CEH',/\bCEH\b/],['CASP+',/\bCASP\+?/],['OSCP',/\bOSCP\b/],['CMMC',/\bCMMC[- ]?(RP|RPA|CCP|CCA|LTP)?\b/],['ISA/IEC 62443',/\b62443\b/],['PE',/,\s*P\.?E\.?\b/],['ITIL',/\bITIL\b/]];
const CLR_RX = /\b(TS\/SCI|TS-SCI|Top Secret|Secret Clearance|Active Secret|Q Clearance|DOE Q|Polygraph|CI Poly|FS Poly|Cleared)\b/i;

export function classify(r, ed){
  ed = ed || {};
  const name = `${r.f||''} ${r.l||''}`, pos = r.p || '', co = r.c || '';
  const np = `${name} | ${pos}`, all = `${np} | ${co}`;
  let branch = '', branchWork = '';
  for (const [b, rxs] of BRANCH_RX) if (rxs.some(x => x.test(`${pos} | ${co}`))) { branchWork = b; break; }
  if (!branchWork) for (const [b, rxs] of BRANCH_RX) if (rxs.some(x => x.test(name))) { branch = b; break; }
  // a branch that only shows up in someone's name ("Jane Doe, USMC") marks a veteran, not their employer
  const nameOnly = !branchWork && !!branch;
  if (branchWork) branch = branchWork;
  const vet = VET_RX.test(np) || nameOnly;
  let rank = '', grade = '';
  for (const R of RANKS){
    if (R.req && !branch) continue;
    const m = (R.pos ? pos : np).match(R.re); if (!m) continue;
    const g = typeof R.g === 'function' ? R.g(branch, m) : R.g;
    if (!g) continue;
    rank = R.r; grade = g; break;
  }
  const milRank = !!grade;
  if (!grade){
    let m;
    if (/\bSES\b|Senior Executive Service/.test(np)) { grade = 'SES'; rank = 'Senior Executive Service'; }
    else if ((m = np.match(/\b(?:GS|GG)-\d{4}-(\d{1,2})\b/)) || (m = np.match(/\b(?:GS|GG)[- ]?(\d{1,2})\b/))) { grade = 'GS-' + (+m[1]); rank = grade; }
    else if ((m = np.match(/\bNH[- ]?0?([1-4])\b/))) { grade = 'NH-0' + m[1]; rank = grade; }
  }
  // agency & segment
  let agency = '', seg = '';
  for (const [lab, s, rx] of AG) if (rx.test(co)) { agency = lab; seg = s; break; }
  if (!seg) for (const [s, rx] of SEG_RX) if (rx.test(co)) { seg = s; break; }
  if (!agency) for (const [lab, s, rx] of AG) if (rx.test(pos)) { agency = lab; if (!seg && (branch || s === 'Federal Civilian') && !co) seg = s; break; }
  if (!seg && !co) for (const [s, rx] of SEG_RX) if (rx.test(pos)) { seg = s; break; }
  // status
  let status = '';
  if (branch){
    if (vet) status = 'Veteran / Retired';
    else if (branch === 'National Guard' || RES_RX.test(np)) status = 'Reserve / Guard';
    else if (milRank) status = 'Serving';
    else if (seg && COMMERCIAL.has(seg)) { if (!agency) agency = branch === 'Joint / DoD' ? 'DoD (supported)' : branch + ' (supported)'; branch = ''; }
    else if (/^(GS|NH|SES)/.test(grade) || /\b(?:GS|GG|NH)[- ]?\d|\bcivilian\b|\bDAC\b|Senior Executive Service/i.test(np)) status = 'DoD Civilian';
    // otherwise uniformed or civilian is unknown, so leave it blank rather than guess
  } else if (vet) status = 'Veteran / Retired';
  if (!seg) {
    if (branch && !(status === 'Veteran / Retired' && co && !/\b(retired|veteran|self[- ]employed|seeking|transition)\b/i.test(co))) seg = 'DoD & Military';
    else if (/\.mil$/i.test(r.e || '')) seg = 'DoD & Military';
    else if (/\.gov$/i.test(r.e || '')) seg = 'Federal Civilian';
    else seg = 'Other Commercial';
  } else if (branch && status !== 'Veteran / Retired' && !COMMERCIAL.has(seg)) seg = 'DoD & Military';
  // seniority, function
  let sen = 'Individual contributor';
  for (const [s, rx] of SEN_RX) if (rx.test(pos)) { sen = s; break; }
  let func = 'Other / Unspecified';
  for (const [f, rx] of FUNC_RX) if (rx.test(pos)) { func = f; break; }
  if (func === 'Other / Unspecified' && status === 'Serving') func = 'Military Operations';
  const certs = CERTS.filter(([, rx]) => rx.test(np)).map(([c]) => c);
  const clr = CLR_RX.test(np);
  // overrides
  if (ed.seg) seg = ed.seg;
  if (ed.branch) branch = ed.branch === '__none' ? '' : ed.branch;
  if (ed.status) status = ed.status === '__none' ? '' : ed.status;
  if (ed.grade) { grade = ed.grade === '__none' ? '' : ed.grade; rank = grade ? (ed.rank || rank || grade) : ''; }
  else if (ed.rank) rank = ed.rank;
  const tier = (branch || status || grade) ? gradeTier(grade) : '';
  // map ring
  let lv = {'C-suite / Owner':1,'VP':1,'Director / Head':2,'Manager / Lead':3}[sen] || 4;
  const gn = gradeNum(grade);
  if (grade){ const gl = grade === 'SES' || /^O-(6|7|8|9|10)$/.test(grade) ? 1 : /^O-[45]$|^E-9$|^GS-15$|^NH-04$/.test(grade) ? 2 : /^O-[123]$|^W-|^E-[78]$|^GS-1[34]$|^NH-03$/.test(grade) ? 3 : 4; lv = Math.min(lv, gl); }
  const {ind, how: indHow} = inferIndustry({c: co, p: pos, seg, status, vet: status === 'Veteran / Retired'}, ed.ind);
  return {seg, branch, status, rank, grade, tier, gn, sen, func, agency, certs, clr, lv, vet: status === 'Veteran / Retired', ind, indHow};
}


export function keyOf(r){
  const m = (r.u || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m){ let k; try { k = decodeURIComponent(m[1]); } catch { k = m[1]; } k = k.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180); if (k && k !== '.' && k !== '..') return k; }
  return 'n_' + hash(`${r.f}|${r.l}|${r.c}`.toLowerCase()).toString(36);
}

export const stripRow = r => { const o = {}; for (const f of ['k','f','l','u','e','c','p','d','fs','fi','x','jc','pv','rx','_new']) if (r[f] !== undefined && r[f] !== null && r[f] !== '') o[f] = r[f]; return o; };

export function parseCSV(text){
  const out = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i + 1] === '"'){ f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); out.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length){ row.push(f); out.push(row); }
  return out;
}
export function parseDate(s){
  s = (s || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/);
  if (m){ const mi = MON.findIndex(x => x.toLowerCase() === m[2].toLowerCase()); if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0].slice(0, 10);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m){ const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const t = Date.parse(s); return isNaN(t) ? '' : isoDay(t);
}
export function rowsFromCSV(text){
  const grid = parseCSV(text.replace(/^﻿/, ''));
  const hi = grid.findIndex(r => r.some(c => /^\s*first name\s*$/i.test(c)) && r.some(c => /^\s*last name\s*$/i.test(c)));
  if (hi < 0) throw new Error('This file has no “First Name” and “Last Name” columns. Use the Connections.csv file from your LinkedIn data export.');
  const H = grid[hi].map(h => h.trim().toLowerCase());
  const ix = n => H.indexOf(n);
  const I = {f: ix('first name'), l: ix('last name'), u: ix('url'), e: ix('email address'), c: ix('company'), p: ix('position'), d: ix('connected on')};
  const out = [];
  for (const g of grid.slice(hi + 1)){
    const get = k => I[k] >= 0 ? (g[I[k]] || '').trim() : '';
    const r = {f: get('f'), l: get('l'), u: get('u'), e: get('e'), c: get('c').slice(0, 160), p: get('p').slice(0, 240), d: parseDate(get('d'))};
    if (!r.f && !r.l && !r.u) continue;
    r.k = keyOf(r); out.push(r);
  }
  if (!out.length) throw new Error('The file has the right columns but no connections in it.');
  return out;
}
export async function readFile(file){
  if (/\.zip$/i.test(file.name) || file.type === 'application/zip'){
    const zip = await JSZip.loadAsync(file);
    const files = Object.values(zip.files);
    const find = rx => files.find(f => rx.test(f.name));
    const entry = find(/(^|\/)connections\.csv$/i);
    if (!entry) throw new Error('No Connections.csv inside that zip. Request the export with “Connections” selected.');
    const rows = rowsFromCSV(await entry.async('string'));
    const text = async rx => { const e = find(rx); return e ? e.async('string') : ''; };
    const t = {messages: await text(/(^|\/)messages\.csv$/i), invitations: await text(/(^|\/)invitations\.csv$/i),
      endGiven: await text(/(^|\/)endorsement_given_info\.csv$/i), endRecv: await text(/(^|\/)endorsement_received_info\.csv$/i),
      recGiven: await text(/(^|\/)recommendations_given\.csv$/i), recRecv: await text(/(^|\/)recommendations_received\.csv$/i)};
    if (Object.values(t).some(Boolean)) rows.rel = relationsFromArchive(t, rows);
    return rows;
  }
  return rowsFromCSV(await file.text());
}

/* ---------- relationships from the rest of the LinkedIn archive ---------- */
export const slugOf = u => { const m = String(u || '').match(/linkedin\.com\/in\/([^/?#\s,"]+)/i); if (!m) return ''; let k = m[1]; try { k = decodeURIComponent(k); } catch {} return k.toLowerCase().replace(/\/+$/, ''); };
function table(text){
  if (!text) return [];
  const g = parseCSV(text.replace(/^\uFEFF/, ''));
  const hi = g.findIndex(r => r.length > 2); if (hi < 0) return [];
  const H = g[hi].map(h => h.trim().toLowerCase());
  return g.slice(hi + 1).filter(r => r.length > 1).map(r => Object.fromEntries(H.map((h, i) => [h, (r[i] || '').trim()])));
}
function stamp(s){
  s = (s || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m){ const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return parseDate(s);
}
const clean = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function relationsFromArchive(t, rows){
  const bySlug = new Map(), byName = new Map();
  for (const r of rows){ const s = slugOf(r.u); if (s) bySlug.set(s, r.k); byName.set(`${r.f} ${r.l}`.toLowerCase().replace(/\s+/g, ' ').trim(), r.k); }
  const rel = new Map(); const get = k => { let o = rel.get(k); if (!o){ o = {}; rel.set(k, o); } return o; };
  // work out which profile is "me": the one that shows up in the most messages
  const msgs = table(t.messages).filter(m => (m['is message draft'] || '').toLowerCase() !== 'yes' && (m.folder || '').toUpperCase() !== 'SPAM');
  const freq = new Map(); const bump = s => s && freq.set(s, (freq.get(s) || 0) + 1);
  for (const m of msgs){ bump(slugOf(m['sender profile url'])); for (const u of (m['recipient profile urls'] || '').split(',')) bump(slugOf(u)); }
  const me = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  for (const m of msgs){
    const from = slugOf(m['sender profile url']), to = (m['recipient profile urls'] || '').split(',').map(slugOf).filter(Boolean);
    const out = from === me, others = out ? to.filter(x => x !== me) : [from];
    const d = stamp(m.date); if (!d) continue;
    for (const o of others){
      const k = bySlug.get(o); if (!k) continue;
      const x = get(k);
      x.m = (x.m || 0) + 1; if (out) x.o = (x.o || 0) + 1; else x.i = (x.i || 0) + 1;
      if (!x.f || d < x.f) x.f = d;
      if (!x.t || d > x.t || (d === x.t && !out)){ x.t = d; x.dir = out ? 'o' : 'i'; if (others.length === 1){ const c = clean(m.content); x.s = c.length > 150 ? c.slice(0, 147) + '…' : c; } }
    }
  }
  for (const v of table(t.invitations)){
    const outgoing = (v.direction || '').toUpperCase() === 'OUTGOING';
    const k = bySlug.get(slugOf(outgoing ? v.inviteeprofileurl : v.inviterprofileurl)); if (!k) continue;
    const x = get(k); x.inv = outgoing ? 'o' : 'i'; x.invd = stamp(v['sent at']); const n = clean(v.message); if (n) x.invn = n.slice(0, 200);
  }
  for (const e of table(t.endGiven)){ const k = bySlug.get(slugOf(e['endorsee public url'])); if (k){ const x = get(k); x.eg = (x.eg || 0) + 1; } }
  for (const e of table(t.endRecv)){ const k = bySlug.get(slugOf(e['endorser public url'])); if (k){ const x = get(k); x.er = (x.er || 0) + 1; } }
  const nm = r => `${r['first name'] || ''} ${r['last name'] || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const e of table(t.recGiven)){ const k = byName.get(nm(e)); if (k) get(k).rg = 1; }
  for (const e of table(t.recRecv)){ const k = byName.get(nm(e)); if (k) get(k).rr = 1; }
  return rel;
}
/** 0 to 100, plus a plain band. Recency counts most, then volume, two-way conversation and endorsements. */
export function warmth(x, today){
  if (!x || !(x.m || x.eg || x.er || x.rg || x.rr || x.inv)) return {score: 0, band: 'none'};
  let s = 0;
  if (x.t){ const days = (Date.parse(today) - Date.parse(x.t)) / 864e5; s += days < 30 ? 40 : days < 90 ? 32 : days < 180 ? 24 : days < 365 ? 16 : days < 730 ? 8 : 3; }
  s += Math.min(x.m || 0, 30) / 30 * 25;
  if (x.o && x.i) s += 15;
  s += Math.min(((x.eg ? 1 : 0) + (x.er ? 1 : 0)) * 5, 10) + (x.rg || x.rr ? 10 : 0) + (x.inv === 'i' ? 3 : 0);
  s = Math.round(Math.min(100, s));
  return {score: s, band: s >= 60 ? 'strong' : s >= 35 ? 'warm' : s >= 12 ? 'light' : 'none'};
}

export function mergeImport(incoming, prevRows, prevMeta){
  const live = !!prevRows;
  const prev = live ? new Map(prevRows.map(r => [r.k, stripRow(r)])) : new Map();
  const first = prev.size === 0;
  const n = (live && prevMeta && prevMeta.n || 0) + 1;
  const seen = new Set(); let added = 0, changed = 0, back = 0;
  const out = [];
  const rel = incoming.rel;
  for (const inc of incoming){
    if (seen.has(inc.k)) continue; seen.add(inc.k);
    const o = prev.get(inc.k);
    if (!o){ const nr = Object.assign({}, inc, {fs: TODAY, fi: n}); if (rel && rel.has(inc.k)) nr.rx = rel.get(inc.k); out.push(nr); if (!first) added++; continue; }
    const r = Object.assign({}, o, {f: inc.f, l: inc.l, u: inc.u || o.u, e: inc.e || o.e, d: inc.d || o.d});
    if (r.x){ delete r.x; back++; }
    if ((o.c || '') !== (inc.c || '') || (o.p || '') !== (inc.p || '')){
      r.pv = [{c: o.c || '', p: o.p || '', until: TODAY}, ...(o.pv || [])].slice(0, 4);
      r.jc = TODAY; changed++;
    }
    r.c = inc.c; r.p = inc.p;
    if (rel){ if (rel.has(inc.k)) r.rx = rel.get(inc.k); else delete r.rx; }
    out.push(r);
  }
  let removed = 0;
  for (const [k, o] of prev) if (!seen.has(k)){ const r = Object.assign({}, o); if (!r.x){ r.x = TODAY; removed++; } out.push(r); }
  const total = out.filter(r => !r.x).length;
  const imports = (live && prevMeta && prevMeta.imports ? prevMeta.imports.slice() : []).concat([{d: TODAY, total, added, changed, removed}]).slice(-104);
  return {rows: out, meta: {lastImport: TODAY, imports, n, rel: rel ? TODAY : (prevMeta && prevMeta.rel) || ''}, stats: {total, added: first ? total : added, changed, removed, back, first, rel: rel ? rel.size : null}};
}

export function sampleNetwork(){
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const FN = ['James','Maria','Robert','Linda','Michael','Angela','David','Jennifer','William','Tasha','Richard','Susan','Joseph','Keisha','Thomas','Sarah','Marcus','Karen','Chris','Nancy','Daniel','Lisa','Matt','Monica','Anthony','Sandra','Mark','Ashley','Derek','Kim','Steven','Emily','Andrew','Rosa','Kenneth','Michelle','Josh','Carol','Kevin','Amanda','Brian','Priya','George','Deborah','Tim','Stephanie','Ron','Rebecca','Jason','Laura','Ryan','Grace','Victor','Hannah','Luis','Megan','Omar','Dana','Travis','Erin','Hector','Paige','Andre','Leah','Wes','Tara','Calvin','Nina','Dwayne','Holly'];
  const LN = ['Alvarez','Brooks','Carter','Dawson','Ellis','Fischer','Garrison','Hale','Ingram','Jennings','Keller','Lawson','Mercer','Nolan','Ortega','Pruitt','Quinn','Ramsey','Sutton','Tate','Underwood','Vance','Whitaker','Yates','Zimmerman','Barrett','Coleman','Dunn','Easley','Ford','Griffin','Hughes','Irving','Jordan','Kemp','Lyons','McCall','Nash','Owens','Parks','Reyes','Sloan','Thornton','Upton','Vega','Walsh','Boyd','Chandler','Doyle','Estrada','Flynn','Gaines','Holt','Ivey','Jacobs','Knox','Lowe','Monroe','Neal','Pace','Rhodes','Stokes','Tran','Vaughn','Wade','Cross'];
  const T = [
    [12,'United States Marine Corps',['LtCol | Program Manager, MARCORSYSCOM','Major, USMC | Cyber Operations Officer','GySgt | Data Network Chief','MSgt | Avionics Chief, MCAS Cherry Point','Col | Commanding Officer, Camp Lejeune','Capt, USMC | Communications Officer','SgtMaj | Senior Enlisted Advisor','CWO3 | Data Systems Officer','Sgt | Cyber Defense Specialist','1stLt | Logistics Officer']],
    [8,'U.S. Army',['LTC | Battalion Commander','MAJ | Cyber Operations Officer, ARCYBER','SFC | Signal NCO','CW4 | Network Management Technician','CPT | Engineer Officer','COL | Brigade Commander, Fort Liberty','CSM | Command Sergeant Major']],
    [5,'US Army Corps of Engineers',['COL | District Commander, USACE Wilmington District','Contracting Officer (GS-1102-13)','Chief, Engineering Division (GS-15)','Cybersecurity Specialist, GS-12','Program Manager, Military Construction']],
    [7,'U.S. Navy',['CDR, USN | Public Works Officer','CAPT, USN | Commanding Officer','LCDR | Cyber Warfare Engineer','Senior Chief Petty Officer | Electronics Technician','LT, USN | Information Warfare Officer']],
    [4,'NAVFAC Southeast',['Contract Specialist, GS-12','Branch Head, Energy (GS-14)','Facilities Program Manager','CDR | Executive Officer']],
    [6,'U.S. Air Force',['Lt Col, USAF | Squadron Commander, Seymour Johnson AFB','Maj, USAF | Cyberspace Operations','MSgt, USAF | Cyber Systems Operations','Capt, USAF | Acquisition Program Manager','CMSgt | Command Chief']],
    [2,'U.S. Space Force',['Lt Col, USSF | Cyber Squadron Commander','Capt, USSF | Space Systems Operations']],
    [2,'United States Coast Guard',['CDR, USCG | Cyber Command Planner','LT, USCG | Naval Engineer']],
    [2,'North Carolina National Guard',['MAJ | Defensive Cyber Operations Element Lead','SSG | Cyber Analyst']],
    [5,'Defense Information Systems Agency',['IT Specialist (INFOSEC), GS-13','Senior Executive Service, Director','Contracting Officer, GS-14','Zero Trust Program Lead']],
    [3,'U.S. Cyber Command',['Planner (GS-14)','Col | J3 Deputy Director','Operations Analyst']],
    [3,'Office of the Secretary of Defense',['Senior Advisor, SES','Policy Analyst, Critical Infrastructure (GS-15)']],
    [4,'Cybersecurity and Infrastructure Security Agency (CISA)',['Regional Cybersecurity Advisor','Branch Chief, ICS Assessments (GS-15)','Protective Security Advisor','Senior Election Security Advisor']],
    [3,'U.S. Department of Energy',['Program Manager, CESER','Senior Advisor, Office of Electricity','Contracting Officer, GS-1102-14']],
    [2,'U.S. Nuclear Regulatory Commission',['Cyber Security Inspector','Senior Reactor Engineer']],
    [2,'Tennessee Valley Authority',['Manager, OT Cybersecurity','Senior Program Manager, Grid Modernization']],
    [2,'Bonneville Power Administration',['Cyber Security Architect','IT Specialist']],
    [2,'U.S. Department of Veterans Affairs',['Contract Specialist','Chief Information Security Officer, VISN 6']],
    [2,'General Services Administration',['Contracting Officer','Category Manager, IT']],
    [3,'State of North Carolina',['Chief Information Security Officer','Deputy State CIO','Emergency Management Coordinator']],
    [2,'City of Greensboro',['IT Director','Water Resources Engineer']],
    [2,'Guilford County',['Emergency Management Director','Network Manager']],
    [13,['Duke Energy','Dominion Energy','Southern Company','Xcel Energy','Entergy','American Electric Power','Santee Cooper','Tri-State Generation and Transmission','Exelon','Constellation','NextEra Energy','PJM Interconnection','ElectriCities of NC','NCEMC'],['Director, Cybersecurity','NERC CIP Compliance Manager','OT Security Engineer','VP, Transmission Operations','Manager, Substation Automation','Chief Information Security Officer','Senior Engineer, Protection & Control','Physical Security Manager | USMC Veteran','Nuclear Security Manager | Navy Veteran']],
    [12,['Dragos','Nozomi Networks','Claroty','Fortinet','Palo Alto Networks','Waterfall Security Solutions','Armis','Tenable','Siemens','Rockwell Automation','Schneider Electric','Honeywell','CrowdStrike','Cisco'],['Regional Sales Director, Federal','Solutions Engineer','Channel Account Manager','Principal ICS Consultant','Account Executive, SLED','VP, Public Sector','Field CTO','Sales Engineer | CISSP, GICSP','Federal Account Manager | Retired Army LTC']],
    [6,['Carahsoft','World Wide Technology','SHI International','CDW Government','Iron Bow Technologies','immixGroup','GuidePoint Security','Optiv'],['Account Manager, DoD','Partner Development Manager','Sales Director, Federal Civilian','Vendor Alliance Manager','Account Executive, Navy & Marine Corps | USMC Veteran']],
    [12,['Lockheed Martin','Leidos','Booz Allen Hamilton','SAIC','CACI International','Peraton','General Dynamics Information Technology','Northrop Grumman','ManTech','Parsons','Jacobs','Huntington Ingalls Industries','KBR','Amentum'],['Capture Manager','Program Manager supporting NAVWAR','Cyber Engineer (TS/SCI)','Director, Business Development','Systems Engineer','Senior Associate, supporting U.S. Army | Army Veteran','Capture Director | Retired USAF Col','Deputy Program Manager | CMMC RP','Solutions Architect | Former Marine']],
    [5,['Idaho National Laboratory','Pacific Northwest National Laboratory','Oak Ridge National Laboratory','Sandia National Laboratories','MITRE','Johns Hopkins Applied Physics Laboratory','North Carolina State University','EPRI'],['Cybersecurity Researcher','Program Manager, Critical Infrastructure','Principal Engineer','Professor of Electrical Engineering','Group Leader, ICS Security']],
    [3,['TEKsystems','Robert Half','ClearanceJobs','Insight Global'],['Technical Recruiter','Talent Acquisition Partner','Account Manager, Cleared Staffing']],
    [8,['Amazon Web Services','Microsoft','Google Public Sector','Salesforce','ServiceNow','Oracle','Esri','Snowflake'],['Account Executive, Public Sector','Senior Solutions Architect','Customer Success Manager','Regional Vice President','Partner Manager']],
    [5,['Accenture','Deloitte','IBM','KPMG','Gartner','Capgemini'],['Senior Manager','Managing Director','Consultant','Research Director','Partner, Public Sector']],
    [4,['Verizon','AT&T','Lumen Technologies','Dell Technologies','Motorola Solutions','Corning'],['Federal Account Director','Network Engineer','Solutions Architect','Regional Sales Manager']],
    [4,['Volvo Group','Caterpillar','Eaton','Honeywell Building Technologies','Nucor','Mack Trucks'],['Plant Manager','Director, Operations','Controls Engineer','Supply Chain Manager | Navy Veteran']],
    [4,['Wells Fargo','Truist','Bank of America','Navy Federal Credit Union','Fidelity Investments','Edward Jones'],['Vice President, Commercial Banking','Financial Advisor','Information Security Manager','Branch Manager','Wealth Advisor | USMC Veteran']],
    [2,['USAA','State Farm','Nationwide','The Hartford'],['Insurance Agent','Cyber Risk Underwriter','Claims Manager']],
    [4,['Cone Health','Novant Health','Atrium Health','Labcorp','Pfizer','UNC Health'],['Registered Nurse','Director of IT Security','Clinical Research Associate','Physician','Practice Manager']],
    [2,['Smith Anderson LLP','Womble Bond Dickinson','Cherry Bekaert','FORVIS'],['Partner, Government Contracts','Attorney','Senior Audit Manager, CPA']],
    [3,['Keller Williams Realty','CBRE','Coldwell Banker','Berkshire Hathaway HomeServices'],['Realtor','Property Manager','Broker | Army Veteran']],
    [3,['Marriott International','Hilton','Destinara Travel','Delta Air Lines','American Airlines'],['Director of Sales, Government & Military','Travel Advisor','Captain, A320 | Former USAF Pilot','Group Sales Manager']],
    [3,['FedEx','UPS','Norfolk Southern','Old Dominion Freight Line','XPO'],['Operations Manager','Fleet Manager | Army Veteran','Regional Director, Logistics']],
    [3,['Lowe’s Companies','Krispy Kreme','Food Lion','Hanesbrands','PepsiCo'],['District Manager','Merchandising Director','Store Manager','Brand Manager']],
    [2,['WFMY News 2','Greensboro News & Record','iHeartMedia'],['Reporter','Marketing Director','Producer']],
    [3,['AFCEA International','Wounded Warrior Project','Fisher House Foundation','Greensboro Chamber of Commerce','Navy League of the United States'],['Chapter President','Program Director','Volunteer Coordinator','Executive Director | Retired Navy CAPT']],
    [3,['Self-employed','Independent Consultant','Stealth Startup'],['Founder & CEO','Independent Consultant','Owner','Freelance Writer']],
    [3,['Blue Ridge Partners LLC','Piedmont Ventures Group','Summit Peak Group','Tarheel Holdings','Carolina Gateway LLC','Ironclad Partners'],['Principal','Managing Partner','Director','Associate']],
    [2,['','Retired'],['Retired','Retired, U.S. Marine Corps','Seeking new opportunities | Navy Veteran']],
  ];
  const tw = T.reduce((a, t) => a + t[0], 0);
  const rows = []; const N = 680;
  for (let i = 0; i < N; i++){
    let x = rnd() * tw, t = T[0]; for (const tt of T){ x -= tt[0]; if (x <= 0){ t = tt; break; } }
    const c = Array.isArray(t[1]) ? pick(t[1]) : t[1];
    let p = pick(t[2]);
    if (rnd() < .06 && !/CISSP|PMP/.test(p)) p += pick([' | CISSP',' | PMP',' | Security+',' | GICSP',' | CISSP, CCSP']);
    const f = pick(FN), l = pick(LN);
    const age = Math.pow(rnd(), 1.7) * 365 * 9;
    const d = isoDay(Date.now() - age * 864e5);
    const r = {f, l, c, p, d, fs: d, u: '', e: ''};
    if (/U\.S\.|Agency|Department|Command|Administration|Corps|NAVFAC|Authority|State of|City of|County/.test(c) && rnd() < .12) r.e = `${f}.${l}`.toLowerCase() + (/Army|Navy|Marine|Air Force|Space|Coast|Guard|Defense|Cyber Command|NAVFAC|Corps of Engineers|Secretary of Defense/.test(c) ? '@mail.mil' : '@agency.gov');
    r.k = 'sample-' + i;
    rows.push(r);
  }
  rows.sort((a, b) => b.d.localeCompare(a.d));
  for (let i = 0; i < 16; i++){ rows[i]._new = true; rows[i].d = rows[i].fs = isoDay(Date.now() - (i % 6) * 864e5); }
  for (let i = 40; i < 400; i += 33){ const r = rows[i]; r.pv = [{c: pick(['Leidos','Booz Allen Hamilton','U.S. Army','Duke Energy','Fortinet','SAIC']), p: pick(['Program Manager','Senior Engineer','Account Executive','Cyber Analyst']), until: isoDay(Date.now() - (i % 5 + 1) * 864e5)}]; r.jc = r.pv[0].until; }
  // pretend message history so the relationship features have something to show
  for (const r of rows){
    if (rnd() > 0.46) continue;
    const m = Math.ceil(Math.pow(rnd(), 2.2) * 40), span = Math.pow(rnd(), 1.4) * 900, f = isoDay(Date.now() - (span + 30 + rnd() * 400) * 864e5);
    const t = isoDay(Date.now() - span * 864e5), o = Math.round(m * (0.3 + rnd() * 0.5));
    r.rx = {m, o, i: m - o, f, t, dir: rnd() < 0.45 ? 'i' : 'o', s: pick(['Thanks for the intro, let’s find time next week.', 'Great seeing you at TechNet. Sending the deck now.', 'Congrats on the new role!', 'Are you going to be at the AFCEA chapter lunch?', 'Following up on our call about the pilot.', 'Appreciate it. Talk soon.'])};
    if (rnd() < 0.15) r.rx.eg = 1; if (rnd() < 0.12) r.rx.er = 1; if (rnd() < 0.3) r.rx.inv = rnd() < 0.6 ? 'o' : 'i';
  }
  // a few demo notes
  const edits = {'sample-3': {star: true, tags: ['warm intro'], note: 'Example note: met at a trade show; follow up on the pilot.'}, 'sample-9': {star: true}};
  const imports = []; let tot = N - 120;
  for (let w = 9; w >= 0; w--){ const add = Math.round(8 + rnd() * 18); tot += add; imports.push({d: isoDay(Date.now() - (w * 7 + 3) * 864e5), total: Math.min(tot, N), added: add, changed: Math.round(rnd() * 6), removed: Math.round(rnd() * 2)}); }
  imports[imports.length - 1].total = N; imports[imports.length - 1].added = 16;
  const meta = {lastImport: imports[imports.length - 1].d, imports};
  return {rows, edits, meta};
}

