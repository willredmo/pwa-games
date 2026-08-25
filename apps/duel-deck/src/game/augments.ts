import type { Side, Unit } from "../engine/types";

// Persistent upgrades ("augments") — the tracker doc's separate offer track.
//
// Key properties from the doc:
//   - Offered every 3rd round, on their own track (never mixed with unit picks)
//   - MATCH-SCOPED: they last the current match only, never carried between
//     matches. `AugmentState` therefore lives and dies with a match.
//
// Most augments are not one-off stat edits — Momentum stacks per round won,
// Desperate Measures switches on below 30 HP, Vanguard's Edge re-targets
// whoever is front. So effects are recomputed from base stats at the start of
// every round via `applyAugments`, rather than mutated into the units once.

export type AugmentCategory = "class" | "global" | "synergy";

/** Everything an augment effect may inspect when it's evaluated. */
export interface AugmentContext {
  units: Unit[]; // your board units, front-first
  ownHp: number;
  enemyUnitCount: number;
  /** Stacking counters accumulated during the match. */
  momentum: number; // rounds won, for Momentum
  rally: number; // Berserkers lost, for Berserker's Rally
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
}

/** Match-scoped augment state. Reset on every new match. */
export interface AugmentState {
  active: string[]; // augment ids, in pick order
  momentum: number;
  rally: number;
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
  return { active: [], momentum: 0, rally: 0, grants: {} };
}

const has = (u: Unit, cls: string) => u.classes.includes(cls);
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
    description: "+2 attack to all Berserkers.",
    category: "class",
    effect: (u) => (has(u, "berserker") ? { atk: 2 } : {}),
  },
  {
    id: "iron-will",
    icon: "🧱",
    name: "Iron will",
    description: "+4 health to all Bulwarks.",
    category: "class",
    effect: (u) => (has(u, "bulwark") ? { hp: 4 } : {}),
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
    description: "Each round your board wins, all units gain +1 attack. Stacks.",
    category: "global",
    effect: (_u, _i, ctx) => ({ atk: ctx.momentum }),
  },
  {
    id: "desperate-measures",
    icon: "💢",
    name: "Desperate measures",
    description: "While your HP is below 30, all units gain +3 attack.",
    category: "global",
    effect: (_u, _i, ctx) => (ctx.ownHp < 30 ? { atk: 3 } : {}),
  },
  {
    id: "united-front",
    icon: "🤝",
    name: "United front",
    description: "+1 health to all units for every unit on your board.",
    category: "global",
    effect: (_u, _i, ctx) => ({ hp: ctx.units.length }),
  },
  {
    id: "overwhelm",
    icon: "🌊",
    name: "Overwhelm",
    description: "If you have more units than your opponent, all units gain +1 attack.",
    category: "global",
    effect: (_u, _i, ctx) => (ctx.units.length > ctx.enemyUnitCount ? { atk: 1 } : {}),
  },
  {
    id: "bloodpact",
    icon: "🩸",
    name: "Bloodpact",
    description: "All units gain +2 attack, but you lose 10 max HP for the match.",
    category: "global",
    effect: () => ({ atk: 2 }),
    hpCost: 10,
  },

  // --- Synergy-based ---
  {
    id: "tank-wall",
    icon: "🏰",
    name: "Tank wall",
    description: "+2 health to Guards/Bulwarks per Guard or Bulwark you have.",
    category: "synergy",
    effect: (u, _i, ctx) =>
      has(u, "tank") ? { hp: 2 * countClass(ctx.units, "tank") } : {},
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
    description: "Your front-most unit gets +2 attack/+2 health, re-applied each round.",
    category: "synergy",
    effect: (_u, index) => (index === 0 ? { atk: 2, hp: 2 } : {}),
  },
  {
    id: "mixed-formation",
    icon: "🎲",
    name: "Mixed formation",
    description: "+1 attack/+1 health to all units, if you have 3+ unit types.",
    category: "synergy",
    effect: (_u, _i, ctx) => {
      const types = new Set(ctx.units.map((x) => x.key));
      return types.size >= 3 ? { atk: 1, hp: 1 } : {};
    },
  },
  {
    id: "berserkers-rally",
    icon: "💀",
    name: "Berserker's rally",
    description: "Whenever a Berserker of yours dies, all units gain +1 attack for the match.",
    category: "synergy",
    effect: (_u, _i, ctx) => ({ atk: ctx.rally }),
  },
];

const BY_ID = new Map(AUGMENTS.map((a) => [a.id, a]));

export function getAugment(id: string): AugmentDef | undefined {
  return BY_ID.get(id);
}

/** Sample `n` augments the player doesn't already hold. */
export function offerAugments(state: AugmentState, n: number): AugmentDef[] {
  const pool = AUGMENTS.filter((a) => !state.active.includes(a.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
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
  };
  const defs = state.active.map(getAugment).filter((d): d is AugmentDef => !!d);

  units.forEach((unit, index) => {
    let atk = unit.baseAtk;
    let hp = unit.baseMaxHp;
    // Rebuilt from scratch each round: a conditional augment that isn't
    // currently firing (Overwhelm while behind on units, Momentum at 0 stacks)
    // must drop its badge, not keep it from last round.
    const auras: string[] = [];
    for (const def of defs) {
      const d = def.effect?.(unit, index, ctx) ?? {};
      atk += d.atk ?? 0;
      hp += d.hp ?? 0;
      // Only badge an augment that's actually moving a number right now.
      if ((d.atk ?? 0) !== 0 || (d.hp ?? 0) !== 0) auras.push(def.id);
    }
    const grant = state.grants[unit.id];
    if (grant) {
      atk += grant.atk ?? 0;
      hp += grant.hp ?? 0;
      for (const id of grant.from) if (!auras.includes(id)) auras.push(id);
    }
    unit.atk = Math.max(0, atk);
    unit.maxHp = Math.max(1, hp);
    unit.hp = unit.maxHp; // units persist and return to full health each round
    unit.auras = auras;
  });
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
