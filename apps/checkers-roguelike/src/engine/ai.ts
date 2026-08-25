import { allPieces, crownRow } from "./board";
import { generateTurns, winner } from "./moves";
import type { Board, Player, Turn } from "./types";
import { opponent } from "./types";

// Minimax + alpha-beta AI. Search depth is the primary difficulty knob (per the
// design doc: "AI gets harder per floor, primarily via deeper search"). Works
// on any board size — it only ever calls generateTurns/winner.

const MAN_VALUE = 100;
const KING_VALUE = 175;
const ADVANCE_WEIGHT = 6; // per row of progress toward crowning, for men
const WIN_SCORE = 100_000;

/** Static evaluation from `player`'s perspective (higher = better for player). */
export function evaluate(board: Board, player: Player): number {
  let score = 0;
  for (const { coord, piece } of allPieces(board)) {
    let value = piece.king ? KING_VALUE : MAN_VALUE;
    if (!piece.king) {
      // Reward men for advancing toward their crown row.
      const homeRow = crownRow(board, opponent(piece.owner));
      const progress = Math.abs(coord.row - homeRow);
      value += progress * ADVANCE_WEIGHT;
    }
    score += piece.owner === player ? value : -value;
  }
  return score;
}

/**
 * Negamax-style alpha-beta. Returns the value of `board` for `aiPlayer` when
 * it's `toMove`'s turn. Terminal (no legal turn) = loss for the side to move.
 * Wins/losses are scored nearer/farther so shorter mates are preferred.
 */
function search(
  board: Board,
  toMove: Player,
  aiPlayer: Player,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (winner(board, toMove) !== null) {
    // The side to move has no moves and has lost.
    const aiLost = toMove === aiPlayer;
    return aiLost ? -WIN_SCORE - depth : WIN_SCORE + depth;
  }
  if (depth === 0) return evaluate(board, aiPlayer);

  const turns = generateTurns(board, toMove);
  const maximizing = toMove === aiPlayer;
  let best = maximizing ? -Infinity : Infinity;

  for (const turn of turns) {
    const value = search(
      turn.board,
      opponent(toMove),
      aiPlayer,
      depth - 1,
      alpha,
      beta,
    );
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break; // prune
  }

  return best;
}

/**
 * Pick the AI's best turn at the given search depth. Ties are broken randomly
 * for variety. Returns null only if the AI has no legal turn (it has lost).
 */
export function chooseTurn(
  board: Board,
  aiPlayer: Player,
  depth: number,
): Turn | null {
  const turns = generateTurns(board, aiPlayer);
  if (turns.length === 0) return null;

  let bestValue = -Infinity;
  let bestTurns: Turn[] = [];
  for (const turn of turns) {
    const value = search(
      turn.board,
      opponent(aiPlayer),
      aiPlayer,
      depth - 1,
      -Infinity,
      Infinity,
    );
    if (value > bestValue) {
      bestValue = value;
      bestTurns = [turn];
    } else if (value === bestValue) {
      bestTurns.push(turn);
    }
  }

  return bestTurns[Math.floor(Math.random() * bestTurns.length)];
}
