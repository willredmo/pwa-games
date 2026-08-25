/**
 * How loudly to celebrate a win.
 *
 * Measured against the **stake**, never the amount. This is an incremental
 * game: bankrolls grow without limit, so a million-dollar win means nothing at
 * a billion-dollar table and any absolute threshold is obsolete within an hour
 * of play. The multiple is what stays meaningful for the whole game.
 *
 * The boundaries are not round numbers picked by feel — they sit in the gaps
 * between what the layout can actually pay, measured over 300k spins each:
 *
 *   1x   even-money bets, hit on 48.5% of spins
 *   2x   a dozen or a column
 *   5x   a straight landing in a six-straight spread
 *   9x   a straight landing alongside outside bets
 *   35x  a straight on its own, hit on 2.8% of spins
 *
 * So 3x separates "the table paid out" from "you hit something", and 12x
 * separates that from "you hit a straight". Nothing lands between the tiers and
 * a boundary, which is what keeps the same event from celebrating differently
 * on different spins.
 */
export const TIER_GOOD = 3;
export const TIER_BIG = 12;

export type WinTier = 0 | 1 | 2 | 3;

export function winTier(net: number, stake: number): WinTier {
  if (net <= 0 || stake <= 0) return 0;
  const multiple = net / stake;
  if (multiple >= TIER_BIG) return 3;
  if (multiple >= TIER_GOOD) return 2;
  return 1;
}

/**
 * Flare strength handed to the renderer, and how many coins erupt from the
 * pocket. Tier 1 is deliberately unchanged from an ordinary spin — half of all
 * spins win something, and a game that throws a party every other spin has no
 * way left to mark the spin that matters.
 */
export function celebrationOf(tier: WinTier): { flare: number; coins: number } {
  switch (tier) {
    case 3:
      return { flare: 2.2, coins: 26 };
    case 2:
      return { flare: 1.5, coins: 11 };
    case 1:
      return { flare: 1, coins: 0 };
    default:
      return { flare: 1, coins: 0 };
  }
}
