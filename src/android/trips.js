// Trips: add where you're going and when, see who you know within 25 to 100 miles,
// and send an "I'll be in town" note. On the iPhone, trips also come from the calendar;
// Android has no calendar access, so you add them here. Ports TripsView and TripView
// (PlannerViews.swift) and the trip rules in CalendarService.swift.
import { CapacitorHttp } from '@capacitor/core';
import { M, person, show, saveTrips, isSample, locate, emit } from './model.js';
import { esc, icon, avatar, segmented, empty, callout, menu, $, plural } from './ui.js';
import { registerRoute, push, popPage } from './nav.js';
import { openPerson, register, open } from './actions.js';
import { fx, ls, NATIVE } from './platform.js';
import { loadGeo, lookup } from '../geo.js';
import { ymd, addDays, whenText, whenPhrase, newId, nearby, activeTrips, soonTrip, miles } from './eventkit.js';
import L from 'leaflet';

const today = () => ymd(new Date());

/* ---------- TripIt (or any iCalendar) feed ---------- */
// The feed link is kept on this phone like other settings. The phone fetches it straight from
// TripIt at most every six hours; the shared engine (src/flights.js) turns it into trips placed
// where each flight lands. No Northfix server sees the link or the trips.
const FEED_URL = 'bearings.tripFeed', FEED_CACHE = 'bearings.tripFeedTrips', FEED_EVERY = 6 * 3600e3, RETRY = 30 * 60e3;
let feed = ls.json(FEED_CACHE, null) || {at: 0, tried: 0, trips: [], error: ''};
let feeding = null;
export const feedURL = () => ls.get(FEED_URL) || '';
const feedName = () => /tripit/i.test(feedURL()) ? 'TripIt' : 'your travel feed';
/** webcal:// → https://; anything that isn't https is refused. */
export function feedLink(raw){
  let s = String(raw || '').trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
  try { const u = new URL(s); return u.protocol === 'https:' && u.hostname ? u.href : ''; } catch { return ''; }
}
/** {status, text}: status 0 when the request never got an answer. */
async function getFeed(url){
  // the native HTTP client first: a WebView fetch to another site is usually blocked by CORS
  if (NATIVE){
    try {
      const r = await CapacitorHttp.get({url, responseType: 'text', connectTimeout: 15000, readTimeout: 20000, headers: {Accept: 'text/calendar, */*'}});
      if (r) return {status: r.status || 0, text: r.status >= 200 && r.status < 300 ? String(r.data || '') : ''};
    } catch {}
  }
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), 20000) : 0;
  try { const r = await fetch(url, {cache: 'no-store', signal: ac ? ac.signal : undefined}); return {status: r.status, text: r.ok ? await r.text() : ''}; }
  catch { return {status: 0, text: ''}; }
  finally { clearTimeout(timer); }
}
const checkFeed = got => { try { return M.api.feedCheck(got.text, got.status, feedName()); } catch { return {ok: /BEGIN:VCALENDAR/.test(got.text), error: 'Couldn’t read that feed.'}; } };
/** Where home is, for leaving out trips in your own city: the place saved for arrival alerts. */
function homeOf(){
  const h = ls.json('bearings.home', null);
  return h && isFinite(h.lat) && isFinite(h.lon) ? {lat: +h.lat, lon: +h.lon, name: h.name || ''} : null;
}
/** Feed text → trips, with any city the engine couldn't place looked up offline. Throws when the engine can't read it. */
async function tripsFrom(text){
  const list = M.api.feedTrips(text, homeOf()) || [];
  const t = today(), out = [];
  for (const x of list){
    if (x.end < t) continue;
    if (x.lat == null || x.lon == null){
      await loadGeo();
      const hit = lookup(x.city);
      if (!hit) continue;
      Object.assign(x, {city: hit.name, lat: hit.lat, lon: hit.lon});
    }
    out.push(x);
  }
  return out;
}
function keepFeed(){ ls.set(FEED_CACHE, JSON.stringify(feed)); }
/** Fetches the feed when it's more than six hours old (or when forced). Never throws. */
export function refreshFeed(force = false){
  const url = feedLink(feedURL());
  if (!url) return Promise.resolve(false);
  if (!force && (Date.now() - feed.at < FEED_EVERY || Date.now() - (feed.tried || 0) < RETRY)) return Promise.resolve(false);
  if (feeding) return feeding;
  feeding = (async () => {
    feed.tried = Date.now();
    const got = await getFeed(url), ok = checkFeed(got);
    // anything short of a whole calendar keeps the last good trips
    if (!ok.ok){ feed.error = ok.error; keepFeed(); emit('trips'); return false; }
    let trips;
    try { trips = await tripsFrom(got.text); } catch (e) { console.warn(e); feed.error = `Couldn’t read ${feedName()} at the last check. Northfix will try again later.`; keepFeed(); return false; }
    feed = {at: Date.now(), tried: Date.now(), trips, error: ''};
    keepFeed();
    emit('trips');
    return true;
  })().catch(() => false).finally(() => { feeding = null; });
  return feeding;
}
/** Saves the link after checking it returns a calendar. Returns an error to show, or ''. */
async function setFeed(raw){
  const url = feedLink(raw);
  if (!url) return 'That doesn’t look like a feed link. It should start with https:// or webcal://.';
  const got = await getFeed(url);
  if (!got.status || !got.text && got.status < 400) return 'Couldn’t read that link. Check that you copied the whole thing and that you’re online.';
  const ok = checkFeed(got);
  if (!ok.ok) return ok.code === 'gone' ? 'That link doesn’t work anymore. Copy the feed link from TripIt again.' : ok.error;
  let trips;
  try { trips = await tripsFrom(got.text); } catch { return 'Couldn’t read the trips in that feed.'; }
  ls.set(FEED_URL, url);
  feed = {at: Date.now(), tried: Date.now(), trips, error: ''};
  keepFeed();
  emit('trips');
  return '';
}
function removeFeed(){ ls.del(FEED_URL); feed = {at: 0, tried: 0, trips: [], error: ''}; ls.del(FEED_CACHE); emit('trips'); }
/** Your trips plus the feed's, leaving out feed trips you already added yourself (same city, overlapping dates). */
function allTrips(){
  const mine = M.trips || [];
  const extra = feedURL() ? (feed.trips || []).filter(f => !mine.some(m => miles(m, f) < 60 && m.start <= addDays(f.end, 1) && f.start <= addDays(m.end, 1))) : [];
  return [...mine, ...extra];
}
// check the feed a little after launch, once the network is loaded
setTimeout(() => { refreshFeed(); }, 6000);

/** "2:10 PM" where you land. */
function landClock(ms, tz){
  try { return new Date(ms).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', ...(tz ? {timeZone: tz} : {})}); }
  catch { return new Date(ms).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}); }
}
/** "Flight AA 1234, CLT to SAN, lands 2:10 PM" */
export function flightLine(f){
  const parts = [f.flight ? `Flight ${f.flight}` : 'Flight'];
  if (f.from && f.to) parts.push(`${f.from} to ${f.to}`); else if (f.to) parts.push(`to ${f.to}`);
  if (f.arr) parts.push(`lands ${landClock(f.arr, f.tz)}`);
  return parts.join(', ');
}

export const tripById = id => allTrips().find(t => t.id === id);
export const nextTrip = () => soonTrip(allTrips(), today());
export const tripsAhead = () => activeTrips(allTrips(), today());
export const nearCount = (t, r = 50) => nearby(t, M.places, person, r).length;

export function tripChip(t){
  return `<button type="button" class="tchip" data-a="trip" data-v="${esc(t.id)}">${icon('plane')}${esc(t.city.split(',')[0])} trip</button>`;
}
export function tripRow(t){
  const n = nearCount(t), now = t.start <= today();
  return `<button type="button" class="row wrow" style="--tone:var(--info)" data-a="trip" data-v="${esc(t.id)}">
    <span class="hc-ic">${icon('plane')}</span><span class="wrow-main"><b>${esc(t.city)}, ${esc(whenText(t.start, t.end))}</b>
    <span class="${n ? 'good-text' : ''}">${n ? `${plural(n, 'person', 'people')} you know nearby` : 'Nobody you know is placed nearby yet'}${now ? '. Under way' : ''}</span></span>${icon('chevR', 'chev')}</button>`;
}

/* ---------- all trips (from You) ---------- */
const TripsView = {
  title: 'Trips',
  mount(body){ this.update(body); refreshFeed(); },
  update(body, what){
    if (what === 'search') return;
    const list = tripsAhead(), t = today();
    const typed = $('input[name="city"]', body), keep = typed ? {city: typed.value, start: $('input[name="start"]', body).value, end: $('input[name="end"]', body).value} : {city: '', start: t, end: addDays(t, 2)};
    const feedTyped = $('input[name="feed"]', body), feedKeep = feedTyped ? feedTyped.value : feedURL();
    const fromFeed = list.filter(x => x.source === 'feed').length;
    body.innerHTML = `${list.length ? `<div class="card list">${list.map(tripRow).join('')}</div>`
        : `<p class="foot first">Add a trip to see who you know near where you’re going, with a ready-made “I’ll be in town” note for each.</p>`}
      <p class="sec-h">Add a trip</p>
      <div class="card form">
        <input type="text" class="field" name="city" value="${esc(keep.city)}" placeholder="City, like Tampa, FL" autocomplete="off" data-enter="add">
        <label class="frow"><span>From</span><input type="date" class="date" name="start" value="${esc(keep.start)}"></label>
        <label class="frow"><span>To</span><input type="date" class="date" name="end" value="${esc(keep.end)}"></label>
        <button type="button" class="btn prominent block" data-a="add">${icon('plus')}Add trip</button>
      </div>
      <p class="foot">Trips stay on this phone. Northfix can’t read your calendar on Android, so add them here.</p>
      <p class="sec-h">${feedURL() ? 'TripIt feed' : 'Add a TripIt feed'}</p>
      <div class="card form">
        <input type="url" class="field" name="feed" value="${esc(feedKeep)}" placeholder="https:// or webcal:// link" autocomplete="off" autocapitalize="off" spellcheck="false" data-enter="feedSave">
        <button type="button" class="btn prominent block" data-a="feedSave">${icon('plus')}${feedURL() ? 'Save link' : 'Add feed'}</button>
        ${feedURL() ? `<p class="small muted">${esc(plural(fromFeed, 'trip', 'trips'))} coming up from ${esc(feedName())}${feed.at ? `. Checked ${esc(new Date(feed.at).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}))}` : ''}.${feed.error ? ` ${esc(feed.error)}` : ''}</p>
          <button type="button" class="btn block" data-a="feedCheck">${icon('refresh')}Check now</button>
          <button type="button" class="btn block tint-bad" data-a="feedRemove">${icon('trash')}Remove feed</button>` : ''}
      </div>
      <p class="foot">In TripIt, open Settings, then Calendar Feeds, and copy the feed link. This phone reads it straight from TripIt every few hours and places each trip where your flight lands. No Northfix server sees the link or your trips.</p>`;
  },
  handlers: {
    trip: id => push('trip', id),
    async feedSave(_, t){
      const body = t.closest('.page-body');
      const raw = ($('input[name="feed"]', body).value || '').trim();
      if (!raw){ show('Paste your feed link first'); return; }
      show('Checking the link…');
      const err = await setFeed(raw);
      if (err){ show(err); return; }
      fx.success();
      const n = tripsAhead().filter(x => x.source === 'feed').length;
      show(n ? `Feed added. ${plural(n, 'trip', 'trips')} coming up.` : 'Feed added. No trips coming up yet.');
    },
    async feedCheck(){ fx.tap(); show('Checking…'); const ok = await refreshFeed(true); if (!ok) show(feed.error || 'Nothing new'); },
    feedRemove(_, el){ menu(el, [{label: 'Remove the TripIt feed', icon: 'trash', danger: true, run: () => { removeFeed(); show('Feed removed'); }}]); },
    async add(_, t){
      const body = t.closest('.page-body');
      const city = ($('input[name="city"]', body).value || '').trim();
      if (!city){ show('Type a city first'); return; }
      let start = $('input[name="start"]', body).value || today(), end = $('input[name="end"]', body).value || start;
      if (end < start) end = start;
      await loadGeo();
      const hit = lookup(city);
      if (!hit){ show(`Couldn’t find “${city}”. Try a city and state, like Tampa, FL.`); return; }
      const trip = {id: 'you-' + newId(), city: hit.name, lat: hit.lat, lon: hit.lon, start, end, source: 'you'};
      M.trips.push(trip);
      $('input[name="city"]', body).value = '';
      fx.success();
      saveTrips();
      const n = nearCount(trip);
      show(n ? `Added. You know ${plural(n, 'person', 'people')} near ${hit.name.split(',')[0]}.` : `Added your trip to ${hit.name.split(',')[0]}`);
    },
  },
};

/* ---------- one trip ---------- */
function tripView(id){
  let radius = 50, map = null;
  const v = {
    title: 'Trip',
    mount(body){ this.update(body); },
    update(body, what){
      if (what === 'search') return;
      const t = tripById(id);
      if (!t){ body.innerHTML = empty('plane', 'Trip not found', 'It may have been removed.'); return; }
      const near = nearby(t, M.places, person, radius);
      const st = body.scrollTop;
      const noPlaces = !Object.keys(M.places).length;
      const flights = (t.flights || []).slice(0, 6);
      body.innerHTML = `<header class="ev-head"><h1>${esc(t.city)}</h1><p class="muted">${esc(whenText(t.start, t.end))}</p>
          ${t.source === 'feed' ? `<p class="small info">From ${esc(feedName())}</p>` : ''}
          ${flights.map(f => `<p class="small muted">${icon('plane')}${esc(flightLine(f))}</p>`).join('')}</header>
        <div class="card map-box trip-map"><div class="trip-leaflet"></div></div>
        <div class="trip-radius">${segmented('radius', [['25', '25 mi'], ['50', '50 mi'], ['100', '100 mi']], String(radius))}</div>
        <p class="sec-h">${esc(plural(near.length, 'person', 'people'))} within ${radius} miles</p>
        ${near.length ? `<div class="card list">${near.slice(0, 200).map(({p, place, d}) => `<div class="nrow">
            <button type="button" class="nrow-main" data-a="open" data-v="${esc(p.k)}">${avatar(p, 40)}<span class="nrow-text"><b>${esc(p.full)}</b><span>${esc([p.p, p.c].filter(Boolean).join(' · '))}</span><span class="near-line">${esc(place.name)}, ${d < 1 ? 'in town' : `${Math.round(d)} mi`}</span></span></button>
            <button type="button" class="pill-btn soft" data-a="write" data-v="${esc(p.k)}">Message</button></div>`).join('')}</div>
            <p class="foot">Tap Message for a ready-made “I’ll be in town” note.</p>`
          : noPlaces && !isSample() ? callout({ic: 'contactCheck', tint: 'var(--info)', title: 'Find out where people are', text: 'LinkedIn’s export doesn’t say where people live. Northfix can work it out on this phone from your Contacts. Nothing leaves your phone.', button: M.locating ? 'Working…' : 'Use my Contacts', act: 'locate'})
          : `<p class="foot">Nobody you know is placed near ${esc(t.city.split(',')[0])} yet. Try a wider distance, or set people’s locations from their profiles.</p>`}
        ${t.source === 'feed' ? `<p class="foot">This trip comes from ${esc(feedName())}. Change it there.</p>` : `<button type="button" class="btn big tint-bad del-ev" data-a="remove">${icon('trash')}Remove this trip</button>`}`;
      body.scrollTop = st;
      drawMap(body, t, near);
    },
    destroy(){ if (map){ map.remove(); map = null; } },
    handlers: {
      open: k => openPerson(k),
      write(k){ const t = tripById(id); if (t) open('message', k, {trip: {city: t.city.split(',')[0], when: whenPhrase(t.start, t.end, today())}}); },
      radius(val, el){ radius = +val; fx.select(); v.update(el.closest('.page-body')); },
      locate: () => locate(),
      remove(_, el){
        const t = tripById(id); if (!t) return;
        menu(el, [{label: `Remove ${t.city.split(',')[0]} trip`, icon: 'trash', danger: true, run: () => { M.trips = M.trips.filter(x => x.id !== id); popPage(); saveTrips(); show('Trip removed'); }}]);
      },
    },
  };
  function drawMap(body, t, near){
    const box = $('.trip-leaflet', body); if (!box) return;
    if (map){ map.remove(); map = null; }
    try {
      map = L.map(box, {zoomControl: false, attributionControl: true, dragging: true, scrollWheelZoom: false}).setView([t.lat, t.lon], radius > 50 ? 7 : radius > 25 ? 8 : 9);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '© OpenStreetMap contributors'}).addTo(map);
      const ring = L.circle([t.lat, t.lon], {radius: radius * 1609.344, color: '#FFB020', weight: 1.5, fillColor: '#FFB020', fillOpacity: 0.12}).addTo(map);
      try { map.fitBounds(ring.getBounds(), {padding: [12, 12]}); } catch {}
      const groups = new Map();
      for (const x of near){ const g = groups.get(x.place.name) || {pl: x.place, n: 0}; g.n++; groups.set(x.place.name, g); }
      for (const [name, g] of groups){
        const size = g.n >= 10 ? 34 : 26;
        L.marker([g.pl.lat, g.pl.lon], {title: `${name}, ${g.n}`, icon: L.divIcon({className: 'geo-pin', html: `<span style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${g.n}</span>`, iconSize: [size, size]})}).addTo(map);
      }
      setTimeout(() => map && map.invalidateSize(), 80);
    } catch (e) { console.warn(e); }
  }
  return v;
}

registerRoute('trips', () => TripsView);
registerRoute('trip', id => tripView(id));
register('trips', () => push('trips'));
register('trip', id => push('trip', id));
