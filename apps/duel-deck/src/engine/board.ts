import { KNIGHTING_BONUS, KNIGHT_AT, MAX_MERGES, SQUIRE_STEP, UNITS, canAbsorb } from "./units";
import type { Board, Side, Unit } from "./types";

// Board construction and slot access. Generic over `lanes` and `depth`.

export const SIDES: Side[] = ["player", "enemy"];

let unitCounter = 0;

/**
 * Move the id counter past every unit on a board restored from a save. The
 * counter restarts at 0 on each page load, and ids key drags, playback and
 * augment grants — a fresh unit reusing a restored unit's id would alias it.
 */
export function reserveUnitIds(board: Board): void {
  for (const u of [...sideUnits(board, "player"), ...sideUnits(board, "enemy")]) {
    const n = Number(u.id.slice(1));
    if (Number.isInteger(n) && n >= unitCounter) unitCounter = n + 1;
  }
}

export function makeUnit(key: string, side: Side): Unit {
  const stats = UNITS[key];
  if (!stats) throw new Error(`makeUnit: unknown unit "${key}"`);
  return {
    id: `u${unitCounter++}`,
    side,
    key,
    name: stats.name,
    shape: stats.shape,
    classes: [...stats.classes],
    baseAtk: stats.atk,
    baseMaxHp: stats.maxHp,
    merges: 0,
    atk: stats.atk,
    maxHp: stats.maxHp,
    hp: stats.maxHp,
    auras: [],
  };
}

/** Most merges a unit on side may hold: MAX_MERGES, unless Ascendant lifts it. */
export function mergeCapFor(board: Board, side: Side): number {
  return board.mods?.[side]?.uncapped ? Infinity : MAX_MERGES;
}

/**
 * Whether an offered unit may merge into the unit at this slot. Like merges
 * with like (a Guard only folds into a Guard), plus Squires into Knights, and
 * never past the level cap.
 */
export function canMerge(
  board: Board,
  side: Side,
  lane: number,
  spot: number,
  key: string,
): boolean {
  if (lane < 0 || lane >= board.lanes || spot < 0 || spot >= board.depth) return false;
  const unit = board.slots[side][lane][spot];
  return !!unit && !!UNITS[key] && canAbsorb(unit.key, unit.merges, key, 1, mergeCapFor(board, side));
}

/**
 * A merged unit contributes 50% of its stats to the target (halves round up),
 * e.g. a Bulwark (2/14) grants +1 ATK / +7 HP. Merging therefore trades raw
 * total stats for concentration: fewer, tougher units on the front instead of
 * more bodies behind.
 */
export const MERGE_RATIO = 0.5;

/**
 * What the n-th through (n+count-1)-th merges into a Squire line grant:
 * merge k adds k × SQUIRE_STEP, so each one is bigger than the last — up to
 * knighthood. After that every merge is worth the POST_KNIGHT_STEP-th step: an
 * uncapped escalation let a long match's Knight reach 30+ attack, and with the
 * level cap at 12 the full KNIGHT_AT-th step lifted Knight rows to 66%
 * (step 4: 59%, as at cap 10; step 3: 49%).
 */
export const POST_KNIGHT_STEP = 4;
function squireGain(targetMerges: number, count = 1): { atk: number; hp: number } {
  let atk = 0;
  let hp = 0;
  for (let i = 1; i <= count; i++) {
    const n = targetMerges + i;
    const k = n <= KNIGHT_AT ? n : POST_KNIGHT_STEP;
    atk += Math.round(k * SQUIRE_STEP.atk);
    hp += Math.round(k * SQUIRE_STEP.hp);
  }
  return { atk, hp };
}

/**
 * What merging an offered unit of this type would grant the target. Squires
 * follow their own escalating rule (and ignore `ratio`), so they need to know
 * how many merges the target already has.
 */
export function mergeGain(
  key: string,
  ratio = MERGE_RATIO,
  targetMerges = 0,
): { atk: number; hp: number } {
  const stats = UNITS[key];
  if (!stats) return { atk: 0, hp: 0 };
  if (key === "squire") return squireGain(targetMerges);
  return {
    atk: Math.round(stats.atk * ratio),
    hp: Math.round(stats.maxHp * ratio),
  };
}

/**
 * Merge an offered unit into a matching one already on the board: half its
 * stats are added to the target's *base* stats, so the upgrade survives both
 * respawn and augment recomputation. Rejects mismatched types.
 */
export function upgradeUnit(
  board: Board,
  side: Side,
  lane: number,
  spot: number,
  key: string,
  ratio = MERGE_RATIO,
): boolean {
  if (!canMerge(board, side, lane, spot, key)) return false;
  const unit = board.slots[side][lane][spot]!;
  const gain = mergeGain(key, ratio, unit.merges);
  unit.baseAtk += gain.atk;
  unit.baseMaxHp += gain.hp;
  unit.merges += 1;
  return true;
}

/**
 * What folding a unit already on the board into another would grant. Half its
 * *current* base stats, so a unit that has itself absorbed merges carries that
 * accumulated value across rather than reverting to its printed stats.
 */
export function unitMergeGain(
  unit: Unit,
  ratio = MERGE_RATIO,
  targetMerges = 0,
): { atk: number; hp: number } {
  // A Squire line counts bodies, not stats: absorbing a Squire that already
  // holds m merges is m + 1 more escalating steps.
  if (unit.key === "squire" || unit.key === "knight") {
    return squireGain(targetMerges, unit.merges + 1);
  }
  return {
    atk: Math.round(unit.baseAtk * ratio),
    hp: Math.round(unit.baseMaxHp * ratio),
  };
}

/**
 * Merge one placed unit into another of the same type in the same lane. The
 * source leaves the board and the queue closes up behind it. Same 50% rule as
 * merging from the offer, and the badge counts every body absorbed, including
 * any the source had already taken in.
 */
export function mergePlaced(
  board: Board,
  side: Side,
  lane: number,
  from: number,
  to: number,
  ratio = MERGE_RATIO,
): boolean {
  if (lane < 0 || lane >= board.lanes || from === to) return false;
  const list = occupants(board, side, lane);
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return false;
  const source = list[from];
  const target = list[to];
  // Squire into Knight, never the reverse: a Knight folded into a Squire would
  // throw away its knighthood.
  // Levels add, so two level-6 units can't fold into a level 12.
  if (!canAbsorb(target.key, target.merges, source.key, source.merges + 1, mergeCapFor(board, side))) return false;
  const gain = unitMergeGain(source, ratio, target.merges);
  target.baseAtk += gain.atk;
  target.baseMaxHp += gain.hp;
  target.merges += source.merges + 1;
  list.splice(from, 1);
  writeLane(board, side, lane, list);
  return true;
}

/**
 * Knight a Squire in place: it keeps its id, merges and grown stats, takes the
 * Knight's type and look, and gains the one-off KNIGHTING_BONUS.
 */
export function promoteToKnight(unit: Unit): void {
  const knight = UNITS.knight;
  unit.key = "knight";
  unit.name = knight.name;
  unit.shape = knight.shape;
  unit.classes = [...knight.classes];
  unit.baseAtk += KNIGHTING_BONUS.atk;
  unit.baseMaxHp += KNIGHTING_BONUS.hp;
}

/** Queue slots a side may use: its `capacity` mod, else the board depth. */
export function capacityOf(board: Board, side: Side): number {
  return Math.min(board.depth, board.mods?.[side]?.capacity ?? board.depth);
}

/** Grow every lane to at least `depth` slots (Reinforcements). Never shrinks. */
export function ensureDepth(board: Board, depth: number): void {
  if (depth <= board.depth) return;
  for (const side of SIDES) {
    for (const lane of board.slots[side]) {
      while (lane.length < depth) lane.push(null);
    }
  }
  board.depth = depth;
}

export function createBoard(lanes: number, depth: number, startHp: number): Board {
  const emptySide = () =>
    Array.from({ length: lanes }, () =>
      Array.from({ length: depth }, () => null as Unit | null),
    );
  return {
    lanes,
    depth,
    slots: { player: emptySide(), enemy: emptySide() },
    hp: { player: startHp, enemy: startHp },
    startHp,
  };
}

export function cloneBoard(board: Board): Board {
  const cloneSide = (grid: (Unit | null)[][]) =>
    grid.map((lane) =>
      lane.map((u) =>
        u ? { ...u, classes: [...u.classes], auras: [...u.auras] } : null,
      ),
    );
  return {
    lanes: board.lanes,
    depth: board.depth,
    slots: {
      player: cloneSide(board.slots.player),
      enemy: cloneSide(board.slots.enemy),
    },
    hp: { ...board.hp },
    ...(board.startHp !== undefined ? { startHp: board.startHp } : {}),
    ...(board.rules ? { rules: { ...board.rules } } : {}),
    ...(board.mods
      ? { mods: { player: { ...board.mods.player }, enemy: { ...board.mods.enemy } } }
      : {}),
  };
}

/** Units in a lane for a side, front-to-back, skipping empty spots. */
export function occupants(board: Board, side: Side, lane: number): Unit[] {
  return board.slots[side][lane].filter((u): u is Unit => u !== null);
}

/** The frontmost unit of a side in a lane — the only one that fights. */
export function front(board: Board, side: Side, lane: number): Unit | null {
  return occupants(board, side, lane)[0] ?? null;
}

export function laneCount(board: Board, side: Side, lane: number): number {
  return occupants(board, side, lane).length;
}

/** Every live unit for a side, across all lanes, front-first. */
export function sideUnits(board: Board, side: Side): Unit[] {
  const out: Unit[] = [];
  for (let lane = 0; lane < board.lanes; lane++) out.push(...occupants(board, side, lane));
  return out;
}

export function allUnits(board: Board): Unit[] {
  return [...sideUnits(board, "player"), ...sideUnits(board, "enemy")];
}

export function findUnitCell(
  board: Board,
  id: string,
): { side: Side; lane: number; spot: number } | null {
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      const laneArr = board.slots[side][lane];
      for (let spot = 0; spot < laneArr.length; spot++) {
        if (laneArr[spot]?.id === id) return { side, lane, spot };
      }
    }
  }
  return null;
}

export function isValidPlacement(
  board: Board,
  side: Side,
  lane: number,
  spot: number,
): boolean {
  if (lane < 0 || lane >= board.lanes) return false;
  if (spot < 0 || spot >= capacityOf(board, side)) return false;
  return board.slots[side][lane][spot] === null;
}

export function place(
  board: Board,
  side: Side,
  lane: number,
  spot: number,
  unit: Unit,
): void {
  board.slots[side][lane][spot] = unit;
}

/** First empty spot for a side, scanning lanes then front-to-back. */
export function firstEmptySpot(
  board: Board,
  side: Side,
): { lane: number; spot: number } | null {
  for (let lane = 0; lane < board.lanes; lane++) {
    for (let spot = 0; spot < capacityOf(board, side); spot++) {
      if (!board.slots[side][lane][spot]) return { lane, spot };
    }
  }
  return null;
}

export function emptySpotCount(board: Board, side: Side): number {
  let n = 0;
  for (let lane = 0; lane < board.lanes; lane++) {
    for (let spot = 0; spot < capacityOf(board, side); spot++) {
      if (!board.slots[side][lane][spot]) n++;
    }
  }
  return n;
}

/** Slide a lane's survivors forward so they're contiguous from spot 0. */
export function compactLane(board: Board, side: Side, lane: number): void {
  writeLane(board, side, lane, occupants(board, side, lane));
}

/** Overwrite a lane with an ordered queue, padding the rest with empties. */
export function writeLane(board: Board, side: Side, lane: number, units: Unit[]): void {
  const laneArr = board.slots[side][lane];
  for (let spot = 0; spot < board.depth; spot++) {
    laneArr[spot] = spot < units.length ? units[spot] : null;
  }
}

/**
 * Insert a unit into a lane's queue at `index`, pushing anything at or behind
 * it further back. The queue always stays contiguous, so dropping onto an
 * occupied slot means "cut in ahead of this unit". Returns false if full.
 */
export function insertUnit(
  board: Board,
  side: Side,
  lane: number,
  index: number,
  unit: Unit,
): boolean {
  const list = occupants(board, side, lane);
  if (list.length >= capacityOf(board, side)) return false;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, unit);
  writeLane(board, side, lane, list);
  return true;
}

/**
 * Swap the unit at a slot for a fresh one of `key`, discarding the old unit
 * (and any merges baked into it). The escape hatch for a full row when nothing
 * on offer matches a type you own.
 */
export function replaceUnit(
  board: Board,
  side: Side,
  lane: number,
  spot: number,
  key: string,
): boolean {
  if (lane < 0 || lane >= board.lanes || spot < 0 || spot >= board.depth) return false;
  if (!board.slots[side][lane][spot] || !UNITS[key]) return false;
  board.slots[side][lane][spot] = makeUnit(key, side);
  return true;
}

/** Reorder within a lane's queue: pull the unit out and re-insert at `to`. */
export function moveUnit(
  board: Board,
  side: Side,
  lane: number,
  from: number,
  to: number,
): void {
  const list = occupants(board, side, lane);
  if (from < 0 || from >= list.length) return;
  const [unit] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, unit);
  writeLane(board, side, lane, list);
}
