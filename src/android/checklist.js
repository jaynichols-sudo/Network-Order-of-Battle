// "Set up Northfix": a checklist card on Today that gets people to the valuable parts
// (socials, notifications, SAM.gov) without making the first run any longer. It shows until
// everything is done or it's hidden, and lives on under You > Set up Northfix either way.
// Ports SetupCard.swift. Android has no calendar, home city, watch or AI tools rows.
import { M, isSample, isStarter, socials } from './model.js';
import { esc, icon, menu } from './ui.js';
import { openSheet, closeSheet, refreshVisible } from './nav.js';
import { register, open } from './actions.js';
import { prefs, savePrefs, ls, fx, askNotify, NATIVE } from './platform.js';
import { Secrets } from './secrets.js';
import { LocalNotifications } from '@capacitor/local-notifications';

const HIDDEN = 'bearings.setupHidden';
export const setupHidden = () => ls.get(HIDDEN) === '1';
export function hideSetup(on = true){ if (on) ls.set(HIDDEN, '1'); else ls.del(HIDDEN); }

// Checked in the background (the key lives in encrypted storage; permissions are a plugin call)
// and re-read each time the card renders.
let samKey = false, notifyOn = false;
async function probe(){
  let changed = false;
  try { const k = !!(await Secrets.get('sam.key')); if (k !== samKey){ samKey = k; changed = true; } } catch {}
  if (NATIVE){
    try { const g = (await LocalNotifications.checkPermissions()).display === 'granted'; if (g !== notifyOn){ notifyOn = g; changed = true; } } catch {}
  }
  return changed;
}

/** The SAM.gov row only makes sense for a federal network or a federal purpose. */
const federal = () => !!(M.info.lens || M.info.lensAuto || prefs.useCase === 'government');

export function setupSteps(){
  const out = [
    {id: 'linkedin', ic: 'download', title: 'LinkedIn connections', detail: 'Everyone you’re connected to, who you message, and who changed jobs.', done: !isSample() && !isStarter()},
    {id: 'socials', ic: 'people', title: 'Facebook and other socials', detail: 'Add a Facebook, Instagram, Snapchat or TikTok download to see everyone you know.', done: (socials().platforms || []).some(p => p.n > 0)},
    {id: 'notify', ic: 'bell', title: 'Notifications', detail: 'Follow-up reminders, the Monday brief, and a nudge the morning after an event.', done: notifyOn},
  ];
  if (federal()) out.push({id: 'sam', ic: 'building', title: 'SAM.gov key', detail: 'New notices at the agencies where you know people, with your own free key.', done: samKey});
  return out;
}

function ringSvg(done, total){
  const r = 7, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return `<svg class="setup-ring ${f >= 1 ? 'full' : ''}" viewBox="0 0 18 18" aria-hidden="true"><circle class="ring-bg" cx="9" cy="9" r="${r}"/><circle class="ring-arc" cx="9" cy="9" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - f)).toFixed(2)}"/></svg>`;
}
const stepRow = s => `<button type="button" class="row setup-row ${s.done ? 'done' : ''}" data-a="setupStep" data-v="${s.id}" ${s.done ? 'disabled' : ''}>
    <span class="setup-ic">${icon(s.done ? 'checkCircle' : s.ic)}</span>
    <span class="setup-main"><b>${esc(s.title)}</b>${s.done ? '' : `<span>${esc(s.detail)}</span>`}</span>
    ${s.done ? '' : icon('chevR', 'chev')}</button>`;

/** The card's HTML: open rows, with done rows folded into one line. `full` lists every row. */
export function setupCardHTML({full = false, showDone = false} = {}){
  const all = setupSteps(), done = all.filter(s => s.done).length, open = all.filter(s => !s.done);
  if (!full && (setupHidden() || !open.length)) return '';
  const shown = full || showDone ? all : open;
  return `<section class="card list setup-card">
    <div class="card-head static"><h2>Set up Northfix</h2><span class="card-meta">${full || !done ? `${done} of ${all.length} done` : ''}${ringSvg(done, all.length)}${full ? '' : `<button type="button" class="tool small plain" data-a="setupMore" aria-label="More">${icon('more')}</button>`}</span></div>
    ${shown.map(stepRow).join('')}
    ${!full && done ? `<button type="button" class="row setup-fold" data-a="setupFold">${icon('checkCircle', 'good')}<span>${showDone ? 'Hide what’s done' : `${done} of ${all.length} done`}</span>${icon(showDone ? 'chevD' : 'chevR', 'chev')}</button>` : ''}
  </section>`;
}

/* ---------- Today ---------- */
let slot = null, showDone = false;
export function setupCard(el){
  slot = el;
  el.innerHTML = setupCardHTML({showDone});
  probe().then(changed => { if (changed && slot && slot.isConnected) setupCard(slot); });
}

async function runStep(id){
  fx.tap();
  if (id === 'linkedin') return open('import');
  if (id === 'socials') return open('socials');
  if (id === 'sam') return open('samSettings');
  if (id === 'notify'){
    if (!prefs.notify){ prefs.notify = true; savePrefs(); }
    const ok = await askNotify();
    notifyOn = ok;
    if (!ok) open('settings');
    refreshVisible('setup');
  }
}

export const setupHandlers = {
  setupStep: id => runStep(id),
  setupFold(){ fx.tap(); showDone = !showDone; if (slot) setupCard(slot); },
  setupMore(_, t){
    menu(t, [{label: 'Hide', icon: 'x', run: () => { hideSetup(true); if (slot) setupCard(slot); }}]);
  },
};

/* ---------- You > Set up Northfix ---------- */
export function openSetup(){
  const render = body => { body.innerHTML = `<p class="muted pad-x">Each of these adds something to Today. None of them is required, and nothing leaves your phone.</p>${setupCardHTML({full: true})}`; };
  openSheet({
    title: 'Set up Northfix', right: ['Done'], full: true,
    mount(body){ render(body); probe().then(() => { if (body.isConnected) render(body); }); },
    update(body){ render(body); },
    handlers: {
      setupStep(id){
        // the sheet closes first, so whatever the row opens isn't under it
        if (id === 'notify') return runStep(id);
        closeSheet(); setTimeout(() => runStep(id), 300);
      },
    },
  });
}
register('setup', openSetup);
