import type { Side } from "../engine/types";
import {
  clamp01,
  easeInCubic,
  easeInOutSine,
  easeOutBack,
  easeOutCubic,
  pulse,
  type Pose,
} from "./anim";

// Procedural unit characters: flat vector shapes with eyes, a weapon and a
// pose-driven animation. Pure function of its options — no internal state.
//
// Local space: origin at the unit centre, "forward" is -y. Body and weapons are
// drawn in a context flipped for enemies so forward maps to screen-down; faces
// are drawn through `Y()` so they stay upright.

export interface CharacterOpts {
  /** Unit type: "guard" | "striker" | "skirmisher" | "bulwark" | "berserker". */
  key: string;
  /** Colour and facing: player units face up (toward the enemy), enemy down. */
  side: Side;
  /** Centre of the character in CSS px. */
  cx: number;
  cy: number;
  /** Half the box the character must fit in (CSS px). */
  size: number;
  /** Continuous clock (ms) for idle motion: breathing, blinking, bobbing. */
  time: number;
  /** Current pose and its 0..1 progress (see board/anim.ts). */
  pose: Pose;
  t: number;
  /** Stable per-unit number so idle loops of identical units don't sync up. */
  seed: number;
  /** Merges absorbed — higher tiers can look grander. */
  merges: number;
}

type RGB = readonly [number, number, number];

interface Palette {
  fill: RGB;
  edge: RGB;
  dark: RGB;
}

const PLAYER: Palette = { fill: [0x3a, 0x86, 0xd6], edge: [0x9e, 0xcb, 0xf5], dark: [0x22, 0x55, 0x92] };
const ENEMY: Palette = { fill: [0xd1, 0x48, 0x3a], edge: [0xf2, 0xa2, 0x94], dark: [0x8c, 0x27, 0x20] };
const STEEL: RGB = [0xe2, 0xe7, 0xef];
const STEEL_D: RGB = [0x8e, 0x98, 0xaa];
const WOOD: RGB = [0x8a, 0x62, 0x3c];
const GOLD: RGB = [0xf5, 0xc8, 0x42];
const INK: RGB = [0x16, 0x14, 0x22];
const WHITE: RGB = [0xff, 0xff, 0xff];

// Per-call white-flash amount; set at the top of drawCharacter.
let FLASH = 0;
function m(c: RGB): string {
  const f = FLASH;
  if (f <= 0.004) return `rgb(${c[0]},${c[1]},${c[2]})`;
  return `rgb(${(c[0] + (255 - c[0]) * f) | 0},${(c[1] + (255 - c[1]) * f) | 0},${(c[2] + (255 - c[2]) * f) | 0})`;
}

/** Top (most forward) extent of each body, in units of R — used for crowns. */
const TOP: Record<string, number> = { guard: 0.82, striker: 1, skirmisher: 1, bulwark: 0.87, berserker: 1, squire: 0.66, knight: 0.86 };
/** Eye line (local y, in R) and half-spacing. */
const EYE_Y: Record<string, number> = { guard: -0.1, striker: 0.16, skirmisher: 0.02, bulwark: -0.04, berserker: -0.06, squire: -0.06, knight: -0.12 };
const EYE_X: Record<string, number> = { guard: 0.3, striker: 0.24, skirmisher: 0.27, bulwark: 0.25, berserker: 0.32, squire: 0.24, knight: 0.26 };

const enum Eye {
  Open,
  Closed,
  Pain,
  Cross,
  Happy,
}

function bodyPath(ctx: CanvasRenderingContext2D, key: string, R: number): void {
  ctx.beginPath();
  switch (key) {
    case "guard": {
      const h = R * 0.82;
      const r = R * 0.22;
      ctx.moveTo(-h + r, -h);
      ctx.arcTo(h, -h, h, h, r);
      ctx.arcTo(h, h, -h, h, r);
      ctx.arcTo(-h, h, -h, -h, r);
      ctx.arcTo(-h, -h, h, -h, r);
      break;
    }
    case "striker":
      ctx.moveTo(0, -R);
      ctx.lineTo(R * 0.92, R * 0.8);
      ctx.lineTo(-R * 0.92, R * 0.8);
      break;
    case "skirmisher":
      ctx.moveTo(0, -R);
      ctx.lineTo(R * 0.88, 0);
      ctx.lineTo(0, R);
      ctx.lineTo(-R * 0.88, 0);
      break;
    case "squire":
    case "knight": {
      // Heater-shield body: flat top, curving to a point. The Squire is the
      // same shape, just smaller — it hasn't grown into it yet.
      const k = key === "squire" ? 0.78 : 0.92;
      const hw = R * 0.8 * k;
      const top = -R * 0.86 * k;
      ctx.moveTo(-hw, top);
      ctx.lineTo(hw, top);
      ctx.lineTo(hw, R * 0.12 * k);
      ctx.quadraticCurveTo(hw * 0.8, R * 0.72 * k, 0, R * k);
      ctx.quadraticCurveTo(-hw * 0.8, R * 0.72 * k, -hw, R * 0.12 * k);
      break;
    }
    case "bulwark":
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const x = Math.cos(a) * R * 0.9;
        const y = Math.sin(a) * R * 0.87;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    default:
      ctx.arc(0, 0, R * 0.9, 0, Math.PI * 2);
  }
  ctx.closePath();
}

function trail(ctx: CanvasRenderingContext2D, px: number, py: number, L: number, ang: number, sgn: number, a: number, lw: number): void {
  if (a < 0.05) return;
  const th = -Math.PI / 2 + ang;
  ctx.save();
  ctx.globalAlpha *= a * 0.6;
  ctx.strokeStyle = m(WHITE);
  ctx.lineWidth = lw * 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(px, py, L, th + sgn * 1.1, th, sgn > 0);
  ctx.stroke();
  ctx.restore();
}

function blade(ctx: CanvasRenderingContext2D, len: number, wid: number, lw: number): void {
  ctx.beginPath();
  ctx.moveTo(-wid, 0);
  ctx.lineTo(-wid, -len * 0.82);
  ctx.lineTo(0, -len);
  ctx.lineTo(wid, -len * 0.82);
  ctx.lineTo(wid, 0);
  ctx.closePath();
  ctx.fillStyle = m(STEEL);
  ctx.strokeStyle = m(STEEL_D);
  ctx.lineWidth = lw;
  ctx.fill();
  ctx.stroke();
  // fuller line
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.1);
  ctx.lineTo(0, -len * 0.8);
  ctx.strokeStyle = m(STEEL_D);
  ctx.lineWidth = lw * 0.6;
  ctx.stroke();
}

function weapon(
  ctx: CanvasRenderingContext2D,
  key: string,
  R: number,
  P: Palette,
  w: number,
  sway: number,
  str: number,
  lw: number,
): void {
  ctx.lineJoin = "round";
  switch (key) {
    case "guard": {
      // Kite shield, left.
      ctx.save();
      ctx.translate(-R * 0.82, R * 0.05 - w * R * 0.06);
      ctx.rotate(sway * 0.4 + w * 0.12);
      ctx.beginPath();
      ctx.moveTo(-R * 0.3, -R * 0.45);
      ctx.lineTo(R * 0.3, -R * 0.45);
      ctx.lineTo(R * 0.3, R * 0.1);
      ctx.quadraticCurveTo(R * 0.25, R * 0.5, 0, R * 0.62);
      ctx.quadraticCurveTo(-R * 0.25, R * 0.5, -R * 0.3, R * 0.1);
      ctx.closePath();
      ctx.fillStyle = m(P.edge);
      ctx.strokeStyle = m(P.dark);
      ctx.lineWidth = lw;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -R * 0.02, R * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = m(P.dark);
      ctx.fill();
      ctx.restore();
      // Short sword, right.
      const ang = -w * 1.0 + sway;
      const px = R * 0.8;
      const py = R * 0.15;
      trail(ctx, px, py, R * 0.95, ang, 1, str, lw);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = m(WOOD);
      ctx.fillRect(-R * 0.05, -R * 0.02, R * 0.1, R * 0.28);
      blade(ctx, R * 0.95, R * 0.1, lw * 0.8);
      ctx.fillStyle = m(GOLD);
      ctx.fillRect(-R * 0.2, -R * 0.07, R * 0.4, R * 0.1);
      ctx.restore();
      break;
    }
    case "striker": {
      const thrust = -w * R * 0.55;
      const ang = sway * 0.5 + 0.08;
      const px = R * 0.55;
      const py = R * 0.1 + thrust;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      // streak behind the head while thrusting
      if (str > 0.1) {
        ctx.save();
        ctx.globalAlpha *= str * 0.55;
        ctx.strokeStyle = m(WHITE);
        ctx.lineWidth = lw * 1.4;
        ctx.lineCap = "round";
        for (let i = -1; i <= 1; i += 2) {
          ctx.beginPath();
          ctx.moveTo(i * R * 0.18, -R * 1.2);
          ctx.lineTo(i * R * 0.18, -R * 1.2 + R * 0.7 * str);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.fillStyle = m(WOOD);
      ctx.fillRect(-R * 0.045, -R * 1.0, R * 0.09, R * 1.9);
      ctx.beginPath();
      ctx.moveTo(0, -R * 1.55);
      ctx.lineTo(R * 0.13, -R * 1.05);
      ctx.lineTo(0, -R * 1.15);
      ctx.lineTo(-R * 0.13, -R * 1.05);
      ctx.closePath();
      ctx.fillStyle = m(STEEL);
      ctx.strokeStyle = m(STEEL_D);
      ctx.lineWidth = lw * 0.8;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = m(P.edge);
      ctx.fillRect(-R * 0.1, -R * 1.02, R * 0.2, R * 0.1);
      ctx.restore();
      break;
    }
    case "skirmisher": {
      for (let i = -1; i <= 1; i += 2) {
        const ang = i * (0.42 - w * 1.0 + sway * (i > 0 ? 1 : -1));
        const px = i * R * 0.72;
        const py = R * 0.12;
        trail(ctx, px, py, R * 0.8, ang, i, str, lw);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang);
        ctx.fillStyle = m(INK);
        ctx.fillRect(-R * 0.04, -R * 0.02, R * 0.08, R * 0.22);
        blade(ctx, R * 0.78, R * 0.075, lw * 0.7);
        ctx.restore();
      }
      break;
    }
    case "bulwark": {
      // Club stub, right.
      const ang = -w * 0.9 + sway * 0.5;
      trail(ctx, R * 0.88, R * 0.2, R * 0.7, ang, 1, str, lw);
      ctx.save();
      ctx.translate(R * 0.88, R * 0.2);
      ctx.rotate(ang);
      ctx.fillStyle = m(WOOD);
      ctx.strokeStyle = m(INK);
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.moveTo(-R * 0.05, 0);
      ctx.lineTo(-R * 0.09, -R * 0.4);
      ctx.lineTo(-R * 0.2, -R * 0.62);
      ctx.lineTo(R * 0.2, -R * 0.62);
      ctx.lineTo(R * 0.09, -R * 0.4);
      ctx.lineTo(R * 0.05, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // Huge tower shield, left; bashes forward on attack.
      ctx.save();
      ctx.translate(-R * 0.82 + w * R * 0.3, -R * 0.02 - w * R * 0.5);
      ctx.rotate(w * 0.18 + sway * 0.3);
      const sw = R * 0.34;
      const sh = R * 0.88;
      ctx.beginPath();
      ctx.moveTo(-sw, -sh);
      ctx.lineTo(sw, -sh);
      ctx.lineTo(sw, sh * 0.35);
      ctx.quadraticCurveTo(sw * 0.9, sh * 0.9, 0, sh);
      ctx.quadraticCurveTo(-sw * 0.9, sh * 0.9, -sw, sh * 0.35);
      ctx.closePath();
      ctx.fillStyle = m(P.edge);
      ctx.strokeStyle = m(P.dark);
      ctx.lineWidth = lw * 1.3;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = m(P.dark);
      ctx.fillRect(-sw * 0.18, -sh * 0.85, sw * 0.36, sh * 1.6);
      ctx.fillRect(-sw * 0.8, -sh * 0.12, sw * 1.6, sh * 0.2);
      ctx.beginPath();
      ctx.arc(0, -sh * 0.02, sw * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = m(GOLD);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "squire": {
      // Dented pot helmet, a size too big.
      ctx.save();
      ctx.translate(0, -R * 0.62);
      ctx.rotate(-0.12 + sway * 0.2);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.62, R * 0.3, 0, Math.PI, 0);
      ctx.lineTo(R * 0.7, R * 0.04);
      ctx.lineTo(-R * 0.7, R * 0.04);
      ctx.closePath();
      ctx.fillStyle = m(STEEL_D);
      ctx.strokeStyle = m(INK);
      ctx.lineWidth = lw * 0.7;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(R * 0.18, -R * 0.14, R * 0.07, 0, Math.PI * 2); // the dent
      ctx.fillStyle = m(INK);
      ctx.fill();
      ctx.restore();
      // Wooden practice sword, right.
      const ang = -w * 1.1 + sway;
      const px = R * 0.66;
      const py = R * 0.18;
      trail(ctx, px, py, R * 0.8, ang, 1, str, lw);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = m(WOOD);
      ctx.strokeStyle = m(INK);
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      ctx.rect(-R * 0.06, -R * 0.8, R * 0.12, R * 0.8);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(-R * 0.17, -R * 0.06, R * 0.34, R * 0.09);
      ctx.restore();
      break;
    }
    case "knight": {
      // Crested heater shield, left.
      ctx.save();
      ctx.translate(-R * 0.86 + w * R * 0.12, R * 0.08);
      ctx.rotate(sway * 0.3 + w * 0.1);
      const sw = R * 0.32;
      const sh = R * 0.56;
      ctx.beginPath();
      ctx.moveTo(-sw, -sh);
      ctx.lineTo(sw, -sh);
      ctx.lineTo(sw, sh * 0.1);
      ctx.quadraticCurveTo(sw * 0.8, sh * 0.75, 0, sh);
      ctx.quadraticCurveTo(-sw * 0.8, sh * 0.75, -sw, sh * 0.1);
      ctx.closePath();
      ctx.fillStyle = m(P.edge);
      ctx.strokeStyle = m(GOLD);
      ctx.lineWidth = lw * 1.1;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = m(GOLD);
      ctx.fillRect(-sw * 0.14, -sh * 0.8, sw * 0.28, sh * 1.45);
      ctx.fillRect(-sw * 0.7, -sh * 0.32, sw * 1.4, sh * 0.2);
      ctx.restore();
      // Longsword, right.
      const ang = -w * 1.15 + sway;
      const px = R * 0.84;
      const py = R * 0.14;
      trail(ctx, px, py, R * 1.2, ang, 1, str, lw);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = m(WOOD);
      ctx.fillRect(-R * 0.05, -R * 0.02, R * 0.1, R * 0.32);
      blade(ctx, R * 1.25, R * 0.11, lw * 0.85);
      ctx.fillStyle = m(GOLD);
      ctx.fillRect(-R * 0.26, -R * 0.08, R * 0.52, R * 0.11);
      ctx.restore();
      // Great helm with a plume.
      ctx.save();
      ctx.translate(0, -R * 0.8);
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, R * 0.22);
      ctx.lineTo(-R * 0.5, -R * 0.12);
      ctx.quadraticCurveTo(0, -R * 0.42, R * 0.5, -R * 0.12);
      ctx.lineTo(R * 0.5, R * 0.22);
      ctx.closePath();
      ctx.fillStyle = m(STEEL);
      ctx.strokeStyle = m(STEEL_D);
      ctx.lineWidth = lw * 0.8;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = m(INK);
      ctx.fillRect(-R * 0.36, -R * 0.02, R * 0.72, R * 0.07); // visor slit
      const plume = Math.sin(sway * 3 + w * 2) * R * 0.08;
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.3);
      ctx.quadraticCurveTo(R * 0.2 + plume, -R * 0.75, -R * 0.38 + plume, -R * 0.62);
      ctx.quadraticCurveTo(-R * 0.08, -R * 0.5, 0, -R * 0.3);
      ctx.fillStyle = m(P.edge);
      ctx.fill();
      ctx.restore();
      break;
    }
    default: {
      // Berserker: big axe, right.
      const ang = -w * 1.55 + sway * 1.3;
      const px = R * 0.82;
      const py = R * 0.28;
      const L = R * 1.5;
      trail(ctx, px, py, L * 0.85, ang, 1, str, lw);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = m(WOOD);
      ctx.fillRect(-R * 0.055, -L * 0.95, R * 0.11, L * 1.12);
      ctx.beginPath();
      ctx.moveTo(0, -L * 1.0);
      ctx.quadraticCurveTo(-R * 1.05, -L * 0.95, -R * 0.85, -L * 0.32);
      ctx.quadraticCurveTo(-R * 0.4, -L * 0.55, 0, -L * 0.42);
      ctx.closePath();
      ctx.fillStyle = m(STEEL);
      ctx.strokeStyle = m(STEEL_D);
      ctx.lineWidth = lw;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  key: string,
  R: number,
  s: number,
  mode: Eye,
  angry: number,
  lw: number,
): void {
  const ey = (EYE_Y[key] ?? 0) * R;
  const ex = (EYE_X[key] ?? 0.28) * R;
  const r = R * (key === "bulwark" ? 0.15 : key === "berserker" ? 0.17 : 0.18);
  const Y = (y: number) => y * s;
  ctx.lineCap = "round";
  for (let i = -1; i <= 1; i += 2) {
    const x = i * ex;
    switch (mode) {
      case Eye.Open: {
        ctx.beginPath();
        ctx.arc(x, Y(ey), r, 0, Math.PI * 2);
        ctx.fillStyle = m(WHITE);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, Y(ey - r * 0.25), r * (0.5 + angry * 0.1), 0, Math.PI * 2);
        ctx.fillStyle = m(INK);
        ctx.fill();
        break;
      }
      case Eye.Closed: {
        ctx.beginPath();
        ctx.moveTo(x - r, Y(ey));
        ctx.lineTo(x + r, Y(ey));
        ctx.strokeStyle = m(INK);
        ctx.lineWidth = lw * 1.1;
        ctx.stroke();
        break;
      }
      case Eye.Pain: {
        // > <
        ctx.beginPath();
        ctx.moveTo(x - i * r, Y(ey - r));
        ctx.lineTo(x + i * r, Y(ey));
        ctx.lineTo(x - i * r, Y(ey + r));
        ctx.strokeStyle = m(INK);
        ctx.lineWidth = lw * 1.2;
        ctx.stroke();
        break;
      }
      case Eye.Cross: {
        ctx.beginPath();
        ctx.moveTo(x - r, Y(ey - r));
        ctx.lineTo(x + r, Y(ey + r));
        ctx.moveTo(x + r, Y(ey - r));
        ctx.lineTo(x - r, Y(ey + r));
        ctx.strokeStyle = m(INK);
        ctx.lineWidth = lw * 1.2;
        ctx.stroke();
        break;
      }
      default: {
        // ^ ^
        ctx.beginPath();
        ctx.moveTo(x - r, Y(ey + r * 0.4));
        ctx.quadraticCurveTo(x, Y(ey - r * 1.2), x + r, Y(ey + r * 0.4));
        ctx.strokeStyle = m(INK);
        ctx.lineWidth = lw * 1.2;
        ctx.stroke();
      }
    }
    // Brows: always for berserker/bulwark, angled in when angry.
    const brow = key === "berserker" ? 1 : key === "bulwark" ? 0.5 : 0;
    const a = Math.max(brow, angry);
    if (a > 0.05 && mode !== Eye.Cross && mode !== Eye.Happy) {
      const flat = key === "bulwark";
      ctx.beginPath();
      ctx.moveTo(x + i * r * 1.35, Y(ey - r * (flat ? 1.05 : 1.7 * a)));
      ctx.lineTo(x - i * r * 1.1, Y(ey - r * (flat ? 1.05 : 0.65 - 0.15 * a)));
      ctx.strokeStyle = m(INK);
      ctx.lineWidth = lw * (flat ? 2.2 : 1.6);
      ctx.stroke();
    }
  }
  // Mouth
  if (mode === Eye.Happy) {
    ctx.beginPath();
    ctx.arc(0, Y(ey + R * 0.3), R * 0.16, Math.PI * 0.1, Math.PI * 0.9, s < 0);
    ctx.strokeStyle = m(INK);
    ctx.lineWidth = lw;
    ctx.stroke();
  } else if (mode === Eye.Pain) {
    ctx.beginPath();
    ctx.arc(0, Y(ey + R * 0.36), R * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = m(INK);
    ctx.fill();
  } else if (angry > 0.5 && mode === Eye.Open) {
    ctx.beginPath();
    ctx.moveTo(-R * 0.14, Y(ey + R * 0.36));
    ctx.lineTo(R * 0.14, Y(ey + R * 0.36));
    ctx.strokeStyle = m(INK);
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function drawCharacter(ctx: CanvasRenderingContext2D, o: CharacterOpts): void {
  const { key, pose, t, time, seed } = o;
  const P = o.side === "player" ? PLAYER : ENEMY;
  const s = o.side === "player" ? 1 : -1; // y-flip for the enemy
  // Body radius as a share of the box. The rest is headroom for weapons; kept
  // small so the body itself reads large on short rows.
  const R = o.size * 0.72;
  const lw = Math.max(1.4, R * 0.075);
  const phase = seed * 2.399;

  // Defaults: idle loop.
  const breathe = Math.sin(time / 430 + phase);
  let sx = 1 - 0.025 * breathe;
  let sy = 1 + 0.04 * breathe;
  let bob = Math.sin(time / 760 + phase * 0.7) * R * 0.04;
  let tilt = 0;
  let scale = 1;
  let alpha = 1;
  let flash = 0;
  let glow = 0;
  let angry = 0;
  let w = 0; // weapon swing -1 (wound up) .. 1 (struck)
  let str = 0; // strike intensity for trails
  let fwd = 0; // local forward offset (negative = forward)
  const sway = Math.sin(time / 520 + phase) * 0.07;
  let eye: Eye = Eye.Open;
  const period = 3000 + (seed % 7) * 450;
  if ((time + seed * 977) % period < 130) eye = Eye.Closed;

  switch (pose) {
    case "attack": {
      let wind = 0;
      let st = 0;
      if (t < 0.28) {
        const p = easeOutCubic(t / 0.28);
        w = -p;
        wind = p;
      } else if (t < 0.5) {
        const p = easeInCubic((t - 0.28) / 0.22);
        w = -1 + 2.15 * p;
        wind = 1 - p;
        st = p;
      } else if (t < 0.62) {
        const p = (t - 0.5) / 0.12;
        w = 1.15 - 0.15 * p;
        st = 1 - p * 0.4;
      } else {
        const p = easeInOutSine((t - 0.62) / 0.38);
        w = 1 - p;
        st = 0.6 * (1 - p);
      }
      str = t >= 0.3 && t < 0.62 ? st : 0;
      sy = 1 - 0.16 * wind + 0.24 * st;
      sx = 1 + 0.1 * wind - 0.14 * st;
      fwd = R * (0.08 * wind - 0.14 * st);
      bob = 0;
      angry = 1;
      eye = Eye.Open;
      break;
    }
    case "hit": {
      const p = pulse(Math.min(1, t * 1.6));
      flash = (1 - easeOutCubic(t)) * 0.95;
      sy = 1 - 0.22 * p;
      sx = 1 + 0.18 * p;
      tilt = (s > 0 ? 1 : -1) * 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.4)) * (seed % 2 ? 1 : -1);
      bob = 0;
      eye = t < 0.8 ? Eye.Pain : Eye.Closed;
      break;
    }
    case "dying": {
      flash = t < 0.3 ? 1 - t / 0.3 : 0;
      tilt = (seed % 2 ? 1 : -1) * 0.9 * easeOutCubic(t);
      scale = 1 - 0.5 * easeInCubic(t);
      alpha = 1 - t ** 1.5;
      sy = 1 - 0.1 * pulse(t * 2);
      bob = R * 0.25 * t;
      eye = Eye.Cross;
      break;
    }
    case "spawn": {
      const p = easeOutBack(clamp01(t));
      scale = Math.max(0.001, p);
      alpha = clamp01(t * 3);
      bob = 0;
      eye = t < 0.6 ? Eye.Closed : Eye.Open;
      break;
    }
    case "merge": {
      const p = pulse(t);
      scale = 1 + 0.18 * p;
      glow = p;
      sy = 1 + 0.06 * Math.sin(t * Math.PI * 4) * (1 - t);
      sx = 1 - 0.06 * Math.sin(t * Math.PI * 4) * (1 - t);
      flash = 0.35 * p;
      eye = Eye.Happy;
      break;
    }
    case "selected": {
      const ph = (time / 330 + phase) % 1;
      const hop = Math.sin(Math.PI * ph); // 0 at ground, 1 apex
      bob = -hop * R * 0.2;
      const land = 1 - hop;
      sy = 1 + 0.08 * hop - 0.1 * land * land * land;
      sx = 1 - 0.05 * hop + 0.08 * land * land * land;
      glow = 0.25;
      eye = Eye.Happy;
      break;
    }
    default:
      break;
  }

  FLASH = flash;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(o.cx, o.cy + bob * s);
  ctx.rotate(tilt);
  ctx.scale(scale * sx, scale * sy);
  ctx.scale(1, s);
  ctx.translate(0, fwd);

  // Tier aura (behind everything).
  const tier = Math.min(Math.max(o.merges, 0), 5);
  if (tier > 0 || glow > 0) {
    const pls = 0.5 + 0.5 * Math.sin(time / 380 + phase);
    ctx.save();
    ctx.globalAlpha *= Math.min(1, 0.22 + tier * 0.06 + glow * 0.5) * (0.7 + 0.3 * pls);
    ctx.beginPath();
    ctx.arc(0, 0, R * (1.08 + tier * 0.04 + glow * 0.18) + pls * R * 0.04, 0, Math.PI * 2);
    ctx.strokeStyle = tier >= 3 || glow > 0 ? m(GOLD) : m(P.edge);
    ctx.lineWidth = lw * (1 + tier * 0.35 + glow * 1.5);
    ctx.stroke();
    if (glow > 0) {
      ctx.globalAlpha *= 0.35;
      ctx.fillStyle = m(GOLD);
      ctx.fill();
    }
    ctx.restore();
  }

  // Body.
  bodyPath(ctx, key, R);
  ctx.fillStyle = m(P.fill);
  ctx.fill();
  // Subtle shade on the rear half for depth (clipped to the body).
  ctx.save();
  ctx.clip();
  ctx.fillStyle = m(P.dark);
  ctx.globalAlpha *= 0.35;
  ctx.fillRect(-R, R * 0.28, R * 2, R);
  ctx.restore();
  bodyPath(ctx, key, R);
  ctx.strokeStyle = m(P.edge);
  ctx.lineWidth = lw * 1.4;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Tier pips on the back rim.
  for (let i = 0; i < tier; i++) {
    const a = Math.PI / 2 + (i - (tier - 1) / 2) * 0.38;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, R * 0.075, 0, Math.PI * 2);
    ctx.fillStyle = m(GOLD);
    ctx.fill();
  }
  // Crown for tier >= 2. Not on the Squire line: its pips already count toward
  // knighthood, and the Knight wears a plumed helm instead.
  const crowned = key !== "squire" && key !== "knight";
  if (crowned && o.merges >= 2) {
    const ty = -(TOP[key] ?? 0.9) * R;
    const cw = R * 0.34;
    ctx.beginPath();
    ctx.moveTo(-cw, ty + R * 0.02);
    ctx.lineTo(-cw, ty - R * 0.2);
    ctx.lineTo(-cw * 0.5, ty - R * 0.08);
    ctx.lineTo(0, ty - R * 0.28);
    ctx.lineTo(cw * 0.5, ty - R * 0.08);
    ctx.lineTo(cw, ty - R * 0.2);
    ctx.lineTo(cw, ty + R * 0.02);
    ctx.closePath();
    ctx.fillStyle = m(GOLD);
    ctx.strokeStyle = m(INK);
    ctx.lineWidth = lw * 0.6;
    ctx.fill();
    ctx.stroke();
  } else if (crowned && o.merges === 1) {
    ctx.beginPath();
    ctx.moveTo(0, -(TOP[key] ?? 0.9) * R - R * 0.02);
    ctx.lineTo(R * 0.09, -(TOP[key] ?? 0.9) * R - R * 0.12);
    ctx.lineTo(0, -(TOP[key] ?? 0.9) * R - R * 0.22);
    ctx.lineTo(-R * 0.09, -(TOP[key] ?? 0.9) * R - R * 0.12);
    ctx.closePath();
    ctx.fillStyle = m(GOLD);
    ctx.fill();
  }

  // Weapon, then face (upright via s).
  weapon(ctx, key, R, P, w, sway, str, lw);
  ctx.scale(1, s);
  drawEyes(ctx, key, R, s, eye, angry, lw);

  ctx.restore();
}
