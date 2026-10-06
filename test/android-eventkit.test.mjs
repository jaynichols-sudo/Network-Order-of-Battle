// Tests for the Android app's event, trip and birthday rules (src/android/eventkit.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttendees, followedUp, eventOn, eventUpcoming, eventRecent, whenText, whenPhrase, nearby, soonTrip, birthdaysFromContacts, nextBirthday, upcomingBirthdays } from '../src/android/eventkit.js';

test('attendee lists: names, emails, header rows and split first/last columns', () => {
  const r = parseAttendees('Name,Email\nJane Smith, jane@x.com\n"Sam","Rivera"\npat@agency.gov\nsolo\n\n');
  assert.deepEqual(r, [{email: 'jane@x.com', name: 'Jane Smith'}, {email: '', name: 'Sam Rivera'}, {email: 'pat@agency.gov', name: ''}]);
});

test('event timing', () => {
  const e = {start: '2026-10-03', end: '2026-10-05'};
  assert.ok(eventUpcoming(e, '2026-10-01'));
  assert.ok(eventOn(e, '2026-10-04'));
  assert.ok(eventOn(e, '2026-10-06'), 'still on the day after, like the iPhone');
  assert.ok(eventRecent(e, '2026-10-20'));
  assert.ok(!eventRecent(e, '2026-11-10'));
  assert.equal(whenText('2026-10-03', '2026-10-05'), 'Oct 3 to Oct 5');
  assert.equal(whenText('2026-10-03', '2026-10-03'), 'Oct 3');
});

test('followed up: ticked, messaged since the event, or a touch after the day you met', () => {
  const e = {start: '2026-10-03', end: '2026-10-05'};
  const m = {k: 'a', at: '2026-10-04T14:00:00Z', followed: false};
  assert.ok(followedUp({...m, followed: true}, e, null));
  assert.ok(!followedUp(m, e, {ed: {touched: '2026-10-04'}}), 'the touch logged when you add them doesn’t count');
  assert.ok(followedUp(m, e, {ed: {touched: '2026-10-08'}}));
  assert.ok(followedUp(m, e, {rx: {t: '2026-10-06', dir: 'o'}}));
  assert.ok(!followedUp(m, e, {rx: {t: '2026-10-06', dir: 'i'}}), 'their message to you doesn’t count');
});

test('trips: who is nearby, and the trip Today shows', () => {
  const trip = {lat: 38.8951, lon: -77.0364};
  const places = {a: {name: 'Arlington, VA', lat: 38.8816, lon: -77.091, prec: 'city'}, b: {name: 'Tampa, FL', lat: 27.9475, lon: -82.4584, prec: 'city'}, c: {name: 'DC area', lat: 38.9, lon: -77, prec: 'area'}};
  const ps = {a: {k: 'a', score: 10}, b: {k: 'b', score: 90}, c: {k: 'c', score: 50}};
  assert.deepEqual(nearby(trip, places, k => ps[k], 50).map(x => x.p.k), ['a']);
  const trips = [{id: 'old', start: '2026-09-01', end: '2026-09-03'}, {id: 'far', start: '2026-12-20', end: '2026-12-22'}, {id: 'soon', start: '2026-10-20', end: '2026-10-22'}];
  assert.equal(soonTrip(trips, '2026-10-06').id, 'soon');
  assert.equal(soonTrip(trips.slice(0, 2), '2026-10-06'), null);
  assert.equal(whenPhrase('2026-10-07', '2026-10-08', '2026-10-06'), 'tomorrow');
  assert.equal(whenPhrase('2026-10-14', '2026-10-15', '2026-10-06'), 'next week');
});

test('birthdays from contacts, matched by email then unique name', () => {
  const rows = [{k: 'a', f: 'Jane', l: 'Smith', e: 'jane@x.com', c: ''}, {k: 'b', f: 'Sam', l: 'Rivera', e: '', c: ''}, {k: 'c', f: 'Pat', l: 'Lee', e: '', c: ''}];
  const cards = [
    {name: {given: 'J', family: 'S'}, emails: [{address: 'Jane@X.com'}], birthday: {month: 10, day: 7}},
    {name: {given: 'Sam', family: 'Rivera'}, birthday: {month: 2, day: 29}},
    {name: {given: 'Pat', family: 'Lee'}},
  ];
  const b = birthdaysFromContacts(rows, cards);
  assert.deepEqual(b, {a: '10-07', b: '02-29'});
  assert.equal(nextBirthday('10-07', '2026-10-06'), '2026-10-07');
  assert.equal(nextBirthday('01-02', '2026-10-06'), '2027-01-02');
  const up = upcomingBirthdays(b, k => ({k, full: k}), '2026-10-06', 7);
  assert.deepEqual(up.map(x => x.p.k), ['a']);
});
