import type { Edge } from "../engine";

/**
 * Relics are the roguelike layer: one is drafted from a random 3 on every cash
 * out, they are kept forever, and they are the only source of build variety
 * between cycles. Upgrades are the flat idle backbone; relics bend the rules.
 */
export interface Relic {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Added into the Edge additively, on top of upgrades. */
  edge?: Partial<Edge>;
  /**
   * Whether a second copy does anything. Numeric bonuses stack with
   * diminishing returns; on/off flags (faster auto-spin, full offline rate, a
   * bigger opening stake) have nothing meaningful to add a second time, so a
   * duplicate would be a dead draft pick.
   */
  stacks?: boolean;
  /** Read by the game layer rather than the engine. */
  flags?: {
    /** Multiplies the auto-spin interval. */
    hasteMult?: number;
    /** Fraction of live earnings granted while away. */
    offlineRate?: number;
    /** Chips handed to you at the start of the next cycle. */
    seed?: number;
    /** Extra payout per Ivory, on top of IVORY_PAYOUT. */
    ivoryPayout?: number;
    /** Magnetism gained for each straight bet currently on the table. */
    magnetismPerStraight?: number;
  };
}

export const RELICS: Relic[] = [
  {
    id: "ivory-ledger",
    name: "Ivory Ledger",
    icon: "♜",
    desc: "Every Ivory is worth an extra +1% payout.",
    flags: { ivoryPayout: 0.01 },
  },
  {
    id: "green-tithe",
    name: "Green Tithe",
    icon: "◆",
    desc: "The zero pays you instead of taking you: 3x your total stake.",
    edge: { zeroBounty: 3 },
  },
  {
    id: "loaded-wheel",
    name: "Loaded Wheel",
    icon: "◎",
    desc: "+5% chance the ball is nudged onto a pocket you covered.",
    edge: { magnetism: 0.05 },
  },
  {
    id: "neighbours-cut",
    name: "Neighbour's Cut",
    icon: "✥",
    desc: "Straight bets pay 10% on the two pockets either side on the wheel.",
    edge: { neighbourPay: 0.1 },
  },
  {
    id: "snowball",
    name: "Snowball",
    icon: "❄",
    desc: "+10% payout per consecutive win. Resets when a spin loses.",
    edge: { streakBonus: 0.1 },
  },
  {
    id: "high-roller",
    name: "High Roller",
    icon: "♠",
    desc: "+50% payout on spins staking at least a quarter of your bankroll.",
    edge: { highRollerBonus: 0.5 },
  },
  {
    id: "crimson",
    name: "Crimson Devotion",
    icon: "♥",
    desc: "+30% payout when the ball lands red.",
    edge: { redBonus: 0.3 },
  },
  {
    id: "obsidian",
    name: "Obsidian Devotion",
    icon: "♣",
    desc: "+30% payout when the ball lands black.",
    edge: { blackBonus: 0.3 },
  },
  {
    id: "double-down",
    name: "Double Down",
    icon: "⧉",
    desc: "10% chance a winning spin pays out twice.",
    edge: { doubleChance: 0.1 },
  },
  {
    id: "marathon",
    stacks: false,
    name: "Marathon",
    icon: "⏩",
    desc: "Auto-spin runs 25% faster.",
    flags: { hasteMult: 0.75 },
  },
  {
    id: "clockwork",
    stacks: false,
    name: "Clockwork Croupier",
    icon: "⏱",
    desc: "The table earns at full rate while you are away, not half.",
    flags: { offlineRate: 1 },
  },
  {
    id: "comp-suite",
    name: "Comp Suite",
    icon: "⚑",
    desc: "+10% of every losing stake is handed back.",
    edge: { rebate: 0.1 },
  },
  {
    id: "deep-pockets",
    stacks: false,
    name: "Deep Pockets",
    icon: "▣",
    desc: "Start each cash-out with 10,000 chips.",
    flags: { seed: 10_000 },
  },
  {
    id: "sector-play",
    name: "Sector Play",
    icon: "⁘",
    desc: "+0.5% nudge chance for every separate number you have a chip on.",
    flags: { magnetismPerStraight: 0.005 },
  },
  {
    id: "iron-guarantee",
    name: "Iron Guarantee",
    icon: "⛨",
    desc: "The zero always returns your full stake.",
    edge: { zeroInsurance: 1 },
  },
];

export const RELIC_BY_ID = new Map(RELICS.map((r) => [r.id, r]));

export function relicsOf(ids: string[]): Relic[] {
  return ids
    .map((id) => RELIC_BY_ID.get(id))
    .filter((r): r is Relic => r !== undefined);
}

/**
 * Draft 3 relics: new ones first, then — once the pool runs dry — duplicates of
 * anything that stacks. Without the fallback the draft becomes a dead screen
 * after fourteen cash-outs, which is exactly when the game needs it most.
 */
export function offerRelics(owned: string[], rng: () => number): string[] {
  const picked: string[] = [];
  const take = (pool: string[]) => {
    while (picked.length < 3 && pool.length > 0) {
      picked.push(...pool.splice(Math.floor(rng() * pool.length), 1));
    }
  };
  take(RELICS.filter((r) => !owned.includes(r.id)).map((r) => r.id));
  if (picked.length < 3) {
    take(
      RELICS.filter((r) => r.stacks !== false && !picked.includes(r.id)).map((r) => r.id),
    );
  }
  return picked;
}

/** Owned ids collapsed to one entry each, for effects that cannot stack. */
export function uniqueRelicsOf(ids: string[]): Relic[] {
  return relicsOf([...new Set(ids)]);
}

/** How many copies of each id appear in the list. */
export function relicCounts(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
