// Desync check for online play. Usage: pnpm netcheck [matches=200]
//
// Online, neither device is authoritative: each assembles the round from its
// own row plus the opponent's committed one and runs `resolveRound` itself,
// trusting that both arrive at the same answer. Two things have to hold for
// that, and neither is obvious:
//
//   1. The engine is side-symmetric. Each device is "player" on its own
//      screen, so the two boards are mirror images of each other.
//   2. A commit survives the round trip. The database drops empty arrays,
//      absent keys and undefined, and unit ids are re-minted on arrival
//      (both devices number from zero, so the opponent's would collide), so
//      augment grants have to travel on the units that carry them.
//
// This plays whole matches with two simulated devices exchanging commits
// through a JSON round-trip that strips empty values the way the database
// does, and fails if the two ever disagree about a round.

import { insertUnit, makeUnit, occupants, writeLane } from "../src/engine/board";
import { MAX_MERGES } from "../src/engine/units";
import { resolveRound } from "../src/engine/combat";
import type { Side, Unit } from "../src/engine/types";
import { ENEMY, PLAYER, newBoard, refreshForRound } from "../src/game/match";
import { OFFERED_AUGMENTS as AUGMENTS, createAugmentState, takeAugment, type AugmentState } from "../src/game/augments";
import { settleRound } from "../src/game/roundEnd";
import { packCommit, unpackCommit, type Commit } from "../src/online/room";

const MATCHES = Number(process.argv[2]) || 200;
const ROUND_CAP = 14;
const KEYS = ["guard", "striker", "skirmisher", "bulwark", "berserker", "squire", "herald", "lancer", "medic", "warden", "acolyte"];
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const flip = (s: Side | null) => (s === "player" ? "enemy" : s === "enemy" ? "player" : null);

/** What the database does to a value on the way through: empties disappear. */
const wire = <T,>(v: T): T =>
  JSON.parse(JSON.stringify(v, (_k, x) => (Array.isArray(x) && x.length === 0 ? undefined : x))) as T;

/** One device's view of the round: its own row as `player`, theirs as `enemy`. */
function assemble(mine: Unit[], myAug: AugmentState, theirs: Commit, myHp: number, theirHp: number) {
  const board = newBoard();
  board.hp = { player: myHp, enemy: theirHp };
  mine.forEach((u, i) => insertUnit(board, PLAYER, 0, i, u));
  const { lanes, aug } = unpackCommit(theirs, ENEMY, board.lanes);
  for (let lane = 0; lane < board.lanes; lane++) writeLane(board, ENEMY, lane, lanes[lane]);
  refreshForRound(board, myAug, aug);
  return board;
}

/**
 * A unit with a random level up to the cap, so Mastery abilities (which only
 * switch on at MAX_LEVEL) are exercised as well as the plain ones.
 */
function grown(key: string): Unit {
  const u = makeUnit(key, PLAYER);
  u.merges = Math.random() < 0.3 ? MAX_MERGES : Math.floor(Math.random() * MAX_MERGES);
  u.baseAtk += Math.round(u.merges * u.baseAtk * 0.5);
  u.baseMaxHp += Math.round(u.merges * u.baseMaxHp * 0.5);
  return u;
}

let desyncs = 0;
let rounds = 0;

for (let m = 0; m < MATCHES; m++) {
  const aAug = createAugmentState();
  const bAug = createAugmentState();
  let aRow: Unit[] = [];
  let bRow: Unit[] = [];
  let hp = { a: 200, b: 200 };

  for (let round = 1; round <= ROUND_CAP; round++) {
    // Each side builds its row privately, as a player would.
    for (let i = 0; i < 2; i++) {
      if (aRow.length < 5) aRow.push(grown(pick(KEYS)));
      if (bRow.length < 5) bRow.push(grown(pick(KEYS)));
    }
    // Drill now and then, so it's covered by the round trip too.
    aAug.drill = Math.random() < 0.2 ? 1 + Math.floor(Math.random() * 2) : 0;
    bAug.drill = Math.random() < 0.2 ? 1 + Math.floor(Math.random() * 2) : 0;
    if (round % 3 === 0) {
      takeAugment(aAug, pick(AUGMENTS).id, aRow);
      takeAugment(bAug, pick(AUGMENTS).id, bRow);
    }

    const aCommit = wire(packCommit(round, [aRow.map((u) => ({ ...u }))], aAug));
    const bCommit = wire(packCommit(round, [bRow.map((u) => ({ ...u }))], bAug));
    const aBoard = assemble(aRow.map((u) => ({ ...u })), aAug, bCommit, hp.a, hp.b);
    const bBoard = assemble(bRow.map((u) => ({ ...u })), bAug, aCommit, hp.b, hp.a);

    const ra = resolveRound(aBoard);
    const rb = resolveRound(bBoard);
    rounds++;

    const agree =
      ra.hpLoss === rb.hpLoss &&
      ra.roundWinner === flip(rb.roundWinner) &&
      ra.matchWinner === flip(rb.matchWinner) &&
      ra.board.hp.player === rb.board.hp.enemy &&
      ra.board.hp.enemy === rb.board.hp.player &&
      ra.ticks.length === rb.ticks.length;
    if (!agree) {
      desyncs++;
      if (desyncs <= 5) {
        console.log(
          `match ${m} round ${round} DESYNC\n` +
            `  A: winner=${ra.roundWinner} loss=${ra.hpLoss} hp=${JSON.stringify(ra.board.hp)} ticks=${ra.ticks.length}\n` +
            `  B: winner=${rb.roundWinner} loss=${rb.hpLoss} hp=${JSON.stringify(rb.board.hp)} ticks=${rb.ticks.length}`,
        );
      }
      break;
    }

    hp = { a: ra.board.hp.player, b: ra.board.hp.enemy };
    settleRound(ra, PLAYER, aAug, aBoard);
    settleRound(rb, PLAYER, bAug, bBoard);
    // Fallen units respawn, carrying any Fortify growth, as in the app.
    aRow = occupants(aBoard, PLAYER, 0).map((u) => ({ ...u }));
    bRow = occupants(bBoard, PLAYER, 0).map((u) => ({ ...u }));
    if (ra.matchWinner) break;
  }
}

console.log(`${desyncs} desync${desyncs === 1 ? "" : "s"} across ${rounds} online rounds in ${MATCHES} matches`);
if (desyncs > 0) process.exit(1);
