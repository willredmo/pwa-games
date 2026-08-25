// Core duel-deck combat types. Generic over lane count and lane depth — the
// doc's v1 is a single shared row, but nothing here assumes one lane, so the
// 3-5 lane expansion stays a config change.

export type Side = "player" | "enemy";

export function otherSide(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

export type Shape = "circle" | "square" | "triangle" | "diamond" | "hexagon";

/** A unit definition (the pool-level template). */
export interface UnitStats {
  name: string;
  atk: number;
  maxHp: number;
  shape: Shape;
  /** Tags that augments target, e.g. "striker", "tank". */
  classes: string[];
  role: string;
}

/** An in-play unit instance on the board. */
export interface Unit {
  id: string;
  side: Side;
  key: string; // index into UNITS
  name: string;
  shape: Shape;
  classes: string[];
  /**
   * Base stats, before augments. Merging an offered unit into this one raises
   * these (not the effective stats), so upgrades survive both the end-of-round
   * respawn and the per-round augment recomputation.
   */
  baseAtk: number;
  baseMaxHp: number;
  /** How many offered units have been merged in — shown as a +N badge. */
  merges: number;
  /** Effective stats after augments are applied for the round. */
  atk: number;
  maxHp: number;
  hp: number;
  /**
   * Ids of the augments actually changing this unit's stats this round, in
   * pick order. Recomputed alongside the stats each round (an augment whose
   * condition is currently false contributes nothing and isn't listed), so it
   * always describes *why* the numbers above differ from the base ones.
   */
  auras: string[];
}

/**
 * The board. `slots[side][lane][spot]` holds a unit or null; spot 0 is the
 * front (closest to the enemy). The two sides face each other across the
 * center line, so both fronts meet in the middle.
 */
export interface Board {
  lanes: number;
  depth: number;
  slots: Record<Side, (Unit | null)[][]>;
  /** Each player's own HP pool (100 at match start). */
  hp: Record<Side, number>;
}

// --- Battle log (drives playback) ---

export interface AttackEvent {
  type: "attack";
  lane: number;
  attacker: string;
  target: string;
  damage: number;
}
export interface DeathEvent {
  type: "death";
  unit: string;
  /** Unit key, so on-death augment triggers can check class. */
  key: string;
  side: Side;
}

export type BattleEvent = AttackEvent | DeathEvent;

/** One tick's events plus the board state after they're applied. */
export interface Tick {
  events: BattleEvent[];
  snapshot: Board;
}

export interface RoundResult {
  board: Board; // final state after the round
  ticks: Tick[];
  /** Side left holding the row, or null if both were wiped / stalemate. */
  roundWinner: Side | null;
  /** Total damage each side dealt during the round. */
  damageDealt: Record<Side, number>;
  /** HP subtracted from the loser (the winner's total damage). */
  hpLoss: number;
  /** Set once a player's HP pool hits 0. */
  matchWinner: Side | null;
}
