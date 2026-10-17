# Data safety form (Play Console > Policy > App content > Data safety)

Matches the Android code at build 91 (main at 51131e4, Oct 14, 2026). Northfix has no analytics, ads or crash-reporting SDKs. Re-check this whenever the app starts talking to a new server.

## How Google counts it

Google counts data as **collected** when the app sends it off the phone, wherever it goes. It counts data as **shared** when it goes to a third party, except when the user starts the transfer and expects it (like looking someone up in their own ZoomInfo account).

That's stricter than Apple's test, so the Play answer declares a little more than the App Store one.

## Recommended answers

**Does your app collect or share any of the required user data types?** Yes.

**Is all of the user data collected by your app encrypted in transit?** Yes. Every request is HTTPS, and Team data is also end-to-end encrypted.

**Do you provide a way for users to request that their data is deleted?** Yes. In the app: leave or delete a team. Everything else lives on the phone and goes with an uninstall. Web link for the deletion question: https://northfix.app/support.html#delete

Declare these three data types. For each: **Collected: Yes. Shared: No. Processed ephemerally: No. Required or optional: Optional (users can choose). Purpose: App functionality only.**

| Play category > type | What triggers it | Where it goes |
|---|---|---|
| **Personal info > User IDs** | Starting or joining a team | The team server keeps a random member ID and a hashed sign-in token. No name, email or device ID. |
| **Personal info > Name** | Joining a team; looking someone up | Your own name and title go to the team server, encrypted. Names of people you look up go to your own ZoomInfo or Seamless.AI account. |
| **Contacts** | Sharing with a team; looking someone up | The people in your network that your team share includes (name, title, company, LinkedIn link, closeness), encrypted with a key the server never has. Lookups send a name, company and title to your own provider. |

Why declare the encrypted Team data at all: the developer can't read it, but it does leave the phone, and Google's form is about what leaves. Declaring it costs nothing and removes any argument later.

Why "Shared: No": the team server is run by the developer, so it's collection, not sharing. Lookups go to a provider only when the user taps to look someone up in their own account, which is Google's user-initiated exception.

Leave everything else unticked: location, financial info, messages, photos, audio, files, calendar, app activity, web browsing, app info and performance, and device IDs.

## Network requests the app makes (for your reference)

| Request | What is sent | Personal data? |
|---|---|---|
| Team server (team.northfix.app) | Encrypted share, encrypted name and title, random IDs | Yes, declared above |
| ZoomInfo or Seamless.AI (your account) | Name, company, title, LinkedIn link of the person you look up | Yes, declared above |
| Sign-in helper (Cloudflare worker) | One-time sign-in codes for LinkedIn (EEA) and Seamless.AI. Stores and logs nothing | No |
| LinkedIn Member Data Portability API (EEA and Switzerland) | Your access token; your LinkedIn data comes back to the phone | No (incoming) |
| SAM.gov | Your SAM.gov API key and a date range | No |
| USASpending.gov | Agency names and dates | No |
| Google News | Company and agency names on your watchlist | No |
| Your trip feed (TripIt or other calendar link) | The feed address you pasted | No |
| Map tiles from tile.openstreetmap.org | The map area on screen | No |
| Google Play Billing | Handled by Google | No |

## Permissions to explain if asked

- **Contacts (READ_CONTACTS):** optional. Start a network from contacts, add birthdays, and place people on the map. Read on the phone only.
- **Location (coarse and fine):** optional. "Near me" on the map and the arrival check, which runs only while the app is open. No background location. Read on the phone only.
- **Internet:** the requests in the table above.
- **Notifications:** follow-up reminders and the Monday brief.

## Other App content answers

- **Ads:** No ads.
- **Target audience:** 18 and over. Not designed for children.
- **News app:** No. Watchlist headlines are a small feature, not the app's purpose.
- **Government app:** No.
- **Financial features:** None.
- **Health:** None.
- **Account deletion:** Teams are the only thing close to an account. Members leave, and owners delete a team, in the app. The web link above covers people who no longer have the app.
- **Purchases:** Google Play Billing. The app never sees payment details.
