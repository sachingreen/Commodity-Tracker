"""Fetch prices into data/history.json + data/latest.json.

Two modes:
  python scripts/fetch_prices.py              append today's close
  python scripts/fetch_prices.py --backfill   replace history with real data

Run --backfill once, first. The repo ships with simulated prices so the page
renders before any job has run; appending to those would produce real-looking
1M and 1Y changes computed against invented history. Backfill pulls two years
of genuine closes from Yahoo and resets the sources that have no history
available (mandi, LME, freight) to a single dated point.

Design rule: never destroy good data. If a source fails on a normal run, the
last close carries forward flagged with its age, so a broken scraper degrades
one row instead of blanking the board.

Sources
  Yahoo Finance chart API  exchange-traded futures, crypto, FX  (no key)
  data.gov.in Agmarknet    Indian mandi prices                  (free key)
  data/manual.json         LME nickel/zinc, BDI, WCI            (by hand)

Env
  DATA_GOV_KEY   optional; India agri rows go stale without it
"""
import json, os, sys, time, urllib.parse, urllib.request, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
MAX_SESSIONS = 520

YAHOO = {
    "BZ=F": ("Brent Crude", "Energy", "USD/bbl", "ICE"),
    "CL=F": ("WTI Crude", "Energy", "USD/bbl", "NYMEX"),
    "NG=F": ("Natural Gas", "Energy", "USD/MMBtu", "NYMEX"),
    "BTC-USD": ("Bitcoin", "Crypto", "USD", "Coinbase"),
    "ETH-USD": ("Ethereum", "Crypto", "USD", "Coinbase"),
    "HG=F": ("Copper", "Base metals", "USD/lb", "COMEX"),
    "ALI=F": ("Aluminium", "Base metals", "USD/t", "CME"),
    "HRC=F": ("Steel HRC", "Base metals", "USD/t", "CME"),
    "GC=F": ("Gold", "Precious", "USD/oz", "COMEX"),
    "SI=F": ("Silver", "Precious", "USD/oz", "COMEX"),
    "ZC=F": ("Corn", "Global agri", "USc/bu", "CBOT"),
    "ZW=F": ("Wheat", "Global agri", "USc/bu", "CBOT"),
    "ZR=F": ("Rough Rice", "Global agri", "USD/cwt", "CBOT"),
    "SB=F": ("Sugar No.11", "Global agri", "USc/lb", "ICE"),
    "ZS=F": ("Soybeans", "Global agri", "USc/bu", "CBOT"),
    "KC=F": ("Coffee C", "Global agri", "USc/lb", "ICE"),
    "CT=F": ("Cotton No.2", "Global agri", "USc/lb", "ICE"),
    "INR=X": ("USD/INR", "Freight", "INR", "FX"),
}

# symbol -> (commodity, market, state, display name)
MANDI = {
    "AGM-CHILLI": ("Chilli Red", "Guntur", "Andhra Pradesh", "Chilli (Guntur)"),
    "AGM-TURMERIC": ("Turmeric", "Nizamabad", "Telangana", "Turmeric (Nizamabad)"),
    "AGM-COTTON": ("Cotton", "Adilabad", "Telangana", "Cotton (Adilabad)"),
    "AGM-ONION": ("Onion", "Kurnool", "Andhra Pradesh", "Onion (Kurnool)"),
}

# No free feed. Edit data/manual.json; the board shows each value's age.
MANUAL = {
    "LME-NI": ("Nickel", "Base metals", "USD/t", "LME · manual"),
    "LME-ZN": ("Zinc", "Base metals", "USD/t", "LME · manual"),
    "BDI": ("Baltic Dry Index", "Freight", "index", "Baltic Exch · manual"),
    "WCI": ("Drewry WCI 40ft", "Freight", "USD/FEU", "Drewry · manual"),
}

# plausibility guard — a price outside this range means the feed changed units
# or returned the wrong contract, so it is rejected rather than written silently
SANE = {
    "BZ=F": (20, 250), "CL=F": (15, 250), "NG=F": (0.5, 30),
    "BTC-USD": (5e3, 1e6), "ETH-USD": (200, 5e4),
    "HG=F": (1, 20), "ALI=F": (800, 8000), "HRC=F": (300, 3000),
    "LME-NI": (6e3, 6e4), "LME-ZN": (1e3, 1e4),
    "GC=F": (800, 2e4), "SI=F": (8, 300),
    "ZC=F": (200, 1500), "ZW=F": (250, 2000), "ZS=F": (500, 3000),
    "ZR=F": (5, 60), "SB=F": (5, 60), "KC=F": (60, 800), "CT=F": (30, 250),
    "INR=X": (40, 200), "BDI": (300, 12000), "WCI": (500, 2e4),
    "AGM-CHILLI": (2e3, 1e5), "AGM-TURMERIC": (2e3, 1e5),
    "AGM-COTTON": (1e3, 5e4), "AGM-ONION": (200, 3e4),
}


def sane(sym, px):
    lo, hi = SANE.get(sym, (0, float("inf")))
    return px is not None and lo <= px <= hi


def get_json(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                print(f"    {type(e).__name__}: {str(e)[:80]}", file=sys.stderr)
                return None
            time.sleep(2 * (i + 1))


def fetch_yahoo(symbol, rng="5d"):
    """Return [(date, close), ...] oldest first."""
    for host in HOSTS:
        url = (f"https://{host}/v8/finance/chart/"
               f"{urllib.parse.quote(symbol)}?range={rng}&interval=1d")
        d = get_json(url, tries=2)
        try:
            res = d["chart"]["result"][0]
            closes = res["indicators"]["quote"][0]["close"]
            stamps = res["timestamp"]
            out = []
            for px, ts in zip(closes, stamps):
                if px is None:
                    continue
                day = dt.datetime.utcfromtimestamp(ts).date().isoformat()
                out.append((day, round(float(px), 4)))
            if out:
                return out
        except Exception:
            continue
    return []


def fetch_mandi(key, commodity, market, state):
    if not key:
        return []
    q = urllib.parse.urlencode({
        "api-key": key, "format": "json", "limit": 40,
        "filters[commodity]": commodity,
        "filters[market]": market,
        "filters[state]": state,
    })
    url = ("https://api.data.gov.in/resource/"
           "9ef84268-d588-465a-a308-a864a43d0070?" + q)
    d = get_json(url)
    recs = (d or {}).get("records") or []
    if not recs:
        return []
    r = recs[0]
    try:
        px = float(str(r.get("modal_price", "")).replace(",", ""))
        day = str(r.get("arrival_date", ""))
        if "/" in day:                      # DD/MM/YYYY
            dd, mm, yy = day.split("/")
            day = f"{yy}-{mm}-{dd}"
        return [(day or dt.date.today().isoformat(), round(px, 2))]
    except Exception:
        return []


def load(name, default):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        try:
            return json.load(open(p))
        except Exception:
            pass
    return default


def main():
    backfill = "--backfill" in sys.argv
    today = dt.date.today().isoformat()
    hist = load("history.json", {"series": {}})
    manual = load("manual.json", {})
    series = {} if backfill else hist.get("series", {})

    meta = {**YAHOO,
            **{k: (v[3], "India agri", "INR/qtl", "Agmarknet")
               for k, v in MANDI.items()},
            **MANUAL}

    rows, missing, fresh, carried, rejected = [], [], 0, 0, 0
    print(("BACKFILL — replacing history" if backfill else "Appending today's close")
          + f"  ({today})\n")

    for sym, (name, group, unit, source) in meta.items():
        if sym in YAHOO:
            points = fetch_yahoo(sym, "2y" if backfill else "5d")
        elif sym in MANDI:
            c, m, s, _ = MANDI[sym]
            points = fetch_mandi(os.environ.get("DATA_GOV_KEY"), c, m, s)
        else:
            e = manual.get(sym) or {}
            points = [(e["date"], e["price"])] if e.get("price") else []

        clean = [(d, p) for d, p in points if sane(sym, p)]
        rejected += len(points) - len(clean)

        s = series.setdefault(sym, {"dates": [], "close": []})
        for day, px in clean:
            if s["dates"] and day <= s["dates"][-1]:
                if day == s["dates"][-1]:
                    s["close"][-1] = px          # same session, refresh
                continue
            s["dates"].append(day)
            s["close"].append(px)

        if clean:
            px, day = s["close"][-1], s["dates"][-1]
            fresh += 1
            tag = f"{len(clean):>4} pts" if backfill else "      ok"
        elif s["close"]:
            px, day = s["close"][-1], s["dates"][-1]
            carried += 1
            tag = " carried"
        else:
            missing.append(sym)
            print(f"  {sym:14} {'—':>12}   no data, no history — dropped")
            continue

        s["dates"] = s["dates"][-MAX_SESSIONS:]
        s["close"] = s["close"][-MAX_SESSIONS:]

        age = (dt.date.fromisoformat(today) - dt.date.fromisoformat(day)).days
        rows.append({"symbol": sym, "name": name, "group": group, "unit": unit,
                     "source": source, "price": px, "date": day,
                     "stale_days": max(age, 0), "history": len(s["close"])})
        print(f"  {sym:14} {px:>12}  {day}  {tag}")

    json.dump({"seed": False, "asof": today, "instruments": rows},
              open(os.path.join(DATA, "latest.json"), "w"), indent=1)
    json.dump({"seed": False, "asof": today, "series": series},
              open(os.path.join(DATA, "history.json"), "w"), indent=1)

    print(f"\n{fresh} fresh · {carried} carried forward · {len(rows)} on the board"
          + (f" · {rejected} points rejected as implausible" if rejected else ""))

    if missing:
        print("\nWARNING — these instruments are not on the board:")
        for sym in missing:
            why = ("no DATA_GOV_KEY secret set" if sym in MANDI
                   else "missing from data/manual.json" if sym in MANUAL
                   else "the feed returned nothing usable")
            print(f"  {sym:14} {why}")
        print("A backfill clears history, so a source that fails during one "
              "leaves nothing to carry forward.")

    if fresh == 0:
        print("Every source failed — check the log above.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
