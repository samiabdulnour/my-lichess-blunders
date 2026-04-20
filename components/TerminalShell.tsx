import type { SessionStats } from '@/lib/types';

interface TerminalShellProps {
  loadedCount: number;
  stats: SessionStats;
  children: React.ReactNode;
}

/**
 * Outer window frame. Just a centered "blunder-trainer" label and the
 * app body — no fake macOS chrome, no stats strip.
 *
 * `loadedCount` and `stats` are accepted but currently unused; the page
 * may re-introduce a stats display elsewhere.
 */
export function TerminalShell({ children }: TerminalShellProps) {
  return (
    <div className="window">
      <div className="titlebar">
        <span className="titlebar-text">my-lichess-blunders</span>
        <a
          className="titlebar-author"
          href="https://github.com/samiabdulnour"
          target="_blank"
          rel="noopener noreferrer"
          title="View author on GitHub"
        >
          @samiabdulnour
        </a>
      </div>
      <div className="app">{children}</div>
    </div>
  );
}
