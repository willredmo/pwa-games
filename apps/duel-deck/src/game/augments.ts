import type { AuraDetail, SideMods, Side, Unit, UnitTraits } from "../engine/types";
import { KNIGHT_AT, UNITS, UNIT_KEYS, innateTraits } from "../engine/units";

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
 * How deep into a match an augment can be offered. Commons from the first
 * upgrade round, rares from the second, epics from the third (RARITY_UNLOCK).
 */
export type Rarity = "common" | "rare" | "epic";
export const RARITY_UNLOCK: Record<Rarity, number> = { common: 1, rare: 2, epic: 3 };

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
  /** Max HP change to the player's own pool, applied once at pick time. */
  hpCost?: number;
  /** Combat keywords for one unit, recomputed each round like `effect`. */
  traits?: (unit: Unit, index: number, ctx: AugmentContext) => UnitTraits;
  /** Side-wide modifiers while held (see `sideModsFor`). */
  mods?: SideMods;
  /** Absent = common. Gates which upgrade round can offer it. */
  rarity?: Rarity;
  /** Pool HP restored each round this side wins (see `settleRound`). */
  healOnWin?: number;
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
}

/**
 * A one-off grant pinned to a single unit. `from` names the augments that
 * contributed, so the unit can show their badges — the delta alone doesn't say
 * where it came from.
 */
export interface Grant extends Delta {
  from: string[];
}

export function createAugmentState(): AugmentState {
  return { active: [], momentum: 0, rally: 0, kills: 0, grants: {} };
}

const has = (u: Unit, cls: string) => u.classes.includes(cls);
/** Most attack Berserker's rally can grant: with full rows Berserkers die every round. */
export const RALLY_CAP = 2;
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
    description: "+2 health to all Skirmishers.",
    category: "class",
    effect: (u) => (has(u, "skirmisher") ? { hp: 2 } : {}),
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
    icon: "🧱",
    name: "Iron will",
    description: "+4 health and +1 attack to all Bulwarks.",
    category: "class",
    effect: (u) => (has(u, "bulwark") ? { hp: 4, atk: 1 } : {}),
  },
  {
    id: "precision-strikes",
    icon: "🎯",
    name: "Precision strikes",
    description: "+1 attack and +1 health to all Strikers.",
    category: "class",
    effect: (u) => (has(u, "striker") ? { atk: 1, hp: 1 } : {}),
  },

  // --- Global ---
  {
    id: "battle-fury",
    icon: "🔥",
    name: "Battle fury",
    description: "+1 attack to every unit on your board.",
    category: "global",
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
    effect: (_u, _i, ctx) => ({ atk: Math.floor(ctx.momentum / 3) }),
  },
  {
    id: "desperate-measures",
    icon: "💢",
    name: "Desperate measures",
    description: "While your HP is below 60, all units gain +3 attack.",
    category: "global",
    // 30% of START_HP (game/match.ts) — not imported, as match.ts imports this module.
    effect: (_u, _i, ctx) => (ctx.ownHp < 60 ? { atk: 3 } : {}),
  },
  {
    id: "united-front",
    icon: "🤝",
    name: "United front",
    description: "+1 health to all units for every 2 units on your board (rounded down).",
    category: "global",
    effect: (_u, _i, ctx) => ({ hp: Math.floor(ctx.units.length / 2) }),
  },
  {
    id: "overwhelm",
    icon: "🌊",
    name: "Overwhelm",
    description: "+1 attack to all units for every 3 enemy units you killed last round.",
    category: "global",
    effect: (_u, _i, ctx) => ({ atk: Math.floor(ctx.kills / 3) }),
  },
  {
    id: "bloodpact",
    icon: "🩸",
    name: "Bloodpact",
    description: "All units gain +2 attack, but you lose 80 HP.",
    category: "global",
    effect: () => ({ atk: 2 }),
    hpCost: 80,
  },

  // --- Synergy-based ---
  {
    id: "tank-wall",
    icon: "🏰",
    name: "Tank wall",
    description: "+1 health to Guards/Bulwarks per Guard or Bulwark you have.",
    category: "synergy",
    effect: (u, _i, ctx) =>
      has(u, "tank") ? { hp: countClass(ctx.units, "tank") } : {},
  },
  {
    id: "glass-cannon-pact",
    icon: "💎",
    name: "Glass cannon pact",
    description: "+3 attack and -1 health to all Strikers and Berserkers.",
    category: "synergy",
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
    description: "+1 attack/+1 health to all units, if you have 4+ unit types.",
    category: "synergy",
    effect: (_u, _i, ctx) => {
      const types = new Set(ctx.units.map((x) => x.key));
      return types.size >= 4 ? { atk: 1, hp: 1 } : {};
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
    traits: (u) => (has(u, "tank") ? { thorns: 2 } : {}),
  },
  {
    id: "lifesteal",
    icon: "🦇",
    name: "Lifesteal",
    description: "Skirmishers heal for half the damage they deal.",
    category: "combat",
    traits: (u) => (has(u, "skirmisher") ? { lifesteal: 0.5 } : {}),
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
    traits: () => ({ lastBreath: true }),
  },

  // --- Squire line ---
  {
    id: "squires-drill",
    icon: "🏋️",
    name: "Squire's drill",
    description: "+1 health to all Squires and +1 attack to all Knights.",
    category: "class",
    units: ["squire", "knight"],
    effect: (u) => (has(u, "squire") ? { hp: 1 } : has(u, "knight") ? { atk: 1 } : {}),
  },
  {
    id: "early-knighthood",
    icon: "⚜️",
    name: "Early knighthood",
    description: `Squires are knighted after ${KNIGHT_AT - 1} merges instead of ${KNIGHT_AT}.`,
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
    description: "Guards, Bulwarks and Knights take 1 less damage per hit.",
    category: "combat",
    rarity: "rare",
    units: ["guard", "bulwark", "knight"],
    traits: (u) => (has(u, "tank") || has(u, "knight") ? { damageReduction: 1 } : {}),
  },
  {
    id: "bloodthirst",
    icon: "🍷",
    name: "Bloodthirst",
    description: "Strikers and Berserkers heal for half the damage they deal.",
    category: "combat",
    rarity: "rare",
    traits: (u) => (has(u, "aggro") ? { lifesteal: 0.5 } : {}),
  },
  {
    id: "spearwall",
    icon: "🔱",
    name: "Spearwall",
    description: "The unit leading your row when the round starts reflects 3 damage when hit and takes 1 less damage per hit.",
    category: "combat",
    rarity: "rare",
    traits: (_u, i) => (i === 0 ? { thorns: 3, damageReduction: 1 } : {}),
  },
  {
    id: "war-chest",
    icon: "🪙",
    name: "War chest",
    description: "Winning a round deals 6 extra damage and heals you 4 HP.",
    category: "strategy",
    rarity: "rare",
    mods: { bounty: 6 },
    healOnWin: 4,
  },

  // --- Epic: offered from the third upgrade round ---
  {
    id: "legion",
    icon: "🦅",
    name: "Legion",
    description: "+1 attack and +1 health to every unit.",
    category: "global",
    rarity: "epic",
    effect: () => ({ atk: 1, hp: 1 }),
  },
  {
    id: "champion",
    icon: "🏆",
    name: "Champion",
    description: "The unit leading your row when each round starts gains +3 attack and +5 health.",
    category: "global",
    rarity: "epic",
    // No first strike: on the front unit it decided nearly every match (88%).
    effect: (_u, i) => (i === 0 ? { atk: 3, hp: 5 } : {}),
  },
  {
    id: "unbreakable",
    icon: "🗿",
    name: "Unbreakable",
    description: "Every unit takes 1 less damage per hit.",
    category: "combat",
    rarity: "epic",
    traits: () => ({ damageReduction: 1 }),
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
    description: "Each round you win, recover 8 HP (up to your starting HP).",
    category: "strategy",
    healOnWin: 8,
  },
  {
    id: "bounty",
    icon: "💰",
    name: "Bounty",
    description: "Winning a round deals 4 extra damage.",
    category: "strategy",
    mods: { bounty: 4 },
  },
];

const BY_ID = new Map(AUGMENTS.map((a) => [a.id, a]));

export function getAugment(id: string): AugmentDef | undefined {
  return BY_ID.get(id);
}

/** Sample `n` augments the player doesn't already hold. */
export const rarityOf = (a: AugmentDef): Rarity => a.rarity ?? "common";

/**
 * Sample `n` augments the side doesn't already hold, from the rarities unlocked
 * by `tier` (1 = first upgrade round). The round a rarity unlocks guarantees at
 * least one card of it, so the second and third upgrade rounds feel different.
 */
export function offerAugments(state: AugmentState, n: number, tier = 1): AugmentDef[] {
  const pool = AUGMENTS.filter(
    (a) => !state.active.includes(a.id) && RARITY_UNLOCK[rarityOf(a)] <= tier,
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const fresh = (Object.keys(RARITY_UNLOCK) as Rarity[]).find((r) => RARITY_UNLOCK[r] === tier);
  if (fresh && fresh !== "common") {
    const i = pool.findIndex((a) => rarityOf(a) === fresh);
    if (i > 0) pool.unshift(...pool.splice(i, 1));
  }
  return pool.slice(0, Math.min(n, pool.length));
}

/** Take an augment. Returns the max-HP cost to apply to the player's pool. */
export function takeAugment(
  state: AugmentState,
  id: string,
  units: Unit[],
): number {
  const def = getAugment(id);
  if (!def || state.active.includes(id)) return 0;
  state.active.push(id);
  def.onPick?.(state, units);
  return def.hpCost ?? 0;
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
): void {
  const ctx: AugmentContext = {
    units,
    ownHp,
    enemyUnitCount,
    momentum: state.momentum,
    rally: state.rally,
    kills: state.kills ?? 0,
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
    const traits: UnitTraits = innateTraits(unit.key, unit.merges);
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
  });
}

/** Merge `t` into `into`: booleans OR, numbers add, lifesteal takes the max. */
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
  }
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
export function unitsAffectedBy(def: AugmentDef): string[] {
  if (def.units) return def.units;
  const units: Unit[] = UNIT_KEYS.map((key, i) => {
    const st = UNITS[key];
    return {
      id: `probe${i}`, side: "player", key, name: st.name, shape: st.shape,
      classes: [...st.classes], baseAtk: st.atk, baseMaxHp: st.maxHp, merges: 0,
      atk: st.atk, maxHp: st.maxHp, hp: st.maxHp, auras: [],
    };
  });
  const ctx: AugmentContext = { units, ownHp: 1, enemyUnitCount: 0, momentum: 99, rally: 99, kills: 99 };
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
