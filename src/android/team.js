// Team packs and the year in review on Android: the same files and the same card as the iPhone.
import { M, show, isSample, saveFile, persons } from './model.js';
import { esc, icon, fmt, Day, plural } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { register, openPerson } from './actions.js';
import { prefs, shareFile, fx } from './platform.js';
import { allow } from './pro.js';

/* ---------- team packs ---------- */
export async function addTeamPackText(text){
  if (!allow('team')) return;
  try {
    const r = M.api.addTeamPack(text);
    await saveFile('team', 'team.json');
    fx.success();
    show(`Added ${r.owner}’s ${fmt(r.count)} people to Ways in`);
  } catch (e) { show('Couldn’t add that pack: ' + ((e && e.message) || e)); }
}

export function openTeam(){
  const render = body => {
    const packs = M.api.teamList();
    body.innerHTML = `<div class="card pad"><p>Find warm paths through your teammates’ networks too. Each person shares a pack, everyone adds the others’ packs, and Ways in shows who on the team knows someone at an account.</p>
        <p class="lock-note">${icon('lock')}A pack holds names, titles, companies and how well you know each person. Never notes, messages, emails or tags. Packs stay on each phone; there’s no server.</p></div>
      <div class="btn-stack"><button type="button" class="btn prominent big block" data-a="share" ${isSample() ? 'disabled' : ''}>${icon('share')}Share my pack</button>
        <button type="button" class="btn big block" data-a="add">${icon('plus')}Add a teammate’s pack</button></div>
      ${isSample() ? '<p class="foot">Import your own network to share a pack.</p>' : ''}
      ${packs.length ? `<p class="sec-h">Your team</p><div class="card list">${packs.map(p => `<div class="row static team-row"><span class="grow"><b>${esc(p.owner)}</b><span class="muted small">${esc(`${plural(p.count, 'person', 'people')} · shared ${Day.nice(p.made)}`)}</span></span>
        <button type="button" class="pill-btn soft" data-a="remove" data-v="${esc(p.owner)}" aria-label="${esc(`Remove ${p.owner}’s pack`)}">Remove</button></div>`).join('')}</div>` : ''}`;
  };
  openSheet({
    title: 'Team packs', right: ['Done'], full: true,
    mount: render,
    handlers: {
      async share(){
        const me = (prefs.name || '').trim();
        try { await shareFile(`Bearings team pack${me ? ' - ' + me : ''}.json`, M.api.teamPack(me || 'A teammate'), {title: 'Share your team pack'}); }
        catch (e) { if (!/cancel/i.test((e && e.message) || '')) show('Couldn’t share: ' + ((e && e.message) || e)); }
      },
      add(_, t){
        if (!allow('team')) return;
        const body = t.closest('.sheet-body');
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
        i.onchange = async () => { const f = i.files && i.files[0]; if (f){ await addTeamPackText(await f.text()); render(body); } };
        i.click();
      },
      async remove(owner, t){ M.api.removeTeamPack(owner); await saveFile('team', 'team.json'); render(t.closest('.sheet-body')); },
    },
  });
}
register('team', openTeam);

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
