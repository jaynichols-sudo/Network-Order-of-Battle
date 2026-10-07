// Bearings for Android: boots the shell, loads the saved network through the shared
// engine, and wires up the device (back button, incoming files, notifications).
import { M, reload, setToast, onChange, isSample, refreshAll, person, followUp } from './model.js';
import { mountShell, registerTab, go, push, refreshVisible, back, toast, N } from './nav.js';
import { HomeView } from './home.js';
import { PeopleView } from './people.js';
import { CompaniesView } from './companies.js';
import { YouView } from './you.js';
import './explore.js';
import './catchup.js';
import './profile.js';
import './sheets.js';
import './events.js';
import './trips.js';
import './birthdays.js';
import './org.js';
import { ingestNotes, guessSource } from './notes.js';
import { installStars } from './ui.js';
import { applyTheme, openImport, openOnboarding } from './setup.js';
import { handleLinkedInUrl } from './linkedin.js';
import { handleSeamlessUrl } from './enrich.js';
import { initBilling } from './pro.js';
import { checkArrival } from './arrivals.js';
import { addTeamPackText } from './team.js';
import { open, openPerson } from './actions.js';
import { migrate, onAppEvents, onNotification, readIncoming, scheduleMonday, ls, prefs } from './platform.js';

async function boot(){
  applyTheme();
  installStars();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((prefs.theme || 'system') === 'system'){ applyTheme(); refreshVisible('theme'); } });
  window.addEventListener('bearings:prefs', () => refreshVisible('all'));

  mountShell(document.getElementById('app'));
  registerTab('home', HomeView);
  registerTab('people', PeopleView);
  registerTab('companies', CompaniesView);
  registerTab('you', YouView);
  setToast(toast);
  onChange(what => refreshVisible(what));

  const mig = await migrate();
  if (mig.ran && Object.values(mig.files).includes('unreadable')) console.warn('Some saved files could not be read', mig.files);
  await reload();

  const start = new URLSearchParams(location.search);
  // Explore and Catch Up used to be tabs; now they're pages pushed from Today
  const tab = start.get('tab') || ls.get('bearings.tab') || 'home';
  if (tab === 'explore' || tab === 'catchup'){ go('home'); push(tab); }
  else go(tab);
  if (start.get('person')){ const k = start.get('person') === 'top' ? M.people.slice().sort((a, b) => b.score - a.score)[0].k : start.get('person'); if (person(k)) openPerson(k); }
  if (start.get('open')) open(start.get('open'));
  if (start.get('page')) push(start.get('page'), start.get('arg') || '');

  if (isSample() && !ls.get('bearings.onboarded') && !start.has('tab')) openOnboarding(0);

  // the engine's "today" is set when it loads; start fresh when you come back on a new day
  const bootDay = new Date().toDateString();
  onAppEvents({
    resume: () => { if (new Date().toDateString() !== bootDay) location.reload(); else checkArrival(); },
    url: async u => {
      if (handleLinkedInUrl(u) || handleSeamlessUrl(u)) return;
      // text shared to Bearings (MainActivity turns it into bearings://notes?text=…)
      if (/^bearings:\/\/notes/i.test(u)){ const t = new URL(u).searchParams.get('text') || ''; if (t.trim()){ go('home'); ingestNotes(t, guessSource(t, new URL(u).searchParams.get('from') || '')); } return; }
      if (!/^(content|file):/i.test(u)) return;
      try {
        const f = await readIncoming(u);
        // a teammate's pack arrives as JSON; everything else is a LinkedIn export
        if (f.type !== 'application/zip' && (await f.slice(0, 400).text()).includes('bearings-team-pack')){ await addTeamPackText(await f.text()); return; }
        // a text file with no connections header is meeting notes, shared from a notes app
        if (f.type !== 'application/zip'){ const head = await f.slice(0, 4000).text(); if (!/first name/i.test(head) && !/^\s*[\[{]/.test(head)){ const t = await f.text(); go('home'); ingestNotes(t, guessSource(t)); return; } }
        openImport(f);
      }
      catch (e) { openImport(); toast(`Couldn’t open that file (${(e && e.message) || 'unknown error'}). Choose it from here instead.`); }
    },
    back,
  });
  onNotification(a => {
    const n = a && a.notification, ex = (n && n.extra) || {}, act = a && a.actionId;
    if (ex.k && (act === 'done' || act === 'snooze')){ if (!isSample()) followUp(ex.k, act === 'snooze' ? 7 : 0); return; }
    if (ex.k){ go('people'); openPerson(ex.k); return; }
    if (ex.weekly){ open('weekly'); return; }
    if (ex.event){ go('home'); open('event', ex.event); return; }
    if (ex.refresh) open('import');
  });
  scheduleMonday();
  initBilling();
  setTimeout(checkArrival, 1500);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refreshVisible('fonts'));
  document.documentElement.classList.add('ready');
}
boot().catch(e => { console.error(e); const a = document.getElementById('app'); if (a) a.innerHTML = `<p style="padding:40px 24px;font:16px system-ui">Bearings couldn’t start: ${String((e && e.message) || e).replace(/</g, '&lt;')}</p>`; });
export { N, refreshAll };
