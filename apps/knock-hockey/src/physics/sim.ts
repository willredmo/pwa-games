import { GOAL_X0, GOAL_X1, H, PUCK_R, SEGMENTS, W, type GoalSide, type SurfaceKind, type Vec } from "./table";
import { FEEL, knot, slowness, type BoardFeel } from "./board";

// The puck simulation. Fixed timestep and no randomness, so the same start
// position and shot always play out exactly the same way on the same board
// (a match's `BoardFeel`, from physics/board.ts; null is a perfectly true board). The CPU relies on
// that: it picks shots by simulating candidates with `simulateShot`, and the
// screen then plays the chosen one back with `step`, frame by frame.

export const DT = 1 / 240;
/** Slowest and fastest a shot can launch the puck, in units per second. */
export const MIN_SPEED = 40;
export const MAX_SPEED = 1300;
/** Sliding friction: a constant slow-down plus drag in proportion to speed. */
const MU = 170;
const DRAG = 0.35;
/** Bounciness of wood on wood (share of the head-on speed kept). */
const RESTITUTION = 0.8;
/** Share of the along-the-wall speed lost on each bounce. */
const WALL_GRIP = 0.04;
const STOP_SPEED = 5;
/** Safety cap. A full-power shot settles in about 4 s. */
const MAX_STEPS = 240 * 12;

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A shot as it actually left the stick: where from, and the exact launch
 * velocity. Replaying this with `step` reproduces the shot bit for bit. */
export interface Launch {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  power: number;
}

/** A shot: direction in radians (0 = right, −π/2 = up the screen) and power 0–1. */
export interface Shot {
  angle: number;
  power: number;
}

export interface Contact {
  kind: SurfaceKind;
  /** Head-on speed at impact, for sound and effects. */
  speed: number;
  x: number;
  y: number;
}

/** Launch speed for a power. Curved so low power gives fine control for taps. */
export const shotSpeed = (power: number) => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(Math.min(1, Math.max(0, power)), 1.35);

/**
 * Every real hit wobbles a little — a stick never strikes quite where you
 * meant — so the same shot isn't a sure thing twice. One standard deviation of
 * angle (degrees) and power, capped at 2σ so a shot never goes wildly off.
 * Applied to every hit, yours and the CPU's, when the stick strikes; the
 * physics after it stays deterministic.
 */
export const WOBBLE = { deg: 0.9, power: 0.06 };

export function wobble(shot: Shot, rng: () => number = Math.random, scale = 1): Shot {
  const g = () => Math.max(-2, Math.min(2, gauss(rng)));
  return {
    angle: shot.angle + g() * ((WOBBLE.deg * scale * Math.PI) / 180),
    power: Math.min(1, Math.max(0.02, shot.power * (1 + g() * WOBBLE.power * scale))),
  };
}

function gauss(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Launch velocity, from a shot. Online, the shooter sends this velocity so
 * the other device never recomputes the sin/cos. */
export function launch(at: Vec, shot: Shot): Puck {
  const v = shotSpeed(shot.power);
  return { x: at.x, y: at.y, vx: Math.cos(shot.angle) * v, vy: Math.sin(shot.angle) * v };
}

export const moving = (p: Puck) => p.vx !== 0 || p.vy !== 0;

/**
 * Advance one fixed step. Pushes any contacts onto `contacts` (if given) and
 * returns the goal the puck just crossed into, if any. The puck's centre
 * crossing the goal line scores; it stops there.
 */
export function step(p: Puck, contacts?: Contact[], board?: BoardFeel | null): GoalSide | null {
  // Only + − × ÷ and sqrt from here on: those are exactly rounded in every JS
  // engine, so online opponents on different browsers simulate a shot
  // identically (Math.hypot, sin, cos can differ in the last bit).
  const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  if (speed === 0) return null;
  // Slow patches on this board's surface add friction.
  const mu = board ? MU * (1 + FEEL.surface * slowness(board, p.x, p.y)) : MU;
  const next = speed - (mu + DRAG * speed) * DT;
  if (next <= STOP_SPEED) {
    p.vx = p.vy = 0;
    return null;
  }
  const k = next / speed;
  p.vx *= k;
  p.vy *= k;
  p.x += p.vx * DT;
  p.y += p.vy * DT;

  for (let si = 0; si < SEGMENTS.length; si++) {
    const s = SEGMENTS[si];
    if (p.x < s.minX || p.x > s.maxX || p.y < s.minY || p.y > s.maxY) continue;
    // Closest point on the segment to the puck centre.
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    let t = ((p.x - s.ax) * ex + (p.y - s.ay) * ey) / (ex * ex + ey * ey);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = s.ax + ex * t;
    const cy = s.ay + ey * t;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= PUCK_R * PUCK_R || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    // Push out of the surface, then bounce if still moving into it.
    p.x = cx + nx * PUCK_R;
    p.y = cy + ny * PUCK_R;
    let vn = p.vx * nx + p.vy * ny;
    if (vn < 0) {
      const hit = -vn;
      let e = RESTITUTION;
      // This board's character at this spot on this rail: a little livelier or
      // deader, a fraction of a degree off true. Stronger the harder the hit.
      let bx = nx;
      let by = ny;
      if (board) {
        const edge = board.edges[si];
        const strength = hit >= FEEL.fullAt ? 1 : hit / FEEL.fullAt;
        e += FEEL.restitution * strength * knot(edge.e, t);
        const tilt = FEEL.tilt * strength * knot(edge.tilt, t);
        // Turn the normal slightly toward the rail's direction (small-angle).
        const tx0 = bx - tilt * ny;
        const ty0 = by + tilt * nx;
        const tl = Math.sqrt(tx0 * tx0 + ty0 * ty0);
        bx = tx0 / tl;
        by = ty0 / tl;
        const vnTilted = p.vx * bx + p.vy * by;
        if (vnTilted < 0) vn = vnTilted;
        else {
          bx = nx;
          by = ny;
        }
      }
      const tx = p.vx - vn * bx;
      const ty = p.vy - vn * by;
      p.vx = tx * (1 - WALL_GRIP) - vn * e * bx;
      p.vy = ty * (1 - WALL_GRIP) - vn * e * by;
      contacts?.push({ kind: s.kind, speed: hit, x: cx, y: cy });
    }
  }

  if (p.x > GOAL_X0 && p.x < GOAL_X1) {
    if (p.y < 0) return stopIn(p, "top");
    if (p.y > H) return stopIn(p, "bottom");
  }
  // Belt and braces: never leave the board (the fuzz test checks this never fires).
  if (p.x < PUCK_R - 1 || p.x > W - PUCK_R + 1 || p.y < PUCK_R - 1 || p.y > H - PUCK_R + 1) {
    if (!(p.x > GOAL_X0 && p.x < GOAL_X1)) {
      p.x = Math.min(W - PUCK_R, Math.max(PUCK_R, p.x));
      p.y = Math.min(H - PUCK_R, Math.max(PUCK_R, p.y));
      escapes++;
    }
  }
  return null;
}

/** How many times the clamp above has fired (for the fuzz test). */
export let escapes = 0;

function stopIn(p: Puck, goal: GoalSide): GoalSide {
  p.vx = p.vy = 0;
  return goal;
}

export interface ShotResult {
  goal: GoalSide | null;
  rest: Vec;
  steps: number;
  /** Surfaces hit, in order. */
  contacts: Contact[];
}

/** Play a shot out to the end, headless. */
export function simulateShot(at: Vec, shot: Shot, board?: BoardFeel | null): ShotResult {
  const p = launch(at, shot);
  const contacts: Contact[] = [];
  let goal: GoalSide | null = null;
  let steps = 0;
  while (moving(p) && steps < MAX_STEPS) {
    goal = step(p, contacts, board);
    steps++;
    if (goal) break;
  }
  return { goal, rest: { x: p.x, y: p.y }, steps, contacts };
}

/** Cheaper version for the CPU's search: only the goal and resting point. */
export function quickShot(at: Vec, shot: Shot, board?: BoardFeel | null): { goal: GoalSide | null; x: number; y: number } {
  const p = launch(at, shot);
  let steps = 0;
  while (moving(p) && steps < MAX_STEPS) {
    const goal = step(p, undefined, board);
    steps++;
    if (goal) return { goal, x: p.x, y: p.y };
  }
  return { goal: null, x: p.x, y: p.y };
}
