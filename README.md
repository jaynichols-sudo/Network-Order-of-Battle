# Bearings

**Know where everyone in your network landed.**

Bearings turns your LinkedIn export into a private map of your network. It shows:

- who changed jobs
- who's waiting on your reply
- who's near where you're traveling
- who you know, and who you used to know, at the companies you're working

Everything stays on your devices and in your own iCloud. There is no Bearings account and no Bearings server.

## Apps

| Platform | Built from | Notes |
|---|---|---|
| iPhone, iPad | `apple/` (SwiftUI) | Native app, widgets, Siri and Shortcuts, Spotlight |
| Mac | `apple/` | Runs the iPad app on Apple silicon Macs |
| Apple Watch | `apple/BearingsWatch` | Waiting on you, follow-ups, complications |
| Android, web | `src/` (Capacitor) | The original web-based app |

The classification, scoring, search and import logic is shared. `src/core.js`, `src/industry.js` and `src/nlq.js` hold it, and `src/engine.js` exposes it to the native apps. It runs unchanged in JavaScriptCore.

## Layout

| Path | What it is |
|---|---|
| `src/engine.js` | Headless engine for the native apps (JSON in, JSON out) |
| `src/core.js`, `industry.js`, `nlq.js`, `companies.js` | Classifier, industries, plain-English search, known companies |
| `src/android/*` | The Android app (and browser build): screens on top of the shared engine in `src/engine.js` |
| `apple/project.yml` | XcodeGen spec for the iPhone, iPad, Mac, Watch and widget targets |
| `apple/Bearings/` | SwiftUI app. Includes the engine bridge, iCloud storage, map, calendar, Salesforce, Siri |
| `apple/BearingsWatch/`, `apple/BearingsWidgets/`, `apple/BearingsHomeWidgets/` | Watch app, watch complications, home-screen widgets |
| `apple/Shared/` | Code shared by the app, watch and widgets |
| `scripts/build.mjs` | Builds the web app into `www/` and the engine into `apple/Bearings/Resources/engine.js` |
| `scripts/build-geo.mjs` | Builds the offline place data (phone prefixes and cities) |
| `brand/` | Logo, wordmark and icon sources |
| `.github/workflows/` | TestFlight upload, compile check with screenshots, signed Android build |
| `SETUP.md` | One-time Apple and GitHub setup |

## Working on it

```sh
npm ci
npm run build                        # web app + native engine
cd apple && xcodegen generate        # Xcode project (on a Mac)
```

Push to `main` and GitHub Actions does the rest:

- archives and uploads the Apple apps to TestFlight
- compiles and screenshots the native app in the simulator (screenshots land on the `ci-screens` branch)
- builds a signed Android APK

## Data and privacy

- **Where data lives:** network data stays in the user's iCloud Drive app folder, or on the device.
- **On-device only:** Contacts matching, calendar reading and crash reports never leave the device unless the user sends feedback.
- **Salesforce:** sign-in goes directly to Salesforce with OAuth and PKCE, and tokens are kept in the keychain.
- **Place data:** GeoNames (CC BY 4.0) and Google libphonenumber (Apache 2.0).
- **Font:** Geist (SIL Open Font License).

Some internal identifiers still use the app's original name, `networkoob`: the bundle IDs and the iCloud container ID. They can't change without losing the App Store record and users' data. People never see them.
