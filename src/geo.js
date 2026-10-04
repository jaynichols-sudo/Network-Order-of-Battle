// Where people probably are, for the Android and web app. Same approach as the
// Apple apps: phone prefixes (Google libphonenumber data) and city coordinates
// (GeoNames), bundled offline in www/geo/, matched against the phone's contacts.

let phoneData = null, cityIndex = null, loading = null;
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function loadGeo(){
  if (phoneData && cityIndex) return;
  if (!loading) loading = (async () => {
    const [p, c] = await Promise.all([fetch('geo/geo-phone.json').then(r => r.json()), fetch('geo/geo-cities.json').then(r => r.json())]);
    phoneData = p;
    cityIndex = new Map();
    for (const [n, a, cc, lat, lon, pop] of c){
      const k = norm(n);
      for (const key of [`${k}|${a}|${cc}`, `${k}||${cc}`]){ const cur = cityIndex.get(key); if (!cur || cur[2] < pop) cityIndex.set(key, [lat, lon, pop]); }
    }
  })();
  await loading;
}

const US = {alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY'};
const COUNTRY = {'united states': 'US', usa: 'US', 'u s a': 'US', 'united kingdom': 'GB', uk: 'GB', england: 'GB', canada: 'CA', germany: 'DE', israel: 'IL', japan: 'JP', australia: 'AU', france: 'FR', italy: 'IT', spain: 'ES', 'south korea': 'KR', korea: 'KR', india: 'IN', singapore: 'SG', 'united arab emirates': 'AE', netherlands: 'NL', belgium: 'BE', poland: 'PL', mexico: 'MX', brazil: 'BR'};

/** A city by name with an optional state or province code, in a country (ISO code). */
export function city(name, admin = '', cc = 'US'){
  if (!cityIndex) return null;
  const k = norm(name);
  const hit = (admin && cityIndex.get(`${k}|${admin.toUpperCase()}|${cc}`)) || (!admin && cityIndex.get(`${k}||${cc}`));
  return hit ? {lat: hit[0], lon: hit[1]} : null;
}

/** "Tampa, FL", "London", "Stuttgart, Germany": an offline lookup for places people type. */
export function lookup(text){
  const parts = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length || !cityIndex) return null;
  const name = parts[0], rest = (parts[1] || '').trim();
  if (/^[A-Za-z]{2}$/.test(rest)){ const c = city(name, rest.toUpperCase(), 'US'); if (c) return {name: `${name}, ${rest.toUpperCase()}`, ...c}; }
  if (rest && US[rest.toLowerCase()]){ const st = US[rest.toLowerCase()]; const c = city(name, st, 'US'); if (c) return {name: `${name}, ${st}`, ...c}; }
  const cc = rest ? (COUNTRY[norm(rest)] || (rest.length === 2 ? rest.toUpperCase() : '')) : '';
  if (cc){ const c = city(name, '', cc); if (c) return {name: `${name}, ${rest}`, ...c}; }
  for (const guess of ['US', 'GB', 'CA', 'DE', 'IL', 'AU', 'FR', 'JP', 'SG', 'AE']){ const c = city(name, '', guess); if (c) return {name: guess === 'US' ? name : `${name}, ${guess}`, ...c}; }
  return null;
}

/** A place for a phone number. Numbers without a country code are read as North American. */
export function phonePlace(raw){
  if (!phoneData) return null;
  let s = String(raw || '').trim(), d = s.replace(/\D/g, '');
  if (s.startsWith('+')){} else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('011')) d = d.slice(3);
  else if (d.length === 10) d = '1' + d; else if (!(d.length === 11 && d.startsWith('1'))) return null;
  for (let n = 1; n <= 3 && n < d.length; n++){
    const map = phoneData.cc[d.slice(0, n)]; if (!map) continue;
    const nat = d.slice(n);
    for (let len = Math.min(nat.length, 9); len > 0; len--){ const i = map[nat.slice(0, len)]; if (i != null){ const p = phoneData.places[i]; return {name: p[0], lat: p[1], lon: p[2], prec: p[3], src: 'phone'}; } }
    return null;
  }
  return null;
}

export function addressPlace(a){
  const c = (a.city || '').trim(); if (!c) return null;
  const cc = COUNTRY[norm(a.country)] || ((a.country || '').length === 2 ? a.country.toUpperCase() : 'US');
  let st = (a.region || '').trim(); if (cc === 'US' && st.length > 2) st = US[st.toLowerCase()] || '';
  const hit = (cc === 'US' && st && city(c, st, cc)) || city(c, '', cc);
  return hit ? {name: cc === 'US' && st ? `${c}, ${st}` : `${c}, ${a.country || cc}`, lat: hit.lat, lon: hit.lon, prec: 'city', src: 'address'} : null;
}

/** Matches network rows to phone contacts (email first, then a unique name) and works out a place for each. */
export function placesFromContacts(rows, contacts){
  const byEmail = new Map(), byName = new Map();
  for (const c of contacts){
    for (const e of c.emails || []) if (e.address) byEmail.set(e.address.toLowerCase(), c);
    const n = norm(`${(c.name && c.name.given) || ''} ${(c.name && c.name.family) || ''}`);
    if (n.includes(' ')){ const l = byName.get(n) || []; l.push(c); byName.set(n, l); }
  }
  const out = {}; let matched = 0;
  const rank = t => ({work: 0, company_main: 1, main: 1, mobile: 2, work_mobile: 2}[t] ?? 3);
  for (const r of rows){
    if (r.x) continue;
    let card = r.e ? byEmail.get(r.e.toLowerCase()) : null;
    if (!card){ const l = byName.get(norm(`${r.f} ${r.l}`)); if (l && l.length === 1) card = l[0]; else if (l) card = l.find(c => norm(c.organization && c.organization.company) === norm(r.c)); }
    if (!card) continue;
    matched++;
    const addr = (card.postalAddresses || []).slice().sort((a, b) => (a.type === 'work' ? 0 : 1) - (b.type === 'work' ? 0 : 1)).map(addressPlace).find(Boolean);
    if (addr){ out[r.k] = addr; continue; }
    const found = (card.phones || []).slice().sort((a, b) => rank(a.type) - rank(b.type)).map(p => phonePlace(p.number)).filter(Boolean);
    const best = found.find(p => p.prec === 'city') || found[0];
    if (best) out[r.k] = best;
  }
  return {places: out, matched};
}

export function miles(a, b){
  const R = 3958.8, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLon = (b.lon - a.lon) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
