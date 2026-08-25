import type { Board, SeriesMap } from "../api/types";
import { change } from "../lib/stats";
import { pct, tone } from "../lib/format";

/**
 * How the world's equity markets did today, at a glance.
 *
 * Country names rather than index names on purpose: most people know whether
 * they care about India or Japan, and far fewer know what the FTSE or the KOSPI
 * covers. The index behind each is named underneath so the claim is checkable.
 *
 * Renders nothing when no market row has data — an empty strip of dashes is
 * worse than no strip.
 */
export function MarketsStrip({ board, series }: { board: Board; series: SeriesMap }) {
  const rows = board.instruments
    .filter((i) => i.group === "Markets")
    .map((i) => ({ i, d: change(series[i.symbol], 1) }))
    .filter((r) => r.d != null);

  if (!rows.length) return null;

  const up = rows.filter((r) => r.d! > 0).length;
  const asOf = rows[0].i.date;

  return (
    <div style={{ marginBottom: 26 }}>
      <div className="stacklabel" style={{ marginBottom: 10 }}>
        <span>World markets · close of {asOf}</span>
        <em>{up} of {rows.length} higher</em>
      </div>
      <div className="cards">
        {rows.map(({ i, d }) => (
          <div className="card" key={i.symbol}>
            <div className="k">{i.name}</div>
            <div className={`v ${tone(d)}`}>{pct(d)}</div>
            <div className="d flat">{i.source}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
