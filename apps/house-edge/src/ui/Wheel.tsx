import { useEffect, useRef } from "react";
import { drawWheel, fitCanvas, type BallView } from "../board/render";
import {
  angleOfPocket,
  coupleBalls,
  planSpin,
  ROTOR_SPEED,
  type SpinPlan,
} from "../board/physics";

/** Below this there is no time for physics to read — the ball just appears. */
const SNAP_MS = 260;
/**
 * Sub-frame ball samples drawn behind the ball each frame. At 60fps a ball on
 * the track covers about 19 degrees between frames, so it strobes — it reads as
 * a stutter, or a wagon-wheel reversal, even though no frames are being
 * dropped. Raising the frame rate cannot fix that; sampling the same flight
 * more finely within the frame can.
 */
const TRAIL = 6;
/** Below this much travel in a frame the ghosts just pile onto the ball. */
const TRAIL_MIN_SWEEP = 0.07;

type Ghost = { rel: number; radius: number; height: number; alpha: number };

/** One ball's flight. Several share a spin, and a rotor. */
type Flight = {
  pocket: number;
  plan: SpinPlan | null;
  rel: number;
  radius: number;
  height: number;
  lastElapsed: number;
  trail: Ghost[];
};

interface Props {
  /**
   * Pockets to land on, one per ball — `result.balls` from the engine. A
   * change of `spinKey` launches a new throw.
   */
  pockets: readonly number[] | null;
  /** Index into `pockets` of the ball that was paid, marked once they land. */
  winner?: number;
  spinKey: number;
  durationMs: number;
  /** Playback rate. 1 is normal; below 1 slows the whole wheel down. */
  speed?: number;
  onSettled: () => void;
}

export function Wheel({ pockets, winner = 0, spinKey, durationMs, speed = 1, onSettled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  // Held in refs so the rAF loop never restarts mid-flight.
  const pocketsRef = useRef(pockets);
  pocketsRef.current = pockets;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const winnerRef = useRef(winner);
  winnerRef.current = winner;

  const anim = useRef({
    wheelAngle: 0,
    flights: [] as Flight[],
    startedAt: 0,
    /** Pockets to ring, once every ball is down. */
    landed: [] as number[],
  });

  // Launch. `planSpin` solves the launch speed backwards from the pocket, so
  // each ball decelerates naturally into its result rather than being snapped.
  useEffect(() => {
    if (!pockets || pockets.length === 0) return;
    const a = anim.current;
    // Balls carry on from wherever the last spin left them; a new ball beyond
    // that count starts from the first ball's resting place.
    const restingRel = (i: number) => a.flights[i]?.rel ?? a.flights[0]?.rel ?? 0;

    if (durationMs <= SNAP_MS) {
      a.flights = pockets.map((pocket) => ({
        pocket,
        plan: null,
        rel: angleOfPocket(pocket),
        radius: 0,
        height: 0,
        lastElapsed: 0,
        trail: [],
      }));
      a.landed = [...pockets];
      settledRef.current();
      return;
    }

    // The first ball's throw sets the rotor and the flight time; the rest are
    // locked to it so they share a wheel and land together. Everything else
    // about each throw is drawn independently, so they take visibly different
    // routes to the same moment.
    let lock: { rotor: number; durationMs: number } | undefined;
    const plans = pockets.map((pocket, i) => {
      const plan = planSpin({
        pocket,
        fromRel: restingRel(i),
        fromWheel: a.wheelAngle,
        durationMs,
        lockTo: lock,
      });
      lock ??= { rotor: plan.rotor, durationMs: plan.durationMs };
      return plan;
    });
    // Only once every flight exists can they be made aware of each other.
    a.flights = coupleBalls(plans).map((plan, i) => ({
      pocket: pockets[i],
      plan,
      rel: restingRel(i),
      radius: 0,
      height: 0,
      lastElapsed: 0,
      trail: [],
    }));
    a.startedAt = performance.now();
    a.landed = [];
  }, [spinKey, pockets, durationMs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const a = anim.current;
      const flying = a.flights.some((f) => f.plan);

      if (flying) {
        const elapsed = now - a.startedAt;
        let anyLeft = false;

        for (const f of a.flights) {
          if (!f.plan) continue;
          const s = f.plan.sample(elapsed);
          f.rel = s.rel;
          f.radius = s.radius;
          f.height = s.height;
          // Every ball shares a rotor, so any of them may drive it.
          a.wheelAngle = s.wheelAngle;

          // Walk back over the frame just drawn and keep the intermediate
          // positions, rebased into this frame's rotor angle so the renderer
          // can place them without knowing anything about time.
          const prev = f.plan.sample(Math.max(0, f.lastElapsed));
          const sweep = Math.abs(
            s.wheelAngle + s.rel - (prev.wheelAngle + prev.rel),
          );
          f.trail.length = 0;
          if (sweep > TRAIL_MIN_SWEEP) {
            for (let i = TRAIL; i >= 1; i--) {
              const t = elapsed + ((f.lastElapsed - elapsed) * i) / (TRAIL + 1);
              const g = f.plan.sample(Math.max(0, t));
              f.trail.push({
                rel: g.wheelAngle + g.rel - s.wheelAngle,
                radius: g.radius,
                height: g.height,
                alpha: 0.07 + 0.26 * (1 - i / (TRAIL + 1)),
              });
            }
          }
          f.lastElapsed = elapsed;

          if (elapsed >= f.plan.durationMs) {
            f.plan = null;
            // The solve already ends here; assign it exactly so a dropped
            // frame can never leave the ball a hair off its pocket.
            f.rel = angleOfPocket(f.pocket);
            f.radius = 0;
            f.height = 0;
            f.trail.length = 0;
          } else {
            anyLeft = true;
          }
        }

        if (!anyLeft) {
          a.landed = a.flights.map((f) => f.pocket);
          settledRef.current();
        }
      } else {
        // At rest the balls sit in their pockets and ride the rotor round.
        a.wheelAngle += ROTOR_SPEED * speedRef.current * dt;
      }

      const ctx = canvas.getContext("2d");
      const visible = canvas.offsetParent !== null;
      if (ctx && visible) {
        const { w, h } = fitCanvas(canvas);
        const balls: BallView[] = a.flights.map((f, i) => ({
          rel: f.rel,
          radius: f.radius,
          height: f.height,
          trail: f.trail,
          // Nothing has won until every ball is down.
          picked: !flying && a.flights.length > 1 && i === winnerRef.current,
        }));
        drawWheel(ctx, w, h, {
          wheelAngle: a.wheelAngle,
          balls,
          // Ring only the pocket that was paid, not all of them.
          highlights: flying ? [] : a.landed.slice(winnerRef.current, winnerRef.current + 1),
        });
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className="wheel" />;
}
