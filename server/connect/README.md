# Sign-in helper: Connect LinkedIn and Sign in with Seamless.AI

A small Cloudflare worker that lets Bearings offer two sign-ins without a Bearings server:

- **Connect LinkedIn:** a one-tap import for members in the EEA and Switzerland, through LinkedIn's official Member Data Portability API.
- **Sign in with Seamless.AI:** used for enrichment. People sign in on Seamless' own page; Bearings never sees their password.

Both providers need a client secret to turn a sign-in into a token, and a secret can't ship inside an app. This helper only does that swap, plus Seamless' token refresh. It never stores or logs anything. The apps then talk to LinkedIn and Seamless directly, from the device.

## One-time setup

1. **Cloudflare.** Create an API token from the "Edit Cloudflare Workers" template. Add it as the GitHub secret `CLOUDFLARE_API_TOKEN`, and your account ID as `CLOUDFLARE_ACCOUNT_ID`.
2. **Deploy.** Run Actions > **Sign-in helper (LinkedIn, Seamless)** > Run workflow. Its log shows the worker's address, for example `https://bearings-connect.<you>.workers.dev`.
3. **Point the apps at it.** Add a repository *variable* (not a secret) named `CONNECT_URL` set to that address. The next iPhone, Mac and Android builds pick it up. Until it's set, both buttons stay hidden.

### Seamless.AI

1. In Seamless, open Settings > Public API > **OAuth Connections** > Create New Connection.
2. Redirect URI: `https://bearings-connect.<you>.workers.dev/seamless/callback`.
3. Add the client ID and secret as GitHub secrets `SEAMLESS_CLIENT_ID` and `SEAMLESS_CLIENT_SECRET`, then run the deploy again.
4. Check whether people outside your company can sign in. Seamless' docs don't say whether a connection made in your account works for other organizations.

### LinkedIn (EEA and Switzerland)

1. At https://www.linkedin.com/developers/apps, create an app.
   - For the company page, use the **Member Data Portability (3rd Party) Default Company** page. Don't create a new one.
   - On the Products tab, request **Member Data Portability API (3rd Party)**.
2. On the Auth tab, add the redirect URL `https://bearings-connect.<you>.workers.dev/linkedin/callback`.
3. Add the client ID and secret as GitHub secrets `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, then run the deploy again.

## Routes

| Route | What it does |
|---|---|
| `GET /linkedin/start`, `/linkedin/callback` | LinkedIn consent, then `bearings://linkedin#token=…` |
| `GET /seamless/start`, `/seamless/callback` | Seamless sign-in, then `bearings://seamless#token=…&refresh=…` |
| `POST /seamless/refresh` | `{refresh_token}` → new tokens. Access lasts 3 hours, refresh 7 days. |
