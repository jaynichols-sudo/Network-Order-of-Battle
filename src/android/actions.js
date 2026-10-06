// Shared moves between screens: card actions, opening people and companies,
// jumping to People with a filter.
import { M, blankFilters, setQuery } from './model.js';
import { go, push, resetStack, N } from './nav.js';
import { fx } from './platform.js';

export const GOV_SEGS = ['DoD & Military', 'Federal Civilian', 'State & Local'];
const later = {};
/** Late-bound openers, registered by the modules that own them (avoids import cycles at load). */
export const register = (name, fn) => { later[name] = fn; };
export const open = (name, ...args) => later[name] && later[name](...args);

export const openPerson = k => push('person', k);
export const openUnit = name => push('unit', name);
export const openIndustry = id => push('industry', id);
/** Explore and Catch Up are pages on Today's stack. */
export function openToday(kind){ if (N.tab !== 'home') go('home'); const st = N.stacks.home, top = st[st.length - 1]; if (!top || top.kind !== kind) push(kind); }
later.explore = () => openToday('explore');
later.catchup = () => openToday('catchup');

/** Jump to People with a fresh filter. */
export function showPeople(patch = {}, text = ''){
  const f = Object.assign(blankFilters(), patch);
  setQuery({text, filters: f});
  resetStack('people');
  go('people');
  later.peopleScrollTop && later.peopleScrollTop();
}
export function showSector(id){
  if (GOV_SEGS.includes(id)) showPeople({seg: [id], ind: [M.constants.gov]});
  else showPeople({ind: [id]});
}

export function perform(a){
  if (!a) return;
  fx.tap();
  switch (a.kind){
    case 'tab': if (a.tab === 'explore' || a.tab === 'catchup') openToday(a.tab); else if (a.tab) go(a.tab); break;
    case 'filter': showPeople({sig: a.sig || [], seg: a.seg || [], status: a.status || []}); break;
    case 'unit': if (a.name) openUnit(a.name); break;
    case 'addTarget': later.companiesMode && later.companiesMode('watchlist'); go('companies'); open('addTarget'); break;
    case 'industries': later.companiesMode && later.companiesMode('industries'); resetStack('companies'); go('companies'); break;
    case 'backup': open('backup'); break;
  }
}
export const currentTab = () => N.tab;
