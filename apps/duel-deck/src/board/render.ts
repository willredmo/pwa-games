import type { Board, Shape, Side } from "../engine/types";

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
  hpFill: "#4ad07a",
  target: "#f0b429",
  merge: "#5fe08f",
  replace: "#e08a4a",
  invalid: "#e0574a",
  mid: "#4a4368",
} as const;

/** Cap on lane width so a one-lane row doesn't stretch into full-width bars. */
const MAX_LANE_ASPECT = 3.4;

export interface Cell {
  side: Side;
  lane: number;
  spot: number;
}

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
  const laneW = Math.min(cw / board.lanes, rowH * MAX_LANE_ASPECT);
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
  return { side, lane, spot };
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

export function draw(canvas: HTMLCanvasElement, state: RenderState): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { board } = state;
  const l = layout(canvas, board);
  if (!l) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const targetSet = new Set(state.validTargets.map((c) => `${c.lane},${c.spot}`));
  const pad = Math.min(l.laneW, l.rowH) * 0.08;

  // Arena panel, sized to the lane block rather than the whole canvas.
  const pp = pad * 1.5;
  roundRect(ctx, l.ox - pp, l.oy - pp, l.laneW * board.lanes + pp * 2, l.rowH * l.rows + pp * 2, 10);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();

  for (let lane = 0; lane < board.lanes; lane++) {
    for (let row = 0; row < l.rows; row++) {
      const { side, spot } = rowToSideSpot(board, row);
      const x = l.ox + lane * l.laneW + pad;
      const y = l.oy + row * l.rowH + pad;
      const w = l.laneW - pad * 2;
      const h = l.rowH - pad * 2;
      const unit = board.slots[side][lane][spot];
      const isTarget = side === "player" && targetSet.has(`${lane},${spot}`);
      const isSelected = !!unit && !!state.selectedId && unit.id === state.selectedId;
      const isDrop =
        !!state.dropCell &&
        state.dropCell.side === side &&
        state.dropCell.lane === lane &&
        state.dropCell.spot === spot;

      // Colour the hovered slot by outcome: gold place, green merge, orange
      // replace (destructive), red invalid.
      const dropColor = isDrop
        ? state.dropKind === "merge"
          ? COLORS.merge
          : state.dropKind === "replace"
            ? COLORS.replace
            : state.dropKind === "invalid"
              ? COLORS.invalid
              : COLORS.target
        : COLORS.target;

      roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.16);
      ctx.fillStyle = COLORS.slot;
      ctx.fill();
      // The picked-up unit gets the same weight as a drop target but a solid
      // line, so "this is in hand" reads differently from "you may drop here".
      ctx.lineWidth =
        isDrop || isSelected ? Math.max(3, h * 0.1) : isTarget ? Math.max(2, h * 0.05) : 1;
      ctx.strokeStyle =
        isDrop || isTarget ? dropColor : isSelected ? COLORS.target : COLORS.slotEdge;
      if (isTarget && !isDrop) ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // A replace discards the unit standing there, so mark it plainly.
      if (isDrop && state.dropKind === "replace") {
        ctx.fillStyle = "rgba(224, 138, 74, 0.22)";
        roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.16);
        ctx.fill();
      }

      if (!unit) continue;

      // The dragged unit is drawn faded — it's lifted off the board.
      const lifted = state.draggingId === unit.id;
      ctx.save();
      if (lifted) ctx.globalAlpha = 0.3;

      // Shape encodes type, colour encodes ownership.
      const cx = x + h * 0.55;
      const cy = y + h / 2;
      const r = h * 0.34;
      traceShape(ctx, unit.shape, cx, cy, r);
      ctx.fillStyle = side === "player" ? COLORS.player : COLORS.enemy;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, h * 0.05);
      ctx.strokeStyle = side === "player" ? COLORS.playerEdge : COLORS.enemyEdge;
      ctx.stroke();

      // Name above, then the two numbers large and colour-coded so ATK vs HP
      // is readable at a glance without parsing the icons.
      const tx = x + h * 1.0;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = COLORS.name;
      ctx.font = `600 ${Math.round(h * 0.24)}px system-ui, sans-serif`;
      ctx.fillText(unit.name, tx, y + h * 0.26);

      const statY = y + h * 0.66;
      ctx.font = `800 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
      const atkLabel = `⚔${unit.atk}`;
      ctx.fillStyle = COLORS.atkText;
      ctx.fillText(atkLabel, tx, statY);
      ctx.fillStyle = COLORS.hpText;
      ctx.fillText(`♥${unit.hp}`, tx + ctx.measureText(atkLabel).width + h * 0.28, statY);

      // Merge badge: how many offered units have been folded into this one.
      const mergeW = h * 0.4;
      const mergeX = x + w - mergeW - pad * 0.5;
      if (unit.merges > 0) {
        const by = y + h * 0.12;
        roundRect(ctx, mergeX, by, mergeW, h * 0.3, h * 0.1);
        ctx.fillStyle = COLORS.target;
        ctx.fill();
        ctx.fillStyle = "#2a1f05";
        ctx.textAlign = "center";
        ctx.font = `800 ${Math.round(h * 0.22)}px system-ui, sans-serif`;
        ctx.fillText(`+${unit.merges}`, mergeX + mergeW / 2, by + h * 0.16);
        ctx.textAlign = "left";
      }

      // Augment badges: one glyph per upgrade currently changing this unit's
      // numbers. Laid out right-to-left from just inside the merge badge, and
      // only as many as genuinely fit beside the name — an overflowing row of
      // icons would obscure exactly the stats it's meant to explain.
      if (unit.auras.length > 0 && state.auraIcon) {
        const size = h * 0.26;
        const gap = h * 0.08;
        const right = (unit.merges > 0 ? mergeX : x + w) - pad * 0.8;
        ctx.font = `${Math.round(size)}px system-ui, sans-serif`;
        const nameRight = tx + ctx.measureText(unit.name).width;
        const room = Math.max(0, right - nameRight - gap);
        const fits = Math.floor(room / (size + gap));
        const budget = Math.min(unit.auras.length, MAX_AURA_BADGES, fits);
        // If some are hidden, the leftmost slot becomes a "+N" count instead.
        const hidden = unit.auras.length - budget;
        const shown = hidden > 0 ? Math.max(0, budget - 1) : budget;

        ctx.textAlign = "center";
        let bx = right - size / 2;
        for (let k = 0; k < shown; k++) {
          ctx.fillText(state.auraIcon(unit.auras[k]), bx, y + h * 0.27);
          bx -= size + gap;
        }
        if (hidden > 0 && budget > 0) {
          ctx.fillStyle = COLORS.name;
          ctx.font = `800 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
          ctx.fillText(`+${unit.auras.length - shown}`, bx, y + h * 0.27);
        }
        ctx.textAlign = "left";
      }

      // HP bar along the bottom of the text area.
      const barW = w - (tx - x) - pad;
      const barH = Math.max(3, h * 0.08);
      const barY = y + h * 0.9;
      ctx.fillStyle = COLORS.hpTrack;
      roundRect(ctx, tx, barY, barW, barH, barH / 2);
      ctx.fill();
      ctx.fillStyle = COLORS.hpFill;
      const frac = Math.max(0, Math.min(1, unit.hp / unit.maxHp));
      roundRect(ctx, tx, barY, barW * frac, barH, barH / 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Battle effects: flash the struck cell, float a damage number.
  for (const hit of state.hits) {
    const row = sideSpotToRow(board, hit.side, hit.spot);
    const x = l.ox + hit.lane * l.laneW + pad;
    const y = l.oy + row * l.rowH + pad;
    const w = l.laneW - pad * 2;
    const h = l.rowH - pad * 2;
    roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.16);
    ctx.fillStyle = hit.dying ? "rgba(12,10,18,0.55)" : "rgba(255,70,45,0.34)";
    ctx.fill();

    ctx.fillStyle = "#ffe27a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
    ctx.lineWidth = Math.max(2, h * 0.06);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    const label = hit.dying ? `✕ -${hit.amount}` : `-${hit.amount}`;
    ctx.strokeText(label, x + w / 2, y + h / 2);
    ctx.fillText(label, x + w / 2, y + h / 2);
  }

  // Centre line where the two front-most units meet.
  const midY = l.oy + board.depth * l.rowH;
  ctx.strokeStyle = COLORS.mid;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(l.ox, midY);
  ctx.lineTo(l.ox + l.laneW * board.lanes, midY);
  ctx.stroke();
  ctx.setLineDash([]);
}
