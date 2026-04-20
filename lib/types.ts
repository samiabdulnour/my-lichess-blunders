/**
 * Shape of a single puzzle. Mirrors the original HTML project's puzzle objects
 * so that the UI port is a 1:1 swap, but the data layer is now stored
 * separately (no more giant in-file PUZZLES const).
 */
export interface Puzzle {
  /** Stable identifier — for Lichess-derived puzzles use `${gameId}_${plyIndex}`. */
  id: string;
  /** Lichess game id this puzzle was derived from. */
  gameId: string;
  /** URL to the original game on lichess.org. */
  site: string;
  /** Opponent name (display only). */
  opponent: string;
  /** Opening ECO code, e.g. "C50". */
  eco: string;
  /** Date in "YYYY.MM.DD" format. */
  date: string;
  /** Which color the user was playing. */
  abdulsColor: 'white' | 'black';
  /**
   * SAN moves played from the starting position up to (but not including) the
   * critical position. The puzzle expects the user to find `bestMove` next.
   */
  setupMoves: string[];
  /** SAN of the engine's best move at the critical position. */
  bestMove: string;
  /** SAN of the move the user actually played in the original game. */
  mistakeMove: string;
  /** Eval (in pawn units, white-positive) before the mistake. */
  evalBefore: number;
  /** Eval (in pawn units, white-positive) after the mistake. */
  evalAfter: number;
  /** Magnitude of eval drop (always a positive number, in pawn units). */
  drop: number;
  /** Severity classification. */
  type: 'blunder' | 'mistake';
}

export type SolveStatus = 'ok' | 'fail';

export type Filter = 'all' | 'blunder' | 'unseen';

export interface SessionStats {
  correct: number;
  wrong: number;
  streak: number;
}
