# Setup: one-time steps

These are the pieces only you can do, because they need your Apple and GitHub logins. Do them once. After that, every push to `main` builds a new TestFlight version and a new Android APK on its own.

App identifiers used everywhere below:

| Item | Value |
|---|---|
| Bundle ID | `com.jaynichols.networkoob` |
| iCloud container | `iCloud.com.jaynichols.networkoob` |
| App name on device | Bearings |

## 1. Apple Developer portal (developer.apple.com)

1. **Team ID:** Account → Membership details. Copy the 10-character Team ID.
2. **iCloud container:** Certificates, IDs & Profiles → Identifiers → **+** → *iCloud Containers* → Description `Network OOB`, Identifier `iCloud.com.jaynichols.networkoob` → Register.
3. **App ID:** Identifiers → **+** → *App IDs* → *App* → Description `Network Order of Battle`, Bundle ID *Explicit* `com.jaynichols.networkoob`. Under Capabilities tick **iCloud** (choose "Include CloudKit support" is fine, either works). Register, then open the App ID again → iCloud → **Edit** → tick `iCloud.com.jaynichols.networkoob` → Save.

## 2. App Store Connect (appstoreconnect.apple.com)

1. **Create the app record:** Apps → **+** → New App. Platform **iOS**, Name `Network Order of Battle` (any unused name works, only you see it in TestFlight), Bundle ID `com.jaynichols.networkoob`, SKU `network-oob`, User Access *Full Access*.
2. **Mac availability:** in the app → Pricing and Availability → make sure **iPhone and iPad Apps on Apple Silicon Macs** is set to *Make this app available*. That is what puts it on your Mac.
3. **API key for the build robot:** Users and Access → **Integrations** → App Store Connect API → Team Keys → **Generate API Key**. Name `GitHub Actions`, Access **Admin** (needed so the build can create its own signing certificate). Download the `.p8` file (you only get one chance) and copy the **Key ID** and the **Issuer ID** shown above the list.

## 3. GitHub repository secrets

Repo → Settings → Secrets and variables → Actions → **New repository secret**, once for each:

| Secret | What to paste |
|---|---|
| `APPLE_TEAM_ID` | Team ID from step 1.1 |
| `ASC_KEY_ID` | Key ID from step 2.3 |
| `ASC_ISSUER_ID` | Issuer ID from step 2.3 |
| `ASC_KEY_P8` | The whole contents of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` lines |
| `ANDROID_KEYSTORE_B64` | Contents of `ANDROID_KEYSTORE_B64.txt` (sent to you separately) |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password (sent to you separately) |

Keep `oob-release.jks` and its password somewhere safe, like your password manager. Every Android update must be signed with that same key, or phones will refuse to install it over the old version.

## 4. Run the first build

Repo → Actions → **iOS + Mac → TestFlight** → Run workflow. It takes about 15 minutes. Apple then processes the build for another 5 to 30 minutes.

## 5. Install

- **iPhone / iPad:** install the TestFlight app. In App Store Connect → your app → TestFlight → Internal Testing → create a group, add yourself, and add the build. Accept the invite in TestFlight.
- **Mac (Apple Silicon):** install TestFlight from the Mac App Store and sign in with the same Apple ID. The app appears there too.
- **Android:** Repo → Actions → latest **Android build** run → download the `order-of-battle-android-…` artifact, unzip, copy `app-release.apk` to the phone, and open it (allow "install unknown apps" for your file manager when asked). The `.aab` file in the same zip is what you would upload to Google Play later if you want store installs.

## How data is stored

- **Apple devices:** two JSON files (`network.json`, `edits.json`) in this app's private iCloud Drive container on your Apple ID. Import on one device and the others pick it up when they open. If iCloud Drive is off, the app saves on the device and the header says so.
- **Android:** the same files, kept in the app's private storage on that phone. Import the weekly export there separately.
