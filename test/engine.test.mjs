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
  assert.match(m.line, /^Last email .*: “OT roadmap review”\. Ada is waiting on your email reply\./);
  assert.equal(m.waiting, true);
  assert.ok(call('weekly', []).some(w => w.k === by.get('Ada') && w.kind === 'reply' && /Emailed you/.test(w.why)));
  call('markReplied', by.get('Ada'));
  assert.equal(call('memory', by.get('Ada')).waiting, false);
  assert.equal(call('memory', by.get('Grace')).mail.mine, true);
  assert.equal(call('applyMail', [{email: 'ghopper@navy.mil', name: 'Grace Hopper', date: '2026-01-01', dir: 'i', subject: 'old'}]).changed, 0);
  assert.equal(call('clearMail').cleared, 2);
  assert.equal(call('memory', by.get('Grace')).mail, null);
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
  const p = call('addPursuit', {name: 'DISA OT gateway', agency: 'DISA', due: '2026-12-01'});
  let d = call('pursuit', p.id);
  assert.equal(d.roleList.length, 6);
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
