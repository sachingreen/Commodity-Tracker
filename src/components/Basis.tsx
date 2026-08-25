import type { Board } from "../api/types";
import { basis } from "../lib/stats";
import { fmt, tone } from "../lib/format";

/**
 * Crops where the board carries both an Indian mandi price and a world
 * benchmark. `toTonne` converts the world quote to USD per tonne — 1 where
 * FRED already publishes per tonne, 22.0462 for the softs quoted in US cents
 * per pound.
 */
const PAIRS: { crop: string; india: string; world: string; toTonne: number }[] = [
  { crop: "Wheat", india: "AGM-WHEAT", world: "WHEAT", toTonne: 1 },
  { crop: "Soybean", india: "AGM-SOYBEAN", world: "SOY", toTonne: 1 },
  { crop: "Rice", india: "AGM-PADDY", world: "RICE", toTonne: 1 },
  { crop: "Maize", india: "AGM-CORN", world: "CORN", toTonne: 1 },
  { crop: "Cotton", india: "AGM-COTTON", world: "COTTON", toTonne: 22.0462 },
];

export function BasisView({ board }: { board: Board }) {
  const usdInr = board.instruments.find((i) => i.symbol === "INR=X")?.price ?? 0;
  const px = (sym: string) => board.instruments.find((i) => i.symbol === sym) ?? null;

  const rows = PAIRS.map((p) => {
    const ind = px(p.india), wor = px(p.world);
    return {
      ...p,
      india: ind, world: wor,
      value: basis(ind?.price ?? null, ind?.date ?? "", wor?.price ?? null,
        wor?.date ?? "", p.toTonne, usdInr),
    };
  }).filter((r) => r.india || r.world);

  const priced = rows.filter((r) => r.value);

  if (!rows.length) {
    return <p className="empty">
      No crop currently has both an Indian mandi price and a world benchmark on the board.
    </p>;
  }

  return (
    <>
      {priced.length > 0 && (
        <div className="cards" style={{ marginBottom: 22 }}>
          {priced.map((r) => (
            <div className="card" key={r.crop}>
              <div className="k">{r.crop}</div>
              <div className={`v ${tone(r.value!.premium)}`}>
                {r.value!.premium >= 0 ? "+" : ""}{r.value!.premium.toFixed(1)}%
              </div>
              <div className="d flat">
                {r.value!.premium >= 0 ? "India dearer" : "India cheaper"}
              </div>
            </div>
          ))}
        </div>
      )}

      <table className="board">
        <thead>
          <tr>
            <th>Crop</th><th>India</th><th>World</th><th>Basis</th>
            <th className="hide-s">As of</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.crop}>
              <td>
                <span className="nm">{r.crop}</span>
                <span className="src">
                  {r.india?.name ?? "no mandi row"} vs {r.world?.name ?? "no benchmark"}
                </span>
              </td>
              <td className="num">
                {r.value ? `$${fmt(r.value.indiaUsdPerTonne, 0)}` : "—"}
              </td>
              <td className="num">
                {r.value ? `$${fmt(r.value.worldUsdPerTonne, 0)}` : "—"}
              </td>
              <td className={`num ${r.value ? tone(r.value.premium) : "flat"}`}>
                {r.value
                  ? `${r.value.premium >= 0 ? "+" : ""}${r.value.premium.toFixed(1)}%`
                  : "awaiting data"}
              </td>
              <td className="src hide-s">
                {r.value ? `${r.value.indiaDate} vs ${r.value.worldDate}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="hint" style={{ marginTop: 18, maxWidth: "70ch" }}>
        Both sides are converted to US dollars per tonne at {fmt(usdInr)} INR.
        Treat these as indicative, not tradeable: the world side is a monthly IMF
        average while the Indian side is one day's modal price at a single market,
        and neither carries freight, duty, or any adjustment for grade or moisture.
        A row reading "awaiting data" means that mandi has not reported since the
        tracker started — those prices have no archive and accumulate one day at a time.
      </p>
    </>
  );
}
