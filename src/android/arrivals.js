// Arrival check on Android. The iPhone watches for significant location changes in the
// background; on Android that needs Google Play's background-location review, so Bearings
// checks only when you open the app: land somewhere 75+ miles from home, open Bearings, and
// it tells you who you know there. Location is used on this phone only.
import { M, isSample } from './model.js';
import { esc, icon, plural } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { open } from './actions.js';
import { prefs, ls, fx } from './platform.js';
import { loadGeo, miles } from '../geo.js';

const AWAY = 75, NEAR = 30, QUIET_DAYS = 4;

function here(){
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(p => resolve({lat: p.coords.latitude, lon: p.coords.longitude}), () => resolve(null),
      {enableHighAccuracy: false, maximumAge: 30 * 60 * 1000, timeout: 15000});
  });
}

/** Turned on in Settings; asks for location while the app is open (never in the background). */
export async function enableArrivals(){
  const p = await here();
  if (!p) return false;
  ls.set('bearings.home', JSON.stringify(p));
  return true;
}

let busy = false;
export async function checkArrival(){
  if (busy || !prefs.arrivals || isSample() || !M.loaded) return;
  busy = true;
  try {
    const p = await here(); if (!p) return;
    let home = ls.json('bearings.home', null);
    if (!home){ ls.set('bearings.home', JSON.stringify(p)); return; }
    if (miles(home, p) < AWAY){
      // back home (or close to it): keep home current if they've moved for good
      ls.del('bearings.arrivedAt');
      return;
    }
    const last = ls.json('bearings.arrivedAt', null);
    if (last && miles(last, p) < AWAY && Date.now() - last.t < QUIET_DAYS * 864e5) return;
    const near = Object.entries(M.places).filter(([k, pl]) => pl && pl.prec === 'city' && miles(p, pl) <= NEAR && M.byKey.has(k));
    ls.set('bearings.arrivedAt', JSON.stringify({lat: p.lat, lon: p.lon, t: Date.now()}));
    if (!near.length) return;
    await loadGeo().catch(() => {});
    const counts = new Map(); for (const [, pl] of near) counts.set(pl.name, (counts.get(pl.name) || 0) + 1);
    const where = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const ps = near.map(([k]) => M.byKey.get(k)).sort((a, b) => b.score - a.score).slice(0, 3);
    fx.success();
    openSheet({
      title: 'You’ve arrived', right: ['Close'],
      mount(body){
        body.innerHTML = `<div class="card pad"><p><b>${esc(`${plural(near.length, 'person', 'people')} you know ${near.length === 1 ? 'is' : 'are'} near ${where}.`)}</b></p>
          <p class="muted">${esc(ps.map(x => x.full).join(', '))}${near.length > ps.length ? ' and more' : ''}</p></div>
          <button type="button" class="btn prominent big block top8" data-a="map">${icon('mappin')}See them on the map</button>`;
      },
      handlers: { map(){ closeSheet(); open('mapAt', p.lat, p.lon, where); } },
    });
  } finally { busy = false; }
}
