// A person's dossier: header with relationship ring, actions, a plain brief, the
// relationship, a timeline, follow-up, location, details, and notes. Ports
// ProfileView.swift, Timeline.swift and Brief.swift (the template brief; no AI here).
import { M, full, memory, isSample, toggleStar, followUp, setCircle, touched, markReplied, setLocation, saveProfile, CIRCLES } from './model.js';
import { esc, fmt, icon, avatar, flag, bandLabel, bandVar, Day, menu, $, empty } from './ui.js';
import { registerRoute, setPageTitle, push } from './nav.js';
import { openUnit, open } from './actions.js';
import { openURL, copy, fx, prefs } from './platform.js';
import { show } from './model.js';
import { enrichSection, enrichHandlers } from './enrich.js';

/* ---------- the brief, from facts already in the app ---------- */
export function briefText(p){
  let a = '';
  const x = p.rx;
  if (x && x.t){ a = x.dir === 'i' ? `${p.f} wrote you ${Day.ago(x.t)}` : `You last wrote ${Day.ago(x.t)}`; if (x.m > 1) a += `, ${x.m} messages in all`; a += '.'; }
  else a = `You haven’t messaged ${p.f} yet; connected ${Day.nice(p.d)}.`;
  const c = p.ed && CIRCLES[p.ed.circle], due = p.ed && p.ed.due;
  let b = '';
  if (p.waiting) b = 'They’re waiting on your reply.';
  else if (p.moved) b = `New role${p.c ? ` at ${p.c}` : ''}: a natural moment to say congratulations.`;
  else if (p.over && c) b = `Overdue for your ${c.title.toLowerCase()}. A quick hello keeps it warm.`;
  else if (p.cooling) b = 'You used to talk often; worth a check-in before it goes cold.';
  else if (due) b = `You planned to follow up ${due <= Day.today() ? 'now' : `on ${Day.nice(due)}`}.`;
  return [a, b].filter(Boolean).join(' ');
}

/* ---------- timeline ---------- */
export function timelineEvents(p){
  const out = [], ed = p.ed || {}, c = CIRCLES[ed.circle];
  if (ed.due) out.push({id: 'due', date: ed.due, icon: 'bellFill', color: 'var(--violet)', title: ed.due <= Day.today() ? 'Follow-up due' : 'Follow-up planned'});
  if (c && p.next) out.push({id: 'next', date: p.next, icon: c.icon, color: 'var(--violet)', title: p.over ? 'Overdue to reach out' : 'Next check-in', detail: `${c.title}, ${c.cadence.toLowerCase()}`});
  if (ed.touched) out.push({id: 'touched', date: ed.touched, icon: 'touch', color: 'var(--good)', title: 'You were in touch'});
  // notes written as "2026-10-02 (meeting): text", one per line
  (ed.note || '').split('\n').forEach((line, i) => {
    if (line.length <= 12) return;
    const colon = line.indexOf(':'), date = line.slice(0, 10);
    if (colon < 10 || !Day.valid(date)) return;
    const source = line.slice(10, colon).trim().replace(/^\(|\)$/g, '');
    out.push({id: 'note' + i, date, icon: 'note', color: 'var(--violet)', title: source ? `Note from ${source}` : 'Note', detail: line.slice(colon + 1).trim()});
  });
  const x = p.rx;
  if (x){
    if (x.t) out.push({id: 'last', date: x.t, icon: x.dir === 'i' ? 'arrowIn' : 'arrowOut', color: x.dir === 'i' ? 'var(--amber)' : 'var(--good)', title: x.dir === 'i' ? `${p.f} wrote you` : `You wrote ${p.f}`, detail: x.s ? `“${x.s}”` : ''});
    if (x.f && x.f !== x.t && x.m > 1) out.push({id: 'first', date: x.f, icon: 'bubbles', color: 'var(--info)', title: 'First message', detail: `${fmt(x.m)} messages since`});
    if (x.invd) out.push({id: 'inv', date: x.invd, icon: 'mail', color: 'var(--accent)', title: x.inv === 'o' ? `You invited ${p.f} to connect` : `${p.f} invited you to connect`, detail: x.invn ? `“${x.invn}”` : ''});
  }
  if (p.jc) out.push({id: 'jc', date: p.jc, icon: 'briefcase', color: 'var(--info)', title: 'Started a new role', detail: [p.p, p.c].filter(Boolean).join(' at ')});
  (p.pv || []).forEach((r, i) => { if (r.until) out.push({id: 'pv' + i, date: r.until, icon: 'uturn', color: 'var(--text2)', title: `Left ${r.c || 'a role'}`, detail: r.p || ''}); });
  if (p.d) out.push({id: 'conn', date: p.d, icon: 'link', color: 'var(--accent)', title: 'Connected on LinkedIn'});
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
function timeline(p){
  const ev = timelineEvents(p); if (!ev.length) return '';
  return `<section class="card tl"><div class="card-head static"><h2>Timeline</h2></div>${ev.map(e => `<div class="tl-row">
    <span class="tl-ic" style="--tc:${e.color}">${icon(e.icon)}</span>
    <span class="tl-body"><b>${esc(e.title)}</b>${e.detail ? `<span>${esc(e.detail)}</span>` : ''}</span><span class="tl-date">${esc(Day.nice(e.date))}</span></div>`).join('')}</section>`;
}

/* ---------- what to remember ---------- */
function memoryCard(k){
  const m = memory(k);
  if (!m || !(m.last || (m.msg && m.msg.text))) return '';
  const src = m.last && m.last.source;
  return `<section class="card memory"><div class="mem-top">${icon('memory')}<span class="eyebrow">What to remember</span>${src ? `<span class="mem-src">${esc(src)}</span>` : ''}</div><p>${esc(m.line)}</p></section>`;
}

/* ---------- pieces ---------- */
function relSummary(x){
  const parts = [];
  if (x.m > 0) parts.push(`${fmt(x.m)} ${x.m === 1 ? 'message' : 'messages'} since ${Day.nice(x.f)}`);
  if (x.eg > 0 || x.er > 0) parts.push(x.eg > 0 && x.er > 0 ? 'you endorsed each other' : x.eg > 0 ? 'you endorsed them' : 'they endorsed you');
  if (x.rg > 0 || x.rr > 0) parts.push(x.rg > 0 && x.rr > 0 ? 'you recommended each other' : x.rg > 0 ? 'you wrote them a recommendation' : 'they wrote you a recommendation');
  if (x.inv) parts.push(x.inv === 'o' ? `you invited them${x.invd ? ` on ${Day.nice(x.invd)}` : ''}` : 'they invited you');
  if (!parts.length) return '';
  const s = parts.join(', '); return s[0].toUpperCase() + s.slice(1) + '.';
}
function tags(p){
  const out = [], c = p.ed && CIRCLES[p.ed.circle], cl = p.cl;
  if (cl.ind && cl.ind !== 'Unclassified') out.push(`<span class="tag"><i class="dot" style="background:${esc(p.indColor)}"></i>${esc(cl.ind)}</span>`);
  if (M.info.hasRel && p.rx) out.push(`<span class="tag" style="--fc:${bandVar(p.band)}">${esc(bandLabel(p.band))} · <span class="mono">${p.score}</span></span>`);
  if (c) out.push(`<span class="tag">${icon(c.icon)}${esc(c.title)}</span>`);
  const fl = [];
  if (p.waiting) fl.push(['Waiting on your reply', 'var(--amber)']);
  if (p.moved) fl.push(['New job', 'var(--info)']);
  if (p.isNew) fl.push(['New connection', 'var(--good)']);
  if (p.due) fl.push(['Follow-up due', 'var(--violet)']);
  if (p.over && c) fl.push(['Overdue', 'var(--violet)']);
  return out.join('') + fl.slice(0, 3).map(([t, col]) => flag(t, col)).join('');
}
const sqAction = (a, title, ic, tint, on = false) => `<button type="button" class="sqact ${on ? 'on' : ''}" style="--rt:${tint}" data-a="${a}" aria-label="${esc(title)}">${icon(ic)}<span>${esc(title)}</span></button>`;
const PLACE_SRC = {you: 'Set by you', company: 'From the location you set for their company', address: 'From their address in your contacts', phone: 'From their phone number in your contacts', sample: 'Sample data'};
const labeled = (k, v) => v ? `<div class="lrow"><span class="muted">${esc(k)}</span><span>${v}</span></div>` : '';

/* ---------- the page ---------- */
function personView(k, part){
  const st = {k, loadedFor: '', note: '', tags: '', ind: '', forCo: true, seg: '', branch: '', status: '', grade: '', rank: '', placeEdit: false, placeQ: ''};
  const fill = p => {
    if (st.loadedFor === p.k) return; st.loadedFor = p.k;
    const ed = p.ed || {};
    Object.assign(st, {note: ed.note || '', tags: (ed.tags || []).join(', '), ind: ed.ind || '', forCo: !ed.ind, seg: ed.seg || '', branch: ed.branch || '', status: ed.status || '', grade: ed.grade || '', rank: ed.rank || ''});
  };
  const view = {
    title: '',
    menu: () => [
      {label: 'Add meeting notes', icon: 'notePlus', run: () => open('notes', k)},
      {label: 'Write a message', icon: 'pencil', run: () => open('message', k)},
      ...(part === 'main' ? [{label: 'Details, location and notes', icon: 'text', run: () => push('personDetails', k)}] : []),
    ],
    mount(body){ this.render(body); },
    update(body){ this.render(body); },
    render(body){
      const p = full(k);
      if (!p){ body.innerHTML = empty('user', 'Not found', 'This person isn’t in your network anymore.'); return; }
      fill(p);
      this.title = part === 'main' ? p.f : `About ${p.f}`;
      const pg = body.closest('.page'); if (pg) setPageTitle(pg, this.title);
      const L = M.info.lens, cl = p.cl, x = p.rx, ed = p.ed || {}, c = CIRCLES[ed.circle];
      const profile = (p.links && p.links.profile) || '';
      const pl = M.places[p.k];
      const industries = (M.constants.industries || []).filter(i => i.id !== M.constants.unclassified);
      const sel = (name, value, opts, auto = 'Automatic') => `<div class="select"><select data-ch="field" data-f="${name}" aria-label="${name}"><option value="">${esc(auto)}</option>${opts.map(o => `<option value="${esc(o[0])}" ${value === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>${icon('chevD')}</div>`;
      const st0 = body.closest('.page-body') ? body.scrollTop : 0;
      const header = `<section class="card prof-head">
          ${avatar(p, 76)}
          <h1>${esc(p.full)}</h1>
          ${p.p ? `<p class="prof-title">${esc(p.p)}</p>` : ''}
          ${p.c ? `<button type="button" class="prof-co" data-a="unit" data-v="${esc(p.c)}">${esc(p.c)}${icon('chevR')}</button>` : ''}
          <div class="tags">${tags(p)}</div>
          <div class="sqactions">
            <button type="button" class="sqact primary" data-a="message">${icon('pencil')}<span>Message</span></button>
            ${sqAction('star', p.starred ? 'Starred' : 'Star', p.starred ? 'starFill' : 'star', 'var(--amber)', p.starred)}
            ${sqAction('remind', 'Remind', ed.due ? 'bellFill' : 'bell', 'var(--violet)', !!ed.due)}
            ${sqAction('circle', !c ? 'Circle' : p.over ? 'Overdue' : 'In touch', c ? c.icon : 'circleWide', p.over ? 'var(--violet)' : 'var(--good)', !!c)}
          </div>
        </section>`;
      const brief = `<section class="card brief"><p class="label">Brief</p><p>${esc(briefText(p))}</p>
          ${p.waiting ? `<button type="button" class="pill-btn soft" data-a="replied">${icon('reply')}I replied</button>` : ''}
          ${ed.due ? `<div class="due-line"><span>${ed.due <= Day.today() ? '<b class="violet">Follow up now.</b> ' : ''}You planned to follow up on ${esc(Day.nice(ed.due))}.</span><button type="button" class="pill-btn soft" data-a="dueDone">Done</button></div>` : ''}</section>`;
      if (part === 'main'){
        body.innerHTML = `<div class="prof">${header}${memoryCard(k)}${brief}${timeline(p)}
          <section class="card list"><button type="button" class="row act more-row" data-a="details">${icon('text')}<span>Details, location and notes</span>${icon('chevR', 'chev')}</button></section>
          ${isSample() ? '<p class="foot">Sample data: changes aren’t saved.</p>' : ''}</div>`;
        body.scrollTop = st0;
        return;
      }
      body.innerHTML = `<div class="prof">
        ${M.info.hasRel ? `<p class="sec-h">Relationship</p><div class="card pad">${x ? `
          ${x.t ? `<p><b>${esc(x.dir === 'i' ? `${p.f} wrote you ${Day.ago(x.t)}` : `You wrote ${Day.ago(x.t)}`)}</b></p>${x.s ? `<p class="muted quote">“${esc(x.s)}”</p>` : ''}` : ''}
          ${relSummary(x) ? `<p class="muted small">${esc(relSummary(x))}</p>` : ''}
          ${x.invn ? `<p class="muted small">Invite note: “${esc(x.invn)}”</p>` : ''}
          ${p.waiting ? `<button type="button" class="btn tint-bad" data-a="replied">${icon('reply')}Waiting on your reply. I replied</button>` : ''}`
          : `<p class="muted">You haven’t messaged ${esc(p.f)} on LinkedIn. A short hello is an easy start.</p>`}</div>` : ''}

        <p class="sec-h">Location</p><div class="card pad">${st.placeEdit ? `
            <input type="text" class="field" data-in="placeQ" data-enter="savePlace" value="${esc(st.placeQ)}" placeholder="City, like Tampa, FL or London" autocomplete="off" enterkeyhint="done">
            <div class="btn-row left"><button type="button" class="btn prominent small" data-a="savePlace">Save</button><button type="button" class="btn small" data-a="cancelPlace">Cancel</button></div>`
          : pl ? `<p><b>${esc(pl.name)}${pl.prec && pl.prec !== 'city' ? ' (roughly)' : ''}</b><br><span class="muted small">${esc(PLACE_SRC[pl.src] || '')}</span></p>
            <div class="btn-row left"><button type="button" class="link" data-a="editPlace">${pl.src === 'you' ? 'Change location' : 'Not right? Set it'}</button>${pl.src === 'you' ? '<button type="button" class="link danger" data-a="clearPlace">Clear location</button>' : ''}</div>`
          : `<p class="muted">Not known yet. LinkedIn doesn’t share locations.</p><button type="button" class="link" data-a="editPlace">Set location</button>`}</div>

        <p class="sec-h">Contact and ways in</p><div class="card list actions">
          ${profile ? `<button type="button" class="row act" data-a="linkedin" data-v="${esc(profile)}">${icon('link')}<span>Open LinkedIn profile</span></button>` : ''}
          ${prefs.salesnav && p.links && p.links.salesNav ? `<button type="button" class="row act" data-a="url" data-v="${esc(p.links.salesNav)}">${icon('globe')}<span>Sales Navigator</span></button>` : ''}
          ${p.e ? `<button type="button" class="row act" data-a="copyEmail">${icon('copy')}<span>Copy email</span></button>` : ''}
          ${p.c ? `<button type="button" class="row act" data-a="unit" data-v="${esc(p.c)}">${icon('building')}<span>More at ${esc(p.c)}</span>${icon('chevR', 'chev')}</button>
                   <button type="button" class="row act" data-a="ways" data-v="${esc(p.c)}">${icon('waysIn')}<span>Other ways into ${esc(p.c)}</span></button>` : ''}
          <button type="button" class="row act" data-a="message">${icon('pencil')}<span>Write a message</span></button>
        </div>
        ${enrichSection(p)}
        <p class="sec-h">Details</p><div class="card list details">
          ${labeled('Industry', `<i class="dot sm" style="background:${esc(p.indColor)}"></i>${esc(cl.ind + (cl.indHow === 'you' ? ' (set by you)' : cl.indHow === 'guess' ? ' (best guess)' : ''))}`)}
          ${labeled('Seniority', esc(cl.sen))}
          ${labeled('Role', esc(cl.func))}
          ${L && cl.seg !== 'Other Commercial' ? labeled('Segment', esc(cl.seg)) : ''}
          ${L && (cl.branch || cl.status) ? labeled('Service', esc([cl.branch, cl.status].filter(Boolean).join(', '))) : !L && cl.status === 'Veteran / Retired' ? labeled('Service', esc([cl.branch, 'Veteran'].filter(Boolean).join(' '))) : ''}
          ${L && cl.grade ? labeled('Rank', esc(((cl.rank && cl.rank !== cl.grade) ? cl.rank + ' ' : '') + cl.grade)) : ''}
          ${L && cl.agency ? labeled('Agency or command', esc(cl.agency)) : ''}
          ${cl.certs.length || (L && cl.clr) ? labeled('Certifications', esc((cl.certs.length ? cl.certs.join(', ') : 'None listed') + (L && cl.clr ? ', clearance mentioned' : ''))) : ''}
          ${labeled('Connected', esc(Day.nice(p.d)))}
          ${p.x ? labeled('Status', esc(`Not in your export since ${Day.nice(p.x)}`)) : ''}
          ${p.e ? labeled('Email', `<span class="sel">${esc(p.e)}</span>`) : ''}
        </div>

        <p class="sec-h">Notes and corrections</p><div class="card form">
          <textarea class="field" rows="4" data-in="note" placeholder="How you know them, last conversation, next step">${esc(st.note)}</textarea>
          <input type="text" class="field" data-in="tags" value="${esc(st.tags)}" placeholder="Tags, separated by commas" autocapitalize="none">
          <label class="frow"><span>Industry</span>${sel('ind', st.ind, industries.map(i => [i.id, i.id]), `Automatic: ${cl.ind}`)}</label>
          ${p.c ? `<label class="toggle-row"><span>Use this for everyone at ${esc(p.c)}</span><input type="checkbox" class="switch" data-ch="forCo" ${st.forCo ? 'checked' : ''}></label>` : ''}
          ${L ? `<label class="frow"><span>Segment</span>${sel('seg', st.seg, (M.constants.segs || []).map(s => [s.id, s.id]))}</label>
            <label class="frow"><span>Branch</span>${sel('branch', st.branch, (M.constants.branches || []).map(b => [b, b]).concat([['__none', 'None']]))}</label>
            <label class="frow"><span>Status</span>${sel('status', st.status, (M.constants.statuses || []).map(b => [b, b]).concat([['__none', 'None']]))}</label>
            <label class="frow"><span>Grade</span>${sel('grade', st.grade, (M.constants.grades || []).map(b => [b, b]).concat([['__none', 'None']]))}</label>
            <input type="text" class="field" data-in="rank" value="${esc(st.rank)}" placeholder="Rank title, like Colonel, USMC (Ret.)">` : ''}
          <button type="button" class="btn prominent block" data-a="save">Save</button>
          ${isSample() ? '<p class="foot">Sample data: changes aren’t saved.</p>' : ''}
        </div>
      </div>`;
      body.scrollTop = st0;
    },
    handlers: {
      ...enrichHandlers(k),
      unit: v => openUnit(v),
      details: () => push('personDetails', k),
      ways: v => open('intro', v),
      message: () => open('message', k),
      star: () => toggleStar(k),
      remind(_, t){
        const p = full(k), due = p && p.ed && p.ed.due;
        menu(t, [[7, 'In a week'], [14, 'In 2 weeks'], [30, 'In a month'], [90, 'In 3 months']].map(([d, l]) => ({label: l, run: () => followUp(k, d)})).concat(due ? ['sep', {label: 'Clear reminder', danger: true, run: () => followUp(k, 0)}] : []));
      },
      circle(_, t){
        const p = full(k), cur = p && p.ed && p.ed.circle;
        menu(t, [{header: 'Keep in touch'}, ...Object.entries(CIRCLES).map(([id, c]) => ({label: `${c.title} · ${c.cadence.toLowerCase()}`, on: cur === id, icon: c.icon, run: () => setCircle(k, id)})),
          ...(cur ? [{label: 'Remove from circle', danger: true, run: () => setCircle(k, '')}] : []), 'sep',
          {label: 'I was in touch today', icon: 'touch', run: () => touched(k)}]);
      },
      linkedin: v => { fx.tap(); openURL(v); },
      url: v => openURL(v),
      replied: () => markReplied(k),
      dueDone: () => followUp(k, 0),
      async copyEmail(){ const p = full(k); if (p && await copy(p.e)) show('Email copied'); },
      editPlace(_, t){ const pl = M.places[k]; st.placeEdit = true; st.placeQ = pl && pl.src === 'you' ? pl.name : ''; view.render(t.closest('.page-body')); const i = t.ownerDocument.querySelector('.page:last-child input[data-in="placeQ"]'); if (i) i.focus(); },
      cancelPlace(_, t){ st.placeEdit = false; view.render(t.closest('.page-body')); },
      async savePlace(_, t){ const body = t.closest('.page-body'); if (await setLocation(k, st.placeQ)){ st.placeEdit = false; view.render(body); } },
      clearPlace: () => setLocation(k, ''),
      placeQ: v => { st.placeQ = v; },
      note: v => { st.note = v; }, tags: v => { st.tags = v; }, rank: v => { st.rank = v; },
      field(v, t){ st[t.dataset.f] = v; },
      forCo(v){ st.forCo = !!v; },
      save(){
        const p = full(k); if (!p) return;
        const tags = st.tags.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
        const patch = {note: st.note.slice(0, 4000), tags, rank: st.rank.trim().slice(0, 80)};
        if (M.info.lens) Object.assign(patch, {seg: st.seg, branch: st.branch, status: st.status, grade: st.grade});
        let co = null;
        if (st.forCo && p.c) co = {company: p.c, ind: st.ind}; else patch.ind = st.ind;
        if (document.activeElement) document.activeElement.blur();
        st.loadedFor = '';
        saveProfile(k, patch, co);
      },
    },
  };
  return view;
}
registerRoute('person', k => personView(k, 'main'));
registerRoute('personDetails', k => personView(k, 'details'));
