import { ALL_SPOTS, LONG_SHOT_THRESHOLD, type Edge } from "../engine";
import { neutralEdge } from "../engine";
import { RELIC_BY_ID, relicCounts, type Relic } from "./relics";
import { LINK_SHARE, type SpotMods } from "./spots";

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

/**
 * Milliseconds between drops in Loose Change before Rush Hour, and the floor it
 * works toward. The floor is the point of the whole curve: below roughly 90ms
 * the play area is a solid curtain of coins, and catching stops being a choice
 * about which drop to go for. Each level closes a share of the *remaining* gap
 * rather than a flat amount, so the upgrade can never overshoot into that.
 */
export const CHANGE_SPAWN_BASE = 250;
export const CHANGE_SPAWN_FLOOR = 95;
const SPAWN_STEP = 0.16;

/**
 * Chance a caught drop counts twice, per level of Double Take.
 *
 * Note this is *not* the flat payout multiplier the mini game used to have and
 * which was deliberately taken out. That one scaled the whole take at the end,
 * which made the number on screen a lie while you were playing. This resolves
 * per catch, so the total shown is always exactly what you are holding.
 */
const DOUBLE_PER_LEVEL = 0.04;

export function doubleChanceAt(level: number): number {
  return Math.min(0.6, DOUBLE_PER_LEVEL * level);
}

export function spawnGapAt(level: number): number {
  return (
    CHANGE_SPAWN_FLOOR +
    (CHANGE_SPAWN_BASE - CHANGE_SPAWN_FLOOR) * Math.pow(1 - SPAWN_STEP, level)
  );
}

/**
 * Auto-spin interval before Haste and the Marathon relic. Deliberately slow:
 * at 900ms the ball had no time to ride the track, so auto-spin read as a
 * number generator rather than a wheel. Haste still buys back ~8x from here.
 */
export const BASE_SPIN_MS = 2_600;
export const MIN_SPIN_MS = 120;

/**
 * Which bets Long Shot actually applies to, named rather than left as an odds
 * threshold. Right now the answer is "single numbers and nothing else" — every
 * outside bet pays 2:1 or 1:1 — so a card reading "8:1 or better" described a
 * category with exactly one member and sent players looking for the others.
 *
 * Derived from the bet table so it stays true on its own: add splits at 17:1
 * and this starts saying "splits and single numbers" without being edited.
 */
const LONG_SHOT_NAMES: Record<string, string> = {
  straight: "single numbers",
  split: "splits",
  street: "streets",
  corner: "corners",
};

function longShotLabel(): string {
  const kinds = [...new Set(ALL_SPOTS.filter((s) => s.payout >= LONG_SHOT_THRESHOLD).map((s) => s.kind))];
  const names = kinds.map((k) => LONG_SHOT_NAMES[k] ?? k);
  if (names.length === 0) return "nothing on the table";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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
    desc: (l) =>
      `+${l}% payout on ${longShotLabel()} — the only bet paying ` +
      `${LONG_SHOT_THRESHOLD}:1 or better.`,
    baseCost: 2_000,
    growth: 1.46,
    maxLevel: 20,
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
    id: "spotDouble",
    name: "Gild a Pocket",
    icon: "◈",
    desc: (l) => `Mark ${l} pocket${l === 1 ? "" : "s"} to pay double when it lands.`,
    baseCost: 3_000,
    growth: 2.4,
    maxLevel: 6,
  },
  {
    id: "spotFree",
    name: "House Account",
    icon: "⊘",
    desc: (l) =>
      `Mark ${l} pocket${l === 1 ? "" : "s"} that hands your stake back — landing there costs nothing.`,
    baseCost: 4_000,
    growth: 2.6,
    maxLevel: 4,
  },
  {
    id: "spotLink",
    name: "Linked Pair",
    icon: "⧉",
    desc: (l) =>
      `Wire ${l} pair${l === 1 ? "" : "s"} of numbers together: a straight on one also pays ` +
      `${Math.round(LINK_SHARE * 100)}% on the other.`,
    baseCost: 12_000,
    growth: 3.2,
    maxLevel: 4,
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
    id: "cupRate",
    name: "Rush Hour",
    icon: "⋮⋮",
    desc: (l) =>
      `Change spills ${(CHANGE_SPAWN_BASE / spawnGapAt(l)).toFixed(2)}x as fast, ` +
      `a drop every ${Math.round(spawnGapAt(l))}ms.`,
    baseCost: 250,
    // Linear, for the same reason Tip Jar had to be: each level closes a share
    // of the *remaining* gap to the floor, so the drop rate it buys is flat and
    // then declining — 0.64 more drops a second at level 1, 0.48 by level 10.
    // On a 1.6x curve the last level cost $17,180 for about $5/min, and the
    // upgrade was dead well before its maximum. Flat benefit, flat price, so
    // every level pays for itself in roughly the same time.
    growth: 1,
    costStep: 250,
    maxLevel: 10,
    section: "change",
  },
  {
    id: "cupDouble",
    name: "Double Take",
    icon: "❊",
    desc: (l) => `${(doubleChanceAt(l) * 100).toFixed(0)}% chance a catch counts twice.`,
    baseCost: 300,
    // Each level is a flat +4 percentage points, so the price is flat too.
    growth: 1,
    costStep: 300,
    maxLevel: 10,
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

/**
 * Every chip on the table, always. There is no upgrade gating these any more.
 *
 * Table Limit used to hand them out one at a time and was described here as the
 * most important curve in the economy — on the theory that a chip too small for
 * your bankroll leaves the affordable stake falling further behind every level.
 * That stopped being true once `maxLayout` scaled by `floor(chips / stake)` and
 * snapped to `MIN_CHIP` rather than to the selected chip: **Max already reaches
 * the whole bankroll whatever chip is chosen**, so the ladder was buying taps
 * saved rather than stake allowed, and an upgrade whose only effect is fewer
 * clicks is not an upgrade.
 *
 * What replaces it for hand-built layouts is the x5 and x10 scale buttons.
 */
export const DENOMS: readonly number[] = [10, 50, 100, 1_000];

/** Chip denominations ladder: 10, 50, 100, 500, 1k, 5k, ... */
export function denomAt(index: number): number {
  return 10 * Math.pow(10, Math.floor(index / 2)) * (index % 2 === 0 ? 1 : 5);
}

export function unlockedDenoms(_levels: UpgradeLevels): number[] {
  return [...DENOMS];
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
/** Edge fields that are plain magnitudes, which is everything except `spots`. */
type NumericEdgeKey = {
  [K in keyof Edge]: Edge[K] extends number ? K : never;
}[keyof Edge];

export function buildEdge(
  levels: UpgradeLevels,
  relicIds: string[],
  ivory: number,
  layout?: Record<string, number>,
  spots?: SpotMods,
): Edge {
  const edge = neutralEdge();
  if (spots) {
    edge.spots = {
      double: spots.double,
      free: spots.free,
      links: spots.links,
      linkShare: LINK_SHARE,
    };
  }

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
      // Only the numeric dials. `spots` is a set of placements rather than a
      // magnitude, so it has no meaning to add into and no relic touches it.
      for (const [key, value] of Object.entries(relic.edge) as [NumericEdgeKey, number][]) {
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
  /** Milliseconds between drops. */
  spawnGap: number;
  /** Chance a catch counts twice, 0..0.6. */
  doubleChance: number;
}

export function changeMods(levels: UpgradeLevels): ChangeMods {
  return {
    cupW: CHANGE_CUP_W + levelOf(levels, "cupWidth") * CUP_WIDTH_STEP,
    autoSpeed: autoSpeedAt(levelOf(levels, "cupAuto")),
    weights: changeWeights(levelOf(levels, "cupLuck")),
    spawnGap: spawnGapAt(levelOf(levels, "cupRate")),
    doubleChance: doubleChanceAt(levelOf(levels, "cupDouble")),
  };
}
