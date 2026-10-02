import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import JSZip from 'jszip';
const CloudStore = registerPlugin('CloudStore');
const NATIVE = Capacitor.isNativePlatform();
const PLATFORM = Capacitor.getPlatform();

(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n || 0).toLocaleString('en-US');
const isoDay = d => { const z = new Date(d); return z.getFullYear() + '-' + String(z.getMonth()+1).padStart(2,'0') + '-' + String(z.getDate()).padStart(2,'0'); };
const TODAY = isoDay(new Date());
const daysAgo = s => s ? (Date.now() - new Date(s + 'T12:00:00').getTime()) / 864e5 : Infinity;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const niceDate = s => { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${+d} ${MON[+m-1]} ${y}`; };
function hash(str){ let h = 2166136261; for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const h01 = (s, salt) => (hash(salt + s) % 100000) / 100000;

/* ---------- taxonomy ---------- */
const SEGS = [
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
const SEGI = Object.fromEntries(SEGS.map((s,i)=>[s.id,i]));
const COMMERCIAL = new Set(['Gov & Defense Contractors','Utilities & Energy','OT/ICS & Cyber Vendors','Channel & Integrators','Labs & Academia','Recruiting & Staffing','Other Commercial']);
const BRANCHES = ['Marine Corps','Army','Navy','Air Force','Space Force','Coast Guard','National Guard','Joint / DoD'];
const STATUSES = ['Serving','Reserve / Guard','DoD Civilian','Veteran / Retired'];
const TIERS = [
  ['Flag / General','O-7 to O-10'],['Field grade','O-4 to O-6'],['Company grade','O-1 to O-3'],['Warrant','W-1 to W-5'],
  ['Senior enlisted','E-7 to E-9'],['Enlisted / NCO','E-1 to E-6'],['SES','Senior Executive Service'],['GS-13 to 15','incl. NH-03/04'],['GS-12 & below',''],['Rank not stated','']
];
const SENIORITY = ['C-suite / Owner','VP','Director / Head','Manager / Lead','Individual contributor'];
const FUNCS = ['Acquisition & Contracting','Cybersecurity','Sales & BD','Program Management','Engineering & Technical','IT & Infrastructure','Policy & Compliance','Operations & Logistics','Marketing & Comms','Recruiting & HR','Finance & Legal','Consulting & Advisory','Executive Leadership','Military Operations','Other / Unspecified'];
const SINCE = [['','Any time'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['365','Last 12 months'],['o1','Over 1 year ago'],['o5','Over 5 years ago']];
const SIGNALS = [['new','New since last refresh'],['jc','Job change detected'],['star','Starred'],['notes','Has tags or notes'],['email','Has email'],['gov','.gov / .mil email'],['clr','Clearance mentioned']];

const BRANCH_RX = [
  ['National Guard', [/\b(National Guard|Air National Guard|Army National Guard)\b/i, /\b(ARNG|NGB|ANG)\b/]],
  ['Marine Corps', [/\b(Marine Corps|U\.?\s?S\.? Marines|Marines|Marine Aircraft|Marine Forces|MARFOR[A-Z]*|MARCORSYSCOM|MARSOC|MARCENT|HMX-1|Camp Lejeune|Cherry Point|(?:former|ex-|retired) Marine|Marine veteran)\b/i, /\b(USMC|USMCR|MCAS|MCSC|I{1,3} MEF|MEF)\b/]],
  ['Space Force', [/\b(Space Force|Space Systems Command)\b/i, /\b(USSF|SSC)\b/]],
  ['Coast Guard', [/\bCoast Guard\b/i, /\bUSCG\b/]],
  ['Air Force', [/\b(Air Force|AFB)\b/i, /\b(USAF|AFRL|AFLCMC|AFCEC|AFCYBER|AFMC|AFGSC|AFSOC|AFRC)\b/]],
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
  {re:/\b(SGM|CSM)\b/, r:'Sergeant Major', g:'E-9', req:1},
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
function gradeTier(g){
  if (!g) return 'Rank not stated';
  if (g === 'SES') return 'SES';
  const [k, n] = [g[0], parseInt(g.split('-').pop(), 10)];
  if (k === 'O') return n >= 7 ? 'Flag / General' : n >= 4 ? 'Field grade' : 'Company grade';
  if (k === 'W') return 'Warrant';
  if (k === 'E') return n >= 7 ? 'Senior enlisted' : 'Enlisted / NCO';
  if (g.startsWith('GS') || g.startsWith('NH')) { if (g.startsWith('NH')) return n >= 3 ? 'GS-13 to 15' : 'GS-12 & below'; return n >= 13 ? 'GS-13 to 15' : 'GS-12 & below'; }
  return 'Rank not stated';
}
function gradeNum(g){
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
const GRADE_OPTS = ['O-10','O-9','O-8','O-7','O-6','O-5','O-4','O-3','O-2','O-1','W-5','W-4','W-3','W-2','W-1','E-9','E-8','E-7','E-6','E-5','E-4','E-3','E-2','E-1','SES','GS-15','GS-14','GS-13','GS-12','GS-11','GS-9','GS-7'];

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
  ['SOCOM','DoD & Military',/\b(USSOCOM|SOCOM|MARSOC)\b/],['Combatant Command','DoD & Military',/\b(INDOPACOM|EUCOM|CENTCOM|NORTHCOM|NORAD|SOUTHCOM|AFRICOM|TRANSCOM|STRATCOM|SPACECOM)\b/],
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
  ['Treasury / IRS','Federal Civilian',/\b(Department of the Treasury|U\.?S\.? Treasury|IRS)\b/],
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
  ['C-suite / Owner', /\b(chief(?! (?:warrant|petty|master|of staff|engineer\b|of))|ceo|cto|cio|ciso|coo|cfo|cro|cmo|cso|president|founder|co-founder|owner|managing partner|managing director|executive director)\b/i],
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
const CERTS = [['CISSP',/\bCISSP\b/],['CISM',/\bCISM\b/],['CCSP',/\bCCSP\b/],['GICSP',/\bGICSP\b/],['GRID / GCIP',/\b(GRID|GCIP)\b/],['PMP',/\bPMP\b/],['Security+',/Security\+|Sec\+/],['CEH',/\bCEH\b/],['CASP+',/\bCASP\+?/],['OSCP',/\bOSCP\b/],['CMMC',/\bCMMC[- ]?(RP|RPA|CCP|CCA|LTP)?\b/],['ISA/IEC 62443',/\b62443\b/],['PE',/,\s*P\.?E\.?\b/],['ITIL',/\bITIL\b/]];
const CLR_RX = /\b(TS\/SCI|TS-SCI|Top Secret|Secret Clearance|Active Secret|Q Clearance|DOE Q|Polygraph|CI Poly|FS Poly|Cleared)\b/i;

function classify(r, ed){
  ed = ed || {};
  const name = `${r.f||''} ${r.l||''}`, pos = r.p || '', co = r.c || '';
  const np = `${name} | ${pos}`, all = `${np} | ${co}`;
  let branch = '';
  for (const [b, rxs] of BRANCH_RX) if (rxs.some(x => x.test(all))) { branch = b; break; }
  const vet = VET_RX.test(np);
  let rank = '', grade = '';
  for (const R of RANKS){
    if (R.req && !branch) continue;
    const m = np.match(R.re); if (!m) continue;
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
    else status = 'DoD Civilian';
  } else if (vet) status = 'Veteran / Retired';
  if (!seg) {
    if (branch) seg = 'DoD & Military';
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
  return {seg, branch, status, rank, grade, tier, gn, sen, func, agency, certs, clr, lv, vet: status === 'Veteran / Retired'};
}

/* ---------- state ---------- */
const S = {all: [], edits: {}, meta: null, mode: 'sample', tab: 'map', sort: 'new', shown: 100, sel: null, readOnly: false, pending: null, syncNote: ''};
const F = {q:'', seg:new Set, branch:new Set, status:new Set, tier:new Set, sen:new Set, func:new Set, cert:new Set, sig:new Set, agency:'', company:'', since:'', removed:false};

function keyOf(r){
  const m = (r.u || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (m){ let k; try { k = decodeURIComponent(m[1]); } catch { k = m[1]; } k = k.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180); if (k && k !== '.' && k !== '..') return k; }
  return 'n_' + hash(`${r.f}|${r.l}|${r.c}`.toLowerCase()).toString(36);
}
function hydrate(rows){
  const imp = (S.meta && S.meta.n) || 0;
  S.all = rows.map(r => {
    const k = r.k || keyOf(r);
    const ed = S.edits[k];
    const cl = classify(r, ed);
    const isNew = S.mode === 'sample' ? !!r._new : (imp > 1 && r.fi === imp);
    const hay = [r.f, r.l, r.p, r.c, cl.agency, cl.rank, cl.grade, cl.branch, ed && ed.note, ed && (ed.tags || []).join(' ')].join(' ').toLowerCase();
    return Object.assign({}, r, {k, cl, ed: ed || null, isNew, hay});
  });
}

/* ---------- filtering ---------- */
function sinceOk(r){
  if (!F.since) return true;
  const d = daysAgo(r.d);
  if (F.since === 'o1') return d > 365;
  if (F.since === 'o5') return d > 365 * 5;
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
  }
  return true;
}
function match(r, skip){
  if (!F.removed && r.x) return false;
  const c = r.cl;
  if (skip !== 'seg' && F.seg.size && !F.seg.has(c.seg)) return false;
  if (skip !== 'branch' && F.branch.size && !F.branch.has(c.branch)) return false;
  if (skip !== 'status' && F.status.size && !F.status.has(c.status)) return false;
  if (skip !== 'tier' && F.tier.size && !F.tier.has(c.tier)) return false;
  if (skip !== 'sen' && F.sen.size && !F.sen.has(c.sen)) return false;
  if (skip !== 'func' && F.func.size && !F.func.has(c.func)) return false;
  if (skip !== 'cert' && F.cert.size && !c.certs.some(x => F.cert.has(x))) return false;
  if (skip !== 'sig' && F.sig.size) for (const s of F.sig) if (!sigOk(r, s)) return false;
  if (skip !== 'agency' && F.agency && c.agency !== F.agency) return false;
  if (skip !== 'company' && F.company && (r.c || '') !== F.company) return false;
  if (skip !== 'since' && !sinceOk(r)) return false;
  if (F.q){ for (const t of F.q.toLowerCase().split(/\s+/)) if (t && !r.hay.includes(t)) return false; }
  return true;
}
const activeCount = () => F.seg.size + F.branch.size + F.status.size + F.tier.size + F.sen.size + F.func.size + F.cert.size + F.sig.size + (F.agency?1:0) + (F.company?1:0) + (F.since?1:0) + (F.q?1:0) + (F.removed?1:0);

/* ---------- render ---------- */
let VIEW = [];
function render(){
  VIEW = S.all.filter(r => match(r));
  renderHeader(); renderKPIs(); renderFilters(); renderActive();
  if (S.tab === 'map') drawMap();
  if (S.tab === 'oob') renderOOB();
  if (S.tab === 'orgs') renderOrgs();
  if (S.tab === 'dir') renderDir();
}
function dtg(){
  const d = new Date(); const p = n => String(n).padStart(2,'0');
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${MON[d.getUTCMonth()].toUpperCase()} ${String(d.getUTCFullYear()).slice(2)}`;
}
function renderHeader(){
  const active = S.all.filter(r => !r.x).length;
  const last = S.meta && S.meta.lastImport;
  let pill = '<span class="pill mute">No import yet</span>';
  if (last){
    const age = daysAgo(last);
    const due = new Date(new Date(last + 'T12:00:00').getTime() + 7 * 864e5);
    pill = age < 7 ? `<span class="pill ok">Current · next refresh ${niceDate(isoDay(due))}</span>`
      : age < 10 ? `<span class="pill warn">Refresh due ${niceDate(isoDay(due))}</span>`
      : `<span class="pill bad">Refresh overdue · ${Math.floor(age)} days old</span>`;
  }
  const where = Store.kind === 'icloud' ? '<span class="pill ok">iCloud sync</span>' : Store.kind === 'device' ? `<span class="pill mute">${PLATFORM === 'ios' ? 'iCloud off · saved on device' : 'Saved on this device'}</span>` : '<span class="pill mute">Saved in this browser</span>';
  $('#dtg').innerHTML = `<span>DTG <b>${dtg()}</b></span><span>Strength <b>${fmt(active)}</b> connections</span><span>Last refresh <b>${last ? niceDate(last) : '—'}</b></span>${pill}${where}`;
  const b = $('#banner');
  if (S.syncNote){ b.hidden = false; b.innerHTML = `<strong>iCloud</strong><span>${esc(S.syncNote)}</span>`; }
  else if (S.mode === 'live'){ b.hidden = true; }
  else {
    b.hidden = false;
    b.innerHTML = `<strong>Sample data</strong><span>Everything below is a generated example network so you can see how it works. Import your LinkedIn Connections export to replace it with your real network.</span><button class="btn sm primary" type="button" data-act="import">Import my connections</button>`;
  }
}
function spark(vals){
  if (!vals || vals.length < 2) return '';
  const w = 120, h = 22, mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const pts = vals.map((v,i) => [i * (w - 4) / (vals.length - 1) + 2, h - 3 - (v - mn) / rg * (h - 6)]);
  const d = pts.map((p,i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const l = pts[pts.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d} L${l[0].toFixed(1)} ${h} L2 ${h}Z" fill="var(--accent)" opacity=".12"/><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.5"/><circle cx="${l[0]}" cy="${l[1]}" r="2.5" fill="var(--accent)"/></svg>`;
}
function renderKPIs(){
  const V = VIEW;
  const n = (fn) => V.reduce((a, r) => a + (fn(r) ? 1 : 0), 0);
  const hist = (S.meta && S.meta.imports || []).map(i => i.total);
  const last = S.meta && S.meta.imports && S.meta.imports[S.meta.imports.length - 1];
  const tiles = [
    {lab:'In view', val:V.length, sub: activeCount() ? `of ${fmt(S.all.filter(r=>!r.x).length)} total` : 'whole network', extra: spark(hist), act:'clear'},
    {lab:'DoD & Military', val:n(r => r.cl.seg === 'DoD & Military'), sub:'uniformed, civilians, commands', act:'seg:DoD & Military', on: F.seg.size === 1 && F.seg.has('DoD & Military')},
    {lab:'Veterans', val:n(r => r.cl.status === 'Veteran / Retired'), sub:'veteran or retired, any employer', act:'status:Veteran / Retired', on: F.status.size === 1 && F.status.has('Veteran / Retired')},
    {lab:'Federal civilian', val:n(r => r.cl.seg === 'Federal Civilian'), sub:'non-DoD agencies', act:'seg:Federal Civilian', on: F.seg.size === 1 && F.seg.has('Federal Civilian')},
    {lab:'New this refresh', val:n(r => r.isNew), sub: last ? `${fmt(last.added)} added ${niceDate(last.d)}` : 'since last import', act:'sig:new', on: F.sig.has('new')},
    {lab:'Job changes', val:n(r => !!r.jc), sub:'moved company or title', act:'sig:jc', on: F.sig.has('jc')},
  ];
  $('#kpis').innerHTML = tiles.map(t => `<button class="kpi${t.on ? ' on' : ''}" type="button" data-kpi="${esc(t.act)}"><span class="lab">${t.lab}</span><span class="val">${fmt(t.val)}</span><span class="sub">${esc(t.sub)}</span>${t.extra || ''}</button>`).join('');
}
function facet(group, values, getter, opts = {}){
  const counts = new Map();
  for (const r of S.all){ if (!match(r, group)) continue; const v = getter(r); if (Array.isArray(v)) v.forEach(x => counts.set(x, (counts.get(x) || 0) + 1)); else if (v) counts.set(v, (counts.get(v) || 0) + 1); }
  const set = F[group];
  const list = (values || [...counts.keys()].sort((a,b) => counts.get(b) - counts.get(a))).filter(v => opts.keepZero || counts.get(v) || set.has(v));
  if (!list.length) return '<span class="status">None in this view</span>';
  return `<div class="chips">${list.map(v => {
    const c = counts.get(v) || 0; const seg = group === 'seg' ? SEGS[SEGI[v]] : null;
    return `<button type="button" class="chip${set.has(v) ? ' on' : ''}${c ? '' : ' zero'}" data-g="${group}" data-v="${esc(v)}">${seg ? `<span class="sw" style="background:var(${seg.c})"></span>` : ''}${esc(opts.label ? opts.label(v) : v)}<span class="n">${fmt(c)}</span></button>`;
  }).join('')}</div>`;
}
function selectOpts(group, getter, current, allLabel){
  const counts = new Map();
  for (const r of S.all){ if (!match(r, group)) continue; const v = getter(r); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
  const keys = [...counts.keys()].sort((a,b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  if (current && !counts.has(current)) keys.unshift(current);
  return `<option value="">${allLabel}</option>` + keys.map(k => `<option value="${esc(k)}"${k === current ? ' selected' : ''}>${esc(k)} (${fmt(counts.get(k) || 0)})</option>`).join('');
}
function renderFilters(){
  const sigCounts = {};
  for (const r of S.all){ if (!match(r, 'sig')) continue; for (const [s] of SIGNALS) if (sigOk(r, s)) sigCounts[s] = (sigCounts[s] || 0) + 1; }
  const html = `
    <div class="fgroup"><div class="gl">Segment</div>${facet('seg', SEGS.map(s => s.id), r => r.cl.seg)}</div>
    <div class="fgroup"><div class="gl">Military branch</div>${facet('branch', BRANCHES, r => r.cl.branch)}</div>
    <div class="fgroup"><div class="gl">Service status</div>${facet('status', STATUSES, r => r.cl.status)}</div>
    <div class="fgroup"><div class="gl">Rank / grade tier</div>${facet('tier', TIERS.map(t => t[0]), r => r.cl.tier)}</div>
    <div class="fgroup"><div class="gl"><label for="fAgency">Agency / command</label></div><select class="fs" id="fAgency">${selectOpts('agency', r => r.cl.agency, F.agency, 'All agencies and commands')}</select></div>
    <div class="fgroup"><div class="gl"><label for="fCompany">Company</label></div><select class="fs" id="fCompany">${selectOpts('company', r => r.c, F.company, 'All companies')}</select></div>
    <div class="fgroup"><div class="gl">Seniority</div>${facet('sen', SENIORITY, r => r.cl.sen)}</div>
    <div class="fgroup"><div class="gl">Function</div>${facet('func', FUNCS, r => r.cl.func)}</div>
    <div class="fgroup"><div class="gl">Certifications in profile</div>${facet('cert', CERTS.map(c => c[0]), r => r.cl.certs)}</div>
    <div class="fgroup"><div class="gl"><label for="fSince">Connected</label></div><select class="fs" id="fSince">${SINCE.map(([v,l]) => `<option value="${v}"${F.since === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="fgroup"><div class="gl">Signals</div><div class="chips">${SIGNALS.map(([v,l]) => `<button type="button" class="chip${F.sig.has(v) ? ' on' : ''}${sigCounts[v] ? '' : ' zero'}" data-g="sig" data-v="${v}">${l}<span class="n">${fmt(sigCounts[v] || 0)}</span></button>`).join('')}</div></div>
    <label class="toggle"><input type="checkbox" id="fRemoved"${F.removed ? ' checked' : ''}> Include people no longer in your export</label>`;
  $('#fbody').innerHTML = html;
  const n = activeCount();
  $('#btnFold').textContent = $('#filters').classList.contains('collapsed') ? `Show${n ? ` (${n})` : ''}` : 'Hide';
}
function renderActive(){
  const parts = [];
  if (F.q) parts.push(['q', '', `“${F.q}”`]);
  for (const g of ['seg','branch','status','tier','sen','func','cert']) for (const v of F[g]) parts.push([g, v, v]);
  for (const v of F.sig) parts.push(['sig', v, (SIGNALS.find(s => s[0] === v) || [, v])[1]]);
  if (F.agency) parts.push(['agency', '', F.agency]);
  if (F.company) parts.push(['company', '', F.company]);
  if (F.since) parts.push(['since', '', SINCE.find(s => s[0] === F.since)[1]]);
  if (F.removed) parts.push(['removed', '', 'Including removed']);
  $('#active').innerHTML = parts.length ? `<span>${fmt(VIEW.length)} match</span>` + parts.map(([g, v, l]) => `<button type="button" class="achip" data-rm="${g}" data-v="${esc(v)}" aria-label="Remove filter ${esc(l)}">${esc(l)} <span aria-hidden="true">×</span></button>`).join('') : '';
}

/* ---------- map ---------- */
let PTS = [], WEDGES = [], MAPGEO = null;
function tok(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }
function drawMap(){
  const wrap = $('#mapWrap'), cv = $('#map');
  const W = Math.max(280, wrap.clientWidth - 16);
  const H = W < 560 ? W : Math.round(Math.min(Math.max(W * .7, 420), 760));
  const dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const ink = tok('--ink'), ink2 = tok('--ink-2'), ink3 = tok('--ink-3'), line = tok('--line'), acc = tok('--accent'), panel = tok('--panel');
  const base = S.all.filter(r => F.removed || !r.x);
  const inView = new Set(VIEW.map(r => r.k));
  const counts = SEGS.map(s => base.filter(r => r.cl.seg === s.id).length);
  const present = SEGS.map((s, i) => ({s, i, n: counts[i]})).filter(x => x.n);
  const narrow = W < 560;
  const cx = W / 2, cy = H / 2, R = narrow ? Math.min(W, H) / 2 - 12 : Math.min(H / 2 - 44, W / 2 - 190);
  MAPGEO = {cx, cy, R};
  const wts = present.map(p => Math.max(Math.pow(p.n, .55), 2));
  const tw = wts.reduce((a, b) => a + b, 0) || 1;
  const gap = .018;
  let a = -Math.PI / 2;
  WEDGES = present.map((p, j) => { const span = wts[j] / tw * Math.PI * 2; const w = {seg: p.s.id, i: p.i, a0: a, a1: a + span, n: p.n}; a += span; return w; });
  const rad = [.14, .36, .57, .78, 1].map(x => x * R);
  // rings
  ctx.lineWidth = 1;
  for (let i = 1; i < rad.length; i++){ ctx.beginPath(); ctx.setLineDash(i === rad.length - 1 ? [] : [3, 4]); ctx.strokeStyle = i === rad.length - 1 ? ink3 : line; ctx.arc(cx, cy, rad[i], 0, Math.PI * 2); ctx.stroke(); }
  ctx.setLineDash([]);
  // tick marks on outer ring (compass rose detail)
  ctx.strokeStyle = ink3;
  for (let d = 0; d < 360; d += 5){ const t = d * Math.PI / 180, len = d % 30 === 0 ? 8 : 3; ctx.beginPath(); ctx.moveTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); ctx.lineTo(cx + Math.cos(t) * (R - len), cy + Math.sin(t) * (R - len)); ctx.stroke(); }
  // wedge separators
  ctx.strokeStyle = line;
  for (const w of WEDGES){ ctx.beginPath(); ctx.moveTo(cx + Math.cos(w.a0) * rad[0], cy + Math.sin(w.a0) * rad[0]); ctx.lineTo(cx + Math.cos(w.a0) * R, cy + Math.sin(w.a0) * R); ctx.stroke(); }
  // ring numbers
  ctx.fillStyle = ink3; ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++){ const rr = (rad[i] + rad[i + 1]) / 2; ctx.fillText(String(i + 1), cx + 4, cy - rr); }
  // dots
  PTS = [];
  const big = base.length > 2500;
  const dotR = big ? 1.6 : base.length > 900 ? 2.2 : 2.8;
  const colors = SEGS.map(s => tok(s.c));
  const wByI = new Map(WEDGES.map(w => [w.i, w]));
  const faint = [], lit = [];
  for (const r of base){
    const w = wByI.get(SEGI[r.cl.seg]); if (!w) continue;
    const span = w.a1 - w.a0, pad = Math.min(gap, span * .15);
    const t = w.a0 + pad + h01(r.k, 'a') * (span - 2 * pad);
    const band = Math.min(Math.max(r.cl.lv, 1), 4) - 1;
    const rr = rad[band] + (.1 + .8 * h01(r.k, 'r')) * (rad[band + 1] - rad[band]);
    const p = {x: cx + Math.cos(t) * rr, y: cy + Math.sin(t) * rr, r, c: colors[SEGI[r.cl.seg]], on: inView.has(r.k)};
    PTS.push(p); (p.on ? lit : faint).push(p);
  }
  ctx.globalAlpha = .14;
  for (const p of faint){ ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  for (const p of lit){
    ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, dotR + (p.r.isNew || p.r.jc ? .6 : 0), 0, Math.PI * 2); ctx.fill();
    if (p.r.isNew || (p.r.ed && p.r.ed.star)){ ctx.strokeStyle = acc; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, dotR + 2.6, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (S.sel){ const p = PTS.find(q => q.r.k === S.sel); if (p){ ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke(); } }
  // center
  ctx.fillStyle = panel; ctx.beginPath(); ctx.arc(cx, cy, rad[0] - 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.max(14, Math.min(22, rad[0] * .38))}px "Barlow Condensed", sans-serif`; ctx.fillText('YOU', cx, cy - 7);
  ctx.font = '500 10.5px "IBM Plex Mono", monospace'; ctx.fillStyle = ink2; ctx.fillText(fmt(VIEW.length) + ' in view', cx, cy + 10);
  // labels
  for (const w of WEDGES){
    const mid = (w.a0 + w.a1) / 2, span = w.a1 - w.a0;
    if (narrow) continue;
    const lx = cx + Math.cos(mid) * (R + 12), ly = cy + Math.sin(mid) * (R + 12);
    const right = Math.cos(mid) >= 0;
    ctx.textAlign = Math.abs(Math.cos(mid)) < .2 ? 'center' : right ? 'left' : 'right';
    ctx.textBaseline = Math.sin(mid) > .5 ? 'top' : Math.sin(mid) < -.5 ? 'bottom' : 'middle';
    const on = F.seg.has(w.seg);
    ctx.fillStyle = on ? acc : ink;
    ctx.font = `600 ${narrow ? 12 : 14}px "Barlow Condensed", sans-serif`;
    const label = (narrow ? SEGS[w.i].short : SEGS[w.i].id).toUpperCase();
    const vis = VIEW.filter(r => r.cl.seg === w.seg).length;
    ctx.fillText(label, lx, ly);
    ctx.font = '400 10.5px "IBM Plex Mono", monospace'; ctx.fillStyle = ink3;
    const off = ctx.textBaseline === 'top' ? 15 : ctx.textBaseline === 'bottom' ? -15 : 14;
    ctx.fillText(vis === w.n ? fmt(w.n) : `${fmt(vis)} / ${fmt(w.n)}`, lx, ly + off);
  }
  $('#mapMeta').textContent = `${fmt(VIEW.length)} lit · ${fmt(base.length - VIEW.length)} dimmed`;
  $('#legend').innerHTML = SEGS.map((s, i) => counts[i] ? `<button type="button" class="${F.seg.size && !F.seg.has(s.id) ? 'off' : ''}" data-g="seg" data-v="${esc(s.id)}"><span class="sw" style="background:var(${s.c})"></span>${esc(s.id)} <span class="n">${fmt(counts[i])}</span></button>` : '').join('');
}
function nearest(ev){
  const rc = $('#map').getBoundingClientRect();
  const x = ev.clientX - rc.left, y = ev.clientY - rc.top;
  let best = null, bd = 64;
  for (const p of PTS){ if (!p.on) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd){ bd = d; best = p; } }
  return {best, x, y};
}
function wedgeAt(x, y){
  if (!MAPGEO) return null;
  const dx = x - MAPGEO.cx, dy = y - MAPGEO.cy, d = Math.hypot(dx, dy);
  if (d < MAPGEO.R * .97) return null;
  let t = Math.atan2(dy, dx); if (t < -Math.PI / 2) t += Math.PI * 2;
  return WEDGES.find(w => t >= w.a0 && t < w.a1) || null;
}

/* ---------- branch & rank ---------- */
function renderOOB(){
  const rows = TIERS.map(t => t[0]);
  const base = S.all.filter(r => match(r, 'branch') && match(r, 'tier') && r.cl.branch);
  const m = {}; let max = 0;
  for (const r of base){ const k = r.cl.tier + '|' + r.cl.branch; m[k] = (m[k] || 0) + 1; max = Math.max(max, m[k]); }
  const colT = b => base.filter(r => r.cl.branch === b).length;
  const head = `<thead><tr><th scope="col" style="text-align:left;padding-left:12px">Tier</th>${BRANCHES.map(b => `<th scope="col">${esc(b)}</th>`).join('')}<th scope="col">Total</th></tr></thead>`;
  const body = rows.map((t, i) => {
    const tot = base.filter(r => r.cl.tier === t).length;
    const sep = t === 'SES' || t === 'Rank not stated' ? ' class="sep"' : '';
    return `<tr${sep}><th scope="row">${esc(t)}<span class="g">${esc(TIERS[i][1])}</span></th>${BRANCHES.map(b => { const n = m[t + '|' + b] || 0; const a = n ? Math.round(8 + 62 * Math.sqrt(n / max)) : 0; return `<td><button type="button" class="${n ? '' : 'z'}" style="--a:${a}" data-cell="${esc(t)}|${esc(b)}" aria-label="${esc(t)}, ${esc(b)}: ${n}">${n || '·'}</button></td>`; }).join('')}<td class="tot">${fmt(tot)}</td></tr>`;
  }).join('');
  const foot = `<tr class="sep"><th scope="row">Total</th>${BRANCHES.map(b => `<td class="tot">${fmt(colT(b))}</td>`).join('')}<td class="tot">${fmt(base.length)}</td></tr>`;
  $('#oob').innerHTML = `<table class="oob">${head}<tbody>${body}${foot}</tbody></table>`;
  const st = {}; base.forEach(r => st[r.cl.status || 'Unstated'] = (st[r.cl.status || 'Unstated'] || 0) + 1);
  $('#oobMeta').textContent = Object.entries(st).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ') || 'No service ties in this view';
}

/* ---------- orgs ---------- */
function bars(el, entries, attr, colorFn){
  if (!entries.length){ el.innerHTML = '<li class="empty">Nothing in this view</li>'; return; }
  const max = entries[0][1];
  el.innerHTML = entries.map(([k, n]) => `<li><button type="button" data-${attr}="${esc(k)}"><span class="nm">${esc(k)}</span><span class="ct">${fmt(n)}</span><span class="tr"><i style="width:${(n / max * 100).toFixed(1)}%;background:${colorFn(k)}"></i></span></button></li>`).join('');
}
function renderOrgs(){
  const co = new Map(), coSeg = {}, ag = new Map(), agSeg = {};
  for (const r of VIEW){
    if (r.c){ co.set(r.c, (co.get(r.c) || 0) + 1); coSeg[r.c] = r.cl.seg; }
    if (r.cl.agency){ ag.set(r.cl.agency, (ag.get(r.cl.agency) || 0) + 1); agSeg[r.cl.agency] = r.cl.seg; }
  }
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25);
  bars($('#coList'), top(co), 'company', k => `var(${SEGS[SEGI[coSeg[k]]].c})`);
  bars($('#agList'), top(ag), 'agency', k => `var(${SEGS[SEGI[agSeg[k]] ?? 0].c})`);
}

/* ---------- directory ---------- */
function sorted(){
  const v = VIEW.slice();
  const s = S.sort;
  const by = {
    new: (a, b) => (b.d || '').localeCompare(a.d || ''),
    old: (a, b) => (a.d || '9').localeCompare(b.d || '9'),
    name: (a, b) => (a.l || '').localeCompare(b.l || '') || (a.f || '').localeCompare(b.f || ''),
    company: (a, b) => (a.c || '~').localeCompare(b.c || '~'),
    rank: (a, b) => b.cl.gn - a.cl.gn || (a.l || '').localeCompare(b.l || ''),
    level: (a, b) => a.cl.lv - b.cl.lv || b.cl.gn - a.cl.gn,
  }[s];
  return v.sort(by);
}
function milCell(c){
  if (c.grade) return `<span class="grade">${esc(c.grade)}</span> <span class="ti">${esc(c.branch || c.status || '')}</span>`;
  if (c.branch || c.status) return `<span class="ti">${esc([c.branch, c.status].filter(Boolean).join(' · '))}</span>`;
  return `<span class="ti">${esc(c.sen)}</span>`;
}
function renderDir(){
  const list = sorted();
  $('#dirCount').textContent = `${fmt(list.length)} ${list.length === 1 ? 'person' : 'people'}`;
  if (!list.length){ $('#dir').innerHTML = '<div class="empty">No one matches these filters. Remove a filter above or clear them all.</div>'; return; }
  const rows = list.slice(0, S.shown).map(r => {
    const c = r.cl, seg = SEGS[SEGI[c.seg]];
    const fl = (r.isNew ? '<span class="flag new">New</span>' : '') + (r.jc ? '<span class="flag jc">Moved</span>' : '') + (r.x ? '<span class="flag rm">Removed</span>' : '');
    return `<button type="button" class="drow" data-open="${esc(r.k)}">
      <span class="st" aria-label="${r.ed && r.ed.star ? 'Starred' : ''}">${r.ed && r.ed.star ? '★' : ''}</span>
      <span style="min-width:0"><div class="nm">${esc(r.f)} ${esc(r.l)}${fl}</div><div class="ti">${esc(r.p || '—')}</div></span>
      <span class="co c-co">${esc(r.c || '—')}${c.agency && c.agency !== r.c ? `<div class="ti">${esc(c.agency)}</div>` : ''}</span>
      <span class="c-seg"><span class="tag"><span class="sw" style="background:var(${seg.c})"></span>${esc(c.seg)}</span><div class="ti">${esc(c.func)}</div></span>
      <span class="c-mil" style="min-width:0">${milCell(c)}</span>
      <span class="dt">${r.d ? niceDate(r.d) : '—'}</span>
    </button>`;
  }).join('');
  $('#dir').innerHTML = `<div class="drow head"><span></span><span>Name &amp; title</span><span>Company</span><span>Segment &amp; function</span><span>Rank / status</span><span style="text-align:right">Connected</span></div>${rows}${list.length > S.shown ? `<div class="more"><button class="btn" type="button" data-act="more">Show ${fmt(Math.min(100, list.length - S.shown))} more of ${fmt(list.length - S.shown)}</button></div>` : ''}`;
}

/* ---------- drawer ---------- */
function openDrawer(k){
  const r = S.all.find(x => x.k === k); if (!r) return;
  S.sel = k;
  const c = r.cl, ed = r.ed || {};
  const opt = (vals, cur, auto) => `<option value="">${auto}</option>` + vals.map(v => { const [val, lab] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}"${cur === val ? ' selected' : ''}>${esc(lab)}</option>`; }).join('');
  const link = S.mode === 'sample' ? '<span class="status">Sample record, no profile link</span>' : (r.u ? `<a href="${esc(r.u)}" target="_blank" rel="noopener" data-ext>Open LinkedIn profile ↗</a>` : '—');
  const hist = (r.pv || []).map(h => `<li><div>${esc(h.p || '—')}</div><div>${esc(h.c || '—')}</div><div class="d">until ${niceDate(h.until)}</div></li>`).join('');
  $('#drawer').innerHTML = `
    <div class="row" style="justify-content:space-between"><span class="eyebrow">${esc(c.seg)}</span><button class="btn sm ghost" type="button" data-act="close">Close</button></div>
    <div><h2>${esc(r.f)} ${esc(r.l)}</h2><div class="pos">${esc(r.p || '—')}</div><div>${esc(r.c || '')}</div></div>
    <div class="row">${link}${r.e ? `<span class="status">${esc(r.e)}</span><button class="btn sm" type="button" data-copy="${esc(r.e)}">Copy email</button>` : ''}</div>
    <dl class="kv">
      <dt>Branch</dt><dd>${esc(c.branch || '—')}</dd>
      <dt>Status</dt><dd>${esc(c.status || '—')}</dd>
      <dt>Rank</dt><dd>${c.grade ? `${esc(c.rank)} <span class="grade">${esc(c.grade)}</span>` : '—'}</dd>
      <dt>Tier</dt><dd>${esc(c.tier || '—')}</dd>
      <dt>Agency / cmd</dt><dd>${esc(c.agency || '—')}</dd>
      <dt>Seniority</dt><dd>${esc(c.sen)}</dd>
      <dt>Function</dt><dd>${esc(c.func)}</dd>
      <dt>Certs</dt><dd>${esc(c.certs.join(', ') || '—')}${c.clr ? ' · clearance mentioned' : ''}</dd>
      <dt>Connected</dt><dd>${niceDate(r.d)}</dd>
      <dt>First seen</dt><dd>${niceDate(r.fs)}${r.x ? ` · not in export since ${niceDate(r.x)}` : ''}</dd>
    </dl>
    ${hist ? `<h3 class="sect">Job history seen in your exports</h3><ul class="hist">${hist}</ul>` : ''}
    <h3 class="sect">Your corrections &amp; notes</h3>
    <form class="form" id="edForm">
      <label>Segment<select id="eSeg">${opt(SEGS.map(s => s.id), ed.seg || '', 'Auto: ' + c.seg)}</select></label>
      <label>Branch<select id="eBranch">${opt([...BRANCHES, ['__none', 'None']], ed.branch || '', 'Auto')}</select></label>
      <label>Status<select id="eStatus">${opt([...STATUSES, ['__none', 'None']], ed.status || '', 'Auto')}</select></label>
      <label>Grade<select id="eGrade">${opt([...GRADE_OPTS, ['__none', 'None']], ed.grade || '', 'Auto')}</select></label>
      <label class="full">Rank title<input id="eRank" type="text" value="${esc(ed.rank || '')}" placeholder="${esc(c.rank || 'e.g. Colonel, USMC (Ret.)')}"></label>
      <label class="full">Tags, comma separated<input id="eTags" type="text" value="${esc((ed.tags || []).join(', '))}" placeholder="e.g. NAVFAC target, AFCEA Augusta, warm intro"></label>
      <label class="full">Notes<textarea id="eNote" placeholder="How you know them, last touch, next step">${esc(ed.note || '')}</textarea></label>
      <label class="toggle full" style="flex-direction:row;letter-spacing:0;text-transform:none;font:400 13px var(--f-body);color:var(--ink)"><input type="checkbox" id="eStar"${ed.star ? ' checked' : ''}> Star this connection</label>
      <div class="row full" style="grid-column:1/-1"><button class="btn primary" type="submit"${S.readOnly ? ' disabled' : ''}>Save</button><span class="status" id="edMsg">${S.mode === 'live' ? '' : 'Sample data: edits aren’t saved.'}</span></div>
    </form>`;
  $('#drawer').hidden = false; $('#scrim').hidden = false;
  if (S.tab === 'map') drawMap();
}
function closeDrawer(){ $('#drawer').hidden = true; $('#scrim').hidden = true; S.sel = null; if (S.tab === 'map') drawMap(); }
async function saveEdit(){
  const k = S.sel; if (!k) return;
  const tags = $('#eTags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  const ed = {seg: $('#eSeg').value, branch: $('#eBranch').value, status: $('#eStatus').value, grade: $('#eGrade').value, rank: $('#eRank').value.trim().slice(0, 80), tags, note: $('#eNote').value.slice(0, 4000), star: $('#eStar').checked};
  for (const f of Object.keys(ed)) if (ed[f] === '' || ed[f] === false || (Array.isArray(ed[f]) && !ed[f].length)) delete ed[f];
  const msg = $('#edMsg'); msg.textContent = 'Saving…';
  try {
    if (Object.keys(ed).length) S.edits[k] = Object.assign({updated: TODAY}, ed); else delete S.edits[k];
    if (S.mode === 'live') await saveEdits();
    const raw = S.all.map(stripRow); hydrate(raw); render(); openDrawer(k);
    $('#edMsg').textContent = S.mode === 'live' ? (Store.kind === 'icloud' ? 'Saved and syncing to iCloud' : 'Saved') : 'Sample data: not saved';
  } catch (e) {
    msg.textContent = 'Couldn’t save: ' + (e && e.message || 'unknown error') + '. Try again.';
  }
}
const stripRow = r => { const o = {}; for (const f of ['k','f','l','u','e','c','p','d','fs','fi','x','jc','pv','_new']) if (r[f] !== undefined && r[f] !== null && r[f] !== '') o[f] = r[f]; return o; };

/* ---------- import ---------- */
function parseCSV(text){
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
function parseDate(s){
  s = (s || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/);
  if (m){ const mi = MON.findIndex(x => x.toLowerCase() === m[2].toLowerCase()); if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0].slice(0, 10);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m){ const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const t = Date.parse(s); return isNaN(t) ? '' : isoDay(t);
}
function rowsFromCSV(text){
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
async function readFile(file){
  if (/\.zip$/i.test(file.name) || file.type === 'application/zip'){
    const zip = await JSZip.loadAsync(file);
    const entry = Object.values(zip.files).find(f => /(^|\/)connections\.csv$/i.test(f.name));
    if (!entry) throw new Error('No Connections.csv inside that zip. Request the export with “Connections” selected.');
    return rowsFromCSV(await entry.async('string'));
  }
  return rowsFromCSV(await file.text());
}
function mergeImport(incoming){
  const live = S.mode === 'live' || S.mode === 'local';
  const prev = live ? new Map(S.all.map(r => [r.k, stripRow(r)])) : new Map();
  const first = prev.size === 0;
  const n = (live && S.meta && S.meta.n || 0) + 1;
  const seen = new Set(); let added = 0, changed = 0, back = 0;
  const out = [];
  for (const inc of incoming){
    if (seen.has(inc.k)) continue; seen.add(inc.k);
    const o = prev.get(inc.k);
    if (!o){ out.push(Object.assign({}, inc, {fs: TODAY, fi: n})); if (!first) added++; continue; }
    const r = Object.assign({}, o, {f: inc.f, l: inc.l, u: inc.u || o.u, e: inc.e || o.e, d: inc.d || o.d});
    if (r.x){ delete r.x; back++; }
    if ((o.c || '') !== (inc.c || '') || (o.p || '') !== (inc.p || '')){
      r.pv = [{c: o.c || '', p: o.p || '', until: TODAY}, ...(o.pv || [])].slice(0, 4);
      r.jc = TODAY; changed++;
    }
    r.c = inc.c; r.p = inc.p;
    out.push(r);
  }
  let removed = 0;
  for (const [k, o] of prev) if (!seen.has(k)){ const r = Object.assign({}, o); if (!r.x){ r.x = TODAY; removed++; } out.push(r); }
  const total = out.filter(r => !r.x).length;
  const imports = (live && S.meta && S.meta.imports ? S.meta.imports.slice() : []).concat([{d: TODAY, total, added, changed, removed}]).slice(-104);
  return {rows: out, meta: {lastImport: TODAY, imports, n}, stats: {total, added: first ? total : added, changed, removed, back, first}};
}
const CHUNK = 450;
async function persist(plan){
  const rows = plan.rows.map(stripRow).map(r => { delete r._new; return r; });
  plan.meta.count = rows.length;
  plan.meta.rev = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  plan.meta.device = PLATFORM;
  $('#impMsg').textContent = Store.kind === 'icloud' ? 'Saving to iCloud…' : 'Saving…';
  await Store.write('network.json', {meta: plan.meta, rows});
  S.rev = plan.meta.rev;
}
function showImport(){
  openModal(`
    <h2>Import weekly export</h2>
    <p style="margin:0;color:var(--ink-2)">Drop the LinkedIn data export zip, or the Connections.csv inside it. New people are added, title and company moves are logged as job changes, and anyone missing from the file is kept but marked removed.</p>
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose a file to import"><b>Choose file</b><span class="status">or drop it here · .zip or .csv</span></div>
    <div id="impOut"></div>
    <div class="row"><button class="btn ghost" type="button" data-close>Cancel</button><span class="status" id="impMsg"></span></div>`);
}
async function handleFile(file){
  const out = $('#impOut'); if (!out) return;
  $('#impMsg').textContent = 'Reading ' + file.name + '…';
  try {
    const rows = await readFile(file);
    const plan = mergeImport(rows); S.pending = plan;
    const st = plan.stats;
    out.innerHTML = `<div class="diff">
      <div><div class="v">${fmt(st.total)}</div><div class="l">Connections</div></div>
      <div><div class="v">${fmt(st.added)}</div><div class="l">${st.first ? 'Loaded' : 'New'}</div></div>
      <div><div class="v">${fmt(st.changed)}</div><div class="l">Job changes</div></div>
      <div><div class="v">${fmt(st.removed)}</div><div class="l">No longer listed</div></div></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-act="commit">${'Save to my network'}</button></div>`;
    $('#impMsg').textContent = `Parsed ${fmt(rows.length)} rows from ${file.name}.`;
  } catch (e) { out.innerHTML = `<p class="err">${esc(e.message || String(e))}</p>`; $('#impMsg').textContent = ''; }
}
async function commitImport(){
  const plan = S.pending; if (!plan) return;
  const btn = document.querySelector('[data-act="commit"]'); if (btn) btn.disabled = true;
  try {
    const wasSample = S.mode === 'sample';
    await persist(plan); S.mode = 'live';
    if (wasSample){ S.edits = {}; await saveEdits(); }
    S.meta = plan.meta; hydrate(plan.rows); S.pending = null;
    closeModal(); render();
  } catch (e) {
    if (btn) btn.disabled = false;
    const why = (e && e.message) || 'Unknown error';
    $('#impMsg').innerHTML = `<span class="err">Save failed. ${esc(why)}</span>`;
  }
}
function showHelp(){
  openModal(`
    <h2>Weekly refresh</h2>
    <p style="margin:0;color:var(--ink-2)">LinkedIn doesn’t let outside apps read your connections, so the refresh runs on LinkedIn’s own export. It takes about two minutes once a week. Import on any one of your Apple devices and iCloud carries it to the others.</p>
    <ol class="steps">
      <li>On LinkedIn, open <b>Me → Settings &amp; Privacy → Data privacy → Get a copy of your data</b>.</li>
      <li>Choose <b>“Want something in particular?”</b>, tick <b>Connections</b> only, and request the archive.</li>
      <li>LinkedIn emails you when the file is ready. Download the zip.</li>
      <li>Tap <b>Import weekly export</b> and pick the zip. No need to unzip it. On iPhone or iPad you can also open the zip in Files or Mail, tap Share, and choose <b>Order of Battle</b>.</li>
    </ol>
    <p style="margin:0;color:var(--ink-2)">Each import is compared with the last one: new connections get a <span class="flag new" style="margin:0">New</span> flag, title or company moves get <span class="flag jc" style="margin:0">Moved</span>, and the header pill turns amber after seven days so you know a refresh is due.</p>
    <p style="margin:0;color:var(--ink-3);font-size:12.5px">The export only includes name, profile URL, company, title, connection date, and email when the person allows it. Branch, rank, segment and the rest are worked out from those fields, so use a profile’s “Your corrections” panel to fix anything the classifier gets wrong.</p>
    <div class="row"><button class="btn" type="button" data-close>Done</button></div>`);
}
function openModal(html){ $('#mbox').innerHTML = html; $('#modal').hidden = false; }
function closeModal(){ $('#modal').hidden = true; S.pending = null; }

/* ---------- export ---------- */
async function exportView(){
  const cols = ['First Name','Last Name','Company','Position','Segment','Agency / Command','Branch','Status','Rank','Grade','Rank Tier','Seniority','Function','Certifications','Clearance Mentioned','Connected On','First Seen','Job Change','LinkedIn URL','Email','Tags','Notes','Starred'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const lines = [cols.join(',')].concat(sorted().map(r => { const c = r.cl, e = r.ed || {}; return [r.f, r.l, r.c, r.p, c.seg, c.agency, c.branch, c.status, c.rank, c.grade, c.tier, c.sen, c.func, c.certs.join('; '), c.clr ? 'Yes' : '', r.d, r.fs, r.jc || '', S.mode === 'sample' ? '' : r.u, r.e, (e.tags || []).join('; '), e.note, e.star ? 'Yes' : ''].map(q).join(','); }));
  const name = `order-of-battle-${TODAY}.csv`;
  const csv = lines.join('\n');
  try {
    if (NATIVE){
      const w = await Filesystem.writeFile({path: name, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8});
      await Share.share({title: 'Order of Battle export', files: [w.uri], dialogTitle: 'Export connections'});
    } else {
      const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  } catch (e) {
    if (!/cancel/i.test((e && e.message) || '')) openModal(`<h2>Export failed</h2><p style="margin:0">${esc((e && e.message) || 'Unknown error')}</p><div class="row"><button class="btn" type="button" data-close>OK</button></div>`);
  }
}

/* ---------- sample network ---------- */
function sampleNetwork(){
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
    [7,['Amazon Web Services','Microsoft','Google Public Sector','Salesforce','Accenture','Self-employed','Wells Fargo','Lowe’s Companies','Volvo Group','Cone Health'],['Account Executive, Public Sector','Senior Manager','Founder & CEO','Consultant','Vice President, Operations','Customer Success Manager','Marketing Director']],
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
  // a few demo notes
  S.edits = {'sample-3': {star: true, tags: ['warm intro'], note: 'Example note: met at a trade show; follow up on the pilot.'}, 'sample-9': {star: true}};
  const imports = []; let tot = N - 120;
  for (let w = 9; w >= 0; w--){ const add = Math.round(8 + rnd() * 18); tot += add; imports.push({d: isoDay(Date.now() - (w * 7 + 3) * 864e5), total: Math.min(tot, N), added: add, changed: Math.round(rnd() * 6), removed: Math.round(rnd() * 2)}); }
  imports[imports.length - 1].total = N; imports[imports.length - 1].added = 16;
  S.meta = {lastImport: imports[imports.length - 1].d, imports};
  return rows;
}

/* ---------- storage ---------- */
const Store = {
  kind: NATIVE ? 'device' : 'browser',
  async init(){
    if (PLATFORM === 'ios'){
      try { const st = await CloudStore.status(); this.kind = st.icloud ? 'icloud' : 'device'; } catch { this.kind = 'device'; }
    }
  },
  async read(name){
    if (PLATFORM === 'ios'){
      const r = await CloudStore.read({name});
      if (r.pending) return {pending: true};
      return {data: r.data ? JSON.parse(r.data) : null};
    }
    if (NATIVE){
      try { const r = await Filesystem.readFile({path: name, directory: Directory.Data, encoding: Encoding.UTF8}); return {data: JSON.parse(r.data)}; }
      catch { return {data: null}; }
    }
    try { const v = localStorage.getItem('oob.' + name); return {data: v ? JSON.parse(v) : null}; } catch { return {data: null}; }
  },
  async write(name, obj){
    const data = JSON.stringify(obj);
    if (PLATFORM === 'ios') return CloudStore.write({name, data});
    if (NATIVE) return Filesystem.writeFile({path: name, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true});
    try { localStorage.setItem('oob.' + name, data); } catch (e) { throw new Error('This browser blocked local storage, so the data can’t be saved here.'); }
  },
};
async function saveEdits(){ await Store.write('edits.json', {edits: S.edits, rev: Date.now()}); }
let loading = false;
async function loadStore(opts = {}){
  if (loading) return; loading = true;
  try {
    const n = await Store.read('network.json');
    if (n.pending){
      S.syncNote = 'Downloading your network from iCloud. This can take a minute on a new device.';
      render(); setTimeout(() => loadStore(), 6000); return;
    }
    S.syncNote = '';
    if (!n.data || !n.data.rows){ render(); return; }
    if (opts.onlyIfChanged && n.data.meta && n.data.meta.rev === S.rev && S.mode === 'live'){
      const e = await Store.read('edits.json');
      const nextEdits = (e.data && e.data.edits) || {};
      if (JSON.stringify(nextEdits) === JSON.stringify(S.edits)) return;
      S.edits = nextEdits; hydrate(S.all.map(stripRow)); render(); return;
    }
    const e = await Store.read('edits.json');
    S.edits = (e.data && e.data.edits) || {};
    S.meta = n.data.meta || {}; S.rev = S.meta.rev; S.mode = 'live';
    hydrate(n.data.rows); render();
    if (S.sel && !$('#drawer').hidden) openDrawer(S.sel);
  } catch (err) {
    const b = $('#banner'); b.hidden = false;
    b.innerHTML = `<strong>Couldn’t load</strong><span>Your saved network didn’t load (${esc((err && err.message) || 'unknown error')}). Close and reopen the app to try again.</span>`;
  } finally { loading = false; }
}
function b64ToBytes(b64){ const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function openIncoming(url){
  if (!/\.(zip|csv)(\?|$)/i.test(url)) return;
  try {
    const r = await Filesystem.readFile({path: url});
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
    const file = new File([b64ToBytes(typeof r.data === 'string' ? r.data : '')], name, {type: /\.zip$/i.test(name) ? 'application/zip' : 'text/csv'});
    showImport(); handleFile(file);
  } catch (e) {
    showImport(); $('#impOut').innerHTML = `<p class="err">Couldn’t open that file (${esc((e && e.message) || 'unknown error')}). Use the drop area instead.</p>`;
  }
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const ext = e.target.closest('a[data-ext]');
  if (ext && NATIVE){ e.preventDefault(); Browser.open({url: ext.href}); return; }
  const t = e.target.closest('button, [data-close], .drop'); if (!t) return;
  if (t.hasAttribute('data-close')){ closeModal(); return; }
  if (t.id === 'drop'){ $('#file').click(); return; }
  const d = t.dataset;
  if (d.g){ if (d.g === 'sig' || F[d.g] instanceof Set){ const s = F[d.g]; s.has(d.v) ? s.delete(d.v) : s.add(d.v); S.shown = 100; render(); } return; }
  if (d.rm){ const g = d.rm; if (F[g] instanceof Set) F[g].delete(d.v); else if (g === 'q'){ F.q = ''; $('#q').value = ''; } else if (g === 'removed') F.removed = false; else F[g] = ''; render(); return; }
  if (d.kpi){ if (d.kpi === 'clear'){ clearAll(); return; } const [g, v] = d.kpi.split(/:(.+)/); const s = F[g]; if (s.size === 1 && s.has(v)) s.clear(); else { s.clear(); s.add(v); } render(); return; }
  if (d.cell){ const [t1, b] = d.cell.split('|'); F.tier = new Set([t1]); F.branch = new Set([b]); setTab('dir'); return; }
  if (d.company !== undefined){ F.company = F.company === d.company ? '' : d.company; setTab('dir'); return; }
  if (d.agency !== undefined){ F.agency = F.agency === d.agency ? '' : d.agency; setTab('dir'); return; }
  if (d.open){ openDrawer(d.open); return; }
  if (d.tab){ setTab(d.tab); return; }
  if (d.copy){ const v = d.copy; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => { t.textContent = 'Copied'; }).catch(() => { t.textContent = v; }); return; }
  switch (d.act){
    case 'more': S.shown += 100; renderDir(); return;
    case 'close': closeDrawer(); return;
    case 'import': showImport(); return;
    case 'commit': commitImport(); return;
  }
  if (t.id === 'btnImport') showImport();
  else if (t.id === 'btnHelp') showHelp();
  else if (t.id === 'btnExport') exportView();
  else if (t.id === 'btnClear') clearAll();
  else if (t.id === 'btnFold'){ $('#filters').classList.toggle('collapsed'); renderFilters(); }
});
function clearAll(){ for (const k of Object.keys(F)) F[k] = F[k] instanceof Set ? new Set : (k === 'removed' ? false : ''); $('#q').value = ''; S.shown = 100; render(); }
function setTab(t){ S.tab = t; S.shown = 100; document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); for (const id of ['map','oob','orgs','dir']) $('#tab-' + id).hidden = id !== t; try { localStorage.setItem('oob.tab', t); } catch {} render(); }
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fAgency'){ F.agency = t.value; render(); }
  else if (t.id === 'fCompany'){ F.company = t.value; render(); }
  else if (t.id === 'fSince'){ F.since = t.value; render(); }
  else if (t.id === 'fRemoved'){ F.removed = t.checked; render(); }
  else if (t.id === 'sort'){ S.sort = t.value; S.shown = 100; renderDir(); }
  else if (t.id === 'file' && t.files[0]){ handleFile(t.files[0]); t.value = ''; }
});
document.addEventListener('submit', e => { if (e.target.id === 'edForm'){ e.preventDefault(); saveEdit(); } });
let qt; $('#q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { F.q = e.target.value.trim(); S.shown = 100; render(); }, 140); });
document.addEventListener('keydown', e => { if (e.key === 'Escape'){ if (!$('#modal').hidden) closeModal(); else if (!$('#drawer').hidden) closeDrawer(); } if (e.key === 'Enter' && e.target.id === 'drop') $('#file').click(); });
$('#scrim').addEventListener('click', closeDrawer);
['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest('#drop'); if (d){ e.preventDefault(); d.classList.add('over'); } }));
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d){ e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); } });
// map interaction
const cv = $('#map'), tip = $('#tip');
cv.addEventListener('mousemove', e => {
  const {best, x, y} = nearest(e);
  if (!best){ tip.hidden = true; cv.style.cursor = wedgeAt(x, y) ? 'pointer' : 'crosshair'; return; }
  const r = best.r, c = r.cl;
  tip.innerHTML = `<b>${esc(r.f)} ${esc(r.l)}</b>${esc(r.p || '')}<div class="g">${esc(r.c || '')}${c.grade ? ' · ' + esc(c.grade) : ''}${c.branch ? ' · ' + esc(c.branch) : ''}</div>`;
  tip.hidden = false; cv.style.cursor = 'pointer';
  const W = $('#mapWrap').clientWidth;
  tip.style.left = Math.min(x + 22, W - 290) + 'px'; tip.style.top = (y + 14) + 'px';
});
cv.addEventListener('mouseleave', () => { tip.hidden = true; });
cv.addEventListener('click', e => {
  const {best, x, y} = nearest(e);
  if (best){ tip.hidden = true; openDrawer(best.r.k); return; }
  const w = wedgeAt(x, y); if (w){ F.seg.has(w.seg) ? F.seg.delete(w.seg) : F.seg.add(w.seg); render(); }
});
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.tab === 'map') drawMap(); }, 120); });
const reTheme = () => { if (S.tab === 'map') drawMap(); };
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reTheme); } catch {}
new MutationObserver(reTheme).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(reTheme);

/* ---------- boot ---------- */
hydrate(sampleNetwork());
let startTab = 'map'; try { startTab = localStorage.getItem('oob.tab') || 'map'; } catch {}
setTab(['map','oob','orgs','dir'].includes(startTab) ? startTab : 'map');
(async () => {
  await Store.init(); render();
  await loadStore();
  if (NATIVE){
    App.addListener('resume', () => loadStore({onlyIfChanged: true}));
    App.addListener('appUrlOpen', ({url}) => openIncoming(url));
    if (PLATFORM === 'ios'){ let t; CloudStore.addListener('changed', () => { clearTimeout(t); t = setTimeout(() => loadStore({onlyIfChanged: true}), 1500); }); }
    try { const launch = await App.getLaunchUrl(); if (launch && launch.url) openIncoming(launch.url); } catch {}
  }
})();
})();
