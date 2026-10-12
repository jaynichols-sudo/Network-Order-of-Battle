// Moves (rotations and people leaving service) and intro tracking. Ports Relationships.swift.
import { person, full, moves, intros, setRoleSince, addIntro, setIntro } from './model.js';
import { esc, icon, empty, menu, $ } from './ui.js';
import { registerRoute, openSheet, closeSheet, push } from './nav.js';
import { openPerson, open, register } from './actions.js';
import { personRow } from './people.js';
import { fx } from './platform.js';

/* ---------- moves ---------- */
registerRoute('moves', () => ({
  title: 'Moves',
  mount(body){ this.update(body); },
  update(body){
    const list = moves();
    const leaving = list.filter(m => m.kind === 'transition'), rotating = list.filter(m => m.kind === 'pcs');
    const rows = ms => `<div class="card list">${ms.map(m => { const p = person(m.k); return p ? `<div class="best">${personRow(p)}<p class="muted why">${esc(m.why)}</p></div>` : ''; }).join('')}</div>`;
    body.innerHTML = !list.length
      ? empty('swap', 'No moves spotted', 'Northfix looks for people whose titles say they’re transitioning or retiring, and service members who’ve been in an assignment two years or more. Set “In this role since” on a profile to sharpen it.')
      : `${leaving.length ? `<p class="sec-h">Leaving service or retiring</p>${rows(leaving)}<p class="foot">A good moment to help, and to stay close as they land somewhere new.</p>` : ''}
         ${rotating.length ? `<p class="sec-h">Likely to rotate</p>${rows(rotating)}<p class="foot">Most tours run two to three years. Reconnect before they move, then again after.</p>` : ''}`;
  },
  handlers: {open: k => openPerson(k)},
}));

/** "In this role since": sharpens rotation estimates for one person. */
export function openRoleSince(k){
  const p = full(k); if (!p) return;
  const now = new Date(), max = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const cur = (p.ed && p.ed.rs) || (p.jc ? p.jc.slice(0, 7) : '') || max;
  openSheet({
    title: 'Role start', cls: 'short',
    left: ['Clear', async s => { closeSheet(s); await setRoleSince(k, ''); }],
    right: ['Save', async s => { const v = $('input', s.el).value; closeSheet(s); await setRoleSince(k, v); }],
    mount(body){
      body.innerHTML = `<div class="card form"><label class="frow"><span>In this role since</span><input type="month" class="field month" value="${esc(cur)}" max="${max}" aria-label="In this role since"></label></div>
        <p class="foot">Used to estimate when a service member is likely to rotate. Most tours run two to three years.</p>`;
    },
  });
}
register('roleSince', openRoleSince);

/* ---------- intros ---------- */
const ST_LABEL = {asked: 'Asked', made: 'Introduced', met: 'Met', declined: 'Didn’t happen'};
registerRoute('intros', () => ({
  title: 'Intros',
  mount(body){ this.update(body); },
  update(body){
    const list = intros();
    body.innerHTML = !list.length
      ? empty('waysIn', 'No intros yet', 'When you ask someone for an intro from Ways in, tap Track it. Northfix follows it from asked to made to met.')
      : ['asked', 'made', 'met', 'declined'].map(st => { const rows = list.filter(x => x.st === st); return rows.length ? `<p class="sec-h">${ST_LABEL[st]}</p><div class="card list">${rows.map(introRow).join('')}</div>` : ''; }).join('');
  },
  handlers: {
    via: k => openPerson(k),
    more(id, t){
      const via = t.dataset.via;
      menu(t, [
        {label: 'Introduced', icon: 'check', run: () => setIntro(via, id, 'made')},
        {label: 'We met', icon: 'checkCircle', run: () => { fx.success(); setIntro(via, id, 'met'); }},
        {label: 'Didn’t happen', icon: 'x', run: () => setIntro(via, id, 'declined')},
        'sep',
        {label: 'Remove', icon: 'trash', danger: true, run: () => setIntro(via, id, 'remove')},
      ]);
    },
    nudge(k){ fx.tap(); open('message', k); },
  },
}));
function introRow(x){
  const first = (x.viaName || '').split(' ')[0];
  return `<div class="intro-row"><div class="row static">
      <button type="button" class="grow intro-main" data-a="via" data-v="${esc(x.via)}"><b>${esc(x.to ? `${x.to}${x.co ? ` at ${x.co}` : ''}` : `Into ${x.co}`)}</b><span class="muted small">${esc(`Through ${x.viaName} · ${x.days === 0 ? 'today' : `${x.days} days ago`}`)}</span></button>
      <button type="button" class="tool small" data-a="more" data-v="${esc(x.id)}" data-via="${esc(x.via)}" aria-label="Change status">${icon('more')}</button></div>
    ${x.nudge ? `<button type="button" class="pill-btn soft nudge" data-a="nudge" data-v="${esc(x.via)}">${icon('wave')}Nudge ${esc(first)}</button>` : ''}</div>`;
}

/** "Track it" after asking for an intro: who you're trying to reach. */
export function openTrackIntro(via, company){
  const p = person(via); if (!p) return;
  openSheet({
    title: 'Track this intro', cls: 'short', left: ['Cancel'],
    right: ['Track', async s => { const to = $('input', s.el).value; closeSheet(s); await addIntro(via, to, company); }],
    mount(body){
      body.innerHTML = `<div class="card form"><input type="text" class="field" placeholder="Who you want to meet (optional)" autocomplete="off">
          <div class="lrow"><span class="muted">At</span><span>${esc(company)}</span></div>
          <div class="lrow"><span class="muted">Asking</span><span>${esc(p.full)}</span></div></div>
        <p class="foot">Northfix reminds you to nudge after a week, and keeps the history on their profile.</p>`;
      setTimeout(() => { const i = $('input', body); if (i) i.focus(); }, 300);
    },
  });
}
register('trackIntro', openTrackIntro);
register('moves', () => push('moves'));
register('intros', () => push('intros'));
