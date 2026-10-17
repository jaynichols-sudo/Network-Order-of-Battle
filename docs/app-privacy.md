# App Store Connect: App Privacy answers

App Store Connect > Northfix > App Privacy > Get Started. These answers match the code at build 105 (main at 51131e4, Oct 14, 2026). Re-check them whenever a feature starts talking to a new server.

## The test Apple applies

Apple counts data as **collected** when it leaves the device in a way that lets the developer, or the developer's third-party partners, get at it for longer than it takes to answer the request in real time.

So three questions decide each row below: does it leave the device, does it reach the developer (or a partner the developer chose), and can the developer read it?

## Recommended answer: "Yes, we collect data", with two types

Until Team, the honest answer was "Data Not Collected". Team changed that. The team server (team.northfix.app) is run by the developer, and it keeps two things it can read: a random member ID for each person on a team, and, for teams bought in the app, the App Store transaction. Everything else on it is ciphertext the developer has no key for.

Declare these two, and nothing else:

| Data type | Purposes | Linked to the user? | Tracking? | What it is |
|---|---|---|---|---|
| **Identifiers > User ID** | App Functionality | No | No | The random member ID and sign-in token (stored only as a hash) the team server gives each person on a team. It carries no name, email or device ID. |
| **Purchases > Purchase History** | App Functionality | No | No | For "Northfix Team, up to 5 seats", the owner's app sends the signed App Store transaction to the team server, which keeps its original transaction ID and expiry date to know the team is paid. |

Why "not linked": the team server never holds a name, email address, phone number or device identifier in readable form. Member names and titles are encrypted on the device with the team key, which never reaches the server.

If you'd rather keep it simpler and Apple accepts it, the fallback is "Data Not Collected" with a note in App Review Notes that Team stores only ciphertext and random IDs. It is defensible but weaker, so I'd declare the two rows.

## Everything else: not collected

| What leaves the device | Where it goes | Why it isn't "collected" |
|---|---|---|
| Your network, notes, pursuits and settings | Your own iCloud Drive (private app folder) | Your Apple account. The developer can't reach it. |
| Team shares, team name, member names and titles | Team server, encrypted (AES-256-GCM) | The key lives only on members' devices and after the `#` in invite links, which never reach a server. The developer can store the ciphertext but can't read it. |
| People you look up (name, company, title, LinkedIn link) | Your own ZoomInfo or Seamless.AI account | Optional, user-initiated each time, shown on screen, sent straight from the device to a provider you have your own contract with. Never reaches the developer. |
| People, follow-ups and notes you choose to send | Your organization's Salesforce, HubSpot or Dynamics 365 | Same: optional, user-initiated, your organization's own account. Tokens stay in the keychain. |
| Sign-in to Outlook or Gmail, then email headers (sender, recipients, date, subject) | Read from Microsoft or Google onto the device | Data comes in, not out. Matched on the device; only the date, direction and subject of the latest email per person is kept, in your iCloud. |
| Your SAM.gov API key and date range | SAM.gov | Public government notices come back. No personal data goes out. |
| Agency names and dates | USASpending.gov (Recompetes, Teaming partners) | Public award data comes back. No one from your network is sent. |
| Company and agency names on your watchlist | Google News | Only the names you watch, no information about you or your people. |
| Your TripIt or other calendar feed address | That feed's host | Your own feed, fetched to read your trips. |
| One-time sign-in codes (Connect LinkedIn in the EEA, Sign in with Seamless.AI) | The Northfix sign-in helper (Cloudflare worker) | Swaps a code for a token in real time and returns it. Stores and logs nothing. |
| LinkedIn data (EEA and Switzerland) | From LinkedIn's Member Data Portability API to the device | Data comes in, not out. |
| Questions you ask Claude through the AI connector | Answered on your Mac; your AI app sends its chat to its own maker | The connector makes no network calls except USASpending.gov agency queries. What Claude Desktop sends to Anthropic is under the user's own Anthropic account. |
| A team pack file | Whoever you send it to | You share the file yourself, like any document. |
| Feedback email, with crash reports if you leave them on | Jay's inbox, only if you send it | User-initiated email. Apple lets optional feedback a user sends themselves go undisclosed. |
| Pro purchases | Apple | Apple handles them. The app checks entitlements on the device. |
| Team billing on the web | Stripe, in the browser | Happens on Stripe's checkout page, outside the app. The team server gets only the Stripe customer and subscription IDs and payment status. |

## Other questions in App Store Connect

- **Tracking:** No. No IDFA, no ad SDKs, no analytics SDKs, no data broker sharing.
- **Privacy policy URL:** https://northfix.app/privacy.html
- **Privacy choices URL (optional):** leave blank, or use the privacy policy URL.

## Keep these in step

The privacy policy at northfix.app/privacy.html should say the same things. If App Review compares them, a mismatch is the most likely reason for a rejection.
