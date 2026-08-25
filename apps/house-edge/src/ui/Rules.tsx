import { OUTSIDE_SPOTS, POCKET_COUNT, STRAIGHT_PAYOUT } from "../engine";
import { IVORY_PAYOUT, levelOf, STACK_FALLOFF } from "../game/upgrades";
import { RELICS } from "../game/relics";
import {
  edgeOf,
  IVORY_SCALE,
  pendingIvory,
  relicSlots,
  RELIC_SLOTS_MAX,
  RELIC_SLOTS_PER_CASHOUT,
  type GameState,
} from "../game/state";
import { money } from "../game/format";
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
  const pending = pendingIvory(state);
  const slots = relicSlots(state);
  // What `peak` would have to reach for the next Ivory, so the ask is a number
  // rather than a mystery.
  const nextIvoryAt = Math.pow(pending + 1, 2) * IVORY_SCALE;
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
          Comp Points, En Prison and Neighbour&apos;s Cut come off a losing spin.
          {edge.rebate > 0 ? (
            <>
              {" "}
              You currently get <b>{(edge.rebate * 100).toFixed(1)}%</b> of a
              losing spin back.
            </>
          ) : null}{" "}
          They stop at breaking even, though — nothing can turn a spin you lost
          into a spin you won.
        </p>
        <p className="card-desc muted">
          Which makes them worth more than they look. A rebate does not just
          reduce a loss, it moves the line you have to clear: an even-money bet
          needs about <b>5.3%</b> back to break even against the zero, and
          anything past that is profit on a bet the house is supposed to win.
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

        <h3>Ivory is the payout multiplier</h3>
        <p className="card-desc">
          Cashing out banks your bankroll as <b>Ivory</b>, and each one is worth{" "}
          <b>+{(IVORY_PAYOUT * 100).toFixed(0)}%</b> payout forever. Nothing in
          the shop raises the multiplier — Ivory and relics are the only things
          that do, which is why cashing out is progress rather than a reset.
        </p>
        <p className="card-desc">
          You are paid on your <b>peak</b> bankroll this cycle, not on what you
          finish with, so a bad run after a good one costs you nothing. The
          amount is the square root of that peak over {money(IVORY_SCALE)}, which
          means each further Ivory needs a bigger peak than the last.
        </p>
        <p className="card-desc muted">
          You hold {state.ivory} Ivory. Cashing out now would add {pending} more,
          taking you to {state.ivory + pending} — the payout is added to what you
          already have, never swapped for it. The next Ivory needs a peak of{" "}
          {money(nextIvoryAt)}.
        </p>

        <h3>Relics are permanent, but only if equipped</h3>
        <p className="card-desc">
          Every cash out drafts <b>one relic from three</b>, out of{" "}
          {RELICS.length}. They survive every future cash out — but only the ones
          you have <b>equipped</b> do anything, and you have{" "}
          <b>
            {state.activeRelics.length}/{slots}
          </b>{" "}
          slots. A slot opens every {RELIC_SLOTS_PER_CASHOUT} cash outs, up to{" "}
          {RELIC_SLOTS_MAX}.
        </p>
        <p className="card-desc">
          Duplicates stack, each copy worth{" "}
          {(STACK_FALLOFF * 100).toFixed(0)}% of the one before, so a second copy
          is a real choice rather than an automatic one.
        </p>
        <p className="card-desc muted">
          Relics change what your layout is worth rather than adding a flat
          bonus: some pay only on red, or only on the zero, or only on the
          numbers either side of a straight. They reward committing to a plan,
          and everything they grant lands on your net like any other bonus.
        </p>

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
