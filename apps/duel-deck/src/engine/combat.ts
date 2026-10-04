import {
  SIDES,
  allUnits,
  cloneBoard,
  compactLane,
  front,
  laneCount,
  occupants,
  sideUnits,
} from "./board";
import type { AttackEvent, Board, BattleEvent, RoundResult, Side, Tick, Unit } from "./types";
import { otherSide } from "./types";

// Deterministic round resolution.
//
// Per the tracker doc:
//   - Only the front-most unit on each side fights; when it dies the next in
//     queue steps up. No multi-target, no ranged.
//   - Both fronts strike simultaneously — a unit that dies this tick still
//     deals its damage.
//   - Combat keywords (`Unit.traits`): first strike, executioner, damage
//     reduction, cleave, thorns, lifesteal, last breath.
//   - The round ends when a side's row is empty. Each of the winner's
//     SURVIVING units then hits the losing player's HP for its attack, so how
//     much of your row is left standing matters, not just who won.
//
// Pure: the input board is cloned, never mutated, so the same commit always
// yields the same result — what the eventual simultaneous-commit netcode needs.

const DEFAULT_TICK_CAP = 200;
/** Most damage a Cleave carry-over can deal. */
const CLEAVE_MAX = 3;
/** Damage of a Last Breath parting blow. */
const LAST_BREATH_DAMAGE = 2;

/** Round-wide tallies that persist across ticks. */
interface RoundState {
  damageDealt: Record<Side, number>;
  kills: Record<Side, number>;
  /** Whether a side has already had its first death (only that one can Last Breath). */
  firstDeathSeen: Record<Side, boolean>;
}

/** Everything one tick's blows read and write. */
interface TickCtx {
  board: Board;
  events: BattleEvent[];
  round: RoundState;
  first: boolean;
  /** HP at the start of the tick, so Executioner ignores same-tick damage. */
  startHp: Map<string, number>;
  /** Damage each unit dealt this tick, for Lifesteal. */
  dealt: Map<string, number>;
  /** Follow-up blows (cleave, thorns) held back so they emit after the main ones. */
  after: (() => void)[];
  total: number;
}

type AttackTag = NonNullable<AttackEvent["tag"]>;

function contestedLanes(board: Board): number[] {
  const out: number[] = [];
  for (let lane = 0; lane < board.lanes; lane++) {
    if (laneCount(board, "player", lane) > 0 && laneCount(board, "enemy", lane) > 0) {
      out.push(lane);
    }
  }
  return out;
}

/** The first living unit behind `target` in its lane's queue, if any. */
function nextBehind(board: Board, target: Unit, lane: number): Unit | null {
  const queue = occupants(board, target.side, lane);
  const idx = queue.findIndex((u) => u.id === target.id);
  for (let i = idx + 1; i < queue.length; i++) if (queue[i].hp > 0) return queue[i];
  return null;
}

/** The first living unit of a side in a lane (the front, once the dead are ignored). */
function livingFront(board: Board, side: Side, lane: number): Unit | null {
  return occupants(board, side, lane).find((u) => u.hp > 0) ?? null;
}

/** Raw damage after the target's reduction (a hit still deals at least 1). */
function reduced(raw: number, target: Unit): number {
  const dr = target.traits?.damageReduction ?? 0;
  return dr > 0 && raw > 0 ? Math.max(1, raw - dr) : raw;
}

/**
 * One blow. Applies damage immediately (deaths are only resolved at the end of
 * the tick, so a unit that "dies" here still strikes in the same exchange),
 * logs it, credits damage/kills, and queues any cleave overflow and thorns.
 */
function strike(
  ctx: TickCtx,
  lane: number,
  attacker: Unit,
  target: Unit,
  raw: number,
  tag?: AttackTag,
): void {
  const damage = reduced(raw, target);
  const blocked = raw - damage;
  const hpBefore = target.hp;
  target.hp -= damage;

  const { round, events, dealt } = ctx;
  round.damageDealt[attacker.side] += damage;
  dealt.set(attacker.id, (dealt.get(attacker.id) ?? 0) + damage);
  ctx.total += damage;
  if (hpBefore > 0 && target.hp <= 0) round.kills[attacker.side]++;

  const ev: AttackEvent = { type: "attack", lane, attacker: attacker.id, target: target.id, damage };
  if (tag) ev.tag = tag;
  if (blocked > 0) ev.blocked = blocked;
  events.push(ev);

  // Cleave: only a main blow carries overkill on (not thorns / last breath / cleave itself).
  const isMain = !tag || tag === "first-strike" || tag === "executioner";
  if (isMain && attacker.traits?.cleave && hpBefore > 0 && target.hp < 0) {
    // Half the overkill carries on, at most CLEAVE_MAX — the whole of it made
    // Cleave a near-lock (77% holder win rate in `pnpm sim --aug=random`).
    const excess = Math.min(CLEAVE_MAX, Math.floor(-target.hp / 2));
    ctx.after.push(() => {
      const next = nextBehind(ctx.board, target, lane);
      if (next && excess > 0) strike(ctx, lane, attacker, next, excess, "cleave");
    });
  }

  // Thorns: any hit reflects, but a reflected hit never reflects again.
  const thorns = target.traits?.thorns ?? 0;
  if (thorns > 0 && tag !== "thorns") {
    ctx.after.push(() => strike(ctx, lane, target, attacker, thorns, "thorns"));
  }
}

/** A front unit's blow on its opposite number, with Executioner folded in. */
function frontBlow(ctx: TickCtx, lane: number, attacker: Unit, target: Unit, firstStrike: boolean): void {
  const bonus = attacker.traits?.executioner ?? 0;
  const hurt = bonus > 0 && (ctx.startHp.get(target.id) ?? target.hp) * 2 < target.maxHp;
  const tag: AttackTag | undefined = firstStrike ? "first-strike" : hurt ? "executioner" : undefined;
  strike(ctx, lane, attacker, target, attacker.atk + (hurt ? bonus : 0), tag);
}

/** Run queued cleave/thorns blows (which may queue more) until none remain. */
function flushAfter(ctx: TickCtx): void {
  while (ctx.after.length > 0) ctx.after.shift()!();
}

/** The front exchange across lanes: first strikers go first, then everyone else. */
function frontExchange(ctx: TickCtx, lanes: number[]): void {
  const { board } = ctx;
  const pairs = lanes.flatMap((lane) => {
    const p = front(board, "player", lane);
    const e = front(board, "enemy", lane);
    return p && e ? [{ lane, p, e }] : [];
  });
  // First strike only breaks the tie when exactly one front has it.
  const striker = (p: Unit, e: Unit): Unit | null => {
    if (!ctx.first) return null;
    const pf = !!p.traits?.firstStrike;
    const ef = !!e.traits?.firstStrike;
    return pf === ef ? null : pf ? p : e;
  };

  for (const { lane, p, e } of pairs) {
    const s = striker(p, e);
    if (s) frontBlow(ctx, lane, s, s === p ? e : p, true);
  }
  for (const { lane, p, e } of pairs) {
    const s = striker(p, e);
    if (!s) {
      frontBlow(ctx, lane, p, e, false);
      frontBlow(ctx, lane, e, p, false);
    } else {
      // The slower side only answers if it survived the opening blow.
      const slow = s === p ? e : p;
      if (slow.hp > 0) frontBlow(ctx, lane, slow, s, false);
    }
  }
}

/** Last Breath: a side's first death, if it has the keyword, hits the enemy front once. */
function lastBreaths(ctx: TickCtx): void {
  const { board, round } = ctx;
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      for (const u of occupants(board, side, lane)) {
        if (u.hp > 0 || round.firstDeathSeen[side]) continue;
        round.firstDeathSeen[side] = true;
        if (!u.traits?.lastBreath) continue;
        const target = livingFront(board, otherSide(side), lane);
        // A flat parting blow. Rounds are kill races, so a free hit scaled
        // to the unit's attack converted trades into kills (~90% win rate).
        if (target) strike(ctx, lane, u, target, LAST_BREATH_DAMAGE, "last-breath");
      }
    }
  }
}

/** Lifesteal: survivors heal a fraction of the damage they dealt this tick. */
function lifestealHeals(ctx: TickCtx): void {
  for (const u of allUnits(ctx.board)) {
    const frac = u.traits?.lifesteal ?? 0;
    if (frac <= 0 || u.hp <= 0) continue;
    const gain = Math.min(Math.floor(frac * (ctx.dealt.get(u.id) ?? 0)), u.maxHp - u.hp);
    if (gain <= 0) continue;
    u.hp += gain;
    ctx.events.push({ type: "heal", unit: u.id, amount: gain });
  }
}

/** One tick across all contested lanes. Adds to the round tallies in place. */
function combatTick(
  board: Board,
  lanes: number[],
  events: BattleEvent[],
  round: RoundState,
  first: boolean,
): number {
  const startHp = new Map<string, number>();
  for (const u of allUnits(board)) startHp.set(u.id, u.hp);
  const ctx: TickCtx = {
    board,
    events,
    round,
    first,
    startHp,
    dealt: new Map(),
    after: [],
    total: 0,
  };

  frontExchange(ctx, lanes);
  flushAfter(ctx); // cleave overflow, thorns
  lastBreaths(ctx);
  flushAfter(ctx); // thorns off last-breath blows
  lifestealHeals(ctx);

  for (const u of allUnits(board)) {
    if (u.hp <= 0) events.push({ type: "death", unit: u.id, key: u.key, side: u.side });
  }
  // Remove the dead, then slide survivors forward so the next steps up.
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      const laneArr = board.slots[side][lane];
      for (let s = 0; s < laneArr.length; s++) {
        if (laneArr[s] && laneArr[s]!.hp <= 0) laneArr[s] = null;
      }
      compactLane(board, side, lane);
    }
  }
  return ctx.total;
}

export function resolveRound(input: Board, opts?: { tickCap?: number }): RoundResult {
  const board = cloneBoard(input);
  const tickCap = opts?.tickCap ?? DEFAULT_TICK_CAP;
  const ticks: Tick[] = [];
  const round: RoundState = {
    damageDealt: { player: 0, enemy: 0 },
    kills: { player: 0, enemy: 0 },
    firstDeathSeen: { player: false, enemy: false },
  };
  const { damageDealt, kills } = round;

  for (let t = 0; t < tickCap; t++) {
    const lanes = contestedLanes(board);
    if (lanes.length === 0) break;
    const events: BattleEvent[] = [];
    const dealt = combatTick(board, lanes, events, round, t === 0);
    ticks.push({ events, snapshot: cloneBoard(board) });
    if (dealt === 0) break; // stalemate guard (e.g. two 0-ATK fronts)
  }

  // Whoever still holds the row won the round.
  const playerLeft = sideUnits(board, "player").length;
  const enemyLeft = sideUnits(board, "enemy").length;
  let roundWinner: Side | null = null;
  if (playerLeft > 0 && enemyLeft === 0) roundWinner = "player";
  else if (enemyLeft > 0 && playerLeft === 0) roundWinner = "enemy";

  // Every unit the winner has left standing hits the loser's HP pool for its
  // attack (plus any Bounty).
  let hpLoss = 0;
  let bounty = 0;
  let survivorDamage = 0;
  const survivors = roundWinner ? sideUnits(board, roundWinner) : [];
  if (roundWinner) {
    bounty = Math.max(0, input.mods?.[roundWinner]?.bounty ?? 0);
    survivorDamage = survivors.reduce((sum, u) => sum + Math.max(0, u.atk), 0);
    hpLoss = survivorDamage + bounty;
    const loser = otherSide(roundWinner);
    board.hp[loser] = Math.max(0, board.hp[loser] - hpLoss);
  }

  let matchWinner: Side | null = null;
  if (board.hp.player <= 0 && board.hp.enemy <= 0) {
    matchWinner = board.hp.player >= board.hp.enemy ? "player" : "enemy";
  } else if (board.hp.enemy <= 0) matchWinner = "player";
  else if (board.hp.player <= 0) matchWinner = "enemy";

  return {
    board,
    ticks,
    roundWinner,
    damageDealt,
    hpLoss,
    survivors: { ids: survivors.map((u) => u.id), damage: survivorDamage },
    kills,
    ...(bounty > 0 ? { bounty } : {}),
    matchWinner,
  };
}
