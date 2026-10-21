// The team's shared agency org chart: everyone's people at one agency, every open pursuit there,
// and the government seats nobody fills. Built from shares already decrypted on the device.
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
const share = (owner, people, pursuits) => JSON.stringify({kind: 'bearings-team-share', v: 2, owner, made: '2026-10-01', people, pursuits: pursuits || [], targets: []});

beforeEach(() => { call('clearNotes'); call('loadSample'); call('setTeamShares', []); });

test('team org: merges a teammate’s people and their pursuit’s open seats at the agency', () => {
  const before = call('teamAgencyOrg', 'DISA');
  assert.equal(before.agency.short, 'DISA');
  call('setTeamShares', [{id: 'm1', text: share('Alex', [
    {f: 'Pat', l: 'Quinn', c: 'Defense Information Systems Agency', p: 'Contracting Officer', b: 'warm'},
    {f: 'Lee', l: 'Ray', c: 'DISA', p: 'Program Manager, Cloud', b: 'strong'}],
    [{name: 'DISA cloud gateway', agency: 'DISA', stage: 'Pursuing', due: '2027-03-01', roles: [{role: 'Program manager', name: 'Lee Ray', p: 'Program Manager, Cloud', b: 'strong'}]}])}]);
  const r = call('teamAgencyOrg', 'DISA');
  assert.ok(r.team >= 1 && r.total > before.total);
  assert.ok(r.contributors.some(c => c.owner === 'Alex' && c.people >= 1));
  const theirs = r.pursuits.find(p => p.owner === 'Alex');
  assert.ok(theirs, 'teammate pursuit at the agency is listed');
  const pm = theirs.seats.find(s => s.role === 'Program manager');
  assert.equal(pm.filled, true);
  assert.deepEqual(pm.holders, ['Lee Ray']);
  const ko = theirs.seats.find(s => s.role === 'Contracting officer');
  assert.equal(ko.filled, false);
  assert.ok(ko.candidates.length >= 1, 'someone on the chart could fill the contracting seat');
  assert.equal(r.openSeats, r.pursuits.flatMap(p => p.seats).filter(s => !s.filled).length);
  assert.ok(r.fillable <= r.openSeats);
});

test('team org: your own pursuit seats are included, and other agencies are not', () => {
  const p = call('addPursuit', {name: 'Mine at DISA', agency: 'DISA', stage: 'Pursuing'});
  call('addPursuit', {name: 'Elsewhere', agency: 'NAVFAC', stage: 'Pursuing'});
  const r = call('teamAgencyOrg', 'DISA');
  const mine = r.pursuits.find(x => x.id === p.id);
  assert.ok(mine && mine.owner === 'You');
  assert.ok(!r.pursuits.some(x => x.name === 'Elsewhere'));
  assert.ok(mine.seats.every(s => !['Incumbent', 'Teaming partner'].includes(s.role)), 'government seats only');
});

test('team org: closed pursuits are left out, and the share format is unchanged', () => {
  call('setTeamShares', [{id: 'm2', text: share('Sam', [], [{name: 'Done deal', agency: 'DISA', stage: 'Won', roles: []}])}]);
  assert.ok(!call('teamAgencyOrg', 'DISA').pursuits.some(x => x.name === 'Done deal'));
  const mine = JSON.parse(call('teamShare', 'Jay'));
  assert.equal(mine.kind, 'bearings-team-share');
  assert.deepEqual(Object.keys(mine).sort(), ['kind', 'made', 'owner', 'people', 'pursuits', 'targets', 'v']);
});
