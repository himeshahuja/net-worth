# Net worth

Himesh Ahuja's net worth as a password-protected dashboard: read from real bank, brokerage and loan accounts through [Plaid](https://plaid.com), saved on every push, twice a week and when you open the page, and published, encrypted, as a static site.

**Live:** https://himeshahuja.github.io/net-worth/ (password protected; [`?sample`](https://himeshahuja.github.io/net-worth/?sample) shows it with sample figures)

The dashboard has these parts:

- **Figures:** net worth, assets and liabilities, each with its change over the chosen range (1M to All). They double as tabs that switch the chart.
- **Over time:** the chart notes each round number the figure first passes ("Passed $30,000"). Hover or focus any point to inspect its date and value.
- **Ratios:** debt to assets, cash and invested shares, and liquid net worth.
- **Balance sheet:** every category and account type (checking, savings, 401(k), student loans…) with its balance, share and change.
- **Changes:** net worth over 1 day, 7 days, month to date, 3 months, year to date, 1 year and all time.
- **Records:** the high, the low, the best and worst months.
- **Month by month:** a chart of each month's change and a table of month-end closes.
- **Transactions:** every transaction returned by Plaid's transaction sync, searchable in the dashboard.

Until the first snapshot it shows seeded sample figures, labelled as such; sandbox figures are labelled too. Add `?sample` to the address to see the sample whatever has been published.

## What is published and who can read it

The whole record is one file, `public/networth.json`, written by the first snapshot.

**It's encrypted.** Each snapshot seals the file with the page's password (`NETWORTH_PASSWORD`). The encryption is AES-256-GCM, with the key derived from the password by PBKDF2 (SHA-256, 600,000 rounds) ([`src/lib/vault.js`](src/lib/vault.js)). The page asks for the password and decrypts the file in the browser, so anyone without it, the commits and the open URL included, sees only noise. *Remember on this device* keeps the derived key, never the password. It stays valid until the password changes. Nothing is protected beyond that one password, so make it long, and share it only with people who may see the figures.

**Inside**, it holds one line per day:
- totals per category, in whole dollars;
- the same totals split by account type (Plaid's own subtype, such as checking or 401(k));
- the number of accounts and when the file was updated.

Transactions are stored in the same encrypted file, with their description, date, category, amount, pending state and the connected account's name and mask. Two accounts of the same type are still published as one balance total. Without the password, neither the balances nor the transactions can be read.

Once you've [set it up](#running-your-own), it also holds the GitHub token the page uses to ask for a new snapshot, sealed with the rest. The token is limited to this repository's Actions, so the most it can do is start, cancel or delete workflow runs.

```json
{"date":"2026-10-31","cash":2051,"investments":0,"retirement":3200,"other":0,"credit":1840,"loans":25000,
 "types":{"cash.checking":1251,"cash.savings":800,"retirement.roth":3200,"credit.credit card":1840,"loans.student":25000}}
```

Plaid keys, access tokens and the page password live in `.env` and `data/` on the owner's computer. Both are gitignored, and `data/` is readable by that user only. The GitHub Action gets copies as encrypted repository secrets, and its public log never prints a figure. The page in the browser never talks to Plaid.

**To change the password**, put the old one in `NETWORTH_PREVIOUS_PASSWORD` and the new one in `NETWORTH_PASSWORD`, save a snapshot, then remove the old one and run `npm run secrets`. Copies of the file in git history keep the password they were sealed with.

## How it works

```
admin page (localhost only) ─► dev-server API ─► Plaid Link, /item/public_token/exchange
                                     │
                                     ▼
                            data/items.<env>.json        access tokens, mode 0600
                                     │
npm run snapshot, or the Action ─────► /accounts/get ─► public/networth.json ─► GitHub Pages
```

- **Connecting** ([`admin.html`](admin.html), [`server/api.js`](server/api.js)). The admin page exists only on the Vite dev server, and its API answers only this computer's own pages: it checks the host and origin and requires a custom header. It creates a Link token, opens Plaid Link and exchanges the public token on the server. What you say you're connecting picks the Link product: Transactions for a bank or card, Investments for a brokerage or retirement account, Liabilities for a loan. The other two products are optional, so a bank that also holds your brokerage account comes in as one connection.
- **Reconnecting.** A connection whose login expired shows *Needs sign-in*. *Reconnect* opens Link in update mode on the same Item, so its access token, and the Action's copy of it, keeps working.
- **Snapshots** ([`server/snapshot.js`](server/snapshot.js), [`server/accounts.js`](server/accounts.js)):
  - Each account's balance is read and sorted by type and subtype. Retirement plans (401(k), 403(b), IRA, Roth and the rest) count as retirement. Card and loan balances count as owed. A card's available credit never counts as money.
  - Only US dollar balances are added, summed in cents. Each type is rounded down and the leftover dollars go to the largest remainders, so a category's types add up to exactly its total.
  - It's all or nothing: if any connection fails, nothing is saved, so one expired login can never make the public figure drop.
  - Temporary failures (bank down, rate limit) are retried twice with backoff first.
  - The first production snapshot clears any sandbox history.
- **On every push, and hourly** ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)). On each push to `main`, and each hour when the Cloudflare Worker in [`worker/`](worker/) starts it, the Action takes a snapshot with the stored secrets, commits the re-encrypted file and redeploys the page. GitHub's own `schedule` trigger never fired for this repository, so the Worker keeps the time. The history keeps one figure per day, so a later run on the same date replaces that day's. The bot's own snapshot commit starts no new run. If a snapshot fails, nothing is saved: a run the Worker started fails, so GitHub emails you, while a push still deploys its code. Action logs on a public repository are public, so a failing connection is named by its position, never by its bank.
- **The page** ([`src/public/`](src/public/)) is plain React with two hand-written SVG charts and no chart library. Every figure on it comes from `networth.json`: the changes, records and ratios are worked out in the browser ([`src/lib/networth.js`](src/lib/networth.js)).

The balances are the ones Plaid already holds (`/accounts/get`), which Plaid refreshes on its own schedule, typically at least daily. They aren't real-time balance checks, and that's fine for a figure kept once a day. Nothing listens for Plaid webhooks, since a static site has no server to receive them. The scheduled Action is the update mechanism.

## Running your own

You need Node 22 or later, a free [Plaid account](https://dashboard.plaid.com/signup), and the [GitHub CLI](https://cli.github.com) for the scheduled snapshots.

1. **Install and add keys.** Run `npm install`. Copy `.env.example` to `.env` and fill in `PLAID_CLIENT_ID`, plus the `PLAID_SECRET` for the environment in `PLAID_ENV` (`sandbox` or `production`; each has its own secret). The keys are on the [Keys page](https://dashboard.plaid.com/developers/keys). If you use the [Plaid CLI](https://github.com/plaid/plaid-cli), `plaid keys write --env sandbox --gitignore` writes sandbox keys for you. Then set `NETWORTH_PASSWORD`, the page's password: at least 12 characters, and snapshots refuse to save without it.
2. **Connect accounts.** Run `npm run dev` and open http://localhost:5180/admin.html. In sandbox, pick any bank and sign in as `user_good` / `pass_good`.
3. **Save a snapshot.** Click *Save today's snapshot*, or run `npm run snapshot`. Check the result at http://localhost:5180/, then commit `public/networth.json`.
4. **Publish.** Push to a GitHub repository and set **Settings → Pages → Source** to **GitHub Actions**. The page is served at `https://<user>.github.io/<repo>/`.
5. **Snapshot on every push and twice a week.** Run `npm run secrets` in the project folder. It stores the keys, the connections and the page password as encrypted secrets, and the snapshot time zone as a variable. Run it again whenever you connect or remove an account; a reconnect doesn't need it. Because the Action commits its own snapshots, `git pull` before saving one on your computer.
6. **Run it every hour.** Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to this repository only and a single permission, **Actions: Read and write**. Then deploy the Worker, which is free on Cloudflare's plan:
   ```sh
   cd worker
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN   # paste the token when asked
   npx wrangler deploy
   ```
   The schedule is the `crons` line in [`worker/wrangler.toml`](worker/wrangler.toml). Its runs show under the Worker's Cron Events in the Cloudflare dashboard, and a refused token fails there with GitHub's status code. When the token expires, make a new one and run `npx wrangler secret put GITHUB_TOKEN` again.

To make the page yours, change the name and portfolio link in [`src/site.js`](src/site.js), and the title and description in [`index.html`](index.html).

### Going to production

- Switch `PLAID_ENV` to `production` with the production secret. Connections are stored per environment, so you connect your real accounts again.
- Plaid's free Trial plan allows 10 production connections, and removing one doesn't give it back.
- Connect from a desktop browser and allow pop-ups for localhost. Banks that sign in through OAuth (Chase, Bank of America, Wells Fargo and many others) open in a Plaid pop-up. A redirect back to the page isn't an option, because Plaid accepts `http://localhost` redirect URIs only in sandbox.
- Some OAuth banks appear in Link only after your Plaid team has finished its company profile and the security questionnaire in the [Plaid Dashboard](https://dashboard.plaid.com); Chase requires both. A bank that's missing from Link in production is usually this, not a bug.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with the public page at `/` and the admin page at `/admin.html` (port 5180) |
| `npm run snapshot` | Save today's snapshot from the terminal |
| `npm run secrets` | Give the Action the Plaid keys, the connections, the page password and the time zone |
| `npm test` | Run the tests |
| `npm run build` | Build the public page into `dist/` (`BASE_PATH` sets the base, `/net-worth/` by default) |
| `npm run lint` | Lint |

## Tests

`npm test` runs 25 tests with Node's built-in runner. Several drive the API over real HTTP against a stand-in for Plaid. They check:

- categories, card balances and the cents arithmetic, and that each category's types add up to its total;
- the look-backs, highs and lows the dashboard shows;
- that snapshots are dated in your time zone;
- that one failing bank saves nothing, and that a briefly unavailable bank is retried while an expired login isn't;
- that requests from other sites are refused;
- that access tokens stay in a `0600` file and never appear in a response or in the published file;
- that the published file opens only with the password, and that a password change carries the history over;
- that the page's GitHub token is sealed in by the Action alone, and never appears unencrypted;
- that reconnecting uses update mode, and that removing a connection removes it at Plaid.
