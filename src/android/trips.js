// Trips: add where you're going and when, see who you know within 25 to 100 miles,
// and send an "I'll be in town" note. On the iPhone, trips also come from the calendar;
// Android has no calendar access, so you add them here. Ports TripsView and TripView
// (PlannerViews.swift) and the trip rules in CalendarService.swift.
import { M, person, show, saveTrips, isSample, locate } from './model.js';
import { esc, icon, avatar, segmented, empty, callout, menu, $, plural } from './ui.js';
import { registerRoute, push, popPage } from './nav.js';
import { openPerson, register, open } from './actions.js';
import { fx } from './platform.js';
import { loadGeo, lookup } from '../geo.js';
import { ymd, addDays, whenText, whenPhrase, newId, nearby, activeTrips, soonTrip } from './eventkit.js';
import L from 'leaflet';

const today = () => ymd(new Date());
export const tripById = id => M.trips.find(t => t.id === id);
export const nextTrip = () => soonTrip(M.trips, today());
export const tripsAhead = () => activeTrips(M.trips, today());
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
  mount(body){ this.update(body); },
  update(body, what){
    if (what === 'search') return;
    const list = tripsAhead(), t = today();
    const typed = $('input[name="city"]', body), keep = typed ? {city: typed.value, start: $('input[name="start"]', body).value, end: $('input[name="end"]', body).value} : {city: '', start: t, end: addDays(t, 2)};
    body.innerHTML = `${list.length ? `<div class="card list">${list.map(tripRow).join('')}</div>`
        : `<p class="foot first">Add a trip to see who you know near where you’re going, with a ready-made “I’ll be in town” note for each.</p>`}
      <p class="sec-h">Add a trip</p>
      <div class="card form">
        <input type="text" class="field" name="city" value="${esc(keep.city)}" placeholder="City, like Tampa, FL" autocomplete="off" data-enter="add">
        <label class="frow"><span>From</span><input type="date" class="date" name="start" value="${esc(keep.start)}"></label>
        <label class="frow"><span>To</span><input type="date" class="date" name="end" value="${esc(keep.end)}"></label>
        <button type="button" class="btn prominent block" data-a="add">${icon('plus')}Add trip</button>
      </div>
      <p class="foot">Trips stay on this phone. Bearings can’t read your calendar on Android, so add them here.</p>`;
  },
  handlers: {
    trip: id => push('trip', id),
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
      body.innerHTML = `<header class="ev-head"><h1>${esc(t.city)}</h1><p class="muted">${esc(whenText(t.start, t.end))}</p></header>
        <div class="card map-box trip-map"><div class="trip-leaflet"></div></div>
        <div class="trip-radius">${segmented('radius', [['25', '25 mi'], ['50', '50 mi'], ['100', '100 mi']], String(radius))}</div>
        <p class="sec-h">${esc(plural(near.length, 'person', 'people'))} within ${radius} miles</p>
        ${near.length ? `<div class="card list">${near.slice(0, 200).map(({p, place, d}) => `<div class="nrow">
            <button type="button" class="nrow-main" data-a="open" data-v="${esc(p.k)}">${avatar(p, 40)}<span class="nrow-text"><b>${esc(p.full)}</b><span>${esc([p.p, p.c].filter(Boolean).join(' · '))}</span><span class="near-line">${esc(place.name)}, ${d < 1 ? 'in town' : `${Math.round(d)} mi`}</span></span></button>
            <button type="button" class="pill-btn soft" data-a="write" data-v="${esc(p.k)}">Message</button></div>`).join('')}</div>
            <p class="foot">Tap Message for a ready-made “I’ll be in town” note.</p>`
          : noPlaces && !isSample() ? callout({ic: 'contactCheck', tint: 'var(--info)', title: 'Find out where people are', text: 'LinkedIn’s export doesn’t say where people live. Bearings can work it out on this phone from your Contacts. Nothing leaves your phone.', button: M.locating ? 'Working…' : 'Use my Contacts', act: 'locate'})
          : `<p class="foot">Nobody you know is placed near ${esc(t.city.split(',')[0])} yet. Try a wider distance, or set people’s locations from their profiles.</p>`}
        <button type="button" class="btn big tint-bad del-ev" data-a="remove">${icon('trash')}Remove this trip</button>`;
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
