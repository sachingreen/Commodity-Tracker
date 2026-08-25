import { describe, expect, it } from "vitest";
import {
  CONV, exporterStack, freightShare, importerStack, leaks, perTonne, total,
  type ExporterInputs, type ImporterInputs,
} from "./ledger";
import { evaluateRules, automaticHighlights } from "./highlights";
import type { Board, Rule, SeriesMap } from "../api/types";

const IMP: ImporterInputs = {
  freight: 60, freightPrev: 45, duty: 7.5, port: 18, inland: 24, finance: 2.2,
};
const EXP: ExporterInputs = {
  postHarvestLoss: 10, grading: 34, toPort: 41, terminal: 15, fxSlippage: -0.8,
};

describe("perTonne", () => {
  const series: SeriesMap = {
    COPPER: { dates: ["a", "b"], close: [9500, 10186] },      // USD/t (FRED)
    "AGM-CHILLI": { dates: ["a"], close: [18400] },           // INR/quintal
    "BZ=F": { dates: ["a"], close: [78.4] },                  // USD/barrel
  };

  it("passes through a price already quoted per tonne", () => {
    expect(perTonne("COPPER", series, 0, 87.9)!).toBeCloseTo(10186, 4);
  });

  it("converts US cents per pound to dollars per tonne", () => {
    const softs: SeriesMap = { SUGAR: { dates: ["a"], close: [17.2] } };
    expect(perTonne("SUGAR", softs, 0, 87.9)!).toBeCloseTo(17.2 * 22.0462, 4);
  });

  it("converts rupees per quintal to dollars per tonne", () => {
    // 18,400 INR/qtl → 184,000 INR/t → /87.9 ≈ 2,093 USD/t
    expect(perTonne("AGM-CHILLI", series, 0, 87.9)!).toBeCloseTo(184000 / 87.9, 4);
  });

  it("converts barrels to a tonne", () => {
    expect(perTonne("BZ=F", series, 0, 87.9)!).toBeCloseTo(78.4 * 7.33, 4);
  });

  it("returns null for an instrument with no conversion", () => {
    expect(perTonne("BTC-USD", { "BTC-USD": { dates: ["a"], close: [96400] } }, 0, 87.9)).toBeNull();
  });

  it("returns null when history does not reach back that far", () => {
    expect(perTonne("AGM-CHILLI", series, 252, 87.9)).toBeNull();
  });

  it("still refuses cargo that cannot be shipped by the tonne", () => {
    expect(CONV["BTC-USD"]).toBeUndefined();
  });

  it("only covers physically shippable cargo", () => {
    expect(CONV["BTC-USD"]).toBeUndefined();
    expect(CONV["GOLD"]).toBeUndefined();
  });
});

describe("importerStack", () => {
  it("sums to base plus every added cost", () => {
    const s = importerStack(1000, 60, IMP);
    const cfr = 1060, ins = cfr * 0.0015, duty = (cfr + ins) * 0.075;
    const sub = cfr + ins + duty + 18 + 24;
    expect(total(s)).toBeCloseTo(sub + sub * 0.022, 6);
  });

  it("charges duty on freight and insurance, not just the goods", () => {
    const cheap = importerStack(1000, 10, IMP);
    const dear = importerStack(1000, 200, IMP);
    const d = (x: typeof cheap) => x.find((s) => s.key === "duty")!.value;
    expect(d(dear)).toBeGreaterThan(d(cheap));
  });

  it("reports freight share of the landed total", () => {
    const s = importerStack(1000, 100, IMP);
    expect(freightShare(s)).toBeCloseTo((100 / total(s)) * 100, 6);
  });

  it("has no freight share when freight is zero", () => {
    expect(freightShare(importerStack(1000, 0, IMP))).toBe(0);
  });
});

describe("exporterStack", () => {
  it("grosses up for post-harvest loss", () => {
    // at 10% loss you must buy 1/0.9 tonnes to ship one
    const s = exporterStack(900, EXP);
    expect(s.find((x) => x.key === "loss")!.value).toBeCloseTo(900 * (0.1 / 0.9), 6);
  });

  it("does not divide by zero at 100% loss", () => {
    const s = exporterStack(900, { ...EXP, postHarvestLoss: 100 });
    expect(Number.isFinite(total(s))).toBe(true);
  });

  it("treats FX slippage as a cost whichever way it is signed", () => {
    const a = exporterStack(900, { ...EXP, fxSlippage: -1.5 });
    const b = exporterStack(900, { ...EXP, fxSlippage: 1.5 });
    expect(a.find((x) => x.key === "finance")!.value)
      .toBeCloseTo(b.find((x) => x.key === "finance")!.value, 6);
  });
});

describe("leaks", () => {
  it("refuses to compare when there is no prior stack", () => {
    expect(leaks(importerStack(1000, 60, IMP), null)).toBeNull();
  });

  it("identifies the leg that grew fastest", () => {
    const now = importerStack(1000, 120, IMP);
    const prev = importerStack(1000, 40, IMP);
    const worst = leaks(now, prev)!.sort((a, b) => b.growth - a.growth)[0];
    expect(worst.label).toBe("Ocean freight");
    expect(worst.growth).toBeCloseTo(200, 6);
  });

  it("reports the share shift in basis points", () => {
    const l = leaks(importerStack(1000, 120, IMP), importerStack(1000, 40, IMP))!;
    expect(l.find((x) => x.label === "Ocean freight")!.shareShiftBps).toBeGreaterThan(0);
    expect(l.find((x) => x.label === "Commodity (FOB)")!.shareShiftBps).toBeLessThan(0);
  });
});

const board: Board = {
  seed: false, asof: "2026-08-21",
  instruments: [
    { symbol: "COPPER", name: "Copper", group: "Base metals", unit: "USD/t",
      source: "IMF via FRED", price: 10186, date: "2026-08-21", stale_days: 0,
      history: 400, freq: "monthly" },
    { symbol: "AGM-CHILLI", name: "Chilli (Guntur)", group: "India agri", unit: "INR/qtl",
      source: "Agmarknet", price: 18400, date: "2026-08-21", stale_days: 0,
      history: 1, freq: "daily" },
    { symbol: "WCI", name: "Drewry WCI 40ft", group: "Freight", unit: "USD/FEU",
      source: "Drewry · manual", price: 4526, date: "2026-08-14", stale_days: 7,
      history: 1, freq: "weekly" },
  ],
};
const series: SeriesMap = {
  COPPER: { dates: Array.from({ length: 30 }, (_, i) => `d${i}`),
           close: Array.from({ length: 30 }, (_, i) => 9500 + i * 40) },
  "AGM-CHILLI": { dates: ["2026-08-21"], close: [18400] },
  WCI: { dates: ["2026-08-14"], close: [4526] },
};

describe("rule evaluation", () => {
  it("fires a threshold rule only when crossed", () => {
    const hit: Rule = { id: "r1", kind: "threshold", symbol: "COPPER", direction: "above", value: 9000 };
    const miss: Rule = { id: "r2", kind: "threshold", symbol: "COPPER", direction: "above", value: 99000 };
    expect(evaluateRules([hit], board, series, IMP, 87.9)).toHaveLength(1);
    expect(evaluateRules([miss], board, series, IMP, 87.9)).toHaveLength(0);
  });

  it("skips a move rule when the instrument has no archive", () => {
    const r: Rule = { id: "r3", kind: "move", symbol: "AGM-CHILLI", percent: 1, sessions: 20 };
    expect(evaluateRules([r], board, series, IMP, 87.9)).toHaveLength(0);
  });

  it("fires a move rule on a real move", () => {
    const r: Rule = { id: "r4", kind: "move", symbol: "COPPER", percent: 5, sessions: 20 };
    const out = evaluateRules([r], board, series, IMP, 87.9);
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe("up");
  });

  it("skips a freight-share rule on cargo with no tonne conversion", () => {
    const r: Rule = { id: "r5", kind: "freightShare", symbol: "WCI", percent: 1 };
    expect(evaluateRules([r], board, series, IMP, 87.9)).toHaveLength(0);
  });

  it("fires a freight-share rule when freight dominates", () => {
    const r: Rule = { id: "r6", kind: "freightShare", symbol: "COPPER", percent: 0.4 };
    const out = evaluateRules([r], board, series, { ...IMP, freight: 200 }, 87.9);
    expect(out).toHaveLength(1);
    expect(out[0].tone).toBe("warn");
  });

  it("ignores rules pointing at a delisted symbol", () => {
    const r: Rule = { id: "r7", kind: "threshold", symbol: "FBX", direction: "above", value: 1 };
    expect(evaluateRules([r], board, series, IMP, 87.9)).toHaveLength(0);
  });
});

describe("automatic highlights", () => {
  it("flags stale prices", () => {
    const h = automaticHighlights(board, series);
    expect(h.some((x) => x.id === "auto-stale")).toBe(true);
  });

  it("flags instruments with no archive", () => {
    const h = automaticHighlights(board, series);
    const thin = h.find((x) => x.id === "auto-thin");
    expect(thin?.headline).toContain("2");
  });

  it("never marks an automatic highlight as pinned", () => {
    expect(automaticHighlights(board, series).every((h) => !h.pinned)).toBe(true);
  });
});
