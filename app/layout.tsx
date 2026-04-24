import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Blunders',
  description: 'Puzzles from your own Lichess mistakes.',
  manifest: '/manifest.webmanifest',
  /**
   * Home-screen icon + Apple-specific controls. Next.js maps these into
   * the right <link rel=...> + <meta name="apple-mobile-web-app-*"> tags.
   * `capable: true` makes iOS launch the app fullscreen when opened from
   * the home screen instead of showing the Safari chrome — the core UX
   * win of installing as a PWA.
   */
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'My Blunders',
    statusBarStyle: 'black-translucent',
  },
  applicationName: 'My Blunders',
};

export const viewport: Viewport = {
  themeColor: '#2da66a',
  /**
   * Lock the initial zoom so the board doesn't scale on double-tap, and
   * disable user scaling — a zoomed-in chessboard is never what we want,
   * and fullscreen PWA mode expects a non-zoomable layout.
   */
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
