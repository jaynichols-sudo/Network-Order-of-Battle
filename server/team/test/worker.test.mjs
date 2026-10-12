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
  assert.match(ok.data, /jaynichols-sudo\.github\.io\/Bearings-site/);
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
  assert.deepEqual(b.data, {plan: 'trial', seats: 5, used: 1, trialEnds: b.data.trialEnds, canCheckout: false});
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
