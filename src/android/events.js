// Event mode: before a conference, see who you know that's going; during it, add the
// people you meet with a note each; afterward, a follow-up list until everyone's been
// contacted. Ports Events.swift. Card scanning (camera OCR) is iPhone only; on Android
// you add people by hand, which takes a few seconds with the keyboard's microphone.
import { M, person, persons, show, metAt, saveEvents } from './model.js';
import { esc, fmt, icon, avatar, menu, empty, $, plural } from './ui.js';
import { openSheet, closeSheet, registerRoute, push, popPage } from './nav.js';
import { openPerson, register, open } from './actions.js';
import { personRow } from './people.js';
import { allow } from './pro.js';
import { fx, openURL, scheduleEventNudge, cancelEventNudge } from './platform.js';
import { ymd, addDays, whenText, newId, eventOn, eventUpcoming, eventRecent, followedUp, toFollowUp, parseAttendees, linkedInSearch } from './eventkit.js';

const today = () => ymd(new Date());
export const eventById = id => M.events.find(e => e.id === id);
export const todoFor = e => toFollowUp(e, person);
const isDone = (m, e) => followedUp(m, e, m.k ? person(m.k) : null);

/** Events worth a chip on Today: on now, coming up, or recently over with follow-ups left. */
export function liveEvents(){
  const t = today();
  return M.events.filter(e => eventOn(e, t) || eventUpcoming(e, t) || (eventRecent(e, t) && todoFor(e).length)).sort((a, b) => a.start < b.start ? -1 : 1);
}
export function eventChip(e){
  const t = today(), todo = todoFor(e).length;
  const label = eventUpcoming(e, t) || eventOn(e, t) || !todo ? esc(e.name) : `${esc(e.name)} <span class="mono">· ${fmt(todo)}</span>`;
  return `<button type="button" class="tchip" data-a="event" data-v="${esc(e.id)}">${icon('ticket')}${label}</button>`;
}

function line(e){
  const t = today(), todo = todoFor(e).length, n = (e.met || []).length;
  if (eventUpcoming(e, t)) return `${whenText(e.start, e.end)}. ${e.attending.length ? `You know ${fmt(e.attending.length)} going` : 'Load the attendee list to see who you know'}`;
  if (eventOn(e, t)) return `Happening now. ${fmt(n)} met so far`;
  return todo === 0 ? (n ? `All ${fmt(n)} followed up` : `${whenText(e.start, e.end)}. No one added`) : `${fmt(todo)} of ${fmt(n)} still to follow up`;
}
export function eventRow(e){
  const t = today(), on = eventOn(e, t), ic = on ? 'waves' : eventUpcoming(e, t) ? 'calendar' : 'checklist';
  return `<button type="button" class="row wrow evrow" style="--tone:${on ? 'var(--good)' : 'var(--violet)'}" data-a="event" data-v="${esc(e.id)}">
    <span class="hc-ic">${icon(ic)}</span><span class="wrow-main"><b>${esc(e.name)}</b><span>${esc(line(e))}</span></span>${icon('chevR', 'chev')}</button>`;
}

/* ---------- all events (from You) ---------- */
const EventsView = {
  title: 'Events',
  mount(body, el){
    const r = $('.bar-right', el); if (r) r.innerHTML = `<button type="button" class="bar-act" data-a="newEvent" aria-label="New event">${icon('plus')}</button>`;
    this.update(body);
  },
  update(body){
    const list = M.events.slice().sort((a, b) => a.start > b.start ? -1 : 1);
    body.innerHTML = list.length
      ? `<div class="card list evlist">${list.map(eventRow).join('')}</div><button type="button" class="btn big new-ev" data-a="newEvent">${icon('plus')}New event</button>`
      : empty('ticket', 'No events yet', 'Going to a conference? Set it up to see who you know there, jot down who you meet, and keep track of follow-ups.', `<button type="button" class="btn prominent" data-a="newEvent">${icon('plus')}New event</button>`);
  },
  handlers: {
    newEvent: () => openNewEvent(),
    event: id => push('event', id),
  },
};

/* ---------- create ---------- */
export function openNewEvent(){
  if (!allow('events')) return;
  const t = today();
  openSheet({
    title: 'New event', left: ['Cancel'], right: ['Create', s => create(s)],
    mount(body){
      body.innerHTML = `<div class="card form">
          <input type="text" class="field" name="name" placeholder="Name, like AFCEA TechNet Augusta" autocomplete="off" data-enter="go">
          <input type="text" class="field" name="place" placeholder="Where (optional)" autocomplete="off" data-enter="go">
          <label class="frow"><span>Starts</span><input type="date" class="date" name="start" value="${t}"></label>
          <label class="frow"><span>Ends</span><input type="date" class="date" name="end" value="${addDays(t, 2)}"></label>
        </div>
        <p class="foot">Next, load the attendee list if you have one, or just add people as you meet them.</p>`;
      setTimeout(() => { const i = $('input[name="name"]', body); if (i) i.focus(); }, 300);
    },
    handlers: { go(_, el){ create(null, el); } },
  });
  async function create(sheet, el){
    const root = (sheet && sheet.el) || el.closest('.sheet');
    const v = n => ($(`[name="${n}"]`, root).value || '').trim();
    const name = v('name'); if (!name){ show('Give the event a name'); return; }
    let start = v('start') || t, end = v('end') || start; if (end < start) end = start;
    const e = {id: newId(), name, place: v('place'), start, end, attending: [], met: []};
    M.events.push(e);
    fx.success();
    closeSheet();
    await saveEvents();
    scheduleEventNudge(e);
    push('event', e.id);
  }
}

/* ---------- one event ---------- */
function eventView(id){
  let fileInput = null;
  const v = {
    get title(){ const e = eventById(id); return e ? e.name : 'Event'; },
    mount(body){ this.update(body); },
    update(body){
      const e = eventById(id);
      if (!e){ body.innerHTML = empty('ticket', 'Event not found', 'It may have been deleted.'); return; }
      const st = body.scrollTop;
      const met = (e.met || []).slice().sort((a, b) => (a.at || '') < (b.at || '') ? 1 : -1);
      const going = persons(e.attending || []).sort((a, b) => b.score - a.score);
      const todo = todoFor(e).length;
      body.innerHTML = `<header class="ev-head"><h1>${esc(e.name)}</h1><p class="muted">${esc([whenText(e.start, e.end), e.place].filter(Boolean).join(' · '))}</p></header>
        <section class="card stats3 ev-stats">
          <div class="stat"><b class="mono">${fmt(going.length)}</b><span class="muted small">you know going</span></div>
          <div class="stat"><b class="mono">${fmt(met.length)}</b><span class="muted small">met</span></div>
          <div class="stat"><b class="mono ${todo ? 'amber' : ''}">${fmt(todo)}</b><span class="muted small">to follow up</span></div>
        </section>
        <div class="card list actions ev-actions">
          <button type="button" class="row act" data-a="addKnown">${icon('contactCheck')}<span>Met someone you’re connected to</span></button>
          <button type="button" class="row act" data-a="addNew">${icon('personPlus')}<span>Add someone new</span></button>
          <button type="button" class="row act" data-a="loadList">${icon('checklist')}<span>Load the attendee list</span>${icon('chevR', 'chev')}</button>
        </div>
        <p class="foot">Notes you add here also go on each person’s timeline. Tap the microphone on your keyboard to dictate.</p>
        ${met.length ? `<p class="sec-h">Met (${fmt(met.length)})</p><div class="card list">${met.map(m => metRow(m, e)).join('')}</div>` : ''}
        ${going.length ? `<p class="sec-h">You know ${fmt(going.length)} going</p><div class="card list">${going.map(p => `<div class="nrow">
            <button type="button" class="nrow-main" data-a="open" data-v="${esc(p.k)}">${avatar(p, 40)}<span class="nrow-text"><b>${esc(p.full)}</b><span>${esc([p.p, p.c].filter(Boolean).join(' · '))}</span></span></button>
            <button type="button" class="pill-btn soft" data-a="metKnown" data-v="${esc(p.k)}">${icon('check')}Met</button></div>`).join('')}</div>` : ''}
        <button type="button" class="btn big tint-bad del-ev" data-a="del">${icon('trash')}Delete event</button>`;
      body.scrollTop = st;
    },
    handlers: {
      open: k => openPerson(k),
      addKnown: () => openPicker(k => openMetForm(id, fromPerson(k))),
      metKnown: k => openMetForm(id, fromPerson(k)),
      addNew: () => openMetForm(id, {name: ''}),
      loadList(_, t){
        menu(t, [{label: 'Paste names or emails', icon: 'copy', run: () => openPaste(id)}, {label: 'Choose a file (CSV or text)', icon: 'note', run: () => pickFile()}]);
      },
      tick(mid){
        const e = eventById(id), m = e && e.met.find(x => x.id === mid); if (!m) return;
        const done = isDone(m, e);
        if (done && !m.followed){ show('Already followed up: you’ve been in touch since the event'); return; }
        m.followed = !m.followed; m.followed ? fx.success() : fx.tap();
        saveEvents();
      },
      write(k){ const e = eventById(id); open('message', k, e ? {event: e.name} : {}); },
      linkedin(mid){ const e = eventById(id), m = e && e.met.find(x => x.id === mid); if (m) openURL(linkedInSearch(m)); },
      metMore(mid, t){
        const e = eventById(id), m = e && e.met.find(x => x.id === mid); if (!m) return;
        menu(t, [{label: 'Edit', icon: 'pencil', run: () => openMetForm(id, Object.assign({}, m), true)}, {label: 'Remove from this event', icon: 'trash', danger: true, run: () => { e.met = e.met.filter(x => x.id !== mid); fx.tap(); saveEvents(); }}]);
      },
      del(_, t){
        const e = eventById(id); if (!e) return;
        menu(t, [{header: 'Notes stay on each person’s timeline'}, {label: `Delete ${e.name}`, icon: 'trash', danger: true, run: async () => {
          M.events = M.events.filter(x => x.id !== id);
          cancelEventNudge(id);
          popPage();
          await saveEvents();
          show(`Deleted ${e.name}`);
        }}]);
      },
    },
  };
  function pickFile(){
    if (!fileInput){
      fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = '.csv,.txt,.tsv,text/csv,text/plain,text/comma-separated-values'; fileInput.hidden = true;
      fileInput.addEventListener('change', async () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (!f) return; try { matchList(id, await f.text()); } catch { show('Couldn’t read that file'); } });
      document.body.appendChild(fileInput);
    }
    fileInput.click();
  }
  v.destroy = () => { if (fileInput){ fileInput.remove(); fileInput = null; } };
  return v;
}

function metRow(m, e){
  const done = isDone(m, e), sub = [m.title, m.company].filter(Boolean).join(' · ');
  const p = m.k ? person(m.k) : null;
  return `<div class="metrow ${done ? 'done' : ''}">
    <button type="button" class="tick" data-a="tick" data-v="${esc(m.id)}" aria-label="${done ? 'Followed up' : 'Mark followed up'}" aria-pressed="${done}">${done ? icon('checkFill') : icon('circle')}</button>
    <div class="met-main"><b>${esc(m.name)}</b>${sub ? `<span class="muted">${esc(sub)}</span>` : ''}${m.note ? `<p class="met-note">${esc(m.note)}</p>` : ''}
      <div class="met-links">${p ? `<button type="button" class="link" data-a="write" data-v="${esc(m.k)}">Message</button><button type="button" class="link" data-a="open" data-v="${esc(m.k)}">Profile</button>`
        : `<button type="button" class="link" data-a="linkedin" data-v="${esc(m.id)}">Find on LinkedIn</button>`}</div></div>
    <button type="button" class="tool small" data-a="metMore" data-v="${esc(m.id)}" aria-label="More">${icon('more')}</button></div>`;
}

const fromPerson = k => { const p = person(k); return p ? {k, name: p.full, company: p.c, title: p.p, email: p.e} : {name: ''}; };

/* ---------- add or edit someone you met ---------- */
export function openMetForm(eventId, m, editing = false){
  const first = (m.name || '').split(' ')[0];
  openSheet({
    title: editing ? 'Edit' : m.k ? `You met ${first}` : 'Someone new', left: ['Cancel'], right: ['Save', s => save(s.el)], full: true,
    mount(body){
      const f = (n, ph, type = 'text', extra = '') => `<input type="${type}" class="field" name="${n}" value="${esc(m[n] || '')}" placeholder="${ph}" ${extra}>`;
      body.innerHTML = `<div class="card form">
          ${f('name', 'Name', 'text', 'autocomplete="off" autocapitalize="words"')}
          ${f('title', 'Title', 'text', 'autocomplete="off"')}
          ${f('company', 'Company', 'text', 'autocomplete="off"')}
          ${f('email', 'Email', 'email', 'autocomplete="off" autocapitalize="none"')}
          ${f('phone', 'Phone', 'tel', 'autocomplete="off"')}
        </div>
        <p class="sec-h">Note</p>
        <div class="card form"><textarea class="field" name="note" rows="5" placeholder="What you talked about, what you promised">${esc(m.note || '')}</textarea></div>
        <p class="foot">Tap the microphone on the keyboard to dictate.${m.k ? '' : ' If they’re in your network, Bearings links them by name or email.'}</p>`;
      if (!m.name) setTimeout(() => { const i = $('input[name="name"]', body); if (i) i.focus(); }, 300);
    },
  });
  async function save(root){
    const v = n => ($(`[name="${n}"]`, root).value || '').trim();
    const out = Object.assign({}, m, {name: v('name'), title: v('title'), company: v('company'), email: v('email'), phone: v('phone'), note: v('note')});
    if (!out.name){ show('Add their name'); return; }
    closeSheet();
    await addMet(eventId, out, editing);
  }
}

/** Saves someone you met: matched to your network when possible, with a note on their timeline. */
export async function addMet(eventId, m, editing = false){
  const e = eventById(eventId); if (!e) return;
  if (!m.k){ try { const r = M.api.matchAttendees([{email: m.email || '', name: m.name}]); if (r && r[0]) m.k = r[0]; } catch {} }
  if (!m.id) m.id = newId();
  if (!m.at) m.at = new Date().toISOString();
  m.followed = !!m.followed;
  const i = e.met.findIndex(x => x.id === m.id);
  if (i >= 0) e.met[i] = m; else e.met.push(m);
  if (m.k){
    e.attending = (e.attending || []).filter(k => k !== m.k);
    if (!editing) await metAt(m.k, m.note || 'Met in person', e.name);
  }
  fx.success();
  await saveEvents();
  scheduleEventNudge(e);
  show(editing ? 'Saved' : m.k ? `Added ${m.name}, with a note on their timeline` : `Added ${m.name}`);
}

/* ---------- pick someone from your network ---------- */
export function openPicker(onPick){
  const render = (body, q) => {
    const t = q.toLowerCase().trim();
    const list = t.length < 2 ? [] : M.people.filter(p => !p.x && (p.full.toLowerCase().includes(t) || p.c.toLowerCase().includes(t))).slice(0, 50);
    $('.pick-list', body).innerHTML = t.length < 2 ? '<p class="foot">Type at least two letters of a name or company.</p>'
      : list.length ? `<div class="card list">${list.map(p => personRow(p, {act: 'pick'})).join('')}</div>` : '<p class="foot">No one matches. Use “Add someone new” instead.</p>';
  };
  openSheet({
    title: 'Who did you meet?', left: ['Cancel'], full: true,
    mount(body){
      body.innerHTML = `<label class="searchbox">${icon('search')}<input type="search" data-in="q" placeholder="Name or company" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Name or company"></label><div class="pick-list"></div>`;
      render(body, '');
      setTimeout(() => { const i = $('input', body); if (i) i.focus(); }, 300);
    },
    handlers: {
      q(v, t){ render(t.closest('.sheet-body'), v); },
      pick(k){ closeSheet(); fx.tap(); setTimeout(() => onPick(k), 120); },
    },
  });
}

/* ---------- attendee list ---------- */
function openPaste(eventId){
  openSheet({
    title: 'Attendee list', left: ['Cancel'], right: ['Match', s => { const txt = $('textarea', s.el).value; if (!txt.trim()) return; closeSheet(); matchList(eventId, txt); }], full: true,
    mount(body){
      body.innerHTML = `<div class="card form"><textarea class="field" rows="12" placeholder="Jane Smith, jane@example.com&#10;Lt Col Sam Rivera&#10;pat.lee@agency.gov" aria-label="Attendee list"></textarea></div>
        <p class="foot">One person per line: a name, an email, or both. Copy it from the registration page or a spreadsheet. The list stays on this phone.</p>`;
    },
  });
}
export async function matchList(eventId, text){
  const e = eventById(eventId); if (!e) return;
  const entries = parseAttendees(text);
  if (!entries.length){ show('No names or emails found. Put one person on each line.'); return; }
  let keys = []; try { keys = M.api.matchAttendees(entries) || []; } catch {}
  const metKeys = new Set(e.met.map(m => m.k).filter(Boolean));
  e.attending = [...new Set((e.attending || []).concat(keys.filter(k => k && !metKeys.has(k))))];
  fx.success();
  await saveEvents();
  show(`${plural(entries.length, 'person', 'people')} on the list. You know ${fmt(e.attending.length)}.`);
}

registerRoute('events', () => EventsView);
registerRoute('event', id => eventView(id));
register('events', () => push('events'));
register('newEvent', () => openNewEvent());
register('event', id => push('event', id));
