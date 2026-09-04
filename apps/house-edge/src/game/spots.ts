import { POCKET_COUNT } from "../engine";

/**
 * Upgrades bought once and then *placed* on a particular number.
 *
 * Everything else in the shop applies to the whole table. These do not: you buy
 * the right to mark a pocket, then choose which one, and the choice is the
 * interesting part. That makes them the only upgrades whose value depends on a
 * decision rather than on a level.
 *
 * The shop entry's **level is the allowance** — how many pockets you may mark —
 * so the existing cost curves and level caps carry these without any new
 * purchasing machinery. Placement lives here in state, separately from the
 * level, because the two change at different times: buying raises the
 * allowance, tapping a number spends it.
 */
export interface SpotMods {
  /** Pockets that pay double when they land. */
  double: number[];
  /** Pockets that hand the stake back when they land. */
  free: number[];
  /** Pairs of pockets: a straight on one also pays a share on the other. */
  links: [number, number][];
}

/** What a linked pocket pays, as a share of the straight's own payout. */
export const LINK_SHARE = 0.35;

export type SpotKind = "double" | "free" | "link";

/** Shop ids, in the same order a player meets them. */
export const SPOT_UPGRADES: Record<SpotKind, string> = {
  double: "spotDouble",
  free: "spotFree",
  link: "spotLink",
};

/** Reverse of SPOT_UPGRADES: which mark a shop id grants, if any. */
export const SPOT_KIND_BY_UPGRADE: Record<string, SpotKind> = Object.fromEntries(
  Object.entries(SPOT_UPGRADES).map(([kind, id]) => [id, kind as SpotKind]),
);

export function emptySpots(): SpotMods {
  return { double: [], free: [], links: [] };
}

/** Placements already spent, per kind. */
export function placedCount(spots: SpotMods, kind: SpotKind): number {
  if (kind === "link") return spots.links.length;
  return spots[kind].length;
}

function valid(pocket: number): boolean {
  return Number.isInteger(pocket) && pocket >= 0 && pocket < POCKET_COUNT;
}

/**
 * A pocket carries at most one mark. Stacking a double onto a free-spin pocket
 * would be two different answers to "what happens when this lands", and the one
 * that fired would depend on the order the settlement happened to check them.
 */
export function markOf(spots: SpotMods, pocket: number): SpotKind | null {
  if (spots.double.includes(pocket)) return "double";
  if (spots.free.includes(pocket)) return "free";
  if (spots.links.some(([a, b]) => a === pocket || b === pocket)) return "link";
  return null;
}

/** The other end of a link, or null. */
export function linkedTo(spots: SpotMods, pocket: number): number | null {
  for (const [a, b] of spots.links) {
    if (a === pocket) return b;
    if (b === pocket) return a;
  }
  return null;
}

/**
 * A pocket is available only if it is bare. Placements are **permanent** for
 * the cycle — there is no lifting one back off — so this is the only gate, and
 * it has to be checked in the UI as well as here: a tap the model silently
 * refuses is indistinguishable from a broken button.
 */
export function canPlace(spots: SpotMods, pocket: number): boolean {
  return valid(pocket) && markOf(spots, pocket) === null;
}

export function place(spots: SpotMods, kind: "double" | "free", pocket: number): SpotMods {
  if (!canPlace(spots, pocket)) return spots;
  return { ...spots, [kind]: [...spots[kind], pocket] };
}

export function link(spots: SpotMods, a: number, b: number): SpotMods {
  if (a === b || !canPlace(spots, a) || !canPlace(spots, b)) return spots;
  return { ...spots, links: [...spots.links, [a, b] as [number, number]] };
}

/** Saves written before this feature, or hand-edited ones. */
export function normaliseSpots(raw: unknown): SpotMods {
  const s = raw as Partial<SpotMods> | undefined;
  if (!s) return emptySpots();
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter(valid) : []);
  return {
    double: nums(s.double),
    free: nums(s.free),
    links: Array.isArray(s.links)
      ? s.links
          .filter(
            (pair): pair is [number, number] =>
              Array.isArray(pair) && pair.length === 2 && pair.every(valid) && pair[0] !== pair[1],
          )
          .map(([a, b]) => [a, b] as [number, number])
      : [],
  };
}
