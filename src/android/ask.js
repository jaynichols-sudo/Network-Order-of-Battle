// Talk to Bearings: log a conversation in one breath, or ask a plain question.
// Ports QuickLogSheet and AskView in AskBearings.swift.
import { M, person, quickPreview, quickSave, logLine, ask, show } from './model.js';
import { esc, plural, icon, avatar, Day, $ } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { openPerson, open, register } from './actions.js';
import { personRow } from './people.js';
import { nextTrip } from './trips.js';
import { nearby } from './eventkit.js';
import { loadGeo, lookup } from '../geo.js';
import { fx } from './platform.js';

const plusDays = n => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* ---------- quick note ---------- */
export function openQuickNote(){
  let text = '', preview = null, t0 = 0, sheet = null;
  const canSave = () => !!(preview && preview.people.length);
  const sync = () => { const b = $('[data-sb="r"]', sheet.el); if (b) b.disabled = !canSave(); };
  const draw = body => {
    const out = $('.ql-preview', body);
    if (!preview){ out.innerHTML = ''; return; }
    if (!preview.people.length){ out.innerHTML = '<p class="small needs">No one you know named yet. Use their full name.</p>'; return; }
    out.innerHTML = preview.people.map(w => { const p = person(w.k); return p ? `<div class="ql-who">${avatar(p, 30, {star: false})}<b>${esc(p.full)}</b></div>` : ''; }).join('')
      + (preview.days > 0 ? `<p class="ql-due violet">${icon('bell')}Follow up ${esc(Day.nice(plusDays(preview.days)))}</p>` : '');
  };
  sheet = openSheet({
    title: 'Quick note', left: ['Cancel'], full: true,
    right: ['Save', async s => {
      if (!canSave()) return;
      const r = await quickSave(text);
      show(logLine(r));
      closeSheet(s);
    }],
    mount(body, s){
      sheet = s;
      body.innerHTML = `<div class="ql"><h2 class="serif ql-h">What happened?</h2>
        <div class="card ql-box"><textarea class="field" rows="5" data-in="text" placeholder="Just met Dan Sitkins at the expo. He wants pricing for two sites by Friday." aria-label="What happened?"></textarea></div>
        <p class="ql-mic muted small">${icon('mic')}Tap the microphone on the keyboard to say it instead.</p>
        <div class="ql-preview" aria-live="polite"></div></div>`;
      sync();
      setTimeout(() => { const i = $('textarea', body); if (i) i.focus(); }, 300);
    },
    handlers: {
      text(v, t){
        text = v; clearTimeout(t0);
        const body = t.closest('.sheet-body');
        t0 = setTimeout(() => { preview = text.length > 4 ? quickPreview(text) : null; draw(body); sync(); }, 350);
      },
    },
  });
  return sheet;
}

/* ---------- ask ---------- */
function suggestions(){
  const s = ['Who’s waiting on me?', 'Who changed jobs lately?', 'Who’s likely to move soon?'];
  const t = M.targets[0];
  if (t){ s.splice(1, 0, `Who do I know at ${t.name}?`); s.push(`Who can get me into ${t.name}?`); }
  const trip = nextTrip();
  if (trip && trip.city) s.unshift(`Who should I see in ${trip.city.split(',')[0]}?`);
  return s;
}
/** Places live on the phone, so "who's near X" is answered here: within 40 miles, or by name. */
async function answerCity(r){
  const place = String(r.place || '').replace(/\b[a-z]/g, c => c.toUpperCase());
  try {
    await loadGeo();
    const hit = lookup(place);
    if (hit){
      const near = nearby({lat: hit.lat, lon: hit.lon}, M.places, person, 40);
      r.people = near.slice(0, 15).map(n => ({k: n.p.k, why: n.d < 2 ? `In ${n.place.name}` : `${Math.round(n.d)} mi away, in ${n.place.name}`}));
      r.answer = near.length ? `${plural(near.length, 'person', 'people')} within 40 miles of ${hit.name}.` : `No one placed near ${hit.name} yet.`;
      return r;
    }
  } catch {}
  // no map hit: anyone whose saved place names it
  const want = place.toLowerCase();
  const named = want.length >= 3 ? Object.entries(M.places).filter(([k, pl]) => (pl.name || '').toLowerCase().includes(want) && person(k)).map(([k, pl]) => ({k, why: pl.name})) : [];
  if (named.length){ r.people = named.slice(0, 15); r.answer = `${plural(named.length, 'person', 'people')} placed in ${place}.`; }
  else { r.people = []; r.answer = `Open the map to see who’s near ${place}.`; r.map = true; }
  return r;
}
export function openAsk(initial = ''){
  let q = initial, result = null, busy = 0;
  const draw = body => {
    const out = $('.ask-out', body);
    if (!result){
      out.innerHTML = `<p class="sec-h">Try</p><div class="card list">${suggestions().map(s => `<button type="button" class="row act" data-a="try" data-v="${esc(s)}">${icon('askSearch')}<span>${esc(s)}</span></button>`).join('')}</div>`;
      return;
    }
    const ps = result.people.map(h => { const p = person(h.k); return p ? personRow(p, {sub: h.why}) : ''; }).join('');
    out.innerHTML = `${result.answer ? `<h2 class="serif ask-answer">${esc(result.answer)}</h2>` : ''}
      ${ps ? `<div class="card list">${ps}</div>` : ''}
      ${result.map ? `<button type="button" class="btn prominent top12" data-a="map">${icon('mappin')}Open the map</button>` : ''}`;
  };
  const run = async body => {
    const t = q.trim(); if (!t) return;
    const n = ++busy;
    let r = ask(t);
    if (r.kind === 'city') r = await answerCity(r);
    if (n !== busy) return;
    result = r; fx.tap(); draw(body);
  };
  openSheet({
    title: 'Ask Bearings', right: ['Done'], full: true,
    mount(body){
      body.innerHTML = `<label class="searchbox">${icon('askSearch')}<input type="search" data-in="q" data-enter="go" value="${esc(q)}" placeholder="Ask about your network" autocomplete="off" enterkeyhint="search" aria-label="Ask about your network"></label><div class="ask-out"></div>`;
      draw(body);
      if (q) run(body); else setTimeout(() => { const i = $('input', body); if (i) i.focus(); }, 300);
    },
    handlers: {
      q(v, t){ q = v; if (!v.trim() && result){ result = null; draw(t.closest('.sheet-body')); } },
      go(v, t){ q = v; const i = t.closest('.sheet-body').querySelector('input'); if (i) i.blur(); run(t.closest('.sheet-body')); },
      try(v, t){ q = v; const body = t.closest('.sheet-body'); $('input', body).value = v; run(body); },
      open(k){ closeSheet(); openPerson(k); },
      map(){ closeSheet(); open('map'); },
    },
  });
}
register('quickNote', openQuickNote);
register('ask', openAsk);
