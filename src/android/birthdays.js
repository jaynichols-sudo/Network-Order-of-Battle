// Birthdays from the phone's Contacts, matched to people in your network when Bearings
// works out where people are (the same pass, so it asks for Contacts once). Ports
// BirthdaysCard (ContactsExtras.swift) and AppModel.upcomingBirthdays.
import { M, person, isSample, locate } from './model.js';
import { esc, icon, avatar, empty } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { openPerson, register } from './actions.js';
import { ymd, upcomingBirthdays, birthdayLabel } from './eventkit.js';

const today = () => ymd(new Date());
export const birthdaysWithin = days => upcomingBirthdays(M.births, person, today(), days);

const bdRow = ({p, date}) => `<button type="button" class="row bdrow" data-a="open" data-v="${esc(p.k)}">${avatar(p, 32, {star: false})}<b>${esc(p.full)}</b><span class="mono muted">${esc(birthdayLabel(date, today()))}</span></button>`;

/** Today's card: only when someone has a birthday in the next seven days. */
export function birthdaysCard(){
  const list = birthdaysWithin(7);
  if (!list.length) return '';
  return `<section class="card list bdays"><div class="card-head static"><h2 class="bd-title">${icon('gift')}Birthdays this week</h2></div>${list.slice(0, 4).map(bdRow).join('')}
    ${list.length > 4 ? `<button type="button" class="row act more-bd" data-a="birthdays"><span>${list.length - 4} more</span>${icon('chevR', 'chev')}</button>` : ''}</section>`;
}

export function openBirthdays(){
  const render = body => {
    const list = birthdaysWithin(30), have = Object.keys(M.births || {}).length;
    if (list.length){ body.innerHTML = `<p class="sec-h">Next 30 days</p><div class="card list">${list.map(bdRow).join('')}</div><p class="foot">From the birthdays saved on your Contacts cards, for people Bearings matched by email or name.</p>`; return; }
    if (isSample()){ body.innerHTML = empty('gift', 'No birthdays in the sample', 'With your own network, Bearings matches people to your Contacts and shows birthdays coming up this week on Today.'); return; }
    body.innerHTML = have
      ? empty('gift', 'No birthdays in the next 30 days', `${have} ${have === 1 ? 'person has' : 'people have'} a birthday on their Contacts card. They show on Today the week of.`)
      : empty('gift', 'No birthdays yet', 'Bearings can match people to your Contacts on this phone and show their birthdays. Nothing leaves your phone.', `<button type="button" class="btn prominent" data-a="locate">${M.locating ? 'Working…' : 'Use my Contacts'}</button>`);
  };
  openSheet({
    title: 'Birthdays', right: ['Done'], full: true,
    mount: render, update(body){ render(body); },
    handlers: {
      open(k){ closeSheet(); openPerson(k); },
      locate: () => locate(),
    },
  });
}
register('birthdays', openBirthdays);
