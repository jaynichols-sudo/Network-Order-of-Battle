// Tests for the shared engine, run against the exact bundle the iPhone, iPad and Mac ship
// (apple/Bearings/Resources/engine.js). Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync('apple/Bearings/Resources/engine.js', 'utf8'))();
const raw = (name, ...args) => JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args)));
const call = (name, ...args) => {
  const r = raw(name, ...args);
  if (r.error) throw new Error(`${name}: ${r.error}`);
  return r.ok;
};
const people = () => call('people');
const byKey = () => new Map(people().map(p => [p.k, p]));
const searchKeys = input => call('search', Object.assign({ text: '', filters: {} }, input)).keys;

beforeEach(() => {
  call('clearNotes');
  call('loadSample');
});

test('sample network loads', () => {
  const info = call('info');
  assert.equal(info.mode, 'sample');
  assert.ok(info.count > 500, `expected a full sample, got ${info.count}`);
  assert.equal(people().length, info.count + info.removed);
});

test('people payload leaves out empty values', () => {
  for (const p of people().slice(0, 200)) {
    for (const [k, v] of Object.entries(p)) {
      assert.ok(v !== '' && v !== false && v != null, `${p.k}.${k} should be left out when empty`);
    }
  }
});

test('unknown calls fail cleanly instead of throwing', () => {
  const r = raw('noSuchCall');
  assert.match(r.error, /Unknown engine call/);
});

test('search: plain words narrow the list, and a filter matches its flag', () => {
  const all = searchKeys({});
  const navy = searchKeys({ text: 'navy' });
  assert.ok(navy.length > 0 && navy.length < all.length);
  const waiting = searchKeys({ filters: { sig: ['waiting'] } });
  const map = byKey();
  assert.ok(waiting.length > 0);
  for (const k of waiting) assert.ok(map.get(k).waiting, `${k} matched "waiting" but isn't flagged`);
});

test('compass: wedges cover the circle and the tally matches the people', () => {
  const c = call('compass', { text: '', filters: {} });
  const span = c.wedges.reduce((s, w) => s + (w.a1 - w.a0), 0);
  assert.ok(Math.abs(span - 2 * Math.PI) < 0.05, `wedges span ${span}`);
  assert.equal(c.wedges.reduce((s, w) => s + w.n, 0), c.total);
  const waiting = people().filter(p => p.waiting && !p.x).length;
  assert.equal(c.tally.w, waiting);
});

test('weekly brief: at most five different people, each with a reason', () => {
  const picks = call('weekly', []);
  assert.ok(picks.length > 0 && picks.length <= 5);
  assert.equal(new Set(picks.map(p => p.k)).size, picks.length);
  for (const p of picks) {
    assert.ok(p.why && p.why.length > 10);
    assert.ok(['reply', 'circle', 'due', 'congrats', 'cold', 'anniv', 'new', 'checkin'].includes(p.kind), p.kind);
  }
  // people waiting on a reply come first
  const map = byKey();
  if (picks.some(p => p.kind === 'reply')) assert.equal(picks[0].kind, 'reply');
  for (const p of picks.filter(p => p.kind === 'reply')) assert.ok(map.get(p.k).waiting);
});

test('weekly brief: skipping someone swaps in someone else', () => {
  const first = call('weekly', []);
  const skip = [first[0].k];
  const next = call('weekly', skip);
  assert.ok(!next.some(p => p.k === skip[0]));
});

test('marking replied clears "waiting on you"', () => {
  const k = people().find(p => p.waiting).k;
  call('markReplied', k);
  assert.equal(byKey().get(k).waiting, undefined);
});

test('circles: overdue when out of touch, cleared by logging a touch', () => {
  const today = Date.parse(call('info').today);
  const p = people().find(p => p.rx && p.rx.t && (today - Date.parse(p.rx.t)) / 864e5 > 60);
  assert.ok(p, 'need someone last in touch over two months ago');
  call('setCircle', p.k, 'inner');
  let now = byKey().get(p.k);
  assert.equal(now.ed.circle, 'inner');
  assert.ok(now.over, 'inner circle and two months quiet should be overdue');
  call('touch', p.k);
  now = byKey().get(p.k);
  assert.ok(!now.over);
  call('setCircle', p.k, 'nonsense');
  assert.equal(byKey().get(p.k).ed?.circle, undefined);
});

test('follow-ups: set, then cleared with zero days', () => {
  const k = people()[3].k;
  call('followUp', k, 7);
  assert.ok(byKey().get(k).ed.due > call('info').today);
  call('followUp', k, 0);
  assert.equal(byKey().get(k).ed?.due, undefined);
});

test('notes and stars survive a backup and restore', () => {
  const [a, b] = people();
  call('addNote', a.k, 'Met at TechNet, wants a demo', 'event');
  call('setEdit', b.k, { star: true });
  const saved = call('backup');
  call('clearNotes');
  assert.equal(call('info').edits, 0);
  call('restore', saved);
  const map = byKey();
  assert.match(map.get(a.k).ed.note, /\(event\): Met at TechNet, wants a demo/);
  assert.equal(map.get(b.k).ed.star, true);
});

test('restore rejects files that are not backups', () => {
  assert.match(raw('restore', '{"hello":1}').error, /isn’t a Bearings backup/);
});

test('ways in: finds people at a company from the sample', () => {
  const r = call('introPaths', 'NAVFAC');
  assert.ok(r.now.length > 0);
  assert.ok(r.best.length > 0);
  assert.deepEqual(call('introPaths', 'x').now, []);
});

test('LinkedIn import: a Connections.csv becomes a network', () => {
  const csv = [
    'Notes:',
    '"When exporting your connection data, you may notice that some of the email addresses are missing."',
    '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ada,Lovelace,https://www.linkedin.com/in/ada,ada@example.com,Analytical Engines,Chief Engineer,05 Oct 2026',
    'Grace,Hopper,https://www.linkedin.com/in/grace,,US Navy,Rear Admiral,01 Jan 2020',
  ].join('\n');
  const r = call('importTexts', { connections: csv }, 'test');
  assert.equal(r.wasSample, true);
  const file = JSON.parse(globalThis.Bearings.fileJSON('network'));
  assert.equal(file.rows.length, 2);
  assert.throws(() => call('importTexts', {}, 'test'), /No Connections\.csv/);
});

test('starter network from contacts', () => {
  const r = call('startFromContacts', [
    { f: 'Pat', l: 'Lee', c: 'Duke Energy', p: 'Director, Grid Security', e: 'pat@example.com' },
    { f: 'Pat', l: 'Lee', c: 'Duke Energy', p: 'Director, Grid Security', e: 'pat@example.com' },
    { f: '', l: '', c: 'Nobody Inc' },
  ]);
  assert.ok(r);
  const file = JSON.parse(globalThis.Bearings.fileJSON('network'));
  assert.equal(file.rows.length, 1, 'duplicates and nameless contacts are dropped');
  assert.equal(file.meta.source, 'contacts');
});

test('CSV export quotes commas and keeps a header', () => {
  const csv = call('exportCSV', null);
  const lines = csv.split('\n');
  assert.match(lines[0], /^First Name,Last Name,Company/);
  assert.equal(lines.length, call('info').count + 1);
});

test('team packs: share who you know, never your notes, and they show up in Ways in', () => {
  const k = people()[0].k;
  call('addNote', k, 'Private note that must not leave');
  call('setEdit', k, { star: true, tags: ['secret'] });
  const pack = call('teamPack', 'Jim');
  assert.doesNotMatch(pack, /Private note|secret|"star"|@/, 'no notes, tags, stars or emails in a pack');
  const parsed = JSON.parse(pack);
  assert.equal(parsed.kind, 'bearings-team-pack');
  assert.equal(parsed.people.length, call('info').count);

  // a teammate's pack, then Ways in shows their people at the company
  const theirs = JSON.stringify({ kind: 'bearings-team-pack', v: 1, owner: 'Jim', made: '2026-10-01',
    people: [{ f: 'Pat', l: 'Morgan', c: 'NAVFAC Southeast', p: 'Contracting Officer', u: '', b: 'strong' },
             { f: 'Lee', l: 'Ray', c: 'Duke Energy', p: 'CISO', u: '', b: 'warm' }] });
  const added = call('addTeamPack', theirs);
  assert.equal(added.count, 2);
  const paths = call('introPaths', 'NAVFAC');
  assert.equal(paths.team.length, 1);
  assert.equal(paths.team[0].owner, 'Jim');
  assert.equal(paths.team[0].b, 'strong');

  // re-adding replaces rather than duplicates, and removing works
  call('addTeamPack', theirs);
  assert.equal(call('teamList').length, 1);
  call('removeTeamPack', 'Jim');
  assert.equal(call('introPaths', 'NAVFAC').team.length, 0);
  assert.throws(() => call('addTeamPack', '{"kind":"notes-backup"}'), /isn’t a Bearings team pack/);
});

test('year in review counts this year only', () => {
  const y = call('yearInReview', 2026);
  assert.equal(y.year, 2026);
  assert.equal(y.months.length, 12);
  assert.equal(y.months.reduce((a, b) => a + b, 0), y.joined);
  assert.ok(y.joined > 0 && y.joined < y.total);
  assert.ok(y.topSectors.length <= 3 && y.topCompanies.length <= 3);
  assert.equal(call('yearInReview', 1990).joined, 0);
});

test('enrichment files from any provider match by LinkedIn link, email or name and company', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ada,Lovelace,https://www.linkedin.com/in/ada,,Analytical Engines,Engineer,05 Oct 2020',
    'Grace,Hopper,https://www.linkedin.com/in/grace,grace@navy.mil,US Navy,Admiral,01 Jan 2020',
    'Katherine,Johnson,,,NASA,Mathematician,01 Jan 2019'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const by = new Map(people().map(p => [p.f, p.k]));
  const csv = [
    'First Name,Last Name,Job Title,Company Name,Email Address,Direct Phone Number,Mobile phone,Person City,Person State,LinkedIn Contact Profile URL',
    'A.,Lovelace,Chief Engineer,Analytical Engines,ada@x.com,555-0101,,Tampa,FL,https://www.linkedin.com/in/ada/',
    'G,Hopper,CTO,Elsewhere,grace@navy.mil,,555-0199,Arlington,VA,',
    'Katherine,Johnson,,NASA,,,,Hampton,Virginia,',
    'Nobody,Atall,CEO,Nowhere Inc,n@x.com,,,,,',
  ].join('\n');
  const r = call('matchEnrichment', csv);
  assert.equal(r.rows, 4);
  assert.equal(r.matched, 3);
  assert.equal(r.people[by.get('Ada')].email, 'ada@x.com', 'matched by LinkedIn link');
  assert.equal(r.people[by.get('Ada')].city, 'Tampa');
  assert.equal(r.people[by.get('Grace')].mobile, '555-0199', 'matched by email');
  assert.equal(r.people[by.get('Katherine')].state, 'Virginia', 'matched by name and company');
  assert.throws(() => call('matchEnrichment', 'foo,bar\n1,2'), /no name columns/);
});

test('meeting notes find the people mentioned, the action items and a summary', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ada,Lovelace,https://www.linkedin.com/in/ada,,Analytical Engines,Engineer,05 Oct 2020',
    'Grace,Hopper,https://www.linkedin.com/in/grace,,US Navy,Admiral,01 Jan 2020',
    'José,Núñez,,,NASA,Mathematician,01 Jan 2019'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const by = new Map(people().map(p => [p.f, p.k]));
  const notes = [
    '# OT security sync with Navy',
    '',
    '## Summary',
    'Grace Hopper walked through the shipyard network refresh. Jose Nunez joined late.',
    '',
    '## Action items',
    '- Send Grace the one-way gateway brief',
    '- Schedule a demo for the OT team in November',
    '',
    'Speaker 2: Ada Lovelaceish is not a person here. Grace Hopper again.',
    'TODO: intro to the program office',
  ].join('\n');
  const r = call('readNotes', notes);
  assert.equal(r.title, 'OT security sync with Navy');
  assert.match(r.summary, /shipyard network refresh/);
  assert.deepEqual(r.people.map(p => p.name), ['Grace Hopper', 'José Núñez'], 'accent-folded, whole names only, most mentioned first');
  assert.equal(r.people[0].n, 2, 'full-name mentions only');
  assert.equal(r.actions.length, 3);
  assert.equal(r.actions[0].k, by.get('Grace'), 'action assigned by first name');
  assert.equal(r.actions[2].text, 'intro to the program office');
  assert.equal(call('readNotes', '').people.length, 0);
});
