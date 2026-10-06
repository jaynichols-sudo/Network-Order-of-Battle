// A fresh LinkedIn export must only change what changed: new people are added, job changes
// are noted, people no longer listed are kept and marked, and every note, star, industry
// choice and follow-up the user made survives. Runs against the shipped engine bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync('apple/Bearings/Resources/engine.js', 'utf8'))();
const B = globalThis.Bearings;
const call = (name, ...args) => { const r = JSON.parse(B.call(name, JSON.stringify(args))); if (r.error) throw new Error(`${name}: ${r.error}`); return r.ok; };
const file = name => B.fileJSON(name);
const byName = () => new Map(call('people').map(p => [`${p.f} ${p.l}`, p]));

const HEAD = 'Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n';
const csv = rows => HEAD + rows.map(r => r.join(',')).join('\n');
const first = csv([
  ['Ada', 'Lovelace', 'https://www.linkedin.com/in/ada', 'ada@example.com', 'Analytical Engines', 'Chief Engineer', '05 Oct 2020'],
  ['Grace', 'Hopper', 'https://www.linkedin.com/in/grace', '', 'US Navy', 'Rear Admiral', '01 Jan 2020'],
  ['Alan', 'Turing', 'https://www.linkedin.com/in/alan-t', 'alan@example.com', 'Bletchley Park', 'Cryptanalyst', '01 Jan 2019'],
  ['Katherine', 'Johnson', '', '', 'NASA Langley', 'Mathematician', '01 Jan 2018'],
  ['Margaret', 'Hamilton', 'https://www.linkedin.com/in/mh', '', 'Obscure Widgets LLC', 'Director', '01 Jan 2017'],
  ['Claude', 'Shannon', 'https://www.linkedin.com/in/shannon', '', 'Bell Labs', 'Researcher', '01 Jan 2016'],
]);
// a month later: Grace changed jobs, Claude dropped off, Alan changed his profile URL,
// Katherine (no URL in the export) moved company, and someone new connected
const second = csv([
  ['Ada', 'Lovelace', 'https://www.linkedin.com/in/ada', 'ada@example.com', 'Analytical Engines', 'Chief Engineer', '05 Oct 2020'],
  ['Grace', 'Hopper', 'https://www.linkedin.com/in/grace', '', 'Digital Equipment Corp', 'Senior Consultant', '01 Jan 2020'],
  ['Alan', 'Turing', 'https://www.linkedin.com/in/alan-turing-1912', 'alan@example.com', 'Bletchley Park', 'Cryptanalyst', '01 Jan 2019'],
  ['Katherine', 'Johnson', '', '', 'NASA', 'Mathematician', '01 Jan 2018'],
  ['Margaret', 'Hamilton', 'https://www.linkedin.com/in/mh', '', 'Obscure Widgets LLC', 'Director', '01 Jan 2017'],
  ['Barbara', 'Liskov', 'https://www.linkedin.com/in/liskov', '', 'MIT', 'Professor', '01 Oct 2026'],
]);

/** Imports like the apps do: plan, write network.json, reload from the saved files. */
function importAndReload(text, saved){
  const plan = call('importTexts', {connections: text}, 'test');
  const network = file('network');
  if (plan.wasSample) call('clearNotes');
  const files = {network, edits: saved ? saved.edits : file('edits'), review: saved ? saved.review : file('review'),
    targets: file('targets'), industries: saved ? saved.industries : file('industries')};
  call('loadFiles', files, null);
  return plan;
}

test('a second LinkedIn export changes only what changed and keeps all your work', () => {
  call('clearNotes');
  call('loadSample');
  importAndReload(first);
  assert.equal(call('info').mode, 'live');
  let p = byName();
  assert.equal(p.size, 6);

  // the user's work between imports
  call('addNote', p.get('Ada Lovelace').k, 'Met at TechNet', 'event');
  call('setEdit', p.get('Grace Hopper').k, {star: true, tags: ['navy']});
  call('setEdit', p.get('Alan Turing').k, {ind: 'Software & Cloud', note: 'Intro to Bletchley'});
  call('setEdit', p.get('Katherine Johnson').k, {note: 'Space program contact', circle: 'key'});
  call('followUp', p.get('Claude Shannon').k, 14);
  call('setEdit', p.get('Claude Shannon').k, {note: 'Information theory chat'});
  call('setCompanyIndustry', 'Obscure Widgets LLC', 'Manufacturing');
  const saved = {edits: file('edits'), review: file('review'), industries: file('industries')};
  const before = JSON.parse(saved.edits).edits;
  assert.equal(Object.keys(before).length, 5);

  const plan = importAndReload(second, saved);
  assert.equal(plan.wasSample, false);
  assert.equal(plan.stats.added, 1, 'only Barbara is new');
  assert.equal(plan.stats.removed, 1, 'only Claude dropped off');

  p = byName();
  // every note, star, tag, circle and follow-up is still there
  assert.match(p.get('Ada Lovelace').ed.note, /Met at TechNet/);
  assert.equal(p.get('Grace Hopper').ed.star, true);
  assert.deepEqual(p.get('Grace Hopper').ed.tags, ['navy']);
  assert.equal(p.get('Alan Turing').ed.note, 'Intro to Bletchley', 'a changed profile URL is matched back by email');
  assert.equal(p.get('Alan Turing').ed.ind, 'Software & Cloud');
  assert.equal(p.get('Katherine Johnson').ed.note, 'Space program contact', 'no URL and a new company is matched back by name');
  assert.equal(p.get('Katherine Johnson').ed.circle, 'key');
  assert.equal(p.get('Claude Shannon').ed.note, 'Information theory chat', 'people no longer listed keep their notes');
  assert.ok(p.get('Claude Shannon').ed.due);
  assert.ok(p.get('Claude Shannon').x, 'and are marked as no longer in the export');
  assert.equal(p.size, 7, 'nobody is duplicated');

  // the job change is noted, with the old role kept
  const grace = call('person', p.get('Grace Hopper').k);
  assert.equal(grace.c, 'Digital Equipment Corp');
  assert.ok(grace.moved || grace.jc, 'flagged as a job change');

  // the industry you chose for an unassigned company is still applied
  assert.equal(p.get('Margaret Hamilton').cl.ind, 'Manufacturing');
  assert.deepEqual(JSON.parse(file('edits')).edits, before, 'the edits file itself is untouched by the import');
});

test('notes on contacts carry over when the LinkedIn export replaces a starter network', () => {
  call('clearNotes');
  call('loadSample');
  call('startFromContacts', [
    {f: 'Ada', l: 'Lovelace', c: 'Analytical Engines', p: 'Chief Engineer', e: 'ada@example.com'},
    {f: 'Pat', l: 'Neighbor', c: 'Local Hardware', p: 'Owner', e: 'pat@example.com'},
  ]);
  const network = file('network');
  call('loadFiles', {network, edits: file('edits'), review: file('review'), targets: file('targets'), industries: file('industries')}, null);
  assert.equal(call('info').mode, 'starter');
  const s = byName();
  call('addNote', s.get('Ada Lovelace').k, 'Starter note');
  call('addNote', s.get('Pat Neighbor').k, 'Not on LinkedIn but important');

  const plan = call('importTexts', {connections: first}, 'test');
  assert.equal(plan.wasStarter, true);
  call('loadFiles', {network: file('network'), edits: file('edits'), review: file('review'), targets: file('targets'), industries: file('industries')}, null);
  const p = byName();
  assert.match(p.get('Ada Lovelace').ed.note, /Starter note/, 'matched to the LinkedIn person');
  assert.ok(p.get('Pat Neighbor'), 'a contact with notes who is not a connection is kept');
  assert.match(p.get('Pat Neighbor').ed.note, /Not on LinkedIn but important/);
});
