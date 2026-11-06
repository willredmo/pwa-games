import { levelOf } from "../engine/units";
import type { AugmentState } from "./augments";

// The gold economy, a match setting (MatchRules.economy; off by default).
// Instead of two free picks a round, each side earns gold and spends it:
// cards, extra rerolls, a fifth slot, more income, level-2 cards. Numbers from
// `pnpm economy` (scripts/economy.ts), where bots play these rules through the
// real engine; see "Economy prototype" in CLAUDE.md.

export const ECON = {
  income: 4,
  /** A card; each card tier above the first adds `tierExtra`. */
  unit: 2,
  tierExtra: 1,
  /** A reroll beyond the round's free one. */
  reroll: 1,
  /** +1 gold a round per this many held, up to `interestCap`. */
  interestPer: 6,
  interestCap: 2,
  holdCap: 30,
  startSlots: 4,
  maxSlots: 5,
  slot: 2,
  /** What each income upgrade costs; each adds 1 gold a round. */
  incomeCosts: [5, 8],
  tier2: 10,
  /** Selling pays this, plus a gold per 2 levels. */
  sell: 2,
} as const;

/** One side's purse. Lives on its AugmentState, so it saves with the match. */
export interface Econ {
  gold: number;
  slots: number;
  /** Income upgrades bought. */
  incomes: number;
  /** Level of the cards it's dealt: 1, or 2 once bought. */
  tier: number;
}

export function econOf(state: AugmentState): Econ {
  return (state.econ ??= { gold: 0, slots: ECON.startSlots, incomes: 0, tier: 1 });
}

export const interestOf = (gold: number) => Math.min(ECON.interestCap, Math.floor(gold / ECON.interestPer));

/** What a side will earn next round, as things stand. */
export const earnings = (e: Econ) => ECON.income + e.incomes + interestOf(e.gold);

/** A new round's gold, interest on what was kept included. */
export function earnRound(state: AugmentState): void {
  const e = econOf(state);
  e.gold = Math.min(ECON.holdCap, e.gold + earnings(e));
}

export const cardPrice = (e: Econ) => ECON.unit + (e.tier - 1) * ECON.tierExtra;

/** Cards this purse can buy. */
export const affordable = (e: Econ) => Math.floor(e.gold / cardPrice(e));

/** The next income upgrade's price, or null with both bought. */
export const incomeCost = (e: Econ): number | null => ECON.incomeCosts[e.incomes] ?? null;

export const sellValue = (merges: number) => ECON.sell + Math.floor(levelOf(merges) / 2);
