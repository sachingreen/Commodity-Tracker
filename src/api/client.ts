import type { Board, SeriesMap } from "./types";

/**
 * The data layer is a set of versioned JSON documents published to the same
 * origin: /api/v1/board.json and /api/v1/series.json. They are ordinary
 * cacheable GETs served from GitHub's CDN — there is no server to call.
 *
 * Because there is no server, there is also no retry-on-the-backend. A failed
 * load surfaces to the user as an error state, not an empty board.
 */
const BASE = `${import.meta.env.BASE_URL}api/v1`;

export interface Payload { board: Board; series: SeriesMap }

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export async function load(signal?: AbortSignal): Promise<Payload> {
  const [board, series] = await Promise.all([
    getJSON<Board>("board.json", signal),
    getJSON<{ series: SeriesMap }>("series.json", signal).then((d) => d.series),
  ]);
  if (!board?.instruments?.length) throw new Error("board.json contained no instruments");
  return { board, series };
}
