// Core checkers types. Kept standard and generic — no board dimensions are
// hard-coded here; everything works off the `Board` bounds it's handed.

export type Player = "red" | "black";

export interface Coord {
  row: number;
  col: number;
}

export interface Piece {
  id: string;
  owner: Player;
  king: boolean;
  /**
   * Roguelike upgrade slots. The base engine ignores these; upgrade behaviour
   * is layered on separately so the core stays standard. Empty for v1 base.
   */
  upgrades: string[];
  /**
   * Optional display number — the player's roster slot (1-based), so on-board
   * pieces line up with the "Piece N" labels in the upgrade panel. Presentation
   * only; the engine never reads it. Unset for AI pieces.
   */
  label?: number;
}

/** A single square holds a piece or nothing. */
export type Square = Piece | null;

/**
 * The board is a plain rows x cols grid. Non-square and variable sizes are
 * first-class — nothing assumes 8x8.
 */
export interface Board {
  rows: number;
  cols: number;
  /** Row-major: squares[row][col]. */
  squares: Square[][];
}

export interface Move {
  from: Coord;
  to: Coord;
  /** Coords of pieces captured along the way (empty for a plain slide). */
  captures: Coord[];
  /** True if this move results in the moving piece being crowned. */
  crowns: boolean;
}

/**
 * A complete turn for one side: either a single slide, or a full capture chain
 * played to completion. `board` is the resulting position after all hops.
 * The human plays these hop-by-hop; the AI and search reason in whole turns.
 */
export interface Turn {
  moves: Move[];
  board: Board;
}

export function coordKey(c: Coord): string {
  return `${c.row},${c.col}`;
}

export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

export function opponent(player: Player): Player {
  return player === "red" ? "black" : "red";
}
