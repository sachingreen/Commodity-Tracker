import type { Series, SeriesMap } from "../api/types";

/**
 * How many observations back a given period is, for a series of this
 * frequency. Returns null where the period is shorter than one observation —
 * asking a monthly series for a one-day change has no answer, and returning
 * the previous month under a "1D" heading would be a lie.
 */
export function periodOffset(
  freq: "daily" | "weekly" | "monthly", period: "1D" | "1W" | "1M" | "1Y",
): number | null {
  const table = {
    daily: { "1D": 1, "1W": 5, "1M": 21, "1Y": 252 },
    weekly: { "1D": null, "1W": 1, "1M": 4, "1Y": 52 },
    monthly: { "1D": null, "1W": null, "1M": 1, "1Y": 12 },
  } as const;
  return table[freq][period];
}

/** Close n sessions back, or null when history doesn't reach that far. */
export function back(s: Series | undefined, n: number): number | null {
  if (!s) return null;
  const v = s.close[s.close.length - 1 - n];
  return v == null ? null : v;
}

/** Percentage change over n sessions. Null when there isn't enough history. */
export function change(s: Series | undefined, n: number): number | null {
  if (!s || !s.close.length) return null;
  const now = s.close[s.close.length - 1];
  const then = back(s, n);
  if (now == null || then == null || then === 0) return null;
  return (now / then - 1) * 100;
}

/** Daily log returns over the last n sessions, oldest first. */
export function logReturns(s: Series | undefined, n: number): number[] {
  if (!s) return [];
  const c = s.close.slice(-(n + 1));
  const out: number[] = [];
  for (let i = 1; i < c.length; i++) {
    if (c[i - 1] > 0 && c[i] > 0) out.push(Math.log(c[i] / c[i - 1]));
  }
  return out;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** Sample standard deviation of daily log returns. 0 when too few points. */
export function sigma(s: Series | undefined, n = 20): number {
  const r = logReturns(s, n);
  if (r.length < 4) return 0;
  const m = mean(r);
  return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
}

/**
 * Drift from the 60-session mean log return, capped at half a sigma.
 * Uncapped drift extrapolates a recent run straight off the chart.
 */
export function drift(s: Series | undefined): number {
  const r = logReturns(s, 60);
  if (!r.length) return 0;
  const cap = 0.5 * sigma(s);
  return Math.max(-cap, Math.min(cap, mean(r)));
}

export interface Band { sessions: number; mid: number; lo1: number; hi1: number; lo2: number; hi2: number }

/**
 * Volatility cone: S·exp(µ·n ± z·σ·√n). Not a forecast — a restatement of
 * how far the price has recently been in the habit of moving.
 */
export function project(spot: number, s: Series | undefined, sessions: number): Band[] {
  const sd = sigma(s);
  const mu = drift(s);
  const out: Band[] = [];
  for (let n = 1; n <= sessions; n++) {
    const t = Math.sqrt(n);
    out.push({
      sessions: n,
      mid: spot * Math.exp(mu * n),
      lo1: spot * Math.exp(mu * n - sd * t),
      hi1: spot * Math.exp(mu * n + sd * t),
      lo2: spot * Math.exp(mu * n - 1.96 * sd * t),
      hi2: spot * Math.exp(mu * n + 1.96 * sd * t),
    });
  }
  return out;
}

export function annualVol(s: Series | undefined): number {
  return sigma(s) * Math.sqrt(252) * 100;
}

/** Pearson correlation of two aligned return arrays. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Correlation matrix over daily log returns.
 *
 * Returns are built from the dates two instruments actually share, so both
 * sides span the same interval. Matching prices by date is not enough on its
 * own: if one series is missing a session, the next day's return covers two
 * days on that side and one on the other, and the correlation is diluted by an
 * artefact of the calendar rather than by the market.
 */
export function correlate(
  symbols: string[], series: SeriesMap, sessions = 90,
): (number | null)[][] {
  const priceByDate = new Map<string, Map<string, number>>();
  for (const sym of symbols) {
    const s = series[sym];
    if (!s) continue;
    const m = new Map<string, number>();
    const c = s.close.slice(-(sessions + 1));
    const d = s.dates.slice(-(sessions + 1));
    d.forEach((day, i) => { if (c[i] > 0) m.set(day, c[i]); });
    priceByDate.set(sym, m);
  }

  /** Log returns over dates present in both series, oldest first. */
  const pairedReturns = (a: string, b: string): [number[], number[]] => {
    const ma = priceByDate.get(a), mb = priceByDate.get(b);
    if (!ma || !mb) return [[], []];
    const shared = [...ma.keys()].filter((d) => mb.has(d)).sort();
    const xs: number[] = [], ys: number[] = [];
    for (let i = 1; i < shared.length; i++) {
      const p0 = ma.get(shared[i - 1])!, p1 = ma.get(shared[i])!;
      const q0 = mb.get(shared[i - 1])!, q1 = mb.get(shared[i])!;
      xs.push(Math.log(p1 / p0));
      ys.push(Math.log(q1 / q0));
    }
    return [xs, ys];
  };

  return symbols.map((a) =>
    symbols.map((b) => {
      if (a === b) return priceByDate.get(a)?.size ? 1 : null;
      const [xs, ys] = pairedReturns(a, b);
      return pearson(xs, ys);
    }),
  );
}

/** Rebase a series to 100 at the start of the window, for overlay charts. */
export function rebase(s: Series | undefined, sessions: number): { dates: string[]; values: number[] } {
  if (!s || !s.close.length) return { dates: [], values: [] };
  const close = s.close.slice(-sessions);
  const dates = s.dates.slice(-sessions);
  const base = close.find((v) => v > 0);
  if (!base) return { dates: [], values: [] };
  return { dates, values: close.map((v) => (v / base) * 100) };
}

/**
 * Weighted basket rebased to 100, matched on dates common to every leg.
 * A leg with no data on a date drops that date rather than carrying forward,
 * so the index never invents a level for a day that didn't trade.
 */
export function basketIndex(
  legs: { symbol: string; weight: number }[], series: SeriesMap, sessions: number,
): { dates: string[]; values: number[]; skipped: string[] } {
  const usable = legs.filter((l) => (series[l.symbol]?.close.length ?? 0) > 1 && l.weight > 0);
  const skipped = legs.filter((l) => !usable.includes(l)).map((l) => l.symbol);
  if (!usable.length) return { dates: [], values: [], skipped };

  const maps = usable.map((l) => {
    const s = series[l.symbol];
    const m = new Map<string, number>();
    s.dates.forEach((d, i) => { if (s.close[i] > 0) m.set(d, s.close[i]); });
    return m;
  });
  const common = [...maps[0].keys()]
    .filter((d) => maps.every((m) => m.has(d)))
    .sort()
    .slice(-sessions);
  if (common.length < 2) return { dates: [], values: [], skipped };

  const total = usable.reduce((a, l) => a + l.weight, 0);
  const base = maps.map((m) => m.get(common[0])!);
  const values = common.map((d) =>
    usable.reduce((acc, l, i) => acc + (l.weight / total) * (maps[i].get(d)! / base[i]) * 100, 0),
  );
  return { dates: common, values, skipped };
}

/* ---------------------------------------------------------------- risk --- */

export interface BasketRisk {
  /** Annualised volatility of the weighted basket, in percent. */
  volatility: number;
  /** Weighted average of the legs' own volatilities, in percent. */
  weightedLegVol: number;
  /**
   * weightedLegVol / volatility. Above 1 means the legs partly offset each
   * other; at exactly 1 they move as one asset and the basket diversifies
   * nothing.
   */
  diversification: number;
  /** Share of total basket variance attributable to each leg, in percent. */
  contributions: { symbol: string; percent: number; weight: number }[];
  /** Sessions common to every leg — the sample the numbers rest on. */
  sessions: number;
  /** Legs excluded, with the reason. */
  skipped: { symbol: string; reason: string }[];
}

/**
 * Risk decomposition for a weighted basket, from daily log returns.
 *
 * Portfolio variance is wᵀΣw; each leg's contribution to it is w_i·(Σw)_i.
 * Contributions sum to 100% by construction, and a leg can contribute more
 * than its weight — that is the point of computing this rather than eyeballing
 * the weights.
 *
 * Only daily series qualify. Monthly benchmarks are excluded rather than
 * mixed in: 12 observations a year cannot estimate a covariance worth acting
 * on, and blending the two frequencies produces a number that looks precise
 * and means nothing.
 */
export function basketRisk(
  legs: { symbol: string; weight: number }[],
  series: SeriesMap,
  freq: Record<string, string>,
  sessions = 252,
): BasketRisk | null {
  const skipped: { symbol: string; reason: string }[] = [];
  const usable = legs.filter((l) => {
    if (l.weight <= 0) { skipped.push({ symbol: l.symbol, reason: "zero weight" }); return false; }
    if (freq[l.symbol] && freq[l.symbol] !== "daily") {
      skipped.push({ symbol: l.symbol, reason: `${freq[l.symbol]} series` }); return false;
    }
    if ((series[l.symbol]?.close.length ?? 0) < 30) {
      skipped.push({ symbol: l.symbol, reason: "not enough history" }); return false;
    }
    return true;
  });
  if (usable.length < 2) return null;

  // align on dates every remaining leg traded, then take returns across them
  const maps = usable.map((l) => {
    const s = series[l.symbol];
    const m = new Map<string, number>();
    s.dates.forEach((d, i) => { if (s.close[i] > 0) m.set(d, s.close[i]); });
    return m;
  });
  const shared = [...maps[0].keys()]
    .filter((d) => maps.every((m) => m.has(d)))
    .sort()
    .slice(-(sessions + 1));
  if (shared.length < 30) return null;

  const rets = maps.map((m) => {
    const out: number[] = [];
    for (let i = 1; i < shared.length; i++) out.push(Math.log(m.get(shared[i])! / m.get(shared[i - 1])!));
    return out;
  });

  const n = usable.length;
  const total = usable.reduce((a, l) => a + l.weight, 0);
  const w = usable.map((l) => l.weight / total);
  const avg = rets.map((r) => r.reduce((a, b) => a + b, 0) / r.length);

  // sample covariance
  const cov: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const T = rets[0].length;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let acc = 0;
      for (let t = 0; t < T; t++) acc += (rets[i][t] - avg[i]) * (rets[j][t] - avg[j]);
      cov[i][j] = cov[j][i] = acc / (T - 1);
    }
  }

  // Σw, then variance = wᵀΣw
  const sw = w.map((_, i) => w.reduce((acc, wj, j) => acc + cov[i][j] * wj, 0));
  const variance = w.reduce((acc, wi, i) => acc + wi * sw[i], 0);
  if (!(variance > 0)) return null;

  const ann = Math.sqrt(variance * 252) * 100;
  const legVols = cov.map((row, i) => Math.sqrt(row[i] * 252) * 100);
  const weighted = w.reduce((acc, wi, i) => acc + wi * legVols[i], 0);

  return {
    volatility: ann,
    weightedLegVol: weighted,
    diversification: weighted / ann,
    contributions: usable.map((l, i) => ({
      symbol: l.symbol,
      weight: w[i] * 100,
      percent: (w[i] * sw[i]) / variance * 100,
    })),
    sessions: T,
    skipped,
  };
}
