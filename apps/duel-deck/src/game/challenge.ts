import { insertUnit, makeUnit, mergeGain } from "../engine/board";
import { resolveRound } from "../engine/combat";
import type { Board, Side, Unit } from "../engine/types";
import { OFFER_KEYS } from "../engine/units";
import { OFFERED_AUGMENTS, createAugmentState, takeAugment, type AugmentState } from "./augments";
import { ENEMY, PLAYER, newBoard, refreshForRound } from "./match";

// The daily challenge (2026-11-02, a player's idea): one round, the same for
// everyone on a given UTC day. You're dealt a pool of units (with levels) and
// upgrades; pick which units go in your row and in what order, and which
// upgrades to take, then fight one fixed enemy row. Retry as often as you like.
//
// Everything comes from a seed made from the date, and the engine has no
// randomness, so every device builds the same challenge and the same fights.
// Units and upgrades ignore progression: a challenge can use anything.
//
// Difficulty is easy, medium or hard (from the seed), and measured rather than
// guessed: `dailyChallenge` samples random answers through the real engine and
// keeps the first enemy row whose share of winning answers lands in the band.

export type ChallengeLevel = "easy" | "medium" | "hard";

export interface ChallengeUnit {
  key: string;
  level: number;
}

export interface Challenge {
  /** UTC date, "YYYY-MM-DD". */
  day: string;
  difficulty: ChallengeLevel;
  /** Units to choose from. */
  units: ChallengeUnit[];
  /** Upgrades to choose from. */
  upgrades: string[];
  /** How many of `upgrades` to take. */
  pickUpgrades: number;
  /** Most units in your row. */
  slots: number;
  /** The enemy's row, front first, and its upgrades. */
  enemy: { row: ChallengeUnit[]; upgrades: string[] };
  /** Share of random answers that win (how hard it measured). */
  winShare: number;
}

/** Your answer: indices into `units` (front first), ids from `upgrades`. */
export interface ChallengeAnswer {
  row: number[];
  upgrades: string[];
}

export const POOL_UNITS = 7;
export const POOL_UPGRADES = 4;
export const PICK_UPGRADES = 2;
export const SLOTS = 5;
/** How many past days can be played (today included). */
export const PAST_DAYS = 90;

/** Share of random answers that should win, per difficulty. */
const BANDS: Record<ChallengeLevel, [number, number]> = {
  easy: [0.3, 0.65],
  medium: [0.1, 0.3],
  hard: [0.02, 0.1],
};
const SAMPLES = 120;
const TRIES = 24;

/**
 * Upgrades a one-round fight can show: no choose-a-unit ones, nothing that
 * reads earlier rounds or the HP pools, nothing that only pays over a match.
 */
const ONE_ROUND = new Set(["momentum", "overwhelm", "desperate-measures", "berserkers-rally", "bloodpact", "living-fortress"]);
export const CHALLENGE_UPGRADES = OFFERED_AUGMENTS.filter(
  (a) => !a.target && a.category !== "strategy" && !ONE_ROUND.has(a.id),
).map((a) => a.id);

/** Today's day key (UTC). */
export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** The `n` days before `day`, newest first, `day` included. */
export function pastDays(day = dayKey(), n = PAST_DAYS): string[] {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => dayKey(new Date(t - i * 86_400_000)));
}

/** A small seeded PRNG (mulberry32), seeded by FNV-1a over the text. */
function rng(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

function sample<T>(r: () => number, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

/** A unit grown to `level` by merges of its own type. */
export function grownUnit(u: ChallengeUnit, side: Side): Unit {
  const unit = makeUnit(u.key, side);
  for (let m = 0; m < u.level - 1; m++) {
    const g = mergeGain(u.key, 0.5, unit.merges);
    unit.baseAtk += g.atk;
    unit.baseMaxHp += g.hp;
    unit.merges += 1;
  }
  return unit;
}

/** The round an answer makes, ready to fight: both rows placed, upgrades applied. */
export function challengeRound(ch: Challenge, answer: ChallengeAnswer): { board: Board; player: AugmentState; enemy: AugmentState } {
  const board = newBoard();
  const mine = answer.row.map((i) => grownUnit(ch.units[i], PLAYER));
  const theirs = ch.enemy.row.map((u) => grownUnit(u, ENEMY));
  mine.forEach((u, i) => insertUnit(board, PLAYER, 0, i, u));
  theirs.forEach((u, i) => insertUnit(board, ENEMY, 0, i, u));
  const player = createAugmentState();
  const enemy = createAugmentState();
  for (const id of answer.upgrades) takeAugment(player, id, mine);
  for (const id of ch.enemy.upgrades) takeAugment(enemy, id, theirs);
  refreshForRound(board, player, enemy);
  return { board, player, enemy };
}

/** Whether an answer wins (the player holds the row). */
export const answerWins = (ch: Challenge, answer: ChallengeAnswer): boolean =>
  resolveRound(challengeRound(ch, answer).board).roundWinner === PLAYER;

/** A random legal answer: up to `slots` units in a random order, `pickUpgrades` upgrades. */
function randomAnswer(r: () => number, ch: Challenge): ChallengeAnswer {
  const n = 3 + Math.floor(r() * (ch.slots - 2));
  return {
    row: sample(r, ch.units.map((_, i) => i), Math.min(n, ch.units.length)),
    upgrades: sample(r, ch.upgrades, ch.pickUpgrades),
  };
}

function winShareOf(ch: Challenge, seed: string): number {
  const r = rng(seed);
  let won = 0;
  for (let i = 0; i < SAMPLES; i++) if (answerWins(ch, randomAnswer(r, ch))) won++;
  return won / SAMPLES;
}

const LEVELS = ["easy", "medium", "hard"] as const;
const seedOf = (day: string) => `duel-deck:challenge:${day}`;

/** A day's difficulty without building it (the seed's first draw), for the calendar. */
export const difficultyOf = (day: string): ChallengeLevel => pick(rng(seedOf(day)), LEVELS);

const cache = new Map<string, Challenge>();

/** The challenge for a day. Deterministic: every device gets the same one. */
export function dailyChallenge(day: string): Challenge {
  const hit = cache.get(day);
  if (hit) return hit;
  const r = rng(seedOf(day));
  const difficulty = pick(r, LEVELS);
  const base = 3 + Math.floor(r() * 4); // the pool's levels: 3 to 6
  const units: ChallengeUnit[] = Array.from({ length: POOL_UNITS }, () => ({
    key: pick(r, OFFER_KEYS),
    level: Math.max(1, base + Math.floor(r() * 3) - 1),
  }));
  const upgrades = sample(r, CHALLENGE_UPGRADES, POOL_UPGRADES);
  const [lo, hi] = BANDS[difficulty];
  let best: Challenge | null = null;
  let bestMiss = Infinity;
  // Each try deals a fresh enemy row, then nudges its levels toward the band:
  // up when too many answers win, down when too few.
  let lift = { easy: -1, medium: 0, hard: 1 }[difficulty];
  for (let t = 0; t < TRIES; t++) {
    const row: ChallengeUnit[] = Array.from({ length: SLOTS }, () => ({
      key: pick(r, OFFER_KEYS),
      level: Math.max(1, base + lift + Math.floor(r() * 3) - 1),
    }));
    const enemyUps = sample(r, CHALLENGE_UPGRADES, difficulty === "easy" ? 1 : 2);
    const ch: Challenge = { day, difficulty, units, upgrades, pickUpgrades: PICK_UPGRADES, slots: SLOTS, enemy: { row, upgrades: enemyUps }, winShare: 0 };
    ch.winShare = winShareOf(ch, `${day}:${t}`);
    const miss = ch.winShare < lo ? lo - ch.winShare : ch.winShare > hi ? ch.winShare - hi : 0;
    // Never a day nobody can win: zero sampled wins isn't proof, so skip it.
    if (ch.winShare > 0 && miss < bestMiss) [best, bestMiss] = [ch, miss];
    if (ch.winShare > 0 && miss === 0) break;
    lift += ch.winShare > hi ? 1 : -1;
  }
  // Every try lost every sample (very unlikely): fall back to the weakest row.
  best ??= { day, difficulty, units, upgrades, pickUpgrades: PICK_UPGRADES, slots: SLOTS, enemy: { row: units.slice(0, 3).map((u) => ({ ...u, level: 1 })), upgrades: [] }, winShare: 1 };
  cache.set(day, best);
  return best;
}

// --- This device's results --------------------------------------------------------

const RESULTS_KEY = "duel-deck:challenges";

export interface ChallengeResult {
  tries: number;
  /** When it was first won (ms), if it has been. */
  wonAt?: number;
  /** Tries it took to win. */
  wonIn?: number;
}

export function loadResults(): Record<string, ChallengeResult> {
  try {
    return JSON.parse(localStorage.getItem(RESULTS_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Record one try at a day's challenge. Returns the updated results. */
export function recordTry(day: string, won: boolean): Record<string, ChallengeResult> {
  const all = loadResults();
  const cur = all[day] ?? { tries: 0 };
  const tries = cur.tries + 1;
  all[day] = { tries, ...(cur.wonAt ? { wonAt: cur.wonAt, wonIn: cur.wonIn } : won ? { wonAt: Date.now(), wonIn: tries } : {}) };
  // Keep only the playable window.
  const keep = new Set(pastDays());
  for (const d of Object.keys(all)) if (!keep.has(d)) delete all[d];
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(all));
  } catch {
    // Private mode: results last for the page.
  }
  return all;
}
