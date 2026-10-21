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
- CRM sync (Salesforce, HubSpot, Dynamics 365)

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

Two ways to pay, same price per seat:

| Product | Where | Price |
|---|---|---|
| `com.jaynichols.networkoob.team5`, "Northfix Team, up to 5 seats" | App Store, auto-renewing subscription, group "Northfix Team" | $2,939.99 a year (5 × $588, at the nearest App Store price point) |
| Northfix Team, per seat | Web (Stripe) | $588 per seat a year, any number of seats, invoices available |

- **The App Store starter tier lets a small team start right on iPhone or Mac.** The owner buys one subscription for up to 5 seats and the team server turns the plan on from the signed transaction (see [team.md](team.md)). Apple's commission applies to this one: under the Small Business Program (15%) a starter team nets about $2,499 a year.
- **Bigger teams, and teams that need an invoice, subscribe on the web.** Stripe, which Apple allows for services sold to organizations (guideline 3.1.3(c)). Apple's 15% doesn't apply. In the app this is offered as "for teams of 6 or more, or if you need an invoice", next to the App Store option, not as a cheaper way to buy the same thing.
- **Separate from Pro,** so lifetime Pro stays lifetime: a lifetime buyer who joins a team pays for the seat, not for Pro. The team subscription is its own subscription group, so it never competes with Pro's.
- **Why $49:** BD and capture teams already pay several hundred to a few thousand dollars a seat for market intelligence. Northfix answers a question those tools can't: who on *my* team knows someone there.
- **To turn on web billing:** in Stripe, create a product "Northfix Team" with a yearly per-seat price, then add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` as GitHub secrets and run the Team server workflow. See [team.md](team.md).

### App Store Connect setup for the starter tier

1. **Monetization > Subscriptions > Create a subscription group** named **Northfix Team** (a separate group from "Northfix Pro"). The group's App Store display name: "Northfix Team".
2. **Add a subscription** in that group. Reference name "Northfix Team, up to 5 seats". Product ID `com.jaynichols.networkoob.team5`. Duration: 1 year.
3. **Price:** pick the yearly price point closest to **$2,939.99** in the United States. Price points above $999.99 aren't in the standard list: App Store Connect offers them on request (the enhanced range goes to $10,000), so ask for the higher range first if the picker stops at $999.99. If $2,939.99 isn't offered exactly, take the nearest point and update the fallback price in `Pro.proposed` in `apple/Northfix/Pro.swift`. Let Apple set the other storefronts from the US price.
4. **Localization (English, U.S.):** display name "Northfix Team, up to 5 seats". Description: "One yearly subscription for a team of up to 5. Pool who your team knows, privately. Everyone on the team gets Northfix Pro." No free trial on this product: the team itself gives 30 days free.
5. **Review information:** a screenshot of the Team screen with the plan options showing (the owner's view once the trial is ending), and a note for review: "The team owner buys this for a team of up to 5 people. Larger teams and teams that need an invoice are offered a per-seat web subscription for organizations (guideline 3.1.3(c))."
6. **Availability:** every country, and the Mac App Store too (it's the same app, built with Mac Catalyst).
7. **Small Business Program:** the account is enrolled (15% commission), which applies to this subscription as to Pro. Keep an eye on the $1M threshold: team subscriptions move the total faster than Pro does.
8. **Testing:** add a sandbox tester in Users and Access, sign in with it on a device under Settings > App Store > Sandbox Account, and set the worker variable `APPLE_ALLOW_SANDBOX` to `true` on the team server while testing. In the sandbox, a yearly subscription renews every hour, up to 6 times, which is a handy way to see the renewal date move on the Team screen.

There's no local `.storekit` configuration file in the project yet. If one is added for the simulator, put `com.jaynichols.networkoob.team5` in it as a yearly auto-renewable subscription in a group named "Northfix Team".

## To turn it on

1. **Prices are set** (above).
2. **Create the products in App Store Connect,** under Monetization > Subscriptions and In-App Purchases, using the IDs above. Each needs a display name, a description and a review screenshot (use the paywall screenshot from CI, `phone-28-paywall`). Claude can do this through the App Store Connect API once you confirm.
3. **Set the gating switch in `apple/Northfix/Pro.swift` to on,** and ship a build.

The paywall's Terms link uses Apple's standard license agreement, and Privacy links to northfix.app/privacy.html. Both are required for subscriptions.
