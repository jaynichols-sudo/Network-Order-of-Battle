# App Review notes

Pushed to App Store Connect by the store-listing workflow (store/listing.json, "review").
The contact phone number comes from the REVIEW_PHONE repository secret.

Thank you for reviewing Bearings.

NO ACCOUNT OR LOGIN. Bearings has no account and no server. On first launch it opens a built-in sample network (680 fictional people) so every screen can be reviewed without any personal data. On the welcome screens, choose “Just look around a sample network.”

HOW REAL USERS GET DATA. LinkedIn lets members download their own data (Settings > Data privacy > Get a copy of your data). The user shares that ZIP or Connections.csv to Bearings, or picks it in Import. Everything is parsed on the device. Nothing is uploaded. There is no scraping and no use of LinkedIn's API.

PERMISSIONS, ALL OPTIONAL AND ASKED IN CONTEXT:
- Contacts: to start a network from Contacts before the LinkedIn file arrives, to add birthdays, and to place people on the map. Read on device only.
- Calendar: to brief the user before meetings with people they know and to spot trips. Read on device only.
- Location (when in use): Near Me on the map.
- Camera: scanning a business card at an event (text is read on device with Vision).
- Notifications: follow-up reminders and the Monday brief.

SYNC. Data syncs only through the user's own iCloud (CloudKit/iCloud Documents). Optional Salesforce integration signs in directly with the user's Salesforce org via OAuth and is off by default.

ENRICHMENT (OPTIONAL). Users who already have a ZoomInfo or Seamless.AI account can add their own API credentials in Settings. Only when they tap Look up, the selected people's names and companies are sent from the device to that provider to fetch work email, phone, title and city. Credentials stay in the device Keychain. Off by default; no Bearings server is involved.

AI. Briefs and draft messages use Apple's on-device Foundation Models when available, with a plain template fallback. No third-party AI service.

Privacy policy: https://www.jaynichols.net/bearings/privacy.html
