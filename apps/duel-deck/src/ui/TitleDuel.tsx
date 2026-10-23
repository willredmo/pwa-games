import { useEffect, useRef } from "react";
import { drawCharacter } from "../board/characters";
import { POSE_MS, prefersReducedMotion, type Pose } from "../board/anim";
import { FxLayer } from "../board/fx";
import type { Side } from "../engine/types";

// The title screen's hero: a small looping duel in the game's own art. Three
// of yours face three of theirs across the middle; the fronts lunge and trade
// blows (both strike at once, as in the game), and every few exchanges one
// falls, its row steps up and it comes back at the back. Alternates who falls,
// so neither side "wins" the menu. Purely decorative: no game state, no input.
// Reduced motion draws the lineup once, still.

/** One unit box (CSS px): the old lineup's 40px portraits. */
const BOX = 40;
/** Between neighbours in a row, and from the middle to each front. */
const STEP = 38;
const MIDDLE_GAP = 26;
/** Canvas height: the units sit low, leaving headroom for damage numbers. */
const HEIGHT = 84;
const UNIT_Y = 56;
/** One exchange, and how many exchanges between falls. */
const BEAT_MS = 1500;
const FALL_EVERY = 3;
/** The attack pose's share at which the blow lands (matches Game's CLASH_AT). */
const CLASH_AT = 0.55;
const SLIDE_MS = 380;

const ROWS: Record<Side, string[]> = {
  player: ["guard", "striker", "herald"],
  enemy: ["berserker", "bulwark", "lancer"],
};

interface Actor {
  key: string;
  side: Side;
  seed: number;
  /** Queue position, 0 = front; `from` is where a slide started. */
  slot: number;
  from: number;
  slideAt: number;
  pose: Pose;
  poseAt: number;
  poseMs: number;
}

const slotX = (side: Side, slot: number, cx: number) =>
  side === "player" ? cx - MIDDLE_GAP - slot * STEP : cx + MIDDLE_GAP + slot * STEP;

export function TitleDuel() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const actors: Actor[] = (["player", "enemy"] as Side[]).flatMap((side) =>
      ROWS[side].map((key, slot) => ({
        key, side, seed: Math.random() * 1000, slot, from: slot, slideAt: -1e9, pose: "idle" as Pose, poseAt: 0, poseMs: 0,
      })),
    );
    const fx = new FxLayer();
    const still = prefersReducedMotion();

    // A tiny scheduler on the frame clock, so nothing runs while the tab is hidden.
    const queue: { at: number; fn: (now: number) => void }[] = [];
    const later = (at: number, fn: (now: number) => void) => queue.push({ at, fn });
    const setPose = (a: Actor, pose: Pose, now: number) => {
      a.pose = pose;
      a.poseAt = now;
      a.poseMs = pose === "idle" ? 0 : POSE_MS[pose as keyof typeof POSE_MS];
    };
    const frontOf = (side: Side) => actors.find((a) => a.side === side && a.slot === 0)!;

    let width = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let beat = 0;
    const exchange = (start: number) => {
      const p = frontOf("player");
      const e = frontOf("enemy");
      setPose(p, "attack", start);
      setPose(e, "attack", start);
      const hit = start + POSE_MS.attack * CLASH_AT;
      // Alternate the loser: every FALL_EVERY-th beat, one front falls.
      const falls = (beat + 1) % FALL_EVERY === 0 ? (Math.floor(beat / FALL_EVERY) % 2 === 0 ? e : p) : null;
      later(hit, (now) => {
        const cx = width / 2;
        fx.add({ kind: "impact", x: cx, y: UNIT_Y - 4, size: BOX, side: "player" }, now);
        for (const [a, b] of [[p, e], [e, p]] as const) {
          const x = slotX(b.side, 0, cx);
          const lethal = b === falls;
          fx.add({ kind: "slash", x, y: UNIT_Y, size: BOX, side: a.side }, now);
          fx.add({ kind: "damage", x, y: UNIT_Y - BOX * 0.3, size: BOX * 0.5, amount: lethal ? 9 : 3 + Math.floor(Math.random() * 5), lethal }, now);
          setPose(b, lethal ? "dying" : "hit", now);
        }
      });
      if (falls) {
        const gone = hit + POSE_MS.dying;
        later(gone, (now) => {
          fx.add({ kind: "death", x: slotX(falls.side, 0, width / 2), y: UNIT_Y, size: BOX, side: falls.side }, now);
          // The row steps up; the fallen one comes back at the back.
          const row = actors.filter((a) => a.side === falls.side);
          for (const a of row) {
            a.from = a.slot;
            a.slideAt = now;
            a.slot = a === falls ? row.length - 1 : a.slot - 1;
          }
          falls.from = falls.slot;
          setPose(falls, "spawn", now);
          fx.add({ kind: "spawn", x: slotX(falls.side, falls.slot, width / 2), y: UNIT_Y, size: BOX, side: falls.side }, now);
        });
      }
      beat++;
      // A fall takes longer to play out, so the next exchange waits for it.
      later(start + (falls ? BEAT_MS + POSE_MS.dying : BEAT_MS), exchange);
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, HEIGHT);
      const cx = width / 2;
      // Back to front, so the fronts (and their lunges) draw over their rows.
      const order = [...actors].sort((a, b) => b.slot - a.slot);
      for (const a of order) {
        const poseT = a.poseMs ? Math.min(1, (now - a.poseAt) / a.poseMs) : 0;
        // A fallen unit stays down (its respawn, scheduled, resets it).
        if (a.poseMs && poseT >= 1 && a.pose !== "dying") setPose(a, "idle", now);
        const slide = Math.min(1, (now - a.slideAt) / SLIDE_MS);
        const ease = 1 - (1 - slide) ** 3;
        let x = slotX(a.side, a.from, cx) + (slotX(a.side, a.slot, cx) - slotX(a.side, a.from, cx)) * ease;
        // drawCharacter's lunge is vertical (the board's rows face up and
        // down); here they face each other, so add a sideways one.
        if (a.pose === "attack") {
          const reach = poseT < CLASH_AT ? Math.sin((poseT / CLASH_AT) * (Math.PI / 2)) : 1 - (poseT - CLASH_AT) / (1 - CLASH_AT);
          x += (a.side === "player" ? 1 : -1) * BOX * 0.32 * reach;
        }
        drawCharacter(ctx, {
          key: a.key,
          side: a.side,
          cx: x,
          cy: UNIT_Y,
          size: BOX * 0.43,
          time: still ? 0 : now,
          pose: a.pose,
          t: poseT,
          seed: a.seed,
          merges: 0,
        });
      }
      fx.draw(ctx, now);
    };

    if (still) {
      draw(0);
      return () => window.removeEventListener("resize", resize);
    }
    let raf = 0;
    const loop = (now: number) => {
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= now) queue.shift()!.fn(now);
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame((now) => {
      later(now + 600, exchange);
      loop(now);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="title__duel" aria-hidden="true" />;
}
