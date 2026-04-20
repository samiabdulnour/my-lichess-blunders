'use client';

import { useMemo } from 'react';
import type { Chess, Move } from 'chess.js';
import { Piece } from './Piece';

interface BoardProps {
  chess: Chess;
  /** From whose perspective to render. */
  orientation: 'white' | 'black';
  /** Currently selected source square, if any. */
  selected: string | null;
  /** Legal moves grouped by `from` square. */
  legalFrom: Record<string, Move[]>;
  /** Square highlighted as "last move from". */
  lastFrom: string | null;
  /** Square highlighted as "last move to". */
  lastTo: string | null;
  /** Square persistently painted green (user's correct move). */
  flashOk: string | null;
  /** Square persistently painted red (user's wrong move). */
  flashFail: string | null;
  /** Destination square of the engine's best move — painted green only
   *  when the user has revealed a wrong answer, so the correct square is
   *  visible alongside their mistake. Pass `null` otherwise. */
  bestRevealed: string | null;
  /** If true, input is disabled (puzzle already answered). */
  revealed: boolean;
  /** Click handler. */
  onSquareClick: (square: string) => void;
}

/**
 * 8x8 board, click-to-move. Drag/drop was in the original — we intentionally
 * skipped it here to keep the port minimal; add it back in a follow-up.
 */
export function Board({
  chess,
  orientation,
  selected,
  legalFrom,
  lastFrom,
  lastTo,
  flashOk,
  flashFail,
  bestRevealed,
  revealed,
  onSquareClick,
}: BoardProps) {
  const flipped = orientation === 'black';
  const pos = useMemo(() => chess.board(), [chess]);

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const moves = legalFrom[selected] ?? [];
    return new Set(moves.map((m) => m.to));
  }, [selected, legalFrom]);

  const ranks = [];
  for (let r = 0; r < 8; r++) ranks.push(flipped ? r + 1 : 8 - r);
  const files = flipped
    ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
    : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  const cells: React.ReactNode[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const br = flipped ? 7 - row : row;
      const bc = flipped ? 7 - col : col;
      const light = (br + bc) % 2 === 0;
      const sqn = String.fromCharCode(97 + bc) + (8 - br);
      const piece = pos[br][bc];

      const classes = ['sq', light ? 'sq-l' : 'sq-d'];
      if (sqn === lastFrom || sqn === lastTo) classes.push('lm');
      if (sqn === selected) classes.push('sel');
      if (!revealed && legalTargets.has(sqn)) {
        if (piece) classes.push('cap-ring');
      }
      if (sqn === flashOk) classes.push('flash-ok');
      if (sqn === flashFail) classes.push('flash-fail');
      // The engine's best-move target only gets painted when the page has
      // explicitly decided to reveal it (i.e. user answered wrong).
      if (sqn === bestRevealed) classes.push('flash-ok');

      cells.push(
        <div
          key={sqn}
          className={classes.join(' ')}
          data-sq={sqn}
          onClick={() => onSquareClick(sqn)}
        >
          {!revealed && legalTargets.has(sqn) && !piece && (
            <div className="sq-dot-hint" />
          )}
          {piece && <Piece color={piece.color} type={piece.type} />}
        </div>
      );
    }
  }

  return (
    <div className="bwrap">
      <div className="ranks">
        {ranks.map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>
      <div className="bcol">
        <div className="board-grid">{cells}</div>
        <div className="files">
          {files.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
