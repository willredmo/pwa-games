// Core duel-deck combat types. Generic over lane count and lane depth — the
// doc's v1 is a single shared row, but nothing here assumes one lane, so the
// 3-5 lane expansion stays a config change.

export type Side = "player" | "enemy";

export function otherSide(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

export type Shape = "circle" | "square" | "triangle" | "diamond" | "hexagon" | "shield";

/** A unit definition (the pool-level template). */
export interface UnitStats {
  name: string;
  atk: number;
  maxHp: number;
  shape: Shape;
  /** Tags that augments target, e.g. "striker", "tank". */
  classes: string[];
  role: string;
  /** Keywords the unit always has, before any augment (its ability, armour). */
  traits?: UnitTraits;
  /** Its innate ability, as shown to the player. */
  ability?: UnitAbility;
  /** False for units that never appear in the offer (the Knight is earned). */
  offered?: boolean;
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
  /**
   * Combat keywords granted by augments for this round, recomputed with the
   * stats by `applyAugments`. Optional so older saves (and fresh units before
   * their first refresh) read as "no traits".
   */
  traits?: UnitTraits;
  /**
   * What each augment is doing to this unit this round, rebuilt alongside the
   * stats. Drives the hover breakdown, so it always matches the real numbers.
   */
  auraDetails?: AuraDetail[];
}

/** One augment's contribution to one unit. */
export interface AuraDetail {
  id: string;
  atk: number;
  hp: number;
  traits?: UnitTraits;
}

/** Combat keywords. Read by `resolveRound`; all absent = plain melee. */
export interface UnitTraits {
  /** Strikes before the enemy in the round's FIRST exchange; a kill there means no return blow. */
  firstStrike?: boolean;
  /** Damage beyond what kills the target carries on to the next enemy in the queue. */
  cleave?: boolean;
  /** Damage reflected back to whoever hits this unit (per hit). */
  thorns?: number;
  /** Fraction (0..1) of damage dealt this unit heals, capped at max HP. */
  lifesteal?: number;
  /** Flat reduction to every hit this unit takes (a hit still deals at least 1). */
  damageReduction?: number;
  /** Bonus ATK against a target below half its max HP. */
  executioner?: number;
  /** On death, deals its ATK once to the enemy front. Only the side's FIRST death each round triggers. */
  lastBreath?: boolean;
  /** Overflow carries in full (Cleave upgrade), instead of half capped at 3. */
  cleaveFull?: boolean;
  /** The first N hits it takes each round are dodged entirely (Skirmisher). */
  dodges?: number;
  /** Damage it strikes back with when it dodges (Skirmisher's riposte). */
  riposte?: number;
  /** Most a (non-full) overflow can carry; defaults to 3 (Berserker raises it). */
  cleaveCap?: number;
  /** Extra damage on its first attack each round (Striker's Charge). */
  openingBonus?: number;
  /** On death, buffs allies for the rest of the round (Guard, Squire, Knight). */
  deathBuff?: { target: "behind" | "allies"; atk?: number; hp?: number };
  /** If it survives a round, permanently gains this (Bulwark's Fortify). */
  growOnSurvive?: { atk?: number; hp?: number };
}

/** A unit's innate ability, for display. Mechanics live in its `traits`. */
export interface UnitAbility {
  name: string;
  /** When it fires: "On death", "Start of round", ... */
  trigger: string;
  text: string;
  /** How it grows with merges, e.g. "+1 health per merge". */
  scaling?: string;
}

/** Side-wide modifiers from augments, set on the board each round. */
export interface SideMods {
  /** Extra HP taken from the loser when this side wins a round. */
  bounty?: number;
  /** Queue slots this side may use (defaults to board.depth). */
  capacity?: number;
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
  /** Side-wide augment modifiers (bounty, capacity). Absent = none. */
  mods?: Partial<Record<Side, SideMods>>;
}

// --- Battle log (drives playback) ---

export interface AttackEvent {
  type: "attack";
  lane: number;
  attacker: string;
  target: string;
  damage: number;
  /** Why this blow happened, when it isn't a plain front-vs-front strike. */
  tag?: "first-strike" | "cleave" | "thorns" | "last-breath" | "executioner" | "charge" | "dodge";
  /** Damage soaked by the target's damageReduction (already removed from `damage`). */
  blocked?: number;
  /** Charge bonus included in `damage` (set even when tagged first-strike). */
  opening?: number;
}
/** A death-triggered buff landing on an ally, for the rest of the round. */
export interface BuffEvent {
  type: "buff";
  unit: string;
  /** The unit whose death caused it. */
  source: string;
  atk: number;
  hp: number;
}
export interface HealEvent {
  type: "heal";
  unit: string;
  amount: number;
}
export interface DeathEvent {
  type: "death";
  unit: string;
  /** Unit key, so on-death augment triggers can check class. */
  key: string;
  side: Side;
}

export type BattleEvent = AttackEvent | DeathEvent | HealEvent | BuffEvent;

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
  /** HP subtracted from the loser: the winner's surviving units' attack, plus bounty. */
  hpLoss: number;
  /** The winner's units left standing, and the attack they hit the loser for. */
  survivors?: { ids: string[]; damage: number };
  /** Enemy units each side killed this round (Overwhelm counts these). */
  kills?: Record<Side, number>;
  /** Bounty included in hpLoss, for display. */
  bounty?: number;
  /** Set once a player's HP pool hits 0. */
  matchWinner: Side | null;
}
