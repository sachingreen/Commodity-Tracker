import type { Board, Highlight, Rule, SeriesMap } from "../api/types";
import { change } from "./stats";
import { CONV, freightShare, importerStack, perTonne, type ImporterInputs } from "./ledger";

const fmt = (v: number, d = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * Evaluate the user's rules against current data.
 *
 * Rules that can't be evaluated — a symbol with no history, a cargo with no
 * tonne conversion — are skipped silently rather than reported as "not fired".
 * Saying nothing is honest; saying "all clear" would not be.
 */
export function evaluateRules(
  rules: Rule[], board: Board, series: SeriesMap, ledgerInputs: ImporterInputs, usdInr: number,
): Highlight[] {
  const out: Highlight[] = [];
  const find = (sym: string) => board.instruments.find((i) => i.symbol === sym);

  for (const rule of rules) {
    const inst = find(rule.symbol);
    if (!inst) continue;

    if (rule.kind === "threshold") {
      const hit = rule.direction === "above" ? inst.price > rule.value : inst.price < rule.value;
      if (!hit) continue;
      out.push({
        id: rule.id, symbol: rule.symbol, pinned: true,
        tone: rule.direction === "above" ? "up" : "down",
        headline: `${inst.name} ${rule.direction} ${fmt(rule.value)}`,
        detail: `Trading at ${fmt(inst.price)} ${inst.unit}, past your ${fmt(rule.value)} mark.`,
      });
    }

    if (rule.kind === "move") {
      const s = series[rule.symbol];
      if (!s || s.close.length <= rule.sessions) continue;   // not enough history
      const c = change(s, rule.sessions);
      if (c == null || Math.abs(c) < rule.percent) continue;
      out.push({
        id: rule.id, symbol: rule.symbol, pinned: true,
        tone: c > 0 ? "up" : "down",
        headline: `${inst.name} moved ${pct(c)} in ${rule.sessions} sessions`,
        detail: `Your threshold was ${rule.percent}%. Now ${fmt(inst.price)} ${inst.unit}.`,
      });
    }

    if (rule.kind === "freightShare") {
      if (!CONV[rule.symbol]) continue;                      // no tonne conversion
      const base = perTonne(rule.symbol, series, 0, usdInr);
      if (base == null) continue;
      const share = freightShare(importerStack(base, ledgerInputs.freight, ledgerInputs));
      if (share < rule.percent) continue;
      out.push({
        id: rule.id, symbol: rule.symbol, pinned: true, tone: "warn",
        headline: `Freight is ${share.toFixed(1)}% of landed cost on ${inst.name}`,
        detail: `Above your ${rule.percent}% line, at $${fmt(ledgerInputs.freight, 0)}/t freight.`,
      });
    }
  }
  return out;
}

/**
 * Highlights nobody configured: the day's largest moves, and any price that
 * has gone stale. These keep the panel useful before any rules are set.
 */
export function automaticHighlights(board: Board, series: SeriesMap): Highlight[] {
  const out: Highlight[] = [];

  const moves = board.instruments
    .map((i) => ({ i, c: change(series[i.symbol], 1) }))
    .filter((x): x is { i: typeof x.i; c: number } => x.c != null && Math.abs(x.c) >= 1.5)
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
    .slice(0, 3);

  for (const { i, c } of moves) {
    out.push({
      id: `auto-move-${i.symbol}`, symbol: i.symbol, pinned: false,
      tone: c > 0 ? "up" : "down",
      headline: `${i.name} ${c > 0 ? "up" : "down"} ${pct(Math.abs(c)).replace("+", "")} on the session`,
      detail: `${fmt(i.price)} ${i.unit} · ${i.source}`,
    });
  }

  const stale = board.instruments.filter((i) => i.stale_days > 3);
  if (stale.length) {
    out.push({
      id: "auto-stale", symbol: stale[0].symbol, pinned: false, tone: "warn",
      headline: `${stale.length} price${stale.length > 1 ? "s" : ""} older than three days`,
      detail: stale.map((i) => `${i.name} (${i.stale_days}d)`).join(", ")
        + ". These have no live feed and are updated by hand.",
    });
  }

  const thin = board.instruments.filter((i) => i.history <= 1);
  if (thin.length) {
    out.push({
      id: "auto-thin", symbol: thin[0].symbol, pinned: false, tone: "info",
      headline: `${thin.length} instruments have no price archive yet`,
      detail: "They build history from each scheduled run, so change columns and "
        + "correlations stay blank until enough sessions accumulate.",
    });
  }

  return out;
}

export function allHighlights(
  rules: Rule[], board: Board, series: SeriesMap,
  ledgerInputs: ImporterInputs, usdInr: number,
): Highlight[] {
  return [
    ...evaluateRules(rules, board, series, ledgerInputs, usdInr),
    ...automaticHighlights(board, series),
  ];
}
