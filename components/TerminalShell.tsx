'use client';

import { useEffect, useState } from 'react';
import type { SessionStats } from '@/lib/types';

interface TerminalShellProps {
  loadedCount: number;
  stats: SessionStats;
  children: React.ReactNode;
}

/**
 * Outer window frame. The titlebar hosts three elements:
 *  · a hamburger/X button on the left that toggles the sidebar,
 *  · the repo-name label, centered,
 *  · the author attribution on the right.
 *
 * The sidebar defaults to open on desktop and closed on mobile — we detect
 * the viewport after mount to avoid SSR/CSR hydration mismatches. The
 * toggle flips `.sidebar-open` on the `.app` container; CSS owns the
 * actual show/hide behavior per breakpoint.
 *
 * `loadedCount` and `stats` are accepted but currently unused; the page
 * may re-introduce a stats display elsewhere.
 */
export function TerminalShell({ children }: TerminalShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // After mount, collapse the sidebar on narrow viewports (mobile).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    if (mq.matches) setSidebarOpen(false);
  }, []);

  const toggle = () => setSidebarOpen((v) => !v);
  const closeOnMobile = () => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 768px)').matches) setSidebarOpen(false);
  };

  return (
    <div className="window">
      <div className="titlebar">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggle}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? (
            /* X icon (close) */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            /* Hamburger icon (open) */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
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
      <div className={'app' + (sidebarOpen ? ' sidebar-open' : '')}>
        {children}
        {/* Click-away overlay on mobile: tapping outside the sidebar closes it. */}
        {sidebarOpen && <div className="sidebar-scrim" onClick={closeOnMobile} />}
      </div>
    </div>
  );
}
