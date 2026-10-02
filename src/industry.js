// Industry for every contact, not just government ones.
// LinkedIn's export has no industry field, so it's inferred from the company name first,
// then the title, then the segment. Anything still unknown is "Unclassified" and can be
// tagged once per company in the app; that correction sticks across imports.

export const GOV_IND = 'Government & Military';
export const UNCLASSIFIED = 'Unclassified';

export const INDUSTRIES = [
  {id: GOV_IND, short: 'Gov & Mil', color: '#B7D25A'},
  {id: 'Defense & Gov Contracting', short: 'Defense', color: '#FFD166'},
  {id: 'Energy & Utilities', short: 'Energy', color: '#FF8A5C'},
  {id: 'Cybersecurity', short: 'Cyber', color: '#FF6FA8'},
  {id: 'Software & Cloud', short: 'Software', color: '#66A8FF'},
  {id: 'IT Services & Consulting', short: 'IT & Consulting', color: '#43D0C0'},
  {id: 'Hardware, Telecom & Networking', short: 'Telecom & HW', color: '#7FC4FF'},
  {id: 'Industrial & Manufacturing', short: 'Industrial', color: '#D8B48A'},
  {id: 'Engineering & Construction', short: 'Eng & Constr', color: '#E0A458'},
  {id: 'Financial Services', short: 'Finance', color: '#5DD39E'},
  {id: 'Insurance', short: 'Insurance', color: '#3FB98A'},
  {id: 'Healthcare & Life Sciences', short: 'Healthcare', color: '#FF7F7F'},
  {id: 'Education & Research', short: 'Education', color: '#A58BFF'},
  {id: 'Legal & Accounting', short: 'Legal & Acct', color: '#C7A6FF'},
  {id: 'Staffing & Recruiting', short: 'Staffing', color: '#8FA3BF'},
  {id: 'Transportation & Logistics', short: 'Transport', color: '#4FC3E8'},
  {id: 'Travel & Hospitality', short: 'Travel', color: '#F2C14E'},
  {id: 'Retail, Consumer & Food', short: 'Retail & Food', color: '#F28C9B'},
  {id: 'Media & Marketing', short: 'Media', color: '#E57CD8'},
  {id: 'Real Estate', short: 'Real Estate', color: '#B5C99A'},
  {id: 'Nonprofit & Associations', short: 'Nonprofit', color: '#9CCFD8'},
  {id: 'Self-Employed & Startups', short: 'Self-employed', color: '#FFB547'},
  {id: 'Retired or Between Roles', short: 'Retired', color: '#7A8BA6'},
  {id: UNCLASSIFIED, short: 'Unclassified', color: '#4A5870'},
];
export const INDI = Object.fromEntries(INDUSTRIES.map((s, i) => [s.id, i]));
export const indColor = id => (INDUSTRIES[INDI[id]] || INDUSTRIES[INDUSTRIES.length - 1]).color;
export const indShort = id => (INDUSTRIES[INDI[id]] || {short: id}).short;

const W = s => new RegExp(String.raw`(?:^|[^A-Za-z0-9])(?:${s})(?=$|[^A-Za-z0-9])`, 'i');

// Matched against the company name, in this order. Specific names come before generic words.
const COMPANY_RULES = [
  ['Self-Employed & Startups', W(String.raw`self[- ]employed|freelance\w*|independent consultant|sole proprietor|stealth(?: mode)?(?: startup)?|stealth startup`)],
  ['Retired or Between Roles', W(String.raw`retired|seeking (?:new )?opportunit\w*|open to work|in transition|career transition|between roles|unemployed`)],
  ['Staffing & Recruiting', W(String.raw`recruit\w*|staffing|talent (?:solutions|partners|acquisition)|headhunt\w*|executive search|TEKsystems|Robert Half|Insight Global|Randstad|Aerotek|Kforce|Adecco|ManpowerGroup|Manpower|Korn Ferry|Heidrick|Spencer Stuart|ClearanceJobs|Hire\w* Heroes|Orion Talent|Lucas Group|Bradley-Morris|Collabera|Apex Systems|Experis|Kelly Services`)],
  ['Engineering & Construction', W(String.raw`AECOM|Black & Veatch|Black and Veatch|Burns & McDonnell|Burns and McDonnell|Fluor|Bechtel|Kiewit|Tetra Tech|WSP|Stantec|HDR|Kimley-Horn|Michael Baker|Mott MacDonald|Arcadis|Clark Construction|Turner Construction|Skanska|Whiting-Turner|Balfour Beatty|Quanta Services|MasTec|MYR Group|Pike Electric|EMCOR|construction|builders|contracting co\w*|general contractors?|architects?|architecture|civil engineering|structural engineering|engineering (?:group|firm|services|associates)|engineers,? (?:inc|llc|pllc|pc)|electrical contractors?|mechanical contractors?|HVAC|plumbing|roofing|paving|excavat\w*|surveying|geospatial|Exodigo`)],
  ['Defense & Gov Contracting', W(String.raw`Lockheed|Raytheon|RTX|Northrop|General Dynamics|GDIT|Boeing|BAE Systems|Leidos|SAIC|Booz Allen|CACI|ManTech|Peraton|L3Harris|Huntington Ingalls|HII|Parsons|KBR|Amentum|Jacobs|Accenture Federal|Deloitte Government|Textron|Sierra Nevada|Anduril|Palantir|Shield AI|Sikorsky|Oshkosh Defense|Leonardo DRS|Mercury Systems|Telos|Unisys Federal|Maximus|V2X|Vectrus|Guidehouse|ICF|Serco|Sev1Tech|Govini|Applied Insight|Iron EagleX|Two Six|SOSi|Credence|Chugach|Akima|Arcfield|General Atomics|Elbit|Kratos|AeroVironment|Saronic|Epirus|Rebellion Defense|Vannevar|Sabre Systems|NCI Information|Perspecta|Torch Technologies|Dynetics|Cubic|Curtiss-Wright|Moog|Ultra Electronics|Collins Aerospace|Pratt & Whitney|Rolls-Royce|defen[cs]e|aerospace|federal (?:services|solutions|systems)|government (?:services|solutions)|missile|munitions|tactical`)],
  ['Cybersecurity', W(String.raw`Waterfall|Dragos|Nozomi|Claroty|Armis|Forescout|TXOne|Owl Cyber|Fortinet|Palo Alto Networks|Tenable|Rapid7|CrowdStrike|Mandiant|SentinelOne|Zscaler|Splunk|Industrial Defender|Verve Industrial|Xage|Shift5|SCADAfence|Radiflow|OTORIO|OPSWAT|Bayshore|Cylus|Check Point|Trellix|McAfee|Symantec|Proofpoint|Axonius|Tanium|Sygnia|Arctic Wolf|Darktrace|Netskope|Illumio|Veracode|Recorded Future|KnowBe4|Mimecast|Sophos|Trend Micro|Kaspersky|Imperva|Qualys|BeyondTrust|CyberArk|SailPoint|Ping Identity|Varonis|Abnormal|Wiz|Snyk|Coalfire|Schellman|Secureworks|eSentire|Expel|Red Canary|Huntress|Cyber\w*|infosec|information security|security solutions|security services|threat intel\w*`)],
  ['Software & Cloud', W(String.raw`Amazon Web Services|AWS|Microsoft|Google|Alphabet|Oracle|Salesforce|SAP|ServiceNow|Workday|Adobe|VMware|Broadcom|Snowflake|Databricks|Atlassian|Autodesk|Esri|HubSpot|Zoom|Slack|Twilio|Okta|MongoDB|Elastic|Red Hat|Intuit|OpenAI|Anthropic|Meta Platforms|Facebook|LinkedIn|Netflix|Uber|Lyft|Stripe|Shopify|Dropbox|Box\.com|DocuSign|Zendesk|Datadog|Palantir|UiPath|Bentley Systems|AVEVA|OSIsoft|Hexagon|Ansys|Dassault|PTC|Tyler Technologies|Granicus|Accela|EnerKnol|Unanet|Deltek|GovWin|SAS Institute|SAS|Epic Games|software|SaaS|cloud|analytics|data(?: |)(?:labs|systems|science)?|\w+\.ai|\w+\.io|AI|apps?|platforms?|technologies,? inc`)],
  ['IT Services & Consulting', W(String.raw`Accenture|Deloitte|PwC|PricewaterhouseCoopers|EY|Ernst & Young|KPMG|McKinsey|BCG|Boston Consulting|Bain|IBM|Capgemini|Cognizant|Infosys|Wipro|TCS|Tata Consultancy|HCL|DXC|Kyndryl|Gartner|Forrester|IDC|Carahsoft|SHI|CDW|World Wide Technology|WWT|Iron Bow|immixGroup|immix|GuidePoint|Optiv|Presidio|Insight Public Sector|Insight Enterprises|ePlus|DLT|Four Inc|Trace3|Arrow Electronics|TD SYNNEX|Ingram Micro|Merlin Cyber|August Schell|Thundercat|Sirius|Converge|Softchoice|NTT Data|Unisys|Perficient|EPAM|Slalom|Protiviti|Huron|Alvarez & Marsal|FTI Consulting|consult\w*|advisors?|advisory|managed services|systems integrat\w*|IT services|IT solutions|technology (?:partners|solutions|services|group)|solutions group`)],
  ['Hardware, Telecom & Networking', W(String.raw`Cisco|Juniper|Arista|Dell|HP|Hewlett|HPE|Intel|AMD|NVIDIA|Qualcomm|Apple|Samsung|Lenovo|NetApp|Pure Storage|Nutanix|Verizon|AT&T|T-Mobile|Sprint|Lumen|CenturyLink|Comcast|Charter|Spectrum|Frontier|Cox Communications|Windstream|Brightspeed|Ericsson|Nokia|Motorola Solutions|Motorola|Ciena|Corning|Extreme Networks|Aruba|Ubiquiti|Garmin|Texas Instruments|Micron|Western Digital|Seagate|semiconductor\w*|telecom\w*|wireless|broadband|fiber|networks,? inc|satellite`)],
  ['Energy & Utilities', W(String.raw`Duke Energy|Dominion|Southern Company|Georgia Power|Alabama Power|Exelon|Constellation|NextEra|FPL|AEP|American Electric Power|Xcel|PG&E|Edison|Entergy|FirstEnergy|PPL|Ameren|Evergy|Eversource|National Grid|ConEd|Con Edison|DTE|Consumers Energy|CenterPoint|Vistra|NRG|Tri-State|Oglethorpe|Santee Cooper|ERCOT|PJM|MISO|ISO New England|NYISO|CAISO|NERC|SERC|WECC|ElectriCities|NCEMC|ExxonMobil|Exxon|Chevron|BP|ConocoPhillips|Marathon Petroleum|Phillips 66|Valero|Halliburton|Schlumberger|SLB|Baker Hughes|Kinder Morgan|Williams Companies|Enbridge|TC Energy|Piedmont Natural Gas|Westinghouse|Framatome|Holtec|Orano|Southern Nuclear|American Water|electric\w*|power(?! BI)|energy|utilit(?:y|ies)|nuclear|oil|gas|petroleum|pipeline|midstream|solar|wind|renewabl\w*|hydro\w*|water (?:authority|utility|resources|works|district)|cooperative|EMC|transmission|grid`)],
  ['Industrial & Manufacturing', W(String.raw`Siemens|Rockwell|Schneider Electric|Honeywell|ABB|Emerson|GE Vernova|GE Aerospace|GE Healthcare|General Electric|GE|Hitachi|Yokogawa|Belden|Moxa|Caterpillar|John Deere|Deere|3M|Eaton|Parker Hannifin|Cummins|Volvo|Mack Trucks|Toyota|Honda|Ford Motor|General Motors|GM|Tesla|Stellantis|BMW|Mercedes|Nucor|Dow|DuPont|BASF|Corning|Danaher|Illinois Tool Works|Johnson Controls|Carrier|Trane|Otis|Whirlpool|Stanley Black & Decker|Ingersoll Rand|Xylem|Mitsubishi|Bosch|Hubbell|Mueller|manufactur\w*|industries|industrial|automation|machin\w*|steel|metals?|chemical\w*|plastics|fabricat\w*|automotive|motors`)],
  ['Insurance', W(String.raw`insurance|assurance|reinsurance|underwrit\w*|State Farm|Allstate|Progressive|GEICO|Nationwide|Liberty Mutual|USAA|MetLife|Prudential|Aflac|Travelers|Chubb|AIG|The Hartford|Hartford|Lincoln Financial|Northwestern Mutual|New York Life|MassMutual|Farmers Insurance|Erie Insurance|Aon|Marsh|Willis Towers Watson|WTW|Gallagher|Brown & Brown`)],
  ['Financial Services', W(String.raw`Wells Fargo|JPMorgan|J\.P\. Morgan|Chase|Bank of America|BofA|Citi|Citigroup|Citibank|Goldman Sachs|Morgan Stanley|Truist|PNC|Capital One|U\.S\. Bank|US Bank|Fidelity|Vanguard|Schwab|Charles Schwab|BlackRock|Edward Jones|Ameriprise|Raymond James|LPL Financial|Navy Federal|PenFed|State Employees Credit Union|SECU|Visa|Mastercard|American Express|PayPal|Block, Inc|Fiserv|FIS|Global Payments|Discover Financial|Ally Financial|Synchrony|First Citizens|Fifth Third|Regions Bank|KeyBank|M&T|Huntington Bank|TD Bank|bank\w*|bancorp|credit union|financial|capital|investments?|wealth|asset management|securities|equity|private equity|ventures|fund|funds|fintech|mortgage|lending|trust company|brokerage|payments`)],
  ['Healthcare & Life Sciences', W(String.raw`Pfizer|Merck|Johnson & Johnson|J&J|AbbVie|Abbott|Eli Lilly|Lilly|Bristol-Myers|BMS|Amgen|Gilead|Moderna|Novartis|Roche|GSK|GlaxoSmithKline|AstraZeneca|Sanofi|Bayer|Medtronic|Boston Scientific|Stryker|Becton|BD|Labcorp|Quest Diagnostics|IQVIA|Novant|Atrium|Cone Health|UNC Health|Duke Health|Duke University Health|WakeMed|ECU Health|Kaiser|HCA|Tenet|CommonSpirit|Ascension|Mayo Clinic|Cleveland Clinic|UnitedHealth|Optum|CVS|Walgreens|Cigna|Anthem|Elevance|Humana|Centene|Blue Cross|BCBS|Cerner|Epic Systems|McKesson|Cardinal Health|health\w*|hospital\w*|medical|medicine|clinic\w*|pharma\w*|biotech\w*|bio\w*|therapeutics|life sciences|diagnostics|dental|nursing|wellness|veterinar\w*|physicians?|surgical|rehab\w*|behavioral`)],
  ['Education & Research', W(String.raw`university|college|school|academy|institute|laborator(?:y|ies)|national lab|MITRE|RAND|EPRI|Electric Power Research|Battelle|SwRI|JHU ?APL|Applied Physics Lab|Lincoln Laboratory|Aerospace Corporation|Software Engineering Institute|education\w*|learning|tutoring|K-12|public schools|school district|research (?:center|institute|foundation)`)],
  ['Legal & Accounting', W(String.raw`law firm|law offices?|law group|legal|attorneys?|lawyers?|counsel(?:ors)? at law|LLP|PLLC|CPAs?|accounting|accountants?|tax (?:services|advisors)|bookkeeping|audit\w*|Grant Thornton|BDO|RSM|Crowe|CliftonLarsonAllen|CLA|Baker Tilly|Dixon Hughes|FORVIS|Cherry Bekaert|Womble|Kilpatrick|Nelson Mullins|K&L Gates|Smith Anderson|Holland & Knight|DLA Piper|Covington|Crowell`)],
  ['Transportation & Logistics', W(String.raw`logistics|freight|trucking|transport\w*|airlines?|airways|aviation|air lines|Delta Air|American Airlines|United Airlines|Southwest|JetBlue|Alaska Airlines|FedEx|UPS|United Parcel|DHL|Maersk|Norfolk Southern|CSX|Union Pacific|BNSF|Amtrak|railroad|railway|rail|shipping|maritime|port of|supply chain|moving company|XPO|J\.?B\.? Hunt|Old Dominion Freight|Ryder|Penske|Werner|Schneider National|C\.?H\.? Robinson|Landstar|Estes|Saia|courier|airport`)],
  ['Travel & Hospitality', W(String.raw`travel|hotels?|hospitality|resorts?|Marriott|Hilton|Hyatt|IHG|Wyndham|Choice Hotels|Best Western|Expedia|Booking\.com|Booking Holdings|Airbnb|Vrbo|cruises?|Carnival|Royal Caribbean|Norwegian Cruise|tourism|Destinara|vacations?|restaurants?|catering|dining|Disney Parks|theme parks?|golf club|country club`)],
  ['Retail, Consumer & Food', W(String.raw`retail\w*|Walmart|Target Corporation|Costco|Home Depot|Lowe.?s|Kroger|Publix|Food Lion|Harris Teeter|Amazon|Best Buy|Nike|Procter|P&G|PepsiCo|Coca-Cola|Coca Cola|Unilever|Kraft|Heinz|General Mills|Kellogg|Mars Wrigley|Nestl[eé]|Tyson|Smithfield|Cargill|ADM|Archer Daniels|Hanesbrands|VF Corporation|Ralph Lauren|Krispy Kreme|Bojangles|Cheerwine|Dollar General|Dollar Tree|Family Dollar|Sherwin-Williams|consumer|brands|apparel|stores|grocer\w*|foods?|beverages?|brewing|brewery|winery|distillery|bakery|farms?|agri\w*|e-?commerce|wholesale`)],
  ['Media & Marketing', W(String.raw`media|marketing|advertising|creative|publishing|publications?|news|broadcast\w*|television|TV|radio|studios?|entertainment|public relations|PR firm|communications group|digital agency|branding|podcast\w*|magazine|Gannett|iHeart|Sinclair|Nexstar|Warner|Paramount|NBCUniversal|Fox|CNN|Omnicom|WPP|Publicis|Interpublic`)],
  ['Real Estate', W(String.raw`real estate|realty|realtors?|properties|property management|homes|home builders?|Keller Williams|RE/MAX|Coldwell Banker|Century 21|Berkshire Hathaway HomeServices|eXp Realty|Compass Real Estate|CBRE|JLL|Cushman|Colliers|Lennar|D\.?R\.? Horton|Pulte|NVR|Toll Brothers|apartments|communities|land company|HOA|homeowners association`)],
  ['Nonprofit & Associations', W(String.raw`foundation|non-?profit|association|society|council|church|ministr(?:y|ies)|charit\w*|Red Cross|USO|Wounded Warrior|VFW|American Legion|Fisher House|Habitat for Humanity|United Way|Salvation Army|YMCA|Boy Scouts|Girl Scouts|AFCEA|NDIA|AUSA|Navy League|Marine Corps Association|MOAA|ISA|ISC2|ISACA|InfraGard|Chamber of Commerce|Rotary|Kiwanis|Lions Club|fellowship|alliance for|coalition|institute for|volunteer\w*`)],
];

// Fallbacks from the title when the company didn't say enough.
const TITLE_RULES = [
  ['Retired or Between Roles', /\b(retired|seeking (?:new )?(?:opportunit\w*|role\w*|position\w*)|open to (?:work|new)|in transition|transitioning|between roles|job seeker|looking for)\b/i],
  ['Self-Employed & Startups', /\b(self[- ]employed|freelance\w*|independent (?:consultant|contractor|advisor)|solopreneur|entrepreneur)\b/i],
  ['Staffing & Recruiting', /\b(recruiter|recruiting|talent acquisition|headhunter|staffing)\b/i],
  ['Real Estate', /\b(realtor|real estate|broker associate|property manager)\b/i],
  ['Legal & Accounting', /\b(attorney|lawyer|paralegal|counsel|cpa|accountant|bookkeeper)\b/i],
  ['Healthcare & Life Sciences', /\b(nurse|rn|physician|md|doctor|pharmacist|dentist|therapist|clinician|medical|surgeon|paramedic)\b/i],
  ['Education & Research', /\b(teacher|professor|instructor|educator|school principal|faculty|researcher|lecturer|student)\b/i],
  ['Nonprofit & Associations', /\b(pastor|chaplain|minister|volunteer|board member)\b/i],
  ['Travel & Hospitality', /\b(travel advisor|travel agent|hotel|hospitality|chef)\b/i],
  ['Media & Marketing', /\b(journalist|reporter|editor|producer|photographer|podcast\w*|author)\b/i],
];

const SEG_TO_IND = {
  'Gov & Defense Contractors': 'Defense & Gov Contracting',
  'Utilities & Energy': 'Energy & Utilities',
  'OT/ICS & Cyber Vendors': 'Cybersecurity',
  'Channel & Integrators': 'IT Services & Consulting',
  'Labs & Academia': 'Education & Research',
  'Recruiting & Staffing': 'Staffing & Recruiting',
};
const GOV_SEGS = new Set(['DoD & Military', 'Federal Civilian', 'State & Local']);

let companyMap = {};
export const companyKey = c => String(c || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();
export function setIndustryOverrides(map){ companyMap = map || {}; }

/** Returns {ind, how} where how is 'you' | 'company' | 'title' | 'segment' | 'gov' | ''. */
export function inferIndustry({c, p, seg, status, vet}, personOverride){
  if (personOverride) return {ind: personOverride, how: 'you'};
  const co = c || '', key = companyKey(co);
  if (key && companyMap[key]) return {ind: companyMap[key], how: 'you'};
  if (GOV_SEGS.has(seg)) return {ind: GOV_IND, how: 'gov'};
  if (co) for (const [ind, rx] of COMPANY_RULES) if (rx.test(co)) return {ind, how: 'company'};
  if (SEG_TO_IND[seg]) return {ind: SEG_TO_IND[seg], how: 'segment'};
  for (const [ind, rx] of TITLE_RULES) if (rx.test(p || '')) return {ind, how: 'title'};
  if (!co && (vet || status === 'Veteran / Retired') && !p) return {ind: 'Retired or Between Roles', how: 'title'};
  return {ind: UNCLASSIFIED, how: ''};
}
