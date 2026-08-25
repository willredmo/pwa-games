import type { BetSpot, Layout } from "./types";
import { colorOf } from "./wheel";

/** Straight-up payout; every other v1 bet is derived from the even-money set. */
export const STRAIGHT_PAYOUT = 35;

function straight(n: number): BetSpot {
  return {
    id: `straight:${n}`,
    kind: "straight",
    value: n,
    label: String(n),
    payout: STRAIGHT_PAYOUT,
  };
}

export const STRAIGHT_SPOTS: BetSpot[] = Array.from({ length: 37 }, (_, n) =>
  straight(n),
);

export const OUTSIDE_SPOTS: BetSpot[] = [
  { id: "dozen:1", kind: "dozen", value: 1, label: "1st 12", payout: 2 },
  { id: "dozen:2", kind: "dozen", value: 2, label: "2nd 12", payout: 2 },
  { id: "dozen:3", kind: "dozen", value: 3, label: "3rd 12", payout: 2 },
  { id: "column:1", kind: "column", value: 1, label: "Col 1", payout: 2 },
  { id: "column:2", kind: "column", value: 2, label: "Col 2", payout: 2 },
  { id: "column:3", kind: "column", value: 3, label: "Col 3", payout: 2 },
  { id: "low", kind: "low", label: "1-18", payout: 1 },
  { id: "high", kind: "high", label: "19-36", payout: 1 },
  { id: "even", kind: "even", label: "Even", payout: 1 },
  { id: "odd", kind: "odd", label: "Odd", payout: 1 },
  { id: "red", kind: "red", label: "Red", payout: 1 },
  { id: "black", kind: "black", label: "Black", payout: 1 },
];

export const ALL_SPOTS: BetSpot[] = [...STRAIGHT_SPOTS, ...OUTSIDE_SPOTS];

const SPOT_BY_ID = new Map(ALL_SPOTS.map((s) => [s.id, s]));

export function spotById(id: string): BetSpot | undefined {
  return SPOT_BY_ID.get(id);
}

export function covers(spot: BetSpot, pocket: number): boolean {
  // The zero loses every outside bet — that is the house edge this whole game
  // is about buying back.
  if (pocket === 0) return spot.kind === "straight" && spot.value === 0;
  switch (spot.kind) {
    case "straight":
      return spot.value === pocket;
    case "red":
      return colorOf(pocket) === "red";
    case "black":
      return colorOf(pocket) === "black";
    case "odd":
      return pocket % 2 === 1;
    case "even":
      return pocket % 2 === 0;
    case "low":
      return pocket <= 18;
    case "high":
      return pocket >= 19;
    case "dozen":
      return Math.ceil(pocket / 12) === spot.value;
    case "column":
      return (pocket % 3 === 0 ? 3 : pocket % 3) === spot.value;
  }
}

/** Every pocket the layout would win on — the pool magnetism nudges towards. */
export function coveredPockets(layout: Layout): number[] {
  const staked = Object.entries(layout).filter(([, amt]) => amt > 0);
  if (staked.length === 0) return [];
  const spots = staked
    .map(([id]) => spotById(id))
    .filter((s): s is BetSpot => s !== undefined);
  const out: number[] = [];
  for (let p = 0; p <= 36; p++) {
    if (spots.some((s) => covers(s, p))) out.push(p);
  }
  return out;
}

export function totalStake(layout: Layout): number {
  let sum = 0;
  for (const amt of Object.values(layout)) sum += amt;
  return sum;
}
