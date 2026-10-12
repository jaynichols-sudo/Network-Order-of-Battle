# Northfix Team

Northfix Team lets a business development or capture team pool who they know, without giving up what makes Northfix different: **the Northfix server can't read anyone's network.**

Each teammate shares a summary of their network, their pursuits and their watchlist. Everyone on the team then sees:

- **Ways in through the whole team.** "Who on my team knows someone at DISA, and how well?"
- **The team federal map.** Where the team, not just you, is covered, thin or not connected.
- **Team pursuits.** Every pursuit on the team, with which decision-maker seats are filled.
- **The team watchlist.** Everyone's target accounts, and who covers each one.

Members never see each other's notes, messages, emails, tags or contact details. A share holds only names, employers, titles, LinkedIn links and how close the relationship is.

## How the privacy works

- **End-to-end encrypted.** When someone starts a team, their device makes a random 256-bit team key. Every share, profile and the team name are encrypted with it (AES-256-GCM) before they leave the device.
- **The key never reaches the server.** It travels inside the invite link, after the `#`. Browsers and apps never send that part of a link to a server.
- **What the server knows:** random team and member IDs, roles, seat counts, billing status, when shares changed and how big they are. It stores everything else as ciphertext it can't open.
- **Leaving deletes your data.** Leaving a team, or being removed, deletes that member's share from the server. Deleting a team deletes everything about it.
- **Removed members lose access immediately.** Their sign-in token is revoked, so they can't download anything new.

## Plans

| Plan | What you get |
|---|---|
| Trial | 30 days, up to 5 people, everything included |
| Team | Per seat, billed yearly. Every member also gets Northfix Pro while they're on the team |

The price ($49 per person per month, billed yearly) is in [pricing.md](pricing.md). Teams pay on the web (Stripe), which Apple allows for services sold to organizations (App Store Review Guideline 3.1.3(c)). When the trial ends without a subscription, the team becomes read-only: people can still see what's there, but can't upload new shares or invite more people.

## Encryption format

Everything encrypted travels as base64 (standard alphabet, with padding) of:

```
0x01 | 12-byte nonce | ciphertext | 16-byte GCM tag
```

The plaintext is UTF-8 JSON, compressed with raw DEFLATE (RFC 1951; zlib on Apple platforms, `deflate-raw` in browsers) before encrypting. The team key is 32 random bytes, written in links as base64url without padding.

| Encrypted field | Plaintext |
|---|---|
| Team name | `{"name": "Waterfall Federal"}` |
| Member profile | `{"name": "Jay Nichols", "title": "Director of Federal Sales"}` |
| Share | See below |

### The share

```json
{
  "kind": "bearings-team-share", "v": 2,
  "owner": "Jay Nichols", "made": "2026-10-12",
  "people": [{"f": "Dana", "l": "Whitfield", "c": "DISA", "p": "Director, Acquisition", "u": "https://www.linkedin.com/in/...", "b": "strong"}],
  "pursuits": [{"name": "DISA OT gateway pilot", "agency": "DISA", "stage": "Qualify", "due": "2026-11-26", "value": "$2.4M",
                "roles": [{"role": "Contracting officer", "name": "Keisha Mercer", "p": "Contracting Officer", "b": "warm"}]}],
  "targets": ["DISA", "NAVFAC", "USACE"]
}
```

`b` is how close the relationship is: `strong`, `warm`, `light` or `none`. A version 1 share (a team pack file) has no `pursuits` or `targets`, and is still accepted.

## Links

- **Invite link:** `https://<team server>/join/<code>#k=<team key>`. Opening it shows a page with an **Open in Northfix** button that hands off to the app as `bearings://team/join?code=<code>&k=<team key>`. That page's script reads the key from the `#` part, so the key never reaches the server.
- An invite has a role, a number of uses (1 to 50, default 10) and an expiry (1 to 30 days, default 14). Admins can revoke one at any time.

## Server API

Base URL: the `TEAM_URL` repository variable. Every request and response body is JSON. Signed-in requests send `Authorization: Bearer <token>`. A token is 32 random bytes in base64url; the server stores only its SHA-256.

Times are milliseconds since 1970. Errors look like `{"error": "Plain-English message"}` with a matching HTTP status.

| Method and path | Who | Body | Returns |
|---|---|---|---|
| `GET /health` | anyone | | `{"ok": true}` |
| `POST /v1/teams` | anyone | `{name, profile}` (both encrypted) | `{team: {id}, member: {id, role: "owner"}, token}` |
| `GET /v1/team` | member | | `{team: {id, name, plan, seats, trialEnds, created, readOnly}, me: {id, role}, members: [{id, role, profile, joined, seen, shareUpdated, shareSize}], invites: [{code, role, usesLeft, expires}]}` (invites for admins only) |
| `PUT /v1/team` | admin | `{name}` | `{ok: true}` |
| `DELETE /v1/team` | owner | | `{ok: true}`, and everything is deleted |
| `POST /v1/invites` | admin | `{role, uses, days}` | `{code, role, usesLeft, expires}` |
| `DELETE /v1/invites/:code` | admin | | `{ok: true}` |
| `GET /v1/invites/:code` | anyone | | `{ok: true, expires}`, or 404 if invalid or expired |
| `POST /v1/join` | anyone with a code | `{code, profile}` | `{team: {id}, member: {id, role}, token}`. 404 for a bad code, 409 when every seat is taken, 402 when the trial has ended |
| `PUT /v1/me` | member | `{profile}` | `{ok: true}` |
| `PUT /v1/share` | member | `{body}` | `{updated}`. 402 when read-only |
| `GET /v1/shares` | member | | `[{member, updated, size}]` |
| `GET /v1/shares/:member` | member | | `{member, updated, body}` |
| `PATCH /v1/members/:id` | admin (owner to make admins or hand over ownership) | `{role}` | `{ok: true}` |
| `DELETE /v1/members/:id` | admin, or yourself to leave | | `{ok: true}`. The owner can't leave; they hand over ownership or delete the team |
| `GET /v1/audit` | admin | | `[{at, actor, kind, target}]`, newest first, the last 200 |
| `GET /v1/billing` | admin | | `{plan, seats, used, trialEnds, canCheckout}` |
| `POST /v1/billing/checkout` | owner | `{seats}` | `{url}` (Stripe Checkout). 501 if billing isn't set up |
| `POST /v1/billing/portal` | owner | | `{url}` (Stripe customer portal) |
| `POST /stripe/webhook` | Stripe | | Updates the plan and seats |
| `GET /join/:code` | anyone | | The invite page |

**Limits:** share body up to 2,000,000 characters, profile up to 4 KB, team name up to 2 KB, 200 members per team.

**Roles:** `owner` (one per team: billing, delete, hand over), `admin` (invite, remove, change roles below admin), `member`.

## Engine calls the apps use

| Call | What it does |
|---|---|
| `teamShare(owner)` | Your share as a JSON string, ready to encrypt |
| `setTeamShares([{id, text}])` | Replaces every share that came from the team server. Team pack files you added by hand stay |
| `teamList()` | `[{owner, made, count, id, pursuits, targets}]` |
| `teamOverview()` | Members, combined coverage, team pursuits and the team watchlist |
| `agencyCoverage(withTeam)` | The federal map. With `true`, each agency also counts the team's people, and the status reflects the whole team |

## Running it

1. **Cloudflare:** the D1 database `bearings-team` already exists. Add the GitHub secrets `CLOUDFLARE_API_TOKEN` (from the "Edit Cloudflare Workers" template, plus D1 edit permission) and `CLOUDFLARE_ACCOUNT_ID`.
2. **Deploy:** run Actions > **Team server** > Run workflow. It applies the database schema and deploys the worker. Its log shows the address.
3. **Point the apps at it:** add a repository variable `TEAM_URL` set to that address. The next builds show Team in the You tab.
4. **Billing (optional, later):** add the GitHub secrets `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` (the per-seat yearly price) and `STRIPE_WEBHOOK_SECRET`, then run the deploy again. Until they're set, teams stay on the trial and you can raise seats by hand.
