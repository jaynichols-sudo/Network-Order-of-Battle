// Small building blocks shared by every screen: escaping, dates, icons, avatars,
// flags, rings, menus and dialogs. Screens are plain HTML strings; actions use
// data-a="name" and are looked up on the nearest element that carries handlers.
import { fx } from './platform.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const fmt = n => Number(n || 0).toLocaleString('en-US');
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
export const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- dates (same wording as the iPhone app) ---------- */
const isoParse = s => { if (!s || s.length < 10) return null; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const Day = {
  today(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  since(s){ const d = isoParse(s); if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t - d) / 864e5); },
  ago(s){ const n = Day.since(s); if (n == null) return ''; if (n <= 0) return 'today'; if (n === 1) return 'yesterday'; if (n < 14) return `${n} days ago`; if (n < 60) return `${Math.round(n / 7)} weeks ago`; if (n < 730) return `${Math.round(n / 30.4)} months ago`; return `${Math.round(n / 365)} years ago`; },
  short(s){ const n = Day.since(s); if (n == null) return ''; if (n < 1) return 'today'; if (n < 14) return `${n}d`; if (n < 60) return `${Math.round(n / 7)}w`; if (n < 730) return `${Math.round(n / 30.4)}mo`; return `${Math.round(n / 365)}y`; },
  nice(s){ const d = isoParse(s); if (!d) return ''; const same = d.getFullYear() === new Date().getFullYear(); return d.toLocaleDateString('en-US', same ? {month: 'short', day: 'numeric'} : {month: 'short', day: 'numeric', year: 'numeric'}); },
  valid: s => !!isoParse(s) && /^\d{4}-\d{2}-\d{2}/.test(s),
};

/* ---------- colors ---------- */
export const BAND = {strong: ['Close', 'good'], warm: ['Warm', 'accent'], light: ['Light touch', 'info'], none: ['No real contact', 'text2']};
export const bandLabel = b => (BAND[b] || BAND.none)[0];
export const bandVar = b => `var(--${(BAND[b] || BAND.none)[1]})`;
export const toneVar = t => ({coral: 'var(--bad)', violet: 'var(--violet)', sky: 'var(--info)', green: 'var(--good)'}[t] || 'var(--accent)');
export const coverageVar = s => s >= 75 ? 'var(--good)' : s >= 45 ? 'var(--accent)' : 'var(--bad)';
/** Resolved colors for canvases, which can't read CSS variables directly. */
export function palette(){
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  return {dark: document.documentElement.dataset.scheme === 'dark', accent: v('--accent'), amber: v('--amber'), good: v('--good'), bad: v('--bad'), info: v('--info'), violet: v('--violet'),
    text: v('--text'), text2: v('--text2-solid'), bg: v('--bg'), card: v('--card'), surface: v('--surface')};
}
export function rgba(hex, a){
  let h = String(hex || '#888').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------- icons ---------- */
const F = ' fill="currentColor" stroke="none"';
const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19z"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.6A5 5 0 0 1 21.5 19"/>',
  building: '<path d="M4 20.5V6a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 14 6v14.5M14 10h4.5A1.5 1.5 0 0 1 20 11.5v9M2.5 20.5h19M7.5 8.5h3M7.5 12h3M7.5 15.5h3"/>',
  scope: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4"/>',
  stack: '<rect x="4" y="7.5" width="16" height="13" rx="2.5"/><path d="M6.5 4h11"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  starFill: `<path${F} d="m12 3.2 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1 6.6 20l1-6.1-4.4-4.3 6.1-.9z"/>`,
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  bellFill: `<path${F} d="M5.2 16.6V11a6.8 6.8 0 0 1 13.6 0v5.6l1.9 2.6H3.3z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>`,
  pencil: '<path d="M11 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-5"/><path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevL: '<path d="M15 5 8 12l7 7"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  more: `<circle${F} cx="5.5" cy="12" r="1.7"/><circle${F} cx="12" cy="12" r="1.7"/><circle${F} cx="18.5" cy="12" r="1.7"/>`,
  sort: '<path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  pin: '<path d="M9 3.5h6l-1 5 3.5 3.5h-11L10 8.5z"/><path d="M12 12v8.5"/>',
  share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10.5H6A1.5 1.5 0 0 0 4.5 12v7.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-2"/>',
  download: '<path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7.5 5h9L19 13M16.5 16.5h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  circleKey: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
  circleInner: `<circle cx="12" cy="12" r="8.5"/><circle${F} cx="12" cy="12" r="4.6"/>`,
  circleWide: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3.2 3"/>',
  touch: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/><path d="m8.5 10.5 2.3 2.3 4.7-4.6"/>',
  reply: '<path d="M9.5 5 3.5 11l6 6"/><path d="M3.5 11H14a6.5 6.5 0 0 1 6.5 6.5V19"/>',
  snow: '<path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4 12 6.5 14.5 4M9.5 20l2.5-2.5 2.5 2.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3 12.5h18"/>',
  personPlus: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
  flag: '<path d="M5 21V4M5 4.5h11l-2 4 2 4H5"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3.5 8 4.5 9 8 12 8zM12 8s1.5-4.5 4-3.5S15 8 12 8z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.2 6.2a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  sparkles: '<path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9z"/><path d="m18.5 15.5.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z"/>',
  mappin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  location: '<path d="M20.5 3.5 3.5 11l7 2.5 2.5 7z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>',
  trend: '<path d="M3.5 17.5 9 12l4 4 7.5-7.5"/><path d="M15 8.5h5.5V14"/>',
  upForward: '<circle cx="12" cy="12" r="9"/><path d="m9 15 6-6M10 9h5v5"/>',
  starCircle: '<circle cx="12" cy="12" r="9"/><path d="m12 7.3 1.4 2.9 3.2.4-2.3 2.2.6 3.2-2.9-1.5-2.9 1.5.6-3.2-2.3-2.2 3.2-.4z"/>',
  zip: '<path d="M6.5 3h7.5l4.5 4.5v12A1.5 1.5 0 0 1 17 21H6.5A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14 3v4.5h4.5M10 5h1.5M10 8h1.5M10 11h1.5M9.5 14h2.5v3h-2.5z"/>',
  contactCheck: '<circle cx="11" cy="8" r="3.5"/><path d="M4 20a7 7 0 0 1 11-5.7"/><path d="m15.5 18 2 2 4-4"/>',
  note: '<path d="M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  arrowIn: '<path d="M17 7 7 17M7 9v8h8"/>',
  arrowOut: '<path d="M7 17 17 7M9 7h8v8"/>',
  bubbles: '<path d="M3.5 6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3.5 3v-3a2 2 0 0 1-2-2z"/><path d="M18.5 9h.5a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-.5v3l-3.5-3h-3.5a1.5 1.5 0 0 1-1.5-1.5"/>',
  uturn: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  play: `<path${F} d="M7 4.5v15l12-7.5z"/>`,
  pause: `<rect${F} x="6" y="5" width="4" height="14" rx="1"/><rect${F} x="14" y="5" width="4" height="14" rx="1"/>`,
  collapse: '<path d="M14 10l6.5-6.5M14 10V5M14 10h5M10 14l-6.5 6.5M10 14v5M10 14H5"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.8 16a3 3 0 0 1 5.4 0M14 10h4M14 13.5h4"/>',
  text: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  waysIn: '<circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><circle cx="12" cy="5" r="2.2"/><path d="M6.2 16.1 10.8 7M17.8 16.1 13.2 7M7.2 18h9.6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3v.2"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8 5.5-5.5"/>',
  checkFill: `<circle${F} cx="12" cy="12" r="10"/><path d="m7.6 12.3 3 3 5.8-5.8" stroke="var(--on-fill, #fff)"/>`,
  plus: '<path d="M12 5v14M5 12h14"/>',
  plusCircle: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  minusCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.2"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  shuffle: '<path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.3 3.4-3M16.5 7H20M17.5 4 20.5 7l-3 3M17.5 14l3 3-3 3M13.2 10c.8-1.7 1.8-3 3.3-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ticket: '<path d="M3.5 8.5V6.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5v2a3.5 3.5 0 0 0 0 7v2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-2a3.5 3.5 0 0 0 0-7z"/><path d="M14.5 5v2.2M14.5 10.9v2.2M14.5 16.8V19"/>',
  plane: '<path d="M21 15.5v-1.8l-7.5-4.7V4.2a1.5 1.5 0 0 0-3 0V9L3 13.7v1.8l7.5-2.2v4.9L8.2 20v1.3l3.8-1 3.8 1V20l-2.3-1.8v-4.9z"/>',
  checklist: '<path d="m3.5 6.5 1.8 1.8L8.5 5M3.5 13.5l1.8 1.8 3.2-3.3M11.5 7h9M11.5 14h9M11.5 20h9M3.5 20h.01"/>',
  waves: '<circle cx="12" cy="12" r="2.2"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13M10 10.5v6.5M14 10.5v6.5"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.alert}</svg>`;

/* ---------- avatars, flags, rings ---------- */
export function avatar(p, size = 40, {star = true} = {}){
  const c = p.color || '#8F89A8';
  return `<span class="av" style="--s:${size}px;--c:${esc(c)}"><span class="av-in" style="font-size:${Math.round(size * 0.36)}px">${esc(p.initials || '?')}</span>${star && p.starred ? `<span class="av-star">${icon('starFill')}</span>` : ''}</span>`;
}
export function meAvatar(initials, size = 34, ring = 1.5){
  return `<span class="me-av" style="--s:${size}px;--r:${ring}px">${initials ? `<span style="font-size:${Math.round(size * 0.36)}px">${esc(initials)}</span>` : icon('user')}</span>`;
}
export const flag = (text, color) => `<span class="flag" style="--fc:${color}">${esc(text)}</span>`;
export function ring(score, size = 52, {label = true} = {}){
  const r = 15.5, C = 2 * Math.PI * r, off = C * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `<span class="ring" style="--s:${size}px"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="ring-bg"/><circle cx="18" cy="18" r="${r}" class="ring-arc" stroke="${coverageVar(score)}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}" data-off="${off.toFixed(2)}"/></svg>${label ? `<b>${score}</b>` : ''}</span>`;
}
/** Starts any coverage rings in el, once they're on screen. */
export function animateRings(el){
  requestAnimationFrame(() => requestAnimationFrame(() => $$('.ring-arc[data-off]', el).forEach(a => { a.style.strokeDashoffset = a.dataset.off; })));
}
export function stack(ps, size = 26){
  if (!ps.length) return '';
  return `<span class="avstack">${ps.slice(0, 5).map(p => avatar(p, size, {star: false})).join('')}${ps.length > 5 ? `<span class="av more" style="--s:${size}px"><span class="av-in" style="font-size:${Math.round(size * 0.34)}px">+${ps.length - 5}</span></span>` : ''}</span>`;
}
export function mixBar(mix){
  const parts = (mix || []).slice(1, 5), total = Math.max(1, parts.reduce((a, b) => a + b, 0));
  const cols = ['var(--violet)', 'color-mix(in srgb, var(--violet) 55%, transparent)', 'var(--accent)', 'var(--fill3)'];
  return `<span class="mixbar">${parts.map((n, i) => n ? `<i style="flex:${n / total};background:${cols[i]}"></i>` : '').join('')}</span>`;
}

/* ---------- segmented control ---------- */
export function segmented(name, options, value){
  return `<div class="seg" role="tablist">${options.map(([v, l]) => `<button type="button" role="tab" class="${v === value ? 'on' : ''}" aria-selected="${v === value}" data-a="${name}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
}

/* ---------- menus ---------- */
let openMenu = null;
export function closeMenu(){ if (openMenu){ openMenu.remove(); openMenu = null; } }
/** items: {label, icon, run, on, danger, disabled, header} or 'sep' */
export function menu(anchor, items){
  closeMenu(); fx.tap();
  const el = document.createElement('div');
  el.className = 'menu-layer';
  el.innerHTML = `<div class="menu" role="menu">${items.map((it, i) => it === 'sep' ? '<hr>' : it.header ? `<p class="menu-h">${esc(it.header)}</p>` :
    `<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}><span>${esc(it.label)}</span>${it.on ? icon('check') : it.icon ? icon(it.icon) : ''}</button>`).join('')}</div>`;
  document.body.appendChild(el);
  const m = el.firstChild, r = anchor.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  const w = Math.min(290, vw - 24); m.style.width = w + 'px';
  const left = Math.max(12, Math.min(vw - w - 12, r.right - w > 12 ? r.right - w : r.left));
  m.style.left = left + 'px';
  const h = m.offsetHeight, below = r.bottom + 6;
  if (below + h < vh - 12) { m.style.top = below + 'px'; m.style.transformOrigin = 'top right'; }
  else { m.style.top = Math.max(12, r.top - h - 6) + 'px'; m.style.transformOrigin = 'bottom right'; }
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    closeMenu();
    if (b){ const it = items[+b.dataset.i]; if (it && it.run) it.run(); }
  });
  openMenu = el;
}

/* ---------- dialogs ---------- */
export function prompt({title, message = '', placeholder = '', value = '', ok = 'OK'}){
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'dialog-layer';
    el.innerHTML = `<form class="dialog"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"><div class="dialog-btns"><button type="button" data-x>Cancel</button><button type="submit" class="strong">${esc(ok)}</button></div></form>`;
    document.body.appendChild(el);
    const input = $('input', el);
    setTimeout(() => input.focus(), 60);
    const done = v => { el.classList.add('out'); setTimeout(() => el.remove(), 180); resolve(v); };
    $('form', el).addEventListener('submit', e => { e.preventDefault(); done(input.value); });
    $('[data-x]', el).addEventListener('click', () => done(null));
    el.addEventListener('click', e => { if (e.target === el) done(null); });
  });
}

/** Empty-state block, like ContentUnavailableView. */
export const empty = (ic, title, text = '', button = '') => `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${button}</div>`;
export const callout = ({ic, tint, title, text, button, act, arg = ''}) => `<div class="card callout">${`<span class="callout-ic" style="color:${tint}">${icon(ic)}</span>`}<div><h4>${esc(title)}</h4><p>${esc(text)}</p>${button ? `<button type="button" class="btn prominent small" data-a="${act}" data-v="${esc(arg)}">${esc(button)}</button>` : ''}</div></div>`;
