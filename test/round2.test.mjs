// Enhancement round 2: bid/no-bid, key dates, set-aside fit, the fiscal year, competitors and
// the weekly capture digest. Run against the engine bundle the apps ship. Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync('apple/Northfix/Resources/engine.js', 'utf8'))();
const call = (name, ...args) => {
  const r = JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args)));
  if (r.error) throw new Error(`${name}: ${r.error}`);
  return r.ok;
};
const fails = (name, ...args) => JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args))).error;
const today = () => call('info').today;
const day = n => new Date(Date.parse(today() + 'T12:00:00') + n * 864e5).toISOString().slice(0, 10);

beforeEach(() => {
  call('clearNotes');
  call('loadSample');
});

/* ---------- fiscal year ---------- */
test('fiscal year: October starts the next fiscal year, and Q4 is July to September', () => {
  assert.deepEqual(call('fiscalOf', '2026-10-01'), {fy: 2027, q: 1, label: 'FY27 Q1', q4: false});
  assert.equal(call('fiscalOf', '2026-12-31').label, 'FY27 Q1');
  assert.equal(call('fiscalOf', '2027-01-15').label, 'FY27 Q2');
  assert.equal(call('fiscalOf', '2027-06-30').label, 'FY27 Q3');
  assert.deepEqual(call('fiscalOf', '2027-09-30'), {fy: 2027, q: 4, label: 'FY27 Q4', q4: true});
  assert.equal(call('fiscalOf', ''), null);
  assert.equal(call('fiscalOf', 'soon'), null);
});

test('pipeline: open value by fiscal quarter, soonest first, undated last', () => {
  const a = call('addPursuit', {name: 'A', agency: 'DISA', due: '2027-08-01', value: '$2M', stage: 'Pursuing'});
  call('addPursuit', {name: 'B', agency: 'DISA', due: '2027-08-20', value: '$1M', stage: 'Proposal'});
  call('addPursuit', {name: 'C', agency: 'DISA', value: '$5M'});
  const q = call('pipeline', false).quarters;
  const q4 = q.find(x => x.label === 'FY27 Q4');
  assert.equal(q4.count, 2);
  assert.equal(q4.value, 3e6);
  assert.equal(q4.q4, true);
  assert.equal(q[q.length - 1].label, 'No due date');
  assert.equal(call('pursuit', a.id).fiscal.label, 'FY27 Q4');
});

/* ---------- key dates ---------- */
test('key dates: set, cleared, sorted, and the next one shows on the pursuit', () => {
  const p = call('addPursuit', {name: 'Zero trust', agency: 'DISA', due: day(60)});
  call('setPursuitDate', p.id, 'industryDay', day(-5));
  call('setPursuitDate', p.id, 'questions', day(6));
  call('setPursuitDate', p.id, 'award', day(150));
  let d = call('pursuit', p.id);
  assert.deepEqual(d.next, {kind: 'questions', label: 'Questions due', date: day(6), days: 6});
  assert.equal(d.dates.find(x => x.kind === 'proposal').date, day(60), 'proposal due is the due date');
  call('setPursuitDate', p.id, 'proposal', day(70));
  assert.equal(call('pursuit', p.id).due, day(70));
  call('setPursuitDate', p.id, 'questions', '');
  assert.equal(call('pursuit', p.id).next.kind, 'proposal');
  assert.match(fails('setPursuitDate', p.id, 'questions', 'next week'), /Use a date like/);
  assert.match(fails('setPursuitDate', p.id, 'lunch', day(1)), /Unknown date/);
  const up = call('upcomingDates', 14);
  assert.ok(!up.some(x => x.pursuitId === p.id), 'nothing for this pursuit in the next two weeks now');
  call('setPursuitDate', p.id, 'orals', day(3));
  assert.ok(call('upcomingDates', 14).some(x => x.pursuitId === p.id && x.kind === 'orals'));
  // it survives a save and load
  const saved = JSON.parse(globalThis.Bearings.fileJSON('pursuits'));
  assert.equal(saved.pursuits.find(x => x.id === p.id).dates.orals, day(3));
});

/* ---------- bid/no-bid ---------- */
test('bid/no-bid: suggestions from your data, your answers win, and a clear call', () => {
  const p = call('addPursuit', {name: 'Bid test', agency: 'DISA', due: day(10)});
  let b = call('bidDecision', p.id);
  assert.equal(b.questions.length, 8);
  const q = k => b.questions.find(x => x.key === k);
  assert.equal(q('time').suggested, 'no', 'ten days is not enough');
  assert.equal(q('partner').suggested, 'no');
  assert.equal(q('incumbent').suggested, 'yes', 'no incumbent listed');
  assert.ok(q('customer').suggested, 'the sample network knows people at DISA');
  assert.equal(q('eligible').answer, '', 'only you can say');
  b = call('setBidAnswer', p.id, 'time', 'yes');
  assert.equal(b.questions.find(x => x.key === 'time').answer, 'yes');
  assert.equal(b.questions.find(x => x.key === 'time').suggested, 'no', 'the suggestion is still shown');
  b = call('setBidAnswer', p.id, 'eligible', 'no');
  assert.equal(b.call, 'No bid');
  assert.match(b.why, /team under/);
  for (const k of ['eligible', 'worth', 'pastPerf', 'partner']) call('setBidAnswer', p.id, k, 'yes');
  call('updatePursuit', p.id, {partners: 'Dragos'});
  b = call('bidDecision', p.id);
  assert.ok(['Bid', 'Bid with conditions'].includes(b.call), b.call);
  assert.ok(b.score >= 45);
  call('setBidAnswer', p.id, 'time', '');
  assert.equal(call('bidDecision', p.id).questions.find(x => x.key === 'time').answer, 'no', 'cleared back to the suggestion');
  assert.match(fails('setBidAnswer', p.id, 'time', 'definitely'), /yes, maybe or no/);
  assert.match(fails('setBidAnswer', p.id, 'vibes', 'yes'), /Unknown question/);
  assert.equal(call('pursuit', p.id).bid.name, 'Bid test');
});

test('bid/no-bid: with too few answers it says so instead of guessing', () => {
  const p = call('addPursuit', {name: 'Blank'});
  const b = call('bidDecision', p.id);
  assert.equal(b.call, 'Not enough answers');
  assert.equal(call('bidDecision', 'nope'), null);
});

/* ---------- set-asides ---------- */
test('set-asides: notices you can’t bid are marked, ranked down, and can be hidden', () => {
  const notices = call('demoOpportunities').map(n => Object.assign({}, n));
  notices[0].typeOfSetAside = '8A'; notices[0].typeOfSetAsideDescription = '8(a) Set-Aside (FAR 19.8)';
  notices[1].typeOfSetAside = 'SDVOSBC'; notices[1].typeOfSetAsideDescription = 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside';
  notices[2].typeOfSetAside = ''; notices[2].typeOfSetAsideDescription = 'Total Small Business Set-Aside (FAR 19.5)';
  notices[3].typeOfSetAside = 'NONE'; notices[3].typeOfSetAsideDescription = '';
  const ids = notices.slice(0, 4).map(n => n.noticeId);
  const fitOf = m => Object.fromEntries(m.items.filter(x => ids.includes(x.id)).map(x => [x.id, x.fit]));
  const none = call('matchOpportunities', notices, {all: true});
  assert.ok(Object.values(fitOf(none)).every(f => f === ''), 'no programs set: no judgment');
  const m = call('matchOpportunities', notices, {all: true, setAsides: ['sdvosb']});
  const f = fitOf(m);
  assert.equal(f[ids[0]], 'no', '8(a) only');
  assert.equal(f[ids[1]], 'yes');
  assert.equal(f[ids[2]], 'yes', 'every program is a small business');
  assert.equal(f[ids[3]], 'open');
  const hidden = call('matchOpportunities', notices, {all: true, setAsides: ['sdvosb'], hideIneligible: true});
  assert.ok(!hidden.items.some(x => x.id === ids[0]));
  assert.ok(hidden.items.some(x => x.id === ids[1]));
  assert.equal(call('opportunityFilters', {setAsides: 'wosb, bogus', hideIneligible: true}).setAsides.join(), 'wosb');
  assert.equal(call('opportunityFilters', {hideIneligible: true}).hideIneligible, false, 'nothing to hide by');
  assert.ok(call('setAsidePrograms').some(p => p.id === 'hubzone'));
});

/* ---------- competitors ---------- */
test('competitors: kept with the watchlist file, flagged on recompetes, teaming partners and pursuits', () => {
  call('setCompetitor', 'Booz Allen Hamilton', true);
  call('setCompetitor', 'booz allen hamilton', true);
  assert.equal(call('competitors').length, 1, 'no duplicates');
  const saved = JSON.parse(globalThis.Bearings.fileJSON('targets'));
  assert.deepEqual(saved.competitors, ['booz allen hamilton']);
  const rc = call('recompetes', call('demoAwardPages'), {months: 24});
  assert.ok(rc.items.some(x => /Booz Allen/.test(x.incumbent) && x.competitor));
  assert.ok(rc.items.some(x => !x.competitor));
  const tp = call('teamingPartners', call('demoAwardPages'), {});
  assert.equal(tp.items.find(x => /Booz Allen/.test(x.name)).competitor, true);
  const p = call('addPursuit', {name: 'Cross domain', agency: 'DISA', incumbent: 'Booz Allen Hamilton'});
  const d = call('pursuit', p.id);
  assert.equal(d.competitor, true);
  assert.deepEqual(d.competitors, ['Booz Allen Hamilton']);
  assert.equal(d.bid.questions.find(q => q.key === 'incumbent').suggested, 'maybe');
  const c = call('competitors')[0];
  assert.ok(c.pursuits.some(x => x.id === p.id));
  assert.match(c.line, /You know|No one/);
  call('setCompetitor', 'Booz Allen Hamilton', false);
  assert.equal(call('competitors').length, 0);
  assert.deepEqual(JSON.parse(globalThis.Bearings.fileJSON('targets')).competitors, undefined, 'the file stays as it was');
});

/* ---------- weekly digest ---------- */
test('capture digest: dates, cold seats, empty seats and bid calls in plain English', () => {
  const p = call('addPursuit', {name: 'Digest pursuit', agency: 'DISA', due: day(40), value: '$3M', stage: 'Pursuing'});
  call('setPursuitDate', p.id, 'questions', day(2));
  call('setPursuitDate', p.id, 'rfp', day(5));
  const d = call('captureDigest', {awards: call('demoAwardPages'), notices: [{isNew: true, agency: 'DISA', title: 'Zero trust RFI', due: day(9)}]});
  assert.equal(d.empty, false);
  assert.match(d.head, /open pursuits?, \$[\d.]+[KMB]? total/);
  const titles = d.sections.map(s => s.title);
  assert.ok(titles.includes('Dates in the next two weeks'));
  assert.ok(titles.includes('Empty seats'));
  assert.ok(titles.includes('New on SAM.gov'));
  assert.match(d.text, /Digest pursuit: questions due in 2 days/);
  assert.match(d.text, /Digest pursuit: final RFP in 5 days/, 'acronyms keep their case');
  assert.ok(!/undefined|null|NaN/.test(d.text), d.text);
  assert.ok(!/—/.test(d.text), 'no em dashes');
  call('clearNotes'); call('load', {mode: 'live', rows: [], meta: {}});
  const blank = call('captureDigest', {});
  assert.equal(blank.empty, true);
  assert.match(blank.head, /No open pursuits/);
});
