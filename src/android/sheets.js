// Sheets: ready-made messages, the Monday brief, the share card preview.
// Ports MessageSheet.swift, WeeklyBrief.swift (WeeklyBriefView) and ShareCard.swift.
import { M, person, full, messages, weeklyPicks, weeklyDone, replacePick, weekStart, touched, myInitials, isSample, show } from './model.js';
import { esc, fmt, icon, avatar, Day, menu, empty, $, $$, plural } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { openPerson, register } from './actions.js';
import { copy, openURL, shareText, shareFile, fx } from './platform.js';
import { drawCompass } from './compass.js';

/* ---------- message drafts ---------- */
export function openMessage(k, ctx = {}){
  const p = full(k); if (!p) return;
  const drafts = messages(k, ctx);
  let picked = drafts[0] ? drafts[0].id : '';
  const profile = (p.links && p.links.profile) || '';
  openSheet({
    title: `Message ${p.f}`, left: ['Close'], full: true,
    mount(body){
      body.innerHTML = `${drafts.length ? `<p class="sec-h">Start from</p><div class="chips-scroll pad">${drafts.map(d => `<button type="button" class="chip ${d.id === picked ? 'on' : ''}" data-a="pick" data-v="${esc(d.id)}">${esc(d.label)}</button>`).join('')}</div>` : ''}
        <p class="sec-h">Your message</p>
        <div class="card"><textarea class="msg-text" rows="9" aria-label="Your message">${esc(drafts[0] ? drafts[0].text : '')}</textarea></div>
        <p class="foot">Edit it to sound like you. LinkedIn doesn’t let other apps send messages, so Bearings copies the text and opens their profile. Tap Message there and paste.</p>
        <div class="card list actions">
          ${profile ? `<button type="button" class="row act" data-a="copyOpen">${icon('ext')}<span>Copy and open LinkedIn</span></button>` : ''}
          ${p.e ? `<button type="button" class="row act" data-a="email">${icon('mail')}<span>Email instead</span></button>` : ''}
          <button type="button" class="row act" data-a="share">${icon('share')}<span>Share</span></button>
          <button type="button" class="row act" data-a="copy">${icon('copy')}<span>Copy</span></button>
        </div>`;
    },
    handlers: {
      pick(id, t){ picked = id; const d = drafts.find(x => x.id === id); $('.msg-text', t.closest('.sheet')).value = d ? d.text : ''; $$('[data-a="pick"]', t.closest('.sheet')).forEach(b => b.classList.toggle('on', b.dataset.v === id)); fx.select(); },
      async copyOpen(_, t){ const txt = $('.msg-text', t.closest('.sheet')).value; await copy(txt); fx.success(); show('Copied. Paste it into LinkedIn.'); openURL(profile); closeSheet(); },
      email(_, t){ const txt = $('.msg-text', t.closest('.sheet')).value; openURL(`mailto:${encodeURIComponent(p.e)}?body=${encodeURIComponent(txt)}`); closeSheet(); },
      async share(_, t){ const r = await shareText($('.msg-text', t.closest('.sheet')).value, `Message ${p.f}`); if (r === 'copied') show('Copied'); },
      async copy(_, t){ await copy($('.msg-text', t.closest('.sheet')).value); fx.success(); show('Copied'); },
    },
  });
}

/* ---------- the Monday brief ---------- */
export function openWeekly(){
  let picks = weeklyPicks();
  const render = body => {
    const done = picks.filter(p => weeklyDone(p.k)).length;
    body.innerHTML = `<div class="wk-head"><p class="eyebrow mono">WEEK OF ${esc(Day.nice(weekStart()).toUpperCase())}</p><h1>Five people worth your time</h1><p class="muted">One reason and a ready-made message for each. Mark them done as you go.</p>
        ${picks.length ? `<div class="progress"><i style="width:${(done / picks.length * 100).toFixed(1)}%"></i></div>` : ''}</div>
      ${!picks.length ? empty('checkCircle', 'Nothing pressing this week', 'No one’s waiting on you and your circles are up to date. Enjoy it.') : ''}
      ${picks.map(w => { const p = person(w.k); if (!p) return ''; const d = weeklyDone(w.k);
        return `<div class="card wk-card ${d ? 'done' : ''}"><button type="button" class="wk-person" data-a="open" data-v="${esc(p.k)}">${avatar(p, 48)}<span><b>${esc(p.full)}</b><span class="muted">${esc([p.p, p.c].filter(Boolean).join(' · '))}</span></span>${d ? `<span class="done-ic">${icon('checkFill')}</span>` : ''}</button>
          <p class="why">${esc(w.why)}</p>
          ${d ? '' : `<div class="btn-row"><button type="button" class="btn prominent" data-a="write" data-v="${esc(p.k)}">${icon('pencil')}Write</button><button type="button" class="btn" data-a="done" data-v="${esc(p.k)}">${icon('check')}Done</button><button type="button" class="btn icon-only" data-a="more" data-v="${esc(p.k)}" aria-label="More">${icon('more')}</button></div>`}</div>`; }).join('')}
      ${picks.length && done === picks.length ? `<p class="good-line">${icon('checkCircle')}All done for this week. A new five arrive Monday morning.</p>` : ''}`;
  };
  openSheet({
    title: 'This week', right: ['Done'], full: true,
    mount: render,
    update(body){ render(body); },
    handlers: {
      open(k){ closeSheet(); openPerson(k); },
      write(k){ openMessage(k); },
      done(k){ touched(k); },
      more(k, t){ menu(t, [{label: 'Someone else instead', icon: 'shuffle', run: () => { picks = replacePick(k, picks); fx.tap(); render(t.closest('.sheet-body')); }}]); },
    },
  });
}

/* ---------- share card ---------- */
// A picture of your network to post: dots and sectors only, no names, photos or companies.
export function renderShareCard(data, {sample = false, initials = ''} = {}){
  const W = 400, H = 640, S = 2.7; // 1080 x 1728
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext('2d'); ctx.scale(S, S);
  ctx.fillStyle = '#120F22'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 330);
  g.addColorStop(0, 'rgba(58,44,110,0.9)'); g.addColorStop(1, 'rgba(58,44,110,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const P = 26;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#FFB020'; ctx.font = '600 11px "Geist Mono", monospace';
  const label = sample ? 'A SAMPLE NETWORK' : 'MY NETWORK';
  let x = P; for (const ch of label){ ctx.fillText(ch, x, P + 12); x += ctx.measureText(ch).width + 1; }
  drawMark(ctx, W - P - 24, P - 4, 24);
  ctx.fillStyle = '#fff'; ctx.font = '700 38px Geist, sans-serif'; ctx.fillText(`${fmt(data.total)} people`, P, P + 62);
  const parts = [`across ${data.wedges.length} sectors`]; if (data.rel && data.tally.close > 0) parts.push(`${fmt(data.tally.close)} close`);
  ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = '400 15px Geist, sans-serif'; ctx.fillText(parts.join(', '), P, P + 84);
  // the compass, parked at a flattering angle
  const cs = 300, cx0 = (W - cs) / 2, cy0 = P + 84 + 18 + 4;
  ctx.save(); ctx.translate(cx0, cy0);
  drawCompass(ctx, data, cs, {t: 4.6, still: true, pal: {dark: true, accent: '#FFB52E', amber: '#FFB020', good: '#3DD4A3', bad: '#FF7A7F', info: '#7EA6FF', violet: '#A992FF', text: '#FFFFFF', text2: '#8E8E93'}});
  // you, in the middle
  ctx.beginPath(); ctx.arc(cs / 2, cs / 2, 23, 0, Math.PI * 2); ctx.fillStyle = '#2A2448'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,176,32,0.9)'; ctx.beginPath(); ctx.arc(cs / 2, cs / 2, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (initials){ ctx.font = '600 16.5px Geist, sans-serif'; ctx.fillText(initials, cs / 2, cs / 2 + 0.5); }
  else { ctx.beginPath(); ctx.arc(cs / 2, cs / 2 - 4, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cs / 2, cs / 2 + 11, 9, Math.PI, 0); ctx.fill(); }
  ctx.restore();
  // the three biggest sectors
  let y = cy0 + cs + 18 + 14;
  ctx.textBaseline = 'middle';
  for (const w of data.wedges.slice().sort((a, b) => b.n - a.n).slice(0, 3)){
    ctx.fillStyle = w.color; ctx.beginPath(); ctx.arc(P + 4.5, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '500 14px Geist, sans-serif'; ctx.fillText(w.id, P + 19, y);
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '500 14px "Geist Mono", monospace'; ctx.fillText(fmt(w.n), W - P, y);
    y += 26;
  }
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 12px Geist, sans-serif'; ctx.fillText('Mapped with Bearings', P, H - P);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '400 12px Geist, sans-serif'; ctx.fillText('Your network, mapped', W - P, H - P);
  return cv;
}
/** The Bearings mark (brand/bearings-mark.svg), drawn small. */
function drawMark(ctx, x, y, s){
  ctx.save(); ctx.translate(x, y); ctx.scale(s / 1024, s / 1024);
  const bg = ctx.createLinearGradient(0, 0, 1024, 1024); bg.addColorStop(0, '#3D3078'); bg.addColorStop(1, '#1C1636');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, 1024, 1024, 230) : ctx.rect(0, 0, 1024, 1024); ctx.fill();
  ctx.lineCap = 'round'; ctx.lineWidth = 36; ctx.strokeStyle = '#F4F1FF';
  ctx.beginPath(); ctx.arc(512, 512, 300, -0.42 * Math.PI, 1.62 * Math.PI); ctx.stroke();
  for (const [cx, cy, c] of [[589.6, 801.8, '#43D0C0'], [230.1, 614.6, '#A992FF'], [311.3, 289.1, '#FF7A7F']]){ ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#FFB020'; ctx.beginPath(); ctx.arc(724.1, 299.9, 50, 0, Math.PI * 2); ctx.fill();
  ctx.translate(512, 512); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#FF9A30'; ctx.beginPath(); ctx.moveTo(0, -250); ctx.lineTo(64, 0); ctx.lineTo(-64, 0); ctx.fill();
  ctx.fillStyle = 'rgba(244,241,255,0.92)'; ctx.beginPath(); ctx.moveTo(0, 250); ctx.lineTo(64, 0); ctx.lineTo(-64, 0); ctx.fill();
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#1C1636'; ctx.strokeStyle = '#F4F1FF'; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
export function openShare(){
  let png = '';
  openSheet({
    title: 'Share your network', right: ['Done'], full: true,
    async mount(body){
      body.innerHTML = '<div class="share-preview"><div class="spinner"></div></div>';
      if (document.fonts && document.fonts.load) await Promise.all(['700 38px Geist', '600 11px "Geist Mono"', '500 14px Geist'].map(f => document.fonts.load(f).catch(() => {})));
      const data = M.api.compass({});
      const cv = renderShareCard(data, {sample: isSample(), initials: myInitials()});
      const url = cv.toDataURL('image/png');
      body.innerHTML = `<div class="share-preview"><img src="${url}" alt="A picture of your network: ${fmt(data.total)} people across ${data.wedges.length} sectors"></div>
        <p class="lock-note">${icon('lock')}Only dots and sector totals. No names, photos or companies.</p>
        <button type="button" class="btn prominent big" data-a="go">${icon('share')}Share</button>`;
      png = url.split(',')[1];
    },
    handlers: {
      async go(){
        if (!png) return;
        try { await shareFile(`my-network-${new Date().toISOString().slice(0, 10)}.png`, png, {base64: true, type: 'image/png', title: 'My network'}); }
        catch (e) { if (!/cancel/i.test((e && e.message) || '')) show('Couldn’t share: ' + ((e && e.message) || e)); }
      },
    },
  });
}
register('weekly', openWeekly);
register('share', openShare);
register('message', openMessage);
