// Bearings "Connect LinkedIn" helper, for members in the EEA and Switzerland.
//
// LinkedIn's Member Data Portability API needs an OAuth client secret to turn the sign-in
// code into an access token, and a secret can't live inside an app. This tiny worker does
// only that swap: it never sees, stores or logs any LinkedIn data. The app then downloads
// the member's data directly from LinkedIn, on the device.
//
// Routes:
//   GET /start?state=…      sends the member to LinkedIn's consent screen
//   GET /callback?code=…    swaps the code for a token and hands it back to the app
// Secrets (wrangler secret put): LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET

const SCOPE = 'r_dma_portability_3rd_party';
const APP = 'bearings://linkedin';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const redirect = `${url.origin}/callback`;
    if (url.pathname === '/start') {
      const state = (url.searchParams.get('state') || '').slice(0, 100);
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(state)) return new Response('Bad request', {status: 400});
      const to = new URL('https://www.linkedin.com/oauth/v2/authorization');
      to.search = new URLSearchParams({response_type: 'code', client_id: env.LINKEDIN_CLIENT_ID, redirect_uri: redirect, state, scope: SCOPE}).toString();
      return Response.redirect(to.toString(), 302);
    }
    if (url.pathname === '/callback') {
      const state = url.searchParams.get('state') || '';
      const back = params => new Response(null, {status: 302, headers: {Location: `${APP}#${new URLSearchParams({state, ...params})}`, 'Cache-Control': 'no-store'}});
      const err = url.searchParams.get('error');
      if (err) return back({error: url.searchParams.get('error_description') || err});
      const code = url.searchParams.get('code');
      if (!code) return back({error: 'LinkedIn didn’t send a sign-in code.'});
      const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) return back({error: body.error_description || 'LinkedIn didn’t accept the sign-in. Try again.'});
      return back({token: body.access_token, expires: String(body.expires_in || '')});
    }
    return new Response('Bearings', {status: 404});
  },
};
