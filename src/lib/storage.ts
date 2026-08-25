/**
 * Persistence for watchlists, rules and baskets.
 *
 * localStorage throws in private browsing and in sandboxed frames, and there is
 * no server to fall back to, so every call is guarded and degrades to an
 * in-memory store for the session. `persistent` reports which one is live so
 * the UI can tell the user their settings won't survive a reload.
 */
const memory = new Map<string, string>();

let available: boolean | null = null;

function probe(): boolean {
  if (available !== null) return available;
  try {
    const k = "__assay_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const persistent = () => probe();

const PREFIX = "assay:";

export function read<T>(key: string, fallback: T): T {
  const k = PREFIX + key;
  try {
    const raw = probe() ? window.localStorage.getItem(k) : memory.get(k) ?? null;
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function write<T>(key: string, value: T): boolean {
  const k = PREFIX + key;
  const raw = JSON.stringify(value);
  try {
    if (probe()) window.localStorage.setItem(k, raw);
    else memory.set(k, raw);
    return true;
  } catch {
    memory.set(k, raw);   // quota exceeded — keep it for the session at least
    return false;
  }
}

export interface Settings {
  watchlist: string[];
  rules: unknown[];
  baskets: unknown[];
}

/** Everything the user has configured, for the export button. */
export function exportAll(): Settings {
  return {
    watchlist: read<string[]>("watchlist", []),
    rules: read<unknown[]>("rules", []),
    baskets: read<unknown[]>("baskets", []),
  };
}

/** Merge an exported file back in. Rejects anything that isn't the right shape. */
export function importAll(json: string): { ok: true } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Expected an object with watchlist, rules and baskets." };
  }
  const p = parsed as Partial<Settings>;
  if (!Array.isArray(p.watchlist) && !Array.isArray(p.rules) && !Array.isArray(p.baskets)) {
    return { ok: false, error: "No watchlist, rules or baskets found in that file." };
  }
  if (Array.isArray(p.watchlist)) write("watchlist", p.watchlist);
  if (Array.isArray(p.rules)) write("rules", p.rules);
  if (Array.isArray(p.baskets)) write("baskets", p.baskets);
  return { ok: true };
}
