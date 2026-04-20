# my-lichess-blunders

Puzzles from your own Lichess mistakes.

This is a Next.js port of the single-file HTML prototype. The UI and terminal
aesthetic are preserved; the data layer is now served from an API instead of
being embedded in the HTML, which is what made the prototype heavy.

## Status

| Piece                         | Status                    |
| ----------------------------- | ------------------------- |
| UI (board, sidebar, stats)    | Ported, working           |
| Seed puzzles                  | Two hand-crafted examples |
| `GET /api/puzzles`            | Returns seed puzzles      |
| `POST /api/lichess/import`    | Route stubbed             |
| `POST /api/analyze`           | Route stubbed             |
| `lib/lichess.ts`              | Types + outline, no impl  |
| `lib/stockfish.ts`            | Types + outline, no impl  |
| `lib/puzzle-generator.ts`     | Types + outline, no impl  |
| Persistence (SQLite / JSON)   | Not started               |

The three lib modules have full JSDoc and a reference implementation sketch
inside each — they are meant to be the next things you fill in.

## Run locally

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. You'll see the two seed puzzles in the
sidebar. Click one, play a move, and the result panel should appear.

```bash
npm run typecheck   # TypeScript sanity check
npm run build       # production build
```

## Architecture

```
blunder-trainer/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 # Main trainer UI (client component)
│   ├── globals.css              # All styling (ported from original)
│   └── api/
│       ├── puzzles/route.ts     # GET — serves puzzle list
│       ├── lichess/import/route.ts  # POST — { username } → imports games
│       └── analyze/route.ts     # POST — { fen }      → stockfish eval
├── components/
│   ├── Board.tsx                # 8x8 grid, click-to-move, legal-move dots
│   ├── Piece.tsx                # Unicode glyph (swap for SVG later)
│   ├── PuzzleList.tsx           # Sidebar with filters
│   ├── ResultPanel.tsx          # After-move breakdown
│   └── TerminalShell.tsx        # Title bar + stats strip + app frame
├── lib/
│   ├── types.ts                 # Puzzle, Filter, SessionStats
│   ├── seed-puzzles.ts          # Hand-crafted stub puzzles
│   ├── lichess.ts               # Lichess API client (stub)
│   ├── stockfish.ts             # Analysis backend (stub)
│   └── puzzle-generator.ts      # Game → Puzzle[] (stub)
└── ...config files
```

## Pipeline (the end goal)

```
┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐    ┌─────────────┐
│ Lichess API     │──► │ puzzle-generator │──► │ persistent store  │──► │ UI / puzzle │
│ (games + evals) │    │ (find critical   │    │ (SQLite or JSON)  │    │  solver     │
│                 │    │  positions)      │    │                   │    │             │
└─────────────────┘    └──────────────────┘    └───────────────────┘    └─────────────┘
         ▲                        │
         │                        ▼
         │               ┌─────────────────┐
         └───────────────│ stockfish       │
                         │ (verify / fill  │
                         │  gaps in evals) │
                         └─────────────────┘
```

Lichess already runs Stockfish on analyzed games, so for an MVP you can
**skip running Stockfish yourself** and trust the `analysis` array on each
game object. Use your own Stockfish only to fact-check or to deepen lines
the cloud didn't return.

## Key design decisions

**Pieces are Unicode, not SVG.** This keeps the scaffold tiny. To swap in a
real piece set, drop SVGs into `public/pieces/` and edit
`components/Piece.tsx` to render `<img src={`/pieces/${color}${type}.svg`} />`
instead. No call sites need to change.

**Drag-and-drop was not ported** (only click-to-move). It was about 40 lines
of global mouse handling in the original — straightforward to add back in a
follow-up, but it was making the port noisy.

**No database yet.** The puzzle list comes from a TypeScript constant. When
you start generating real puzzles, the simplest next step is a
`data/puzzles.json` that `/api/puzzles` reads on startup. Graduate to
`better-sqlite3` when you want filtering/indexing, and to Postgres only if
you actually go multi-user.

**Stockfish placement is deferred.** See `lib/stockfish.ts` — the three
options are spelled out. The Lichess cloud-eval option is the lightest
starting point.

## Suggested next steps (in order)

1. **Implement `fetchLichessGames`** in `lib/lichess.ts`. Test it from a
   scratch script with your own username.
2. **Implement `generatePuzzlesFromGame`** in `lib/puzzle-generator.ts` using
   only the `analysis` that Lichess already ships. This is the fastest path
   to seeing real puzzles.
3. **Add persistence** — a `data/puzzles.json` read by `/api/puzzles`, merged
   with seeds during the transition.
4. **Implement `analyzePosition`** in `lib/stockfish.ts` (start with Lichess
   cloud-eval) so you can verify best-move answers in the UI.
5. **Re-add drag-and-drop** in `components/Board.tsx`.
6. **Swap Unicode pieces for SVG pieces** in `components/Piece.tsx`.
