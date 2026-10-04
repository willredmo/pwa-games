import type { UnitStats } from "./types";

// Unit pool — v1 first pass, straight from the tracker doc.
// Melee/front-line only: no ranged units in v1.
//
// `shape` drives the abstract/geometric theming (flat shapes, color encodes
// ownership). `classes` are the tags augments target ("+2 attack to all
// Strikers and Berserkers").

export const UNITS: Record<string, UnitStats> = {
  guard: {
    name: "Guard",
    atk: 3,
    maxHp: 10,
    shape: "square",
    classes: ["guard", "tank"],
    role: "Tanky, absorbs hits, low output",
  },
  striker: {
    name: "Striker",
    atk: 6,
    maxHp: 4,
    shape: "triangle",
    classes: ["striker", "aggro"],
    role: "Glass cannon",
  },
  skirmisher: {
    name: "Skirmisher",
    atk: 5,
    maxHp: 5,
    shape: "diamond",
    classes: ["skirmisher"],
    role: "Balanced all-rounder",
  },
  bulwark: {
    name: "Bulwark",
    atk: 2,
    maxHp: 14,
    shape: "hexagon",
    classes: ["bulwark", "tank"],
    role: "Max tank, meant to stall",
  },
  berserker: {
    name: "Berserker",
    atk: 8,
    maxHp: 3,
    shape: "circle",
    classes: ["berserker", "aggro"],
    role: "Highest attack, very fragile",
  },
  // The late-game unit: the weakest body in the pool, but its merges escalate
  // (see SQUIRE_STEP) and at KNIGHT_AT merges it is promoted to a Knight.
  squire: {
    name: "Squire",
    atk: 2,
    maxHp: 4,
    shape: "shield",
    classes: ["squire"],
    role: "Weak now; every merge is bigger than the last, and 5 make a Knight",
  },
  knight: {
    name: "Knight",
    // Placeholders, overwritten below with the stats a Squire actually has at
    // the moment it's knighted — a Knight only ever exists by promotion.
    atk: 0,
    maxHp: 0,
    shape: "shield",
    classes: ["knight"],
    role: "Promoted Squire: armoured, and still growing with every merge",
    traits: { damageReduction: 1 },
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
export const SQUIRE_STEP = { atk: 1, hp: 1.5 };
/** Merges at which a Squire is knighted (Early knighthood lowers it). */
export const KNIGHT_AT = 5;
/** One-off stats a Squire gains on being knighted, on top of its merges. */
export const KNIGHTING_BONUS = { atk: 2, hp: 4 };

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
