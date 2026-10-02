// Builds the offline place data the native app uses to guess where contacts are.
//   phone prefixes -> place  (Google libphonenumber geocoding data, Apache 2.0)
//   place names    -> lat/lon (GeoNames cities via all-the-cities, CC BY 4.0)
// Usage: node scripts/build-geo.mjs <libphonenumber-geo-carrier dir> <all-the-cities dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const [geoDir, citiesDir] = process.argv.slice(2);
const require = createRequire(path.join(citiesDir, 'index.js'));
const cities = require(path.join(citiesDir, 'index.js'));
const BSON = require('bson');
const { getCountries, getCountryCallingCode } = require('libphonenumber-js');

const CA = {AB: '01', BC: '02', MB: '03', NB: '04', NL: '05', NS: '07', ON: '08', PE: '09', QC: '10', SK: '11', YT: '12', NT: '13', NU: '14'};
const US_STATES = {Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', 'Washington State': 'WA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY'};
const CA_PROV = {Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB', 'Newfoundland and Labrador': 'NL', Newfoundland: 'NL', 'Nova Scotia': 'NS', Ontario: 'ON', 'Prince Edward Island': 'PE', Quebec: 'QC', Saskatchewan: 'SK', Yukon: 'YT', 'Northwest Territories': 'NT', Nunavut: 'NU'};
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// index cities by name (and alternate name) per country
const byName = new Map(), adminPts = new Map(), countryPts = new Map();
for (const c of cities){
  const [lon, lat] = c.loc.coordinates;
  for (const n of [c.name, c.altName].filter(Boolean)){
    const k = c.country + '|' + norm(n);
    const cur = byName.get(k); if (!cur) byName.set(k, [c]); else cur.push(c);
  }
  const ak = c.country + '|' + c.adminCode; const a = adminPts.get(ak) || {w: 0, lat: 0, lon: 0}; const w = Math.max(c.population, 1); a.w += w; a.lat += lat * w; a.lon += lon * w; adminPts.set(ak, a);
  const ck = c.country; const b = countryPts.get(ck) || {w: 0, lat: 0, lon: 0}; b.w += w; b.lat += lat * w; b.lon += lon * w; countryPts.set(ck, b);
}
const centroid = m => m && m.w ? [+(m.lat / m.w).toFixed(4), +(m.lon / m.w).toFixed(4)] : null;
const best = (countries, name, admin) => {
  let top = null;
  for (const cc of countries) for (const c of byName.get(cc + '|' + norm(name)) || []){
    if (admin && c.adminCode !== admin) continue;
    if (!top || c.population > top.population) top = c;
  }
  return top;
};
const ccCountries = {};
for (const c of getCountries()){ const cc = getCountryCallingCode(c); (ccCountries[cc] = ccCountries[cc] || []).push(c); }

const places = [], placeIdx = new Map();
const addPlace = (name, lat, lon, prec) => { const key = name + '|' + prec; if (placeIdx.has(key)) return placeIdx.get(key); const i = places.length; places.push([name, +lat.toFixed(4), +lon.toFixed(4), prec]); placeIdx.set(key, i); return i; };
const countryName = new Intl.DisplayNames(['en'], {type: 'region'});

function resolve(desc, cc){
  const countries = ccCountries[cc] || [];
  if (desc === 'Washington D.C.') { const c = best(['US'], 'Washington', 'DC') || best(['US'], 'Washington, D.C.', 'DC'); return c && addPlace('Washington, DC', c.loc.coordinates[1], c.loc.coordinates[0], 'city'); }
  let m = desc.match(/^(.+), ([A-Z]{2})$/);
  if (m && cc === '1'){
    const [, city, st] = m;
    const c = CA[st] ? best(['CA'], city, CA[st]) : best(['US'], city, st);
    if (c) return addPlace(`${city}, ${st}`, c.loc.coordinates[1], c.loc.coordinates[0], 'city');
    const reg = centroid(adminPts.get((CA[st] ? 'CA|' + CA[st] : 'US|' + st)));
    return reg ? addPlace(`${city}, ${st}`, reg[0], reg[1], 'region') : null;
  }
  if (cc === '1' && US_STATES[desc]){ const r = centroid(adminPts.get('US|' + US_STATES[desc])); return r && addPlace(desc.replace(' State', ''), r[0], r[1], 'region'); }
  if (cc === '1' && CA_PROV[desc]){ const r = centroid(adminPts.get('CA|' + CA[CA_PROV[desc]])); return r && addPlace(desc, r[0], r[1], 'region'); }
  // "City" or "City, Region" elsewhere
  const name = desc.split(',')[0].trim();
  const c = best(countries, name);
  if (c){ const label = countries.length === 1 || countries[0] === c.country ? `${desc}, ${countryName.of(c.country)}` : desc; return addPlace(label, c.loc.coordinates[1], c.loc.coordinates[0], 'city'); }
  for (const iso of countries){ if (norm(countryName.of(iso) || '') === norm(desc)){ const r = centroid(countryPts.get(iso)); return r && addPlace(desc, r[0], r[1], 'region'); } }
  return null;
}

const out = {};
let total = 0, hit = 0;
const dir = path.join(geoDir, 'resources/geocodes/en');
for (const f of fs.readdirSync(dir)){
  const cc = f.replace('.bson', '');
  const d = BSON.deserialize(fs.readFileSync(path.join(dir, f)));
  const map = {};
  for (const [prefix, desc] of Object.entries(d)){
    total++;
    const i = resolve(desc, cc);
    if (i != null){ map[prefix] = i; hit++; }
  }
  if (Object.keys(map).length) out[cc] = map;
}
// city lookup for postal addresses and titles: bigger towns only, keyed "name|admin|country"
const cityList = cities.filter(c => c.population >= 15000).map(c => [c.name, c.adminCode, c.country, +c.loc.coordinates[1].toFixed(4), +c.loc.coordinates[0].toFixed(4), c.population]);
const outDir = 'apple/Bearings/Resources';
fs.writeFileSync(path.join(outDir, 'geo-phone.json'), JSON.stringify({places, cc: out}));
fs.writeFileSync(path.join(outDir, 'geo-cities.json'), JSON.stringify(cityList));
console.log(`phone prefixes ${hit}/${total}, places ${places.length}, cities ${cityList.length}`);
