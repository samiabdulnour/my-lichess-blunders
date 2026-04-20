import type { ParsedGame, ParsedMove } from './pgn';
import type { GameSpeed, Puzzle } from './types';
import { bestMoveSan, analyzePosition } from './stockfish';

/**
 * Pull the Lichess speed name out of the Event header. Lichess writes
 * Events like "Rated blitz game" or "Rated 3+2 • Blitz Arena". We match
 * the speed name case-insensitively and fall back to deriving it from
 * the TimeControl header if needed.
 */
function deriveSpeed(headers: Record<string, string>): GameSpeed {
  const event = (headers['event'] ?? '').toLowerCase();
  if (event.includes('ultrabullet')) return 'ultraBullet';
  if (event.includes('bullet')) return 'bullet';
  if (event.includes('blitz')) return 'blitz';
  if (event.includes('rapid')) return 'rapid';
  if (event.includes('classical')) return 'classical';
  if (event.includes('correspondence')) return 'correspondence';

  // Fallback: classify by total estimated game length using Lichess's rule
  //   bucket = base + 40 * increment   (in seconds)
  const tc = headers['timecontrol'] ?? '';
  if (!tc || tc === '-') return 'correspondence';
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return 'unknown';
  const base = parseInt(m[1], 10);
  const inc = m[2] ? parseInt(m[2], 10) : 0;
  const bucket = base + 40 * inc;
  if (bucket < 30) return 'ultraBullet';
  if (bucket < 180) return 'bullet';
  if (bucket < 480) return 'blitz';
  if (bucket < 1500) return 'rapid';
  return 'classical';
}

/**
 * Render the PGN TimeControl header (e.g. "180+2") into the conventional
 * "minutes+increment" form ("3+2"). Returns the raw string when it
 * doesn't fit the pattern.
 */
function formatTimeControl(tc: string): string {
  if (!tc || tc === '-') return 'corr.';
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/);
  if (!m) return tc;
  const base = parseInt(m[1], 10);
  const inc = m[2] ? parseInt(m[2], 10) : 0;
  // < 60s base => show seconds (e.g. ultraBullet "30+0"); otherwise minutes.
  const baseDisplay = base < 60 ? `${base}s` : `${Math.round(base / 60)}`;
  return `${baseDisplay}+${inc}`;
}

/**
 * Eval-drop thresholds (in centipawns) for puzzle classification.
 * Tweak these in one place to change the whole pipeline.
 */
export const THRESHOLDS = {
  /** Minimum eval drop to count as a "mistake" puzzle. */
  mistakeCp: 100,
  /** Minimum eval drop to count as a "blunder" puzzle. */
  blunderCp: 200,
};

/**
 * Compare a player name to the user's username. Lichess usernames are
 * case-insensitive, so we lower-case both sides.
 */
function isUser(name: string, username: string): boolean {
  return name.trim().toLowerCase() === username.trim().toLowerCase();
}

/**
 * Cap-able eval value: mate scores are clamped to ±10000 for arithmetic
 * (we treat them as "lost" / "won" for purposes of detecting eval drops).
 */
function evalToCp(m: ParsedMove): number {
  if (m.mate !== null) return m.mate > 0 ? 10000 : -10000;
  return m.evalCp ?? 0;
}

/**
 * Walk a parsed game and turn each critical mistake by `username` into a
 * Puzzle. For each critical position we ask Stockfish for the best move
 * and store it as the puzzle's answer.
 *
 * "Critical" means: the user's move dropped the eval (from their POV) by
 * at least `THRESHOLDS.mistakeCp` centipawns.
 */
export async function generatePuzzlesFromGame(
  game: ParsedGame,
  username: string
): Promise<Puzzle[]> {
  // Identify which color the user played in this game.
  let userColor: 'w' | 'b' | null = null;
  if (isUser(game.white, username)) userColor = 'w';
  else if (isUser(game.black, username)) userColor = 'b';
  if (!userColor) return [];

  const puzzles: Puzzle[] = [];
  const moves = game.moves;
  const speed = deriveSpeed(game.headers);
  const timeControl = formatTimeControl(game.headers['timecontrol'] ?? '');

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    if (mv.color !== userColor) continue; // only the user's moves
    if (i === 0) continue; // need an "eval before" reference

    const prev = moves[i - 1];
    const evalBeforeCp = evalToCp(prev); // eval at the position the user faced
    const evalAfterCp = evalToCp(mv);

    // Eval is white-positive; flip to side-relative so a drop is always
    // positive regardless of color.
    const sideSign = userColor === 'w' ? 1 : -1;
    const evalBeforeSide = evalBeforeCp * sideSign;
    const evalAfterSide = evalAfterCp * sideSign;
    const dropCp = evalBeforeSide - evalAfterSide;

    if (dropCp < THRESHOLDS.mistakeCp) continue;

    // Skip the opening (first 6 plies) — almost always book noise.
    if (mv.ply <= 6) continue;

    // Get the engine's best move at the position the user faced.
    let best: string | null = null;
    try {
      best = await bestMoveSan(mv.fenBefore, 18);
    } catch (err) {
      console.warn(`Skipping puzzle at ply ${mv.ply}: ${(err as Error).message}`);
      continue;
    }
    if (!best) continue;
    if (best === mv.san) continue; // engine agrees with the user — no puzzle

    // Build the setup move list (everything before the mistake) in SAN.
    const setupMoves = moves.slice(0, i).map((m) => m.san);

    const opponent = userColor === 'w' ? game.black : game.white;
    const player = userColor === 'w' ? game.white : game.black;
    puzzles.push({
      id: `${game.gameId ?? 'unknown'}_${mv.ply}`,
      gameId: game.gameId ?? 'unknown',
      site: game.site ?? 'https://lichess.org',
      player,
      opponent,
      eco: game.eco,
      date: game.date,
      abdulsColor: userColor === 'w' ? 'white' : 'black',
      setupMoves,
      bestMove: best,
      mistakeMove: mv.san,
      evalBefore: evalBeforeSide / 100, // back to pawn units, side-relative
      evalAfter: evalAfterSide / 100,
      drop: dropCp / 100,
      type: dropCp >= THRESHOLDS.blunderCp ? 'blunder' : 'mistake',
      speed,
      timeControl,
    });
  }

  return puzzles;
}

// Re-export so the API route can import everything from one place if it wants.
export { analyzePosition };
