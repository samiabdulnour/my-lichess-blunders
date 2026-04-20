'use client';

import type { Puzzle, SolveStatus, Filter } from '@/lib/types';
import { ImportControls } from './ImportControls';

interface PuzzleListProps {
  all: Puzzle[];
  filtered: Puzzle[];
  filter: Filter;
  current: Puzzle | null;
  solved: Record<string, SolveStatus>;
  onFilterChange: (f: Filter) => void;
  onSelect: (p: Puzzle) => void;
  onImport: (newPuzzles: Puzzle[]) => void;
}

export function PuzzleList({
  all,
  filtered,
  filter,
  current,
  solved,
  onFilterChange,
  onSelect,
  onImport,
}: PuzzleListProps) {
  return (
    <div className="side">
      <ImportControls onImport={onImport} />
      <div className="side-header">
        <div className="side-prompt">filter puzzles</div>
      </div>
      <div className="fbrow">
        {(['all', 'blunder', 'unseen'] as const).map((f) => (
          <button
            key={f}
            className={'fb' + (filter === f ? ' on' : '')}
            onClick={() => onFilterChange(f)}
          >
            {f === 'blunder' ? 'blunders' : f}
          </button>
        ))}
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
                <div className="pi-opp">vs {p.opponent}</div>
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
