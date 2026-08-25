import { useCallback, useEffect, useMemo, useState } from "react";
import { load } from "./api/client";
import type { Basket, Board, Rule, SeriesMap } from "./api/types";
import { allHighlights } from "./lib/highlights";
import type { ExporterInputs, ImporterInputs } from "./lib/ledger";
import { change } from "./lib/stats";
import { fmt, pct, tone } from "./lib/format";
import { exportAll, importAll, persistent, read, write } from "./lib/storage";
import {
  BasketView, BoardView, CompareView, CorrelationView, DetailView, HighlightsView, LedgerView,
} from "./components/Views";

type Tab = "board" | "compare" | "correlation" | "basket" | "ledger" | "highlights";
const TABS: { id: Tab; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "highlights", label: "Highlights" },
  { id: "compare", label: "Compare" },
  { id: "correlation", label: "Correlation" },
  { id: "basket", label: "Basket" },
  { id: "ledger", label: "Ledger" },
];

const DEFAULT_IMP: ImporterInputs = {
  freight: 62, freightPrev: 52, duty: 7.5, port: 18, inland: 24, finance: 2.2,
};
const DEFAULT_EXP: ExporterInputs = {
  postHarvestLoss: 10, grading: 34, toPort: 41, terminal: 15, fxSlippage: -0.8,
};
const DEFAULT_BASKET: Basket = {
  id: "basket-1", name: "My basket",
  legs: [{ symbol: "BZ=F", weight: 40 }, { symbol: "HG=F", weight: 35 }, { symbol: "ZW=F", weight: 25 }],
};

/** Read the tab from the URL hash so views are linkable and the back button works. */
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace("#", "") as Tab;
  return TABS.some((t) => t.id === h) ? h : "board";
};

export default function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [series, setSeries] = useState<SeriesMap>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [selected, setSelected] = useState("BZ=F");

  const [watchlist, setWatchlist] = useState<string[]>(() => read("watchlist", []));
  const [rules, setRules] = useState<Rule[]>(() => read("rules", []));
  const [basket, setBasket] = useState<Basket>(() => read("basket", DEFAULT_BASKET));
  const [imp, setImp] = useState<ImporterInputs>(() => read("imp", DEFAULT_IMP));
  const [exp, setExp] = useState<ExporterInputs>(() => read("exp", DEFAULT_EXP));

  useEffect(() => { write("watchlist", watchlist); }, [watchlist]);
  useEffect(() => { write("rules", rules); }, [rules]);
  useEffect(() => { write("basket", basket); }, [basket]);
  useEffect(() => { write("imp", imp); }, [imp]);
  useEffect(() => { write("exp", exp); }, [exp]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal)
      .then(({ board, series }) => {
        setBoard(board); setSeries(series);
        setSelected((s) => board.instruments.some((i) => i.symbol === s) ? s : board.instruments[0].symbol);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      });
    return () => ac.abort();
  }, []);

  const usdInr = useMemo(
    () => board?.instruments.find((i) => i.symbol === "INR=X")?.price ?? 87.9, [board]);

  const highlights = useMemo(
    () => board ? allHighlights(rules, board, series, imp, usdInr) : [],
    [board, series, rules, imp, usdInr]);

  const flagged = useMemo(
    () => new Set(highlights.filter((h) => h.pinned).map((h) => h.symbol)), [highlights]);

  const toggleWatch = useCallback((s: string) =>
    setWatchlist((w) => w.includes(s) ? w.filter((x) => x !== s) : [...w, s]), []);

  const go = (t: Tab) => { window.location.hash = t; setTab(t); };

  if (error) {
    return (
      <main className="wrap" style={{ paddingTop: 60 }}>
        <h2>The data didn't load</h2>
        <div className="notice bad" style={{ marginTop: 16 }}>
          <b>{error}</b> — the published price files couldn't be read. If you've just
          deployed, the update job may not have run yet. Check the Actions tab.
        </div>
      </main>
    );
  }

  if (!board) {
    return <main className="wrap" style={{ paddingTop: 60 }}><p className="lede">Loading prices…</p></main>;
  }

  const instrument = board.instruments.find((i) => i.symbol === selected) ?? board.instruments[0];
  const pinnedCount = highlights.filter((h) => h.pinned).length;

  return (
    <>
      <div className="tape" aria-hidden="true">
        <div className="tape-run">
          {[0, 1].map((dup) => board.instruments.map((i) => {
            const d = change(series[i.symbol], 1);
            return (
              <span className="tick" key={`${dup}-${i.symbol}`}>
                <b>{i.name}</b>{fmt(i.price)}{" "}
                <span className={tone(d)}>{d == null ? "" : pct(d)}</span>
              </span>
            );
          }))}
        </div>
      </div>

      <header>
        <div className="wrap">
          <div className="brandrow">
            <div>
              <h1>As<span>s</span>ay</h1>
              <p className="tagline">
                Daily prices, volatility bands, correlations, and a landed-cost ledger
                that shows which leg of the chain is taking the margin.
              </p>
            </div>
            <div className="stamp">
              <div>as of {board.asof}</div>
              <div>{board.instruments.length} instruments</div>
              <div className={board.seed ? "" : "live"}>{board.seed ? "sample data" : "live feed"}</div>
            </div>
          </div>
          {board.seed && (
            <div className="notice">
              <b>Sample data.</b> These are simulated prices so the page renders before the
              first fetch. Run the update job with backfill enabled to replace them.
            </div>
          )}
          {!persistent() && (
            <div className="notice">
              <b>Settings won't be saved.</b> Your browser is blocking local storage, so
              watchlist, rules and basket will reset when you reload.
            </div>
          )}
        </div>
      </header>

      <nav>
        <div className="wrap navrow">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id} onClick={() => go(t.id)}>
              {t.label}
              {t.id === "highlights" && pinnedCount > 0 && <span className="badge">{pinnedCount}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="wrap">
        {tab === "board" && (
          <section>
            <p className="eyebrow">01 · The board</p>
            <h2>What things cost today</h2>
            <p className="lede">
              {board.instruments.length} instruments across energy, crypto, metals, global agri
              and Indian mandi prices. Star what you follow; select a row for its chart.
            </p>
            <BoardView board={board} series={series} selected={selected} onSelect={setSelected}
              watchlist={watchlist} onToggleWatch={toggleWatch} flagged={flagged} />
            <DetailView instrument={instrument} series={series} />
          </section>
        )}

        {tab === "highlights" && (
          <section>
            <p className="eyebrow">02 · Highlights</p>
            <h2>What's worth a look</h2>
            <p className="lede">
              Rules you set, plus a few things worth flagging anyway. Everything is evaluated
              in your browser when the page loads — there is no server to push you a notification.
            </p>
            <HighlightsView highlights={highlights} rules={rules} board={board}
              onAdd={(r) => setRules((x) => [...x, r])}
              onRemove={(id) => setRules((x) => x.filter((r) => r.id !== id))} />
          </section>
        )}

        {tab === "compare" && (
          <section>
            <p className="eyebrow">03 · Compare</p>
            <h2>Rebased to 100</h2>
            <p className="lede">
              Different units can't share an axis, so every series is indexed to 100 at the
              start of the window. What you're comparing is relative movement, not price.
            </p>
            <CompareView board={board} series={series} watchlist={watchlist} />
          </section>
        )}

        {tab === "correlation" && (
          <section>
            <p className="eyebrow">04 · Correlation</p>
            <h2>What moves together</h2>
            <p className="lede">
              Daily log returns, matched across sessions both instruments traded.
              Useful for spotting where a basket isn't as diversified as it looks.
            </p>
            <CorrelationView board={board} series={series} />
          </section>
        )}

        {tab === "basket" && (
          <section>
            <p className="eyebrow">05 · Basket</p>
            <h2>Build your own index</h2>
            <p className="lede">
              Weight a few instruments into a single index. Useful for tracking an input
              cost bundle rather than watching six rows separately.
            </p>
            <BasketView board={board} series={series} basket={basket} onChange={setBasket} />
          </section>
        )}

        {tab === "ledger" && (
          <section>
            <p className="eyebrow">06 · Landed-cost ledger</p>
            <h2>Where the money leaks</h2>
            <p className="lede">
              The same tonne of cargo, priced today and twelve months ago. The faded bar is
              last year. Whichever segment grew fastest is where your margin went.
            </p>
            <LedgerView board={board} series={series} inputs={imp} setInputs={setImp}
              expInputs={exp} setExpInputs={setExp} usdInr={usdInr} />
          </section>
        )}
      </main>

      <footer>
        <div className="wrap">
          <div className="chips" style={{ marginBottom: 18 }}>
            <button className="ghost-btn" onClick={() => {
              const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "assay-settings.json";
              a.click();
              URL.revokeObjectURL(a.href);
            }}>Export settings</button>
            <label className="ghost-btn" style={{ cursor: "pointer" }}>
              Import settings
              <input type="file" accept="application/json" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const res = importAll(await f.text());
                if (res.ok) window.location.reload();
                else alert(res.error);
              }} />
            </label>
          </div>
          Built by Sachin G. · specified and modelled by hand, assembled with AI tooling ·
          informational only, not trading advice.
        </div>
      </footer>
    </>
  );
}
