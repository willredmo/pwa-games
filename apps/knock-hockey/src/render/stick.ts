import { PUCK_R } from "../physics/table";
import type { StickLook } from "../game/stick";

// The mini hockey stick, seen from above: a blade lying flat behind the puck,
// across the line of the shot, and a shaft running back and off to one side
// toward the player's hands. Shared by the game and the Locker preview.

export const BLADE_LEN = 38;
const BLADE_W = 7;
const SHAFT_LEN = 128;
const SHAFT_W = 7;
/** The shaft leaves the heel at this angle off straight back. */
const SHAFT_TILT = (36 * Math.PI) / 180;
const CURVE_DEPTH = { straight: 0, mid: 4.5, big: 9 } as const;

export interface StickPose {
  /** The puck the stick lines up on. */
  x: number;
  y: number;
  /** Shot direction, radians. */
  angle: number;
  /** Gap between the blade and the puck: the pull-back. */
  back: number;
  alpha?: number;
}

export function drawStick(ctx: CanvasRenderingContext2D, look: StickLook, pose: StickPose): void {
  ctx.save();
  ctx.globalAlpha = pose.alpha ?? 1;
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  // Local frame: +x is the shot direction, the blade's face sits at -bx.
  const bx = -(PUCK_R + pose.back + BLADE_W / 2);
  const heel = { x: bx - 1, y: BLADE_LEN / 2 };
  const dir = { x: -Math.cos(SHAFT_TILT), y: Math.sin(SHAFT_TILT) };
  const end = { x: heel.x + dir.x * SHAFT_LEN, y: heel.y + dir.y * SHAFT_LEN };

  // Soft shadow on the board.
  ctx.save();
  ctx.translate(2.5, 3.5);
  ctx.strokeStyle = "rgba(40, 22, 6, 0.28)";
  ctx.lineCap = "round";
  ctx.lineWidth = SHAFT_W;
  line(ctx, heel, end);
  ctx.lineWidth = BLADE_W;
  bladePath(ctx, bx, look);
  ctx.stroke();
  ctx.restore();

  drawShaft(ctx, look, heel, end, dir);

  // Blade, then tape over its middle.
  ctx.lineCap = "round";
  ctx.lineWidth = BLADE_W;
  ctx.strokeStyle = look.blade;
  bladePath(ctx, bx, look);
  ctx.stroke();
  drawTape(ctx, bx, look);

  ctx.restore();
}

/** The blade's centre line, toe (top, −y) to heel. The toe curls toward the puck. */
function bladePath(ctx: CanvasRenderingContext2D, bx: number, look: StickLook, inset = 0): void {
  const c = CURVE_DEPTH[look.curve];
  const toe = -BLADE_LEN / 2 + inset;
  const heelY = BLADE_LEN / 2 - inset;
  ctx.beginPath();
  ctx.moveTo(bx + c * (inset ? 0.85 : 1), toe);
  ctx.quadraticCurveTo(bx - c * 0.15, (toe + heelY) / 2 - 4, bx, heelY);
}

function drawTape(ctx: CanvasRenderingContext2D, bx: number, look: StickLook): void {
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineWidth = BLADE_W - 1.5;
  bladePath(ctx, bx, look, 6);
  if (look.pattern === "solid") {
    ctx.strokeStyle = look.tape;
    ctx.stroke();
  } else if (look.pattern === "stripes") {
    ctx.strokeStyle = look.tape;
    ctx.setLineDash([3.5, 2.5]);
    ctx.stroke();
  } else {
    // Checker: two half-width lanes with offset dashes.
    ctx.strokeStyle = look.blade === look.tape ? "#f4f1ea" : look.blade;
    ctx.stroke();
    ctx.strokeStyle = look.tape;
    ctx.lineWidth = (BLADE_W - 1.5) / 2;
    ctx.save();
    ctx.translate(-(BLADE_W - 1.5) / 4, 0);
    ctx.setLineDash([3, 3]);
    bladePath(ctx, bx, look, 6);
    ctx.stroke();
    ctx.restore();
    ctx.translate((BLADE_W - 1.5) / 4, 0);
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = 3;
    bladePath(ctx, bx, look, 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShaft(
  ctx: CanvasRenderingContext2D,
  look: StickLook,
  heel: { x: number; y: number },
  end: { x: number; y: number },
  dir: { x: number; y: number },
): void {
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineWidth = SHAFT_W;
  const at = (t: number) => ({ x: heel.x + (end.x - heel.x) * t, y: heel.y + (end.y - heel.y) * t });

  if (look.finish === "two-tone") {
    ctx.strokeStyle = look.shaft2;
    line(ctx, heel, at(0.42));
    ctx.strokeStyle = look.shaft;
    line(ctx, at(0.42), end);
  } else {
    ctx.strokeStyle = look.shaft;
    line(ctx, heel, end);
  }
  if (look.finish === "wood") {
    // Grain: thin lighter and darker streaks along the shaft.
    const nx = -dir.y;
    const ny = dir.x;
    ctx.lineWidth = 1;
    const streaks: [number, number, number, string][] = [
      [-2.2, 0.02, 0.62, "rgba(255,240,215,0.42)"],
      [1.1, 0.2, 0.9, "rgba(50,25,0,0.38)"],
      [2.5, 0.05, 0.45, "rgba(255,240,215,0.3)"],
      [-0.6, 0.48, 0.88, "rgba(50,25,0,0.32)"],
      [0.4, 0.06, 0.3, "rgba(50,25,0,0.25)"],
    ];
    for (const [off, t0, t1, color] of streaks) {
      ctx.strokeStyle = color;
      const a = at(t0);
      const b = at(t1);
      line(ctx, { x: a.x + nx * off, y: a.y + ny * off }, { x: b.x + nx * off, y: b.y + ny * off });
    }
  }
  // A highlight down one edge, so the shaft reads as round.
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  const off = -SHAFT_W / 2 + 1.4;
  line(ctx, { x: heel.x - dir.y * off, y: heel.y + dir.x * off }, { x: end.x - dir.y * off, y: end.y + dir.x * off });

  // Knob of tape at the top end.
  ctx.lineCap = "round";
  ctx.lineWidth = SHAFT_W + 1.6;
  ctx.strokeStyle = look.knob;
  line(ctx, at(0.89), end);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  for (const t of [0.915, 0.945, 0.975]) {
    const p = at(t);
    line(ctx, { x: p.x - dir.y * 4.4, y: p.y + dir.x * 4.4 }, { x: p.x + dir.y * 4.4, y: p.y - dir.x * 4.4 });
  }

  if (look.decal.trim()) {
    const mid = at(0.66);
    ctx.translate(mid.x, mid.y);
    let a = Math.atan2(dir.y, dir.x);
    // Keep the text the right way up whichever way the stick points.
    const world = ctx.getTransform();
    const screenA = Math.atan2(world.b * Math.cos(a) + world.d * Math.sin(a), world.a * Math.cos(a) + world.c * Math.sin(a));
    if (Math.abs(screenA) > Math.PI / 2) a += Math.PI;
    ctx.rotate(a);
    ctx.fillStyle = readableOn(look.shaft);
    ctx.font = "bold 6.5px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(look.decal.trim().slice(0, 3).toUpperCase(), 0, 0.4);
  }
  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1d1d22" : "#f4f1ea";
}

/** The stick's blade and shaft as world-space segments, for grabbing it. */
export function stickSegments(pose: StickPose): { ax: number; ay: number; bx: number; by: number }[] {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  const w = (x: number, y: number) => ({ x: pose.x + x * c - y * s, y: pose.y + x * s + y * c });
  const bx = -(PUCK_R + pose.back + BLADE_W / 2);
  const toe = w(bx, -BLADE_LEN / 2);
  const heelL = { x: bx - 1, y: BLADE_LEN / 2 };
  const heel = w(heelL.x, heelL.y);
  const end = w(heelL.x - Math.cos(SHAFT_TILT) * SHAFT_LEN, heelL.y + Math.sin(SHAFT_TILT) * SHAFT_LEN);
  return [
    { ax: toe.x, ay: toe.y, bx: heel.x, by: heel.y },
    { ax: heel.x, ay: heel.y, bx: end.x, by: end.y },
  ];
}
