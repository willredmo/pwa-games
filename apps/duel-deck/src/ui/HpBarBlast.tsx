import { useEffect, useRef } from "react";
import { FxLayer } from "../board/fx";
import { sfx } from "../game/sound";

// The enemy's HP bar blowing up in slow motion when you win the match: a big
// blast at the bar's middle and smaller ones along it, the bar itself gone in
// the flash. It plays once, at the very end, so it ignores the battle speed
// setting. Drawn on its own full-screen canvas because the bar sits outside the
// board's canvas; the effects are the board's own (FxLayer "explosion"), run on
// a clock slowed to SLOW of real time. The bar hides itself (HpBar `blown`).

/** Playback rate of the effect clock: 0.4 = two and a half times slower. */
const SLOW = 0.4;
/** Effect-clock length of the blast (ms); it lasts BLAST_MS / SLOW in real time. */
const BLAST_MS = 1800;
/** How long the whole thing takes in real time, for whoever waits on it. */
export const HP_BAR_BLAST_MS = Math.round(BLAST_MS / SLOW);

export function HpBarBlast({ selector, side, onDone }: { selector: string; side: "player" | "enemy"; onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const bar = document.querySelector<HTMLElement>(selector);
    if (!canvas || !ctx || !bar) {
      done.current?.();
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const fit = () => {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    };
    fit();
    const box = bar.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const size = Math.max(30, Math.min(48, box.width / 7));
    const fx = new FxLayer();
    const realStart = performance.now();
    const t0 = 1000;
    const clock = (now: number) => t0 + (now - realStart) * SLOW;

    // The big one in the middle, then smaller bursts walking out to both ends.
    fx.add({ kind: "explosion", x: cx, y: cy, size, side }, t0);
    const spots = [-0.36, 0.36, -0.18, 0.18];
    spots.forEach((f, i) => {
      fx.add({ kind: "death", x: cx + f * box.width, y: cy, size: size * 0.7, side }, t0 + 90 + i * 70);
    });
    sfx("explode", 0.6, 0.6);

    let raf = 0;
    const loop = (now: number) => {
      const t = clock(now);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const o = fx.shakeOffset(t);
      ctx.translate(o.x, o.y);
      fx.draw(ctx, t);
      if (t - t0 < BLAST_MS) raf = requestAnimationFrame(loop);
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        done.current?.();
      }
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [selector, side]);

  return <canvas ref={ref} className="hpbar-blast" aria-hidden="true" />;
}
