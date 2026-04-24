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
  /** The user's own player name in this game (display only). May be missing
   *  on puzzles imported before this field existed. */
  player?: string;
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
  /** Lichess speed bucket (bullet/blitz/rapid/...). May be missing on
   *  puzzles imported before this field existed. */
  speed?: GameSpeed;
  /** Display-form time control like "3+2" or "5+0". May be missing on
   *  puzzles imported before this field existed. */
  timeControl?: string;
}

export type SolveStatus = 'ok' | 'fail';

/**
 * Progress filter for the puzzle list:
 *   · unseen — never attempted
 *   · retry  — first-try failed (includes "show solution" give-ups)
 *   · all    — everything in the store
 * `unseen` is the default on app start so the user always lands on
 * something fresh. Blunder/mistake severity was dropped as a filter
 * because the whole library is already blunders-only in practice
 * (mistakes are rare + less instructive).
 */
export type Filter = 'unseen' | 'retry' | 'all';

/**
 * Which game phase the puzzle occurred in. Classified by how many plies
 * had been played before the critical position — see `phaseOf` on the
 * page. The exact thresholds are heuristic but close to how commentators
 * carve up a game (opening ≈ first dozen moves, endgame ≈ move 30+).
 */
export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/** Phase filter for the sidebar. `'all'` matches every puzzle. */
export type PhaseFilter = 'all' | GamePhase;

/**
 * ECO opening filter. `'all'` matches every puzzle. A single letter
 * (`'A'`–`'E'`) matches the whole opening family. Any other string is
 * matched as an exact ECO code prefix (e.g. `'B21'`).
 */
export type EcoFilter = 'all' | string;

/** Lichess game speed bucket. `'unknown'` covers PGNs with no Event tag. */
export type GameSpeed =
  | 'ultraBullet'
  | 'bullet'
  | 'blitz'
  | 'rapid'
  | 'classical'
  | 'correspondence'
  | 'unknown';

/** Speed filter for the sidebar. `'all'` matches every puzzle. */
export type SpeedFilter = 'all' | GameSpeed;

export interface SessionStats {
  correct: number;
  wrong: number;
  streak: number;
}
