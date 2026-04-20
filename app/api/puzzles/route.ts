import { NextResponse } from 'next/server';
import { SEED_PUZZLES } from '@/lib/seed-puzzles';
import type { Puzzle } from '@/lib/types';

/**
 * GET /api/puzzles
 *
 * Returns the puzzle list for the trainer UI.
 *
 * Today: serves the hand-crafted seed puzzles from `lib/seed-puzzles.ts`.
 *
 * Once `lib/puzzle-generator.ts` is wired up, this should read generated
 * puzzles from persistent storage (a SQLite file or `data/puzzles.json`)
 * and return them here. Pagination, filtering, and per-user partitioning
 * can be added at that point.
 */
export async function GET() {
  const puzzles: Puzzle[] = SEED_PUZZLES;
  return NextResponse.json({ puzzles });
}
