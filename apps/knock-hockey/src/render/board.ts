import {
  BLOCK_D,
  GOAL_X0,
  GOAL_X1,
  H,
  PUCK_R,
  RAIL,
  W,
  STANDARD,
  blockPoints,
  type Layout,
  type Vec,
} from "../physics/table";

// Draws the wooden board in board units. The caller sets the transform (see
// `fitBoard`). Flat, geometric art: wood tones and painted rink lines.

export const P1_COLOR = "#2f6fd6";
export const P2_COLOR = "#d63c3c";

/** Room around the rails so the sticks have somewhere to go. */
const MARGIN = 10;
export const VIEW_W = W + 2 * (RAIL + MARGIN);
export const VIEW_H = H + 2 * (RAIL + MARGIN);

export interface View {
  scale: number;
  ox: number;
  oy: number;
}

/** Fit the board (with rails and margin) into a cw × ch CSS-pixel box. */
export function fitBoard(cw: number, ch: number): View {
  const scale = Math.min(cw / VIEW_W, ch / VIEW_H);
  return {
    scale,
    ox: (cw - W * scale) / 2,
    oy: (ch - H * scale) / 2,
  };
}

export const toBoard = (v: View, px: number, py: number): Vec => ({ x: (px - v.ox) / v.scale, y: (py - v.oy) / v.scale });

let floorPattern: CanvasPattern | null = null;
let railPattern: CanvasPattern | null = null;

/** A tiling wood-grain texture, drawn once. */
function grain(ctx: CanvasRenderingContext2D, base: string, dark: string, light: string, size: number): CanvasPattern | null {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // Deterministic streaks, so the board looks the same every load.
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size;
    g.strokeStyle = rnd() < 0.55 ? dark : light;
    g.globalAlpha = 0.25 + rnd() * 0.35;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(x, 0);
    const wob = (rnd() - 0.5) * 6;
    g.bezierCurveTo(x + wob, size * 0.33, x - wob, size * 0.66, x, size);
    g.stroke();
  }
  return ctx.createPattern(c, "repeat");
}

export function drawBoard(ctx: CanvasRenderingContext2D, layout: Layout = STANDARD): void {
  const WEDGE_X = layout.wedgeX;
  const WEDGE_Y = layout.wedgeY;
  floorPattern ??= grain(ctx, "#ecd2a2", "#c99f63", "#f7e6c4", 96);
  railPattern ??= grain(ctx, "#9c5f2c", "#6e3d16", "#b97a42", 64);

  // Rails: one rounded frame under everything.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = railPattern ?? "#9c5f2c";
  roundRect(ctx, -RAIL, -RAIL, W + 2 * RAIL, H + 2 * RAIL, 10);
  ctx.fill();
  ctx.restore();
  // Bevel on the rail top.
  ctx.strokeStyle = "rgba(255,230,190,0.35)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, -RAIL + 1, -RAIL + 1, W + 2 * RAIL - 2, H + 2 * RAIL - 2, 9);
  ctx.stroke();

  // Playing surface.
  ctx.fillStyle = floorPattern ?? "#ecd2a2";
  ctx.fillRect(0, 0, W, H);

  // Painted rink lines.
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#c8372d";
  ctx.fillRect(0, H / 2 - 2, W, 4);
  ctx.fillStyle = "#2c5fb8";
  ctx.fillRect(0, H * 0.34 - 2.5, W, 5);
  ctx.fillRect(0, H * 0.66 - 2.5, W, 5);
  ctx.strokeStyle = "#2c5fb8";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 38, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#2c5fb8";
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  // Goal creases, in each defender's colour: CPU at the top, you at the bottom.
  for (const [y, dir, color] of [
    [0, 1, P2_COLOR],
    [H, -1, P1_COLOR],
  ] as const) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(GOAL_X0 - 6, y);
    ctx.quadraticCurveTo(W / 2, y + dir * 34, GOAL_X1 + 6, y);
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#c8372d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(GOAL_X0, y + dir * 1);
    ctx.lineTo(GOAL_X1, y + dir * 1);
    ctx.stroke();
  }
  ctx.restore();

  // Goal slots cut through the end rails.
  for (const [y0, color] of [
    [-RAIL - 0.5, P2_COLOR],
    [H - 0.5, P1_COLOR],
  ] as const) {
    ctx.fillStyle = "#24140a";
    ctx.fillRect(GOAL_X0, y0, GOAL_X1 - GOAL_X0, RAIL + 1);
    // Net hatching.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 0.8;
    for (let x = GOAL_X0 + 5; x < GOAL_X1; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + RAIL + 1);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(GOAL_X0 - 3, y0 < 0 ? y0 : y0 + RAIL - 2.5, GOAL_X1 - GOAL_X0 + 6, 3);
    ctx.globalAlpha = 1;
  }

  // Corner wedges.
  const wedges: Vec[][] = [
    [{ x: 0, y: 0 }, { x: WEDGE_X, y: 0 }, { x: 0, y: WEDGE_Y }],
    [{ x: W, y: 0 }, { x: W - WEDGE_X, y: 0 }, { x: W, y: WEDGE_Y }],
    [{ x: 0, y: H }, { x: WEDGE_X, y: H }, { x: 0, y: H - WEDGE_Y }],
    [{ x: W, y: H }, { x: W - WEDGE_X, y: H }, { x: W, y: H - WEDGE_Y }],
  ];
  for (const [c, a, b] of wedges) {
    ctx.fillStyle = railPattern ?? "#9c5f2c";
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,230,190,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // Diamond blocks.
  for (const cy of [BLOCK_D, H - BLOCK_D]) {
    const pts = blockPoints(cy);
    ctx.save();
    ctx.shadowColor = "rgba(40,20,0,0.45)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = railPattern ?? "#9c5f2c";
    poly(ctx, pts);
    ctx.fill();
    ctx.restore();
    // Bevel: lit top edges, shaded bottom edges.
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,230,190,0.55)";
    ctx.beginPath();
    ctx.moveTo(pts[3].x, pts[3].y);
    ctx.lineTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(50,22,4,0.5)";
    ctx.beginPath();
    ctx.moveTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y);
    ctx.lineTo(pts[3].x, pts[3].y);
    ctx.stroke();
  }
}

export function drawPuck(ctx: CanvasRenderingContext2D, p: Vec, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(40,22,6,0.35)";
  ctx.beginPath();
  ctx.arc(p.x + 1.5, p.y + 2.5, PUCK_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1c20";
  ctx.beginPath();
  ctx.arc(p.x, p.y, PUCK_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, PUCK_R - 2.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.arc(p.x - 2.6, p.y - 2.8, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Short dotted line in the shot direction, ending in an arrowhead. No bounces shown. */
export function drawAimLine(ctx: CanvasRenderingContext2D, p: Vec, angle: number, color: string, length = 74): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const sx = p.x + dx * (PUCK_R + 4);
  const sy = p.y + dy * (PUCK_R + 4);
  const ex = p.x + dx * (PUCK_R + length);
  const ey = p.y + dy * (PUCK_R + length);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 5]);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ex + dx * 7, ey + dy * 7);
  ctx.lineTo(ex - dy * 4.5, ey + dx * 4.5);
  ctx.lineTo(ex + dy * 4.5, ey - dx * 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function poly(ctx: CanvasRenderingContext2D, pts: Vec[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}
