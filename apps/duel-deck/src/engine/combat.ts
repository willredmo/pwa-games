import {
  SIDES,
  allUnits,
  cloneBoard,
  compactLane,
  front,
  laneCount,
  sideUnits,
} from "./board";
import type { Board, BattleEvent, RoundResult, Side, Tick } from "./types";
import { otherSide } from "./types";

// Deterministic round resolution.
//
// Per the tracker doc:
//   - Only the front-most unit on each side fights; when it dies the next in
//     queue steps up. No multi-target, no ranged.
//   - Both fronts strike simultaneously — a unit that dies this tick still
//     deals its damage.
//   - The round ends when a side's row is empty. The winning side's TOTAL
//     damage dealt that round is subtracted from the losing player's HP.
//
// Pure: the input board is cloned, never mutated, so the same commit always
// yields the same result — what the eventual simultaneous-commit netcode needs.

const DEFAULT_TICK_CAP = 200;

function contestedLanes(board: Board): number[] {
  const out: number[] = [];
  for (let lane = 0; lane < board.lanes; lane++) {
    if (laneCount(board, "player", lane) > 0 && laneCount(board, "enemy", lane) > 0) {
      out.push(lane);
    }
  }
  return out;
}

/** One tick across all contested lanes. Adds to `damage` totals in place. */
function combatTick(
  board: Board,
  lanes: number[],
  events: BattleEvent[],
  damageDealt: Record<Side, number>,
): number {
  // Collect from the pre-tick front lines so damage is truly simultaneous.
  const incoming = new Map<string, number>();
  const add = (id: string, d: number) => incoming.set(id, (incoming.get(id) ?? 0) + d);

  for (const lane of lanes) {
    const pf = front(board, "player", lane);
    const ef = front(board, "enemy", lane);
    if (!pf || !ef) continue;

    add(ef.id, pf.atk);
    damageDealt.player += pf.atk;
    events.push({ type: "attack", lane, attacker: pf.id, target: ef.id, damage: pf.atk });

    add(pf.id, ef.atk);
    damageDealt.enemy += ef.atk;
    events.push({ type: "attack", lane, attacker: ef.id, target: pf.id, damage: ef.atk });
  }

  let total = 0;
  for (const u of allUnits(board)) {
    const d = incoming.get(u.id);
    if (d) {
      u.hp -= d;
      total += d;
    }
  }
  for (const u of allUnits(board)) {
    if (u.hp <= 0) events.push({ type: "death", unit: u.id, key: u.key, side: u.side });
  }
  // Remove the dead, then slide survivors forward so the next steps up.
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      const laneArr = board.slots[side][lane];
      for (let s = 0; s < laneArr.length; s++) {
        if (laneArr[s] && laneArr[s]!.hp <= 0) laneArr[s] = null;
      }
      compactLane(board, side, lane);
    }
  }
  return total;
}

export function resolveRound(input: Board, opts?: { tickCap?: number }): RoundResult {
  const board = cloneBoard(input);
  const tickCap = opts?.tickCap ?? DEFAULT_TICK_CAP;
  const ticks: Tick[] = [];
  const damageDealt: Record<Side, number> = { player: 0, enemy: 0 };

  for (let t = 0; t < tickCap; t++) {
    const lanes = contestedLanes(board);
    if (lanes.length === 0) break;
    const events: BattleEvent[] = [];
    const dealt = combatTick(board, lanes, events, damageDealt);
    ticks.push({ events, snapshot: cloneBoard(board) });
    if (dealt === 0) break; // stalemate guard (e.g. two 0-ATK fronts)
  }

  // Whoever still holds the row won the round.
  const playerLeft = sideUnits(board, "player").length;
  const enemyLeft = sideUnits(board, "enemy").length;
  let roundWinner: Side | null = null;
  if (playerLeft > 0 && enemyLeft === 0) roundWinner = "player";
  else if (enemyLeft > 0 && playerLeft === 0) roundWinner = "enemy";

  // The winner's total damage this round comes off the loser's HP pool.
  let hpLoss = 0;
  if (roundWinner) {
    hpLoss = damageDealt[roundWinner];
    const loser = otherSide(roundWinner);
    board.hp[loser] = Math.max(0, board.hp[loser] - hpLoss);
  }

  let matchWinner: Side | null = null;
  if (board.hp.player <= 0 && board.hp.enemy <= 0) {
    matchWinner = board.hp.player >= board.hp.enemy ? "player" : "enemy";
  } else if (board.hp.enemy <= 0) matchWinner = "player";
  else if (board.hp.player <= 0) matchWinner = "enemy";

  return { board, ticks, roundWinner, damageDealt, hpLoss, matchWinner };
}
