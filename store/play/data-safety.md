# Data safety form (Play Console > Policy > App content > Data safety)

Based on the Android code as of October 2026. Bearings has no server and no analytics, ads or crash-reporting SDKs.

## Overview questions

- **Does your app collect or share any of the required user data types?** No.
  - Google counts data as "collected" only when it leaves the device and reaches you or a third party. Bearings reads the LinkedIn file, contacts and location on the phone only, and never sends them anywhere.
- **Is all of the user data collected by your app encrypted in transit?** Not applicable, since nothing is collected. If the form insists, answer Yes: the only network requests are HTTPS map tiles.
- **Do you provide a way for users to request that their data is deleted?** Yes. Everything lives on the phone and is deleted by uninstalling the app or by Android Settings > Apps > Bearings > Storage > Clear storage.

## Network requests the app does make (for your reference)

| Request | What is sent | Why it isn't "collection" |
|---|---|---|
| Map tiles from tile.openstreetmap.org | The map area being viewed (no personal data) | Standard tile fetch; no user data |
| Opening linkedin.com links | Nothing sent by Bearings; the link opens in the browser or LinkedIn app | User-initiated navigation |

## Permissions to explain if asked

- **Contacts (READ_CONTACTS):** optional. Used to start a network from contacts, add birthdays, and place people on the map. Read on the phone only.
- **Location (coarse and fine):** optional. Used for "near me" on the map. Read on the phone only.
- **Notifications:** follow-up reminders and the Monday brief.

## Other App content answers

- **Ads:** No ads.
- **Target audience:** 18 and over. Not designed for children.
- **News app:** No.
- **Government app:** No.
- **Financial features:** None.
- **Health:** None.
- **Account deletion:** The app has no accounts.
