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
    ability: { name: "Bodyguard", trigger: "On death", text: "The unit behind it gains +2 health for the rest of the round.", scaling: "+1 health every 2 levels" },
  },
  striker: {
    name: "Striker",
    atk: 4,
    maxHp: 4,
    shape: "triangle",
    classes: ["striker", "aggro"],
    role: "Glass cannon",
    ability: { name: "Charge", trigger: "First attack", text: "Its first attack each round deals +3 damage.", scaling: "+1 damage per level" },
  },
  skirmisher: {
    name: "Skirmisher",
    atk: 3,
    maxHp: 2,
    shape: "diamond",
    classes: ["skirmisher"],
    role: "Balanced all-rounder",
    ability: { name: "Evasion", trigger: "Start of round", text: "Dodges the first hit it takes each round.", scaling: "When it dodges, strikes back for +1 damage every 2 levels" },
  },
  bulwark: {
    name: "Bulwark",
    atk: 1,
    maxHp: 11,
    shape: "hexagon",
    classes: ["bulwark", "tank"],
    role: "Max tank, meant to stall",
    ability: { name: "Fortify", trigger: "End of round", text: "If it survived the round, it permanently gains +1 health.", scaling: "+1 health every 2 levels" },
  },
  berserker: {
    name: "Berserker",
    atk: 5,
    maxHp: 3,
    shape: "circle",
    classes: ["berserker", "aggro"],
    role: "Highest attack, very fragile",
    ability: { name: "Overflow", trigger: "On kill", text: "Half the damage beyond a kill (up to 3) carries into the next enemy.", scaling: "Carry-over cap +1 per level" },
  },
  // The first unit that wants to stand at the back: it never fights well, but
  // from behind the front it lifts whoever is fighting.
  herald: {
    name: "Herald",
    atk: 1,
    maxHp: 5,
    shape: "star",
    classes: ["herald", "support"],
    role: "Support: useless in front, lifts the front from behind",
    ability: { name: "Rally", trigger: "Start of round", text: "If it isn't your front unit, your front unit gains +3 attack for the round.", scaling: "+1 attack every 2 levels" },
  },
  // Reaches past the front: every blow it lands also stabs the unit behind.
  lancer: {
    name: "Lancer",
    atk: 3,
    maxHp: 5,
    shape: "kite",
    classes: ["lancer"],
    role: "Reach: hits the front and the unit behind it",
    ability: { name: "Impale", trigger: "On hit", text: "Each blow it lands also hits the enemy unit behind the front for 1.", scaling: "+1 pierce damage every 2 levels" },
  },
  // Back-row sustain: keeps the front standing from behind.
  medic: {
    name: "Medic",
    atk: 1,
    maxHp: 6,
    shape: "cross",
    classes: ["medic", "support"],
    role: "Support: heals your front unit from behind",
    ability: { name: "Mend", trigger: "After each exchange", text: "If it isn't your front unit, your front unit heals 3 (up to 3 times a round).", scaling: "+1 healing every 2 levels" },
  },
  // The late-game unit: the weakest body in the pool, but its merges escalate
  // (see SQUIRE_STEP) and at KNIGHT_AT merges it is promoted to a Knight.
  squire: {
    name: "Squire",
    atk: 1,
    maxHp: 3,
    shape: "shield",
    classes: ["squire"],
    role: "Weak now; every level is bigger than the last, and level 7 makes a Knight",
    ability: { name: "Pass the torch", trigger: "On death", text: "The unit behind it gains +1 attack for the rest of the round.", scaling: "+1 attack every 2 levels" },
  },
  knight: {
    name: "Knight",
    atk: 0,
    maxHp: 0,
    shape: "shield",
    classes: ["knight"],
    role: "Promoted Squire: armoured, and still growing with every level",
    ability: { name: "Armour · Last rally", trigger: "Always · On death", text: "Takes 1 less damage per hit. When it falls, all your units gain +1 attack for the rest of the round.", scaling: "Last rally +1 attack every 2 levels past knighthood" },
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

/**
 * A unit's level as the player sees it: every unit starts at level 1 and each
 * body merged in adds one, so merging two placed units adds their levels. The
 * engine keeps counting `merges`; this is the only conversion.
 */
export const levelOf = (merges: number) => merges + 1;
/** The level at which a Squire is knighted (7 by default). */
export const KNIGHT_LEVEL = levelOf(KNIGHT_AT);
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
    case "lancer":
      return { pierce: 1 + Math.floor(m / 2) };
    case "medic":
      // Read by combat, which only heals from behind the front.
      return { mend: 3 + Math.floor(m / 2) };
    case "herald":
      // Read by applyAugments, which only credits Heralds behind the front.
      return { rally: 3 + Math.floor(m / 2) };
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
