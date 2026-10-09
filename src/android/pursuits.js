// Pursuits: an opportunity (a bid, a deal) and the people who decide it. Each seat shows who
// you know in it, or who could fill it, and the warmest ways into the agency. Ports Pursuits.swift.
import { M, person, isSample, pursuits, pursuit, addPursuit, updatePursuit, assignRole, removePursuit, show } from './model.js';
import { esc, fmt, icon, avatar, empty, progressRing, $ } from './ui.js';
import { registerRoute, openSheet, closeSheet, push, popPage, setPageTitle } from './nav.js';
import { openPerson, register } from './actions.js';
import { personRow } from './people.js';
import { openPicker } from './events.js';
import { fx } from './platform.js';

export function dueText(days){
  if (days == null) return '';
  if (days < 0) return `due ${-days} days ago`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}
const sampleNote = () => isSample() ? '<p class="foot">Sample data: pursuits aren’t saved.</p>' : '';

/* ---------- the list ---------- */
function row(p){
  const meta = [p.agency, p.stage, dueText(p.days)].filter(Boolean).join(' · ');
  return `<button type="button" class="row purow" data-a="pursuit" data-v="${esc(p.id)}">${progressRing(p.filled, p.roles, 38, 4)}
    <span class="purow-main"><b>${esc(p.name)}</b>${meta ? `<span class="muted small">${esc(meta)}</span>` : ''}<span class="small strong ${p.filled < 3 ? 'needs' : 'good'}">${esc(`${p.filled} of ${p.roles} seats known${p.warm > 0 ? ` · ${p.warm} warm` : ''}`)}</span></span>${icon('chevR', 'chev')}</button>`;
}
registerRoute('pursuits', () => {
  const view = {
    title: 'Pursuits',
    mount(body, page){
      const r = $('.bar-right', page);
      r.insertAdjacentHTML('beforeend', `<button type="button" class="bar-act" data-a="add" aria-label="Add a pursuit">${icon('plus')}</button>`);
      this.update(body);
    },
    update(body){
      const list = pursuits();
      body.innerHTML = list.length
        ? `<div class="card list top8">${list.map(row).join('')}</div>${sampleNote()}`
        : empty('target', 'No pursuits yet', 'Add a bid or a deal, and Bearings maps the people who decide it: who you know in each seat, the gaps, and your warmest ways in.', '<button type="button" class="btn prominent" data-a="add">Add a pursuit</button>');
    },
    handlers: {
      add: () => openNewPursuit(),
      pursuit: id => push('pursuit', id),
    },
  };
  return view;
});

/* ---------- one pursuit ---------- */
registerRoute('pursuit', id => {
  let note = null, noteT = 0;
  const view = {
    title: 'Pursuit',
    menu: () => [{label: 'Delete pursuit', icon: 'trash', danger: true, run: () => del()}],
    mount(body){ this.render(body); },
    update(body){
      // don't redraw under someone typing their notes
      const a = document.activeElement;
      if (a && body.contains(a) && a.tagName === 'TEXTAREA') return;
      this.render(body);
    },
    render(body){
      const d = pursuit(id);
      if (!d){ body.innerHTML = empty('target', 'Not found', 'This pursuit was deleted.'); return; }
      if (note == null) note = d.note || '';
      this.title = d.name;
      const pg = body.closest('.page'); if (pg) setPageTitle(pg, d.name);
      const sc = body.scrollTop;
      const meta = [dueText(d.days), d.value, d.agency ? `${fmt(d.known)} ${d.known === 1 ? 'person' : 'people'} you know at ${d.agency}` : ''].filter(Boolean).join(' · ');
      body.innerHTML = `<div class="pursuit">
        <section class="card pad pu-head">
          ${d.agency ? `<p class="eyebrow mono muted">${esc(d.agency.toUpperCase())}</p>` : ''}
          <h1 class="serif">${esc(d.name)}</h1>
          <div class="pu-ring">${progressRing(d.filled, d.roles, 46, 5)}<span class="pu-ring-t"><b>${esc(`${d.filled} of ${d.roles} seats known`)}</b>${meta ? `<span class="muted small">${esc(meta)}</span>` : ''}</span></div>
          <label class="frow pu-stage"><span>Stage</span><div class="select"><select data-ch="stage" aria-label="Stage">${d.stages.map(s => `<option ${s === d.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>${icon('chevD')}</div></label>
        </section>
        <p class="sec-h">Who decides</p>
        <div class="card list roles">${d.roleList.map(r => roleRow(r)).join('')}</div>
        <p class="foot">${esc(d.agency ? `Suggestions come from titles at ${d.agency}. Tap one to put them in the seat.` : 'Add an agency or company to get suggestions for each seat.')}</p>
        ${d.best.length ? `<p class="sec-h">Warmest ways in</p><div class="card list">${d.best.map(b => { const x = person(b.k); return x ? `<div class="best">${personRow(x)}<p class="muted why">${esc(b.why)}</p></div>` : ''; }).join('')}</div>` : ''}
        <p class="sec-h">Notes</p>
        <div class="card"><textarea class="field pad-x pu-note" rows="4" data-in="note" placeholder="What you know about this one">${esc(note)}</textarea></div>
        <div class="card list actions top12">
          ${d.agency ? `<button type="button" class="row act" data-a="org">${icon('org')}<span>Org chart for ${esc(d.agency)}</span>${icon('chevR', 'chev')}</button>` : ''}
          <button type="button" class="row act danger" data-a="del">${icon('trash')}<span>Delete pursuit</span></button>
        </div>
        ${sampleNote()}
      </div>`;
      body.scrollTop = sc;
    },
    handlers: {
      open: k => openPerson(k),
      async stage(v){ fx.select(); await updatePursuit(id, {stage: v}); },
      add(role){ openPicker(k => assignRole(id, role, k, true).then(() => { fx.success(); }), {title: role, none: 'No one matches. Try another name or company.'}); },
      async assign(k, t){ fx.tap(); await assignRole(id, t.dataset.role, k, true); },
      async unassign(k, t){ fx.tap(); await assignRole(id, t.dataset.role, k, false); },
      note(v){ note = v; clearTimeout(noteT); noteT = setTimeout(() => updatePursuit(id, {note: v}), 700); },
      org(){ const d = pursuit(id); if (d && d.agency) push('org', d.agency); },
      del: () => del(),
    },
    destroy(){ if (noteT){ clearTimeout(noteT); const d = pursuit(id); if (d && note != null && note !== d.note) updatePursuit(id, {note}); } },
  };
  async function del(){ await removePursuit(id); fx.success(); show('Pursuit deleted'); popPage(); }
  return view;
});
function roleRow(r){
  const people = r.people.map(m => { const p = person(m.k); return p ? `<div class="pu-person">${personRow(p)}<button type="button" class="tool small" data-a="unassign" data-v="${esc(m.k)}" data-role="${esc(r.role)}" aria-label="Remove ${esc(m.name)}">${icon('x')}</button></div>` : ''; }).join('');
  const sugg = r.suggest.length ? `<div class="chips-scroll pu-sugg">${r.suggest.map(s => { const p = person(s.k); return `<button type="button" class="sugg" data-a="assign" data-v="${esc(s.k)}" data-role="${esc(r.role)}">${p ? avatar(p, 26, {star: false}) : ''}<span class="sugg-t"><b>${esc(s.name)}</b><span>${esc(s.p)}</span></span></button>`; }).join('')}</div>` : '';
  return `<div class="pu-role"><div class="pu-role-top"><b>${esc(r.role)}</b>${r.people.length ? '' : '<span class="flag" style="--fc:var(--needs)">Empty seat</span>'}<button type="button" class="tool small" data-a="add" data-v="${esc(r.role)}" aria-label="Add someone as ${esc(r.role)}">${icon('plusCircle')}</button></div>${people}${sugg}</div>`;
}

/* ---------- a new pursuit ---------- */
export function openNewPursuit(agency = ''){
  const st = {name: '', org: agency, value: '', due: '', hasDue: false};
  const valid = () => !!st.name.trim() && !!st.org.trim();
  const sync = sheet => { const b = $('[data-sb="r"]', sheet.el); if (b) b.disabled = !valid(); };
  const plus30 = () => { const d = new Date(Date.now() + 30 * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  let sheet = null;
  const watch = body => {
    const t = M.targets.slice(0, 10);
    $('.np-watch', body).innerHTML = t.length ? `<p class="sec-h">From your watchlist</p><div class="chips-scroll">${t.map(x => `<button type="button" class="chip ${st.org === x.name ? 'on' : ''}" data-a="pickOrg" data-v="${esc(x.name)}">${esc(x.name)}</button>`).join('')}</div>` : '';
  };
  sheet = openSheet({
    title: 'New pursuit', left: ['Cancel'], full: true,
    right: ['Add', async s => {
      if (!valid()) return;
      const id = await addPursuit({name: st.name.trim(), agency: st.org.trim(), value: st.value.trim(), due: st.hasDue && st.due ? st.due : ''});
      if (!id) return;
      fx.success();
      closeSheet(s);
      push('pursuit', id);
    }],
    mount(body, s){
      body.innerHTML = `<div class="card form">
          <input type="text" class="field" data-in="name" placeholder="Name, like “DISA OT gateway pilot”" autocomplete="off">
          <input type="text" class="field np-org" data-in="org" value="${esc(st.org)}" placeholder="Agency or company" autocomplete="off" autocapitalize="characters">
          <input type="text" class="field" data-in="value" placeholder="Value or vehicle (optional)" autocomplete="off">
        </div>
        <div class="card form top12">
          <label class="toggle-row"><span>Due date</span><input type="checkbox" class="switch" data-ch="hasDue"></label>
          <input type="date" class="field np-due" data-in="due" hidden>
        </div>
        <div class="np-watch"></div>`;
      watch(body);
      sync(s);
      setTimeout(() => { const i = $('input', body); if (i) i.focus(); }, 300);
    },
    handlers: {
      name(v){ st.name = v; sync(sheet); },
      org(v, t){ st.org = v; sync(sheet); watch(t.closest('.sheet-body')); },
      value(v){ st.value = v; },
      due(v){ st.due = v; },
      hasDue(on, t){ st.hasDue = !!on; const i = $('.np-due', t.closest('.sheet-body')); i.hidden = !on; if (on && !i.value){ i.value = plus30(); st.due = i.value; } },
      pickOrg(v, t){ fx.select(); st.org = v; const body = t.closest('.sheet-body'); $('.np-org', body).value = v; watch(body); sync(sheet); },
    },
  });
  return sheet;
}
register('newPursuit', openNewPursuit);
register('pursuits', () => push('pursuits'));
