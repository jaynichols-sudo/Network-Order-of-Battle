// Capture memo: a bid/no-bid memo and call plans from a SAM.gov notice, the network and notes.
// Run against the engine bundle the apps ship. Run with: npm test
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
const notices = () => call('matchOpportunities', call('demoOpportunities'), {}).items;

beforeEach(() => { call('clearNotes'); call('loadSample'); });

test('memo: recommendation, factors, call plans and a grounded prompt for a sample notice', () => {
  const n = notices().find(x => x.known > 0);
  assert.ok(n, 'a sample notice at an agency you know');
  const m = call('captureMemo', n, {naics: [n.naics]});
  assert.ok(['Bid', 'Bid with conditions', 'No bid'].includes(m.call));
  assert.ok(m.score >= 0 && m.score <= 100);
  assert.equal(m.factors.find(f => f.key === 'naics').answer, 'yes');
  assert.equal(m.factors.find(f => f.key === 'relationships').answer === 'no', false);
  assert.ok(m.callPlans.length >= 1 && m.callPlans.every(c => c.plan.startsWith('Goal:')));
  assert.match(m.memo, new RegExp(`^Bid/no-bid: `));
  assert.match(m.memo, /Recommendation: /);
  assert.match(m.prompt, /never invent/);
  for (const f of m.facts) assert.ok(m.prompt.includes(f));
});

test('memo: a set-aside you do not qualify for, or no time left, is a no bid', () => {
  const n = Object.assign({}, notices()[0], {fit: 'no', setAside: 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside'});
  assert.equal(call('captureMemo', n, {}).call, 'No bid');
  const late = Object.assign({}, notices()[0], {fit: 'yes', days: 3, due: day(3)});
  const m = call('captureMemo', late, {});
  assert.equal(m.call, 'No bid');
  assert.match(m.why, /time/);
});

test('memo: pursuit notes and the incumbent are used when the notice is tracked', () => {
  const n = notices()[0];
  const p = call('addPursuit', {name: 'Memo test', agency: n.agency, incumbent: 'Leidos', source: n.id});
  call('updatePursuit', p.id, {note: 'Customer wants zero trust by FY28.'});
  const m = call('captureMemo', n, {});
  assert.equal(m.pursuitId, p.id);
  assert.ok(m.factors.some(f => f.key === 'incumbent'));
  assert.ok(m.factors.some(f => f.key === 'pursuit'));
  assert.match(m.memo, /zero trust by FY28/);
});

test('memo: needs a notice', () => {
  assert.match(fails('captureMemo', {}, {}), /notice/);
});
