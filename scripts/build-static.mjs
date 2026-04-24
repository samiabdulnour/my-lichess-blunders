#!/usr/bin/env node
/**
 * Static-export build used by the Capacitor iOS shell.
 *
 * ── Why not just `BUILD_TARGET=static next build`? ──
 * When `output: 'export'` is set, Next.js tries to statically pre-render
 * every route in `app/` — including `app/api/*` route handlers. Those
 * handlers are genuinely dynamic (they run stockfish, stream Lichess
 * games, etc.) and refuse to be force-static, so the build errors out.
 *
 * The iOS bundle doesn't need the API routes anyway — those stay on
 * Render and are called via `NEXT_PUBLIC_API_BASE`. So the simplest fix
 * is to temporarily rename `app/api` out of the way for the duration of
 * the export, then put it back. We register exit + SIGINT handlers so
 * the directory is always restored even if the build crashes or the
 * user hits Ctrl-C.
 */

import { existsSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const API_SRC = resolve(root, 'app/api');
// Park OUTSIDE app/ — anything inside app/ is still walked by Next's
// router, including dot-directories, so we'd hit the same "route refuses
// to be static" error with a confusing `/.api-parked/...` route name.
const API_PARK = resolve(root, '.api-parked');

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  if (existsSync(API_PARK)) {
    // If something put a fresh app/api back while we were building, drop
    // the parked copy silently — don't risk clobbering real code.
    if (existsSync(API_SRC)) {
      rmSync(API_PARK, { recursive: true, force: true });
    } else {
      renameSync(API_PARK, API_SRC);
    }
  }
}

process.on('exit', restore);
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});
process.on('SIGTERM', () => {
  restore();
  process.exit(143);
});

if (!existsSync(API_SRC)) {
  console.error(`[build-static] expected ${API_SRC} to exist`);
  process.exit(1);
}

renameSync(API_SRC, API_PARK);

const result = spawnSync('npx', ['next', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, BUILD_TARGET: 'static' },
});

restore();
process.exit(result.status ?? 0);
