import { useEffect, useRef, useState } from "react";
import { MAX_LEVEL } from "../engine/units";

// The first-match tutorial: a coach card over a real match against Easy. Each
// step either waits for the player to do the thing (place a unit, battle,
// merge, take an upgrade) or has a Next button, and the part of the screen it
// talks about is outlined (`spot`, a selector given the `tut-spot` class).
// Doing beats reading, so it explains a rule just as the player meets it.
// Game rigs the first two offers (TUTORIAL_OFFERS) so a merge is always there.

/** What the coach reads from the match. */
export interface TutorialState {
  phase: string;
  round: number;
  picksLeft: number;
  /** Units on your row. */
  units: number;
  /** Highest level on your row. */
  topLevel: number;
}

interface Step {
  title: string;
  text: React.ReactNode;
  /** Outlined while the step is up. */
  spot?: string;
  /** Show a Next button. */
  next?: boolean;
  /** Hidden until this holds (e.g. the upgrade step waits for round 3). */
  waitFor?: (s: TutorialState) => boolean;
  /** Advances by itself once this holds; `at` is the state when the step began. */
  until?: (s: TutorialState, at: TutorialState) => boolean;

}

/**
 * A step that's only read moves on by itself once the player plays on to the
 * next round, so ignoring Next never strands the tutorial (and the steps that
 * wait for round 3's upgrade still come up).
 */
const playedOn = (s: TutorialState, at: TutorialState) => s.round > at.round;

const STEPS: Step[] = [
  {
    title: "Welcome to Duel Deck",
    text: (
      <>
        You and the enemy each build a <strong>row of up to 5 units</strong>. Yours is the blue half at the bottom, theirs the
        red half at the top. Each round the rows clash, front to front.
      </>
    ),
    spot: ".app__stage",
    next: true,
    // Someone who starts picking straight away has got the idea.
    until: (s, at) => s.picksLeft < at.picksLeft || playedOn(s, at),
  },
  {
    title: "Pick a unit",
    text: (
      <>
        Each round you're dealt 5 cards and take <strong>2</strong>. Tap a card, then tap the first empty slot of your row (or
        drag it there).
      </>
    ),
    spot: ".hand",
    until: (s, at) => s.picksLeft < at.picksLeft,
  },
  {
    title: "Take a second",
    text: (
      <>
        Slot 1 is your <strong>front</strong>: it meets the enemy first. Take one more card. You can drag placed units to
        reorder them, and ↶ Undo takes a move back.
      </>
    ),
    spot: ".hand",
    until: (s) => s.picksLeft === 0,
  },
  {
    title: "Battle!",
    text: (
      <>
        When your row looks right, press <strong>⚔ Battle</strong>. The enemy builds its row at the same time.
      </>
    ),
    spot: ".hud .primary-btn",
    until: (s) => s.phase === "battle",
  },
  {
    title: "How a round plays",
    text: (
      <>
        Only the two <strong>front units</strong> fight. When one falls, the next in line steps up. The side still standing
        wins the round, and each of its survivors hits the loser's <strong>HP</strong> for its attack. Tap{" "}
        <strong>▶ 1×</strong> to speed battles up.
      </>
    ),
    until: (s) => s.phase === "pick" && s.round >= 2,
  },
  {
    title: "Your row is permanent",
    text: (
      <>
        Everyone who fell is back, at full health: your row only grows. Both players start with <strong>200 HP</strong> (the
        bars above and below the board), and the first to reach 0 loses.
      </>
    ),
    next: true,
    until: playedOn,
  },
  {
    title: "Merge to level up",
    text: (
      <>
        Drop a card on a unit <strong>of the same type</strong> to merge it in: the unit gains half the card's stats and a
        level. Try it with a card that matches one of yours. Levels stop at {MAX_LEVEL}, where the unit's ability gets
        stronger (★ Mastery).
      </>
    ),
    spot: ".hand",
    until: (s, at) => s.topLevel > at.topLevel || playedOn(s, at),
    next: true,
  },
  {
    title: "Know your units",
    text: (
      <>
        Press and hold any unit or card (or hover it with a mouse) to see its ability and what's changing its numbers. The ☰
        menu has every unit and a quick rules recap.
      </>
    ),
    next: true,
    until: playedOn,
  },
  {
    title: "Classes",
    text: (
      <>
        The corner of each card shows its class: <strong>⚔ Attack</strong>, <strong>🛡 Defense</strong> or{" "}
        <strong>✚ Support</strong>. Fill <em>every</em> slot with one class and the whole row gets a bonus each round.
      </>
    ),
    spot: ".hand",
    next: true,
    until: playedOn,
  },
  {
    title: "Reroll and freeze",
    text: (
      <>
        <strong>🎲 Reroll</strong> swaps the cards you haven't taken. <strong>❄</strong> on a card keeps it for next round.
        Finish your picks and battle: round 3 brings your first upgrade.
      </>
    ),
    spot: ".reroll-btn",
    until: (s) => s.phase === "augment",
  },
  {
    title: "Upgrades",
    text: (
      <>
        Every 3rd round you choose an <strong>upgrade</strong> that lasts the whole match. All three cards share a rarity
        (silver, gold or prismatic, the same for your opponent), and <strong>↻</strong> under a card rerolls it once. Tap
        one to select it, then press <strong>Take</strong>.
      </>
    ),
    waitFor: (s) => s.phase === "augment",
    until: (s) => s.phase !== "augment",
  },
  {
    title: "You're ready",
    text: <>That's everything you need. Play this match out against Easy, then try Normal or Hard, or duel a friend online.</>,
    next: true,
    until: playedOn,
  },
];

export const TUTORIAL_DONE_KEY = "duel-deck:tutorial-done";

export function markTutorialDone(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, "1");
  } catch {
    /* it will be offered again; harmless */
  }
}

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function Tutorial({ state }: { state: TutorialState }) {
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const at = useRef(state);
  const step = STEPS[index];

  const advance = () => {
    at.current = state;
    if (index + 1 >= STEPS.length) {
      markTutorialDone();
      setClosed(true);
    } else setIndex(index + 1);
  };

  /** Whether this step's `waitFor` has held: it only gates a step's first appearance. */
  const [started, setStarted] = useState(false);
  useEffect(() => setStarted(false), [index]);
  const waiting = !!step?.waitFor && !started && !step.waitFor(state);

  useEffect(() => {
    if (closed || !step) return;
    if (waiting) {
      at.current = state;
      return;
    }
    if (!started) setStarted(true);
    if (step.until?.(state, at.current)) advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.round, state.picksLeft, state.units, state.topLevel, index, closed]);

  // Outline what the step is about.
  useEffect(() => {
    if (closed || !step?.spot) return;
    const el = document.querySelector(step.spot);
    el?.classList.add("tut-spot");
    return () => el?.classList.remove("tut-spot");
  }, [index, closed, step?.spot, state.phase]);

  if (closed || !step) return null;
  if (waiting) return null;
  // Battles need the whole board; only the step about battles stays up.
  if (state.phase === "battle" && index !== 4) return null;

  const skip = () => {
    markTutorialDone();
    setClosed(true);
  };

  // Top of the screen while picking (the cards are at the bottom); bottom for
  // battles and upgrades, which need the board and the middle.
  const bottom = state.phase === "battle" || state.phase === "augment";

  return (
    <div className={`tut${bottom ? " tut--bottom" : ""}`} role="dialog" aria-label="Tutorial">
      <div className="tut__head">
        <strong>{step.title}</strong>
        <span className="tut__count">
          {index + 1}/{STEPS.length}
        </span>
      </div>
      <p className="tut__text">{step.text}</p>
      <div className="tut__actions">
        <button className="link-btn" onClick={skip}>
          Skip tutorial
        </button>
        {step.next && (
          <button className="primary-btn" onClick={advance}>
            {index + 1 >= STEPS.length ? "Let's go" : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}
