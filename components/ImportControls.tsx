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

/** Games fetched per batch. Small enough to feel responsive, large enough
 *  that the user usually gets several puzzles per click. */
const BATCH_SIZE = 20;

/** Hard upper bound on cumulative Lichess games pulled. The auto-fetch
 *  loop stops once this is hit so we don't silently chew through a user's
 *  entire game history. */
const MAX_FETCHED_GAMES = 200;

/** When the store's unseen-puzzle count drops to or below this, the
 *  auto-fetch effect will quietly pull the next batch — provided a
 *  username exists and we haven't hit `MAX_FETCHED_GAMES`. */
const AUTO_FETCH_THRESHOLD = 5;

/**
 * Sidebar panel with:
 *   · username input
 *   · a single IMPORT button → fetches `BATCH_SIZE` games from Lichess
 *   · a small clear-cache escape hatch
 *
 * Auto-fetch behaviour: once the user has done at least one manual fetch
 * (so we have a pagination cursor), the panel will quietly pull the next
 * batch of older games whenever the unseen-puzzle count drops to
 * `AUTO_FETCH_THRESHOLD`. This keeps the list stocked without requiring
 * the user to click "fetch more" ever again. The loop terminates when
 * cumulative games fetched reaches `MAX_FETCHED_GAMES`.
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
   * pagination cursor for subsequent (auto-triggered) fetches. `null`
   * until the first successful fetch.
   */
  const [oldestMs, setOldestMs] = useState<number | null>(null);
  /**
   * Cumulative games pulled from Lichess across all batches (persists
   * across reloads). Compared to `MAX_FETCHED_GAMES` to cap the
   * auto-fetch loop.
   */
  const [fetchedCount, setFetchedCount] = useState(0);
  /**
   * True once we've hydrated `oldestMs`, `fetchedCount`, and `username`
   * from localStorage. Gating the auto-fetch effect on this prevents
   * it from firing a stale fetch on first render.
   */
  const [hydrated, setHydrated] = useState(false);
  /**
   * `working` lives as a ref too so the auto-fetch effect can check it
   * without depending on the state value — avoids a render-loop where
   * setState → re-run effect → setState.
   */
  const workingRef = useRef(false);
  /**
   * Set once Lichess returns 0 games for a requested cursor — means the
   * user has been paginated to the beginning of their recorded history.
   * Stops the auto-fetch loop so we don't spin forever on an empty tail.
   */
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    setUsername(loadUsername());
    setOldestMs(loadOldestFetchedMs());
    setFetchedCount(loadFetchedGameCount());
    setHydrated(true);
  }, []);

  /* ── Streaming fetch directly from Lichess ── */
  /**
   * Fetch a batch of up to BATCH_SIZE games from Lichess.
   * When `untilCursor` is provided, fetches games strictly older than that
   * timestamp (used for every fetch except the very first).
   */
  const runFetch = useCallback(
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
        message: `fetching up to ${BATCH_SIZE} ${label}games...`,
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
              // Advance the pagination cursor. Subtract 1ms so the next fetch
              // doesn't re-request the boundary game.
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
              // Accumulate the game count for the auto-fetch cap.
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
                message: `analyzed ${batchParsed} games → ${evt.generated} puzzles`,
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

  /* ── Auto-fetch loop ──
     When the user has worked their way through most of what's loaded
     (unseenCount ≤ AUTO_FETCH_THRESHOLD), quietly pull the next batch.
     Only fires after a first manual fetch has established a cursor, and
     stops when the cumulative game count hits MAX_FETCHED_GAMES. */
  useEffect(() => {
    if (!hydrated) return;
    if (workingRef.current) return;
    if (exhausted) return;
    if (oldestMs == null) return;
    if (fetchedCount >= MAX_FETCHED_GAMES) return;
    if (unseenCount > AUTO_FETCH_THRESHOLD) return;
    if (!username.trim()) return;
    runFetch(oldestMs);
  }, [hydrated, oldestMs, fetchedCount, unseenCount, username, exhausted, runFetch]);

  const pct =
    status.progress && status.progress.total > 0
      ? Math.min(100, Math.round((status.progress.current / status.progress.total) * 100))
      : null;

  const working = status.kind === 'working';
  const capReached = fetchedCount >= MAX_FETCHED_GAMES;

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
        disabled={working || capReached}
        onClick={() =>
          runFetch(
            // First click (no cursor yet) fetches the most recent games.
            // Every subsequent manual click continues paginating older.
            oldestMs ?? undefined
          )
        }
        title={
          capReached
            ? `reached ${MAX_FETCHED_GAMES}-game cap — clear cache to restart`
            : undefined
        }
      >
        {working
          ? '· fetching ·'
          : capReached
            ? `cap reached (${fetchedCount}/${MAX_FETCHED_GAMES})`
            : 'import'}
      </button>
      {fetchedCount > 0 && !working && (
        <div className="import-counter">
          {fetchedCount} / {MAX_FETCHED_GAMES} games · auto-fetch{' '}
          {capReached || exhausted ? 'off' : 'on'}
          {exhausted && !capReached ? ' (history exhausted)' : ''}
        </div>
      )}
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
