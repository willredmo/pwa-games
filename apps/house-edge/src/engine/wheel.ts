import type { PocketColor } from "./types";

/** Pocket order around a European single-zero wheel, clockwise from 0. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const POCKET_COUNT = WHEEL_ORDER.length; // 37

const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function colorOf(pocket: number): PocketColor {
  if (pocket === 0) return "green";
  return RED.has(pocket) ? "red" : "black";
}

/** Index of a pocket in the physical wheel order (not its face value). */
export function wheelIndex(pocket: number): number {
  return WHEEL_ORDER.indexOf(pocket as (typeof WHEEL_ORDER)[number]);
}

/** The two pockets physically either side of `pocket` on the wheel. */
export function neighbours(pocket: number): [number, number] {
  const i = wheelIndex(pocket);
  return [
    WHEEL_ORDER[(i - 1 + POCKET_COUNT) % POCKET_COUNT],
    WHEEL_ORDER[(i + 1) % POCKET_COUNT],
  ];
}

export function spinWheel(rng: () => number): number {
  return WHEEL_ORDER[Math.floor(rng() * POCKET_COUNT)];
}
