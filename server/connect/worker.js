// Bearings sign-in helper: "Connect LinkedIn" (EEA and Switzerland) and "Sign in with Seamless.AI".
//
// Both providers need an OAuth client secret to turn a sign-in code into an access token,
// and a secret can't live inside an app. This tiny worker does only that swap (and Seamless'
// token refresh). It never sees, stores or logs any LinkedIn or Seamless data: the app then
// talks to LinkedIn or Seamless directly, from the device.
//
// Routes:
//   GET  /linkedin/start?state=…    LinkedIn's consent screen
//   GET  /linkedin/callback         code → token → bearings://linkedin#…
//   GET  /seamless/start?state=…    Seamless' sign-in
//   GET  /seamless/callback         code → tokens → bearings://seamless#…
//   POST /seamless/refresh          {refresh_token} → new tokens (JSON)
// Secrets: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, SEAMLESS_CLIENT_ID, SEAMLESS_CLIENT_SECRET

const STATE = /^[A-Za-z0-9_-]{16,100}$/;
const toApp = (where, params) => new Response(null, {status: 302, headers: {Location: `bearings://${where}#${new URLSearchParams(params)}`, 'Cache-Control': 'no-store'}});
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', 'Cache-Control': 'no-store'}});

async function linkedin(url, env) {
  const redirect = `${url.origin}/linkedin/callback`;
  if (url.pathname === '/linkedin/start') {
    const state = url.searchParams.get('state') || '';
    if (!STATE.test(state) || !env.LINKEDIN_CLIENT_ID) return new Response('Bad request', {status: 400});
    const to = new URL('https://www.linkedin.com/oauth/v2/authorization');
    to.search = new URLSearchParams({response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID, redirect_uri: redirect, state, scope: 'r_dma_portability_3rd_party'}).toString();
    return Response.redirect(to.toString(), 302);
  }
  const state = url.searchParams.get('state') || '';
  const err = url.searchParams.get('error');
  if (err) return toApp('linkedin', {state, error: url.searchParams.get('error_description') || err});
  const code = url.searchParams.get('code');
  if (!code) return toApp('linkedin', {state, error: 'LinkedIn didn’t send a sign-in code.'});
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) return toApp('linkedin', {state, error: body.error_description || 'LinkedIn didn’t accept the sign-in. Try again.'});
  return toApp('linkedin', {state, token: body.access_token, expires: String(body.expires_in || '')});
}

const SEAMLESS_TOKEN = 'https://api.seamless.ai/api/client/v1/oauth/accessToken';
async function seamlessToken(env, redirect, extra) {
  const res = await fetch(SEAMLESS_TOKEN, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({client_id: env.SEAMLESS_CLIENT_ID, client_secret: env.SEAMLESS_CLIENT_SECRET, redirect_uri: redirect, ...extra}),
  });
  const body = await res.json().catch(() => ({}));
  return {ok: res.ok && !!body.access_token, body};
}

async function seamless(req, url, env) {
  const redirect = `${url.origin}/seamless/callback`;
  if (url.pathname === '/seamless/start') {
    const state = url.searchParams.get('state') || '';
    if (!STATE.test(state) || !env.SEAMLESS_CLIENT_ID) return new Response('Bad request', {status: 400});
    const to = new URL('https://login.seamless.ai/oauth/authorize');
    to.search = new URLSearchParams({client_id: env.SEAMLESS_CLIENT_ID, redirect_uri: redirect, response_type: 'code', state}).toString();
    return Response.redirect(to.toString(), 302);
  }
  if (url.pathname === '/seamless/callback') {
    const state = url.searchParams.get('state') || '';
    const err = url.searchParams.get('error');
    if (err) return toApp('seamless', {state, error: url.searchParams.get('error_description') || err});
    const code = url.searchParams.get('code');
    if (!code) return toApp('seamless', {state, error: 'Seamless.AI didn’t send a sign-in code.'});
    const t = await seamlessToken(env, redirect, {grant_type: 'authorization_code', code});
    if (!t.ok) return toApp('seamless', {state, error: t.body.message || t.body.error_description || 'Seamless.AI didn’t accept the sign-in. Try again.'});
    return toApp('seamless', {state, token: t.body.access_token, refresh: t.body.refresh_token || '', expires: String(t.body.expires_in || 10800)});
  }
  if (url.pathname === '/seamless/refresh' && req.method === 'POST') {
    const {refresh_token} = await req.json().catch(() => ({}));
    if (!refresh_token || typeof refresh_token !== 'string') return json({error: 'missing refresh_token'}, 400);
    const t = await seamlessToken(env, redirect, {grant_type: 'refresh_token', refresh_token});
    if (!t.ok) return json({error: t.body.message || 'refresh failed'}, 401);
    return json({access_token: t.body.access_token, refresh_token: t.body.refresh_token || refresh_token, expires_in: t.body.expires_in || 10800});
  }
  return null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/linkedin/')) return linkedin(url, env);
    if (url.pathname.startsWith('/seamless/')) { const r = await seamless(req, url, env); if (r) return r; }
    return new Response('Bearings', {status: 404});
  },
};
