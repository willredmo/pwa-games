export type PocketColor = "red" | "black" | "green";

/** The bet families offered in v1. Splits/streets/corners are deferred. */
export type BetKind =
  | "straight"
  | "red"
  | "black"
  | "odd"
  | "even"
  | "low"
  | "high"
  | "dozen"
  | "column";

export interface BetSpot {
  /** Stable key used as the layout map key, e.g. "straight:17", "dozen:2". */
  id: string;
  kind: BetKind;
  /** Pocket number for `straight`; 1-3 for `dozen`/`column`. Unused otherwise. */
  value?: number;
  label: string;
  /** Profit multiple on a win — a win returns stake + stake * payout. */
  payout: number;
}

/** Spot id -> chips staked on it. Absent/zero means no bet. */
export type Layout = Record<string, number>;

/**
 * Every way the player has bent the odds, flattened into one object.
 * Built by the game layer from upgrade levels + relics; the engine never
 * knows what an upgrade or a relic is.
 */
export interface Edge {
  /** Multiplies profit on wins. */
  payoutMult: number;
  /** Fraction of a losing stake handed back. */
  rebate: number;
  /** Chance the ball is nudged into a pocket the layout covers. */
  magnetism: number;
  /** Fraction of stake returned when the zero takes it. */
  zeroInsurance: number;
  /** Extra balls resolved against the same layout. Profit only, no stake back. */
  extraBalls: number;
  /** Profit multiplier applied to those extra balls. */
  /**
   * Extra profit multiplier on long-shot bets only (payout >= 8:1, i.e.
   * straights). Straights carry ~6x the variance of an even-money bet for the
   * same expected value, so without a lane of their own the extra risk buys
   * nothing and betting numbers is strictly a trap.
   */
  longShotMult: number;
  /** Multiple of total stake won when the zero hits (relic). */
  zeroBounty: number;
  /** Fraction of a straight payout paid on wheel-adjacent pockets (relic). */
  neighbourPay: number;
  /** Extra profit multiplier when the winning pocket is red / black. */
  redBonus: number;
  blackBonus: number;
  /** Extra profit multiplier per consecutive winning spin. */
  streakBonus: number;
  /** Extra profit multiplier when staking >= HIGH_ROLLER_FRACTION of bankroll. */
  highRollerBonus: number;
  /** Chance a winning spin pays out twice. */
  doubleChance: number;
}

export interface SpinInput {
  layout: Layout;
  edge: Edge;
  /** Only read for the high-roller threshold. */
  bankroll: number;
  /** Consecutive wins before this spin. */
  streak: number;
  rng: () => number;
}

export interface SpinResult {
  /** The pocket the wheel should be animated to. */
  pocket: number;
  /** Every pocket resolved this spin — the primary first, then extra balls. */
  balls: number[];
  /**
   * Index into `balls` of the one that was paid. Every ball is settled in
   * full and the best single outcome takes the spin, so `pocket` is
   * `balls[winner]`.
   */
  winner: number;
  /** Total chips committed. */
  stake: number;
  /** Total chips coming back: stake returned + profit + rebates. */
  returned: number;
  /** returned - stake. */
  net: number;
  won: boolean;
  /** True when magnetism moved the ball rather than the draw landing there. */
  magnetised: boolean;
  /** True when the doubleChance roll fired. */
  doubled: boolean;
}
