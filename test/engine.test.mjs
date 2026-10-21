// Tests for the shared engine, run against the exact bundle the iPhone, iPad and Mac ship
// (apple/Northfix/Resources/engine.js). Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync('apple/Northfix/Resources/engine.js', 'utf8'))();
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
  // the sample comes with example pursuits; these tests start without them (see capture.test.mjs)
  for (const p of call('pursuits')) call('removePursuit', p.id);
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
    assert.ok(['reply', 'circle', 'due', 'seat', 'congrats', 'cold', 'anniv', 'new', 'checkin', 'intro', 'move'].includes(p.kind), p.kind);
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
  assert.match(raw('restore', '{"hello":1}').error, /isn’t a Northfix backup/);
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
  assert.throws(() => call('addTeamPack', '{"kind":"notes-backup"}'), /isn’t a Northfix team pack/);
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

test('memory recalls the last note, the last message and what is pending', () => {
  const p = people().find(x => x.waiting);
  let m = call('memory', p.k);
  assert.match(m.line, /waiting on your reply/);
  call('addNote', p.k, 'Talked about the OT summit and his new team', 'Plaud');
  m = call('memory', p.k);
  assert.match(m.line, /^Last time \(.+\): Talked about the OT summit/);
  assert.equal(m.last.source, 'Plaud');
  assert.equal(call('memory', 'nobody'), null);
});

test('org chart lays out who you and your team know at a company by level, with gaps', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ada,Lovelace,,,Acme Corp,Chief Technology Officer,05 Oct 2020',
    'Grace,Hopper,,,Acme Corp,Software Engineer,01 Jan 2020',
    'Kate,Johnson,,,Acme Corp,Contracts Manager,01 Jan 2019',
    'Alan,Turing,,,Other Co,Engineer,01 Jan 2019'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  call('addTeamPack', JSON.stringify({kind: 'bearings-team-pack', v: 1, owner: 'Sam', made: '2026-01-01', people: [{f: 'Mary', l: 'Jackson', c: 'Acme Corp', p: 'VP of Sales', b: 'warm'}]}));
  const by = new Map(people().map(p => [p.f, p.k]));
  call('setReportsTo', by.get('Grace'), by.get('Ada'));
  const o = call('orgChart', 'Acme');
  assert.equal(o.company, 'Acme Corp');
  assert.equal(o.total, 4);
  const top = o.levels[0];
  assert.equal(top.id, 'C-suite / Owner');
  assert.equal(top.people[0].name, 'Ada Lovelace');
  const vp = o.levels.find(l => l.id === 'VP');
  assert.equal(vp.people[0].src, 'team');
  assert.equal(vp.people[0].owner, 'Sam');
  assert.deepEqual(o.links, [{from: by.get('Grace'), to: by.get('Ada')}]);
  assert.ok(!o.levels.flatMap(l => l.people).some(p => p.name === 'Alan Turing'));
});

test('org chart for a mapped agency lays people into its real offices', () => {
  const o = call('orgChart', 'DISA');
  assert.ok(o.levels.length > 0, 'levels are still there');
  const s = o.structure;
  assert.ok(s, 'DISA has a structure');
  assert.equal(s.agency, 'Defense Information Systems Agency');
  assert.equal(s.leader, 'Director');
  assert.ok(s.asOf && /^https:\/\//.test(s.source));
  assert.ok(s.offices.length >= 8);
  const office = code => s.offices.find(x => x.code === code);
  const psd = office('PSD');
  assert.ok(psd.filled && psd.people.length > 0, 'contracting officers sit in Procurement Services');
  assert.ok(psd.people.every(p => /contract/i.test(p.p)));
  assert.equal(office('WHCA').filled, false);
  assert.deepEqual(office('WHCA').people, []);
  // every placed person is someone from the levels, and nobody is placed twice
  const inLevels = new Set(o.levels.flatMap(l => l.people.map(p => p.name)));
  const placed = s.offices.flatMap(x => x.people.map(p => p.name));
  assert.ok(placed.every(n => inLevels.has(n)));
  assert.equal(new Set(placed).size, placed.length);
  // a title that names no office leaves the person out of the offices
  assert.ok(!placed.some(n => o.levels.flatMap(l => l.people).find(p => p.name === n && /Zero Trust/.test(p.p))));
});

test('org chart offices follow titles and company names for other agencies', () => {
  const office = (s, code) => s.offices.find(x => x.code === code);
  const cisa = call('orgChart', 'CISA').structure;
  assert.equal(cisa.agency, 'Cybersecurity and Infrastructure Security Agency');
  assert.ok(office(cisa, 'IOD').people.some(p => /Protective Security Advisor/.test(p.p)));
  assert.ok(office(cisa, 'CSD').people.some(p => /ICS Assessments/.test(p.p)));
  const usace = call('orgChart', 'Army Corps').structure;
  assert.ok(office(usace, 'SAD').people.some(p => /Wilmington District/.test(p.p)), 'a district lands in its division');
  const cyber = call('orgChart', 'Cyber Command').structure;
  assert.equal(cyber.agency, 'U.S. Cyber Command');
  assert.ok(office(cyber, 'ARCYBER').people.length > 0);
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ada,Lovelace,,,NAVFAC Southeast,Environmental Program Manager,05 Oct 2020',
    'Grace,Hopper,,,NAVFAC Southeast,Contract Specialist,01 Jan 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const nav = call('orgChart', 'NAVFAC').structure;
  assert.deepEqual(office(nav, 'EV').people.map(p => p.name), ['Ada Lovelace'], 'the title wins');
  assert.deepEqual(office(nav, 'LANT').people.map(p => p.name), ['Grace Hopper'], 'then the company');
});

test('unknown companies have no structure, and structureFor works with no one known', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ada,Lovelace,,,Acme Corp,Chief Technology Officer,05 Oct 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  assert.equal(call('orgChart', 'Acme').structure, undefined);
  assert.equal(call('structureFor', 'Acme'), null);
  assert.equal(call('structureFor', 'Not An Agency At All'), null);
  const ferc = call('structureFor', 'Federal Energy Regulatory Commission');
  assert.equal(ferc.agency, 'Federal Energy Regulatory Commission');
  assert.ok(ferc.offices.length > 0);
  assert.ok(ferc.offices.every(x => !x.filled && x.people.length === 0));
  assert.ok(ferc.offices.some(x => x.code === 'OEIS'));
  assert.equal(call('structureFor', 'FERC').agency, 'Federal Energy Regulatory Commission');
});

test('email dates and subjects feed memory, waiting and the weekly five', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ada,Lovelace,,ada@acme.com,Acme Corp,Chief Technology Officer,05 Oct 2020',
    'Grace,Hopper,,,Navy,Rear Admiral,01 Jan 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const by = new Map(people().map(p => [p.f, p.k]));
  const today = call('info').today;
  const r = call('applyMail', [
    {email: 'ADA@acme.com', name: 'Someone', date: today, dir: 'i', subject: 'OT roadmap review'},
    {email: 'ada@acme.com', date: '2026-01-02', dir: 'o', subject: 'Older'},
    {email: 'ghopper@navy.mil', name: 'Hopper, Grace', date: '2026-02-03T10:00:00Z', dir: 'o', subject: 'Thanks'},
    {email: 'nobody@x.com', name: 'No One', date: today, dir: 'i', subject: 'Spam'}]);
  assert.equal(r.matched, 2);
  let m = call('memory', by.get('Ada'));
  assert.match(m.line, /^Ada emailed you today: “OT roadmap review”, you haven’t replied\./);
  assert.equal(m.waiting, true);
  assert.ok(call('weekly', []).some(w => w.k === by.get('Ada') && w.kind === 'reply' && /Emailed you/.test(w.why)));
  assert.ok(call('home', {}).cards.some(c => /waiting on your reply/.test(c.title) && /Ada Lovelace \(by email\)/.test(c.body)), 'the home card counts email too');
  assert.ok(call('people').find(p => p.k === by.get('Ada')).waiting, 'waiting flag covers email');
  assert.ok(searchKeys({filters: {sig: ['waiting']}}).includes(by.get('Ada')));
  call('markReplied', by.get('Ada'));
  assert.equal(call('memory', by.get('Ada')).waiting, false);
  assert.equal(call('memory', by.get('Grace')).mail.mine, true);
  call('applyMail', [{email: 'ghopper@navy.mil', name: 'Grace Hopper', date: '2026-01-01', dir: 'i', subject: 'old'}]);
  const g = call('person', by.get('Grace')).mail;
  assert.deepEqual([g.lastOut, g.subjectOut, g.lastIn, g.subjectIn, g.n90], ['2026-02-03', 'Thanks', '2026-01-01', 'old', 0], 'older mail fills in the last one each way but never moves the latest');
  assert.equal(call('memory', by.get('Grace')).mail.mine, true);
  assert.equal(call('applyMail', [{email: 'ghopper@navy.mil', name: 'Grace Hopper', date: '2026-01-01', dir: 'i', subject: 'old'}]).changed, 0, 'a repeat changes nothing');
  assert.equal(call('clearMail').cleared, 2);
  assert.equal(call('memory', by.get('Grace')).mail, null);
  assert.equal(call('person', by.get('Grace')).mail, undefined);
});

test('email touchpoints: last each way, count in 90 days, timeline events, no bodies', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Dana,Whitfield,,dana@navfac.navy.mil,NAVFAC,Program Manager,05 Oct 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  const netFile = globalThis.Bearings.fileJSON('network');
  call('loadFiles', { network: netFile }, null);
  const k = people()[0].k;
  const today = call('info').today;
  const day = n => new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10);
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push({email: 'dana@navfac.navy.mil', name: 'Dana Whitfield', date: day(20 + i * 10) + 'T09:00:00Z', dir: i % 2 ? 'o' : 'i', subject: `Thread ${i}`, body: 'SHOULD NEVER BE STORED'});
  rows.push({email: 'dana@navfac.navy.mil', date: day(3), dir: 'o', subject: '  Re: NAVFAC   pilot '});
  rows.push({email: 'dana@navfac.navy.mil', date: day(12), dir: 'i', subject: 'Site visit'});
  rows.push({email: 'dana@navfac.navy.mil', date: day(400), dir: 'i', subject: 'Ancient'});
  assert.equal(call('applyMail', rows).changed, 1);
  const p = call('person', k);
  assert.deepEqual({lastIn: p.mail.lastIn, lastOut: p.mail.lastOut, subjectIn: p.mail.subjectIn, subjectOut: p.mail.subjectOut, n90: p.mail.n90, more: p.mail.more},
    {lastIn: day(12), lastOut: day(3), subjectIn: 'Site visit', subjectOut: 'Re: NAVFAC pilot', n90: 10, more: 5});
  assert.equal(p.mail.events.length, 5, 'at most five on the timeline');
  assert.deepEqual(p.mail.events[0], {kind: 'email-out', date: day(3), subject: 'Re: NAVFAC pilot'});
  assert.deepEqual(p.mail.events[1], {kind: 'email-in', date: day(12), subject: 'Site visit'});
  assert.ok(p.mail.events.every(e => e.date >= p.mail.events[4].date), 'newest first');
  assert.doesNotMatch(JSON.stringify(call('person', k)) + globalThis.Bearings.fileJSON('edits'), /NEVER BE STORED|Ancient/, 'no bodies, and nothing older than the window');
  assert.ok(!people().find(x => x.k === k).mail, 'the list payload stays slim');
  const m = call('memory', k);
  assert.equal(m.line, `You emailed Dana 3 days ago: “Re: NAVFAC pilot”.`);
  assert.equal(m.waiting, false);
  assert.equal(m.mail.lastIn, day(12));
  // the next sync overlaps the last one: nothing doubles up, newer mail lands on top
  const again = call('applyMail', [{email: 'dana@navfac.navy.mil', date: day(3), dir: 'o', subject: 'Re: NAVFAC pilot'}]);
  assert.equal(again.changed, 0, 'a repeat header changes nothing');
  call('applyMail', [{email: 'dana@navfac.navy.mil', date: day(1), dir: 'i', subject: 'Re: Re: NAVFAC pilot'}]);
  const q = call('person', k);
  assert.equal(q.mail.n90, 11);
  assert.equal(q.mail.lastIn, day(1));
  assert.equal(q.mail.lastOut, day(3));
  assert.equal(q.mailWaiting, true);
  assert.equal(call('memory', k).line, `Dana emailed you yesterday: “Re: Re: NAVFAC pilot”, you haven’t replied.`);
  assert.ok(call('weekly', []).some(w => w.k === k && w.kind === 'reply' && /Emailed you yesterday about “Re: Re: NAVFAC pilot”/.test(w.why)));
  // saved edits from an older version (one email, no list) still read
  call('loadFiles', { network: netFile, edits: JSON.stringify({edits: {[k]: {mail: {t: day(5), dir: 'i', s: 'Legacy', n: 2}}}}) }, null);
  const legacy = call('person', k).mail;
  assert.deepEqual(legacy.events, [{kind: 'email-in', date: day(5), subject: 'Legacy'}]);
  assert.equal(legacy.lastIn, day(5));
  assert.equal(legacy.lastOut, '');
  call('applyMail', [{email: 'dana@navfac.navy.mil', date: day(2), dir: 'o', subject: 'Back to you'}]);
  const up = call('person', k).mail;
  assert.equal(up.events.length, 2);
  assert.equal(up.lastIn, day(5));
  assert.equal(up.lastOut, day(2));
});

test('people from an enrichment file you are not connected to fill empty org chart seats', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Grace,Hopper,,,Acme Corp,Software Engineer,01 Jan 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const file = 'First Name,Last Name,Job Title,Company Name,Email Address\nGrace,Hopper,Engineer,Acme Corp,g@acme.com\nAda,Lovelace,Chief Technology Officer,Acme Corp,ada@acme.com\nNo,Company,CEO,,x@y.com';
  const m = call('matchEnrichment', file, 'zoominfo');
  assert.equal(m.matched, 1);
  assert.equal(m.added, 1);
  const o = call('orgChart', 'Acme');
  assert.equal(o.known, 1);
  assert.equal(o.listed, 1);
  const top = o.levels.find(l => l.id === 'C-suite / Owner').people[0];
  assert.equal(top.name, 'Ada Lovelace');
  assert.equal(top.src, 'list');
  assert.equal(top.owner, 'zoominfo');
  assert.ok(o.gaps.length >= 1);
  const saved = JSON.parse(globalThis.Bearings.fileJSON('prospects'));
  assert.equal(saved.prospects.length, 1);
  assert.equal(call('addProspects', [{name: 'Ada Lovelace', p: 'CTO', c: 'Acme Corp'}], 'zoominfo'), 0);
  assert.equal(call('clearProspects', 'Acme').removed, 1);
});

test('pursuits map the people who decide an opportunity, with gaps and suggestions', () => {
  call('loadSample');
  for (const x of call('pursuits')) call('removePursuit', x.id);
  const p = call('addPursuit', {name: 'DISA OT gateway', agency: 'DISA', due: '2026-12-01'});
  let d = call('pursuit', p.id);
  assert.equal(d.roleList.length, 8);
  assert.ok(d.known > 0);
  const withSuggest = d.roleList.find(r => r.suggest.length);
  assert.ok(withSuggest, 'some role has suggestions');
  call('assignRole', p.id, withSuggest.role, withSuggest.suggest[0].k, true);
  d = call('pursuit', p.id);
  assert.equal(d.filled, 1);
  assert.equal(d.roleList.find(r => r.role === withSuggest.role).people[0].k, withSuggest.suggest[0].k);
  call('updatePursuit', p.id, {stage: 'Proposal'});
  assert.equal(call('pursuits')[0].stage, 'Proposal');
  const saved = JSON.parse(globalThis.Bearings.fileJSON('pursuits'));
  assert.equal(saved.pursuits.length, 1);
  call('removePursuit', p.id);
  assert.equal(call('pursuits').length, 0);
});

test('moves flag people leaving service and long tours', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Pat,Lee,,,US Navy,Commander (O-5) transitioning via SkillBridge,05 Oct 2020',
    'Sam,Ray,,,US Army,Lieutenant Colonel (O-5),01 Jan 2020',
    'Ann,Cole,,,Acme Corp,Engineer,01 Jan 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const by = new Map(people().map(p => [p.f, p.k]));
  call('setRoleSince', by.get('Sam'), '2023-06');
  const ms = call('moves');
  assert.equal(ms[0].k, by.get('Pat'));
  assert.equal(ms[0].kind, 'transition');
  const sam = ms.find(m => m.k === by.get('Sam'));
  assert.equal(sam.kind, 'pcs');
  assert.ok(!ms.some(m => m.k === by.get('Ann')));
  assert.match(call('memory', by.get('Sam')).line, /Likely to rotate/);
});

test('quick log files a spoken note, a touch and a follow-up', () => {
  call('loadSample');
  const p = people().find(x => x.f && x.l);
  const r = call('quickLog', `Just met ${p.f} ${p.l}, wants pricing by Friday`);
  assert.equal(r.people[0].k, p.k);
  assert.ok(r.days >= 1 && r.days <= 7);
  const m = call('memory', p.k);
  assert.equal(m.last.source, 'Voice');
  assert.ok(call('person', p.k).ed.due);
  assert.equal(call('quickLog', 'nobody here', false).people.length, 0);
});

test('intros are tracked on the person you asked, with nudges', () => {
  call('loadSample');
  const p = people()[0];
  call('addIntro', p.k, 'Robert Hale', 'DISA');
  let list = call('intros');
  assert.equal(list.length, 1);
  assert.equal(list[0].st, 'asked');
  call('setIntro', p.k, list[0].id, 'made');
  list = call('intros');
  assert.equal(list[0].st, 'made');
  assert.equal(list[0].nudge, false);
});

test('ask answers plain questions from the network', () => {
  call('loadSample');
  assert.equal(call('ask', 'Who is waiting on me?').kind, 'waiting');
  const at = call('ask', 'Who do I know at DISA?');
  assert.equal(at.kind, 'at');
  assert.ok(at.people.length > 0);
  assert.equal(call('ask', 'Who should I see in San Diego next week?').kind, 'city');
  assert.equal(call('ask', 'Who can get me into NAVFAC').kind, 'ways');
  assert.ok(['search', 'at'].includes(call('ask', 'navy o-5 and up in cyber').kind));
});

test('account trends count reach by month and snapshot coverage weekly', () => {
  call('loadSample');
  const t = call('trend', 'DISA');
  assert.equal(t.months.length, 12);
  assert.ok(t.months[11].known >= t.months[0].known);
  assert.equal(call('snapshot'), true);
  assert.equal(call('snapshot'), false);
  assert.equal(call('trend', 'DISA').snaps.length, 1);
  assert.ok(Array.isArray(call('targetChanges')));
});

test('social downloads merge into one picture across platforms', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Jane,Doe,,,Acme Corp,Engineer,05 Oct 2020',
    'Bob,Stone,,,Navy,Commander,01 Jan 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const by = new Map(people().map(p => [p.f, p.k]));
  const fb = call('importSocial', 'facebook', {'connections/friends/your_friends.json': JSON.stringify({friends_v2: [{name: 'Jane Doe', timestamp: 1400000000}, {name: 'Aunt May', timestamp: 1300000000}]}),
    'connections/friends/sent_friend_requests.json': JSON.stringify({sent_requests_v2: [{name: 'Bob Stone', timestamp: 1}]})});
  assert.equal(fb.matched, 1);
  assert.equal(fb.added, 2);
  const sc = call('importSocial', 'snapchat', {'json/friends.json': JSON.stringify({Friends: [{Username: 'janedoe22', 'Display Name': 'Jane Doe', 'Creation Timestamp': '2019-01-01 00:00:00 UTC'}]})});
  assert.equal(sc.matched, 1);
  const ig = call('importSocial', 'instagram', {
    'connections/followers_and_following/followers_1.json': JSON.stringify([{string_list_data: [{value: 'janedoe22', href: 'https://www.instagram.com/janedoe22', timestamp: 1600000000}]}, {string_list_data: [{value: 'bobstone', timestamp: 1600000000}]}]),
    'connections/followers_and_following/following.json': JSON.stringify({relationships_following: [{title: 'janedoe22', string_list_data: [{href: 'https://www.instagram.com/_u/janedoe22', timestamp: 1600000000}]}, {string_list_data: [{value: 'randomperson', timestamp: 1}]}]})});
  assert.equal(ig.matched, 2);
  const tt = call('importSocial', 'tiktok', {'user_data_tiktok.json': JSON.stringify({Profile: {}, Activity: {'Following List': {Following: [{Date: '2023-02-01 10:00:00', UserName: 'bobstone'}]}, 'Follower List': {FansList: [{Date: '2023-02-01', UserName: 'bobstone'}]}}})});
  assert.equal(tt.matched, 1);
  const all = call('socials');
  const jane = all.people.find(p => p.k === by.get('Jane'));
  assert.deepEqual(jane.on.sort(), ['facebook', 'instagram', 'snapchat']);
  assert.equal(jane.ties, 4);
  assert.equal(all.strongest[0].k, by.get('Jane'));
  const bob = all.people.find(p => p.k === by.get('Bob'));
  assert.ok(bob.on.includes('tiktok') && bob.on.includes('instagram'));
  assert.equal(all.people.find(p => p.k === by.get('Bob')).on.includes('facebook'), false, 'sent requests are not friends');
  assert.ok(all.people.some(p => p.name === 'Aunt May' && !p.linkedin));
  assert.equal(all.unique, 2 + all.people.filter(p => !p.linkedin).length);
  assert.match(call('memory', by.get('Jane')).line, /Also connected on Facebook, Snapchat and Instagram|Also connected on/);
  assert.ok(call('person', by.get('Jane')).social.on.facebook);
  const re = call('importSocial', 'facebook', {'your_friends.json': JSON.stringify({friends_v2: [{name: 'Jane Doe', timestamp: 1400000000}]})});
  assert.equal(re.matched, 1);
  assert.ok(!call('socials').people.some(p => p.name === 'Aunt May'), 'a fresh download replaces the old list');
  const saved = JSON.parse(globalThis.Bearings.fileJSON('social'));
  assert.ok(saved.social.length >= 2);
});

test('the federal map shows where you are connected and where you are not', () => {
  const net = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Ann,Lee,,,Cybersecurity and Infrastructure Security Agency,Senior Advisor,05 Oct 2020',
    'Bo,Kim,,,U.S. Army Corps of Engineers,Director of Programs,01 Jan 2020',
    'Cy,Ray,,,Acme Corp,Ice cream maker,01 Jan 2020',
    'Di,Fox,,,Idaho National Laboratory,Program Manager,01 Jan 2020'].join('\n');
  call('importTexts', { connections: net }, 'test');
  call('loadFiles', { network: globalThis.Bearings.fileJSON('network') }, null);
  const m = call('agencyCoverage');
  assert.ok(m.totals.agencies > 140);
  const row = s => m.rows.find(r => r.short === s);
  assert.equal(row('CISA').known, 1);
  assert.equal(row('USACE').known, 1);
  assert.equal(row('INL').known, 1);
  assert.equal(row('ICE').known, 0, 'acronyms match case-sensitively');
  assert.equal(row('USACE').status, 'thin');
  assert.equal(row('NSA').status, 'none');
  assert.equal(row('NSA').gap, 'No one yet');
  assert.ok(m.depts.find(d => d.name === 'Energy').thin >= 1);
  assert.equal(m.totals.covered + m.totals.thin + m.totals.none, m.totals.agencies);
});

test('team shares: people, pursuits and watchlist, never notes', () => {
  const k = people().find(p => p.c)?.k;
  call('setEdit', k, { note: 'secret note', tags: ['vip'] });
  const id = call('addPursuit', { name: 'DISA pilot', agency: 'DISA' }).id;
  call('assignRole', id, 'Contracting officer', k, true);
  const share = JSON.parse(call('teamShare', 'Jay'));
  assert.equal(share.kind, 'bearings-team-share');
  assert.equal(share.v, 2);
  assert.equal(share.pursuits.length, 1);
  assert.equal(share.pursuits[0].roles[0].role, 'Contracting officer');
  assert.ok(share.targets.includes('DISA'));
  const text = JSON.stringify(share);
  assert.ok(!text.includes('secret note') && !text.includes('vip'), 'notes and tags never leave the device');
  assert.deepEqual(Object.keys(share.people[0]).sort(), ['b', 'c', 'f', 'l', 'p', 'u']);
});

test('team server shares replace each other; hand-added packs stay', () => {
  call('addTeamPack', JSON.stringify({ kind: 'bearings-team-pack', v: 1, owner: 'Jim', people: [{ f: 'A', l: 'B', c: 'NAVFAC', b: 'warm' }] }));
  const shares = call('demoTeamShares');
  assert.equal(shares.length, 3);
  let list = call('setTeamShares', shares);
  assert.equal(list.length, 4);
  assert.equal(list.filter(t => t.id).length, 3);
  list = call('setTeamShares', shares.slice(0, 1).concat([{ id: 'bad', text: 'not json' }]));
  assert.deepEqual(list.map(t => t.owner).sort(), ['Jim', 'Pat Morgan']);
  assert.equal(call('removeTeamPack', 'Pat Morgan').length, 2, 'server shares are removed by leaving, not by hand');
});

test('the federal map counts the team, and keeps your own status', () => {
  const alone = call('agencyCoverage', false);
  call('setTeamShares', call('demoTeamShares'));
  const team = call('agencyCoverage', true);
  assert.equal(team.totals.agencies, alone.totals.agencies);
  assert.ok(team.totals.none < alone.totals.none, 'teammates fill gaps');
  assert.deepEqual(team.mine, { covered: alone.totals.covered, thin: alone.totals.thin, none: alone.totals.none });
  const filled = team.rows.find(r => r.mine === 'none' && r.status !== 'none');
  assert.ok(filled && filled.teamKnown > 0 && filled.teamBest.length > 0);
  assert.equal(call('agencyCoverage', false).totals.none, alone.totals.none, 'without the team, only your people count');
});

test('agency display names match as employers', () => {
  call('setTeamShares', [{ id: 'x', text: JSON.stringify({ kind: 'bearings-team-share', v: 2, owner: 'Pat',
    people: [{ f: 'Dana', l: 'Ruiz', c: 'DoD Chief Information Officer', p: 'Deputy CIO', b: 'strong' }], targets: ['DoD CIO'] }) }]);
  const row = call('agencyCoverage', true).rows.find(r => r.short === 'DoD CIO');
  assert.equal(row.teamKnown, 1);
  const o = call('teamOverview');
  const t = o.targets.find(x => x.name === 'DoD CIO');
  assert.equal(t.team, 1);
  assert.deepEqual(t.owners, ['Pat']);
});

test('team overview: members, combined reach, pursuits and watchlist', () => {
  call('addPursuit', { name: 'Mine', agency: 'NAVFAC', due: '2026-12-01' });
  call('setTeamShares', call('demoTeamShares'));
  const o = call('teamOverview');
  assert.equal(o.members.length, 3);
  assert.ok(o.agencies.team > o.agencies.mine);
  assert.ok(o.people > o.me.count);
  assert.equal(o.pursuits.filter(p => p.mine).length, 1);
  assert.equal(o.pursuits.filter(p => !p.mine).length, 3);
  assert.ok(o.targets.some(t => t.owners.includes('You') && t.owners.length > 1), 'a shared watchlist account shows who watches it');
});

test('quote: one per day, stable within a day, changes the next day', async () => {
  const {quote, QUOTES} = await import('../src/quotes.js');
  const a = quote('2026-10-12'), b = quote('2026-10-12'), c = quote('2026-10-13');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.text && a.by);
  const seen = new Set(); for (let i = 0; i < QUOTES.length; i++) seen.add(quote(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)).text);
  assert.equal(seen.size, QUOTES.length);
});

test('social import reads Meta HTML downloads (Facebook friends, Instagram followers)', async () => {
  const html = fs.readFileSync(new URL('./fixtures/fb_your_friends.html', import.meta.url), 'utf8');
  const ig = fs.readFileSync(new URL('./fixtures/ig_followers_1.html', import.meta.url), 'utf8');
  call('loadSample');
  const r = call('importSocial', 'facebook', {'connections/friends/your_friends.html': html});
  assert.equal(r.entries, 3);
  const s = call('socials');
  const names = JSON.stringify(s);
  assert.ok(names.includes('Dana Whitfield') && names.includes("Zoë O'Neil"), 'names decoded');
  assert.ok(!names.includes('Generated by'), 'footer skipped');
  const r2 = call('importSocial', 'instagram', {'connections/followers_and_following/followers_1.html': ig});
  assert.equal(r2.entries, 2);
});

test('social import: Facebook reads only friend and follower lists, and reports a limited date range', () => {
  call('loadSample');
  const page = (rows, extra = '') => `<html><body>${extra}${rows.map(([n, d]) => `<div class="_a6-p"><div><div>${n}</div><div>${d}</div></div></div>`).join('')}</body></html>`;
  const range = '<div>Contains data you requested from</div><div>October 12, 2025 at 11:56 AM</div><div>to</div><div>October 12, 2026 at 11:56 AM</div>';
  const r = call('importSocial', 'facebook', {
    'x/connections/friends/your_friends.html': page([['Dana Whitfield', 'Mar 14, 2026 6:02:11 pm']], range),
    'x/logged_information/activity_messages/people_and_friends.html': page([['Someone Reacted', 'Oct 04, 2026 11:39:30 am'], ['Another Person', 'Oct 05, 2026 1:00:00 pm']]),
    'x/connections/friends/suggested_friends.html': page([['Suggested Guy', 'Oct 01, 2026 1:00:00 pm']]),
  });
  assert.equal(r.entries, 1, 'activity and suggestions are not friends');
  assert.deepEqual(r.range, {from: 'October 12, 2025', to: 'October 12, 2026'});
});
