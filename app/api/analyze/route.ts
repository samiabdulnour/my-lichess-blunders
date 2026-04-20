import { NextResponse } from 'next/server';
import { analyzePosition } from '@/lib/stockfish';

/**
 * POST /api/analyze
 *
 * Body: { fen: string, depth?: number, multiPv?: number }
 *
 * Runs Stockfish on the given position and returns the engine's eval and
 * principal variation(s). Used both to fact-check Lichess's evals and to
 * find best replies for puzzle answers.
 *
 * Stockfish placement: see `lib/stockfish.ts` for the choice between
 * a local Node binary, the Lichess cloud-eval API, or client-side WASM.
 */
export async function POST(req: Request) {
  let body: { fen?: string; depth?: number; multiPv?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { fen, depth = 18, multiPv = 1 } = body;
  if (!fen || typeof fen !== 'string') {
    return NextResponse.json({ error: 'fen is required' }, { status: 400 });
  }

  try {
    const result = await analyzePosition({ fen, depth, multiPv });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
