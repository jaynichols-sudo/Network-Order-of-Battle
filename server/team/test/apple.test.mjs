// Unit tests for apple.js: JWS decoding, X.509 parsing and chain verification. They run in
// Node directly (the module uses only web crypto). The chain in fixtures/ is shaped like
// Apple's (a P-384 root, a P-384 intermediate with the WWDR marker, a P-256 leaf with the
// receipt-signing marker), made with openssl and valid for a hundred years.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPrivateKey, createSign} from 'node:crypto';
import {decodeJWS, verifyAppleJWS, parseCertificate, signedBy, pemToDer, APPLE_ROOT_CA_G3_PEM, AppleVerifyError} from '../apple.js';

const fixtures = new URL('fixtures/', import.meta.url);
const pem = (f) => readFile(new URL(f, fixtures), 'utf8');
const der = async (f) => pemToDer(await pem(f));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const b64url = (s) => Buffer.from(s).toString('base64url');

const BUNDLE = 'com.jaynichols.networkoob';
const PRODUCT = 'com.jaynichols.networkoob.team5';
const leafKey = createPrivateKey(await pem('test-leaf-key.pem'));
const chain = {leaf: await der('test-leaf.pem'), intermediate: await der('test-intermediate.pem'), root: await der('test-root.pem')};
const options = {bundleId: BUNDLE, productIds: [PRODUCT], roots: [chain.root]};

// Signs `claims` the way the App Store does: ES256, with the chain in x5c.
function sign(claims, x5c = [chain.leaf, chain.intermediate, chain.root], {alg = 'ES256', key = leafKey} = {}) {
  const header = b64url(JSON.stringify({alg, x5c: x5c.map(b64)}));
  const payload = b64url(JSON.stringify(claims));
  const sig = createSign('sha256').update(`${header}.${payload}`).sign({key, dsaEncoding: 'ieee-p1363'});
  return `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`;
}
const claims = (extra = {}) => ({bundleId: BUNDLE, productId: PRODUCT, environment: 'Production', originalTransactionId: '2000000001', transactionId: '2000000002', expiresDate: Date.now() + 86400000, ...extra});

async function refused(jws, opts, reason) {
  await assert.rejects(verifyAppleJWS(jws, opts), (e) => {
    assert.ok(e instanceof AppleVerifyError, `${e}`);
    assert.equal(e.reason, reason);
    assert.doesNotMatch(e.message, /—/);
    return true;
  });
}

test('decodeJWS splits a crafted token without checking it', () => {
  const header = {alg: 'ES256', x5c: [b64(chain.leaf), b64(chain.intermediate), b64(chain.root)]};
  const payload = {bundleId: BUNDLE, productId: PRODUCT, expiresDate: 1234567890123, environment: 'Sandbox'};
  const token = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.${Buffer.from([1, 2, 3, 255]).toString('base64url')}`;
  const d = decodeJWS(token);
  assert.deepEqual(d.header, header);
  assert.deepEqual(d.payload, payload);
  assert.equal(d.signingInput, token.slice(0, token.lastIndexOf('.')));
  assert.deepEqual([...d.signature], [1, 2, 3, 255]);
  assert.equal(d.chain.length, 3);
  assert.deepEqual([...d.chain[0]], [...chain.leaf]);
  // Base64url with no padding, and payloads that aren't objects, are handled.
  assert.equal(decodeJWS(`${b64url('{"alg":"ES256"}')}.${b64url('{"a":1}')}.`).payload.a, 1);
  for (const bad of ['', 'a.b', 'a.b.c.d', `${b64url('[]')}.${b64url('{}')}.x`, `${b64url('{}')}.${b64url('"s"')}.x`, 'not base64!.x.y', 42]) {
    assert.throws(() => decodeJWS(bad), (e) => e instanceof AppleVerifyError && e.reason === 'format');
  }
});

test('parseCertificate reads Apple Root CA - G3 and the test chain', async () => {
  const apple = parseCertificate(pemToDer(APPLE_ROOT_CA_G3_PEM));
  assert.equal(apple.curve.name, 'P-384');
  assert.equal(apple.sigAlg, '1.2.840.10045.4.3.3'); // ecdsa-with-SHA384
  assert.equal(new Date(apple.notBefore).toISOString(), '2014-04-30T18:19:06.000Z');
  assert.equal(new Date(apple.notAfter).toISOString(), '2039-04-30T18:19:06.000Z');
  assert.equal(apple.isCA, true);
  assert.ok(await signedBy(apple, apple), 'self-signed');
  // The published SHA-256 fingerprint of Apple Root CA - G3.
  const fp = Buffer.from(await crypto.subtle.digest('SHA-256', pemToDer(APPLE_ROOT_CA_G3_PEM))).toString('hex');
  assert.equal(fp, '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179');

  const leaf = parseCertificate(chain.leaf), inter = parseCertificate(chain.intermediate), root = parseCertificate(chain.root);
  assert.equal(leaf.curve.name, 'P-256');
  assert.equal(leaf.isCA, false);
  assert.ok('1.2.840.113635.100.6.11.1' in leaf.extensions);
  assert.ok(inter.isCA);
  assert.ok('1.2.840.113635.100.6.2.1' in inter.extensions);
  assert.ok(await signedBy(inter, root));
  assert.ok(await signedBy(leaf, inter));
  assert.equal(await signedBy(leaf, root), false);
  assert.equal(await signedBy(inter, inter), false);
});

test('verifyAppleJWS accepts a transaction signed by the test chain', async () => {
  const c = claims();
  const tx = await verifyAppleJWS(sign(c), options);
  assert.deepEqual(tx, c);
  // Sandbox only when allowed; a fixed clock works too.
  await refused(sign(claims({environment: 'Sandbox'})), options, 'environment');
  assert.equal((await verifyAppleJWS(sign(claims({environment: 'Sandbox'})), {...options, allowSandbox: true})).environment, 'Sandbox');
  assert.equal((await verifyAppleJWS(sign(c), {...options, at: Date.now() + 365 * 86400000})).transactionId, c.transactionId);
});

test('verifyAppleJWS refuses anything off the chain or off the claims', async () => {
  const c = claims();
  // Signed by a chain that doesn't end at the trusted root; the real Apple root doesn't trust the test chain either.
  await refused(sign(c, [chain.leaf, await der('other-intermediate.pem'), await der('other-root.pem')]), options, 'root');
  await refused(sign(c), {...options, roots: undefined}, 'root');
  // The leaf without Apple's receipt-signing marker, or a chain of the wrong length.
  await refused(sign(c, [await der('test-leaf-no-marker.pem'), chain.intermediate, chain.root]), options, 'leaf');
  await refused(sign(c, [chain.leaf, chain.intermediate]), options, 'chain');
  await refused(sign(c, [chain.leaf, chain.leaf, chain.root]), options, 'root');
  // Tampering: the payload changed, or the signature did, or the algorithm isn't ES256.
  const good = sign(c);
  const [h, , s] = good.split('.');
  await refused(`${h}.${b64url(JSON.stringify(claims({productId: PRODUCT, expiresDate: c.expiresDate + 1})))}.${s}`, options, 'signature');
  await refused(`${h}.${good.split('.')[1]}.${Buffer.alloc(64, 7).toString('base64url')}`, options, 'signature');
  await refused(sign(c, undefined, {alg: 'HS256'}), options, 'alg');
  // Certificates outside their dates.
  await refused(sign(c), {...options, at: Date.UTC(2000, 0, 1)}, 'expired-certificate');
  // Claims that don't fit.
  await refused(sign(claims({bundleId: 'com.example.other'})), options, 'bundle');
  await refused(sign(claims({productId: 'com.jaynichols.networkoob.pro.yearly'})), options, 'product');
  await refused(sign(claims({revocationDate: Date.now() - 1000})), options, 'revoked');
  await refused(sign(claims({expiresDate: undefined})), options, 'expires');
  await refused(sign(c), {...options, bundleId: undefined}, 'bundle');
});
