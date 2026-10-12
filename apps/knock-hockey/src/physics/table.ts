// The board, in board units (about one CSS pixel on a phone). The origin is
// the inside corner of the top-left rail: x runs right, y runs down, and the
// playing surface is [0, W] × [0, H]. Every shape the puck can hit is a line
// segment; a segment's ends act as round posts, so corners and goal posts
// bounce properly with no special cases.
//
//   ┌──╲────[ GOAL ]────╱──┐  y = 0   (top goal: Player 1 shoots at it)
//   │   ╲       ◇      ╱   │
//   │           ●          │          centre ice
//   │   ╱       ◇      ╲   │
//   └──╱────[ GOAL ]────╲──┘  y = H   (bottom goal: the CPU shoots at it)

export interface Vec {
  x: number;
  y: number;
}

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Bounding box grown by the puck radius, for a cheap reject before the real test. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** What the puck hit, for stats (corner shots) and sound. */
  kind: SurfaceKind;
}

export type SurfaceKind = "rail" | "wedge" | "block" | "post";
export type GoalSide = "top" | "bottom";

/** Playing surface width and height. Portrait, to fit a phone held upright. */
export const W = 300;
export const H = 600;
/** Wood rail thickness, drawn outside the playing surface. */
export const RAIL = 16;
export const PUCK_R = 9;

/** Goal slot width, centred on each end rail. */
export const GOAL_W = 64;
export const GOAL_X0 = (W - GOAL_W) / 2;
export const GOAL_X1 = (W + GOAL_W) / 2;

/**
 * Corner wedges: a slanted board across each corner. `wedgeX` is how far it
 * runs along the end rail, `wedgeY` along the side rail. The standard board's
 * are steeper than 45° (≈54° to the end rail) on purpose: a puck sent straight
 * up a side rail glances off at a shallow angle *toward the end rail*, behind
 * the diamond, and into the goal — the game's signature shot (`pnpm sim
 * corner` checks it). A match can choose true 45° corners instead, where that
 * shot runs across the end of the board rather than into the goal.
 */
export type Corners = "steep" | "45";
export const CORNERS: Corners[] = ["steep", "45"];

export interface Layout {
  corners: Corners;
  wedgeX: number;
  wedgeY: number;
  /** Every surface the puck can hit. */
  segments: readonly Segment[];
}

const WEDGES: Record<Corners, { x: number; y: number }> = {
  steep: { x: 42, y: 58 },
  "45": { x: 50, y: 50 },
};
/** The standard (steep) corner's size, for code that doesn't care about layouts. */
export const WEDGE_X = WEDGES.steep.x;
export const WEDGE_Y = WEDGES.steep.y;

/** Diamond blocks: centre distance from each end rail, and half-diagonal. */
export const BLOCK_D = 50;
export const BLOCK_S = 24;

export const CENTER: Vec = { x: W / 2, y: H / 2 };

function seg(ax: number, ay: number, bx: number, by: number, kind: SurfaceKind): Segment {
  return {
    ax,
    ay,
    bx,
    by,
    minX: Math.min(ax, bx) - PUCK_R,
    minY: Math.min(ay, by) - PUCK_R,
    maxX: Math.max(ax, bx) + PUCK_R,
    maxY: Math.max(ay, by) + PUCK_R,
    kind,
  };
}

/** How deep the goal slot runs through the end rail. */
export const SLOT = RAIL;

function buildSegments(WEDGE_X: number, WEDGE_Y: number): Segment[] {
  const s: Segment[] = [];
  // End rails, split by the goal slots.
  for (const y of [0, H]) {
    s.push(seg(WEDGE_X, y, GOAL_X0, y, "rail"));
    s.push(seg(GOAL_X1, y, W - WEDGE_X, y, "rail"));
    // Slot sides. Their inner ends are the goal posts.
    const out = y === 0 ? -SLOT * 3 : H + SLOT * 3;
    s.push(seg(GOAL_X0, y, GOAL_X0, out, "post"));
    s.push(seg(GOAL_X1, y, GOAL_X1, out, "post"));
  }
  // Side rails.
  s.push(seg(0, WEDGE_Y, 0, H - WEDGE_Y, "rail"));
  s.push(seg(W, WEDGE_Y, W, H - WEDGE_Y, "rail"));
  // Corner wedges.
  s.push(seg(0, WEDGE_Y, WEDGE_X, 0, "wedge"));
  s.push(seg(W - WEDGE_X, 0, W, WEDGE_Y, "wedge"));
  s.push(seg(0, H - WEDGE_Y, WEDGE_X, H, "wedge"));
  s.push(seg(W - WEDGE_X, H, W, H - WEDGE_Y, "wedge"));
  // Diamonds.
  for (const cy of [BLOCK_D, H - BLOCK_D]) {
    const pts = blockPoints(cy);
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      s.push(seg(a.x, a.y, b.x, b.y, "block"));
    }
  }
  return s;
}

/** The diamond's four corners, clockwise from the top. */
export function blockPoints(cy: number): Vec[] {
  const cx = W / 2;
  return [
    { x: cx, y: cy - BLOCK_S },
    { x: cx + BLOCK_S, y: cy },
    { x: cx, y: cy + BLOCK_S },
    { x: cx - BLOCK_S, y: cy },
  ];
}

export const LAYOUTS: Record<Corners, Layout> = {
  steep: { corners: "steep", wedgeX: WEDGES.steep.x, wedgeY: WEDGES.steep.y, segments: buildSegments(WEDGES.steep.x, WEDGES.steep.y) },
  "45": { corners: "45", wedgeX: WEDGES["45"].x, wedgeY: WEDGES["45"].y, segments: buildSegments(WEDGES["45"].x, WEDGES["45"].y) },
};
/** A match's layout (older saves have none: the standard steep corners). */
export const layoutFor = (corners?: Corners | null): Layout => LAYOUTS[corners ?? "steep"];
export const STANDARD = LAYOUTS.steep;
/** The standard layout's surfaces. */
export const SEGMENTS = STANDARD.segments;

/**
 * Whether a puck centred at `p` would overlap a diamond, wedge or rail by
 * more than `pad` short of touching (pad = PUCK_R means "any overlap").
 */
export function insideSolid(p: Vec, pad = 0, layout: Layout = STANDARD): boolean {
  for (const cy of [BLOCK_D, H - BLOCK_D]) {
    if (Math.abs(p.x - W / 2) + Math.abs(p.y - cy) < BLOCK_S) return true;
  }
  const wedge = (dx: number, dy: number) => dx / layout.wedgeX + dy / layout.wedgeY < 1;
  if (wedge(p.x, p.y) || wedge(W - p.x, p.y) || wedge(p.x, H - p.y) || wedge(W - p.x, H - p.y)) return true;
  return pad > 0 && distToWalls(p, layout) < pad;
}

/** Distance from `p` to the nearest surface. */
export function distToWalls(p: Vec, layout: Layout = STANDARD): number {
  let best = Infinity;
  for (const s of layout.segments) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const t = Math.max(0, Math.min(1, ((p.x - s.ax) * ex + (p.y - s.ay) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(p.x - s.ax - ex * t, p.y - s.ay - ey * t));
  }
  return best;
}

/** The goal a side attacks: Player 1 (bottom) shoots up at the top goal. */
export const goalOf = (attacksTop: boolean): GoalSide => (attacksTop ? "top" : "bottom");
