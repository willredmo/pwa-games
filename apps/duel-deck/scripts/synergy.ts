// Head-to-head value of each full-row synergy: the same one-class row, synergy
// on vs off, one round against random rows at the same level. Prints the round
// win rate both ways and the difference (what the synergy is worth).
// Usage: pnpm synergy [trials=4000] [--level=4]
import { createBoard, makeUnit, mergeGain, writeLane } from "../src/engine/board";
import { resolveRound } from "../src/engine/combat";
import type { Archetype, Unit } from "../src/engine/types";
import { OFFER_KEYS, UNITS, synergyOf } from "../src/engine/units";
import { applyAugments, createAugmentState } from "../src/game/augments";

const args = process.argv.slice(2);
const trials = Number(args.find((a) => /^\d+$/.test(a)) ?? 4000);
const levelArg = args.find((a) => a.startsWith("--level="));
const levels = levelArg ? [Number(levelArg.split("=")[1])] : [2, 5, 8];

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

function grown(key: string, side: "player" | "enemy", level: number): Unit {
  const u = makeUnit(key, side);
  for (let m = 0; m < level - 1; m++) {
    const g = mergeGain(key, 0.5, u.merges);
    u.baseAtk += g.atk;
    u.baseMaxHp += g.hp;
    u.merges += 1;
  }
  return u;
}

function roundWon(rowKeys: string[], level: number, withSynergy: boolean): boolean {
  const board = createBoard(1, 5, 200);
  const mine = rowKeys.map((k) => grown(k, "player", level));
  const theirs = Array.from({ length: 5 }, () => grown(pick(OFFER_KEYS), "enemy", level));
  writeLane(board, "player", 0, mine);
  writeLane(board, "enemy", 0, theirs);
  board.mods = { player: { capacity: 5 }, enemy: { capacity: 5 } };
  const syn = withSynergy ? synergyOf(mine, 5) : null;
  applyAugments(mine, createAugmentState(), 200, 5, 5, syn);
  applyAugments(theirs, createAugmentState(), 200, 5, 5, synergyOf(theirs, 5));
  return resolveRound(board).roundWinner === "player";
}

for (const cls of ["attack", "defense", "support"] as Archetype[]) {
  const keys = OFFER_KEYS.filter((k) => UNITS[k].archetype === cls);
  for (const level of levels) {
    let on = 0;
    let off = 0;
    for (let i = 0; i < trials; i++) {
      const row = Array.from({ length: 5 }, () => pick(keys));
      // Same row both ways; separate random opponents, averaged over many trials.
      if (roundWon(row, level, true)) on++;
      if (roundWon(row, level, false)) off++;
    }
    const pct = (n: number) => ((100 * n) / trials).toFixed(1);
    console.log(`${cls.padEnd(8)} L${level}: off ${pct(off)}%  on ${pct(on)}%  (+${(((on - off) * 100) / trials).toFixed(1)})`);
  }
}
