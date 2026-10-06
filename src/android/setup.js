// Import, the "here's your network" payoff, Settings, and the welcome tour.
// Ports ImportView.swift (and PayoffView), SettingsView.swift and Onboarding.swift.
import { M, isSample, isStarter, readImport, commitImport, startFromContacts, backup, restore, exportCSV, setLens, locate, show, setQuery, myInitials, scheduleMonday } from './model.js';
import { esc, fmt, icon, segmented, $, plural, REDUCED } from './ui.js';
import { openSheet, closeSheet, go, toast } from './nav.js';
import { register, open } from './actions.js';
import { createCompass } from './compass.js';
import { prefs, savePrefs, ls, fx, openURL, exportRequested, askNotify, statusBar, NATIVE } from './platform.js';

const LINKEDIN_EXPORT = 'https://www.linkedin.com/mypreferences/d/download-my-data';
const pickFile = accept => new Promise(resolve => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
  i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
  document.body.appendChild(i); i.click();
});

/* ---------- import ---------- */
const step = (n, title, text) => `<div class="step"><span class="step-n mono">${n}</span><div><b>${esc(title)}</b><p class="muted">${esc(text)}</p></div></div>`;
export function openImport(file = null){
  const st = {reading: false, saving: false, plan: null, name: '', error: ''};
  let sheet = null;
  const render = body => {
    const p = st.plan;
    body.innerHTML = `<p class="muted pad-x">${isSample() ? 'Three steps. Everything stays private to you.' : 'New people are added, job changes are noted, and anyone no longer in the file is kept but marked as removed.'}</p>
      <div class="card pad steps">${step(1, 'Ask LinkedIn for your data', 'On LinkedIn’s “Get a copy of your data” page, choose the larger archive (it includes messages, so Bearings can tell who you talk to) or just Connections, then tap Request archive.')}
        ${step(2, 'Wait for the email', 'LinkedIn usually sends a download link within about 10 minutes. The full archive can take up to a day.')}
        ${step(3, 'Bring the file here', 'Download the zip and choose it below, or open it from your Downloads or Files app with Bearings.')}
        <button type="button" class="link" data-a="linkedin">${icon('ext')}Open LinkedIn’s data page</button></div>
      <div class="card list"><button type="button" class="row choose" data-a="choose" ${st.reading || st.saving ? 'disabled' : ''}>${icon('zip')}<span><b>Choose your LinkedIn file</b><span class="muted small">The .zip from LinkedIn, or the Connections.csv inside it</span></span></button>
        ${st.reading ? `<p class="pad muted"><span class="spinner sm"></span> Reading ${esc(st.name)}…</p>` : ''}${st.error ? `<p class="pad bad">${esc(st.error)}</p>` : ''}</div>
      ${isSample() && !p ? `<div class="card list"><button type="button" class="row act" data-a="starter">${icon('contactCheck')}<span>No file yet? Start with your contacts</span></button></div><p class="foot">See your network right away from the people in your phone, then add LinkedIn when the email arrives.</p>` : ''}
      ${p ? `<p class="sec-h">From ${esc(st.name)}</p><div class="card pad"><div class="grid2">
          <div class="stat"><b class="mono">${fmt(p.stats.total)}</b><span class="muted small">Connections</span></div>
          <div class="stat"><b class="mono bad">${fmt(p.stats.added)}</b><span class="muted small">${p.stats.first ? 'Loaded' : 'New'}</span></div>
          <div class="stat"><b class="mono info">${fmt(p.stats.changed)}</b><span class="muted small">Job changes</span></div>
          <div class="stat"><b class="mono">${fmt(p.stats.removed)}</b><span class="muted small">No longer listed</span></div></div>
        ${p.stats.rel != null ? `<p class="violet small">${icon('bubbles')}${fmt(p.stats.rel)} people with messages, invitations or endorsements</p>` : '<p class="muted small">Tip: request the full LinkedIn archive (not just Connections) to see who you talk to and who’s waiting on a reply.</p>'}
        <button type="button" class="btn prominent block" data-a="commit" ${st.saving ? 'disabled' : ''}>${st.saving ? 'Saving…' : 'Save to my network'}</button></div>` : ''}`;
  };
  const read = async (f, body) => {
    st.name = f.name; st.error = ''; st.plan = null; st.reading = true; render(body);
    try { st.plan = await readImport(f); } catch (e) { st.error = (e && e.message) || String(e); }
    st.reading = false; render(body);
  };
  sheet = openSheet({
    title: isSample() ? 'Import your connections' : 'Refresh your network', left: ['Close'], full: true,
    mount(body){ render(body); if (file) read(file, body); },
    handlers: {
      linkedin(){ openURL(LINKEDIN_EXPORT); exportRequested(); },
      async choose(_, t){ const body = t.closest('.sheet-body'); const f = await pickFile('.zip,.csv,application/zip,text/csv,text/comma-separated-values'); if (f) read(f, body); },
      starter(){ closeSheet(); setTimeout(() => openOnboarding(2), 300); },
      async commit(_, t){
        const body = t.closest('.sheet-body'), plan = st.plan; if (!plan) return;
        st.saving = true; render(body);
        try {
          await commitImport(plan);
          closeSheet(sheet);
          if (plan.wasSample || plan.stats.first || plan.wasStarter){ go('home'); setTimeout(openPayoff, 350); }
          else show(`${fmt(plan.stats.added)} new, ${fmt(plan.stats.changed)} changed jobs. Catch up from Today.`);
        } catch (e) { st.saving = false; st.error = 'Save failed: ' + ((e && e.message) || e); render(body); }
      },
    },
  });
  return sheet;
}
register('import', openImport);
register('backup', backup);

/* ---------- payoff ---------- */
export function openPayoff(){
  let compass = null;
  openSheet({
    title: '', right: ['Look around'], full: true,
    mount(body){
      const p = M.api.payoff();
      const max = Math.max(1, (p.top[0] || [0, 1])[1]);
      body.innerHTML = `<h1 class="pay-h">Here’s your network</h1><div class="pay-compass"></div>
        <p class="pay-count"><b class="mono" data-count="${p.total}">0</b><span class="muted">people at ${fmt(p.companies)} companies</span></p>
        <div class="card grid2 pad">${[[p.execs, 'Executives'], [p.dirs, 'Directors'], [p.industries, 'Industries'], [p.companies, 'Companies']].map(([v, l]) => `<div class="stat"><b class="mono big">${fmt(v)}</b><span class="muted small">${l}</span></div>`).join('')}</div>
        ${p.top.length ? `<p class="sec-h">Where you know the most people</p><div class="card pad bars-list">${p.top.map(([n, c, col]) => `<div class="bl"><div class="row-between"><span>${esc(n)}</span><span class="mono muted">${fmt(c)}</span></div><span class="bar"><i style="width:${c / max * 100}%;background:${esc(col)}"></i></span></div>`).join('')}</div>` : ''}
        <div class="stack-btns"><button type="button" class="btn prominent big" data-a="shareIt">${icon('share')}Share a picture of it</button><button type="button" class="btn big" data-a="mapIt">See it on a map</button></div>`;
      compass = createCompass({initials: myInitials(), interactive: false});
      $('.pay-compass', body).appendChild(compass.el);
      compass.setData(M.api.compass({}));
      const n = $('[data-count]', body), total = p.total, t0 = performance.now(), dur = REDUCED() ? 0 : 2400;
      const tick = now => { const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3); n.textContent = fmt(Math.round(total * e)); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      fx.success();
    },
    destroy(){ if (compass) compass.destroy(); },
    handlers: {
      shareIt(){ closeSheet(); setTimeout(() => open('share'), 320); },
      mapIt(){ closeSheet(); ls.set('bearings.explore', 'map'); go('explore'); },
    },
  });
}

/* ---------- settings ---------- */
export function applyTheme(){
  const t = prefs.theme || 'system';
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  root.dataset.scheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#0D0A17' : '#F3F3F6';
  statusBar(dark);
}
export function openSettings(){
  const toggle = (key, label, sub = '') => `<label class="toggle-row"><span>${esc(label)}${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</span><input type="checkbox" class="switch" data-ch="pref" data-k="${key}" ${prefs[key] ? 'checked' : ''}></label>`;
  const render = body => {
    const lens = prefs.lens == null ? 'auto' : prefs.lens ? 'on' : 'off';
    body.innerHTML = `
      <p class="sec-h">You</p><div class="card form"><label class="frow col"><span>Your name</span><input type="text" class="field" data-ch="name" value="${esc(prefs.name)}" placeholder="Used to greet you and sign drafts" autocomplete="name"></label></div>
      <p class="sec-h">Appearance</p><div class="card pad">${segmented('theme', [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']], prefs.theme || 'system')}</div>
      <p class="sec-h">Federal and military view</p><div class="card pad">${segmented('lens', [['auto', `Automatic${M.info.lensAuto ? ' (on)' : ' (off)'}`], ['on', 'On'], ['off', 'Off']], lens)}<p class="muted small top8">Sorts out ranks, agencies and commands, and splits government into DoD, federal civilian, and state and local.</p></div>
      <p class="sec-h">Preferences</p><div class="card list">${toggle('salesnav', 'I use Sales Navigator')}${toggle('notify', 'Reminders', 'Follow-ups and refresh nudges')}${toggle('mondayBrief', 'Monday brief', 'Five people worth reaching out to, every Monday at 7:30')}${toggle('haptics', 'Haptics')}</div>
      <p class="sec-h">Places</p><div class="card list"><button type="button" class="row act" data-a="locate" ${M.locating ? 'disabled' : ''}>${icon('contactCheck')}<span>${M.locating ? 'Matching…' : 'Match with my Contacts'}</span></button></div>
      <p class="foot">Works out where people are from their cards in your Contacts: the address, then the phone area code. It all happens on this phone.</p>
      <p class="sec-h">Your data</p><div class="card list">
        <button type="button" class="row act" data-a="import">${icon('download')}<span>${isSample() ? 'Import connections' : 'Refresh connections'}</span></button>
        <button type="button" class="row act" data-a="export">${icon('share')}<span>Export everyone as a spreadsheet</span></button>
        <button type="button" class="row act" data-a="backup">${icon('drive')}<span>Back up your notes</span></button>
        <button type="button" class="row act" data-a="restore">${icon('refresh')}<span>Restore from a backup</span></button></div>
      <p class="foot">${isSample() ? 'You’re looking at a sample network.' : `${fmt(M.info.count)} people${M.info.lastImport ? `, last refreshed ${esc(M.info.lastImport)}` : ''}.`} Everything stays on this phone. Back up your notes now and then; the file holds your notes, stars, follow-ups, watchlist and industry choices.</p>
      <div class="card list"><button type="button" class="row act" data-a="tour">${icon('sparkles')}<span>Show the welcome tour</span></button>
        <button type="button" class="row act" data-a="feedback">${icon('mail')}<span>Send feedback</span></button></div>
      <p class="foot center">Bearings for Android</p>`;
  };
  openSheet({
    title: 'Settings', right: ['Done'], full: true,
    mount: render, update(body, what){ if (what === 'places') render(body); },
    handlers: {
      name(v){ prefs.name = v.trim(); savePrefs(); M.version++; window.dispatchEvent(new Event('bearings:prefs')); },
      theme(v, t){ prefs.theme = v; savePrefs(); applyTheme(); fx.select(); render(t.closest('.sheet-body')); window.dispatchEvent(new Event('bearings:prefs')); },
      lens(v, t){ fx.select(); setLens(v === 'auto' ? null : v === 'on'); render(t.closest('.sheet-body')); },
      async pref(v, t){
        const k = t.dataset.k; prefs[k] = !!v; savePrefs(); fx.select();
        if (k === 'notify' && v) await askNotify();
        if (k === 'mondayBrief' || k === 'notify') scheduleMonday();
        if (k === 'notify') M.version++;
      },
      locate: () => locate(),
      import(){ closeSheet(); setTimeout(() => open('import'), 300); },
      export: () => exportCSV(null),
      backup: () => backup(),
      async restore(){ const f = await pickFile('.json,application/json'); if (f) restore(f); },
      tour(){ closeSheet(); setTimeout(() => openOnboarding(0), 300); },
      feedback: () => openURL('mailto:jay@jaynichols.net?subject=' + encodeURIComponent('Bearings for Android')),
    },
  });
}
register('settings', openSettings);

/* ---------- welcome tour ---------- */
const USES = [
  ['sales', 'Sales and business development', 'Who you know at every account, and who’s gone quiet', 'trend'],
  ['recruiting', 'Recruiting and hiring', 'Senior people, job changes and who’s open to talk', 'personPlus'],
  ['career', 'My career and job search', 'Who can introduce you, and who just moved companies', 'upForward'],
  ['founder', 'Founder, investor or advisor', 'Warm paths to customers, investors and hires', 'bulb'],
  ['government', 'Government, defense or military', 'Ranks, agencies and commands, sorted out for you', 'starCircle'],
];
export function openOnboarding(startStep = 0){
  document.querySelector('.onboard') && document.querySelector('.onboard').remove();
  const hasReal = () => !isSample() && !isStarter();
  const st = {step: startStep, use: prefs.useCase || '', working: false, error: '', built: null};
  const el = document.createElement('div'); el.className = 'onboard';
  document.body.appendChild(el);
  let compass = null;
  const finish = then => {
    ls.set('bearings.onboarded', '1');
    el.classList.add('out'); setTimeout(() => { if (compass) compass.destroy(); el.remove(); }, 300);
    setTimeout(() => { if (st.built) openPayoff(); if (then) then(); }, 420);
  };
  el.__back = () => { if (st.step > 0 && st.step < 3){ st.step--; render(); } else finish(); };
  const header = (title, text) => `<div class="ob-head"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div>`;
  const render = () => {
    if (compass && st.step !== 0){ compass.destroy(); compass = null; }
    let html = '';
    if (st.step === 0){
      html = `<div class="ob-step welcome"><div class="ob-compass"></div><div class="ob-center"><h1>Your network, mapped.</h1><p class="muted">See everyone you know at a glance: who’s close, who’s waiting on you, and who just changed jobs.</p></div>
        <div class="ob-foot"><p class="lock-note">${icon('lock')}No account. Nothing leaves your phone.</p><button type="button" class="btn prominent big" data-a="start">Get started</button></div></div>`;
    } else if (st.step === 1){
      html = `<div class="ob-step">${header('What do you use your network for?', 'Bearings sets itself up to match. You can change this later.')}
        <div class="ob-scroll">${USES.map(([id, t, d, ic]) => `<button type="button" class="card use ${st.use === id ? 'on' : ''}" data-a="use" data-v="${id}"><span class="use-ic">${icon(ic)}</span><span class="use-t"><b>${esc(t)}</b><span class="muted">${esc(d)}</span></span><span class="use-check">${st.use === id ? icon('checkFill') : '<i class="ring-empty"></i>'}</span></button>`).join('')}</div>
        <div class="ob-foot"><button type="button" class="btn prominent big" data-a="cont" ${st.use ? '' : 'disabled'}>Continue</button></div></div>`;
    } else if (st.step === 2){
      html = `<div class="ob-step">${header('Start in seconds', 'See your network right now from your phone’s contacts, then add LinkedIn for the full picture.')}
        <div class="ob-scroll"><button type="button" class="card option" data-a="contacts" ${st.working ? 'disabled' : ''}><span class="opt-ic" style="--tc:var(--accent)">${icon('contactCheck')}</span><span class="use-t"><b>Start with my contacts</b><span class="muted">Maps the people already in your phone. Nothing is uploaded.</span></span>${st.working ? '<span class="spinner sm"></span>' : icon('chevR', 'chev')}</button>
          <button type="button" class="card option" data-a="haveFile" ${st.working ? 'disabled' : ''}><span class="opt-ic" style="--tc:var(--info)">${icon('zip')}</span><span class="use-t"><b>I already have my LinkedIn file</b><span class="muted">Open the zip from LinkedIn and see your whole network.</span></span>${icon('chevR', 'chev')}</button>
          ${st.error ? `<p class="bad pad-x">${esc(st.error)}</p>` : ''}</div>
        <div class="ob-foot"><button type="button" class="link strong" data-a="sample">Just look around a sample network</button></div></div>`;
    } else {
      html = `<div class="ob-step">${st.built ? `<div class="ob-built"><p class="good strong">${icon('checkCircle')}${esc(plural(st.built.count, 'person', 'people'))} mapped</p><p class="muted">from your contacts, at ${esc(plural(st.built.companies, 'company', 'companies'))}.</p></div>` : ''}
        ${header(hasReal() ? 'Keep it fresh' : 'Now get the full picture', hasReal() ? 'Every few weeks, grab a new LinkedIn export. Bearings spots job changes and new connections.' : 'LinkedIn adds everyone you’re connected to, who you message, and who changed jobs. Ask for your data now; it arrives by email.')}
        <div class="ob-scroll steps">${step(1, 'Ask LinkedIn for your data', 'Pick the larger archive so Bearings can see who you talk to.')}${step(2, 'Wait for the email', 'Usually about 10 minutes, up to a day for the full archive. We’ll remind you.')}${step(3, 'Open the file with Bearings', 'Download it, then open it from your Downloads or Files app and choose Bearings.')}</div>
        <div class="ob-foot"><button type="button" class="btn prominent big" data-a="ask">Ask LinkedIn for my data</button><button type="button" class="link strong" data-a="later">I’ll do it later</button></div></div>`;
    }
    el.innerHTML = html;
    if (st.step === 0){
      compass = createCompass({initials: '', interactive: false});
      el.querySelector('.ob-compass').appendChild(compass.el);
      compass.setData(M.api.compass({}));
    }
    el.__h = handlers;
  };
  const handlers = {
    start(){ fx.tap(); st.step = hasReal() ? 3 : 1; render(); },
    use(v){ fx.tap(); st.use = v; render(); },
    cont(){
      fx.tap(); prefs.useCase = st.use; savePrefs();
      if (st.use === 'government') setLens(true);
      const sort = st.use === 'sales' || st.use === 'founder' ? (M.info.hasRel ? 'warm' : null) : st.use === 'career' ? 'new' : 'level';
      if (sort) setQuery({sort});
      st.step = 2; render();
    },
    async contacts(){
      st.error = ''; st.working = true; render();
      try { st.built = await startFromContacts(); st.step = 3; }
      catch (e) { st.error = (e && e.message) || String(e); }
      st.working = false; render();
    },
    haveFile(){ finish(() => open('import')); },
    sample(){ finish(); },
    ask(){ fx.tap(); openURL(LINKEDIN_EXPORT); exportRequested(); finish(); },
    later(){ finish(); },
  };
  render();
  requestAnimationFrame(() => el.classList.add('in'));
}
register('onboarding', openOnboarding);
