# Northfix for AI tools

A small MCP (Model Context Protocol) server that lets Claude Desktop, Cursor and other AI apps answer questions about your own network. It runs on your Mac, reads the files the Northfix app already saves, and answers there.

Ask things like:

- "Who do I know at DISA, and who's my warmest way in?"
- "Who's waiting on a reply from me?"
- "Give me this week's five people to reach out to."
- "Who changed jobs in the last 30 days?"
- "How well am I covered at the Department of Energy?"
- "Where do we stand on the NAVFAC pursuit? Which seats are empty?"
- "Tell me about Dana Whitfield before my call."
- "Give me a call plan for the DISA contracting officer."
- "Which DISA contracts end in the next year, and who do I know at the incumbents?"
- "Who wins work at NAVFAC that I could team with?"
- "What's my weighted pipeline this quarter?"
- "Save a note on Dana: wants the zero trust brief by Friday."

## Tools

All tools are read-only except `log_note`, which saves a note only when you ask.

| Tool | What it answers |
| --- | --- |
| `search_people(query, limit?)` | Plain-English search of your network ("colonels at Fort Liberty", "who used to be at Leidos") |
| `person(name_or_key)` | One person: role, past roles, closeness, last message, your notes and follow-ups |
| `ways_in(company_or_agency)` | Ranked intro paths: who works there now, who used to, close contacts in the same sector, teammates |
| `waiting_on_me()` | People who wrote last and are waiting on your reply |
| `weekly_five()` | This week's five people to reach out to, each with a reason |
| `who_changed_jobs(days?)` | Recent job changes, with new and previous role (default 90 days) |
| `agency_coverage(filter?)` | The federal map: covered, thin or no one yet, by department or agency |
| `pursuits()` | Your pursuits, with stage, due date and seats filled |
| `pursuit(name)` | One pursuit: each decision-maker and industry seat, who fills and owns it, cold seats, suggestions, win chance, warmest ways in |
| `pipeline(include_team?)` | Open value, weighted by win chance, by stage; due this quarter; won and lost history and win rate |
| `cold_seats()` | Seats on open pursuits due soon where you haven't been in touch for 60 days |
| `call_plan(name_or_key, pursuit?)` | Facts and a short plan before a call: goal, opener, questions, next step |
| `recompetes(agencies?, months?)` | Contracts ending soon at your agencies, from USASpending.gov: incumbent, value, end date, who you know at the agency and the incumbent |
| `teaming_partners(agency)` | Companies that win work at an agency, from USASpending.gov, with who you and your team know at each |
| `log_note(name_or_key, note)` | Saves a dated note on a person. Northfix files it the next time it opens on your Mac |
| `network_summary()` | A short overview of your network. Always free |

Each answer comes back as short text for the AI to read, plus the same facts as structured data.

## Set it up

You need Northfix on your Mac, opened at least once, with iCloud Drive on. That's where Northfix keeps your network, and where this tool reads it.

### Claude Desktop (easiest)

1. Download `northfix.mcpb` from [northfix.app/ai.html](https://northfix.app/ai.html).
2. Double-click it. Claude Desktop opens and asks to install the Northfix extension.
3. Click Install. Leave the folder setting empty unless your files are somewhere unusual.
4. Start a new chat and ask "Who do I know at DISA?"

### Claude Desktop (config file)

Download `northfix-mcp.mjs`, put it somewhere stable (for example `~/Applications/Northfix/`), and add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "northfix": {
      "command": "node",
      "args": ["/Users/you/Applications/Northfix/northfix-mcp.mjs"]
    }
  }
}
```

This needs Node.js 18 or later. If Claude can't find `node`, use its full path, such as `/opt/homebrew/bin/node` or `/usr/local/bin/node` (run `which node` in Terminal). Quit and reopen Claude Desktop after saving.

### Cursor, ChatGPT desktop and other MCP apps

Any app that can start a local (stdio) MCP server uses the same command. In Cursor, add it to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "northfix": {
      "command": "node",
      "args": ["/Users/you/Applications/Northfix/northfix-mcp.mjs"]
    }
  }
}
```

For other apps, look for "MCP servers", "connectors" or "tools" in settings and add a local server with command `node` and argument `/Users/you/Applications/Northfix/northfix-mcp.mjs`. Some versions of ChatGPT desktop only connect to remote servers; this one is local on purpose, so use an app that supports local servers.

### Options

- `--data /path/to/folder` or the `NORTHFIX_DATA` environment variable: read the network from another folder (it should hold `network.json`). By default the server looks in Northfix's iCloud Drive folder, `~/Library/Mobile Documents/iCloud~com~jaynichols~networkoob/Documents`, then the app's local folder for when iCloud is off, `~/Library/Containers/com.jaynichols.networkoob/Data/Library/Application Support/NetworkOOB`. macOS may ask once whether to allow access to the second one.
- `NORTHFIX_STATE`: where the free plan's daily count is kept. Default `~/Library/Application Support/Northfix AI/`.
- `NORTHFIX_USASPENDING_URL`: for testing only. Sends USASpending.gov searches to another address.

## Privacy

- **Answered on your Mac.** The server reads your Northfix files on this Mac and works out the answer there, with the same engine the Northfix apps use.
- **Nothing goes to Northfix.** There's no Northfix server involved, no account and no analytics.
- **Only agency names go to USASpending.gov.** `recompetes` and `teaming_partners` ask USASpending.gov, the federal government's public spending site, for contract awards. The request holds the agency name and dates, never anyone from your network. Every other tool makes no network connections at all.
- **Your AI app sees only the answers.** It gets the answer to each question you ask, nothing more. It never gets your whole network file. What your AI app does with an answer is covered by that app's own privacy policy. For example, Claude Desktop sends your chat, including tool answers, to Anthropic to reply.
- **Read-only, except notes you ask to save.** The server never changes your network, notes or follow-ups. `log_note` writes `ai-inbox.json` in your Northfix folder; the app files those notes on the right people when it next opens on your Mac, then deletes the file. The only other file it writes is the free plan's daily count, outside your Northfix folder.
- Answers can include the email address on a contact when it's in your own data, because it's your data.

## Northfix Pro

With Northfix Pro (or a Northfix Team seat), ask as much as you like. On the free plan, `network_summary` is always available, plus three other questions a day.

How it knows: the Northfix app writes a small file, `ai-access.json`, next to your network when you have Pro (`{"pro": true, "until": "...", "written": "..."}`). It syncs through iCloud, so Pro bought on your iPhone counts on your Mac. If a subscription renews while the app is closed, there's a week's grace until the app next opens and updates the file.

## For developers

- `mcp/server.mjs` is the server. No dependencies. From the repo it loads the engine bundle at `apple/Northfix/Resources/engine.js` (run `npm run build` first).
- `npm run build:mcp` writes `dist-mcp/northfix-mcp.mjs` (one file, engine inlined) and `dist-mcp/northfix.mcpb` (the Claude Desktop extension: `manifest.json`, `server/index.mjs`, `icon.png`).
- `npm test` includes `test/mcp.test.mjs`, which starts the server on the sample network saved in the app's file format and checks every tool and the free plan limit.
- Protocol: MCP over stdio, JSON-RPC 2.0, one message per line. Protocol version 2025-06-18; older clients asking for 2025-03-26 or 2024-11-05 get that version back.
- The server checks the files' modification times before every call and reloads when the app has saved. It restarts the engine when the day changes, so "this week" stays right.
