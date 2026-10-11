// Account trends (your reach into a company over time) and watchlist alerts (news and people
// changes at the companies and agencies you watch). Ports Watchlist.swift.
import { CapacitorHttp } from '@capacitor/core';
import { M, person, trend, targetChanges } from './model.js';
import { esc, fmt, icon, avatar, Day, $ } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { openPerson } from './actions.js';
import { personRow } from './people.js';
import { NATIVE, ls, openURL, fx } from './platform.js';

/* ---------- your reach over time ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Bars for everyone you know there by month, a line for director and up. Plain SVG. */
function chart(months){
  const W = 340, H = 150, L = 26, R = W - 4, T = 8, B = H - 22;
  const max = Math.max(1, ...months.map(m => m.known));
  const step = max <= 4 ? 1 : Math.ceil(max / 4 / (max > 40 ? 10 : max > 12 ? 5 : 1)) * (max > 40 ? 10 : max > 12 ? 5 : 1);
  const top = Math.ceil(max / step) * step;
  const y = v => B - (v / top) * (B - T);
  const slot = (R - L) / months.length, bw = Math.max(4, slot * 0.62);
  const x = i => L + slot * i + slot / 2;
  let grid = '';
  for (let v = 0; v <= top; v += step) grid += `<line x1="${L}" x2="${R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="tg"/><text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" class="tl" text-anchor="end">${v}</text>`;
  const bars = months.map((m, i) => m.known ? `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${y(m.known).toFixed(1)}" width="${bw.toFixed(1)}" height="${(B - y(m.known)).toFixed(1)}" rx="3" class="tb"/>` : '').join('');
  const pts = months.map((m, i) => `${x(i).toFixed(1)},${y(m.senior).toFixed(1)}`);
  const line = `<polyline points="${pts.join(' ')}" class="tline"/>` + months.map((m, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(m.senior).toFixed(1)}" r="2.6" class="tdot"/>`).join('');
  const labels = months.map((m, i) => { const mon = MON[+m.m.slice(5, 7) - 1]; return ['Jan', 'Apr', 'Jul', 'Oct'].includes(mon) ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="tl" text-anchor="middle">${mon}</text>` : ''; }).join('');
  return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="People you know there, by month, over the last year">${grid}${bars}${line}${labels}</svg>`;
}
export function trendSection(name){
  const t = trend(name);
  if (!t || !t.now || !t.now.known) return '';
  const first = (t.months[0] || {}).known || 0, last = (t.months[t.months.length - 1] || {}).known || 0;
  const s = t.snaps || [], a = s[0], b = s[s.length - 1];
  return `<p class="sec-h">Your reach over time</p><div class="card pad trend">
    <div class="trend-top"><b class="mono">${fmt(last)}</b><span class="muted small">people you know there</span>${last > first ? `<span class="good small strong trend-up">${icon('upRight')}+${fmt(last - first)} this year</span>` : ''}</div>
    ${chart(t.months)}
    <div class="trend-legend"><span><i class="dot" style="background:color-mix(in srgb, var(--info) 50%, transparent)"></i>Everyone you know</span><span><i class="dot" style="background:var(--accent)"></i>Director and up</span></div>
    ${s.length >= 2 ? `<p class="small ${b.score >= a.score ? 'good' : 'bad'}">Coverage score ${a.score} → ${b.score} since ${esc(Day.nice(a.d))}.</p>` : ''}
  </div>`;
}

/* ---------- news ---------- */
// Headlines about the companies and agencies you watch, from Google News, fetched on the phone
// a few times a day. Nothing about you is sent: only the company names you watch.
const NEWS_KEY = 'bearings.news', FRESH = 4 * 3600e3;
let news = ls.json(NEWS_KEY, null) || {at: 0, key: '', items: []};
let fetching = null;
const newsURL = name => `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" when:14d`)}&hl=en-US&gl=US&ceid=US:en`;
async function getText(url){
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) {
    // the WebView blocks cross-origin reads; the native HTTP client doesn't have that limit
    if (!NATIVE) return '';
    try {
      const r = await CapacitorHttp.get({url, responseType: 'text', connectTimeout: 12000, readTimeout: 12000});
      return r && r.status >= 200 && r.status < 300 ? String(r.data || '') : '';
    } catch { return ''; }
  }
}
function parseRSS(text, target){
  if (!text) return [];
  let doc; try { doc = new DOMParser().parseFromString(text, 'text/xml'); } catch { return []; }
  const out = [];
  for (const it of doc.querySelectorAll('item')){
    const g = n => ((it.getElementsByTagName(n)[0] || {}).textContent || '').trim();
    let title = g('title'); const source = g('source'), link = g('link');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const d = Date.parse(g('pubDate'));
    if (title && link) out.push({target, title, source, link, date: isNaN(d) ? Date.now() : d});
    if (out.length >= 6) break;
  }
  return out;
}
/** Refreshes the headlines at most every four hours, or when the watchlist changes. Never throws. */
export function refreshNews(force = false){
  const names = M.targets.map(t => t.name).slice(0, 8);
  const key = names.join('|');
  if (!names.length) return Promise.resolve(false);
  if (!force && news.key === key && Date.now() - news.at < FRESH) return Promise.resolve(false);
  if (fetching) return fetching;
  fetching = (async () => {
    const all = (await Promise.all(names.map(async n => parseRSS(await getText(newsURL(n)), n).filter(Boolean)))).flat();
    const since = Date.now() - 10 * 864e5, seen = new Set();
    const items = all.filter(h => h.date >= since).sort((a, b) => b.date - a.date).filter(h => { const k = h.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    // keep the old headlines if nothing came back (offline, or blocked)
    news = {at: Date.now(), key, items: all.length ? items : news.items};
    ls.set(NEWS_KEY, JSON.stringify(news));
    return true;
  })().catch(() => false).finally(() => { fetching = null; });
  return fetching;
}
export const headlines = () => news.items.filter(h => M.targets.some(t => t.name === h.target));
function ago(ms){
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min. ago`;
  if (s < 86400) return `${Math.round(s / 3600)} ${Math.round(s / 3600) === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
const headline = (h, i) => `<button type="button" class="row headline" data-a="newsOpen" data-v="${i}"><span class="hl-main"><span class="eyebrow mono">${esc(h.target.toUpperCase())}</span><b class="serif">${esc(h.title)}</b><span class="muted small">${esc([h.source, ago(h.date)].filter(Boolean).join(' · '))}</span></span></button>`;

/* ---------- Today: on your watchlist ---------- */
let slot = null;
export function watchlistCard(el){
  slot = el;
  const changes = targetChanges(), heads = headlines().slice(0, 3);
  el.innerHTML = changes.length || heads.length ? `<section class="card list watch-card">
      <div class="card-head static"><p class="eyebrow mono muted">ON YOUR WATCHLIST</p><button type="button" class="link small" data-a="watchAll">All</button></div>
      ${changes.slice(0, 2).map(c => { const p = person(c.k); return `<button type="button" class="row wchange" data-a="open" data-v="${esc(c.k)}">${p ? avatar(p, 34, {star: false}) : ''}<span class="wc-main"><span class="small strong info">${esc(`${c.kind === 'moved' ? 'Now at' : 'New connection at'} ${c.target}`)}</span><span class="wc-who">${esc(c.name + (c.p ? `, ${c.p}` : ''))}</span></span></button>`; }).join('')}
      ${heads.map(headline).join('')}
    </section>` : '';
  refreshNews().then(changed => { if (changed && slot && slot.isConnected) watchlistCard(slot); });
}
export function openWatchAll(){
  const render = body => {
    const changes = targetChanges(), heads = headlines();
    const groups = {};
    heads.forEach((h, i) => { (groups[h.target] = groups[h.target] || []).push([h, i]); });
    body.innerHTML = `${changes.length ? `<p class="sec-h">People</p><div class="card list">${changes.map(c => { const p = person(c.k); return p ? personRow(p, {sub: `${c.kind === 'moved' ? 'Moved to' : 'New connection at'} ${c.target}`}) : ''; }).join('')}</div>` : ''}
      ${Object.keys(groups).sort().map(t => `<p class="sec-h">${esc(t)}</p><div class="card list">${groups[t].map(([h, i]) => `<button type="button" class="row headline" data-a="newsOpen" data-v="${i}"><span class="hl-main"><b>${esc(h.title)}</b><span class="muted small">${esc([h.source, ago(h.date)].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>`).join('')}
      ${!changes.length && !heads.length ? '<p class="foot">Nothing new at the companies you watch yet.</p>' : ''}
      <p class="foot">Headlines come from Google News. Bearings sends only the names on your watchlist, nothing about you.</p>
      <button type="button" class="btn top12" data-a="reload">${icon('refresh')}Check for news</button>`;
  };
  openSheet({
    title: 'Watchlist', right: ['Done'], full: true,
    mount: render,
    handlers: {
      open(k){ closeSheet(); openPerson(k); },
      newsOpen(i){ const h = headlines()[+i]; if (h) openURL(h.link); },
      async reload(_, t){ fx.tap(); const body = t.closest('.sheet-body'); await refreshNews(true); render(body); if (slot && slot.isConnected) watchlistCard(slot); },
    },
  });
}
export const watchHandlers = {
  watchAll: () => { fx.tap(); openWatchAll(); },
  newsOpen: i => { const h = headlines()[+i]; if (h) openURL(h.link); },
};
