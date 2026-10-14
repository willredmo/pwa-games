import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "../board/anim";

// The result screen's continuous backdrop: a slowly turning sunburst, a
// breathing glow and confetti rain for a win; a red glow and rising embers for
// a loss. Drawn on a canvas, not in CSS: iOS Safari dropped the CSS version
// (a 160vmax masked conic-gradient layer, and keyframes reading per-piece
// custom properties), while the canvas explosions already ran everywhere.
// Particles move by frame time, so 120 Hz screens don't run it fast. Reduced
// motion keeps it, slower and sparser, with the rays still.

const CONFETTI_COLORS = ["#f0b429", "#ff6b6b", "#4cc9f0", "#7bd88f", "#b26eff", "#fff6c8"];
const EMBER_COLORS = ["#ff7a45", "#ff7a45", "#ffcf6b"];
const RAYS = 20;

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  size: number;
  color: string;
  /** Sideways wobble phase, so pieces flutter rather than fall straight. */
  phase: number;
}

export function ResultBackdrop({ won }: { won: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const calm = prefersReducedMotion();
    const pace = calm ? 0.45 : 1;
    let w = 0;
    let h = 0;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();

    const spawn = (anywhere: boolean): Bit => {
      const size = 0.6 + Math.random() * 0.8;
      return won
        ? {
            x: Math.random() * w,
            y: anywhere ? Math.random() * h : -20,
            vx: (Math.random() - 0.5) * 40,
            vy: (h / (3.2 + Math.random() * 3)) * pace,
            spin: (Math.random() - 0.5) * 8 * pace,
            angle: Math.random() * Math.PI * 2,
            size,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            phase: Math.random() * Math.PI * 2,
          }
        : {
            x: Math.random() * w,
            y: anywhere ? Math.random() * h : h + 12,
            vx: (Math.random() - 0.5) * 30,
            vy: -(h / (6 + Math.random() * 3)) * pace,
            spin: 0,
            angle: 0,
            size,
            color: EMBER_COLORS[Math.floor(Math.random() * EMBER_COLORS.length)],
            phase: Math.random() * Math.PI * 2,
          };
    };
    const count = Math.round((won ? 46 : 34) * (calm ? 0.5 : 1));
    const bits = Array.from({ length: count }, () => spawn(true));

    let raf = 0;
    let last = performance.now();
    const start = last;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.22;

      // Sunburst: alternating wedges fading out from the centre, one turn per 40 s.
      if (won) {
        const r = Math.hypot(w, h);
        const turn = calm ? 0 : (t / 40) * Math.PI * 2;
        const fade = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.55);
        fade.addColorStop(0, "rgba(240, 180, 41, 0.14)");
        fade.addColorStop(1, "rgba(240, 180, 41, 0)");
        ctx.fillStyle = fade;
        const wedge = ((Math.PI * 2) / RAYS) * 0.4;
        for (let i = 0; i < RAYS; i++) {
          const a = turn + (i / RAYS) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, a, a + wedge);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Glow, breathing every 3.2 s.
      const breathe = calm ? 1 : 0.85 + 0.27 * (0.5 - 0.5 * Math.cos((t / 3.2) * Math.PI * 2));
      const gr = Math.min(w, h) * 0.3 * breathe;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr);
      glow.addColorStop(0, won ? "rgba(255, 214, 102, 0.35)" : "rgba(200, 40, 40, 0.28)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - gr, cy - gr, gr * 2, gr * 2);

      for (let i = 0; i < bits.length; i++) {
        const b = bits[i];
        b.x += (b.vx + Math.sin(t * 2 + b.phase) * 25) * dt;
        b.y += b.vy * dt;
        b.angle += b.spin * dt;
        if (won ? b.y > h + 20 : b.y < -20) {
          bits[i] = spawn(false);
          continue;
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        if (won) {
          ctx.rotate(b.angle);
          // Tumbling: the piece narrows as it turns edge-on.
          ctx.scale(b.size * Math.cos(t * 3 + b.phase), b.size);
          ctx.fillStyle = b.color;
          ctx.fillRect(-4, -6.5, 8, 13);
        } else {
          // Embers shrink as they rise.
          const life = Math.max(0.3, b.y / h);
          ctx.globalAlpha = Math.min(0.9, life);
          ctx.fillStyle = b.color;
          ctx.shadowColor = b.color;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(0, 0, 3 * b.size * life, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
    };
  }, [won]);

  return <canvas ref={ref} className="result-fx" aria-hidden="true" />;
}
