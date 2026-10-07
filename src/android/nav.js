// Navigation: four tabs (Today, People, Companies, You), each with its own stack of
// pushed pages (Explore and Catch Up are pushed from Today), plus bottom sheets on top. Views are plain objects: {title, mount(el), update(el, what), handlers}.
import { $, $$, esc, icon, menu, closeMenu, REDUCED } from './ui.js';
import { fx, ls, statusBar } from './platform.js';

export const TABS = [['home', 'Today', 'sun'], ['people', 'People', 'people'], ['companies', 'Companies', 'building'], ['you', 'You', 'user']];
const roots = {};          // tab -> view
const routes = {};         // route kind -> (arg) => view
export const N = {tab: 'home', stacks: {home: [], people: [], companies: [], you: []}, sheets: []};

export const registerTab = (name, view) => { roots[name] = view; };
export const registerRoute = (kind, factory) => { routes[kind] = factory; };

/* ---------- action dispatch ---------- */
// data-a="name" on any element; the handler is looked up on the nearest ancestor with that handler.
function findHandler(t, name){ for (let el = t; el; el = el.parentElement){ if (el.__h && typeof el.__h[name] === 'function') return el.__h[name]; } return null; }
export function wire(el, handlers){ el.__h = handlers; }
document.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t || t.disabled) return;
  if (t.tagName === 'INPUT' && t.type !== 'button' && t.type !== 'checkbox') return;
  const h = findHandler(t, t.dataset.a); if (!h) return;
  e.preventDefault(); h(t.dataset.v, t, e);
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-ch]'); if (!t) return;
  const h = findHandler(t, t.dataset.ch); if (h) h(t.type === 'checkbox' ? t.checked : t.value, t, e);
});
// Enter in a field with data-enter="name" runs that handler (Save, Search)
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const t = e.target.closest && e.target.closest('[data-enter]'); if (!t) return;
  const h = findHandler(t, t.dataset.enter); if (h){ e.preventDefault(); h(t.value, t, e); }
});
document.addEventListener('input', e => {
  const t = e.target.closest('[data-in]'); if (!t) return;
  const h = findHandler(t, t.dataset.in); if (h) h(t.value, t, e);
});

/* ---------- tabs ---------- */
let shell = null;
export function mountShell(app){
  shell = app;
  app.innerHTML = `<div id="screens">${TABS.map(([t]) => `<section class="screen" data-tab="${t}" hidden></section>`).join('')}</div>
    <div id="pages"></div>
    <nav class="tabbar" aria-label="Main">${TABS.map(([t, label, ic]) => `<button type="button" class="tb" data-tab="${t}" aria-label="${label}">${icon(ic)}<span>${label}</span><b class="badge" hidden></b></button>`).join('')}</nav>
    <div id="sheets"></div>
    <div id="toast" role="status" aria-live="polite" hidden></div>`;
  $('.tabbar', app).addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab, {fromBar: true}); });
}
export function setBadge(tab, n){
  const b = $(`.tb[data-tab="${tab}"] .badge`, shell); if (!b) return;
  b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
}
const screenEl = t => $(`.screen[data-tab="${t}"]`, shell);
const dirty = new Set();
export function go(tab, {fromBar = false} = {}){
  closeMenu();
  if (!roots[tab]) tab = 'home';
  if (fromBar && tab === N.tab){
    // second tap: back to the top of the tab
    if (N.stacks[tab].length){ while (N.stacks[tab].length) popPage(true); }
    else { const s = screenEl(tab); s.scrollTo({top: 0, behavior: REDUCED() ? 'auto' : 'smooth'}); }
    return;
  }
  if (fromBar) fx.select();
  const prev = N.tab; N.tab = tab; ls.set('bearings.tab', tab);
  for (const [t] of TABS){ screenEl(t).hidden = t !== tab; $(`.tb[data-tab="${t}"]`, shell).classList.toggle('on', t === tab); }
  $$('#pages > .page', shell).forEach(p => { p.hidden = p.dataset.tab !== tab; });
  const s = screenEl(tab), v = roots[tab];
  if (!s.__mounted){ s.__mounted = true; wire(s, v.handlers || {}); v.mount(s); dirty.delete(tab); }
  else if (dirty.has(tab)){ dirty.delete(tab); v.update && v.update(s, 'all'); }
  v.onShow && v.onShow(s);
  syncStatusBar();
  if (prev !== tab && roots[prev] && roots[prev].onHide) roots[prev].onHide(screenEl(prev));
}

/** Light status bar text over a night-sky page (Explore), the theme's everywhere else. */
export function syncStatusBar(){
  const st = N.stacks[N.tab], top = st[st.length - 1];
  statusBar(document.documentElement.dataset.scheme === 'dark' || !!(top && top.el.classList.contains('night')) || !!document.querySelector('.onboard'));
}

/* ---------- pages ---------- */
export function push(kind, arg){
  closeMenu();
  const f = routes[kind]; if (!f) return;
  const v = f(arg);
  const el = document.createElement('div');
  el.className = 'page' + (v.pageCls ? ' ' + v.pageCls : ''); el.dataset.tab = N.tab;
  el.innerHTML = `<header class="bar"><button type="button" class="bar-back" aria-label="Back">${icon('chevL')}<span>Back</span></button><h2 class="bar-title"></h2><div class="bar-right"></div></header><div class="page-body"></div>`;
  $('.bar-back', el).addEventListener('click', () => popPage());
  $('#pages', shell).appendChild(el);
  const prevTop = N.stacks[N.tab][N.stacks[N.tab].length - 1];
  N.stacks[N.tab].push({v, el, kind});
  const body = $('.page-body', el);
  if (v.cls) body.classList.add(...v.cls.split(' '));
  wire(el, v.handlers || {});
  v.mount(body, el);
  setPageTitle(el, v.title);
  // a page can put a "More" button in its bar: menu() returns the items
  if (v.menu){ const r = $('.bar-right', el); r.insertAdjacentHTML('beforeend', `<button type="button" class="bar-act more" aria-label="More">${icon('more')}</button>`); r.lastElementChild.addEventListener('click', e => { const items = v.menu(); if (items && items.length) menu(e.currentTarget, items); }); }
  if (!REDUCED()){ el.classList.add('enter'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('enter'))); }
  if (prevTop) setTimeout(() => { if (!prevTop.el.hidden) prevTop.el.classList.add('under'); }, 300);
  syncStatusBar();
}
export function setPageTitle(el, t){ const h = $('.bar-title', el); if (h) h.textContent = t || ''; }
export function popPage(instant = false){
  const st = N.stacks[N.tab]; const top = st.pop(); if (!top) return false;
  top.v.destroy && top.v.destroy();
  const under = st[st.length - 1]; if (under){ under.el.classList.remove('under'); under.v.update && under.v.update($('.page-body', under.el), 'all'); }
  else { const s = screenEl(N.tab); roots[N.tab].update && roots[N.tab].update(s, 'all'); }
  if (instant || REDUCED()) top.el.remove();
  else { top.el.classList.add('leave'); setTimeout(() => top.el.remove(), 260); }
  syncStatusBar();
  return true;
}
export function resetStack(tab){ const st = N.stacks[tab]; while (st.length){ const t = st.pop(); t.v.destroy && t.v.destroy(); t.el.remove(); } }

/* ---------- sheets ---------- */
// def: {title, left: [label, fn], right: [label, fn], full, mount(el, sheet), update, handlers, destroy, cls}
export function openSheet(def){
  closeMenu();
  const el = document.createElement('div');
  el.className = 'sheet-layer' + (def.cls ? ' ' + def.cls : '');
  el.innerHTML = `<div class="scrim"></div><div class="sheet ${def.full ? 'full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(def.title || '')}">
    <div class="grab"><i></i></div>
    ${def.bare ? '' : `<header class="sheet-bar"><div class="sb-l">${def.left ? `<button type="button" class="link" data-sb="l">${esc(def.left[0])}</button>` : ''}</div><h2>${esc(def.title || '')}</h2><div class="sb-r">${def.right ? `<button type="button" class="link strong" data-sb="r">${esc(def.right[0])}</button>` : ''}</div></header>`}
    <div class="sheet-body"></div></div>`;
  $('#sheets', shell).appendChild(el);
  const sheet = {def, el, body: $('.sheet-body', el), close: () => closeSheet(sheet)};
  N.sheets.push(sheet);
  wire(el, def.handlers || {});
  $('.scrim', el).addEventListener('click', () => sheet.close());
  el.addEventListener('click', e => { const b = e.target.closest('[data-sb]'); if (!b) return; const s = b.dataset.sb === 'l' ? def.left : def.right; if (s && s[1]) s[1](sheet); else sheet.close(); });
  dragToClose(sheet);
  def.mount(sheet.body, sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  return sheet;
}
export function setSheetButton(sheet, side, label){ const b = $(`[data-sb="${side}"]`, sheet.el); if (b) b.textContent = label; }
export function closeSheet(sheet){
  sheet = sheet || N.sheets[N.sheets.length - 1]; if (!sheet) return false;
  const i = N.sheets.indexOf(sheet); if (i < 0) return false;
  N.sheets.splice(i, 1);
  sheet.def.destroy && sheet.def.destroy();
  sheet.el.classList.remove('in'); sheet.el.classList.add('out');
  setTimeout(() => sheet.el.remove(), REDUCED() ? 0 : 280);
  sheet.def.onClose && sheet.def.onClose();
  return true;
}
function dragToClose(sheet){
  const s = $('.sheet', sheet.el), grab = $('.grab', sheet.el), bar = $('.sheet-bar', sheet.el);
  let y0 = null, dy = 0, t0 = 0;
  const start = e => { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; t0 = performance.now(); s.style.transition = 'none'; e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); s.style.transform = `translateY(${dy}px)`; };
  const end = () => { if (y0 == null) return; y0 = null; s.style.transition = ''; const v = dy / Math.max(1, performance.now() - t0); if (dy > 120 || v > 0.8) sheet.close(); s.style.transform = ''; };
  for (const h of [grab, bar].filter(Boolean)){ h.addEventListener('pointerdown', start); h.addEventListener('pointermove', move); h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end); }
}

/* ---------- refresh whatever is on screen ---------- */
export function refreshVisible(what){
  for (const [t] of TABS) if (t !== N.tab && screenEl(t).__mounted) dirty.add(t);
  const st = N.stacks[N.tab], top = st[st.length - 1];
  if (top){ top.v.update && top.v.update($('.page-body', top.el), what); setPageTitle(top.el, top.v.title); dirty.add(N.tab); }
  else { const s = screenEl(N.tab); if (s.__mounted) roots[N.tab].update && roots[N.tab].update(s, what); }
  for (const sh of N.sheets) sh.def.update && sh.def.update(sh.body, what, sh);
}
/** Android back: sheet, then page, then nothing (the app goes to the background). */
export function back(){
  if (document.querySelector('.menu-layer')){ closeMenu(); return true; }
  const dlg = document.querySelector('.dialog-layer [data-x]'); if (dlg){ dlg.click(); return true; }
  const lay = document.querySelector('.onboard'); if (lay && lay.__back){ lay.__back(); return true; }
  if (N.sheets.length){ closeSheet(); return true; }
  if (N.stacks[N.tab].length){ popPage(); return true; }
  if (N.tab !== 'home'){ go('home'); return true; }
  return false;
}

let toastT = 0;
export function toast(msg){
  const t = $('#toast', shell); if (!t) return;
  t.textContent = msg; t.hidden = false; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }, 3000);
}
