import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Chess } from 'chess.js';

/**
 * Stockfish analysis service — spawns the local `stockfish` binary and
 * speaks UCI to it.
 *
 * Requires Stockfish installed on the host machine:
 *   macOS:  brew install stockfish
 *   Linux:  apt install stockfish  (or equivalent)
 *
 * If the binary is missing, analyzePosition throws a clear error so the
 * caller can surface it in the UI.
 *
 * Performance note: each call spawns a fresh process. That's ~10ms of
 * overhead on top of the search itself — fine for batch puzzle-generation
 * (50 positions × depth 18 finishes in seconds), and dramatically simpler
 * than holding a long-running engine across requests. If you hit a
 * bottleneck, switch to a singleton engine pool keyed on FEN.
 */

export interface AnalyzeOpts {
  fen: string;
  /** Search depth. Default 18 — strong, fast for personal use. */
  depth?: number;
  /** Number of principal variations. Default 1 (just the best move). */
  multiPv?: number;
}

export interface AnalysisLine {
  /** Eval in centipawns (white-positive). null if `mate` is set. */
  cp: number | null;
  /** Moves to mate, signed (positive = white mates). null if `cp` is set. */
  mate: number | null;
  /** UCI moves of the principal variation. */
  pvUci: string[];
  /** Same PV converted to SAN — matches what the puzzle UI compares against. */
  pvSan: string[];
}

export interface AnalysisResult {
  fen: string;
  depth: number;
  /** Principal variations, sorted best-first. */
  lines: AnalysisLine[];
}

/** Convert a UCI move ("e2e4", "e7e8q") to SAN against a given FEN. */
function uciToSan(fen: string, uci: string): string {
  const c = new Chess(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
  const m = c.move({ from, to, promotion });
  return m.san;
}

function uciLineToSan(fen: string, uciMoves: string[]): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of uciMoves) {
    const from = u.slice(0, 2);
    const to = u.slice(2, 4);
    const promotion = u.length > 4 ? u.slice(4, 5) : undefined;
    try {
      const m = c.move({ from, to, promotion });
      out.push(m.san);
    } catch {
      break; // engine sometimes emits truncated PVs in low-time scenarios
    }
  }
  return out;
}

/**
 * Drive a single Stockfish process through one analysis request.
 * Resolves with the parsed `info ... pv ...` output for each multipv slot
 * after the engine emits `bestmove`.
 */
function runUci(opts: AnalyzeOpts): Promise<AnalysisResult> {
  const { fen, depth = 18, multiPv = 1 } = opts;

  return new Promise((resolve, reject) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn('stockfish', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(
        new Error(
          `Could not spawn 'stockfish': ${(err as Error).message}. ` +
            `Install it with 'brew install stockfish' (macOS) or 'apt install stockfish' (Linux).`
        )
      );
      return;
    }

    proc.on('error', (err) => {
      reject(
        new Error(
          `Stockfish error: ${err.message}. Is the 'stockfish' binary on your PATH? ` +
            `Try 'brew install stockfish' (macOS).`
        )
      );
    });

    // Per-multipv slot — index 0 = best line. Stockfish updates these many
    // times during search; we keep the latest.
    const lines: Map<number, AnalysisLine> = new Map();
    let buffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      // Split on newlines, but leave any trailing partial line in the buffer.
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    });

    function handleLine(line: string) {
      if (line.startsWith('info ') && line.includes(' pv ')) {
        const mpvMatch = line.match(/\bmultipv\s+(\d+)\b/);
        const cpMatch = line.match(/\bscore cp\s+(-?\d+)/);
        const mateMatch = line.match(/\bscore mate\s+(-?\d+)/);
        const pvMatch = line.match(/\bpv\s+(.+?)(?:\s+(?:bmc|hashfull|nps|tbhits|time|nodes|depth)\s+|$)/);
        const mpv = mpvMatch ? parseInt(mpvMatch[1], 10) : 1;
        const pvUci = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
        if (pvUci.length === 0) return;

        // White-relative score: Stockfish reports cp from side-to-move POV;
        // flip the sign when it's black to move so callers always get a
        // white-positive value.
        const sideToMove = fen.split(' ')[1]; // 'w' or 'b'
        const flip = sideToMove === 'b' ? -1 : 1;

        const cp = cpMatch ? parseInt(cpMatch[1], 10) * flip : null;
        const mate = mateMatch ? parseInt(mateMatch[1], 10) * flip : null;

        let pvSan: string[] = [];
        try {
          pvSan = uciLineToSan(fen, pvUci);
        } catch {
          // ignore — partial/illegal PV
        }

        lines.set(mpv, { cp, mate, pvUci, pvSan });
      } else if (line.startsWith('bestmove')) {
        proc.stdin.end();
        const sorted = Array.from(lines.entries())
          .sort(([a], [b]) => a - b)
          .map(([, v]) => v);
        resolve({ fen, depth, lines: sorted });
      }
    }

    proc.stderr.on('data', () => {
      // Stockfish prints its banner to stderr; ignore.
    });

    // Drive the engine
    proc.stdin.write('uci\n');
    proc.stdin.write(`setoption name MultiPV value ${multiPv}\n`);
    proc.stdin.write('isready\n');
    proc.stdin.write(`position fen ${fen}\n`);
    proc.stdin.write(`go depth ${depth}\n`);

    // Safety timeout — kill the process if it goes longer than 30s
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill();
        reject(new Error(`Stockfish timed out at depth ${depth}`));
      }
    }, 30_000);
  });
}

export async function analyzePosition(opts: AnalyzeOpts): Promise<AnalysisResult> {
  return runUci(opts);
}

/** Convenience: just give me the best move at this position, as SAN. */
export async function bestMoveSan(fen: string, depth = 18): Promise<string | null> {
  const res = await analyzePosition({ fen, depth, multiPv: 1 });
  return res.lines[0]?.pvSan[0] ?? null;
}

// Suppress unused-import warning when the conversion helper is only used
// internally by uciLineToSan; keep the export available for callers.
export { uciToSan };
