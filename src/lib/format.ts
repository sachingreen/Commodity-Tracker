export const fmt = (v: number | null | undefined, digits?: number): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = digits ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

export const pct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

export const tone = (v: number | null | undefined): string =>
  v == null ? "flat" : v > 0.02 ? "up" : v < -0.02 ? "down" : "flat";

/** Palette for the correlation heatmap: red through neutral to teal. */
export function heat(v: number | null): string {
  if (v == null) return "transparent";
  const t = Math.max(-1, Math.min(1, v));
  return t >= 0
    ? `rgba(70,180,138,${0.12 + 0.78 * t})`
    : `rgba(219,88,76,${0.12 + 0.78 * -t})`;
}

export const uid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
