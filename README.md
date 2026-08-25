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
3. **Settings → Secrets and variables → Actions →** add two free keys:
   - `DATA_GOV_KEY` from [data.gov.in](https://data.gov.in) — the four mandi rows
   - `ALPHAVANTAGE_KEY` from [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key) — the daily ETF proxies
   - `TIINGO_KEY` from [tiingo.com](https://www.tiingo.com) — optional fallback for the same proxies

   Both are optional. Without either, those rows simply don't appear and the run
   log says why.
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
| Basket | Weighted custom index, plus volatility and per-leg variance contributions |

The Macro group is there because commodities do not move in isolation — the
dollar, real yields and risk appetite drive much of what the rest of the board
shows, and all four series are daily, so they carry volatility bands and enter
the correlation matrix.
| Ledger | Landed-cost stack today vs a year ago, importer and exporter views |

Watchlist, rules, basket and ledger assumptions persist per browser via
localStorage, with export/import to move them between machines.

**Basket risk** is computed locally: portfolio variance is `wᵀΣw` from daily log
returns, and each leg's share of it is `wᵢ·(Σw)ᵢ`. Contributions sum to 100% by
construction, and a leg routinely carries more risk than its weight — which is
the point of showing it. The diversification ratio is the weighted average of
the legs' own volatilities divided by the basket's; 1.0 means the legs move as
one asset and the basket diversifies nothing. Monthly benchmarks are excluded
rather than mixed in — twelve observations a year cannot estimate a covariance
worth acting on.

## What this deliberately doesn't do

- **No accounts, no sync, no push notifications.** Static hosting has no server
  to hold them. Highlights are evaluated in your browser when the page loads;
  nothing reaches you with the tab closed. Multi-user features are the point at
  which Pages stops being enough.
- **Staleness is judged per cadence, not per day.** A monthly IMF benchmark
  published for 1 July is current in August; flagging it "55d old" would make
  working data look broken. The thresholds are 4 days for daily series, 10 for
  weekly, 45 for monthly.
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

| Group | Source | Frequency |
|---|---|---|
| Brent, WTI, natural gas, USD/INR | EIA and Fed via FRED | daily |
| Bitcoin, Ethereum, Solana | Coinbase, CoinGecko as fallback | daily |
| VIX, US 10-year, broad dollar index, EUR/USD | CBOE, Treasury and Fed via FRED | daily |
| Metals, precious, global agri | IMF via FRED | monthly, 2–3 week lag |
| India agri — 14 mandi rows | data.gov.in Agmarknet | daily, when the market trades |
| Commodity ETF proxies (GLD, SLV, CPER, WEAT, CORN, CANE, JO, SOYB, DBB, USO) | Alpha Vantage, Tiingo as fallback | daily |
| BDI, Drewry WCI | `data/manual.json` | by hand |

**About the mandi rows.** Several are chosen to sit opposite a global
benchmark — wheat, soybeans, cotton and sugar appear twice on the board, once
as an IMF world price and once as what is actually paid at an Indian mandi.
The gap between the two is the basis.

That dataset carries no archive: it publishes the current day only. These rows
therefore start with a single point and accumulate one per run, so their charts
and change columns stay empty for weeks. A row reporting "no arrivals today" is
normal — Agmarknet lists only markets that actually traded.

**About the proxies.** Free daily feeds for the actual metal and grain
contracts do not exist without paying. What does exist is daily equity data,
and the commodity ETFs track their underlying closely. They are listed in
their own group, priced per share, and never feed the landed-cost ledger — a
GLD share is roughly a tenth of an ounce, and every one carries roll yield and
expense drag. Use them for movement, correlation and volatility; use the FRED
monthly benchmarks for the actual price level.

Ten tickers at two runs a day is 20 calls, inside Alpha Vantage's free tier of
25 per day. Adding more proxies, or a third daily run, will exceed it — and the
free tier answers a spent quota with HTTP 200 and an explanatory message rather
than an error code, which is exactly the kind of thing that gets mistaken for
data. The fetcher checks for it and falls through to Tiingo, whose free tier
gives full history on a single token. The run log names which provider served
each row.

Unadjusted closes are used on purpose. These ETFs stand in for a commodity
price, so adjusting for dividend reinvestment would be the wrong correction.

Run `python scripts/fetch_prices.py --check` to probe every source without
writing anything. It prints the latest observation per series and names what
failed — the fastest way to spot a FRED series ID that has been renamed.

Values in `data/manual.json`, sourced 21–22 Aug 2026: nickel $16,707/t (LME cash),
zinc $3,824/t (LME 3-month; cash was ~$3,980, a backwardation worth noticing),
Baltic Dry 2,841, Drewry WCI $4,526/40ft.

Informational only. Not trading advice.
