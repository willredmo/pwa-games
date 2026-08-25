import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./motion";

/** Past this multiple of the old value, rolling reads as a stall, not a climb. */
const SNAP_RATIO = 8;
/** Below this absolute change there is nothing to watch. */
const SNAP_ABSOLUTE = 0.01;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Ease a displayed number toward its real value.
 *
 * The value returned is for *display only* — the caller's own state has already
 * moved. This never gates anything the player can act on, so a roll-up in
 * progress cannot make a bankroll look affordable when it is not: it is always
 * catching up to a number that is already true, and it always arrives.
 *
 * `durationMs` should be shortened to fit the auto-spin cadence. At max
 * Croupier's Haste a spin lands every ~200ms, and a 450ms roll-up would never
 * reach its target before the next one restarted it — the figure would drift
 * permanently behind the bankroll it is supposed to report.
 */
export function useCountUp(value: number, durationMs = 450): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const startedAt = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    const jump = Math.abs(value - from.current);
    // A prestige, a Loose Change payout or a dev grant moves the bankroll by
    // orders of magnitude. Rolling those is not a flourish, it is a wait.
    const huge = jump > Math.abs(from.current) * SNAP_RATIO;
    if (prefersReducedMotion() || huge || jump < SNAP_ABSOLUTE || durationMs <= 0) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = from.current;
    startedAt.current = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt.current) / durationMs);
      const at = start + (value - start) * easeOut(t);
      from.current = at;
      setShown(at);
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        // Land exactly on the real figure; easing alone leaves float dust.
        from.current = value;
        setShown(value);
      }
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, durationMs]);

  return shown;
}
