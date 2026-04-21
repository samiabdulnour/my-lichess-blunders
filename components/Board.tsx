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
  /** Square persistently painted green (user's correct move or revealed best move). */
  flashOk: string | null;
  /** Square persistently painted red (user's wrong move). */
  flashFail: string | null;
  /** If set, the piece at `.from` gets a CSS bounce-back animation
   *  starting from the `.to` square — used to rewind a wrong move. */
  bounceBack: { from: string; to: string } | null;
  /** If true, input is disabled (puzzle already answered, or the board
   *  is mid-bounce from a wrong move). */
  revealed: boolean;
  /** Click handler. */
  onSquareClick: (square: string) => void;
  /** Drag handler. Fires when the user drags a piece from one square to
   *  another. Receives the target `to` square and the legal Move that
   *  matches — the parent applies it via the same `makeMove` logic the
   *  click path uses. */
  onDragMove: (move: Move) => void;
}

/**
 * 8x8 board, click-to-move AND drag-to-move. HTML5 drag-and-drop powers
 * the drag path; touch devices fall back to click-to-move since HTML5
 * DnD isn't supported by Mobile Safari.
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
  bounceBack,
  revealed,
  onSquareClick,
  onDragMove,
}: BoardProps) {
  const flipped = orientation === 'black';
  const pos = useMemo(() => chess.board(), [chess]);

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    const moves = legalFrom[selected] ?? [];
    return new Set(moves.map((m) => m.to));
  }, [selected, legalFrom]);

  // Bounce-back: compute the pixel offset between the wrong destination
  // and the piece's origin, in the board's visual coordinate system. We
  // hand it to CSS via custom properties so the keyframe animation can
  // translate from (dx, dy) back to (0, 0).
  const bounceDelta = useMemo(() => {
    if (!bounceBack) return null;
    const visual = (sqn: string) => {
      const col = sqn.charCodeAt(0) - 97;
      const row = 8 - parseInt(sqn[1], 10);
      return {
        vc: flipped ? 7 - col : col,
        vr: flipped ? 7 - row : row,
      };
    };
    const f = visual(bounceBack.from);
    const t = visual(bounceBack.to);
    // Expressed in "squares"; the CSS multiplies by --sq-size to get
    // pixels. Avoids baking a fixed square size into JS math.
    return { dx: t.vc - f.vc, dy: t.vr - f.vr };
  }, [bounceBack, flipped]);

  const ranks = [];
  for (let r = 0; r < 8; r++) ranks.push(flipped ? r + 1 : 8 - r);
  const files = flipped
    ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
    : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  const myColor = chess.turn();

  // Drag handlers. We set the source square on dragstart, allow the drop
  // on any square (HTML5 needs a preventDefault on dragover), and on drop
  // look up a legal move matching (from → to) and hand it to the parent.
  const handleDragStart = (e: React.DragEvent, sqn: string) => {
    if (revealed) {
      e.preventDefault();
      return;
    }
    const piece = (() => {
      const col = sqn.charCodeAt(0) - 97;
      const row = 8 - parseInt(sqn[1], 10);
      return pos[row][col];
    })();
    if (!piece || piece.color !== myColor) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', sqn);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (revealed) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, to: string) => {
    if (revealed) return;
    e.preventDefault();
    const from = e.dataTransfer.getData('text/plain');
    if (!from || from === to) return;
    const cands = (legalFrom[from] ?? []).filter((m) => m.to === to);
    if (cands.length === 0) return;
    const mv = cands.find((m) => m.promotion === 'q') ?? cands[0];
    onDragMove(mv);
  };

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

      const isBouncing =
        bounceBack !== null && sqn === bounceBack.from && piece !== null;

      cells.push(
        <div
          key={sqn}
          className={classes.join(' ')}
          data-sq={sqn}
          onClick={() => onSquareClick(sqn)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, sqn)}
        >
          {!revealed && legalTargets.has(sqn) && !piece && (
            <div className="sq-dot-hint" />
          )}
          {piece && (
            <div
              className={'piece-wrap' + (isBouncing ? ' bouncing' : '')}
              style={
                isBouncing && bounceDelta
                  ? ({
                      '--bx': `${bounceDelta.dx}`,
                      '--by': `${bounceDelta.dy}`,
                    } as React.CSSProperties)
                  : undefined
              }
              draggable={!revealed}
              onDragStart={(e) => handleDragStart(e, sqn)}
            >
              <Piece color={piece.color} type={piece.type} />
            </div>
          )}
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
