# Connect LinkedIn (EEA and Switzerland)

LinkedIn offers a free, official way to share your data with an app, but only to members in the EEA and Switzerland (the EU's Digital Markets Act). This folder is the small helper that makes that work. Bearings uses it to offer a one-tap "Connect LinkedIn" there, instead of the manual export.

The helper only swaps LinkedIn's sign-in code for an access token, because that step needs a secret that can't ship inside the app. The app then downloads the member's connections, messages and invitations directly from LinkedIn. Nothing passes through or is kept by the helper.

## Set up (one time)

1. **LinkedIn developer app.**
   - At https://www.linkedin.com/developers/apps, create an app.
   - For the company page, pick the **Member Data Portability (3rd Party) Default Company** page. Don't create a new one.
   - On the **Products** tab, request **Member Data Portability API (3rd Party)** and accept the terms.
   - On **Auth**, add the redirect URL `https://bearings-linkedin-connect.<your-subdomain>.workers.dev/callback`. You get the exact address after step 3.
2. **GitHub repository secrets.** Add these under Settings > Secrets and variables > Actions:
   - `CLOUDFLARE_API_TOKEN`: a Cloudflare API token from the "Edit Cloudflare Workers" template.
   - `CLOUDFLARE_ACCOUNT_ID`
   - `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`, from the LinkedIn app's Auth tab.
3. **Deploy.** Run Actions > **LinkedIn connect helper** > Run workflow. The run shows the worker's address.
4. **Point the apps at it.** Add a repository variable (not a secret) named `LINKEDIN_CONNECT_URL` set to that address, for example `https://bearings-linkedin-connect.jay.workers.dev`. The next iPhone, Mac and Android builds pick it up.

Until `LINKEDIN_CONNECT_URL` is set, the button stays hidden. Members outside the EEA and Switzerland never see it, since LinkedIn only allows those members to consent.
