const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Live reduced-motion preference for the canvas code. CSS handles the DOM side
 * with the same media query; this exists because a canvas cannot be styled.
 *
 * Read on every frame rather than captured once — the preference can change
 * while the game is open (a system setting, or a browser devtools emulation),
 * and a wheel that keeps throwing sparks after someone asks it to stop is
 * exactly the failure the setting exists to prevent.
 */
let reduced = false;

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia(QUERY);
  reduced = mq.matches;
  // Safari below 14 has no addEventListener on MediaQueryList.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", (e) => {
      reduced = e.matches;
    });
  } else if (typeof mq.addListener === "function") {
    mq.addListener((e) => {
      reduced = e.matches;
    });
  }
}

/**
 * True when the player has asked for less motion. Callers drop *decorative*
 * motion only: the wheel still spins and the ball still flies, because that is
 * the game rather than an embellishment. What goes is the confetti-adjacent
 * layer — particles, flares, counter roll-ups.
 */
export function prefersReducedMotion(): boolean {
  return reduced;
}
