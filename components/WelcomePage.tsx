'use client';

import { useState } from 'react';
import type { Puzzle } from '@/lib/types';
import { apiUrl } from '@/lib/api';
import { saveAutoImport, saveUsername, saveWelcomeSeen } from '@/lib/storage';

interface WelcomePageProps {
  /** Hand new puzzles up to the parent — used by the PGN-upload path so
   *  the imported puzzles populate the main app immediately after dismiss. */
  onImport: (puzzles: Puzzle[]) => void;
  /** Dismiss the welcome screen and let the main app take over. */
  onDismiss: () => void;
}

type Status = { kind: 'idle' | 'working' | 'error'; message?: string };

/**
 * First-visit landing page. Three numbered steps — username, import,
 * solve — with a username field and a primary "start importing" CTA
 * underneath. Two escape hatches at the bottom: PGN file upload, and a
 * "try with sample puzzles" link that drops the user straight into the
 * app with whatever seed puzzles `/api/puzzles` ships.
 *
 * The streamed-import path can't run from here (it needs the parent's
 * import-state plumbing), so this component just stashes the username +
 * an `autoImport` flag in localStorage and dismisses; ImportControls
 * picks the flag up on mount and kicks off the first batch.
 *
 * The PGN-upload path posts directly to /api/import-pgn, hands the
 * resulting puzzles to the parent via `onImport`, then dismisses.
 */
export function WelcomePage({ onImport, onDismiss }: WelcomePageProps) {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const trimmed = username.trim();
  const ready = trimmed.length > 0 && status.kind !== 'working';

  const handleStartImport = () => {
    if (!trimmed) {
      setStatus({ kind: 'error', message: 'enter your Lichess username first' });
      return;
    }
    saveUsername(trimmed);
    saveAutoImport(true);
    saveWelcomeSeen(true);
    onDismiss();
  };

  const handleTrySamples = () => {
    saveWelcomeSeen(true);
    onDismiss();
  };

  const handleUploadPgn = async (file: File) => {
    if (!trimmed) {
      setStatus({ kind: 'error', message: 'enter your Lichess username first' });
      return;
    }
    saveUsername(trimmed);
    setStatus({ kind: 'working', message: `reading ${file.name}...` });
    try {
      const pgn = await file.text();
      setStatus({ kind: 'working', message: 'analyzing with stockfish...' });
      const res = await fetch(apiUrl('/api/import-pgn'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn, username: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({
          kind: 'error',
          message: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const puzzles = (data.puzzles ?? []) as Puzzle[];
      onImport(puzzles);
      saveWelcomeSeen(true);
      onDismiss();
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message });
    }
  };

  const onPgnInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) handleUploadPgn(file);
  };

  return (
    <div className="welcome">
      <div className="welcome-content">
        <div className="welcome-eyebrow">my-lichess-blunders</div>
        <h1 className="welcome-title">
          Train on <em>your own</em> blunders.
        </h1>
        <p className="welcome-desc">
          We&apos;ll pull your last 50 Lichess games, run Stockfish on each
          move, and turn your mistakes into puzzles. Takes about 2 minutes.
        </p>

        <div className="welcome-steps">
          <div className="welcome-step active">
            <div className="welcome-step-num">1</div>
            <div className="welcome-step-body">
              <div className="welcome-step-title">Your Lichess username</div>
              <div className="welcome-step-desc">
                We use it to fetch your public game history.
              </div>
            </div>
          </div>
          <div className="welcome-step">
            <div className="welcome-step-num">2</div>
            <div className="welcome-step-body">
              <div className="welcome-step-title">Import &amp; analyze</div>
              <div className="welcome-step-desc">
                50 games · ~2 minutes on a modern laptop.
              </div>
            </div>
          </div>
          <div className="welcome-step">
            <div className="welcome-step-num">3</div>
            <div className="welcome-step-body">
              <div className="welcome-step-title">Solve your blunders</div>
              <div className="welcome-step-desc">
                One position per mistake, sorted by severity.
              </div>
            </div>
          </div>
        </div>

        <form
          className="welcome-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleStartImport();
          }}
        >
          <input
            type="text"
            className="welcome-input"
            placeholder="e.g. magnuscarlsen"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (status.kind === 'error') setStatus({ kind: 'idle' });
            }}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            disabled={status.kind === 'working'}
            aria-label="Your Lichess username"
          />
          <button
            type="submit"
            className={'welcome-cta' + (ready ? ' ready' : '')}
            disabled={status.kind === 'working'}
          >
            {status.kind === 'working' ? '· working ·' : 'start importing →'}
          </button>
        </form>

        {status.message && status.kind !== 'idle' && (
          <div className={'welcome-status' + (status.kind === 'error' ? ' err' : '')}>
            {status.message}
          </div>
        )}

        <div className="welcome-foot">
          <span>Already have a PGN?</span>{' '}
          <label className="welcome-link">
            upload file
            <input
              type="file"
              accept=".pgn,text/plain"
              style={{ display: 'none' }}
              onChange={onPgnInputChange}
              disabled={status.kind === 'working'}
            />
          </label>
          <span className="welcome-foot-sep"> · </span>
          <button
            type="button"
            className="welcome-link"
            onClick={handleTrySamples}
            disabled={status.kind === 'working'}
          >
            try with sample puzzles
          </button>
        </div>
      </div>
    </div>
  );
}
