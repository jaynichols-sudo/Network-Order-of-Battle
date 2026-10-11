// Across your socials: Facebook, Instagram, Snapchat and TikTok data downloads, read on the
// phone and merged with LinkedIn into one picture of who you're connected to, and where.
// Ports Socials.swift.
import { person, socials, importSocial, clearSocial, show } from './model.js';
import { esc, fmt, icon, avatar, Day } from './ui.js';
import { registerRoute, openSheet, push } from './nav.js';
import { openPerson, register } from './actions.js';
import { openURL, fx } from './platform.js';

export const PLATFORMS = [
  {id: 'facebook', name: 'Facebook', color: '#1877F2', letter: 'f', ink: '#fff',
    how: '', steps: ["In the Facebook app, tap Menu, then Settings & privacy, then Settings.", "Tap Accounts Center, then Your information and permissions, then Download your information.", "Tap Download or transfer information, choose your Facebook profile, then Specific types of information.", "Tick Friends and followers only, then Next.", "Choose Download to device. Set Date range to All time and Format to JSON, then Create files.", "Facebook tells you when it’s ready, usually within a few hours. Download the zip, then tap Add file here."],
    url: 'https://accountscenter.facebook.com/info_and_permissions/dyi'},
  {id: 'instagram', name: 'Instagram', color: '#E1306C', letter: 'ig', ink: '#fff',
    how: '', steps: ["In Instagram, go to your profile, tap the menu (three lines), then Accounts Center.", "Tap Your information and permissions, then Download your information.", "Tap Download or transfer information, choose your Instagram account, then Specific types of information.", "Tick Followers and following only, then Next.", "Choose Download to device. Set Date range to All time and Format to JSON, then Create files.", "When Instagram says it’s ready, download the zip, then tap Add file here."],
    url: 'https://accountscenter.instagram.com/info_and_permissions/dyi'},
  {id: 'snapchat', name: 'Snapchat', color: '#F7C600', letter: 'sc', ink: '#000',
    how: '', steps: ["In Snapchat, tap your profile, then the gear for Settings.", "Scroll to Privacy Controls and tap My Data.", "Turn on Friends (you can leave Memories and other media off to keep it small). Choose JSON if it asks, and All time.", "Tap Submit. Snapchat emails you a link when the file is ready.", "Download the zip from that link, then tap Add file here."],
    url: 'https://accounts.snapchat.com/accounts/downloadmydata'},
  {id: 'tiktok', name: 'TikTok', color: '#25F4EE', letter: 'tt', ink: '#000',
    how: '', steps: ["In TikTok, go to your profile, tap the menu (three lines), then Settings and privacy.", "Tap Account, then Download your data.", "Choose JSON as the file format and select your profile and activity data (it includes who you follow and who follows you).", "Tap Request data. TikTok can take a few days to prepare it.", "When it’s ready, open the Download data tab, download the file, then tap Add file here."],
    url: 'https://www.tiktok.com/setting/download-your-data'},
];
const P = id => PLATFORMS.find(p => p.id === id);
export function profileURL(id, handle){
  const h = String(handle || '').replace(/^[@\s]+|\s+$/g, '');
  if (!h) return '';
  switch (id){
    case 'facebook': return 'https://www.facebook.com/search/people/?q=' + encodeURIComponent(h);
    case 'instagram': return 'https://www.instagram.com/' + encodeURIComponent(h);
    case 'snapchat': return 'https://www.snapchat.com/add/' + encodeURIComponent(h);
    case 'tiktok': return 'https://www.tiktok.com/@' + encodeURIComponent(h);
  }
  return '';
}
const badge = (p, size = 18) => `<span class="sbadge" style="--s:${size}px;background:${p.color};color:${p.ink}" role="img" aria-label="${esc(p.name)}">${esc(p.letter)}</span>`;
const pickFile = accept => new Promise(resolve => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
  i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
  document.body.appendChild(i); i.click();
});

/** On a profile: where else you're connected with this person. */
export function socialBadges(social){
  if (!social || !social.on) return '';
  const on = PLATFORMS.filter(p => social.on[p.id]);
  if (!on.length) return '';
  return `<div class="also-on"><span class="muted small">Also on</span>${on.map(p => { const h = (social.h || {})[p.id] || ''; const u = h ? profileURL(p.id, h) : '';
    return u ? `<button type="button" class="schip" style="background:${p.color};color:${p.ink}" data-a="url" data-v="${esc(u)}">${esc(p.name)}</button>` : `<span class="schip" style="background:${p.color};color:${p.ink}">${esc(p.name)}</span>`; }).join('')}</div>`;
}

/* ---------- the page ---------- */
registerRoute('socials', () => {
  let filter = 'all', busy = '';
  const view = {
    title: 'Across your socials',
    mount(body){ this.update(body); },
    update(body){
      const d = socials();
      const sc = body.scrollTop;
      const nets = 1 + d.platforms.filter(p => p.n > 0).length;
      const rows = [{name: 'LinkedIn', n: d.linkedin, color: 'var(--info)'}].concat(d.platforms.map(p => ({name: p.name, n: p.n, color: (P(p.id) || {}).color || '#888'})));
      const top = Math.max(1, ...rows.map(r => r.n));
      const people = filter === 'all' ? d.people : filter === 'off' ? d.people.filter(e => !e.linkedin) : d.people.filter(e => e.on.includes(filter));
      body.innerHTML = `<div class="socials">
        <section class="card pad so-top">
          <p class="eyebrow mono muted">EVERYONE YOU’RE CONNECTED TO</p>
          <div class="so-big"><b class="serif">${fmt(d.unique)}</b><span class="muted">people across ${nets} ${nets === 1 ? 'network' : 'networks'}</span></div>
          <div class="so-bars">${rows.map(r => `<div class="so-bar"><span class="small strong">${esc(r.name)}</span><span class="so-track"><i style="width:${Math.max(3, r.n / top * 100)}%;background:${r.color};opacity:${r.n ? 0.85 : 0.15}"></i></span><span class="mono muted small">${r.n ? fmt(r.n) : '–'}</span></div>`).join('')}</div>
          ${d.both > 0 ? `<p class="muted small">${esc(`${fmt(d.both)} of your LinkedIn connections you also know socially. ${fmt(d.socialOnly)} people you know only off LinkedIn.`)}</p>` : ''}
        </section>
        <p class="sec-h">Your downloads</p>
        <div class="card list">${PLATFORMS.map(p => { const n = (d.platforms.find(x => x.id === p.id) || {}).n || 0; return `<div class="so-plat">
            <div class="so-plat-top">${badge(p, 30)}<span class="grow"><b>${esc(p.name)}</b><span class="muted small">${n > 0 ? `${fmt(n)} connections` : busy === p.id ? 'Reading…' : 'Not added yet'}</span></span>
              <button type="button" class="pill-btn ${n > 0 ? 'soft' : 'primary'}" data-a="add" data-v="${p.id}" ${busy ? 'disabled' : ''}>${n > 0 ? 'Update' : 'Add file'}</button></div>
            ${n === 0 ? `<details class="so-how"><summary class="small strong">How to get your ${esc(p.name)} file</summary><ol class="small muted">${p.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol><p class="small muted">Only names, usernames and the date you connected come in. No messages, photos, phone numbers or emails.</p></details><button type="button" class="link small" data-a="url" data-v="${esc(p.url)}">Request your ${esc(p.name)} download</button>` : `<button type="button" class="link small so-remove" data-a="remove" data-v="${p.id}">Remove ${esc(p.name)}</button>`}
          </div>`; }).join('')}</div>
        <p class="foot">Each app lets you download your own data. Bearings reads only the friends and followers lists, on this phone, and never signs in to any of them. Facebook and Snapchat include names; Instagram and TikTok only usernames, which Bearings matches by handle.</p>
        ${d.strongest.length ? `<p class="sec-h">Connected everywhere</p><div class="card list">${d.strongest.slice(0, 15).map(entryRow).join('')}</div><p class="foot">Three or more places. Usually your real relationships.</p>` : ''}
        ${d.people.length ? `<p class="sec-h row-between"><span>Everyone</span><span class="select"><select data-ch="filter" aria-label="Show">${[['all', 'All'], ['off', 'Not on LinkedIn'], ...PLATFORMS.map(p => [p.id, p.name])].map(([v, l]) => `<option value="${v}" ${v === filter ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${icon('chevD')}</span></p>
          <div class="card list">${people.slice(0, 300).map(entryRow).join('') || '<p class="muted pad">No one here yet.</p>'}</div>${people.length > 300 ? `<p class="foot">Showing 300 of ${fmt(people.length)}.</p>` : ''}` : ''}
      </div>`;
      body.scrollTop = sc;
      view.__d = d;
    },
    handlers: {
      url: v => openURL(v),
      filter(v, t){ filter = v; fx.select(); view.update(t.closest('.page-body')); },
      async add(id, t){
        const p = P(id), body = t.closest('.page-body');
        const f = await pickFile('.zip,.json,application/zip,application/json');
        if (!f) return;
        busy = id; view.update(body);
        try {
          const r = await importSocial(id, p.name, f);
          show(`${p.name}: ${fmt(r.entries)} connections, ${fmt(r.matched)} already in your network`);
        } catch (e) { show(`Couldn’t read that ${p.name} file: ${(e && e.message) || e}`); }
        busy = ''; view.update(body);
      },
      async remove(id, t){ const body = t.closest('.page-body'); await clearSocial(id); fx.tap(); show(`Removed ${P(id).name}`); view.update(body); },
      entry(id){
        const e = (view.__d ? view.__d.people : []).find(x => x.id === id);
        if (!e) return;
        if (e.linkedin && e.k) openPerson(e.k); else openSocialPerson(e);
      },
    },
  };
  return view;
});
function entryRow(e){
  const p = e.k ? person(e.k) : null;
  const letter = (e.name.replace(/@/g, '')[0] || '?').toUpperCase();
  return `<button type="button" class="row so-entry" data-a="entry" data-v="${esc(e.id)}">${p ? avatar(p, 34, {star: false}) : `<span class="so-letter">${esc(letter)}</span>`}
    <span class="grow so-main"><b class="one">${esc(e.name)}</b><span class="so-badges">${e.linkedin ? '<span class="sbadge in" style="--s:18px" role="img" aria-label="LinkedIn">in</span>' : ''}${e.on.map(id => P(id) ? badge(P(id)) : '').join('')}</span></span>
    ${e.ties >= 3 ? `<span class="small strong good">${e.ties} places</span>` : ''}</button>`;
}

/** Someone you know only off LinkedIn: where you're connected, and ways to reach them. */
function openSocialPerson(e){
  const named = !e.name.startsWith('@');
  openSheet({
    title: '', right: ['Done'],
    mount(body){
      body.innerHTML = `<div class="pad-x"><h2 class="serif so-name">${esc(e.name)}</h2>${e.since ? `<p class="muted small">Connected since ${esc(Day.nice(e.since))}</p>` : ''}</div>
        <p class="sec-h">Connected on</p><div class="card list">${e.on.map(id => { const p = P(id); if (!p) return ''; const h = (e.h || {})[id]; const u = h ? profileURL(id, h) : profileURL(id, named ? e.name : '');
          return u ? `<button type="button" class="lrow so-link" data-a="url" data-v="${esc(u)}"><span>${badge(p)} ${esc(p.name)}</span><span class="accent">${esc(h ? '@' + h : 'Find')}</span></button>` : `<div class="lrow"><span>${badge(p)} ${esc(p.name)}</span></div>`; }).join('')}</div>
        ${named ? `<div class="card list actions top12"><button type="button" class="row act" data-a="url" data-v="${esc('https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(e.name))}">${icon('search')}<span>Find them on LinkedIn</span></button></div>` : ''}`;
    },
    handlers: {url: v => openURL(v)},
  });
}
register('socials', () => push('socials'));
