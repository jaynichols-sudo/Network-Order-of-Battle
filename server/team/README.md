# Bearings Team server

A small Cloudflare Worker with a D1 database that lets a team pool encrypted network summaries. The full contract (API, roles, limits, plans, encryption format) is in [docs/team.md](../../docs/team.md).

## Privacy

Every team name, member profile and share is encrypted on the device with a team key (AES-256-GCM) before it's sent. The key travels only inside invite links, after the `#`, so it never reaches this server. The server stores ciphertext it can't open, plus random IDs, roles, seat counts, billing status, and when shares changed and how big they are. Sign-in tokens are stored only as SHA-256 hashes.

Leaving or being removed deletes that member's share and revokes their token. Deleting a team deletes every row about it.

## One-time setup

1. Add the GitHub secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template plus D1 edit permission) and `CLOUDFLARE_ACCOUNT_ID`.
2. Run Actions > **Team server** > Run workflow. It runs the tests, applies `schema.sql` to the `bearings-team` D1 database, and deploys. The log and the run summary show the address.
3. Add a repository variable `TEAM_URL` set to that address.
4. Optional, for billing: add the GitHub secrets `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (the per-seat yearly price) and `STRIPE_WEBHOOK_SECRET`, then run the workflow again. In Stripe, point a webhook at `<TEAM_URL>/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`. Until billing is set up, the billing endpoints return 501 and teams stay on the trial.

You can also set `APP_STORE_URL` as a worker variable. The invite page links to it for people who don't have Bearings yet (otherwise it links to the Bearings site).

## Raising seats by hand

Without Stripe, a team keeps its trial seats (5). To give a team more seats, or to turn a trial into a paid team:

```sh
cd server/team
npx wrangler d1 execute bearings-team --remote --command "UPDATE teams SET seats = 25, plan = 'active' WHERE id = '<team id>'"
```

Find the team id in the app, or list teams with `SELECT id, plan, seats, created FROM teams`.

## Routes

| Route | What it does |
|---|---|
| `GET /health` | `{"ok": true}` |
| `/v1/...` | The team API. See the table in [docs/team.md](../../docs/team.md) |
| `GET /join/:code` | The invite page that hands off to the app |
| `GET /billing/done` | Where Stripe Checkout and the customer portal return |
| `POST /stripe/webhook` | Stripe updates (signature checked) |

## Tests

```sh
cd server/team
npm install
npm test
```

The tests run the worker in Miniflare with a local D1 database and a fake Stripe.
