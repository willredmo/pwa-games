// Shared animation vocabulary for the board: poses, their timing, and easings.
//
// App owns *when* a pose starts (it knows about picks and battle ticks); the
// renderer and characters only read a pose plus its 0..1 progress. Keeping the
// clock here means every layer agrees on what "halfway through an attack" is.

/**
 * What a unit is doing right now. `idle` is the resting loop; every other pose
 * is a one-shot that runs for its duration and then falls back to idle.
 */
export type Pose = "idle" | "spawn" | "attack" | "hit" | "dying" | "merge" | "selected" | "dodge";

/** A pose as App records it: started at `start` (ms, performance.now clock). */
export interface PoseState {
  pose: Pose;
  start: number;
  duration: number;
}

/** Default one-shot lengths (ms) at normal speed; App divides by fast-mode factor. */
export const POSE_MS: Record<Exclude<Pose, "idle" | "selected">, number> = {
  spawn: 420,
  attack: 480,
  hit: 400,
  dying: 680,
  merge: 600,
  dodge: 300,
};

/** 0..1 progress through a pose; 1 once it has finished. */
export function poseProgress(p: PoseState, now: number): number {
  if (p.duration <= 0) return 1;
  return Math.max(0, Math.min(1, (now - p.start) / p.duration));
}

/**
 * Resolve the pose to draw. A finished one-shot reads as idle — except dying,
 * which holds its last frame so a dead unit doesn't pop back up before the
 * board snapshot removes it.
 */
export function activePose(p: PoseState | undefined, now: number): { pose: Pose; t: number } {
  if (!p) return { pose: "idle", t: 0 };
  const t = poseProgress(p, now);
  if (t >= 1 && p.pose !== "dying" && p.pose !== "selected") return { pose: "idle", t: 0 };
  return { pose: p.pose, t };
}

/** True when the OS asks for less motion — every layer should honour it. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number) => t ** 3;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
export const easeOutElastic = (t: number) => {
  if (t === 0 || t === 1) return t;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};
/** 0 → 1 → 0 over the pose: for punches that return to rest. */
export const pulse = (t: number) => Math.sin(Math.PI * clamp01(t));
