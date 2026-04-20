import type { Puzzle } from './types';

/**
 * Seed puzzles shipped with the app.
 *
 * Intentionally empty — the UI is driven entirely by user-imported games
 * (via Lichess fetch or PGN upload). Leaving this as `[]` avoids the
 * "vs demo_white" entries cluttering the sidebar on a fresh install.
 *
 * If you want to preload curated examples, drop Puzzle objects in here;
 * `app/api/puzzles/route.ts` returns this array unchanged.
 */
export const SEED_PUZZLES: Puzzle[] = [];
