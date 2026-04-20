import { Chess } from 'chess.js';

/**
 * A single move from a parsed PGN, with the eval annotation if present.
 *
 * `evalCp` is in centipawns, white-positive (e.g. +120 = white is up ~1.2
 * pawns). It's null for plies the engine didn't analyze.
 *
 * `mate` is signed: +N means white mates in N, -N means black mates in N.
 * It's set instead of evalCp when the position is a forced mate.
 */
export interface ParsedMove {
  /** 1-based ply number (1 = white's first move). */
  ply: number;
  /** Side that played this move. */
  color: 'w' | 'b';
  /** Move in SAN notation, e.g. "Nxe5". */
  san: string;
  /** FEN of the position *before* this move was played. */
  fenBefore: string;
  /** FEN of the position *after* this move was played. */
  fenAfter: string;
  /** Engine eval after this move, in centipawns (white-positive). */
  evalCp: number | null;
  /** Mate distance after this move (signed: +N = white mates in N). */
  mate: number | null;
  /** Lichess judgment, if attached: "Inaccuracy" | "Mistake" | "Blunder". */
  judgment: string | null;
}

export interface ParsedGame {
  /** All standard PGN headers, lowercased keys. */
  headers: Record<string, string>;
  /** Lichess game id, parsed from the Site header if it's a lichess.org URL. */
  gameId: string | null;
  /** Direct URL to the game on lichess.org, if derivable. */
  site: string | null;
  /** Player names. */
  white: string;
  black: string;
  /** ECO code, e.g. "C50". */
  eco: string;
  /** Date in PGN format ("YYYY.MM.DD"). */
  date: string;
  /** Moves in order, with eval annotations attached. */
  moves: ParsedMove[];
}

/**
 * Split a PGN file containing one or more games into individual game blocks.
 *
 * Lichess exports games separated by blank lines between the result token
 * (`1-0`, `0-1`, `1/2-1/2`, `*`) of one game and the headers of the next.
 */
function splitGames(pgnText: string): string[] {
  const lines = pgnText.split(/\r?\n/);
  const games: string[] = [];
  let buffer: string[] = [];
  let sawMoves = false;

  for (const line of lines) {
    if (line.trim() === '' && sawMoves) {
      // Blank line after we've seen the moves — game boundary
      games.push(buffer.join('\n').trim());
      buffer = [];
      sawMoves = false;
      continue;
    }
    buffer.push(line);
    if (!line.startsWith('[') && line.trim() !== '') sawMoves = true;
  }

  if (buffer.length > 0) {
    const last = buffer.join('\n').trim();
    if (last) games.push(last);
  }

  return games.filter((g) => g.includes('['));
}

/** Pull the eval and judgment out of a comment string like
 *  "[%eval 0.32] [%clk 0:01:30]" or "Mistake. Best was Nf6. [%eval -1.4]". */
function parseComment(comment: string): {
  evalCp: number | null;
  mate: number | null;
  judgment: string | null;
} {
  let evalCp: number | null = null;
  let mate: number | null = null;
  let judgment: string | null = null;

  // %eval can be a decimal pawn value ("0.32", "-1.4") or "#3" / "#-2" for mate
  const evalMatch = comment.match(/\[%eval\s+(#?-?\d+(?:\.\d+)?)\]/);
  if (evalMatch) {
    const v = evalMatch[1];
    if (v.startsWith('#')) {
      mate = parseInt(v.slice(1), 10);
    } else {
      evalCp = Math.round(parseFloat(v) * 100);
    }
  }

  // Lichess's text-form judgment: "Mistake.", "Blunder.", "Inaccuracy."
  const judgeMatch = comment.match(/\b(Inaccuracy|Mistake|Blunder)\b/);
  if (judgeMatch) judgment = judgeMatch[1];

  return { evalCp, mate, judgment };
}

/**
 * Parse a single PGN game (headers + moves + comments) into a ParsedGame.
 *
 * Uses chess.js's loadPgn for the SAN/FEN walk, then extracts eval comments
 * via getComments() and aligns them to plies by FEN.
 */
function parseSingleGame(pgnBlock: string): ParsedGame | null {
  const chess = new Chess();
  try {
    // chess.js v1 throws on malformed PGN
    chess.loadPgn(pgnBlock);
  } catch (err) {
    console.warn('Failed to parse PGN block:', err);
    return null;
  }

  const headers = chess.header();
  const lcHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lcHeaders[k.toLowerCase()] = v as string;

  // Comments are returned as { fen, comment }[] — index by fen for lookup.
  const commentsByFen: Record<string, string> = {};
  for (const c of chess.getComments()) commentsByFen[c.fen] = c.comment;

  // Walk the move history to capture fenBefore/fenAfter and align eval comments.
  // chess.js doesn't give us before-FEN per move directly, so we replay.
  const history = chess.history({ verbose: true });
  const replay = new Chess();
  const moves: ParsedMove[] = [];

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const fenBefore = replay.fen();
    replay.move(h.san);
    const fenAfter = replay.fen();
    const comment = commentsByFen[fenAfter] ?? '';
    const { evalCp, mate, judgment } = parseComment(comment);
    moves.push({
      ply: i + 1,
      color: h.color,
      san: h.san,
      fenBefore,
      fenAfter,
      evalCp,
      mate,
      judgment,
    });
  }

  // Derive Lichess game id from the Site header (e.g. "https://lichess.org/abcd1234")
  const siteHeader = lcHeaders['site'] ?? '';
  const lichessMatch = siteHeader.match(/lichess\.org\/([a-zA-Z0-9]{8})/);
  const gameId = lichessMatch ? lichessMatch[1] : null;
  const site = gameId ? `https://lichess.org/${gameId}` : siteHeader || null;

  return {
    headers: lcHeaders,
    gameId,
    site,
    white: lcHeaders['white'] ?? 'Unknown',
    black: lcHeaders['black'] ?? 'Unknown',
    eco: lcHeaders['eco'] ?? '',
    date: lcHeaders['date'] ?? lcHeaders['utcdate'] ?? '????.??.??',
    moves,
  };
}

/**
 * Parse a PGN file (one or many games) into an array of ParsedGames.
 * Games that fail to parse are skipped with a warning.
 */
export function parsePgn(pgnText: string): ParsedGame[] {
  const blocks = splitGames(pgnText);
  const games: ParsedGame[] = [];
  for (const block of blocks) {
    const g = parseSingleGame(block);
    if (g) games.push(g);
  }
  return games;
}
