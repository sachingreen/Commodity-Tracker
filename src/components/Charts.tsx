import type { Series } from "../api/types";
import { project, rebase } from "../lib/stats";
import { fmt } from "../lib/format";

export function Sparkline({ series }: { series?: Series }) {
  const c = series?.close ?? [];
  if (c.length < 2) return <span className="src">—</span>;
  const lo = Math.min(...c), hi = Math.max(...c), r = hi - lo || 1;
  const W = 104, H = 26;
  const pts = c.map((v, i) => `${(i / (c.length - 1) * W).toFixed(1)},${(H - ((v - lo) / r) * H).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: "block" }}>
      <polyline points={pts} fill="none" strokeWidth="1.4" strokeLinejoin="round"
        stroke={c[c.length - 1] >= c[0] ? "var(--gain)" : "var(--loss)"} />
    </svg>
  );
}

/** Price history with the forward volatility cone attached at today's close. */
export function Cone({ series, spot, sessions = 30 }: { series?: Series; spot: number; sessions?: number }) {
  const hist = (series?.close ?? []).slice(-180);
  if (hist.length < 10) {
    return <p className="hint" style={{ padding: "30px 20px", textAlign: "center" }}>
      Not enough history to draw a chart yet. This instrument builds its archive from each scheduled run.
    </p>;
  }
  const bands = project(spot, series, sessions);
  const W = 900, H = 300, L = 56, R = 14, T = 14, B = 26;
  const all = [...hist, ...bands.map((b) => b.hi2), ...bands.map((b) => b.lo2)];
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const n = hist.length + sessions;
  const X = (k: number) => L + (k / (n - 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const anchor = hist.length - 1;

  const line = (vals: number[], off: number) =>
    vals.map((v, k) => `${k ? "L" : "M"}${X(k + off).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const fromSpot = (vals: number[]) =>
    `M${X(anchor).toFixed(1)} ${Y(spot).toFixed(1)}` +
    vals.map((v, k) => `L${X(anchor + 1 + k).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
  const band = (up: number[], dn: number[]) =>
    fromSpot(up) + dn.map((_, k) => {
      const i = dn.length - 1 - k;
      return `L${X(anchor + 1 + i).toFixed(1)} ${Y(dn[i]).toFixed(1)}`;
    }).join("") + "Z";

  const grid = Array.from({ length: 5 }, (_, k) => lo + (hi - lo) * k / 4);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label="Price history with a projected volatility band">
      {grid.map((v, i) => (
        <g key={i}>
          <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={L - 8} y={Y(v) + 4} textAnchor="end" fill="var(--dim)"
            fontFamily="var(--mono)" fontSize="11">{fmt(v)}</text>
        </g>
      ))}
      <path d={band(bands.map((b) => b.hi2), bands.map((b) => b.lo2))} fill="rgba(233,161,59,.13)" />
      <path d={band(bands.map((b) => b.hi1), bands.map((b) => b.lo1))} fill="rgba(233,161,59,.26)" />
      <path d={fromSpot(bands.map((b) => b.mid))} fill="none" stroke="var(--amber)"
        strokeWidth="1.4" strokeDasharray="4 4" />
      <path d={line(hist, 0)} fill="none" stroke="var(--ink)" strokeWidth="1.6"
        strokeLinejoin="round" strokeLinecap="round" />
      <line x1={X(anchor)} y1={T} x2={X(anchor)} y2={H - B} stroke="var(--muted)"
        strokeWidth="1" strokeDasharray="2 3" />
      <text x={X(anchor) + 7} y={T + 13} fill="var(--muted)" fontFamily="var(--mono)"
        fontSize="10.5" letterSpacing="1">TODAY</text>
      <text x={L} y={H - 7} fill="var(--dim)" fontFamily="var(--mono)" fontSize="10.5">
        {hist.length} sessions back
      </text>
      <text x={W - R} y={H - 7} textAnchor="end" fill="var(--dim)" fontFamily="var(--mono)" fontSize="10.5">
        +{sessions} projected
      </text>
    </svg>
  );
}

const LINE_COLOURS = ["var(--amber)", "var(--gain)", "var(--slate)", "var(--violet)",
  "var(--clay)", "var(--steel)", "var(--loss)", "var(--ink)"];

/** Several instruments rebased to 100 so different units can share an axis. */
export function Overlay({ symbols, names, seriesMap, sessions }: {
  symbols: string[];
  names: Record<string, string>;
  seriesMap: Record<string, Series | undefined>;
  sessions: number;
}) {
  const lines = symbols
    .map((s, i) => ({ symbol: s, colour: LINE_COLOURS[i % LINE_COLOURS.length], ...rebase(seriesMap[s], sessions) }))
    .filter((l) => l.values.length > 1);

  if (!lines.length) {
    return <p className="empty">Pick two or more instruments with price history to compare them.</p>;
  }

  const W = 900, H = 320, L = 46, R = 12, T = 14, B = 40;
  const vals = lines.flatMap((l) => l.values);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const maxLen = Math.max(...lines.map((l) => l.values.length));
  const X = (k: number, len: number) => L + (k / Math.max(len - 1, 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const grid = Array.from({ length: 5 }, (_, k) => lo + (hi - lo) * k / 4);

  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Instruments rebased to 100 at the start of the window">
        {grid.map((v, i) => (
          <g key={i}>
            <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)}
              stroke={Math.abs(v - 100) < (hi - lo) / 40 ? "var(--muted)" : "var(--line)"} strokeWidth="1" />
            <text x={L - 8} y={Y(v) + 4} textAnchor="end" fill="var(--dim)"
              fontFamily="var(--mono)" fontSize="11">{v.toFixed(0)}</text>
          </g>
        ))}
        {lines.map((l) => (
          <path key={l.symbol} fill="none" stroke={l.colour} strokeWidth="1.7" strokeLinejoin="round"
            d={l.values.map((v, k) => `${k ? "L" : "M"}${X(k, l.values.length).toFixed(1)} ${Y(v).toFixed(1)}`).join("")} />
        ))}
        <text x={L} y={H - 8} fill="var(--dim)" fontFamily="var(--mono)" fontSize="10.5">
          {maxLen} sessions, rebased to 100
        </text>
      </svg>
      <div className="chips" style={{ marginTop: 12 }}>
        {lines.map((l) => (
          <span key={l.symbol} className="src" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <i style={{ width: 12, height: 3, background: l.colour, display: "inline-block" }} />
            {names[l.symbol] ?? l.symbol}
            <b className="num" style={{ color: "var(--muted)", fontWeight: 500 }}>
              {(l.values[l.values.length - 1] - 100).toFixed(1)}%
            </b>
          </span>
        ))}
      </div>
    </>
  );
}

/** Plain price history, for benchmarks published too infrequently to project. */
export function History({ series }: { series?: Series }) {
  const c = series?.close ?? [];
  if (c.length < 2) {
    return <p className="hint" style={{ padding: "30px 20px", textAlign: "center" }}>
      Not enough history to draw a chart yet.
    </p>;
  }
  const W = 900, H = 260, L = 56, R = 14, T = 14, B = 26;
  let lo = Math.min(...c), hi = Math.max(...c);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const X = (k: number) => L + (k / (c.length - 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const grid = Array.from({ length: 5 }, (_, k) => lo + (hi - lo) * k / 4);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price history">
      {grid.map((v, i) => (
        <g key={i}>
          <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={L - 8} y={Y(v) + 4} textAnchor="end" fill="var(--dim)"
            fontFamily="var(--mono)" fontSize="11">{fmt(v)}</text>
        </g>
      ))}
      <path d={c.map((v, k) => `${k ? "L" : "M"}${X(k).toFixed(1)} ${Y(v).toFixed(1)}`).join("")}
        fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <text x={L} y={H - 7} fill="var(--dim)" fontFamily="var(--mono)" fontSize="10.5">
        {c.length} observations
      </text>
    </svg>
  );
}
