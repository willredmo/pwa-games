import { OUTSIDE_SPOTS, POCKET_COUNT, STRAIGHT_PAYOUT } from "../engine";
import { levelOf } from "../game/upgrades";
import { edgeOf, type GameState } from "../game/state";
import { TIER_BIG, TIER_GOOD } from "./celebration";

interface Props {
  state: GameState;
  onClose: () => void;
}

/** House edge on a fair European wheel, as a percentage. */
const HOUSE_EDGE = (1 / POCKET_COUNT) * 100;

/**
 * How winnings work.
 *
 * Two of the rules here are invisible during play and both surprise people:
 * bonuses apply to a spin's *net* rather than to each bet, and a multi-ball
 * spin pays only its best ball. Players work out the payout table on their own
 * — nobody works those out by watching, and the first thing anyone tries when
 * they notice a payout multiplier is covering red and black.
 *
 * The payout column is read from the engine's own bet definitions rather than
 * retyped, so it cannot drift away from what the table actually pays.
 */
export function Rules({ state, onClose }: Props) {
  const edge = edgeOf(state);
  const extraBalls = levelOf(state.upgrades, "balls");
  const payouts = [
    { label: "Single number", pays: STRAIGHT_PAYOUT },
    // Dedupe by payout: three dozens and three columns all pay the same, and a
    // six-row table of identical numbers teaches nothing.
    ...[...new Map(OUTSIDE_SPOTS.map((s) => [s.payout, s])).values()].map((s) => ({
      label: s.payout === 2 ? "Dozen or column" : "Red/Black, Odd/Even, 1-18/19-36",
      pays: s.payout,
    })),
  ];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-inner rules" onClick={(e) => e.stopPropagation()}>
        <h2>How winnings work</h2>

        <h3>The table pays</h3>
        <ul className="rule-list">
          {payouts.map((p) => (
            <li key={p.label}>
              <span>{p.label}</span>
              <b>{p.pays}:1</b>
            </li>
          ))}
        </ul>
        <p className="card-desc">
          Win a bet and you get your stake back plus the payout. A $10 single
          number returns $360 — your $10 and $350 of profit.
        </p>

        <h3>The zero is the house edge</h3>
        <p className="card-desc">
          There are {POCKET_COUNT} pockets but the payouts are priced for 36. The
          zero is not red, not even and not low, so it takes every outside bet
          with it. That gap is worth{" "}
          <b>−{HOUSE_EDGE.toFixed(2)}%</b> of everything you stake, and clawing it
          back is the whole game.
        </p>

        <h3>Bonuses pay on your net, not on each bet</h3>
        <p className="card-desc">
          Your payout multiplier is currently <b>×{edge.payoutMult.toFixed(2)}</b>.
          It applies to what the <em>spin</em> won or lost, not to each winning
          bet on its own.
        </p>
        <p className="card-desc">
          So at ×1.20, betting $20 on red and $10 on a single number and landing
          on red pays <b>+$12</b> — the $10 you actually netted, times 1.2. Not
          +$14. A single bet is unaffected: a $10 straight at ×1.20 still pays
          +$420.
        </p>
        <p className="card-desc muted">
          Which is why covering red <em>and</em> black does nothing. One side wins
          exactly what the other loses, so the spin nets zero, and any multiple of
          zero is still zero. The only pocket that position can lose to is the
          green one.
        </p>

        <h3>Losses can be softened, never reversed</h3>
        <p className="card-desc">
          Rebates, En Prison and Neighbour&apos;s Cut come off a losing spin, but
          they stop at breaking even. Nothing can turn a spin you lost into a
          spin you won.
        </p>

        {extraBalls > 0 && (
          <>
            <h3>Best ball takes the spin</h3>
            <p className="card-desc">
              You have <b>{extraBalls + 1} balls</b>. Every one is settled in full
              against your whole layout and the <b>single best result</b> is paid
              — the biggest win, or failing that the smallest loss. The others pay
              nothing, so more balls are more chances, not more payouts.
            </p>
          </>
        )}

        <h3>Why some wins celebrate louder</h3>
        <p className="card-desc">
          Measured against your stake, not the amount — a big number means
          nothing once the bankroll is big. Past <b>{TIER_GOOD}×</b> your stake
          the pocket flares harder; past <b>{TIER_BIG}×</b>, which in practice
          means a single number landing, the wheel throws coins.
        </p>

        <button type="button" className="buy" onClick={onClose}>
          Back to the table
        </button>
      </div>
    </div>
  );
}
