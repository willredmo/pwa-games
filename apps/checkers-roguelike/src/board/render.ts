import { isDarkSquare } from "../engine/board";
import type { Board, Coord } from "../engine/types";
import { coordsEqual } from "../engine/types";

// Imperative Canvas 2D board renderer, driven from a game-state object.
// Generic over board dimensions.
//
// The canvas's *display* size is owned by CSS. This module never writes
// canvas.style.width/height (doing so creates a feedback loop with clientWidth).
// It only sizes the backing store for the device pixel ratio and draws the
// board centered within whatever CSS box it's given.

const COLORS = {
  light: "#e9e2cf",
  dark: "#4a4a63",
  redPiece: "#c0392b",
  redPieceEdge: "#7d2018",
  blackPiece: "#2c2c3a",
  blackPieceEdge: "#0f0f16",
  crown: "#f1c40f",
  label: "#f4f4f8",
  select: "rgba(46, 204, 113, 0.55)",
  target: "rgba(46, 204, 113, 0.35)",
  targetRing: "#2ecc71",
} as const;

export interface RenderState {
  board: Board;
  selected: Coord | null;
  /** Destination squares the selected piece can legally move to. */
  targets: Coord[];
}

interface Layout {
  size: number; // cell size in CSS px
  ox: number; // x offset of board within the canvas box
  oy: number; // y offset of board within the canvas box
}

/** Board layout within the canvas's CSS box, or null if not laid out yet. */
function layout(canvas: HTMLCanvasElement, board: Board): Layout | null {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (cw <= 0 || ch <= 0) return null;
  const size = Math.floor(Math.min(cw / board.cols, ch / board.rows));
  if (size <= 0) return null;
  return {
    size,
    ox: Math.floor((cw - size * board.cols) / 2),
    oy: Math.floor((ch - size * board.rows) / 2),
  };
}

export function pixelToCoord(
  canvas: HTMLCanvasElement,
  board: Board,
  x: number,
  y: number,
): Coord | null {
  const l = layout(canvas, board);
  if (!l) return null;
  const col = Math.floor((x - l.ox) / l.size);
  const row = Math.floor((y - l.oy) / l.size);
  if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) return null;
  return { row, col };
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

  // Size the backing store to the CSS box for crisp HiDPI rendering.
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const { size, ox, oy } = l;

  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      ctx.fillStyle = isDarkSquare(row, col) ? COLORS.dark : COLORS.light;
      ctx.fillRect(ox + col * size, oy + row * size, size, size);
    }
  }

  if (state.selected) {
    const { row, col } = state.selected;
    ctx.fillStyle = COLORS.select;
    ctx.fillRect(ox + col * size, oy + row * size, size, size);
  }

  for (const t of state.targets) {
    const cx = ox + t.col * size + size / 2;
    const cy = oy + t.row * size + size / 2;
    ctx.fillStyle = COLORS.target;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.targetRing;
    ctx.lineWidth = Math.max(2, size * 0.03);
    ctx.stroke();
  }

  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      const piece = board.squares[row][col];
      if (!piece) continue;
      const cx = ox + col * size + size / 2;
      const cy = oy + row * size + size / 2;
      const r = size * 0.38;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = piece.owner === "red" ? COLORS.redPiece : COLORS.blackPiece;
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.04);
      ctx.strokeStyle =
        piece.owner === "red" ? COLORS.redPieceEdge : COLORS.blackPieceEdge;
      ctx.stroke();

      if (piece.king) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.crown;
        ctx.lineWidth = Math.max(2, size * 0.05);
        ctx.stroke();
      }

      // Roster number, so board pieces line up with the "Piece N" upgrade panel.
      if (piece.label !== undefined) {
        ctx.fillStyle = COLORS.label;
        ctx.font = `700 ${Math.round(size * 0.3)}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(piece.label), cx, cy + size * 0.02);
      }
    }
  }
}

export function isTarget(targets: Coord[], c: Coord): boolean {
  return targets.some((t) => coordsEqual(t, c));
}
