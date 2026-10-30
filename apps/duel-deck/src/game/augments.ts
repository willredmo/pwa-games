import type { Archetype, AuraDetail, SideMods, Side, Unit, UnitTraits } from "../engine/types";
import { KNIGHT_LEVEL, MAX_LEVEL, SYNERGIES, UNITS, UNIT_KEYS, innateTraits } from "../engine/units";
import { firstEmptySpot, makeUnit, mergeCapFor, mergeGain, place, sideUnits } from "../engine/board";
import type { Board } from "../engine/types";

// Persistent upgrades ("augments") — the tracker doc's separate offer track.
//
// Key properties from the doc:
//   - Offered every 3rd round, on their own track (never mixed with unit picks)
//   - MATCH-SCOPED: they last the current match only, never carried between
//     matches. `AugmentState` therefore lives and dies with a match.
//
// Most augments are not one-off stat edits — Momentum stacks per round won,
// Desperate Measures switches on below 60 HP, Vanguard's Edge re-targets
// whoever is front. So effects are recomputed from base stats at the start of
// every round via `applyAugments`, rather than mutated into the units once.

/**
 * Silver, gold, prismatic (as in League's ARAM Mayhem). Each upgrade choice
 * deals cards of one rarity, the same for both players: `rollRarity` draws it
 * from a seed both sides share, with fixed odds (`RARITY_ODDS`).
 */
export type Rarity = "silver" | "gold" | "prismatic";
export const RARITIES: Rarity[] = ["silver", "gold", "prismatic"];
/**
 * Chance of each rarity [silver, gold, prismatic] at every upgrade choice,
 * the same all match (the user's call; they used to climb from 75/25/0).
 */
export const RARITY_ODDS: [number, number, number] = [0.5, 0.35, 0.15];

/**
 * A string hashed to [0, 1), the same on both devices: FNV-1a, then
 * murmur3's finalizer. FNV alone left "seed:1", "seed:2", ... a few
 * thousandths apart (the last character only nudges it), so 91% of matches
 * got one rarity at every choice.
 */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * This choice's rarity for both players: `seed` is shared (the room for an
 * online duel, the saved match against the CPU), `tier` is which upgrade
 * choice this is (1 = the first), so each choice rolls afresh.
 */
export function rollRarity(seed: string, tier: number): Rarity {
  let r = hash01(`${seed}:${tier}`);
  for (let i = 0; i < RARITIES.length; i++) {
    r -= RARITY_ODDS[i];
    if (r < 0) return RARITIES[i];
  }
  return "silver";
}

/** A fresh seed for a CPU match's upgrade rarities. */
export const newUpgradeSeed = () => Math.random().toString(36).slice(2, 10);

export type AugmentCategory = "class" | "global" | "synergy" | "combat" | "strategy";

/** Everything an augment effect may inspect when it's evaluated. */
export interface AugmentContext {
  units: Unit[]; // your board units, front-first
  ownHp: number;
  enemyUnitCount: number;
  /** Stacking counters accumulated during the match. */
  momentum: number; // rounds won, for Momentum
  rally: number; // Berserkers lost, for Berserker's Rally
  kills: number; // enemy units you killed last round, for Overwhelm
  /** Slots this side may fill this round (Full ranks). */
  capacity: number;
  /** The pool the match started with, for HP thresholds (Desperate measures). */
  startHp: number;
  /** Upgrades this side holds, for Warlord. */
  upgrades: number;
}

/** A flat stat delta applied to one unit for the coming round. */
export interface Delta {
  atk?: number;
  hp?: number;
}

export interface AugmentDef {
  id: string;
  name: string;
  description: string;
  category: AugmentCategory;
  /**
   * Badge drawn on every unit this augment is currently buffing. Unique per
   * augment — it's the only thing distinguishing one badge from another on the
   * board, and the panels list it beside the name as the legend.
   */
  icon: string;
  /** Per-unit modifier, recomputed each round. */
  effect?: (unit: Unit, index: number, ctx: AugmentContext) => Delta;
  /** One-time consequences at pick time (e.g. Bloodpact's HP cost). */
  onPick?: (state: AugmentState, units: Unit[]) => void;
  /** Share of the starting pool it costs, once, at pick time (Bloodpact). */
  hpCostShare?: number;
  /** Combat keywords for one unit, recomputed each round like `effect`. */
  traits?: (unit: Unit, index: number, ctx: AugmentContext) => UnitTraits;
  /** Side-wide modifiers while held (see `sideModsFor`). */
  mods?: SideMods;
  /** Absent = silver. Each upgrade choice deals one rarity. */
  rarity?: Rarity;
  /**
   * Choose-a-unit upgrades: taking one asks for one of your units, which it
   * changes once, at pick time (`applyTarget`). `can` says which units it
   * may land on; it's only offered while at least one can.
   */
  target?: {
    can: (unit: Unit, board: Board, side: Side) => boolean;
    apply: (unit: Unit, ctx: TargetContext) => void;
    /** The AI's choice among the units it can land on (highest wins). */
    aiScore: (unit: Unit, board: Board, side: Side) => number;
    /** What the unit-choice step says it does, e.g. "gains 3 levels". */
    verb: string;
  };
  /** Pool HP restored each round this side wins (see `settleRound`). */
  healOnWin?: number;
  /**
   * Pulled from the game for now: never offered and not listed, but kept so a
   * saved match that already holds it still plays.
   */
  retired?: boolean;
  /**
   * Upgrades never offered while this one is held, because they can't do
   * anything alongside it (Ascendant's single unit has no allies or row).
   */
  excludes?: string[];
  /**
   * Unit types this augment is built around when that isn't visible in its
   * effect — Berserker's rally buffs everyone but is triggered by Berserkers.
   * Overrides the derived set in `unitsAffectedBy`.
   */
  units?: string[];
}

/** Match-scoped augment state. Reset on every new match. */
export interface AugmentState {
  active: string[]; // augment ids, in pick order
  momentum: number;
  rally: number;
  /** Enemies killed last round (Overwhelm). Undefined in old saves = 0. */
  kills: number;
  /** One-time grants baked onto specific units (e.g. Last Stand). */
  grants: Record<string, Grant>; // unitId -> delta
  /**
   * Drill: attack every unit gets this round, one per pick left unspent while
   * the whole row is at its level cap (`drillFor` in match.ts). Set at commit,
   * cleared when the next round starts, and sent with the online commit.
   */
  drill?: number;
}

/**
 * A one-off grant pinned to a single unit. `from` names the augments that
 * contributed, so the unit can show their badges — the delta alone doesn't say
 * where it came from.
 */
export interface Grant extends Delta {
  from: string[];
}

/** What a choose-a-unit upgrade may change when it lands. */
export interface TargetContext {
  state: AugmentState;
  board: Board;
  side: Side;
  id: string;
}

/** Pin a permanent stat bonus on one unit, crediting `id` (see `Grant`). */
function grant(state: AugmentState, unit: Unit, id: string, d: Delta): void {
  const prev = state.grants[unit.id] ?? { from: [] };
  state.grants[unit.id] = {
    ...prev,
    atk: (prev.atk ?? 0) + (d.atk ?? 0),
    hp: (prev.hp ?? 0) + (d.hp ?? 0),
    from: prev.from.includes(id) ? prev.from : [...prev.from, id],
  };
}

/**
 * Give a unit up to `n` levels, each as if a copy of itself were merged in
 * (a Knight takes them as Squire merges, as its offers would), stopping at the
 * level cap. Returns the levels given.
 */
export function levelUp(unit: Unit, n: number, ctx: TargetContext): number {
  const cap = mergeCapFor(ctx.board, ctx.side);
  const ratio = mergeRatioFor(ctx.state);
  let given = 0;
  while (given < n && unit.merges < cap) {
    const gain = mergeGain(unit.key === "knight" ? "squire" : unit.key, ratio, unit.merges);
    unit.baseAtk += gain.atk;
    unit.baseMaxHp += gain.hp;
    unit.merges++;
    given++;
  }
  return given;
}

const belowCap = (u: Unit, board: Board, side: Side) => u.merges < mergeCapFor(board, side);
const isSupport = (u: Unit) => UNITS[u.key]?.archetype === "support";
/** Attack x health: the AI's sense of how much a unit fights. */
const power = (u: Unit) => Math.max(1, u.baseAtk) * u.baseMaxHp;

export function createAugmentState(): AugmentState {
  return { active: [], momentum: 0, rally: 0, kills: 0, grants: {} };
}

const has = (u: Unit, cls: string) => u.classes.includes(cls);
/** Most attack Berserker's rally can grant: with full rows Berserkers die every round. */
export const RALLY_CAP = 2;
/** Shield every unit in an Iron Line row starts each round with. */
export const IRON_LINE_SHIELD = 5;
const countClass = (units: Unit[], cls: string) =>
  units.filter((u) => has(u, cls)).length;

export const AUGMENTS: AugmentDef[] = [
  // --- Class-targeted ---
  {
    id: "reinforced-plating",
    icon: "🛡️",
    name: "Reinforced plating",
    description: "+3 health to all Guards and Bulwarks.",
    category: "class",
    effect: (u) => (has(u, "tank") ? { hp: 3 } : {}),
  },
  {
    id: "sharpened-edge",
    icon: "🗡️",
    name: "Sharpened edge",
    description: "+2 attack to all Strikers and Berserkers.",
    category: "class",
    effect: (u) => (has(u, "aggro") ? { atk: 2 } : {}),
  },
  {
    id: "steady-footing",
    icon: "🥾",
    name: "Steady footing",
    description: "+1 attack and +2 health to all Skirmishers.",
    category: "class",
    // Retired 2026-10-20: taken 0 of 19 times offered. Duelist replaces it.
    retired: true,
    effect: (u) => (has(u, "skirmisher") ? { atk: 1, hp: 2 } : {}),
  },
  {
    id: "adrenaline",
    icon: "⚡",
    name: "Adrenaline",
    description: "+3 attack to all Berserkers.",
    category: "class",
    effect: (u) => (has(u, "berserker") ? { atk: 3 } : {}),
  },
  {
    id: "iron-will",
    icon: "🪖",
    name: "Iron will",
    description: "+4 health and +1 attack to all Bulwarks.",
    category: "class",
    effect: (u) => (has(u, "bulwark") ? { hp: 4, atk: 1 } : {}),
  },
  {
    id: "precision-strikes",
    icon: "🔪",
    name: "Precision strikes",
    description: "+2 attack and +1 health to all Strikers.",
    category: "class",
    effect: (u) => (has(u, "striker") ? { atk: 2, hp: 1 } : {}),
  },

  // --- Global ---
  {
    id: "battle-fury",
    icon: "😤",
    name: "Battle fury",
    description: "+1 attack to every unit on your board.",
    category: "global",
    rarity: "gold",
    effect: () => ({ atk: 1 }),
  },
  {
    id: "last-stand",
    icon: "🚩",
    name: "Last stand",
    description: "Your front-most unit right now gains +5 health, permanently.",
    category: "global",
    onPick: (state, units) => {
      const frontUnit = units[0];
      if (!frontUnit) return;
      const prev = state.grants[frontUnit.id] ?? { from: [] };
      state.grants[frontUnit.id] = {
        ...prev,
        hp: (prev.hp ?? 0) + 5,
        from: prev.from.includes("last-stand") ? prev.from : [...prev.from, "last-stand"],
      };
    },
  },
  {
    id: "momentum",
    icon: "📈",
    name: "Momentum",
    description: "For every 3 rounds your board wins, all units gain +1 attack. Stacks.",
    category: "global",
    rarity: "gold",
    effect: (_u, _i, ctx) => ({ atk: Math.floor(ctx.momentum / 3) }),
  },
  {
    id: "desperate-measures",
    icon: "💢",
    name: "Desperate measures",
    description: "While your HP is below half of what you started with (100 of 200), all units gain +2 attack.",
    category: "global",
    rarity: "gold",
    effect: (_u, _i, ctx) => (ctx.ownHp < ctx.startHp * 0.5 ? { atk: 2 } : {}),
  },
  {
    id: "united-front",
    icon: "🤝",
    name: "United front",
    description: "+1 health to all units for every 2 units on your board (rounded down).",
    category: "global",
    rarity: "prismatic",
    effect: (_u, _i, ctx) => ({ hp: Math.floor(ctx.units.length / 2) }),
  },
  {
    id: "overwhelm",
    icon: "🌊",
    name: "Overwhelm",
    description: "+1 attack to all units for every 3 enemy units you killed last round.",
    category: "global",
    rarity: "prismatic",
    effect: (_u, _i, ctx) => ({ atk: Math.floor(ctx.kills / 3) }),
  },
  {
    id: "bloodpact",
    icon: "🩸",
    name: "Bloodpact",
    description: "All units gain +2 attack, but you lose 40% of your starting HP (80 of 200).",
    category: "global",
    rarity: "prismatic",
    effect: () => ({ atk: 2 }),
    hpCostShare: 0.4,
  },

  // --- Synergy-based ---
  {
    id: "tank-wall",
    icon: "🏰",
    name: "Tank wall",
    description: "+1 health to Guards/Bulwarks per Guard or Bulwark you have.",
    category: "synergy",
    // Retired 2026-10-20: taken 4% of the time; Reinforced plating does the same job.
    retired: true,
    effect: (u, _i, ctx) =>
      has(u, "tank") ? { hp: countClass(ctx.units, "tank") } : {},
  },
  {
    id: "glass-cannon-pact",
    icon: "💎",
    name: "Glass cannon pact",
    description: "+3 attack and -1 health to all Strikers and Berserkers.",
    category: "synergy",
    // Retired 2026-10-20: taken 0 of 15 times offered; Sharpened edge covers it.
    retired: true,
    effect: (u) => (has(u, "aggro") ? { atk: 3, hp: -1 } : {}),
  },
  {
    id: "vanguards-edge",
    icon: "👑",
    name: "Vanguard's edge",
    description: "The unit leading your row when each round starts gets +2 attack and +2 health.",
    category: "synergy",
    effect: (_u, index) => (index === 0 ? { atk: 2, hp: 2 } : {}),
  },
  {
    id: "mixed-formation",
    icon: "🎲",
    name: "Mixed formation",
    // 5 types, not 4: with nine offered types 4 came too easily (54.7%).
    description: "+2 attack/+2 health to all units, if you have 5+ unit types.",
    category: "synergy",
    rarity: "prismatic",
    effect: (_u, _i, ctx) => {
      const types = new Set(ctx.units.map((x) => x.key));
      return types.size >= 5 ? { atk: 2, hp: 2 } : {};
    },
  },
  {
    id: "berserkers-rally",
    icon: "💀",
    name: "Berserker's rally",
    units: ["berserker"],
    description: "For every 4 of your Berserkers that die, all units gain +1 attack for the match (up to +2).",
    category: "synergy",
    // A point per 4 deaths, capped: Berserkers fall nearly every round and respawn, so
    // a full point per death stacked without limit.
    effect: (_u, _i, ctx) => ({ atk: Math.min(RALLY_CAP, Math.floor(ctx.rally / 4)) }),
  },

  // --- Combat keywords ---
  {
    id: "first-strike",
    icon: "🏹",
    name: "First strike",
    description:
      "Each Striker's first swing of the round lands first, even if it steps up later; if it kills, no blow comes back.",
    category: "combat",
    traits: (u) => (has(u, "striker") ? { firstStrike: true } : {}),
  },
  {
    id: "cleave",
    icon: "🪓",
    name: "Cleave",
    description: "Berserkers' Overflow carries in full: no halving, no cap.",
    category: "combat",
    traits: (u) => (has(u, "berserker") ? { cleave: true, cleaveFull: true } : {}),
  },
  {
    id: "thorns",
    icon: "🌵",
    name: "Thorns",
    description: "Guards and Bulwarks reflect 2 damage to whoever hits them.",
    category: "combat",
    rarity: "gold",
    traits: (u) => (has(u, "tank") ? { thorns: 2 } : {}),
  },
  {
    id: "lifesteal",
    icon: "🦇",
    name: "Lifesteal",
    description: "Skirmishers heal for all the damage they deal.",
    category: "combat",
    traits: (u) => (has(u, "skirmisher") ? { lifesteal: 1 } : {}),
  },
  {
    id: "shield-wall",
    icon: "🚧",
    name: "Shield wall",
    units: ["guard", "bulwark"],
    description:
      "The unit leading your row when the round starts takes 1 less damage per hit, plus 1 less per Guard or Bulwark behind it.",
    category: "combat",
    traits: (_u, i, ctx) => {
      if (i !== 0) return {};
      const tanks = ctx.units.filter((x, j) => j > 0 && has(x, "tank")).length;
      return { damageReduction: 1 + tanks };
    },
  },
  {
    id: "executioner",
    icon: "⚔️",
    name: "Executioner",
    description: "All units deal +4 damage to targets below half health.",
    category: "combat",
    traits: () => ({ executioner: 4 }),
  },
  {
    id: "last-breath",
    icon: "💨",
    name: "Last breath",
    description:
      "Your first fallen unit each round strikes the enemy front for 2 damage as it falls.",
    category: "combat",
    // Retired 2026-10-20: taken 5% of the time.
    retired: true,
    traits: () => ({ lastBreath: true }),
  },

  // --- Squire line ---
  {
    id: "squires-drill",
    icon: "🏋️",
    name: "Squire's drill",
    description: "+2 health to all Squires and +1 attack/+2 health to all Knights.",
    category: "class",
    units: ["squire", "knight"],
    effect: (u) => (has(u, "squire") ? { hp: 2 } : has(u, "knight") ? { atk: 1, hp: 2 } : {}),
  },
  {
    id: "early-knighthood",
    icon: "⚜️",
    name: "Early knighthood",
    description: `Squires are knighted at level ${KNIGHT_LEVEL - 1} instead of ${KNIGHT_LEVEL}.`,
    category: "class",
    units: ["squire", "knight"],
  },
  {
    id: "knights-oath",
    icon: "🐴",
    name: "Knight's oath",
    description: "While you have a Knight, all your other units gain +1 attack.",
    category: "synergy",
    units: ["knight", "squire"],
    effect: (u, _i, ctx) =>
      !has(u, "knight") && countClass(ctx.units, "knight") > 0 ? { atk: 1 } : {},
  },

  // --- Rare: offered from the second upgrade round ---
  {
    id: "bastion",
    icon: "🏯",
    name: "Bastion",
    description: "Guards, Bulwarks, Knights and Sentinels take 1 less damage per hit.",
    category: "combat",
    rarity: "gold",
    units: ["guard", "bulwark", "knight", "sentinel"],
    traits: (u) => (has(u, "tank") || has(u, "knight") || has(u, "sentinel") ? { damageReduction: 1 } : {}),
  },
  {
    id: "bloodthirst",
    icon: "🍷",
    name: "Bloodthirst",
    description: "Strikers and Berserkers heal for half the damage they deal.",
    category: "combat",
    rarity: "gold",
    traits: (u) => (has(u, "aggro") ? { lifesteal: 0.5 } : {}),
  },
  {
    id: "spearwall",
    icon: "🔱",
    name: "Spearwall",
    description: "The unit leading your row when the round starts reflects 3 damage when hit and takes 1 less damage per hit.",
    category: "combat",
    rarity: "gold",
    traits: (_u, i) => (i === 0 ? { thorns: 3, damageReduction: 1 } : {}),
  },
  {
    id: "war-chest",
    icon: "🪙",
    name: "War chest",
    description: "Winning a round deals 8 extra damage and heals you 6 HP.",
    category: "strategy",
    rarity: "gold",
    mods: { bounty: 8 },
    healOnWin: 6,
  },

  // --- Epic: offered from the third upgrade round ---
  {
    id: "legion",
    icon: "🦅",
    name: "Legion",
    description: "+1 attack and +1 health to every unit.",
    category: "global",
    rarity: "prismatic",
    // Every unit again (1.8.0, the user's call). From 1.6 to 1.7 it was only
    // the row's most common class, after every unit measured 58% (as a
    // common) and 83% for real players.
    effect: () => ({ atk: 1, hp: 1 }),
  },
  {
    id: "champion",
    icon: "🏆",
    name: "Champion",
    description: "The unit leading your row when each round starts gains +3 attack and +5 health.",
    category: "global",
    rarity: "prismatic",
    // No first strike: on the front unit it decided nearly every match (88%).
    effect: (_u, i) => (i === 0 ? { atk: 3, hp: 5 } : {}),
  },
  {
    id: "unbreakable",
    icon: "🗿",
    name: "Unbreakable",
    description: "Every unit has at least 1 armour (takes 1 less damage per hit). Doesn't add to armour a unit already has.",
    category: "combat",
    rarity: "prismatic",
    // Was +1 armour on top of everything: Knight + Bastion + Unbreakable took
    // 3 less per hit (real players 86%, n=35). Now a floor.
    traits: () => ({ minArmour: 1 }),
  },

  // --- Strategy ---
  {
    id: "reinforcements",
    icon: "📣",
    name: "Reinforcements",
    description: "One extra slot in your row (6 instead of 5), and +1 health to all units.",
    category: "strategy",
    effect: () => ({ hp: 1 }),
    mods: { capacity: 6 },
    // Retired 2026-10-16: units reaching the level cap open slots instead.
    retired: true,
  },
  {
    id: "scout",
    icon: "🔭",
    name: "Scout",
    description: "One extra unit-offer reroll every round.",
    category: "strategy",
  },
  {
    id: "fusion",
    icon: "⚗️",
    name: "Fusion",
    description: "Merges grant 60% of the absorbed unit's stats instead of 50% (Squire merges keep their own escalating gains).",
    category: "strategy",
  },
  {
    id: "veteran",
    icon: "🎖️",
    name: "Veteran",
    description: "Units that didn't fight this round gain +3 health permanently.",
    category: "strategy",
  },
  {
    id: "field-medic",
    icon: "🩹",
    name: "Field medic",
    description: "Each round you win, recover 14 HP (up to your starting HP).",
    category: "strategy",
    healOnWin: 14,
  },
  {
    id: "bounty",
    icon: "💰",
    name: "Bounty",
    description: "Winning a round deals 4 extra damage.",
    category: "strategy",
    // Retired 2026-10-20: taken 6% of the time; a weaker War chest.
    retired: true,
    mods: { bounty: 4 },
  },

  // --- Second wave: back-row and endgame play ---
  {
    id: "holdout",
    icon: "🪨",
    name: "Holdout",
    description: "While it's your last unit standing, it takes 2 less damage per hit.",
    category: "combat",
    mods: { holdout: 2 },
  },
  {
    id: "full-ranks",
    icon: "🎌",
    name: "Full ranks",
    description: "If every slot in your row is filled when the round starts, all units gain +1 attack.",
    category: "global",
    rarity: "gold",
    effect: (_u, _i, ctx) => (ctx.units.length >= ctx.capacity ? { atk: 1 } : {}),
  },
  {
    id: "tactician",
    icon: "🧭",
    name: "Tactician",
    description: "Upgrade choices show 4 options instead of 3.",
    category: "strategy",
    rarity: "gold",
  },
  {
    id: "last-light",
    icon: "🕯️",
    name: "Last light",
    description: "When only one of your units is left standing, it gains +2 attack for every ally that fell this round.",
    category: "combat",
    rarity: "gold",
    mods: { lastLight: 2 },
  },
  {
    id: "sabotage",
    icon: "🪤",
    name: "Sabotage",
    description: "The enemy's front unit loses 4 attack at the start of each round.",
    category: "strategy",
    rarity: "prismatic",
  },
  {
    // The one-unit build: everything goes into a single unit with no level
    // cap. `refreshForRound` trims the row to its best unit; `uncapped` lets
    // any type merge into it (else it would only grow on the rare matching
    // card) and lifts the cap. Capacity 1 overrides Reinforcements.
    id: "ascendant",
    icon: "🌟",
    name: "Ascendant",
    description:
      "Your row holds one unit: your strongest fighter (attack × health; a support unit only if there's nothing else) stays and the rest leave. It has no level cap, and every unit you pick merges into it.",
    category: "strategy",
    rarity: "prismatic",
    mods: { capacity: 1, uncapped: true },
    // Retired 2026-10-16 until it's had more testing.
    retired: true,
    // One unit: no extra slots, no unit types to mix, no allies to fall or to
    // count, no Knight-and-others, and the champion always fights.
    excludes: ["reinforcements", "mixed-formation", "united-front", "last-light", "knights-oath", "veteran"],
    effect: () => ({ atk: 1, hp: 3 }),
  },
  {
    id: "living-fortress",
    icon: "⛰️",
    name: "Living fortress",
    units: ["bulwark"],
    description: "Bulwarks' Fortify works even if the Bulwark falls, so every Bulwark hardens every round.",
    category: "class",
    rarity: "prismatic",
  },
  // --- Third wave: an upgrade or two for every unit (2026-10-14) ---
  // Lancer, the four supports and the Skirmisher had none built around them.
  // Each one leans on the unit's own ability; the rares echo its Mastery, so
  // a mastered unit stacks with them rather than wasting the pick.
  {
    id: "long-reach",
    icon: "🎣",
    name: "Long reach",
    description: "Lancers' Impale deals +3 damage.",
    category: "class",
    traits: (u) => (has(u, "lancer") ? { pierce: 3 } : {}),
  },
  {
    id: "skewer",
    icon: "🍢",
    name: "Skewer",
    description: "Lancers' Impale reaches one unit deeper.",
    category: "combat",
    rarity: "gold",
    traits: (u) => (has(u, "lancer") ? { pierceDeeper: 1 } : {}),
  },
  {
    id: "war-horn",
    icon: "🎺",
    name: "War horn",
    description: "Heralds' Rally gives +3 more attack.",
    category: "class",
    traits: (u) => (has(u, "herald") ? { rally: 3 } : {}),
  },
  {
    id: "banner-of-hope",
    icon: "🏳️",
    name: "Banner of hope",
    description: "Heralds' Rally also gives the unit it lands on that much health.",
    category: "class",
    rarity: "gold",
    units: ["herald"],
    // Applied after every upgrade (`applyAugments`), so "that much" is the
    // whole Rally: War horn's +3 and the match's level cap included.
  },
  {
    id: "triage",
    icon: "🩺",
    name: "Triage",
    description: "Medics' Mend heals 2 more, and once more each round.",
    category: "class",
    traits: (u) => (has(u, "medic") ? { mend: 2, mendMore: 1 } : {}),
  },
  {
    id: "stimulant",
    icon: "💉",
    name: "Stimulant",
    description: "Each time a Medic mends, the unit it heals also gains +2 attack for the round.",
    category: "combat",
    rarity: "gold",
    traits: (u) => (has(u, "medic") ? { mendAtk: 2 } : {}),
  },
  {
    id: "thick-barrier",
    icon: "🧊",
    name: "Thick barrier",
    description: "Wardens' Barrier shields 4 more.",
    category: "class",
    traits: (u) => (has(u, "warden") ? { barrier: 4 } : {}),
  },
  {
    id: "aegis",
    icon: "🔮",
    name: "Aegis",
    description: "Wardens shield themselves with their Barrier too, so a Warden that steps up to the front is protected, and Barrier shields 2 more.",
    category: "combat",
    rarity: "gold",
    traits: (u) => (has(u, "warden") ? { barrierSelf: true, barrier: 2 } : {}),
  },
  {
    id: "devotion",
    icon: "🙏",
    name: "Devotion",
    description: "+6 health to all Acolytes, so Lifebond gives more.",
    category: "class",
    effect: (u) => (has(u, "acolyte") ? { hp: 6 } : {}),
  },
  {
    id: "blessing",
    icon: "😇",
    name: "Blessing",
    description: "Acolytes' Lifebond also gives the unit it lands on +3 attack.",
    category: "class",
    rarity: "gold",
    traits: (u) => (has(u, "acolyte") ? { lifebondAtk: 3 } : {}),
  },
  {
    id: "counterstrike",
    icon: "🤺",
    name: "Counterstrike",
    description: "Skirmishers' Riposte deals +3 damage.",
    category: "combat",
    // Retired 2026-10-20: taken 4% of the time. Duelist replaces it.
    retired: true,
    traits: (u) => (has(u, "skirmisher") ? { riposte: 3 } : {}),
  },
  {
    id: "choir",
    icon: "🎶",
    name: "Choir",
    description: "+1 attack and +3 health to all Support units (Herald, Medic, Warden, Acolyte, Beacon).",
    category: "class",
    rarity: "gold",
    effect: (u) => (has(u, "support") ? { atk: 1, hp: 3 } : {}),
  },

  // --- 1.7.0: for the Skirmisher, Beacon and Sentinel ---
  {
    id: "duelist",
    icon: "🥋",
    name: "Duelist",
    description: "Skirmishers gain +1 attack and +2 health, and their Riposte deals +2 damage.",
    category: "class",
    effect: (u) => (has(u, "skirmisher") ? { atk: 1, hp: 2 } : {}),
    traits: (u) => (has(u, "skirmisher") ? { riposte: 2 } : {}),
  },
  {
    id: "signal-fire",
    icon: "🏮",
    name: "Signal fire",
    description: "Beacons relay at ×0.5 more (×2 at level 1).",
    category: "class",
    traits: (u) => (has(u, "beacon") ? { relay: 50 } : {}),
  },
  {
    id: "vengeance",
    icon: "⚖️",
    name: "Vengeance",
    description: "Sentinels send back 20% more of each blow (60% at level 1: a 10-damage hit sends 6 back).",
    category: "class",
    traits: (u) => (has(u, "sentinel") ? { reflect: 20 } : {}),
  },

  // --- 1.7.0: more rares and epics (there were 38 commons to 5 epics) ---
  {
    id: "phalanx",
    icon: "🏛️",
    name: "Phalanx",
    description: "The first two units in your row take 1 less damage per hit.",
    category: "combat",
    rarity: "gold",
    traits: (_u, i) => (i < 2 ? { damageReduction: 1 } : {}),
  },
  {
    id: "undying",
    icon: "♾️",
    name: "Undying",
    description: "The unit at the back of your row survives the first blow that would kill it each round, on 1 health.",
    category: "combat",
    rarity: "gold",
    // On the front unit it measured 61%: an extra life every round where it matters most.
    traits: (_u, i, ctx) => (i === ctx.units.length - 1 ? { endure: true } : {}),
  },
  {
    id: "twin-fangs",
    icon: "🐺",
    name: "Twin fangs",
    description: "Strikers and Berserkers gain +1 attack and +1 health for each other Striker or Berserker in your row (up to +3).",
    category: "synergy",
    rarity: "gold",
    effect: (u, _i, ctx) => {
      if (!has(u, "aggro")) return {};
      const n = Math.min(3, countClass(ctx.units, "aggro") - 1);
      return { atk: n, hp: n };
    },
  },
  {
    id: "sanctum",
    icon: "⛪",
    name: "Sanctum",
    description: "Every support ability counts twice (Rally, Mend, Barrier, Lifebond), as if your row were all Support. Doesn't stack with that bonus.",
    category: "synergy",
    rarity: "prismatic",
    units: ["herald", "medic", "warden", "acolyte"],
  },
  {
    id: "iron-curtain",
    icon: "⛓️",
    name: "Iron curtain",
    description: "Every unit starts each round with a shield of a tenth of its health (at least 2), so it keeps up as your units grow.",
    category: "combat",
    rarity: "prismatic",
    // A flat 3 was worth a lot at level 1 and nothing at level 10; a quarter
    // of health measured 71% (sim, --aug=random), an eighth 59-60%.
    traits: (u) => ({ shield: Math.max(2, Math.ceil(u.baseMaxHp / 10)) }),
  },
  {
    id: "colossus",
    icon: "🗻",
    name: "Colossus",
    description: "Your highest-level unit (the front-most on a tie) gains +3 attack and +6 health.",
    category: "global",
    rarity: "prismatic",
    // +4/+8 measured 58%.
    effect: (u, _i, ctx) => (u === colossusOf(ctx.units) ? { atk: 3, hp: 6 } : {}),
  },
  {
    id: "warlord",
    icon: "🦁",
    name: "Warlord",
    description: "Every unit gains +1 attack for every 4 upgrades you hold, this one included (up to +2).",
    category: "global",
    rarity: "prismatic",
    // Per 2 up to +3 measured 68%; per 3 up to +2, 60-61%.
    effect: (_u, _i, ctx) => ({ atk: Math.min(2, Math.floor(ctx.upgrades / 4)) }),
  },
  {
    id: "golden-age",
    icon: "🌅",
    name: "Golden age",
    description: "+1 attack and +4 health to all your units.",
    category: "global",
    rarity: "prismatic",
    // +2/+4 measured 65% among prismatics.
    effect: () => ({ atk: 1, hp: 4 }),
  },

  // --- 1.8.0: gold and prismatic brought up to silver's numbers ---
  {
    id: "bloodbond",
    icon: "🧛",
    name: "Bloodbond",
    description: "The unit leading your row when the round starts heals for half the damage it deals.",
    category: "combat",
    rarity: "gold",
    traits: (_u, i) => (i === 0 ? { lifesteal: 0.5 } : {}),
  },
  {
    id: "spiked-line",
    icon: "🦔",
    name: "Spiked line",
    description: "Every unit reflects 1 damage to whoever hits it.",
    category: "combat",
    rarity: "gold",
    traits: () => ({ thorns: 1 }),
  },
  {
    id: "opening-salvo",
    icon: "💥",
    name: "Opening salvo",
    description: "Every unit's first attack each round deals +3 damage.",
    category: "combat",
    rarity: "gold",
    traits: () => ({ openingBonus: 3 }),
  },
  {
    id: "rear-guard",
    icon: "🐢",
    name: "Rear guard",
    description: "The unit at the back of your row gains +4 attack and +8 health.",
    category: "global",
    rarity: "gold",
    effect: (_u, i, ctx) => (i === ctx.units.length - 1 ? { atk: 4, hp: 8 } : {}),
  },
  {
    id: "second-line",
    icon: "🥈",
    name: "Second line",
    description: "The second unit in your row gains +3 attack and +6 health.",
    category: "global",
    rarity: "gold",
    effect: (_u, i) => (i === 1 ? { atk: 3, hp: 6 } : {}),
  },
  {
    id: "mantis-shrimp",
    icon: "🦐",
    name: "Mantis shrimp",
    description:
      "The unit leading your row when the round starts punches first in the round's opening exchange, and that first blow deals +3.",
    category: "combat",
    rarity: "gold",
    // +4 measured 61% among golds, +2 55%.
    traits: (_u, i) => (i === 0 ? { firstStrike: true, openingBonus: 3 } : {}),
  },
  {
    id: "drill-sergeant",
    icon: "🪃",
    name: "Drill sergeant",
    description: "Choose one of your units: it gains 2 levels (up to the cap) and +2 attack, permanently.",
    category: "strategy",
    rarity: "gold",
    target: {
      verb: "gains 2 levels and +2 attack",
      can: () => true,
      apply: (u, c) => {
        levelUp(u, 2, c);
        grant(c.state, u, c.id, { atk: 2 });
      },
      aiScore: (u) => u.merges + (isSupport(u) ? 0 : 3),
    },
  },
  {
    id: "juggernaut",
    icon: "🦏",
    name: "Juggernaut",
    description: "Choose one of your units: +5 attack and +10 health, permanently.",
    category: "combat",
    rarity: "prismatic",
    target: {
      verb: "gains +5 attack and +10 health for good",
      can: () => true,
      apply: (u, c) => grant(c.state, u, c.id, { atk: 5, hp: 10 }),
      aiScore: (u) => (isSupport(u) ? 0 : power(u)),
    },
  },
  {
    id: "heroic-legion",
    icon: "🏇",
    name: "Heroic legion",
    description: "Choose one of your units: it and every other unit of its type gain 2 levels.",
    category: "strategy",
    rarity: "prismatic",
    target: {
      verb: "gains 2 levels, with every unit of its type",
      can: belowCap,
      apply: (u, c) => {
        for (const v of sideUnits(c.board, c.side)) if (v.key === u.key) levelUp(v, 2, c);
      },
      // The type with the most units, fighters first.
      aiScore: (u, b, s) => sideUnits(b, s).filter((v) => v.key === u.key).length * 10 + (isSupport(u) ? 0 : 5) + u.merges,
    },
  },
  {
    id: "vanguards-vow",
    icon: "🔆",
    name: "Vanguard's vow",
    description:
      "The unit leading your row when the round starts survives its first killing blow each round on 1 health, and takes 1 less damage per hit.",
    category: "combat",
    rarity: "prismatic",
    traits: (_u, i) => (i === 0 ? { endure: true, damageReduction: 1 } : {}),
  },
  {
    id: "hawk-eye",
    icon: "👁️",
    name: "Hawk eye",
    description: "All your units gain +2 attack, and their blows can't be dodged.",
    category: "global",
    rarity: "prismatic",
    effect: () => ({ atk: 2 }),
    traits: () => ({ trueStrike: true }),
  },
  {
    id: "blood-moon",
    icon: "🌕",
    name: "Blood moon",
    description: "All your units heal for a quarter of the damage they deal.",
    category: "combat",
    rarity: "prismatic",
    // Half measured 72% among prismatics.
    traits: () => ({ lifesteal: 0.25 }),
  },
  {
    id: "avalanche",
    icon: "🏔️",
    name: "Avalanche",
    description: "All your units' overkill carries on, in full, to the next enemy.",
    category: "combat",
    rarity: "prismatic",
    // Half of it, up to 3 (a Berserker's Overflow) measured 38.5%.
    traits: () => ({ cleave: true, cleaveFull: true }),
  },
  {
    id: "mirror-shield",
    icon: "🪩",
    name: "Mirror shield",
    description: "Every unit reflects 2 damage to whoever hits it.",
    category: "combat",
    rarity: "prismatic",
    traits: () => ({ thorns: 2 }),
  },
  {
    id: "phoenix",
    icon: "🌋",
    name: "Phoenix",
    description: "The first two units in your row each survive their first killing blow each round, on 1 health.",
    category: "combat",
    rarity: "prismatic",
    traits: (_u, i) => (i < 2 ? { endure: true } : {}),
  },
  {
    id: "ironclad",
    icon: "⚙️",
    name: "Ironclad",
    description: "Every unit takes 1 less damage per hit (a hit still deals at least 1).",
    category: "combat",
    rarity: "prismatic",
    traits: () => ({ damageReduction: 1 }),
  },
  {
    id: "golden-fleece",
    icon: "🐑",
    name: "Golden fleece",
    description: "Each round you win deals 10 extra damage and heals you 25 HP (up to your starting HP).",
    category: "strategy",
    rarity: "prismatic",
    // 6 and 15 measured 40.5%.
    mods: { bounty: 10 },
    healOnWin: 25,
  },

  // --- Choose a unit: taking one asks which of your units it lands on ---
  {
    id: "whetstone",
    icon: "🔨",
    name: "Whetstone",
    description: "Choose one of your units: +2 attack, permanently.",
    category: "combat",
    target: {
      verb: "gains +2 attack for good",
      can: () => true,
      apply: (u, c) => grant(c.state, u, c.id, { atk: 2 }),
      aiScore: (u) => (isSupport(u) ? 0 : power(u)),
    },
  },
  {
    id: "iron-skin",
    icon: "🦾",
    name: "Iron skin",
    description: "Choose one of your units: +5 health, permanently.",
    category: "combat",
    target: {
      verb: "gains +5 health for good",
      can: () => true,
      apply: (u, c) => grant(c.state, u, c.id, { hp: 5 }),
      aiScore: (u) => (isSupport(u) ? 0 : power(u)),
    },
  },
  {
    id: "field-promotion",
    icon: "🎓",
    name: "Field promotion",
    description: "Choose one of your units below the level cap: it gains 2 levels.",
    category: "strategy",
    target: {
      verb: "gains 2 levels",
      can: belowCap,
      apply: (u, c) => void levelUp(u, 2, c),
      // Closest to its Mastery, fighters first.
      aiScore: (u) => u.merges + (isSupport(u) ? 0 : 3),
    },
  },
  {
    id: "commission",
    icon: "📜",
    name: "Battlefield commission",
    description: "Choose one of your units below the level cap: it gains 3 levels.",
    category: "strategy",
    rarity: "gold",
    target: {
      verb: "gains 3 levels",
      can: belowCap,
      apply: (u, c) => void levelUp(u, 3, c),
      aiScore: (u) => u.merges + (isSupport(u) ? 0 : 3),
    },
  },
  {
    id: "heros-mark",
    icon: "💠",
    name: "Hero's mark",
    description: "Choose one of your units: +3 attack and +6 health, permanently.",
    category: "combat",
    rarity: "gold",
    target: {
      verb: "gains +3 attack and +6 health for good",
      can: () => true,
      apply: (u, c) => grant(c.state, u, c.id, { atk: 3, hp: 6 }),
      aiScore: (u) => (isSupport(u) ? 0 : power(u)),
    },
  },
  {
    id: "apotheosis",
    icon: "✨",
    name: "Apotheosis",
    description: "Choose one of your units below the level cap: it gains 5 levels.",
    category: "strategy",
    rarity: "prismatic",
    target: {
      verb: "gains 5 levels",
      can: belowCap,
      // Straight to the cap measured 72% among prismatics.
      apply: (u, c) => void levelUp(u, 5, c),
      // The most levels gained, on a fighter.
      aiScore: (u, b, s) => (isSupport(u) ? 0 : 20) + Math.min(30, mergeCapFor(b, s)) - u.merges,
    },
  },
  {
    id: "mirror-image",
    icon: "🪞",
    name: "Mirror image",
    description: "Choose one of your units: a copy of it, at the same level, joins your row. Needs an empty slot.",
    category: "strategy",
    rarity: "prismatic",
    target: {
      verb: "is copied into an empty slot",
      can: (_u, b, s) => !!firstEmptySpot(b, s),
      apply: (u, c) => {
        const spot = firstEmptySpot(c.board, c.side);
        if (!spot) return;
        const copy: Unit = { ...JSON.parse(JSON.stringify(u)), id: makeUnit(u.key, c.side).id };
        place(c.board, c.side, spot.lane, spot.spot, copy);
      },
      aiScore: (u) => u.merges * 10 + (isSupport(u) ? 0 : 5),
    },
  },
];

/** Colossus's unit: the most merged, front-most on a tie. */
function colossusOf(units: Unit[]): Unit | undefined {
  let best: Unit | undefined;
  for (const u of units) if (!best || u.merges > best.merges) best = u;
  return best;
}

/** Attack the enemy front loses to Sabotage. */
export const SABOTAGE_ATK = 4;

const BY_ID = new Map(AUGMENTS.map((a) => [a.id, a]));
/** The upgrades in play: everything but the retired ones. Offers and lists use this. */
export const OFFERED_AUGMENTS = AUGMENTS.filter((a) => !a.retired);

export function getAugment(id: string): AugmentDef | undefined {
  return BY_ID.get(id);
}

/** Sample `n` augments the player doesn't already hold. */
export const rarityOf = (a: AugmentDef): Rarity => a.rarity ?? "silver";

/** The side's board, so choose-a-unit upgrades are only offered with a unit to land on. */
export interface OfferContext {
  board: Board;
  side: Side;
  /** The upgrades this side has unlocked (game/progression.ts); absent = all of them (the CPU). */
  allowed?: ReadonlySet<string>;
}

/** Upgrades `state` could be dealt now, of `rarity`, leaving out `skip`. */
function offerPool(state: AugmentState, rarity: Rarity, ctx?: OfferContext, skip: string[] = []): AugmentDef[] {
  const excluded = new Set(state.active.flatMap((id) => getAugment(id)?.excludes ?? []));
  const units = ctx ? sideUnits(ctx.board, ctx.side) : [];
  return OFFERED_AUGMENTS.filter(
    (a) =>
      rarityOf(a) === rarity &&
      !state.active.includes(a.id) &&
      !excluded.has(a.id) &&
      !skip.includes(a.id) &&
      (!ctx?.allowed || ctx.allowed.has(a.id)) &&
      (!a.target || !ctx || units.some((u) => a.target!.can(u, ctx.board, ctx.side))),
  );
}

/**
 * Deal `n` upgrades of `rarity` the side doesn't hold. Should that rarity run
 * dry (a long match, most of them held), the rest come from the other
 * rarities, nearest first.
 */
export function offerAugments(state: AugmentState, n: number, rarity: Rarity, ctx?: OfferContext): AugmentDef[] {
  const at = RARITIES.indexOf(rarity);
  const order = [...RARITIES].sort((a, b) => Math.abs(RARITIES.indexOf(a) - at) - Math.abs(RARITIES.indexOf(b) - at));
  const out: AugmentDef[] = [];
  for (const r of order) {
    const pool = offerPool(state, r, ctx, out.map((a) => a.id));
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/**
 * Reroll one card: another upgrade of the same rarity that isn't on the table
 * and hasn't been shown this choice (`seen`). Null when there's none left.
 */
export function rerollAugment(state: AugmentState, card: AugmentDef, seen: string[], ctx?: OfferContext): AugmentDef | null {
  const pool = offerPool(state, rarityOf(card), ctx, seen);
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/**
 * Land a choose-a-unit upgrade (already taken) on one of the side's units.
 * Returns false, changing nothing, if it can't land there.
 */
export function applyTarget(state: AugmentState, id: string, board: Board, side: Side, unitId: string): boolean {
  const def = getAugment(id);
  const unit = sideUnits(board, side).find((u) => u.id === unitId);
  if (!def?.target || !unit || !def.target.can(unit, board, side)) return false;
  def.target.apply(unit, { state, board, side, id });
  return true;
}

/** The unit the AI lands a choose-a-unit upgrade on, or null when none can take it. */
export function aiTarget(id: string, board: Board, side: Side): Unit | null {
  const t = getAugment(id)?.target;
  if (!t) return null;
  let best: Unit | null = null;
  let bestScore = -Infinity;
  for (const u of sideUnits(board, side)) {
    if (!t.can(u, board, side)) continue;
    const sc = t.aiScore(u, board, side);
    if (sc > bestScore) [best, bestScore] = [u, sc];
  }
  return best;
}

/** Take an augment. Returns the max-HP cost to apply to the player's pool. */
export function takeAugment(
  state: AugmentState,
  id: string,
  units: Unit[],
  startHp = 200,
): number {
  const def = getAugment(id);
  if (!def || state.active.includes(id)) return 0;
  state.active.push(id);
  def.onPick?.(state, units);
  return hpCostOf(def, startHp);
}

/** What an augment costs from the pool at pick time, for a match started at `startHp`. */
export function hpCostOf(def: AugmentDef, startHp = 200): number {
  return def.hpCostShare ? Math.round(def.hpCostShare * startHp) : 0;
}

/**
 * Recompute every unit's effective stats from base + active augments, then heal
 * to full for the coming round. Call at the start of each round, after new
 * units are placed, so newly added units get existing augments too.
 */
export function applyAugments(
  units: Unit[],
  state: AugmentState,
  ownHp: number,
  enemyUnitCount: number,
  capacity = 5,
  /** This side's full-row synergy this round (`synergyOf`), if any. */
  synergy: Archetype | null = null,
  startHp = 200,
  /** The match's level cap, where abilities take their Mastery form. */
  levelCap = MAX_LEVEL,
): void {
  const ctx: AugmentContext = {
    units,
    ownHp,
    enemyUnitCount,
    capacity,
    startHp,
    momentum: state.momentum,
    rally: state.rally,
    kills: state.kills ?? 0,
    upgrades: state.active.length,
  };
  const defs = state.active.map(getAugment).filter((d): d is AugmentDef => !!d);

  units.forEach((unit, index) => {
    let atk = unit.baseAtk;
    let hp = unit.baseMaxHp;
    // Rebuilt from scratch each round: a conditional augment that isn't
    // currently firing (Overwhelm while behind on units, Momentum at 0 stacks)
    // must drop its badge, not keep it from last round.
    const auras: string[] = [];
    const details: AuraDetail[] = [];
    // Innate keywords first (the Knight's armour), so augments add to them
    // rather than the per-round rebuild wiping them out.
    const traits: UnitTraits = innateTraits(unit.key, unit.merges, levelCap);
    for (const def of defs) {
      const d = def.effect?.(unit, index, ctx) ?? {};
      atk += d.atk ?? 0;
      hp += d.hp ?? 0;
      // Only badge an augment that's actually moving a number right now.
      if ((d.atk ?? 0) !== 0 || (d.hp ?? 0) !== 0) auras.push(def.id);
      const t = def.traits?.(unit, index, ctx);
      const hasT = !!t && Object.keys(t).length > 0;
      if (t) {
        mergeTraits(traits, t);
        // Badge an augment that grants this unit a keyword it contributes.
        if (hasT && !auras.includes(def.id)) auras.push(def.id);
      }
      if ((d.atk ?? 0) !== 0 || (d.hp ?? 0) !== 0 || hasT) {
        details.push({ id: def.id, atk: d.atk ?? 0, hp: d.hp ?? 0, ...(hasT ? { traits: t } : {}) });
      }
    }
    const grant = state.grants[unit.id];
    if (grant) {
      atk += grant.atk ?? 0;
      hp += grant.hp ?? 0;
      for (const id of grant.from) if (!auras.includes(id)) auras.push(id);
      // A grant pins to the unit rather than an augment; credit its sources.
      details.push({ id: grant.from.join("+") || "grant", atk: grant.atk ?? 0, hp: grant.hp ?? 0 });
    }
    unit.atk = Math.max(0, atk);
    unit.maxHp = Math.max(1, hp);
    unit.hp = unit.maxHp; // units persist and return to full health each round
    unit.auras = auras;
    unit.traits = traits;
    unit.auraDetails = details;
    delete unit.shieldLeft; // a fresh round, a fresh shield
  });

  // Banner of hope: a Herald's Rally also gives that much health. After the
  // loop, so it reads the finished Rally (War horn adds to it, whichever was
  // taken first), and before any doubling, which then doubles both.
  if (state.active.includes("banner-of-hope")) {
    for (const u of units) {
      const rally = u.traits?.rally ?? 0;
      if (!has(u, "herald") || rally <= 0) continue;
      u.traits!.rallyHp = (u.traits!.rallyHp ?? 0) + rally;
      u.auraDetails = [...(u.auraDetails ?? []), { id: "banner-of-hope", atk: 0, hp: 0, traits: { rallyHp: rally } }];
      if (!u.auras.includes("banner-of-hope")) u.auras.push("banner-of-hope");
    }
  }

  // Sanctum: Sanctuary's doubling without the full row (and not on top of it).
  if (synergy !== "support" && state.active.includes("sanctum")) {
    for (const u of units) {
      const gained: UnitTraits = {};
      doubleSupport(u.traits ?? (u.traits = {}), gained);
      if (Object.keys(gained).length === 0) continue;
      const det = u.auraDetails?.find((d) => d.id === "sanctum");
      if (det) det.traits = { ...det.traits, ...gained };
      else u.auraDetails = [...(u.auraDetails ?? []), { id: "sanctum", atk: 0, hp: 0, traits: gained }];
      if (!u.auras.includes("sanctum")) u.auras.push("sanctum");
    }
  }

  // Full-row synergy: a row of one class, badged and itemised like an augment.
  // Tuned two ways. Head to head (same row, synergy on vs off, one round vs
  // random rows): Assault +6-7 points; Sanctuary (support doubled) +5 at level
  // 2 and +28 at level 6, lifting a levelled all-Support row from 27% to 55%
  // (doubling plus a front that survives a lethal blow was +50). At match level
  // (`pnpm sim --aug=random`) Iron Line holders won 45% at +2 health, 49% at
  // +3, 56% at +4: all-Defense rows deal little damage, so it needs the most.
  if (synergy) {
    const syn = SYNERGIES[synergy];
    const id = `syn-${synergy}`;
    units.forEach((u) => {
      const t = u.traits ?? (u.traits = {});
      let atk = 0;
      let hp = 0;
      const gained: UnitTraits = {};
      if (synergy === "attack") {
        // Overflow for everyone: overkill carries on to the next enemy (half,
        // up to 3). Berserkers keep their own, bigger Overflow.
        atk = 2;
        if (!t.cleave) {
          t.cleave = gained.cleave = true;
          t.cleaveCap = 3;
        }
      } else if (synergy === "defense") {
        // A shield, not health: it soaks the first blows each round and shows
        // as the shield bar, so the line visibly holds.
        t.shield = (t.shield ?? 0) + IRON_LINE_SHIELD;
        gained.shield = IRON_LINE_SHIELD;
      } else {
        // Sanctuary: every support ability counts twice.
        doubleSupport(t, gained);
      }
      u.atk += atk;
      u.maxHp += hp;
      u.hp = u.maxHp;
      if (!u.auras.includes(id)) u.auras.push(id);
      u.auraDetails = [...(u.auraDetails ?? []), { id, label: `${syn.icon} ${syn.name}`, atk, hp, traits: gained }];
    });
  }

  // Drill: a maxed row's unspent picks, as attack for this round only.
  const drill = state.drill ?? 0;
  if (drill > 0) {
    for (const u of units) {
      u.atk += drill;
      if (!u.auras.includes("drill")) u.auras.push("drill");
      u.auraDetails = [...(u.auraDetails ?? []), { id: "drill", label: "🎯 Drill", atk: drill, hp: 0 }];
    }
  }

  // Herald's Rally, Acolyte's Lifebond and Warden's Barrier happen in combat
  // as the round opens (`openingBuffs` in combat.ts), so the board shows
  // every unit at its own stats while picking.
}

/** Merge `t` into `into`: booleans OR, numbers add, lifesteal takes the max. */
/**
 * Every support ability counts twice (Sanctuary, Sanctum). `gained` gets the
 * extra, so the info card itemises what was added.
 */
function doubleSupport(t: UnitTraits, gained: UnitTraits): void {
  for (const k of ["rally", "rallyHp", "mend", "barrier", "lifebond"] as const) {
    if (t[k]) {
      gained[k] = t[k];
      t[k] = t[k]! * 2;
    }
  }
}

function mergeTraits(into: UnitTraits, t: UnitTraits): void {
  const out = into as Record<string, boolean | number | undefined>;
  for (const [k, v] of Object.entries(t)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "boolean") out[k] = true;
    // Structured abilities (death buffs, growth) aren't stacked — the latest wins.
    else if (typeof v === "object") (out as Record<string, unknown>)[k] = v;
    else if (k === "lifesteal") out[k] = Math.max((out[k] as number) ?? 0, v);
    else out[k] = ((out[k] as number) ?? 0) + v;
  }
}

/** Count this side's Berserker deaths in a round, for Berserker's Rally. */
export function countBerserkerDeaths(
  events: { type: string; key?: string; side?: Side }[],
  side: Side,
): number {
  return events.filter(
    (e) => e.type === "death" && e.side === side && e.key === "berserker",
  ).length;
}

/**
 * Move a grant from one unit to another (e.g., when merging). If the target
 * already holds a grant, combine the deltas and union the `from` arrays.
 * No-op if the source has no grant.
 */
export function transferGrant(state: AugmentState, fromId: string, toId: string): void {
  const sourceGrant = state.grants[fromId];
  if (!sourceGrant) return;

  const targetGrant = state.grants[toId];
  if (targetGrant) {
    // Combine deltas and union the from arrays
    targetGrant.atk = (targetGrant.atk ?? 0) + (sourceGrant.atk ?? 0);
    targetGrant.hp = (targetGrant.hp ?? 0) + (sourceGrant.hp ?? 0);
    // Union from arrays without duplicates
    for (const id of sourceGrant.from) {
      if (!targetGrant.from.includes(id)) {
        targetGrant.from.push(id);
      }
    }
  } else {
    // Just copy the grant to the target
    state.grants[toId] = { ...sourceGrant };
  }

  // Delete the source grant
  delete state.grants[fromId];
}

// --- Helpers other layers call (contract; implementations may grow) ---

export function hasAugment(state: AugmentState, id: string): boolean {
  return state.active.includes(id);
}

/** Merge every held augment's `mods` into one SideMods. */
export function sideModsFor(state: AugmentState): SideMods {
  const out: SideMods = {};
  for (const id of state.active) {
    const m = getAugment(id)?.mods;
    if (!m) continue;
    if (m.bounty) out.bounty = (out.bounty ?? 0) + m.bounty;
    if (m.capacity) out.capacity = Math.max(out.capacity ?? 0, m.capacity);
    if (m.lastLight) out.lastLight = (out.lastLight ?? 0) + m.lastLight;
    if (m.holdout) out.holdout = (out.holdout ?? 0) + m.holdout;
    if (m.uncapped) out.uncapped = true;
  }
  // Ascendant's single slot wins over Reinforcements' extra one.
  if (out.uncapped) out.capacity = 1;
  return out;
}

/** Share of an absorbed unit's stats a merge grants (Fusion raises it). */
export function mergeRatioFor(state: AugmentState): number {
  return hasAugment(state, "fusion") ? 0.6 : 0.5;
}

/**
 * Unit types an augment can change, found by running its `effect`/`traits`
 * against one of each type with every condition switched on (low HP, big
 * stacks, tanks behind the front). Derived rather than hand-tagged, so the
 * "filter by unit" view can't drift from what the augments actually do.
 * An augment that touches every type — or none (strategy picks) — is general.
 */
const affectedCache = new Map<string, string[]>();
export function unitsAffectedBy(def: AugmentDef): string[] {
  if (def.units) return def.units;
  const cached = affectedCache.get(def.id);
  if (cached) return cached;
  const out = probeAffected(def);
  affectedCache.set(def.id, out);
  return out;
}

/** The probe behind unitsAffectedBy (pure, so its result is cached per augment). */
function probeAffected(def: AugmentDef): string[] {
  const units: Unit[] = UNIT_KEYS.map((key, i) => {
    const st = UNITS[key];
    return {
      id: `probe${i}`, side: "player", key, name: st.name, shape: st.shape,
      classes: [...st.classes], baseAtk: st.atk, baseMaxHp: st.maxHp, merges: 0,
      atk: st.atk, maxHp: st.maxHp, hp: st.maxHp, auras: [],
    };
  });
  const ctx: AugmentContext = { units, ownHp: 1, enemyUnitCount: 0, momentum: 99, rally: 99, kills: 99, capacity: 0, startHp: 200, upgrades: 99 };
  const hit = new Set<string>();
  units.forEach((u, i) => {
    // Front (index 0) and its real queue position, for front-only augments.
    for (const index of [0, i]) {
      const d = def.effect?.(u, index, ctx) ?? {};
      const t = def.traits?.(u, index, ctx) ?? {};
      if (d.atk || d.hp || Object.keys(t).length > 0) hit.add(u.key);
    }
  });
  return UNIT_KEYS.filter((k) => hit.has(k));
}
