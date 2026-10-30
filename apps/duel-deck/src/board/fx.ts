import type { Side } from "../engine/types";
import {
  clamp01,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  lerp,
  prefersReducedMotion,
} from "./anim";

// Transient board effects: particles, floating numbers, slashes, rings, screen
// shake. Particles live in a fixed pool (no per-frame allocation); one-off
// effects (numbers, slashes, rings, flashes, delayed bursts) sit in a small list.

export type FxKind =
  /** Floating damage number rising off a struck unit. */
  | "damage"
  /** Weapon arc across a unit being hit. */
  | "slash"
  /** Burst of sparks where two front units collide. */
  | "impact"
  /** A unit dying: shatter / burst of its colour. */
  | "death"
  /** A unit arriving on the board. */
  | "spawn"
  /** Two units fusing: inward sparkle spiral + glow. */
  | "merge"
  /** A unit swapped out by a replace: puff of smoke. */
  | "replace"
  /** Lifesteal: green rising plus-signs and a "+N". */
  | "heal"
  /** Thorns: spike burst back at the attacker. */
  | "thorns"
  /** Cleave: wide heavy arc carrying through to the next unit. */
  | "cleave"
  /** First strike: speed lines / flash ahead of the blow. */
  | "first-strike"
  /** Last breath: ghostly parting strike from a dying unit. */
  | "last-breath"
  /** Damage reduction soaked part of a hit: shield glint. */
  | "block"
  /** Bounty paid: gold coins burst toward the losing side. */
  | "bounty"
  // --- Unit abilities ---
  /** Floating "✦ Ability" name over the unit that triggered it (needs `text`). */
  | "ability-label"
  /** Evasion: sidestep afterimages and "DODGE!". */
  | "dodge"
  /** Charge: golden wind-up glow gathering on the striker. */
  | "charge-up"
  /** Overflow: red shockwave travelling from the kill to `tx,ty`. */
  | "overflow"
  /** Bodyguard: shield beam from the fallen Guard to `tx,ty`. */
  | "bodyguard"
  /** Pass the torch: flame arcing from the fallen Squire to `tx,ty`. */
  | "torch"
  /**
   * A support ability relayed by a Beacon: a glowing orb arcing to `tx,ty`,
   * `amount` times its first size (it grows at each Beacon). With `text`, it
   * lands on a Beacon and bounces: a squash ring, sparkles and `text` ("×1.5").
   */
  | "relay"
  /** Last rally: gold banner burst from the fallen Knight. */
  | "rally"
  /** Fortify: stone pulse on a surviving Bulwark and "+N♥ forever". */
  | "fortify"
  /** An ability's stat gain on the unit receiving it ("+2⚔", "+3♥"; needs `text`). */
  | "stat-gain"
  /** Endure (Phoenix, Undying, Vanguard's vow): a killing blow left it on 1♥. Flash, flame ring, rising embers. */
  | "rebirth"
  /** The losing row blows up at the end of a match: flash, fireball, shockwave, debris, smoke. `size` is a cell. */
  | "explosion";

export interface FxSpawn {
  kind: FxKind;
  /** Position in CSS px (canvas space, before shake). */
  x: number;
  y: number;
  /** Cell height in CSS px, so effects scale with the board. */
  size: number;
  side?: Side;
  /** For "damage": the number shown. */
  amount?: number;
  /** For "damage": the blow was fatal (show it bigger / differently). */
  lethal?: boolean;
  /** For "damage": what armour or a shield soaked, and what the unit healed back this beat (lifesteal), shown small under the number instead of as numbers of their own. */
  blocked?: number;
  healed?: number;
  /** For "last-breath": optional target point the wisp travels to. */
  tx?: number;
  ty?: number;
  /** For "ability-label": the text to float. */
  text?: string;
}

const MAX_PARTICLES = 400;
/** One hop of a relayed support ability (source → Beacon → … → the unit it lands on). */
export const RELAY_HOP_MS = 560;
/** How long ability names and their numbers stay readable. */
const ABILITY_LABEL_MS = 1800;
const SHAKE_MS = 300;
const INK = "#201d30";

const COL = {
  player: "#3a86d6",
  playerLight: "#9ecbf5",
  enemy: "#d1483a",
  enemyLight: "#f2a294",
  gold: "#f0b429",
  goldLight: "#ffe27a",
  green: "#5fe08f",
  darkGreen: "#2f7a45",
  ember: "#ff9a3c",
  violet: "#cdb8ff",
  blueWhite: "#dff0ff",
  shield: "#6fb2ff",
  grey: "#b4b0c0",
  smoke: "#b9b3c9",
};

const enum PT {
  Spark,
  Dot,
  Shard,
  Smoke,
  Sparkle,
  Spiral,
  Plus,
  Coin,
}

interface Particle {
  alive: boolean;
  type: PT;
  t0: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  // spiral
  ox: number;
  oy: number;
  rad: number;
}

const enum ET {
  Number,
  Slash,
  Ring,
  Flash,
  MergeBurst,
  Spikes,
  Cleave,
  Speed,
  Shield,
  Wisp,
  WispBurst,
  Label,
  Travel,
  Afterimage,
  Banner,
  Stone,
  Fireball,
}

interface Effect {
  type: ET;
  t0: number;
  dur: number;
  x: number;
  y: number;
  size: number;
  color: string;
  color2: string;
  amount: number;
  flag: boolean;
  dir: number;
  done: boolean;
  /** Number style: 0 damage, 1 heal, 2 block, 3 bounty. */
  style: number;
  tx: number;
  ty: number;
  /** Label text, or the Travel variant ("shock" | "beam" | "flame"). */
  text: string;
}

function mkParticle(): Particle {
  return {
    alive: false, type: PT.Dot, t0: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, g: 0,
    size: 1, rot: 0, vr: 0, color: "#fff", ox: 0, oy: 0, rad: 0,
  };
}

const sideCol = (s?: Side) => (s === "enemy" ? COL.enemy : s === "player" ? COL.player : COL.gold);
const sideLight = (s?: Side) =>
  s === "enemy" ? COL.enemyLight : s === "player" ? COL.playerLight : COL.goldLight;

export class FxLayer {
  private parts: Particle[] = [];
  private effects: Effect[] = [];
  private cursor = 0;
  private lastNow = -1;
  private trauma = 0;
  private traumaAt = 0;
  private reduced = false;
  private shakeSize = 12;

  constructor() {
    for (let i = 0; i < MAX_PARTICLES; i++) this.parts.push(mkParticle());
  }

  /** Queue an effect starting at `now` (ms, performance.now clock). */
  add(fx: FxSpawn, now: number): void {
    this.reduced = prefersReducedMotion();
    const { x, y, size: s } = fx;
    this.shakeSize = Math.max(6, s * 0.28);
    switch (fx.kind) {
      case "damage":
        this.addNumber(fx, now);
        break;
      case "slash":
        this.fx(ET.Slash, now, 260, x, y, s, sideCol(fx.side), sideLight(fx.side), 0, false, fx.side === "enemy" ? -1 : 1);
        break;
      case "impact": {
        this.fx(ET.Ring, now, 320, x, y, s * 1.0, COL.goldLight, "#fff", 0, false, 0);
        this.fx(ET.Flash, now, 110, x, y, s * 0.55, "#fff", "#fff", 0, false, 0);
        const n = this.count(14);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = s * (2.2 + Math.random() * 3.2);
          const p = this.emit(PT.Spark, now, 260 + Math.random() * 240, x, y, Math.cos(a) * sp, Math.sin(a) * sp - s * 0.6,
            s * 5, s * (0.045 + Math.random() * 0.03), i % 3 === 0 ? "#fff" : i % 3 === 1 ? COL.goldLight : sideLight(fx.side));
          if (p) p.rot = 0;
        }
        break;
      }
      case "death": {
        const c = sideCol(fx.side);
        const l = sideLight(fx.side);
        this.fx(ET.Flash, now, 160, x, y, s * 0.8, "#fff", l, 0, false, 0);
        this.fx(ET.Ring, now, 420, x, y, s * 1.1, l, c, 0, false, 0);
        const n = this.count(16);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = s * (1.2 + Math.random() * 2.6);
          const p = this.emit(PT.Shard, now, 520 + Math.random() * 220, x, y, Math.cos(a) * sp, Math.sin(a) * sp - s * 1.4,
            s * 5.5, s * (0.08 + Math.random() * 0.12), i % 3 === 0 ? l : c);
          if (p) {
            p.rot = Math.random() * 6.28;
            p.vr = (Math.random() - 0.5) * 18;
          }
        }
        const d = this.count(6);
        for (let i = 0; i < d; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = s * (0.8 + Math.random() * 1.6);
          this.emit(PT.Dot, now, 400, x, y, Math.cos(a) * sp, Math.sin(a) * sp, s * 2, s * 0.05, "#fff");
        }
        break;
      }
      case "spawn": {
        const by = y + s * 0.34;
        this.fx(ET.Ring, now, 380, x, by, s * 0.7, COL.smoke, COL.smoke, 0, true, 0); // flag: flattened
        const n = this.count(10);
        for (let i = 0; i < n; i++) {
          const dir = i % 2 ? 1 : -1;
          const sp = s * (0.5 + Math.random() * 1.1) * dir;
          this.emit(PT.Smoke, now, 420 + Math.random() * 200, x + dir * s * 0.1, by, sp, -s * (0.1 + Math.random() * 0.35),
            -s * 0.2, s * (0.1 + Math.random() * 0.08), COL.smoke);
        }
        const k = this.count(5);
        for (let i = 0; i < k; i++) {
          this.emit(PT.Sparkle, now + i * 40, 520 + Math.random() * 200, x + (Math.random() - 0.5) * s * 0.8, by - Math.random() * s * 0.2,
            (Math.random() - 0.5) * s * 0.3, -s * (0.8 + Math.random() * 0.8), 0, s * (0.09 + Math.random() * 0.06),
            i % 2 ? COL.goldLight : sideLight(fx.side));
        }
        break;
      }
      case "merge": {
        const n = this.count(18);
        const R = s * 1.0;
        for (let i = 0; i < n; i++) {
          const p = this.emit(PT.Spiral, now, 440, x, y, 0, 0, 0, s * (0.05 + Math.random() * 0.04), i % 2 ? COL.green : COL.goldLight);
          if (p) {
            p.ox = x;
            p.oy = y;
            p.rot = (i / n) * Math.PI * 2;
            p.vr = 7 + Math.random() * 2;
            p.rad = R * (0.7 + Math.random() * 0.5);
          }
        }
        this.fx(ET.Flash, now, 440, x, y, s * 0.4, COL.green, COL.green, 0, false, 0); // building glow
        this.fx(ET.MergeBurst, now + 440, 1, x, y, s, COL.green, COL.goldLight, 0, false, 0);
        break;
      }
      case "replace": {
        const n = this.count(10);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = s * (0.3 + Math.random() * 0.7);
          this.emit(PT.Smoke, now, 600 + Math.random() * 300, x, y, Math.cos(a) * sp, Math.sin(a) * sp - s * 0.5,
            -s * 0.3, s * (0.14 + Math.random() * 0.1), i % 2 ? "#8d879c" : "#a9a3b8");
        }
        break;
      }
      case "heal": {
        // No amount: just the sparkle (a "stat-gain" carries the number instead).
        if (fx.amount !== undefined) this.addNumber(fx, now, 1);
        const n = this.count(7);
        for (let i = 0; i < n; i++) {
          this.emit(PT.Plus, now + i * 45, 650 + Math.random() * 300, x + (Math.random() - 0.5) * s * 0.8, y + (Math.random() - 0.3) * s * 0.3,
            (Math.random() - 0.5) * s * 0.35, -s * (0.7 + Math.random() * 0.7), 0, s * (0.09 + Math.random() * 0.06),
            i % 2 ? COL.green : "#b8f5cc");
        }
        break;
      }
      case "thorns": {
        this.fx(ET.Spikes, now, 380, x, y, s, COL.green, COL.darkGreen, 0, false, 0);
        const n = this.count(5);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = s * (1.2 + Math.random() * 1.6);
          const p = this.emit(PT.Shard, now, 380 + Math.random() * 200, x, y, Math.cos(a) * sp, Math.sin(a) * sp - s * 0.3,
            s * 3, s * (0.07 + Math.random() * 0.06), i % 2 ? COL.darkGreen : "#1f4d2e");
          if (p) {
            p.rot = a;
            p.vr = (Math.random() - 0.5) * 10;
          }
        }
        break;
      }
      case "cleave": {
        const dir = fx.side === "enemy" ? -1 : 1;
        this.fx(ET.Cleave, now, 360, x, y, s, sideCol(fx.side), sideLight(fx.side), 0, false, dir);
        const n = this.count(10);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n; // along the sweep
          const ex = x + dir * (u - 0.5) * s * 2.2;
          const ey = y - Math.sin(u * Math.PI) * s * 0.4 + s * 0.1;
          this.emit(PT.Dot, now + u * 170, 380 + Math.random() * 260, ex, ey, (Math.random() - 0.5) * s * 0.5,
            -s * (0.3 + Math.random() * 0.8), -s * 0.5, s * (0.035 + Math.random() * 0.03), i % 2 ? COL.ember : COL.goldLight);
        }
        break;
      }
      case "first-strike": {
        const dir = fx.side === "enemy" ? 1 : -1; // vertical travel: player strikes up
        this.fx(ET.Speed, now, 260, x, y, s, "#fff", sideLight(fx.side), 0, false, dir);
        this.fx(ET.Flash, now + 90, 120, x, y, s * 0.5, "#fff", "#fff", 0, false, 0);
        break;
      }
      case "last-breath": {
        const hasT = fx.tx !== undefined && fx.ty !== undefined;
        const dur = hasT ? 620 : 800;
        const e = this.fx(ET.Wisp, now, dur, x, y, s, COL.violet, "#efe6ff", 0, hasT, 0);
        e.tx = hasT ? (fx.tx as number) : x;
        e.ty = hasT ? (fx.ty as number) : y - s * 1.1;
        if (hasT) {
          const b = this.fx(ET.WispBurst, now + dur, 1, e.tx, e.ty, s, COL.violet, "#fff", 0, false, 0);
          b.done = false;
        }
        break;
      }
      case "block": {
        this.fx(ET.Shield, now, 420, x, y, s, COL.blueWhite, COL.shield, 0, false, 0);
        if (fx.amount) this.addNumber(fx, now, 2);
        break;
      }
      case "bounty": {
        if (fx.amount) this.addNumber(fx, now, 3);
        const n = this.count(9);
        for (let i = 0; i < n; i++) {
          const sp = s * (0.9 + Math.random() * 1.5);
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
          const p = this.emit(PT.Coin, now + i * 25, 650 + Math.random() * 250, x, y, Math.cos(a) * sp, Math.sin(a) * sp,
            s * 4.2, s * (0.075 + Math.random() * 0.03), COL.gold);
          if (p) p.rot = Math.random() * 6.28;
        }
        break;
      }
      case "ability-label": {
        const e = this.fx(ET.Label, now, ABILITY_LABEL_MS, x, y - s * 0.55, s, COL.goldLight, INK, 0, false, 0);
        e.text = fx.text ?? "";
        break;
      }
      case "dodge": {
        // Afterimages trail the sidestep; the word lands a beat later.
        for (let i = 0; i < 3; i++) {
          this.fx(ET.Afterimage, now + i * 45, 320, x, y, s, sideLight(fx.side), "#fff", 0, false, i % 2 ? 1 : -1);
        }
        const e = this.fx(ET.Label, now + 60, 800, x, y - s * 0.2, s * 1.15, "#e8f6ff", INK, 0, false, 0);
        e.text = "DODGE!";
        break;
      }
      case "charge-up": {
        this.fx(ET.Flash, now, 260, x, y, s * 0.75, COL.goldLight, COL.gold, 0, false, 0);
        const n = this.count(10);
        for (let i = 0; i < n; i++) {
          const p = this.emit(PT.Spiral, now, 300, x, y, 0, 0, 0, s * 0.05, i % 2 ? COL.goldLight : "#fff");
          if (p) { p.ox = x; p.oy = y; p.rot = (i / n) * Math.PI * 2; p.vr = 9; p.rad = s * 0.9; }
        }
        break;
      }
      case "overflow":
      case "bodyguard":
      case "torch": {
        const variant = fx.kind === "overflow" ? "shock" : fx.kind === "bodyguard" ? "beam" : "flame";
        const col = variant === "shock" ? "#ff5a3c" : variant === "beam" ? COL.blueWhite : "#ff9f2e";
        const e = this.fx(ET.Travel, now, variant === "beam" ? 720 : 640, x, y, s, col, "#fff", 0, false, 0);
        e.tx = fx.tx ?? x;
        e.ty = fx.ty ?? y;
        e.text = variant;
        // A burst where it lands.
        const land = this.fx(ET.Ring, now + e.dur, 420, e.tx, e.ty, s * 0.8, col, col, 0, false, 0);
        land.done = false;
        if (variant === "beam") this.fx(ET.Shield, now + e.dur, 600, e.tx, e.ty, s, COL.blueWhite, COL.shield, 0, false, 0);
        break;
      }
      case "relay": {
        const e = this.fx(ET.Travel, now, RELAY_HOP_MS, x, y, s, COL.goldLight, "#fff", fx.amount ?? 1, false, 0);
        e.tx = fx.tx ?? x;
        e.ty = fx.ty ?? y;
        e.text = "relay";
        const at = now + e.dur;
        if (fx.text) {
          // Lands on a Beacon and bounces off it: a squashed ring, a spray of
          // sparkles and the multiplier, so the boost is seen happening.
          const ring = this.fx(ET.Ring, at, 380, e.tx, e.ty, s * 0.9, COL.goldLight, COL.gold, 0, false, 0);
          ring.done = false;
          this.fx(ET.Flash, at, 220, e.tx, e.ty, s * 0.6, "#fff", COL.goldLight, 0, false, 0);
          const n = this.count(12);
          for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + ((i / n) - 0.5) * Math.PI * 1.4;
            const v = s * (2.2 + (i % 3) * 0.6);
            this.emit(PT.Sparkle, at, 520, e.tx, e.ty, Math.cos(a) * v, Math.sin(a) * v, s * 3, s * 0.07, i % 2 ? COL.goldLight : "#fff");
          }
          const label = this.fx(ET.Label, at, 1100, e.tx, e.ty - s * 0.45, s * 1.05, COL.goldLight, INK, 0, false, 0);
          label.text = fx.text;
        } else {
          const ring = this.fx(ET.Ring, at, 420, e.tx, e.ty, s * 1.0, COL.goldLight, COL.gold, 0, false, 0);
          ring.done = false;
        }
        break;
      }
      case "rally": {
        this.fx(ET.Banner, now, 1400, x, y, s, COL.gold, COL.goldLight, 0, false, 0);
        this.fx(ET.Ring, now, 900, x, y, s * 2.2, COL.goldLight, COL.gold, 0, false, 0);
        break;
      }
      case "fortify": {
        this.fx(ET.Stone, now, 1000, x, y, s, "#b9b3c9", "#6f6a82", 0, false, 0);
        const e = this.fx(ET.Label, now + 120, ABILITY_LABEL_MS, x, y - s * 0.35, s, "#d6ffe4", INK, 0, false, 0);
        e.text = `+${fx.amount ?? 1}♥ forever`;
        break;
      }
      case "rebirth": {
        this.fx(ET.Flash, now, 320, x, y, s * 0.9, "#fff", COL.goldLight, 0, false, 0);
        this.fx(ET.Ring, now + 60, 700, x, y, s * 1.8, COL.ember, COL.gold, 0, false, 0);
        // Embers rising off it, fanned upward like wings.
        const n = this.count(18);
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + ((i / n) - 0.5) * Math.PI * 1.2;
          const v = s * (1.6 + (i % 4) * 0.45);
          this.emit(PT.Spark, now + (i % 3) * 40, 760, x, y + s * 0.2, Math.cos(a) * v, Math.sin(a) * v, -s * 0.8, s * 0.08, i % 3 ? COL.ember : COL.goldLight);
        }
        break;
      }
      case "explosion":
        this.explode(x, y, s, fx.side, now);
        break;
      case "stat-gain": {
        // Big enough to read at a glance: gold for attack, green for health.
        const atk = (fx.text ?? "").includes("⚔");
        const e = this.fx(ET.Label, now, ABILITY_LABEL_MS, x, y - s * 0.1, s * 1.25,
          atk ? COL.goldLight : "#b8f5cc", INK, 0, false, 0);
        e.text = fx.text ?? "";
        break;
      }
    }
  }

  /** Kick the screen; intensity ~0..1, larger blows shake harder. */
  shake(intensity: number, now: number): void {
    if (prefersReducedMotion()) return;
    const cur = this.currentTrauma(now);
    this.trauma = Math.min(1, cur + Math.max(0, intensity));
    this.traumaAt = now;
  }

  /** Current shake offset in CSS px, applied by the renderer to the whole board. */
  shakeOffset(now: number): { x: number; y: number } {
    const tr = this.currentTrauma(now);
    if (tr <= 0.001) return { x: 0, y: 0 };
    const k = tr * tr * this.shakeSize;
    return {
      x: k * (Math.sin(now * 0.091) * 0.6 + Math.sin(now * 0.173 + 1.3) * 0.4),
      y: k * (Math.sin(now * 0.113 + 2.1) * 0.6 + Math.sin(now * 0.157 + 4.2) * 0.4),
    };
  }

  /** Draw every live effect and drop the finished ones. */
  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const dt = this.lastNow < 0 ? 0 : Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    ctx.save();
    this.drawEffects(ctx, now);
    this.drawParticles(ctx, now, dt);
    this.drawNumbers(ctx, now);
    ctx.restore();
  }

  /** Anything still on screen or still to come (particles, effects, shake), so the caller can't drop frames. */
  busy(now: number): boolean {
    if (this.effects.length > 0 || this.currentTrauma(now) > 0) return true;
    for (const p of this.parts) if (p.alive) return true;
    return false;
  }

  /** Remove everything (new match). */
  clear(): void {
    for (const p of this.parts) p.alive = false;
    this.effects.length = 0;
    this.trauma = 0;
    this.lastNow = -1;
  }

  // ---- internals ----

  private currentTrauma(now: number): number {
    return Math.max(0, this.trauma - (now - this.traumaAt) / SHAKE_MS);
  }

  private count(n: number): number {
    return this.reduced ? Math.max(2, Math.round(n * 0.35)) : n;
  }

  private emit(type: PT, t0: number, life: number, x: number, y: number, vx: number, vy: number, g: number,
    size: number, color: string): Particle | null {
    const parts = this.parts;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = parts[(this.cursor + i) % MAX_PARTICLES];
      if (!p.alive) {
        this.cursor = (this.cursor + i + 1) % MAX_PARTICLES;
        p.alive = true; p.type = type; p.t0 = t0; p.life = life; p.x = x; p.y = y;
        p.vx = vx; p.vy = vy; p.g = g; p.size = size; p.color = color;
        p.rot = 0; p.vr = 0; p.rad = 0; p.ox = x; p.oy = y;
        return p;
      }
    }
    return null;
  }

  private fx(type: ET, t0: number, dur: number, x: number, y: number, size: number, color: string, color2: string,
    amount: number, flag: boolean, dir: number): Effect {
    const e: Effect = { type, t0, dur, x, y, size, color, color2, amount, flag, dir, done: false, style: 0, tx: 0, ty: 0, text: "" };
    this.effects.push(e);
    return e;
  }

  private addNumber(fx: FxSpawn, now: number, style = 0): void {
    // Stack: push new numbers up/aside past any still-fresh ones nearby.
    let stack = 0;
    for (const e of this.effects) {
      if (e.type === ET.Number && now - e.t0 < 600 && Math.abs(e.x - fx.x) < fx.size * 0.9 && Math.abs(e.y - fx.y) < fx.size * 1.5) stack++;
    }
    const e = this.fx(ET.Number, now, fx.lethal ? 1100 : 900, fx.x + (stack % 2 ? 1 : -1) * Math.min(stack, 2) * fx.size * 0.18,
      fx.y - stack * fx.size * 0.34, fx.size, fx.lethal ? COL.goldLight : "#fff", fx.lethal ? COL.enemy : INK,
      fx.amount ?? 0, !!fx.lethal, fx.side === "enemy" ? -1 : 1);
    e.done = false;
    // Number effects don't travel, so tx / ty carry the folded-in block and heal.
    e.tx = style === 0 ? fx.blocked ?? 0 : 0;
    e.ty = style === 0 ? fx.healed ?? 0 : 0;
    if (style > 0) {
      e.style = style;
      e.flag = false;
      e.dur = 900;
      e.dir = 1;
      e.x = fx.x;
      if (style === 1) { e.color = "#d6ffe4"; e.color2 = "#1c5a33"; }
      else if (style === 2) { e.color = COL.grey; e.color2 = INK; }
      else { e.color = COL.goldLight; e.color2 = "#6b4a00"; }
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, now: number): void {
    const list = this.effects;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.type === ET.MergeBurst || e.type === ET.WispBurst) {
        if (now >= e.t0) {
          if (e.type === ET.MergeBurst) this.mergeBurst(e, now);
          else this.wispBurst(e, now);
          continue; // consumed
        }
        list[w++] = e;
        continue;
      }
      if (now - e.t0 >= e.dur) continue;
      list[w++] = e;
      if (now < e.t0 || e.type === ET.Number) continue;
      const t = (now - e.t0) / e.dur;
      switch (e.type) {
        case ET.Slash:
          this.drawSlash(ctx, e, t);
          break;
        case ET.Spikes:
          this.drawSpikes(ctx, e, t);
          break;
        case ET.Cleave:
          this.drawCleave(ctx, e, t);
          break;
        case ET.Speed:
          this.drawSpeed(ctx, e, t);
          break;
        case ET.Shield:
          this.drawShield(ctx, e, t);
          break;
        case ET.Wisp:
          this.drawWisp(ctx, e, t);
          break;
        case ET.Label:
          this.drawLabel(ctx, e, t);
          break;
        case ET.Travel:
          this.drawTravel(ctx, e, t);
          break;
        case ET.Afterimage:
          this.drawAfterimage(ctx, e, t);
          break;
        case ET.Banner:
          this.drawBanner(ctx, e, t);
          break;
        case ET.Stone:
          this.drawStone(ctx, e, t);
          break;
        case ET.Fireball:
          this.drawFireball(ctx, e, t);
          break;
        case ET.Ring: {
          const r = e.size * (0.15 + easeOutCubic(t));
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.strokeStyle = e.color;
          ctx.lineWidth = Math.max(1, e.size * 0.12 * (1 - t));
          ctx.beginPath();
          if (e.flag) ctx.ellipse(e.x, e.y, r * 1.2, r * 0.35, 0, 0, 6.2832);
          else ctx.arc(e.x, e.y, r, 0, 6.2832);
          ctx.stroke();
          break;
        }
        case ET.Flash: {
          const building = e.color === COL.green; // merge glow grows then holds
          const a = building ? easeInCubic(t) * 0.55 : (1 - t) * (1 - t);
          const r = e.size * (building ? 0.6 + t * 0.5 : 0.7 + easeOutCubic(t) * 0.8);
          ctx.globalCompositeOperation = "lighter";
          const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
          g.addColorStop(0, e.color);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.globalAlpha = a;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, 6.2832);
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
          break;
        }
      }
    }
    list.length = w;
    ctx.globalAlpha = 1;
  }

  /**
   * The match-losing blast. Plain Canvas 2D only (gradients, arcs, "lighter"
   * compositing), never `ctx.filter`, which Safari ignores, so it looks the
   * same on iOS, Android and desktop. Particles move by frame time, so 120 Hz
   * screens don't run it fast. About 120 particles at most; reduced motion
   * keeps the flash and fireball, drops the shake and most of the debris.
   */
  private explode(x: number, y: number, s: number, side: Side | undefined, now: number): void {
    const R = s * 2.6;
    if (!this.reduced) {
      this.shakeSize = s * 0.55;
      this.trauma = 1;
      this.traumaAt = now;
    }
    this.fx(ET.Flash, now, 260, x, y, R * 1.5, "#ffffff", "#fff", 0, false, 0);
    this.fx(ET.Fireball, now, 1100, x, y, R, "#fff6c8", COL.ember, 0, false, 0);
    this.fx(ET.Ring, now + 40, 650, x, y, R * 1.7, "#ffd9a0", "#fff", 0, false, 0);
    this.fx(ET.Ring, now + 160, 800, x, y, R * 2.3, COL.ember, COL.ember, 0, false, 0);
    const c = sideCol(side);
    const l = sideLight(side);
    const shards = this.count(42);
    for (let i = 0; i < shards; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = s * (2.5 + Math.random() * 5);
      const p = this.emit(PT.Shard, now, 900 + Math.random() * 600, x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.3,
        Math.cos(a) * sp, Math.sin(a) * sp - s * 2.2, s * 7, s * (0.09 + Math.random() * 0.16), i % 4 === 0 ? INK : i % 4 === 1 ? l : c);
      if (p) {
        p.rot = Math.random() * 6.28;
        p.vr = (Math.random() - 0.5) * 22;
      }
    }
    const sparks = this.count(28);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = s * (4 + Math.random() * 6);
      this.emit(PT.Spark, now, 380 + Math.random() * 380, x, y, Math.cos(a) * sp, Math.sin(a) * sp, s * 4,
        s * (0.05 + Math.random() * 0.04), i % 3 === 0 ? "#fff" : i % 3 === 1 ? COL.goldLight : COL.ember);
    }
    const smoke = this.count(18);
    for (let i = 0; i < smoke; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R * 0.6;
      this.emit(PT.Smoke, now + 150 + Math.random() * 250, 1500 + Math.random() * 700, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7,
        Math.cos(a) * s * 0.8, -s * (0.4 + Math.random() * 0.8), -s * 0.35, s * (0.35 + Math.random() * 0.3), i % 2 ? "#4b4458" : "#6d6680");
    }
    const embers = this.count(24);
    for (let i = 0; i < embers; i++) {
      this.emit(PT.Dot, now + 200 + Math.random() * 500, 1300 + Math.random() * 900, x + (Math.random() - 0.5) * R * 1.4,
        y + (Math.random() - 0.5) * R * 0.8, (Math.random() - 0.5) * s * 0.8, -s * (0.6 + Math.random() * 1.2), -s * 0.2,
        s * (0.04 + Math.random() * 0.04), i % 2 ? COL.ember : COL.goldLight);
    }
  }

  /** Fireball: layered radial gradients (no blur filter) that swell, then cool from white to red and fade. */
  private drawFireball(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const grow = easeOutCubic(clamp01(t / 0.35));
    const fade = t < 0.3 ? 1 : 1 - easeInCubic((t - 0.3) / 0.7);
    const R = e.size * (0.25 + grow * 0.95);
    ctx.globalCompositeOperation = "lighter";
    const layers: [number, string, string][] = [
      [1, "rgba(255,120,40,0.85)", "rgba(160,20,10,0)"],
      [0.7, "rgba(255,190,80,0.9)", "rgba(255,90,30,0)"],
      [0.38 * (1 - t * 0.6), "rgba(255,255,235,1)", "rgba(255,210,120,0)"],
    ];
    for (const [k, inner, outer] of layers) {
      const r = Math.max(1, R * k);
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.globalAlpha = fade;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    // Billowing lobes give the ball an edge rather than a perfect circle.
    ctx.globalAlpha = fade * 0.4;
    ctx.fillStyle = t < 0.4 ? "#ffb347" : "#c2452d";
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + t * 1.5;
      const d = R * (0.55 + 0.12 * Math.sin(i * 2.3 + t * 9));
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d * 0.8, R * 0.32 * (1 - t * 0.5), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private mergeBurst(e: Effect, now: number): void {
    const s = e.size;
    this.fx(ET.Ring, now, 480, e.x, e.y, s * 1.3, COL.green, COL.green, 0, false, 0);
    this.fx(ET.Ring, now, 360, e.x, e.y, s * 0.8, COL.goldLight, COL.goldLight, 0, false, 0);
    this.fx(ET.Flash, now, 260, e.x, e.y, s * 1.1, COL.goldLight, "#fff", 0, false, 0);
    const n = this.count(18);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = s * (1.6 + Math.random() * 2.4);
      this.emit(i % 3 ? PT.Spark : PT.Sparkle, now, 400 + Math.random() * 250, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, s * 1.2,
        s * (0.05 + Math.random() * 0.06), i % 2 ? COL.green : COL.goldLight);
    }
  }

  private wispBurst(e: Effect, now: number): void {
    const s = e.size;
    this.fx(ET.Ring, now, 340, e.x, e.y, s * 0.8, COL.violet, COL.violet, 0, false, 0);
    this.fx(ET.Flash, now, 200, e.x, e.y, s * 0.6, COL.violet, "#fff", 0, false, 0);
    const n = this.count(10);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = s * (0.8 + Math.random() * 1.6);
      this.emit(i % 2 ? PT.Sparkle : PT.Dot, now, 380 + Math.random() * 200, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0,
        s * (0.04 + Math.random() * 0.04), i % 2 ? COL.violet : "#fff");
    }
  }

  private drawSpikes(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const s = e.size;
    const r0 = s * (0.18 + easeOutCubic(t) * 0.5);
    const len = s * 0.3 * (1 - t * 0.6) * Math.min(1, t * 8);
    ctx.globalAlpha = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    ctx.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? e.color : e.color2;
      ctx.lineWidth = Math.max(1.5, s * (pass ? 0.05 : 0.1));
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const l = i % 2 ? len * 0.7 : len;
        ctx.moveTo(e.x + c * r0, e.y + sn * r0);
        ctx.lineTo(e.x + c * (r0 + l), e.y + sn * (r0 + l));
      }
      ctx.stroke();
    }
  }

  private drawCleave(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const s = e.size;
    const head = lerp(Math.PI * 1.05, Math.PI * 1.95, easeOutCubic(clamp01(t / 0.6)));
    const tail = lerp(Math.PI * 1.05, Math.PI * 1.95, easeOutCubic(clamp01((t - 0.15) / 0.85)));
    if (head - tail < 0.02) return;
    const fade = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
    ctx.save();
    ctx.translate(e.x, e.y + s * 0.15);
    ctx.scale(e.dir, 1);
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 * fade;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = s * 0.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.15, s * 0.5, 0, tail, head);
    ctx.stroke();
    ctx.globalAlpha = 0.9 * fade;
    ctx.strokeStyle = e.color2;
    ctx.lineWidth = s * 0.24;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.15, s * 0.5, 0, lerp(tail, head, 0.2), head);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2, s * 0.07);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.15, s * 0.5, 0, lerp(tail, head, 0.5), head);
    ctx.stroke();
    ctx.restore();
  }

  private drawSpeed(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const s = e.size;
    const k = easeOutCubic(clamp01(t / 0.7));
    ctx.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? "#fff" : e.color2;
      ctx.lineWidth = Math.max(1, s * (pass ? 0.03 : 0.07));
      ctx.globalAlpha = (1 - t) * (pass ? 1 : 0.7);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const f1 = (i * 0.618) % 1;
        const f2 = (i * 0.377 + 0.2) % 1;
        const x = e.x + (f1 - 0.5) * s * 0.9;
        const len = s * (0.45 + f2 * 0.6);
        const head = e.y - e.dir * s * (1.3 * (1 - k) + 0.05);
        ctx.moveTo(x, head - e.dir * len * (1 - t * 0.4));
        ctx.lineTo(x, head);
      }
      ctx.stroke();
    }
  }

  private drawShield(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const s = e.size;
    const k = Math.max(0.01, easeOutBack(clamp01(t / 0.3)));
    const w = s * 0.26 * k;
    const h = s * 0.32 * k;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalAlpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
    ctx.beginPath();
    ctx.moveTo(-w, -h * 0.7);
    ctx.lineTo(0, -h);
    ctx.lineTo(w, -h * 0.7);
    ctx.lineTo(w, h * 0.1);
    ctx.quadraticCurveTo(w * 0.7, h * 0.7, 0, h);
    ctx.quadraticCurveTo(-w * 0.7, h * 0.7, -w, h * 0.1);
    ctx.closePath();
    ctx.fillStyle = e.color;
    ctx.globalAlpha *= 0.85;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.strokeStyle = e.color2;
    ctx.stroke();
    // chevron
    ctx.strokeStyle = e.color2;
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, -h * 0.05);
    ctx.lineTo(0, h * 0.35);
    ctx.lineTo(w * 0.5, -h * 0.05);
    ctx.stroke();
    ctx.restore();
    // glint ring
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath();
    ctx.arc(e.x, e.y, s * (0.2 + easeOutCubic(t) * 0.35), 0, 6.2832);
    ctx.stroke();
  }

  private drawWisp(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const s = e.size;
    const trail = e.flag ? easeInCubic : easeOutCubic;
    const fade = t > 0.75 && !e.flag ? 1 - (t - 0.75) / 0.25 : 1;
    // Trail: fixed samples behind the head, no allocation.
    for (let i = 5; i >= 0; i--) {
      const tt = clamp01(t - i * 0.04);
      const k = trail(tt);
      const x = lerp(e.x, e.tx, k) + Math.sin(tt * 9) * s * 0.08 * (e.flag ? 1 : 1 - tt);
      const y = lerp(e.y, e.ty, k);
      const head = i === 0;
      const r = s * (head ? 0.17 : 0.13 - i * 0.015);
      ctx.globalAlpha = (head ? 0.8 : 0.28 - i * 0.04) * fade;
      ctx.fillStyle = head ? "#f4eeff" : e.color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r), 0, 6.2832);
      ctx.fill();
      if (head) {
        // wispy tail tip
        ctx.globalAlpha = 0.35 * fade;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.ellipse(x, y + r * 1.4, r * 0.6, r * 1.5, 0, 0, 6.2832);
        ctx.fill();
      }
    }
  }

  /** Floating text: pops in, rises, fades. Ability names and "DODGE!". */
  private drawLabel(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const pop = t < 0.18 ? easeOutBack(t / 0.18) : 1;
    const fs = Math.max(10, e.size * 0.32) * pop;
    ctx.save();
    ctx.globalAlpha = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
    ctx.font = `800 ${Math.round(fs)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const y = e.y - easeOutCubic(t) * e.size * 0.45;
    ctx.lineWidth = Math.max(2, fs * 0.22);
    ctx.strokeStyle = e.color2;
    ctx.strokeText(e.text, e.x, y);
    ctx.fillStyle = e.color;
    ctx.fillText(e.text, e.x, y);
    ctx.restore();
  }

  /**
   * Something crossing from (x,y) to (tx,ty): a red shockwave (Overflow), a
   * shield beam (Bodyguard) or an arcing flame (Pass the torch).
   */
  private drawTravel(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const k = easeOutCubic(t);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (e.text === "beam") {
      // A beam that draws itself across, then thins out.
      const ex = lerp(e.x, e.tx, Math.min(1, k * 1.4));
      const ey = lerp(e.y, e.ty, Math.min(1, k * 1.4));
      ctx.globalAlpha = 1 - t * 0.7;
      ctx.strokeStyle = e.color;
      ctx.lineCap = "round";
      ctx.lineWidth = e.size * 0.22 * (1 - t * 0.6);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth *= 0.35;
      ctx.stroke();
    } else if (e.text === "relay") {
      // A bouncing orb: an arc bulging to the side of its path (rows are
      // stacked, so an upward arc would overshoot the target), a short comet
      // tail, and bigger after every Beacon (`amount`), so the boost reads as growth.
      const scale = e.amount || 1;
      const dx = e.tx - e.x;
      const dy = e.ty - e.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const bulge = e.size * 0.8;
      const at = (q: number) => {
        const kq = easeOutCubic(clamp01(q));
        const h = bulge * Math.sin(Math.PI * kq);
        return { px: lerp(e.x, e.tx, kq) + nx * h, py: lerp(e.y, e.ty, kq) + ny * h };
      };
      for (let i = 4; i >= 0; i--) {
        const { px, py } = at(t - i * 0.05);
        const r = e.size * 0.17 * scale * (1 - i * 0.16);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.2);
        g.addColorStop(0, "#fff");
        g.addColorStop(0.4, e.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = (i === 0 ? 1 : 0.45 - i * 0.08) * (t > 0.9 ? (1 - t) * 10 : 1);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, r * 2.2, 0, 6.2832);
        ctx.fill();
      }
    } else {
      // A projectile: straight for the shockwave, an arc for the flame.
      const arc = e.text === "flame" ? -e.size * 0.9 * Math.sin(Math.PI * k) : 0;
      const px = lerp(e.x, e.tx, k) + arc;
      const py = lerp(e.y, e.ty, k);
      const r = e.size * (e.text === "shock" ? 0.28 + 0.18 * Math.sin(t * 20) : 0.2);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.35, e.color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 1 - t * 0.3;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r * 2, 0, 6.2832);
      ctx.fill();
      if (e.text === "shock") {
        // Concentric ripple around the travelling front.
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(1, e.size * 0.06);
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.beginPath();
        ctx.ellipse(px, py, r * 2.6, r * 1.2, 0, 0, 6.2832);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Evasion: a ghost of the unit slipping sideways. */
  private drawAfterimage(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const off = e.dir * e.size * 0.55 * easeOutCubic(t);
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.45;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.ellipse(e.x + off, e.y, e.size * 0.32, e.size * 0.42, 0, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = e.color2;
    ctx.lineWidth = Math.max(1, e.size * 0.04);
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(e.x + off - e.dir * e.size * 0.5, e.y + i * e.size * 0.18);
      ctx.lineTo(e.x + off - e.dir * e.size * 0.95, e.y + i * e.size * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Last rally: a gold pennant that unfurls upward and fades. */
  private drawBanner(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const rise = easeOutBack(Math.min(1, t * 2)) * e.size * 1.1;
    const s = e.size;
    ctx.save();
    ctx.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
    const x = e.x;
    const top = e.y - rise;
    ctx.strokeStyle = "#8a6a2a";
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(x, e.y);
    ctx.lineTo(x, top - s * 0.1);
    ctx.stroke();
    const wave = Math.sin(t * 14) * s * 0.06;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + s * 0.7, top + s * 0.12 + wave);
    ctx.lineTo(x + s * 0.55, top + s * 0.3);
    ctx.lineTo(x + s * 0.7, top + s * 0.48 + wave);
    ctx.lineTo(x, top + s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = e.color2;
    ctx.font = `800 ${Math.round(s * 0.3)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⚜", x + s * 0.3, top + s * 0.28);
    ctx.restore();
  }

  /** Fortify: a hexagon of stone that settles onto the unit. */
  private drawStone(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const r = e.size * (0.9 - 0.25 * easeOutCubic(t));
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.85;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = Math.max(2, e.size * 0.1 * (1 - t * 0.5));
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const px = e.x + Math.cos(a) * r;
      const py = e.y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha *= 0.25;
    ctx.fillStyle = e.color2;
    ctx.fill();
    ctx.restore();
  }

  private drawSlash(ctx: CanvasRenderingContext2D, e: Effect, t: number): void {
    const R = e.size * 0.8;
    // Sweep from upper-leading to lower-trailing; head runs ahead of the tail.
    const a0 = -1.15;
    const a1 = 1.15;
    const head = lerp(a0, a1, easeOutCubic(clamp01(t / 0.65)));
    const tail = lerp(a0, a1, easeOutCubic(clamp01((t - 0.2) / 0.8)));
    if (head - tail < 0.02) return;
    ctx.save();
    ctx.translate(e.x - e.dir * R * 0.35, e.y);
    ctx.scale(e.dir, 1);
    ctx.lineCap = "round";
    const fade = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45 * fade;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = e.size * 0.26;
    ctx.beginPath();
    ctx.arc(0, 0, R, tail, head);
    ctx.stroke();
    ctx.globalAlpha = 0.9 * fade;
    ctx.strokeStyle = e.color2;
    ctx.lineWidth = e.size * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, R, lerp(tail, head, 0.25), head);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(1.5, e.size * 0.04);
    ctx.beginPath();
    ctx.arc(0, 0, R, lerp(tail, head, 0.45), head);
    ctx.stroke();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, now: number, dt: number): void {
    const parts = this.parts;
    ctx.lineCap = "round";
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = parts[i];
      if (!p.alive) continue;
      const age = now - p.t0;
      if (age >= p.life) {
        p.alive = false;
        continue;
      }
      if (age < 0) continue;
      const t = age / p.life;
      if (p.type === PT.Spiral) {
        p.rot += p.vr * dt;
        const r = p.rad * (1 - t) * (1 - t);
        p.x = p.ox + Math.cos(p.rot) * r;
        p.y = p.oy + Math.sin(p.rot) * r;
      } else {
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.type === PT.Smoke || p.type === PT.Sparkle) {
          p.vx *= 1 - 1.5 * dt;
          p.vy *= p.type === PT.Smoke ? 1 - 1.5 * dt : 1;
        }
        p.rot += p.vr * dt;
      }
      switch (p.type) {
        case PT.Spark: {
          ctx.globalAlpha = 1 - t * t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * (1 - t * 0.6));
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
          ctx.stroke();
          break;
        }
        case PT.Dot: {
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.8, p.size * (1 - t * 0.5)), 0, 6.2832);
          ctx.fill();
          break;
        }
        case PT.Shard: {
          ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
          ctx.fillStyle = p.color;
          const s = p.size * (1 - t * 0.35);
          const c = Math.cos(p.rot);
          const sn = Math.sin(p.rot);
          ctx.beginPath();
          ctx.moveTo(p.x + c * s, p.y + sn * s);
          ctx.lineTo(p.x - sn * s * 0.55 - c * s * 0.6, p.y + c * s * 0.55 - sn * s * 0.6);
          ctx.lineTo(p.x + sn * s * 0.55 - c * s * 0.6, p.y - c * s * 0.55 - sn * s * 0.6);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case PT.Smoke: {
          ctx.globalAlpha = (1 - t) * 0.5;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + easeOutCubic(t) * 1.4), 0, 6.2832);
          ctx.fill();
          break;
        }
        case PT.Plus: {
          ctx.globalAlpha = (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4) * 0.85;
          ctx.fillStyle = p.color;
          const a = p.size * (1 - t * 0.3);
          const b = a * 0.38;
          ctx.fillRect(p.x - a, p.y - b, a * 2, b * 2);
          ctx.fillRect(p.x - b, p.y - a, b * 2, a * 2);
          break;
        }
        case PT.Coin: {
          ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          const r = p.size;
          const sx = Math.max(0.15, Math.abs(Math.cos(p.rot + age * 0.012))); // spin
          ctx.fillStyle = COL.gold;
          ctx.strokeStyle = "#8a5a00";
          ctx.lineWidth = Math.max(1, r * 0.2);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r * sx, r, 0, 0, 6.2832);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#fff6c2";
          ctx.beginPath();
          ctx.arc(p.x - r * sx * 0.3, p.y - r * 0.3, Math.max(0.6, r * 0.25), 0, 6.2832);
          ctx.fill();
          break;
        }
        case PT.Sparkle:
        case PT.Spiral: {
          const a = p.type === PT.Spiral ? Math.min(1, t * 5) : t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          const s = p.size * (p.type === PT.Spiral ? 1 : 1 - t * 0.5);
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - s * 1.6);
          ctx.lineTo(p.x + s * 0.4, p.y - s * 0.4);
          ctx.lineTo(p.x + s * 1.6, p.y);
          ctx.lineTo(p.x + s * 0.4, p.y + s * 0.4);
          ctx.lineTo(p.x, p.y + s * 1.6);
          ctx.lineTo(p.x - s * 0.4, p.y + s * 0.4);
          ctx.lineTo(p.x - s * 1.6, p.y);
          ctx.lineTo(p.x - s * 0.4, p.y - s * 0.4);
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawNumbers(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const e of this.effects) {
      if (e.type !== ET.Number || now < e.t0) continue;
      const age = now - e.t0;
      const t = age / e.dur;
      const big = e.flag;
      const pop = easeOutBack(clamp01(age / (big ? 240 : 180)));
      const st = e.style;
      // Damage reads at a glance: big enough to see on a phone row, red, with
      // a heavy outline. Heals, blocks and bounty stay smaller beside it.
      const px = e.size * (big ? 1.0 : st === 2 ? 0.34 : st === 0 ? 0.78 : 0.56) * Math.max(0.01, pop);
      const rise = easeOutCubic(t) * e.size * (big ? 0.9 : 1.0);
      let x = e.x;
      if (big && t < 0.5) x += Math.sin(age * 0.09) * e.size * 0.05 * (1 - t * 2); // shaky
      const y = e.y - e.size * 0.2 - rise;
      ctx.globalAlpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      ctx.font = `900 ${px.toFixed(1)}px system-ui, -apple-system, sans-serif`;
      const text = big ? `☠ −${e.amount}` : st === 1 || st === 3 ? `+${e.amount}` : st === 2 ? `−${e.amount} blocked` : `−${e.amount}`;
      ctx.lineWidth = Math.max(2.5, px * (st === 0 || big ? 0.26 : 0.2));
      ctx.strokeStyle = big ? "#4a0f0a" : st === 0 ? "#2a0705" : e.color2;
      // A short red glow as the number pops, fading before it rises away.
      if ((st === 0 || big) && t < 0.4) {
        ctx.shadowColor = "rgba(255, 60, 40, 0.9)";
        ctx.shadowBlur = px * 0.5 * (1 - t / 0.4);
      }
      ctx.strokeText(text, x, y);
      ctx.shadowBlur = 0;
      if (big) {
        const g = ctx.createLinearGradient(0, y - px * 0.5, 0, y + px * 0.5);
        g.addColorStop(0, COL.goldLight);
        g.addColorStop(1, "#ff5a43");
        ctx.fillStyle = g;
      } else if (st === 0) {
        const g = ctx.createLinearGradient(0, y - px * 0.5, 0, y + px * 0.5);
        g.addColorStop(0, "#ffd2c9");
        g.addColorStop(0.45, "#ff5a43");
        g.addColorStop(1, "#d8261a");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = st === 1 ? COL.green : e.color;
      }
      ctx.fillText(text, x, y);
      // Blocked and healed ride along under the damage (feedback 2026-10-30:
      // too many numbers at once on a phone).
      if (st === 0 && (e.tx > 0 || e.ty > 0)) {
        const sub = [e.tx > 0 ? `🛡${e.tx}` : "", e.ty > 0 ? `+${e.ty}` : ""].filter(Boolean).join(" ");
        const spx = px * 0.46;
        const sy = y + px * 0.62;
        ctx.font = `800 ${spx.toFixed(1)}px system-ui, -apple-system, sans-serif`;
        ctx.lineWidth = Math.max(2, spx * 0.24);
        ctx.strokeStyle = e.ty > 0 ? "#1c5a33" : INK;
        ctx.strokeText(sub, x, sy);
        ctx.fillStyle = e.ty > 0 ? COL.green : COL.grey;
        ctx.fillText(sub, x, sy);
      }
    }
    ctx.globalAlpha = 1;
  }
}
