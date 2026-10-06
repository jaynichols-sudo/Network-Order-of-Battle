// Provider sign-ins on this phone: each value is encrypted with an AES key that can't be
// read out of the app (a non-extractable WebCrypto key kept in the app's private storage).
// Nothing here is backed up or synced.
const DB = 'bearings-secrets', STORE = 'kv';

function db(){
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx(mode, fn){
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
    const req = fn(s);
    t.oncomplete = () => { d.close(); resolve(req && req.result); };
    t.onerror = () => { d.close(); reject(t.error); };
  });
}
let keyP = null;
function key(){
  if (!keyP) keyP = (async () => {
    const have = await tx('readonly', s => s.get('__key'));
    if (have) return have;
    const k = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
    await tx('readwrite', s => s.put(k, '__key'));
    return k;
  })();
  return keyP;
}

const cache = new Map();
export const Secrets = {
  async get(name){
    if (cache.has(name)) return cache.get(name);
    try {
      const rec = await tx('readonly', s => s.get(name));
      if (!rec) { cache.set(name, ''); return ''; }
      const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: rec.iv}, await key(), rec.data);
      const v = new TextDecoder().decode(plain);
      cache.set(name, v);
      return v;
    } catch { return ''; }
  },
  async set(name, value){
    cache.delete(name);
    if (!value){ await tx('readwrite', s => s.delete(name)).catch(() => {}); cache.set(name, ''); return; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await key(), new TextEncoder().encode(value));
    await tx('readwrite', s => s.put({iv, data}, name));
    cache.set(name, value);
  },
};
