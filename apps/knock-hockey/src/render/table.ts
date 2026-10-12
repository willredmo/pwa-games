import { DT, launch, moving, step, wobble, type Contact, type Launch, type Puck, type Shot } from "../physics/sim";
import type { BoardFeel } from "../physics/board";
import { GOAL_X0, GOAL_X1, H, PUCK_R, STANDARD, W, type GoalSide, type Layout, type Vec } from "../physics/table";
import type { Player, ShotOutcome } from "../game/match";
import type { StickLook } from "../game/stick";
import { clack, unlockSound } from "../game/sound";
import { P1_COLOR, P2_COLOR, drawAimLine, drawBoard, drawPuck, fitBoard, toBoard, type View } from "./board";
import { drawStick } from "./stick";

// The board on screen: draws it, takes your aim and power, animates the CPU's
// (or an online opponent's) stick, and plays shots out with the same
// fixed-step physics the CPU searches with. React owns the rules
// (game/match.ts); this owns the canvas.
//
// Shooting: press anywhere on the board and drag back, like a slingshot —
// the shot points from your finger back toward where you pressed, and the
// drag's length is the power. A marker shows where you pressed and a dashed
// white line runs to your finger. The ↺ ↻ buttons, arrow keys and power bar
// fine-tune. Nothing fires until you press Hit (or Space).

/** Pull-back gap at zero and full power, board units. */
const BACK_MIN = 2;
const BACK_MAX = 62;
/** Drag length (board units) for full power, and the dead zone before a drag counts. */
const DRAG_FULL = 150;
const DRAG_DEAD = 6;
/** Below this the release cancels instead of shooting. */
export const MIN_POWER = 0.04;

/** Who is taking the current shot. */
export type Controller = "local" | "cpu" | "remote";

export type { Launch };

export interface TableEvents {
  /** Pull-back changed (0–1), so the power bar can follow. */
  onPull: (power: number) => void;
  /** The stick has started its swing: the turn is committed. */
  onFire: (launch: Launch, by: Controller) => void;
  /** Your aim or power changed while lining up (for showing an online opponent). */
  onAim?: (angle: number, power: number) => void;
  /** The puck has stopped, or gone in. */
  onShot: (out: ShotOutcome) => void;
}

type Phase = "waiting" | "aiming" | "cpu" | "striking" | "rolling";

interface Strike {
  t0: number;
  dur: number;
  fromBack: number;
  launch: Launch;
}

interface CpuMove {
  t0: number;
  fromAngle: number;
  toAngle: number;
  fromPower: number;
  shot: Shot;
  /** An exact launch to replay (online opponent, goal replay). */
  exact?: Launch;
  /** Line up quickly (an online opponent, whose aim was already shown live). */
  quick?: boolean;
}

interface Fade {
  t0: number;
  player: Player;
  angle: number;
  at: Vec;
}

const now = () => performance.now();
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class Table {
  aimLine = true;
  /** This match's board character (physics/board.ts); null is a perfectly true board. */
  board: BoardFeel | null = null;
  /** This match's corners (steep by default, or 45°). */
  layout: Layout = STANDARD;
  /** Draw the board turned 180°, so the top goal is at the bottom (online guest). */
  flipped = false;
  private ctx: CanvasRenderingContext2D;
  private view: View = { scale: 1, ox: 0, oy: 0 };
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private acc = 0;

  private puck: Puck;
  private phase: Phase = "waiting";
  private shooter: Player | null = null;
  private controller: Controller = "local";
  /** An online opponent's live aim, eased toward. */
  private remoteAim: { angle: number; power: number } | null = null;
  private lastAimSent = { angle: NaN, power: NaN };
  private aim = -Math.PI / 2;
  private power = 0;
  private looks: Record<Player, StickLook>;

  private strike: Strike | null = null;
  private cpu: CpuMove | null = null;
  private fade: Fade | null = null;
  private contacts: Contact[] = [];
  /** The shot now rolling, as it left the stick (kept for goal replays). */
  private lastLaunch: Launch | null = null;
  /** Slow motion for replays: 1 is real time. Only the puck slows; the stick doesn't. */
  timeScale = 1;
  private trail: Vec[] = [];
  private sparks: { x: number; y: number; t0: number; s: number }[] = [];
  /**
   * How a goal blows the puck up, Rocket League style, keyed by the goal it
   * goes into: every goal explodes; one that would win the match (set by the
   * game before each shot) gets the big one.
   */
  explodeInto: Partial<Record<GoalSide, BoomSize>> = { top: "normal", bottom: "normal" };
  private boom: Boom | null = null;
  private goal: { side: GoalSide; t0: number } | null = null;
  private ro: ResizeObserver;
  /** A drag to set angle and power: where it started and where the finger is (board units). */
  private drag: { id: number; start: Vec; cur: Vec } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private events: TableEvents,
    at: Vec,
    looks: Record<Player, StickLook>,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.looks = looks;
    this.puck = { x: at.x, y: at.y, vx: 0, vy: 0 };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.up);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.up);
  }

  setLooks(looks: Record<Player, StickLook>): void {
    this.looks = looks;
  }

  /** Put the puck down (match start, a goal's restart, a resumed save). */
  placePuck(at: Vec): void {
    this.boom = null;
    // Anything still in motion is dropped (a replay skipping ahead).
    if (this.phase === "rolling" || this.phase === "striking") this.phase = "waiting";
    this.strike = null;
    this.cpu = null;
    this.fade = null;
    this.puck = { x: at.x, y: at.y, vx: 0, vy: 0 };
    this.trail = [];
    this.goal = null;
  }

  /**
   * Hand the stick to `who`. Local turns take input; CPU turns wait for
   * `playCpu`; remote turns follow `setRemoteAim` and wait for `playRemote`.
   */
  beginTurn(who: Player, controller: Controller): void {
    this.shooter = who;
    this.controller = controller;
    this.phase = controller === "local" ? "aiming" : "cpu";
    this.cpu = null;
    this.remoteAim = null;
    this.power = 0;
    this.events.onPull(0);
    // Start aimed straight at the goal being attacked.
    const gy = who === "p1" ? 0 : H;
    this.aim = Math.atan2(gy - this.puck.y, W / 2 - this.puck.x);
  }

  /** No one's turn (goal celebration, end of match). */
  idle(): void {
    this.shooter = null;
    this.phase = "waiting";
  }

  get canAim(): boolean {
    return this.phase === "aiming" && this.controller === "local" && !this.strike;
  }

  /** Swing with the current power and aim. The only way a human shot fires. */
  hit(): void {
    if (!this.canAim || this.power < MIN_POWER) return;
    this.fire({ angle: this.aim, power: this.power });
  }

  /** Turn the aim, from the ↺ ↻ buttons (the only way to aim). Positive is clockwise on screen. */
  nudge(deg: number): void {
    if (!this.canAim) return;
    this.aim += (deg * Math.PI) / 180;
  }

  /** The power bar is being set. */
  barPull(power: number): void {
    if (!this.canAim) return;
    this.power = clamp01(power);
    this.events.onPull(this.power);
  }

  /** Raise or lower the power (↑ ↓ keys). */
  addPower(delta: number): void {
    this.barPull(this.power + delta);
  }

  /** Animate the CPU lining up `shot`, pulling back, and hitting. */
  playCpu(shot: Shot): void {
    if (this.phase !== "cpu") return;
    // Turn the short way round.
    let to = shot.angle;
    while (to - this.aim > Math.PI) to -= Math.PI * 2;
    while (to - this.aim < -Math.PI) to += Math.PI * 2;
    this.cpu = { t0: now(), fromAngle: this.aim, toAngle: to, fromPower: 0, shot: { angle: to, power: shot.power } };
  }

  /** An online opponent is lining up: show their stick where they have it. */
  setRemoteAim(angle: number, power: number): void {
    if (this.phase !== "cpu" || this.controller !== "remote" || this.cpu) return;
    this.remoteAim = { angle, power };
  }

  /** Replay an online opponent's shot exactly as it left their stick. */
  /**
   * Replay an exact launch: an online opponent's shot, or a goal replay. An
   * opponent's line-up was already shown live, so it settles quickly; a
   * replay (`leisurely`) lines up at the CPU's unhurried pace.
   */
  playRemote(l: Launch, leisurely = false): void {
    if (this.phase !== "cpu" || this.controller !== "remote") return;
    // Start from exactly where their puck was.
    this.puck = { x: l.x, y: l.y, vx: 0, vy: 0 };
    this.goal = null;
    let to = l.angle;
    while (to - this.aim > Math.PI) to -= Math.PI * 2;
    while (to - this.aim < -Math.PI) to += Math.PI * 2;
    this.remoteAim = null;
    this.cpu = { t0: now(), fromAngle: this.aim, toAngle: to, fromPower: this.power, shot: { angle: to, power: l.power }, exact: l, quick: !leisurely };
  }

  // --- Input ---------------------------------------------------------------

  private boardPoint(e: PointerEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    const p = toBoard(this.view, e.clientX - r.left, e.clientY - r.top);
    // Turned round (online guest): screen points map to the far side of the board.
    return this.flipped ? { x: W - p.x, y: H - p.y } : p;
  }

  private down = (e: PointerEvent) => {
    unlockSound(); // browsers only allow audio after a tap
    if (!this.canAim || this.drag) return;
    capture(this.canvas, e.pointerId);
    const p = this.boardPoint(e);
    this.drag = { id: e.pointerId, start: p, cur: p };
    e.preventDefault();
  };

  private move = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!this.canAim) {
      this.drag = null;
      return;
    }
    d.cur = this.boardPoint(e);
    // Slingshot: the shot points from the finger back toward the press.
    const dx = d.start.x - d.cur.x;
    const dy = d.start.y - d.cur.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < DRAG_DEAD) return; // a tap, or a shaky start: leave aim and power alone
    this.aim = Math.atan2(dy, dx);
    this.power = clamp01((len - DRAG_DEAD) / DRAG_FULL);
    this.events.onPull(this.power);
  };

  /** Letting go keeps the angle and power; the Hit button shoots. */
  private up = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = null;
  };

  private fire(intended: Shot, exact?: Launch): void {
    this.phase = "striking";
    let l: Launch;
    if (exact) l = exact;
    else {
      // Every hit, yours or the CPU's, wobbles slightly off what was intended.
      // (An online opponent's wobble was rolled on their device.)
      const shot = wobble(intended);
      const p = launch(this.puck, shot);
      l = { x: this.puck.x, y: this.puck.y, vx: p.vx, vy: p.vy, angle: shot.angle, power: shot.power };
    }
    this.events.onFire(l, this.controller);
    // Harder hits snap forward faster.
    this.strike = { t0: now(), dur: 150 - 70 * l.power, fromBack: this.back(), launch: l };
  }

  // --- Animation and physics -----------------------------------------------

  private back(): number {
    return BACK_MIN + (BACK_MAX - BACK_MIN) * this.power;
  }

  private pose() {
    return { x: this.puck.x, y: this.puck.y, angle: this.aim, back: this.back() };
  }

  private frame = (t: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, this.last ? (t - this.last) / 1000 : 0);
    this.last = t;
    this.update(t, dt);
    this.draw(t);
  };

  private update(t: number, dt: number): void {
    // CPU: turn to aim (0.5 s), pull back (0.7 s), hold, hit. An online
    // opponent's line-up was already shown live, so theirs just settles quickly.
    if (this.cpu && this.phase === "cpu") {
      const e = t - this.cpu.t0;
      const quick = !!this.cpu.quick;
      const TURN = quick ? 160 : 520;
      const PULL = quick ? 200 : 700;
      const HOLD = quick ? 80 : 220;
      const { fromPower, shot } = this.cpu;
      this.aim = this.cpu.fromAngle + (this.cpu.toAngle - this.cpu.fromAngle) * ease(clamp01(e / TURN));
      this.power = fromPower + (shot.power - fromPower) * ease(clamp01((e - TURN) / PULL));
      this.events.onPull(this.power);
      if (e >= TURN + PULL + HOLD) {
        const exact = this.cpu.exact;
        this.cpu = null;
        this.fire(shot, exact);
      }
    } else if (this.remoteAim && this.phase === "cpu") {
      // Ease toward the opponent's live aim, the short way round.
      let d = this.remoteAim.angle - this.aim;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const k = Math.min(1, dt * 12);
      this.aim += d * k;
      this.power += (this.remoteAim.power - this.power) * k;
      this.events.onPull(this.power);
    }

    // Report your own line-up as it changes, for an online opponent to watch.
    if (this.events.onAim && this.canAim && (this.aim !== this.lastAimSent.angle || this.power !== this.lastAimSent.power)) {
      this.lastAimSent = { angle: this.aim, power: this.power };
      this.events.onAim(this.aim, this.power);
    }

    if (this.strike) {
      const k = clamp01((t - this.strike.t0) / this.strike.dur);
      // Accelerate into the puck.
      this.power = (1 - k * k) * ((this.strike.fromBack - BACK_MIN) / (BACK_MAX - BACK_MIN));
      if (k >= 1) {
        const l = this.strike.launch;
        this.strike = null;
        this.power = 0;
        this.events.onPull(0);
        this.fade = { t0: t, player: this.shooter!, angle: l.angle, at: { x: l.x, y: l.y } };
        this.puck = { x: l.x, y: l.y, vx: l.vx, vy: l.vy };
        this.contacts = [];
        this.lastLaunch = l;
        this.trail = [];
        this.acc = 0;
        this.phase = "rolling";
        clack("stick", 0.25 + l.power * 0.75);
      }
    }

    if (this.phase === "rolling") {
      this.acc += dt * this.timeScale;
      let scored: GoalSide | null = null;
      while (this.acc >= DT && moving(this.puck)) {
        this.acc -= DT;
        const n = this.contacts.length;
        scored = step(this.puck, this.contacts, this.board, this.layout);
        for (let i = n; i < this.contacts.length; i++) {
          const c = this.contacts[i];
          const s = Math.min(1, c.speed / 900);
          clack(c.kind, s);
          if (s > 0.12) this.sparks.push({ x: c.x, y: c.y, t0: t, s });
        }
        if (scored) break;
      }
      this.trail.push({ x: this.puck.x, y: this.puck.y });
      if (this.trail.length > 14) this.trail.shift();
      if (scored || !moving(this.puck)) {
        if (scored) {
          this.goal = { side: scored, t0: t };
          const size = this.explodeInto[scored];
          if (size) this.boom = makeBoom(this.puck, scored, t, size);
        }
        this.phase = "waiting";
        this.shooter = null;
        this.events.onShot({
          goal: scored,
          rest: { x: this.puck.x, y: this.puck.y },
          contacts: this.contacts,
          power: this.lastLaunch?.power ?? 0,
          launch: this.lastLaunch ?? undefined,
        });
      }
    } else if (this.trail.length) {
      this.trail.shift();
    }
  }

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const cw = host.clientWidth;
    const ch = host.clientHeight;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.view = fitBoard(cw, ch);
  }

  private draw(t: number): void {
    const { ctx, view, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
    if (this.flipped) {
      // Turned 180° about the board's centre.
      ctx.translate(W, H);
      ctx.scale(-1, -1);
    }
    // The explosion shakes the whole board for a moment (not with Reduce Motion).
    if (this.boom && !reducedMotion()) {
      const k = (t - this.boom.t0) / BOOM_SHAKE_MS;
      if (k < 1) {
        const a = (1 - k) * (1 - k) * 4.5 * this.boom.scale;
        ctx.translate(Math.sin(t * 0.09) * a, Math.cos(t * 0.11) * a);
      }
    }
    drawBoard(ctx, this.layout);

    // Trail behind a moving puck.
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      ctx.fillStyle = `rgba(30,30,35,${(i / this.trail.length) * 0.16})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PUCK_R * (0.5 + (i / this.trail.length) * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    const color = this.shooter === "p2" ? P2_COLOR : P1_COLOR;
    // Turn ring around the puck.
    if (this.shooter && this.phase !== "rolling") {
      const pulse = 0.5 + 0.5 * Math.sin(t / 260);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35 + 0.35 * pulse;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(this.puck.x, this.puck.y, PUCK_R + 5 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // A goal: the puck drops into the slot.
    let puckAlpha = 1;
    if (this.goal) {
      const k = clamp01((t - this.goal.t0) / 450);
      puckAlpha = this.boom ? 0 : 1 - k; // blown up: gone at once
    }
    drawPuck(ctx, this.puck, puckAlpha);

    if (this.shooter && (this.phase === "aiming" || this.phase === "cpu" || this.phase === "striking")) {
      if (this.aimLine && this.controller === "local" && this.phase === "aiming") drawAimLine(ctx, this.puck, this.aim, color);
      drawStick(ctx, this.looks[this.shooter], this.pose());
    }
    if (this.drag && this.canAim) drawDrag(ctx, this.drag.start, this.drag.cur);
    // Follow-through: the stick ends up just behind where the puck was, then fades.
    if (this.fade) {
      const k = (t - this.fade.t0) / 520;
      if (k >= 1) this.fade = null;
      else
        drawStick(ctx, this.looks[this.fade.player], {
          ...this.fade.at,
          angle: this.fade.angle,
          back: -PUCK_R * 0.6 * ease(clamp01(k * 3)),
          alpha: 1 - ease(clamp01((k - 0.3) / 0.7)),
        });
    }

    // Impact sparks: a quick ring at each hard bounce.
    this.sparks = this.sparks.filter((s) => t - s.t0 < 320);
    for (const s of this.sparks) {
      const k = (t - s.t0) / 320;
      ctx.strokeStyle = `rgba(255,244,214,${(1 - k) * 0.9})`;
      ctx.lineWidth = 2 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3 + k * (8 + 10 * s.s), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.boom) {
      if (drawBoom(ctx, this.boom, t, this.timeScale)) this.boom = null;
    }

    // Goal flash on the scoring end.
    if (this.goal) {
      const k = (t - this.goal.t0) / 1300;
      if (k < 1) {
        const y = this.goal.side === "top" ? 0 : H;
        const scorerColor = this.goal.side === "top" ? P1_COLOR : P2_COLOR;
        const g = ctx.createRadialGradient(W / 2, y, 4, W / 2, y, 170);
        g.addColorStop(0, hexA(scorerColor, 0.55 * (1 - k)));
        g.addColorStop(1, hexA(scorerColor, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, y === 0 ? 0 : H - 170, W, 170);
        ctx.strokeStyle = hexA("#fff4c2", 1 - k);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(GOAL_X0, y);
        ctx.lineTo(GOAL_X1, y);
        ctx.stroke();
      }
    }
  }
}

// --- Goal explosion ----------------------------------------------------------

const BOOM_SHAKE_MS = 650;

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export type BoomSize = "normal" | "big";

interface Boom {
  t0: number;
  /** 1 for a normal goal, bigger for a match winner. */
  scale: number;
  x: number;
  y: number;
  color: string;
  /** Splinters and sparks: start offset, velocity (units/s), size, colour, life (s). */
  bits: { vx: number; vy: number; size: number; color: string; life: number; spin: number }[];
}

function makeBoom(p: Vec, side: GoalSide, t0: number, size: BoomSize): Boom {
  const scale = size === "big" ? 1.6 : 1;
  const color = side === "top" ? P1_COLOR : P2_COLOR;
  // Blast back out of the goal mouth, into the board.
  const into = side === "top" ? 1 : -1;
  const palette = [color, color, "#f2b632", "#fff4c2", "#ffffff", "#c8925a"];
  const bits = Array.from({ length: Math.round(48 * scale) }, (_, i) => {
    const a = Math.PI * (0.05 + Math.random() * 0.9); // a fan pointing into the board
    const speed = (120 + Math.random() * 420) * scale;
    return {
      vx: Math.cos(a) * speed * (Math.random() < 0.5 ? 1 : -1) * 0.9,
      vy: Math.sin(a) * speed * into,
      size: (1.5 + Math.random() * 3.5) * Math.sqrt(scale),
      color: palette[i % palette.length],
      life: 0.7 + Math.random() * 0.8,
      spin: Math.random() * Math.PI,
    };
  });
  return { t0, scale, x: p.x, y: side === "top" ? 0 : H, color, bits };
}

/** Draw the explosion; returns true once it's over. Slows with replays' slow-mo. */
function drawBoom(ctx: CanvasRenderingContext2D, b: Boom, t: number, timeScale: number): boolean {
  const e = ((t - b.t0) / 1000) * timeScale; // seconds of explosion time
  if (e > 1.6) return true;
  ctx.save();
  // Flash.
  if (e < 0.22) {
    const k = e / 0.22;
    const r = 120 * b.scale;
    const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, r);
    g.addColorStop(0, `rgba(255,255,240,${0.95 * (1 - k)})`);
    g.addColorStop(1, "rgba(255,255,240,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Two shockwave rings.
  for (const [delay, reach, width] of [
    [0, 150, 5],
    [0.09, 100, 3],
  ] as const) {
    const k = (e - delay) / 0.6;
    if (k <= 0 || k >= 1) continue;
    ctx.strokeStyle = hexA(b.color, (1 - k) * 0.9);
    ctx.lineWidth = width * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 10 + reach * b.scale * (1 - (1 - k) * (1 - k)), 0, Math.PI * 2);
    ctx.stroke();
  }
  // Splinters and sparks, slowing as they fly.
  for (const p of b.bits) {
    if (e > p.life) continue;
    const k = e / p.life;
    const travel = (1 - Math.exp(-2.2 * e)) / 2.2; // drag
    const x = b.x + p.vx * travel;
    const y = b.y + p.vy * travel;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = p.color;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.spin + e * 8);
    ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
    ctx.restore();
  }
  ctx.restore();
  return false;
}

/** Keep getting moves outside the element. Can throw if the pointer is already gone. */
export function capture(el: Element, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* fine: moves still arrive while over the element */
  }
}

/** Where the drag started (a ring and dot) and a dashed white line to the finger. */
function drawDrag(ctx: CanvasRenderingContext2D, start: Vec, cur: Vec): void {
  ctx.save();
  ctx.lineCap = "round";
  // A dark under-stroke keeps the white readable on the light wood.
  for (const [color, width] of [
    ["rgba(20,14,6,0.35)", 4],
    ["#ffffff", 2.2],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(cur.x, cur.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(start.x, start.y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 3, 0, Math.PI * 2);
  ctx.fill();
  // The finger end.
  ctx.beginPath();
  ctx.arc(cur.x, cur.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, a)})`;
}
