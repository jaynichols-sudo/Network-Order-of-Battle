// Teaming-partner finder: who wins work at an agency in a NAICS, and a one-tap intro into a pursuit seat.
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

beforeEach(() => { call('clearNotes'); call('loadSample'); });

test('finder: partners at one agency, ways in first, then by value', () => {
  const pages = call('demoAwardPages');
  const all = call('teamingFinder', pages, {});
  assert.ok(all.total > 0);
  const ag = all.items[0].awards[0].agency;
  const one = call('teamingFinder', pages, {agency: ag});
  assert.equal(one.agency.short, ag);
  assert.ok(one.items.every(x => x.awards.every(a => a.agency === ag)));
  const flags = one.items.map(x => x.ways.length > 0);
  assert.deepEqual(flags, flags.slice().sort((a, b) => b - a), 'ones with a way in come first');
  for (const x of one.items) assert.ok(x.awards.length <= 3 && x.line);
});

test('finder: a NAICS code narrows to companies with awards in it', () => {
  const pages = call('demoAwardPages');
  const any = call('teamingFinder', pages, {}).items.flatMap(x => x.naics);
  const code = any[0];
  assert.ok(code, 'sample awards carry NAICS codes');
  const r = call('teamingFinder', pages, {naics: code});
  assert.ok(r.total > 0 && r.items.every(x => x.naics.includes(code)));
  assert.equal(call('teamingFinder', pages, {naics: '999999'}).total, 0);
});

test('intro request: inside the partner fills the seat, outside logs an intro', () => {
  const pages = call('demoAwardPages');
  const x = call('teamingFinder', pages, {}).items.find(i => i.ways.some(w => w.inside));
  assert.ok(x, 'a partner where you know someone inside');
  const p = call('addPursuit', {name: 'Teaming test', agency: x.awards[0].agency});
  const inside = x.ways.find(w => w.inside);
  const r = call('requestTeamingIntro', p.id, {partner: x.name, via: inside.k});
  assert.equal(r.seated, true);
  assert.ok(r.partners.includes(x.name));
  assert.ok(call('pursuit', p.id).roleList.find(s => s.role === 'Teaming partner').people.some(q => q.k === inside.k));
  // again: no duplicate partner
  assert.equal(call('requestTeamingIntro', p.id, {partner: x.name, via: inside.k}).partners.filter(n => n === x.name).length, 1);
  const outsider = call('people').find(q => !q.c || !q.c.includes(x.name.split(' ')[0]));
  const r2 = call('requestTeamingIntro', p.id, {partner: x.name, via: outsider.k, to: 'their BD lead'});
  assert.equal(r2.intro, true);
  assert.ok(call('intros').some(i => i.via === outsider.k && i.co === x.name && i.to === 'their BD lead'));
});

test('intro request: needs a pursuit and a company', () => {
  assert.match(fails('requestTeamingIntro', 'nope', {partner: 'Leidos'}), /pursuit/);
  const p = call('addPursuit', {name: 'X'});
  assert.match(fails('requestTeamingIntro', p.id, {}), /company/);
});
