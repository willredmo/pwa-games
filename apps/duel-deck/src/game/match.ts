import {
  capacityOf,
  createBoard,
  levelCapOf,
  mergeCapFor,
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
  cloneBoard,
} from "../engine/board";
import { resolveRound } from "../engine/combat";
import { KNIGHT_AT, MAX_LEVEL, OFFER_KEYS, UNITS, canAbsorb, innateTraits, isMastered, synergyOf } from "../engine/units";
import type { Archetype, Board, Side, Unit } from "../engine/types";
import {
  SABOTAGE_ATK,
  applyAugments,
  getAugment,
  hasAugment,
  mergeRatioFor,
  offerAugments,
  rerollAugment,
  applyTarget,
  aiTarget,
  rarityOf,
  sideModsFor,
  takeAugment,
  unitsAffectedBy,
  type AugmentDef,
  type AugmentState,
  type Rarity,
  hpCostOf,
} from "./augments";

// Match configuration and round flow, per the tracker doc's v1 scope.

export const PLAYER: Side = "player";
export const ENEMY: Side = "enemy";

/** Single shared row in v1; the engine is generic so 3-5 lanes is a config bump. */
export const LANES = 1;
/** Queue depth per side. */
export const DEPTH = 5;
/** Most extra slots a side can earn from units at the level cap (a row of 8). */
export const MAX_EARNED_SLOTS = 3;
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

/** Cards on an upgrade choice for this side (Tactician adds one). */
export function augmentOfferCount(state: AugmentState): number {
  return AUGMENT_OFFER_COUNT + (hasAugment(state, "tactician") ? 1 : 0);
}

/** Which upgrade choice this is (1 for round 3, 2 for round 6, ...): sets the rarity odds. */
export function upgradeTier(round: number): number {
  return Math.max(1, Math.floor(round / AUGMENT_EVERY));
}

/** Unit-offer rerolls each round (Scout adds one). */
export const UNIT_REROLLS = 1;
/** Rerolls each upgrade card gets (its own button, as in ARAM Mayhem). */
export const AUGMENT_REROLLS = 1;

export function unitRerollsFor(state: AugmentState): number {
  return UNIT_REROLLS + (hasAugment(state, "scout") ? 1 : 0);
}

export function isAugmentRound(round: number): boolean {
  return round % AUGMENT_EVERY === 0;
}

/**
 * Whether `side`'s row is complete: every slot filled, every unit at its level
 * cap. Picks can't grow it then (only replace), so unspent ones become Drill.
 */
export function rowMaxed(board: Board, side: Side): boolean {
  const cap = mergeCapFor(board, side);
  if (!Number.isFinite(cap)) return false;
  const units = sideUnits(board, side);
  return units.length > 0 && units.length >= capacityOf(board, side) && units.every((u) => u.merges >= cap);
}

/**
 * Drill for a commit: one attack per unspent pick, for this round only, once
 * the row is maxed. Not permanent stats (that would just remove the cap) and
 * not healing (two maxed rows could stall forever): it ends matches faster.
 */
export function drillFor(board: Board, side: Side, unusedPicks: number): number {
  return rowMaxed(board, side) ? Math.max(0, unusedPicks) : 0;
}

/**
 * A match's settings, chosen before it starts (the title screen for a CPU
 * match, the host for an online duel) and fixed for the whole match.
 */
export interface MatchRules {
  /** Both pools start here (START_HP_OPTIONS). */
  startHp: number;
  /** Easy mode: undo also takes back unit rerolls (and refunds them). */
  easy: boolean;
  /** Full-row class bonuses (Full Assault, Iron Line, Sanctuary). */
  synergies: boolean;
  /** Upgrade choices every AUGMENT_EVERY rounds. */
  upgrades: boolean;
  /** Highest level a unit can reach, where its ability takes its Mastery form (LEVEL_CAP_OPTIONS). */
  levelCap: number;
}

export const DEFAULT_RULES: MatchRules = { startHp: START_HP, easy: false, synergies: true, upgrades: true, levelCap: MAX_LEVEL };

/**
 * Level caps a match can be played at. Not below 8: a Squire is knighted at
 * level 7. Higher caps strengthen Knights most (sim: Knight rows 62% at 10,
 * 69% at 12, 72% at 13), so the title screen says so.
 */
export const LEVEL_CAP_OPTIONS = [8, 10, 12, 15] as const;

export function newBoard(rules: Partial<MatchRules> = {}): Board {
  const r = { ...DEFAULT_RULES, ...rules };
  const board = createBoard(LANES, DEPTH, r.startHp);
  if (r.levelCap && r.levelCap !== MAX_LEVEL) board.levelCap = r.levelCap;
  // Only the switches that differ from the defaults are stored.
  if (r.easy || !r.synergies || !r.upgrades) {
    board.rules = {
      ...(r.easy ? { easy: true } : {}),
      ...(!r.synergies ? { synergies: false } : {}),
      ...(!r.upgrades ? { upgrades: false } : {}),
    };
  }
  return board;
}

/** The settings a match is played under, read off its board. */
export function rulesOf(board: Board): MatchRules {
  return {
    startHp: startHpOf(board),
    easy: board.rules?.easy === true,
    synergies: board.rules?.synergies !== false,
    upgrades: board.rules?.upgrades !== false,
    levelCap: levelCapOf(board),
  };
}

/** The settings that differ from the defaults, as short labels ("♥100", "Easy mode"). */
export function rulesSummary(r: MatchRules): string[] {
  return [
    ...(r.startHp !== START_HP ? [`♥${r.startHp} start`] : []),
    ...(r.easy ? ["Easy mode"] : []),
    ...(!r.synergies ? ["No class bonuses"] : []),
    ...(!r.upgrades ? ["No upgrades"] : []),
    ...(r.levelCap && r.levelCap !== MAX_LEVEL ? [`Level cap ${r.levelCap}`] : []),
  ];
}

/** Starting health presets on the title screen (both players start equal). */
export const START_HP_OPTIONS = [100, 200, 300] as const;
/** A custom starting health must be a whole number in this range (the database rules enforce it too). */
export const START_HP_MIN = 20;
export const START_HP_MAX = 999;
/** A starting health clamped to the allowed range, or null if it isn't a number. */
export function clampStartHp(n: number): number | null {
  return Number.isFinite(n) ? Math.min(START_HP_MAX, Math.max(START_HP_MIN, Math.round(n))) : null;
}

/** The pool this match started with (saves from before the setting read as 200). */
export function startHpOf(board: Board): number {
  return board.startHp ?? START_HP;
}

/**
 * Roll this round's unit offer. Drawn WITH replacement from the flat pool —
 * with only five unit types, sampling without replacement would offer the whole
 * pool every round and make the pick meaningless.
 */
export function rollOffer(count = OFFER_COUNT, state?: AugmentState): string[] {
  const weights = OFFER_KEYS.map((k) => offerWeight(k, state));
  const total = weights.reduce((a, b) => a + b, 0);
  return Array.from({ length: count }, () => {
    let r = Math.random() * total;
    for (let i = 0; i < OFFER_KEYS.length; i++) {
      r -= weights[i];
      if (r < 0) return OFFER_KEYS[i];
    }
    return OFFER_KEYS[OFFER_KEYS.length - 1];
  });
}

/**
 * Squires are dealt more often than other units. A Squire only pays off once
 * six more have been merged into it, so its share of the offer decides whether
 * knighthood is reachable at all. Each new unit type thinned it (with nine
 * offered types it fell to 1 card in 9 and Squires won 36%); 1.6 restores the
 * 1-in-6 share it had among six. Holding a Squire upgrade (Squire's drill,
 * Early knighthood, Knight's oath) adds SQUIRE_AUGMENT_WEIGHT, so taking one
 * actually finds you the Squires it's built around.
 */
export const SQUIRE_WEIGHT = 1.3;
export const SQUIRE_AUGMENT_WEIGHT = 0.2;
export function offerWeight(key: string, state?: AugmentState): number {
  if (key !== "squire") return 1;
  const backed = !!state && SQUIRE_AUGMENTS.some((id) => hasAugment(state, id));
  return SQUIRE_WEIGHT + (backed ? SQUIRE_AUGMENT_WEIGHT : 0);
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

const byAttack = (a: Unit, b: Unit) => b.baseAtk - a.baseAtk || b.baseMaxHp - a.baseMaxHp;

/**
 * Highest-ATK-first (sim: beats random 59.7%; tanks-first loses), with
 * supports placed where they help. A support buffs the unit directly in front
 * of it, so sorted by attack they all sat at the back buffing each other. Now:
 * the strongest fighter, then every Beacon, then a support (so its buff is
 * relayed to the front, amplified); then each further fighter followed by one
 * more support. Supports left over go at the back.
 */
function supportOrder(row: Unit[]): Unit[] {
  const arch = (u: Unit) => UNITS[u.key]?.archetype;
  const fighters = row.filter((u) => arch(u) !== "support").sort(byAttack);
  const beacons = row.filter((u) => (u.traits?.relay ?? innateTraits(u.key, u.merges).relay ?? 0) > 0);
  const supports = row.filter((u) => arch(u) === "support" && !beacons.includes(u)).sort(byAttack);
  if (!fighters.length) return [...supports, ...beacons];
  const out: Unit[] = [];
  fighters.forEach((f, i) => {
    out.push(f);
    if (i === 0) out.push(...beacons);
    const s = supports.shift();
    if (s) out.push(s);
  });
  return [...out, ...supports];
}

function sortByAttack(board: Board, side: Side): void {
  for (let lane = 0; lane < board.lanes; lane++) {
    writeLane(board, side, lane, supportOrder(occupants(board, side, lane)));
  }
}

/** How hard the enemy plays. */
export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

export interface AiOptions {
  difficulty?: Difficulty;
  /** Hard: the opponent's upgrades, to simulate its row as it will fight. */
  oppAug?: AugmentState;
  /**
   * Hard: a board holding the opponent's row as it stood at the start of the
   * round — what a player could see too. Not this round's picks, which would
   * be peeking at a simultaneous commit.
   */
  scout?: Board;
}

/** Easy: two random cards, placed where they land, no rerolls, no arranging. */
function easyCommit(board: Board, side: Side, state?: AugmentState): string[] {
  const offer = rollOffer(OFFER_COUNT, state);
  const picked: string[] = [];
  const order = offer.map((_, i) => i).sort(() => Math.random() - 0.5);
  for (const i of order) {
    if (picked.length >= PICK_COUNT) break;
    if (deployToBack(board, side, offer[i], state)) picked.push(offer[i]);
  }
  return picked;
}

/** Reorder a side's row (front first). */
function arrange(board: Board, side: Side, order: (row: Unit[]) => Unit[]): void {
  for (let lane = 0; lane < board.lanes; lane++) {
    writeLane(board, side, lane, order(occupants(board, side, lane)));
  }
}

/** Formations Hard tries for every pick: hitters first with supports placed, plain hitters first, walls first, as placed. */
const FORMATIONS: ((row: Unit[]) => Unit[])[] = [
  supportOrder,
  (row) => row.sort(byAttack),
  (row) => row.sort((a, b) => b.baseMaxHp - a.baseMaxHp || b.baseAtk - a.baseAtk),
  (row) => row.sort((a, b) => b.baseAtk + b.baseMaxHp - (a.baseAtk + a.baseMaxHp)),
  (row) => row,
];

/**
 * How good a candidate row is: fight it against the scouted opponent row
 * (combat is deterministic) and score the HP swing, with the row's total
 * stats as a tie-break so it still builds for later rounds.
 */
function scoreRow(
  cand: Board,
  side: Side,
  state: AugmentState,
  oppAug: AugmentState,
  scout: Board,
): number {
  const opp: Side = side === PLAYER ? ENEMY : PLAYER;
  const test = cloneBoard(cand);
  test.slots[opp] = cloneBoard(scout).slots[opp];
  ensureDepth(test, Math.max(test.depth, test.slots[opp][0]?.length ?? 0));
  if (side === PLAYER) refreshForRound(test, state, oppAug);
  else refreshForRound(test, oppAug, state);
  const res = resolveRound(test);
  let score = 0;
  if (res.roundWinner === side) score += 20 + res.hpLoss;
  else if (res.roundWinner === opp) score -= 20 + res.hpLoss;
  // Survivors' attack also covers a draw-ish wipe: more left standing is better.
  score += (res.survivors?.ids.length ?? 0) * (res.roundWinner === side ? 1 : 0);
  // Weighting this tie-break up (0.4), or adding a bonus per merge, measured
  // worse for Hard (53-55% vs 60% against Normal): the round result is what counts.
  for (const u of sideUnits(cand, side)) score += (u.baseAtk + u.baseMaxHp) * 0.15;
  return score;
}

/** Hard's growth weights (tuning; the sim sets them). */
/**
 * Hard's growth weights: `level` per level on the row, plus `conc` × `level` ×
 * level² / cap per unit, so stacking levels on one unit pays. Tuned with
 * `pnpm sim --tune-enemy=level,conc` against the previous Hard (fight score
 * alone): 0,0 lost 32%, 4,0.5 ~50%, 12,1 60%, 20-30,1 64%.
 */
export const HARD_TUNING = { level: 24, conc: 1 };
/** Rows Hard tries in every formation, after scoring all of them in one. */
const HARD_SHORTLIST = 6;

/** A row's identity for de-duplicating Hard's candidates: its units as a multiset. */
const rowKey = (board: Board, side: Side) =>
  sideUnits(board, side)
    .map((u) => `${u.key}:${u.merges}:${u.baseAtk}:${u.baseMaxHp}`)
    .sort()
    .join(",");

/**
 * Every way Hard could add one card: the next empty slot, merged into any unit
 * that takes it, or, with a full row and nothing to merge into, replacing a
 * unit or leaving the pick unspent.
 */
function addOptions(board: Board, side: Side, key: string, state: AugmentState): Board[] {
  const out: Board[] = [];
  const spot = firstEmptySpot(board, side);
  if (spot) {
    const b = cloneBoard(board);
    place(b, side, spot.lane, spot.spot, makeUnit(key, side));
    out.push(b);
  }
  const cap = mergeCapFor(board, side);
  const ratio = mergeRatioFor(state);
  let merged = false;
  for (let lane = 0; lane < board.lanes; lane++) {
    board.slots[side][lane].forEach((u, s) => {
      if (!u || !canAbsorb(u.key, u.merges, key, 1, cap)) return;
      const b = cloneBoard(board);
      if (upgradeUnit(b, side, lane, s, key, ratio)) {
        out.push(b);
        merged = true;
      }
    });
  }
  if (!spot && !merged) {
    out.push(board);
    for (let lane = 0; lane < board.lanes; lane++) {
      board.slots[side][lane].forEach((u, s) => {
        if (!u) return;
        const b = cloneBoard(board);
        if (replaceUnit(b, side, lane, s, key)) out.push(b);
      });
    }
  }
  return out;
}

/**
 * What a row is worth beyond this round: every level counts (a replaced or
 * unspent pick is a level thrown away), and levels count for more stacked on
 * one unit, which reaches its Mastery and earns a slot sooner.
 */
function growthValue(board: Board, side: Side): number {
  const cap = levelCapOf(board);
  let v = 0;
  for (const u of sideUnits(board, side)) {
    const lv = Math.min(cap, u.merges + 1);
    v += HARD_TUNING.level * lv + (HARD_TUNING.conc * HARD_TUNING.level * lv * lv) / cap;
  }
  return v;
}

/**
 * Hard: every pair of offer cards, each added every way it can be (any merge
 * target, an empty slot, a replacement), in several formations; each row is
 * fought against the opponent's scouted row and a prediction of its picks,
 * and valued for growth as well as the fight. Rerolls (same allowance as the
 * player) when the best line still loses.
 */
function hardCommit(
  board: Board,
  side: Side,
  state: AugmentState,
  oppAug: AugmentState,
  scout: Board,
): string[] {
  const opp: Side = side === PLAYER ? ENEMY : PLAYER;
  const predicted = cloneBoard(scout);
  aiCommit(predicted, opp, oppAug, { difficulty: "normal" });
  const fightOf = (row: Board) =>
    (scoreRow(row, side, state, oppAug, scout) + scoreRow(row, side, state, oppAug, predicted)) / 2;
  const search = (offer: string[]) => {
    // Every distinct row the picks can make, scored in the default formation;
    // the best few are then tried in every formation.
    const rows: { score: number; cand: Board; growth: number; picked: string[] }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < offer.length; i++) {
      for (let j = 0; j < offer.length; j++) {
        if (i === j) continue;
        for (const first of addOptions(board, side, offer[i], state)) {
          for (const cand of addOptions(first, side, offer[j], state)) {
            const k = rowKey(cand, side);
            if (seen.has(k)) continue;
            seen.add(k);
            const picked = [first !== board ? offer[i] : null, cand !== first ? offer[j] : null].filter(
              (x): x is string => !!x,
            );
            const growth = growthValue(cand, side);
            const arranged = cloneBoard(cand);
            arrange(arranged, side, FORMATIONS[0]);
            rows.push({ score: fightOf(arranged) + growth, cand, growth, picked });
          }
        }
      }
    }
    rows.sort((a, b) => b.score - a.score);
    let best: { score: number; fight: number; board: Board; picked: string[] } | null = null;
    for (const r of rows.slice(0, HARD_SHORTLIST)) {
      for (const formation of FORMATIONS) {
        const arranged = cloneBoard(r.cand);
        arrange(arranged, side, formation);
        const fight = fightOf(arranged);
        const score = fight + r.growth;
        if (!best || score > best.score) best = { score, fight, board: arranged, picked: r.picked };
      }
    }
    return best;
  };
  let best = search(rollOffer(OFFER_COUNT, state));
  for (let left = unitRerollsFor(state); left > 0 && best && best.fight < 0; left--) {
    const next = search(rollOffer(OFFER_COUNT, state));
    if (next && next.score > best.score) best = next;
  }
  if (!best) return [];
  board.slots[side] = best.board.slots[side];
  ensureDepth(board, best.board.depth);
  return best.picked;
}

/**
 * AI commit — takes PICK_COUNT *distinct* offers (each of the five is
 * single-use, as for the player). Fills the row with the best-valued units,
 * then prefers offers it can merge; finishes by sorting the row
 * highest-ATK-first.
 */
export function aiCommit(
  board: Board,
  side: Side,
  state?: AugmentState,
  opts: AiOptions = {},
): string[] {
  const difficulty = opts.difficulty ?? "normal";
  if (difficulty === "easy") return easyCommit(board, side, state);
  if (difficulty === "hard" && state && opts.oppAug) {
    return hardCommit(board, side, state, opts.oppAug, opts.scout ?? board);
  }
  let offer = rollOffer(OFFER_COUNT, state);
  // Same rerolls as the player: spend them on an offer that's useless to a full
  // row (nothing it can merge into).
  for (let left = state ? unitRerollsFor(state) : UNIT_REROLLS; left > 0; left--) {
    const cap = mergeCapFor(board, side);
    const usable = offer.some((k) => sideUnits(board, side).some((u) => canAbsorb(u.key, u.merges, k, 1, cap)));
    if (usable || firstEmptySpot(board, side)) break;
    offer = rollOffer(OFFER_COUNT, state);
  }
  const available = offer.map((_, i) => i);
  const picked: string[] = [];
  while (picked.length < PICK_COUNT && available.length > 0) {
    // Units it could still merge into: same type, under the level cap.
    const cap = mergeCapFor(board, side);
    const mine = sideUnits(board, side);
    // A Squire's printed ATK (2) undersells it, so every AI values it as a
    // mid-tier pick; Squire augments only nudge that. (A big nudge made holding
    // one switch the AI to an all-in merge plan, which the sim then credited to
    // the augment rather than the play style.)
    const squireBuild =
      !!state && SQUIRE_AUGMENTS.some((id) => hasAugment(state, id));
    const fit = augmentFit(state);
    const lean = classLean(board, side);
    const value = (i: number) => {
      const key = offer[i];
      // Owning a type only matters once the row is full and picks merge.
      const owns = !firstEmptySpot(board, side) && mine.some((u) => canAbsorb(u.key, u.merges, key, 1, cap));
      // Survivors deal the round's damage, so a unit's health matters as well
      // as its attack — an attack-only score over-picked glass cannons.
      const base =
        key === "squire"
          ? SQUIRE_PICK_VALUE + (squireBuild ? NUDGE : 0)
          : (AI_UNIT_VALUE[key] ?? 5);
      return (
        (owns ? 100 : 0) +
        base +
        (key === "squire" ? 0 : (fit.get(key) ?? 0)) +
        (lean && UNITS[key]?.archetype === lean ? SYNERGY_NUDGE : 0)
      );
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
  // 1.8.0, measured against the same rarity (`pnpm sim 12000 --aug=random`).
  "mirror-image": 60,
  apotheosis: 60,
  "golden-age": 59,
  commission: 59,
  "field-promotion": 58,
  bloodbond: 57,
  "mirror-shield": 56,
  juggernaut: 56,
  "drill-sergeant": 56,
  "heros-mark": 56,
  "blood-moon": 55,
  "hawk-eye": 54,
  "opening-salvo": 54,
  "iron-skin": 54,
  "spiked-line": 54,
  phoenix: 53,
  "rear-guard": 52,
  whetstone: 51,
  "second-line": 51,
  "heroic-legion": 50,
  avalanche: 50,
  "vanguards-vow": 50,
  ironclad: 47,
  "golden-fleece": 42,
  "mantis-shrimp": 58,
  legion: 49,
  "mixed-formation": 56,
  champion: 49,
  bastion: 50,
  bloodthirst: 50,
  "war-chest": 50,
  unbreakable: 47,
  spearwall: 46,
  "knights-oath": 56,
  "squires-drill": 55,
  "early-knighthood": 54,
  "field-medic": 50,
  "first-strike": 44,
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
  executioner: 48,
  "precision-strikes": 48,
  veteran: 48,
  "tank-wall": 48,
  adrenaline: 48,
  "iron-will": 47,
  scout: 46,
  "shield-wall": 46,
  // Second wave (sim 2026-10-07, 20k matches, --aug=random). Tactician can't be
  // measured with random picks (a 4th card adds nothing), so it's a placeholder.
  "living-fortress": 56,
  "full-ranks": 53,
  sabotage: 51,
  "last-light": 50,
  holdout: 46,
  tactician: 48,
  // Sim 2026-10-13 (12k, --aug=random): 47%.
  ascendant: 47,
  // Third wave (sim 2026-10-14, 12k, --aug=random): 45-49%. The AI rarely fields
  // supports, so these under-read like the other unit upgrades.
  "long-reach": 49,
  skewer: 48,
  "war-horn": 46,
  "banner-of-hope": 47,
  triage: 46,
  stimulant: 46,
  "thick-barrier": 45,
  aegis: 48,
  devotion: 47,
  blessing: 49,
  counterstrike: 47,
  choir: 48,
};

/**
 * Rarity premium for the AI. Augments are balanced so a rare's holder win rate
 * sits near a common's, which left the AI's win-rate table indifferent to
 * rarity — it kept taking commons a point "better". Rarer picks are the point
 * of the later upgrade rounds, so it should reach for them.
 */
const RARITY_BONUS: Record<Rarity, number> = { silver: 0, gold: 6, prismatic: 12 };
/** A card scoring below this (plus its rarity's premium) gets rerolled. */
const AI_REROLL_BELOW = 52;
/** HP the AI keeps in reserve when an augment costs pool HP. */
const AI_HP_FLOOR = 70;

/**
 * How much the AI wants an augment given its row: the base win-rate score, the
 * rarity premium, and fit — unit-specific augments are worth more when it
 * fields those units and close to nothing when it fields none.
 */
/** Ascendant's AI fit: the champion's share of the row's power where it breaks even, and how much a share point moves the score. */
const ASCENDANT_SHARE = 0.35;
const ASCENDANT_SHARE_WEIGHT = 40;

export function aiAugmentScore(def: AugmentDef, units: Unit[] = [], ownHp = START_HP, startHp = START_HP): number {
  let score = (AUGMENT_SCORE[def.id] ?? 45) + RARITY_BONUS[rarityOf(def)];
  // An HP cost (Bloodpact) is only worth paying with health to spare: taken
  // low, it left the AI on 1 HP, one round from losing.
  const cost = hpCostOf(def, startHp);
  if (cost && ownHp - cost < AI_HP_FLOOR) score -= 100;
  // Ascendant throws away every unit but the champion, so it's only worth it
  // when the champion is a real fighter carrying a big share of the row.
  // Without this the AI took it whenever offered (it's an epic) and could be
  // left with a lone support unit.
  if (def.id === "ascendant" && units.length > 0) {
    const champ = championOf(units)!;
    if (UNITS[champ.key]?.archetype === "support") return score - 100;
    const share = fighterPower(champ) / units.reduce((sum, u) => sum + fighterPower(u), 0);
    score += Math.round((share - ASCENDANT_SHARE) * ASCENDANT_SHARE_WEIGHT);
  }
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
  ownHp = START_HP,
  startHp = START_HP,
): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const o of options) {
    const id = typeof o === "string" ? o : o.id;
    const def = typeof o === "string" ? null : (o as AugmentDef);
    const score = def ? aiAugmentScore(def, units, ownHp, startHp) : (AUGMENT_SCORE[id] ?? 45);
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The AI's whole upgrade turn, shared by the app and the sim: deal this
 * choice's cards (`rarity`, the same as the player's), reroll each poor fit
 * once (Hard holds out for a little more), take the best, apply its pool cost
 * and, for a choose-a-unit upgrade, land it (`aiTarget`). Returns the id taken.
 */
export function aiTakeAugment(
  board: Board,
  side: Side,
  state: AugmentState,
  rarity: Rarity,
  difficulty: Difficulty = "normal",
): string | null {
  const units = sideUnits(board, side);
  const startHp = startHpOf(board);
  const ctx = { board, side };
  const offer = offerAugments(state, augmentOfferCount(state), rarity, ctx);
  if (difficulty !== "easy") {
    const bar = AI_REROLL_BELOW + RARITY_BONUS[rarity] + (difficulty === "hard" ? 4 : 0);
    const seen = offer.map((a) => a.id);
    offer.forEach((card, i) => {
      if (aiAugmentScore(card, units, board.hp[side], startHp) >= bar) return;
      const next = rerollAugment(state, card, seen, ctx);
      if (!next) return;
      offer[i] = next;
      seen.push(next.id);
    });
  }
  // Easy takes a card at random.
  const choice =
    difficulty === "easy"
      ? offer[Math.floor(Math.random() * offer.length)]
      : aiPickAugment(offer, units, board.hp[side], startHp);
  if (!choice) return null;
  const cost = takeAugment(state, choice.id, units, startHp);
  if (cost) board.hp[side] = Math.max(1, board.hp[side] - cost);
  const target = aiTarget(choice.id, board, side);
  if (target) applyTarget(state, choice.id, board, side, target.id);
  return choice.id;
}

/**
 * Online: charge `side`'s pool for upgrades it holds now but didn't before
 * (Bloodpact). The opponent pays on their own device as they take it; this is
 * the same charge on ours, made when their commit shows the new upgrade, or
 * the two devices would disagree about their health from then on.
 */
export function chargeNewUpgrades(board: Board, side: Side, before: string[], now: string[]): void {
  for (const id of now) {
    if (before.includes(id)) continue;
    const def = getAugment(id);
    const cost = def ? hpCostOf(def, startHpOf(board)) : 0;
    if (cost) board.hp[side] = Math.max(1, board.hp[side] - cost);
  }
}

/**
 * Refresh both sides for the coming round: recompute augment-modified stats and
 * heal survivors to full. Player augments only affect the player's units; the
 * enemy gets its own state.
 */
/**
 * How much the AI wants each unit as a fresh pick. Stats alone misjudge them
 * now that each has an ability (Evasion is worth far more than its health
 * suggests), so these are set from the "always take X" sim rather than derived.
 */
const AI_UNIT_VALUE: Record<string, number> = {
  herald: 5.4,
  lancer: 5.6,
  medic: 5.3,
  // New, not yet measured with the "always take X" sim; on a par with Medic.
  warden: 5.3,
  acolyte: 5.2,
  guard: 6,
  berserker: 5.8,
  bulwark: 5.5,
  skirmisher: 5.3,
  striker: 5.2,
};

/** What the AI treats a fresh Squire as worth, on the same scale as AI_UNIT_VALUE. */
const SQUIRE_PICK_VALUE = 5.6;
/**
 * Extra pick value for a Squire while holding a Squire upgrade. 1 had the AI's
 * Squire upgrades winning 63-65% (50-51% when picked at random); 0.5, with
 * SQUIRE_AUGMENT_WEIGHT 0.2, brings them to 55-58%.
 */
const NUDGE = 0.5;

/**
 * How much each unit type is worth extra to a side, given the augments it
 * holds: FIT_BONUS per held augment built around that type (Adrenaline for
 * Berserkers, Steady footing for Skirmishers). Augments that touch every unit,
 * or none, don't tilt picks. Without this the AI took unit-specific augments
 * and then never fielded the units, so they measured as dead cards.
 */
const FIT_BONUS = 1;
const ALL_TYPES = Object.keys(UNITS).length;
function augmentFit(state?: AugmentState): Map<string, number> {
  const fit = new Map<string, number>();
  if (!state) return fit;
  for (const id of state.active) {
    const def = getAugment(id);
    if (!def) continue;
    const affects = unitsAffectedBy(def);
    if (affects.length === 0 || affects.length >= ALL_TYPES) continue;
    for (const k of affects) fit.set(k, (fit.get(k) ?? 0) + FIT_BONUS);
  }
  return fit;
}

/**
 * Normal's pull toward a full-row synergy: once SYNERGY_LEAN_AT units share a
 * class, offers of that class score this much more (same idea as FIT_BONUS).
 * Hard needs no nudge: its search scores rows with the synergy applied.
 */
const SYNERGY_NUDGE = 1.5;
const SYNERGY_LEAN_AT = 3;
function classLean(board: Board, side: Side): Archetype | null {
  const counts = new Map<Archetype, number>();
  for (const u of sideUnits(board, side)) {
    const a = UNITS[u.key]?.archetype;
    if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  let best: Archetype | null = null;
  let n = 0;
  for (const [a, k] of counts) if (k > n) [best, n] = [a, k];
  return n >= SYNERGY_LEAN_AT ? best : null;
}

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
  // Knighting first: a Knight reaching the cap earns a slot like anyone.
  promoteSquires(board, PLAYER, playerAug);
  promoteSquires(board, ENEMY, enemyAug);
  // Every unit at the level cap opens one more slot for its side (kept even if
  // that unit is later replaced), so a long match never stalls on a row of
  // maxed units with nowhere to put a pick.
  const earned = (side: Side) => {
    const now = Math.min(MAX_EARNED_SLOTS, sideUnits(board, side).filter((u) => isMastered(u.merges, levelCapOf(board))).length);
    return Math.max(board.earnedSlots?.[side] ?? 0, now);
  };
  board.earnedSlots = { player: earned(PLAYER), enemy: earned(ENEMY) };
  const withCapacity = (state: AugmentState, side: Side) => {
    const mods = sideModsFor(state);
    // Ascendant's single slot stays single.
    if (mods.uncapped) return { ...mods, capacity: mods.capacity ?? 1 };
    return { ...mods, capacity: (mods.capacity ?? DEPTH) + (board.earnedSlots![side] ?? 0) };
  };
  board.mods = { player: withCapacity(playerAug, PLAYER), enemy: withCapacity(enemyAug, ENEMY) };
  // Ascendant: the row is one unit. Taking it trims the row to its best unit
  // here, where every path (the app, the AI, the sim, online) passes.
  for (const side of [PLAYER, ENEMY]) if (board.mods[side]!.uncapped) keepChampion(board, side);
  // (Knighting, above, happens here because every merge path — offer, placed
  // unit, AI — is followed by a refresh: one place to check, so none can skip it.)
  ensureDepth(board, Math.max(board.mods.player!.capacity!, board.mods.enemy!.capacity!));
  const p = sideUnits(board, PLAYER);
  const e = sideUnits(board, ENEMY);
  const pCap = board.mods.player!.capacity!;
  const eCap = board.mods.enemy!.capacity!;
  const { startHp, synergies } = rulesOf(board);
  applyAugments(p, playerAug, board.hp.player, e.length, pCap, synergies ? synergyOf(p, pCap) : null, startHp, levelCapOf(board));
  applyAugments(e, enemyAug, board.hp.enemy, p.length, eCap, synergies ? synergyOf(e, eCap) : null, startHp, levelCapOf(board));
  // Sabotage reaches across: each side's holds the other's front down. After
  // both sides are computed, since it acts on the opponent's finished stats.
  if (hasAugment(playerAug, "sabotage")) sabotage(e[0]);
  if (hasAugment(enemyAug, "sabotage")) sabotage(p[0]);
}

/** How much a unit is worth fighting alone: attack times health, from its base stats. */
const fighterPower = (u: Unit) => Math.max(1, u.baseAtk) * u.baseMaxHp;

/**
 * Ascendant's champion: the strongest fighter (attack × health), front-most on
 * a tie. A support unit only when there's nothing else: every support ability
 * works from behind the front, so alone it does nothing. It used to be the
 * highest level, which could keep a levelled Acolyte with 1 attack.
 * Deterministic, so both devices of an online match agree.
 */
export function championOf(units: Unit[]): Unit | undefined {
  const fighters = units.filter((u) => UNITS[u.key]?.archetype !== "support");
  const pool = fighters.length > 0 ? fighters : units;
  return pool.reduce<Unit | undefined>((a, b) => (!a || fighterPower(b) > fighterPower(a) ? b : a), undefined);
}

/** Keep only `side`'s champion (`championOf`). */
export function keepChampion(board: Board, side: Side): void {
  const units = sideUnits(board, side);
  if (units.length <= 1) return;
  const best = championOf(units)!;
  for (let lane = 0; lane < board.lanes; lane++) {
    writeLane(board, side, lane, lane === 0 ? [best] : []);
  }
}

/** Sabotage's hit on one front unit, badged and itemised like any augment. */
function sabotage(front: Unit | undefined): void {
  if (!front) return;
  const cut = Math.min(SABOTAGE_ATK, front.atk);
  front.atk -= cut;
  if (!front.auras.includes("sabotage")) front.auras.push("sabotage");
  front.auraDetails = [...(front.auraDetails ?? []), { id: "sabotage", atk: -cut, hp: 0 }];
}
