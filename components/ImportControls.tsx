'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Puzzle } from '@/lib/types';
import {
  loadUsername,
  saveUsername,
  loadOldestFetchedMs,
  saveOldestFetchedMs,
  loadFetchedGameCount,
  saveFetchedGameCount,
} from '@/lib/storage';

interface ImportControlsProps {
  /** Called as puzzles arrive. May be called many times during a streamed import. */
  onImport: (newPuzzles: Puzzle[]) => void;
  /** Wipe all imported puzzles and solved progress from cache. */
  onClearAll: () => void;
  /** How many unsolved puzzles are currently in the store. Used to
   *  decide when to quietly pull another batch from Lichess. */
  unseenCount: number;
}

interface ImportStatus {
  kind: 'idle' | 'working' | 'ok' | 'error';
  message?: string;
  /** Current/total game count for the progress bar, when known. */
  progress?: { current: number; total: number };
}

/** Games imported per batch. Small enough to feel responsive, large enough
 *  that the user usually gets several puzzles per click. */
const BATCH_SIZE = 20;

/** When the store's unseen-puzzle count drops to or below this, the
 *  auto-import effect will quietly pull the next batch — provided a
 *  username exists and we haven't paginated past the user's history. */
const AUTO_IMPORT_THRESHOLD = 5;

/**
 * Sidebar panel with:
 *   · username input
 *   · primary IMPORT button → streams `BATCH_SIZE` games from Lichess
 *   · PGN file upload fallback for when the user has a file in hand
 *   · clear-cache escape hatch
 *
 * Auto-import behaviour: once the user has done at least one manual import
 * (so we have a pagination cursor), the panel will quietly pull the next
 * batch of older games whenever the unseen-puzzle count drops to
 * `AUTO_IMPORT_THRESHOLD`. This keeps the list stocked without requiring
 * the user to click import again. The loop only stops when the user
 * paginates past the beginning of their recorded history.
 *
 * Streaming events are decoded line-by-line; puzzles are handed back to
 * the parent via onImport as each game finishes analysis, so the sidebar
 * list grows in real-time.
 */
export function ImportControls({ onImport, onClearAll, unseenCount }: ImportControlsProps) {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' });
  /**
   * UNIX ms of the oldest Lichess game already imported. Serves as the
   * pagination cursor for subsequent (auto-triggered) imports. `null`
   * until the first successful import.
   */
  const [oldestMs, setOldestMs] = useState<number | null>(null);
  /**
   * Cumulative games pulled from Lichess across all batches (persists
   * across reloads). Purely informational — shown in the counter so the
   * user can see how far the auto-import has gotten. No hard cap.
   */
  const [fetchedCount, setFetchedCount] = useState(0);
  /**
   * True once we've hydrated `oldestMs`, `fetchedCount`, and `username`
   * from localStorage. Gating the auto-import effect on this prevents
   * it from firing a stale import on first render.
   */
  const [hydrated, setHydrated] = useState(false);
  /**
   * `working` lives as a ref too so the auto-import effect can check it
   * without depending on the state value — avoids a render-loop where
   * setState → re-run effect → setState.
   */
  const workingRef = useRef(false);
  /**
   * Set once Lichess returns 0 games for a requested cursor — means the
   * user has been paginated to the beginning of their recorded history.
   * Stops the auto-import loop so we don't spin forever on an empty tail.
   */
  const [exhausted, setExhausted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUsername(loadUsername());
    setOldestMs(loadOldestFetchedMs());
    setFetchedCount(loadFetchedGameCount());
    setHydrated(true);
  }, []);

  /* ── Streaming import directly from Lichess ── */
  /**
   * Import a batch of up to BATCH_SIZE games from Lichess.
   * When `untilCursor` is provided, imports games strictly older than that
   * timestamp (used for every import except the very first).
   */
  const runImport = useCallback(
    async (untilCursor?: number | null) => {
      const name = username.trim();
      if (!name) {
        setStatus({ kind: 'error', message: 'enter your Lichess username first' });
        return;
      }
      saveUsername(name);

      workingRef.current = true;
      const label = untilCursor ? 'older ' : '';
      setStatus({
        kind: 'working',
        message: `importing up to ${BATCH_SIZE} ${label}games...`,
      });

      let totalPuzzles = 0;
      let parsedGames = 0;
      try {
        const res = await fetch('/api/lichess/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: name,
            max: BATCH_SIZE,
            ...(untilCursor ? { until: untilCursor } : {}),
          }),
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          setStatus({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
          workingRef.current = false;
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Read NDJSON line-by-line. Each non-empty line is one JSON event.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(trimmed);
            } catch {
              continue;
            }
            const type = evt.type as string;

            if (type === 'status') {
              setStatus((prev) => ({
                kind: 'working',
                message: (evt.message as string) ?? prev.message,
                progress: prev.progress,
              }));
            } else if (type === 'parsed') {
              parsedGames = (evt.total as number) ?? 0;
              setStatus({
                kind: 'working',
                message: `parsed ${parsedGames} games — starting analysis...`,
                progress: { current: 0, total: parsedGames },
              });
            } else if (type === 'progress') {
              setStatus({
                kind: 'working',
                message: (evt.message as string) ?? 'analyzing...',
                progress: {
                  current: (evt.current as number) ?? 0,
                  total: (evt.total as number) ?? parsedGames,
                },
              });
            } else if (type === 'puzzles') {
              const puzzles = (evt.puzzles as Puzzle[]) ?? [];
              if (puzzles.length > 0) {
                onImport(puzzles);
                totalPuzzles += puzzles.length;
              }
            } else if (type === 'game-error') {
              // Non-fatal — note in the console and keep going.
              console.warn(
                `game ${(evt.gameId as string) ?? '?'} failed:`,
                evt.message
              );
            } else if (type === 'done') {
              // Advance the pagination cursor. Subtract 1ms so the next
              // import doesn't re-request the boundary game.
              const serverOldest = evt.oldestMs;
              if (typeof serverOldest === 'number' && serverOldest > 0) {
                const nextCursor = serverOldest - 1;
                // Only move the cursor backwards (older). Never let a newer
                // batch overwrite an older cursor already on disk.
                setOldestMs((prev) => {
                  const next = prev == null ? nextCursor : Math.min(prev, nextCursor);
                  saveOldestFetchedMs(next);
                  return next;
                });
              }
              // Accumulate the game count for the counter display.
              const batchParsed = (evt.parsedGames as number) ?? parsedGames ?? 0;
              setFetchedCount((prev) => {
                const next = prev + batchParsed;
                saveFetchedGameCount(next);
                return next;
              });
              // Zero games back means we've paginated past the user's
              // oldest recorded game — no point asking again.
              if (batchParsed === 0) setExhausted(true);
              setStatus({
                kind: 'ok',
                message: `imported ${batchParsed} games → ${evt.generated} puzzles`,
              });
              workingRef.current = false;
              return;
            } else if (type === 'error') {
              setStatus({
                kind: 'error',
                message: (evt.message as string) ?? 'stream error',
              });
              workingRef.current = false;
              return;
            }
          }
        }

        // Fallback if the server ended without a final `done` event.
        setFetchedCount((prev) => {
          const next = prev + parsedGames;
          saveFetchedGameCount(next);
          return next;
        });
        setStatus({
          kind: 'ok',
          message: `${parsedGames} games → ${totalPuzzles} puzzles`,
        });
      } catch (err) {
        setStatus({ kind: 'error', message: (err as Error).message });
      } finally {
        workingRef.current = false;
      }
    },
    [username, onImport]
  );

  /* ── PGN file upload fallback (single-shot JSON) ──
     For users who have a PGN exported from somewhere and don't want to
     wait on the Lichess API. Kept alongside the streaming importer so
     both paths work. */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be picked again
    if (!file) return;

    const name = username.trim();
    if (!name) {
      setStatus({ kind: 'error', message: 'enter your Lichess username first' });
      return;
    }
    saveUsername(name);

    workingRef.current = true;
    setStatus({ kind: 'working', message: `reading ${file.name}...` });
    const pgn = await file.text();

    setStatus({ kind: 'working', message: 'analyzing with stockfish...' });
    try {
      const res = await fetch('/api/import-pgn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn, username: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const puzzles = (data.puzzles ?? []) as Puzzle[];
      onImport(puzzles);
      setStatus({
        kind: 'ok',
        message: `imported ${data.parsedGames} games → ${data.generated} puzzles`,
      });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    } finally {
      workingRef.current = false;
    }
  };

  /* ── Auto-import loop ──
     When the user has worked their way through most of what's loaded
     (unseenCount ≤ AUTO_IMPORT_THRESHOLD), quietly pull the next batch.
     Only fires after a first manual import has established a cursor, and
     stops when the user runs out of Lichess history. */
  useEffect(() => {
    if (!hydrated) return;
    if (workingRef.current) return;
    if (exhausted) return;
    if (oldestMs == null) return;
    if (unseenCount > AUTO_IMPORT_THRESHOLD) return;
    if (!username.trim()) return;
    runImport(oldestMs);
  }, [hydrated, oldestMs, unseenCount, username, exhausted, runImport]);

  const pct =
    status.progress && status.progress.total > 0
      ? Math.min(100, Math.round((status.progress.current / status.progress.total) * 100))
      : null;

  const working = status.kind === 'working';

  return (
    <div className="import-panel">
      <div className="side-prompt">import lichess games</div>
      <input
        type="text"
        placeholder="your Lichess username"
        className="import-input"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        spellCheck={false}
        autoCapitalize="none"
        disabled={working}
      />
      <button
        className="import-btn prim"
        disabled={working}
        onClick={() =>
          runImport(
            // First click (no cursor yet) imports the most recent games.
            // Every subsequent manual click continues paginating older.
            oldestMs ?? undefined
          )
        }
      >
        {working ? '· importing ·' : 'import'}
      </button>
      {fetchedCount > 0 && !working && (
        <div className="import-counter">
          {fetchedCount} games imported · auto-import{' '}
          {exhausted ? 'off (history exhausted)' : 'on'}
        </div>
      )}
      <button
        className="import-btn"
        disabled={working}
        onClick={() => fileRef.current?.click()}
      >
        or upload PGN file
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pgn,text/plain"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <button
        className="import-btn danger"
        disabled={working}
        onClick={() => {
          if (
            window.confirm(
              'Clear all imported puzzles and solved progress? Seed puzzles will remain.'
            )
          ) {
            onClearAll();
            setOldestMs(null);
            setFetchedCount(0);
            setExhausted(false);
            setStatus({ kind: 'ok', message: 'cache cleared' });
          }
        }}
      >
        clear all puzzles
      </button>
      {pct !== null && working && (
        <div className="import-progress" aria-label="analysis progress">
          <div className="import-progress-bar" style={{ width: pct + '%' }} />
          <div className="import-progress-text">
            {status.progress?.current ?? 0} / {status.progress?.total ?? 0}
          </div>
        </div>
      )}
      {status.message && (
        <div
          className={
            'import-status ' +
            (status.kind === 'error' ? 'err' : status.kind === 'ok' ? 'ok' : 'work')
          }
        >
          {status.message}
        </div>
      )}
    </div>
  );
}
