// Economy prototype: bots with different spending habits play a round-robin
// through the real engine, with no UI and no change to the game's rules.
//
//   pnpm economy [matches-per-pair=100] [--rule=income:5,unit:2] [--only=spend,save10]
//
// What it answers: is saving ever worth it, is buying income on round 1 always
// right or never right, do matches stay around 20 rounds, and does any one
// habit beat everything else. Bots share one way of choosing cards (real
// players' take rates, fill the row then merge), so a gap between two of them
// comes from how they spend. No bot here plays as well as a person.

import { cloneBoard, firstEmptySpot, makeUnit, mergeCapFor, occupants, place, sideUnits, upgradeUnit, writeLane } from "../src/engine/board";
import { resolveRound } from "../src/engine/combat";
import type { Board, Side, Unit } from "../src/engine/types";
import { OFFER_KEYS, canAbsorb, levelOf } from "../src/engine/units";
import { createAugmentState, mergeRatioFor, newUpgradeSeed, rollRarity, type AugmentState } from "../src/game/augments";
import { LEARNED, OFFER_COUNT, aiTakeAugment, isAugmentRound, newBoard, refreshForRound, rollOffer, supportOrder, upgradeTier } from "../src/game/match";
import { settleRound } from "../src/game/roundEnd";

const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);

/** The most balanced set so far (see CLAUDE.md); `--rule=name:value,…` overrides them. */
const RULES = {
  income: 4,
  unit: 2,
  /** Rerolls beyond the free one. */
  reroll: 1,
  /** +1 gold per this many held, up to `interestCap`. */
  interestPer: 6,
  interestCap: 2,
  holdCap: 30,
  startSlots: 4,
  slot4: 2,
  slot5: 2,
  income1: 5,
  income2: 8,
  /** Selling pays this, plus a gold per 2 levels. */
  sell: 2,
  tier2: 10,
  tier3: 8,
  /** Each tier above the first adds this to a card's price. */
  tierExtra: 1,
  /** Gold a round for having every slot filled. */
  fullBonus: 0,
};
for (const kv of flag("rule")?.split(",") ?? []) {
  const [k, v] = kv.split(":");
  if (!(k in RULES)) throw new Error(`no rule ${k}`);
  RULES[k as keyof typeof RULES] = Number(v);
}

/** A spending habit. */
interface Policy {
  name: string;
  /** Keep this much gold unspent, for interest. */
  floor?: number;
  /** Income purchases to make, as soon as they can be paid for. */
  income?: number;
  /** No slot before this round (Infinity: never). */
  slotFrom?: number;
  /** Card tier to buy up to, as soon as it can be paid for, from round 3. */
  tier?: number;
  /** Sell the weakest unit, below this many merges, when nothing else can be bought. */
  sell?: number;
  /** Pay for extra rerolls when no card fits. */
  reroll?: boolean;
  /** Take a unit type out of the match with an upgrade choice, from this round. */
  ban?: number;
  /** Which type: the opponent's best ("top"), or the best they hold and you don't ("counter"). */
  banMode?: "top" | "counter";
  /** No tier purchase before this round. */
  tierFrom?: number;
}

const POLICIES: Policy[] = [
  { name: "spend" },
  { name: "save5", floor: 5 },
  { name: "save10", floor: 10 },
  { name: "save15", floor: 15 },
  { name: "income1", income: 1 },
  { name: "income2", income: 2 },
  { name: "income2+save10", income: 2, floor: 10 },
  { name: "tall", slotFrom: Infinity },
  { name: "lateSlots", slotFrom: 8 },
  { name: "tier2", tier: 2 },
  { name: "tier3", tier: 3 },
  { name: "tier3late", tier: 3, tierFrom: 9 },
  { name: "sell", sell: 2 },
  { name: "sellMore", sell: 5 },
  { name: "reroll", reroll: true },
  { name: "ban", ban: 3 },
  { name: "ban9", ban: 9 },
  { name: "ban15", ban: 15 },
  { name: "banCounter", ban: 9, banMode: "counter" },
];

interface Purse {
  gold: number;
  slots: number;
  incomes: number;
  tier: number;
  spent: { units: number; slots: number; income: number; tier: number; reroll: number };
  banned: boolean;
}

const newPurse = (): Purse => ({
  gold: 0,
  slots: RULES.startSlots,
  incomes: 0,
  tier: 1,
  spent: { units: 0, slots: 0, income: 0, tier: 0, reroll: 0 },
  banned: false,
});

const appeal = (key: string) => {
  const c = LEARNED.cards[key];
  return c?.offered ? c.taken / c.offered : 0;
};
const ROOM_MERGE = LEARNED.roomPicks ? LEARNED.roomMerges / LEARNED.roomPicks : 0.15;

function spot(board: Board, side: Side, id: string): number {
  return board.slots[side][0].findIndex((u) => u?.id === id);
}

/** Add a card's levels to a unit, as a tier-N card would. */
function mergeCard(board: Board, side: Side, u: Unit, key: string, tier: number, ratio: number | undefined): boolean {
  let done = false;
  for (let n = 0; n < tier; n++) {
    const s = spot(board, side, u.id);
    if (s >= 0 && upgradeUnit(board, side, 0, s, key, ratio)) done = true;
  }
  return done;
}

function placeCard(board: Board, side: Side, key: string, tier: number, ratio: number | undefined): boolean {
  const at = firstEmptySpot(board, side);
  if (!at) return false;
  const unit = makeUnit(key, side);
  place(board, side, at.lane, at.spot, unit);
  for (let n = 1; n < tier; n++) upgradeUnit(board, side, at.lane, at.spot, key, ratio);
  return true;
}

function spendRound(board: Board, side: Side, state: AugmentState, purse: Purse, p: Policy, round: number, keys: readonly string[]): void {
  const can = (cost: number) => purse.gold - cost >= 0;
  const pay = (cost: number, on: keyof Purse["spent"]) => {
    purse.gold -= cost;
    purse.spent[on] += cost;
  };
  // Income first: it's the investment, and only early pays back.
  const wanted = p.income ?? 0;
  while (purse.incomes < wanted) {
    const cost = purse.incomes === 0 ? RULES.income1 : RULES.income2;
    if (!can(cost)) break;
    pay(cost, "income");
    purse.incomes++;
  }
  if (purse.incomes < wanted) return; // saving up for it
  const earned = board.earnedSlots?.[side] ?? 0;
  const size = () => sideUnits(board, side).length;
  const slotCost = () => (purse.slots === 3 ? RULES.slot4 : RULES.slot5);
  if (round >= (p.slotFrom ?? 0) && purse.slots < 5 && size() >= purse.slots + earned && can(slotCost())) {
    pay(slotCost(), "slots");
    purse.slots++;
  }
  if (p.tier && round >= (p.tierFrom ?? 3) && purse.tier < p.tier) {
    const cost = purse.tier === 1 ? RULES.tier2 : RULES.tier3;
    if (!can(cost)) return;
    pay(cost, "tier");
    purse.tier++;
  }
  const ratio = mergeRatioFor(state);
  let offer = rollOffer(OFFER_COUNT, state, keys);
  let freeReroll = true;
  const floor = p.floor ?? 0;
  const unitCost = () => RULES.unit + (purse.tier - 1) * RULES.tierExtra;
  const wontBreak = () => purse.gold - unitCost() >= floor;
  for (let guard = 0; guard < 12 && wontBreak() && offer.length > 0; guard++) {
    const cap = mergeCapFor(board, side);
    const room = size() < purse.slots + earned && !!firstEmptySpot(board, side);
    const targets = sideUnits(board, side).sort((a, b) => b.merges - a.merges);
    let target: Unit | undefined;
    let card = -1;
    for (const u of targets) {
      card = offer.findIndex((k) => canAbsorb(u.key, u.merges, k, 1, cap));
      if (card >= 0) {
        target = u;
        break;
      }
    }
    if (target && (!room || Math.random() < ROOM_MERGE)) {
      const key = offer[card];
      if (mergeCard(board, side, target, key, purse.tier, ratio)) {
        offer.splice(card, 1);
        pay(unitCost(), "units");
        continue;
      }
    }
    if (room) {
      const key = [...offer].sort((a, b) => appeal(b) - appeal(a))[0];
      placeCard(board, side, key, purse.tier, ratio);
      offer.splice(offer.indexOf(key), 1);
      pay(unitCost(), "units");
      continue;
    }
    if (freeReroll) {
      freeReroll = false;
      offer = rollOffer(OFFER_COUNT, state, keys);
      continue;
    }
    if (p.reroll && can(RULES.reroll + unitCost())) {
      pay(RULES.reroll, "reroll");
      offer = rollOffer(OFFER_COUNT, state, keys);
      continue;
    }
    if (p.sell) {
      const row = occupants(board, side, 0);
      const worst = [...row].sort((a, b) => a.merges - b.merges)[0];
      if (worst && worst.merges < p.sell && row.length > 1) {
        purse.gold += RULES.sell + Math.floor(levelOf(worst.merges) / 2);
        writeLane(board, side, 0, row.filter((u) => u !== worst));
        continue;
      }
    }
    break;
  }
  writeLane(board, side, 0, supportOrder(occupants(board, side, 0)));
}

interface Result {
  winner: Side | null;
  rounds: number;
  purse: Record<Side, Purse>;
  top: Record<Side, number>;
  /** Biggest share of the match's rounds any lead held from round 6. */
  swing: boolean;
}

function playMatch(a: Policy, b: Policy): Result {
  let board = newBoard();
  const aug: Record<Side, AugmentState> = { player: createAugmentState(), enemy: createAugmentState() };
  const purse: Record<Side, Purse> = { player: newPurse(), enemy: newPurse() };
  const policy: Record<Side, Policy> = { player: a, enemy: b };
  const seed = newUpgradeSeed();
  let keys: string[] = [...OFFER_KEYS];
  let round = 0;
  let winner: Side | null = null;
  let leader6: Side | null = null;
  while (round < 80) {
    round++;
    const c = cloneBoard(board);
    for (const s of ["player", "enemy"] as Side[]) {
      const p = purse[s];
      const interest = Math.min(RULES.interestCap, Math.floor(p.gold / RULES.interestPer));
      const full = sideUnits(c, s).length >= p.slots ? RULES.fullBonus : 0;
      p.gold = Math.min(RULES.holdCap, p.gold + RULES.income + p.incomes + interest + full);
      if (isAugmentRound(round)) {
        if (policy[s].ban && round >= policy[s].ban! && !p.banned) {
          // Instead of an upgrade: a type the other side has levelled.
          const other: Side = s === "player" ? "enemy" : "player";
          const mine = new Set(sideUnits(c, s).map((u) => u.key));
          const theirs = sideUnits(c, other)
            .filter((u) => policy[s].banMode !== "counter" || !mine.has(u.key))
            .sort((x, y) => y.merges - x.merges);
          const top = theirs[0];
          p.banned = true;
          if (top && keys.length > 4) keys = keys.filter((k) => k !== (top.key === "knight" ? "squire" : top.key));
        } else aiTakeAugment(c, s, aug[s], rollRarity(seed, upgradeTier(round)), "normal");
      }
    }
    for (const s of ["player", "enemy"] as Side[]) spendRound(c, s, aug[s], purse[s], policy[s], round, keys);
    refreshForRound(c, aug.player, aug.enemy);
    const res = resolveRound(c);
    for (const s of ["player", "enemy"] as Side[]) settleRound(res, s, aug[s], c);
    if (round === 6) leader6 = res.board.hp.player === res.board.hp.enemy ? null : res.board.hp.player > res.board.hp.enemy ? "player" : "enemy";
    if (res.matchWinner) {
      winner = res.matchWinner;
      break;
    }
    const hp = { ...res.board.hp };
    board = cloneBoard(c);
    board.hp = hp;
  }
  const top = (s: Side) => Math.max(0, ...sideUnits(board, s).map((u) => levelOf(u.merges)));
  return { winner, rounds: round, purse, top: { player: top("player"), enemy: top("enemy") }, swing: !!(leader6 && winner && leader6 !== winner) };
}

const only = flag("only")?.split(",");
const field = POLICIES.filter((p) => !only || only.includes(p.name));
const score = new Map(field.map((p) => [p.name, { won: 0, n: 0, spent: { units: 0, slots: 0, income: 0, tier: 0, reroll: 0 }, left: 0, top: 0 }]));
const vs = new Map<string, number>();
const rounds: number[] = [];
let capped = 0;
let swings = 0;
for (const a of field) {
  for (const b of field) {
    if (a.name >= b.name) continue;
    let aWins = 0;
    for (let i = 0; i < N; i++) {
      // Sides alternate, in case the engine's order favours one.
      const flip = i % 2 === 1;
      const r = flip ? playMatch(b, a) : playMatch(a, b);
      rounds.push(r.rounds);
      if (!r.winner) capped++;
      if (r.swing) swings++;
      const sideA: Side = flip ? "enemy" : "player";
      const sideB: Side = flip ? "player" : "enemy";
      const add = (name: string, s: Side, won: boolean) => {
        const t = score.get(name)!;
        t.n++;
        if (won) t.won++;
        for (const k of Object.keys(t.spent) as (keyof typeof t.spent)[]) t.spent[k] += r.purse[s].spent[k];
        t.left += r.purse[s].gold;
        t.top += r.top[s];
      };
      add(a.name, sideA, r.winner === sideA);
      add(b.name, sideB, r.winner === sideB);
      if (r.winner === sideA) aWins++;
    }
    vs.set(`${a.name}|${b.name}`, aWins / N);
    vs.set(`${b.name}|${a.name}`, 1 - aWins / N);
  }
}

rounds.sort((x, y) => x - y);
const q = (p: number) => rounds[Math.floor(p * (rounds.length - 1))];
console.log(`rules ${JSON.stringify(RULES)}`);
console.log(`matches ${rounds.length} (${N} a pair): rounds p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)}, no winner by 80: ${capped}, round-6 leader lost: ${((100 * swings) / rounds.length).toFixed(0)}%`);
const rank = [...score].sort((a, b) => b[1].won / b[1].n - a[1].won / a[1].n);
console.log("habit            win%   worst matchup      gold on: units slots income tier reroll  left  top lv");
for (const [name, t] of rank) {
  const opp = field.filter((p) => p.name !== name).map((p) => [p.name, vs.get(`${name}|${p.name}`) ?? 0] as const).sort((x, y) => x[1] - y[1]);
  const worst = opp[0];
  const avg = (v: number) => (v / t.n).toFixed(0).padStart(5);
  console.log(
    `${name.padEnd(16)} ${((100 * t.won) / t.n).toFixed(1).padStart(5)}  ${`${worst?.[0] ?? "-"} ${((worst?.[1] ?? 0) * 100).toFixed(0)}%`.padEnd(20)}   ${avg(t.spent.units)} ${avg(t.spent.slots)} ${avg(t.spent.income)} ${avg(t.spent.tier)} ${avg(t.spent.reroll)} ${avg(t.left)} ${(t.top / t.n).toFixed(1).padStart(5)}`,
  );
}
