import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'blunder-trainer',
  description: 'Puzzles from your own Lichess mistakes.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
