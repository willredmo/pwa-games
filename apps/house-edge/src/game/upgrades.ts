import type { Edge } from "../engine";
import { neutralEdge } from "../engine";
import { RELIC_BY_ID, relicCounts, type Relic } from "./relics";

export interface Upgrade {
  id: string;
  name: string;
  icon: string;
  /** Shown on the card; `lvl` is the level you would be buying. */
  desc: (lvl: number) => string;
  baseCost: number;
  /** cost(level) = baseCost * growth^level. Ignored when `costStep` is set. */
  growth: number;
  /**
   * Set for a *linear* curve: cost(level) = baseCost + costStep * level. Use it
   * when the thing being bought also grows linearly — compounding the price of
   * a fixed-size benefit means the upgrade is dead within a few levels, however
   * many levels it nominally has.
   */
  costStep?: number;
  maxLevel: number;
  /** Hidden until this upgrade is at level 1+. */
  requires?: string;
  /** Which shop section it belongs to. Defaults to the table. */
  section?: "table" | "change";
}

/**
 * Share of a losing spin Comp Points hands back, per level.
 *
 * Safe to have in the shop again only because settlement is now on the **net**:
 * a rebate comes off what the spin actually lost and is clamped so it can never
 * carry a spin above zero. Measured across every rate up to the 0.95 ceiling,
 * a red/black hedge stays negative — worst case -0.135% — where under the old
 * per-bet settlement 7.5% was enough to make it +1.15% and print money.
 */
export const REBATE_PER_LEVEL = 0.025;

/** Each further copy of a stacking relic is worth this much of the last. */
export const STACK_FALLOFF = 0.6;
/** Payout each Ivory chip is worth, before the Ivory Ledger relic. */
export const IVORY_PAYOUT = 0.02;
/** Loose Change: the cup's own dimensions, before any upgrade. */
export const CHANGE_CUP_W = 54;
/** The cup's speed. Auto-move is measured against this and never exceeds it. */
export const CHANGE_CUP_SPEED = 300;
const CUP_WIDTH_STEP = 7;
/** Cents of change you can hold in one scramble, and what a level adds. */
export const CHANGE_CAP_BASE = 2_000;
export const CHANGE_CAP_STEP = 2_000;

/**
 * Auto-spin interval before Haste and the Marathon relic. Deliberately slow:
 * at 900ms the ball had no time to ride the track, so auto-spin read as a
 * number generator rather than a wheel. Haste still buys back ~8x from here.
 */
export const BASE_SPIN_MS = 2_600;
export const MIN_SPIN_MS = 120;

export const UPGRADES: Upgrade[] = [
  {
    id: "rebate",
    name: "Comp Points",
    icon: "⚑",
    desc: (l) =>
      `The house hands back ${(l * REBATE_PER_LEVEL * 100).toFixed(1)}% of what a losing spin cost you.`,
    // Cheap enough to be the first real purchase, dear enough to be a decision:
    // an even-money layout breaks even around 5.3% and turns positive at level
    // 3, which is roughly $530 all in against a $400 opening bankroll.
    baseCost: 120,
    growth: 1.42,
    maxLevel: 12,
  },
  {
    id: "limit",
    name: "Table Limit",
    icon: "▲",
    desc: (l) => `Unlock the ${fmtDenom(denomAt(l + BASE_DENOMS - 1))} chip.`,
    baseCost: 2_000,
    // Must track the denomination ladder's own ~3.16x step. Anything steeper
    // and the affordable stake falls further behind the bankroll every level,
    // which strangles growth no matter how high the payout multiplier goes.
    growth: 3.17,
    maxLevel: 30,
  },
  {
    id: "insurance",
    name: "En Prison",
    icon: "⛨",
    desc: (l) => `${l * 20}% of your stake survives the zero.`,
    baseCost: 600,
    growth: 2.6,
    maxLevel: 5,
  },
  {
    id: "auto",
    name: "Hire a Croupier",
    icon: "⚙",
    desc: () => "Unlocks auto-spin: your layout replays on its own.",
    baseCost: 200,
    growth: 1,
    maxLevel: 1,
  },
  {
    id: "magnetism",
    name: "Weighted Wheel",
    icon: "◎",
    desc: (l) => `+1% chance the ball is nudged onto a covered pocket (now ${l}%).`,
    baseCost: 1_500,
    growth: 1.48,
    maxLevel: 25,
  },
  {
    id: "haste",
    name: "Croupier's Haste",
    icon: "⏩",
    desc: (l) => `Auto-spin ${(100 - 100 * Math.pow(0.92, l)).toFixed(0)}% faster.`,
    baseCost: 250,
    growth: 1.33,
    maxLevel: 25,
    requires: "auto",
  },
  {
    id: "longshot",
    name: "Long Shot",
    icon: "✦",
    desc: (l) => `+${l}% payout on bets paying 8:1 or better.`,
    baseCost: 2_000,
    growth: 1.46,
    maxLevel: 20,
    requires: "limit",
  },
  {
    id: "balls",
    name: "Second Ball",
    icon: "⚭",
    desc: (l) =>
      `${l} extra ball${l === 1 ? "" : "s"} per spin. The best single ball takes the spin.`,
    baseCost: 50_000,
    growth: 14,
    maxLevel: 4,
    requires: "magnetism",
  },
  {
    id: "cupWidth",
    name: "Wider Cup",
    icon: "◡",
    desc: (l) => `Catch with a ${CHANGE_CUP_W + l * CUP_WIDTH_STEP}px mouth, up from ${CHANGE_CUP_W}px.`,
    baseCost: 60,
    growth: 1.55,
    maxLevel: 8,
    section: "change",
  },
  {
    id: "cupCap",
    name: "Tip Jar",
    icon: "▤",
    desc: (l) => `Hold up to $${(CHANGE_CAP_BASE + l * CHANGE_CAP_STEP) / 100} of change in one go.`,
    baseCost: 120,
    // Linear, to match a cap that grows by a flat $20 a level. On the old 1.7x
    // curve a level cost 40M by the top while still buying the same $15, so the
    // upgrade was dead from about level six.
    growth: 1,
    costStep: 120,
    maxLevel: 25,
    section: "change",
  },
  {
    id: "cupLuck",
    name: "Lucky Spill",
    icon: "✧",
    desc: (l) =>
      `Bigger denominations fall more often — average drop about ${Math.round(
        meanDrop(l),
      )}c, up from ${Math.round(meanDrop(0))}c.`,
    baseCost: 400,
    growth: 1.85,
    maxLevel: 10,
    section: "change",
  },
  {
    id: "cupAuto",
    name: "Steady Hands",
    icon: "⇔",
    desc: (l) =>
      `The cup drifts toward the nearest drop at ${Math.round(
        (autoSpeedAt(l) / CHANGE_CUP_SPEED) * 100,
      )}% of your own speed when you are not steering.`,
    baseCost: 900,
    growth: 2.3,
    maxLevel: 5,
    section: "change",
  },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export type UpgradeLevels = Record<string, number>;

export function levelOf(levels: UpgradeLevels, id: string): number {
  return levels[id] ?? 0;
}

export function costOf(upgrade: Upgrade, level: number): number {
  if (upgrade.costStep !== undefined) return upgrade.baseCost + upgrade.costStep * level;
  return Math.ceil(upgrade.baseCost * Math.pow(upgrade.growth, level));
}

/** Denominations available before any Table Limit is bought. */
export const BASE_DENOMS = 3;

/** Chip denominations ladder: 10, 50, 100, 500, 1k, 5k, ... */
export function denomAt(index: number): number {
  return 10 * Math.pow(10, Math.floor(index / 2)) * (index % 2 === 0 ? 1 : 5);
}

export function unlockedDenoms(levels: UpgradeLevels): number[] {
  // Three chips from the start, so bet sizing is a real choice on turn one
  // rather than something Table Limit slowly hands you.
  const n = levelOf(levels, "limit") + BASE_DENOMS;
  return Array.from({ length: n }, (_, i) => denomAt(i));
}

export function fmtDenom(v: number): string {
  if (v >= 1e9) return `${v / 1e9}B`;
  if (v >= 1e6) return `${v / 1e6}M`;
  if (v >= 1e3) return `${v / 1e3}k`;
  return String(v);
}

/** Pass unique relics — hasteMult multiplies, so duplicates would compound. */
export function spinIntervalMs(levels: UpgradeLevels, relics: Relic[]): number {
  let ms = BASE_SPIN_MS * Math.pow(0.92, levelOf(levels, "haste"));
  for (const r of relics) ms *= r.flags?.hasteMult ?? 1;
  return Math.max(MIN_SPIN_MS, ms);
}

export function offlineRate(relics: Relic[]): number {
  return relics.reduce((rate, r) => Math.max(rate, r.flags?.offlineRate ?? 0), 0.5);
}

export function startingChips(relics: Relic[]): number {
  return relics.reduce((seed, r) => Math.max(seed, r.flags?.seed ?? 0), 100);
}

/**
 * Flatten upgrade levels, owned relics and Ivory into the single `Edge` the
 * engine consumes. Recomputed from scratch whenever anything changes rather
 * than mutated in place, so there is no state to drift.
 */
export function buildEdge(
  levels: UpgradeLevels,
  relicIds: string[],
  ivory: number,
  layout?: Record<string, number>,
): Edge {
  const edge = neutralEdge();

  // No flat payout multiplier or loss rebate is sold any more. Both made a
  // red+black hedge profitable: covering both colours returns the stake on
  // every non-zero pocket, so any multiplier above 1 or any rebate at all turns
  // a no-risk layout positive. See the note in CLAUDE.md.
  edge.rebate = REBATE_PER_LEVEL * levelOf(levels, "rebate");
  edge.magnetism = 0.01 * levelOf(levels, "magnetism");
  edge.zeroInsurance = 0.2 * levelOf(levels, "insurance");
  edge.extraBalls = levelOf(levels, "balls");
  edge.longShotMult = 0.01 * levelOf(levels, "longshot");

  let perIvory = IVORY_PAYOUT;
  for (const [id, copies] of relicCounts(relicIds)) {
    const relic = RELIC_BY_ID.get(id);
    if (!relic) continue;
    // Copies beyond the first are worth progressively less, so stacking is a
    // real option without a third copy of one relic eclipsing every build.
    let scale = 0;
    for (let i = 0; i < copies; i++) scale += Math.pow(STACK_FALLOFF, i);
    if (relic.stacks === false) scale = 1;

    if (relic.edge) {
      for (const [key, value] of Object.entries(relic.edge) as [keyof Edge, number][]) {
        edge[key] += value * scale;
      }
    }
    perIvory += (relic.flags?.ivoryPayout ?? 0) * scale;
    // Sector Play: rewards spreading across several numbers rather than one.
    if (relic.flags?.magnetismPerStraight && layout) {
      const straights = Object.entries(layout).filter(
        ([id2, amount]) => amount > 0 && id2.startsWith("straight:"),
      ).length;
      edge.magnetism += relic.flags.magnetismPerStraight * straights * scale;
    }
  }
  edge.payoutMult += perIvory * ivory;

  edge.magnetism = Math.min(edge.magnetism, 0.95);
  edge.zeroInsurance = Math.min(edge.zeroInsurance, 1);
  edge.rebate = Math.min(edge.rebate, 0.95);
  return edge;
}


/* ---- Loose Change ------------------------------------------------------- */

/** Every drop in the spill, in cents: 5c..$1 in nickels, then the notes. */
export const CHANGE_DROPS: readonly number[] = [
  ...Array.from({ length: 20 }, (_, i) => (i + 1) * 5),
  500,
  1_000,
  2_000,
];
/** Anything at or above this draws as a bill rather than a coin. */
export const CHANGE_BILL_FROM = 500;
/**
 * Bills follow the same curve as the coins, then get nudged up by this much.
 * On the raw curve they land at about 0.5% between them — rare enough that most
 * runs never show one, which makes them a mechanic nobody discovers.
 */
const BILL_BOOST = 2.5;
/** How far Lucky Spill can flatten the curve. 1 would make it uniform. */
const LUCK_PER_LEVEL = 0.05;

/**
 * Weighted as 1/value, so a drop's frequency is inversely proportional to what
 * it is worth and every denomination contributes the same expected amount. A
 * flat weighting would make the big ones as common as the small ones and reduce
 * the game to waiting.
 *
 * Lucky Spill raises that curve to a power below 1, which flattens it toward
 * uniform. Scaling the big denominations up directly would do the same to the
 * average but would leave the nickel just as common; flattening moves frequency
 * from the bottom of the ladder to the top, which is what the upgrade claims.
 */
export function changeWeights(luckLevel: number): number[] {
  const p = 1 - Math.min(0.9, luckLevel * LUCK_PER_LEVEL);
  return CHANGE_DROPS.map(
    (v) => Math.pow(100 / v, p) * (v >= CHANGE_BILL_FROM ? BILL_BOOST : 1),
  );
}

/** Average value of one drop, in cents, at a given Lucky Spill level. */
export function meanDrop(luckLevel: number): number {
  const w = changeWeights(luckLevel);
  const sum = w.reduce((a, b) => a + b, 0);
  return CHANGE_DROPS.reduce((a, v, i) => a + v * w[i], 0) / sum;
}

/**
 * Auto-move speed, in px/s. Capped at the player's own speed by construction —
 * a cup that outruns you turns the game into watching, and the last level is
 * meant to feel like a steady hand, not an autopilot.
 */
export function autoSpeedAt(level: number): number {
  return (Math.min(5, level) / 5) * CHANGE_CUP_SPEED;
}

export interface ChangeMods {
  /** Mouth width in px. */
  cupW: number;
  /** Auto-drift speed in px/s, 0 when unbought. */
  autoSpeed: number;
  /** Drop weights, already biased by Lucky Spill. */
  weights: number[];
  /** Most change one scramble can hold, in cents. */
  capCents: number;
}

export function changeMods(levels: UpgradeLevels): ChangeMods {
  return {
    cupW: CHANGE_CUP_W + levelOf(levels, "cupWidth") * CUP_WIDTH_STEP,
    autoSpeed: autoSpeedAt(levelOf(levels, "cupAuto")),
    weights: changeWeights(levelOf(levels, "cupLuck")),
    capCents: CHANGE_CAP_BASE + levelOf(levels, "cupCap") * CHANGE_CAP_STEP,
  };
}
