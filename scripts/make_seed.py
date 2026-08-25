"""Generate seed data so the site renders before the first live fetch.

Every record written here carries "seed": true so the UI can label it
as sample data. The GitHub Action overwrites these files with real prices.
"""
import json, math, random, datetime as dt

random.seed(11)

# symbol, name, group, unit, source, start_price, annual_vol, annual_drift
UNIVERSE = [
    ("BZ=F",  "Brent Crude",        "Energy",       "USD/bbl",  "ICE",        78.40, 0.34, 0.02),
    ("CL=F",  "WTI Crude",          "Energy",       "USD/bbl",  "NYMEX",      74.80, 0.35, 0.02),
    ("NG=F",  "Natural Gas",        "Energy",       "USD/MMBtu","NYMEX",       3.42, 0.62, -0.05),
    ("BTC-USD","Bitcoin",           "Crypto",       "USD",      "Coinbase", 96400.0, 0.52, 0.18),
    ("ETH-USD","Ethereum",          "Crypto",       "USD",      "Coinbase",  3180.0, 0.63, 0.12),
    ("HG=F",  "Copper",             "Base metals",  "USD/lb",   "COMEX",       4.62, 0.24, 0.06),
    ("ALI=F", "Aluminium",          "Base metals",  "USD/t",    "CME",      2585.00, 0.22, 0.04),
    ("LME-NI","Nickel",             "Base metals",  "USD/t",    "LME · manual", 16707.0, 0.31, -0.03),
    ("LME-ZN","Zinc",               "Base metals",  "USD/t",    "LME · manual",  3824.0, 0.26, 0.03),
    ("HRC=F", "Steel HRC",          "Base metals",  "USD/t",    "CME",       790.00, 0.29, 0.01),
    ("GC=F",  "Gold",               "Precious",     "USD/oz",   "COMEX",    3410.00, 0.16, 0.09),
    ("SI=F",  "Silver",             "Precious",     "USD/oz",   "COMEX",      38.90, 0.29, 0.11),
    ("ZC=F",  "Corn",               "Global agri",  "USc/bu",   "CBOT",      432.00, 0.23, -0.02),
    ("ZW=F",  "Wheat",              "Global agri",  "USc/bu",   "CBOT",      556.00, 0.26, -0.01),
    ("ZR=F",  "Rough Rice",         "Global agri",  "USD/cwt",  "CBOT",       13.85, 0.21, 0.03),
    ("SB=F",  "Sugar No.11",        "Global agri",  "USc/lb",   "ICE",        17.20, 0.28, -0.04),
    ("ZS=F",  "Soybeans",           "Global agri",  "USc/bu",   "CBOT",     1042.00, 0.20, 0.01),
    ("KC=F",  "Coffee C",           "Global agri",  "USc/lb",   "ICE",       298.00, 0.42, 0.07),
    ("CT=F",  "Cotton No.2",        "Global agri",  "USc/lb",   "ICE",        68.40, 0.22, -0.02),
    ("AGM-CHILLI","Chilli (Guntur)","India agri",   "INR/qtl",  "Agmarknet", 18400.0, 0.38, 0.05),
    ("AGM-TURMERIC","Turmeric (Nizamabad)","India agri","INR/qtl","Agmarknet",14250.0, 0.33, 0.08),
    ("AGM-COTTON","Cotton (Adilabad)","India agri", "INR/qtl",  "Agmarknet",  7650.0, 0.19, 0.01),
    ("AGM-ONION","Onion (Kurnool)", "India agri",   "INR/qtl",  "Agmarknet",  2180.0, 0.55, -0.06),
    ("BDI",   "Baltic Dry Index",   "Freight",      "index",    "Baltic Exch · manual",2841.0, 0.48, 0.10),
    ("WCI",   "Drewry WCI 40ft",    "Freight",      "USD/FEU",  "Drewry · manual",4526.0, 0.41, 0.22),
    ("INR=X", "USD/INR",            "Freight",      "INR",      "FX",          87.90, 0.06, 0.02),
]

DAYS = 400


def walk(start, vol, drift, n):
    """Geometric random walk, returned oldest-first."""
    sd = vol / math.sqrt(252)
    mu = drift / 252
    out, p = [], start
    for _ in range(n):
        p *= math.exp(mu - 0.5 * sd * sd + sd * random.gauss(0, 1))
        out.append(p)
    # rescale so the walk ends exactly on `start` — keeps the shape, kills drift
    k = start / out[-1]
    return [round(v * k, 4) for v in out]


today = dt.date(2026, 8, 21)  # last business day
dates = []
d = today
while len(dates) < DAYS:
    if d.weekday() < 5:
        dates.append(d.isoformat())
    d -= dt.timedelta(days=1)
dates.reverse()

NO_ARCHIVE = {"LME-NI", "LME-ZN", "BDI", "WCI",
              "AGM-CHILLI", "AGM-TURMERIC", "AGM-COTTON", "AGM-ONION"}

history, latest = {}, []
for sym, name, group, unit, source, p0, vol, drift in UNIVERSE:
    if sym in NO_ARCHIVE:
        # these are real, hand-sourced values with no price archive behind them.
        # inventing a year of history for them would fabricate the 1M/1Y columns.
        history[sym] = {"dates": [dates[-1]], "close": [p0]}
        latest.append({"symbol": sym, "name": name, "group": group, "unit": unit,
                       "source": source, "price": p0, "date": dates[-1],
                       "stale_days": 0, "history": 1})
        continue
    series = walk(p0, vol, drift, DAYS)
    history[sym] = {"dates": dates, "close": series}
    latest.append({
        "symbol": sym, "name": name, "group": group, "unit": unit,
        "source": source, "price": series[-1], "date": dates[-1],
        "stale_days": 0, "history": len(series),
    })

json.dump({"seed": True, "asof": today.isoformat(), "instruments": latest},
          open("data/latest.json", "w"), indent=1)
json.dump({"seed": True, "asof": today.isoformat(), "series": history},
          open("data/history.json", "w"), indent=1)
print(f"wrote {len(latest)} instruments x {DAYS} sessions")
