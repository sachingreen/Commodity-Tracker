import type { Conversion, SeriesMap } from "../api/types";
import { back } from "./stats";

/**
 * Contract weights used to express every quote as one tonne.
 * Only instruments listed here can enter the ledger.
 */
export const CONV: Record<string, Conversion> = {
  // FRED quotes metals and most grains in USD per tonne already, so most
  // factors are 1. The exceptions are crude (barrels), the softs (US cents
  // per pound) and mandi prices (rupees per quintal).
  "BZ=F": { factor: 7.33, currency: "USD" },      // barrels per tonne
  "CL=F": { factor: 7.33, currency: "USD" },
  COPPER: { factor: 1, currency: "USD" },
  ALUM: { factor: 1, currency: "USD" },
  NICKEL: { factor: 1, currency: "USD" },
  ZINC: { factor: 1, currency: "USD" },
  IRONORE: { factor: 1, currency: "USD" },
  WHEAT: { factor: 1, currency: "USD" },
  CORN: { factor: 1, currency: "USD" },
  RICE: { factor: 1, currency: "USD" },
  SOY: { factor: 1, currency: "USD" },
  SUGAR: { factor: 22.0462, currency: "USD" },    // USc/lb → USD/t
  COFFEE: { factor: 22.0462, currency: "USD" },
  COTTON: { factor: 22.0462, currency: "USD" },
  "AGM-CHILLI": { factor: 10, currency: "INR" },  // quintals per tonne
  "AGM-TURMERIC": { factor: 10, currency: "INR" },
  "AGM-COTTON": { factor: 10, currency: "INR" },
  "AGM-ONION": { factor: 10, currency: "INR" },
};

export const SEG_COLOUR: Record<string, string> = {
  base: "var(--slate)",
  freight: "var(--amber)",
  duty: "var(--violet)",
  handling: "var(--gain)",
  inland: "var(--clay)",
  finance: "var(--steel)",
  loss: "var(--loss)",
};

export interface Segment { key: string; label: string; value: number; colour: string }

export interface ImporterInputs {
  freight: number; freightPrev: number; duty: number;
  port: number; inland: number; finance: number;
}
export interface ExporterInputs {
  postHarvestLoss: number; grading: number; toPort: number;
  terminal: number; fxSlippage: number;
}

/** Convert a quoted price to USD per tonne. Null when unpriceable. */
export function perTonne(
  symbol: string, series: SeriesMap, sessionsBack: number, usdInr: number,
): number | null {
  const conv = CONV[symbol];
  const s = series[symbol];
  if (!conv || !s || !s.close.length) return null;
  const px = sessionsBack === 0 ? s.close[s.close.length - 1] : back(s, sessionsBack);
  if (px == null) return null;
  const usd = conv.currency === "INR" ? (px * conv.factor) / usdInr : px * conv.factor;
  return Number.isFinite(usd) ? usd : null;
}

export function importerStack(base: number, freight: number, i: ImporterInputs): Segment[] {
  const cfr = base + freight;
  const insurance = cfr * 0.0015;
  const duty = (cfr + insurance) * (i.duty / 100);
  const subtotal = cfr + insurance + duty + i.port + i.inland;
  return [
    { key: "base", label: "Commodity (FOB)", value: base, colour: SEG_COLOUR.base },
    { key: "freight", label: "Ocean freight", value: freight, colour: SEG_COLOUR.freight },
    { key: "duty", label: "Duty + insurance", value: duty + insurance, colour: SEG_COLOUR.duty },
    { key: "handling", label: "Port & CFS", value: i.port, colour: SEG_COLOUR.handling },
    { key: "inland", label: "Inland haul", value: i.inland, colour: SEG_COLOUR.inland },
    { key: "finance", label: "Finance, 90d", value: subtotal * (i.finance / 100), colour: SEG_COLOUR.finance },
  ];
}

export function exporterStack(base: number, e: ExporterInputs): Segment[] {
  const phl = e.postHarvestLoss / 100;
  // To ship one saleable tonne you must buy 1/(1-loss) tonnes.
  const lossCost = phl >= 1 ? base * 99 : base * (phl / (1 - phl));
  const subtotal = base + lossCost + e.grading + e.toPort + e.terminal;
  return [
    { key: "base", label: "Farmgate / mill", value: base, colour: SEG_COLOUR.base },
    { key: "loss", label: "Post-harvest loss", value: lossCost, colour: SEG_COLOUR.loss },
    { key: "handling", label: "Grading & packing", value: e.grading, colour: SEG_COLOUR.handling },
    { key: "inland", label: "Farm to port", value: e.toPort, colour: SEG_COLOUR.inland },
    { key: "duty", label: "Terminal & docs", value: e.terminal, colour: SEG_COLOUR.duty },
    { key: "finance", label: "FX slippage", value: Math.abs(subtotal * (e.fxSlippage / 100)), colour: SEG_COLOUR.finance },
  ];
}

export const total = (segs: Segment[]) => segs.reduce((a, s) => a + s.value, 0);

/** Freight as a share of landed cost, in percent. */
export function freightShare(segs: Segment[]): number {
  const t = total(segs);
  if (!t) return 0;
  const f = segs.find((s) => s.key === "freight");
  return f ? (f.value / t) * 100 : 0;
}

export interface Leak { label: string; delta: number; growth: number; shareShiftBps: number }

/**
 * Compare two stacks leg by leg. Returns null when there is no prior stack —
 * an instrument with no archive gets no comparison rather than a fabricated one.
 */
export function leaks(now: Segment[], prev: Segment[] | null): Leak[] | null {
  if (!prev) return null;
  const tN = total(now), tP = total(prev);
  return now.map((s, i) => {
    const p = prev[i]?.value ?? 0;
    return {
      label: s.label,
      delta: s.value - p,
      growth: p ? (s.value / p - 1) * 100 : 0,
      shareShiftBps: ((s.value / tN) * 100 - (tP ? (p / tP) * 100 : 0)) * 100,
    };
  });
}
