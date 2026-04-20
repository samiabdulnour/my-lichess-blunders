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
  const [filter, setFilter] = useState<Filter>('all');
  const [ecoFilter, setEcoFilter] = useState<EcoFilter>('all');
  const [speedFilter, setSpeedFilter] = useState<SpeedFilter>('all');
  const [current, setCurrent] = useState<Puzzle | null>(null);
  const [chess, setChess] = useState<Chess>(() => new Chess());
  const [selected, setSelected] = useState<string | null>(null);
  const [legalFrom, setLegalFrom] = useState<Record<string, Move[]>>({});
  const [lastFrom, setLastFrom] = useState<string | null>(null);
  const [lastTo, setLastTo] = useState<string | null>(null);
  const [flashOk, setFlashOk] = useState<string | null>(null);
  const [flashFail, setFlashFail] = useState<string | null>(null);
  /** Destination square of the puzzle's best move — used to paint the
   *  correct square green when the user picks the wrong one. */
  const [bestTo, setBestTo] = useState<string | null>(null);
  /** Source square of the puzzle's best move — painted green alongside
   *  `bestTo` on a miss so the user can see which piece should have moved. */
  const [bestFrom, setBestFrom] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [yourMove, setYourMove] = useState<string | null>(null);
  const [isOk, setIsOk] = useState(false);
  const [solved, setSolved] = useState<Record<string, SolveStatus>>({});
  const [stats, setStats] = useState<SessionStats>({ correct: 0, wrong: 0, streak: 0 });
  const hydrated = useRef(false);
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
     Apply the type filter first, then narrow further by exact ECO code. */
  const filtered = useMemo(() => {
    let list = all;
    if (filter === 'blunder') list = list.filter((p) => p.type === 'blunder');
    else if (filter === 'unseen') list = list.filter((p) => !solved[p.id]);

    if (ecoFilter !== 'all') {
      list = list.filter((p) => p.eco === ecoFilter);
    }
    if (speedFilter !== 'all') {
      list = list.filter((p) => p.speed === speedFilter);
    }
    return list;
  }, [all, filter, ecoFilter, speedFilter, solved]);

  /* ── Load a puzzle: replay its setup moves and hand over to the board ── */
  const loadPuzzle = useCallback((p: Puzzle) => {
    const c = new Chess();
    for (const mv of p.setupMoves) {
      try {
        c.move(mv);
      } catch (err) {
        console.warn(`Illegal setup move "${mv}" in puzzle ${p.id}`, err);
        break;
      }
    }
    // Probe the best move on a clone so the main state stays on the
    // "before" position — this gives us the source + destination squares,
    // both of which the board highlights green when the user picks a wrong
    // move (source so you can see which piece, destination for where).
    let bestFromSq: string | null = null;
    let bestToSq: string | null = null;
    try {
      const probe = new Chess(c.fen());
      const m = probe.move(p.bestMove);
      bestFromSq = m?.from ?? null;
      bestToSq = m?.to ?? null;
    } catch {
      /* Puzzle data is slightly malformed — no green hint, but playable. */
    }
    setCurrent(p);
    currentRef.current = p;
    setChess(c);
    setSelected(null);
    setLastFrom(null);
    setLastTo(null);
    setFlashOk(null);
    setFlashFail(null);
    setBestTo(bestToSq);
    setBestFrom(bestFromSq);
    setRevealed(false);
    setYourMove(null);
    setLegalFrom(groupLegal(c));
  }, []);

  /* ── Handle a click on a board square ── */
  const onSquareClick = useCallback(
    (sqn: string) => {
      if (revealed || !current) return;
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
    [revealed, current, chess, selected, legalFrom]
  );

  /* ── Apply a move and compare to the puzzle's best move ── */
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
    setChess(next);
    setSelected(null);
    setLastFrom(mv.from);
    setLastTo(mv.to);
    setRevealed(true);
    setYourMove(applied.san);
    setIsOk(ok);

    // Paint the user's destination square green (correct) or red (wrong).
    // These are persistent — they stay until the user advances to another
    // puzzle, so they act as an "answer marker" on the board itself. The
    // correct square (from `bestTo`) also turns green on a miss, handled
    // by the Board component via the `bestRevealed` prop.
    if (ok) setFlashOk(mv.to);
    else setFlashFail(mv.to);

    setSolved((prev) => {
      if (prev[current.id]) return prev;
      return { ...prev, [current.id]: ok ? 'ok' : 'fail' };
    });
    setStats((prev) => {
      if (solved[current.id]) return prev;
      return ok
        ? { correct: prev.correct + 1, wrong: prev.wrong, streak: prev.streak + 1 }
        : { correct: prev.correct, wrong: prev.wrong + 1, streak: 0 };
    });
  };

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
  const turn = chess.turn();
  const turnLabel = turn === 'w' ? 'WHITE TO MOVE' : 'BLACK TO MOVE';
  const turnClass = turn === 'w' ? 'tb-w' : 'tb-b';

  return (
    <TerminalShell loadedCount={all.length} stats={stats}>
      <PuzzleList
        all={all}
        filtered={filtered}
        filter={filter}
        ecoFilter={ecoFilter}
        speedFilter={speedFilter}
        current={current}
        solved={solved}
        onFilterChange={setFilter}
        onEcoFilterChange={setEcoFilter}
        onSpeedFilterChange={setSpeedFilter}
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
              <span className={`tbadge ${turnClass}`}>{turnLabel}</span>
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
                bestRevealed={revealed && !isOk ? bestTo : null}
                bestFromRevealed={revealed && !isOk ? bestFrom : null}
                revealed={revealed}
                onSquareClick={onSquareClick}
              />

              {/* Always reserve the 280px panel slot so the board doesn't shift
                  horizontally when the result appears. */}
              <div className="result-slot" aria-hidden={!revealed}>
                {revealed && yourMove && (
                  <ResultPanel
                    puzzle={current}
                    yourMove={yourMove}
                    isOk={isOk}
                    onRetry={retry}
                    onNext={next}
                  />
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
