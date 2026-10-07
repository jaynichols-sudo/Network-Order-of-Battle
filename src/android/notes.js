// Meeting notes from anywhere (apple/Bearings/MeetingNotes.swift): paste a Plaud summary,
// a Google Keep or Samsung note, a reMarkable page, or share text to Bearings. The engine
// finds the people you know in it and the action items; you pick who gets a short note,
// and the action items become follow-ups. The full text stays where it came from.
import { M, person, isSample, readNotes, saveMeetingNotes, show } from './model.js';
import { esc, icon, avatar, $, plural } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { register } from './actions.js';
import { fx } from './platform.js';

/** A best guess at where text came from, for the label on the sheet. */
export function guessSource(text, fileName = ''){
  const s = (String(text).slice(0, 4000) + ' ' + fileName).toLowerCase();
  if (s.includes('plaud')) return 'Plaud';
  if (s.includes('remarkable')) return 'reMarkable';
  return 'Shared notes';
}
const pickTextFile = () => new Promise(resolve => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.txt,.md,.markdown,.text,text/plain,text/markdown'; i.style.display = 'none';
  i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
  document.body.appendChild(i); i.click();
});

/** "Add meeting notes": paste text, or choose a text file. */
export function openNotes(forPerson = ''){
  if (typeof forPerson !== 'string') forPerson = '';
  let text = '';
  const go = sheet => {
    const v = ($('textarea', sheet.el) || {}).value || text;
    if (!v.trim()){ show('Paste or choose some notes first'); return; }
    closeSheet(sheet);
    setTimeout(() => ingestNotes(v, guessSource(v), forPerson), 260);
  };
  openSheet({
    title: 'Add meeting notes', left: ['Cancel'], right: ['Read', s => go(s)], full: true,
    mount(body){
      const p = forPerson && person(forPerson);
      body.innerHTML = `<p class="foot first">A Plaud summary, a note from your notes app, a reMarkable page or any notes. Bearings finds the people you know and the action items.${p ? ` ${esc(p.f)} is included either way.` : ''}</p>
        <div class="card top8"><textarea class="msg-text notes-paste" data-in="text" placeholder="Paste your notes here" aria-label="Meeting notes"></textarea></div>
        <div class="btn-row"><button type="button" class="btn" data-a="paste">${icon('copy')}Paste</button><button type="button" class="btn" data-a="file">${icon('note')}Choose a file</button></div>
        <p class="foot">You can also share notes to Bearings from Plaud or your notes app.</p>`;
    },
    handlers: {
      text: v => { text = v; },
      async paste(_, t){
        try { const v = await navigator.clipboard.readText(); if (v){ text = v; $('textarea', t.closest('.sheet')).value = v; return; } } catch {}
        show('Press and hold in the box, then choose Paste');
      },
      async file(_, t){
        const f = await pickTextFile(); if (!f) return;
        try { text = await f.text(); $('textarea', t.closest('.sheet')).value = text; }
        catch { show(`Couldn’t read ${f.name}`); }
      },
    },
  });
}
register('notes', openNotes);

/** Reads the text and opens the review sheet. */
export function ingestNotes(text, source = 'Shared notes', forPerson = ''){
  const r = readNotes(text);
  if (!r){ show('Couldn’t read those notes'); return; }
  if (r.words < 3){ show('There’s no text in that to file'); return; }
  openReview(r, source, forPerson);
}
register('ingestNotes', ingestNotes);

function openReview(reading, source, forPerson){
  const people = reading.people.map(m => m.k).filter(k => person(k));
  if (forPerson && person(forPerson) && !people.includes(forPerson)) people.unshift(forPerson);
  const st = {title: reading.title || 'Meeting', people, picked: new Set(people), acts: new Set(reading.actions.map((_, i) => i)), inTouch: true, saving: false};
  const mention = k => {
    const n = (reading.people.find(m => m.k === k) || {}).n || 0, p = person(k);
    const role = [p.p, p.c].filter(Boolean).join(', ');
    return n > 0 ? `Mentioned ${n === 1 ? 'once' : `${n} times`}${role ? ' · ' + role : ''}` : role;
  };
  const who = a => person(a.k || [...st.picked][0] || '');
  const render = body => {
    const sc = body.scrollTop;
    body.innerHTML = `<p class="eyebrow pad-x top8">${esc(source)} · ${esc(plural(reading.words, 'word', 'words'))}</p>
      <div class="card top8"><input type="text" class="notes-title" data-in="title" value="${esc(st.title)}" aria-label="Meeting" placeholder="Meeting">${reading.summary ? `<p class="notes-sum">${esc(reading.summary)}</p>` : '<div style="height:10px"></div>'}</div>
      <p class="sec-h">${st.people.length ? 'People you know in these notes' : 'Who was there?'}</p>
      <div class="card list">${st.people.map(k => { const p = person(k); if (!p) return ''; const on = st.picked.has(k);
        return `<button type="button" class="row prow pick-row ${on ? 'on' : ''}" data-a="toggle" data-v="${esc(k)}" aria-pressed="${on}">${avatar(p, 38, {star: false})}<span class="prow-main"><b class="prow-name">${esc(p.full)}</b><span class="prow-detail">${esc(mention(k))}</span></span><span class="tick">${on ? icon('checkFill') : icon('circle')}</span></button>`; }).join('')}
        <button type="button" class="row act accent" data-a="add">${icon('plusCircle')}<span>Add someone</span></button></div>
      <p class="foot">Each person gets a short note with the date, the meeting and the summary.</p>
      ${reading.actions.length ? `<p class="sec-h">Action items</p><div class="card list">${reading.actions.map((a, i) => { const on = st.acts.has(i), p = who(a);
        return `<button type="button" class="row act-row ${on ? 'on' : ''}" data-a="act" data-v="${i}" aria-pressed="${on}"><span class="box"></span><span class="grow"><span>${esc(a.text)}</span>${p ? `<span class="muted small">With ${esc(p.full)}</span>` : ''}</span></button>`; }).join('')}</div>
        <p class="foot">Each one becomes a follow-up in three days for the person it mentions, and goes into their note.</p>` : ''}
      <div class="card list top8"><label class="toggle-row" style="padding:12px 16px"><span>I was in touch with them today</span><input type="checkbox" class="switch" data-ch="inTouch" ${st.inTouch ? 'checked' : ''}></label></div>
      ${isSample() ? '<p class="foot">Sample data: changes aren’t saved.</p>' : ''}`;
    body.scrollTop = sc;
  };
  const save = async sheet => {
    if (st.saving) return;
    if (!st.picked.size){ show('Pick at least one person'); return; }
    st.saving = true;
    const base = reading.summary ? `${st.title.trim() || 'Meeting'}. ${reading.summary}` : (st.title.trim() || 'Meeting');
    const todo = {}, follow = [];
    reading.actions.forEach((a, i) => {
      if (!st.acts.has(i)) return;
      const k = a.k && person(a.k) ? a.k : [...st.picked][0];
      if (!k) return;
      (todo[k] = todo[k] || []).push(a.text);
      if (!follow.some(f => f[0] === k)) follow.push([k, 3]);
    });
    const notes = [...st.picked].map(k => [k, (base + (todo[k] ? ` To do: ${todo[k].join('; ')}.` : '')).slice(0, 480), source]);
    // someone with a to-do who wasn't picked still gets the to-do as a note
    for (const k of Object.keys(todo)) if (!st.picked.has(k)) notes.push([k, `To do from ${st.title.trim() || 'a meeting'}: ${todo[k].join('; ')}.`.slice(0, 480), source]);
    const ok = await saveMeetingNotes({notes, touch: st.inTouch ? [...st.picked] : [], follow});
    st.saving = false;
    if (!ok) return;
    fx.success();
    const n = st.picked.size, f = follow.length;
    show(`Saved to ${plural(n, 'person', 'people')}${f ? `, ${plural(f, 'follow-up', 'follow-ups')} set` : ''}`);
    closeSheet(sheet);
  };
  openSheet({
    title: 'Meeting notes', left: ['Cancel'], right: ['Save', s => save(s)], full: true,
    mount: render,
    handlers: {
      title: v => { st.title = v; },
      toggle(k, t){ fx.tap(); st.picked.has(k) ? st.picked.delete(k) : st.picked.add(k); render(t.closest('.sheet-body')); },
      act(i, t){ fx.tap(); i = +i; st.acts.has(i) ? st.acts.delete(i) : st.acts.add(i); render(t.closest('.sheet-body')); },
      inTouch: v => { st.inTouch = !!v; },
      add(_, t){ const body = t.closest('.sheet-body'); pickPerson(k => { if (!st.people.includes(k)) st.people.push(k); st.picked.add(k); render(body); }); },
    },
  });
}

/** A small search-for-someone sheet. */
export function pickPerson(onPick, title = 'Add someone'){
  let q = '';
  const render = body => {
    const t = q.trim().toLowerCase();
    const list = t ? M.people.filter(p => !p.x && `${p.full} ${p.c}`.toLowerCase().includes(t)).slice(0, 50) : M.people.filter(p => !p.x).slice().sort((a, b) => b.score - a.score).slice(0, 30);
    $('.pp-list', body).innerHTML = `<p class="sec-h">${t ? 'Matches' : 'People you’re closest to'}</p>${list.length ? `<div class="card list">${list.map(p => `<button type="button" class="row prow" data-a="pick" data-v="${esc(p.k)}">${avatar(p, 40, {star: false})}<span class="prow-main"><b class="prow-name">${esc(p.full)}</b><span class="prow-detail">${esc([p.p, p.c].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>` : '<p class="muted pad">No one matches.</p>'}`;
  };
  openSheet({
    title, left: ['Cancel'], full: true,
    mount(body){ body.innerHTML = `<label class="searchbox">${icon('search')}<input type="search" data-in="q" placeholder="Search everyone" autocomplete="off"></label><div class="pp-list"></div>`; render(body); setTimeout(() => { const i = $('input', body); if (i) i.focus(); }, 300); },
    handlers: {
      q(v, t){ q = v; render(t.closest('.sheet-body')); },
      pick(k){ closeSheet(); onPick(k); },
    },
  });
}
