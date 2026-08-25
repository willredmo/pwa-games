import {
  createBoard,
  firstEmptySpot,
  makeUnit,
  place,
  replaceUnit,
  sideUnits,
  upgradeUnit,
} from "../engine/board";
import { UNITS, UNIT_KEYS } from "../engine/units";
import type { Board, Side } from "../engine/types";
import { applyAugments, type AugmentState } from "./augments";

// Match configuration and round flow, per the tracker doc's v1 scope.

export const PLAYER: Side = "player";
export const ENEMY: Side = "enemy";

/** Single shared row in v1; the engine is generic so 3-5 lanes is a config bump. */
export const LANES = 1;
/** Queue depth per side. */
export const DEPTH = 5;
export const START_HP = 100;

/** Each round both players pick 2 from 5 offered units. Picks are free (no economy). */
export const OFFER_COUNT = 5;
export const PICK_COUNT = 2;

/** Augments are a separate track, offered every 3rd round. */
export const AUGMENT_EVERY = 3;
export const AUGMENT_OFFER_COUNT = 3;

export function isAugmentRound(round: number): boolean {
  return round % AUGMENT_EVERY === 0;
}

export function newBoard(): Board {
  return createBoard(LANES, DEPTH, START_HP);
}

/**
 * Roll this round's unit offer. Drawn WITH replacement from the flat pool —
 * with only five unit types, sampling without replacement would offer the whole
 * pool every round and make the pick meaningless.
 */
export function rollOffer(count = OFFER_COUNT): string[] {
  return Array.from(
    { length: count },
    () => UNIT_KEYS[Math.floor(Math.random() * UNIT_KEYS.length)],
  );
}

/**
 * Add a unit to the back of a side's queue, or — if the row is full — merge it
 * into a random unit there, mirroring the player's rule so neither side wastes
 * picks once saturated.
 */
export function deployToBack(board: Board, side: Side, key: string): boolean {
  const spot = firstEmptySpot(board, side);
  if (spot) {
    place(board, side, spot.lane, spot.spot, makeUnit(key, side));
    return true;
  }
  // Row full — fold it into a unit of the same type, if there is one.
  for (let lane = 0; lane < board.lanes; lane++) {
    for (let s = 0; s < board.depth; s++) {
      if (upgradeUnit(board, side, lane, s, key)) return true;
    }
  }
  // Otherwise swap out the weakest unit, rather than waste the pick.
  const incoming = UNITS[key];
  if (!incoming) return false;
  let worst: { lane: number; spot: number; score: number } | null = null;
  for (let lane = 0; lane < board.lanes; lane++) {
    for (let s = 0; s < board.depth; s++) {
      const u = board.slots[side][lane][s];
      if (!u) continue;
      const score = u.baseAtk + u.baseMaxHp;
      if (!worst || score < worst.score) worst = { lane, spot: s, score };
    }
  }
  if (worst && incoming.atk + incoming.maxHp > worst.score) {
    return replaceUnit(board, side, worst.lane, worst.spot, key);
  }
  return false;
}

/**
 * AI commit — v1 is random picks, per the doc. Takes PICK_COUNT *distinct*
 * offers (each of the five is single-use, as for the player).
 */
export function aiCommit(board: Board, side: Side): string[] {
  const offer = rollOffer();
  const available = offer.map((_, i) => i);
  const picked: string[] = [];
  // Walk the offer in random order, keeping the first PICK_COUNT that can
  // actually be used — so a full row doesn't waste picks on unmergeable types.
  while (picked.length < PICK_COUNT && available.length > 0) {
    const [index] = available.splice(Math.floor(Math.random() * available.length), 1);
    const key = offer[index];
    if (deployToBack(board, side, key)) picked.push(key);
  }
  return picked;
}

/** Random augment choice for the AI (v1: random, like its unit picks). */
export function aiPickAugment<T>(options: T[]): T | null {
  if (options.length === 0) return null;
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Refresh both sides for the coming round: recompute augment-modified stats and
 * heal survivors to full. Player augments only affect the player's units; the
 * enemy gets its own state.
 */
export function refreshForRound(
  board: Board,
  playerAug: AugmentState,
  enemyAug: AugmentState,
): void {
  const p = sideUnits(board, PLAYER);
  const e = sideUnits(board, ENEMY);
  applyAugments(p, playerAug, board.hp.player, e.length);
  applyAugments(e, enemyAug, board.hp.enemy, p.length);
}
