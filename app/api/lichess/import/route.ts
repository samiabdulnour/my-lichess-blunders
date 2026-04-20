import { fetchLichessGamesPgn, LICHESS_MAX_GAMES } from '@/lib/lichess';
import { parsePgn, type ParsedGame } from '@/lib/pgn';
import { generatePuzzlesFromGame } from '@/lib/puzzle-generator';

/**
 * Parse the PGN UTCDate ("YYYY.MM.DD") + UTCTime ("HH:MM:SS") headers into
 * a UNIX millisecond timestamp. Returns null if either header is missing or
 * malformed. Falls back to the plain `date` header when UTC fields aren't
 * present.
 */
function gameStartMs(game: ParsedGame): number | null {
  const d = game.headers['utcdate'] ?? game.headers['date'];
  const t = game.headers['utctime'] ?? '00:00:00';
  if (!d) return null;
  const [y, mo, da] = d.split('.').map((s) => Number(s));
  const [h, mi, s] = t.split(':').map((s) => Number(s));
  if (!y || !mo || !da) return null;
  const ms = Date.UTC(y, mo - 1, da, h || 0, mi || 0, s || 0);
  return Number.isFinite(ms) ? ms : null;
}

/** Lichess returns games newest-first; find the minimum timestamp across them. */
function computeOldestMs(games: ParsedGame[]): number | null {
  let min: number | null = null;
  for (const g of games) {
    const ms = gameStartMs(g);
    if (ms == null) continue;
    if (min == null || ms < min) min = ms;
  }
  return min;
}

/**
 * POST /api/lichess/import
 *
 * Body: { username: string, max?: number }
 *
 * Fetches the user's recent games directly from Lichess (as PGN with eval
 * annotations), then streams NDJSON progress events as each game is analyzed:
 *
 *   {"type":"status",   "message":"fetching 30 games..."}
 *   {"type":"parsed",   "total":30}
 *   {"type":"progress", "current":0, "total":30, "message":"analyzing game 1/30 (abcd1234)"}
 *   {"type":"puzzles",  "gameIndex":0, "gameId":"abcd1234", "puzzles":[ ... ]}
 *   ... repeat progress/puzzles per game ...
 *   {"type":"done",     "parsedGames":30, "generated":42}
 *
 * On fatal error:
 *   {"type":"error", "message":"..."}
 *
 * The response Content-Type is `application/x-ndjson`; clients should read
 * the body as a stream and parse one JSON object per line.
 *
 * Stockfish runs in-process via child_process.spawn (see lib/stockfish.ts),
 * which is why this route opts into the Node.js runtime.
 */
export const runtime = 'nodejs';
// Give the analysis pipeline plenty of time — 30 games × ~3s/ply can add up.
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { username?: string; max?: number; until?: number };
  try {
    body = (await req.json()) as { username?: string; max?: number; until?: number };
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const username = (body.username ?? '').trim();
  if (!username) {
    return new Response(JSON.stringify({ error: 'username is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const maxInput = Number(body.max);
  const max = Number.isFinite(maxInput)
    ? Math.max(1, Math.min(LICHESS_MAX_GAMES, Math.floor(maxInput)))
    : LICHESS_MAX_GAMES;

  // Optional cursor for pagination — when set, Lichess returns only games
  // created strictly before this UNIX ms timestamp.
  const untilInput = Number(body.until);
  const untilMillis = Number.isFinite(untilInput) && untilInput > 0 ? Math.floor(untilInput) : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };
      try {
        const cursorNote = untilMillis
          ? ` (older than ${new Date(untilMillis).toISOString().slice(0, 10)})`
          : '';
        emit({
          type: 'status',
          message: `fetching up to ${max} games for ${username}${cursorNote}...`,
        });
        const pgn = await fetchLichessGamesPgn({ username, max, untilMillis });

        emit({ type: 'status', message: 'parsing PGN...' });
        const games = parsePgn(pgn);
        emit({ type: 'parsed', total: games.length });

        if (games.length === 0) {
          emit({
            type: 'done',
            parsedGames: 0,
            generated: 0,
            oldestMs: null,
            note: untilMillis
              ? 'no older games found — you may have reached the start of this account history'
              : 'no games returned — check the username, or confirm your games have engine analysis attached',
          });
          controller.close();
          return;
        }

        let totalPuzzles = 0;
        for (let i = 0; i < games.length; i++) {
          const game = games[i];
          emit({
            type: 'progress',
            current: i,
            total: games.length,
            message: `analyzing game ${i + 1}/${games.length}${game.gameId ? ` (${game.gameId})` : ''}`,
          });
          try {
            const puzzles = await generatePuzzlesFromGame(game, username);
            totalPuzzles += puzzles.length;
            emit({
              type: 'puzzles',
              gameIndex: i,
              gameId: game.gameId,
              puzzles,
            });
          } catch (err) {
            emit({
              type: 'game-error',
              gameIndex: i,
              gameId: game.gameId,
              message: (err as Error).message,
            });
          }
        }

        // Lichess returns games newest-first, so the last parsed game is
        // the oldest one in this batch. Emit its timestamp so the client
        // can use it as a pagination cursor for "fetch next 30 games".
        const oldestMs = computeOldestMs(games);
        emit({
          type: 'done',
          parsedGames: games.length,
          generated: totalPuzzles,
          oldestMs,
        });
      } catch (err) {
        emit({ type: 'error', message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      // Disable proxy buffering so progress events reach the browser promptly.
      'X-Accel-Buffering': 'no',
    },
  });
}
