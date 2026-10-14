// Pursuits: an opportunity (a bid, a deal) and the people who decide it. Each seat shows who
// you know in it, or who could fill it, and the warmest ways into the agency. Ports Pursuits.swift.
import { M, person, isSample, pursuits, pursuit, addPursuit, updatePursuit, assignRole, removePursuit, setSeatOwner, pipeline, pursuitSheet, callPlan, show } from './model.js';
import { esc, fmt, icon, avatar, empty, progressRing, flag, menu, Day, $ } from './ui.js';
import { registerRoute, openSheet, closeSheet, push, popPage, setPageTitle } from './nav.js';
import { openPerson, register, open } from './actions.js';
import { personRow } from './people.js';
import { openPicker } from './events.js';
import { fx, ls, copy, shareText, shareFile, NATIVE } from './platform.js';

export function dueText(days){
  if (days == null) return '';
  if (days < 0) return `due ${-days} days ago`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
}
const sampleNote = () => isSample() ? '<p class="foot">Sample data: pursuits aren’t saved.</p>' : '';
/** 1840000 as "$1.8M", the way the engine writes money. */
export function money(n){
  const v = +n || 0;
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e11 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
const coldFlag = days => flag(days == null ? 'Cold' : `Cold: ${days} days`, 'var(--info)');

/* ---------- the list ---------- */
function row(p){
  const meta = [p.agency, p.stage, dueText(p.days)].filter(Boolean).join(' · ');
  const odds = p.amount > 0 && p.stage !== 'Won' && p.stage !== 'Lost' ? ` · ${p.pwin}% of ${money(p.amount)}` : '';
  return `<button type="button" class="row purow" data-a="pursuit" data-v="${esc(p.id)}">${progressRing(p.filled, p.roles, 38, 4)}
    <span class="purow-main"><b>${esc(p.name)}</b>${meta ? `<span class="muted small">${esc(meta + odds)}</span>` : ''}<span class="small strong ${p.filled < 3 ? 'needs' : 'good'}">${esc(`${p.filled} of ${p.roles} seats known${p.warm > 0 ? ` · ${p.warm} warm` : ''}`)}</span>${p.cold ? `<span class="pu-cold">${flag(`${p.cold} cold ${p.cold === 1 ? 'seat' : 'seats'}`, 'var(--info)')}</span>` : ''}</span>${icon('chevR', 'chev')}</button>`;
}
function pipelineRow(){
  const pl = pipeline(false);
  if (!pl || !pl.rows.length) return '';
  const bits = [`${fmt(pl.open.count)} open`, pl.open.weighted ? `${pl.open.weightedText} weighted` : '', pl.winRate != null ? `${pl.winRate}% won` : ''].filter(Boolean).join(' · ');
  return `<div class="card list top8"><button type="button" class="row act pu-pipe" data-a="pipeline">${icon('trend')}<span class="grow"><b>Pipeline</b><span class="muted small">${esc(bits)}</span></span>${icon('chevR', 'chev')}</button></div>`;
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
        ? `${pipelineRow()}<div class="card list top8">${list.map(row).join('')}</div>${sampleNote()}`
        : empty('target', 'No pursuits yet', 'Add a bid or a deal, and Northfix maps the people who decide it: who you know in each seat, the gaps, and your warmest ways in.', '<button type="button" class="btn prominent" data-a="add">Add a pursuit</button>');
    },
    handlers: {
      add: () => openNewPursuit(),
      pursuit: id => push('pursuit', id),
      pipeline: () => { fx.tap(); push('pipeline'); },
    },
  };
  return view;
});

/* ---------- one pursuit ---------- */
registerRoute('pursuit', id => {
  let note = null, noteT = 0;
  const view = {
    title: 'Pursuit',
    menu: () => [
      {label: 'Share one-pager', icon: 'share', run: () => openOnePager(id)},
      {label: 'Pipeline', icon: 'trend', run: () => push('pipeline')},
      {label: 'Delete pursuit', icon: 'trash', danger: true, run: () => del()},
    ],
    mount(body){ this.render(body); },
    update(body){
      // don't redraw under someone typing their notes or a detail
      const a = document.activeElement;
      if (a && body.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return;
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
      const gov = d.roleList.filter(r => r.side !== 'industry'), ind = d.roleList.filter(r => r.side === 'industry');
      const team = d.teammates || [];
      const odds = d.amount > 0 ? `${d.pwin}% of ${money(d.amount)} is ${money(d.weighted)} weighted` : `${d.pwin}% chance of winning`;
      body.innerHTML = `<div class="pursuit">
        <section class="card pad pu-head">
          ${d.agency ? `<p class="eyebrow mono muted">${esc(d.agency.toUpperCase())}</p>` : ''}
          <h1 class="serif">${esc(d.name)}</h1>
          <div class="pu-ring">${progressRing(d.filled, d.roles, 46, 5)}<span class="pu-ring-t"><b>${esc(`${d.filled} of ${d.roles} seats known`)}</b>${meta ? `<span class="muted small">${esc(meta)}</span>` : ''}${d.cold ? `<span class="pu-cold">${flag(`${d.cold} cold ${d.cold === 1 ? 'seat' : 'seats'}`, 'var(--info)')}</span>` : ''}</span></div>
          <label class="frow pu-stage"><span>Stage</span><div class="select"><select data-ch="stage" aria-label="Stage">${d.stages.map(s => `<option ${s === d.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>${icon('chevD')}</div></label>
        </section>
        <p class="sec-h">The bid</p>
        <div class="card form pu-form">
          <label class="frow col"><span>Incumbent</span><input type="text" class="field" data-ch="incumbent" value="${esc(d.incumbent)}" placeholder="Who holds the work today" autocomplete="off" enterkeyhint="done"></label>
          <label class="frow col"><span>Teaming partners</span><input type="text" class="field" data-ch="partners" value="${esc(d.partners.join(', '))}" placeholder="Companies you’d bid with, separated by commas" autocomplete="off" enterkeyhint="done"></label>
          <label class="frow pu-pwin"><span>Win chance</span><span class="pu-pwin-in"><input type="number" class="field" data-ch="pwin" min="0" max="100" step="5" inputmode="numeric" value="${d.pwinSet ? d.pwin : ''}" placeholder="${d.pwinSet ? '' : d.pwin}" aria-label="Win chance, percent"><span class="muted">%</span></span></label>
        </div>
        <p class="foot">${esc(d.pwinSet ? `${odds}.` : `${odds}. ${d.pwin}% is typical for ${d.stage}. Type your own number to change it.`)}${d.pwinSet ? ' <button type="button" class="link small" data-a="pwinReset">Use the stage default</button>' : ''}</p>
        <p class="sec-h">Who decides</p>
        <div class="card list roles">${gov.map(r => roleRow(r, team)).join('')}</div>
        <p class="foot">${esc(d.agency ? `Suggestions come from titles at ${d.agency}. Tap one to put them in the seat.` : 'Add an agency or company to get suggestions for each seat.')}</p>
        <p class="sec-h">Industry</p>
        <div class="card list roles">${ind.map(r => roleRow(r, team)).join('')}</div>
        <p class="foot">Who holds the work today, and who you’d bid it with. Suggestions come from the companies above.</p>
        ${d.best.length ? `<p class="sec-h">Warmest ways in</p><div class="card list">${d.best.map(b => { const x = person(b.k); return x ? `<div class="best">${personRow(x)}<p class="muted why">${esc(b.why)}</p></div>` : ''; }).join('')}</div>` : ''}
        <p class="sec-h">Notes</p>
        <div class="card"><textarea class="field pad-x pu-note" rows="4" data-in="note" placeholder="What you know about this one">${esc(note)}</textarea></div>
        <div class="card list actions top12">
          <button type="button" class="row act" data-a="sheet">${icon('share')}<span>Share one-pager</span>${icon('chevR', 'chev')}</button>
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
      async incumbent(v, t){ t.blur(); await updatePursuit(id, {incumbent: v.trim().slice(0, 160)}); },
      async partners(v, t){ t.blur(); await updatePursuit(id, {partners: v.trim().slice(0, 400)}); },
      async pwin(v, t){
        t.blur();
        const s = String(v).trim();
        if (s === ''){ await updatePursuit(id, {pwin: ''}); return; }
        const n = Math.max(0, Math.min(100, Math.round(+s)));
        if (!isFinite(n)){ t.value = ''; return; }
        fx.select(); await updatePursuit(id, {pwin: n});
      },
      async pwinReset(){ fx.tap(); await updatePursuit(id, {pwin: ''}); },
      add(role){ openPicker(k => assignRole(id, role, k, true).then(() => { fx.success(); }), {title: role, none: 'No one matches. Try another name or company.'}); },
      async assign(k, t){ fx.tap(); await assignRole(id, t.dataset.role, k, true); },
      async unassign(k, t){ fx.tap(); await assignRole(id, t.dataset.role, k, false); },
      plan(k){ fx.tap(); openCallPlan(k, id); },
      owner(role, t){
        const d = pursuit(id); if (!d) return;
        const cur = d.owners[role] || '';
        menu(t, [{header: `Who owns the ${role.toLowerCase()} seat`}, ...d.teammates.map(n => ({label: n, on: n === cur, run: () => setSeatOwner(id, role, n)})),
          ...(cur ? ['sep', {label: 'No owner', danger: true, run: () => setSeatOwner(id, role, '')}] : [])]);
      },
      note(v){ note = v; clearTimeout(noteT); noteT = setTimeout(() => updatePursuit(id, {note: v}), 700); },
      org(){ const d = pursuit(id); if (d && d.agency) push('org', d.agency); },
      sheet: () => openOnePager(id),
      del: () => del(),
    },
    destroy(){ if (noteT){ clearTimeout(noteT); const d = pursuit(id); if (d && note != null && note !== d.note) updatePursuit(id, {note}); } },
  };
  async function del(){ await removePursuit(id); fx.success(); show('Pursuit deleted'); popPage(); }
  return view;
});
const lastLine = m => m.last ? `Last in touch ${Day.ago(m.last)}` : 'Not in touch yet';
function roleRow(r, team){
  const people = r.people.map(m => { const p = person(m.k); return p ? `<div class="pu-person">${personRow(p, {sub: lastLine(m)})}<button type="button" class="tool small" data-a="unassign" data-v="${esc(m.k)}" data-role="${esc(r.role)}" aria-label="Remove ${esc(m.name)}">${icon('x')}</button></div>
    <button type="button" class="link small pu-plan" data-a="plan" data-v="${esc(m.k)}" aria-label="${esc(`Call plan for ${m.name}`)}">${icon('checklist')}Call plan</button>` : ''; }).join('');
  const sugg = r.suggest.length ? `<div class="chips-scroll pu-sugg">${r.suggest.map(s => { const p = person(s.k); return `<button type="button" class="sugg" data-a="assign" data-v="${esc(s.k)}" data-role="${esc(r.role)}">${p ? avatar(p, 26, {star: false}) : ''}<span class="sugg-t"><b>${esc(s.name)}</b><span>${esc(s.p)}</span></span></button>`; }).join('')}</div>` : '';
  const badge = r.cold ? coldFlag(r.coldDays) : r.people.length ? '' : flag('Empty seat', 'var(--needs)');
  const owner = team.length ? `<button type="button" class="link small pu-owner" data-a="owner" data-v="${esc(r.role)}">${esc(r.owner ? `Owner: ${r.owner}` : 'Set owner')}</button>` : (r.owner ? `<span class="muted small pu-owner">${esc(`Owner: ${r.owner}`)}</span>` : '');
  const sub = [r.companies.length ? r.companies.join(', ') : '', r.hint].filter(Boolean);
  return `<div class="pu-role"><div class="pu-role-top"><b>${esc(r.role)}</b>${badge}<button type="button" class="tool small" data-a="add" data-v="${esc(r.role)}" aria-label="Add someone as ${esc(r.role)}">${icon('plusCircle')}</button></div>
    ${sub.length || owner ? `<div class="pu-role-sub">${r.companies.length ? `<span class="small strong">${esc(r.companies.join(', '))}</span>` : ''}${r.hint ? `<span class="muted small">${esc(r.hint)}</span>` : ''}${owner}</div>` : ''}${people}${sugg}</div>`;
}

/* ---------- the pipeline ---------- */
const PIPE_TEAM = 'bearings.pipeTeam';
const OPEN_STAGES = ['Tracking', 'Pursuing', 'Proposal', 'Submitted'];
registerRoute('pipeline', () => {
  let withTeam = ls.get(PIPE_TEAM) === '1';
  const view = {
    title: 'Pipeline',
    mount(body){ this.update(body); },
    update(body){
      let pl = pipeline(withTeam);
      if (pl && !pl.hasTeam && withTeam) pl = pipeline(false);
      if (!pl || !pl.rows.length){ body.innerHTML = empty('trend', 'No pursuits yet', 'Add a pursuit with a value and a stage, and Northfix adds up what’s open, weighted by your chance of winning.', '<button type="button" class="btn prominent" data-a="add">Add a pursuit</button>'); return; }
      const team = pl.withTeam;
      const stat = (v, l) => `<div class="stat"><b class="mono">${esc(v)}</b><span class="muted small">${esc(l)}</span></div>`;
      const open = pl.stages.filter(s => OPEN_STAGES.includes(s.stage));
      const max = Math.max(1, ...open.map(s => s.value));
      const who = r => team ? (r.mine ? 'Yours' : r.owner) : '';
      const rowOf = (r, right) => `<button type="button" class="row pipe-row" ${r.mine && r.id ? `data-a="pursuit" data-v="${esc(r.id)}"` : 'disabled'}><span class="grow"><b>${esc(r.name)}</b><span class="muted small">${esc([who(r), r.agency, r.stage, r.due && !r.closed ? `due ${Day.nice(r.due)}` : '', r.closed ? `decided ${Day.nice(r.closed)}` : ''].filter(Boolean).join(' · '))}</span></span>${right}${r.mine && r.id ? icon('chevR', 'chev') : ''}</button>`;
      const openRows = pl.rows.filter(r => OPEN_STAGES.includes(r.stage));
      body.innerHTML = `<div class="card pad pipe-head"><p class="eyebrow mono muted">${team ? 'OPEN ACROSS THE TEAM' : 'OPEN PURSUITS'}</p>
          <p><b class="serif big">${esc(pl.open.weightedText)}</b> <span class="muted">weighted, of ${esc(pl.open.valueText)} in ${fmt(pl.open.count)} open ${pl.open.count === 1 ? 'pursuit' : 'pursuits'}</span></p></div>
        <div class="card stats3">${stat(pl.dueThisQuarter.weightedText, `due in the next 90 days (${fmt(pl.dueThisQuarter.count)})`)}${stat(pl.winRate == null ? '–' : pl.winRate + '%', 'win rate')}${stat(`${fmt(pl.won.count)} / ${fmt(pl.lost.count)}`, 'won / lost')}</div>
        ${pl.hasTeam ? `<div class="card list top12"><label class="toggle-row"><span>Include my team</span><input type="checkbox" class="switch" data-ch="team" ${team ? 'checked' : ''}></label></div>` : ''}
        <p class="sec-h">By stage</p>
        <div class="card list">${open.map(s => `<div class="row static pipe-stage"><span class="grow"><span class="row-between"><b>${esc(s.stage)}</b><span class="mono small">${esc(s.count ? `${s.valueText} · ${s.weightedText} weighted` : 'None')}</span></span>
          <span class="pipe-bar"><i style="width:${s.value ? Math.max(2, s.value / max * 100) : 0}%;background:var(--accent)"></i></span><span class="muted small">${esc(`${fmt(s.count)} ${s.count === 1 ? 'pursuit' : 'pursuits'}`)}</span></span></div>`).join('')}</div>
        ${openRows.length ? `<p class="sec-h">Open, biggest weighted first</p><div class="card list">${openRows.map(r => rowOf(r, `<span class="pipe-amt"><b class="mono">${esc(r.amount ? money(r.weighted) : 'No value')}</b><span class="muted small">${esc(`${r.pwin}%${r.amount ? ' of ' + money(r.amount) : ''}`)}</span></span>`)).join('')}</div>` : ''}
        ${pl.unpriced ? `<p class="foot">${esc(`${fmt(pl.unpriced)} ${pl.unpriced === 1 ? 'pursuit has' : 'pursuits have'} no value yet, so ${pl.unpriced === 1 ? 'it counts' : 'they count'} as $0. Add a value like $2.5M on the pursuit.`)}</p>` : ''}
        <p class="sec-h">Won and lost</p>
        ${pl.history.length ? `<div class="card list">${pl.history.map(r => rowOf(r, `<span class="pipe-amt">${flag(r.stage, r.stage === 'Won' ? 'var(--good)' : 'var(--bad)')}<span class="muted small mono">${esc(r.amount ? money(r.amount) : '')}</span></span>`)).join('')}</div>
          <p class="foot">${esc(`Won ${pl.won.valueText} in ${fmt(pl.won.count)}, lost ${pl.lost.valueText} in ${fmt(pl.lost.count)}.`)}</p>` : '<p class="foot">Nothing decided yet. Set a pursuit to Won or Lost and it shows here.</p>'}
        <p class="foot">Weighted value is the value times the win chance. Each stage has a typical win chance until you set your own on the pursuit.</p>`;
    },
    handlers: {
      pursuit: v => { fx.tap(); push('pursuit', v); },
      add: () => openNewPursuit(),
      team(on, t){ fx.select(); withTeam = !!on; ls.set(PIPE_TEAM, withTeam ? '1' : '0'); view.update(t.closest('.page-body')); },
    },
  };
  return view;
});

/* ---------- the one-pager ---------- */
/** The pursuit on one printable page: plain HTML with its own styles, to share or print. */
export function onePagerHTML(sh){
  const e = esc;
  const seat = s => `<div class="seat${s.cold ? ' cold' : ''}"><div class="seat-h"><b>${e(s.role)}</b>${s.owner ? `<span class="own">Owner: ${e(s.owner)}</span>` : ''}</div>
    ${s.people.map(p => `<div class="who">${e(p.name)}${p.detail ? ` <span class="dim">· ${e(p.detail)}</span>` : ''}${p.last ? ` <span class="dim">· last in touch ${e(p.last)}</span>` : ''}</div>`).join('')}
    <div class="st">${e(s.status)}</div></div>`;
  const gov = sh.seats.filter(s => s.side !== 'industry'), ind = sh.seats.filter(s => s.side === 'industry');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(sh.title)}</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font: 12px/1.4 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c1636; background: #fff; }
  .eyebrow { font: 600 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .1em; color: #8a6200; text-transform: uppercase; }
  h1 { font: 600 22px/1.2 Georgia, "Times New Roman", serif; margin: 6px 0 12px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #5d5875; margin: 16px 0 6px; border-bottom: 1px solid #e3e0ee; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 3px 8px 3px 0; vertical-align: top; }
  td:first-child { color: #5d5875; width: 34%; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; }
  .seat { border: 1px solid #e3e0ee; border-radius: 6px; padding: 6px 8px; break-inside: avoid; }
  .seat.cold { border-color: #7ea6ff; background: #f3f6ff; }
  .seat-h { display: flex; justify-content: space-between; gap: 8px; }
  .own, .dim { color: #5d5875; }
  .st { color: #5d5875; font-size: 11px; margin-top: 2px; }
  .cold .st { color: #2f5bd3; font-weight: 600; }
  ul { margin: 0; padding-left: 16px; }
  li { margin: 2px 0; }
  .note { white-space: pre-wrap; }
  footer { margin-top: 18px; font-size: 10px; color: #5d5875; border-top: 1px solid #e3e0ee; padding-top: 6px; }
</style></head><body>
<p class="eyebrow">Pursuit one-pager${sh.cold ? ` · ${e(sh.cold)} cold ${sh.cold === 1 ? 'seat' : 'seats'}` : ''}</p>
<h1>${e(sh.title)}</h1>
<table>${sh.facts.map(([k, v]) => `<tr><td>${e(k)}</td><td>${e(v)}</td></tr>`).join('')}</table>
<h2>Who decides</h2><div class="grid">${gov.map(seat).join('')}</div>
<h2>Industry</h2><div class="grid">${ind.map(seat).join('')}</div>
${sh.best.length ? `<h2>Warmest ways in</h2><ul>${sh.best.map(b => `<li><b>${e(b.name)}</b>: ${e(b.why)}</li>`).join('')}</ul>` : ''}
${sh.team.length ? `<h2>Through your team</h2><ul>${sh.team.map(t => `<li><b>${e(t.name)}</b>: ${e(t.detail)}</li>`).join('')}</ul>` : ''}
${sh.note ? `<h2>Notes</h2><p class="note">${e(sh.note)}</p>` : ''}
<footer>${e(sh.footer)}</footer>
</body></html>`;
}
const fileName = s => (String(s || 'pursuit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'pursuit');
export function openOnePager(id){
  const sh = pursuitSheet(id);
  if (!sh){ show('This pursuit was deleted.'); return; }
  const html = onePagerHTML(sh);
  let frame = null;
  openSheet({
    title: 'One-pager', right: ['Done'], full: true,
    mount(body){
      body.innerHTML = `<div class="card onepager"><iframe class="onepager-frame" title="${esc(`One-pager for ${sh.title}`)}" sandbox="allow-same-origin allow-modals"></iframe></div>
        <p class="lock-note">${icon('lock')}It has your own relationship notes. Share it only with your team.</p>
        <div class="card list actions">
          <button type="button" class="row act" data-a="share">${icon('share')}<span>Share one-pager</span></button>
          ${NATIVE ? '' : `<button type="button" class="row act" data-a="print">${icon('note')}<span>Print or save as PDF</span></button>`}
          <button type="button" class="row act" data-a="copyText">${icon('copy')}<span>Copy as text</span></button>
        </div>
        <p class="foot">${esc(NATIVE ? 'Share sends a web page. Open it in Chrome and choose Share, then Print, to save a PDF.' : 'Print opens your browser’s print dialog. Choose Save as PDF to keep a copy.')}</p>`;
      frame = $('.onepager-frame', body);
      frame.srcdoc = html;
    },
    handlers: {
      async share(){
        try { await shareFile(`${fileName(sh.title)}-one-pager.html`, html, {type: 'text/html', title: sh.title}); }
        catch (e) { if (!/cancel/i.test((e && e.message) || '')) show('Couldn’t share: ' + ((e && e.message) || e)); }
      },
      print(){ try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { show('Couldn’t open printing here. Use Share instead.'); } },
      async copyText(){ await copy(onePagerText(sh)); fx.success(); show('Copied'); },
    },
  });
}
function onePagerText(sh){
  const lines = [sh.title, '', ...sh.facts.map(([k, v]) => `${k}: ${v}`), ''];
  for (const s of sh.seats) lines.push(`${s.role}${s.owner ? ` (owner: ${s.owner})` : ''}: ${s.people.length ? s.people.map(p => p.name).join(', ') + '. ' : ''}${s.status}`);
  if (sh.best.length) lines.push('', 'Warmest ways in:', ...sh.best.map(b => `${b.name}: ${b.why}`));
  if (sh.note) lines.push('', 'Notes:', sh.note);
  lines.push('', sh.footer);
  return lines.join('\n');
}

/* ---------- call plan ---------- */
/** A short plan before talking to someone: goal, opener, two questions, next step, and the facts behind it. */
export function openCallPlan(k, pursuitId = null){
  const cp = callPlan(k, pursuitId);
  if (!cp){ show('This person isn’t in your network anymore.'); return; }
  const p = person(k);
  const ctx = [cp.seat ? `${cp.seat} seat` : '', cp.pursuit].filter(Boolean).join(' on ');
  const text = `Call plan: ${cp.name}${ctx ? ` (${ctx})` : ''}\n\n${cp.plan}`;
  openSheet({
    title: 'Call plan', left: ['Close'], full: true,
    mount(body){
      body.innerHTML = `<div class="card list">${p ? personRow(p) : ''}</div>
        ${ctx ? `<p class="foot">${esc(ctx)}</p>` : ''}
        <p class="sec-h">The plan</p>
        <div class="card pad cplan">${cp.plan.split('\n').map(l => { const i = l.indexOf(':'); return i > 0 && i < 14 ? `<p><b>${esc(l.slice(0, i))}</b>${esc(l.slice(i))}</p>` : `<p>${esc(l)}</p>`; }).join('')}</div>
        <p class="sec-h">What Northfix knows</p>
        <div class="card pad"><ul class="cplan-facts">${cp.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
        <div class="card list actions top12">
          <button type="button" class="row act" data-a="write">${icon('pencil')}<span>Write a message</span></button>
          <button type="button" class="row act" data-a="copyPlan">${icon('copy')}<span>Copy</span></button>
          <button type="button" class="row act" data-a="sharePlan">${icon('share')}<span>Share</span></button>
        </div>
        <p class="foot">Made on this phone from your own notes and history.</p>`;
    },
    handlers: {
      open(kk){ closeSheet(); openPerson(kk); },
      write(){ open('message', k); },
      async copyPlan(){ await copy(text); fx.success(); show('Copied'); },
      async sharePlan(){ const r = await shareText(text, `Call plan: ${cp.name}`); if (r === 'copied') show('Copied'); },
    },
  });
}
register('callPlan', openCallPlan);
register('pursuit', id => push('pursuit', id));
register('pipeline', () => push('pipeline'));

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
