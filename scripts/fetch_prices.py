"""Fetch prices into data/history.json + data/latest.json.

  python scripts/fetch_prices.py            append the latest observations
  python scripts/fetch_prices.py --backfill replace history with a full archive
  python scripts/fetch_prices.py --check    probe every source, write nothing

Why these sources
  Yahoo's chart API rate-limits by IP and refuses CI runners outright; Stooq's
  CSV endpoint returns HTML for futures tickers. Both were tried and abandoned.
  FRED needs no key, does not block datacenter addresses, and is run by the
  St. Louis Fed, so it will still answer next year. CoinGecko's free tier
  covers crypto without a key. data.gov.in covers Indian mandis.

The frequency trade-off, stated plainly
  FRED serves energy and FX daily, but metals and agricultural commodities
  come monthly from the IMF with a two-to-three week lag. A 20-session
  volatility band computed from monthly observations would be arithmetic
  dressed up as analysis, so every instrument carries a `freq` field and the
  app shows bands and correlations only for daily series.

Design rule: never destroy good data. A failed source carries its last close
forward flagged with its age, and a backfill replaces a symbol's history only
once replacement data is actually in hand.
"""
import json, os, shutil, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, datetime as dt

def env_key(name):
    """Read an API key, stripped.

    A key pasted into a CI secret box usually carries a trailing newline. That
    newline lands inside the query string and curl rejects the entire URL with
    "Malformed input to a URL function" — which reads like a code bug and is
    not one.
    """
    return (os.environ.get(name) or "").strip()


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
MAX_SESSIONS = 900          # monthly series need years to fill a chart
PACE = float(os.environ.get("PACE", "1"))
# Hard ceiling on the whole fetch. Without one, a run where every source is
# slow spends three retries and escalating sleeps on each of 36 sources and
# quietly burns twenty minutes of CI. Past the budget, remaining sources are
# skipped and carry forward — a partial refresh beats a hung job.
BUDGET = float(os.environ.get("BUDGET_SECONDS", "420"))
STARTED = time.monotonic()


def out_of_time():
    return time.monotonic() - STARTED > BUDGET

# symbol -> (provider, code, name, group, unit, freq, source label)
SOURCES = {
    # --- FRED, daily -------------------------------------------------------
    "BZ=F":  ("fred", "DCOILBRENTEU", "Brent Crude", "Energy", "USD/bbl", "daily", "EIA via FRED"),
    "CL=F":  ("fred", "DCOILWTICO", "WTI Crude", "Energy", "USD/bbl", "daily", "EIA via FRED"),
    "NG=F":  ("fred", "DHHNGSP", "Natural Gas", "Energy", "USD/MMBtu", "daily", "EIA via FRED"),
    "INR=X": ("fred", "DEXINUS", "USD/INR", "Freight", "INR", "daily", "Fed via FRED"),

    # --- CoinGecko, daily --------------------------------------------------
    "BTC-USD": ("coingecko", "bitcoin", "Bitcoin", "Crypto", "USD", "daily", "CoinGecko"),
    "ETH-USD": ("coingecko", "ethereum", "Ethereum", "Crypto", "USD", "daily", "CoinGecko"),

    # --- FRED, monthly (IMF global benchmark prices) -----------------------
    "COPPER":  ("fred", "PCOPPUSDM", "Copper", "Base metals", "USD/t", "monthly", "IMF via FRED"),
    "ALUM":    ("fred", "PALUMUSDM", "Aluminium", "Base metals", "USD/t", "monthly", "IMF via FRED"),
    "NICKEL":  ("fred", "PNICKUSDM", "Nickel", "Base metals", "USD/t", "monthly", "IMF via FRED"),
    "ZINC":    ("fred", "PZINCUSDM", "Zinc", "Base metals", "USD/t", "monthly", "IMF via FRED"),
    "IRONORE": ("fred", "PIORECRUSDM", "Iron ore", "Base metals", "USD/t", "monthly", "IMF via FRED"),
    "GOLD":    ("fred", "PGOLDUSDM", "Gold", "Precious", "USD/oz", "monthly", "IMF via FRED"),
    "SILVER":  ("fred", "PSILVERUSDM", "Silver", "Precious", "USD/oz", "monthly", "IMF via FRED"),
    "WHEAT":   ("fred", "PWHEAMTUSDM", "Wheat", "Global agri", "USD/t", "monthly", "IMF via FRED"),
    "CORN":    ("fred", "PMAIZMTUSDM", "Maize", "Global agri", "USD/t", "monthly", "IMF via FRED"),
    "RICE":    ("fred", "PRICENPQUSDM", "Rice", "Global agri", "USD/t", "monthly", "IMF via FRED"),
    "SUGAR":   ("fred", "PSUGAISAUSDM", "Sugar", "Global agri", "USc/lb", "monthly", "IMF via FRED"),
    "SOY":     ("fred", "PSOYBUSDM", "Soybeans", "Global agri", "USD/t", "monthly", "IMF via FRED"),
    "COFFEE":  ("fred", "PCOFFOTMUSDM", "Coffee", "Global agri", "USc/lb", "monthly", "IMF via FRED"),
    "COTTON":  ("fred", "PCOTTINDUSDM", "Cotton", "Global agri", "USc/lb", "monthly", "IMF via FRED"),

    # --- Agmarknet, daily when it is up ------------------------------------
    "AGM-CHILLI":   ("mandi", "Chilli Red|Guntur|Andhra Pradesh", "Chilli (Guntur)", "India agri", "INR/qtl", "daily", "Agmarknet"),
    "AGM-TURMERIC": ("mandi", "Turmeric|Nizamabad|Telangana", "Turmeric (Nizamabad)", "India agri", "INR/qtl", "daily", "Agmarknet"),
    "AGM-COTTON":   ("mandi", "Cotton|Adilabad|Telangana", "Cotton (Adilabad)", "India agri", "INR/qtl", "daily", "Agmarknet"),
    "AGM-ONION":    ("mandi", "Onion|Kurnool|Andhra Pradesh", "Onion (Kurnool)", "India agri", "INR/qtl", "daily", "Agmarknet"),

    # --- Alpha Vantage, daily ETF proxies (needs ALPHAVANTAGE_KEY) ---------
    # Ten tickers x two runs a day = 20 calls, inside the free tier's 25.
    "P-GOLD":   ("alpha", "GLD", "Gold (GLD)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-SILVER": ("alpha", "SLV", "Silver (SLV)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-COPPER": ("alpha", "CPER", "Copper (CPER)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-WHEAT":  ("alpha", "WEAT", "Wheat (WEAT)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-CORN":   ("alpha", "CORN", "Corn (CORN)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-SUGAR":  ("alpha", "CANE", "Sugar (CANE)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-COFFEE": ("alpha", "JO", "Coffee (JO)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-SOY":    ("alpha", "SOYB", "Soybeans (SOYB)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-METALS": ("alpha", "DBB", "Base metals (DBB)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),
    "P-OIL":    ("alpha", "USO", "Crude (USO)", "Proxies", "USD/share", "daily", "Alpha Vantage · proxy"),

    # --- hand-maintained, no free feed exists ------------------------------
    "BDI": ("manual", "", "Baltic Dry Index", "Freight", "index", "daily", "Baltic Exch · manual"),
    "WCI": ("manual", "", "Drewry WCI 40ft", "Freight", "USD/FEU", "weekly", "Drewry · manual"),
}

# a price outside this range means the series changed units or is the wrong one
SANE = {
    "BZ=F": (10, 300), "CL=F": (10, 300), "NG=F": (0.5, 40), "INR=X": (40, 200),
    "BTC-USD": (1e3, 1e7), "ETH-USD": (50, 1e5),
    "COPPER": (2e3, 3e4), "ALUM": (800, 8e3), "NICKEL": (5e3, 8e4),
    "ZINC": (800, 1e4), "IRONORE": (20, 500),
    "GOLD": (500, 2e4), "SILVER": (5, 300),
    "WHEAT": (80, 1e3), "CORN": (60, 800), "RICE": (150, 2e3),
    "SUGAR": (3, 80), "SOY": (200, 2e3), "COFFEE": (50, 800), "COTTON": (30, 400),
    "AGM-CHILLI": (2e3, 1e5), "AGM-TURMERIC": (2e3, 1e5),
    "AGM-COTTON": (1e3, 5e4), "AGM-ONION": (200, 3e4),
    "BDI": (300, 12000), "WCI": (500, 2e4),
    # ETF share prices, not commodity prices
    "P-GOLD": (20, 2000), "P-SILVER": (5, 500), "P-COPPER": (5, 300),
    "P-WHEAT": (1, 100), "P-CORN": (1, 100), "P-SUGAR": (1, 100),
    "P-COFFEE": (1, 300), "P-SOY": (1, 100), "P-METALS": (2, 200),
    "P-OIL": (5, 300),
}


def sane(sym, px):
    lo, hi = SANE.get(sym, (0, float("inf")))
    return px is not None and lo <= px <= hi


CURL = shutil.which("curl")


def get(url, tries=2, timeout=30):
    """Return the response body as text, or a __MARKER__ describing the failure.

    curl goes first. Python's urllib times out against FRED on some networks
    where curl succeeds against the identical URL — most likely an IPv6 or TLS
    negotiation difference. Rather than diagnose someone's network stack, use
    the client that works; curl is present on macOS and on GitHub runners.
    """
    if CURL:
        for i in range(tries):
            r = subprocess.run(
                # -L follows redirects; --ipv4 avoids the long IPv6 stall that
                # CI runners hit on hosts with AAAA records they cannot reach
                # --http1.1 because some of these hosts negotiate HTTP/2 and
                # then reset the stream mid-response (curl error 92)
                [CURL, "-sS", "-L", "--ipv4", "--http1.1", "--compressed",
                 "--connect-timeout", "15", "--max-time", str(timeout),
                 "-A", UA, "-w", "\n__STATUS_%{http_code}__", url],
                capture_output=True, text=True)
            body = r.stdout
            if "__STATUS_" in body:
                body, _, status = body.rpartition("\n__STATUS_")
                code = status.rstrip("_")
                if code == "200":
                    return body
                if code != "000":
                    if i == tries - 1:
                        return f"__HTTP_{code}__"
                elif i == tries - 1:
                    # 000 means the request never completed. curl explains why
                    # on stderr, and that message is the whole diagnosis —
                    # discarding it turns a solvable problem into a mystery.
                    why = (r.stderr or "").strip().replace("\n", " ")[:90]
                    return f"__CURL_{why or 'no response, no error'}__"
            elif i == tries - 1:
                why = (r.stderr or "").strip().replace("\n", " ")[:90]
                return f"__CURL_exit{r.returncode}_{why}__"
            time.sleep(2)

    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if i == tries - 1:
                return f"__HTTP_{e.code}__"
            time.sleep(3 * (i + 1))
        except Exception as e:
            if i == tries - 1:
                return f"__ERR_{type(e).__name__}__"
            time.sleep(3 * (i + 1))


def fetch_fred(code, limit):
    """FRED's official API. Returns ([(date, value), ...], status).

    Uses api.stlouisfed.org, not the fredgraph.csv chart-download URL. The
    chart URL is meant for browsers and accepts connections from CI runners
    then sends nothing back — a 45-second timeout with zero bytes received.
    The API host is built for programmatic access and needs a free key.
    """
    key = env_key("FRED_API_KEY")
    if not key:
        return [], "no FRED_API_KEY set"
    q = urllib.parse.urlencode({
        "series_id": code, "api_key": key, "file_type": "json",
        "sort_order": "desc", "limit": limit,
    })
    body = get("https://api.stlouisfed.org/fred/series/observations?" + q, timeout=30)
    if not body or body.startswith("__"):
        return [], (body or "no response")
    try:
        obs = json.loads(body).get("observations", [])
    except Exception:
        # the API reports a bad key or series as XML even with file_type=json
        return [], f"unexpected response: {body[:60]}"
    if not obs:
        return [], "series returned no observations"
    out = []
    for o in obs:
        raw = str(o.get("value", "")).strip()
        if raw in (".", "", "NA"):        # FRED marks gaps with a full stop
            continue
        try:
            out.append((o["date"], round(float(raw), 4)))
        except (ValueError, KeyError):
            continue
    out.sort()
    return out, ("ok" if out else "every observation was a gap marker")


def fetch_coingecko(coin, days):
    url = (f"https://api.coingecko.com/api/v3/coins/{coin}/market_chart"
           f"?vs_currency=usd&days={days}&interval=daily")
    body = get(url)
    if not body or body.startswith("__"):
        return [], (body or "no response")
    try:
        prices = json.loads(body)["prices"]
    except Exception:
        return [], "unexpected response shape"
    out = [(dt.datetime.utcfromtimestamp(ms / 1000).date().isoformat(),
            round(float(px), 2)) for ms, px in prices]
    return out, ("ok" if out else "no prices returned")


def fetch_alpha(ticker, key, backfill):
    """Daily closes for an exchange-traded proxy.

    Alpha Vantage's own commodity endpoints are monthly for metals and grains,
    same as FRED, so they add nothing. What it does give is daily equity
    closes — and the commodity ETFs track their underlying closely enough to
    be useful for movement. They are NOT the commodity price: a GLD share is
    roughly a tenth of an ounce, and every one of these carries roll yield and
    expense drag. They are listed as proxies in their own group, priced per
    share, and never feed the landed-cost ledger.
    """
    if not key:
        return [], "no ALPHAVANTAGE_KEY set"
    if not key.isalnum():
        return [], "ALPHAVANTAGE_KEY has stray characters — re-paste the secret"
    size = "full" if backfill else "compact"
    url = ("https://www.alphavantage.co/query?function=TIME_SERIES_DAILY"
           f"&symbol={ticker}&outputsize={size}&apikey={key}")
    body = get(url, timeout=45)
    if not body or body.startswith("__"):
        return [], (body or "no response")
    try:
        payload = json.loads(body)
    except Exception:
        return [], "unexpected response shape"
    # the free tier answers refusals with 200 and an explanatory field
    for field in ("Note", "Information", "Error Message"):
        if field in payload:
            return [], payload[field][:70]
    daily = payload.get("Time Series (Daily)")
    if not daily:
        return [], "no daily series in response"
    out = sorted((day, round(float(v["4. close"]), 4)) for day, v in daily.items())
    return (out[-750:] if backfill else out[-10:]), "ok"


def fetch_tiingo(ticker, backfill):
    """Fallback for the ETF proxies when Alpha Vantage is unavailable.

    Tiingo's free tier gives the full available history and a single token.
    Unadjusted closes are used deliberately: these stand in for a commodity
    price, so dividend reinvestment would be the wrong adjustment.
    """
    key = env_key("TIINGO_KEY")
    if not key:
        return [], "no TIINGO_KEY set"
    start = (dt.date.today() - dt.timedelta(days=1100 if backfill else 14)).isoformat()
    url = (f"https://api.tiingo.com/tiingo/daily/{ticker}/prices"
           f"?startDate={start}&format=json&resampleFreq=daily&token={key}")
    body = get(url, timeout=45)
    if not body or body.startswith("__"):
        return [], (body or "no response")
    try:
        rows = json.loads(body)
    except Exception:
        return [], "unexpected response shape"
    if not isinstance(rows, list) or not rows:
        return [], "no rows returned"
    out = []
    for r in rows:
        day = str(r.get("date", ""))[:10]
        px = r.get("close")
        if day and px is not None:
            out.append((day, round(float(px), 4)))
    return sorted(out), ("ok" if out else "no closes in response")


def fetch_mandi(spec, key):
    if not key:
        return [], "no DATA_GOV_KEY set"
    commodity, market, state = spec.split("|")
    q = urllib.parse.urlencode({
        "api-key": key, "format": "json", "limit": 40,
        "filters[commodity]": commodity,
        "filters[market]": market,
        "filters[state]": state,
    })
    body = get("https://api.data.gov.in/resource/"
               "9ef84268-d588-465a-a308-a864a43d0070?" + q)
    if not body or body.startswith("__"):
        return [], (body or "no response")
    try:
        recs = json.loads(body).get("records") or []
    except Exception:
        return [], "unexpected response shape"
    if not recs:
        return [], "no records for that market today"
    r = recs[0]
    try:
        px = float(str(r.get("modal_price", "")).replace(",", ""))
    except ValueError:
        return [], "unparseable price"
    day = str(r.get("arrival_date", ""))
    if "/" in day:                        # DD/MM/YYYY
        d, m, y = day.split("/")
        day = f"{y}-{m}-{d}"
    return [(day or dt.date.today().isoformat(), round(px, 2))], "ok"


def load(name, default):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        try:
            return json.load(open(p))
        except Exception:
            pass
    return default


def pull(sym, spec, backfill, key, manual):
    provider, code = spec[0], spec[1]
    if provider == "alpha":
        points, why = fetch_alpha(code, env_key("ALPHAVANTAGE_KEY"), backfill)
        if points:
            return points, "ok · alphavantage"
        # the free tier answers a spent quota with HTTP 200 and a message, so
        # any empty result is worth a second opinion before giving up
        alt, alt_why = fetch_tiingo(code, backfill)
        if alt:
            return alt, "ok · tiingo"
        return [], f"alphavantage: {why}; tiingo: {alt_why}"
    if provider == "fred":
        return fetch_fred(code, 900 if backfill else 12)
    if provider == "coingecko":
        return fetch_coingecko(code, 730 if backfill else 7)
    if provider == "mandi":
        return fetch_mandi(code, key)
    e = manual.get(sym) or {}
    return (([(e["date"], e["price"])], "ok") if e.get("price")
            else ([], "absent from manual.json"))


def check(key, manual):
    """Probe every source and report. Writes nothing."""
    print("Probing every configured source. Nothing will be written.\n")
    bad = []
    for sym, spec in SOURCES.items():
        if out_of_time():
            print(f"  {sym:14} {'—':>12}  skipped, budget spent")
            continue
        points, why = pull(sym, spec, False, key, manual)
        clean = [(d, p) for d, p in points if sane(sym, p)]
        if clean:
            d, p = clean[-1]
            print(f"  {sym:14} {spec[6]:22} {p:>12}  {d}")
        else:
            bad.append((sym, spec[1], why))
            print(f"  {sym:14} {spec[6]:22} {'—':>12}  FAILED: {why}")
        if PACE:
            time.sleep(PACE)

    if bad:
        print(f"\n{len(bad)} of {len(SOURCES)} failed:")
        for sym, code, why in bad:
            print(f"  {sym:14} code={code or '(manual)':16} {why}")
        print("\nA FRED failure almost always means the series ID was renamed or "
              "discontinued. Search fred.stlouisfed.org for the commodity, take "
              "the ID from the page URL, and update it in SOURCES.")
    else:
        print(f"\nAll {len(SOURCES)} sources answered.")
    return 1 if bad else 0


def main():
    backfill = "--backfill" in sys.argv
    key = env_key("DATA_GOV_KEY")
    manual = load("manual.json", {})

    if "--check" in sys.argv:
        sys.exit(check(key, manual))

    today = dt.date.today().isoformat()
    series = load("history.json", {"series": {}}).get("series", {})
    rows, fresh, carried, rejected, failures = [], 0, 0, 0, []

    print(("BACKFILL — replacing history where new data arrives"
           if backfill else "Appending the latest observations") + f"  ({today})\n")

    for sym, spec in SOURCES.items():
        _, _, name, group, unit, freq, label = spec
        if out_of_time():
            points, why = [], f"skipped — {BUDGET:.0f}s budget spent"
        else:
            points, why = pull(sym, spec, backfill, key, manual)
        clean = [(d, p) for d, p in points if sane(sym, p)]
        rejected += len(points) - len(clean)

        # replace this symbol's history only now that replacement data exists
        if backfill and clean:
            series[sym] = {"dates": [], "close": []}
        s = series.setdefault(sym, {"dates": [], "close": []})
        for day, px in clean:
            if s["dates"] and day <= s["dates"][-1]:
                if day == s["dates"][-1]:
                    s["close"][-1] = px
                continue
            s["dates"].append(day)
            s["close"].append(px)

        if clean:
            fresh += 1
            tag = f"{len(clean)} pts" if backfill else "ok"
        elif s["close"]:
            carried += 1
            tag = "carried"
            failures.append((sym, why))
        else:
            failures.append((sym, why))
            if "no ALPHAVANTAGE_KEY" not in why:
                print(f"  {sym:14} {'—':>12}              dropped: {why}")
            continue

        px, day = s["close"][-1], s["dates"][-1]
        s["dates"] = s["dates"][-MAX_SESSIONS:]
        s["close"] = s["close"][-MAX_SESSIONS:]
        age = (dt.date.fromisoformat(today) - dt.date.fromisoformat(day)).days

        rows.append({"symbol": sym, "name": name, "group": group, "unit": unit,
                     "source": label, "freq": freq, "price": px, "date": day,
                     "stale_days": max(age, 0), "history": len(s["close"])})
        print(f"  {sym:14} {px:>12}  {day}  {tag:>9}  {label}")
        if PACE:
            time.sleep(PACE)

    json.dump({"seed": False, "asof": today, "instruments": rows},
              open(os.path.join(DATA, "latest.json"), "w"), indent=1)
    json.dump({"seed": False, "asof": today, "series": series},
              open(os.path.join(DATA, "history.json"), "w"), indent=1)

    daily = sum(1 for r in rows if r["freq"] == "daily")
    print(f"\n{fresh} fresh · {carried} carried forward · {len(rows)} on the board"
          + (f" · {rejected} rejected as implausible" if rejected else ""))
    print(f"{daily} daily series carry volatility bands and correlations; "
          f"{len(rows) - daily} are monthly or weekly and show none.")

    if failures:
        print("\nSources that did not answer:")
        for sym, why in failures:
            print(f"  {sym:14} {why}")

    if fresh == 0:
        print("\nEvery source failed. Nothing was overwritten.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
