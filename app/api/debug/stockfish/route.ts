import { spawn } from 'node:child_process';
import { bestMoveSan } from '@/lib/stockfish';

/**
 * GET /api/debug/stockfish
 *
 * Returns a JSON payload describing whether Stockfish is callable from the
 * server process, how long it took, and what it returned for a trivial
 * starting-position query. Intended as a deployment-sanity check — point
 * your browser at the route on a live deployment to confirm the engine is
 * wired up before blaming the generator.
 */
export const runtime = 'nodejs';

function runCommand(cmd: string, args: string[], timeoutMs = 5000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(cmd, args);
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => resolve({ stdout, stderr, code }));
    setTimeout(() => {
      if (!proc.killed) proc.kill();
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

export async function GET() {
  const result: Record<string, unknown> = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    env: {
      PATH: process.env.PATH ?? '(unset)',
    },
  };

  // 1) Is the binary on PATH?
  try {
    const which = await runCommand('which', ['stockfish']);
    result.whichStockfish = which.stdout.trim() || '(not found)';
  } catch (err) {
    result.whichStockfish = `ERROR: ${(err as Error).message}`;
  }

  // 2) Can we spawn it at all?
  try {
    const v = await runCommand('stockfish', ['--help'], 3000);
    result.stockfishHelpExit = v.code;
    result.stockfishHelpFirstLine = (v.stdout || v.stderr).split('\n')[0];
  } catch (err) {
    result.stockfishHelpError = (err as Error).message;
  }

  // 3) Full UCI round-trip — what the generator actually needs.
  const t0 = Date.now();
  try {
    const best = await bestMoveSan(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      10,
    );
    result.bestMoveStartingPos = best;
    result.bestMoveMs = Date.now() - t0;
    result.engineOk = true;
  } catch (err) {
    result.bestMoveError = (err as Error).message;
    result.bestMoveMs = Date.now() - t0;
    result.engineOk = false;
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
