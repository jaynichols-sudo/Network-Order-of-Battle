# Bearings pricing

## Proposal

**Free**, which is most of the app:
- Today and the Monday five
- the compass, Explore, the map and clusters
- People, plain-English search, Companies and the watchlist
- Catch Up, reminders, circles and notes
- widgets, the Watch app and Siri

**Bearings Pro**, the tools for working a network:
- Event mode
- Ways in (warm intro paths)
- Team packs
- Arrival alerts
- The account map PDF
- Salesforce

| Product ID | Type | Proposed price |
|---|---|---|
| `com.jaynichols.networkoob.pro.yearly` | Auto-renewing subscription | $29.99 a year, with a 2-week free trial |
| `com.jaynichols.networkoob.pro.monthly` | Auto-renewing subscription | $3.99 a month |
| `com.jaynichols.networkoob.pro` | Non-consumable (lifetime) | $79.99 |

The subscriptions share one subscription group: "Bearings Pro".

## Why this shape

- **The free app has to win the Today habit on its own.** People pay for the work tools once they rely on the app.
- **The prices fit similar apps.** Personal CRMs (Clay, Dex, Covve) charge about $10 to $20 a month for teams, and $3 to $5 a month for individuals.
- **The lifetime option suits privacy-minded buyers,** who often dislike subscriptions. Bearings has no server costs, so a one-time price is sustainable.

## To turn it on

1. **Confirm or change the prices.**
2. **Create the products in App Store Connect,** under Monetization > Subscriptions and In-App Purchases, using the IDs above. Each needs a display name, a description and a review screenshot (use the paywall screenshot from CI, `phone-28-paywall`). Claude can do this through the App Store Connect API once you confirm.
3. **Set the gating switch in `apple/Bearings/Pro.swift` to on,** and ship a build.

The paywall's Terms link uses Apple's standard license agreement, and Privacy links to jaynichols.net/bearings/privacy.html. Both are required for subscriptions.
