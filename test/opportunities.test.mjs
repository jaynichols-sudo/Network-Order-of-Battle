// SAM.gov opportunities matched to the network, run against the engine bundle the apps ship.
// The fixture is a SAM.gov v2 search answer written on 2026-10-12; its dates are moved to
// today so deadlines stay in the future. Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync('apple/Bearings/Resources/engine.js', 'utf8'))();
const call = (name, ...args) => {
  const r = JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args)));
  if (r.error) throw new Error(`${name}: ${r.error}`);
  return r.ok;
};

const ANCHOR = Date.parse('2026-10-12T12:00:00');
const iso = ms => { const z = new Date(ms); return z.getFullYear() + '-' + String(z.getMonth() + 1).padStart(2, '0') + '-' + String(z.getDate()).padStart(2, '0'); };
const shift = Math.round((Date.parse(iso(Date.now()) + 'T12:00:00') - ANCHOR) / 864e5) * 864e5;
const move = s => s && s.replace(/^\d{4}-\d{2}-\d{2}/, d => iso(Date.parse(d + 'T12:00:00') + shift));
function fixtureText(){
  const j = JSON.parse(fs.readFileSync('test/fixtures/sam-opportunities.json', 'utf8'));
  for (const o of j.opportunitiesData){ o.postedDate = move(o.postedDate); o.responseDeadLine = move(o.responseDeadLine); }
  return JSON.stringify(j);
}
const page = () => call('opportunityPage', fixtureText());
const ALL = ['r', 'p', 'k', 'o', 's', 'a'];

beforeEach(() => {
  call('clearNotes');
  call('loadSample');
  // the sample comes with example pursuits; these tests start without them (see capture.test.mjs)
  for (const p of call('pursuits')) call('removePursuit', p.id);
});

test('opportunities: reads a SAM.gov answer into slim notices', () => {
  const p = page();
  assert.equal(p.total, 9);
  assert.equal(p.items.length, 9);
  const n = p.items[0];
  assert.equal(n.noticeId, 'a1f3c0d2e4b54c7e9f0a1b2c3d4e5f60');
  assert.equal(n.fullParentPathName, 'DEPT OF DEFENSE.DEPT OF THE NAVY.NAVFACSYSCOM.NAVFAC SOUTHEAST');
  assert.ok(!('pointOfContact' in n) && !('links' in n), 'leaves out what Northfix does not use');
  const award = p.items.find(x => x.type === 'Award Notice');
  assert.equal(award.award.awardee, 'EXAMPLE SYSTEMS LLC');
});

test('opportunities: SAM.gov errors come back in plain English', () => {
  const bad = call('opportunityPage', JSON.stringify({error: {code: 'API_KEY_INVALID', message: 'An invalid api_key was supplied.'}}));
  assert.equal(bad.code, 'key');
  assert.match(bad.error, /API key/);
  const rate = call('opportunityPage', JSON.stringify({error: {code: 'OVER_RATE_LIMIT', message: 'You have exceeded your rate limit.'}}));
  assert.equal(rate.code, 'rate');
  assert.match(call('opportunityPage', 'not json').error, /couldn’t read/);
});

test('opportunities: offices map to agencies on the federal map', () => {
  const m = call('matchOpportunities', page().items, {types: ALL, all: true});
  const by = Object.fromEntries(m.items.map(x => [x.sol, x]));
  assert.equal(by.N6945026R0099.agency, 'NAVFAC', 'NAVFACSYSCOM is NAVFAC');
  assert.equal(by.N6945026R0099.office, 'NAVFAC Southeast');
  assert.equal(by.N6945026R0099.area, 'NAVFAC Atlantic', 'Southeast sits under NAVFAC Atlantic on the org chart');
  assert.equal(by.HC102826Q0042.agency, 'DISA');
  assert.equal(by.W912HN26R0007.agency, 'USACE', 'an engineer district is the Corps');
  assert.equal(by.W912HN26R0007.area, 'South Atlantic Division');
  assert.equal(by['70QS0126Q00000011'].agency, 'CISA', 'the most specific office wins over DHS');
  assert.equal(by['70Z0G126C00000001'].agency, 'USCG');
  assert.equal(by['89243126SCR000001'].agency, 'DOE', '"ENERGY, DEPARTMENT OF" reads as the Department of Energy');
  assert.equal(by['1240LU26Q0101'].agency, 'USFS');
  assert.equal(by.HC102826Q0042.title, 'Enterprise Cross Domain Solution Sustainment', 'all-capitals titles read in title case');
});

test('opportunities: plain type labels, deadlines, links and who you know', () => {
  const m = call('matchOpportunities', page().items, {types: ALL});
  const by = Object.fromEntries(m.items.map(x => [x.sol, x]));
  const navfac = by.N6945026R0099;
  assert.equal(navfac.type, 'Sources sought');
  assert.equal(navfac.kind, 'r');
  assert.equal(navfac.days, 10);
  assert.equal(navfac.link, 'https://sam.gov/opp/a1f3c0d2e4b54c7e9f0a1b2c3d4e5f60/view');
  assert.ok(navfac.known > 0, 'the sample network knows people at NAVFAC');
  assert.ok(navfac.people.length > 0 && navfac.people.length <= 3);
  for (let i = 1; i < navfac.people.length; i++) assert.ok(navfac.people[i - 1].score >= navfac.people[i].score, 'closest first');
  const keys = new Set(call('people').map(p => p.k));
  for (const p of navfac.people) assert.ok(keys.has(p.k), 'people are real keys');
  assert.match(navfac.line, /^You know \d+ people there/);
  assert.equal(navfac.watched, true, 'NAVFAC is on the sample watchlist');
  assert.equal(by.HC102826Q0042.type, 'Combined solicitation');
  assert.equal(by.W912HN26R0007.type, 'Presolicitation');
  assert.equal(by.W912HN26R0007.due, '', 'no deadline is fine');
  assert.equal(by['70Z0G126C00000001'].type, 'Award');
  assert.equal(by['89243126SCR000001'].type, 'Special notice');
});

test('opportunities: only agencies you know, no past deadlines, no duplicates', () => {
  const m = call('matchOpportunities', page().items, {types: ALL});
  const sols = m.items.map(x => x.sol);
  assert.ok(!sols.includes('1240LU26Q0101'), 'no one in the sample works at the Forest Service');
  assert.ok(!sols.includes('89503026RBP000123'), 'the deadline has passed');
  assert.equal(sols.filter(s => s === '70QS0126Q00000011').length, 1, 'the same notice twice shows once');
  const everything = call('matchOpportunities', page().items, {types: ALL, all: true});
  assert.ok(everything.items.some(x => x.sol === '1240LU26Q0101'), 'all: true keeps them');
});

test('opportunities: ranked by deadline, people and the watchlist', () => {
  const m = call('matchOpportunities', page().items, {types: ALL});
  for (let i = 1; i < m.items.length; i++) assert.ok(m.items[i - 1].score >= m.items[i].score);
  const by = Object.fromEntries(m.items.map(x => [x.sol, x]));
  assert.ok(by.HC102826Q0042.score > by['70Z0G126C00000001'].score, 'a watched agency due in four days beats an award');
  call('toggleTarget', 'USCG');
  const after = Object.fromEntries(call('matchOpportunities', page().items, {types: ALL}).items.map(x => [x.sol, x]));
  assert.equal(after['70Z0G126C00000001'].watched, true, 'watching an agency counts');
  assert.ok(after['70Z0G126C00000001'].score > by['70Z0G126C00000001'].score);
});

test('opportunities: pursuits at the agency show on the notice', () => {
  call('addPursuit', {name: 'Navy FRCS monitoring', agency: 'NAVFAC'});
  const m = call('matchOpportunities', page().items, {types: ALL});
  const n = m.items.find(x => x.sol === 'N6945026R0099');
  assert.equal(n.pursuit, 'Navy FRCS monitoring');
});

test('opportunities: filters by notice type, NAICS and keyword', () => {
  const items = page().items;
  const ss = call('matchOpportunities', items, {types: ['r']});
  assert.ok(ss.items.length >= 2 && ss.items.every(x => x.kind === 'r'));
  const byDefault = call('matchOpportunities', items, {});
  assert.ok(!byDefault.items.some(x => x.kind === 'a'), 'awards are opt-in');
  const naics = call('matchOpportunities', items, {types: ALL, naics: '5415'});
  assert.ok(naics.items.length && naics.items.every(x => x.naics.startsWith('5415')), 'a NAICS prefix matches its codes');
  const kw = call('matchOpportunities', items, {types: ALL, keywords: 'scada, cross domain'});
  assert.deepEqual(kw.items.map(x => x.sol).sort(), ['HC102826Q0042', 'W912HN26R0007']);
  assert.equal(kw.types.k, 1);
});

test('opportunities: new ones are counted against what was seen', () => {
  const items = page().items;
  const first = call('matchOpportunities', items, {types: ALL});
  assert.equal(first.newCount, 0, 'the first look counts nothing as new');
  assert.equal(first.alerts.length, 0);
  const seen = call('markOpportunitiesSeen', [], first.ids.filter(id => !id.startsWith('d4b6')));
  const next = call('matchOpportunities', items, {types: ALL, seen});
  assert.equal(next.newCount, 1);
  const cisa = next.items.find(x => x.isNew);
  assert.equal(cisa.agency, 'CISA');
  assert.equal(next.alerts.length, 1, 'new, and you know three or more people there');
  assert.match(next.alerts[0].title, /^Sources sought at CISA$/);
  assert.match(next.alerts[0].body, /You know \d+ people there/);
});

test('opportunities: one agency at a time, for its page', () => {
  const items = page().items;
  for (const name of ['NAVFAC', 'Naval Facilities Engineering Command', 'Naval Facilities Engineering Systems Command']){
    const m = call('matchOpportunities', items, {types: ALL, agency: name});
    assert.equal(m.agency.short, 'NAVFAC', name);
    assert.deepEqual(m.items.map(x => x.sol), ['N6945026R0099'], name);
  }
  const none = call('matchOpportunities', items, {types: ALL, agency: 'Duke Energy'});
  assert.equal(none.items.length, 0);
  assert.equal(none.agency, null);
});

test('opportunities: the searches to run stay few', () => {
  const one = call('opportunityRequests', {}, 14);
  assert.equal(one.length, 1);
  assert.match(one[0].postedFrom, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.match(one[0].postedTo, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(one[0].limit, 1000);
  assert.equal(one[0].offset, 0);
  assert.ok(!('ptype' in one[0]), 'several types are filtered on the phone');
  const typed = call('opportunityRequests', {types: ['r']}, 14);
  assert.equal(typed[0].ptype, 'r');
  assert.equal(call('opportunityRequests', {naics: '541512, 541330'}, 14).length, 2);
  assert.equal(call('opportunityRequests', {naics: '5415, 541330'}, 14).length, 1, 'a prefix is filtered on the phone');
  const f = call('opportunityFilters', {naics: '541512; 5415x, 1', keywords: 'OT\nSCADA', types: 'r,zz'});
  assert.deepEqual(f, {naics: ['541512', '5415'], keywords: ['OT', 'SCADA'], types: ['r'], setAsides: [], hideIneligible: false});
});

test('opportunities: the sample network has demo notices, a real one does not', () => {
  const d = call('demoOpportunities');
  assert.ok(d.length >= 5);
  assert.ok(d.every(x => x.demo && x.solicitationNumber.startsWith('SAMPLE-')), 'clearly fictional');
  const m = call('matchOpportunities', d, {});
  assert.ok(m.items.length >= 4, 'they match the sample network');
  assert.ok(m.items.every(x => x.demo));
  assert.ok(m.items.slice(0, 3).every(x => x.known > 0));
  call('load', {mode: 'live', rows: [{f: 'Ada', l: 'Lovelace', c: 'NAVFAC', p: 'Engineer'}], meta: {}});
  assert.deepEqual(call('demoOpportunities'), []);
});
