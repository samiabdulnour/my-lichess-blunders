'use client';

import type { Puzzle } from '@/lib/types';

interface ResultPanelProps {
  puzzle: Puzzle;
  yourMove: string;
  isOk: boolean;
  onRetry: () => void;
  onNext: () => void;
}

const fmtEval = (v: number) => {
  if (Math.abs(v) > 50) return v > 0 ? '+M' : '-M';
  return (v >= 0 ? '+' : '') + v.toFixed(1);
};

export function ResultPanel({ puzzle, yourMove, isOk, onRetry, onNext }: ResultPanelProps) {
  const myC = puzzle.abdulsColor;
  const evalClass = (v: number) => {
    const good = myC === 'white' ? v > 0.3 : v < -0.3;
    if (good) return 'eg';
    if (Math.abs(v) < 0.3) return 'em';
    return 'eb';
  };

  /**
   * Build a Lichess URL that opens the game at the exact puzzle position
   * and from the side the user was playing. Lichess accepts:
   *   /{gameId}            — white POV
   *   /{gameId}/black      — black POV
   *   …#N                  — jump to ply N
   * Stripping any existing trailing slash or fragment from `puzzle.site`
   * keeps the result clean if the upstream value ever changes shape.
   */
  const lichessUrl = (() => {
    // Drop any existing fragment so we can attach our own ply anchor.
    const base = puzzle.site.replace(/#.*$/, '').replace(/\/$/, '');
    const ply = puzzle.setupMoves.length;
    const pov = myC === 'black' ? '/black' : '';
    return `${base}${pov}#${ply}`;
  })();

  const gaveUp = yourMove === '—';
  const statusText = isOk
    ? 'engine move found'
    : gaveUp
      ? 'solution revealed'
      : 'suboptimal — stockfish prefers different';

  return (
    <div className="result">
      <div className="r-line" style={{ marginBottom: 10 }}>
        <span className={isOk ? 'r-status-ok' : 'r-status-fail'}></span>
        <span style={{ color: isOk ? 'var(--green)' : 'var(--red)' }}>
          {statusText}
        </span>
      </div>
      <div className="r-section">eval delta</div>
      <div className="r-evals">
        <div className="re">
          <div className="re-l">before</div>
          <div className={`re-v ${evalClass(puzzle.evalBefore)}`}>
            {fmtEval(puzzle.evalBefore)}
          </div>
        </div>
        <div className="re">
          <div className="re-l">after blunder</div>
          <div className="re-v eb">{fmtEval(puzzle.evalAfter)}</div>
        </div>
        <div className="re">
          <div className="re-l">drop</div>
          <div className="re-v eb">-{puzzle.drop.toFixed(1)}</div>
        </div>
      </div>
      <div className="r-section">moves</div>
      <div className="r-moves">
        <div className={`rm ${isOk ? 'ok-move' : 'fail-move'}`}>
          <div className="rm-label">you played</div>
          <div className="rm-val">{yourMove}</div>
        </div>
        <div className="rm best-move">
          <div className="rm-label">engine best</div>
          <div className="rm-val">{puzzle.bestMove}</div>
        </div>
        <div className="rm blunder-move">
          <div className="rm-label">the blunder</div>
          <div className="rm-val">{puzzle.mistakeMove}</div>
        </div>
      </div>
      <div className="r-acts">
        <button
          className="abtn lc"
          onClick={() => window.open(lichessUrl, '_blank', 'noopener,noreferrer')}
        >
          open lichess
        </button>
        <button className="abtn" onClick={onRetry}>
          retry
        </button>
        <button className="abtn prim" onClick={onNext}>
          next puzzle
        </button>
      </div>
    </div>
  );
}
