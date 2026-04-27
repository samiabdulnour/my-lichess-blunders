'use client';

import { useMemo, useRef, useState } from 'react';
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
  /** If set, the piece at `.to` gets a slide-in animation starting
   *  from `.from` — used on puzzle load to replay the opponent's move
   *  and on the user's correct move / show-solution to animate the
   *  piece forward into place. */
  introMove: { from: string; to: string } | null;
  /** If true, input is disabled (puzzle already answered, or the board
   *  is mid-bounce from a wrong move). */
  revealed: boolean;
  /** Click handler. */
  onSquareClick: (square: string) => void;
  /** Drag handler. Receives the legal Move to apply. */
  onDragMove: (move: Move) => void;
}

/** Pixels of pointer movement before a press becomes a drag. Below the
 *  threshold the gesture is treated as a click so taps still select a
 *  piece without accidentally dragging it. */
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  from: string;
  pointerId: number;
  /** Pointer position when the drag started. */
  startX: number;
  startY: number;
  /** Latest pointer position. */
  curX: number;
  curY: number;
  /** Square currently under the pointer (for the drop-target ring). */
  over: string | null;
  /** Has the pointer moved past the threshold yet? Drives whether this
   *  is a "real" drag (with visual translation) or still a tentative
   *  press that may resolve as a click. */
  active: boolean;
}

/**
 * 8x8 board, click-to-move AND drag-to-move. A unified Pointer Events
 * pipeline handles mouse, touch, and pen input — no HTML5 DnD, so
 * mobile Safari (which doesn't fire HTML5 drag events) works the same
 * as desktop. A small pixel threshold lets a quick tap still register
 * as a click for click-to-move users.
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
  introMove,
  revealed,
  onSquareClick,
  onDragMove,
}: BoardProps) {
  const flipped = orientation === 'black';
  const pos = useMemo(() => chess.board(), [chess]);
  const myColor = chess.turn();

  const [drag, setDrag] = useState<DragState | null>(null);

  /** True iff a drag has already crossed the movement threshold. We
   *  check this on click to suppress the click-to-move handler when
   *  the gesture was a real drag (so click-then-drag doesn't double-fire). */
  const wasDraggingRef = useRef(false);

  // During a drag OR a regular selection, both kinds of "source" contribute
  // to the target-hint set. The drag source takes precedence since the user
  // is actively holding a piece.
  const hintSource = drag?.from ?? selected;
  const legalTargets = useMemo(() => {
    if (!hintSource) return new Set<string>();
    const moves = legalFrom[hintSource] ?? [];
    return new Set(moves.map((m) => m.to));
  }, [hintSource, legalFrom]);

  // Shared visual-coord helper used by both animation paths.
  const visual = useMemo(
    () => (sqn: string) => {
      const col = sqn.charCodeAt(0) - 97;
      const row = 8 - parseInt(sqn[1], 10);
      return {
        vc: flipped ? 7 - col : col,
        vr: flipped ? 7 - row : row,
      };
    },
    [flipped]
  );

  // Bounce-back offset (square units). Piece sits at `from` in the DOM
  // and animates from translate(to-from) back to (0,0).
  const bounceDelta = useMemo(() => {
    if (!bounceBack) return null;
    const f = visual(bounceBack.from);
    const t = visual(bounceBack.to);
    return { dx: t.vc - f.vc, dy: t.vr - f.vr };
  }, [bounceBack, visual]);

  // Intro / forward-move offset (square units). Piece sits at `to` in
  // the DOM and animates from translate(from-to) back to (0,0) so it
  // appears to slide in from its origin.
  const introDelta = useMemo(() => {
    if (!introMove) return null;
    const f = visual(introMove.from);
    const t = visual(introMove.to);
    return { dx: f.vc - t.vc, dy: f.vr - t.vr };
  }, [introMove, visual]);

  const ranks = [];
  for (let r = 0; r < 8; r++) ranks.push(flipped ? r + 1 : 8 - r);
  const files = flipped
    ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
    : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  /** Walk up from the given client point to find the square underneath.
   *  Used during pointermove (for hover ring) and pointerup (for drop). */
  const findSquareAt = (clientX: number, clientY: number): string | null => {
    if (typeof document === 'undefined') return null;
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    const sq = (el as HTMLElement).closest?.('[data-sq]');
    return sq ? sq.getAttribute('data-sq') : null;
  };

  /** Begin a potential drag from the given square. The drag stays
   *  "tentative" (no translation, no source-fade) until the pointer
   *  moves past the threshold; that lets a quick tap fall through to
   *  the click-to-move path.
   *
   *  We call `setPointerCapture` on the wrap so subsequent pointer
   *  events for this gesture continue to fire on the same element even
   *  when the pointer leaves the original square. That removes the need
   *  for document-level listeners and avoids a render-cycle race with
   *  ultra-fast taps. */
  const handlePointerDown = (e: React.PointerEvent, sqn: string) => {
    if (revealed) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const col = sqn.charCodeAt(0) - 97;
    const row = 8 - parseInt(sqn[1], 10);
    const piece = pos[row][col];
    if (!piece || piece.color !== myColor) return;

    // Note: we deliberately do NOT call e.preventDefault() here. On
    // touch, that suppresses the synthesized click event so a quick tap
    // on a piece would never fire the click-to-move handler. Page-scroll
    // suppression is handled by `touch-action: none` on the piece-wrap
    // in globals.css instead.

    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* Some browsers reject capture on already-captured pointers. */
    }

    wasDraggingRef.current = false;
    setDrag({
      from: sqn,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      over: sqn,
      active: false,
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const active = drag.active || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
    if (active) wasDraggingRef.current = true;
    const over = active ? findSquareAt(e.clientX, e.clientY) : drag.over;
    setDrag({ ...drag, curX: e.clientX, curY: e.clientY, over, active });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    const from = drag.from;
    setDrag(null);
    if (!wasActive) return; // tap, not drag — let the click handler run
    const target = findSquareAt(e.clientX, e.clientY);
    if (!target || target === from) return;
    const cands = (legalFrom[from] ?? []).filter((m) => m.to === target);
    if (cands.length === 0) return;
    const mv = cands.find((m) => m.promotion === 'q') ?? cands[0];
    onDragMove(mv);
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag(null);
  };

  /** Square click. Suppressed when the gesture was a real drag — the
   *  pointerup branch already applied the move (or rejected it) and we
   *  don't want a stray click-to-select firing on top. */
  const handleSquareClick = (sqn: string) => {
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false;
      return;
    }
    onSquareClick(sqn);
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
      if (sqn === selected || sqn === drag?.from) classes.push('sel');
      if (!revealed && legalTargets.has(sqn)) {
        if (piece) classes.push('cap-ring');
      }
      // Drop-target ring follows the dragged piece so the user can see
      // where it would land. We only render it once the drag is "active"
      // to avoid flicker during a tap.
      if (drag?.active && drag.over === sqn && sqn !== drag.from) {
        if (legalTargets.has(sqn)) classes.push('drop-target');
      }
      if (sqn === flashOk) classes.push('flash-ok');
      if (sqn === flashFail) classes.push('flash-fail');

      const isBouncing =
        bounceBack !== null && sqn === bounceBack.from && piece !== null;
      const isIntro = introMove !== null && sqn === introMove.to && piece !== null;
      const isDragSource = drag?.from === sqn && piece !== null;
      const isDragActive = isDragSource && drag.active;

      // Compose the piece-wrap class + inline CSS vars / transform.
      // Three states share the wrap:
      //   · animating (bounce-back OR intro/forward) → CSS keyframe
      //   · drag-active → live transform follows the cursor; the
      //     dragged piece floats above the board with z-index bump
      //   · drag-source (pre-threshold) → stays put, opacity unchanged
      let wrapClass = 'piece-wrap';
      let wrapStyle: React.CSSProperties | undefined;
      const activeDelta =
        isBouncing && bounceDelta
          ? bounceDelta
          : isIntro && introDelta
            ? introDelta
            : null;
      if (activeDelta && !isDragActive) {
        wrapClass += ' animating';
        wrapStyle = {
          '--bx': `${activeDelta.dx}`,
          '--by': `${activeDelta.dy}`,
        } as React.CSSProperties;
      }
      if (isDragActive) {
        wrapClass += ' dragging';
        wrapStyle = {
          transform: `translate(${drag.curX - drag.startX}px, ${drag.curY - drag.startY}px) scale(1.1)`,
        };
      }

      cells.push(
        <div
          key={sqn}
          className={classes.join(' ')}
          data-sq={sqn}
          onClick={() => handleSquareClick(sqn)}
        >
          {!revealed && legalTargets.has(sqn) && !piece && (
            <div className="sq-dot-hint" />
          )}
          {piece && (
            <div
              className={wrapClass}
              style={wrapStyle}
              onPointerDown={(e) => handlePointerDown(e, sqn)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
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
