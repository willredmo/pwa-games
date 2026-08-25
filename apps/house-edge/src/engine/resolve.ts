import type { BetSpot, Edge, SpinInput, SpinResult } from "./types";
import { covers, coveredPockets, spotById, totalStake, STRAIGHT_PAYOUT } from "./bets";
import { colorOf, neighbours, spinWheel, POCKET_COUNT } from "./wheel";

/** Payout odds at or above which a bet counts as a long shot. */
export const LONG_SHOT_THRESHOLD = 8;

/** Stake share of bankroll that counts as a high-roller spin. */
export const HIGH_ROLLER_FRACTION = 0.25;

/** A wheel with nothing bought yet: straight European odds, -2.70% per unit. */
export function neutralEdge(): Edge {
  return {
    payoutMult: 1,
    rebate: 0,
    magnetism: 0,
    zeroInsurance: 0,
    extraBalls: 0,
    longShotMult: 0,
    zeroBounty: 0,
    neighbourPay: 0,
    redBonus: 0,
    blackBonus: 0,
    streakBonus: 0,
    highRollerBonus: 0,
    doubleChance: 0,
  };
}

interface Tally {
  /** Profit from winning spots at true odds, before any edge is applied. */
  baseProfit: number;
  /** The same profit with every win-side multiplier applied. */
  bonusProfit: number;
  /** Stake on spots that missed. */
  lostStake: number;
  /** Loss-side credits: rebate, zero insurance, neighbour pay. */
  softCredit: number;
}

interface StakedSpot {
  spot: BetSpot;
  amount: number;
}

function stakedSpots(layout: SpinInput["layout"]): StakedSpot[] {
  const out: StakedSpot[] = [];
  for (const [id, amount] of Object.entries(layout)) {
    if (amount <= 0) continue;
    const spot = spotById(id);
    if (spot) out.push({ spot, amount });
  }
  return out;
}

/**
 * Resolve one spin. Pure — takes its randomness as an injected `rng` and
 * mutates nothing, so the UI can hold the result while the wheel animates and
 * a replay/offline path can run the same function headlessly.
 */
export function resolveSpin(input: SpinInput): SpinResult {
  const { layout, edge, bankroll, streak, rng } = input;
  const stake = totalStake(layout);
  const spots = stakedSpots(layout);

  let pocket = spinWheel(rng);
  let magnetised = false;
  const covered = coveredPockets(layout);

  if (stake > 0 && edge.magnetism > 0) {
    // Nothing to gain if the layout already wins here, or covers everything.
    const alreadyWinning = covered.includes(pocket);
    if (!alreadyWinning && covered.length > 0 && covered.length < POCKET_COUNT) {
      if (rng() < edge.magnetism) {
        pocket = covered[Math.floor(rng() * covered.length)];
        magnetised = true;
      }
    }
  }

  const balls = [pocket];
  if (stake === 0) {
    return {
      pocket,
      balls,
      winner: 0,
      stake: 0,
      returned: 0,
      net: 0,
      won: false,
      magnetised,
      doubled: false,
    };
  }

  const doubled = edge.doubleChance > 0 && rng() < edge.doubleChance;

  // Per-spin multipliers: these describe the throw, not where a ball ended up.
  let spinMult = edge.payoutMult;
  spinMult *= 1 + edge.streakBonus * streak;
  if (bankroll > 0 && stake >= bankroll * HIGH_ROLLER_FRACTION) {
    spinMult *= 1 + edge.highRollerBonus;
  }
  if (doubled) spinMult *= 2;

  /**
   * The colour bonuses depend on where *that* ball landed, so with several
   * balls in play the multiplier has to be resolved per ball rather than once
   * for the spin. Folding them into `spinMult` off the primary pocket would
   * pay Crimson Devotion on a black ball that happened to share a spin with a
   * red one.
   */
  const multFor = (landed: number) => {
    const color = colorOf(landed);
    if (color === "red") return spinMult * (1 + edge.redBonus);
    if (color === "black") return spinMult * (1 + edge.blackBonus);
    return spinMult;
  };

  const longShot = (spot: BetSpot) =>
    spot.payout >= LONG_SHOT_THRESHOLD ? 1 + edge.longShotMult : 1;

  /**
   * Settle one ball against the layout, twice over: once at **true European
   * odds** with no edge at all, and once with every win-side multiplier
   * applied. The pair is what makes net settlement possible — see `settle`.
   */
  const tally = (landed: number) => {
    const mult = multFor(landed);
    const [nLeft, nRight] = neighbours(landed);
    let baseProfit = 0; // profit at true odds
    let bonusProfit = 0; // the same profit, enhanced
    let lostStake = 0;
    let softCredit = 0; // rebate / insurance / neighbour pay — all loss-side

    for (const { spot, amount } of spots) {
      if (covers(spot, landed)) {
        baseProfit += amount * spot.payout;
        bonusProfit += amount * spot.payout * mult * longShot(spot);
        continue;
      }
      lostStake += amount;
      // A miss: rebate, or the softer zero-insurance rate when the zero took it.
      const softening =
        landed === 0 ? Math.max(edge.rebate, edge.zeroInsurance) : edge.rebate;
      softCredit += amount * softening;
      // Wheel-adjacent straights pay a fraction (relic).
      if (
        edge.neighbourPay > 0 &&
        spot.kind === "straight" &&
        (spot.value === nLeft || spot.value === nRight)
      ) {
        softCredit += amount * STRAIGHT_PAYOUT * edge.neighbourPay * mult * longShot(spot);
      }
    }
    return { baseProfit, bonusProfit, lostStake, softCredit };
  };

  /**
   * Net settlement — the rule that closes the red/black hedge.
   *
   * Every bonus is applied to what the spin **actually won or lost at true
   * odds**, never to the gross return. A layout covering both colours returns
   * its stake on every non-zero pocket, so its true net is exactly zero, and
   * zero multiplied by any payout bonus is still zero.
   *
   * Settling per bet instead lets the winning half collect an enhanced payout
   * while the losing half collects a rebate, out of a position that never had
   * anything at risk. That made seven of the nine bonuses individually
   * profitable on a hedge — Second Ball worst at +21.6% per dollar staked.
   */
  const settle = ({ baseProfit, bonusProfit, lostStake, softCredit }: Tally) => {
    const trueNet = baseProfit - lostStake;
    if (trueNet > 0) {
      // A genuine win: scale the whole net by how much the edge enhanced it.
      // Taking the ratio rather than a flat multiplier keeps the per-bet
      // weighting of Long Shot intact.
      const ratio = baseProfit > 0 ? bonusProfit / baseProfit : 1;
      return trueNet * ratio + softCredit;
    }
    // A genuine loss: credits soften it, but can never carry it above zero.
    return Math.min(0, trueNet + softCredit);
  };

  /** What this spin is worth if `landed` is the ball that counts. */
  const netFor = (landed: number) => {
    let n = settle(tally(landed));
    if (landed === 0 && edge.zeroBounty > 0) {
      // Green Tithe pays a profit on the zero, which net settlement cannot
      // express — on a hedge the zero is the *only* losing pocket, so an
      // unconditional bounty hands back exactly what the hedge is missing.
      // Scaling by the share of the wheel left uncovered prices it against the
      // risk actually taken: near-full for a straight bet, near-nil for a
      // layout that already covers 36 pockets.
      //
      // The second term is the same argument applied to the zero itself. A
      // bounty compensates for what the zero costs you, so a fully insured
      // zero has nothing to compensate — otherwise En Prison at max level
      // (100%) plus Green Tithe is a hedge that cannot lose *and* gets paid,
      // which measured +0.80% even with the coverage term already in place.
      const insured = Math.min(1, Math.max(edge.rebate, edge.zeroInsurance));
      const risk = (1 - covered.length / POCKET_COUNT) * (1 - insured);
      n += stake * edge.zeroBounty * multFor(landed) * risk;
    }
    return n;
  };

  // Drawn *without replacement*: two balls cannot come to rest in the same
  // pocket, because a pocket only holds one ball. Rejection sampling keeps the
  // draw uniform over whatever is still free, and the guard is belt-and-braces
  // against a degenerate rng — the wheel has 37 pockets and at most 5 balls.
  for (let i = 0; i < edge.extraBalls && balls.length < POCKET_COUNT; i++) {
    let extra = spinWheel(rng);
    for (let guard = 0; balls.includes(extra) && guard < 500; guard++) {
      extra = spinWheel(rng);
    }
    if (!balls.includes(extra)) balls.push(extra);
  }

  /**
   * Best ball takes the spin. Every ball is settled in full against the whole
   * layout and the **best single outcome** is paid — highest win, or failing
   * that the smallest loss. Only one ball is ever paid, so the ceiling on a
   * spin is one bet's payout however many balls are in the air.
   *
   * The alternative — paying every ball that wins — makes each extra ball
   * worth a flat slab of EV on top of the last, which is why four balls came
   * to roughly four times the value of one and the upgrade's compounding cost
   * curve could never track it.
   *
   * The smallest-loss half of the rule is not a special case: a losing ball
   * can still differ from its siblings through zero insurance, or through
   * Neighbour's Cut paying on the pockets either side of a straight.
   */
  let winner = 0;
  let net = netFor(balls[0]);
  for (let i = 1; i < balls.length; i++) {
    const candidate = netFor(balls[i]);
    if (candidate > net) {
      net = candidate;
      winner = i;
    }
  }

  const returned = stake + net;
  return {
    pocket: balls[winner],
    balls,
    winner,
    stake,
    returned,
    net,
    won: net > 0,
    magnetised: magnetised && winner === 0,
    doubled,
  };
}
