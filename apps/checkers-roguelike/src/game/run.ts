import {
  createEmptyBoard,
  isDarkSquare,
  makePiece,
} from "../engine/board";
import { UPGRADE } from "../engine/upgrades";
import type { Board, Piece, Player } from "../engine/types";

// Roguelike run structure: the 10-floor ladder, the player's persistent 4-piece
// roster, per-floor board generation (size tiers + rectangular shape variants),
// and upgrade assignment. Difficulty numbers are centralized here for tuning —
// the design doc flags exact AI depth and the shape schedule as open questions,
// so this table is meant to be the one place you edit them.

export const PLAYER: Player = "red";
export const AI: Player = "black";
export const STARTING_PIECES = 4;

export interface FloorConfig {
  floor: number; // 1-based
  rows: number;
  cols: number;
  aiDepth: number; // search depth = primary difficulty knob
  aiPieces: number; // opponent piece count (player is always STARTING_PIECES)
  shape: "square" | "wide" | "long"; // rectangular variant, for UI/flavor
}

/**
 * The ladder. Size tiers per the design doc (6x6 → 8x8 → 10x10), with a few
 * floors rolling a rectangular variant (wide = extra columns, long = extra
 * rows). Fixed schedule for now (deterministic + testable) rather than random.
 */
export const FLOORS: FloorConfig[] = [
  { floor: 1, rows: 6, cols: 6, aiDepth: 2, aiPieces: 4, shape: "square" },
  { floor: 2, rows: 6, cols: 8, aiDepth: 2, aiPieces: 5, shape: "wide" },
  { floor: 3, rows: 6, cols: 6, aiDepth: 3, aiPieces: 5, shape: "square" },
  { floor: 4, rows: 8, cols: 8, aiDepth: 3, aiPieces: 6, shape: "square" },
  { floor: 5, rows: 8, cols: 10, aiDepth: 3, aiPieces: 7, shape: "wide" },
  { floor: 6, rows: 8, cols: 8, aiDepth: 4, aiPieces: 8, shape: "square" },
  { floor: 7, rows: 10, cols: 8, aiDepth: 3, aiPieces: 8, shape: "long" },
  { floor: 8, rows: 10, cols: 10, aiDepth: 4, aiPieces: 9, shape: "square" },
  { floor: 9, rows: 10, cols: 12, aiDepth: 3, aiPieces: 10, shape: "wide" },
  { floor: 10, rows: 10, cols: 10, aiDepth: 4, aiPieces: 12, shape: "square" },
];

export const FINAL_FLOOR = FLOORS.length;

export function floorConfig(floor: number): FloorConfig {
  return FLOORS[Math.min(floor, FINAL_FLOOR) - 1];
}

export function boardLabel(cfg: FloorConfig): string {
  return `${cfg.rows}×${cfg.cols}`;
}

/**
 * One of the player's persistent pieces. Upgrades and the crowned state carry
 * across floors; a piece captured mid-match is not lost from the roster (each
 * floor fields the full roster fresh).
 */
export interface RosterPiece {
  upgrades: string[];
  king: boolean;
}

export function createRoster(): RosterPiece[] {
  return Array.from({ length: STARTING_PIECES }, () => ({
    upgrades: [],
    king: false,
  }));
}

/** Whether a roster piece can still receive a given upgrade (no duplicates). */
export function canReceive(piece: RosterPiece, upgradeId: string): boolean {
  if (piece.upgrades.includes(upgradeId)) return false;
  if (upgradeId === UPGRADE.EarlyKing && piece.king) return false;
  return true;
}

/** Apply an upgrade to one roster piece, returning a new roster. */
export function applyUpgrade(
  roster: RosterPiece[],
  pieceIndex: number,
  upgradeId: string,
): RosterPiece[] {
  return roster.map((p, i) => {
    if (i !== pieceIndex) return p;
    const next: RosterPiece = {
      upgrades: [...p.upgrades, upgradeId],
      king: p.king || upgradeId === UPGRADE.EarlyKing,
    };
    return next;
  });
}

function rosterToPiece(rp: RosterPiece, label: number): Piece {
  const piece = makePiece(PLAYER, rp.king);
  piece.upgrades = [...rp.upgrades];
  piece.label = label; // 1-based roster number, matches the upgrade panel
  return piece;
}

/**
 * Fill a side's home squares with `pieces`, packed from the home edge inward on
 * dark squares. Red's home is the bottom rows (advancing up); black's is the
 * top rows (advancing down).
 */
function place(board: Board, pieces: Piece[], side: Player): void {
  const rowOrder =
    side === PLAYER
      ? [...Array(board.rows).keys()].reverse() // bottom-up
      : [...Array(board.rows).keys()]; // top-down
  let idx = 0;
  for (const row of rowOrder) {
    for (let col = 0; col < board.cols; col++) {
      if (idx >= pieces.length) return;
      if (isDarkSquare(row, col)) board.squares[row][col] = pieces[idx++];
    }
  }
}

/** Build the starting board for a floor: player roster vs. AI pieces. */
export function buildFloorBoard(cfg: FloorConfig, roster: RosterPiece[]): Board {
  const board = createEmptyBoard(cfg.rows, cfg.cols);
  place(board, roster.map((rp, i) => rosterToPiece(rp, i + 1)), PLAYER);
  place(
    board,
    Array.from({ length: cfg.aiPieces }, () => makePiece(AI)),
    AI,
  );
  return board;
}
