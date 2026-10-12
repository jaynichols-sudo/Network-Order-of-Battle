# Northfix pricing

## Proposal

**Free**, which is most of the app:
- Today and the Monday five
- the compass, Explore, the map and clusters
- People, plain-English search, Companies and the watchlist
- Catch Up, reminders, circles and notes
- widgets, the Watch app and Siri

**Northfix Pro**, the tools for working a network:
- Event mode
- Ways in (warm intro paths)
- Team packs
- Arrival alerts
- The account map PDF
- Salesforce

| Product ID | Type | Price |
|---|---|---|
| `com.jaynichols.networkoob.pro.yearly` | Auto-renewing subscription | $99.99 a year, with a 2-week free trial |
| `com.jaynichols.networkoob.pro.monthly` | Auto-renewing subscription | $19.99 a month |
| `com.jaynichols.networkoob.pro` | Non-consumable (lifetime) | $249.99 |

The subscriptions share one subscription group: "Northfix Pro".

## Why this shape

Decided October 11, 2026.

- **The free app has to win the Today habit on its own.** People pay for the work tools once they rely on the app.
- **Priced for professionals, not hobbyists.** The buyer is a BD, capture or sales professional who often expenses tools. $19.99 a month is still well under LinkedIn's paid plans.
- **Monthly is the anchor; yearly is the plan to sell.** Yearly is 58% off twelve months of monthly ($239.88), so it reads as the clear deal without making monthly look inflated.
- **Lifetime is permanent.** It stays on sale, and a lifetime purchase is Pro for good: no expiry and no later move to a subscription. At about 2.5 years of yearly, it doesn't undercut the yearly plan.
- **What it nets.** Under Apple's Small Business Program (15%), yearly nets about $85 per subscriber.

## Northfix Team

Decided: **$49 per person per month, billed yearly ($588 per seat a year)**, with a 30-day free trial for up to 5 people. Everyone on a team gets Northfix Pro while they're on it.

- **Sold on the web, not in the App Store.** Teams subscribe through Stripe, which Apple allows for services sold to organizations (guideline 3.1.3(c)). Apple's 15% doesn't apply.
- **Separate from Pro,** so lifetime Pro stays lifetime: a lifetime buyer who joins a team pays for the seat, not for Pro.
- **Why $49:** BD and capture teams already pay several hundred to a few thousand dollars a seat for market intelligence. Northfix answers a question those tools can't: who on *my* team knows someone there.
- **To turn it on:** in Stripe, create a product "Northfix Team" with a yearly per-seat price, then add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` as GitHub secrets and run the Team server workflow. See [team.md](team.md).

## To turn it on

1. **Prices are set** (above).
2. **Create the products in App Store Connect,** under Monetization > Subscriptions and In-App Purchases, using the IDs above. Each needs a display name, a description and a review screenshot (use the paywall screenshot from CI, `phone-28-paywall`). Claude can do this through the App Store Connect API once you confirm.
3. **Set the gating switch in `apple/Bearings/Pro.swift` to on,** and ship a build.

The paywall's Terms link uses Apple's standard license agreement, and Privacy links to northfix.app/privacy.html. Both are required for subscriptions.
