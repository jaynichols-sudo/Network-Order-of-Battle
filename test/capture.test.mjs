// Capture features: industry seats, the pipeline, cold seats, the pursuit one-pager, call plans,
// event attendee lists, and recompetes and teaming partners from USASpending.gov. Run against
// the engine bundle the apps ship. Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync('apple/Bearings/Resources/engine.js', 'utf8'))();
const call = (name, ...args) => {
  const r = JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args)));
  if (r.error) throw new Error(`${name}: ${r.error}`);
  return r.ok;
};
const today = () => call('info').today;
const day = n => new Date(Date.parse(today() + 'T12:00:00') + n * 864e5).toISOString().slice(0, 10);

beforeEach(() => {
  call('clearNotes');
  call('loadSample');
});

test('the sample network comes with pursuits that show every part of capture', () => {
  const ps = call('pursuits');
  assert.ok(ps.length >= 4);
  assert.ok(ps.some(p => p.stage === 'Won') && ps.some(p => p.stage === 'Lost'), 'won and lost history');
  assert.ok(ps.some(p => p.cold > 0), 'at least one cold seat');
  assert.ok(ps.some(p => p.incumbent), 'an incumbent');
  assert.ok(call('demoOpportunities').length > 0, 'sample SAM.gov notices');
  assert.ok(call('demoAwardPages').length > 0, 'sample awards');
});

test('incumbent and teaming partner seats fill from the companies on the pursuit', () => {
  const p = call('addPursuit', {name: 'Test recompete', agency: 'DISA'});
  let d = call('pursuit', p.id);
  assert.equal(d.roleList.length, 8);
  const inc = d.roleList.find(r => r.role === 'Incumbent');
  assert.equal(inc.side, 'industry');
  assert.match(inc.hint, /incumbent/);
  call('updatePursuit', p.id, {incumbent: 'Leidos', partners: 'Dragos, Claroty'});
  d = call('pursuit', p.id);
  const inc2 = d.roleList.find(r => r.role === 'Incumbent');
  assert.deepEqual(inc2.companies, ['Leidos']);
  assert.ok(inc2.suggest.length > 0, 'suggests people at Leidos');
  const people = new Map(call('people').map(x => [x.k, x]));
  for (const s of inc2.suggest) assert.match(people.get(s.k).c, /Leidos/);
  const tp = d.roleList.find(r => r.role === 'Teaming partner');
  assert.deepEqual(tp.companies, ['Dragos', 'Claroty']);
  for (const s of tp.suggest) assert.match(people.get(s.k).c, /Dragos|Claroty/);
});

test('pipeline: totals by stage, weighted by win chance, with won and lost history', () => {
  for (const x of call('pursuits')) call('removePursuit', x.id);
  const a = call('addPursuit', {name: 'A', agency: 'DISA', value: '$2M', stage: 'Proposal'});
  const b = call('addPursuit', {name: 'B', agency: 'CISA', value: '500K', stage: 'Tracking'});
  call('updatePursuit', b.id, {pwin: 60});
  const c = call('addPursuit', {name: 'C', agency: 'DOE', value: '1,000,000', stage: 'Submitted'});
  call('updatePursuit', c.id, {stage: 'Won'});
  const pl = call('pipeline');
  assert.equal(pl.open.count, 2);
  assert.equal(pl.open.value, 2500000);
  assert.equal(pl.open.weighted, 2000000 * 0.4 + 500000 * 0.6);
  assert.equal(pl.won.count, 1);
  assert.equal(pl.winRate, 100);
  assert.equal(pl.history[0].name, 'C');
  assert.equal(pl.history[0].closed, today());
  call('updatePursuit', b.id, {pwin: ''});
  assert.equal(call('pursuits').find(x => x.id === b.id).pwin, 10, 'back to the stage default');
  call('updatePursuit', a.id, {stage: 'Lost'});
  assert.equal(call('pipeline').winRate, 50);
});

test('cold seats: open pursuits due soon whose seated people have gone quiet', () => {
  for (const x of call('pursuits')) call('removePursuit', x.id);
  const quiet = call('people').find(x => !x.x && x.c && /Defense Information Systems/.test(x.c));
  const p = call('addPursuit', {name: 'Cold test', agency: 'DISA', due: day(30), stage: 'Pursuing'});
  call('assignRole', p.id, 'Program manager', quiet.k, true);
  const before = call('coldSeats').length;
  call('touch', quiet.k);
  assert.equal(call('coldSeats').length, 0, 'touching them warms the seat');
  call('updatePursuit', p.id, {due: day(400)});
  assert.equal(call('pursuit', p.id).cold, 0, 'not cold when the due date is far away');
  assert.ok(before <= 1);
});

test('cold seats show on Today and in the weekly brief', () => {
  const cs = call('coldSeats');
  assert.ok(cs.length > 0);
  const cards = call('home', {}).cards;
  const card = cards.find(c => /pursuit seats? (is|are) going cold/.test(c.title));
  assert.ok(card, 'a Today card');
  assert.equal(card.act.kind, 'pursuit');
  const w = call('weekly', []);
  assert.ok(w.length <= 5);
});

test('pursuit one-pager: facts, every seat with a status, ways in', () => {
  const sheet = call('pursuitSheet', 'sample-disa');
  assert.equal(sheet.title, 'DISA cross domain services recompete');
  assert.equal(sheet.seats.length, 8);
  for (const s of sheet.seats) assert.ok(s.status, s.role);
  assert.ok(sheet.facts.some(([k, v]) => k === 'Incumbent' && v === 'Booz Allen Hamilton'));
  assert.ok(sheet.facts.some(([k, v]) => k === 'Win chance' && v === '35%'));
  assert.match(sheet.footer, /Northfix/);
});

test('call plan: facts for the on-device model, and a plan without one', () => {
  const d = call('pursuit', 'sample-navfac');
  const seated = d.roleList.find(r => r.role === 'Program manager').people[0];
  const cp = call('callPlan', seated.k, 'sample-navfac');
  assert.equal(cp.seat, 'Program manager');
  assert.ok(cp.facts.length >= 4);
  assert.match(cp.plan, /^Goal: /);
  assert.match(cp.plan, /Ask: /);
  assert.match(cp.prompt, /Facts:/);
  assert.ok(!/—/.test(cp.plan), 'no em dashes');
  const none = call('callPlan', call('people')[5].k);
  assert.match(none.plan, /Goal: /);
});

test('event attendee list: who you know, who is new, and tagging', () => {
  const ps = call('people').filter(x => !x.x && x.c).slice(0, 3);
  const csv = ['First Name,Last Name,Company,Title', ...ps.map(x => `${x.f},${x.l},${x.c},${x.p || ''}`),
    'Grace,Hopper,Navy Research Group,Rear Admiral', 'Alan,Turing,Bletchley Partners,Principal'].join('\n');
  const m = call('matchAttendeeList', csv, 'TechNet Augusta');
  assert.equal(m.rows, 5);
  assert.equal(m.knownCount, 3);
  assert.equal(m.newCount, 2);
  assert.ok(m.companies.some(c => c.company === 'Navy Research Group'));
  assert.equal(m.added, 2, 'new people kept for org charts');
  const t = call('tagAttendees', m.known.map(x => x.k), 'TechNet Augusta');
  assert.equal(t.tagged, 3);
  assert.equal(call('tagAttendees', m.known.map(x => x.k), 'TechNet Augusta').tagged, 0, 'tags once');
  assert.throws(() => call('matchAttendeeList', 'Foo,Bar\n1,2', 'x'), /name columns/);
});

test('award requests: one POST per agency, contracts only, with a service-wide ask narrowed by office', () => {
  const rq = call('awardRequests', ['NAVFAC', 'DISA', 'NAVFAC'], 24);
  assert.equal(rq.length, 2);
  const nav = rq.find(x => x.short === 'NAVFAC');
  assert.match(nav.url, /api\.usaspending\.gov\/api\/v2\/search\/spending_by_award\/$/);
  assert.deepEqual(nav.body.filters.award_type_codes, ['A', 'B', 'C', 'D']);
  assert.deepEqual(nav.body.filters.agencies, [{type: 'awarding', tier: 'subtier', name: 'Department of the Navy'}]);
  // time_period is about actions, not the period of performance: ask for awards still being worked
  assert.equal(nav.body.filters.time_period[0].end_date, today());
  assert.ok(nav.body.filters.time_period[0].start_date < day(-500), 'looks back about 18 months');
  assert.ok(!nav.body.fields.includes('Awarding Office'), 'only fields the API knows');
  const def = call('awardRequests', [], 12);
  assert.ok(def.length > 0 && def.length <= 8, 'defaults to the watchlist and pursuits');
});

test('award answers: read, matched to the network, narrowed to the office, ended ones dropped', () => {
  const nav = call('awardRequests', ['NAVFAC'], 24)[0];
  const answer = JSON.stringify({page_metadata: {page: 1, hasNext: false}, results: [
    {'Award ID': 'N6945024C0001', 'Recipient Name': 'LEIDOS, INC.', 'Start Date': day(-900), 'End Date': day(200), 'Award Amount': 12500000,
      'Awarding Agency': 'Department of Defense', 'Awarding Sub Agency': 'Department of the Navy', 'Awarding Office': 'NAVFAC SOUTHEAST', Description: 'UTILITY CONTROL SYSTEMS SUPPORT',
      NAICS: {code: '541512', description: 'Computer systems design'}, generated_internal_id: 'CONT_AWD_N6945024C0001_9700'},
    {'Award ID': 'N0002424C0002', 'Recipient Name': 'HUNTINGTON INGALLS INDUSTRIES', 'End Date': day(100), 'Award Amount': 90000000,
      'Awarding Sub Agency': 'Department of the Navy', 'Awarding Office': 'NAVSEA HQ', Description: 'SHIP REPAIR', generated_internal_id: 'CONT_AWD_N0002424C0002_9700'},
    {'Award ID': 'N6945020C0003', 'Recipient Name': 'JACOBS', 'End Date': day(-10), 'Award Amount': 4000000,
      'Awarding Sub Agency': 'Department of the Navy', 'Awarding Office': 'NAVFAC ATLANTIC', generated_internal_id: 'CONT_AWD_N6945020C0003_9700'},
  ]});
  const page = call('awardPage', answer);
  assert.equal(page.items.length, 3);
  assert.equal(page.items[0].naics, '541512');
  const rc = call('recompetes', [{agencyId: nav.agencyId, items: page.items}], {months: 24});
  assert.equal(rc.total, 1, 'NAVSEA is not NAVFAC, and the Jacobs contract already ended');
  const r = rc.items[0];
  assert.equal(r.incumbent, 'Leidos, Inc.');
  assert.equal(r.agency, 'NAVFAC');
  assert.equal(r.amountText, '$12.5M');
  assert.equal(r.link, 'https://www.usaspending.gov/award/CONT_AWD_N6945024C0001_9700');
  assert.ok(r.known > 0 && r.incumbentKnown > 0);
  assert.match(call('awardPage', '{"detail":"Request was throttled."}').error, /busy/);
  assert.match(call('awardPage', 'not json').error, /couldn’t read/);
});

test('a recompete becomes a pursuit once, with the incumbent filled in', () => {
  const rc = call('recompetes', call('demoAwardPages'), {months: 24});
  assert.ok(rc.items.length > 0);
  const x = rc.items[0];
  const p = call('pursueAward', x);
  assert.equal(p.incumbent, x.incumbent);
  assert.equal(p.due, x.end);
  assert.equal(call('pursueAward', x).id, p.id, 'no duplicate');
  assert.equal(call('recompetes', call('demoAwardPages'), {months: 24}).items.find(y => y.id === x.id).tracked, true);
});

test('teaming partners: companies that win at the agency, people you know there first', () => {
  const tp = call('teamingPartners', call('demoAwardPages'), {});
  assert.ok(tp.items.length > 3);
  const firstUnknown = tp.items.findIndex(x => !x.known);
  if (firstUnknown > 0) assert.ok(tp.items.slice(firstUnknown).every(x => !x.known));
  const disa = call('teamingPartners', call('demoAwardPages'), {agency: 'DISA'});
  assert.ok(disa.items.every(x => x.agencies.includes('DISA')));
  assert.equal(disa.agency.short, 'DISA');
});

test('seat owners travel in the encrypted team share, with win chance and incumbent', () => {
  call('setSeatOwner', 'sample-disa', 'Contracting officer', 'Pat Morgan');
  assert.equal(call('pursuit', 'sample-disa').roleList.find(r => r.role === 'Contracting officer').owner, 'Pat Morgan');
  const share = JSON.parse(call('teamShare', 'Jay'));
  const p = share.pursuits.find(x => x.name === 'DISA cross domain services recompete');
  assert.equal(p.owners['Contracting officer'], 'Pat Morgan');
  assert.equal(p.pwin, 35);
  assert.equal(p.incumbent, 'Booz Allen Hamilton');
  call('addTeamPack', JSON.stringify(Object.assign({}, share, {owner: 'Alex'})));
  const o = call('teamOverview');
  assert.equal(o.pursuits.find(x => x.owner === 'Alex' && x.name === p.name).owners['Contracting officer'], 'Pat Morgan');
  call('setSeatOwner', 'sample-disa', 'Contracting officer', '');
  assert.equal(call('pursuit', 'sample-disa').roleList.find(r => r.role === 'Contracting officer').owner, '');
});

test('federal map: Department of War counts as DoD, with a date on the map', () => {
  assert.match(call('federalAsOf'), /^\d{4}-\d{2}$/);
  const csv = 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nPat,Lee,,,Department of War,Senior Advisor,01 Oct 2026\n';
  call('importTexts', {connections: csv}, 'test');
  const net = JSON.parse(globalThis.Bearings.fileJSON('network'));
  call('load', {mode: 'live', rows: net.rows, meta: net.meta});
  const pat = call('people').find(x => x.f === 'Pat' && x.l === 'Lee');
  assert.equal(call('person', pat.k).cl.seg, 'DoD & Military');
  assert.ok(call('agencyCoverage', false).rows.find(r => r.short === 'OSD').known >= 1);
});
