// Runs the team worker in Miniflare with a local D1 database. `npm test` in server/team.
import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac, randomBytes} from 'node:crypto';
import {Miniflare, Response as MfResponse} from 'miniflare';

const here = new URL('..', import.meta.url);
const schema = await readFile(new URL('schema.sql', here), 'utf8');
const blob = (n = 64) => randomBytes(n).toString('base64'); // stands in for ciphertext
const WEBHOOK_SECRET = 'whsec_test_secret';

// Fake Stripe for the instance that has billing configured.
const stripeCalls = [];
async function fakeStripe(req) {
  const url = new URL(req.url);
  const form = req.method === 'POST' ? Object.fromEntries(new URLSearchParams(await req.text())) : null;
  stripeCalls.push({method: req.method, path: url.pathname, form, auth: req.headers.get('authorization')});
  const reply = (body) => new MfResponse(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
  if (url.pathname === '/v1/checkout/sessions') return reply({id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1'});
  if (url.pathname === '/v1/billing_portal/sessions') return reply({url: 'https://billing.stripe.com/p/session/1'});
  if (url.pathname.startsWith('/v1/subscriptions/')) return reply({id: 'sub_1', status: 'active', items: {data: [{quantity: 12}]}});
  return new MfResponse('{}', {status: 404});
}

async function start(bindings = {}, extra = {}) {
  const mf = new Miniflare({
    modules: true,
    modulesRules: [{type: 'ESModule', include: ['**/*.js']}],
    scriptPath: new URL('worker.js', here).pathname,
    compatibilityDate: '2026-07-01',
    d1Databases: ['DB'],
    bindings,
    ...extra,
  });
  const db = await mf.getD1Database('DB');
  const statements = schema.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const s of statements) await db.prepare(s).run();
  const call = async (method, path, {token, body, headers = {}, raw} = {}) => {
    const h = {...headers};
    if (token) h.authorization = `Bearer ${token}`;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await mf.dispatchFetch(`http://team.test${path}`, {method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body))});
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return {status: res.status, data, headers: res.headers};
  };
  return {mf, db, call};
}

const plain = await start();
const billed = await start({STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET}, {outboundService: fakeStripe});
after(async () => { await plain.mf.dispose(); await billed.mf.dispose(); });

async function newTeam(call) {
  const r = await call('POST', '/v1/teams', {body: {name: blob(), profile: blob()}});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function invite(call, token, body = {}) {
  const r = await call('POST', '/v1/invites', {token, body});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function joinWith(call, code) {
  return call('POST', '/v1/join', {body: {code, profile: blob()}});
}

test('health and CORS preflight', async () => {
  const {call} = plain;
  assert.deepEqual((await call('GET', '/health')).data, {ok: true});
  const pre = await call('OPTIONS', '/v1/team', {headers: {origin: 'https://localhost', 'access-control-request-method': 'PUT'}});
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  const err = await call('GET', '/v1/team');
  assert.equal(err.status, 401);
  assert.equal(err.headers.get('access-control-allow-origin'), '*');
});

test('create and read a team', async () => {
  const {call} = plain;
  const t = await newTeam(call);
  assert.equal(t.member.role, 'owner');
  assert.match(t.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(t.team.id, /^[A-Za-z0-9_-]{22}$/);
  const r = await call('GET', '/v1/team', {token: t.token});
  assert.equal(r.status, 200);
  assert.equal(r.data.team.plan, 'trial');
  assert.equal(r.data.team.seats, 5);
  assert.equal(r.data.team.readOnly, false);
  assert.ok(r.data.team.trialEnds > Date.now() + 29 * 86400000);
  assert.deepEqual(r.data.me, {id: t.member.id, role: 'owner'});
  assert.equal(r.data.members.length, 1);
  assert.deepEqual(r.data.invites, []);
});

test('input validation', async () => {
  const {call} = plain;
  assert.equal((await call('POST', '/v1/teams', {body: {name: blob()}})).status, 400);
  assert.equal((await call('POST', '/v1/teams', {body: {name: 'not base64!', profile: blob()}})).status, 400);
  assert.equal((await call('POST', '/v1/teams', {body: {name: blob(), profile: 'A'.repeat(5000)}})).status, 413);
  assert.equal((await call('POST', '/v1/teams', {raw: '{nope', headers: {'content-type': 'application/json'}})).status, 400);
  assert.equal((await call('GET', '/v1/team', {token: 'short'})).status, 401);
  const t = await newTeam(call);
  assert.equal((await call('POST', '/v1/invites', {token: t.token, body: {uses: 51}})).status, 400);
  assert.equal((await call('POST', '/v1/invites', {token: t.token, body: {days: 0}})).status, 400);
  assert.equal((await call('POST', '/v1/invites', {token: t.token, body: {role: 'owner'}})).status, 400);
});

test('invite, join, seat limit, shares, invite visibility', async () => {
  const {call} = plain;
  const owner = await newTeam(call);
  const inv = await invite(call, owner.token);
  assert.match(inv.code, /^[2-9A-HJ-NP-Za-km-np-z]{10}$/);
  assert.equal(inv.usesLeft, 10);
  assert.equal(inv.role, 'member');
  assert.equal((await call('GET', `/v1/invites/${inv.code}`)).status, 200);
  assert.equal((await call('GET', '/v1/invites/ZZZZZZZZZZ')).status, 404);

  const members = [];
  for (let i = 0; i < 4; i++) {
    const j = await joinWith(call, inv.code);
    assert.equal(j.status, 200, JSON.stringify(j.data));
    assert.equal(j.data.team.id, owner.team.id);
    assert.equal(j.data.member.role, 'member');
    members.push(j.data);
  }
  const full = await joinWith(call, inv.code);
  assert.equal(full.status, 409);
  assert.match(full.data.error, /seat/);
  assert.equal((await joinWith(call, 'ZZZZZZZZZZ')).status, 404);

  // Shares
  const body = blob(500);
  const put = await call('PUT', '/v1/share', {token: members[0].token, body: {body}});
  assert.equal(put.status, 200);
  assert.ok(put.data.updated > 0);
  const list = await call('GET', '/v1/shares', {token: members[1].token});
  assert.deepEqual(list.data, [{member: members[0].member.id, updated: put.data.updated, size: body.length}]);
  const one = await call('GET', `/v1/shares/${members[0].member.id}`, {token: owner.token});
  assert.equal(one.data.body, body);
  assert.equal((await call('GET', `/v1/shares/${members[1].member.id}`, {token: owner.token})).status, 404);
  assert.equal((await call('PUT', '/v1/share', {token: members[0].token, body: {body: 'A'.repeat(2000004)}})).status, 413);

  // Members don't see invites; admins do.
  const asMember = await call('GET', '/v1/team', {token: members[0].token});
  assert.deepEqual(asMember.data.invites, []);
  assert.equal(asMember.data.members.length, 5);
  assert.equal(asMember.data.members.find((m) => m.id === members[0].member.id).shareSize, body.length);
  assert.equal((await call('POST', '/v1/invites', {token: members[0].token, body: {}})).status, 403);
  assert.equal((await call('GET', '/v1/audit', {token: members[0].token})).status, 403);
  const asOwner = await call('GET', '/v1/team', {token: owner.token});
  assert.equal(asOwner.data.invites.length, 1);
  assert.equal(asOwner.data.invites[0].usesLeft, 6);

  // Profile update and rename
  assert.equal((await call('PUT', '/v1/me', {token: members[0].token, body: {profile: blob()}})).status, 200);
  assert.equal((await call('PUT', '/v1/team', {token: members[0].token, body: {name: blob()}})).status, 403);
  assert.equal((await call('PUT', '/v1/team', {token: owner.token, body: {name: blob()}})).status, 200);

  // Revoke
  assert.equal((await call('DELETE', `/v1/invites/${inv.code}`, {token: owner.token})).status, 200);
  assert.equal((await call('GET', `/v1/invites/${inv.code}`)).status, 404);
  const kinds = (await call('GET', '/v1/audit', {token: owner.token})).data.map((e) => e.kind);
  assert.equal(kinds[0], 'invite_revoked');
  assert.ok(kinds.includes('created') && kinds.includes('joined') && kinds.includes('invite_created'));
  assert.ok(!kinds.includes('share'));
});

test('removal, leaving, roles and ownership transfer', async () => {
  const {call, db} = plain;
  const owner = await newTeam(call);
  const memberInv = await invite(call, owner.token);
  const adminInv = await invite(call, owner.token, {role: 'admin', uses: 1, days: 1});
  const admin = (await joinWith(call, adminInv.code)).data;
  assert.equal(admin.member.role, 'admin');
  const a = (await joinWith(call, memberInv.code)).data;
  const b = (await joinWith(call, memberInv.code)).data;
  const c = (await joinWith(call, memberInv.code)).data;

  // Admins can't make admin invites or promote; members can't remove.
  assert.equal((await call('POST', '/v1/invites', {token: admin.token, body: {role: 'admin'}})).status, 403);
  assert.equal((await call('PATCH', `/v1/members/${a.member.id}`, {token: admin.token, body: {role: 'admin'}})).status, 403);
  assert.equal((await call('DELETE', `/v1/members/${b.member.id}`, {token: a.token})).status, 403);

  // Admin removes a member: their share and token are gone.
  await call('PUT', '/v1/share', {token: a.token, body: {body: blob()}});
  assert.equal((await call('DELETE', `/v1/members/${a.member.id}`, {token: admin.token})).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM shares WHERE member_id = ?').bind(a.member.id).first()).n, 0);
  assert.equal((await call('GET', '/v1/team', {token: a.token})).status, 401);
  assert.equal((await call('GET', `/v1/shares/${a.member.id}`, {token: owner.token})).status, 404);

  // Admin can't remove the owner; member leaves; owner can't leave.
  assert.equal((await call('DELETE', `/v1/members/${owner.member.id}`, {token: admin.token})).status, 403);
  await call('PUT', '/v1/share', {token: b.token, body: {body: blob()}});
  assert.equal((await call('DELETE', `/v1/members/${b.member.id}`, {token: b.token})).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM shares WHERE member_id = ?').bind(b.member.id).first()).n, 0);
  const ownerLeave = await call('DELETE', `/v1/members/${owner.member.id}`, {token: owner.token});
  assert.equal(ownerLeave.status, 400);
  assert.match(ownerLeave.data.error, /hand over ownership/i);
  assert.doesNotMatch(ownerLeave.data.error, /—/);

  // Owner promotes c to admin, then hands ownership to c.
  assert.equal((await call('PATCH', `/v1/members/${c.member.id}`, {token: owner.token, body: {role: 'admin'}})).status, 200);
  assert.equal((await call('PATCH', `/v1/members/${c.member.id}`, {token: admin.token, body: {role: 'owner'}})).status, 403);
  assert.equal((await call('PATCH', `/v1/members/${c.member.id}`, {token: owner.token, body: {role: 'owner'}})).status, 200);
  const view = await call('GET', '/v1/team', {token: c.token});
  assert.equal(view.data.me.role, 'owner');
  const roles = Object.fromEntries(view.data.members.map((m) => [m.id, m.role]));
  assert.equal(roles[owner.member.id], 'admin');
  assert.equal(Object.values(roles).filter((r) => r === 'owner').length, 1);
  // The old owner can now leave.
  assert.equal((await call('DELETE', `/v1/members/${owner.member.id}`, {token: owner.token})).status, 200);
  const kinds = (await call('GET', '/v1/audit', {token: c.token})).data.map((e) => e.kind);
  for (const k of ['removed', 'left', 'role']) assert.ok(kinds.includes(k), k);
});

test('read-only after the trial ends', async () => {
  const {call, db} = plain;
  const owner = await newTeam(call);
  const inv = await invite(call, owner.token);
  await db.prepare('UPDATE teams SET trial_ends = ? WHERE id = ?').bind(Date.now() - 1000, owner.team.id).run();
  const view = await call('GET', '/v1/team', {token: owner.token});
  assert.equal(view.data.team.readOnly, true);
  assert.equal((await call('PUT', '/v1/share', {token: owner.token, body: {body: blob()}})).status, 402);
  assert.equal((await call('POST', '/v1/invites', {token: owner.token, body: {}})).status, 402);
  assert.equal((await joinWith(call, inv.code)).status, 402);
  // Reading still works.
  assert.equal((await call('GET', '/v1/shares', {token: owner.token})).status, 200);
  // Canceled teams are read-only too; active ones aren't.
  await db.prepare("UPDATE teams SET plan = 'active' WHERE id = ?").bind(owner.team.id).run();
  assert.equal((await call('PUT', '/v1/share', {token: owner.token, body: {body: blob()}})).status, 200);
  await db.prepare("UPDATE teams SET plan = 'canceled' WHERE id = ?").bind(owner.team.id).run();
  assert.equal((await call('PUT', '/v1/share', {token: owner.token, body: {body: blob()}})).status, 402);
});

test('deleting a team wipes everything', async () => {
  const {call, db} = plain;
  const owner = await newTeam(call);
  const inv = await invite(call, owner.token);
  const m = (await joinWith(call, inv.code)).data;
  await call('PUT', '/v1/share', {token: m.token, body: {body: blob()}});
  assert.equal((await call('DELETE', '/v1/team', {token: m.token})).status, 403);
  assert.equal((await call('DELETE', '/v1/team', {token: owner.token})).status, 200);
  for (const t of ['shares', 'invites', 'events', 'members']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE team_id = ?`).bind(owner.team.id).first()).n, 0, t);
  }
  assert.equal(await db.prepare('SELECT id FROM teams WHERE id = ?').bind(owner.team.id).first(), null);
  assert.equal((await call('GET', '/v1/team', {token: m.token})).status, 401);
});

test('invite page', async () => {
  const {call} = plain;
  const owner = await newTeam(call);
  const inv = await invite(call, owner.token);
  const ok = await call('GET', `/join/${inv.code}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/html/);
  assert.match(ok.data, /You're invited to a team on Northfix/);
  assert.match(ok.data, /bearings:\/\/team\/join\?code=/);
  assert.match(ok.data, /This link is missing its key/);
  assert.match(ok.data, /northfix\.app/);
  assert.match(ok.data, /#0D0A17/);
  const nonce = /nonce="([^"]+)"/.exec(ok.data)[1];
  assert.match(ok.headers.get('content-security-policy'), new RegExp(`nonce-${nonce}`));
  const bad = await call('GET', '/join/ZZZZZZZZZZ');
  assert.equal(bad.status, 404);
  assert.match(bad.data, /This invite has expired or was revoked\./);
  assert.doesNotMatch(bad.data, /bearings:\/\//);
  const evil = await call('GET', `/join/${encodeURIComponent('<script>alert(1)</script>')}`);
  assert.equal(evil.status, 404);
  assert.doesNotMatch(evil.data, /<script>alert/);
});

test('billing returns 501 when Stripe is not set up', async () => {
  const {call} = plain;
  const owner = await newTeam(call);
  const b = await call('GET', '/v1/billing', {token: owner.token});
  assert.deepEqual(b.data, {plan: 'trial', seats: 5, used: 1, trialEnds: b.data.trialEnds, renewsAt: null, canCheckout: false, canSubscribeOnAppStore: true});
  assert.equal((await call('POST', '/v1/billing/checkout', {token: owner.token, body: {seats: 5}})).status, 501);
  assert.equal((await call('POST', '/v1/billing/portal', {token: owner.token})).status, 501);
  const w = await call('POST', '/stripe/webhook', {raw: '{}'});
  assert.equal(w.status, 501);
  assert.ok(w.data.error);
});

function signed(payload, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return {raw, headers: {'stripe-signature': `t=${t},v1=${sig}`, 'content-type': 'application/json'}};
}

test('checkout, portal and Stripe webhooks', async () => {
  const {call, db} = billed;
  const owner = await newTeam(call);
  const inv = await invite(call, owner.token);
  const m = (await joinWith(call, inv.code)).data;

  assert.equal((await call('GET', '/v1/billing', {token: owner.token})).data.canCheckout, true);
  assert.equal((await call('POST', '/v1/billing/checkout', {token: m.token, body: {seats: 5}})).status, 403);
  assert.equal((await call('POST', '/v1/billing/checkout', {token: owner.token, body: {seats: 1}})).status, 400); // fewer than members
  const co = await call('POST', '/v1/billing/checkout', {token: owner.token, body: {seats: 12}});
  assert.equal(co.status, 200);
  assert.equal(co.data.url, 'https://checkout.stripe.com/c/pay/cs_1');
  const sent = stripeCalls.find((c) => c.path === '/v1/checkout/sessions');
  assert.equal(sent.auth, 'Bearer sk_test_x');
  assert.deepEqual(sent.form, {
    mode: 'subscription', 'line_items[0][price]': 'price_x', 'line_items[0][quantity]': '12',
    success_url: 'http://team.test/billing/done', cancel_url: 'http://team.test/billing/done',
    client_reference_id: owner.team.id, 'metadata[team_id]': owner.team.id, 'subscription_data[metadata][team_id]': owner.team.id,
  });
  assert.equal((await call('POST', '/v1/billing/portal', {token: owner.token})).status, 400); // no customer yet

  // Bad signatures are refused and change nothing.
  const done = {type: 'checkout.session.completed', data: {object: {mode: 'subscription', client_reference_id: owner.team.id, customer: 'cus_1', subscription: 'sub_1', metadata: {team_id: owner.team.id}}}};
  const forged = signed(done, 'whsec_wrong');
  assert.equal((await call('POST', '/stripe/webhook', forged)).status, 400);
  const stale = signed(done, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 600);
  assert.equal((await call('POST', '/stripe/webhook', stale)).status, 400);
  assert.equal((await call('POST', '/stripe/webhook', {raw: forged.raw, headers: {'content-type': 'application/json'}})).status, 400);
  assert.equal((await db.prepare('SELECT plan FROM teams WHERE id = ?').bind(owner.team.id).first()).plan, 'trial');

  // checkout.session.completed: fetches the subscription for seats and status.
  const ok = await call('POST', '/stripe/webhook', signed(done));
  assert.equal(ok.status, 200);
  let team = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(owner.team.id).first();
  assert.equal(team.plan, 'active');
  assert.equal(team.seats, 12);
  assert.equal(team.stripe_customer, 'cus_1');
  assert.equal(team.stripe_sub, 'sub_1');
  assert.ok(stripeCalls.some((c) => c.method === 'GET' && c.path === '/v1/subscriptions/sub_1'));

  // Portal works once there's a customer.
  const portal = await call('POST', '/v1/billing/portal', {token: owner.token});
  assert.equal(portal.data.url, 'https://billing.stripe.com/p/session/1');

  // subscription.updated finds the team by stripe_sub when metadata is missing.
  const upd = {type: 'customer.subscription.updated', data: {object: {id: 'sub_1', customer: 'cus_1', status: 'past_due', items: {data: [{quantity: 20}]}}}};
  assert.equal((await call('POST', '/stripe/webhook', signed(upd))).status, 200);
  team = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(owner.team.id).first();
  assert.equal(team.plan, 'past_due');
  assert.equal(team.seats, 20);

  const del = {type: 'customer.subscription.deleted', data: {object: {id: 'sub_1', customer: 'cus_1', status: 'canceled', metadata: {team_id: owner.team.id}, items: {data: [{quantity: 20}]}}}};
  assert.equal((await call('POST', '/stripe/webhook', signed(del))).status, 200);
  assert.equal((await db.prepare('SELECT plan FROM teams WHERE id = ?').bind(owner.team.id).first()).plan, 'canceled');
  assert.equal((await call('GET', '/v1/team', {token: owner.token})).data.team.readOnly, true);
  assert.ok((await call('GET', '/v1/audit', {token: owner.token})).data.some((e) => e.kind === 'billing' && e.actor === 'stripe'));

  // Unknown events are acknowledged.
  assert.equal((await call('POST', '/stripe/webhook', signed({type: 'invoice.paid', data: {object: {}}}))).status, 200);
});

test('billing done page', async () => {
  const r = await plain.call('GET', '/billing/done');
  assert.equal(r.status, 200);
  assert.match(r.data, /You're all set\./);
  assert.match(r.data, /Go back to Northfix\./);
});

// ---------- App Store starter plan ----------

// A worker whose Apple verifier is a stub: it trusts the JWS payload as long as the bundle
// and product match, and refuses a payload with `refuse` set. Real verification is covered
// in apple.test.mjs.
const STUB_ENTRY = `import {createWorker} from './worker.js';
import {AppleVerifyError} from './apple.js';
export default createWorker({verifyApple: async (jws, {bundleId, productIds, allowSandbox}) => {
  const payload = JSON.parse(atob(jws.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (payload.refuse) throw new AppleVerifyError(payload.refuse, 'stub');
  if (payload.bundleId !== bundleId) throw new AppleVerifyError('That purchase belongs to a different app.', 'bundle');
  if (!productIds.includes(payload.productId)) throw new AppleVerifyError("That purchase isn't a Northfix Team subscription.", 'product');
  if (payload.environment !== 'Production' && !(allowSandbox && payload.environment === 'Sandbox')) throw new AppleVerifyError("That's a test purchase, not a real one.", 'environment');
  return payload;
}});`;
async function startWithStub(bindings = {}) {
  const read = (f) => readFile(new URL(f, here), 'utf8');
  return start(bindings, {
    scriptPath: undefined,
    modulesRoot: here.pathname,
    modules: [
      {type: 'ESModule', path: `${here.pathname}entry.js`, contents: STUB_ENTRY},
      {type: 'ESModule', path: `${here.pathname}worker.js`, contents: await read('worker.js')},
      {type: 'ESModule', path: `${here.pathname}apple.js`, contents: await read('apple.js')},
      {type: 'ESModule', path: `${here.pathname}migrate.js`, contents: await read('migrate.js')},
    ],
  });
}
const apple = await startWithStub();
after(async () => { await apple.mf.dispose(); });

// A JWS-shaped token whose payload is `claims`; the stub verifier reads only the payload.
function fakeJWS(claims) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({alg: 'ES256', x5c: []})}.${part(claims)}.${Buffer.from('sig').toString('base64url')}`;
}
const inAYear = () => Date.now() + 365 * 86400000;
const team5 = (extra = {}) => ({bundleId: 'com.jaynichols.networkoob', productId: 'com.jaynichols.networkoob.team5', environment: 'Production', originalTransactionId: '2000000001', transactionId: '2000000009', expiresDate: inAYear(), ...extra});

test('App Store: subscribing moves a trial to team5 with 5 seats and a renewal date', async () => {
  const {call, db} = apple;
  const owner = await newTeam(call);
  const inv = await invite(call, owner.token);
  const m = (await joinWith(call, inv.code)).data;

  // Owner only, and the transaction is required.
  assert.equal((await call('POST', '/v1/billing/apple', {token: m.token, body: {transaction: fakeJWS(team5())}})).status, 403);
  assert.equal((await call('POST', '/v1/billing/apple', {token: owner.token, body: {}})).status, 400);
  assert.equal((await call('POST', '/v1/billing/apple', {token: owner.token, body: {transaction: 'x'.repeat(20001)}})).status, 413);

  // Refused transactions leave the team alone and say why in plain English.
  for (const [claims, re] of [
    [team5({bundleId: 'com.example.other'}), /different app/],
    [team5({productId: 'com.jaynichols.networkoob.pro.yearly'}), /isn't a Northfix Team subscription/],
    [team5({environment: 'Sandbox'}), /test purchase/],
    [team5({expiresDate: Date.now() - 1000}), /has ended/],
    [team5({refuse: "The App Store didn't confirm that subscription."}), /didn't confirm/],
  ]) {
    const r = await call('POST', '/v1/billing/apple', {token: owner.token, body: {transaction: fakeJWS(claims)}});
    assert.equal(r.status, 402, JSON.stringify(r.data));
    assert.match(r.data.error, re);
    assert.doesNotMatch(r.data.error, /—/);
  }
  assert.equal((await db.prepare('SELECT plan FROM teams WHERE id = ?').bind(owner.team.id).first()).plan, 'trial');

  // A good one.
  const expires = inAYear();
  const ok = await call('POST', '/v1/billing/apple', {token: owner.token, body: {transaction: fakeJWS(team5({expiresDate: expires}))}});
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(ok.data, {plan: 'team5', seats: 5, renewsAt: expires});
  const row = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(owner.team.id).first();
  assert.equal(row.plan, 'team5');
  assert.equal(row.seats, 5);
  assert.equal(row.apple_transaction_id, '2000000001');
  assert.equal(row.apple_expires, expires);
  const view = await call('GET', '/v1/team', {token: m.token});
  assert.equal(view.data.team.plan, 'team5');
  assert.equal(view.data.team.renewsAt, expires);
  assert.equal(view.data.team.readOnly, false);
  const b = await call('GET', '/v1/billing', {token: owner.token});
  assert.equal(b.data.renewsAt, expires);
  assert.equal(b.data.canSubscribeOnAppStore, true);
  assert.ok((await call('GET', '/v1/audit', {token: owner.token})).data.some((e) => e.kind === 'billing' && e.target === `team5:${expires}`));

  // The same subscription can't pay for a second team.
  const second = await newTeam(call);
  const dup = await call('POST', '/v1/billing/apple', {token: second.token, body: {transaction: fakeJWS(team5())}});
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /already pays for another team/);

  // Renewal: the app sends the latest transaction again and the date moves forward.
  const later = expires + 365 * 86400000;
  assert.equal((await call('POST', '/v1/billing/apple', {token: owner.token, body: {transaction: fakeJWS(team5({transactionId: '2000000010', expiresDate: later}))}})).status, 200);
  assert.equal((await db.prepare('SELECT apple_expires FROM teams WHERE id = ?').bind(owner.team.id).first()).apple_expires, later);
});

test('App Store: a lapsed team5 plan is read-only until the renewal arrives', async () => {
  const {call, db} = apple;
  const owner = await newTeam(call);
  const mine = {originalTransactionId: '2000000500'};
  assert.equal((await call('POST', '/v1/billing/apple', {token: owner.token, body: {transaction: fakeJWS(team5(mine))}})).status, 200);
  await db.prepare('UPDATE teams SET apple_expires = ? WHERE id = ?').bind(Date.now() - 1000, owner.team.id).run();
  const view = await call('GET', '/v1/team', {token: owner.token});
  assert.equal(view.data.team.readOnly, true);
  assert.equal((await call('PUT', '/v1/share', {token: owner.token, body: {body: blob()}})).status, 402);
  assert.equal((await call('POST', '/v1/invites', {token: owner.token, body: {}})).status, 402);
  // The renewed transaction brings it back.
  assert.equal((await call('POST', '/v1/billing/apple', {token: owner.token, body: {transaction: fakeJWS(team5({...mine, expiresDate: inAYear()}))}})).status, 200);
  assert.equal((await call('GET', '/v1/team', {token: owner.token})).data.team.readOnly, false);
  assert.equal((await call('PUT', '/v1/share', {token: owner.token, body: {body: blob()}})).status, 200);
});

test('App Store: seat limit, teams on Stripe, and sandbox when allowed', async () => {
  const {call, db} = apple;
  // Six people already: the starter plan doesn't fit.
  const owner = await newTeam(call);
  await db.prepare('UPDATE teams SET seats = 10 WHERE id = ?').bind(owner.team.id).run();
  const inv = await invite(call, owner.token);
  for (let i = 0; i < 5; i++) assert.equal((await joinWith(call, inv.code)).status, 200);
  const big = await call('POST', '/v1/billing/apple', {token: owner.token, body: {transaction: fakeJWS(team5({originalTransactionId: '3'}))}});
  assert.equal(big.status, 409);
  assert.match(big.data.error, /covers up to 5/);
  assert.equal((await db.prepare('SELECT seats FROM teams WHERE id = ?').bind(owner.team.id).first()).seats, 10);

  // A team billed through Stripe manages billing there.
  const stripeTeam = await newTeam(call);
  await db.prepare("UPDATE teams SET plan = 'active', seats = 12 WHERE id = ?").bind(stripeTeam.team.id).run();
  const web = await call('POST', '/v1/billing/apple', {token: stripeTeam.token, body: {transaction: fakeJWS(team5({originalTransactionId: '4'}))}});
  assert.equal(web.status, 409);
  assert.match(web.data.error, /billed on the web/);
  assert.equal((await call('GET', '/v1/billing', {token: stripeTeam.token})).data.canSubscribeOnAppStore, false);

  // Sandbox purchases are refused unless APPLE_ALLOW_SANDBOX is set.
  const sandbox = await startWithStub({APPLE_ALLOW_SANDBOX: 'true'});
  try {
    const t = await newTeam(sandbox.call);
    assert.equal((await sandbox.call('POST', '/v1/billing/apple', {token: t.token, body: {transaction: fakeJWS(team5({environment: 'Sandbox'}))}})).status, 200);
  } finally { await sandbox.mf.dispose(); }
});

// The teams table before the App Store plan existed. A worker instance brings it forward
// before its first request, keeping every row.
const OLD_TEAMS_TABLE = `CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name_enc TEXT NOT NULL,
  created INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'active', 'past_due', 'canceled')),
  seats INTEGER NOT NULL DEFAULT 5,
  trial_ends INTEGER NOT NULL,
  stripe_customer TEXT,
  stripe_sub TEXT
)`;

test('App Store: an older database is migrated on the first request', async () => {
  const mf = new Miniflare({
    modules: true, modulesRules: [{type: 'ESModule', include: ['**/*.js']}], scriptPath: new URL('worker.js', here).pathname,
    compatibilityDate: '2026-07-01', d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    // The old schema: the old teams table, then everything else from schema.sql.
    await db.prepare(OLD_TEAMS_TABLE).run();
    const rest = schema.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter((s) => s && !/^CREATE TABLE IF NOT EXISTS teams\b/.test(s));
    for (const s of rest) await db.prepare(s).run();
    await db.prepare("INSERT INTO teams (id, name_enc, created, plan, seats, trial_ends, stripe_customer, stripe_sub) VALUES ('t1', 'enc', 1, 'active', 12, 2, 'cus_1', 'sub_1')").run();
    const before = await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'teams'").first();
    assert.doesNotMatch(before.sql, /team5/);

    const res = await mf.dispatchFetch('http://team.test/health');
    assert.equal(res.status, 200);

    const after = await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'teams'").first();
    assert.match(after.sql, /'team5'/);
    assert.match(after.sql, /apple_transaction_id TEXT/);
    assert.match(after.sql, /apple_expires INTEGER/);
    const row = await db.prepare('SELECT * FROM teams WHERE id = ?').bind('t1').first();
    assert.deepEqual(row, {id: 't1', name_enc: 'enc', created: 1, plan: 'active', seats: 12, trial_ends: 2, stripe_customer: 'cus_1', stripe_sub: 'sub_1', apple_transaction_id: null, apple_expires: null});
    await db.prepare("UPDATE teams SET plan = 'team5' WHERE id = 't1'").run(); // the widened CHECK allows it
    const {results: indexes} = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'teams'").all();
    const names = indexes.map((i) => i.name);
    assert.ok(names.includes('teams_stripe_sub') && names.includes('teams_apple_transaction'), names.join(','));
    // Running again changes nothing.
    assert.equal((await mf.dispatchFetch('http://team.test/health')).status, 200);
    assert.equal((await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'teams'").first()).sql, after.sql);
  } finally { await mf.dispose(); }
});

test('migrate.js describes the same teams table as schema.sql', async () => {
  const {TEAMS_TABLE} = await import('../migrate.js');
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  const fromSchema = schema.replace(/--.*$/gm, '').split(';').map(normalize).find((s) => s.startsWith('CREATE TABLE IF NOT EXISTS teams'));
  assert.equal(normalize(TEAMS_TABLE), fromSchema);
  // On a fresh database, the worker still adds the App Store index on its first request.
  const idx = await plain.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'teams_apple_transaction'").first();
  assert.ok(idx);
});
