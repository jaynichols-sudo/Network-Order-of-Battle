// Airports Northfix knows by code: the busiest US airports plus major international hubs.
// Each row: IATA|city|state or country|lat|lon|time zone (US rows take the state's zone
// unless one is given). Used to place a flight's arrival on the map without a geocoder.

const US = `ATL|Atlanta|GA|33.6407|-84.4277
DFW|Dallas|TX|32.8998|-97.0403
DEN|Denver|CO|39.8561|-104.6737
ORD|Chicago|IL|41.9742|-87.9073
LAX|Los Angeles|CA|33.9416|-118.4085
JFK|New York|NY|40.6413|-73.7781
LAS|Las Vegas|NV|36.0840|-115.1537
MCO|Orlando|FL|28.4312|-81.3081
MIA|Miami|FL|25.7959|-80.2870
CLT|Charlotte|NC|35.2140|-80.9431
SEA|Seattle|WA|47.4502|-122.3088
PHX|Phoenix|AZ|33.4342|-112.0116
EWR|Newark|NJ|40.6895|-74.1745
SFO|San Francisco|CA|37.6213|-122.3790
IAH|Houston|TX|29.9902|-95.3368
BOS|Boston|MA|42.3656|-71.0096
FLL|Fort Lauderdale|FL|26.0742|-80.1506
MSP|Minneapolis|MN|44.8848|-93.2223
LGA|New York|NY|40.7769|-73.8740
DTW|Detroit|MI|42.2162|-83.3554
PHL|Philadelphia|PA|39.8744|-75.2424
SLC|Salt Lake City|UT|40.7899|-111.9791
BWI|Baltimore|MD|39.1774|-76.6684
DCA|Washington|DC|38.8512|-77.0402
IAD|Washington|DC|38.9531|-77.4565
SAN|San Diego|CA|32.7338|-117.1933
TPA|Tampa|FL|27.9755|-82.5332
BNA|Nashville|TN|36.1263|-86.6774
AUS|Austin|TX|30.1975|-97.6664
MDW|Chicago|IL|41.7868|-87.7522
HNL|Honolulu|HI|21.3245|-157.9251
DAL|Dallas|TX|32.8471|-96.8518
PDX|Portland|OR|45.5898|-122.5951
STL|St. Louis|MO|38.7499|-90.3748
RDU|Raleigh|NC|35.8801|-78.7880
HOU|Houston|TX|29.6454|-95.2789
SMF|Sacramento|CA|38.6951|-121.5908
MSY|New Orleans|LA|29.9934|-90.2580
SJC|San Jose|CA|37.3639|-121.9289
SJU|San Juan|PR|18.4394|-66.0018
MCI|Kansas City|MO|39.2976|-94.7139
OAK|Oakland|CA|37.7126|-122.2197
SAT|San Antonio|TX|29.5337|-98.4698
RSW|Fort Myers|FL|26.5362|-81.7552
CLE|Cleveland|OH|41.4117|-81.8498
IND|Indianapolis|IN|39.7173|-86.2944
PIT|Pittsburgh|PA|40.4915|-80.2329
CVG|Cincinnati|OH|39.0489|-84.6678
CMH|Columbus|OH|39.9980|-82.8919
SNA|Santa Ana|CA|33.6762|-117.8675
JAX|Jacksonville|FL|30.4941|-81.6879
OGG|Kahului|HI|20.8986|-156.4305
MKE|Milwaukee|WI|42.9472|-87.8966
BDL|Hartford|CT|41.9389|-72.6832
ONT|Ontario|CA|34.0560|-117.6012
PBI|West Palm Beach|FL|26.6832|-80.0956
ABQ|Albuquerque|NM|35.0402|-106.6090
BUR|Burbank|CA|34.2007|-118.3587
ANC|Anchorage|AK|61.1743|-149.9962
OMA|Omaha|NE|41.3032|-95.8941
CHS|Charleston|SC|32.8986|-80.0405
BOI|Boise|ID|43.5644|-116.2228
RIC|Richmond|VA|37.5052|-77.3197
MEM|Memphis|TN|35.0424|-89.9767
ELP|El Paso|TX|31.8072|-106.3776|America/Denver
OKC|Oklahoma City|OK|35.3931|-97.6007
BUF|Buffalo|NY|42.9405|-78.7322
TUS|Tucson|AZ|32.1161|-110.9410
SDF|Louisville|KY|38.1744|-85.7360
LGB|Long Beach|CA|33.8177|-118.1516
KOA|Kailua-Kona|HI|19.7388|-156.0456
GRR|Grand Rapids|MI|42.8808|-85.5228
ORF|Norfolk|VA|36.8946|-76.2012
TUL|Tulsa|OK|36.1984|-95.8881
BHM|Birmingham|AL|33.5629|-86.7535
LIH|Lihue|HI|21.9760|-159.3390
RNO|Reno|NV|39.4991|-119.7681
SAV|Savannah|GA|32.1276|-81.2021
GSP|Greenville|SC|34.8957|-82.2189
DSM|Des Moines|IA|41.5340|-93.6631
ALB|Albany|NY|42.7483|-73.8017
PVD|Providence|RI|41.7240|-71.4282
SYR|Syracuse|NY|43.1112|-76.1063
ROC|Rochester|NY|43.1189|-77.6724
MYR|Myrtle Beach|SC|33.6797|-78.9283
PSP|Palm Springs|CA|33.8297|-116.5070
PNS|Pensacola|FL|30.4734|-87.1866|America/Chicago
LIT|Little Rock|AR|34.7294|-92.2243
SRQ|Sarasota|FL|27.3954|-82.5544
GEG|Spokane|WA|47.6199|-117.5338
PWM|Portland|ME|43.6462|-70.3093
MHT|Manchester|NH|42.9326|-71.4357
ECP|Panama City|FL|30.3571|-85.7955|America/Chicago
ICT|Wichita|KS|37.6499|-97.4331
TYS|Knoxville|TN|35.8110|-83.9940|America/New_York
GSO|Greensboro|NC|36.0978|-79.9373
COS|Colorado Springs|CO|38.8058|-104.7008
LEX|Lexington|KY|38.0365|-84.6059
CAK|Akron|OH|40.9161|-81.4422
DAY|Dayton|OH|39.9024|-84.2194
MSN|Madison|WI|43.1399|-89.3375
HSV|Huntsville|AL|34.6372|-86.7751
SBA|Santa Barbara|CA|34.4262|-119.8404
JAN|Jackson|MS|32.3112|-90.0759
CHA|Chattanooga|TN|35.0353|-85.2038|America/New_York
AVL|Asheville|NC|35.4362|-82.5418
FAT|Fresno|CA|36.7762|-119.7181
MAF|Midland|TX|31.9425|-102.2019
SGF|Springfield|MO|37.2457|-93.3886
BZN|Bozeman|MT|45.7775|-111.1530
EYW|Key West|FL|24.5561|-81.7596
VPS|Destin|FL|30.4832|-86.5254|America/Chicago
HPN|White Plains|NY|41.0670|-73.7076
ISP|Islip|NY|40.7952|-73.1002
ILM|Wilmington|NC|34.2706|-77.9026
CRP|Corpus Christi|TX|27.7704|-97.5012
MOB|Mobile|AL|30.6912|-88.2428
BTR|Baton Rouge|LA|30.5332|-91.1496
FAY|Fayetteville|NC|34.9912|-78.8803
OAJ|Jacksonville|NC|34.8292|-77.6121
EWN|New Bern|NC|35.0730|-77.0429
CAE|Columbia|SC|33.9389|-81.1195
AGS|Augusta|GA|33.3699|-81.9645
ROA|Roanoke|VA|37.3255|-79.9754
CHO|Charlottesville|VA|38.1386|-78.4529
PHF|Newport News|VA|37.1319|-76.4930
TLH|Tallahassee|FL|30.3965|-84.3503
GNV|Gainesville|FL|29.6900|-82.2718
DAB|Daytona Beach|FL|29.1799|-81.0581
MLB|Melbourne|FL|28.1028|-80.6453
PIE|St. Petersburg|FL|27.9102|-82.6874
SFB|Sanford|FL|28.7776|-81.2375
LAN|Lansing|MI|42.7787|-84.5874
FWA|Fort Wayne|IN|40.9785|-85.1951
SBN|South Bend|IN|41.7087|-86.3173
EVV|Evansville|IN|38.0370|-87.5324|America/Chicago
CID|Cedar Rapids|IA|41.8847|-91.7108
FSD|Sioux Falls|SD|43.5820|-96.7419
FAR|Fargo|ND|46.9207|-96.8158
BIL|Billings|MT|45.8077|-108.5430
MSO|Missoula|MT|46.9163|-114.0906
JAC|Jackson|WY|43.6073|-110.7377
EGE|Vail|CO|39.6426|-106.9177
ASE|Aspen|CO|39.2232|-106.8688
SAF|Santa Fe|NM|35.6171|-106.0894
LBB|Lubbock|TX|33.6636|-101.8228
AMA|Amarillo|TX|35.2194|-101.7059
HRL|Harlingen|TX|26.2285|-97.6544
MFE|McAllen|TX|26.1758|-98.2386
GRK|Killeen|TX|31.0672|-97.8289
SHV|Shreveport|LA|32.4466|-93.8256
LFT|Lafayette|LA|30.2053|-91.9876
XNA|Fayetteville|AR|36.2819|-94.3068
STS|Santa Rosa|CA|38.5090|-122.8129
SBP|San Luis Obispo|CA|35.2368|-120.6424
MRY|Monterey|CA|36.5870|-121.8429
EUG|Eugene|OR|44.1246|-123.2190
RDM|Bend|OR|44.2541|-121.1500
MFR|Medford|OR|42.3742|-122.8735
BLI|Bellingham|WA|48.7928|-122.5375
PSC|Pasco|WA|46.2647|-119.1190
FAI|Fairbanks|AK|64.8151|-147.8561
JNU|Juneau|AK|58.3550|-134.5763
ITO|Hilo|HI|19.7203|-155.0485
GUM|Hagatna|GU|13.4834|144.7960
STT|St. Thomas|VI|18.3373|-64.9734
BGR|Bangor|ME|44.8074|-68.8281
BTV|Burlington|VT|44.4720|-73.1533
ACK|Nantucket|MA|41.2531|-70.0602
ABE|Allentown|PA|40.6524|-75.4404
MDT|Harrisburg|PA|40.1935|-76.7634
ACY|Atlantic City|NJ|39.4576|-74.5772
TTN|Trenton|NJ|40.2767|-74.8135
SWF|Newburgh|NY|41.5041|-74.1048
PIA|Peoria|IL|40.6642|-89.6933
BMI|Bloomington|IL|40.4771|-88.9159
MLI|Moline|IL|41.4485|-90.5075
RFD|Rockford|IL|42.1954|-89.0972
GRB|Green Bay|WI|44.4851|-88.1296
ATW|Appleton|WI|44.2581|-88.5191
DLH|Duluth|MN|46.8421|-92.1936
RST|Rochester|MN|43.9083|-92.5000
LNK|Lincoln|NE|40.8510|-96.7592
FLG|Flagstaff|AZ|35.1385|-111.6712
AZA|Mesa|AZ|33.3078|-111.6550
PGD|Punta Gorda|FL|26.9202|-81.9905
GPT|Gulfport|MS|30.4073|-89.0701
MGM|Montgomery|AL|32.3006|-86.3940
CSG|Columbus|GA|32.5163|-84.9389
TRI|Bristol|TN|36.4752|-82.4074|America/New_York`;

const INTL = `LHR|London|United Kingdom|51.4700|-0.4543|Europe/London
LGW|London|United Kingdom|51.1537|-0.1821|Europe/London
MAN|Manchester|United Kingdom|53.3650|-2.2725|Europe/London
EDI|Edinburgh|United Kingdom|55.9500|-3.3725|Europe/London
DUB|Dublin|Ireland|53.4264|-6.2499|Europe/Dublin
CDG|Paris|France|49.0097|2.5479|Europe/Paris
ORY|Paris|France|48.7262|2.3652|Europe/Paris
FRA|Frankfurt|Germany|50.0379|8.5622|Europe/Berlin
MUC|Munich|Germany|48.3537|11.7750|Europe/Berlin
BER|Berlin|Germany|52.3667|13.5033|Europe/Berlin
STR|Stuttgart|Germany|48.6899|9.2220|Europe/Berlin
AMS|Amsterdam|Netherlands|52.3105|4.7683|Europe/Amsterdam
BRU|Brussels|Belgium|50.9014|4.4844|Europe/Brussels
MAD|Madrid|Spain|40.4983|-3.5676|Europe/Madrid
BCN|Barcelona|Spain|41.2974|2.0833|Europe/Madrid
LIS|Lisbon|Portugal|38.7742|-9.1342|Europe/Lisbon
FCO|Rome|Italy|41.8003|12.2389|Europe/Rome
MXP|Milan|Italy|45.6301|8.7255|Europe/Rome
NAP|Naples|Italy|40.8860|14.2908|Europe/Rome
ZRH|Zurich|Switzerland|47.4582|8.5555|Europe/Zurich
GVA|Geneva|Switzerland|46.2381|6.1090|Europe/Zurich
VIE|Vienna|Austria|48.1103|16.5697|Europe/Vienna
CPH|Copenhagen|Denmark|55.6180|12.6508|Europe/Copenhagen
ARN|Stockholm|Sweden|59.6498|17.9238|Europe/Stockholm
OSL|Oslo|Norway|60.1976|11.1004|Europe/Oslo
HEL|Helsinki|Finland|60.3172|24.9633|Europe/Helsinki
KEF|Reykjavik|Iceland|63.9850|-22.6056|Atlantic/Reykjavik
WAW|Warsaw|Poland|52.1657|20.9671|Europe/Warsaw
PRG|Prague|Czechia|50.1008|14.2600|Europe/Prague
ATH|Athens|Greece|37.9364|23.9445|Europe/Athens
IST|Istanbul|Turkey|41.2753|28.7519|Europe/Istanbul
TLV|Tel Aviv|Israel|32.0055|34.8854|Asia/Jerusalem
DXB|Dubai|United Arab Emirates|25.2532|55.3657|Asia/Dubai
AUH|Abu Dhabi|United Arab Emirates|24.4330|54.6511|Asia/Dubai
DOH|Doha|Qatar|25.2731|51.6081|Asia/Qatar
RUH|Riyadh|Saudi Arabia|24.9576|46.6988|Asia/Riyadh
CAI|Cairo|Egypt|30.1219|31.4056|Africa/Cairo
NBO|Nairobi|Kenya|-1.3192|36.9278|Africa/Nairobi
JNB|Johannesburg|South Africa|-26.1367|28.2411|Africa/Johannesburg
CPT|Cape Town|South Africa|-33.9715|18.6021|Africa/Johannesburg
DEL|Delhi|India|28.5562|77.1000|Asia/Kolkata
BOM|Mumbai|India|19.0896|72.8656|Asia/Kolkata
BLR|Bengaluru|India|13.1986|77.7066|Asia/Kolkata
SIN|Singapore|Singapore|1.3644|103.9915|Asia/Singapore
KUL|Kuala Lumpur|Malaysia|2.7456|101.7099|Asia/Kuala_Lumpur
BKK|Bangkok|Thailand|13.6900|100.7501|Asia/Bangkok
MNL|Manila|Philippines|14.5086|121.0194|Asia/Manila
HKG|Hong Kong|Hong Kong|22.3080|113.9185|Asia/Hong_Kong
TPE|Taipei|Taiwan|25.0797|121.2342|Asia/Taipei
PEK|Beijing|China|40.0799|116.6031|Asia/Shanghai
PVG|Shanghai|China|31.1443|121.8083|Asia/Shanghai
ICN|Seoul|South Korea|37.4602|126.4407|Asia/Seoul
NRT|Tokyo|Japan|35.7720|140.3929|Asia/Tokyo
HND|Tokyo|Japan|35.5494|139.7798|Asia/Tokyo
KIX|Osaka|Japan|34.4320|135.2304|Asia/Tokyo
SYD|Sydney|Australia|-33.9399|151.1753|Australia/Sydney
MEL|Melbourne|Australia|-37.6690|144.8410|Australia/Melbourne
BNE|Brisbane|Australia|-27.3842|153.1175|Australia/Brisbane
AKL|Auckland|New Zealand|-37.0082|174.7850|Pacific/Auckland
YYZ|Toronto|ON|43.6777|-79.6248|America/Toronto
YOW|Ottawa|ON|45.3225|-75.6692|America/Toronto
YUL|Montreal|QC|45.4706|-73.7408|America/Toronto
YVR|Vancouver|BC|49.1967|-123.1815|America/Vancouver
YYC|Calgary|AB|51.1215|-114.0076|America/Edmonton
YEG|Edmonton|AB|53.3097|-113.5797|America/Edmonton
YHZ|Halifax|NS|44.8808|-63.5086|America/Halifax
MEX|Mexico City|Mexico|19.4361|-99.0719|America/Mexico_City
CUN|Cancun|Mexico|21.0365|-86.8771|America/Cancun
GDL|Guadalajara|Mexico|20.5218|-103.3112|America/Mexico_City
SJD|Los Cabos|Mexico|23.1518|-109.7215|America/Mazatlan
PVR|Puerto Vallarta|Mexico|20.6801|-105.2544|America/Mexico_City
NAS|Nassau|Bahamas|25.0390|-77.4662|America/Nassau
MBJ|Montego Bay|Jamaica|18.5037|-77.9134|America/Jamaica
PUJ|Punta Cana|Dominican Republic|18.5674|-68.3634|America/Santo_Domingo
PTY|Panama City|Panama|9.0714|-79.3835|America/Panama
SJO|San Jose|Costa Rica|9.9939|-84.2088|America/Costa_Rica
BOG|Bogota|Colombia|4.7016|-74.1469|America/Bogota
LIM|Lima|Peru|-12.0219|-77.1143|America/Lima
SCL|Santiago|Chile|-33.3930|-70.7858|America/Santiago
EZE|Buenos Aires|Argentina|-34.8222|-58.5358|America/Argentina/Buenos_Aires
GRU|Sao Paulo|Brazil|-23.4356|-46.4731|America/Sao_Paulo
GIG|Rio de Janeiro|Brazil|-22.8100|-43.2506|America/Sao_Paulo`;

const STATE_TZ = {
  'America/New_York': 'CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV',
  'America/Chicago': 'AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI',
  'America/Denver': 'CO ID MT NM UT WY',
  'America/Phoenix': 'AZ',
  'America/Los_Angeles': 'CA NV OR WA',
  'America/Anchorage': 'AK', 'Pacific/Honolulu': 'HI', 'America/Puerto_Rico': 'PR', 'America/St_Thomas': 'VI', 'Pacific/Guam': 'GU',
};
const tzOf = {};
for (const [tz, list] of Object.entries(STATE_TZ)) for (const st of list.split(' ')) tzOf[st] = tz;

/** code → {code, city, region, name ("San Diego, CA"), lat, lon, tz, us}, in busiest-first order. */
export const AIRPORTS = new Map();
for (const [block, us] of [[US, true], [INTL, false]]){
  for (const line of block.split('\n')){
    const [code, city, region, lat, lon, tz] = line.split('|');
    AIRPORTS.set(code, {code, city, region, name: `${city}, ${region}`, lat: +lat, lon: +lon, tz: tz || tzOf[region] || '', us});
  }
}

export const airport = code => AIRPORTS.get(String(code || '').toUpperCase()) || null;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\bst\.?\s/g, 'st ').replace(/\bsaint\s/g, 'st ').replace(/[^a-z0-9]+/g, ' ').trim();
const byCity = new Map();
for (const a of AIRPORTS.values()){ const k = norm(a.city); if (!byCity.has(k)) byCity.set(k, []); byCity.get(k).push(a); }
const STATE_NAMES = {alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'd c': 'DC', 'puerto rico': 'PR'};
const ALIASES = {'washington dc': 'washington', 'washington d c': 'washington', nyc: 'new york', 'new york city': 'new york', 'la': 'los angeles', 'sf': 'san francisco', 'philly': 'philadelphia', 'vegas': 'las vegas', 'dc': 'washington', 'saint louis': 'st louis', 'st louis': 'st louis', 'fort cavazos': 'killeen', 'fort hood': 'killeen', 'fort liberty': 'fayetteville', 'fort bragg': 'fayetteville', 'camp lejeune': 'jacksonville', 'cherry point': 'new bern', 'orange county': 'santa ana', 'bentonville': 'fayetteville', 'reykjavík': 'reykjavik', 'bogotá': 'bogota', 'são paulo': 'sao paulo', 'zürich': 'zurich', 'montréal': 'montreal', 'cancún': 'cancun', 'bangalore': 'bengaluru', 'new delhi': 'delhi', 'dubai uae': 'dubai'};

/** The main airport for a city name, like "San Diego", "San Diego, CA" or "London, UK".
 *  With a state or country given, only that one matches. Null when unknown. */
export function airportByCity(text){
  const parts = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  let name = norm(parts[0]);
  name = ALIASES[name] ? norm(ALIASES[name]) : name;
  const list = byCity.get(name);
  if (!list) return null;
  const regRaw = parts[1] ? parts[1].replace(/\./g, '').trim() : '';
  if (!regRaw) return list[0];
  const r = norm(regRaw), up = regRaw.toUpperCase();
  const code = /^[A-Z]{2}$/.test(up) ? up : STATE_NAMES[r] || '';
  const hit = list.find(a => (code && a.region === code) || norm(a.region) === r || (r === 'uk' && a.region === 'United Kingdom') || (['usa', 'us', 'united states'].includes(r) && a.us));
  // "Washington, DC area" or a region we don't recognize: fall back only for a unique city
  return hit || (code || STATE_NAMES[r] ? null : list.length === 1 || list.every(a => a.region === list[0].region) ? list[0] : null);
}
