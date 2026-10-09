// Ready-made top-level structure for the federal agencies and commands that matter most
// to an OT/ICS and critical-infrastructure seller. The org chart lays your people into
// these offices, and shows the offices where you know no one yet.
//
// Each agency: aliases (as LinkedIn shows the employer), the leader's title, and its
// top-level offices. Each office has a short code, a name, and how to recognise it in a
// person's title or company text:
//   kw    words or phrases, matched case-insensitively on whole words
//   codes acronyms, matched case-sensitively on whole tokens (so "ICE" is not "ice")
//   re    regular expressions, for numbered offices like "SEA 05" or "Region II"
// Offices are tested in order and the first match wins, so list specific ones first.
//
// Structures change. Every entry carries asOf and the source it was checked against.
// Leave an office out rather than guess at it.

export const AGENCIES = [
  {
    id: 'disa', agency: 'Defense Information Systems Agency', short: 'DISA', leader: 'Director',
    aliases: ['Defense Information Systems Agency', 'DISA'],
    asOf: 'FY2025 (Sept 2025); J9 confirmed April 2026',
    source: 'https://connect.disa.mil/industry/sfsites/c/cms/delivery/media/MCFAI6UHZ5SRAZNEEZCSJIA4TYQI',
    offices: [
      {code: 'OIC', name: 'Operations and Infrastructure Center', kw: ['operations and infrastructure center']},
      {code: 'DCDC', name: 'DoD Cyber Defense Command', kw: ['cyber defense command', 'jfhq dodin', 'joint force headquarters dodin'], codes: ['DCDC', 'JFHQ-DODIN']},
      {code: 'HaCC', name: 'Hosting and Compute Center (J9)', kw: ['hosting and compute'], codes: ['HaCC', 'J9']},
      {code: 'PSD', name: 'Procurement Services Directorate (DITCO)', kw: ['procurement services', 'ditco', 'defense information technology contracting', 'contracting officer', 'contract specialist', 'contracting'], codes: ['PSD', 'DITCO']},
      {code: 'WSD', name: 'Workforce Services and Development', kw: ['workforce services and development'], codes: ['WSD']},
      {code: 'RME', name: 'Risk Management Executive', kw: ['risk management executive'], codes: ['RME']},
      {code: 'NSD', name: 'Network Services Directorate', kw: ['network services directorate']},
      {code: 'JSP', name: 'Joint Service Provider', kw: ['joint service provider'], codes: ['JSP']},
      {code: 'JITC', name: 'Joint Interoperability Test Command', kw: ['joint interoperability test'], codes: ['JITC']},
      {code: 'DSO', name: 'Defense Spectrum Organization', kw: ['defense spectrum organization', 'spectrum'], codes: ['DSO']},
      {code: 'WHCA', name: 'White House Communications Agency', kw: ['white house communications'], codes: ['WHCA']},
      {code: 'JSSC', name: 'Joint Staff Support Center', kw: ['joint staff support center'], codes: ['JSSC']},
      {code: 'CAE', name: 'Component Acquisition Executive', kw: ['component acquisition executive'], codes: ['CAE']},
      {code: 'OCFO', name: 'Office of the Chief Financial Officer', kw: ['chief financial officer', 'comptroller'], codes: ['CFO', 'OCFO']},
    ],
  },
  {
    id: 'uscybercom', agency: 'U.S. Cyber Command', short: 'USCYBERCOM', leader: 'Commander',
    aliases: ['U.S. Cyber Command', 'United States Cyber Command', 'USCYBERCOM', 'CYBERCOM'],
    asOf: 'Dec 2025',
    source: 'https://www.everycrsreport.com/files/2025-12-23_IF13042_854904486279f992f1931a1a8d60bfdffa1bb727.html',
    offices: [
      {code: 'CNMF', name: 'Cyber National Mission Force', kw: ['cyber national mission force'], codes: ['CNMF']},
      {code: 'DCDC', name: 'DoD Cyber Defense Command', kw: ['cyber defense command', 'jfhq dodin', 'joint force headquarters dodin'], codes: ['DCDC', 'JFHQ-DODIN']},
      {code: 'ARCYBER', name: 'Army Cyber Command', kw: ['army cyber command', 'arcyber'], codes: ['ARCYBER']},
      {code: 'FLTCYBER', name: 'U.S. Fleet Cyber Command', kw: ['fleet cyber command', 'fltcyber', '10th fleet', 'tenth fleet'], codes: ['FLTCYBER', 'C10F']},
      {code: 'MARFORCYBER', name: 'Marine Forces Cyberspace Command', kw: ['marine forces cyberspace', 'marine corps forces cyberspace', 'marforcyber'], codes: ['MARFORCYBER']},
      {code: 'AFCYBER', name: 'Air Forces Cyber / 16th Air Force', kw: ['air forces cyber', '16th air force', 'sixteenth air force', 'afcyber'], codes: ['AFCYBER', '16 AF', '16AF']},
      {code: 'CGCYBER', name: 'Coast Guard Cyber Command', kw: ['coast guard cyber command', 'cgcyber'], codes: ['CGCYBER']},
    ],
  },
  {
    id: 'arcyber', agency: 'U.S. Army Cyber Command', short: 'ARCYBER', leader: 'Commanding General',
    aliases: ['U.S. Army Cyber Command', 'Army Cyber Command', 'ARCYBER'],
    asOf: 'Nov 2022',
    source: 'https://www.cybercom.mil/Media/News/Article/3232195/cyber-101-us-army-cyber-command-arcyber/',
    offices: [
      {code: '1st IO', name: '1st Information Operations Command', kw: ['1st information operations command', '1st io command', '1st io cmd']},
      {code: 'NETCOM', name: 'Army Network Enterprise Technology Command', kw: ['network enterprise technology command', 'netcom'], codes: ['NETCOM']},
      {code: '780th MI', name: '780th Military Intelligence Brigade (Cyber)', kw: ['780th military intelligence', '780th mi']},
      {code: 'CPB', name: 'Army Cyber Protection Brigade', kw: ['cyber protection brigade'], codes: ['CPB']},
    ],
  },
  {
    id: 'cisa', agency: 'Cybersecurity and Infrastructure Security Agency', short: 'CISA', leader: 'Director',
    aliases: ['Cybersecurity and Infrastructure Security Agency', 'CISA'],
    asOf: '2025',
    source: 'https://www.cisa.gov/about/divisions-offices',
    offices: [
      {code: 'CSD', name: 'Cybersecurity Division', kw: ['cybersecurity division', 'cyber security division', 'threat hunting', 'vulnerability management', 'ics assessments', 'ics assessment'], codes: ['CSD']},
      {code: 'ISD', name: 'Infrastructure Security Division', kw: ['infrastructure security division', 'chemical security', 'bomb prevention'], codes: ['ISD']},
      {code: 'ECD', name: 'Emergency Communications Division', kw: ['emergency communications'], codes: ['ECD']},
      {code: 'NRMC', name: 'National Risk Management Center', kw: ['national risk management'], codes: ['NRMC']},
      {code: 'IOD', name: 'Integrated Operations Division', kw: ['integrated operations', 'protective security advisor', 'cybersecurity advisor', 'cybersecurity state coordinator', 'regional director'], codes: ['IOD']},
      {code: 'SED', name: 'Stakeholder Engagement Division', kw: ['stakeholder engagement'], codes: ['SED']},
    ],
  },
  {
    id: 'dhs', agency: 'Department of Homeland Security', short: 'DHS', leader: 'Secretary',
    aliases: ['U.S. Department of Homeland Security', 'Department of Homeland Security', 'DHS'],
    asOf: 'FY2024 report (Jan 2025)',
    source: 'https://dhs.gov/sites/default/files/2025-01/2025_0117_dhs_annual_performance_report_fy2024.pdf',
    offices: [
      {code: 'CISA', name: 'Cybersecurity and Infrastructure Security Agency', kw: ['cybersecurity and infrastructure security'], codes: ['CISA']},
      {code: 'USCG', name: 'U.S. Coast Guard', kw: ['coast guard'], codes: ['USCG']},
      {code: 'TSA', name: 'Transportation Security Administration', kw: ['transportation security administration'], codes: ['TSA']},
      {code: 'FEMA', name: 'Federal Emergency Management Agency', kw: ['federal emergency management'], codes: ['FEMA']},
      {code: 'CBP', name: 'U.S. Customs and Border Protection', kw: ['customs and border protection', 'border patrol'], codes: ['CBP']},
      {code: 'ICE', name: 'U.S. Immigration and Customs Enforcement', kw: ['immigration and customs enforcement', 'homeland security investigations'], codes: ['ICE', 'HSI']},
      {code: 'USSS', name: 'U.S. Secret Service', kw: ['secret service'], codes: ['USSS']},
      {code: 'USCIS', name: 'U.S. Citizenship and Immigration Services', kw: ['citizenship and immigration services'], codes: ['USCIS']},
      {code: 'S&T', name: 'Science and Technology Directorate', kw: ['science and technology directorate'], codes: ['S&T']},
      {code: 'I&A', name: 'Office of Intelligence and Analysis', kw: ['intelligence and analysis'], codes: ['I&A']},
      {code: 'CWMD', name: 'Countering Weapons of Mass Destruction Office', kw: ['countering weapons of mass destruction'], codes: ['CWMD']},
      {code: 'MGMT', name: 'Management Directorate (incl. OCIO)', kw: ['management directorate', 'chief information officer', 'chief information security officer'], codes: ['OCIO', 'CIO', 'CISO']},
      {code: 'FLETC', name: 'Federal Law Enforcement Training Centers', kw: ['federal law enforcement training'], codes: ['FLETC']},
    ],
  },
  {
    id: 'dodcio', agency: 'DoD Chief Information Officer', short: 'DoD CIO', leader: 'Chief Information Officer',
    aliases: ['Office of the DoD CIO', 'DoD CIO', 'DoD Chief Information Officer', 'Department of Defense Chief Information Officer', 'Office of the Department of Defense Chief Information Officer', 'DoW CIO', 'Department of War Chief Information Officer'],
    asOf: '2025',
    source: 'https://dodcio.defense.gov/AboutDoDCIO.aspx',
    offices: [
      {code: 'CS', name: 'Deputy CIO for Cybersecurity', kw: ['deputy cio for cybersecurity', 'dcio cs', 'cybersecurity', 'ciso', 'cmmc', 'risk management framework']},
      {code: 'IE', name: 'Deputy CIO for Information Enterprise', kw: ['information enterprise', 'dcio ie']},
      {code: 'C3', name: 'Deputy CIO for Command, Control and Communications', kw: ['command control and communications', 'command control communications', 'dcio c3', 'spectrum', 'positioning navigation and timing'], codes: ['C3']},
      {code: 'R&A', name: 'Deputy CIO for Resources and Analysis', kw: ['resources and analysis', 'dcio r a'], codes: ['R&A']},
    ],
  },
  {
    id: 'navfac', agency: 'Naval Facilities Engineering Systems Command', short: 'NAVFAC', leader: 'Commander',
    aliases: ['Naval Facilities Engineering Systems Command', 'Naval Facilities Engineering Command', 'NAVFAC'],
    asOf: '2025 (business lines per NAVFAC Pacific; commands per Wikipedia)',
    source: 'https://pacific.navfac.navy.mil/Facilities-Engineering-Commands/NAVFAC-Hawaii/About-Us/Organization/Business-Lines/',
    offices: [
      {code: 'PW', name: 'Public Works (incl. energy and utilities)', kw: ['public works', 'energy', 'utilities'], codes: ['PW', 'PWD']},
      {code: 'DC', name: 'Design and Construction', kw: ['design and construction', 'capital improvements', 'construction', 'roicc']},
      {code: 'EV', name: 'Environmental', kw: ['environmental']},
      {code: 'AM', name: 'Asset Management', kw: ['asset management']},
      {code: 'RE', name: 'Real Estate', kw: ['real estate', 'realty']},
      {code: 'EXWC', name: 'Engineering and Expeditionary Warfare Center', kw: ['engineering and expeditionary warfare center', 'exwc'], codes: ['EXWC']},
      {code: 'EXP', name: 'Expeditionary', kw: ['expeditionary']},
      {code: 'NCC', name: 'Navy Crane Center', kw: ['navy crane center']},
      {code: 'LANT', name: 'NAVFAC Atlantic (Mid-Atlantic, Southeast, Washington, EURAFCENT)', kw: ['atlantic', 'mid atlantic', 'midlant', 'southeast', 'navfac washington', 'eurafcent', 'europe africa central'], codes: ['LANT']},
      {code: 'PAC', name: 'NAVFAC Pacific (Far East, Hawaii, Marianas, Northwest, Southwest)', kw: ['pacific', 'far east', 'hawaii', 'marianas', 'northwest', 'southwest'], codes: ['PAC']},
    ],
  },
  {
    id: 'usace', agency: 'U.S. Army Corps of Engineers', short: 'USACE', leader: 'Chief of Engineers',
    aliases: ['U.S. Army Corps of Engineers', 'United States Army Corps of Engineers', 'Army Corps of Engineers', 'USACE'],
    asOf: '2026 (divisions and districts)',
    source: 'https://summit.ncmbc.us/wp-content/uploads/2026/04/1530-USACE-Session-1.pdf',
    offices: [
      {code: 'LRD', name: 'Great Lakes and Ohio River Division', kw: ['great lakes and ohio river', 'buffalo district', 'chicago district', 'detroit district', 'huntington district', 'louisville district', 'nashville district', 'pittsburgh district'], codes: ['LRD']},
      {code: 'MVD', name: 'Mississippi Valley Division', kw: ['mississippi valley', 'memphis district', 'new orleans district', 'rock island district', 'st louis district', 'saint louis district', 'st paul district', 'saint paul district', 'vicksburg district'], codes: ['MVD']},
      {code: 'NAD', name: 'North Atlantic Division', kw: ['north atlantic division', 'baltimore district', 'new england district', 'new york district', 'norfolk district', 'philadelphia district', 'europe district'], codes: ['NAD']},
      {code: 'NWD', name: 'Northwestern Division', kw: ['northwestern division', 'kansas city district', 'omaha district', 'portland district', 'seattle district', 'walla walla district'], codes: ['NWD']},
      {code: 'POD', name: 'Pacific Ocean Division', kw: ['pacific ocean division', 'alaska district', 'honolulu district', 'japan district', 'far east district'], codes: ['POD']},
      {code: 'SAD', name: 'South Atlantic Division', kw: ['south atlantic division', 'charleston district', 'jacksonville district', 'mobile district', 'savannah district', 'wilmington district', 'caribbean district'], codes: ['SAD']},
      {code: 'SPD', name: 'South Pacific Division', kw: ['south pacific division', 'albuquerque district', 'los angeles district', 'sacramento district', 'san francisco district'], codes: ['SPD']},
      {code: 'SWD', name: 'Southwestern Division', kw: ['southwestern division', 'fort worth district', 'galveston district', 'little rock district', 'tulsa district'], codes: ['SWD']},
      {code: 'TAD', name: 'Transatlantic Division', kw: ['transatlantic division', 'middle east district'], codes: ['TAD']},
      {code: 'ERDC', name: 'Engineer Research and Development Center', kw: ['engineer research and development center'], codes: ['ERDC']},
      {code: 'HNC', name: 'Engineering and Support Center, Huntsville', kw: ['engineering and support center', 'huntsville center'], codes: ['HNC']},
    ],
  },
  {
    id: 'navwar', agency: 'Naval Information Warfare Systems Command', short: 'NAVWAR', leader: 'Commander',
    aliases: ['Naval Information Warfare Systems Command', 'NAVWAR', 'SPAWAR', 'Space and Naval Warfare Systems Command', 'NIWC Pacific', 'NIWC Atlantic', 'Naval Information Warfare Center Pacific', 'Naval Information Warfare Center Atlantic', 'SSC Pacific', 'SSC Atlantic'],
    asOf: '2025',
    source: 'https://www.navwar.navy.mil/Command-Locations/',
    offices: [
      {code: 'NIWC PAC', name: 'NIWC Pacific', kw: ['niwc pacific', 'niwc pac', 'information warfare center pacific', 'ssc pacific', 'spawar systems center pacific']},
      {code: 'NIWC LANT', name: 'NIWC Atlantic', kw: ['niwc atlantic', 'niwc lant', 'information warfare center atlantic', 'ssc atlantic', 'spawar systems center atlantic']},
      {code: 'PEO C4I', name: 'Program Executive Office C4I', kw: ['peo c4i']},
      {code: 'PEO Digital', name: 'Program Executive Office Digital', kw: ['peo digital']},
      {code: 'PEO MLB', name: 'PEO Manpower, Logistics and Business Solutions', kw: ['peo mlb', 'manpower logistics and business']},
    ],
  },
  {
    id: 'navsea', agency: 'Naval Sea Systems Command', short: 'NAVSEA', leader: 'Commander',
    aliases: ['Naval Sea Systems Command', 'NAVSEA'],
    asOf: '2025',
    source: 'https://www.navsea.navy.mil/About/Organization/Directorates/',
    offices: [
      {code: 'NSWC', name: 'Naval Surface Warfare Centers', kw: ['naval surface warfare center', 'nswc'], codes: ['NSWC']},
      {code: 'NUWC', name: 'Naval Undersea Warfare Centers', kw: ['naval undersea warfare center', 'nuwc'], codes: ['NUWC']},
      {code: 'SEA 01', name: 'Comptroller', kw: ['comptroller'], re: [/\bSEA[ -]?0?1\b/i]},
      {code: 'SEA 02', name: 'Contracts', kw: ['contracting officer', 'contract specialist', 'contracts directorate'], re: [/\bSEA[ -]?0?2\b/i]},
      {code: 'SEA 03', name: 'Cyber Engineering and Digital Transformation', kw: ['cyber engineering', 'digital transformation'], re: [/\bSEA[ -]?0?3\b/i]},
      {code: 'SEA 04', name: 'Industrial Operations (shipyards)', kw: ['industrial operations', 'naval shipyard', 'shipyard'], re: [/\bSEA[ -]?0?4\b/i]},
      {code: 'SEA 05', name: 'Naval Systems Engineering and Logistics', kw: ['naval systems engineering', 'systems engineering'], re: [/\bSEA[ -]?0?5\b/i]},
      {code: 'SEA 07', name: 'Undersea Warfare', kw: ['undersea warfare'], re: [/\bSEA[ -]?0?7\b/i]},
      {code: 'SEA 08', name: 'Naval Nuclear Propulsion', kw: ['naval nuclear propulsion', 'naval reactors'], re: [/\bSEA[ -]?0?8\b/i]},
      {code: 'SEA 10', name: 'Corporate Operations', kw: ['corporate operations'], re: [/\bSEA[ -]?10\b/i]},
      {code: 'SEA 21', name: 'Surface Warfare', kw: ['surface warfare'], re: [/\bSEA[ -]?21\b/i]},
    ],
  },
  {
    id: 'afcec', agency: 'Air Force Civil Engineer Center', short: 'AFCEC', leader: 'Director',
    aliases: ['Air Force Civil Engineer Center', 'AFCEC'],
    asOf: 'July 2024',
    source: 'https://www.afcec.af.mil/About-Us/Fact-Sheets/Display/Article/466125/air-force-civil-engineer-center/',
    offices: [
      {code: 'Energy', name: 'Energy Directorate', kw: ['energy']},
      {code: 'Env', name: 'Environmental Directorate', kw: ['environmental']},
      {code: 'Fac Eng', name: 'Facility Engineering Directorate', kw: ['facility engineering']},
      {code: 'Install', name: 'Installations Directorate', kw: ['installations directorate', 'real property', 'housing']},
      {code: 'Ops', name: 'Operations Directorate', kw: ['operations directorate']},
      {code: 'Ready', name: 'Readiness Directorate', kw: ['readiness directorate', 'emergency management', 'fire emergency services']},
      {code: 'BIS', name: 'Business Information Systems and Mission Support', kw: ['business information systems', 'mission support']},
    ],
  },
  {
    id: 'doe', agency: 'Department of Energy', short: 'DOE', leader: 'Secretary of Energy',
    aliases: ['U.S. Department of Energy', 'Department of Energy', 'DOE', 'USDOE'],
    asOf: 'Nov 2025',
    source: 'https://www.energy.gov/sites/default/files/2025-11/Organization-Chart-11.20.2025-2.pdf',
    offices: [
      {code: 'CESER', name: 'Cybersecurity, Energy Security and Emergency Response', kw: ['cybersecurity energy security and emergency response', 'ceser'], codes: ['CESER']},
      {code: 'OE', name: 'Office of Electricity', kw: ['office of electricity'], codes: ['OE']},
      {code: 'NNSA', name: 'National Nuclear Security Administration', kw: ['national nuclear security', 'nnsa'], codes: ['NNSA']},
      {code: 'IM', name: 'Office of the Chief Information Officer', kw: ['chief information officer', 'chief information security officer', 'ocio'], codes: ['OCIO', 'CIO', 'CISO']},
      {code: 'NE', name: 'Office of Nuclear Energy', kw: ['nuclear energy']},
      {code: 'EM', name: 'Office of Environmental Management', kw: ['environmental management'], codes: ['EM']},
      {code: 'SC', name: 'Office of Science', kw: ['office of science']},
      {code: 'IN', name: 'Intelligence and Counterintelligence', kw: ['intelligence and counterintelligence']},
      {code: 'EHSS', name: 'Environment, Health, Safety and Security', kw: ['environment health safety and security'], codes: ['EHSS']},
      {code: 'HGEO', name: 'Hydrocarbons and Geothermal Energy Office', kw: ['hydrocarbons and geothermal'], codes: ['HGEO']},
      {code: 'ARPA-E', name: 'Advanced Research Projects Agency-Energy', kw: ['arpa e', 'advanced research projects agency energy']},
    ],
  },
  {
    id: 'nnsa', agency: 'National Nuclear Security Administration', short: 'NNSA', leader: 'Administrator',
    aliases: ['National Nuclear Security Administration', 'NNSA'],
    asOf: 'Nov 2025',
    source: 'https://www.energy.gov/sites/default/files/2025-11/Organization-Chart-11.20.2025-2.pdf',
    offices: [
      {code: 'NA-10', name: 'Defense Programs', kw: ['defense programs'], re: [/\bNA[ -]?10\b/i]},
      {code: 'NA-20', name: 'Defense Nuclear Nonproliferation', kw: ['nonproliferation'], re: [/\bNA[ -]?20\b/i]},
      {code: 'NA-30', name: 'Naval Reactors', kw: ['naval reactors'], re: [/\bNA[ -]?30\b/i]},
      {code: 'NA-40', name: 'Emergency Management', kw: ['emergency management'], re: [/\bNA[ -]?40\b/i]},
      {code: 'NA-70', name: 'Defense Nuclear Security', kw: ['defense nuclear security'], re: [/\bNA[ -]?70\b/i]},
      {code: 'NA-80', name: 'Counterterrorism and Counterproliferation', kw: ['counterterrorism', 'counter terrorism', 'counterproliferation'], re: [/\bNA[ -]?80\b/i]},
      {code: 'NA-90', name: 'Infrastructure', kw: ['office of infrastructure'], re: [/\bNA[ -]?90\b/i]},
      {code: 'NA-IM', name: 'Information Management and CIO', kw: ['information management', 'chief information officer', 'chief information security officer'], codes: ['CIO', 'CISO'], re: [/\bNA[ -]?IM\b/i]},
      {code: 'NA-PAS', name: 'Partnership and Acquisition Services', kw: ['partnership and acquisition services', 'contracting officer', 'contract specialist'], re: [/\bNA[ -]?PAS\b/i]},
    ],
  },
  {
    id: 'ferc', agency: 'Federal Energy Regulatory Commission', short: 'FERC', leader: 'Chairman',
    aliases: ['Federal Energy Regulatory Commission', 'FERC'],
    asOf: '2025',
    source: 'https://ferc.gov/offices',
    offices: [
      {code: 'OEIS', name: 'Office of Energy Infrastructure Security', kw: ['energy infrastructure security'], codes: ['OEIS']},
      {code: 'OER', name: 'Office of Electric Reliability', kw: ['electric reliability'], codes: ['OER']},
      {code: 'OEMR', name: 'Office of Energy Market Regulation', kw: ['energy market regulation'], codes: ['OEMR']},
      {code: 'OEP', name: 'Office of Energy Projects', kw: ['energy projects'], codes: ['OEP']},
      {code: 'OERA', name: 'Office of Enforcement and Regulatory Accounting', kw: ['enforcement', 'regulatory accounting'], codes: ['OERA', 'OE']},
      {code: 'OTRE', name: 'Office of Technical Reporting and Economics', kw: ['technical reporting and economics'], codes: ['OTRE']},
      {code: 'OGC', name: 'Office of the General Counsel', kw: ['general counsel'], codes: ['OGC']},
      {code: 'OED', name: 'Office of the Executive Director', kw: ['office of the executive director'], codes: ['OED']},
      {code: 'OEA', name: 'Office of External Affairs', kw: ['external affairs'], codes: ['OEA']},
      {code: 'OPP', name: 'Office of Public Participation', kw: ['public participation'], codes: ['OPP']},
    ],
  },
  {
    id: 'nrc', agency: 'Nuclear Regulatory Commission', short: 'NRC', leader: 'Chairman',
    aliases: ['U.S. Nuclear Regulatory Commission', 'Nuclear Regulatory Commission', 'USNRC', 'NRC'],
    not: /\bhealth\b/i,
    asOf: 'mid-2026 reorganization',
    source: 'https://www.ans.org/news/2026-04-21/article-7966/nrc-reorganization-update-changes-will-begin-this-summer/',
    offices: [
      {code: 'NRR', name: 'Office of Nuclear Reactor Regulation', kw: ['nuclear reactor regulation'], codes: ['NRR']},
      {code: 'OAR', name: 'Office of Advanced Reactors', kw: ['advanced reactors'], codes: ['OAR']},
      {code: 'CNRI', name: 'Office of the Chief Nuclear Reactor Inspector', kw: ['chief nuclear reactor inspector'], codes: ['CNRI']},
      {code: 'NMSS', name: 'Nuclear Material Safety and Safeguards', kw: ['nuclear material safety', 'nuclear materials safety'], codes: ['NMSS']},
      {code: 'RES', name: 'Office of Nuclear Regulatory Research', kw: ['nuclear regulatory research'], codes: ['RES']},
      {code: 'R-I', name: 'Region I', re: [/\bregion (I|1)\b/i]},
      {code: 'R-II', name: 'Region II', re: [/\bregion (II|2)\b/i]},
      {code: 'R-III', name: 'Region III', re: [/\bregion (III|3)\b/i]},
      {code: 'R-IV', name: 'Region IV', re: [/\bregion (IV|4)\b/i]},
    ],
  },
  {
    id: 'tva', agency: 'Tennessee Valley Authority', short: 'TVA', leader: 'President and CEO',
    aliases: ['Tennessee Valley Authority', 'TVA'],
    asOf: '2026 Q2 (third-party org chart)',
    source: 'https://creately.com/org-chart/us-government/tennessee-valley-authority/',
    offices: [
      {code: 'NUC', name: 'Nuclear Operations', kw: ['nuclear']},
      {code: 'PWR', name: 'Power Operations', kw: ['power operations']},
      {code: 'FIN', name: 'Finance', kw: ['finance', 'financial', 'treasurer']},
      {code: 'EXT', name: 'External Relations', kw: ['external relations']},
      {code: 'CORP', name: 'Corporate Services', kw: ['corporate services']},
      {code: 'LEGAL', name: 'Legal', kw: ['general counsel', 'legal', 'attorney']},
    ],
  },
  {
    id: 'bpa', agency: 'Bonneville Power Administration', short: 'BPA', leader: 'Administrator and CEO',
    aliases: ['Bonneville Power Administration', 'BPA'],
    asOf: 'long-standing business lines (source deck 2013)',
    source: 'https://usea.org/sites/default/files/event-/BPA_Overview_101.pdf',
    offices: [
      {code: 'PS', name: 'Power Services', kw: ['power services', 'generation asset management', 'power marketing']},
      {code: 'TS', name: 'Transmission Services', kw: ['transmission services', 'transmission']},
      {code: 'EFW', name: 'Environment, Fish and Wildlife', kw: ['fish and wildlife']},
    ],
  },
  {
    id: 'wapa', agency: 'Western Area Power Administration', short: 'WAPA', leader: 'Administrator and CEO',
    aliases: ['Western Area Power Administration', 'WAPA'],
    asOf: '2025',
    source: 'https://www.wapa.gov/about-wapa/regions/',
    offices: [
      {code: 'DSW', name: 'Desert Southwest Region', kw: ['desert southwest', 'desert south west'], codes: ['DSW']},
      {code: 'RM', name: 'Rocky Mountain Region', kw: ['rocky mountain'], codes: ['RMR']},
      {code: 'SN', name: 'Sierra Nevada Region', kw: ['sierra nevada'], codes: ['SNR']},
      {code: 'UGP', name: 'Upper Great Plains Region', kw: ['upper great plains'], codes: ['UGP', 'UGPR']},
      {code: 'CRSP', name: 'Colorado River Storage Project Management Center', kw: ['colorado river storage'], codes: ['CRSP']},
    ],
  },
  {
    id: 'usbr', agency: 'Bureau of Reclamation', short: 'Reclamation', leader: 'Commissioner',
    aliases: ['U.S. Bureau of Reclamation', 'Bureau of Reclamation', 'USBR'],
    asOf: 'FY2026 budget',
    source: 'https://www.usbr.gov/budget/2026/FY-2026-BOR-Regional-Maps-Map-Keys.pdf',
    offices: [
      {code: 'R5', name: 'Missouri Basin (Region 5)', kw: ['missouri basin'], re: [/\bregion 5\b/i]},
      {code: 'R6', name: 'Arkansas-Rio Grande-Texas Gulf (Region 6)', kw: ['arkansas rio grande', 'texas gulf'], re: [/\bregion 6\b/i]},
      {code: 'R7', name: 'Upper Colorado Basin (Region 7)', kw: ['upper colorado'], re: [/\bregion 7\b/i]},
      {code: 'R8', name: 'Lower Colorado Basin (Region 8)', kw: ['lower colorado'], re: [/\bregion 8\b/i]},
      {code: 'R9', name: 'Columbia-Pacific Northwest (Region 9)', kw: ['columbia pacific northwest', 'pacific northwest'], re: [/\bregion 9\b/i]},
      {code: 'R10', name: 'California-Great Basin (Region 10)', kw: ['california great basin'], re: [/\bregion 10\b/i]},
    ],
  },
  {
    id: 'gsa', agency: 'General Services Administration', short: 'GSA', leader: 'Administrator',
    aliases: ['U.S. General Services Administration', 'General Services Administration', 'GSA'],
    asOf: '2023 (CRS); FAS and PBS unchanged in 2025',
    source: 'https://www.everycrsreport.com/reports/R47722.html',
    offices: [
      {code: 'TTS', name: 'Technology Transformation Services (in FAS)', kw: ['technology transformation services'], codes: ['TTS']},
      {code: 'FAS', name: 'Federal Acquisition Service', kw: ['federal acquisition service', 'multiple award schedule', 'contracting officer', 'contract specialist'], codes: ['FAS', 'MAS']},
      {code: 'PBS', name: 'Public Buildings Service', kw: ['public buildings service', 'property manager', 'facility manager', 'building manager'], codes: ['PBS']},
      {code: 'OGP', name: 'Office of Government-wide Policy', kw: ['government wide policy', 'governmentwide policy'], codes: ['OGP']},
    ],
  },
  {
    id: 'dla', agency: 'Defense Logistics Agency', short: 'DLA', leader: 'Director',
    aliases: ['Defense Logistics Agency', 'DLA'],
    asOf: 'Dec 2022',
    source: 'https://www.everycrsreport.com/files/2022-12-14_IF11543_092abd982a411d17dac843dbef18f46bed4e8d4d.html',
    offices: [
      {code: 'Energy', name: 'DLA Energy', kw: ['energy', 'fuel']},
      {code: 'Aviation', name: 'DLA Aviation', kw: ['aviation']},
      {code: 'L&M', name: 'DLA Land and Maritime', kw: ['land and maritime']},
      {code: 'Troop Spt', name: 'DLA Troop Support', kw: ['troop support']},
      {code: 'Disposition', name: 'DLA Disposition Services', kw: ['disposition']},
      {code: 'Distribution', name: 'DLA Distribution', kw: ['distribution']},
    ],
  },
  {
    id: 'faa', agency: 'Federal Aviation Administration', short: 'FAA', leader: 'Administrator',
    aliases: ['Federal Aviation Administration', 'FAA'],
    asOf: '2025',
    source: 'https://tfmlearning.faa.gov/assets/media/CDM/CDM_2025/FAA_Organizational_Chart_2025.pdf',
    offices: [
      {code: 'ATO', name: 'Air Traffic Organization', kw: ['air traffic', 'technical operations'], codes: ['ATO']},
      {code: 'AVS', name: 'Aviation Safety', kw: ['aviation safety', 'flight standards', 'aircraft certification'], codes: ['AVS']},
      {code: 'ARP', name: 'Airports', kw: ['office of airports', 'airports division'], codes: ['ARP']},
      {code: 'AST', name: 'Commercial Space Transportation', kw: ['commercial space'], codes: ['AST']},
      {code: 'ASH', name: 'Security and Hazardous Materials Safety', kw: ['security and hazardous materials'], codes: ['ASH']},
      {code: 'AFN', name: 'Finance and Management (incl. IT Services)', kw: ['finance and management', 'information and technology services', 'information technology'], codes: ['AFN', 'AIT']},
      {code: 'ANG', name: 'NextGen', kw: ['nextgen', 'next generation air transportation'], codes: ['ANG']},
    ],
  },
  {
    id: 'tsa', agency: 'Transportation Security Administration', short: 'TSA', leader: 'Administrator',
    aliases: ['Transportation Security Administration', 'TSA'],
    asOf: '2025',
    source: 'https://www.tsa.gov/leader-bios/operations-support',
    offices: [
      {code: 'LE/FAMS', name: 'Law Enforcement / Federal Air Marshal Service', kw: ['federal air marshal', 'air marshal', 'law enforcement'], codes: ['FAMS']},
      {code: 'RCA', name: 'Requirements and Capabilities Analysis', kw: ['requirements and capabilities analysis'], codes: ['RCA']},
      {code: 'PPE', name: 'Policy, Plans and Engagement', kw: ['policy plans and engagement'], codes: ['PPE']},
      {code: 'I&A', name: 'Intelligence and Analysis', kw: ['intelligence and analysis'], codes: ['I&A']},
      {code: 'ES&VP', name: 'Enrollment Services and Vetting Programs', kw: ['enrollment services and vetting', 'vetting programs']},
      {code: 'IT', name: 'Information Technology', kw: ['information technology', 'chief information officer', 'chief information security officer'], codes: ['CIO', 'CISO']},
      {code: 'OS', name: 'Operations Support', kw: ['operations support']},
      {code: 'SO', name: 'Security Operations (airports and surface)', kw: ['security operations', 'federal security director', 'transportation security officer', 'transportation security inspector'], codes: ['FSD', 'TSO', 'TSI']},
    ],
  },
  {
    id: 'uscg', agency: 'U.S. Coast Guard (C5I and cyber)', short: 'USCG', leader: 'Commandant',
    aliases: ['U.S. Coast Guard', 'United States Coast Guard', 'Coast Guard', 'USCG'],
    asOf: '2025',
    source: 'https://www.dcms.uscg.mil/Our-Organization/Assistant-Commandant-for-C4IT-CG-6-/C5ISC/',
    offices: [
      {code: 'CGCYBER', name: 'Coast Guard Cyber Command', kw: ['coast guard cyber command', 'cgcyber', 'cyber command'], codes: ['CGCYBER']},
      {code: 'C5ISC', name: 'C5I Service Center', kw: ['c5i service center', 'c5isc'], codes: ['C5ISC']},
      {code: 'CG-6', name: 'Assistant Commandant for C4 and IT', kw: ['c4it', 'c4 and it', 'c4 it', 'cg 6'], re: [/\bCG-?6\b/i]},
    ],
  },
  {
    id: 'vaoit', agency: 'VA Office of Information and Technology', short: 'VA OIT', leader: 'Chief Information Officer',
    aliases: ['VA Office of Information and Technology', 'Veterans Affairs Office of Information and Technology', 'Department of Veterans Affairs Office of Information and Technology', 'VA OIT'],
    asOf: 'July 2025 (new service lines)',
    source: 'https://www.govinfo.gov/content/pkg/CHRG-119hhrg61356/html/CHRG-119hhrg61356.htm',
    offices: [
      {code: 'TO', name: 'Technical Operations', kw: ['technical operations']},
      {code: 'PD', name: 'Product Delivery', kw: ['product delivery']},
      {code: 'EUS', name: 'End User Services', kw: ['end user services']},
      {code: 'PS', name: 'People Science', kw: ['people science']},
      {code: 'COS', name: 'Office of the Chief of Staff', kw: ['chief of staff']},
    ],
  },
  {
    id: 'ssc', agency: 'Space Systems Command', short: 'SSC', leader: 'Commander',
    aliases: ['Space Systems Command', 'U.S. Space Force Space Systems Command', 'SSC'],
    asOf: 'Feb 2026 (System Deltas)',
    source: 'https://newspaceeconomy.ca/2026/04/19/space-systems-command-deltas-and-what-the-february-2026-structure-reveals/',
    offices: [
      {code: 'SYD 80', name: 'Space Access', kw: ['space access'], re: [/\b(SYD|systems? delta) ?80\b/i]},
      {code: 'SYD 81', name: 'Operational Test and Training Infrastructure', re: [/\b(SYD|systems? delta) ?81\b/i]},
      {code: 'SYD 84', name: 'Missile Warning and Tracking', kw: ['missile warning'], re: [/\b(SYD|systems? delta) ?84\b/i]},
      {code: 'SYD 85', name: 'Battle Management, C3 and Space Intelligence', kw: ['bmc3i'], re: [/\b(SYD|systems? delta) ?85\b/i]},
      {code: 'SYD 88', name: 'Satellite Communications', kw: ['satellite communications', 'satcom', 'milsatcom'], re: [/\b(SYD|systems? delta) ?88\b/i]},
      {code: 'SYD 89', name: 'Space Combat Power', kw: ['space combat power'], re: [/\b(SYD|systems? delta) ?89\b/i]},
      {code: 'SYD 810', name: 'Space-Based Sensing and Targeting', kw: ['space based sensing'], re: [/\b(SYD|systems? delta) ?810\b/i]},
      {code: 'SYD 831', name: 'Navigation Warfare and PNT', kw: ['navigation warfare', 'gps', 'pnt'], re: [/\b(SYD|systems? delta) ?831\b/i]},
      {code: 'SLD 30', name: 'Space Launch Delta 30 (Vandenberg)', kw: ['space launch delta 30', 'sld 30', 'vandenberg']},
      {code: 'SLD 45', name: 'Space Launch Delta 45 (Patrick-Cape Canaveral)', kw: ['space launch delta 45', 'sld 45', 'cape canaveral', 'patrick space force base']},
      {code: 'SBD 3', name: 'Space Base Delta 3 (Los Angeles AFB)', kw: ['space base delta 3', 'sbd 3', 'los angeles air force base']},
    ],
  },
];

/* ---------- matching ---------- */
// Lower case, "&" as "and", punctuation as spaces, "U.S." as "us", no leading "the".
export const norm = s => ' ' + String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  .replace(/\bu s\b/g, 'us').replace(/\bthe\b/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Compiled once: normalized aliases and per-office matchers.
const COMPILED = AGENCIES.map(a => ({
  a,
  aliases: a.aliases.map(x => ({n: norm(x), acro: /^[A-Z0-9]{2,5}$/.test(x) ? x : ''})),
  offices: a.offices.map(o => ({
    kw: (o.kw || []).map(norm),
    codes: (o.codes || []).map(c => new RegExp('(^|[^A-Za-z0-9])' + esc(c) + '(?![A-Za-z0-9])')),
    re: o.re || [],
  })),
}));

// The agency a company (or search) names, or null. A whole-name match wins; then the
// longest alias found inside the text. Short acronyms only count inside a longer name
// when they are written in capitals, so "DOE" matches "DOE Oak Ridge" but not "doe".
export function findAgency(text){
  const raw = String(text || '');
  const n = norm(raw);
  if (n.trim().length < 2) return null;
  let best = null, bestScore = 0;
  for (const c of COMPILED){
    if (c.a.not && c.a.not.test(raw)) continue;
    for (const al of c.aliases){
      let score = 0;
      if (n === al.n) score = 1000 + al.n.length;
      else if (n.includes(al.n)){
        if (al.acro && !new RegExp('(^|[^A-Za-z0-9])' + esc(al.acro) + '(?![A-Za-z0-9])').test(raw)) continue;
        score = al.n.length;
      }
      if (score > bestScore){ best = c; bestScore = score; }
    }
  }
  return best;
}

const officeHit = (o, raw, n) => o.kw.some(k => n.includes(k)) || o.codes.some(r => r.test(raw)) || o.re.some(r => r.test(raw));

// Which office a person sits in: their title first, then their company text (so "NAVFAC
// Southeast" lands in Atlantic only when the title says nothing more specific). -1 if none.
export function officeOf(compiled, title, company){
  for (const raw of [String(title || ''), String(company || '')]){
    if (!raw.trim()) continue;
    const n = norm(raw);
    const i = compiled.offices.findIndex(o => officeHit(o, raw, n));
    if (i >= 0) return i;
  }
  return -1;
}
