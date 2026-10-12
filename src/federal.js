// The federal map: departments, agencies and major military commands, so Northfix can
// show where you are connected and, more importantly, where you are not.
//
// Each row: [department, name, short, aliases, tags]
//   aliases  how the employer or title shows on LinkedIn. ALL-CAPS entries are acronyms,
//            matched case-sensitively on whole words (so "ICE" is not "ice"); the rest are
//            matched case-insensitively on whole words.
//   tags     what the agency touches, for the "your focus" filter:
//            energy, water, defense, cyber, transport, intel, infrastructure, health, finance, science
//
// Keep names current; an agency that is renamed keeps its old name as an alias.

export const FEDERAL = [
  // Department of Defense: leadership and services
  ['Defense', 'Office of the Secretary of Defense', 'OSD', ['OSD', 'OUSD', 'Office of the Secretary of Defense', 'Pentagon', 'Under Secretary of Defense'], ['defense']],
  ['Defense', 'DoD Chief Information Officer', 'DoD CIO', ['DoD CIO', 'DOD CIO', 'Department of Defense Chief Information Officer'], ['defense', 'cyber']],
  ['Defense', 'Joint Staff', 'Joint Staff', ['Joint Staff', 'Joint Chiefs of Staff'], ['defense']],
  ['Defense', 'Chief Digital and AI Office', 'CDAO', ['CDAO', 'Chief Digital and Artificial Intelligence Office'], ['defense', 'cyber']],
  ['Defense', 'U.S. Army', 'Army', ['U.S. Army', 'US Army', 'United States Army', 'Department of the Army'], ['defense']],
  ['Defense', 'U.S. Navy', 'Navy', ['U.S. Navy', 'US Navy', 'United States Navy', 'Department of the Navy'], ['defense']],
  ['Defense', 'U.S. Marine Corps', 'USMC', ['USMC', 'U.S. Marine Corps', 'US Marine Corps', 'United States Marine Corps'], ['defense']],
  ['Defense', 'U.S. Air Force', 'Air Force', ['USAF', 'U.S. Air Force', 'US Air Force', 'United States Air Force', 'Department of the Air Force'], ['defense']],
  ['Defense', 'U.S. Space Force', 'Space Force', ['USSF', 'U.S. Space Force', 'US Space Force', 'United States Space Force'], ['defense']],
  ['Defense', 'National Guard Bureau', 'NGB', ['National Guard Bureau', 'Army National Guard', 'Air National Guard'], ['defense']],
  // Department of Defense: combatant commands
  ['Defense', 'U.S. Cyber Command', 'CYBERCOM', ['USCYBERCOM', 'CYBERCOM', 'U.S. Cyber Command', 'US Cyber Command'], ['defense', 'cyber']],
  ['Defense', 'U.S. Northern Command / NORAD', 'NORTHCOM', ['USNORTHCOM', 'NORTHCOM', 'NORAD'], ['defense']],
  ['Defense', 'U.S. Indo-Pacific Command', 'INDOPACOM', ['USINDOPACOM', 'INDOPACOM'], ['defense']],
  ['Defense', 'U.S. European Command', 'EUCOM', ['USEUCOM', 'EUCOM'], ['defense']],
  ['Defense', 'U.S. Central Command', 'CENTCOM', ['USCENTCOM', 'CENTCOM'], ['defense']],
  ['Defense', 'U.S. Africa Command', 'AFRICOM', ['USAFRICOM', 'AFRICOM'], ['defense']],
  ['Defense', 'U.S. Southern Command', 'SOUTHCOM', ['USSOUTHCOM', 'SOUTHCOM'], ['defense']],
  ['Defense', 'U.S. Special Operations Command', 'SOCOM', ['USSOCOM', 'SOCOM', 'Special Operations Command'], ['defense']],
  ['Defense', 'U.S. Transportation Command', 'TRANSCOM', ['USTRANSCOM', 'TRANSCOM'], ['defense', 'transport']],
  ['Defense', 'U.S. Strategic Command', 'STRATCOM', ['USSTRATCOM', 'STRATCOM'], ['defense']],
  ['Defense', 'U.S. Space Command', 'SPACECOM', ['USSPACECOM', 'SPACECOM'], ['defense']],
  // Department of Defense: agencies
  ['Defense', 'Defense Information Systems Agency', 'DISA', ['DISA', 'Defense Information Systems Agency'], ['defense', 'cyber']],
  ['Defense', 'Defense Logistics Agency', 'DLA', ['DLA', 'Defense Logistics Agency'], ['defense', 'energy']],
  ['Defense', 'Defense Threat Reduction Agency', 'DTRA', ['DTRA', 'Defense Threat Reduction Agency'], ['defense']],
  ['Defense', 'Defense Contract Management Agency', 'DCMA', ['DCMA', 'Defense Contract Management Agency'], ['defense']],
  ['Defense', 'Defense Contract Audit Agency', 'DCAA', ['DCAA', 'Defense Contract Audit Agency'], ['defense', 'finance']],
  ['Defense', 'Defense Counterintelligence and Security Agency', 'DCSA', ['DCSA', 'Defense Counterintelligence and Security Agency'], ['defense', 'intel']],
  ['Defense', 'DARPA', 'DARPA', ['DARPA', 'Defense Advanced Research Projects Agency'], ['defense', 'science']],
  ['Defense', 'Defense Innovation Unit', 'DIU', ['DIU', 'Defense Innovation Unit'], ['defense']],
  ['Defense', 'Missile Defense Agency', 'MDA', ['Missile Defense Agency'], ['defense']],
  ['Defense', 'Defense Health Agency', 'DHA', ['Defense Health Agency'], ['defense', 'health']],
  ['Defense', 'Defense Intelligence Agency', 'DIA', ['DIA', 'Defense Intelligence Agency'], ['defense', 'intel']],
  ['Defense', 'National Security Agency', 'NSA', ['NSA', 'National Security Agency'], ['defense', 'intel', 'cyber']],
  ['Defense', 'National Geospatial-Intelligence Agency', 'NGA', ['NGA', 'National Geospatial-Intelligence Agency'], ['defense', 'intel']],
  ['Defense', 'National Reconnaissance Office', 'NRO', ['NRO', 'National Reconnaissance Office'], ['defense', 'intel']],
  ['Defense', 'Washington Headquarters Services', 'WHS', ['WHS', 'Washington Headquarters Services'], ['defense']],
  // Army commands
  ['Defense', 'U.S. Army Corps of Engineers', 'USACE', ['USACE', 'Army Corps of Engineers', 'Corps of Engineers'], ['defense', 'water', 'energy', 'infrastructure']],
  ['Defense', 'Army Cyber Command', 'ARCYBER', ['ARCYBER', 'Army Cyber Command', 'Army Cyber'], ['defense', 'cyber']],
  ['Defense', 'Army Materiel Command', 'AMC', ['Army Materiel Command'], ['defense']],
  ['Defense', 'Army Installation Management Command', 'IMCOM', ['IMCOM', 'Installation Management Command'], ['defense', 'infrastructure', 'energy']],
  ['Defense', 'Army Futures Command', 'AFC', ['Army Futures Command'], ['defense']],
  ['Defense', 'Army Contracting Command', 'ACC', ['Army Contracting Command'], ['defense']],
  ['Defense', 'PEO Enterprise Information Systems', 'PEO EIS', ['PEO EIS', 'Program Executive Office Enterprise Information Systems'], ['defense', 'cyber']],
  ['Defense', 'Army Engineer Research and Development Center', 'ERDC', ['ERDC', 'Engineer Research and Development Center'], ['defense', 'science', 'infrastructure']],
  // Navy and Marine Corps commands
  ['Defense', 'Naval Facilities Engineering Systems Command', 'NAVFAC', ['NAVFAC', 'Naval Facilities Engineering'], ['defense', 'infrastructure', 'energy', 'water']],
  ['Defense', 'Naval Sea Systems Command', 'NAVSEA', ['NAVSEA', 'Naval Sea Systems Command'], ['defense']],
  ['Defense', 'Naval Air Systems Command', 'NAVAIR', ['NAVAIR', 'Naval Air Systems Command'], ['defense']],
  ['Defense', 'Naval Information Warfare Systems Command', 'NAVWAR', ['NAVWAR', 'NIWC', 'SPAWAR', 'Naval Information Warfare'], ['defense', 'cyber']],
  ['Defense', 'Naval Supply Systems Command', 'NAVSUP', ['NAVSUP', 'Naval Supply Systems Command'], ['defense']],
  ['Defense', 'Fleet Cyber Command / 10th Fleet', 'FLTCYBER', ['FLTCYBER', 'FCC/C10F', 'Fleet Cyber Command', 'U.S. Tenth Fleet'], ['defense', 'cyber']],
  ['Defense', 'Commander, Navy Installations Command', 'CNIC', ['CNIC', 'Navy Installations Command'], ['defense', 'infrastructure']],
  ['Defense', 'Marine Corps Systems Command', 'MARCORSYSCOM', ['MARCORSYSCOM', 'Marine Corps Systems Command'], ['defense']],
  ['Defense', 'Marine Corps Forces Cyberspace Command', 'MARFORCYBER', ['MARFORCYBER', 'Marine Corps Forces Cyberspace'], ['defense', 'cyber']],
  ['Defense', 'Marine Corps Installations Command', 'MCICOM', ['MCICOM', 'Marine Corps Installations Command'], ['defense', 'infrastructure']],
  // Air and Space Force commands
  ['Defense', 'Air Force Civil Engineer Center', 'AFCEC', ['AFCEC', 'Air Force Civil Engineer Center'], ['defense', 'infrastructure', 'energy']],
  ['Defense', 'Air Force Materiel Command', 'AFMC', ['AFMC', 'Air Force Materiel Command'], ['defense']],
  ['Defense', 'Air Force Life Cycle Management Center', 'AFLCMC', ['AFLCMC', 'Air Force Life Cycle Management Center'], ['defense']],
  ['Defense', 'Air Force Research Laboratory', 'AFRL', ['AFRL', 'Air Force Research Laboratory', 'Air Force Research Lab'], ['defense', 'science']],
  ['Defense', 'Sixteenth Air Force (Air Forces Cyber)', '16 AF', ['16th Air Force', 'Sixteenth Air Force', 'Air Forces Cyber', 'AFCYBER'], ['defense', 'cyber']],
  ['Defense', 'Air Force Installation and Mission Support Center', 'AFIMSC', ['AFIMSC', 'Installation and Mission Support Center'], ['defense', 'infrastructure']],
  ['Defense', 'Space Systems Command', 'SSC', ['Space Systems Command'], ['defense']],

  // Homeland Security
  ['Homeland Security', 'Department of Homeland Security (HQ)', 'DHS', ['DHS', 'Department of Homeland Security', 'Homeland Security'], ['cyber', 'infrastructure']],
  ['Homeland Security', 'Cybersecurity and Infrastructure Security Agency', 'CISA', ['CISA', 'Cybersecurity and Infrastructure Security Agency'], ['cyber', 'infrastructure', 'energy', 'water']],
  ['Homeland Security', 'Transportation Security Administration', 'TSA', ['TSA', 'Transportation Security Administration'], ['transport', 'cyber']],
  ['Homeland Security', 'Federal Emergency Management Agency', 'FEMA', ['FEMA', 'Federal Emergency Management Agency'], ['infrastructure']],
  ['Homeland Security', 'U.S. Coast Guard', 'USCG', ['USCG', 'U.S. Coast Guard', 'US Coast Guard', 'United States Coast Guard'], ['defense', 'transport', 'cyber']],
  ['Homeland Security', 'U.S. Customs and Border Protection', 'CBP', ['CBP', 'Customs and Border Protection'], ['transport']],
  ['Homeland Security', 'U.S. Immigration and Customs Enforcement', 'ICE', ['ICE', 'Immigration and Customs Enforcement'], []],
  ['Homeland Security', 'U.S. Secret Service', 'USSS', ['USSS', 'Secret Service'], ['cyber']],
  ['Homeland Security', 'U.S. Citizenship and Immigration Services', 'USCIS', ['USCIS', 'Citizenship and Immigration Services'], []],
  ['Homeland Security', 'DHS Science and Technology Directorate', 'DHS S&T', ['DHS S&T', 'Science and Technology Directorate'], ['science']],
  ['Homeland Security', 'Federal Law Enforcement Training Centers', 'FLETC', ['FLETC', 'Federal Law Enforcement Training'], []],

  // Energy
  ['Energy', 'Department of Energy (HQ)', 'DOE', ['DOE', 'Department of Energy', 'U.S. Department of Energy', 'Dept. of Energy'], ['energy']],
  ['Energy', 'National Nuclear Security Administration', 'NNSA', ['NNSA', 'National Nuclear Security Administration'], ['energy', 'defense']],
  ['Energy', 'Office of Cybersecurity, Energy Security, and Emergency Response', 'CESER', ['CESER', 'Cybersecurity, Energy Security, and Emergency Response'], ['energy', 'cyber']],
  ['Energy', 'Office of Electricity', 'OE', ['Office of Electricity'], ['energy']],
  ['Energy', 'Office of Environmental Management', 'EM', ['Office of Environmental Management', 'DOE Environmental Management'], ['energy']],
  ['Energy', 'Bonneville Power Administration', 'BPA', ['BPA', 'Bonneville Power'], ['energy', 'water']],
  ['Energy', 'Western Area Power Administration', 'WAPA', ['WAPA', 'Western Area Power'], ['energy']],
  ['Energy', 'Southwestern Power Administration', 'SWPA', ['SWPA', 'Southwestern Power Administration'], ['energy']],
  ['Energy', 'Southeastern Power Administration', 'SEPA', ['Southeastern Power Administration'], ['energy']],
  ['Energy', 'Idaho National Laboratory', 'INL', ['INL', 'Idaho National Laboratory', 'Idaho National Lab'], ['energy', 'cyber', 'science']],
  ['Energy', 'Sandia National Laboratories', 'Sandia', ['Sandia National Laboratories', 'Sandia National Labs', 'Sandia'], ['energy', 'defense', 'science']],
  ['Energy', 'Los Alamos National Laboratory', 'LANL', ['LANL', 'Los Alamos National Laboratory', 'Los Alamos'], ['energy', 'defense', 'science']],
  ['Energy', 'Lawrence Livermore National Laboratory', 'LLNL', ['LLNL', 'Lawrence Livermore'], ['energy', 'defense', 'science']],
  ['Energy', 'Oak Ridge National Laboratory', 'ORNL', ['ORNL', 'Oak Ridge National Laboratory', 'Oak Ridge National Lab'], ['energy', 'science']],
  ['Energy', 'Pacific Northwest National Laboratory', 'PNNL', ['PNNL', 'Pacific Northwest National Laboratory'], ['energy', 'cyber', 'science']],
  ['Energy', 'National Renewable Energy Laboratory', 'NREL', ['NREL', 'National Renewable Energy Laboratory', 'National Laboratory of the Rockies'], ['energy', 'science']],
  ['Energy', 'Argonne National Laboratory', 'Argonne', ['Argonne National Laboratory', 'Argonne National Lab'], ['energy', 'science']],
  ['Energy', 'Savannah River Site and National Laboratory', 'SRS', ['Savannah River'], ['energy', 'defense']],
  ['Energy', 'Federal Energy Regulatory Commission', 'FERC', ['FERC', 'Federal Energy Regulatory Commission'], ['energy']],

  // Independent energy, nuclear and infrastructure
  ['Independent', 'Nuclear Regulatory Commission', 'NRC', ['NRC', 'Nuclear Regulatory Commission'], ['energy']],
  ['Independent', 'Tennessee Valley Authority', 'TVA', ['TVA', 'Tennessee Valley Authority'], ['energy', 'water']],
  ['Independent', 'Environmental Protection Agency', 'EPA', ['EPA', 'Environmental Protection Agency'], ['water', 'infrastructure']],
  ['Independent', 'General Services Administration', 'GSA', ['GSA', 'General Services Administration'], ['infrastructure']],
  ['Independent', 'NASA', 'NASA', ['NASA', 'National Aeronautics and Space Administration'], ['science']],
  ['Independent', 'U.S. Postal Service', 'USPS', ['USPS', 'U.S. Postal Service', 'United States Postal Service'], ['transport', 'infrastructure']],
  ['Independent', 'Federal Communications Commission', 'FCC', ['FCC', 'Federal Communications Commission'], ['cyber']],
  ['Independent', 'Securities and Exchange Commission', 'SEC', ['Securities and Exchange Commission'], ['finance', 'cyber']],
  ['Independent', 'Small Business Administration', 'SBA', ['SBA', 'Small Business Administration'], ['finance']],
  ['Independent', 'Office of Personnel Management', 'OPM', ['OPM', 'Office of Personnel Management'], []],
  ['Independent', 'National Science Foundation', 'NSF', ['NSF', 'National Science Foundation'], ['science']],
  ['Independent', 'Social Security Administration', 'SSA', ['SSA', 'Social Security Administration'], []],
  ['Independent', 'Federal Reserve Board', 'Fed', ['Federal Reserve'], ['finance']],
  ['Independent', 'Office of the Director of National Intelligence', 'ODNI', ['ODNI', 'Director of National Intelligence'], ['intel']],
  ['Independent', 'Central Intelligence Agency', 'CIA', ['CIA', 'Central Intelligence Agency'], ['intel']],
  ['Independent', 'Government Accountability Office', 'GAO', ['GAO', 'Government Accountability Office'], []],
  ['Independent', 'Architect of the Capitol', 'AOC', ['Architect of the Capitol'], ['infrastructure', 'energy']],

  // Interior
  ['Interior', 'Department of the Interior (HQ)', 'DOI', ['DOI', 'Department of the Interior', 'Department of Interior'], []],
  ['Interior', 'Bureau of Reclamation', 'USBR', ['USBR', 'Bureau of Reclamation'], ['water', 'energy']],
  ['Interior', 'Bureau of Land Management', 'BLM', ['BLM', 'Bureau of Land Management'], ['energy']],
  ['Interior', 'National Park Service', 'NPS', ['NPS', 'National Park Service'], ['infrastructure']],
  ['Interior', 'U.S. Geological Survey', 'USGS', ['USGS', 'Geological Survey'], ['science', 'water']],
  ['Interior', 'Bureau of Safety and Environmental Enforcement', 'BSEE', ['BSEE', 'Bureau of Safety and Environmental Enforcement'], ['energy']],
  ['Interior', 'Bureau of Ocean Energy Management', 'BOEM', ['BOEM', 'Bureau of Ocean Energy Management'], ['energy']],
  ['Interior', 'Bureau of Indian Affairs', 'BIA', ['Bureau of Indian Affairs'], []],
  ['Interior', 'U.S. Fish and Wildlife Service', 'FWS', ['Fish and Wildlife Service'], []],

  // Commerce
  ['Commerce', 'Department of Commerce (HQ)', 'DOC', ['Department of Commerce', 'U.S. Department of Commerce'], []],
  ['Commerce', 'National Institute of Standards and Technology', 'NIST', ['NIST', 'National Institute of Standards and Technology'], ['cyber', 'science']],
  ['Commerce', 'National Oceanic and Atmospheric Administration', 'NOAA', ['NOAA', 'National Oceanic and Atmospheric Administration', 'National Weather Service'], ['science']],
  ['Commerce', 'Bureau of Industry and Security', 'BIS', ['Bureau of Industry and Security'], ['cyber']],
  ['Commerce', 'National Telecommunications and Information Administration', 'NTIA', ['NTIA', 'National Telecommunications and Information Administration'], ['cyber', 'infrastructure']],
  ['Commerce', 'U.S. Census Bureau', 'Census', ['Census Bureau'], []],
  ['Commerce', 'U.S. Patent and Trademark Office', 'USPTO', ['USPTO', 'Patent and Trademark Office'], []],

  // Transportation
  ['Transportation', 'Department of Transportation (HQ)', 'DOT', ['USDOT', 'U.S. Department of Transportation', 'Department of Transportation'], ['transport']],
  ['Transportation', 'Federal Aviation Administration', 'FAA', ['FAA', 'Federal Aviation Administration'], ['transport', 'cyber']],
  ['Transportation', 'Federal Highway Administration', 'FHWA', ['FHWA', 'Federal Highway Administration'], ['transport', 'infrastructure']],
  ['Transportation', 'Federal Transit Administration', 'FTA', ['Federal Transit Administration'], ['transport']],
  ['Transportation', 'Federal Railroad Administration', 'FRA', ['Federal Railroad Administration'], ['transport']],
  ['Transportation', 'Pipeline and Hazardous Materials Safety Administration', 'PHMSA', ['PHMSA', 'Pipeline and Hazardous Materials Safety'], ['energy', 'transport']],
  ['Transportation', 'Maritime Administration', 'MARAD', ['MARAD', 'Maritime Administration'], ['transport']],

  // Treasury
  ['Treasury', 'Department of the Treasury (HQ)', 'Treasury', ['Department of the Treasury', 'U.S. Treasury', 'US Treasury'], ['finance']],
  ['Treasury', 'Internal Revenue Service', 'IRS', ['IRS', 'Internal Revenue Service'], ['finance']],
  ['Treasury', 'Bureau of the Fiscal Service', 'Fiscal Service', ['Bureau of the Fiscal Service', 'Fiscal Service'], ['finance']],
  ['Treasury', 'U.S. Mint', 'Mint', ['U.S. Mint', 'United States Mint'], ['finance']],
  ['Treasury', 'Bureau of Engraving and Printing', 'BEP', ['Bureau of Engraving and Printing'], ['finance']],
  ['Treasury', 'Office of the Comptroller of the Currency', 'OCC', ['Comptroller of the Currency'], ['finance']],

  // Justice
  ['Justice', 'Department of Justice (HQ)', 'DOJ', ['DOJ', 'Department of Justice', 'U.S. Department of Justice'], []],
  ['Justice', 'Federal Bureau of Investigation', 'FBI', ['FBI', 'Federal Bureau of Investigation'], ['cyber', 'intel']],
  ['Justice', 'Drug Enforcement Administration', 'DEA', ['DEA', 'Drug Enforcement Administration'], []],
  ['Justice', 'Bureau of Alcohol, Tobacco, Firearms and Explosives', 'ATF', ['ATF', 'Bureau of Alcohol, Tobacco, Firearms'], []],
  ['Justice', 'U.S. Marshals Service', 'USMS', ['U.S. Marshals', 'US Marshals'], []],
  ['Justice', 'Federal Bureau of Prisons', 'BOP', ['Bureau of Prisons'], ['infrastructure']],

  // Veterans Affairs
  ['Veterans Affairs', 'Department of Veterans Affairs (HQ)', 'VA', ['Department of Veterans Affairs', 'Veterans Affairs'], ['health']],
  ['Veterans Affairs', 'Veterans Health Administration', 'VHA', ['VHA', 'Veterans Health Administration', 'VA Medical Center'], ['health', 'infrastructure']],
  ['Veterans Affairs', 'Veterans Benefits Administration', 'VBA', ['VBA', 'Veterans Benefits Administration'], []],
  ['Veterans Affairs', 'VA Office of Information and Technology', 'VA OIT', ['VA OIT', 'VA Office of Information and Technology'], ['cyber']],

  // Health and Human Services
  ['Health and Human Services', 'Department of Health and Human Services (HQ)', 'HHS', ['HHS', 'Health and Human Services'], ['health']],
  ['Health and Human Services', 'Centers for Disease Control and Prevention', 'CDC', ['CDC', 'Centers for Disease Control'], ['health']],
  ['Health and Human Services', 'National Institutes of Health', 'NIH', ['NIH', 'National Institutes of Health'], ['health', 'science']],
  ['Health and Human Services', 'Food and Drug Administration', 'FDA', ['FDA', 'Food and Drug Administration'], ['health']],
  ['Health and Human Services', 'Centers for Medicare & Medicaid Services', 'CMS', ['Centers for Medicare'], ['health']],
  ['Health and Human Services', 'Administration for Strategic Preparedness and Response', 'ASPR', ['ASPR', 'Strategic Preparedness and Response'], ['health', 'infrastructure']],

  // Agriculture
  ['Agriculture', 'Department of Agriculture (HQ)', 'USDA', ['USDA', 'Department of Agriculture'], []],
  ['Agriculture', 'Rural Utilities Service', 'RUS', ['Rural Utilities Service', 'USDA Rural Development'], ['energy', 'water']],
  ['Agriculture', 'U.S. Forest Service', 'USFS', ['USFS', 'Forest Service'], []],

  // Other departments
  ['State', 'Department of State', 'State', ['Department of State', 'State Department', 'U.S. Department of State'], []],
  ['Education', 'Department of Education', 'ED', ['Department of Education'], []],
  ['Labor', 'Department of Labor', 'DOL', ['Department of Labor'], []],
  ['Housing and Urban Development', 'Department of Housing and Urban Development', 'HUD', ['HUD', 'Housing and Urban Development'], ['infrastructure']],
];

const isAcronym = a => /^[A-Z0-9&./\- ]+$/.test(a) && /[A-Z]/.test(a) && a.length <= 14;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compiled matchers, built once. */
export function compileFederal(){
  return FEDERAL.map(([dept, name, short, aliases, tags], i) => {
    // the display name always counts, so "DoD Chief Information Officer" as an employer matches
    const all = aliases.includes(name) ? aliases : aliases.concat(isAcronym(name) ? [] : [name]);
    const caps = all.filter(isAcronym), words = all.filter(a => !isAcronym(a));
    const rxCaps = caps.length ? new RegExp(`(^|[^A-Za-z0-9])(${caps.map(esc).join('|')})(?![A-Za-z0-9])`) : null;
    const rxWords = words.length ? new RegExp(`\\b(${words.map(esc).join('|')})\\b`, 'i') : null;
    return {id: 'f' + i, dept, name, short, tags, test: s => (!!rxCaps && rxCaps.test(s)) || (!!rxWords && rxWords.test(s))};
  });
}
