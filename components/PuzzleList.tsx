'use client';

import { useMemo } from 'react';
import type {
  Puzzle,
  SolveStatus,
  Filter,
  EcoFilter,
  SpeedFilter,
  PhaseFilter,
} from '@/lib/types';
import type { ThemeMode } from '@/lib/storage';
import { ecoName } from '@/lib/eco-names';
import { ImportControls } from './ImportControls';

interface PuzzleListProps {
  all: Puzzle[];
  filtered: Puzzle[];
  filter: Filter;
  ecoFilter: EcoFilter;
  speedFilter: SpeedFilter;
  phaseFilter: PhaseFilter;
  current: Puzzle | null;
  solved: Record<string, SolveStatus>;
  /** Unseen puzzle count, used by auto-fetch to decide when to pull more. */
  unseenCount: number;
  /** Random-order toggle: when on, "next" picks a random unsolved puzzle. */
  randomOrder: boolean;
  /** Active color theme; used to render the right state for the toggle. */
  theme: ThemeMode;
  onFilterChange: (f: Filter) => void;
  onEcoFilterChange: (e: EcoFilter) => void;
  onSpeedFilterChange: (s: SpeedFilter) => void;
  onPhaseFilterChange: (p: PhaseFilter) => void;
  onSelect: (p: Puzzle) => void;
  onImport: (newPuzzles: Puzzle[]) => void;
  onClearAll: () => void;
  onRandomOrderChange: (on: boolean) => void;
  onThemeChange: (t: ThemeMode) => void;
}

/** Time-format options in the order Lichess presents them. */
const SPEEDS: { value: SpeedFilter; label: string }[] = [
  { value: 'all', label: 'all time formats' },
  { value: 'bullet', label: 'bullet' },
  { value: 'blitz', label: 'blitz' },
  { value: 'rapid', label: 'rapid' },
  { value: 'classical', label: 'classical' },
];

/** Game-phase filter options. */
const PHASES: { value: PhaseFilter; label: string }[] = [
  { value: 'all', label: 'all phases' },
  { value: 'opening', label: 'opening' },
  { value: 'middlegame', label: 'middlegame' },
  { value: 'endgame', label: 'endgame' },
];

export function PuzzleList({
  all,
  filtered,
  filter,
  ecoFilter,
  speedFilter,
  phaseFilter,
  current,
  solved,
  unseenCount,
  randomOrder,
  theme,
  onFilterChange,
  onEcoFilterChange,
  onSpeedFilterChange,
  onPhaseFilterChange,
  onSelect,
  onImport,
  onClearAll,
  onRandomOrderChange,
  onThemeChange,
}: PuzzleListProps) {
  /* Build the ECO option list from the puzzles we actually have. Every
     distinct ECO code, sorted, with its full opening name attached. */
  const codes = useMemo(() => {
    const set = new Set<string>();
    for (const p of all) {
      if (p.eco) set.add(p.eco);
    }
    return Array.from(set).sort();
  }, [all]);

  return (
    <div className="side">
      <ImportControls
        onImport={onImport}
        onClearAll={onClearAll}
        unseenCount={unseenCount}
      />
      <div className="side-header">
        <div className="side-prompt">filter puzzles</div>
      </div>
      <div className="fbrow">
        {(['new', 'retry', 'all'] as const).map((f) => (
          <button
            key={f}
            className={'fb' + (filter === f ? ' on' : '')}
            onClick={() => onFilterChange(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="eco-filter">
        <label className="eco-filter-label" htmlFor="speed-select">
          time format
        </label>
        <select
          id="speed-select"
          className="eco-select"
          value={speedFilter}
          onChange={(e) => onSpeedFilterChange(e.target.value as SpeedFilter)}
        >
          {SPEEDS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="eco-filter">
        <label className="eco-filter-label" htmlFor="phase-select">
          game phase
        </label>
        <select
          id="phase-select"
          className="eco-select"
          value={phaseFilter}
          onChange={(e) => onPhaseFilterChange(e.target.value as PhaseFilter)}
        >
          {PHASES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="eco-filter">
        <label className="eco-filter-label" htmlFor="eco-select">
          opening
        </label>
        <select
          id="eco-select"
          className="eco-select"
          value={ecoFilter}
          onChange={(e) => onEcoFilterChange(e.target.value)}
        >
          <option value="all">all openings</option>
          {codes.map((c) => {
            const name = ecoName(c);
            return (
              <option key={c} value={c}>
                {name ? `${c} — ${name}` : c}
              </option>
            );
          })}
        </select>
      </div>
      {/* Preference toggles. Two side-by-side switches for random order
          (affects "next puzzle" picking) and dark theme (drives the
          [data-theme] attribute on <html> from page.tsx). */}
      <div className="prefs">
        <button
          type="button"
          role="switch"
          aria-checked={randomOrder}
          className={'pref-toggle' + (randomOrder ? ' on' : '')}
          onClick={() => onRandomOrderChange(!randomOrder)}
          title="Pick the next puzzle at random instead of in order"
        >
          <span className="pref-knob" />
          <span className="pref-label">random order</span>
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={theme === 'dark'}
          className={'pref-toggle' + (theme === 'dark' ? ' on' : '')}
          onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          title="Switch between light and dark theme"
        >
          <span className="pref-knob" />
          <span className="pref-label">dark mode</span>
        </button>
      </div>
      <div className="qline">
        → <span>{filtered.length}</span> puzzles matched
      </div>
      <div className="plist">
        {filtered.map((p) => {
          const st = solved[p.id];
          const isCurrent = current?.id === p.id;
          const cls =
            'pi' +
            (st === 'ok' ? ' done-ok' : st === 'fail' ? ' done-fail' : '') +
            (isCurrent ? ' cur' : '');
          const ico =
            st === 'ok' ? '\u2713' : st === 'fail' ? '\u2717' : p.type === 'blunder' ? '\u26A0' : '!';
          const ic =
            st === 'ok'
              ? 'var(--green)'
              : st === 'fail'
                ? 'var(--red)'
                : p.type === 'blunder'
                  ? 'var(--red)'
                  : 'var(--yellow)';
          const dc = p.type === 'blunder' ? 'var(--red)' : 'var(--yellow)';
          return (
            <div key={p.id} className={cls} onClick={() => onSelect(p)}>
              <span className="pi-ico" style={{ color: ic }}>
                {ico}
              </span>
              <div className="pi-info">
                <div className="pi-opp">
                  {p.player
                    ? p.abdulsColor === 'white'
                      ? `${p.player} vs ${p.opponent}`
                      : `${p.opponent} vs ${p.player}`
                    : `vs ${p.opponent}`}
                </div>
                <div className="pi-meta">
                  {p.eco} · {p.date.replace(/\./g, '-')}
                </div>
              </div>
              <span className="pi-drop" style={{ color: dc }}>
                -{p.drop.toFixed(1)}
              </span>
            </div>
          );
        })}
        {all.length === 0 && (
          <div style={{ padding: '14px', fontSize: '11px', color: 'var(--txt-dim)' }}>
            No puzzles yet. Import games from Lichess to generate some.
          </div>
        )}
      </div>
    </div>
  );
}
