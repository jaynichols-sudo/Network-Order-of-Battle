# App Store Connect: App Privacy answers

App Store Connect > Bearings > App Privacy > Get Started. These answers match the app as of build 67.

## Recommended answer: "No, we do not collect data from this app"

Apple counts data as **collected** only when it is sent off the device in a way that lets the developer or the developer's third-party partners access it beyond real-time servicing of the request. Bearings has no server, no analytics, no ads and no SDKs that collect data:

| What leaves the device | Where it goes | Why it isn't "collected" by the developer |
|---|---|---|
| Your network, notes and settings | Your own iCloud (private app folder) | Apple service on your account; the developer can't access it |
| People you choose to look up (name, company, title, LinkedIn link) | Your own ZoomInfo or Seamless.AI account | Optional, user-initiated each time, disclosed on screen, and sent to a provider you have your own contract with. Apple lets this go undisclosed when it is optional, infrequent, not used for tracking or ads, and clearly disclosed at the time. The developer never receives it. |
| People, tasks and notes you send | Your organization's Salesforce | Same: optional, user-initiated, your org's own account |
| Sign-in codes (LinkedIn EEA, Seamless.AI) | The Bearings sign-in helper (Cloudflare worker) | It swaps a one-time code for a token and returns it to the app. It keeps and logs nothing, and no personal data passes through it. |
| A team pack file | Whoever you send it to | You share the file yourself, like a document |
| Feedback email with diagnostics | Jay, only if you choose to send it | User-initiated email; optional disclosure |
| Purchases | Apple | Handled by Apple |

## Conservative alternative, if Apple pushes back

Declare only this. Everything else stays "not collected".

- **Contact Info > Other User Contact Info.** Purposes: **App Functionality**. **Not linked** to the user's identity. **Not used for tracking.**
  - Covers the ZoomInfo and Seamless.AI lookups, where names and companies go to the user's chosen provider.

## Other questions in App Store Connect

- **Tracking:** No. There's no IDFA, no ad SDKs, and no data broker sharing.
- **Privacy policy URL:** https://www.jaynichols.net/bearings/privacy.html, already in the listing.
- **Privacy choices URL (optional):** leave it blank, or use the same privacy policy URL.
