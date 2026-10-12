// Tests for flight recognition, iCalendar parsing and trips from a TripIt feed (src/flights.js),
// plus the engine calls the apps use. Run with: npm test
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFlight, parseICS, tripsFromFeed, tripsFromEvents } from '../src/flights.js';
import { AIRPORTS, airport, airportByCity } from '../src/airports.js';

new Function(fs.readFileSync('apple/Bearings/Resources/engine.js', 'utf8'))();
const call = (name, ...args) => {
  const r = JSON.parse(globalThis.Bearings.call(name, JSON.stringify(args)));
  if (r.error) throw new Error(`${name}: ${r.error}`);
  return r.ok;
};
const pick = f => f && {flight: f.flight, from: f.from, to: f.to};

test('airport table: size, shape and city lookups', () => {
  const us = [...AIRPORTS.values()].filter(a => a.us), intl = [...AIRPORTS.values()].filter(a => !a.us);
  assert.ok(us.length >= 150, `US airports: ${us.length}`);
  assert.ok(intl.length >= 50, `international airports: ${intl.length}`);
  for (const a of AIRPORTS.values()){
    assert.match(a.code, /^[A-Z]{3}$/);
    assert.ok(Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180, a.code);
    assert.ok(a.tz, `${a.code} has a time zone`);
  }
  assert.equal(airport('san').name, 'San Diego, CA');
  assert.equal(airport('LHR').name, 'London, United Kingdom');
  assert.equal(airportByCity('San Diego, CA').code, 'SAN');
  assert.equal(airportByCity('Portland, ME').code, 'PWM');
  assert.equal(airportByCity('Portland').code, 'PDX');
  assert.equal(airportByCity('Washington, D.C.').code, 'DCA');
  assert.equal(airportByCity('St. Louis, Missouri').code, 'STL');
  assert.equal(airportByCity('London, UK').code, 'LHR');
  assert.equal(airportByCity('Springfield, IL'), null, 'a state that doesn’t match isn’t a guess');
  assert.equal(airportByCity('Nowhere'), null);
});

test('Flighty events', () => {
  assert.deepEqual(pick(parseFlight('✈ CLT → SAN • AA 1234')), {flight: 'AA 1234', from: 'CLT', to: 'SAN'});
  assert.deepEqual(pick(parseFlight('✈️ JFK→LHR • BA 178', 'John F. Kennedy International Airport')), {flight: 'BA 178', from: 'JFK', to: 'LHR'});
  assert.deepEqual(pick(parseFlight('Flight to San Diego (AA 1234)', 'Charlotte Douglas International Airport (CLT)')), {flight: 'AA 1234', from: 'CLT', to: 'SAN'});
  const f = parseFlight('✈ CLT → SAN • AA 1234');
  assert.equal(f.toCity, 'San Diego, CA');
  assert.equal(f.tz, 'America/Los_Angeles');
  assert.equal(f.airline, 'American');
  assert.ok(Math.abs(f.lat - 32.73) < 0.1 && Math.abs(f.lon + 117.19) < 0.1);
});

test('TripIt segments and airline emails', () => {
  assert.deepEqual(pick(parseFlight('AA1234 CLT to SAN', 'Charlotte (CLT)')), {flight: 'AA 1234', from: 'CLT', to: 'SAN'});
  assert.deepEqual(pick(parseFlight('UA 92 EWR-TLV')), {flight: 'UA 92', from: 'EWR', to: 'TLV'});
  assert.deepEqual(pick(parseFlight('Delta 2087 to Atlanta')), {flight: 'DL 2087', from: '', to: 'ATL'});
  assert.deepEqual(pick(parseFlight('Flight: Southwest 1823', '', 'Depart: BWI 7:05 AM\nArrive: Tampa (TPA) 9:40 AM')), {flight: 'WN 1823', from: 'BWI', to: 'TPA'});
  assert.deepEqual(pick(parseFlight('Your flight to Denver', '', 'United Airlines flight 1520\nDeparts Raleigh (RDU) 6:00 AM, arrives Denver (DEN) 8:05 AM')), {flight: 'UA 1520', from: 'RDU', to: 'DEN'});
  assert.deepEqual(pick(parseFlight('DL 2087')), {flight: 'DL 2087', from: '', to: ''}, 'a bare flight number is still a flight');
  assert.deepEqual(pick(parseFlight('CLT → SAN')), {flight: '', from: 'CLT', to: 'SAN'}, 'a route without a number');
});

test('not flights', () => {
  for (const t of ['Charlotte, NC to San Diego, CA', 'Meeting in Arlington, VA 2026', 'Trip to Alaska 2026', 'Lunch at 12 PM', 'Columbus Day', 'Ship CA 92101 office', 'Call at 9 AM 2 people', 'Q3 2026 review', 'USA vs CAN', 'Team offsite']){
    assert.equal(parseFlight(t, '', ''), null, t);
  }
});

const FEED = fs.readFileSync(new URL('./fixtures/tripit.ics', import.meta.url), 'utf8');

test('iCalendar: folding, escapes, all-day, UTC and TZID times, cancelled events', () => {
  const evs = parseICS(FEED);
  assert.equal(evs.length, 6, 'the cancelled event is left out');
  const trip = evs.find(e => e.uid === 'trip-1');
  assert.equal(trip.title, 'San Diego, CA, October 2026');
  assert.equal(trip.location, 'San Diego, CA');
  assert.ok(trip.allDay);
  assert.equal(trip.startDay, '2026-10-14');
  assert.equal(trip.endDay, '2026-10-17', 'DTEND of an all-day event is the day after');
  const seg = evs.find(e => e.uid === 'seg-1');
  assert.equal(new Date(seg.start).toISOString(), '2026-10-14T12:00:00.000Z');
  assert.match(seg.notes, /dep CLT 8:00am EDT arr SAN 2:10pm PDT; Confirmation ABC123/, 'folded line joined, \\; unescaped');
  const back = evs.find(e => e.uid === 'seg-2');
  assert.equal(new Date(back.start).toISOString(), '2026-10-17T23:00:00.000Z', 'TZID America/Los_Angeles');
  assert.equal(back.startDay, '2026-10-17');
  const win = parseICS('BEGIN:VEVENT\nDTSTART;TZID="Eastern Standard Time":20261020T090000\nDURATION:PT1H30M\nSUMMARY:Call\\, then lunch\nEND:VEVENT');
  assert.equal(new Date(win[0].start).toISOString(), '2026-10-20T13:00:00.000Z', 'Windows zone names');
  assert.equal(win[0].end - win[0].start, 90 * 60e3);
  assert.equal(win[0].title, 'Call, then lunch');
});

test('trips from a TripIt feed', () => {
  const home = {lat: 36.0726, lon: -79.792, name: 'Greensboro, NC'};
  const trips = tripsFromFeed(FEED, home);
  assert.deepEqual(trips.map(t => [t.city, t.start, t.end]), [['San Diego, CA', '2026-10-14', '2026-10-17'], ['Boston, MA', '2026-11-02', '2026-11-04']],
    'Charlotte (where the flights leave from, 80 miles away) and the Dallas connection are not trips');
  const sd = trips[0];
  assert.equal(sd.source, 'feed');
  assert.equal(sd.id, 'feed-san-diego-2026-10-14');
  assert.deepEqual(sd.flights.map(f => f.flight), ['AA 1234', 'AA 2345', 'AA 456']);
  assert.equal(sd.land.flight, 'AA 1234');
  assert.equal(sd.land.tz, 'America/Los_Angeles');
  assert.equal(new Date(sd.land.at).toISOString(), '2026-10-14T21:10:00.000Z');
  const bos = trips[1];
  assert.equal(bos.flights.length, 2, 'the flight home belongs to the trip');
  assert.equal(bos.end, '2026-11-04', 'stays until the flight out');
  // without a home city, home is where journeys start
  assert.deepEqual(tripsFromFeed(FEED, null).map(t => t.city), ['San Diego, CA', 'Boston, MA']);
  // a trip to your home city is skipped
  const fromSD = tripsFromFeed(FEED, {lat: 32.72, lon: -117.16}).map(t => t.city);
  assert.ok(!fromSD.includes('San Diego, CA') && fromSD.includes('Boston, MA'), fromSD.join('; '));
});

test('trips from flights alone, connections skipped, unknown cities left for the app', () => {
  const d = (s) => Date.parse(s);
  const ev = (uid, title, start, end, extra = {}) => ({uid, title, location: '', notes: '', start: d(start), end: d(end), startDay: start.slice(0, 10), endDay: end.slice(0, 10), allDay: false, ...extra});
  const events = [
    ev('a', 'UA 1 GSO to ORD', '2026-10-20T12:00:00Z', '2026-10-20T14:00:00Z'),
    ev('b', 'UA 2 ORD to DEN', '2026-10-20T15:30:00Z', '2026-10-20T18:00:00Z'),
    ev('c', 'Dinner', '2026-10-21T00:00:00Z', '2026-10-21T02:00:00Z'),
    ev('d', 'UA 3 DEN to GSO', '2026-10-23T15:00:00Z', '2026-10-23T20:00:00Z'),
    {uid: 'e', title: 'Offsite', location: 'Bozeman, MT', notes: '', start: d('2026-11-10T05:00:00Z'), end: d('2026-11-13T04:59:59Z'), startDay: '2026-11-10', endDay: '2026-11-12', allDay: true},
    {uid: 'f', title: 'Summit', location: 'Hilton Head, SC', notes: '', start: d('2026-12-01T05:00:00Z'), end: d('2026-12-03T04:59:59Z'), startDay: '2026-12-01', endDay: '2026-12-02', allDay: true},
  ];
  const trips = tripsFromEvents(events, null, {source: 'calendar'});
  assert.deepEqual(trips.map(t => [t.city, t.start, t.end, t.lat == null]), [['Denver, CO', '2026-10-20', '2026-10-23', false], ['Bozeman, MT', '2026-11-10', '2026-11-12', false], ['Hilton Head, SC', '2026-12-01', '2026-12-02', true]]);
  assert.deepEqual(trips[0].flights.map(f => f.flight), ['UA 1', 'UA 2', 'UA 3']);
  assert.equal(trips[0].id, 'calendar-denver-2026-10-20');
  // the iPhone asks for flights only (it places the other events itself)
  assert.deepEqual(tripsFromEvents(events, null, {flightsOnly: true}).map(t => t.city), ['Denver, CO']);
});

test('engine calls', () => {
  assert.equal(call('flightInfo', '✈ CLT → SAN • AA 1234', '', '').to, 'SAN');
  assert.equal(call('flightInfo', 'Coffee with Sam', 'Starbucks', ''), null);
  const many = call('flightInfos', [['AA1234 CLT to SAN', '', ''], ['Standup', '', ''], ['Flight to Boston (B6 1022)', 'JFK', '']]);
  assert.deepEqual(many.map(f => f && f.to), ['SAN', null, 'BOS']);
  const trips = call('feedTrips', FEED, {lat: 36.0726, lon: -79.792, name: 'Greensboro, NC'});
  assert.deepEqual(trips.map(t => t.city), ['San Diego, CA', 'Boston, MA']);
  assert.equal(call('eventTrips', [], null, {}).length, 0);
  assert.equal(call('icsEvents', FEED).length, 6);
  assert.deepEqual(call('feedTrips', 'not a calendar', null), []);
});
