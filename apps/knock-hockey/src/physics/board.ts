import { H, SEGMENTS, W } from "./table";

// Every match's board has a little character of its own, like a real wooden
// board: some stretches of rail are a touch livelier or deader, some bounce a
// fraction of a degree off true, and the playing surface has a few slightly
// slow patches. It's all generated from one seed saved with the match, so a
// board stays the same for the whole game, replays reproduce goals exactly,
// both online devices play the same board, and the CPU plans on it too.
//
// Kept deliberately small: it nudges shots, it doesn't change how the game is
// played (`pnpm sim feel` checks the corner shot and the CPU on many boards).
// Everything here is + − × ÷ on precomputed numbers, so it's as deterministic
// across browsers as the rest of the physics.

/** How strong each effect is. */
export const FEEL = {
  /** Bounciness varies by up to ± this (of 0.8) at a full-speed hit. */
  restitution: 0.06,
  /** A bounce can come off up to this far from true (radians, ≈1.4°) at a full-speed hit. */
  tilt: 0.025,
  /** Head-on speed at which edge effects are full strength; softer hits get less. */
  fullAt: 900,
  /** Slow patches add up to this much friction (never less than a true board). */
  surface: 0.18,
  /** Knots along each segment (one per this many units) and surface grid cell size. */
  edgeSpacing: 28,
  cell: 60,
} as const;

export interface BoardFeel {
  seed: number;
  /** Per segment (same order as SEGMENTS): knot values in −1…1 for bounciness and tilt. */
  edges: { e: number[]; tilt: number[] }[];
  /** Surface slowness lattice, values 0…1, `cols` × `rows`. */
  grid: number[];
  cols: number;
  rows: number;
}

/** A fresh seed for a new match. */
export const newBoardSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Build a board's character from its seed. */
export function makeBoard(seed: number): BoardFeel {
  const rnd = seeded(seed);
  const signed = () => rnd() * 2 - 1;
  const edges = SEGMENTS.map((s) => {
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    const knots = Math.max(2, Math.ceil(len / FEEL.edgeSpacing) + 1);
    return { e: Array.from({ length: knots }, signed), tilt: Array.from({ length: knots }, signed) };
  });
  const cols = Math.ceil(W / FEEL.cell) + 1;
  const rows = Math.ceil(H / FEEL.cell) + 1;
  // Mostly true, with the odd slow patch: only the top ~40% of values count.
  const grid = Array.from({ length: cols * rows }, () => Math.max(0, (rnd() - 0.6) / 0.4));
  return { seed, edges, grid, cols, rows };
}

const memo = new Map<number, BoardFeel>();
/** `makeBoard`, cached (the CPU's worker asks for the same board every turn). */
export function boardFor(seed: number | undefined | null): BoardFeel | null {
  if (seed == null) return null;
  let b = memo.get(seed);
  if (!b) {
    b = makeBoard(seed);
    memo.set(seed, b);
  }
  return b;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smoothly interpolated knot value at position t (0…1) along a segment. */
export function knot(values: number[], t: number): number {
  const f = t * (values.length - 1);
  const i = f < 0 ? 0 : f >= values.length - 1 ? values.length - 2 : Math.floor(f);
  const u = smooth(f - i);
  return values[i] + (values[i + 1] - values[i]) * u;
}

/** Extra friction factor at (x, y): 0 on a true patch, up to 1 on the slowest. */
export function slowness(b: BoardFeel, x: number, y: number): number {
  const fx = Math.min(Math.max(x / FEEL.cell, 0), b.cols - 1.0001);
  const fy = Math.min(Math.max(y / FEEL.cell, 0), b.rows - 1.0001);
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = smooth(fx - i);
  const v = smooth(fy - j);
  const g = (a: number, c: number) => b.grid[c * b.cols + a];
  const top = g(i, j) + (g(i + 1, j) - g(i, j)) * u;
  const bot = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * u;
  return top + (bot - top) * v;
}

/** Small seeded generator (integer ops only, so identical everywhere). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
