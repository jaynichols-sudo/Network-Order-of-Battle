// Bearings Team on Android: the encrypted team (teamsync.js), the team overview, team pack
// files shared by hand, and the year in review. The same files and card as the iPhone.
import { M, show, isSample, saveFile, persons, refreshAll } from './model.js';
import { esc, icon, fmt, Day, plural, $, menu, prompt, confirmDialog } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { register, openPerson } from './actions.js';
import { prefs, shareFile, shareText, copy, openURL, fx } from './platform.js';
import { allow } from './pro.js';
import * as T from './teamsync.js';

/* ---------- team packs (files shared by hand) ---------- */
export async function addTeamPackText(text){
  if (!allow('team')) return;
  try {
    const r = M.api.addTeamPack(text);
    await saveFile('team', 'team.json');
    refreshAll();
    fx.success();
    show(`Added ${r.owner}’s ${fmt(r.count)} people to Ways in`);
  } catch (e) { show('Couldn’t add that pack: ' + ((e && e.message) || e)); }
}
const errText = e => (e && e.message) || String(e);
const ROLE = {owner: 'Owner', admin: 'Admin', member: 'Member'};

/* ---------- the team screen ---------- */
// What the screen knows between renders. `info` comes from the server; everything else is local.
const ctx = {info: null, bill: null, loading: false, error: '', inviting: false, inv: {role: 'member', uses: 10, days: 14}, link: ''};
// the sample team is never saved: it lasts until the app restarts or you end it
const previewing = () => M.api.teamList().some(t => /^demo-/.test(t.id));

function pitch(){
  return `<div class="card pad team-pitch"><h2 class="serif">Pool who your team knows, privately.</h2>
      <p>Everything is encrypted on your phone before it leaves; the Bearings server can’t read it.</p>
      <p class="muted small">Teammates see names, titles, employers and how well you know each person, plus your pursuits and watchlist. Never notes, messages, emails or tags.</p></div>
    <div class="btn-stack"><button type="button" class="btn prominent big block" data-a="start">${icon('people')}Start a team</button>
      <button type="button" class="btn big block" data-a="joinLink">${icon('link')}Join with a link</button></div>
    <p class="foot">A team gets a 30-day free trial for up to 5 people. Everyone on a team gets Bearings Pro.</p>`;
}

function memberRow(m, info){
  const mine = m.id === info.me.id, myRole = info.me.role;
  const shared = M.api.teamList().find(t => t.id === m.id);
  const count = mine ? (isSample() ? 'sample network, not shared' : plural(M.info.count, 'person', 'people')) : shared ? plural(shared.count, 'person', 'people') : 'nothing shared yet';
  const last = m.shareUpdated ? `shared ${T.ago(m.shareUpdated)}` : '';
  const canAct = !mine && m.role !== 'owner' && (myRole === 'owner' || (myRole === 'admin' && m.role === 'member'));
  return `<div class="row static team-row"><span class="grow"><b>${esc(m.name)}${mine ? ' (you)' : ''}</b><span class="muted small">${esc([m.title, ROLE[m.role]].filter(Boolean).join(' · '))}</span><span class="muted small">${esc([count, last].filter(Boolean).join(' · '))}</span></span>
    ${canAct ? `<button type="button" class="tool small" data-a="memberMenu" data-v="${esc(m.id)}" aria-label="${esc(`Options for ${m.name}`)}">${icon('more')}</button>` : ''}</div>`;
}

function inviteBlock(info){
  if (!(info.me.role === 'owner' || info.me.role === 'admin')) return '';
  if (info.team.readOnly) return '<p class="foot">This team is read-only, so it can’t invite anyone until it’s subscribed.</p>';
  const opt = (name, list, cur) => `<span class="select"><select data-ch="${name}" aria-label="${name}">${list.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${icon('chevD')}</span>`;
  const form = ctx.inviting ? `<div class="card form top12">
      <div class="frow"><span>Role</span>${opt('invRole', [['member', 'Member'], ...(info.me.role === 'owner' ? [['admin', 'Admin']] : [])], ctx.inv.role)}</div>
      <div class="frow"><span>Uses</span>${opt('invUses', [1, 5, 10, 25, 50].map(n => [n, plural(n, 'person', 'people')]), ctx.inv.uses)}</div>
      <div class="frow"><span>Expires in</span>${opt('invDays', [1, 7, 14, 30].map(n => [n, plural(n, 'day', 'days')]), ctx.inv.days)}</div>
      <div class="btn-row"><button type="button" class="btn prominent" data-a="makeInvite">Create link</button><button type="button" class="btn" data-a="cancelInvite">Cancel</button></div></div>` : '';
  const link = ctx.link ? `<div class="card pad top12 invite-out"><p class="small muted">Send this link to your teammate. The part after the # is the team key, so share it only with people you trust.</p>
      <p class="invite-link mono">${esc(ctx.link)}</p>
      <div class="btn-row"><button type="button" class="btn" data-a="copyLink">${icon('copy')}Copy</button><button type="button" class="btn prominent" data-a="shareLink">${icon('share')}Share</button></div></div>` : '';
  const open = info.invites.length ? `<p class="sec-h">Open invites</p><div class="card list">${info.invites.map(i => `<div class="row static team-row"><span class="grow"><b class="mono">${esc(i.code)}</b><span class="muted small">${esc(`${ROLE[i.role]} · ${plural(i.usesLeft, 'use', 'uses')} left · until ${Day.nice(new Date(i.expires).toISOString())}`)}</span></span>
      <button type="button" class="pill-btn soft small" data-a="copyInvite" data-v="${esc(i.code)}">Copy link</button><button type="button" class="pill-btn soft small bad" data-a="revoke" data-v="${esc(i.code)}">Revoke</button></div>`).join('')}</div>` : '';
  return `${ctx.inviting ? form : `<div class="btn-stack"><button type="button" class="btn prominent big block" data-a="invite">${icon('personPlus')}Invite people</button></div>`}${link}${open}`;
}

function billingBlock(info){
  if (info.me.role !== 'owner' || !ctx.bill) return '';
  const b = ctx.bill, paid = b.plan !== 'trial';
  if (!b.canCheckout && !paid) return '';
  return `<p class="sec-h">Billing</p><div class="card list">
      ${b.canCheckout ? `<button type="button" class="row act" data-a="seats">${icon('plusCircle')}<span>Add seats</span><span class="muted">${esc(`${b.used} of ${b.seats} used`)}</span></button>` : ''}
      ${paid ? `<button type="button" class="row act" data-a="portal">${icon('card')}<span>Manage billing</span>${icon('ext', 'chev')}</button>` : ''}</div>
    <p class="foot">Teams pay per seat, yearly, on the web.</p>`;
}

function teamBlock(){
  const st = T.teamState(), info = ctx.info;
  if (!info) return `<div class="card pad"><h2>${esc(st.teamName || 'Your team')}</h2><p class="muted">${ctx.error ? esc(ctx.error) : 'Loading…'}</p>
      ${ctx.error ? '<div class="btn-row left"><button type="button" class="btn small" data-a="reload">Try again</button></div>' : ''}</div>`;
  const t = info.team, owner = info.me.role === 'owner';
  return `<div class="card pad team-head"><h2>${esc(t.name)}</h2>
      <p class="muted">${esc(T.planLine(t))} · ${esc(`${info.members.length} of ${t.seats} seats used`)}</p>
      <div class="row-between top12"><span class="muted small">${T.isSyncing() ? 'Syncing…' : esc(`Last synced ${T.ago(st.lastSync)}`)}</span><button type="button" class="btn small" data-a="sync" ${T.isSyncing() ? 'disabled' : ''}>${icon('refresh')}Sync now</button></div></div>
    ${t.readOnly ? '<p class="foot bad">The trial ended. You can still see what’s here, but shares won’t update and no one new can join until the team is subscribed.</p>' : ''}
    ${isSample() ? '<p class="foot">You’re on the sample network, so nothing of yours is shared. Import your own network to share it with the team.</p>' : ''}
    ${ctx.error ? `<p class="foot bad" role="alert">${esc(ctx.error)}</p>` : ''}
    <p class="sec-h">Members</p><div class="card list">${info.members.map(m => memberRow(m, info)).join('')}</div>
    ${inviteBlock(info)}
    ${billingBlock(info)}
    <div class="card list top12">${owner
      ? `<button type="button" class="row act danger" data-a="deleteTeam">${icon('trash')}<span>Delete team</span></button>`
      : `<button type="button" class="row act danger" data-a="leave">${icon('uturn')}<span>Leave team</span></button>`}</div>
    ${owner && info.members.length > 1 ? '<p class="foot">To leave, make someone else the owner first.</p>' : ''}`;
}

function overview(){
  if (!M.api.teamList().length) return '';
  const o = M.api.teamOverview();
  const stat = (v, l) => `<div class="stat"><b class="mono">${esc(v)}</b><span class="muted small">${esc(l)}</span></div>`;
  // "Dana Whitfield (you know well)", "Grace Liu (Pat knows a little)"
  const via = x => { const you = x.owner === 'You', who = you ? 'you' : x.owner.split(/\s+/)[0], v = you ? 'know' : 'knows';
    return `${who} ${v}${x.b === 'strong' ? ' well' : x.b === 'warm' ? '' : ' a little'}`; };
  const pursuits = o.pursuits.slice(0, 30).map(p => `<div class="row static team-row"><span class="grow"><b>${esc(p.name)}</b>
      <span class="muted small">${esc([p.agency, p.stage, p.due ? `due ${Day.nice(p.due)}` : ''].filter(Boolean).join(' · '))}</span>
      <span class="muted small">${esc(p.owner === 'You' ? 'Yours' : p.owner)}</span></span><span class="seats mono small ${p.filled >= p.roles ? 'good' : ''}" aria-label="${esc(`${p.filled} of ${p.roles} seats filled`)}">${p.filled}/${p.roles}</span></div>`).join('');
  const targets = o.targets.slice(0, 30).map(t => `<div class="row static team-row"><span class="grow"><b>${esc(t.name)}</b>
      <span class="muted small">${esc(`Watched by ${t.owners.join(', ')} · ${plural(t.people, 'person', 'people')} known`)}</span>
      ${t.best.length ? `<span class="muted small wrap">${esc('Best paths: ' + t.best.map(b => `${b.name} (${via(b)})`).join(', '))}</span>` : '<span class="muted small bad">No one on the team knows anyone here yet</span>'}</span></div>`).join('');
  const shares = !T.onTeam() && o.members.length ? `<p class="sec-h">Teammates</p><div class="card list">${o.members.map(m => `<div class="row static team-row"><span class="grow"><b>${esc(m.owner)}</b><span class="muted small">${esc(`${plural(m.count, 'person', 'people')} · ${plural(m.agencies, 'agency', 'agencies')} · ${plural(m.pursuits, 'pursuit', 'pursuits')}`)}</span></span></div>`).join('')}</div>` : '';
  return `<p class="sec-h">Team overview</p>
    <div class="card stats3 team-reach">${stat(fmt(o.people), 'people across the team')}${stat(`${o.agencies.team}/${o.agencies.total}`, 'agencies with the team')}${stat(`${o.agencies.mine}`, 'agencies on your own')}</div>
    <p class="foot">With the team, ${o.coverage.team.covered} agencies are covered and ${o.coverage.team.thin} thin. On your own: ${o.coverage.mine.covered} covered, ${o.coverage.mine.thin} thin.</p>
    ${shares}
    <p class="sec-h">Team pursuits</p>${pursuits ? `<div class="card list">${pursuits}</div><p class="foot">Seats filled out of the six decision-maker roles.</p>` : '<p class="foot">No pursuits on the team yet.</p>'}
    <p class="sec-h">Team watchlist</p>${targets ? `<div class="card list">${targets}</div>` : '<p class="foot">No one on the team is watching anything yet.</p>'}`;
}

function packs(){
  const list = M.api.teamList().filter(p => !p.id);
  return `<p class="sec-h">Share a file instead</p>
    <div class="card pad"><p class="small">No server at all: each person shares a pack file, everyone adds the others’ packs, and Ways in shows who on the team knows someone at an account.</p></div>
    <div class="btn-row"><button type="button" class="btn" data-a="share" ${isSample() ? 'disabled' : ''}>${icon('share')}Share my pack</button>
      <button type="button" class="btn" data-a="add">${icon('plus')}Add a pack</button></div>
    ${isSample() ? '<p class="foot">Import your own network to share a pack.</p>' : ''}
    ${list.length ? `<div class="card list top12">${list.map(p => `<div class="row static team-row"><span class="grow"><b>${esc(p.owner)}</b><span class="muted small">${esc(`${plural(p.count, 'person', 'people')} · shared ${Day.nice(p.made)}`)}</span></span>
      <button type="button" class="pill-btn soft" data-a="remove" data-v="${esc(p.owner)}" aria-label="${esc(`Remove ${p.owner}’s pack`)}">Remove</button></div>`).join('')}</div>` : ''}`;
}

function render(body){
  if (!body) return;
  const sc = body.scrollTop;
  const server = T.teamEnabled() ? (T.onTeam() ? teamBlock() : pitch()) : '';
  const pv = previewing();
  const sample = isSample() && !T.onTeam() ? `<div class="card pad top12"><p class="small">${pv ? 'Showing three made-up teammates. Nothing is saved or sent anywhere.' : 'See what a team looks like with three made-up teammates.'}</p>
      <div class="btn-row left"><button type="button" class="btn small ${pv ? '' : 'prominent'}" data-a="preview">${pv ? 'End the preview' : 'Preview with a sample team'}</button></div></div>` : '';
  body.innerHTML = `<div class="team">${server}${sample}${overview()}${packs()}
    <p class="lock-note">${icon('lock')}Shares hold names, titles, companies and how well you know each person. Never notes, messages, emails or tags.</p></div>`;
  body.scrollTop = sc;
}

async function load(body){
  if (!T.onTeam()) { render(body); return; }
  ctx.loading = true;
  try {
    ctx.info = await T.teamInfo(); ctx.error = '';
    ctx.bill = ctx.info.me.role === 'owner' ? await T.billing().catch(() => null) : null;
  } catch (e) { ctx.error = errText(e); if (e.gone) ctx.info = null; }
  ctx.loading = false;
  render(body);
}

async function doSync(body, quiet = false){
  const p = T.sync({quiet});
  render(body);
  try { const r = await p; if (r && r.info) ctx.info = r.info; ctx.error = ''; }
  catch (e) { ctx.error = errText(e); if (e.gone){ ctx.info = null; show(ctx.error); } }
  await load(body);
}

export function openTeam(){
  ctx.info = null; ctx.error = ''; ctx.link = ''; ctx.inviting = false; ctx.bill = null;
  const body0 = () => { const s = document.querySelector('.sheet-layer.team-sheet .sheet-body'); return s; };
  openSheet({
    title: 'Team', right: ['Done'], full: true, cls: 'team-sheet',
    mount(body){ render(body); load(body); },
    update(body){ render(body); },
    handlers: {
      start: () => openStart(() => { const b = body0(); ctx.info = null; render(b); load(b); }),
      joinLink: () => openJoin(null, () => { const b = body0(); ctx.info = null; render(b); load(b); }),
      reload: (_, t) => load(t.closest('.sheet-body')),
      sync: (_, t) => doSync(t.closest('.sheet-body')),
      invite(_, t){ ctx.inviting = true; ctx.link = ''; render(t.closest('.sheet-body')); },
      cancelInvite(_, t){ ctx.inviting = false; render(t.closest('.sheet-body')); },
      invRole(v){ ctx.inv.role = v; },
      invUses(v){ ctx.inv.uses = +v; },
      invDays(v){ ctx.inv.days = +v; },
      async makeInvite(_, t){
        const body = t.closest('.sheet-body');
        try { const r = await T.invite(ctx.inv); ctx.link = r.link; ctx.inviting = false; fx.success(); }
        catch (e) { show(errText(e)); }
        await load(body);
      },
      async copyLink(){ if (await copy(ctx.link)) show('Invite link copied'); },
      async shareLink(){ const r = await shareText(`Join my team on Bearings: ${ctx.link}`, 'Join my team on Bearings'); if (r === 'copied') show('Invite link copied'); },
      async copyInvite(code){ try { if (await copy(await T.linkFor(code))) show('Invite link copied'); } catch (e) { show(errText(e)); } },
      async revoke(code, t){
        const body = t.closest('.sheet-body');
        if (!(await confirmDialog({title: 'Revoke this invite?', message: 'The link stops working right away. People who already joined stay on the team.', ok: 'Revoke', danger: true}))) return;
        try { await T.revokeInvite(code); show('Invite revoked'); } catch (e) { show(errText(e)); }
        await load(body);
      },
      memberMenu(id, t){
        const body = t.closest('.sheet-body'), info = ctx.info; if (!info) return;
        const m = info.members.find(x => x.id === id); if (!m) return;
        const owner = info.me.role === 'owner', items = [];
        const act = (fn, done) => async () => { try { await fn(); fx.success(); show(done); } catch (e) { show(errText(e)); } await doSync(body, true); };
        if (owner && m.role === 'member') items.push({label: 'Make admin', icon: 'starCircle', run: act(() => T.setRole(id, 'admin'), `${m.name} is now an admin`)});
        if (owner && m.role === 'admin') items.push({label: 'Make member', icon: 'user', run: act(() => T.setRole(id, 'member'), `${m.name} is now a member`)});
        if (owner) items.push({label: 'Make owner', icon: 'seal', run: async () => {
          if (!(await confirmDialog({title: `Make ${m.name} the owner?`, message: 'They’ll handle billing and can delete the team. You’ll become an admin.', ok: 'Make owner'}))) return;
          await act(() => T.setRole(id, 'owner'), `${m.name} is now the owner`)();
        }});
        items.push({label: 'Remove from team', icon: 'trash', danger: true, run: async () => {
          if (!(await confirmDialog({title: `Remove ${m.name}?`, message: 'Their share is deleted from the server and they lose access right away.', ok: 'Remove', danger: true}))) return;
          await act(() => T.removeMember(id), `Removed ${m.name}`)();
        }});
        menu(t, items);
      },
      async leave(_, t){
        const body = t.closest('.sheet-body');
        if (!(await confirmDialog({title: 'Leave the team?', message: 'Your share is deleted from the server, and your teammates’ shares are removed from this phone.', ok: 'Leave', danger: true}))) return;
        try { await T.leave(); ctx.info = null; fx.success(); show('You left the team'); } catch (e) { show(errText(e)); }
        render(body);
      },
      async deleteTeam(_, t){
        const body = t.closest('.sheet-body'), name = (ctx.info && ctx.info.team.name) || '';
        if (!(await confirmDialog({title: 'Delete the team?', message: `This deletes every member’s share, the invites and the team for everyone. Type ${name} to confirm.`, ok: 'Delete', danger: true, type: name}))) return;
        try { await T.deleteTeam(); ctx.info = null; fx.success(); show('Team deleted'); } catch (e) { show(errText(e)); }
        render(body);
      },
      async seats(_, t){
        const b = ctx.bill; if (!b) return;
        const v = await prompt({title: 'How many seats?', message: `You’re using ${b.used}. Teams pay per seat, yearly.`, value: String(Math.max(b.seats, b.used + 5)), ok: 'Continue'});
        const n = parseInt(v, 10); if (!n) return;
        try { const r = await T.checkout(n); openURL(r.url); } catch (e) { show(errText(e)); }
      },
      async portal(){ try { const r = await T.portal(); openURL(r.url); } catch (e) { show(errText(e)); } },
      preview(_, t){
        M.api.setTeamShares(previewing() ? [] : M.api.demoTeamShares());
        fx.tap(); refreshAll(); render(t.closest('.sheet-body'));
      },
      async share(){
        const me = (prefs.name || '').trim();
        try { await shareFile(`Bearings team pack${me ? ' - ' + me : ''}.json`, M.api.teamPack(me || 'A teammate'), {title: 'Share your team pack'}); }
        catch (e) { if (!/cancel/i.test((e && e.message) || '')) show('Couldn’t share: ' + errText(e)); }
      },
      add(_, t){
        if (!allow('team')) return;
        const body = t.closest('.sheet-body');
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
        i.onchange = async () => { const f = i.files && i.files[0]; if (f){ await addTeamPackText(await f.text()); render(body); } };
        i.click();
      },
      async remove(owner, t){ M.api.removeTeamPack(owner); await saveFile('team', 'team.json'); refreshAll(); render(t.closest('.sheet-body')); },
    },
  });
}
register('team', openTeam);

/* ---------- start a team ---------- */
function openStart(done){
  const st = {team: '', name: (prefs.name || '').trim(), title: '', busy: false, err: ''};
  const ok = () => st.team.trim() && st.name.trim() && !st.busy;
  let sheet = null;
  const sync = () => { const b = sheet && $('[data-sb="r"]', sheet.el); if (b) b.disabled = !ok(); };
  sheet = openSheet({
    title: 'Start a team', left: ['Cancel'], full: true,
    right: ['Start', async s => {
      if (!ok()) return;
      st.busy = true; st.err = ''; sync(); $('.form-err', s.body).textContent = 'Setting up your team…';
      try { await T.createTeam(st.team, st.name, st.title); fx.success(); closeSheet(s); show(`Started ${st.team.trim()}`); done && done(); }
      catch (e) { st.busy = false; sync(); $('.form-err', s.body).textContent = errText(e); }
    }],
    mount(body){
      body.innerHTML = `<div class="card form">
          <input type="text" class="field" data-in="team" placeholder="Team name, like Federal BD" autocomplete="off">
          <input type="text" class="field" data-in="name" value="${esc(st.name)}" placeholder="Your name" autocomplete="name">
          <input type="text" class="field" data-in="title" placeholder="Your title (optional)" autocomplete="organization-title">
        </div>
        <p class="foot form-err" role="alert"></p>
        <p class="lock-note">${icon('lock')}The team name and your profile are encrypted on this phone. The key goes only into the invite links you send.</p>`;
      sync();
      setTimeout(() => { const i = $('input', body); if (i) i.focus(); }, 300);
    },
    handlers: {team(v){ st.team = v; sync(); }, name(v){ st.name = v; sync(); }, title(v){ st.title = v; }},
  });
}

/* ---------- join a team ---------- */
/** With an invite (from a bearings://team/join link) it asks for your name and title; without, it asks for the link too. */
export function openJoin(inv, done){
  if (!T.teamEnabled()) return;
  if (T.onTeam()){ show('You’re already on a team. Leave it first to join another.'); return; }
  const st = {link: '', inv: inv || null, name: (prefs.name || '').trim(), title: '', busy: false};
  let sheet = null;
  const ok = () => !!(st.inv || T.parseInvite(st.link)) && st.name.trim() && !st.busy;
  const sync = () => { const b = sheet && $('[data-sb="r"]', sheet.el); if (b) b.disabled = !ok(); };
  const say = (text, bad = false) => { const e = sheet && $('.form-err', sheet.body); if (e){ e.textContent = text; e.classList.toggle('bad', bad); } };
  sheet = openSheet({
    title: 'Join a team', left: ['Cancel'], full: true,
    right: ['Join', async s => {
      const i = st.inv || T.parseInvite(st.link);
      if (!i || !ok()) return;
      st.busy = true; sync(); say('Joining…');
      try { await T.joinFromLink(i.code, i.key, st.name, st.title); fx.success(); closeSheet(s); show(`You joined ${T.teamState().teamName || 'the team'}`); done ? done() : openTeam(); }
      catch (e) { st.busy = false; sync(); say(errText(e), true); }
    }],
    mount(body){
      body.innerHTML = `${st.inv ? '<div class="card pad"><p>You’re invited to a team on Bearings. Add your name so your teammates know who you are.</p></div>'
          : `<div class="card form"><textarea class="field" rows="3" data-in="link" placeholder="Paste the invite link" autocapitalize="none" autocorrect="off" spellcheck="false"></textarea></div>`}
        <div class="card form top12">
          <input type="text" class="field" data-in="name" value="${esc(st.name)}" placeholder="Your name" autocomplete="name">
          <input type="text" class="field" data-in="title" placeholder="Your title (optional)" autocomplete="organization-title">
        </div>
        <p class="foot form-err" role="alert"></p>
        <p class="lock-note">${icon('lock')}Your name and title are encrypted on this phone before they’re sent. Once you join, a summary of your network is shared with the team. Never notes, messages, emails or tags.</p>`;
      sync();
      if (st.inv) T.checkInvite(st.inv.code).catch(e => say(errText(e), true));
    },
    handlers: {
      link(v){ st.link = v; sync(); say(v.trim() && !T.parseInvite(v) ? 'That doesn’t look like a Bearings invite link.' : '', true); },
      name(v){ st.name = v; sync(); },
      title(v){ st.title = v; },
    },
  });
}
/** bearings://team/join?code=…&k=… from the invite page. */
export function handleTeamUrl(u){
  if (!/^bearings:\/\/team\/join/i.test(u)) return false;
  const inv = T.parseInvite(u);
  if (!T.teamEnabled()) return true;
  if (!inv){ show('That invite link is missing its key. Ask your teammate for a new one.'); return true; }
  closeSheet();
  openJoin(inv);
  return true;
}
register('joinTeam', openJoin);

/* ---------- year in review ---------- */
export const reviewYear = () => { const d = new Date(); return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); };
export const yearSeason = () => { const m = new Date().getMonth(); return m === 11 || m === 0; };

function drawYear(r, sample){
  const W = 400, H = 640, S = 3;
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
  const c = cv.getContext('2d'); c.scale(S, S);
  c.fillStyle = '#120F22'; c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(280, 128, 0, 280, 128, 380); g.addColorStop(0, 'rgba(58,44,110,.9)'); g.addColorStop(1, 'rgba(58,44,110,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const amber = '#FFB020';
  c.fillStyle = amber; c.font = '600 11px "Geist Mono"'; c.fillText((sample ? 'A SAMPLE YEAR' : 'MY YEAR IN NETWORKING').split('').join(String.fromCharCode(8202)), 26, 40);
  c.fillStyle = '#fff'; c.font = '700 64px Geist'; c.fillText(String(r.year), 26, 112);
  let y = 160;
  const stat = (n, label) => { c.fillStyle = amber; c.font = '700 30px Geist'; c.fillText(fmt(n), 26, y); const w = c.measureText(fmt(n)).width; c.fillStyle = 'rgba(255,255,255,.8)'; c.font = '400 16px Geist'; c.fillText(label, 26 + w + 10, y); y += 44; };
  stat(r.joined, 'new connections'); stat(r.moved, 'job changes I caught');
  if (r.hasRel) stat(r.talked, 'people I talked with');
  if (r.reconnected > 0) stat(r.reconnected, 'people I reconnected with');
  y += 4;
  const top = Math.max(1, ...r.months), bw = (W - 52 - 11 * 5) / 12;
  r.months.forEach((n, i) => {
    const h = Math.max(3, 54 * n / top), x = 26 + i * (bw + 5);
    c.fillStyle = i + 1 === r.busiestMonth ? amber : 'rgba(255,255,255,.28)';
    c.beginPath(); c.roundRect(x, y + 54 - h, bw, h, 3); c.fill();
    c.fillStyle = 'rgba(255,255,255,.45)'; c.font = '500 9px "Geist Mono"'; c.textAlign = 'center'; c.fillText('JFMAMJJASOND'[i], x + bw / 2, y + 68); c.textAlign = 'left';
  });
  y += 104;
  if (r.topSectors.length){
    c.fillStyle = 'rgba(255,255,255,.5)'; c.font = '600 10px "Geist Mono"'; c.fillText('WHERE IT GREW', 26, y); y += 22;
    for (const s of r.topSectors){
      c.fillStyle = s.color; c.beginPath(); c.arc(30, y - 5, 4.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.9)'; c.font = '500 14px Geist'; c.fillText(s.id, 45, y);
      c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '500 14px "Geist Mono"'; c.textAlign = 'right'; c.fillText('+' + s.n, W - 26, y); c.textAlign = 'left';
      y += 24;
    }
  }
  c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '600 12px Geist'; c.fillText('Mapped with Bearings', 26, H - 26);
  c.fillStyle = 'rgba(255,255,255,.5)'; c.font = '400 12px Geist'; c.textAlign = 'right'; c.fillText(`${fmt(r.total)} people`, W - 26, H - 26);
  return cv;
}
const spoken = r => [`Your ${r.year} in networking`, `${r.joined} new connections`, `${r.moved} job changes caught`, r.hasRel ? `${r.talked} people you talked with` : '',
  r.reconnected ? `${r.reconnected} people you reconnected with` : '', r.topSectors.length ? 'Grew most in ' + r.topSectors.map(s => s.id).join(', ') : ''].filter(Boolean).join('. ');

export function openYear(){
  let png = '';
  openSheet({
    title: `Your ${reviewYear()}`, right: ['Done'], full: true,
    async mount(body){
      body.innerHTML = '<div class="share-preview"><div class="spinner"></div></div>';
      if (document.fonts && document.fonts.load) await Promise.all(['700 64px Geist', '600 11px "Geist Mono"', '500 14px Geist'].map(f => document.fonts.load(f).catch(() => {})));
      const r = M.api.yearInReview(reviewYear());
      const url = drawYear(r, isSample()).toDataURL('image/png');
      png = url.split(',')[1];
      const close = persons(r.closest);
      body.innerHTML = `<img class="year-card" src="${url}" alt="${esc(spoken(r))}">
        <p class="lock-note">${icon('lock')}Only counts and sectors. No names.</p>
        <button type="button" class="btn prominent big block" data-a="go">${icon('share')}Share</button>
        ${close.length ? `<p class="sec-h">Who you talked with most</p><div class="card list">${close.map(p => `<button type="button" class="row act team-row" data-a="open" data-v="${esc(p.k)}"><span class="grow"><b>${esc(p.full)}</b><span class="muted small">${esc([p.p, p.c].filter(Boolean).join(' at '))}</span></span>${icon('chevR', 'chev')}</button>`).join('')}</div>` : ''}`;
    },
    handlers: {
      async go(){
        if (!png) return;
        try { await shareFile(`my-year-${reviewYear()}.png`, png, {base64: true, type: 'image/png', title: 'My year in networking'}); }
        catch (e) { if (!/cancel/i.test((e && e.message) || '')) show('Couldn’t share: ' + ((e && e.message) || e)); }
      },
      open(k){ closeSheet(); openPerson(k); },
    },
  });
}
register('year', openYear);
