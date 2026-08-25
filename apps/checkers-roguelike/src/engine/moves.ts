import {
  cloneBoard,
  crownRow,
  forwardDir,
  inBounds,
  pieceAt,
} from "./board";
import type { Board, Coord, Move, Piece, Player, Turn } from "./types";
import { coordsEqual, opponent } from "./types";
import { UPGRADE, canCaptureAnyDirection, hasUpgrade, isGuarded } from "./upgrades";

// Standard checkers move generation, generic over board size.
//
// Base rules:
//   - Men slide/capture diagonally; forward only unless kinged.
//   - Kings slide/capture diagonally in all four directions (single step —
//     "American"/English draughts kings, not flying kings).
//   - Captures are NOT mandatory: plain slides and captures are both legal, and
//     the player may choose either. (House rule for this game.)
//   - Multi-jumps chain: once a capture is chosen, it continues from the landing
//     square while more captures are available with the same piece.
//
// Roguelike upgrades layered in (see ./upgrades):
//   - Backward-strike: a man may capture in all four directions.
//   - Swift: a man/king may slide (not capture) two squares.
//   - Guardian: a piece adjacent to a friendly Guardian can't be captured.
//   - Early-king: applied by crowning the piece; uses the normal king rules.
//   - Long-leap: a capture may reach a victim two squares away (one empty gap),
//     landing just beyond it. Applies to any capture hop.
//   - Double-strike: the same reach as Long-leap, but only on *continuation*
//     hops of a chain — lets a multi-jump cross to a non-adjacent diagonal.
//   - Fortified: the first capture that would remove the piece instead only
//     breaks its shield; the jumper still passes over (handled in applyMove).

const DIAGONALS: ReadonlyArray<Coord> = [
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 1 },
];

function moveDirs(piece: Piece): ReadonlyArray<Coord> {
  if (piece.king) return DIAGONALS;
  const fd = forwardDir(piece.owner);
  return DIAGONALS.filter((d) => d.row === fd);
}

function willCrown(board: Board, piece: Piece, dest: Coord): boolean {
  return !piece.king && dest.row === crownRow(board, piece.owner);
}

/** Plain (non-capturing) slides for a single piece, including Swift 2-steps. */
function simpleMovesFor(board: Board, from: Coord, piece: Piece): Move[] {
  const out: Move[] = [];
  const swift = hasUpgrade(piece, UPGRADE.Swift);
  for (const d of moveDirs(piece)) {
    const one = { row: from.row + d.row, col: from.col + d.col };
    if (!inBounds(board, one) || pieceAt(board, one) !== null) continue;
    out.push({ from, to: one, captures: [], crowns: willCrown(board, piece, one) });

    // Swift: a second empty square in the same direction (path must be clear).
    if (swift) {
      const two = { row: from.row + 2 * d.row, col: from.col + 2 * d.col };
      if (inBounds(board, two) && pieceAt(board, two) === null) {
        out.push({ from, to: two, captures: [], crowns: willCrown(board, piece, two) });
      }
    }
  }
  return out;
}

/**
 * Single-hop captures for one piece, each returned as its own `Move`. Normally
 * a jump goes over an adjacent enemy onto the empty square beyond. Long-leap
 * (and Double-strike on continuation hops) also allows a "reach" jump over a
 * one-square gap to a victim two away, landing just beyond.
 *
 * `continuation` marks a 2nd+ hop of a chain — needed so Double-strike's reach
 * only applies mid-chain. Multi-jumps are driven by the caller re-invoking this
 * from the landing square (see `capturesFrom`).
 */
function captureMovesFor(
  board: Board,
  from: Coord,
  piece: Piece,
  continuation: boolean,
): Move[] {
  const out: Move[] = [];
  const dirs = canCaptureAnyDirection(piece)
    ? DIAGONALS
    : DIAGONALS.filter((d) => d.row === forwardDir(piece.owner));
  const reach =
    hasUpgrade(piece, UPGRADE.LongLeap) ||
    (continuation && hasUpgrade(piece, UPGRADE.DoubleStrike));
  // Victim at distance 1 (standard), or distance 2 (reach jump over a gap).
  const victimDists = reach ? [1, 2] : [1];

  for (const d of dirs) {
    for (const vd of victimDists) {
      const over = { row: from.row + vd * d.row, col: from.col + vd * d.col };
      const land = {
        row: from.row + (vd + 1) * d.row,
        col: from.col + (vd + 1) * d.col,
      };
      if (!inBounds(board, land) || pieceAt(board, land) !== null) continue;
      // Squares between the jumper and the victim must be empty.
      let gapClear = true;
      for (let k = 1; k < vd; k++) {
        if (pieceAt(board, { row: from.row + k * d.row, col: from.col + k * d.col }) !== null) {
          gapClear = false;
          break;
        }
      }
      if (!gapClear) continue;
      const victim = pieceAt(board, over);
      if (!victim || victim.owner === piece.owner) continue;
      if (isGuarded(board, over)) continue; // Guardian aura protects this victim
      out.push({ from, to: land, captures: [over], crowns: willCrown(board, piece, land) });
    }
  }
  return out;
}

/**
 * Captures available from a specific square (the piece standing there). Used to
 * decide whether a just-jumped piece can keep jumping. Returns [] if the square
 * is empty. `continuation` should be true for 2nd+ hops of a chain (enables the
 * Double-strike reach). A piece that crowned on its last hop stops (crowning
 * ends the turn), which the caller enforces via `Move.crowns`.
 */
export function capturesFrom(
  board: Board,
  from: Coord,
  continuation = false,
): Move[] {
  const piece = pieceAt(board, from);
  if (!piece) return [];
  return captureMovesFor(board, from, piece, continuation);
}

/**
 * All legal moves for `player`. Captures are not forced, so plain slides and
 * captures are both returned and the player may pick either.
 */
export function generateMoves(board: Board, player: Player): Move[] {
  const moves: Move[] = [];

  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      const piece = board.squares[row][col];
      if (!piece || piece.owner !== player) continue;
      const from = { row, col };
      moves.push(...captureMovesFor(board, from, piece, false));
      moves.push(...simpleMovesFor(board, from, piece));
    }
  }

  return moves;
}

export function movesFrom(board: Board, from: Coord, player: Player): Move[] {
  return generateMoves(board, player).filter((m) => coordsEqual(m.from, from));
}

/**
 * All complete turns for `player`: every single slide, plus every capture chain
 * played to completion (mirroring the human's rule that a started jump must run
 * out, but that jumping at all is optional). Each Turn carries its hop sequence
 * and the resulting board. This is the unit the AI/search reason over.
 */
export function generateTurns(board: Board, player: Player): Turn[] {
  const turns: Turn[] = [];

  const extend = (b: Board, from: Coord, path: Move[], continuation: boolean): void => {
    for (const hop of capturesFrom(b, from, continuation)) {
      const nb = applyMove(b, hop);
      const chain = [...path, hop];
      // A crown ends the turn; otherwise keep jumping if more captures exist.
      if (!hop.crowns && capturesFrom(nb, hop.to, true).length > 0) {
        extend(nb, hop.to, chain, true);
      } else {
        turns.push({ moves: chain, board: nb });
      }
    }
  };

  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      const piece = board.squares[row][col];
      if (!piece || piece.owner !== player) continue;
      const from = { row, col };
      if (capturesFrom(board, from, false).length > 0) extend(board, from, [], false);
      for (const m of movesFrom(board, from, player)) {
        if (m.captures.length === 0) {
          turns.push({ moves: [m], board: applyMove(board, m) });
        }
      }
    }
  }

  return turns;
}

/** Apply a move to a fresh board copy. Assumes `move` came from generateMoves. */
export function applyMove(board: Board, move: Move): Board {
  const next = cloneBoard(board);
  const piece = next.squares[move.from.row][move.from.col];
  if (!piece) throw new Error("applyMove: no piece at move.from");

  next.squares[move.from.row][move.from.col] = null;
  for (const c of move.captures) {
    const victim = next.squares[c.row][c.col];
    // Fortified absorbs the first capture: the shield breaks but the piece
    // survives (the jumper still passes over onto the empty landing square).
    if (victim && hasUpgrade(victim, UPGRADE.Fortified)) {
      victim.upgrades = victim.upgrades.filter((u) => u !== UPGRADE.Fortified);
    } else {
      next.squares[c.row][c.col] = null;
    }
  }

  next.squares[move.to.row][move.to.col] = {
    ...piece,
    king: piece.king || move.crowns,
  };
  return next;
}

/**
 * The side to move loses if it has no pieces or no legal moves. Returns the
 * winner, or null if the game is still going.
 */
export function winner(board: Board, toMove: Player): Player | null {
  if (generateMoves(board, toMove).length === 0) return opponent(toMove);
  return null;
}
