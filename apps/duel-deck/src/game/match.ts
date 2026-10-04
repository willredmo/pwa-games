import {
  createBoard,
  ensureDepth,
  promoteToKnight,
  firstEmptySpot,
  makeUnit,
  occupants,
  place,
  replaceUnit,
  sideUnits,
  upgradeUnit,
  writeLane,
} from "../engine/board";
import { KNIGHT_AT, OFFER_KEYS, UNITS, mergesInto } from "../engine/units";
import type { Board, Side, Unit } from "../engine/types";
import {
  applyAugments,
  hasAugment,
  mergeRatioFor,
  offerAugments,
  rarityOf,
  sideModsFor,
  takeAugment,
  unitsAffectedBy,
  type AugmentDef,
  type AugmentState,
  type Rarity,
} from "./augments";

// Match configuration and round flow, per the tracker doc's v1 scope.

export const PLAYER: Side = "player";
export const ENEMY: Side = "enemy";

/** Single shared row in v1; the engine is generic so 3-5 lanes is a config bump. */
export const LANES = 1;
/** Queue depth per side. */
export const DEPTH = 5;
/**
 * Each player's HP pool. Round damage is the winner's surviving units' attack,
 * so pools drain slowly; 200 gives long matches with several augment picks.
 * Augments that read or spend pool HP (Desperate measures, Bloodpact, Field
 * medic's cap) are scaled to it.
 */
export const START_HP = 200;

/** Each round both players pick 2 from 5 offered units. Picks are free (no economy). */
export const OFFER_COUNT = 5;
export const PICK_COUNT = 2;

/** Augments are a separate track, offered every 3rd round. */
export const AUGMENT_EVERY = 3;
export const AUGMENT_OFFER_COUNT = 3;

/** Which upgrade round this is (1 for round 3, 2 for round 6, ...): gates rarity. */
export function upgradeTier(round: number): number {
  return Math.max(1, Math.floor(round / AUGMENT_EVERY));
}

/** Unit-offer rerolls each round (Scout adds one). */
export const UNIT_REROLLS = 1;
/** Rerolls on each upgrade choice. */
export const AUGMENT_REROLLS = 2;

export function unitRerollsFor(state: AugmentState): number {
  return UNIT_REROLLS + (hasAugment(state, "scout") ? 1 : 0);
}

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
    () => OFFER_KEYS[Math.floor(Math.random() * OFFER_KEYS.length)],
  );
}

/**
 * Add a unit for the AI: place at the back while there's room; once full, merge
 * into a matching unit (front-most first); failing that, swap out the weakest
 * unit — but only when the newcomer's raw stats beat it.
 */
export function deployToBack(
  board: Board,
  side: Side,
  key: string,
  state?: AugmentState,
): boolean {
  const ratio = state ? mergeRatioFor(state) : undefined;
  // Fill the row first, then merge. Merging while slots stood empty left the AI
  // fielding two or three bodies against a full row — survivors score the
  // round, so empty slots are lost damage.
  const spot = firstEmptySpot(board, side);
  if (spot) {
    place(board, side, spot.lane, spot.spot, makeUnit(key, side));
    return true;
  }
  for (let lane = 0; lane < board.lanes; lane++) {
    for (let s = 0; s < board.depth; s++) {
      if (upgradeUnit(board, side, lane, s, key, ratio)) return true;
    }
  }
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

/** Sort every lane highest-ATK-first (sim: beats random 59.7%; tanks-first loses). */
function sortByAttack(board: Board, side: Side): void {
  for (let lane = 0; lane < board.lanes; lane++) {
    const row = occupants(board, side, lane);
    row.sort((a, b) => b.baseAtk - a.baseAtk || b.baseMaxHp - a.baseMaxHp);
    writeLane(board, side, lane, row);
  }
}

/**
 * AI commit — takes PICK_COUNT *distinct* offers (each of the five is
 * single-use, as for the player). Fills the row with the best-valued units,
 * then prefers offers it can merge; finishes by sorting the row
 * highest-ATK-first.
 */
export function aiCommit(board: Board, side: Side, state?: AugmentState): string[] {
  let offer = rollOffer();
  // Same rerolls as the player: spend them on an offer that's useless to a full
  // row (nothing it can merge into).
  for (let left = state ? unitRerollsFor(state) : UNIT_REROLLS; left > 0; left--) {
    const have = sideUnits(board, side).map((u) => u.key);
    const usable = offer.some((k) => have.some((h) => mergesInto(h, k)));
    if (usable || firstEmptySpot(board, side)) break;
    offer = rollOffer();
  }
  const available = offer.map((_, i) => i);
  const picked: string[] = [];
  const owned = () => new Set(sideUnits(board, side).map((u) => u.key));
  while (picked.length < PICK_COUNT && available.length > 0) {
    const mine = owned();
    // A Squire's printed ATK (2) undersells it, so every AI values it as a
    // mid-tier pick; Squire augments only nudge that. (A big nudge made holding
    // one switch the AI to an all-in merge plan, which the sim then credited to
    // the augment rather than the play style.)
    const squireBuild =
      !!state && SQUIRE_AUGMENTS.some((id) => hasAugment(state, id));
    const value = (i: number) => {
      const key = offer[i];
      // Owning a type only matters once the row is full and picks merge.
      const owns = !firstEmptySpot(board, side) && [...mine].some((k) => mergesInto(k, key));
      // Survivors deal the round's damage, so a unit's health matters as well
      // as its attack — an attack-only score over-picked glass cannons.
      const st = UNITS[key];
      const base =
        key === "squire"
          ? SQUIRE_PICK_VALUE + (squireBuild ? NUDGE : 0)
          : (st?.atk ?? 0) + (st?.maxHp ?? 0) * 0.5;
      return (owns ? 100 : 0) + base;
    };
    available.sort((a, b) => value(b) - value(a));
    // Best-valued offer that can actually be used, so a full row doesn't waste picks.
    for (let n = 0; n < available.length; n++) {
      const key = offer[available[n]];
      if (deployToBack(board, side, key, state)) {
        picked.push(key);
        available.splice(n, 1);
        break;
      }
      if (n === available.length - 1) available.length = 0;
    }
  }
  sortByAttack(board, side);
  return picked;
}

/**
 * Static augment scores — holder win rates (%) from `pnpm sim --aug=random`
 * after the balance pass. Re-measure after balance changes. Unlisted scores 45.
 */
const AUGMENT_SCORE: Record<string, number> = {
  legion: 56,
  champion: 49,
  bastion: 50,
  bloodthirst: 50,
  "war-chest": 47,
  unbreakable: 47,
  spearwall: 46,
  "knights-oath": 56,
  "squires-drill": 55,
  "early-knighthood": 54,
  "field-medic": 50,
  "first-strike": 56,
  bloodpact: 55,
  "last-stand": 54,
  "united-front": 54,
  overwhelm: 53,
  reinforcements: 53,
  "desperate-measures": 52,
  "steady-footing": 52,
  "battle-fury": 52,
  fusion: 51,
  cleave: 51,
  "sharpened-edge": 50,
  thorns: 50,
  "last-breath": 50,
  lifesteal: 50,
  "reinforced-plating": 49,
  "berserkers-rally": 49,
  "glass-cannon-pact": 49,
  "vanguards-edge": 49,
  momentum: 49,
  bounty: 48,
  "mixed-formation": 48,
  executioner: 48,
  "precision-strikes": 48,
  veteran: 48,
  "tank-wall": 48,
  adrenaline: 48,
  "iron-will": 47,
  scout: 46,
  "shield-wall": 46,
};

/**
 * Rarity premium for the AI. Augments are balanced so a rare's holder win rate
 * sits near a common's, which left the AI's win-rate table indifferent to
 * rarity — it kept taking commons a point "better". Rarer picks are the point
 * of the later upgrade rounds, so it should reach for them.
 */
const RARITY_BONUS: Record<Rarity, number> = { common: 0, rare: 6, epic: 12 };
/** Below this the AI spends a reroll rather than settle. */
const AI_REROLL_BELOW = 52;

/**
 * How much the AI wants an augment given its row: the base win-rate score, the
 * rarity premium, and fit — unit-specific augments are worth more when it
 * fields those units and close to nothing when it fields none.
 */
export function aiAugmentScore(def: AugmentDef, units: Unit[] = []): number {
  let score = (AUGMENT_SCORE[def.id] ?? 45) + RARITY_BONUS[rarityOf(def)];
  const affects = unitsAffectedBy(def);
  const specific = affects.length > 0 && affects.length < Object.keys(UNITS).length;
  if (specific && units.length > 0) {
    const share = units.filter((u) => affects.includes(u.key)).length / units.length;
    score += share > 0 ? 4 + 8 * share : -15;
  }
  return score;
}

/** Highest-scoring augment for the AI. Options may be defs or bare ids. */
export function aiPickAugment<T extends { id: string } | string>(
  options: T[],
  units: Unit[] = [],
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const o of options) {
    const id = typeof o === "string" ? o : o.id;
    const def = typeof o === "string" ? null : (o as AugmentDef);
    const score = def ? aiAugmentScore(def, units) : (AUGMENT_SCORE[id] ?? 45);
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The AI's whole upgrade turn, shared by the app and the sim: draw an offer for
 * this tier, reroll (up to the player's allowance) while the best card is a
 * poor fit, take the best, and apply its pool cost. Returns the id taken.
 */
export function aiTakeAugment(
  board: Board,
  side: Side,
  state: AugmentState,
  round: number,
): string | null {
  const units = sideUnits(board, side);
  let offer = offerAugments(state, AUGMENT_OFFER_COUNT, upgradeTier(round));
  for (let left = AUGMENT_REROLLS; left > 0; left--) {
    const top = aiPickAugment(offer, units);
    if (!top || aiAugmentScore(top, units) >= AI_REROLL_BELOW) break;
    offer = offerAugments(state, AUGMENT_OFFER_COUNT, upgradeTier(round));
  }
  const choice = aiPickAugment(offer, units);
  if (!choice) return null;
  const cost = takeAugment(state, choice.id, units);
  if (cost) board.hp[side] = Math.max(1, board.hp[side] - cost);
  return choice.id;
}

/**
 * Refresh both sides for the coming round: recompute augment-modified stats and
 * heal survivors to full. Player augments only affect the player's units; the
 * enemy gets its own state.
 */
/** What the AI treats a fresh Squire as worth — roughly a Striker's attack. */
const SQUIRE_PICK_VALUE = 8;
const NUDGE = 1;

/** Augments that make Squires worth starting (the AI leans in when it has one). */
const SQUIRE_AUGMENTS = ["squires-drill", "early-knighthood", "knights-oath"];

/** Merges a side's Squires need to be knighted. */
export function knightAt(state: AugmentState): number {
  return hasAugment(state, "early-knighthood") ? KNIGHT_AT - 1 : KNIGHT_AT;
}

/** Knight every Squire on `side` that has reached its merge threshold. */
function promoteSquires(board: Board, side: Side, state: AugmentState): void {
  const at = knightAt(state);
  for (const u of sideUnits(board, side)) {
    if (u.key === "squire" && u.merges >= at) promoteToKnight(u);
  }
}

export function refreshForRound(
  board: Board,
  playerAug: AugmentState,
  enemyAug: AugmentState,
): void {
  // Capacity is always explicit: once one side's Reinforcements grows the board,
  // `capacityOf`'s fallback (the board depth) would hand the other side the
  // extra slot too.
  const withCapacity = (state: AugmentState) => {
    const mods = sideModsFor(state);
    return { ...mods, capacity: mods.capacity ?? DEPTH };
  };
  board.mods = { player: withCapacity(playerAug), enemy: withCapacity(enemyAug) };
  // Knighting happens here because every merge path (offer, placed unit, AI)
  // is followed by a refresh — one place to check, so none can skip it.
  promoteSquires(board, PLAYER, playerAug);
  promoteSquires(board, ENEMY, enemyAug);
  ensureDepth(board, Math.max(board.mods.player!.capacity!, board.mods.enemy!.capacity!));
  const p = sideUnits(board, PLAYER);
  const e = sideUnits(board, ENEMY);
  applyAugments(p, playerAug, board.hp.player, e.length);
  applyAugments(e, enemyAug, board.hp.enemy, p.length);
}
