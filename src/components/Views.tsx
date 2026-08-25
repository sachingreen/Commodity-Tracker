import { useMemo, useState } from "react";
import type { Basket, Board, Group, Highlight, Instrument, Rule, SeriesMap } from "../api/types";
import { annualVol, change, correlate, basketIndex, basketRisk, periodOffset, project } from "../lib/stats";
import { CONV, exporterStack, importerStack, leaks, perTonne, total,
  type ExporterInputs, type ImporterInputs } from "../lib/ledger";
import { fmt, heat, pct, tone, uid } from "../lib/format";
import { Cone, History, Overlay, Sparkline } from "./Charts";

/**
 * A monthly IMF benchmark published for 1 July is perfectly current in
 * August — flagging it as 55 days old makes working data look broken. Judge
 * lateness against the cadence the source actually publishes at.
 */
const STALE_AFTER: Record<string, number> = { daily: 4, weekly: 10, monthly: 45 };
const isStale = (i: Instrument) => i.stale_days > (STALE_AFTER[i.freq] ?? 4);

const GROUPS: Group[] = ["Energy", "Crypto", "Base metals", "Precious",
  "Global agri", "India agri", "Freight", "Proxies", "Macro"];

/* ---------------------------------------------------------------- board */

export function BoardView({ board, series, selected, onSelect, watchlist, onToggleWatch, flagged }: {
  board: Board; series: SeriesMap; selected: string;
  onSelect: (s: string) => void;
  watchlist: string[]; onToggleWatch: (s: string) => void;
  flagged: Set<string>;
}) {
  const [group, setGroup] = useState<Group | "All" | "Watchlist">("All");
  const groups = GROUPS.filter((g) => board.instruments.some((i) => i.group === g));

  const visible = (i: Instrument) =>
    group === "All" ? true : group === "Watchlist" ? watchlist.includes(i.symbol) : i.group === group;

  const shown = board.instruments.filter(visible);

  return (
    <>
      <div className="chips">
        {(["All", "Watchlist", ...groups] as const).map((g) => (
          <button key={g} className="chip-btn" aria-pressed={group === g}
            onClick={() => setGroup(g as Group | "All" | "Watchlist")}>
            {g}{g === "Watchlist" && watchlist.length ? ` (${watchlist.length})` : ""}
          </button>
        ))}
      </div>

      {!shown.length && (
        <p className="empty">
          {group === "Watchlist"
            ? "Nothing on your watchlist yet. Tap the star beside any instrument to add it."
            : "No instruments in this group."}
        </p>
      )}

      {!!shown.length && (
        <table className="board">
          <thead>
            <tr>
              <th className="star" aria-label="Watchlist" />
              <th>Instrument</th><th>Last</th><th>1D</th>
              <th className="hide-s">1W</th><th className="hide-s">1M</th>
              <th>1Y</th><th className="hide-s">History</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => {
              const list = shown.filter((i) => i.group === g);
              if (!list.length) return null;
              return (
                <>
                  <tr className="grouphead" key={g}><td colSpan={8}>{g}</td></tr>
                  {list.map((i) => {
                    const s = series[i.symbol];
                    // A monthly series has no one-day change. Reading its
                    // previous observation under a "1D" heading would report
                    // a month's move as a day's.
                    const cells = (["1D", "1W", "1M", "1Y"] as const).map((p) => {
                      const n = periodOffset(i.freq, p);
                      return n == null ? null : change(s, n);
                    });
                    const starred = watchlist.includes(i.symbol);
                    return (
                      <tr key={i.symbol} data-sym={i.symbol} aria-selected={i.symbol === selected}
                        onClick={() => onSelect(i.symbol)} tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter") onSelect(i.symbol); }}>
                        <td className="star">
                          <button className="star-btn" aria-pressed={starred}
                            aria-label={starred ? `Remove ${i.name} from watchlist` : `Add ${i.name} to watchlist`}
                            onClick={(e) => { e.stopPropagation(); onToggleWatch(i.symbol); }}>
                            {starred ? "★" : "☆"}
                          </button>
                        </td>
                        <td>
                          <span className="nm">
                            {i.name}
                            {flagged.has(i.symbol) && <i className="dot" title="A highlight rule fired" />}
                          </span>
                          <span className="src">
                            {i.source}
                            {i.freq !== "daily" && ` · ${i.freq}`}
                            {isStale(i) && <span className="stale"> · {i.stale_days}d old</span>}
                          </span>
                        </td>
                        <td className="num">{fmt(i.price)}</td>
                        <td className={`num ${tone(cells[0])}`}>{pct(cells[0])}</td>
                        <td className={`num hide-s ${tone(cells[1])}`}>{pct(cells[1])}</td>
                        <td className={`num hide-s ${tone(cells[2])}`}>{pct(cells[2])}</td>
                        <td className={`num ${tone(cells[3])}`}>{pct(cells[3])}</td>
                        <td className="hide-s">
                          {i.history > 1
                            ? <Sparkline series={s} up={(cells[3] ?? cells[2] ?? 0) >= 0} />
                            : <span className="src">no archive</span>}
                        </td>
                      </tr>
                    );
                  })}
                </>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/* --------------------------------------------------------------- detail */

export function DetailView({ instrument, series }: { instrument: Instrument; series: SeriesMap }) {
  const s = series[instrument.symbol];
  const daily = instrument.freq === "daily";
  const bands = daily ? project(instrument.price, s, 30) : [];
  const at = (n: number) => bands[n - 1];
  const window = (s?.close ?? []).slice(-(daily ? 252 : 12));

  return (
    <div className="panel" style={{ marginTop: 26 }}>
      <div className="dhead">
        <div>
          <h3>{instrument.name}</h3>
          <span className="src">
            {instrument.symbol} · {instrument.source} · close of {instrument.date}
          </span>
        </div>
        <div>
          <span className="dprice num">{fmt(instrument.price)}</span>
          <span className="dunit">{instrument.unit}</span>
        </div>
      </div>
      {daily ? (
        <div className="chartbox"><Cone series={s} spot={instrument.price} /></div>
      ) : (
        <>
          <div className="chartbox"><History series={s} /></div>
          <p className="hint" style={{ padding: "0 20px 16px" }}>
            This benchmark is published {instrument.freq}, so there is no
            forward band. A volatility cone built from {instrument.freq}{" "}
            observations would look like the daily ones and mean something
            entirely different.
          </p>
        </>
      )}
      <dl className="dfoot">
        <div className="stat"><dt>Ann. volatility</dt>
          <dd>{daily && instrument.history > 5 ? `${annualVol(s).toFixed(1)}%` : "—"}</dd></div>
        <div className="stat"><dt>7-session range</dt>
          <dd>{at(7) ? `${fmt(at(7).lo1)} – ${fmt(at(7).hi1)}` : "—"}</dd></div>
        <div className="stat"><dt>30-session range</dt>
          <dd>{at(30) ? `${fmt(at(30).lo1)} – ${fmt(at(30).hi1)}` : "—"}</dd></div>
        <div className="stat"><dt>{daily ? "52w high / low" : "12m high / low"}</dt>
          <dd>{window.length > 1 ? `${fmt(Math.max(...window))} / ${fmt(Math.min(...window))}` : "—"}</dd></div>
      </dl>
    </div>
  );
}

/* ----------------------------------------------------------- highlights */

export function HighlightsView({ highlights, rules, board, onAdd, onRemove }: {
  highlights: Highlight[]; rules: Rule[]; board: Board;
  onAdd: (r: Rule) => void; onRemove: (id: string) => void;
}) {
  const [kind, setKind] = useState<Rule["kind"]>("threshold");
  const [symbol, setSymbol] = useState(board.instruments[0]?.symbol ?? "");
  const [value, setValue] = useState(100);
  const [sessions, setSessions] = useState(5);
  const [direction, setDirection] = useState<"above" | "below">("above");

  const cargo = board.instruments.filter((i) => CONV[i.symbol]);
  const options = kind === "freightShare" ? cargo : board.instruments;

  const submit = () => {
    const sym = options.some((o) => o.symbol === symbol) ? symbol : options[0]?.symbol;
    if (!sym) return;
    if (kind === "threshold") onAdd({ id: uid(), kind, symbol: sym, direction, value });
    if (kind === "move") onAdd({ id: uid(), kind, symbol: sym, percent: value, sessions });
    if (kind === "freightShare") onAdd({ id: uid(), kind, symbol: sym, percent: value });
  };

  const label = (r: Rule) => {
    const nm = board.instruments.find((i) => i.symbol === r.symbol)?.name ?? r.symbol;
    if (r.kind === "threshold") return `${nm} ${r.direction} ${fmt(r.value)}`;
    if (r.kind === "move") return `${nm} moves ${r.percent}% in ${r.sessions} sessions`;
    return `Freight tops ${r.percent}% of landed cost on ${nm}`;
  };

  return (
    <div className="ledger">
      <div>
        {highlights.length ? (
          <div className="hl">
            {highlights.map((h) => (
              <div key={h.id} className={`hl-item ${h.tone}`}>
                <span className="tag">{h.pinned ? "your rule" : "automatic"}</span>
                <h4>{h.headline}</h4>
                <p>{h.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">Nothing notable right now. Add a rule and it will appear here when it fires.</p>
        )}
      </div>

      <div className="controls">
        <h3>Rules</h3>
        <div className="fld">
          <label htmlFor="rk">Trigger on</label>
          <select id="rk" value={kind} onChange={(e) => setKind(e.target.value as Rule["kind"])}>
            <option value="threshold">Price crosses a level</option>
            <option value="move">Percentage move</option>
            <option value="freightShare">Freight share of landed cost</option>
          </select>
        </div>
        <div className="fld">
          <label htmlFor="rs">Instrument</label>
          <select id="rs" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {options.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
          </select>
        </div>
        {kind === "threshold" && (
          <div className="fld">
            <label htmlFor="rd">Direction</label>
            <select id="rd" value={direction} onChange={(e) => setDirection(e.target.value as "above" | "below")}>
              <option value="above">Above</option><option value="below">Below</option>
            </select>
          </div>
        )}
        <div className="fld">
          <label htmlFor="rv">{kind === "threshold" ? "Level" : "Percent"}</label>
          <input id="rv" type="number" value={value} step="0.5"
            onChange={(e) => setValue(Number(e.target.value))} />
        </div>
        {kind === "move" && (
          <div className="fld">
            <label htmlFor="rn">Over sessions</label>
            <input id="rn" type="number" value={sessions} min={1} max={252}
              onChange={(e) => setSessions(Number(e.target.value))} />
          </div>
        )}
        <button className="solid-btn" onClick={submit}>Add rule</button>

        {!!rules.length && (
          <div style={{ marginTop: 18 }}>
            {rules.map((r) => (
              <div className="rule-row" key={r.id}>
                <span className="grow">{label(r)}</span>
                <button className="ghost-btn" onClick={() => onRemove(r.id)}
                  aria-label={`Remove rule: ${label(r)}`}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <p className="hint">
          Rules run in your browser against the published data. Nothing is sent anywhere,
          and nothing reaches you when the tab is closed.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- correlation */

export function CorrelationView({ board, series }: { board: Board; series: SeriesMap }) {
  const [sessions, setSessions] = useState(90);
  // Mixing monthly and daily returns in one matrix produces a number with no
  // meaning — the two are not observations of the same thing.
  const eligible = board.instruments.filter(
    (i) => i.freq === "daily" && (series[i.symbol]?.close.length ?? 0) > 10);
  const symbols = eligible.map((i) => i.symbol);
  const matrix = useMemo(() => correlate(symbols, series, sessions), [symbols.join(), series, sessions]);
  const excluded = board.instruments.length - eligible.length;

  if (eligible.length < 2) {
    return <p className="empty">Correlations need at least two instruments with price history.</p>;
  }

  return (
    <>
      <div className="chips">
        {[30, 90, 180, 252].map((n) => (
          <button key={n} className="chip-btn" aria-pressed={sessions === n} onClick={() => setSessions(n)}>
            {n} sessions
          </button>
        ))}
      </div>
      <div className="corr-scroll">
        <table className="corr">
          <thead>
            <tr>
              <th className="rowhead" />
              {eligible.map((i) => <th key={i.symbol}>{i.symbol.replace(/=F$|-USD$|^AGM-/, "")}</th>)}
            </tr>
          </thead>
          <tbody>
            {eligible.map((row, r) => (
              <tr key={row.symbol}>
                <th className="rowhead">{row.name}</th>
                {eligible.map((col, c) => {
                  const v = matrix[r][c];
                  return (
                    <td key={col.symbol} className={v == null ? "na" : ""}
                      style={{ background: heat(v) }}
                      title={`${row.name} vs ${col.name}: ${v == null ? "not enough overlapping sessions" : v.toFixed(2)}`}>
                      {v == null ? "·" : v.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>
        Pearson correlation of daily log returns, computed only across sessions both
        instruments actually traded. A blank cell means too few overlapping sessions to
        say anything — not a correlation of zero.
        {excluded > 0 && ` ${excluded} instrument${excluded > 1 ? "s are" : " is"} absent \u2014 either monthly benchmarks, or too new to have an archive.`}
      </p>
    </>
  );
}

/* --------------------------------------------------------------- basket */

export function BasketView({ board, series, basket, onChange }: {
  board: Board; series: SeriesMap; basket: Basket; onChange: (b: Basket) => void;
}) {
  const [sessions, setSessions] = useState(180);
  const eligible = board.instruments.filter((i) => (series[i.symbol]?.close.length ?? 0) > 1);
  const result = basketIndex(basket.legs, series, sessions);
  const nameOf = (s: string) => board.instruments.find((i) => i.symbol === s)?.name ?? s;
  const freqOf = Object.fromEntries(board.instruments.map((i) => [i.symbol, i.freq]));
  const risk = basketRisk(basket.legs, series, freqOf, sessions);

  const setLeg = (idx: number, patch: Partial<{ symbol: string; weight: number }>) =>
    onChange({ ...basket, legs: basket.legs.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });

  const addLeg = () => {
    const unused = eligible.find((i) => !basket.legs.some((l) => l.symbol === i.symbol));
    if (unused) onChange({ ...basket, legs: [...basket.legs, { symbol: unused.symbol, weight: 10 }] });
  };

  const totalWeight = basket.legs.reduce((a, l) => a + l.weight, 0);
  const change = result.values.length > 1
    ? result.values[result.values.length - 1] - 100 : null;

  return (
    <div className="basket-grid">
      <div>
        {result.values.length > 1 ? (
          <>
            <div className="panel" style={{ padding: "14px 6px 4px" }}>
              <Overlay symbols={[basket.id]} names={{ [basket.id]: basket.name }}
                seriesMap={{ [basket.id]: { dates: result.dates, close: result.values } }}
                sessions={sessions} />
            </div>
            <div className="cards" style={{ marginTop: 16 }}>
              <div className="card">
                <div className="k">Index level</div>
                <div className="v">{fmt(result.values[result.values.length - 1], 1)}</div>
                <div className={`d ${tone(change)}`}>{pct(change)} over the window</div>
              </div>
              <div className="card">
                <div className="k">Sessions matched</div>
                <div className="v">{result.dates.length}</div>
                <div className="d flat">common to every leg</div>
              </div>
              {risk && (
                <>
                  <div className="card">
                    <div className="k">Basket volatility</div>
                    <div className="v">{risk.volatility.toFixed(1)}%</div>
                    <div className="d flat">annualised, {risk.sessions} sessions</div>
                  </div>
                  <div className="card">
                    <div className="k">Diversification</div>
                    <div className="v">{risk.diversification.toFixed(2)}×</div>
                    <div className="d flat">
                      vs {risk.weightedLegVol.toFixed(1)}% undiversified
                    </div>
                  </div>
                </>
              )}
            </div>

            {risk && (
              <div className="stackwrap" style={{ marginTop: 16 }}>
                <div className="stacklabel">
                  <span>Share of basket variance</span>
                  <em>{risk.contributions.length} legs</em>
                </div>
                <div className="legend" style={{ marginTop: 0, borderTop: "none" }}>
                  {[...risk.contributions].sort((a, b) => b.percent - a.percent).map((c) => (
                    <div className="lrow" key={c.symbol}>
                      <span className="swatch" style={{
                        background: c.percent > c.weight ? "var(--loss)" : "var(--gain)" }} />
                      <span>{nameOf(c.symbol)}<br />
                        <span className="src">
                          {c.weight.toFixed(0)}% of the money ·{" "}
                          {c.percent > c.weight ? "carrying more risk than its weight"
                            : "carrying less risk than its weight"}
                        </span>
                      </span>
                      <span className="num">{c.percent.toFixed(1)}%</span>
                      <span className="num delta flat">
                        {c.percent - c.weight >= 0 ? "+" : ""}{(c.percent - c.weight).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="hint">
                  Variance contributions are wᵢ·(Σw)ᵢ and sum to 100%. A leg can carry
                  far more risk than its weight suggests — that is what this is for.
                  {!!risk.skipped.length && ` Left out of the risk figures: ${
                    risk.skipped.map((k) => `${nameOf(k.symbol)} (${k.reason})`).join(", ")}.`}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="empty">
            Add two or more legs with price history to build an index.
          </p>
        )}
        {!!result.skipped.length && (
          <div className="notice" style={{ marginTop: 16 }}>
            <b>Left out:</b> {result.skipped.map(nameOf).join(", ")} — no price archive to index yet.
          </div>
        )}
      </div>

      <div className="controls">
        <h3>Basket</h3>
        <div className="fld">
          <label htmlFor="bn">Name</label>
          <input id="bn" type="text" value={basket.name} style={{ width: "100%" }}
            onChange={(e) => onChange({ ...basket, name: e.target.value })} />
        </div>
        {basket.legs.map((l, i) => (
          <div className="leg-row" key={i}>
            <select value={l.symbol} onChange={(e) => setLeg(i, { symbol: e.target.value })}>
              {eligible.map((x) => <option key={x.symbol} value={x.symbol}>{x.name}</option>)}
            </select>
            <input type="number" value={l.weight} min={0} step={5}
              aria-label={`Weight for ${nameOf(l.symbol)}`}
              onChange={(e) => setLeg(i, { weight: Number(e.target.value) })} />
            <button className="ghost-btn" style={{ padding: "6px 8px" }}
              aria-label={`Remove ${nameOf(l.symbol)}`}
              onClick={() => onChange({ ...basket, legs: basket.legs.filter((_, j) => j !== i) })}>×</button>
          </div>
        ))}
        <button className="ghost-btn" onClick={addLeg} style={{ marginTop: 6 }}>Add leg</button>
        <div className="fld" style={{ marginTop: 18 }}>
          <label htmlFor="bw">Window <b>{sessions} sessions</b></label>
          <input id="bw" type="range" min={30} max={400} step={10} value={sessions}
            onChange={(e) => setSessions(Number(e.target.value))} />
        </div>
        <p className="hint">
          Weights are normalised, so they need not sum to 100 — yours currently total{" "}
          {fmt(totalWeight, 0)}. The index uses only dates every leg traded.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- ledger */

export function LedgerView({ board, series, inputs, setInputs, expInputs, setExpInputs, usdInr }: {
  board: Board; series: SeriesMap;
  inputs: ImporterInputs; setInputs: (i: ImporterInputs) => void;
  expInputs: ExporterInputs; setExpInputs: (e: ExporterInputs) => void;
  usdInr: number;
}) {
  const [view, setView] = useState<"imp" | "exp">("imp");
  const cargo = board.instruments.filter((i) =>
    CONV[i.symbol] && (view === "imp" || i.group === "Global agri" || i.group === "India agri"));
  const [symbol, setSymbol] = useState(cargo[0]?.symbol ?? "");
  const active = cargo.some((c) => c.symbol === symbol) ? symbol : cargo[0]?.symbol ?? "";

  const now = perTonne(active, series, 0, usdInr);
  const then = perTonne(active, series, 252, usdInr);
  const noHistory = then == null;

  if (now == null) return <p className="empty">Pick a cargo priced per tonne.</p>;

  const segsNow = view === "imp" ? importerStack(now, inputs.freight, inputs) : exporterStack(now, expInputs);
  const segsPrev = noHistory ? null
    : view === "imp" ? importerStack(then!, inputs.freightPrev, inputs) : exporterStack(then!, expInputs);
  const tN = total(segsNow), tP = segsPrev ? total(segsPrev) : tN;
  const scale = Math.max(tN, tP);
  const leakRows = leaks(segsNow, segsPrev);
  const name = board.instruments.find((i) => i.symbol === active)?.name ?? active;

  const bar = (segs: typeof segsNow, t: number, labels: boolean) => segs.map((s) => {
    const w = (s.value / scale) * 100;
    return (
      <div className="seg" key={s.key} style={{ width: `${w.toFixed(2)}%`, background: s.colour }}
        title={`${s.label}: $${fmt(s.value)}/t`}>
        {labels && w > 7 && <span>{((s.value / t) * 100).toFixed(0)}%</span>}
      </div>
    );
  });

  const worst = leakRows ? [...leakRows].sort((a, b) => b.delta - a.delta)[0] : null;
  const totalDelta = tN - tP;

  return (
    <>
      <div className="toggle" role="group" aria-label="Ledger view">
        <button aria-pressed={view === "imp"} onClick={() => setView("imp")}>Importer · landed cost</button>
        <button aria-pressed={view === "exp"} onClick={() => setView("exp")}>Exporter · FOB margin</button>
      </div>

      <div className="ledger">
        <div>
          <div className="stackwrap">
            <div className="stacklabel"><span>Today</span><em>${fmt(tN, 0)}/t</em></div>
            <div className="stack">{bar(segsNow, tN, true)}</div>
            {segsPrev && (
              <>
                <div className="stacklabel"><span>12 months ago</span><em>${fmt(tP, 0)}/t</em></div>
                <div className="stack ghost">{bar(segsPrev, tP, false)}</div>
              </>
            )}
            <div className="legend">
              {segsNow.map((s, i) => {
                const l = leakRows?.[i];
                return (
                  <div className="lrow" key={s.key}>
                    <span className="swatch" style={{ background: s.colour }} />
                    <span>{s.label}<br />
                      <span className="src">
                        {((s.value / tN) * 100).toFixed(1)}% of stack
                        {l && ` · ${l.shareShiftBps >= 0 ? "+" : ""}${l.shareShiftBps.toFixed(0)} bps vs LY`}
                      </span>
                    </span>
                    <span className="num">${fmt(s.value)}</span>
                    <span className={`num delta ${l ? tone(l.growth) : "flat"}`}>
                      {l ? pct(l.growth) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="leak">
            {noHistory ? (
              <>
                <h3>No 12-month history for {name} yet</h3>
                <p>This row has no free price archive, so its history only builds from the
                  first scheduled run onward. Today's stack is shown on its own rather than
                  against an invented comparison.</p>
              </>
            ) : (
              <>
                <h3>{name} costs ${fmt(Math.abs(totalDelta), 0)}/t {totalDelta >= 0 ? "more" : "less"} than a year ago</h3>
                <p>{Math.abs(totalDelta) < 0.5 ? "The stack is flat year on year. Nothing is leaking." : (
                  <><b>{worst!.label}</b> is the largest single increase at {pct(worst!.growth)},
                    adding ${fmt(worst!.delta, 0)}/t
                    {totalDelta > 0 ? ` — ${((worst!.delta / totalDelta) * 100).toFixed(0)}% of the total rise` : " against a falling total"}.</>
                )}</p>
              </>
            )}
          </div>
        </div>

        <div className="controls">
          <h3>Assumptions</h3>
          <div className="fld">
            <label htmlFor="cargo">Cargo</label>
            <select id="cargo" value={active} onChange={(e) => setSymbol(e.target.value)}>
              {cargo.map((i) => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
            </select>
            <p className="hint" style={{ marginTop: 7 }}>
              {view === "imp" ? "Any cargo priced per tonne."
                : "Crops only — loss and farmgate terms don't apply to metals or energy."}
            </p>
          </div>

          {view === "imp" ? (
            <>
              <Slider id="frt" label="Ocean freight" suffix="/t" prefix="$" min={5} max={220}
                value={inputs.freight} onChange={(v) => setInputs({ ...inputs, freight: v })} />
              <Slider id="frtp" label="Ocean freight, 12m ago" suffix="/t" prefix="$" min={5} max={220}
                value={inputs.freightPrev} onChange={(v) => setInputs({ ...inputs, freightPrev: v })} />
              <Slider id="duty" label="Customs duty" suffix="%" min={0} max={40} step={0.5}
                value={inputs.duty} onChange={(v) => setInputs({ ...inputs, duty: v })} />
              <Slider id="port" label="Port & CFS" suffix="/t" prefix="$" min={0} max={90}
                value={inputs.port} onChange={(v) => setInputs({ ...inputs, port: v })} />
              <Slider id="inl" label="Inland haul" suffix="/t" prefix="$" min={0} max={120}
                value={inputs.inland} onChange={(v) => setInputs({ ...inputs, inland: v })} />
              <Slider id="fin" label="Finance, 90d" suffix="%" min={0} max={12} step={0.1}
                value={inputs.finance} onChange={(v) => setInputs({ ...inputs, finance: v })} />
            </>
          ) : (
            <>
              <Slider id="phl" label="Post-harvest loss" suffix="%" min={0} max={35} step={0.5}
                value={expInputs.postHarvestLoss} onChange={(v) => setExpInputs({ ...expInputs, postHarvestLoss: v })} />
              <Slider id="grd" label="Grading & packing" suffix="/t" prefix="$" min={0} max={150}
                value={expInputs.grading} onChange={(v) => setExpInputs({ ...expInputs, grading: v })} />
              <Slider id="tpt" label="Farm to port" suffix="/t" prefix="$" min={0} max={150}
                value={expInputs.toPort} onChange={(v) => setExpInputs({ ...expInputs, toPort: v })} />
              <Slider id="trm" label="Terminal & docs" suffix="/t" prefix="$" min={0} max={90}
                value={expInputs.terminal} onChange={(v) => setExpInputs({ ...expInputs, terminal: v })} />
              <Slider id="fx" label="Realised FX vs mid" suffix="%" min={-5} max={2} step={0.1}
                value={expInputs.fxSlippage} onChange={(v) => setExpInputs({ ...expInputs, fxSlippage: v })} />
            </>
          )}
          <p className="hint">
            Freight is your input, not a feed. It starts from the container index but an
            eight-lane composite is not your contracted rate — replace it with yours.
          </p>
        </div>
      </div>
    </>
  );
}

function Slider({ id, label, value, onChange, min, max, step = 1, prefix = "", suffix = "" }: {
  id: string; label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; prefix?: string; suffix?: string;
}) {
  return (
    <div className="fld">
      <label htmlFor={id}>{label} <b>{prefix}{value}{suffix}</b></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/* -------------------------------------------------------------- compare */

export function CompareView({ board, series, watchlist }: {
  board: Board; series: SeriesMap; watchlist: string[];
}) {
  const eligible = board.instruments.filter((i) => (series[i.symbol]?.close.length ?? 0) > 1);
  const [picked, setPicked] = useState<string[]>(() => {
    const start = watchlist.filter((s) => eligible.some((e) => e.symbol === s));
    return start.length >= 2 ? start.slice(0, 6) : eligible.slice(0, 3).map((i) => i.symbol);
  });
  const [sessions, setSessions] = useState(180);
  const names = Object.fromEntries(board.instruments.map((i) => [i.symbol, i.name]));

  const toggle = (s: string) =>
    setPicked((p) => p.includes(s) ? p.filter((x) => x !== s) : p.length < 8 ? [...p, s] : p);

  return (
    <>
      <div className="chips">
        {[60, 180, 400].map((n) => (
          <button key={n} className="chip-btn" aria-pressed={sessions === n} onClick={() => setSessions(n)}>
            {n} sessions
          </button>
        ))}
      </div>
      <div className="panel" style={{ padding: "14px 6px 16px" }}>
        <Overlay symbols={picked} names={names} seriesMap={series} sessions={sessions} />
      </div>
      <p className="lede" style={{ marginTop: 22 }}>Choose up to eight instruments.</p>
      <div className="chips">
        {eligible.map((i) => (
          <button key={i.symbol} className="chip-btn" aria-pressed={picked.includes(i.symbol)}
            onClick={() => toggle(i.symbol)}>{i.name}</button>
        ))}
      </div>
    </>
  );
}
