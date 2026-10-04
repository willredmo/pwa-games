import { useEffect, useRef } from "react";
import type { Side } from "../engine/types";
import { drawCharacter } from "../board/characters";
import { prefersReducedMotion } from "../board/anim";

// Small idle-animated character, for offer cards and the drag ghost.
export interface UnitPortraitProps {
  unitKey: string;
  side: Side;
  /** Square size in CSS px. */
  size: number;
}

export function UnitPortrait({ unitKey, side, size }: UnitPortraitProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const seed = Math.random() * 1000;
    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawCharacter(ctx, {
        key: unitKey,
        side,
        cx: size / 2,
        cy: size / 2,
        // Weapons reach ~1.1x the box past the body; keep them inside the canvas.
        size: size * 0.43,
        time,
        pose: "idle",
        t: 0,
        seed,
        merges: 0,
      });
    };
    if (prefersReducedMotion()) {
      draw(0);
      return;
    }
    let raf = 0;
    const loop = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [unitKey, side, size]);

  return <canvas ref={ref} style={{ width: size, height: size, display: "block" }} aria-hidden="true" />;
}
