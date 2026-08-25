import { inBounds } from "./board";
import type { Board, Coord, Piece } from "./types";

// Engine-side upgrade *effects*. Only the ids and their gameplay hooks live
// here; the player-facing catalog (names, descriptions, which are offered) is
// in the game layer (../game/upgrades.ts) and references these ids. Piece
// upgrades are stored as plain string ids on Piece.upgrades, so the base engine
// stays standard and these checks layer cleanly on top.

export const UPGRADE = {
  BackwardStrike: "backward-strike",
  LongLeap: "long-leap",
  Fortified: "fortified",
  Swift: "swift",
  EarlyKing: "early-king",
  DoubleStrike: "double-strike",
  Guardian: "guardian",
  PhantomStep: "phantom-step",
} as const;

export type UpgradeId = (typeof UPGRADE)[keyof typeof UPGRADE];

export function hasUpgrade(piece: Piece, id: UpgradeId): boolean {
  return piece.upgrades.includes(id);
}

/** Backward-strike lets a non-king capture in all directions (like a king). */
export function canCaptureAnyDirection(piece: Piece): boolean {
  return piece.king || hasUpgrade(piece, UPGRADE.BackwardStrike);
}

const NEIGHBORS: ReadonlyArray<Coord> = [
  { row: -1, col: -1 },
  { row: -1, col: 0 },
  { row: -1, col: 1 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
];

/**
 * Guardian aura: the piece at `coord` cannot be captured if a friendly piece
 * with the Guardian upgrade sits on an adjacent square. Used to veto capture
 * hops whose victim is protected.
 */
export function isGuarded(board: Board, coord: Coord): boolean {
  const victim = board.squares[coord.row][coord.col];
  if (!victim) return false;
  for (const d of NEIGHBORS) {
    const n = { row: coord.row + d.row, col: coord.col + d.col };
    if (!inBounds(board, n)) continue;
    const neighbor = board.squares[n.row][n.col];
    if (neighbor && neighbor.owner === victim.owner && hasUpgrade(neighbor, UPGRADE.Guardian)) {
      return true;
    }
  }
  return false;
}
