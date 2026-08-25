import { describe, expect, it } from "vitest";
import { annualVol, back, basketIndex, change, correlate, drift, logReturns, pearson, project, rebase, sigma } from "./stats";
import type { Series, SeriesMap } from "../api/types";

const days = (n: number, from = "2026-01-01") => {
  const out: string[] = [];
  const d = new Date(from);
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};
const flat = (n: number, v = 100): Series => ({ dates: days(n), close: Array(n).fill(v) });
const ramp = (n: number, start = 100, step = 1): Series =>
  ({ dates: days(n), close: Array.from({ length: n }, (_, i) => start + i * step) });

describe("change and back", () => {
  it("returns null rather than guessing when history is short", () => {
    const s: Series = { dates: days(3), close: [10, 11, 12] };
    expect(change(s, 252)).toBeNull();
    expect(back(s, 99)).toBeNull();
  });

  it("computes a plain percentage change", () => {
    const s: Series = { dates: days(3), close: [100, 110, 120] };
    expect(change(s, 2)).toBeCloseTo(20, 6);
  });

  it("treats a single data point as having no change", () => {
    expect(change({ dates: ["2026-08-21"], close: [42] }, 1)).toBeNull();
  });

  it("survives a zero in the denominator", () => {
    expect(change({ dates: days(2), close: [0, 5] }, 1)).toBeNull();
  });
});

describe("sigma and drift", () => {
  it("is zero for a flat series", () => {
    expect(sigma(flat(40))).toBe(0);
    expect(annualVol(flat(40))).toBe(0);
  });

  it("needs at least four returns", () => {
    expect(sigma({ dates: days(3), close: [1, 2, 3] })).toBe(0);
  });

  it("caps drift at half a sigma so a run does not extrapolate off the chart", () => {
    // steep, near-constant ascent: raw mean return far exceeds 0.5σ
    const s = ramp(80, 100, 4);
    const raw = logReturns(s, 60).reduce((a, b) => a + b, 0) / 60;
    expect(drift(s)).toBeLessThanOrEqual(0.5 * sigma(s) + 1e-12);
    expect(drift(s)).toBeLessThan(raw);
  });

  it("skips non-positive prices when taking logs", () => {
    const s: Series = { dates: days(6), close: [10, 0, 12, 13, 14, 15] };
    expect(logReturns(s, 5).every(Number.isFinite)).toBe(true);
  });
});

describe("project", () => {
  it("widens with the square root of time", () => {
    const s = ramp(60, 100, 0.4);
    const b = project(100, s, 30);
    const w1 = b[3].hi1 - b[3].lo1;
    const w2 = b[15].hi1 - b[15].lo1;
    expect(w2).toBeGreaterThan(w1);
  });

  it("nests the 95% band outside the 68% band", () => {
    const b = project(100, ramp(60, 100, 0.4), 10);
    for (const x of b) {
      expect(x.hi2).toBeGreaterThanOrEqual(x.hi1);
      expect(x.lo2).toBeLessThanOrEqual(x.lo1);
    }
  });

  it("collapses to a flat line when volatility is zero", () => {
    const b = project(100, flat(60), 5);
    expect(b.every((x) => Math.abs(x.hi1 - x.lo1) < 1e-9)).toBe(true);
  });

  it("never projects a negative price", () => {
    const wild: Series = { dates: days(40), close: Array.from({ length: 40 }, (_, i) => 100 * (1 + 0.4 * Math.sin(i))) };
    expect(project(100, wild, 60).every((x) => x.lo2 > 0)).toBe(true);
  });
});

describe("pearson", () => {
  it("is 1 for identical series and -1 for mirrored", () => {
    const a = Array.from({ length: 30 }, (_, i) => Math.sin(i));
    expect(pearson(a, a)).toBeCloseTo(1, 9);
    expect(pearson(a, a.map((v) => -v))).toBeCloseTo(-1, 9);
  });

  it("refuses to report a correlation from too few points", () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull();
  });

  it("returns null when one side has no variance", () => {
    expect(pearson(Array(20).fill(1), Array.from({ length: 20 }, (_, i) => i))).toBeNull();
  });
});

describe("correlate", () => {
  it("matches returns by date, not by position", () => {
    // B is missing a mid-series session. Index alignment would pair the wrong
    // days and produce a correlation well below 1.
    const a: Series = { dates: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15"],
                        close: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((v) => 100 + v) };
    const b: Series = { dates: a.dates.filter((d) => d !== "07"),
                        close: a.dates.map((d, i) => ({ d, v: a.close[i] })).filter((x) => x.d !== "07").map((x) => x.v) };
    const m = correlate(["A", "B"], { A: a, B: b }, 90);
    expect(m[0][1]).not.toBeNull();
    expect(m[0][1]!).toBeGreaterThan(0.9);
  });

  it("puts 1 on the diagonal", () => {
    const s: SeriesMap = { A: ramp(40), B: ramp(40, 50, 2) };
    const m = correlate(["A", "B"], s, 30);
    expect(m[0][0]).toBe(1);
    expect(m[1][1]).toBe(1);
  });

  it("puts null on the diagonal for a symbol with no data", () => {
    expect(correlate(["GHOST"], {}, 90)[0][0]).toBeNull();
  });

  it("returns null for an instrument with no archive", () => {
    const s: SeriesMap = { A: ramp(40), NEW: { dates: ["2026-08-21"], close: [10] } };
    expect(correlate(["A", "NEW"], s, 90)[0][1]).toBeNull();
  });
});

describe("rebase", () => {
  it("starts every series at 100", () => {
    expect(rebase(ramp(30, 250, 3), 20).values[0]).toBeCloseTo(100, 9);
  });
  it("handles an empty series", () => {
    expect(rebase(undefined, 20).values).toEqual([]);
  });
});

describe("basketIndex", () => {
  const s: SeriesMap = { A: ramp(40, 100, 1), B: ramp(40, 200, 2) };

  it("starts at 100", () => {
    const r = basketIndex([{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], s, 30);
    expect(r.values[0]).toBeCloseTo(100, 9);
  });

  it("normalises weights that do not sum to 100", () => {
    const a = basketIndex([{ symbol: "A", weight: 1 }, { symbol: "B", weight: 1 }], s, 30);
    const b = basketIndex([{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], s, 30);
    expect(a.values.at(-1)).toBeCloseTo(b.values.at(-1)!, 9);
  });

  it("reports legs it could not use instead of dropping them silently", () => {
    const r = basketIndex(
      [{ symbol: "A", weight: 50 }, { symbol: "MISSING", weight: 50 }], s, 30);
    expect(r.skipped).toEqual(["MISSING"]);
    expect(r.values[0]).toBeCloseTo(100, 9);
  });

  it("uses only dates every leg shares", () => {
    const gappy: SeriesMap = {
      A: { dates: ["01", "02", "03", "04"], close: [10, 11, 12, 13] },
      B: { dates: ["01", "03", "04"], close: [20, 22, 24] },
    };
    const r = basketIndex([{ symbol: "A", weight: 1 }, { symbol: "B", weight: 1 }], gappy, 90);
    expect(r.dates).toEqual(["01", "03", "04"]);
  });

  it("returns nothing usable when every leg is empty", () => {
    const r = basketIndex([{ symbol: "X", weight: 1 }], {}, 30);
    expect(r.values).toEqual([]);
    expect(r.skipped).toEqual(["X"]);
  });
});
