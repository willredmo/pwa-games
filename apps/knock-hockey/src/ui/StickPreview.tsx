import { useEffect, useRef } from "react";
import type { StickLook } from "../game/stick";
import { drawPuck } from "../render/board";
import { drawStick, stickSegments, type StickPose } from "../render/stick";
import { PUCK_R } from "../physics/table";

// A stick drawn big, lying almost flat with its blade on a puck. Uses the same
// drawing code as the game, so what you build in the Locker is what you play.

const POSE: StickPose = { x: 0, y: 0, angle: (30 * Math.PI) / 180, back: 1 };

export function StickPreview({ look, className }: { look: StickLook; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      // Fit the stick and puck with some padding.
      const pts = stickSegments(POSE).flatMap((s) => [
        { x: s.ax, y: s.ay },
        { x: s.bx, y: s.by },
      ]);
      pts.push({ x: -PUCK_R, y: -PUCK_R }, { x: PUCK_R, y: PUCK_R });
      const pad = 10;
      const minX = Math.min(...pts.map((p) => p.x)) - pad;
      const maxX = Math.max(...pts.map((p) => p.x)) + pad;
      const minY = Math.min(...pts.map((p) => p.y)) - pad;
      const maxY = Math.max(...pts.map((p) => p.y)) + pad;
      const s = Math.min(cw / (maxX - minX), ch / (maxY - minY));
      const ox = (cw - (maxX - minX) * s) / 2 - minX * s;
      const oy = (ch - (maxY - minY) * s) / 2 - minY * s;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      drawPuck(ctx, { x: 0, y: 0 });
      drawStick(ctx, look, POSE);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [look]);

  return <canvas ref={ref} className={className ?? "stick-preview"} aria-hidden />;
}
