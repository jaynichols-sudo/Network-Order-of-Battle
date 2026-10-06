// Renders the Android app (the built www/ folder) headless with the sample network and
// saves raw phone screenshots for the Play listing, plus extra screens for checking.
// usage: npm run build && node store/play/shoot.mjs <out dir> [light|dark] [store|all]
// Needs Playwright with Chromium. Set PLAYWRIGHT to its index.mjs if it isn't installed here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [out = 'store/play/raw', scheme = 'light', which = 'store'] = process.argv.slice(2);
const pw = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.mjs');
const chromium = pw.chromium || (pw.default && pw.default.chromium);
fs.mkdirSync(out, {recursive: true});

/* ---------- a tiny static server for www/ ---------- */
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml'};
const server = http.createServer((req, res) => {
  const p = path.join('www', decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  fs.readFile(p.endsWith(path.sep) || p === 'www' ? path.join(p, 'index.html') : p, (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': TYPES[path.extname(p)] || 'application/octet-stream'}); res.end(data);
  });
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

/* ---------- sample events and a trip, dated around today ---------- */
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(14, 20, 0, 0); return d.toISOString(); };
const met = (id, k, name, company, title, note, followed = false, at = iso(-2)) => ({id, k, name, company, title, email: '', phone: '', note, at, followed});
const events = [
  {id: 'ev-technet', name: 'AFCEA TechNet Augusta', place: 'Augusta, GA', start: day(-4), end: day(-2),
    attending: ['sample-282', 'sample-667', 'sample-572'],
    met: [
      met('m1', 'sample-652', 'Steven Boyd', 'Defense Information Systems Agency', 'Senior Executive Service, Director', 'Wants a follow-up demo for the OT team in November.'),
      met('m2', 'sample-550', 'Maria Dawson', 'Office of the Secretary of Defense', 'Policy Analyst, Critical Infrastructure', 'Send her the water sector brief.', true),
      met('m3', 'sample-115', 'Holly Tran', 'North Carolina State University', 'Professor of Electrical Engineering', 'Grad students for the spring internship.'),
      met('m4', undefined, 'Dana Whitfield', 'Fort Eisenhower', 'Network Operations Lead', 'Met at the Army Cyber booth. Interested in one-way gateways.', false, iso(-1)),
    ]},
  {id: 'ev-milcom', name: 'MILCOM 2026', place: 'Washington, DC', start: day(20), end: day(22), attending: ['sample-652', 'sample-33', 'sample-488', 'sample-667'], met: []},
];
const trips = [{id: 'you-dc', city: 'Washington, DC', lat: 38.8951, lon: -77.0364, start: day(9), end: day(11), source: 'you'}];
const births = {'sample-660': day(1).slice(5), 'sample-492': day(4).slice(5)};

const browser = await chromium.launch();
const errors = [];
async function page({births: withBirths = false} = {}){
  const ctx = await browser.newContext({viewport: {width: 412, height: 892}, deviceScaleFactor: 2.625, colorScheme: scheme, isMobile: true, hasTouch: true, reducedMotion: 'reduce'});
  await ctx.route(/tile\.openstreetmap\.org/, r => r.abort());
  await ctx.addInitScript(([ev, tr, bd]) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('bearings.onboarded', '1');
    localStorage.setItem('bearings.v2', 'x');
    localStorage.setItem('oob.prefs', JSON.stringify({name: 'Jay Nichols'}));
    localStorage.setItem('bearings.explore', 'compass');
    localStorage.setItem('oob.events.json', JSON.stringify(ev));
    localStorage.setItem('bearings.trips', JSON.stringify(tr));
    if (bd) localStorage.setItem('oob.places.json', JSON.stringify({v: 1, built: '', people: {}, births: bd}));
  }, [events, trips, withBirths ? births : null]);
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(`${m.text()}`); });
  p.on('pageerror', e => errors.push(String(e)));
  return p;
}
const settle = p => p.waitForTimeout(700);
async function shot(p, name){ await settle(p); await p.screenshot({path: path.join(out, `${name}.png`)}); console.log('shot', name); }
async function go(p, q){ await p.goto(base + 'index.html' + q); await p.waitForSelector('#app .screen:not([hidden])'); await settle(p); }

const scenes = {
  async today(p){ await go(p, '?tab=home'); await shot(p, '01-today'); },
  async person(p){ await go(p, '?tab=people&person=sample-652'); await shot(p, '02-person'); },
  async people(p){ await go(p, '?tab=people'); await shot(p, '03-people'); },
  async compass(p){ await go(p, '?tab=explore'); await p.waitForTimeout(1200); await shot(p, '04-compass'); },
  async event(p){ await go(p, '?tab=home'); await p.click('[data-a="event"][data-v="ev-technet"]'); await p.waitForTimeout(500); await shot(p, '05-event'); },
  async catchup(p){ await go(p, '?tab=catchup'); await p.waitForTimeout(800); await shot(p, '06-catchup'); },
};
const extra = {
  async todayBirthdays(p){ await go(p, '?tab=home'); await p.evaluate(() => { const sc = document.querySelector('.screen[data-tab="home"]'); sc.scrollTop = document.querySelector('.chips-slot').offsetTop - 120; }); await shot(p, 'x-today-chips'); },
  async you(p){ await go(p, '?tab=you'); await shot(p, 'x-you'); },
  async events(p){ await go(p, '?tab=you'); await p.click('[data-a="events"]'); await p.waitForTimeout(500); await shot(p, 'x-events'); },
  async eventTop(p){ await go(p, '?tab=home'); await p.click('[data-a="event"][data-v="ev-technet"]'); await p.waitForTimeout(500); await shot(p, 'x-event-top'); await p.evaluate(() => { document.querySelector('.page:last-of-type .page-body').scrollTop = 99999; }); await shot(p, 'x-event-bottom'); },
  async newEvent(p){ await go(p, '?tab=you'); await p.click('[data-a="events"]'); await p.waitForTimeout(400); await p.click('.bar-act'); await p.waitForTimeout(600); await shot(p, 'x-new-event'); },
  async metForm(p){ await go(p, '?tab=home'); await p.click('[data-a="event"][data-v="ev-technet"]'); await p.waitForTimeout(400); await p.click('[data-a="addNew"]'); await p.waitForTimeout(600); await shot(p, 'x-met-form'); },
  async picker(p){ await go(p, '?tab=home'); await p.click('[data-a="event"][data-v="ev-technet"]'); await p.waitForTimeout(400); await p.click('[data-a="addKnown"]'); await p.waitForTimeout(500); await p.fill('.sheet input[type=search]', 'boyd'); await shot(p, 'x-picker'); await p.click('.sheet [data-a="pick"]'); await p.waitForTimeout(700); await shot(p, 'x-met-known'); },
  async paste(p){ await go(p, '?tab=home'); await p.click('[data-a="event"][data-v="ev-milcom"]'); await p.waitForTimeout(400); await p.click('[data-a="loadList"]'); await p.waitForTimeout(300); await p.click('.menu button[data-i="0"]'); await p.waitForTimeout(500); await p.fill('.sheet textarea', 'Name,Email\nGeorge Lowe,glowe@example.com\nTravis Rhodes\nnobody@example.org'); await shot(p, 'x-paste'); await p.click('.sheet [data-sb="r"]'); await p.waitForTimeout(900); await shot(p, 'x-after-paste'); },
  async trips(p){ await go(p, '?tab=you'); await p.click('[data-a="trips"]'); await p.waitForTimeout(500); await shot(p, 'x-trips'); },
  async trip(p){ await go(p, '?tab=home'); await p.click('[data-a="trip"]'); await p.waitForTimeout(900); await shot(p, 'x-trip'); await p.click('.page:last-of-type [data-a="write"]'); await p.waitForTimeout(600); await shot(p, 'x-trip-message'); },
  async bdaySheet(p){ await go(p, '?tab=you'); await p.click('[data-a="birthdays"]'); await p.waitForTimeout(600); await shot(p, 'x-birthdays'); },
};
for (const [name, fn] of Object.entries(scenes)){ const p = await page(); try { await fn(p); } catch (e) { errors.push(`${name}: ${e.message}`); } await p.context().close(); }
if (which === 'all') for (const [name, fn] of Object.entries(extra)){ const p = await page({births: true}); try { await fn(p); } catch (e) { errors.push(`${name}: ${e.message}`); } await p.context().close(); }
await browser.close();
server.close();
if (errors.length){ console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
else console.log('no console errors');
