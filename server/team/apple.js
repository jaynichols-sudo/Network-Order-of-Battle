// App Store subscriptions for Northfix Team, checked on the server.
//
// The app sends a StoreKit 2 transaction as a JWS (`Transaction.jwsRepresentation`). Apple
// signs it with a leaf certificate whose chain (in the JWS header's x5c) ends at Apple Root
// CA - G3. This module checks that chain and the signature with the Workers crypto API, no
// libraries, then returns the transaction's claims.
//
// What's checked, in order:
//   1. The JWS is three base64url parts and alg is ES256.
//   2. x5c holds exactly three certificates: leaf, intermediate, root.
//   3. The intermediate is signed by a trusted root (Apple Root CA - G3, below), is a CA, and
//      carries Apple's Worldwide Developer Relations marker (1.2.840.113635.100.6.2.1).
//   4. The leaf is signed by the intermediate and carries Apple's receipt-signing marker
//      (1.2.840.113635.100.6.11.1).
//   5. Every certificate is within its validity dates.
//   6. The JWS signature verifies with the leaf's P-256 key.
//   7. The claims name the app's bundle, one of the expected products and the expected
//      environment, and the transaction isn't revoked.
// Revocation (OCSP) isn't checked, which matches Apple's own library with online checks off.

export const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

// Apple's marker extensions. The intermediate carries the first, the leaf the second.
const OID_APPLE_WWDR = '1.2.840.113635.100.6.2.1';
const OID_APPLE_RECEIPT_SIGNING = '1.2.840.113635.100.6.11.1';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const CURVES = {'1.2.840.10045.3.1.7': {name: 'P-256', bytes: 32}, '1.3.132.0.34': {name: 'P-384', bytes: 48}, '1.3.132.0.35': {name: 'P-521', bytes: 66}};
const SIGNATURE_HASHES = {'1.2.840.10045.4.3.2': 'SHA-256', '1.2.840.10045.4.3.3': 'SHA-384', '1.2.840.10045.4.3.4': 'SHA-512'};

/** Thrown for anything that keeps a transaction from being trusted. `message` is plain English for the app. */
export class AppleVerifyError extends Error {
  constructor(message, reason) { super(message); this.reason = reason; }
}
const refuse = (reason, message = "The App Store didn't confirm that subscription.") => { throw new AppleVerifyError(message, reason); };

// ---------- bytes ----------

export function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return base64ToBytes(b64);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64urlToBytes(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return base64ToBytes(b64);
}

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- DER ----------

// Reads one TLV at `offset`. Returns the tag, where the content starts and ends, and the end of the whole element.
function tlv(bytes, offset) {
  if (offset + 2 > bytes.length) throw new Error('DER: truncated');
  const tag = bytes[offset];
  let len = bytes[offset + 1], pos = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || pos + n > bytes.length) throw new Error('DER: bad length');
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | bytes[pos++];
  }
  if (pos + len > bytes.length) throw new Error('DER: truncated');
  return {tag, start: pos, end: pos + len, next: pos + len, offset};
}

// The children of a constructed element, in order.
function children(bytes, el) {
  const out = [];
  let pos = el.start;
  while (pos < el.end) { const c = tlv(bytes, pos); out.push(c); pos = c.next; }
  return out;
}

const slice = (bytes, el) => bytes.subarray(el.offset, el.next); // the whole element, header included
const content = (bytes, el) => bytes.subarray(el.start, el.end);

function oid(bytes, el) {
  if (el.tag !== 0x06) throw new Error('DER: expected OID');
  const b = content(bytes, el);
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join('.');
}

// UTCTime (YYMMDDHHMMSSZ) or GeneralizedTime (YYYYMMDDHHMMSSZ) to milliseconds.
function time(bytes, el) {
  const s = String.fromCharCode(...content(bytes, el));
  const m = el.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : el.tag === 0x18 ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(s) : null;
  if (!m) throw new Error('DER: bad time');
  let year = Number(m[1]);
  if (el.tag === 0x17) year += year >= 50 ? 1900 : 2000;
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

/**
 * The parts of an X.509 certificate this module needs. `bytes` is DER.
 * Returns {tbs, sigAlg, signature, issuer, subject, notBefore, notAfter, spki, curve, extensions: {oid: content}, isCA}.
 */
export function parseCertificate(bytes) {
  const cert = tlv(bytes, 0);
  if (cert.tag !== 0x30) throw new Error('DER: not a certificate');
  const [tbs, sigAlgSeq, sigBits] = children(bytes, cert);
  if (!tbs || !sigAlgSeq || !sigBits || sigBits.tag !== 0x03) throw new Error('DER: not a certificate');
  const sigAlg = oid(bytes, children(bytes, sigAlgSeq)[0]);
  const signature = content(bytes, sigBits).subarray(1); // the first byte counts unused bits

  const fields = children(bytes, tbs);
  let i = 0;
  if (fields[i].tag === 0xa0) i++; // [0] version
  i++; // serialNumber
  i++; // signature algorithm (repeated)
  const issuer = slice(bytes, fields[i++]);
  const [nb, na] = children(bytes, fields[i++]);
  const subject = slice(bytes, fields[i++]);
  const spkiEl = fields[i++];
  const spki = slice(bytes, spkiEl);
  const [algSeq] = children(bytes, spkiEl);
  const [keyType, params] = children(bytes, algSeq);
  const curve = keyType && oid(bytes, keyType) === OID_EC_PUBLIC_KEY && params && params.tag === 0x06 ? CURVES[oid(bytes, params)] : null;

  const extensions = {};
  let isCA = false;
  for (; i < fields.length; i++) {
    if (fields[i].tag !== 0xa3) continue; // [3] extensions
    const [seq] = children(bytes, fields[i]);
    for (const ext of children(bytes, seq)) {
      const parts = children(bytes, ext);
      const id = oid(bytes, parts[0]);
      const value = parts[parts.length - 1]; // OCTET STRING, after the optional critical BOOLEAN
      extensions[id] = content(bytes, value);
      if (id === OID_BASIC_CONSTRAINTS) {
        const inner = tlv(extensions[id], 0);
        const [ca] = children(extensions[id], inner);
        isCA = !!(ca && ca.tag === 0x01 && extensions[id][ca.start] !== 0);
      }
    }
  }
  return {tbs: slice(bytes, tbs), sigAlg, signature, issuer, subject, notBefore: time(bytes, nb), notAfter: time(bytes, na), spki, curve, extensions, isCA};
}

// An ECDSA signature in DER (SEQUENCE of two INTEGERs) as the fixed-width r||s that WebCrypto wants.
function rawSignature(der, width) {
  const seq = tlv(der, 0);
  const [r, s] = children(der, seq);
  const out = new Uint8Array(width * 2);
  for (const [n, el] of [[0, r], [1, s]]) {
    let v = content(der, el);
    while (v.length > width && v[0] === 0) v = v.subarray(1);
    if (v.length > width) throw new Error('DER: bad signature');
    out.set(v, n * width + (width - v.length));
  }
  return out;
}

async function publicKey(cert) {
  if (!cert.curve) throw new Error('unsupported key');
  return crypto.subtle.importKey('spki', cert.spki, {name: 'ECDSA', namedCurve: cert.curve.name}, false, ['verify']);
}

/** True when `cert` was signed by `issuer`'s key. */
export async function signedBy(cert, issuer) {
  const hash = SIGNATURE_HASHES[cert.sigAlg];
  if (!hash || !issuer.curve) return false;
  try {
    const key = await publicKey(issuer);
    return await crypto.subtle.verify({name: 'ECDSA', hash}, key, rawSignature(cert.signature, issuer.curve.bytes), cert.tbs);
  } catch { return false; }
}

// ---------- JWS ----------

/**
 * Splits a JWS into its parts without checking anything.
 * Returns {header, payload, signingInput, signature, chain} where chain is the x5c certificates as DER bytes.
 */
export function decodeJWS(jws) {
  if (typeof jws !== 'string') throw new AppleVerifyError("That isn't an App Store transaction.", 'format');
  const parts = jws.split('.');
  if (parts.length !== 3) throw new AppleVerifyError("That isn't an App Store transaction.", 'format');
  let header, payload, signature;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(parts[1])));
    signature = base64urlToBytes(parts[2]);
  } catch { throw new AppleVerifyError("That isn't an App Store transaction.", 'format'); }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') throw new AppleVerifyError("That isn't an App Store transaction.", 'format');
  const chain = Array.isArray(header.x5c) ? header.x5c.map((c) => { try { return base64ToBytes(c); } catch { return new Uint8Array(); } }) : [];
  return {header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature, chain};
}

/**
 * Verifies a StoreKit 2 transaction JWS and returns its claims.
 *
 * options: bundleId (required), productIds (array; the transaction's productId must be one),
 * allowSandbox (accept Sandbox as well as Production), roots (DER root certificates to trust;
 * defaults to Apple Root CA - G3), at (milliseconds; defaults to now).
 */
export async function verifyAppleJWS(jws, options = {}) {
  const {bundleId, productIds = [], allowSandbox = false, at = Date.now()} = options;
  const roots = (options.roots || [pemToDer(APPLE_ROOT_CA_G3_PEM)]).map(parseCertificate);
  const {header, payload, signingInput, signature, chain} = decodeJWS(jws);
  if (header.alg !== 'ES256') refuse('alg');
  if (chain.length !== 3) refuse('chain');
  let leaf, intermediate;
  try { leaf = parseCertificate(chain[0]); intermediate = parseCertificate(chain[1]); } catch { refuse('certificate'); }

  // The chain: a trusted root signed the intermediate, which signed the leaf.
  let root = null;
  for (const r of roots) {
    if (sameBytes(intermediate.issuer, r.subject) && await signedBy(intermediate, r)) { root = r; break; }
  }
  if (!root) refuse('root');
  if (!intermediate.isCA || !(OID_APPLE_WWDR in intermediate.extensions)) refuse('intermediate');
  if (!sameBytes(leaf.issuer, intermediate.subject) || !(await signedBy(leaf, intermediate))) refuse('leaf');
  if (!(OID_APPLE_RECEIPT_SIGNING in leaf.extensions)) refuse('leaf');
  for (const c of [leaf, intermediate, root]) if (at < c.notBefore || at > c.notAfter) refuse('expired-certificate');

  // The signature, with the leaf's key.
  if (!leaf.curve || leaf.curve.name !== 'P-256' || signature.length !== 64) refuse('signature');
  let ok = false;
  try { ok = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, await publicKey(leaf), signature, new TextEncoder().encode(signingInput)); } catch {}
  if (!ok) refuse('signature');

  // The claims.
  if (!bundleId || payload.bundleId !== bundleId) refuse('bundle', 'That purchase belongs to a different app.');
  if (!productIds.includes(payload.productId)) refuse('product', "That purchase isn't a Northfix Team subscription.");
  if (payload.environment !== 'Production' && !(allowSandbox && payload.environment === 'Sandbox')) refuse('environment', "That's a test purchase, not a real one.");
  if (payload.revocationDate) refuse('revoked', 'That purchase was refunded or revoked.');
  if (!Number.isFinite(payload.expiresDate)) refuse('expires', "That purchase isn't a subscription.");
  return payload;
}
