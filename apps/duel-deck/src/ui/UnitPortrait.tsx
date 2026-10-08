import { useEffect, useRef } from "react";
import type { Side } from "../engine/types";
import { drawCharacter } from "../board/characters";
import { prefersReducedMotion, type Pose } from "../board/anim";

// Small idle-animated character, for offer cards and the drag ghost.
export interface UnitPortraitProps {
  unitKey: string;
  side: Side;
  /** Square size in CSS px. */
  size: number;
  /** Merges, for the character's tier trim (crown, pips). Defaults to none. */
  merges?: number;
  /** A looping pose: idle by default, `dance` for the result screen's MVP. */
  pose?: Extract<Pose, "idle" | "dance">;
  /**
   * Extra canvas (px) on every side beyond the layout box, so a big pose (the
   * MVP's dance: hops, leans, a waved weapon) isn't cut off at the box's edge.
   * Pulled back with negative margins, so the layout size stays `size`.
   */
  bleed?: number;
}

export function UnitPortrait({ unitKey, side, size, merges = 0, pose = "idle", bleed = 0 }: UnitPortraitProps) {
  const full = size + bleed * 2;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(full * dpr);
    canvas.height = Math.round(full * dpr);
    const seed = Math.random() * 1000;
    const draw = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, full, full);
      drawCharacter(ctx, {
        key: unitKey,
        side,
        cx: full / 2,
        cy: full / 2,
        // Weapons reach ~1.1x the box past the body; keep them inside the canvas.
        size: size * 0.43,
        time,
        pose,
        t: 0,
        seed,
        merges,
      });
    };
    // Reduced motion stills idle portraits. The MVP's dance still plays (the
    // result screen's one celebration, and it's asked for), at half strength:
    // drawCharacter tones the dance down under the same setting.
    if (prefersReducedMotion() && pose !== "dance") {
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
  }, [unitKey, side, size, merges, pose, full]);

  return (
    <canvas
      ref={ref}
      style={{
        width: full,
        height: full,
        display: "block",
        // Bleed spills over the neighbours without moving them, and never
        // steals their clicks.
        margin: bleed ? -bleed : undefined,
        position: bleed ? "relative" : undefined,
        zIndex: bleed ? 1 : undefined,
        pointerEvents: bleed ? "none" : undefined,
      }}
      aria-hidden="true"
    />
  );
}
