// The org chart (apple/Bearings/OrgChart.swift): everyone you and your team know at a
// company or agency, by level from the top down, with the seats nobody covers called out.
// LinkedIn doesn't share reporting lines, so those come from you: press and hold a card
// and drop it on their manager, or use "Reports to…" in the card's menu.
import { M, person, orgChart, setReportsTo } from './model.js';
import { esc, fmt, icon, avatar, bandVar, menu, empty, $, $$ } from './ui.js';
import { registerRoute, openSheet, closeSheet } from './nav.js';
import { openPerson, open } from './actions.js';
import { fx } from './platform.js';

const SHORT = {'C-suite / Owner': 'Executives', 'VP': 'Vice presidents', 'Director / Head': 'Directors and heads', 'Manager / Lead': 'Managers and leads', 'Individual contributor': 'Individual contributors'};
const initialsOf = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();

function card(c, chart){
  const p = c.k ? person(c.k) : null;
  const boss = c.rt ? person(c.rt) : null;
  const reports = chart.links.filter(l => l.to === c.k).length;
  const foot = c.src === 'team' && c.owner ? `<span class="oc-foot info">Through ${esc(c.owner)}</span>`
    : boss ? `<span class="oc-foot violet">Reports to ${esc(boss.f)}</span>`
    : reports ? `<span class="oc-foot violet">${reports} report${reports === 1 ? '' : 's'}</span>` : '';
  const face = `<span class="ocard-top">${p ? avatar(p, 40, {star: false}) : `<span class="team-av">${esc(initialsOf(c.name))}</span>`}<i class="dot" style="background:${bandVar(c.band)}" aria-hidden="true"></i></span>
    <b>${esc(c.name)}</b><span class="oc-p">${esc(c.p || c.func)}</span>${foot}`;
  if (!c.k) return `<div class="ocard team" role="group" aria-label="${esc(c.name)}, through your team"><div class="ocard-main">${face}</div></div>`;
  return `<div class="card ocard" data-k="${esc(c.k)}"><button type="button" class="ocard-main" data-a="open" data-v="${esc(c.k)}" aria-label="${esc(c.name)}${c.p ? ', ' + esc(c.p) : ''}">${face}</button>
    <button type="button" class="oc-more" data-a="cardMenu" data-v="${esc(c.k)}" aria-label="Set ${esc(c.name)}’s manager">${icon('more')}</button></div>`;
}
function level(id, people, chart){
  const head = `<div class="olevel-h"><span class="eyebrow">${esc(SHORT[id] || id)}</span>${people.length ? `<span class="mono">${fmt(people.length)}</span>` : ''}</div>`;
  if (!people.length) return `<section class="olevel">${head}<div class="oempty">${icon('personDashed')}<div class="grow"><b>No one here yet</b><p>A gap worth filling. Ways in shows who could introduce you.</p></div><button type="button" class="pill-btn soft" data-a="ways">Ways in</button></div></section>`;
  return `<section class="olevel">${head}<div class="orow">${people.map(c => card(c, chart)).join('')}</div></section>`;
}

/* ---------- "Reports to…" ---------- */
function pickManager(k, chart){
  const me = person(k); if (!me) return;
  let q = '';
  const here = chart.levels.flatMap(l => l.people).filter(c => c.k && c.k !== k).map(c => person(c.k)).filter(Boolean);
  const render = body => {
    const t = q.trim().toLowerCase();
    let list = here;
    if (t) list = M.people.filter(p => p.k !== k && !p.x && (`${p.full} ${p.c}`).toLowerCase().includes(t)).slice(0, 40);
    const cur = me.ed && me.ed.rt;
    $('.mgr-list', body).innerHTML = `<p class="sec-h">${t ? 'Matches' : `At ${esc(chart.company)}`}</p>
      ${list.length ? `<div class="card list">${list.map(p => `<button type="button" class="row prow" data-a="pick" data-v="${esc(p.k)}">${avatar(p, 40, {star: false})}<span class="prow-main"><b class="prow-name">${esc(p.full)}</b><span class="prow-detail">${esc([p.p, p.c].filter(Boolean).join(' · '))}</span></span>${cur === p.k ? `<span class="good">${icon('check')}</span>` : ''}</button>`).join('')}</div>` : '<p class="muted pad">No one matches. Try another name.</p>'}
      ${cur ? `<div class="card list"><button type="button" class="row act" data-a="clear">${icon('x')}<span class="bad">Clear manager</span></button></div>` : ''}`;
  };
  openSheet({
    title: `${me.f} reports to`, left: ['Cancel'], full: true,
    mount(body){ body.innerHTML = `<label class="searchbox">${icon('search')}<input type="search" data-in="q" placeholder="Search everyone" autocomplete="off"></label><div class="mgr-list"></div>`; render(body); },
    handlers: {
      q(v, t){ q = v; render(t.closest('.sheet-body')); },
      async pick(boss){ closeSheet(); await setReportsTo(k, boss); },
      async clear(){ closeSheet(); await setReportsTo(k, ''); },
    },
  });
}

/* ---------- press, hold and drop onto a manager ---------- */
function dragToManager(body, chartOf){
  let timer = 0, drag = null, x0 = 0, y0 = 0, suppress = false;
  const cardAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('.ocard[data-k]'); };
  const end = async (drop) => {
    clearTimeout(timer); timer = 0;
    if (!drag) return;
    const {k, el, ghost} = drag; drag = null;
    ghost.remove(); el.classList.remove('dragging');
    $$('.ocard.drop', body).forEach(c => c.classList.remove('drop'));
    suppress = true; setTimeout(() => { suppress = false; }, 400);
    if (drop && drop.dataset.k !== k) await setReportsTo(k, drop.dataset.k);
    else if (!drop) cardMenu(k, $('.oc-more', el), chartOf());
  };
  body.addEventListener('touchstart', e => {
    const el = e.target.closest('.ocard[data-k]'); if (!el || e.touches.length > 1 || e.target.closest('.oc-more')) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    timer = setTimeout(() => {
      timer = 0; fx.star();
      const ghost = document.createElement('div'); ghost.className = 'drag-ghost'; ghost.textContent = $('b', el).textContent;
      ghost.style.left = x0 + 'px'; ghost.style.top = y0 + 'px'; document.body.appendChild(ghost);
      el.classList.add('dragging');
      drag = {k: el.dataset.k, el, ghost};
    }, 420);
  }, {passive: true});
  body.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (timer && Math.hypot(t.clientX - x0, t.clientY - y0) > 8){ clearTimeout(timer); timer = 0; }
    if (!drag) return;
    e.preventDefault();
    drag.ghost.style.left = t.clientX + 'px'; drag.ghost.style.top = t.clientY + 'px';
    const over = cardAt(t.clientX, t.clientY);
    $$('.ocard.drop', body).forEach(c => { if (c !== over) c.classList.remove('drop'); });
    if (over && over !== drag.el) over.classList.add('drop');
  }, {passive: false});
  body.addEventListener('touchend', e => { const t = e.changedTouches[0]; const over = drag && cardAt(t.clientX, t.clientY); end(over && over !== drag.el ? over : null); });
  body.addEventListener('touchcancel', () => { if (drag){ drag.ghost.remove(); drag.el.classList.remove('dragging'); drag = null; } clearTimeout(timer); timer = 0; });
  body.addEventListener('contextmenu', e => { if (e.target.closest('.ocard')) e.preventDefault(); });
  // the click that follows a drop shouldn't also open the profile
  body.addEventListener('click', e => { if (suppress && e.target.closest('.ocard')){ e.stopPropagation(); e.preventDefault(); } }, true);
}
function cardMenu(k, anchor, chart){
  const p = person(k); if (!p) return;
  const boss = p.ed && p.ed.rt && person(p.ed.rt);
  menu(anchor, [
    {label: boss ? `Reports to ${boss.full}` : 'Reports to…', icon: 'upRight', run: () => pickManager(k, chart)},
    ...(boss ? [{label: 'Clear manager', icon: 'x', danger: true, run: () => setReportsTo(k, '')}] : []),
    'sep',
    {label: `Open ${p.f}’s profile`, icon: 'user', run: () => openPerson(k)},
  ]);
}

registerRoute('org', name => {
  let chart = null, wired = false;
  const view = {
    title: 'Org chart',
    menu: () => [{label: 'Find a way in', icon: 'waysIn', run: () => open('intro', (chart && chart.company) || name)}],
    mount(body){ this.render(body); },
    update(body){ this.render(body); },
    render(body){
      chart = orgChart(name);
      const sc = body.scrollTop, rows = [...body.querySelectorAll('.orow')].map(r => r.scrollLeft);
      if (!chart || !chart.company){ body.innerHTML = empty('org', 'No one here yet', 'No one in your network works there. Try a shorter name.'); return; }
      const all = chart.levels.flatMap(l => l.people), team = all.filter(c => c.src === 'team').length;
      const levels = (chart.allLevels || chart.levels.map(l => l.id)).map(id => level(id, (chart.levels.find(l => l.id === id) || {}).people || [], chart)).join('');
      body.innerHTML = `<div class="org">
        <header class="org-head"><h1>${esc(chart.company)}</h1><p>${esc(`${fmt((chart.total || 0) - team)} you know${team ? ` · ${fmt(team)} through your team` : ''}`)}</p>
          ${chart.gaps.length ? `<div class="gapchips">${chart.gaps.map(g => `<span class="gapchip">${icon('alert')}No one senior in ${esc(g)}</span>`).join('')}</div>` : ''}</header>
        ${levels}
        <p class="org-foot">LinkedIn doesn’t share who reports to whom. Press and hold a card and drop it on their manager, or use the menu on a card. Only you see this.</p></div>`;
      body.scrollTop = sc;
      body.querySelectorAll('.orow').forEach((r, i) => { if (rows[i]) r.scrollLeft = rows[i]; });
      if (!wired){ wired = true; dragToManager(body, () => chart); }
    },
    handlers: {
      open: k => openPerson(k),
      ways: () => open('intro', (chart && chart.company) || name),
      cardMenu: (k, t) => cardMenu(k, t, chart),
    },
  };
  return view;
});
