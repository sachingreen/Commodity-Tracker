"""Publish data/ as a versioned static API under public/api/v1/.

Vite copies public/ into the build verbatim, so these land at
/api/v1/board.json and /api/v1/series.json on the deployed site. They are
ordinary cacheable GETs served by GitHub's CDN — there is no server.

Keeping this as a separate step means the shape the app consumes is decided
here, not smeared through the fetcher. If the API needs to change, it changes
in one file and the version in the path goes up.
"""
import json, os, sys, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "public", "api", "v1")

# Sessions retained in the published series. Two years is enough for a 252-day
# change and a 400-session chart, and keeps the payload small enough to fetch
# on a phone.
KEEP = 520


def sig(x, n=6):
    """Round to n significant figures — full precision costs payload for nothing."""
    if not x:
        return 0
    from math import floor, log10
    return round(x, -int(floor(log10(abs(x)))) + (n - 1))


def main():
    latest = json.load(open(os.path.join(DATA, "latest.json")))
    history = json.load(open(os.path.join(DATA, "history.json")))
    os.makedirs(OUT, exist_ok=True)

    board = {
        "seed": latest.get("seed", False),
        "asof": latest.get("asof", dt.date.today().isoformat()),
        "instruments": [
            {
                "symbol": i["symbol"], "name": i["name"], "group": i["group"],
                "unit": i["unit"], "source": i["source"],
                "price": sig(i["price"]),
                "date": i.get("date", latest.get("asof")),
                "stale_days": i.get("stale_days", 0),
                "history": i.get("history",
                                 len(history["series"].get(i["symbol"], {}).get("close", []))),
            }
            for i in latest["instruments"]
        ],
    }

    series = {
        sym: {"dates": s["dates"][-KEEP:], "close": [sig(v) for v in s["close"][-KEEP:]]}
        for sym, s in history["series"].items()
        # don't publish a series for something no longer on the board
        if any(i["symbol"] == sym for i in latest["instruments"])
    }

    for name, payload in (("board.json", board),
                          ("series.json", {"asof": board["asof"], "series": series})):
        path = os.path.join(OUT, name)
        with open(path, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        print(f"  {name:14} {os.path.getsize(path) / 1024:>7.1f} KB")

    thin = [i["symbol"] for i in board["instruments"] if i["history"] <= 1]
    print(f"\npublished {len(board['instruments'])} instruments, "
          f"{len(series)} series, as of {board['asof']}")
    if board["seed"]:
        print("NOTE: still serving simulated prices — run fetch_prices.py --backfill")
    if thin:
        print(f"no archive yet ({len(thin)}): {', '.join(thin)}")

    if not board["instruments"]:
        print("Refusing to publish an empty board.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
