import type { Board, Shape, Side, Unit } from "../engine/types";
import { capacityOf } from "../engine/board";
import { MAX_LEVEL, levelOf } from "../engine/units";
import { levelCapOf } from "../engine/board";
import {
  activePose,
  clamp01,
  easeInOutSine,
  easeOutBack,
  easeOutCubic,
  prefersReducedMotion,
  pulse,
  type Pose,
  type PoseState,
} from "./anim";
import { drawCharacter, kawaiiOn } from "./characters";
import { bloodOn } from "./blood";
import type { FxLayer } from "./fx";

// Imperative Canvas 2D board renderer.
//
// Theming per the doc: abstract/geometric — units are flat shapes, colour
// encodes ownership, shape encodes unit type. Generic over lane count/depth.
// CSS owns the display size; this only sets the backing store for DPR.

const COLORS = {
  panel: "#201d30",
  slot: "#2a2640",
  slotEdge: "#39335a",
  player: "#3a86d6",
  playerEdge: "#9ecbf5",
  enemy: "#d1483a",
  enemyEdge: "#f2a294",
  text: "#f4f2fb",
  name: "#c9c3e4",
  atkText: "#ffc94d",
  hpText: "#5fe08f",
  hpTrack: "#14121f",
  /** Warden's shield: its bar and the number beside the stats. */
  shield: "#7fd3ff",
  shieldSpent: "rgba(127, 211, 255, 0.4)",
  hpFill: "#4ad07a",
  target: "#f0b429",
  merge: "#5fe08f",
  replace: "#e08a4a",
  invalid: "#e0574a",
  mid: "#4a4368",
  energy: "#8d7bff",
} as const;

/** Cap on lane width so a one-lane row doesn't stretch into full-width bars. */
const MAX_LANE_ASPECT = 8;
/** Absolute cap on slot width (CSS px) so wide windows stay readable, not stretched. */
const MAX_LANE_W = 320;
/** The same cap during a battle, when the board takes the screen (battle view). */
const MAX_LANE_W_BATTLE = 560;

/**
 * Battle view: while a battle plays, the rows under the board collapse (App.css
 * `.app--battle`) and the board and its units may grow past their picking-phase
 * caps, so the fight is easy to follow. A module flag rather than a parameter,
 * because `cellCenter` (where effects land) must agree with `draw`; Game sets it
 * as it renders and `draw` from `RenderState.battle` every frame.
 */
let battleTarget = false;
/**
 * How far into battle view the board is drawn, 0 (picking) .. 1 (battle). It
 * eases toward the target over BATTLE_VIEW_MS rather than switching, so the
 * board and its units grow into a battle and shrink back out of it, in step
 * with App.css collapsing the rows under the board. Advanced once per frame by
 * `draw`; `cellCenter` reads the same value, so effects land where units are.
 */
let battleT = 0;
let battleLast = -1;
// Matches Game's BOARD_ZOOM_MS (the board's own move) and App.css's controls-in.
const BATTLE_VIEW_MS = 700;
export function setBattleView(on: boolean): void {
  battleTarget = on;
}
function stepBattleView(now: number): void {
  const dt = battleLast < 0 ? 0 : Math.max(0, now - battleLast);
  battleLast = now;
  if (prefersReducedMotion()) {
    battleT = battleTarget ? 1 : 0;
    return;
  }
  const k = Math.min(1, dt / BATTLE_VIEW_MS);
  battleT = battleTarget ? Math.min(1, battleT + k) : Math.max(0, battleT - k);
}
/** The eased battle-view amount the caps interpolate by. */
const battleView = () => easeInOutSine(battleT);

export interface Cell {
  side: Side;
  lane: number;
  spot: number;
  /**
   * Which half of the slot the pointer is over, when it came from a pointer.
   * Holding a placed unit over a same-type unit, left (the character) merges
   * and right (the stats) just moves — otherwise twins could never be reordered.
   */
  zone?: "left" | "right";
}

export type TargetKind =
  | "place"
  | "insert"
  | "merge"
  | "replace"
  | "reorder"
  | "merge-or-move"
  | "merge-or-add";

/** Colour and badge text per drop outcome — shared by outlines, badges and labels. */
const KIND_STYLE: Record<TargetKind, { color: string; badge: string }> = {
  place: { color: COLORS.target, badge: "＋ ADD" },
  insert: { color: COLORS.target, badge: "↧ INSERT" },
  merge: { color: COLORS.merge, badge: "⇪ MERGE" },
  replace: { color: COLORS.replace, badge: "⇄ REPLACE" },
  reorder: { color: "#b8b0e0", badge: "↕ MOVE" },
  // A same-type unit while moving one of yours: split slot, see drawDropHints.
  "merge-or-move": { color: COLORS.merge, badge: "⇪ MERGE  |  MOVE ↕" },
  // A same-type unit while holding an offer, with room: left merges, right inserts.
  "merge-or-add": { color: COLORS.merge, badge: "⇪ MERGE  |  INSERT ↧" },
};

export interface CellHit {
  side: Side;
  lane: number;
  spot: number;
  amount: number;
  dying: boolean;
}

export interface RenderState {
  board: Board;
  validTargets: Cell[];
  hits: CellHit[];
  /** Slot currently hovered during a drag, drawn as the insertion point. */
  dropCell?: Cell | null;
  /** What the hovered slot would do, so the colour matches the outcome. */
  /** "reorder" (and an absent kind) fall through to the neutral gold outline. */
  dropKind?: "place" | "merge" | "replace" | "reorder" | "invalid";
  /**
   * What dropping the held unit on each valid target would do, keyed
   * "lane,spot". Lets every option be colour-coded and badged before the
   * pointer reaches it, not just the hovered one.
   */
  targetKinds?: Record<string, TargetKind>;
  /** Outcome text for the hovered slot, e.g. "MERGE ⚔6→9 ♥4→6". */
  dropLabel?: string | null;
  /** Unit type in hand, drawn as a faint preview when it would be added. */
  heldKey?: string | null;
  /** Unit being dragged — drawn faded, since it's "lifted off" the board. */
  draggingId?: string | null;
  /**
   * Unit click-selected and waiting for a destination. Ringed rather than faded
   * (the drag treatment): it's still standing there, and unlike a drag there's
   * no ghost following the pointer to show what's in hand.
   */
  selectedId?: string | null;
  /**
   * Resolves an augment id to its badge glyph. Injected rather than imported so
   * the renderer stays generic over the game layer.
   */
  auraIcon?: (id: string) => string;
  /** A unit's shown name (kawaii mode renames yours); defaults to `unit.name`. */
  unitName?: (unit: Unit) => string;
  /** A unit's class glyph (⚔ 🛡 ✚), drawn before its name. Injected like `auraIcon`. */
  classIcon?: (unit: Unit) => string | undefined;
  /**
   * Merges a unit still needs to promote (a Squire to a Knight), or null if it
   * isn't on such a path. Injected for the same reason: the threshold depends
   * on that side's augments (Early knighthood).
   */
  promoteIn?: (unit: Unit) => number | null;
  /**
   * A battle is playing: light the clash zone, halo each side's front unit
   * (the only one that fights) and dim the queue behind it.
   */
  battle?: boolean;
  /** Animation clock (ms, performance.now). Drawn once per frame by App's rAF loop. */
  time?: number;
  /** Per-unit one-shot poses keyed by unit id, set by App (see board/anim.ts). */
  poses?: Record<string, PoseState>;
  /** Transient effects layer, owned by App, drawn on top of the board. */
  fx?: FxLayer;
}

/** Aura badges drawn per unit before collapsing the rest into a "+N". */
const MAX_AURA_BADGES = 4;

interface Layout {
  ox: number;
  oy: number;
  laneW: number;
  rowH: number;
  rows: number;
}

function layout(canvas: HTMLCanvasElement, board: Board): Layout | null {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (cw <= 0 || ch <= 0) return null;
  const rows = board.depth * 2;
  const rowH = ch / rows;
  const laneCap = MAX_LANE_W + (MAX_LANE_W_BATTLE - MAX_LANE_W) * battleView();
  const laneW = Math.min(cw / board.lanes, laneCap, rowH * MAX_LANE_ASPECT);
  return { ox: (cw - laneW * board.lanes) / 2, oy: 0, laneW, rowH, rows };
}

/** Canvas row (0 = enemy back … 2*depth-1 = player back) → side + spot. */
function rowToSideSpot(board: Board, row: number): { side: Side; spot: number } {
  if (row < board.depth) return { side: "enemy", spot: board.depth - 1 - row };
  return { side: "player", spot: row - board.depth };
}

function sideSpotToRow(board: Board, side: Side, spot: number): number {
  return side === "enemy" ? board.depth - 1 - spot : board.depth + spot;
}

export function pixelToCell(
  canvas: HTMLCanvasElement,
  board: Board,
  x: number,
  y: number,
): Cell | null {
  const l = layout(canvas, board);
  if (!l) return null;
  const lane = Math.floor((x - l.ox) / l.laneW);
  const row = Math.floor((y - l.oy) / l.rowH);
  if (lane < 0 || lane >= board.lanes || row < 0 || row >= l.rows) return null;
  const { side, spot } = rowToSideSpot(board, row);
  const zone = x - (l.ox + lane * l.laneW) < l.laneW / 2 ? "left" : "right";
  return { side, lane, spot, zone };
}

/**
 * Centre of a cell in CSS px, plus the cell height — where App anchors effects
 * (damage numbers, slashes, bursts) so they line up with what's drawn.
 */
export function cellCenter(
  canvas: HTMLCanvasElement,
  board: Board,
  cell: Cell,
): { x: number; y: number; size: number } | null {
  const l = layout(canvas, board);
  if (!l) return null;
  const row = sideSpotToRow(board, cell.side, cell.spot);
  return {
    x: l.ox + (cell.lane + 0.5) * l.laneW,
    y: l.oy + (row + 0.5) * l.rowH,
    // Effects (damage numbers, labels, bursts) scale with this, so it's capped
    // like the unit itself (UNIT_MAX_H) rather than growing with the row.
    size: l.rowH * contentScale(l.rowH),
  };
}

/**
 * Where a unit's character stands in its slot (left of its name and stats),
 * for effects that belong on the body (a death, blood) rather than the slot's
 * middle. Matches drawUnit's layout: contents scaled by `contentScale` about
 * the slot's left edge, the character CHAR_X across. Ignores lunges.
 */
export function unitCenter(
  canvas: HTMLCanvasElement,
  board: Board,
  cell: Cell,
): { x: number; y: number; size: number } | null {
  const l = layout(canvas, board);
  if (!l) return null;
  const row = sideSpotToRow(board, cell.side, cell.spot);
  const pad = Math.min(l.laneW, l.rowH) * 0.03;
  const h = l.rowH - pad * 2;
  return {
    x: l.ox + cell.lane * l.laneW + pad + h * CHAR_X * contentScale(h),
    y: l.oy + (row + 0.5) * l.rowH,
    size: l.rowH * contentScale(l.rowH),
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Trace a unit's shape centred at (cx, cy) with radius r. */
export function traceShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.beginPath();
  switch (shape) {
    case "circle":
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case "square": {
      const s = r * 0.88;
      ctx.rect(cx - s, cy - s, s * 2, s * 2);
      break;
    }
    case "triangle":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.92, cy + r * 0.75);
      ctx.lineTo(cx - r * 0.92, cy + r * 0.75);
      ctx.closePath();
      break;
    case "diamond":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
    case "shield":
      ctx.moveTo(cx - r * 0.8, cy - r * 0.86);
      ctx.lineTo(cx + r * 0.8, cy - r * 0.86);
      ctx.lineTo(cx + r * 0.8, cy + r * 0.12);
      ctx.quadraticCurveTo(cx + r * 0.64, cy + r * 0.72, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.64, cy + r * 0.72, cx - r * 0.8, cy + r * 0.12);
      ctx.closePath();
      break;
    case "hexagon":
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
  }
}

// ---- per-unit visual state (module-level so it survives across frames) ----

interface UnitVis {
  row: number; // displayed row (float)
  hp: number; // eased hp
  ghost: number; // lingering damage chunk
  ghostHold: number; // ms before ghost drains
  flash: number; // 0..1 bar flash after a hit
  lastHp: number;
  seed: number;
  pose: Pose;
  t: number;
  stamp: number;
}

const vis = new Map<string, UnitVis>();
let frameStamp = 0;
let lastTime = -1;
let lastDt = 16;
let energy = 0;

const DASH_TARGET = [5, 4];
const DASH_MID = [12, 9];
const NO_DASH: number[] = [];
/**
 * Character box as a share of the slot height. Body plus legs span about
 * 2.3 body radii (R = 0.72 x size), so 0.58 keeps them inside the row; at the
 * old 0.78 the feet and heads spilled into the neighbouring rows.
 */
const CHAR_SIZE = 0.58;
/**
 * Tallest a unit is drawn, in CSS px. Rows grow with the window (rowH reached
 * 84 on a 768×1024 tablet), and everything in a slot scaled with them, so big
 * screens showed huge characters and stats. Past this the slot still grows but
 * its contents stay this size, centred vertically; phones (rowH ~42) are below
 * it and unchanged. This is a project rule (CLAUDE.md, "Layout"): anything a
 * unit draws must respect it.
 */
const UNIT_MAX_H = 52;
/**
 * The cap in battle view: the user asked for a board that's easy to watch, and
 * during a battle nothing else competes for the screen. Picking keeps 52, so
 * the rule above still holds where the board shares the screen with controls.
 */
const UNIT_MAX_H_BATTLE = 96;
/** Scale for a slot's contents: 1 up to the unit cap, smaller past it. */
const contentScale = (h: number) => Math.min(1, (UNIT_MAX_H + (UNIT_MAX_H_BATTLE - UNIT_MAX_H) * battleView()) / h);
/** Character centre and text column, from the slot's left edge, in slot heights. */
const CHAR_X = 0.56;
const TEXT_X = 1.12;
/** Empty slots: a fine dotted edge, distinct from the bolder animated target dash. */
const DASH_EMPTY = [2, 4];

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

function updateVis(
  board: Board,
  state: RenderState,
  time: number,
  dt: number,
  animated: boolean,
  reduce: boolean,
): void {
  frameStamp++;
  let activity = 0;
  const slideK = 1 - Math.exp(-dt / 110);
  const hpK = 1 - Math.exp(-dt / 120);
  const drainK = 1 - Math.exp(-dt / 220);
  for (const side of ["enemy", "player"] as const) {
    const lanes = board.slots[side];
    for (let lane = 0; lane < lanes.length; lane++) {
      const col = lanes[lane];
      for (let spot = 0; spot < col.length; spot++) {
        const u = col[spot];
        if (!u) continue;
        const target = sideSpotToRow(board, side, spot);
        let v = vis.get(u.id);
        if (!v) {
          v = {
            row: target, hp: u.hp, ghost: u.hp, ghostHold: 0, flash: 0, lastHp: u.hp,
            seed: hashId(u.id), pose: "idle", t: 0, stamp: 0,
          };
          vis.set(u.id, v);
        }
        v.stamp = frameStamp;
        // Slide toward the target row.
        if (!animated || reduce) v.row = target;
        else {
          v.row += (target - v.row) * slideK;
          if (Math.abs(target - v.row) < 0.002) v.row = target;
        }
        // HP easing + ghost chunk.
        if (!animated) {
          v.hp = v.ghost = u.hp;
          v.flash = 0;
        } else {
          if (u.hp < v.lastHp) {
            v.flash = 1;
            v.ghost = Math.max(v.ghost, v.hp, v.lastHp);
            v.ghostHold = 380;
          }
          v.lastHp = u.hp;
          v.hp = reduce ? u.hp : v.hp + (u.hp - v.hp) * hpK;
          if (Math.abs(u.hp - v.hp) < 0.01) v.hp = u.hp;
          if (v.ghostHold > 0) v.ghostHold -= dt;
          else v.ghost += (v.hp - v.ghost) * drainK;
          if (v.ghost < v.hp) v.ghost = v.hp;
          v.flash = Math.max(0, v.flash - dt / 260);
        }
        const ap = animated ? activePose(state.poses?.[u.id], time) : { pose: "idle" as Pose, t: 0 };
        v.pose = ap.pose;
        v.t = ap.t;
        if (ap.pose === "attack") activity = Math.max(activity, pulse(ap.t));
        else if (ap.pose === "hit") activity = Math.max(activity, 0.8 * (1 - ap.t));
      }
    }
  }
  if (vis.size > 0) for (const [id, v] of vis) if (v.stamp !== frameStamp) vis.delete(id);
  energy += (activity - energy) * (1 - Math.exp(-dt / (activity > energy ? 50 : 220)));
}

/** A heart centred on (x, y), `r` about half its width (Kawaii board decor). */
function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 1.1);
  ctx.bezierCurveTo(x - r * 1.6, y, x - r * 1.1, y - r * 1.3, x, y - r * 0.45);
  ctx.bezierCurveTo(x + r * 1.1, y - r * 1.3, x + r * 1.6, y, x, y + r * 1.1);
}

/**
 * Kawaii board decor, inside the arena: soft hearts drifting up and sparkles
 * twinkling, faint enough to sit behind the slots. Seeded positions, moved by
 * the clock (time, not frames) and still under reduced motion.
 */
function drawKawaiiDecor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number, still: boolean): void {
  const t = still ? 0 : time;
  for (let i = 0; i < 14; i++) {
    const px = x + ((i * 0.618 + 0.11) % 1) * w;
    const speed = 0.006 + (i % 4) * 0.002;
    const py = y + h - ((((i * 0.37) % 1) * h + t * speed) % (h + 40)) + 20;
    const r = 5 + (i % 3) * 3;
    ctx.globalAlpha = 0.08 + (i % 3) * 0.035;
    ctx.fillStyle = i % 2 ? "#ff8fc8" : "#ffb3d9";
    heartPath(ctx, px + Math.sin(t / 900 + i) * 6, py, r);
    ctx.fill();
  }
  for (let i = 0; i < 18; i++) {
    const px = x + ((i * 0.754 + 0.3) % 1) * w;
    const py = y + ((i * 0.433 + 0.07) % 1) * h;
    const tw = 0.5 + 0.5 * Math.sin(t / 600 + i * 1.7);
    const s = 1.5 + tw * 2;
    ctx.globalAlpha = 0.1 + tw * 0.2;
    ctx.fillStyle = i % 3 ? "#fff" : "#ffe27a";
    ctx.beginPath();
    ctx.moveTo(px, py - s * 1.6);
    ctx.lineTo(px + s * 0.4, py - s * 0.4);
    ctx.lineTo(px + s * 1.6, py);
    ctx.lineTo(px + s * 0.4, py + s * 0.4);
    ctx.lineTo(px, py + s * 1.6);
    ctx.lineTo(px - s * 0.4, py + s * 0.4);
    ctx.lineTo(px - s * 1.6, py);
    ctx.lineTo(px - s * 0.4, py - s * 0.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function draw(canvas: HTMLCanvasElement, state: RenderState): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { board } = state;
  battleTarget = !!state.battle;
  stepBattleView(state.time ?? performance.now());
  const l = layout(canvas, board);
  if (!l) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const bw = Math.round(cw * dpr);
  const bh = Math.round(ch * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const animated = state.time !== undefined;
  const time = state.time ?? 0;
  const reduce = prefersReducedMotion();
  if (animated && time !== lastTime) {
    lastDt = lastTime < 0 ? 16 : Math.max(0, Math.min(100, time - lastTime));
    lastTime = time;
    updateVis(board, state, time, lastDt, true, reduce);
  } else if (!animated) {
    updateVis(board, state, 0, 16, false, reduce);
  }

  ctx.save();
  if (state.fx && animated && !reduce) {
    const o = state.fx.shakeOffset(time);
    ctx.translate(o.x, o.y);
  }

  const targetSet = new Set(state.validTargets.map((c) => `${c.lane},${c.spot}`));
  const pad = Math.min(l.laneW, l.rowH) * 0.03;
  const bx = l.ox;
  const bwid = l.laneW * board.lanes;
  const bht = l.rowH * l.rows;
  const midY = l.oy + board.depth * l.rowH;
  // Kawaii mode: a pink-and-lavender arena with drifting hearts.
  const cute = kawaiiOn();

  // Arena panel with gradient + soft vignette.
  const pp = pad * 1.5;
  roundRect(ctx, bx - pp, l.oy - pp, bwid + pp * 2, bht + pp * 2, 10);
  const g = ctx.createLinearGradient(0, l.oy, 0, l.oy + bht);
  g.addColorStop(0, cute ? "#4a2148" : "#2a1d2e");
  g.addColorStop(0.5, cute ? "#3a2152" : "#201d30");
  g.addColorStop(1, cute ? "#2d2a5c" : "#1a2038");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const vg = ctx.createRadialGradient(
    bx + bwid / 2, l.oy + bht / 2, Math.min(bwid, bht) * 0.35,
    bx + bwid / 2, l.oy + bht / 2, Math.max(bwid, bht) * 0.75,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, cute ? "rgba(40,0,40,0.3)" : "rgba(0,0,0,0.45)");
  ctx.fillStyle = vg;
  ctx.fillRect(bx - pp, l.oy - pp, bwid + pp * 2, bht + pp * 2);
  if (cute) drawKawaiiDecor(ctx, bx - pp, l.oy - pp, bwid + pp * 2, bht + pp * 2, time, reduce);
  ctx.restore();
  if (cute) {
    roundRect(ctx, bx - pp, l.oy - pp, bwid + pp * 2, bht + pp * 2, 10);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255, 143, 200, 0.45)";
    ctx.stroke();
  }

  const hasDrop = !!state.dropCell;
  const pulse1 = 0.5 + 0.5 * Math.sin(time / 180);

  // Slots (static layer).
  for (let lane = 0; lane < board.lanes; lane++) {
    for (let row = 0; row < l.rows; row++) {
      const { side, spot } = rowToSideSpot(board, row);
      const x = l.ox + lane * l.laneW + pad;
      const y = l.oy + row * l.rowH + pad;
      const w = l.laneW - pad * 2;
      const h = l.rowH - pad * 2;
      const unit = board.slots[side][lane][spot];
      const isTarget = side === "player" && targetSet.has(`${lane},${spot}`);
      const isDrop =
        hasDrop &&
        state.dropCell!.side === side &&
        state.dropCell!.lane === lane &&
        state.dropCell!.spot === spot;
      const kind = isTarget ? state.targetKinds?.[`${lane},${spot}`] : undefined;
      const dropColor = isDrop
        ? state.dropKind === "merge"
          ? COLORS.merge
          : state.dropKind === "replace"
            ? COLORS.replace
            : state.dropKind === "invalid"
              ? COLORS.invalid
              : COLORS.target
        : kind
          ? KIND_STYLE[kind].color
          : COLORS.target;
      const r = Math.min(w, h) * 0.16;

      // Empty (and unlocked) slots recede: a faint wash with a dotted edge and
      // their queue position, so filled slots stand out and the room left reads.
      const empty = !unit && spot < capacityOf(board, side);
      roundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = cute ? (empty ? "rgba(255, 143, 200, 0.07)" : "rgba(74, 40, 92, 0.92)") : empty ? "rgba(42, 38, 64, 0.35)" : COLORS.slot;
      ctx.fill();
      ctx.fillStyle = cute
        ? side === "player" ? "rgba(255,143,200,0.08)" : "rgba(209,72,58,0.06)"
        : side === "player" ? "rgba(58,134,214,0.07)" : "rgba(209,72,58,0.07)";
      ctx.fill();
      if (empty) {
        const k = h * contentScale(h); // where a unit's character would stand
        ctx.font = `700 ${Math.round(Math.max(10, k * 0.3))}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (cute) {
          // Empty slots hold a little heart instead of a number.
          ctx.fillStyle = side === "player" ? "rgba(255, 143, 200, 0.3)" : "rgba(255, 133, 119, 0.22)";
          heartPath(ctx, x + k * CHAR_X, y + h / 2, k * 0.12);
          ctx.fill();
        } else {
          ctx.fillStyle = side === "player" ? "rgba(125, 184, 255, 0.28)" : "rgba(255, 133, 119, 0.24)";
          ctx.fillText(`${spot + 1}`, x + k * CHAR_X, y + h / 2);
        }
        ctx.textAlign = "left";
      }

      if (isDrop || isTarget) {
        ctx.lineWidth = isDrop ? Math.max(3, h * 0.1) * (0.8 + 0.3 * pulse1) : Math.max(2, h * 0.05);
        ctx.strokeStyle = dropColor;
        if (isDrop) {
          ctx.shadowColor = dropColor;
          ctx.shadowBlur = 6 + 10 * pulse1;
        } else {
          ctx.setLineDash(DASH_TARGET);
          ctx.lineDashOffset = -time * 0.02;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash(NO_DASH);
        ctx.lineDashOffset = 0;
      } else if (empty) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = cute ? "rgba(255, 143, 200, 0.4)" : "rgba(90, 81, 128, 0.45)";
        ctx.setLineDash(DASH_EMPTY);
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
      } else {
        ctx.lineWidth = cute ? 1.5 : 1;
        ctx.strokeStyle = cute ? "rgba(255, 143, 200, 0.5)" : COLORS.slotEdge;
        ctx.stroke();
      }

      if (isDrop && state.dropKind === "replace") {
        ctx.fillStyle = "rgba(224, 138, 74, 0.22)";
        roundRect(ctx, x, y, w, h, r);
        ctx.fill();
      }
      void unit;

      if (spot >= capacityOf(board, side)) {
        // Locked slot: dim it, hatch diagonally, and stamp a small padlock.
        ctx.save();
        roundRect(ctx, x, y, w, h, r);
        ctx.fillStyle = "rgba(10, 8, 20, 0.55)";
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = "rgba(160, 150, 200, 0.18)";
        ctx.lineWidth = 1;
        const step = Math.max(6, h * 0.16);
        ctx.beginPath();
        for (let d = -h; d < w; d += step) {
          ctx.moveTo(x + d, y + h);
          ctx.lineTo(x + d + h, y);
        }
        ctx.stroke();
        ctx.restore();
        const s = Math.min(w, h) * 0.2;
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.save();
        ctx.strokeStyle = "rgba(190, 180, 230, 0.55)";
        ctx.fillStyle = "rgba(190, 180, 230, 0.55)";
        ctx.lineWidth = Math.max(1.5, s * 0.18);
        ctx.beginPath();
        ctx.arc(cx, cy - s * 0.25, s * 0.38, Math.PI, 0);
        ctx.stroke();
        ctx.fillRect(cx - s * 0.55, cy - s * 0.25, s * 1.1, s * 0.85);
        ctx.restore();
      }
    }
  }

  // Battle focus: the front unit on each side is the only one that fights.
  // Its index is the first living unit in the lane (the queue is contiguous).
  const frontOf = (side: Side, lane: number) =>
    board.slots[side][lane].findIndex((u) => !!u && u.hp > 0);
  if (state.battle) {
    const e = energy;
    const breathe = 0.5 + 0.5 * Math.sin(time / 260);
    // Clash zone: each side's colour glowing toward the centre line.
    const band = l.rowH * (0.9 + 0.3 * e);
    const za = ctx.createLinearGradient(0, midY - band, 0, midY);
    za.addColorStop(0, "rgba(209, 72, 58, 0)");
    za.addColorStop(1, `rgba(209, 72, 58, ${0.16 + 0.22 * e})`);
    ctx.fillStyle = za;
    ctx.fillRect(bx, midY - band, bwid, band);
    const zb = ctx.createLinearGradient(0, midY, 0, midY + band);
    zb.addColorStop(0, `rgba(58, 134, 214, ${0.16 + 0.22 * e})`);
    zb.addColorStop(1, "rgba(58, 134, 214, 0)");
    ctx.fillStyle = zb;
    ctx.fillRect(bx, midY, bwid, band);
    // Halo behind each front unit, in its side's colour.
    for (let lane = 0; lane < board.lanes; lane++) {
      for (const side of ["enemy", "player"] as const) {
        const spot = frontOf(side, lane);
        if (spot < 0) continue;
        const row = sideSpotToRow(board, side, spot);
        const x = l.ox + lane * l.laneW + pad;
        const y = l.oy + row * l.rowH + pad;
        const w = l.laneW - pad * 2;
        const h = l.rowH - pad * 2;
        const col = side === "player" ? "58, 134, 214" : "209, 72, 58";
        ctx.save();
        roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.16);
        ctx.fillStyle = `rgba(${col}, ${0.08 + 0.05 * breathe + 0.08 * e})`;
        ctx.shadowColor = `rgba(${col}, 0.9)`;
        ctx.shadowBlur = 8 + 6 * breathe + 10 * e;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = Math.max(1.5, h * 0.05);
        ctx.strokeStyle = `rgba(${col}, ${0.55 + 0.3 * breathe})`;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Energy line along the centre.
  {
    const e = energy;
    ctx.save();
    ctx.lineCap = "round";
    const energyCol = cute ? "#ff8fc8" : COLORS.energy;
    ctx.strokeStyle = energyCol;
    ctx.globalAlpha = 0.18 + 0.12 * (0.5 + 0.5 * Math.sin(time / 420)) + 0.5 * e;
    ctx.lineWidth = 3 + 5 * e;
    ctx.shadowColor = energyCol;
    ctx.shadowBlur = 8 + 18 * e;
    ctx.beginPath();
    ctx.moveTo(bx, midY);
    ctx.lineTo(bx + bwid, midY);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55 + 0.45 * e;
    ctx.strokeStyle = cute ? (e > 0.2 ? "#ffe0f0" : "#b0609a") : e > 0.2 ? "#d9d2ff" : COLORS.mid;
    ctx.lineWidth = 2;
    ctx.setLineDash(DASH_MID);
    ctx.lineDashOffset = -time * (0.03 + 0.08 * e);
    ctx.beginPath();
    ctx.moveTo(bx, midY);
    ctx.lineTo(bx + bwid, midY);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    if (animated) {
      const px = bx + (((time * (0.0003 + 0.0006 * e)) % 1 + 1) % 1) * bwid;
      ctx.globalAlpha = 0.5 + 0.5 * e;
      ctx.fillStyle = cute ? "#ffd6ec" : "#fff";
      ctx.shadowColor = energyCol;
      ctx.shadowBlur = 12;
      if (cute) heartPath(ctx, px, midY, 3.5 + 2 * e);
      else {
        ctx.beginPath();
        ctx.arc(px, midY, 2 + 2 * e, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // Blood splats on the floor, under the units.
  if (state.fx && animated) state.fx.drawUnder(ctx, time);

  // Units: idle ones first, attackers last so lunges pass over neighbours.
  for (let passIdx = 0; passIdx < 2; passIdx++) {
    for (let lane = 0; lane < board.lanes; lane++) {
      for (const side of ["enemy", "player"] as const) {
        const col = board.slots[side][lane];
        for (let spot = 0; spot < col.length; spot++) {
          const unit = col[spot];
          if (!unit) continue;
          const v = vis.get(unit.id);
          if (!v) continue;
          if ((v.pose === "attack" ? 1 : 0) !== passIdx) continue;
          // In battle the queue waits in the half-light; dying units keep
          // full strength so their fall still reads.
          const waiting = !!state.battle && unit.hp > 0 && spot !== frontOf(side, lane);
          drawUnit(ctx, state, unit, side, lane, v, l, pad, time, animated, reduce, waiting);
        }
      }
    }
  }

  drawDropHints(ctx, state, l, pad, time, animated);

  // Battle effects: brief subtle flash on struck cells.
  for (const hit of state.hits) {
    const row = sideSpotToRow(board, hit.side, hit.spot);
    const x = l.ox + hit.lane * l.laneW + pad;
    const y = l.oy + row * l.rowH + pad;
    const w = l.laneW - pad * 2;
    const h = l.rowH - pad * 2;
    roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.16);
    ctx.fillStyle = hit.dying ? "rgba(12,10,18,0.3)" : "rgba(255,70,45,0.16)";
    ctx.fill();
  }

  if (state.fx && animated) state.fx.draw(ctx, time);
  ctx.restore();
}

/**
 * While a unit is in hand: a small action badge on every valid slot, and on the
 * hovered one a larger outcome label (plus a faint preview of the unit when
 * it would be added). Drawn over the units so it reads even on a full row.
 */
function drawDropHints(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  l: Layout,
  pad: number,
  time: number,
  animated: boolean,
): void {
  const kinds = state.targetKinds;
  if (!kinds || state.validTargets.length === 0) return;
  const { board } = state;
  const drop = state.dropCell && state.dropCell.side === "player" ? state.dropCell : null;

  for (const cell of state.validTargets) {
    const kind = kinds[`${cell.lane},${cell.spot}`];
    if (!kind) continue;
    const row = sideSpotToRow(board, "player", cell.spot);
    const x = l.ox + cell.lane * l.laneW + pad;
    const y = l.oy + row * l.rowH + pad;
    const w = l.laneW - pad * 2;
    const h = l.rowH - pad * 2;
    const style = KIND_STYLE[kind];
    const hovered = !!drop && drop.lane === cell.lane && drop.spot === cell.spot;

    // Faint preview of the incoming unit. The queue stays contiguous, so it
    // lands right behind the last unit whichever empty slot is hovered — draw
    // it there, not under the pointer.
    if (hovered && kind === "place" && state.heldKey) {
      const landSpot = board.slots.player[cell.lane].filter((u) => u).length;
      const landY = l.oy + sideSpotToRow(board, "player", landSpot) * l.rowH + pad;
      ctx.save();
      ctx.globalAlpha = 0.45;
      drawCharacter(ctx, {
        key: state.heldKey,
        side: "player",
        cx: x + h * contentScale(h) * CHAR_X,
        cy: landY + h / 2,
        size: h * contentScale(h) * CHAR_SIZE,
        time,
        pose: "idle",
        t: 0,
        seed: 0,
        merges: 0,
      });
      ctx.restore();
    }

    // Split slot (a twin of the unit in hand): left half merges, right half
    // inserts/moves. Both halves are always tinted and labelled while a unit is
    // in hand, so the choice is legible the first time, not just once learned.
    const split = kind === "merge-or-move" || kind === "merge-or-add";
    if (split) {
      drawSplitSlot(ctx, x, y, w, h, kind, hovered ? (drop!.zone === "right" ? "right" : "left") : null, state.dropLabel ?? null, time, animated);
      continue;
    }
    const hoverStyle =
      split && hovered && drop!.zone === "right"
        ? kind === "merge-or-move"
          ? KIND_STYLE.reorder
          : KIND_STYLE.insert
        : style;
    const text = hovered && state.dropLabel ? state.dropLabel : style.badge;
    // Label size follows the capped unit size (contentScale), not the raw row height.
    const fs = Math.round(Math.max(10, h * contentScale(h) * (hovered ? 0.34 : 0.26)));
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const bh = fs * 1.5;
    const bw = tw + fs * 1.1;
    // Hovered: centred in the slot. Otherwise tucked into the right edge.
    const bx = hovered ? x + (w - bw) / 2 : x + w - bw - pad * 2;
    const by = y + (h - bh) / 2;
    const bob = hovered && animated ? Math.sin(time / 180) * h * 0.03 : 0;

    ctx.save();
    roundRect(ctx, bx, by + bob, bw, bh, bh / 2);
    ctx.globalAlpha = hovered ? 0.96 : 0.82;
    ctx.fillStyle = hoverStyle.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#17131f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + bw / 2, by + bob + bh / 2 + 1);
    ctx.restore();
  }
}

/**
 * One slot split into two labelled halves. `over` is the half under the
 * pointer (null when not hovered): it brightens and shows the full outcome,
 * the other half dims but keeps its label.
 */
function drawSplitSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: "merge-or-move" | "merge-or-add",
  over: "left" | "right" | null,
  outcome: string | null,
  time: number,
  animated: boolean,
): void {
  const half = w / 2;
  const right = kind === "merge-or-add" ? KIND_STYLE.insert : KIND_STYLE.reorder;
  const halves = [
    { side: "left" as const, x0: x, color: COLORS.merge, rgb: "95, 224, 143", label: "⇪ MERGE" },
    {
      side: "right" as const,
      x0: x + half,
      color: right.color,
      rgb: kind === "merge-or-add" ? "240, 180, 41" : "184, 176, 224",
      label: kind === "merge-or-add" ? "INSERT ↧" : "MOVE ↕",
    },
  ];
  const r = Math.min(w, h) * 0.16;
  const pulse = animated ? 0.5 + 0.5 * Math.sin(time / 200) : 1;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  for (const hf of halves) {
    const active = over === hf.side;
    const dim = over !== null && !active;
    ctx.fillStyle = `rgba(${hf.rgb}, ${active ? 0.3 + 0.08 * pulse : dim ? 0.07 : 0.16})`;
    ctx.fillRect(hf.x0, y, half, h);
    if (active) {
      ctx.strokeStyle = hf.color;
      ctx.lineWidth = Math.max(2.5, h * 0.09);
      ctx.strokeRect(hf.x0 + 1.5, y + 1.5, half - 3, h - 3);
    }
  }
  ctx.restore();

  // Divider.
  ctx.save();
  ctx.strokeStyle = "rgba(240, 236, 255, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x + half, y + h * 0.1);
  ctx.lineTo(x + half, y + h * 0.9);
  ctx.stroke();
  ctx.restore();

  // A label pill centred in each half; the active one carries the outcome.
  for (const hf of halves) {
    const active = over === hf.side;
    const dim = over !== null && !active;
    const text = active && outcome ? outcome : hf.label;
    let fs = Math.round(Math.max(10, h * contentScale(h) * (active ? 0.3 : 0.26)));
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    // Shrink the outcome to fit its half rather than spill into the other.
    while (fs > 9 && ctx.measureText(text).width + fs * 1.1 > half - 6) {
      fs -= 1;
      ctx.font = `800 ${fs}px system-ui, sans-serif`;
    }
    const tw = ctx.measureText(text).width;
    const bh = fs * 1.5;
    const bw = tw + fs * 1.1;
    const bx = hf.x0 + (half - bw) / 2;
    const by = y + (h - bh) / 2;
    ctx.save();
    ctx.globalAlpha = dim ? 0.55 : 0.95;
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fillStyle = hf.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#17131f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
    ctx.restore();
  }
}

/**
 * Level badge colours, rarity-style, under the level cap (MAX_LEVEL): the
 * median unit ends a match around level 7 and most rows have one at 10, so
 * gold is the cap itself (shown as "MAX") and red is past it, which only
 * Ascendant allows.
 */
const TIERS_BELOW_CAP: { from: number; fill: string; ink: string; glow?: string }[] = [
  { from: 1, fill: "rgba(255, 255, 255, 0.10)", ink: "rgba(236, 232, 245, 0.55)" },
  { from: 2, fill: "#3fae6a", ink: "#06240f" },
  { from: 5, fill: "#3a86d6", ink: "#04182c" },
  { from: 8, fill: "#9a5cf0", ink: "#fff", glow: "rgba(200, 160, 255, 0.9)" },
];
/** The tiers for a cap: the fixed ones below it, gold at the cap, red past it. */
export const levelTiers = (cap = MAX_LEVEL) => [
  ...TIERS_BELOW_CAP.filter((t) => t.from < cap),
  { from: cap, fill: "#f0b429", ink: "#2a1f05", glow: "rgba(255, 226, 122, 0.95)" },
  { from: cap + 1, fill: "#e5483a", ink: "#fff", glow: "rgba(255, 150, 120, 0.95)" },
];
export const LEVEL_TIERS = levelTiers();
/** A level as its badge reads: "Lv7", "MAX" at the cap, "Lv14" past it. */
export const levelLabel = (level: number, cap = MAX_LEVEL) => (level === cap ? "MAX" : `Lv${level}`);
export const levelTier = (level: number, cap = MAX_LEVEL) => {
  const tiers = levelTiers(cap);
  return [...tiers].reverse().find((t) => level >= t.from) ?? tiers[0];
};

function drawUnit(
  ctx: CanvasRenderingContext2D,
  state: RenderState,
  unit: Board["slots"][Side][number][number] & object,
  side: Side,
  lane: number,
  v: UnitVis,
  l: Layout,
  pad: number,
  time: number,
  animated: boolean,
  reduce: boolean,
  waiting = false,
): void {
  // The slot is `slotW` × `h`; its contents are drawn in a space scaled by
  // `sc` about the slot's left-middle (see UNIT_MAX_H), so they read `w` wide
  // there and fill the real width while capping their height.
  const slotW = l.laneW - pad * 2;
  const h = l.rowH - pad * 2;
  const sc = contentScale(h);
  const w = slotW / sc;
  const x = l.ox + lane * l.laneW + pad;
  const y = l.oy + v.row * l.rowH + pad;
  const toward = side === "player" ? -1 : 1;
  const t = v.t;

  // Whole-slot motion (entrances, deaths) vs. body-only motion (lunge,
  // knockback): moving the name and stats with a lunge would smear them over
  // the opposing front's text at exactly the moment the player is reading it.
  let dx = 0;
  let dy = 0;
  let bdx = 0;
  let bdy = 0;
  let scale = 1;
  let alpha = 1;
  switch (v.pose) {
    case "attack": {
      if (reduce) break;
      let f: number;
      if (t < 0.25) f = -0.1 * easeInOutSine(t / 0.25);
      else if (t < 0.45) f = -0.1 + 0.52 * easeOutCubic((t - 0.25) / 0.2);
      else f = 0.42 * (1 - easeInOutSine((t - 0.45) / 0.55));
      bdy = toward * f * l.rowH;
      break;
    }
    case "dodge": {
      // Evasion: a quick sidestep out of the blow and back.
      if (reduce) break;
      bdx = pulse(t) * h * 0.65;
      break;
    }
    case "hit": {
      if (reduce) break;
      bdy = -toward * 0.12 * l.rowH * pulse(t);
      bdx = Math.sin(t * 38) * (1 - t) * h * 0.05;
      break;
    }
    case "dying": {
      if (!reduce) dy = -toward * 0.25 * l.rowH * easeOutCubic(t);
      alpha = 1 - t * t;
      scale = 1 - 0.15 * t;
      break;
    }
    case "spawn": {
      if (!reduce) dy = -(1 - easeOutCubic(t)) * l.rowH * 0.8;
      alpha = clamp01(t * 3);
      scale = 0.6 + 0.4 * easeOutBack(t);
      break;
    }
    case "merge":
      if (!reduce) scale = 1 + 0.18 * pulse(t);
      break;
  }

  const lifted = state.draggingId === unit.id;
  const ccx = x + slotW / 2;
  const ccy = y + h / 2;
  ctx.save();
  ctx.globalAlpha = alpha * (lifted ? 0.3 : 1) * (waiting ? 0.5 : 1);
  ctx.translate(ccx + dx, ccy + dy);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.translate(-ccx, -ccy);

  // Selection glow.
  if (state.selectedId === unit.id) {
    const p = 0.5 + 0.5 * Math.sin(time / 200);
    roundRect(ctx, x, y, slotW, h, Math.min(slotW, h) * 0.16);
    ctx.lineWidth = Math.max(3, h * 0.08);
    ctx.strokeStyle = COLORS.target;
    ctx.shadowColor = COLORS.target;
    ctx.shadowBlur = 8 + 14 * p;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Everything below is the slot's contents, capped in size on big screens.
  if (sc < 1) {
    ctx.translate(x, ccy);
    ctx.scale(sc, sc);
    ctx.translate(-x, -ccy);
  }

  // Character, sized so body and legs fit inside the row (weapons may still
  // reach past it). See CHAR_SIZE.
  const cx = x + h * CHAR_X;
  const cy = y + h / 2;
  ctx.save();
  ctx.translate(bdx, bdy);
  drawCharacter(ctx, {
    key: unit.key,
    side,
    cx,
    cy,
    size: h * CHAR_SIZE,
    time,
    pose: v.pose,
    t,
    seed: v.seed,
    merges: unit.merges,
    wounds: bloodOn() ? clamp01(1 - v.hp / Math.max(1, unit.maxHp)) : 0,
  });
  ctx.restore();

    // Name, stats.
    const tx = x + h * TEXT_X;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.name;
    ctx.font = `600 ${Math.round(Math.max(11, h * 0.26))}px system-ui, sans-serif`;
    // Class glyph first, so a row's classes (and a synergy in the making) read at a glance.
    const cls = state.classIcon?.(unit);
    const clsW = cls ? ctx.measureText(cls).width + h * 0.08 : 0;
    if (cls) ctx.fillText(cls, tx, y + h * 0.26);
    const nameX = tx + clsW;
    const shownName = state.unitName?.(unit) ?? unit.name;
    ctx.fillText(shownName, nameX, y + h * 0.26);

    const statY = y + h * 0.66;
    ctx.font = `800 ${Math.round(Math.max(15, h * 0.44))}px system-ui, sans-serif`;
    const atkLabel = `⚔${unit.atk}`;
    ctx.fillStyle = COLORS.atkText;
    ctx.fillText(atkLabel, tx, statY);
    ctx.fillStyle = COLORS.hpText;
    const hpX = tx + ctx.measureText(atkLabel).width + h * 0.28;
    const hpLabel = `♥${Math.max(0, unit.hp)}`;
    ctx.fillText(hpLabel, hpX, statY);
    let statsRight = hpX + ctx.measureText(hpLabel).width;
    // Warden's Barrier: what's left of the shield, after the health, in the
    // shield bar's colour (the bar itself sits under the HP bar).
    const shieldMax = unit.traits?.shield ?? 0;
    const shieldNow = Math.max(0, Math.min(shieldMax, unit.shieldLeft ?? shieldMax));
    if (shieldMax > 0) {
      const shieldLabel = `🔰${shieldNow}`;
      ctx.font = `800 ${Math.round(Math.max(11, h * 0.3))}px system-ui, sans-serif`;
      ctx.fillStyle = shieldNow > 0 ? COLORS.shield : COLORS.shieldSpent;
      const sx = statsRight + h * 0.2;
      ctx.fillText(shieldLabel, sx, statY);
      statsRight = sx + ctx.measureText(shieldLabel).width;
    }

    // Squire countdown: merges left until knighthood, right-aligned on the
    // stats line. Shortened, then dropped, when the stats leave no room.
    const promote = state.promoteIn?.(unit) ?? null;
    if (promote !== null && promote > 0) {
      ctx.font = `700 ${Math.round(Math.max(9, h * 0.22))}px system-ui, sans-serif`;
      const full = `⚜ ${promote} more to Knight`;
      const short = `⚜ ${promote}`;
      const room = x + w - pad * 1.5 - statsRight - h * 0.2;
      const label = ctx.measureText(full).width <= room ? full : ctx.measureText(short).width <= room ? short : null;
      if (label) {
        ctx.textAlign = "right";
        ctx.fillStyle = COLORS.target;
        ctx.fillText(label, x + w - pad * 1.5, statY);
        ctx.textAlign = "left";
      }
    }

    // Level badge, coloured by tier (LEVEL_TIERS): every unit starts at a faint Lv1.
    ctx.font = `800 ${Math.round(h * 0.22)}px system-ui, sans-serif`;
    const cap = levelCapOf(state.board);
    const badge = levelLabel(levelOf(unit.merges), cap);
    const mergeW = Math.max(h * 0.4, ctx.measureText(badge).width + h * 0.16);
    const mergeX = x + w - mergeW - pad * 0.5;
    {
      const by = y + h * 0.12;
      roundRect(ctx, mergeX, by, mergeW, h * 0.3, h * 0.1);
      const tier = levelTier(levelOf(unit.merges), cap);
      ctx.fillStyle = tier.fill;
      ctx.fill();
      if (tier.glow) {
        ctx.strokeStyle = tier.glow;
        ctx.lineWidth = Math.max(1, h * 0.04);
        ctx.stroke();
      }
      ctx.fillStyle = tier.ink;
      ctx.textAlign = "center";
      ctx.fillText(badge, mergeX + mergeW / 2, by + h * 0.16);
      ctx.textAlign = "left";
    }

    if (unit.auras.length > 0 && state.auraIcon) {
      const size = h * 0.26;
      const gap = h * 0.08;
      const right = mergeX - pad * 0.8;
      ctx.font = `${Math.round(size)}px system-ui, sans-serif`;
      const nameRight = nameX + ctx.measureText(state.unitName?.(unit) ?? unit.name).width;
      const room = Math.max(0, right - nameRight - gap);
      const fits = Math.floor(room / (size + gap));
      const budget = Math.min(unit.auras.length, MAX_AURA_BADGES, fits);
      const hidden = unit.auras.length - budget;
      const shown = hidden > 0 ? Math.max(0, budget - 1) : budget;
      ctx.textAlign = "center";
      let abx = right - size / 2;
      for (let k = 0; k < shown; k++) {
        ctx.fillText(state.auraIcon(unit.auras[k]), abx, y + h * 0.27);
        abx -= size + gap;
      }
      if (hidden > 0 && budget > 0) {
        ctx.fillStyle = COLORS.name;
        ctx.font = `800 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
        ctx.fillText(`+${unit.auras.length - shown}`, abx, y + h * 0.27);
      }
      ctx.textAlign = "left";
    }

    // HP bar: eased fill, lingering ghost chunk, hit flash, low-HP pulse.
    const barW = w - (tx - x) - pad;
    const barH = Math.max(3, h * 0.08);
    // A shielded unit's HP bar moves up to make room for the shield bar below.
    const barY = y + h * (shieldMax > 0 ? 0.83 : 0.9);
    if (shieldMax > 0) {
      // Shield bar: full width is the whole Barrier, the fill what's left.
      const sh = Math.max(2, h * 0.06);
      const sy = y + h * 0.94;
      ctx.fillStyle = COLORS.hpTrack;
      roundRect(ctx, tx, sy, barW, sh, sh / 2);
      ctx.fill();
      if (shieldNow > 0) {
        ctx.fillStyle = COLORS.shield;
        roundRect(ctx, tx, sy, Math.max(sh, (barW * shieldNow) / shieldMax), sh, sh / 2);
        ctx.fill();
      }
    }
    const r = barH / 2;
    const max = unit.maxHp || 1;
    const frac = clamp01(v.hp / max);
    const gfrac = clamp01(v.ghost / max);
    ctx.fillStyle = COLORS.hpTrack;
    roundRect(ctx, tx, barY, barW, barH, r);
    ctx.fill();
    if (gfrac > frac + 0.002) {
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      roundRect(ctx, tx, barY, barW * gfrac, barH, r);
      ctx.fill();
    }
    if (frac > 0) {
      ctx.fillStyle = COLORS.hpFill;
      roundRect(ctx, tx, barY, Math.max(barH, barW * frac), barH, r);
      ctx.fill();
      if (frac < 0.3 && animated) {
        ctx.globalAlpha *= 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time / 130));
        ctx.fillStyle = "#ff4a3a";
        roundRect(ctx, tx, barY, Math.max(barH, barW * frac), barH, r);
        ctx.fill();
        ctx.globalAlpha = alpha * (lifted ? 0.3 : 1) * (waiting ? 0.5 : 1);
      }
      if (v.flash > 0.01) {
        ctx.globalAlpha *= v.flash;
        ctx.fillStyle = "#fff";
        roundRect(ctx, tx, barY, Math.max(barH, barW * frac), barH, r);
        ctx.fill();
      }
    }
  ctx.restore();
}
