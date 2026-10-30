import type { Archetype, UnitStats, UnitTraits } from "./types";

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
    archetype: "defense",
    role: "Tanky, absorbs hits, low output",
    ability: { name: "Bodyguard", trigger: "On death", text: "The unit behind it gains +2 health for the rest of the round.", scaling: "+1 health every 2 levels" },
    mastery: "Bodyguard shields every unit on your row, not just the one behind.",
  },
  striker: {
    name: "Striker",
    atk: 4,
    maxHp: 4,
    shape: "triangle",
    classes: ["striker", "aggro"],
    archetype: "attack",
    role: "Glass cannon",
    ability: { name: "Charge", trigger: "First attack", text: "Its first attack each round deals +3 damage.", scaling: "+1 damage per level" },
    mastery: "Charge hits the first blow against each new enemy, not just once a round.",
  },
  skirmisher: {
    name: "Skirmisher",
    atk: 3,
    maxHp: 2,
    shape: "diamond",
    classes: ["skirmisher"],
    archetype: "attack",
    role: "Balanced all-rounder",
    ability: { name: "Evasion", trigger: "Start of round", text: "Dodges the first hit it takes each round.", scaling: "When it dodges, strikes back for +1 damage every 2 levels" },
    mastery: "Dodges the first two hits each round.",
  },
  bulwark: {
    name: "Bulwark",
    atk: 1,
    maxHp: 11,
    shape: "hexagon",
    classes: ["bulwark", "tank"],
    archetype: "defense",
    role: "Max tank, meant to stall",
    ability: { name: "Fortify", trigger: "End of round", text: "If it survived the round, it permanently gains +1 health.", scaling: "+1 health every 2 levels" },
    mastery: "Fortify also gives +1 attack each round it survives.",
  },
  berserker: {
    name: "Berserker",
    atk: 5,
    maxHp: 3,
    shape: "circle",
    classes: ["berserker", "aggro"],
    archetype: "attack",
    role: "Highest attack, very fragile",
    ability: { name: "Overflow", trigger: "On kill", text: "Half the damage beyond a kill (up to 3) carries into the next enemy.", scaling: "Carry-over cap +1 per level" },
    mastery: "Overflow chains: an enemy its Overflow kills passes the rest on to the next.",
  },
  // The first unit that wants to stand at the back: it never fights well, but
  // from behind the front it lifts whoever is fighting.
  herald: {
    name: "Herald",
    atk: 1,
    maxHp: 5,
    shape: "star",
    classes: ["herald", "support"],
    archetype: "support",
    role: "Support: lifts the unit in front of it",
    ability: { name: "Rally", trigger: "Start of round", text: "The unit directly in front of it gains +3 attack for the round. Leading the row, it rallies itself.", scaling: "+1 attack every 2 levels" },
    mastery: "Rally also gives that unit as much health as attack.",
  },
  // Reaches past the front: every blow it lands also stabs the unit behind.
  lancer: {
    name: "Lancer",
    atk: 3,
    maxHp: 5,
    shape: "kite",
    classes: ["lancer"],
    archetype: "attack",
    role: "Reach: hits the front and the unit behind it",
    ability: { name: "Impale", trigger: "On hit", text: "Each blow it lands also hits the enemy unit behind the front for 1.", scaling: "+1 pierce damage every 2 levels" },
    mastery: "Impale hits the two units behind the front.",
  },
  // Back-row sustain: keeps the front standing from behind.
  medic: {
    name: "Medic",
    atk: 1,
    maxHp: 6,
    shape: "cross",
    classes: ["medic", "support"],
    archetype: "support",
    role: "Support: heals the unit in front of it",
    ability: { name: "Mend", trigger: "After each exchange", text: "The unit directly in front of it heals 3 (up to 3 times a round). Leading the row, it heals itself.", scaling: "+1 healing every 2 levels" },
    mastery: "Mends 5 times a round instead of 3.",
  },
  // Burst protection from behind: soaks the first hits the front takes, but
  // never grows the front's health, so it can't stall a round the way
  // uncapped healing did.
  warden: {
    name: "Warden",
    atk: 1,
    maxHp: 6,
    shape: "octagon",
    classes: ["warden", "support"],
    archetype: "support",
    role: "Support: shields the unit in front of it",
    ability: { name: "Barrier", trigger: "Start of round", text: "The unit directly in front of it gets a shield that absorbs the first 4 damage it takes. Leading the row, it shields itself.", scaling: "+1 shield per level" },
    mastery: "The unit in front of that one gets the same shield.",
  },
  // Gives itself away: half its health moves to the front each round. Big
  // health, no other use, so it wants the back of the row.
  acolyte: {
    name: "Acolyte",
    atk: 1,
    maxHp: 8,
    shape: "drop",
    classes: ["acolyte", "support"],
    archetype: "support",
    role: "Support: gives half its health to the unit in front of it",
    ability: { name: "Lifebond", trigger: "Start of round", text: "It gives half its health to the unit directly in front of it for the round. Leading the row, it keeps it and gains a shield that size instead.", scaling: "Its health grows with levels, so the gift does too" },
    mastery: "That unit also gains +2 attack.",
  },
  // The answer to a runaway hitter: the harder it's struck, the harder it
  // strikes back, so a unit stacked with attack hurts itself on it.
  sentinel: {
    name: "Sentinel",
    atk: 2,
    maxHp: 8,
    shape: "pillar",
    classes: ["sentinel"],
    archetype: "defense",
    role: "Counter: punishes big hitters",
    ability: {
      name: "Retaliate",
      trigger: "When hit",
      text:
        "Every time it's hit, it deals 40% of that blow's damage straight back to the attacker, rounded down: a 10-damage hit sends 4 back. Counted before its own armour or shields, so the harder something hits it, the more it hurts itself.",
      scaling: "+5% per level (85% at level 10: a 10-damage hit sends 8 back)",
    },
    mastery: "Sends back 100% of every blow: a 10-damage hit sends all 10 back.",
  },
  // Carries other supports forward: whatever reaches it goes on to the unit
  // ahead, stronger. Useless alone; the point is a chain from the back.
  beacon: {
    name: "Beacon",
    atk: 1,
    maxHp: 6,
    shape: "lantern",
    classes: ["beacon", "support"],
    archetype: "support",
    role: "Support: boosts the support behind it and bounces it forward",
    ability: {
      name: "Relay",
      trigger: "When a support ability lands on it",
      text:
        "Does nothing on its own. Put a support unit (Herald, Medic, Warden or Acolyte) directly behind it: instead of keeping that unit's Rally, Mend, Barrier or Lifebond, the Beacon bounces it on to the unit in front of it, 1.5× stronger. Beacons in a row each add their boost (two at level 1: 2×), up to 3× in all, so a support at the back can power up your front unit.",
      scaling: "Bounces it +0.1× stronger per level (×2.4 at level 10)",
    },
    mastery: "Bounces it on at 3×.",
  },
  // The late-game unit: the weakest body in the pool, but its merges escalate
  // (see SQUIRE_STEP) and at KNIGHT_AT merges it is promoted to a Knight.
  squire: {
    name: "Squire",
    atk: 1,
    maxHp: 3,
    shape: "shield",
    classes: ["squire"],
    archetype: "defense",
    role: "Weak now; every level is bigger than the last, and level 7 makes a Knight",
    ability: { name: "Pass the torch", trigger: "On death", text: "The unit behind it gains +1 attack for the rest of the round.", scaling: "+1 attack every 2 levels" },
  },
  knight: {
    name: "Knight",
    atk: 0,
    maxHp: 0,
    shape: "shield",
    classes: ["knight"],
    archetype: "defense",
    role: "Promoted Squire: armoured, and still growing with every level",
    ability: { name: "Armour · Last rally", trigger: "Always · On death", text: "Takes 1 less damage per hit. When it falls, all your units gain +1 attack for the rest of the round.", scaling: "Last rally +1 attack every 2 levels past knighthood" },
    mastery: "Armour 2: takes 2 less damage per hit.",
    offered: false,
  },
};


/** How each class reads to the player. */
export const ARCHETYPES: Record<Archetype, { icon: string; name: string }> = {
  attack: { icon: "⚔", name: "Attack" },
  defense: { icon: "🛡", name: "Defense" },
  support: { icon: "✚", name: "Support" },
};

/**
 * Full-row synergies: when every slot of a side's row (5, or 6 with
 * Reinforcements) holds one class, the whole row gets that class's bonus for
 * the round, no upgrade needed. Applied in `applyAugments`, so it's recomputed
 * each round, badged, itemised and deterministic online.
 */
export const SYNERGIES: Record<Archetype, { name: string; icon: string; text: string }> = {
  attack: { name: "Full Assault", icon: "🔥", text: "Every unit gains +2 attack, and its overkill carries on to the next enemy (half, up to 3)." },
  defense: { name: "Iron Line", icon: "🧱", text: "Every unit starts each round with a 5 shield." },
  support: {
    name: "Sanctuary",
    icon: "🕊",
    text: "Every support ability counts twice: rally, mend, barrier and lifebond are doubled (before any Beacon amplifies them).",
  },
};
/** Smallest row a synergy needs: a single unit (Ascendant) is no "row of one class". */
export const SYNERGY_MIN = 5;

/**
 * The class every unit on the row shares, once there are at least
 * SYNERGY_MIN of them, or null. Not "every slot": rows grow past 5 as units
 * reach the level cap, and an earned slot shouldn't break a bonus. A row with
 * room for fewer than SYNERGY_MIN (Ascendant's one) never qualifies.
 */
export function synergyOf(units: { key: string }[], capacity: number): Archetype | null {
  if (capacity < SYNERGY_MIN || units.length < SYNERGY_MIN) return null;
  const first = UNITS[units[0].key]?.archetype;
  return first && units.every((u) => UNITS[u.key]?.archetype === first) ? first : null;
}
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
/**
 * Units stop levelling here, and reaching it unlocks their Mastery. Without a
 * cap the dominant plan was to pour every pick into one unit; capped, a row
 * needs several strong units. Ascendant (an upgrade) lifts it for a side that
 * fields a single unit.
 */
export const MAX_LEVEL = 10;
export const MAX_MERGES = MAX_LEVEL - 1;
/** Whether a unit with this many merges has reached its Mastery. */
/** At the level cap, which is a match setting (`levelCapOf`); MAX_LEVEL is the default. */
export const isMastered = (merges: number, cap = MAX_LEVEL) => levelOf(merges) >= cap;

/**
 * Whether odies more bodies of type incoming can be folded into a unit of
 * type 	arget that has merges already: like with like, and within the cap
 * (cap = most merges allowed; Infinity once uncapped).
 */
export function canAbsorb(target: string, merges: number, incoming: string, bodies = 1, cap = MAX_MERGES): boolean {
  // An uncapped side (Ascendant) holds one unit, and it absorbs any type.
  if (cap === Infinity) return true;
  return mergesInto(target, incoming) && merges + bodies <= cap;
}
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

/** Mends a mastered Medic gets each round (combat's default is 3). */
export const MASTER_MEND_MORE = 2;
/** A mastered Beacon's Relay, in percent. */
export const BEACON_MASTER_RELAY = 300;

export function unitsOfClass(units: { classes: string[] }[], cls: string): number {
  return units.filter((u) => u.classes.includes(cls)).length;
}

/**
 * A unit's innate ability as mechanics, grown by its merges — the one source
 * for combat (seeded into `unit.traits` each round), the hover breakdown and
 * the Units screen, so they can't disagree. `merges` counts every body folded
 * in, so a Knight's includes the Squires that made it.
 */
export function innateTraits(key: string, merges = 0, cap = MAX_LEVEL): UnitTraits {
  const m = Math.max(0, merges);
  const master = isMastered(m, cap);
  switch (key) {
    // At MAX_LEVEL each ability takes its Mastery form (UNITS[key].mastery).
    case "guard":
      return { deathBuff: { target: master ? "allies" : "behind", hp: 2 + Math.floor(m / 2) } };
    case "striker":
      return master ? { openingBonus: 3 + m, chargeEach: true } : { openingBonus: 3 + m };
    case "skirmisher":
      // One dodge below Mastery: a second made a merged Skirmisher near-
      // untouchable (63-84% in the round-robin). Merges sharpen the counter.
      return { dodges: master ? 2 : 1, riposte: Math.floor(m / 2) };
    case "bulwark":
      return { growOnSurvive: master ? { atk: 1, hp: 1 + Math.floor(m / 2) } : { hp: 1 + Math.floor(m / 2) } };
    case "berserker":
      return master ? { cleave: true, cleaveCap: 3 + m, cleaveChain: true } : { cleave: true, cleaveCap: 3 + m };
    case "lancer":
      return master ? { pierce: 1 + Math.floor(m / 2), pierceDeeper: 1 } : { pierce: 1 + Math.floor(m / 2) };
    case "medic":
      // Read by combat (mendHeals): heals the unit directly ahead.
      return master ? { mend: 3 + Math.floor(m / 2), mendMore: MASTER_MEND_MORE } : { mend: 3 + Math.floor(m / 2) };
    case "herald": {
      // Read by combat (openingBuffs): lands on the unit directly ahead.
      const rally = 3 + Math.floor(m / 2);
      return master ? { rally, rallyHp: rally } : { rally };
    }
    case "warden": {
      // Read by combat (openingBuffs): lands on the unit directly ahead.
      // 3 + 1 every 2 levels measured 41% (sim, --aug=random); 4 + 1 a level 52%.
      const barrier = 4 + m;
      return master ? { barrier, barrierReach: 1 } : { barrier };
    }
    case "sentinel":
      // Percent of each blow: 40% at level 1, 85% at 10, 100% mastered.
      return { reflect: master ? 100 : 40 + 5 * m };
    case "beacon":
      // Percent: ×1.5 at level 1, ×2.4 at 10, ×3 mastered. In a chain each adds
      // its bonus over ×1, up to RELAY_CAP (combat.ts).
      return { relay: master ? BEACON_MASTER_RELAY : 150 + 10 * m };
    case "acolyte":
      // `lifebond` multiplies the gift (Sanctuary doubles it); the Acolyte
      // always loses half its own health. Read by combat (openingBuffs).
      return master ? { lifebond: 1, lifebondAtk: 2 } : { lifebond: 1 };
    case "squire":
      return { deathBuff: { target: "behind", atk: 1 + Math.floor(m / 2) } };
    case "knight": {
      const past = Math.max(0, m - KNIGHT_AT);
      return { damageReduction: master ? 2 : 1, deathBuff: { target: "allies", atk: 1 + Math.floor(past / 2) } };
    }
    default:
      return {};
  }
}
