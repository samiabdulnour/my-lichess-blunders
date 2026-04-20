# my-lichess-blunders

Train on puzzles generated from your own Lichess mistakes.

## Features

- Import the last 50 of your Lichess games
- Stockfish finds your mistakes and generates puzzles from them
- Filter puzzles by type (all / blunders / unseen) or by opening (ECO code)
- Tracks solved/failed state across sessions in localStorage

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, enter your Lichess username, and click **Fetch last 50 games**.

## Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm run typecheck   # TypeScript check
```

## Stack

Next.js 15 · React 19 · TypeScript · chess.js · Stockfish
