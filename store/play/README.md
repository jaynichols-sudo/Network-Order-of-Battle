# Getting Bearings onto Google Play

Everything that can be prepared ahead of time is in this folder. These are the steps only Jay can do, in order.

## 1. Developer account (one time)

1. Sign up at play.google.com/console with a Google account ($25 one-time fee, ID verification).
2. Choose **Personal** or **Organization**.
   - A **new personal account** must run a **closed test with at least 12 testers, opted in for 14 days in a row**, before it can publish to everyone.
   - An **organization** account (needs a D-U-N-S number) skips that rule, so the LLC and D-U-N-S matter here too.

## 2. Create the app

1. Create app: name **Bearings: Your Network Map**, app, free, accept the declarations.
2. Package name is set by the first upload: `com.jaynichols.networkoob`.
3. Fill in **Main store listing** from `listing.md`, with the graphics listed there.
4. Fill in **App content**:
   - Data safety, target audience and ads: answers are in `data-safety.md`.
   - Content rating: the questionnaire answers are all "No", since there's no violence, user-generated content, gambling or the like. That gives an Everyone / 3+ rating.
   - Privacy policy: https://www.jaynichols.net/bearings/privacy.html

## 3. First upload (by hand)

Google requires the very first app bundle to be uploaded in the Console.

1. In GitHub, open Actions > **Bearings Android build** > latest run, download the `bearings-android-…` artifact and unzip it.
2. In Play Console, open Testing > **Closed testing** > Create track (call it "Testers").
3. Create a release, upload `app-release.aab`, and let **Play App Signing** manage the key (the default).
4. Under **Testers**, create an email list with at least 12 people (Google accounts) and save. Copy the opt-in link and send it to them. They must tap it and install from Play.
5. Roll out. The 14-day clock starts when 12 testers have opted in.

## 4. After that: uploads from GitHub

1. In Google Cloud, create a service account, and in Play Console > Users and permissions, invite it with "Release to testing tracks" permission.
2. Add the service account's JSON key as a GitHub repository secret named **`PLAY_SERVICE_ACCOUNT_JSON`**.
3. To ship a new build, run Actions > **Bearings Android build** > Run workflow, and pick `internal` or `alpha` (alpha is Play's name for the first closed track) under "Also upload to Google Play".

## 5. Going public

After 14 days with 12 or more opted-in testers, Play Console unlocks **Apply for production**. Answer the short questionnaire about the test, then promote the release to production.
