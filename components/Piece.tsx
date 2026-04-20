/**
 * Renders a single chess piece using the cburnett SVG set (the same one
 * Lichess uses by default). The SVGs live in `public/pieces/cburnett/`
 * and are fetched as static assets.
 *
 * To switch piece sets later, drop a new set into `public/pieces/<set>/`
 * with the same `${color}${type}.svg` naming convention and change the
 * `SET` constant below.
 */

const SET = 'cburnett';

interface PieceProps {
  color: 'w' | 'b';
  type: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
}

export function Piece({ color, type }: PieceProps) {
  const key = color + type.toUpperCase();
  return (
    <img
      className="piece"
      src={`/pieces/${SET}/${key}.svg`}
      alt={key}
      draggable={false}
    />
  );
}
