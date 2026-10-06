// Bearings for Android: boots the shell, loads the saved network through the shared
// engine, and wires up the device (back button, incoming files, notifications).
import { M, reload, setToast, onChange, isSample, refreshAll, person, followUp } from './model.js';
import { mountShell, registerTab, go, refreshVisible, setBadge, back, toast, N } from './nav.js';
import { HomeView } from './home.js';
import { PeopleView } from './people.js';
import { CompaniesView } from './companies.js';
import { ExploreView } from './explore.js';
import { CatchUpView } from './catchup.js';
import './profile.js';
import './sheets.js';
import { applyTheme, openImport, openOnboarding } from './setup.js';
import { open, openPerson } from './actions.js';
import { migrate, onAppEvents, onNotification, readIncoming, scheduleMonday, ls, prefs } from './platform.js';

async function boot(){
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((prefs.theme || 'system') === 'system'){ applyTheme(); refreshVisible('theme'); } });
  window.addEventListener('bearings:prefs', () => refreshVisible('all'));

  mountShell(document.getElementById('app'));
  registerTab('home', HomeView);
  registerTab('people', PeopleView);
  registerTab('companies', CompaniesView);
  registerTab('explore', ExploreView);
  registerTab('catchup', CatchUpView);
  setToast(toast);
  onChange(what => { setBadge('catchup', M.info.deckCount); refreshVisible(what); });

  const mig = await migrate();
  if (mig.ran && Object.values(mig.files).includes('unreadable')) console.warn('Some saved files could not be read', mig.files);
  await reload();
  setBadge('catchup', M.info.deckCount);

  const start = new URLSearchParams(location.search);
  go(start.get('tab') || ls.get('bearings.tab') || 'home');
  if (start.get('person')){ const k = start.get('person') === 'top' ? M.people.slice().sort((a, b) => b.score - a.score)[0].k : start.get('person'); if (person(k)) openPerson(k); }
  if (start.get('open')) open(start.get('open'));

  if (isSample() && !ls.get('bearings.onboarded') && !start.has('tab')) openOnboarding(0);

  // the engine's "today" is set when it loads; start fresh when you come back on a new day
  const bootDay = new Date().toDateString();
  onAppEvents({
    resume: () => { if (new Date().toDateString() !== bootDay) location.reload(); },
    url: async u => {
      if (!/^(content|file):/i.test(u)) return;
      try { openImport(await readIncoming(u)); }
      catch (e) { openImport(); toast(`Couldn’t open that file (${(e && e.message) || 'unknown error'}). Choose it from here instead.`); }
    },
    back,
  });
  onNotification(a => {
    const n = a && a.notification, ex = (n && n.extra) || {}, act = a && a.actionId;
    if (ex.k && (act === 'done' || act === 'snooze')){ if (!isSample()) followUp(ex.k, act === 'snooze' ? 7 : 0); return; }
    if (ex.k){ go('people'); openPerson(ex.k); return; }
    if (ex.weekly){ open('weekly'); return; }
    if (ex.refresh) open('import');
  });
  scheduleMonday();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refreshVisible('fonts'));
  document.documentElement.classList.add('ready');
}
boot().catch(e => { console.error(e); const a = document.getElementById('app'); if (a) a.innerHTML = `<p style="padding:40px 24px;font:16px system-ui">Bearings couldn’t start: ${String((e && e.message) || e).replace(/</g, '&lt;')}</p>`; });
export { N, refreshAll };
