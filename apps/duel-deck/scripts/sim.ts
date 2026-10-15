// Headless AI-vs-AI balance sim for Duel Deck, mirroring the app's round flow.
// Usage: pnpm sim [matches=5000] [--draw=none|more-damage|both] [--cap=300] [--aug=ai|random] [--hp=N]
//                 [--player=easy|normal|hard] [--enemy=easy|normal|hard]
//
// --player / --enemy set each side's AI difficulty (default normal), so
// `--enemy=hard` reports how often a Normal AI beats a Hard one.
//
// --aug=random picks augments uniformly from each offer instead of by the AI's
// score table. Use it for balance work: score-based picking means weak augments
// are almost never taken (tiny samples) and strong ones are mostly taken next to
// other strong ones, so their holder win rates are biased.
import { capacityOf, cloneBoard, sideUnits } from "../src/engine/board";
import { resolveRound } from "../src/engine/combat";
import { synergyOf } from "../src/engine/units";
import type { Side } from "../src/engine/types";
import { newBoard, aiCommit, drillFor, PICK_COUNT, type Difficulty, aiPickAugment, aiTakeAugment, isAugmentRound, refreshForRound, upgradeTier, augmentOfferCount } from "../src/game/match";
import { createAugmentState, offerAugments, takeAugment, AUGMENTS } from "../src/game/augments";
import { settleRound } from "../src/game/roundEnd";

type DrawRule = "none" | "more-damage" | "both";
const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 5000);
const CAP = Number(flag("cap") ?? 300);
const rule = (flag("draw") ?? "none") as DrawRule;
if (!["none", "more-damage", "both"].includes(rule)) throw new Error(`bad --draw=${rule}`);
const startHp = flag("hp") ? Number(flag("hp")) : null;
const augMode = flag("aug") ?? "ai";
const diff: Record<Side, Difficulty> = {
  player: (flag("player") ?? "normal") as Difficulty,
  enemy: (flag("enemy") ?? "normal") as Difficulty,
};
if (!["ai", "random"].includes(augMode)) throw new Error(`bad --aug=${augMode}`);
const pickAug = <T>(opts: T[]): T | null =>
  augMode === "random"
    ? (opts[Math.floor(Math.random() * opts.length)] ?? null)
    : (aiPickAugment(opts as never) as T | null);
const SIDES: Side[] = ["player", "enemy"];
const other = (s: Side): Side => (s === "player" ? "enemy" : "player");

const rounds: number[] = [];
const sideWins: Record<Side, number> = { player: 0, enemy: 0 };
let capHits = 0, totRounds = 0, totDraws = 0, zeroDmg = 0, drillRounds = 0;
const MAXR = 10; // rounds >= MAXR bucketed together
const byRound = Array.from({ length: MAXR + 1 }, () => ({ n: 0, draws: 0, dmg: 0 }));
const augWin: Record<string, [number, number]> = {};
// Full-row synergies: rounds they fired, and [won, n] for sides holding one in the final round.
const synRounds: Record<string, number> = { attack: 0, defense: 0, support: 0 };
const synWin: Record<string, [number, number]> = { attack: [0, 0], defense: [0, 0], support: [0, 0] };
// Unit levels (merges + 1) on each row at match end, and each row's highest.
const endLevels: number[] = [];
// Per unit type: [matches won, matches] for sides fielding it at match end.
const unitWin: Record<string, [number, number]> = {};
const topLevels: number[] = [];
for (const a of AUGMENTS) augWin[a.id] = [0, 0];

for (let i = 0; i < N; i++) {
  let board = newBoard();
  if (startHp) board.hp = { player: startHp, enemy: startHp };
  const aug = { player: createAugmentState(), enemy: createAugmentState() };
  let winner: Side | null = null, r = 0;
  const lastSyn: Record<Side, string | null> = { player: null, enemy: null };
  while (r < CAP) {
    r++;
    const c = cloneBoard(board);
    // Upgrade rounds open with the upgrade, before unit picks — as in the app.
    // --aug=ai plays the app's AI upgrade turn (rarity, fit, rerolls); random
    // mode picks blind, for unbiased per-augment win rates.
    if (isAugmentRound(r)) for (const s of SIDES) {
      if (augMode === "ai") { aiTakeAugment(c, s, aug[s], r, diff[s]); continue; }
      const ch = pickAug(offerAugments(aug[s], augmentOfferCount(aug[s]), upgradeTier(r)));
      if (ch) { const k = takeAugment(aug[s], ch.id, sideUnits(c, s)); if (k) c.hp[s] = Math.max(1, c.hp[s] - k); }
    }
    // Hard scouts the rows as they stood before either side picked.
    const scout = cloneBoard(c);
    const pp = aiCommit(c, "player", aug.player, { difficulty: diff.player, oppAug: aug.enemy, scout });
    const ep = aiCommit(c, "enemy", aug.enemy, { difficulty: diff.enemy, oppAug: aug.player, scout });
    // Drill: a maxed row's unspent picks, this round only (as in the app).
    aug.player.drill = drillFor(c, "player", PICK_COUNT - pp.length);
    aug.enemy.drill = drillFor(c, "enemy", PICK_COUNT - ep.length);
    if (aug.player.drill || aug.enemy.drill) drillRounds++;
    refreshForRound(c, aug.player, aug.enemy);
    for (const s of SIDES) {
      const a = synergyOf(sideUnits(c, s), capacityOf(c, s));
      lastSyn[s] = a;
      if (a) synRounds[a]++;
    }
    const res = resolveRound(c);
    // Same round-end bookkeeping as the app (Momentum, Rally, kills, Veteran,
    // Field medic) — before reading HP, since Field medic heals the result.
    for (const s of SIDES) settleRound(res, s, aug[s], c);
    const hp = { ...res.board.hp };
    let applied = res.hpLoss, isDraw = !res.roundWinner, mw = res.matchWinner;
    if (isDraw && rule !== "none") {
      const dp = res.damageDealt.player, de = res.damageDealt.enemy;
      if (rule === "more-damage" && dp !== de) {
        const w = dp > de ? "player" : "enemy";
        hp[other(w)] -= res.damageDealt[w]; applied = res.damageDealt[w]; isDraw = false;
      } else if (rule === "both") {
        hp.enemy -= dp; hp.player -= de; applied = dp + de; isDraw = false;
      }
      if (!isDraw || applied > 0) {
        if (hp.player <= 0 || hp.enemy <= 0) mw = hp.player === hp.enemy ? (Math.random() < 0.5 ? "player" : "enemy") : hp.player > hp.enemy ? "player" : "enemy";
      }
    }
    const b = byRound[Math.min(r, MAXR)];
    b.n++; b.dmg += applied; if (isDraw) { b.draws++; totDraws++; }
    if (applied === 0) zeroDmg++;
    if (mw) { winner = mw; break; }
    board = cloneBoard(c); board.hp = hp;
  }
  for (const s of SIDES) {
    const a = lastSyn[s];
    if (a) { synWin[a][1]++; if (winner === s) synWin[a][0]++; }
  }
  for (const s of SIDES) {
    for (const k of new Set(sideUnits(board, s).map((u) => u.key))) {
      const t = (unitWin[k] ??= [0, 0]);
      t[1]++;
      if (winner === s) t[0]++;
    }
    const lv = sideUnits(board, s).map((u) => u.merges + 1);
    endLevels.push(...lv);
    if (lv.length) topLevels.push(Math.max(...lv));
  }
  rounds.push(r); totRounds += r;
  if (winner) sideWins[winner]++;
  if (!winner) capHits++;
  else for (const s of SIDES) for (const id of aug[s].active) { augWin[id][1]++; if (winner === s) augWin[id][0]++; }
}

rounds.sort((a, b) => a - b);
const pct = (p: number) => rounds[Math.min(rounds.length - 1, Math.floor(p * rounds.length))];
const f = (x: number, d = 1) => x.toFixed(d);
console.log(`draw rule: ${rule}   matches: ${N}   cap: ${CAP}`);
console.log(`player (${diff.player}) wins ${f(100 * sideWins.player / N)}%   enemy (${diff.enemy}) wins ${f(100 * sideWins.enemy / N)}%`);
console.log(`rounds/match: p10 ${pct(0.1)} median ${pct(0.5)} p90 ${pct(0.9)} max ${rounds[rounds.length - 1]}   mean ${f(totRounds / N)}`);
console.log(`draw rounds: ${f(100 * totDraws / totRounds)}%   zero-damage rounds: ${f(100 * zeroDmg / totRounds)}%   cap hits: ${capHits}`);
console.log(`rounds with Drill (a maxed row): ${f(100 * drillRounds / totRounds)}%`);
console.log("by round:");
byRound.forEach((b, r) => { if (r && b.n) console.log(`  r${String(r).padEnd(3)}${r === MAXR ? "+" : " "} draws ${f(100 * b.draws / b.n, 0).padStart(3)}%  avg dmg ${f(b.dmg / b.n).padStart(5)}  (n=${b.n})`); });
const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
endLevels.sort((a, b) => a - b); topLevels.sort((a, b) => a - b);
console.log(`unit level at match end: median ${q(endLevels, 0.5)} p75 ${q(endLevels, 0.75)} p90 ${q(endLevels, 0.9)} p99 ${q(endLevels, 0.99)} max ${endLevels[endLevels.length - 1]}`);
console.log(`row's top level:       median ${q(topLevels, 0.5)} p75 ${q(topLevels, 0.75)} p90 ${q(topLevels, 0.9)} p99 ${q(topLevels, 0.99)} max ${topLevels[topLevels.length - 1]}`);
console.log("full-row synergies (share of rows that had one; win rate of sides holding one in the final round):");
for (const a of Object.keys(synRounds)) {
  const [w, n] = synWin[a];
  console.log(`  ${a.padEnd(10)} ${f((100 * synRounds[a]) / (2 * totRounds))}% of rows   holder won ${n ? f((100 * w) / n) + "%" : "n/a"} (n=${n})`);
}
console.log("unit holder win rate (fielded at match end):");
for (const [k, [w, n]] of Object.entries(unitWin).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]))
  console.log(`  ${k.padEnd(20)} ${f(100 * w / n)}%  (n=${n})`);
console.log("augment holder win rate:");
for (const [id, [w, n]] of Object.entries(augWin).sort((a, b) => (b[1][0] / (b[1][1] || 1)) - (a[1][0] / (a[1][1] || 1))))
  console.log(`  ${id.padEnd(20)} ${n ? f(100 * w / n) + "%" : "n/a"}  (n=${n})`);
