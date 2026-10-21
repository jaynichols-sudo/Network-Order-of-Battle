// Recompete radar: expiring contracts joined with coverage, ways in, alerts and the digest.
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

beforeEach(() => { call('clearNotes'); call('loadSample'); });

test('radar: buckets, ways in, next step and digest from the sample awards', () => {
  const pages = call('demoAwardPages');
  const r = call('recompeteRadar', pages, {months: 24});
  assert.ok(r.total > 0, 'sample has recompetes');
  assert.equal(r.items.length, Math.min(r.total, 100));
  assert.equal(r.buckets.reduce((s, b) => s + b.count, 0), r.total);
  for (const x of r.items){
    assert.ok(x.horizon && typeof x.next === 'string' && x.next.length > 10);
    assert.equal(x.covered, x.known > 0 || x.incumbentKnown > 0 || x.team.length > 0);
    for (const w of x.ways) assert.ok(['agency', 'incumbent'].includes(w.side) && w.k && w.name);
  }
  assert.match(r.text, /^Recompete radar for the week of/);
  assert.ok(r.items.every((x, i, a) => i === 0 || a[i - 1].score >= x.score), 'best first');
});

test('radar: everything is new until seen, and alerts stop once seen', () => {
  const pages = call('demoAwardPages');
  const first = call('recompeteRadar', pages, {months: 24});
  assert.equal(first.newCount, first.total);
  assert.ok(first.alerts.length <= 5);
  for (const a of first.alerts) assert.ok(a.id && a.title && a.body);
  const again = call('recompeteRadar', pages, {months: 24, seen: first.ids});
  assert.equal(again.newCount, 0);
  assert.equal(again.alerts.length, 0);
});

test('radar: a shorter window never shows more, and tracking clears the alert', () => {
  const pages = call('demoAwardPages');
  const wide = call('recompeteRadar', pages, {months: 24});
  const narrow = call('recompeteRadar', pages, {months: 3});
  assert.ok(narrow.total <= wide.total);
  assert.ok(narrow.items.every(x => x.days <= 3 * 31));
  const pick = wide.alerts[0] && wide.items.find(x => x.id === wide.alerts[0].id);
  if (pick){
    call('pursueAward', pick);
    const after = call('recompeteRadar', pages, {months: 24});
    assert.ok(!after.alerts.some(a => a.id === pick.id));
    assert.equal(after.items.find(x => x.id === pick.id).tracked, true);
  }
});

test('radar: empty pages give an empty radar, not an error', () => {
  const r = call('recompeteRadar', [], {});
  assert.equal(r.total, 0);
  assert.deepEqual(r.buckets, []);
  assert.equal(r.months, 12);
});
