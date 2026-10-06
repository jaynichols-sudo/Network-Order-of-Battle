// You: who you are in Bearings, the share card, your stuff (the week's five, lists,
// Catch Up, Explore), your data (import or refresh, backup) and settings and help.
import { M, isSample, isStarter, myInitials, runList, lastBackup } from './model.js';
import { esc, fmt, icon, meAvatar, Day, empty, $, plural } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { open, openToday } from './actions.js';
import { runSavedList, listMenu } from './home.js';
import { openURL, fx, prefs } from './platform.js';
import { tripsAhead } from './trips.js';
import { birthdaysWithin } from './birthdays.js';

const row = (a, ic, label, detail = '', chev = true) => `<button type="button" class="row act" data-a="${a}">${icon(ic)}<span>${esc(label)}</span>${detail ? `<span class="muted">${esc(detail)}</span>` : ''}${chev ? icon('chevR', 'chev') : ''}</button>`;

function profileLine(){
  if (isSample()) return 'Looking around a sample network';
  const n = plural(M.info.count, 'person', 'people');
  if (isStarter()) return `${n} from your contacts`;
  return `${n}${M.info.lastImport ? `, refreshed ${Day.nice(M.info.lastImport)}` : ''}`;
}

export function openLists(){
  const render = body => {
    body.innerHTML = M.lists.length
      ? `<div class="card list">${M.lists.map(s => `<div class="row lrow-btn"><button type="button" class="grow lrow-main" data-a="run" data-v="${esc(s.id)}"><b>${esc(s.name)}</b><span class="muted small">${esc(plural(runList(s).length, 'person', 'people'))}</span></button><button type="button" class="tool small" data-a="more" data-v="${esc(s.id)}" aria-label="More">${icon('more')}</button></div>`).join('')}</div>
         <p class="foot">Lists stay up to date every time you refresh. Pin a new one from People: search or filter, then Sort, then Pin this search.</p>`
      : empty('pin', 'No lists yet', 'In People, search or filter, then use Sort and Pin this search. It shows up on Today and here.');
  };
  openSheet({
    title: 'Lists', right: ['Done'], full: true,
    mount: render, update(body, what){ if (what === 'lists' || what === 'all') render(body); },
    handlers: {
      run(id){ closeSheet(); runSavedList(id); },
      more(id, t){ listMenu(id, t); },
    },
  });
}

export const YouView = {
  mount(el){
    el.innerHTML = `<div class="scr you"><header class="scr-head"><h1>You</h1></header><div class="you-body"></div></div>`;
    this.update(el);
  },
  update(el){
    const name = (prefs.name || '').trim();
    const b = lastBackup();
    $('.you-body', el).innerHTML = `
      <section class="card you-card"><button type="button" class="you-main" data-a="settings">${meAvatar(myInitials(), 60)}<span class="you-text"><b>${esc(name || 'Add your name')}</b><span>${esc(profileLine())}</span></span>${icon('chevR', 'chev')}</button></section>
      <button type="button" class="card share-card" data-a="share"><span class="sc-ic">${icon('share')}</span><span class="you-text"><b>Share card</b><span>A picture of your network. Dots and sector totals only.</span></span>${icon('chevR', 'chev')}</button>
      <section class="card list"><div class="card-head static"><h2>Your stuff</h2></div>
        ${row('weekly', 'checkCircle', 'This week’s five')}
        ${row('lists', 'pin', 'Lists', M.lists.length ? fmt(M.lists.length) : '')}
        ${row('catchup', 'stack', 'Catch Up', M.info.deckCount ? `${fmt(M.info.deckCount)} new` : '')}
        ${row('events', 'ticket', 'Events', M.events.length ? fmt(M.events.length) : '')}
        ${row('trips', 'plane', 'Trips', tripsAhead().length ? fmt(tripsAhead().length) : '')}
        ${row('birthdays', 'gift', 'Birthdays', birthdaysWithin(7).length ? `${fmt(birthdaysWithin(7).length)} this week` : '')}
        ${row('explore', 'scope', 'Explore', 'Compass, map, clusters')}
      </section>
      <section class="card list"><div class="card-head static"><h2>Data</h2></div>
        ${row('import', 'download', isSample() ? 'Import connections' : 'Refresh connections', M.info.lastImport && !isSample() ? Day.ago(M.info.lastImport) : '')}
        ${isSample() ? '' : row('backup', 'drive', 'Back up notes', b ? `Last ${Day.ago(b)}` : 'Never', false)}
      </section>
      <section class="card list">
        ${row('settings', 'gear', 'Settings')}
        ${row('help', 'mail', 'Help and contact support', '', false)}
      </section>
      <p class="foot center">Everything stays on this phone.</p>`;
  },
  handlers: {
    settings: () => open('settings'),
    share: () => { fx.tap(); open('share'); },
    weekly: () => open('weekly'),
    lists: () => openLists(),
    catchup: () => openToday('catchup'),
    explore: () => openToday('explore'),
    events: () => open('events'),
    trips: () => open('trips'),
    birthdays: () => open('birthdays'),
    import: () => open('import'),
    backup: () => open('backup'),
    help: () => openURL('mailto:jay@jaynichols.net?subject=' + encodeURIComponent('Bearings for Android: help')),
  },
};
