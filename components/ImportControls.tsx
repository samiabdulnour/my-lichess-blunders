'use client';

import { useRef, useState, useEffect } from 'react';
import type { Puzzle } from '@/lib/types';
import {
  loadUsername,
  saveUsername,
  loadOldestFetchedMs,
  saveOldestFetchedMs,
} from '@/lib/storage';

interface ImportControlsProps {
  /** Called as puzzles arrive. May be called many times during a streamed import. */
  onImport: (newPuzzles: Puzzle[]) => void;
  /** Wipe all imported puzzles and solved progress from cache. */
  onClearAll: () => void;
}

interface ImportStatus {
  kind: 'idle' | 'working' | 'ok' | 'error';
  message?: string;
  /** Current/total game count for the progress bar, when known. */
  progress?: { current: number; total: number };
}

/** Upper cap for the "fetch from Lichess" button — matches the server side. */
const DEFAULT_FETCH_MAX = 50;

/**
 * Sidebar panel with:
 *   · username input
 *   · "fetch last N games" button → POST /api/lichess/import (NDJSON stream)
 *   · "upload PGN file" fallback  → POST /api/import-pgn (single JSON response)
 *
 * Streaming events are decoded line-by-line; puzzles are handed back to the
 * parent via onImport as each game finishes analysis, so the sidebar list
 * grows in real-time.
 */
export function ImportControls({ onImport, onClearAll }: ImportControlsProps) {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' });
  /**
   * UNIX ms of the oldest Lichess game already imported. Serves as the
   * pagination cursor for the "fetch older 30 games" button. `null` until
   * the first successful fetch.
   */
  const [oldestMs, setOldestMs] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUsername(loadUsername());
    setOldestMs(loadOldestFetchedMs());
  }, []);

  /* ── Streaming fetch directly from Lichess ── */
  /**
   * Fetch a batch of up to N games from Lichess.
   * When `untilCursor` is provided, fetches games strictly older than that
   * timestamp (used by the "fetch next 30 games" button).
   */
  const runFetch = async (untilCursor?: number | null) => {
    const name = username.trim();
    if (!name) {
      setStatus({ kind: 'error', message: 'enter your Lichess username first' });
      return;
    }
    saveUsername(name);

    const label = untilCursor ? 'older ' : '';
    setStatus({
      kind: 'working',
      message: `fetching up to ${DEFAULT_FETCH_MAX} ${label}games...`,
    });

    let totalPuzzles = 0;
    let parsedGames = 0;
    try {
      const res = await fetch('/api/lichess/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: name,
          max: DEFAULT_FETCH_MAX,
          ...(untilCursor ? { until: untilCursor } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setStatus({ kind: 'error', message: data.error ?? `HTTP ${res.status}` });
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
            setStatus({
              kind: 'ok',
              message: `analyzed ${evt.parsedGames} games → ${evt.generated} puzzles`,
            });
            return;
          } else if (type === 'error') {
            setStatus({
              kind: 'error',
              message: (evt.message as string) ?? 'stream error',
            });
            return;
          }
        }
      }

      // Fallback message if the server ended without a final `done` event.
      setStatus({
        kind: 'ok',
        message: `${parsedGames} games → ${totalPuzzles} puzzles`,
      });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  };

  /* ── File upload fallback (single-shot JSON) ── */
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
        message: `parsed ${data.parsedGames} games → ${data.generated} puzzles`,
      });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  };

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
        onClick={() => runFetch()}
      >
        {working ? '· fetching ·' : `fetch last ${DEFAULT_FETCH_MAX} games`}
      </button>
      {oldestMs !== null && (
        <button
          className="import-btn"
          disabled={working}
          onClick={() => runFetch(oldestMs)}
          title={`fetch games older than ${new Date(oldestMs).toISOString().slice(0, 10)}`}
        >
          fetch next {DEFAULT_FETCH_MAX} games (older)
        </button>
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
