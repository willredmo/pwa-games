// Core duel-deck combat types. Generic over lane count and lane depth — the
// doc's v1 is a single shared row, but nothing here assumes one lane, so the
// 3-5 lane expansion stays a config change.

export type Side = "player" | "enemy";

export function otherSide(side: Side): Side {
  return side === "player" ? "enemy" : "player";
}

export type Shape = "circle" | "square" | "triangle" | "diamond" | "hexagon" | "shield" | "star" | "kite" | "cross" | "octagon" | "drop" | "lantern" | "pillar";

/**
 * A unit's class. A row whose every slot holds one class gets that class's
 * synergy (`SYNERGIES` in engine/units.ts). Separate from `classes`, which are
 * the tags upgrades target.
 */
export type Archetype = "attack" | "defense" | "support";

/** A unit definition (the pool-level template). */
export interface UnitStats {
  name: string;
  atk: number;
  maxHp: number;
  shape: Shape;
  /** Tags that augments target, e.g. "striker", "tank". */
  classes: string[];
  /** Attack, Defense or Support: what full-row synergies count. */
  archetype: Archetype;
  role: string;
  /** Keywords the unit always has, before any augment (its ability, armour). */
  traits?: UnitTraits;
  /** Its innate ability, as shown to the player. */
  ability?: UnitAbility;
  /** What the ability becomes at MAX_LEVEL, as shown to the player. */
  mastery?: string;
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
  /**
   * Shield left this round (Warden's Barrier), once a hit has dented it. Absent
   * means untouched: the full `traits.shield`. Cleared by `applyAugments`.
   */
  shieldLeft?: number;
}

/** One augment's contribution to one unit. */
export interface AuraDetail {
  id: string;
  /** Display name when the source isn't an augment (a Herald's rally). */
  label?: string;
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
  /** A unit its Overflow kills passes the rest on in turn (a mastered Berserker). */
  cleaveChain?: boolean;
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
  /**
   * Start of round: the unit directly in front of this one gains this much
   * attack for the round (Herald's Rally). Several stack. Every support
   * ability lands on the unit directly ahead (`supportTarget` in combat.ts);
   * a Beacon there passes it on.
   */
  rally?: number;
  /** Each landed main blow also hits the enemy unit behind the front for this much (Lancer's Impale). */
  pierce?: number;
  /** After each exchange, it heals the unit directly in front of it for this much (Medic's Mend). */
  mend?: number;
  /** Mends per round beyond the usual 3 (a mastered Medic, Triage). */
  mendMore?: number;
  /** Each Mend also gives the unit it heals this much attack for the round (Stimulant). */
  mendAtk?: number;
  /** Charge fires on the first blow against each new enemy (a mastered Striker). */
  chargeEach?: boolean;
  /** Impale reaches this many more units behind the first (a mastered Lancer, Skewer). */
  pierceDeeper?: number;
  /** Rally also gives the unit it lands on this much health (a mastered Herald). */
  rallyHp?: number;
  /** The unit directly in front starts the round with a shield of this much (Warden's Barrier). */
  barrier?: number;
  /** How many more units ahead of that one Barrier also covers (a mastered Warden). */
  barrierReach?: number;
  /** Barrier also shields the Warden itself (Aegis), for when it steps up to the front. */
  barrierSelf?: boolean;
  /**
   * A support ability reaching this unit goes on to the unit in front of it,
   * amplified to this percent (Beacon's Relay: 150 + 10 a level). Beacons in
   * a row chain, each adding its bonus over ×1, up to RELAY_CAP. One with
   * nobody ahead keeps what it gets.
   */
  relay?: number;
  /**
   * Percent of every blow it takes (the blow's full strength, before armour
   * or shields) struck back at the attacker (Sentinel's Retaliate). Played as
   * thorns, so a reflected blow never reflects again.
   */
  reflect?: number;
  /**
   * Armour counts as at least this much (Unbreakable). A floor, not a bonus:
   * a Knight's or Bastion's armour doesn't stack with it.
   */
  minArmour?: number;
  /** Damage absorbed before health this round (set by Barrier). */
  shield?: number;
  /** Gives half its health to the unit directly in front, times this (Acolyte's Lifebond; Sanctuary doubles). */
  lifebond?: number;
  /** A mastered Acolyte: the unit it gives to also gains this much attack. */
  lifebondAtk?: number;
  /** Its blows can't be dodged (Full Assault). */
  trueStrike?: boolean;
  /** The first blow each round that would kill it leaves it on 1 health instead (Sanctuary). */
  endure?: boolean;
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
  /** Last light: attack the side's last unit standing gains per ally fallen this round. */
  lastLight?: number;
  /** Holdout: extra damage reduction for the side's last unit standing. */
  holdout?: number;
  /** Ascendant: this side's units have no level cap. */
  uncapped?: boolean;
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
  /** Each player's own HP pool. */
  hp: Record<Side, number>;
  /** The pool both players started the match with (the title screen's choice; absent = 200). */
  startHp?: number;
  /**
   * Extra row slots each side has earned by bringing units to the level cap
   * (one per unit, up to MAX_EARNED_SLOTS). Never shrinks, so replacing a
   * maxed unit doesn't take its slot away.
   */
  earnedSlots?: Partial<Record<Side, number>>;
  /** The match's level cap (a match setting; absent = MAX_LEVEL, 10). Read through `levelCapOf`. */
  levelCap?: number;
  /** Match settings beyond the pool (absent = the defaults: no easy mode, synergies and upgrades on). */
  rules?: { easy?: boolean; synergies?: boolean; upgrades?: boolean };
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
  tag?: "first-strike" | "cleave" | "thorns" | "last-breath" | "executioner" | "charge" | "dodge" | "pierce";
  /** Damage soaked by the target's damageReduction (already removed from `damage`). */
  blocked?: number;
  /** Charge bonus included in `damage` (set even when tagged first-strike). */
  opening?: number;
  /** The target's shield after this blow, when a shield soaked some of it. */
  shieldLeft?: number;
  /** The blow would have killed the target, but it endured on 1 health (Phoenix, Undying, Vanguard's vow). */
  endured?: true;
}
/** A death-triggered buff landing on an ally, for the rest of the round. */
export interface BuffEvent {
  type: "buff";
  unit: string;
  /** The unit whose death caused it (or, for Last light, the unit itself). */
  source: string;
  /** Ability name for playback when it isn't a death buff ("Last light"). */
  label?: string;
  atk: number;
  hp: number;
  /** Shield it gains for the round (Warden's Barrier). */
  shield?: number;
  /** Beacons it passed through on the way, nearest the source first, and the chain's total amplification (capped at RELAY_CAP). */
  via?: string[];
  amp?: number;
}
export interface HealEvent {
  type: "heal";
  unit: string;
  amount: number;
  /** Who healed it, when it wasn't its own lifesteal (a Medic's Mend). */
  source?: string;
  /** Beacons a Mend passed through (see BuffEvent.via). */
  via?: string[];
  amp?: number;
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
  /** Ascendant: pool damage dealt by champions in a mutual wipe (both pools may take some). */
  ascendantHit?: number;
  /** Start-of-round support buffs (Rally, Lifebond, Barrier), applied before the first tick. */
  opening?: BattleEvent[];
  /** Set once a player's HP pool hits 0. */
  matchWinner: Side | null;
}
