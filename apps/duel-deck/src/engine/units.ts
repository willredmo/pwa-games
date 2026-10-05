import type { UnitStats, UnitTraits } from "./types";

// Unit pool — v1 first pass, straight from the tracker doc.
// Melee/front-line only: no ranged units in v1.
//
// `shape` drives the abstract/geometric theming (flat shapes, color encodes
// ownership). `classes` are the tags augments target ("+2 attack to all
// Strikers and Berserkers").

export const UNITS: Record<string, UnitStats> = {
  // Stats were scaled down ~⅓ across the board: merges and augments compound,
  // and the old numbers climbed into the 30s and 40s by mid-match.
  guard: {
    name: "Guard",
    atk: 3,
    maxHp: 6,
    shape: "square",
    classes: ["guard", "tank"],
    role: "Tanky, absorbs hits, low output",
    ability: { name: "Bodyguard", trigger: "On death", text: "The unit behind it gains +2 health for the rest of the round.", scaling: "+1 health every 2 merges" },
  },
  striker: {
    name: "Striker",
    atk: 4,
    maxHp: 4,
    shape: "triangle",
    classes: ["striker", "aggro"],
    role: "Glass cannon",
    ability: { name: "Charge", trigger: "First attack", text: "Its first attack each round deals +3 damage.", scaling: "+1 damage per merge" },
  },
  skirmisher: {
    name: "Skirmisher",
    atk: 3,
    maxHp: 2,
    shape: "diamond",
    classes: ["skirmisher"],
    role: "Balanced all-rounder",
    ability: { name: "Evasion", trigger: "Start of round", text: "Dodges the first hit it takes each round.", scaling: "When it dodges, strikes back for +1 damage every 2 merges" },
  },
  bulwark: {
    name: "Bulwark",
    atk: 1,
    maxHp: 11,
    shape: "hexagon",
    classes: ["bulwark", "tank"],
    role: "Max tank, meant to stall",
    ability: { name: "Fortify", trigger: "End of round", text: "If it survived the round, it permanently gains +1 health.", scaling: "+1 health every 2 merges" },
  },
  berserker: {
    name: "Berserker",
    atk: 5,
    maxHp: 3,
    shape: "circle",
    classes: ["berserker", "aggro"],
    role: "Highest attack, very fragile",
    ability: { name: "Overflow", trigger: "On kill", text: "Half the damage beyond a kill (up to 3) carries into the next enemy.", scaling: "Carry-over cap +1 per merge" },
  },
  // The late-game unit: the weakest body in the pool, but its merges escalate
  // (see SQUIRE_STEP) and at KNIGHT_AT merges it is promoted to a Knight.
  squire: {
    name: "Squire",
    atk: 1,
    maxHp: 3,
    shape: "shield",
    classes: ["squire"],
    role: "Weak now; every merge is bigger than the last, and 6 make a Knight",
    ability: { name: "Pass the torch", trigger: "On death", text: "The unit behind it gains +1 attack for the rest of the round.", scaling: "+1 attack every 2 merges" },
  },
  knight: {
    name: "Knight",
    atk: 0,
    maxHp: 0,
    shape: "shield",
    classes: ["knight"],
    role: "Promoted Squire: armoured, and still growing with every merge",
    ability: { name: "Armour · Last rally", trigger: "Always · On death", text: "Takes 1 less damage per hit. When it falls, all your units gain +1 attack for the rest of the round.", scaling: "Last rally +1 attack every 2 merges past knighthood" },
    offered: false,
  },
};


/** Every unit type, including ones that are earned rather than offered. */
export const UNIT_KEYS = Object.keys(UNITS);
/** Unit types that can appear in the round's offer. */
export const OFFER_KEYS = UNIT_KEYS.filter((k) => UNITS[k].offered !== false);

/**
 * Squire merges escalate instead of granting a share of the absorbed unit:
 * the n-th merge into a Squire (or the Knight it becomes) adds n × this.
 */
export const SQUIRE_STEP = { atk: 0.45, hp: 0.65 };
/** Merges at which a Squire is knighted (Early knighthood lowers it). */
export const KNIGHT_AT = 6;
/** One-off stats a Squire gains on being knighted, on top of its merges. */
export const KNIGHTING_BONUS = { atk: 1, hp: 2 };

/**
 * A Squire's stats the moment it's knighted, before augments: its printed
 * stats, each escalating merge (rounded per merge, as in board.ts), and the
 * knighting bonus. Derived so the Knight's listed stats can't drift from the
 * rules that produce it.
 */
export function knightedStats(at = KNIGHT_AT): { atk: number; hp: number } {
  let atk = UNITS.squire.atk;
  let hp = UNITS.squire.maxHp;
  for (let k = 1; k <= at; k++) {
    atk += Math.round(k * SQUIRE_STEP.atk);
    hp += Math.round(k * SQUIRE_STEP.hp);
  }
  return { atk: atk + KNIGHTING_BONUS.atk, hp: hp + KNIGHTING_BONUS.hp };
}
{
  const ks = knightedStats();
  UNITS.knight.atk = ks.atk;
  UNITS.knight.maxHp = ks.hp;
}

/**
 * Whether an incoming unit of type `incoming` merges into a unit of type
 * `target`. Like merges with like, and a Squire also merges into a Knight —
 * knighthood is where Squires keep growing, not where they stop.
 */
export function mergesInto(target: string, incoming: string): boolean {
  return target === incoming || (target === "knight" && incoming === "squire");
}

export function unitsOfClass(units: { classes: string[] }[], cls: string): number {
  return units.filter((u) => u.classes.includes(cls)).length;
}

/**
 * A unit's innate ability as mechanics, grown by its merges — the one source
 * for combat (seeded into `unit.traits` each round), the hover breakdown and
 * the Units screen, so they can't disagree. `merges` counts every body folded
 * in, so a Knight's includes the Squires that made it.
 */
export function innateTraits(key: string, merges = 0): UnitTraits {
  const m = Math.max(0, merges);
  switch (key) {
    case "guard":
      return { deathBuff: { target: "behind", hp: 2 + Math.floor(m / 2) } };
    case "striker":
      return { openingBonus: 3 + m };
    case "skirmisher":
      // One dodge, always: a second made a merged Skirmisher near-untouchable
      // (63-84% in the round-robin). Merges sharpen the counter instead.
      return { dodges: 1, riposte: Math.floor(m / 2) };
    case "bulwark":
      return { growOnSurvive: { hp: 1 + Math.floor(m / 2) } };
    case "berserker":
      return { cleave: true, cleaveCap: 3 + m };
    case "squire":
      return { deathBuff: { target: "behind", atk: 1 + Math.floor(m / 2) } };
    case "knight": {
      const past = Math.max(0, m - KNIGHT_AT);
      return { damageReduction: 1, deathBuff: { target: "allies", atk: 1 + Math.floor(past / 2) } };
    }
    default:
      return {};
  }
}
