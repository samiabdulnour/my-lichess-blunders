import type { Puzzle } from './types';

/**
 * Tiny localStorage wrapper for persisting imported puzzles across reloads.
 *
 * Keys:
 *   bt.puzzles          — Puzzle[] generated from imports
 *   bt.username         — the Lichess username used for imports (convenience)
 *   bt.solved           — { [puzzleId]: 'ok' | 'fail' } progress
 *   bt.oldestFetchedMs  — UNIX ms of the oldest game imported from Lichess,
 *                         used as a cursor for pagination.
 *   bt.fetchedGames     — cumulative count of games pulled from Lichess
 *                         across all batches. Caps auto-fetch at 200.
 *
 * Graduate this to a real database (SQLite via better-sqlite3, or Postgres)
 * when you start caring about multi-device or multi-user.
 */

const KEY_PUZZLES = 'bt.puzzles';
const KEY_USERNAME = 'bt.username';
const KEY_SOLVED = 'bt.solved';
const KEY_OLDEST = 'bt.oldestFetchedMs';
const KEY_FETCHED = 'bt.fetchedGames';
const KEY_RANDOM = 'bt.randomOrder';
const KEY_THEME = 'bt.theme';

export function loadPuzzles(): Puzzle[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY_PUZZLES);
    if (!raw) return [];
    return JSON.parse(raw) as Puzzle[];
  } catch {
    return [];
  }
}

export function savePuzzles(puzzles: Puzzle[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY_PUZZLES, JSON.stringify(puzzles));
  } catch (err) {
    console.warn('Failed to save puzzles to localStorage:', err);
  }
}

export function loadUsername(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(KEY_USERNAME) ?? '';
}

export function saveUsername(username: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY_USERNAME, username);
}

export function loadSolved(): Record<string, 'ok' | 'fail'> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY_SOLVED);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveSolved(solved: Record<string, 'ok' | 'fail'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY_SOLVED, JSON.stringify(solved));
  } catch (err) {
    console.warn('Failed to save solved map to localStorage:', err);
  }
}

/** Merge two puzzle lists, deduping by id. Later entries win. */
export function mergePuzzles(a: Puzzle[], b: Puzzle[]): Puzzle[] {
  const map = new Map<string, Puzzle>();
  for (const p of a) map.set(p.id, p);
  for (const p of b) map.set(p.id, p);
  return Array.from(map.values());
}

/**
 * Wipe all imported puzzles, solved progress, and the pagination cursor
 * from localStorage. The username is preserved so the user doesn't have to
 * retype it after clearing. Seed puzzles served from `/api/puzzles` are
 * unaffected (they live in code, not storage).
 */
export function clearAll(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY_PUZZLES);
  window.localStorage.removeItem(KEY_SOLVED);
  window.localStorage.removeItem(KEY_OLDEST);
  window.localStorage.removeItem(KEY_FETCHED);
}

/**
 * Cursor for "fetch older games" pagination. Stores the UNIX ms timestamp
 * of the oldest Lichess game already imported; the next batch fetches
 * games strictly older than this.
 */
export function loadOldestFetchedMs(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(KEY_OLDEST);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function saveOldestFetchedMs(ms: number | null): void {
  if (typeof window === 'undefined') return;
  if (ms == null) window.localStorage.removeItem(KEY_OLDEST);
  else window.localStorage.setItem(KEY_OLDEST, String(ms));
}

/**
 * Cumulative number of Lichess games that have been fetched (summed
 * across all batches). Used to enforce the `MAX_FETCHED_GAMES` cap so
 * the auto-fetch loop eventually stops.
 */
export function loadFetchedGameCount(): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(KEY_FETCHED);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function saveFetchedGameCount(n: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY_FETCHED, String(Math.max(0, Math.floor(n))));
}

/* ── User-preference toggles ──
   Tiny boolean / enum settings kept in localStorage so they survive
   reloads. Each has a default that matches "first-time user" behavior. */

/** Random-order toggle. When true, `next()` picks a random unsolved
 *  puzzle from the filtered list instead of the next one in order. */
export function loadRandomOrder(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(KEY_RANDOM) === '1';
}

export function saveRandomOrder(on: boolean): void {
  if (typeof window === 'undefined') return;
  if (on) window.localStorage.setItem(KEY_RANDOM, '1');
  else window.localStorage.removeItem(KEY_RANDOM);
}

export type ThemeMode = 'light' | 'dark';

/** Color theme. Defaults to 'light' (the original terminal-on-paper
 *  look). When 'dark', the app inverts to a full-black background suite
 *  driven by a `[data-theme="dark"]` selector in globals.css. */
export function loadTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const v = window.localStorage.getItem(KEY_THEME);
  return v === 'dark' ? 'dark' : 'light';
}

export function saveTheme(t: ThemeMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY_THEME, t);
}
