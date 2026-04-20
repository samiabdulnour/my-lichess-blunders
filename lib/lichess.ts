/**
 * Lichess API client.
 *
 * We fetch games directly as PGN text (rather than NDJSON) because our
 * downstream pipeline (lib/pgn.ts → lib/puzzle-generator.ts) already
 * understands PGN with `[%eval ...]` comments.
 *
 *   GET https://lichess.org/api/games/user/{username}
 *     ?max=50
 *     &tags=true         ← headers like [White], [Black], [ECO], [Date]
 *     &evals=true        ← inline `{ [%eval 0.32] }` comments per ply
 *     &clocks=false
 *     &opening=false
 *     &literate=false
 *     &moves=true
 *
 * Unauthenticated access is fine for personal use (~20 req/s). For higher
 * throughput set `LICHESS_TOKEN` in the environment.
 *
 * Docs: https://lichess.org/api#tag/Games/operation/apiGamesUser
 */

export interface FetchLichessPgnOpts {
  /** Lichess username (case-insensitive). */
  username: string;
  /** Cap on games returned. Server-side cap is 30 here to keep analysis snappy. */
  max?: number;
  /** Only return games created after this UNIX time (ms). */
  sinceMillis?: number;
  /**
   * Only return games created **before** this UNIX time (ms). Used for
   * "fetch older" pagination — pass the timestamp of the oldest game already
   * loaded to get the next batch behind it.
   */
  untilMillis?: number;
}

/** Absolute upper bound we enforce on the server, regardless of client input. */
export const LICHESS_MAX_GAMES = 50;

/**
 * Fetch up to `max` games for `username` from Lichess as a single PGN blob.
 * Returned text can be fed directly into `parsePgn` from lib/pgn.ts.
 *
 * Throws on network errors, 4xx/5xx responses from Lichess, or unknown users.
 */
export async function fetchLichessGamesPgn(opts: FetchLichessPgnOpts): Promise<string> {
  const { username, sinceMillis, untilMillis } = opts;
  const maxRequested = opts.max ?? LICHESS_MAX_GAMES;
  const max = Math.max(1, Math.min(LICHESS_MAX_GAMES, Math.floor(maxRequested)));

  if (!username.trim()) throw new Error('username is required');

  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username.trim())}`);
  url.searchParams.set('max', String(max));
  url.searchParams.set('tags', 'true');
  url.searchParams.set('evals', 'true');
  url.searchParams.set('clocks', 'false');
  url.searchParams.set('opening', 'false');
  url.searchParams.set('literate', 'false');
  url.searchParams.set('moves', 'true');
  if (sinceMillis) url.searchParams.set('since', String(sinceMillis));
  if (untilMillis) url.searchParams.set('until', String(untilMillis));

  const headers: Record<string, string> = {
    Accept: 'application/x-chess-pgn',
    'User-Agent': 'blunder-trainer/0.1',
  };
  const token = process.env.LICHESS_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) {
      throw new Error(`Lichess user "${username}" not found`);
    }
    throw new Error(`Lichess API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.text();
}
