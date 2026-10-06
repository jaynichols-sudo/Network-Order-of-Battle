// Bearings Pro on Android, through Google Play Billing (cordova-plugin-purchase).
// Same products and features as the iPhone. Nothing is locked until GATING is on, which
// waits on the products existing in the Play Console (see docs/pricing.md).
import { esc, icon } from './ui.js';
import { openSheet, closeSheet } from './nav.js';
import { register } from './actions.js';
import { show } from './model.js';
import { fx, openURL, ls } from './platform.js';

export const GATING = false;
export const IDS = {yearly: 'com.jaynichols.networkoob.pro.yearly', monthly: 'com.jaynichols.networkoob.pro.monthly', lifetime: 'com.jaynichols.networkoob.pro'};
const PROPOSED = {yearly: '$29.99', monthly: '$3.99', lifetime: '$79.99'};

export const FEATURES = {
  events: ['Event mode', 'See who you know before a conference, then work the follow-up list.', 'ticket'],
  waysIn: ['Ways in', 'The best paths into any company, with the intro ask drafted.', 'waysIn'],
  team: ['Team packs', 'Pool networks with teammates, privately, to find warm paths.', 'people'],
  arrivals: ['Arrival check', 'Open Bearings in a new city and see who you know there.', 'plane'],
  enrich: ['ZoomInfo and Seamless.AI', 'Fill in emails, phones and locations from your own account.', 'sparkles'],
};

const P = {owned: ls.get('bearings.pro') === '1', ready: false, store: null};
export const unlocked = () => !GATING || P.owned;

function cdv(){ return globalThis.CdvPurchase; }
export async function initBilling(){
  const C = cdv(); if (!C || P.ready) return;
  const {store, ProductType, Platform} = C;
  P.store = store;
  store.register([
    {id: IDS.yearly, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.GOOGLE_PLAY},
    {id: IDS.monthly, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.GOOGLE_PLAY},
    {id: IDS.lifetime, type: ProductType.NON_CONSUMABLE, platform: Platform.GOOGLE_PLAY},
  ]);
  store.when().approved(t => t.verify()).verified(r => r.finish()).receiptUpdated(refresh).productUpdated(refresh);
  try { await store.initialize([Platform.GOOGLE_PLAY]); P.ready = true; refresh(); } catch (e) { console.warn('billing', e); }
}
function refresh(){
  if (!P.store) return;
  const owned = Object.values(IDS).some(id => { try { return P.store.owned(id); } catch { return false; } });
  P.owned = owned; ls.set('bearings.pro', owned ? '1' : '0');
}
function price(plan){
  const p = P.store && P.store.get(IDS[plan]);
  const o = p && p.getOffer && p.getOffer();
  const ph = o && o.pricingPhases && o.pricingPhases[o.pricingPhases.length - 1];
  return (ph && ph.price) || (p && p.pricing && p.pricing.price) || PROPOSED[plan];
}

/** True when the feature can be used; otherwise opens the paywall for it. */
export function allow(feature){
  if (unlocked()) return true;
  openPaywall(feature);
  return false;
}

export function openPaywall(feature = ''){
  let plan = 'yearly', busy = false, note = '';
  const f = FEATURES[feature];
  const render = body => {
    const opt = (id, title, sub, badge = '') => `<button type="button" class="card plan ${plan === id ? 'on' : ''}" data-a="plan" data-v="${id}" role="radio" aria-checked="${plan === id}" aria-label="${esc([title, sub, badge].filter(Boolean).join(', '))}">
      <span class="plan-dot" aria-hidden="true"></span><span class="grow"><b>${esc(title)}</b><span class="muted small">${esc(sub)}</span></span>${badge ? `<span class="badge-needs">${esc(badge)}</span>` : ''}</button>`;
    body.innerHTML = `<div class="paywall">
      <p class="muted">${f ? esc(`${f[0]} is part of Pro. `) : ''}The map, Today, search and reminders stay free. Pro adds the tools for working your network.</p>
      <div class="card list">${Object.entries(FEATURES).map(([id, [t, line, ic]]) => `<div class="row static pw-feat ${id === feature ? 'hl' : ''}"><span class="pw-ic" aria-hidden="true">${icon(ic)}</span><span class="grow"><b>${esc(t)}</b><span class="muted small">${esc(line)}</span></span></div>`).join('')}</div>
      <div class="plans" role="radiogroup" aria-label="Plans">
        ${opt('yearly', 'Yearly', `${price('yearly')} a year`, 'Best value')}
        ${opt('monthly', 'Monthly', `${price('monthly')} a month`)}
        ${opt('lifetime', 'Lifetime', `${price('lifetime')} once`)}
      </div>
      <button type="button" class="btn prominent big block" data-a="buy" ${busy || P.owned ? 'disabled' : ''}>${busy ? 'One moment…' : P.owned ? 'You have Pro. Thank you!' : 'Continue'}</button>
      ${note ? `<p class="foot bad" role="alert">${esc(note)}</p>` : ''}
      <div class="btn-row"><button type="button" class="link" data-a="restore">Restore purchases</button><button type="button" class="link" data-a="privacy">Privacy</button></div>
      <p class="foot">Subscriptions renew automatically until you cancel in Google Play. Your network never leaves your devices either way.</p></div>`;
  };
  openSheet({
    title: 'Bearings Pro', right: ['Not now'], full: true,
    mount: render,
    handlers: {
      plan(v, t){ plan = v; fx.select(); render(t.closest('.sheet-body')); },
      async buy(_, t){
        const body = t.closest('.sheet-body');
        const p = P.store && P.store.get(IDS[plan]);
        const offer = p && p.getOffer && p.getOffer();
        if (!offer){ note = 'Pro isn’t available to buy yet. Everything is unlocked for now.'; render(body); return; }
        busy = true; note = ''; render(body);
        try { const err = await offer.order(); if (err && err.code !== cdv().ErrorCode.PAYMENT_CANCELLED) note = err.message || 'The purchase didn’t go through.'; }
        catch (e) { note = (e && e.message) || 'The purchase didn’t go through.'; }
        busy = false; refresh();
        if (P.owned){ fx.success(); closeSheet(); show('Welcome to Bearings Pro'); } else render(body);
      },
      async restore(_, t){
        if (P.store) { try { await P.store.restorePurchases(); } catch {} refresh(); }
        if (P.owned){ closeSheet(); show('Pro restored'); } else { note = 'No Pro purchase found on this Google account.'; render(t.closest('.sheet-body')); }
      },
      privacy: () => openURL('https://www.jaynichols.net/bearings/privacy.html'),
    },
  });
}
register('paywall', openPaywall);
