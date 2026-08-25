import type { Board, Coord, Piece, Player, Square } from "./types";

// Board construction and access helpers. All generic over rows/cols.
//
// Orientation convention used throughout the engine:
//   - "black" starts on the top rows (low indices) and advances DOWN (+row).
//   - "red"   starts on the bottom rows (high indices) and advances UP (-row).
// Pieces live only on dark squares, where (row + col) is odd.

export function isDarkSquare(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export function inBounds(board: Board, c: Coord): boolean {
  return c.row >= 0 && c.row < board.rows && c.col >= 0 && c.col < board.cols;
}

export function pieceAt(board: Board, c: Coord): Square {
  if (!inBounds(board, c)) return null;
  return board.squares[c.row][c.col];
}

export function createEmptyBoard(rows: number, cols: number): Board {
  const squares: Square[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null as Square),
  );
  return { rows, cols, squares };
}

/** Deep-ish clone: new grid + new piece objects so mutation never leaks. */
export function cloneBoard(board: Board): Board {
  return {
    rows: board.rows,
    cols: board.cols,
    squares: board.squares.map((row) =>
      row.map((sq) => (sq ? { ...sq, upgrades: [...sq.upgrades] } : null)),
    ),
  };
}

let pieceCounter = 0;
export function makePiece(owner: Player, king = false): Piece {
  return { id: `p${pieceCounter++}`, owner, king, upgrades: [] };
}

/**
 * The direction a non-king piece of `player` advances in (delta row).
 * Kings ignore this and move both ways.
 */
export function forwardDir(player: Player): number {
  return player === "black" ? 1 : -1;
}

/** The row that crowns a piece of `player` (the far edge from its start). */
export function crownRow(board: Board, player: Player): number {
  return player === "black" ? board.rows - 1 : 0;
}

/**
 * Standard-style fill: pack dark squares from each player's home edge inward,
 * `rowsPerSide` deep. Generic over board size. The roguelike's custom starting
 * setup (4 pieces, etc.) is built elsewhere; this is the "normal game" helper
 * used for tests and reference.
 */
export function createStandardBoard(
  rows: number,
  cols: number,
  rowsPerSide = Math.max(1, Math.floor((rows - 2) / 2)),
): Board {
  const board = createEmptyBoard(rows, cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!isDarkSquare(row, col)) continue;
      if (row < rowsPerSide) {
        board.squares[row][col] = makePiece("black");
      } else if (row >= rows - rowsPerSide) {
        board.squares[row][col] = makePiece("red");
      }
    }
  }
  return board;
}

export function allPieces(
  board: Board,
): Array<{ coord: Coord; piece: Piece }> {
  const out: Array<{ coord: Coord; piece: Piece }> = [];
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      const piece = board.squares[row][col];
      if (piece) out.push({ coord: { row, col }, piece });
    }
  }
  return out;
}

export function countPieces(board: Board, player: Player): number {
  let n = 0;
  for (const { piece } of allPieces(board)) if (piece.owner === player) n++;
  return n;
}
