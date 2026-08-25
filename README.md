# Assay

Commodity tape, correlations, custom indices and a landed-cost ledger.
A React SPA on GitHub Pages, fed by a scheduled Python job.

## Architecture

```
scripts/fetch_prices.py   pulls prices        → data/*.json   (committed, the archive)
scripts/publish_api.py    shapes the payload  → public/api/v1/*.json
Vite build                                    → dist/         → GitHub Pages
```

The data layer is versioned static JSON: `/api/v1/board.json` and
`/api/v1/series.json`. Those are real cacheable GETs off GitHub's CDN. There is
no server, which means no cold start and nothing to keep alive — and also no
POST. Everything the user configures lives in their browser.

**One workflow does all of it.** A commit pushed with the default `GITHUB_TOKEN`
does not trigger other workflows, so splitting "fetch" and "deploy" into two
would leave the site stale while the data stayed current.

## Setup

1. Push to a repo named `Commodity-Tracker` (the Vite `base` matches that path —
   change `BASE_PATH` for a custom domain).
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Secrets → Actions →** add `DATA_GOV_KEY`, a free key from
   [data.gov.in](https://data.gov.in). Without it the four mandi rows drop off
   the board and the run log says so.
4. **Actions → Refresh and deploy → Run workflow → tick `backfill` → Run.**

Step 4 matters. The repo ships with simulated prices for the exchange-traded
rows so the page renders before any job has run. A normal run *appends* to
whatever history is there, which would give you real-looking 1M and 1Y columns
computed against invented history. `backfill` discards that and pulls two years
of real closes instead.

## Local

```bash
npm install
python scripts/publish_api.py    # generate the API from data/
npm run dev
npm run test                     # 51 unit tests
node test/app.test.mjs           # 37 integration tests against the built app
```

## Features

| View | What it does |
|---|---|
| Board | 26 instruments, watchlist stars, change columns, sparklines |
| Highlights | Rules you set, plus automatic flags for big moves and stale prices |
| Compare | Up to 8 instruments rebased to 100 on one axis |
| Correlation | Pearson on daily log returns, over sessions both instruments traded |
| Basket | Weighted custom index, matched on dates every leg traded |
| Ledger | Landed-cost stack today vs a year ago, importer and exporter views |

Watchlist, rules, basket and ledger assumptions persist per browser via
localStorage, with export/import to move them between machines.

## What this deliberately doesn't do

- **No accounts, no sync, no push notifications.** Static hosting has no server
  to hold them. Highlights are evaluated in your browser when the page loads;
  nothing reaches you with the tab closed. Multi-user features are the point at
  which Pages stops being enough.
- **Rows with no price archive show no change columns, no correlations, and no
  year-on-year stack.** Nickel, zinc, BDI, WCI and the four mandi rows have no
  free history to backfill, so they start from one point and build up. The
  ledger says so outright rather than comparing today against today.
- **Freightos FBX was dropped.** It blocks automated access and publishes no
  free level, so it would have sat permanently stale.
- **The forecast band is not a prediction.** Realised 20-session volatility
  projected forward as `S·exp(µ·n ± z·σ·√n)`, drift capped at ±0.5σ. Inner band
  ≈68%, outer ≈95% under lognormal returns — which commodities frequently
  are not, especially around harvest and supply shocks.
- **Freight in the ledger is your input, not a feed.** Both sliders start from
  the WCI level, but an eight-lane composite is not your contracted rate.

## Data sources

| Group | Source | Refresh |
|---|---|---|
| Energy, crypto, metals, global agri, FX | Yahoo Finance chart API | twice daily, 2y archive |
| India agri (chilli, turmeric, cotton, onion) | data.gov.in Agmarknet | daily, when up |
| LME nickel & zinc, BDI, WCI | `data/manual.json` | by hand |

Values in `data/manual.json`, sourced 21–22 Aug 2026: nickel $16,707/t (LME cash),
zinc $3,824/t (LME 3-month; cash was ~$3,980, a backwardation worth noticing),
Baltic Dry 2,841, Drewry WCI $4,526/40ft.

Informational only. Not trading advice.
