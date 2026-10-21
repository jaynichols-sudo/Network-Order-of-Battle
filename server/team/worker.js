// Northfix Team server. The contract is docs/team.md.
//
// Teams pool encrypted network summaries. Every team name, profile and share arrives
// already encrypted with a team key the server never sees (it lives after the # in invite
// links). This worker stores ciphertext, checks who may do what, and keeps billing state
// (Stripe on the web, or the App Store plan checked by apple.js).
//
// Bindings: DB (D1). Optional vars/secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID,
// STRIPE_WEBHOOK_SECRET (billing returns 501 until set), APP_STORE_URL, APPLE_BUNDLE_ID
// (defaults to the Northfix bundle), APPLE_ALLOW_SANDBOX ("true" accepts TestFlight and
// sandbox purchases for the App Store team plan).

import {verifyAppleJWS, AppleVerifyError} from './apple.js';
import {migrate} from './migrate.js';

const DAY = 86400000;
const TRIAL_DAYS = 30;
const TRIAL_SEATS = 5;
// The App Store starter plan: one yearly subscription for a team of up to 5.
const APPLE_BUNDLE_ID = 'com.jaynichols.networkoob';
const TEAM5_PRODUCT = 'com.jaynichols.networkoob.team5';
const TEAM5_SEATS = 5;
const MAX_JWS = 20000;
const MAX_MEMBERS = 200;
const LIMITS = {body: 2000000, profile: 4096, name: 2048};
const MAX_REQUEST = 2100000; // the largest JSON request we read (a share plus its wrapper)
const ROLES = ['owner', 'admin', 'member'];
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'; // no 0 O o 1 l I
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{10}$`);
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SITE = 'https://northfix.app/';

// ---------- small helpers ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {...CORS, 'content-type': 'application/json', 'Cache-Control': 'no-store'}});
const fail = (status, error) => json({error}, status);

// Thrown to stop a handler with a JSON error.
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const stop = (status, message) => { throw new HttpError(status, message); };

const now = () => Date.now();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomId = (n = 16) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

// Invite code: 10 characters, unbiased (rejection sampling).
function inviteCode() {
  const n = CODE_ALPHABET.length, max = 256 - (256 % n);
  let out = '';
  while (out.length < 10) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < max && out.length < 10) out += CODE_ALPHABET[b % n];
  return out;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

async function readJson(req) {
  if (Number(req.headers.get('content-length') || 0) > MAX_REQUEST) stop(413, 'That request is too large.');
  const text = await req.text();
  if (text.length > MAX_REQUEST) stop(413, 'That request is too large.');
  if (!text) return {};
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  stop(400, "The request body isn't valid JSON.");
}

// An encrypted field: base64 text within a size limit.
function encrypted(value, what, limit) {
  if (typeof value !== 'string' || !value) stop(400, `The ${what} is missing.`);
  if (value.length > limit) stop(413, `The ${what} is too large.`);
  if (!B64_RE.test(value)) stop(400, `The ${what} must be encrypted base64.`);
  return value;
}

function intIn(value, fallback, min, max, what) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) stop(400, `${what} must be a whole number from ${min} to ${max}.`);
  return value;
}

const isAdmin = (m) => m.role === 'owner' || m.role === 'admin';
// Paid means Stripe says active or past due, a trial that hasn't ended, or an App Store plan whose paid period hasn't.
const readOnly = (team, t = now()) =>
  team.plan === 'canceled' || (team.plan === 'trial' && t > team.trial_ends) || (team.plan === 'team5' && !(team.apple_expires > t));
// When the current paid period ends, for teams billed through the App Store.
const renewsAt = (team) => (team.plan === 'team5' ? team.apple_expires ?? null : null);
const event = (db, teamId, actor, kind, target = null) =>
  db.prepare('INSERT INTO events (team_id, at, actor, kind, target) VALUES (?, ?, ?, ?, ?)').bind(teamId, now(), actor, kind, target);
const countMembers = async (db, teamId) => (await db.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').bind(teamId).first()).n;

// Signs the caller in from the bearer token, marks them seen, and loads their team.
async function auth(req, db) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '');
  if (!m) stop(401, 'Sign in to your team first.');
  if (!TOKEN_RE.test(m[1])) stop(401, "That sign-in token isn't valid.");
  const me = await db.prepare('UPDATE members SET seen = ? WHERE token_hash = ? RETURNING id, team_id, role').bind(now(), await sha256(m[1])).first();
  if (!me) stop(401, "That sign-in token isn't valid. You may have been removed from the team.");
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(me.team_id).first();
  if (!team) stop(401, 'That team no longer exists.');
  return {me, team};
}
const needAdmin = (me) => { if (!isAdmin(me)) stop(403, 'Only team admins can do that.'); };
const needOwner = (me) => { if (me.role !== 'owner') stop(403, 'Only the team owner can do that.'); };

async function validInvite(db, code) {
  if (!CODE_RE.test(code)) return null;
  return db.prepare('SELECT * FROM invites WHERE code = ? AND uses_left > 0 AND expires > ?').bind(code, now()).first();
}

// ---------- teams and members ----------

async function createTeam(req, db) {
  const body = await readJson(req);
  const name = encrypted(body.name, 'team name', LIMITS.name);
  const profile = encrypted(body.profile, 'profile', LIMITS.profile);
  const teamId = randomId(), memberId = randomId(), token = randomId(32), t = now();
  await db.batch([
    db.prepare('INSERT INTO teams (id, name_enc, created, plan, seats, trial_ends) VALUES (?, ?, ?, ?, ?, ?)').bind(teamId, name, t, 'trial', TRIAL_SEATS, t + TRIAL_DAYS * DAY),
    db.prepare('INSERT INTO members (id, team_id, role, token_hash, profile_enc, joined, seen) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(memberId, teamId, 'owner', await sha256(token), profile, t, t),
    event(db, teamId, memberId, 'created'),
  ]);
  return json({team: {id: teamId}, member: {id: memberId, role: 'owner'}, token});
}

async function getTeam(db, {me, team}) {
  const {results: rows} = await db.prepare(
    `SELECT m.id, m.role, m.profile_enc, m.joined, m.seen, s.updated, s.size
     FROM members m LEFT JOIN shares s ON s.member_id = m.id WHERE m.team_id = ? ORDER BY m.joined`).bind(team.id).all();
  let invites = [];
  if (isAdmin(me)) {
    const {results} = await db.prepare('SELECT code, role, uses_left, expires FROM invites WHERE team_id = ? AND uses_left > 0 AND expires > ? ORDER BY expires').bind(team.id, now()).all();
    invites = results.map((i) => ({code: i.code, role: i.role, usesLeft: i.uses_left, expires: i.expires}));
  }
  return json({
    team: {id: team.id, name: team.name_enc, plan: team.plan, seats: team.seats, trialEnds: team.trial_ends, renewsAt: renewsAt(team), created: team.created, readOnly: readOnly(team)},
    me: {id: me.id, role: me.role},
    members: rows.map((r) => ({id: r.id, role: r.role, profile: r.profile_enc, joined: r.joined, seen: r.seen, shareUpdated: r.updated ?? null, shareSize: r.size ?? null})),
    invites,
  });
}

async function renameTeam(req, db, {me, team}) {
  needAdmin(me);
  const name = encrypted((await readJson(req)).name, 'team name', LIMITS.name);
  await db.prepare('UPDATE teams SET name_enc = ? WHERE id = ?').bind(name, team.id).run();
  return json({ok: true});
}

async function deleteTeam(db, {me, team}) {
  needOwner(me);
  await db.batch(['shares', 'invites', 'events', 'members'].map((t) => db.prepare(`DELETE FROM ${t} WHERE team_id = ?`).bind(team.id))
    .concat(db.prepare('DELETE FROM teams WHERE id = ?').bind(team.id)));
  return json({ok: true});
}

async function updateMe(req, db, {me}) {
  const profile = encrypted((await readJson(req)).profile, 'profile', LIMITS.profile);
  await db.prepare('UPDATE members SET profile_enc = ? WHERE id = ?').bind(profile, me.id).run();
  return json({ok: true});
}

async function changeRole(req, db, {me, team}, id) {
  needAdmin(me);
  const {role} = await readJson(req);
  if (!ROLES.includes(role)) stop(400, 'Role must be owner, admin or member.');
  const target = await db.prepare('SELECT id, role FROM members WHERE id = ? AND team_id = ?').bind(id, team.id).first();
  if (!target) stop(404, "That person isn't on this team.");
  if (target.role === role) return json({ok: true});
  if (target.role === 'owner') stop(403, "The owner's role can't be changed. The owner can hand over ownership instead.");
  if (role === 'owner') {
    // Hand over ownership: the target becomes owner and the current owner becomes an admin.
    needOwner(me);
    await db.batch([
      db.prepare("UPDATE members SET role = 'owner' WHERE id = ?").bind(target.id),
      db.prepare("UPDATE members SET role = 'admin' WHERE id = ?").bind(me.id),
      event(db, team.id, me.id, 'role', `${target.id}:owner`),
    ]);
    return json({ok: true});
  }
  if (role === 'admin') needOwner(me);
  if (target.role === 'admin' && me.role !== 'owner' && target.id !== me.id) stop(403, 'Only the team owner can change an admin.');
  await db.batch([
    db.prepare('UPDATE members SET role = ? WHERE id = ?').bind(role, target.id),
    event(db, team.id, me.id, 'role', `${target.id}:${role}`),
  ]);
  return json({ok: true});
}

async function removeMember(db, {me, team}, id) {
  const leaving = id === me.id;
  if (leaving && me.role === 'owner') stop(400, 'The owner can\'t leave the team. Hand over ownership to someone else first, or delete the team.');
  if (!leaving) {
    needAdmin(me);
    const target = await db.prepare('SELECT id, role FROM members WHERE id = ? AND team_id = ?').bind(id, team.id).first();
    if (!target) stop(404, "That person isn't on this team.");
    if (target.role === 'owner') stop(403, "The owner can't be removed.");
    if (target.role === 'admin' && me.role !== 'owner') stop(403, 'Only the team owner can remove an admin.');
  }
  // Deleting the member row revokes their token; their share goes with it.
  await db.batch([
    db.prepare('DELETE FROM shares WHERE member_id = ?').bind(id),
    db.prepare('DELETE FROM members WHERE id = ? AND team_id = ?').bind(id, team.id),
    event(db, team.id, me.id, leaving ? 'left' : 'removed', id),
  ]);
  return json({ok: true});
}

// ---------- invites and joining ----------

async function createInvite(req, db, {me, team}) {
  needAdmin(me);
  if (readOnly(team)) stop(402, "This team is read-only until it's subscribed, so it can't invite anyone.");
  const body = await readJson(req);
  const role = body.role ?? 'member';
  if (role !== 'member' && role !== 'admin') stop(400, 'An invite role must be admin or member.');
  if (role === 'admin') needOwner(me);
  const uses = intIn(body.uses, 10, 1, 50, 'Uses');
  const days = intIn(body.days, 14, 1, 30, 'Days');
  const code = inviteCode(), expires = now() + days * DAY;
  await db.batch([
    db.prepare('DELETE FROM invites WHERE team_id = ? AND (uses_left <= 0 OR expires <= ?)').bind(team.id, now()), // tidy old ones
    db.prepare('INSERT INTO invites (code, team_id, role, uses_left, expires, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(code, team.id, role, uses, expires, me.id),
    event(db, team.id, me.id, 'invite_created', code),
  ]);
  return json({code, role, usesLeft: uses, expires});
}

async function revokeInvite(db, {me, team}, code) {
  needAdmin(me);
  const r = await db.prepare('DELETE FROM invites WHERE code = ? AND team_id = ?').bind(code, team.id).run();
  if (!r.meta.changes) stop(404, "That invite doesn't exist.");
  await event(db, team.id, me.id, 'invite_revoked', code).run();
  return json({ok: true});
}

async function checkInvite(db, code) {
  const invite = await validInvite(db, code);
  if (!invite) stop(404, 'This invite has expired or was revoked.');
  return json({ok: true, expires: invite.expires});
}

async function join(req, db) {
  const body = await readJson(req);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const profile = encrypted(body.profile, 'profile', LIMITS.profile);
  const invite = await validInvite(db, code);
  if (!invite) stop(404, 'This invite has expired or was revoked.');
  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(invite.team_id).first();
  if (!team) stop(404, 'This invite has expired or was revoked.');
  if (readOnly(team)) stop(402, "This team's trial has ended, so it can't add people until it's subscribed.");
  const used = await countMembers(db, team.id);
  if (used >= MAX_MEMBERS) stop(409, `A team can have up to ${MAX_MEMBERS} people.`);
  if (used >= team.seats) stop(409, 'Every seat on this team is taken. Ask the team owner to add seats.');
  // Spend one use first so a used-up invite can't be raced.
  const spent = await db.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code = ? AND uses_left > 0').bind(code).run();
  if (!spent.meta.changes) stop(404, 'This invite has expired or was revoked.');
  const memberId = randomId(), token = randomId(32), t = now();
  await db.batch([
    db.prepare('INSERT INTO members (id, team_id, role, token_hash, profile_enc, joined, seen) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(memberId, team.id, invite.role, await sha256(token), profile, t, t),
    event(db, team.id, memberId, 'joined', invite.code),
  ]);
  return json({team: {id: team.id}, member: {id: memberId, role: invite.role}, token});
}

// ---------- shares ----------

async function putShare(req, db, {me, team}) {
  if (readOnly(team)) stop(402, "This team is read-only until it's subscribed, so shares can't be updated.");
  const body = encrypted((await readJson(req)).body, 'share', LIMITS.body);
  const t = now();
  await db.prepare(
    `INSERT INTO shares (member_id, team_id, body, size, updated) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (member_id) DO UPDATE SET body = excluded.body, size = excluded.size, updated = excluded.updated`).bind(me.id, team.id, body, body.length, t).run();
  return json({updated: t});
}

async function listShares(db, {team}) {
  const {results} = await db.prepare('SELECT member_id, updated, size FROM shares WHERE team_id = ? ORDER BY updated DESC').bind(team.id).all();
  return json(results.map((s) => ({member: s.member_id, updated: s.updated, size: s.size})));
}

async function getShare(db, {team}, id) {
  const s = await db.prepare('SELECT member_id, updated, body FROM shares WHERE member_id = ? AND team_id = ?').bind(id, team.id).first();
  if (!s) stop(404, "That person hasn't shared anything yet.");
  return json({member: s.member_id, updated: s.updated, body: s.body});
}

async function audit(db, {me, team}) {
  needAdmin(me);
  const {results} = await db.prepare('SELECT at, actor, kind, target FROM events WHERE team_id = ? ORDER BY id DESC LIMIT 200').bind(team.id).all();
  return json(results);
}

// ---------- billing (Stripe) ----------

const billingReady = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);

async function stripe(env, method, path, form) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? {'content-type': 'application/x-www-form-urlencoded'} : {})},
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Stripe error', res.status, body.error?.type, body.error?.code);
    stop(502, "Stripe didn't accept the request. Try again later.");
  }
  return body;
}

async function billing(db, env, {me, team}) {
  needAdmin(me);
  return json({
    plan: team.plan, seats: team.seats, used: await countMembers(db, team.id), trialEnds: team.trial_ends, renewsAt: renewsAt(team),
    canCheckout: billingReady(env) && me.role === 'owner',
    // The App Store plan can be applied to a trial, a lapsed team, or to renew itself. Teams on Stripe manage billing there.
    canSubscribeOnAppStore: me.role === 'owner' && team.plan !== 'active' && team.plan !== 'past_due',
  });
}

// ---------- billing (App Store) ----------

// The owner bought "Northfix Team, up to 5 seats" in the app and sends the StoreKit 2
// transaction JWS. `verify` checks it against Apple's certificate chain (apple.js); tests
// inject a stub. The app sends the latest transaction again whenever the server says the
// plan has lapsed, which is how renewals reach the server without App Store notifications.
async function appleBilling(req, db, env, {me, team}, verify) {
  needOwner(me);
  const body = await readJson(req);
  const jws = body.transaction;
  if (typeof jws !== 'string' || !jws) stop(400, 'Send the App Store transaction.');
  if (jws.length > MAX_JWS) stop(413, 'That transaction is too large.');
  if (team.plan === 'active' || team.plan === 'past_due') stop(409, 'This team is billed on the web. Manage seats and billing there.');
  let tx;
  try {
    tx = await verify(jws, {bundleId: env.APPLE_BUNDLE_ID || APPLE_BUNDLE_ID, productIds: [TEAM5_PRODUCT], allowSandbox: env.APPLE_ALLOW_SANDBOX === 'true'});
  } catch (e) {
    if (e instanceof AppleVerifyError) { console.error('Apple transaction refused', e.reason); stop(402, e.message); }
    throw e;
  }
  const expires = Number(tx.expiresDate);
  if (!(expires > now())) stop(402, 'That App Store subscription has ended. Renew it in Settings, under your Apple Account, then try again.');
  const txId = String(tx.originalTransactionId || tx.transactionId || '');
  if (!txId) stop(402, "The App Store didn't confirm that subscription.");
  const other = await db.prepare('SELECT id FROM teams WHERE apple_transaction_id = ? AND id != ?').bind(txId, team.id).first();
  if (other) stop(409, 'That App Store subscription already pays for another team.');
  const used = await countMembers(db, team.id);
  if (used > TEAM5_SEATS) stop(409, `This team has ${used} people, and the App Store plan covers up to ${TEAM5_SEATS}. Subscribe on the web for more seats.`);
  await db.batch([
    db.prepare('UPDATE teams SET plan = ?, seats = ?, apple_transaction_id = ?, apple_expires = ? WHERE id = ?').bind('team5', TEAM5_SEATS, txId, expires, team.id),
    event(db, team.id, me.id, 'billing', `team5:${expires}`),
  ]);
  return json({plan: 'team5', seats: TEAM5_SEATS, renewsAt: expires});
}

async function checkout(req, db, env, url, {me, team}) {
  needOwner(me);
  if (!billingReady(env)) stop(501, "Billing isn't set up on this server yet.");
  const used = await countMembers(db, team.id);
  const seats = intIn((await readJson(req)).seats, null, Math.max(1, used), MAX_MEMBERS, 'Seats');
  if (seats === null) stop(400, 'Choose how many seats to buy.');
  const form = {
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': String(seats),
    success_url: `${url.origin}/billing/done`,
    cancel_url: `${url.origin}/billing/done`,
    client_reference_id: team.id,
    'metadata[team_id]': team.id,
    'subscription_data[metadata][team_id]': team.id,
  };
  if (team.stripe_customer) form.customer = team.stripe_customer;
  const session = await stripe(env, 'POST', 'checkout/sessions', form);
  return json({url: session.url});
}

async function portal(db, env, url, {me, team}) {
  needOwner(me);
  if (!env.STRIPE_SECRET_KEY) stop(501, "Billing isn't set up on this server yet.");
  if (!team.stripe_customer) stop(400, "This team doesn't have a subscription yet.");
  const session = await stripe(env, 'POST', 'billing_portal/sessions', {customer: team.stripe_customer, return_url: `${url.origin}/billing/done`});
  return json({url: session.url});
}

// Checks Stripe's "t=…,v1=…" signature: HMAC-SHA256 of `${t}.${raw}`, within 5 minutes.
async function verifyStripe(header, raw, secret) {
  const parts = {t: null, v1: []};
  for (const kv of (header || '').split(',')) {
    const [k, v] = kv.split('=', 2);
    if (k === 't') parts.t = v; else if (k === 'v1' && v) parts.v1.push(v);
  }
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1.length || Math.abs(now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${raw}`)));
  return parts.v1.some((sig) => {
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

const PLAN_FOR_STATUS = {active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled'};
const subQuantity = (sub) => Math.min(MAX_MEMBERS, Math.max(1, sub.items?.data?.[0]?.quantity || sub.quantity || 1));

async function findTeam(db, teamId, subId) {
  if (typeof teamId === 'string' && ID_RE.test(teamId)) {
    const t = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(teamId).first();
    if (t) return t;
  }
  return subId ? db.prepare('SELECT * FROM teams WHERE stripe_sub = ?').bind(subId).first() : null;
}

async function webhook(req, db, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) stop(501, "Billing isn't set up on this server yet.");
  const raw = await req.text();
  if (!(await verifyStripe(req.headers.get('stripe-signature'), raw, env.STRIPE_WEBHOOK_SECRET))) stop(400, "The Stripe signature didn't match.");
  let evt;
  try { evt = JSON.parse(raw); } catch { stop(400, "The request body isn't valid JSON."); }
  const obj = evt.data?.object || {};
  let team = null, change = null;

  if (evt.type === 'checkout.session.completed' && obj.mode === 'subscription') {
    team = await findTeam(db, obj.client_reference_id || obj.metadata?.team_id, obj.subscription);
    if (team && obj.subscription) {
      // The session doesn't carry the quantity or status, so ask Stripe for the subscription.
      const sub = env.STRIPE_SECRET_KEY ? await stripe(env, 'GET', `subscriptions/${encodeURIComponent(obj.subscription)}`) : {status: 'active'};
      change = {customer: obj.customer || team.stripe_customer, sub: obj.subscription, plan: PLAN_FOR_STATUS[sub.status] || 'active', seats: sub.items ? subQuantity(sub) : team.seats};
    }
  } else if (evt.type === 'customer.subscription.updated' || evt.type === 'customer.subscription.deleted') {
    team = await findTeam(db, obj.metadata?.team_id, obj.id);
    if (team) {
      const plan = evt.type === 'customer.subscription.deleted' ? 'canceled' : PLAN_FOR_STATUS[obj.status] || team.plan;
      change = {customer: obj.customer || team.stripe_customer, sub: obj.id, plan, seats: obj.items ? subQuantity(obj) : team.seats};
    }
  }

  if (team && change) {
    await db.batch([
      db.prepare('UPDATE teams SET stripe_customer = ?, stripe_sub = ?, plan = ?, seats = ? WHERE id = ?').bind(change.customer, change.sub, change.plan, change.seats, team.id),
      event(db, team.id, 'stripe', 'billing', `${change.plan}:${change.seats}`),
    ]);
  }
  return json({received: true});
}

// ---------- HTML pages ----------

function page(title, inner, status = 200, nonce = null) {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'${nonce ? `; script-src 'nonce-${nonce}'` : ''}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0D0A17;color:#F4F1FF;
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:24px;box-sizing:border-box}
main{max-width:420px;text-align:center}h1{font-size:1.5rem;line-height:1.25;margin:0 0 12px}p{margin:12px 0;color:#CFC8E8}
.btn{display:inline-block;margin:20px 0 8px;padding:14px 28px;border-radius:12px;background:#FFB52E;color:#0D0A17;font-weight:700;text-decoration:none}
a{color:#FFB52E}.small{font-size:.9rem}[hidden]{display:none}</style></head><body><main>${inner}</main></body></html>`;
  return new Response(html, {status, headers: {'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': csp}});
}

async function invitePage(db, env, code) {
  const store = /^https:\/\//.test(env.APP_STORE_URL || '') ? env.APP_STORE_URL : SITE;
  const getApp = `<p class="small">Don't have Northfix yet? <a href="${escapeHtml(store)}">Get it here</a>.</p>`;
  if (!(await validInvite(db, code))) {
    return page('Invite expired', `<h1>This invite has expired or was revoked.</h1><p>Ask your teammate for a new invite.</p>${getApp}`, 404);
  }
  // The key lives after the # and never reaches this server. The script reads it in the browser.
  const nonce = randomId();
  const codeJs = JSON.stringify(code).replace(/</g, '\\u003c');
  return page("You're invited to a team on Northfix", `<h1>You're invited to a team on Northfix</h1>
<p>Open the invite in the Northfix app to join. Your team's data is encrypted, and the key stays on your devices.</p>
<a class="btn" id="open" href="#" hidden>Open in Northfix</a>
<p id="nokey" hidden>This link is missing its key. Ask your teammate for a new invite.</p>
${getApp}
<script nonce="${nonce}">(function(){var m=/(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash);
if(!m){document.getElementById('nokey').hidden=false;return;}
var a=document.getElementById('open');a.href='bearings://team/join?code='+encodeURIComponent(${codeJs})+'&k='+encodeURIComponent(m[1]);a.hidden=false;})();</script>`, 200, nonce);
}

// ---------- router ----------

async function route(req, env, verify) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;
  const db = env.DB;
  let m;

  if (path === '/health' && method === 'GET') return json({ok: true});
  if (path === '/billing/done' && method === 'GET') return page("You're all set", "<h1>You're all set.</h1><p>Go back to Northfix.</p>");
  if ((m = /^\/join\/([^/]+)$/.exec(path)) && method === 'GET') return invitePage(db, env, decodeURIComponent(m[1]));
  if (path === '/stripe/webhook' && method === 'POST') return webhook(req, db, env);

  if (path === '/v1/teams' && method === 'POST') return createTeam(req, db);
  if (path === '/v1/join' && method === 'POST') return join(req, db);
  if ((m = /^\/v1\/invites\/([^/]+)$/.exec(path)) && method === 'GET') return checkInvite(db, decodeURIComponent(m[1]));

  if (!path.startsWith('/v1/')) stop(404, 'Not found.');
  const routes = [
    ['GET', /^\/v1\/team$/, (c) => getTeam(db, c)],
    ['PUT', /^\/v1\/team$/, (c) => renameTeam(req, db, c)],
    ['DELETE', /^\/v1\/team$/, (c) => deleteTeam(db, c)],
    ['POST', /^\/v1\/invites$/, (c) => createInvite(req, db, c)],
    ['DELETE', /^\/v1\/invites\/([^/]+)$/, (c, code) => revokeInvite(db, c, code)],
    ['PUT', /^\/v1\/me$/, (c) => updateMe(req, db, c)],
    ['PUT', /^\/v1\/share$/, (c) => putShare(req, db, c)],
    ['GET', /^\/v1\/shares$/, (c) => listShares(db, c)],
    ['GET', /^\/v1\/shares\/([^/]+)$/, (c, id) => getShare(db, c, id)],
    ['PATCH', /^\/v1\/members\/([^/]+)$/, (c, id) => changeRole(req, db, c, id)],
    ['DELETE', /^\/v1\/members\/([^/]+)$/, (c, id) => removeMember(db, c, id)],
    ['GET', /^\/v1\/audit$/, (c) => audit(db, c)],
    ['GET', /^\/v1\/billing$/, (c) => billing(db, env, c)],
    ['POST', /^\/v1\/billing\/checkout$/, (c) => checkout(req, db, env, url, c)],
    ['POST', /^\/v1\/billing\/portal$/, (c) => portal(db, env, url, c)],
    ['POST', /^\/v1\/billing\/apple$/, (c) => appleBilling(req, db, env, c, verify)],
  ];
  for (const [verb, re, handler] of routes) {
    if (verb !== method || !(m = re.exec(path))) continue;
    const ctx = await auth(req, db);
    return handler(ctx, m[1] && decodeURIComponent(m[1]));
  }
  stop(404, 'Not found.');
}

/**
 * The worker. `verifyApple` checks an App Store transaction JWS and returns its claims
 * (see apple.js); tests pass a stub.
 */
export function createWorker({verifyApple = verifyAppleJWS} = {}) {
  let migrated = null;
  return {
    async fetch(req, env) {
      if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: CORS});
      try {
        if (!migrated) migrated = migrate(env.DB).catch((e) => { migrated = null; throw e; });
        await migrated;
        return await route(req, env, verifyApple);
      } catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.message);
        if (e instanceof URIError) return fail(400, "That address isn't valid.");
        console.error('Unhandled error', e?.message);
        return fail(500, 'Something went wrong on the server. Try again.');
      }
    },
  };
}

export default createWorker();
