# Network Order of Battle

A private app for mapping your LinkedIn connections. Import LinkedIn's Connections export once a week and the app tags everyone by segment, agency or command, military branch, service status, rank and grade, seniority, function, and certifications, then shows them on a range-ring map, a branch-by-rank matrix, org rankings, and a searchable directory.

Runs on iPhone, iPad, Apple Silicon Macs (synced through your iCloud) and Android.

## Layout

| Path | What it is |
|---|---|
| `src/` | The app itself: `index.html`, `styles.css`, `app.js` (classifier, filters, map, import/merge, storage) |
| `scripts/build.mjs` | Bundles `src/` and the fonts into `www/` |
| `ios/` | Xcode project. The iCloud storage plugin lives in `ios/App/App/SceneDelegate.swift` |
| `android/` | Android Studio project |
| `.github/workflows/` | Cloud builds: TestFlight upload and signed Android APK |
| `SETUP.md` | One-time Apple and GitHub setup |

## Working on it

```sh
npm ci
npm run build          # builds www/
open www/index.html    # runs in a browser, saving to browser storage
npm run sync           # build + copy into the iOS and Android projects
```

Push to `main` and GitHub Actions builds both platforms.

## Classifier notes

Branch, rank and segment are inferred from the name, title and company fields in the export. Rules are tables near the top of `src/app.js` (`BRANCH_RX`, `RANKS`, `AG`, `SEG_RX`, `FUNC_RX`). Ambiguous abbreviations such as CSM, CPO and Captain only count as ranks when a military branch is also detected. Per-person corrections made in the app always win over the rules.
