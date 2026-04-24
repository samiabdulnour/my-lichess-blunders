'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';

import { Board } from '@/components/Board';
import { PuzzleList } from '@/components/PuzzleList';
import { TerminalShell } from '@/components/TerminalShell';
import { ResultPanel } from '@/components/ResultPanel';
import { ecoName } from '@/lib/eco-names';
import type {
  EcoFilter,
  Filter,
  GamePhase,
  PhaseFilter,
  Puzzle,
  SessionStats,
  SolveStatus,
  SpeedFilter,
} from '@/lib/types';
import {
  loadPuzzles,
  savePuzzles,
  loadSolved,
  saveSolved,
  mergePuzzles,
  clearAll,
} from '@/lib/storage';

export default function Page() {
  const [all, setAll] = useState<Puzzle[]>([]);
  // Start on 'unseen' so the user always lands on something fresh rather
  // than re-seeing puzzles they've already solved.
  const [filter, setFilter] = useState<Filter>('unseen');
  const [ecoFilter, setEcoFilter] = useState<EcoFilter>('all');
  const [speedFilter, setSpeedFilter] = useState<SpeedFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [current, setCurrent] = useState<Puzzle | null>(null);
  const [chess, setChess] = useState<Chess>(() => new Chess());
  const [selected, setSelected] = useState<string | null>(null);
  const [legalFrom, setLegalFrom] = useState<Record<string, Move[]>>({});
  const [lastFrom, setLastFrom] = useState<string | null>(null);
  const [lastTo, setLastTo] = useState<string | null>(null);
  const [flashOk, setFlashOk] = useState<string | null>(null);
  const [flashFail, setFlashFail] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [yourMove, setYourMove] = useState<string | null>(null);
  const [isOk, setIsOk] = useState(false);
  /** True while a wrong move is flashing red and being undone. Blocks
   *  further input during that short window. */
  const [awaitingRetry, setAwaitingRetry] = useState(false);
  /** When set, the piece at `.from` is rendered with a CSS animation
   *  that slides it from the `.to` square back to `.from` — the visual
   *  "bounce" after a wrong move, matching the Lichess puzzle feel. */
  const [bounceBack, setBounceBack] = useState<{ from: string; to: string } | null>(null);
  /** When set, the piece at `.to` is animated sliding in from `.from`
   *  — used on puzzle load to replay the opponent's blunder so the user
   *  sees what just happened before they have to respond. */
  const [introMove, setIntroMove] = useState<{ from: string; to: string } | null>(null);
  /** SANs of every wrong move the user has tried on the current puzzle.
   *  Surfaced in the result panel so the user can see what they tried
   *  before finding the answer or giving up. */
  const [attempts, setAttempts] = useState<string[]>([]);
  const [solved, setSolved] = useState<Record<string, SolveStatus>>({});
  const [stats, setStats] = useState<SessionStats>({ correct: 0, wrong: 0, streak: 0 });
  const hydrated = useRef(false);
  /** Puzzle id whose outcome has already been counted in stats. Prevents
   *  double-counting when the user tries multiple wrong moves before
   *  either finding the right one or clicking "show solution". */
  const recordedRef = useRef<string | null>(null);
  /**
   * Mirror of `current` as a ref. handleImport uses this to decide whether
   * to auto-jump on the first streamed batch without falling into stale-
   * closure traps when many batches arrive in quick succession.
   */
  const currentRef = useRef<Puzzle | null>(null);

  /* ── Load puzzles: seeds (from API) + saved (from localStorage) ── */
  useEffect(() => {
    const saved = loadPuzzles();
    const savedSolved = loadSolved();
    setSolved(savedSolved);

    fetch('/api/puzzles')
      .then((r) => r.json())
      .then((data: { puzzles: Puzzle[] }) => {
        const merged = mergePuzzles(data.puzzles ?? [], saved);
        setAll(merged);
        if (merged.length > 0) loadPuzzle(merged[0]);
        hydrated.current = true;
      })
      .catch((err) => {
        console.error('Failed to load seed puzzles:', err);
        setAll(saved);
        if (saved.length > 0) loadPuzzle(saved[0]);
        hydrated.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Persist solved state whenever it changes (after first hydration) ── */
  useEffect(() => {
    if (hydrated.current) saveSolved(solved);
  }, [solved]);

  /* ── Derived: filtered puzzle list ──
     Apply the progress filter first, then narrow by ECO / speed / phase. */
  const filtered = useMemo(() => {
    let list = all;
    if (filter === 'unseen') list = list.filter((p) => !solved[p.id]);
    else if (filter === 'retry') list = list.filter((p) => solved[p.id] === 'fail');

    if (ecoFilter !== 'all') {
      list = list.filter((p) => p.eco === ecoFilter);
    }
    if (speedFilter !== 'all') {
      list = list.filter((p) => p.speed === speedFilter);
    }
    if (phaseFilter !== 'all') {
      list = list.filter((p) => phaseOf(p) === phaseFilter);
    }
    return list;
  }, [all, filter, ecoFilter, speedFilter, phaseFilter, solved]);

  /* Count of unseen puzzles across the whole library, NOT narrowed by the
     ECO / speed / phase dropdowns. The auto-fetch loop uses this: if the
     user is still picky about phase but has unseen puzzles elsewhere, we
     shouldn't spam Lichess for more. */
  const unseenCount = useMemo(
    () => all.reduce((n, p) => (solved[p.id] ? n : n + 1), 0),
    [all, solved]
  );

  /* ── Load a puzzle: replay its setup moves and hand over to the board ──
     We also capture the opponent's last move (the final setup move) so
     the board can animate it sliding in — the user sees the blunder
     happen on load rather than arriving cold on a puzzle position. */
  const loadPuzzle = useCallback((p: Puzzle) => {
    const c = new Chess();
    let lastMoveFrom: string | null = null;
    let lastMoveTo: string | null = null;
    for (let i = 0; i < p.setupMoves.length; i++) {
      try {
        const applied = c.move(p.setupMoves[i]);
        if (applied && i === p.setupMoves.length - 1) {
          lastMoveFrom = applied.from;
          lastMoveTo = applied.to;
        }
      } catch (err) {
        console.warn(`Illegal setup move "${p.setupMoves[i]}" in puzzle ${p.id}`, err);
        break;
      }
    }
    setCurrent(p);
    currentRef.current = p;
    setChess(c);
    setSelected(null);
    setLastFrom(lastMoveFrom);
    setLastTo(lastMoveTo);
    setFlashOk(null);
    setFlashFail(null);
    setRevealed(false);
    setYourMove(null);
    setAwaitingRetry(false);
    setBounceBack(null);
    setAttempts([]);
    setLegalFrom(groupLegal(c));

    // Intro animation: slide the opponent's last move in. The piece
    // already lives on `to` (we applied every setup move above); the
    // Board translates it visually from `from` back to 0 over ~350ms.
    if (lastMoveFrom && lastMoveTo) {
      setIntroMove({ from: lastMoveFrom, to: lastMoveTo });
      const id = p.id;
      setTimeout(() => {
        if (currentRef.current?.id !== id) return;
        setIntroMove(null);
      }, 400);
    } else {
      setIntroMove(null);
    }
  }, []);

  /* ── Handle a click on a board square ── */
  const onSquareClick = useCallback(
    (sqn: string) => {
      if (revealed || awaitingRetry || !current) return;
      const myColor = current.abdulsColor === 'white' ? 'w' : 'b';
      if (chess.turn() !== myColor) return;

      if (selected === sqn) {
        setSelected(null);
        return;
      }
      if (selected) {
        const cands = (legalFrom[selected] ?? []).filter((m) => m.to === sqn);
        if (cands.length > 0) {
          const mv = cands.find((m) => m.promotion === 'q') ?? cands[0];
          makeMove(mv);
          return;
        }
      }
      if ((legalFrom[sqn] ?? []).length > 0) {
        setSelected(sqn);
      } else {
        setSelected(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [revealed, awaitingRetry, current, chess, selected, legalFrom]
  );

  /* ── Apply a move and compare to the puzzle's best move ──
     Lichess-style flow:
      · Correct move → reveal result panel, persistent green flash.
      · Wrong move  → brief red flash on the landing square, then undo
        the move so the user can try again. Stats are recorded once per
        puzzle (on the first wrong attempt), so repeat tries don't
        inflate the miss count. */
  const makeMove = (mv: Move) => {
    if (!current) return;
    const next = new Chess(chess.fen());
    let applied;
    try {
      applied = next.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    } catch {
      return;
    }
    if (!applied) return;

    const ok = applied.san === current.bestMove;

    if (ok) {
      setChess(next);
      setSelected(null);
      setLastFrom(mv.from);
      setLastTo(mv.to);
      setRevealed(true);
      setYourMove(applied.san);
      setIsOk(true);
      setFlashOk(mv.to);

      if (recordedRef.current !== current.id) {
        recordedRef.current = current.id;
        setSolved((prev) =>
          prev[current.id] ? prev : { ...prev, [current.id]: 'ok' }
        );
        setStats((prev) =>
          solved[current.id]
            ? prev
            : { correct: prev.correct + 1, wrong: prev.wrong, streak: prev.streak + 1 }
        );
      }
      return;
    }

    // ── Wrong move ──
    // Show the piece landing on its (wrong) square with a red flash, then
    // slide it back to its origin — two phases, so the user gets the
    // Lichess-style "nope, try again" feedback:
    //   · phase 1 (red flash, 400ms): piece sits at destination, red.
    //   · phase 2 (bounce, 300ms): piece animates back to source.
    setChess(next);
    setSelected(null);
    setLastFrom(mv.from);
    setLastTo(mv.to);
    setFlashFail(mv.to);
    setAwaitingRetry(true);

    // Track the attempt so we can surface it in the result panel.
    setAttempts((prev) => (prev.includes(applied.san) ? prev : [...prev, applied.san]));

    // Record the miss exactly once per puzzle.
    if (recordedRef.current !== current.id) {
      recordedRef.current = current.id;
      setSolved((prev) =>
        prev[current.id] ? prev : { ...prev, [current.id]: 'fail' }
      );
      setStats((prev) =>
        solved[current.id]
          ? prev
          : { correct: prev.correct, wrong: prev.wrong + 1, streak: 0 }
      );
    }

    const beforeFen = chess.fen();
    const puzzleId = current.id;
    const bounceFrom = mv.from;
    const bounceTo = mv.to;

    // Phase 1 → Phase 2: rewind the position so the piece is back at
    // its origin in the DOM, then apply the bounce-back animation.
    setTimeout(() => {
      if (currentRef.current?.id !== puzzleId) return;
      const rewind = new Chess(beforeFen);
      setChess(rewind);
      setLastFrom(null);
      setLastTo(null);
      setFlashFail(null);
      setLegalFrom(groupLegal(rewind));
      setBounceBack({ from: bounceFrom, to: bounceTo });
    }, 400);

    // Phase 2 → done: clear the animation state and unlock input.
    setTimeout(() => {
      if (currentRef.current?.id !== puzzleId) return;
      setBounceBack(null);
      setAwaitingRetry(false);
    }, 700);
  };

  /* ── Give up: reveal the engine's best move ──
     Plays the engine's move on the board so the right piece travels to
     the right square, then opens the result panel with a "solution
     revealed" status and "—" in the "you played" slot. The source
     square gets the same yellow last-move highlight used after a
     correct solve, so the pre- and post-reveal views stay consistent. */
  const showSolution = useCallback(() => {
    if (!current || revealed || awaitingRetry) return;
    const beforeFen = chess.fen();
    const replay = new Chess(beforeFen);
    let bestApplied;
    try {
      bestApplied = replay.move(current.bestMove);
    } catch {
      return;
    }
    if (!bestApplied) return;

    setChess(replay);
    setSelected(null);
    setLastFrom(bestApplied.from);
    setLastTo(bestApplied.to);
    setFlashOk(bestApplied.to);
    setFlashFail(null);
    setRevealed(true);
    setYourMove('—');
    setIsOk(false);

    if (recordedRef.current !== current.id) {
      recordedRef.current = current.id;
      setSolved((prev) =>
        prev[current.id] ? prev : { ...prev, [current.id]: 'fail' }
      );
      setStats((prev) =>
        solved[current.id]
          ? prev
          : { correct: prev.correct, wrong: prev.wrong + 1, streak: 0 }
      );
    }
  }, [current, revealed, awaitingRetry, chess, solved]);

  const retry = () => {
    if (current) loadPuzzle(current);
  };

  const next = useCallback(() => {
    if (!current || filtered.length === 0) return;
    const idx = filtered.findIndex((p) => p.id === current.id);
    for (let i = 1; i <= filtered.length; i++) {
      const cand = filtered[(idx + i) % filtered.length];
      if (!solved[cand.id]) {
        loadPuzzle(cand);
        return;
      }
    }
    loadPuzzle(filtered[(idx + 1) % filtered.length]);
  }, [current, filtered, solved, loadPuzzle]);

  /**
   * Import handler. Safe to call many times during a streamed import:
   *  · merges incoming puzzles into `all` (deduped by id),
   *  · persists the user-generated set to localStorage,
   *  · auto-jumps to the first new puzzle only when nothing is currently
   *    displayed on the board (so subsequent batches don't yank the user
   *    off a puzzle they're thinking about).
   */
  const handleImport = useCallback(
    (newPuzzles: Puzzle[]) => {
      if (newPuzzles.length === 0) return;

      setAll((prev) => mergePuzzles(prev, newPuzzles));

      // Persist only imported (non-seed) puzzles — seeds always come from
      // the API; storing them would duplicate the seed list on reload.
      const saved = loadPuzzles();
      savePuzzles(mergePuzzles(saved, newPuzzles));

      if (!currentRef.current) {
        loadPuzzle(newPuzzles[0]);
      }
    },
    [loadPuzzle]
  );

  /**
   * Wipe all imported puzzles + solved progress from localStorage and reset
   * the in-memory state back to whatever the seed endpoint returns. Seeds
   * live in code so they reappear immediately. Username is preserved.
   */
  const handleClearAll = useCallback(() => {
    clearAll();
    setSolved({});
    setStats({ correct: 0, wrong: 0, streak: 0 });
    setCurrent(null);
    currentRef.current = null;
    setAll([]);
    setRevealed(false);
    setYourMove(null);

    // Reload the seed puzzles so the sidebar isn't empty after a clear.
    fetch('/api/puzzles')
      .then((r) => r.json())
      .then((data: { puzzles: Puzzle[] }) => {
        const seeds = data.puzzles ?? [];
        setAll(seeds);
        if (seeds.length > 0) loadPuzzle(seeds[0]);
      })
      .catch((err) => console.error('Failed to reload seed puzzles:', err));
  }, [loadPuzzle]);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'ArrowRight' || e.key === 'Enter') && revealed) next();
      if (e.key === 'r' && revealed) retry();
      if (e.key === 'Escape' && !revealed) setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, next]);

  /* ── Render ── */
  const mn = current ? Math.floor(current.setupMoves.length / 2) + 1 : 0;

  return (
    <TerminalShell loadedCount={all.length} stats={stats}>
      <PuzzleList
        all={all}
        filtered={filtered}
        filter={filter}
        ecoFilter={ecoFilter}
        speedFilter={speedFilter}
        phaseFilter={phaseFilter}
        current={current}
        solved={solved}
        unseenCount={unseenCount}
        onFilterChange={setFilter}
        onEcoFilterChange={setEcoFilter}
        onSpeedFilterChange={setSpeedFilter}
        onPhaseFilterChange={setPhaseFilter}
        onSelect={loadPuzzle}
        onImport={handleImport}
        onClearAll={handleClearAll}
      />

      <div className="main">
        {!current ? (
          <div className="empty">
            <div className="empty-line">
              No puzzles loaded. Import a Lichess PGN from the sidebar.
            </div>
          </div>
        ) : (
          <>
            <div className="ctx">
              <div>
                <div className="ctx-opp">
                  {current.player
                    ? current.abdulsColor === 'white'
                      ? `${current.player} vs ${current.opponent}`
                      : `${current.opponent} vs ${current.player}`
                    : `vs ${current.opponent}`}{' '}
                  <span className="eco">
                    [{current.eco}
                    {ecoName(current.eco) ? ` — ${ecoName(current.eco)}` : ''}]
                  </span>
                </div>
                <div className="ctx-meta">
                  move <span>{mn}</span> · you play{' '}
                  <span>
                    {current.abdulsColor === 'white' ? '\u25CB' : '\u25CF'} {current.abdulsColor}
                  </span>
                  {current.speed && current.speed !== 'unknown' && (
                    <>
                      {' '}
                      ·{' '}
                      <span>
                        {current.speed}
                        {current.timeControl ? ` ${current.timeControl}` : ''}
                      </span>
                    </>
                  )}{' '}
                  · <span>{current.date.replace(/\./g, '-')}</span>
                </div>
              </div>
            </div>

            <div className="puzzle-prompt">find the best move</div>

            <div className="board-row">
              <Board
                chess={chess}
                orientation={current.abdulsColor}
                selected={selected}
                legalFrom={legalFrom}
                lastFrom={lastFrom}
                lastTo={lastTo}
                flashOk={flashOk}
                flashFail={flashFail}
                bounceBack={bounceBack}
                introMove={introMove}
                revealed={revealed || awaitingRetry}
                onSquareClick={onSquareClick}
                onDragMove={makeMove}
              />

              {/* Always reserve the 280px panel slot so the board doesn't shift
                  horizontally when the result appears. Before reveal the
                  slot hosts a "show solution" escape hatch; after reveal
                  it shows the result panel with eval details + next. */}
              <div className="result-slot">
                {revealed && yourMove ? (
                  <ResultPanel
                    puzzle={current}
                    yourMove={yourMove}
                    attempts={attempts}
                    isOk={isOk}
                    onRetry={retry}
                    onNext={next}
                  />
                ) : (
                  <div className="pre-result">
                    <div className="r-line">
                      <span
                        className={
                          current.abdulsColor === 'white'
                            ? 'r-status-turn-w'
                            : 'r-status-turn-b'
                        }
                      ></span>
                      <span
                        style={{
                          color:
                            current.abdulsColor === 'white'
                              ? 'var(--yellow)'
                              : 'var(--cyan)',
                        }}
                      >
                        {current.abdulsColor} to move
                      </span>
                    </div>
                    <button
                      className="abtn"
                      onClick={showSolution}
                      disabled={awaitingRetry}
                    >
                      show solution
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </TerminalShell>
  );
}

/** Group all legal moves at the current position by their `from` square. */
function groupLegal(c: Chess): Record<string, Move[]> {
  const out: Record<string, Move[]> = {};
  for (const m of c.moves({ verbose: true }) as Move[]) {
    if (!out[m.from]) out[m.from] = [];
    out[m.from].push(m);
  }
  return out;
}

/**
 * Classify a puzzle by how many plies had been played before the critical
 * position. Thresholds are the conventional-commentary breakpoints:
 *   · opening    — moves 1–12     (plies 0–23)
 *   · middlegame — moves 13–30    (plies 24–59)
 *   · endgame    — move 31+       (plies 60+)
 * These are heuristics, not hard definitions (a true endgame classifier
 * would look at material too), but they're accurate enough for a filter.
 */
function phaseOf(p: Puzzle): GamePhase {
  const ply = p.setupMoves.length;
  if (ply < 24) return 'opening';
  if (ply < 60) return 'middlegame';
  return 'endgame';
}
