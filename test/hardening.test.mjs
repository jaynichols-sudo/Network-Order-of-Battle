// Hardening for the parts that talk to outside services and haven't met them on a real device
// yet: USASpending.gov (recompetes, teaming partners), SAM.gov, the TripIt feed and the AI
// connector. Every answer here is a saved fixture or a hand-made bad answer. No network.
// Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

new Function(fs.readFileSync('apple/Northfix/Resources/engine.js', 'utf8'))();
const call = (name, ...args) => {
  const r = JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args)));
  if (r.error) throw new Error(`${name}: ${r.error}`);
  return r.ok;
};
const today = () => call('info').today;
const day = n => new Date(Date.parse(today() + 'T12:00:00') + n * 864e5).toISOString().slice(0, 10);
// fixture dates are written as @END_<days from today>, with T for a full timestamp
const fixture = name => fs.readFileSync(`test/fixtures/${name}`, 'utf8')
  .replace(/@END_(-?\d+)(T?)/g, (_, n, t) => day(+n) + (t ? 'T00:00:00' : ''));

beforeEach(() => {
  call('clearNotes');
  call('loadSample');
});

/* ---------- USASpending.gov ---------- */
test('USASpending: a real-shaped answer reads cleanly, skipping rows with no id and nulls', () => {
  const page = call('awardPage', fixture('usaspending-awards.json'), 200);
  assert.equal(page.error, undefined);
  assert.equal(page.more, true);
  assert.equal(page.items.length, 5, 'the row with no id and the null row are skipped');
  const parsons = page.items.find(x => x.piid === 'N4008025C0404');
  assert.equal(parsons.recipient, 'PARSONS GOVERNMENT SERVICES INC.');
  assert.equal(parsons.amount, 0);
  assert.equal(parsons.end, '');
  assert.equal(parsons.naics, '');
  const amentum = page.items.find(x => x.piid === 'N4008525C0505');
  assert.equal(amentum.amount, 7250000.5, 'amounts sent as strings still read');
  assert.equal(amentum.end, day(300), 'a timestamp end date reads as a day');
  assert.equal(amentum.desc, 'FACILITIES SUPPORT SERVICES');
  assert.equal(page.items.find(x => x.piid === 'N6247023F0303').desc, '');
});

test('USASpending: NAVFAC is narrowed by contract number, since the API sends no office', () => {
  const nav = call('awardRequests', ['NAVFAC'], 24)[0];
  const page = call('awardPage', fixture('usaspending-awards.json'), 200);
  const rc = call('recompetes', [{agencyId: nav.agencyId, items: page.items}], {months: 24});
  const ids = rc.items.map(x => x.piid).sort();
  // NAVSEA's ship repair is out, Jacobs already ended, Parsons has no end date
  assert.deepEqual(ids, ['N4008525C0505', 'N6945024C0101']);
  assert.equal(rc.items.find(x => x.piid === 'N6945024C0101').office, '');
  const tp = call('teamingPartners', [{agencyId: nav.agencyId, items: page.items}], {});
  assert.ok(!tp.items.some(x => /Huntington/.test(x.name)), 'NAVSEA work is not a NAVFAC teaming partner');
});

test('USASpending: a command with no known office code shows contracts as filed under its service', () => {
  const rq = call('awardRequests', ['AFCEC'], 24)[0];
  assert.equal(rq.body.filters.agencies[0].name, 'Department of the Air Force');
  const items = [{id: 'CONT_AWD_FA890324C0001', piid: 'FA890324C0001', recipient: 'JACOBS', end: day(120), amount: 3e6, sub: 'Department of the Air Force', office: '', desc: 'CIVIL ENGINEERING'}];
  const rc = call('recompetes', [{agencyId: rq.agencyId, items}], {months: 24});
  assert.equal(rc.total, 1);
  assert.equal(rc.items[0].office, 'filed under Department of the Air Force');
});

test('USASpending: errors, busy signals, HTML pages and empty bodies come back in plain English', () => {
  const busy = call('awardPage', '<html><body>Too Many Requests</body></html>', 429);
  assert.equal(busy.code, 'rate');
  assert.match(busy.error, /busy/);
  assert.equal(call('awardPage', '', 503).code, 'rate');
  const down = call('awardPage', '<html><h1>502 Bad Gateway</h1></html>', 502);
  assert.match(down.error, /having trouble \(error 502\)/);
  assert.match(call('awardPage', '<html>Forbidden</html>', 403).error, /didn’t answer \(error 403\)/);
  assert.match(call('awardPage', '{"detail":"Field \'filters\' is missing"}', 422).error, /said: Field 'filters' is missing/);
  assert.match(call('awardPage', '{"detail":[{"loc":["body"],"msg":"bad"}]}', 422).error, /said: error 422/);
  assert.match(call('awardPage', '', 200).error, /empty answer/);
  assert.match(call('awardPage', '[]', 200).error, /empty answer/);
  assert.match(call('awardPage', '{"results": [', 200).error, /couldn’t read/);
  const none = call('awardPage', '{"results": null, "page_metadata": null}', 200);
  assert.deepEqual(none, {items: [], more: false});
  // the apps older than this change send no status
  assert.match(call('awardPage', 'not json').error, /couldn’t read/);
});

test('USASpending: one failed agency keeps its last answer instead of emptying the screen', () => {
  const old = [{agencyId: 'a', items: [{id: '1'}]}, {agencyId: 'b', items: [{id: '2'}]}, {agencyId: 'gone', items: [{id: '3'}]}];
  const got = [{agencyId: 'a', items: [{id: '4'}]}];
  const merged = call('mergeAwardPages', old, got, ['a', 'b']);
  assert.deepEqual(merged.map(p => p.agencyId).sort(), ['a', 'b']);
  assert.deepEqual(merged.find(p => p.agencyId === 'a').items, [{id: '4'}], 'fresh answers win');
  assert.deepEqual(call('mergeAwardPages', [{agencyId: 'a', items: [{id: 's', demo: true}]}], [], ['a']), [], 'sample awards never carry over');
  assert.deepEqual(call('mergeAwardPages', null, null, null), []);
});

test('USASpending: junk pages and items never throw', () => {
  const rc = call('recompetes', [null, {agencyId: 'nope'}, {agencyId: call('awardRequests', ['DISA'], 24)[0].agencyId, items: [null, 5, 'x', {id: ''}, {id: 'k', end: 'soon'}]}], {months: 'abc'});
  assert.equal(rc.total, 0);
  assert.equal(rc.months, 24);
  assert.equal(call('teamingPartners', 'not a list', null).total, 0);
  assert.deepEqual(call('awardRequests', ['Not an agency anywhere'], 24), []);
});

/* ---------- SAM.gov ---------- */
test('SAM.gov: every error shape reads in plain English, and only a real limit counts as the limit', () => {
  const page = (t, s) => call('opportunityPage', t, s);
  assert.equal(page('{"error":{"code":"API_KEY_INVALID","message":"An invalid api_key was supplied."}}', 403).code, 'key');
  assert.equal(page('<html>Forbidden</html>', 403).code, 'key');
  assert.equal(page('{"error":{"code":"OVER_RATE_LIMIT","message":"You have exceeded your rate limit."}}', 429).code, 'rate');
  assert.equal(page('', 429).code, 'rate');
  const bad = page('{"errorCode":"400","errorMessage":"Limit must be between 1 and 1000"}', 400);
  assert.equal(bad.code, undefined, 'a bad limit is not the daily limit');
  assert.match(bad.error, /said: Limit must be between 1 and 1000/);
  assert.match(page('{"title":"Bad Request","detail":"PostedFrom and PostedTo are mandatory"}', 400).error, /said: PostedFrom and PostedTo are mandatory/);
  assert.match(page('{"error":"Invalid request"}', 400).error, /said: Invalid request/);
  const down = page('<html><h1>503 Service Unavailable</h1></html>', 503);
  assert.equal(down.code, 'down');
  assert.match(down.error, /having trouble \(error 503\)/);
  assert.match(page('<html>oops</html>', 200).error, /couldn’t read/);
  assert.match(page('', 200).error, /empty answer/);
});

test('SAM.gov: a 200 that isn’t a notice list is an error, not "no notices"', () => {
  for (const t of ['{}', '{"message":"Internal server error"}', '{"opportunitiesData":null,"totalRecords":2500}']){
    const p = call('opportunityPage', t, 200);
    assert.ok(p.error, t);
    assert.deepEqual(p.items, []);
  }
  assert.match(call('opportunityPage', '{"message":"Internal server error"}', 200).error, /Internal server error/);
  const empty = call('opportunityPage', '{"totalRecords":0,"opportunitiesData":[]}', 200);
  assert.equal(empty.error, undefined);
  assert.equal(empty.more, false);
});

test('SAM.gov: the real fixture reads, with nulls and junk rows skipped, and says when there are more', () => {
  const j = JSON.parse(fs.readFileSync('test/fixtures/sam-opportunities.json', 'utf8'));
  const n = j.opportunitiesData.length;
  j.opportunitiesData.push(null, 7, {title: 'no id'}, Object.assign({}, j.opportunitiesData[0], {noticeId: 'nulls', responseDeadLine: null, pointOfContact: null, award: null, naicsCode: null}));
  j.totalRecords = 1500; j.limit = 1000; j.offset = 0;
  const p = call('opportunityPage', JSON.stringify(j), 200);
  assert.equal(p.items.length, n + 1);
  assert.equal(p.total, 1500);
  assert.equal(p.more, true);
  const nulls = p.items.find(x => x.noticeId === 'nulls');
  assert.equal(nulls.responseDeadLine, undefined);
  assert.equal(nulls.award, undefined);
});

test('SAM.gov: a failed search keeps the notices it found last time', () => {
  const old = [{noticeId: 'a', naicsCode: '541512'}, {noticeId: 'b', naicsCode: '541330'}, {noticeId: 'c', naicsCode: '237130'}, {noticeId: 'd', naicsCode: '541330', demo: true}];
  const got = [{noticeId: 'e', naicsCode: '541512'}];
  const merged = call('mergeOpportunities', old, got, [{ncode: '541330'}]);
  assert.deepEqual(merged.map(x => x.noticeId), ['e', 'b']);
  assert.deepEqual(call('mergeOpportunities', old, got, []).map(x => x.noticeId), ['e'], 'nothing failed: only the fresh ones');
  assert.deepEqual(call('mergeOpportunities', null, null, null), []);
});

/* ---------- TripIt feed ---------- */
test('TripIt: only a whole calendar replaces the saved copy', () => {
  const ics = fs.readFileSync('test/fixtures/tripit.ics', 'utf8');
  assert.deepEqual(call('feedCheck', ics, 200, 'TripIt'), {ok: true});
  assert.deepEqual(call('feedCheck', ics + '\r\n\r\n', 200, 'TripIt'), {ok: true}, 'trailing blank lines are fine');
  const cut = call('feedCheck', ics.slice(0, Math.floor(ics.length * 0.6)), 200, 'TripIt');
  assert.equal(cut.code, 'partial');
  assert.match(cut.error, /kept the last full copy/);
  for (const s of [401, 403, 404, 410]) assert.equal(call('feedCheck', '<html>Not Found</html>', s, 'TripIt').code, 'gone', String(s));
  assert.match(call('feedCheck', '', 404, 'TripIt').error, /no longer works\. Copy the link again from TripIt/);
  assert.equal(call('feedCheck', '', 0, 'TripIt').code, 'down');
  assert.equal(call('feedCheck', '<html>Bad Gateway</html>', 502, 'TripIt').code, 'down');
  assert.equal(call('feedCheck', '<html>a login page</html>', 200, 'TripIt').code, 'notcal');
  assert.match(call('feedCheck', '', 0).error, /your travel feed/);
});

test('TripIt: CRLF and tab folding, escapes and two calendars in one feed read the same', () => {
  const ics = fs.readFileSync('test/fixtures/tripit.ics', 'utf8').replace(/\r?\n/g, '\n');
  const plain = call('feedTrips', ics, null);
  const crlf = call('feedTrips', '﻿' + ics.replace(/\n/g, '\r\n').replace(/^(SUMMARY:.{10})/m, '$1\r\n\t'), null);
  assert.deepEqual(crlf.map(t => [t.city, t.start, t.end]), plain.map(t => [t.city, t.start, t.end]));
  const two = call('feedTrips', ics + '\n' + ics, null);
  assert.ok(two.length >= plain.length);
  assert.deepEqual(call('feedTrips', '', null), []);
  assert.deepEqual(call('feedTrips', 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:half', null), []);
});
