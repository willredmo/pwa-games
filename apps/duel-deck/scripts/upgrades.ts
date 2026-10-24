// Upgrade check. Usage: pnpm upgrades
//
// Every offered upgrade gets a small scenario run through the real engine
// (refreshForRound, resolveRound, settleRound) and an assertion that it does
// what its description says. Not a balance test (that's `pnpm sim`): this is
// "does Banner of hope give the health it promises", one upgrade at a time.
// Also checks the level cap survives the round's board clone, and fails if
// an offered upgrade has no check here.

import { cloneBoard, insertUnit, levelCapOf, makeUnit, occupants, upgradeUnit } from "../src/engine/board";
import { resolveRound } from "../src/engine/combat";
import { KNIGHT_AT, UNITS, isMastered } from "../src/engine/units";
import type { AttackEvent, BattleEvent, Board, BuffEvent, HealEvent, RoundResult, Side, Unit } from "../src/engine/types";
import {
  OFFERED_AUGMENTS,
  createAugmentState,
  mergeRatioFor,
  takeAugment,
  transferGrant,
  type AugmentState,
} from "../src/game/augments";
import {
  ENEMY,
  PLAYER,
  UNIT_REROLLS,
  augmentOfferCount,
  chargeNewUpgrades,
  knightAt,
  newBoard,
  refreshForRound,
  unitRerollsFor,
  type MatchRules,
} from "../src/game/match";
import { settleRound } from "../src/game/roundEnd";

// --- Harness ---------------------------------------------------------------

const failures: string[] = [];
const covered = new Set<string>();
let checks = 0;

/** Record one assertion for `id` (an upgrade id, or a topic like "level-cap"). */
function check(id: string, what: string, ok: boolean, got?: unknown): void {
  covered.add(id);
  checks++;
  if (!ok) failures.push(`${id}: ${what}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ""}`);
}

interface Spec {
  key: string;
  merges?: number;
  atk?: number;
  hp?: number;
}
type U = string | Spec;

function mk(u: U, side: Side): Unit {
  const s = typeof u === "string" ? { key: u } : u;
  const unit = makeUnit(s.key, side);
  if (s.merges) unit.merges = s.merges;
  if (s.atk !== undefined) unit.baseAtk = s.atk;
  if (s.hp !== undefined) unit.baseMaxHp = s.hp;
  return unit;
}

interface Setup {
  board: Board;
  p: Unit[];
  e: Unit[];
  pAug: AugmentState;
  eAug: AugmentState;
}

/**
 * A refreshed board: `mine` and `theirs` front-first, each side holding the
 * listed upgrades (taken through `takeAugment`, so onPick runs).
 */
function setup(
  mine: U[],
  theirs: U[],
  ups: string[] = [],
  opts: { enemyUps?: string[]; rules?: Partial<MatchRules>; hp?: number; aug?: Partial<AugmentState> } = {},
): Setup {
  const board = newBoard(opts.rules ?? {});
  if (opts.hp !== undefined) board.hp.player = opts.hp;
  mine.forEach((u, i) => insertUnit(board, PLAYER, 0, i, mk(u, PLAYER)));
  theirs.forEach((u, i) => insertUnit(board, ENEMY, 0, i, mk(u, ENEMY)));
  const pAug = { ...createAugmentState(), ...opts.aug };
  const eAug = createAugmentState();
  for (const id of ups) takeAugment(pAug, id, occupants(board, PLAYER, 0));
  for (const id of opts.enemyUps ?? []) takeAugment(eAug, id, occupants(board, ENEMY, 0));
  refreshForRound(board, pAug, eAug);
  return { board, p: occupants(board, PLAYER, 0), e: occupants(board, ENEMY, 0), pAug, eAug };
}

/** A unit's stats with and without the upgrades, same row otherwise. */
function delta(mine: U[], theirs: U[], ups: string[], i: number, opts: Parameters<typeof setup>[3] = {}) {
  const a = setup(mine, theirs, [], opts).p[i];
  const b = setup(mine, theirs, ups, opts).p[i];
  return { atk: b.atk - a.atk, hp: b.maxHp - a.maxHp, unit: b, base: a };
}

const events = (r: RoundResult): BattleEvent[] => [...(r.opening ?? []), ...r.ticks.flatMap((t) => t.events)];
const attacks = (r: RoundResult) => events(r).filter((e): e is AttackEvent => e.type === "attack");
const buffs = (r: RoundResult) => events(r).filter((e): e is BuffEvent => e.type === "buff");
const heals = (r: RoundResult) => events(r).filter((e): e is HealEvent => e.type === "heal");

const base = (key: string) => UNITS[key];

// --- Level cap ---------------------------------------------------------------

for (const cap of [8, 10, 12, 15]) {
  const s = setup([{ key: "striker", merges: cap - 1 }, { key: "striker", merges: cap - 2 }], ["guard"], [], { rules: { levelCap: cap } });
  check("level-cap", `cap ${cap}: a unit at level ${cap} is mastered`, !!s.p[0].traits?.chargeEach);
  check("level-cap", `cap ${cap}: a unit at level ${cap - 1} isn't`, !s.p[1].traits?.chargeEach);
  // The board is cloned every round (the respawn snapshot, resolveRound).
  const next = cloneBoard(s.board);
  check("level-cap", `cap ${cap} survives cloneBoard`, levelCapOf(next) === cap, levelCapOf(next));
  check("level-cap", `cap ${cap} survives resolveRound`, levelCapOf(resolveRound(s.board).board) === cap);
  refreshForRound(next, s.pAug, s.eAug);
  const lead = occupants(next, PLAYER, 0)[0];
  check("level-cap", `cap ${cap}: still mastered next round`, !!lead.traits?.chargeEach);
  check("level-cap", `cap ${cap}: merge cap is ${cap - 1} merges`, !upgradeUnit(next, PLAYER, 0, 0, "striker"));
  check("level-cap", `cap ${cap}: earned slot at the cap`, next.earnedSlots?.player === 1, next.earnedSlots);
}
{
  const s = setup([{ key: "guard", merges: 9 }], ["guard"], [], { rules: { levelCap: 15 } });
  check("level-cap", "cap 15: level 10 isn't mastered", !isMastered(s.p[0].merges, levelCapOf(s.board)) && s.p[0].traits?.deathBuff?.target === "behind");
}

// --- Class-targeted ----------------------------------------------------------

{
  const row = ["guard", "bulwark", "striker"];
  const g = delta(row, ["guard"], ["reinforced-plating"], 0);
  const b = delta(row, ["guard"], ["reinforced-plating"], 1);
  const s = delta(row, ["guard"], ["reinforced-plating"], 2);
  check("reinforced-plating", "+3 health to Guards and Bulwarks only", g.hp === 3 && b.hp === 3 && s.hp === 0, [g.hp, b.hp, s.hp]);
}
{
  const row = ["striker", "berserker", "guard"];
  const d = [0, 1, 2].map((i) => delta(row, ["guard"], ["sharpened-edge"], i).atk);
  check("sharpened-edge", "+2 attack to Strikers and Berserkers only", d.join() === "2,2,0", d);
}
{
  const row = ["berserker", "striker"];
  const d = [0, 1].map((i) => delta(row, ["guard"], ["adrenaline"], i).atk);
  check("adrenaline", "+3 attack to Berserkers only", d.join() === "3,0", d);
}
{
  const b = delta(["bulwark", "guard"], ["guard"], ["iron-will"], 0);
  const g = delta(["bulwark", "guard"], ["guard"], ["iron-will"], 1);
  check("iron-will", "+1/+4 to Bulwarks only", b.atk === 1 && b.hp === 4 && g.atk === 0 && g.hp === 0, [b.atk, b.hp, g.atk, g.hp]);
}
{
  const s = delta(["striker", "berserker"], ["guard"], ["precision-strikes"], 0);
  const b = delta(["striker", "berserker"], ["guard"], ["precision-strikes"], 1);
  check("precision-strikes", "+2/+1 to Strikers only", s.atk === 2 && s.hp === 1 && b.atk === 0, [s.atk, s.hp, b.atk]);
}

// --- Global ------------------------------------------------------------------

{
  const row = ["guard", "medic", "beacon"];
  const d = [0, 1, 2].map((i) => delta(row, ["guard"], ["battle-fury"], i).atk);
  check("battle-fury", "+1 attack to every unit", d.join() === "1,1,1", d);
}
{
  const s = setup(["guard", "striker"], ["guard"], ["last-stand"]);
  check("last-stand", "the front unit gains +5 health", s.p[0].maxHp === base("guard").maxHp + 5 && s.p[1].maxHp === base("striker").maxHp, [s.p[0].maxHp, s.p[1].maxHp]);
  const next = cloneBoard(s.board);
  refreshForRound(next, s.pAug, s.eAug);
  check("last-stand", "permanently (still there next round)", occupants(next, PLAYER, 0)[0].maxHp === base("guard").maxHp + 5);
  transferGrant(s.pAug, s.p[0].id, s.p[1].id);
  refreshForRound(s.board, s.pAug, s.eAug);
  check("last-stand", "a merge carries it to the unit merged into", s.p[1].maxHp === base("striker").maxHp + 5);
}
{
  const d = delta(["guard"], ["guard"], ["momentum"], 0, { aug: { momentum: 7 } });
  check("momentum", "+1 attack per 3 rounds won (7 wins: +2)", d.atk === 2, d.atk);
  const s = setup([{ key: "berserker", atk: 50, hp: 999 }], ["guard"], ["momentum"]);
  const r = resolveRound(s.board);
  settleRound(r, PLAYER, s.pAug, s.board);
  check("momentum", "a round won counts", r.roundWinner === PLAYER && s.pAug.momentum === 1, s.pAug.momentum);
}
{
  const low = delta(["guard"], ["guard"], ["desperate-measures"], 0, { hp: 99 });
  const half = delta(["guard"], ["guard"], ["desperate-measures"], 0, { hp: 100 });
  check("desperate-measures", "+2 attack below half the starting HP, not at half", low.atk === 2 && half.atk === 0, [low.atk, half.atk]);
  const big = delta(["guard"], ["guard"], ["desperate-measures"], 0, { hp: 149, rules: { startHp: 300 } });
  check("desperate-measures", "half of a custom starting HP (149 of 300)", big.atk === 2, big.atk);
}
{
  const d4 = delta(["guard", "guard", "guard", "guard"], ["guard"], ["united-front"], 3);
  const d5 = delta(["guard", "guard", "guard", "guard", "guard"], ["guard"], ["united-front"], 0);
  check("united-front", "+1 health per 2 units (4: +2, 5: +2)", d4.hp === 2 && d5.hp === 2, [d4.hp, d5.hp]);
}
{
  const d = delta(["guard"], ["guard"], ["overwhelm"], 0, { aug: { kills: 6 } });
  check("overwhelm", "+1 attack per 3 kills last round (6: +2)", d.atk === 2, d.atk);
  const s = setup([{ key: "berserker", atk: 99, hp: 999 }], ["guard", "guard", "guard"], ["overwhelm"]);
  const r = resolveRound(s.board);
  settleRound(r, PLAYER, s.pAug, s.board);
  check("overwhelm", "kills are counted at round end", s.pAug.kills === 3, s.pAug.kills);
}
{
  const st = createAugmentState();
  const cost = takeAugment(st, "bloodpact", [], 200);
  const cost300 = takeAugment(createAugmentState(), "bloodpact", [], 300);
  check("bloodpact", "costs 40% of the starting HP", cost === 80 && cost300 === 120, [cost, cost300]);
  const d = [0, 1].map((i) => delta(["guard", "medic"], ["guard"], ["bloodpact"], i).atk);
  check("bloodpact", "+2 attack to every unit", d.join() === "2,2", d);
  // Online: the opponent's device charges it too when their commit shows it.
  const b = newBoard();
  chargeNewUpgrades(b, ENEMY, [], ["bloodpact"]);
  chargeNewUpgrades(b, ENEMY, ["bloodpact"], ["bloodpact"]);
  check("bloodpact", "online: charged once on the other device", b.hp.enemy === 120, b.hp.enemy);
}

// --- Synergy -----------------------------------------------------------------

{
  const f = delta(["guard", "striker"], ["guard"], ["vanguards-edge"], 0);
  const b = delta(["guard", "striker"], ["guard"], ["vanguards-edge"], 1);
  check("vanguards-edge", "+2/+2 to the front unit only", f.atk === 2 && f.hp === 2 && b.atk === 0 && b.hp === 0, [f, b].map((x) => [x.atk, x.hp]));
}
{
  const five = delta(["guard", "striker", "medic", "bulwark", "lancer"], ["guard"], ["mixed-formation"], 4);
  const four = delta(["guard", "striker", "medic", "bulwark", "guard"], ["guard"], ["mixed-formation"], 0);
  check("mixed-formation", "+1/+1 with 5 unit types, nothing with 4", five.atk === 1 && five.hp === 1 && four.atk === 0, [five.atk, five.hp, four.atk]);
}
{
  const d4 = delta(["guard"], ["guard"], ["berserkers-rally"], 0, { aug: { rally: 4 } });
  const d99 = delta(["guard"], ["guard"], ["berserkers-rally"], 0, { aug: { rally: 99 } });
  check("berserkers-rally", "+1 attack per 4 Berserker deaths, up to +2", d4.atk === 1 && d99.atk === 2, [d4.atk, d99.atk]);
  const s = setup(["berserker", "berserker"], [{ key: "bulwark", atk: 99, hp: 99 }], ["berserkers-rally"]);
  const r = resolveRound(s.board);
  settleRound(r, PLAYER, s.pAug, s.board);
  check("berserkers-rally", "Berserker deaths are counted", s.pAug.rally === 2, s.pAug.rally);
}
{
  const s = setup(["striker", "striker", "berserker", "guard"], ["guard"], ["twin-fangs"]);
  const d = s.p.map((u, i) => u.atk - setup(["striker", "striker", "berserker", "guard"], ["guard"]).p[i].atk);
  check("twin-fangs", "+1 attack per other Striker/Berserker (3 of them: +2 each, Guard 0)", d.join() === "2,2,2,0", d);
  const h = s.p.map((u, i) => u.maxHp - setup(["striker", "striker", "berserker", "guard"], ["guard"]).p[i].maxHp);
  check("twin-fangs", "and +1 health per other", h.join() === "2,2,2,0", h);
  const five = delta(["striker", "striker", "berserker", "berserker", "striker"], ["guard"], ["twin-fangs"], 0);
  check("twin-fangs", "up to +3", five.atk === 3, five.atk);
  const one = delta(["striker", "guard"], ["guard"], ["twin-fangs"], 0);
  check("twin-fangs", "nothing for a lone one", one.atk === 0, one.atk);
}

// --- Combat keywords ---------------------------------------------------------

{
  // Both would kill each other in one exchange; with First strike only ours swings.
  const s = setup([{ key: "striker", atk: 20, hp: 5 }], [{ key: "guard", atk: 20, hp: 5 }], ["first-strike"]);
  const r = resolveRound(s.board);
  const first = attacks(r)[0];
  const back = attacks(r).filter((a) => a.attacker === s.e[0].id);
  check("first-strike", "the Striker's blow lands first and kills before one comes back", first?.tag === "first-strike" && back.length === 0 && r.roundWinner === PLAYER, attacks(r));
  const late = setup(["guard", { key: "striker", atk: 20, hp: 5 }], [{ key: "guard", atk: 99, hp: 1 }, { key: "guard", atk: 20, hp: 5 }], ["first-strike"]);
  const r2 = resolveRound(late.board);
  const strikerFirst = attacks(r2).find((a) => a.attacker === late.p[1].id);
  check("first-strike", "also when it steps up later", strikerFirst?.tag === "first-strike", strikerFirst);
}
{
  const run = (ups: string[]) => {
    const s = setup([{ key: "berserker", atk: 30 }], [{ key: "guard", atk: 0, hp: 4 }, { key: "bulwark", atk: 0, hp: 99 }], ups);
    return attacks(resolveRound(s.board)).find((a) => a.tag === "cleave");
  };
  const plain = run([]);
  const full = run(["cleave"]);
  check("cleave", "Overflow carries in full (26), not halved and capped", full?.damage === 26 && (plain?.damage ?? 0) < 26, [plain?.damage, full?.damage]);
}
{
  const s = setup(["guard", "bulwark"], [{ key: "striker", hp: 99 }], ["thorns"]);
  check("thorns", "Guards and Bulwarks get thorns 2", s.p[0].traits?.thorns === 2 && s.p[1].traits?.thorns === 2);
  const t = attacks(resolveRound(s.board)).find((a) => a.tag === "thorns" && a.attacker === s.p[0].id);
  check("thorns", "a hit on the Guard sends 2 back", t?.damage === 2, t);
}
{
  const s = setup(["skirmisher"], [{ key: "bulwark", hp: 99 }], ["lifesteal"]);
  check("lifesteal", "Skirmishers heal all the damage they deal", s.p[0].traits?.lifesteal === 1);
  const r = resolveRound(s.board);
  const h = heals(r).find((e) => e.unit === s.p[0].id);
  const lost = attacks(r).find((a) => a.target === s.p[0].id && a.damage > 0)?.damage;
  check("lifesteal", "and it happens in combat (what it lost, back)", !!h && h.amount === lost, [h?.amount, lost]);
}
{
  const s = setup(["guard", "bulwark", "guard", "striker"], ["guard"], ["shield-wall"]);
  check("shield-wall", "front takes 1 less, +1 per Guard/Bulwark behind (3)", s.p[0].traits?.damageReduction === 3 && !s.p[1].traits?.damageReduction, s.p.map((u) => u.traits?.damageReduction));
}
{
  // Guard 3 attack into a 14-health Bulwark: 14, 11, 8, then 5 is below half.
  const s = setup(["guard"], [{ key: "bulwark", atk: 0, hp: 14 }], ["executioner"]);
  const ex = attacks(resolveRound(s.board)).find((a) => a.attacker === s.p[0].id && a.tag === "executioner");
  check("executioner", "+4 damage against a target below half health", ex?.damage === base("guard").atk + 4, ex);
}
{
  const s = setup(["guard", "striker"], [{ key: "guard", atk: 6, hp: 99 }], ["unbreakable"]);
  const hit = attacks(resolveRound(s.board)).find((a) => a.target === s.p[0].id);
  check("unbreakable", "every unit takes 1 less per hit", hit?.damage === 5, hit);
  const k = setup([{ key: "knight", merges: KNIGHT_AT }], ["guard"], ["unbreakable", "bastion"]);
  check("unbreakable", "doesn't add to armour a unit already has (Knight + Bastion = 2)", k.p[0].traits?.damageReduction === 2 && k.p[0].traits?.minArmour === 1);
}
{
  const s = setup(["guard", "bulwark", { key: "knight", merges: KNIGHT_AT }, "sentinel", "striker"], ["guard"], ["bastion"]);
  const dr = s.p.map((u, i) => (u.traits?.damageReduction ?? 0) - (setup(["guard", "bulwark", { key: "knight", merges: KNIGHT_AT }, "sentinel", "striker"], ["guard"]).p[i].traits?.damageReduction ?? 0));
  check("bastion", "Guards, Bulwarks, Knights and Sentinels take 1 less", dr.join() === "1,1,1,1,0", dr);
}
{
  const s = setup(["striker", "berserker", "skirmisher"], ["guard"], ["bloodthirst"]);
  check("bloodthirst", "Strikers and Berserkers heal half the damage they deal", s.p[0].traits?.lifesteal === 0.5 && s.p[1].traits?.lifesteal === 0.5 && !s.p[2].traits?.lifesteal);
}
{
  const s = setup(["guard", "striker"], [{ key: "striker", atk: 6, hp: 99 }], ["spearwall"]);
  check("spearwall", "front reflects 3 and takes 1 less; not the second", s.p[0].traits?.thorns === 3 && s.p[0].traits?.damageReduction === 1 && !s.p[1].traits?.thorns);
}
{
  const s = setup(["guard", { key: "guard", hp: 2 }], [{ key: "bulwark", atk: 4, hp: 99 }], ["holdout"]);
  const r = resolveRound(s.board);
  const shared = attacks(r).filter((a) => a.target === s.p[0].id && !a.tag);
  const alone = attacks(r).filter((a) => a.target === s.p[1].id && !a.tag);
  check("holdout", "the last unit standing takes 2 less per hit", shared[0]?.damage === 4 && alone.at(-1)?.damage === 2, [shared[0]?.damage, alone.at(-1)?.damage]);
}
{
  const s = setup(["guard", "striker", "medic"], [{ key: "bulwark", atk: 99, hp: 999 }], ["last-light"]);
  const ll = buffs(resolveRound(s.board)).filter((b) => b.label === "Last light");
  check("last-light", "the last unit gets +2 attack per fallen ally", ll.reduce((n, b) => n + b.atk, 0) === 4 && ll.every((b) => b.unit === s.p[2].id), ll);
}
{
  const f = setup(["guard", "striker", "medic"], ["guard"], ["phalanx"]);
  check("phalanx", "first two units take 1 less, the third doesn't", f.p[0].traits?.damageReduction === 1 && f.p[1].traits?.damageReduction === 1 && !f.p[2].traits?.damageReduction);
}
{
  const s = setup(["guard", "medic"], ["guard"], ["undying"]);
  check("undying", "the back unit endures, the front doesn't", !!s.p[1].traits?.endure && !s.p[0].traits?.endure);
  const solo = setup([{ key: "guard", hp: 5 }], [{ key: "striker", atk: 50, hp: 999 }], ["undying"]);
  const r = resolveRound(solo.board);
  const blows = attacks(r).filter((a) => a.target === solo.p[0].id);
  check("undying", "survives the first lethal blow on 1, not the second", blows[0]?.damage === 4 && blows.length === 2, blows.map((b) => b.damage));
}
{
  const s = setup([{ key: "guard", hp: 25 }, { key: "medic", hp: 6 }], ["guard"], ["iron-curtain"]);
  check("iron-curtain", "shield of a tenth of health, at least 2", s.p[0].traits?.shield === 3 && s.p[1].traits?.shield === 2, [s.p[0].traits?.shield, s.p[1].traits?.shield]);
}

// --- Squire line -------------------------------------------------------------

{
  const sq = delta(["squire", { key: "knight", merges: KNIGHT_AT }], ["guard"], ["squires-drill"], 0);
  const kn = delta(["squire", { key: "knight", merges: KNIGHT_AT }], ["guard"], ["squires-drill"], 1);
  check("squires-drill", "+2 health to Squires, +1/+2 to Knights", sq.hp === 2 && sq.atk === 0 && kn.atk === 1 && kn.hp === 2, [sq.hp, kn.atk, kn.hp]);
}
{
  const st = createAugmentState();
  takeAugment(st, "early-knighthood", []);
  check("early-knighthood", "knighted one level earlier", knightAt(st) === KNIGHT_AT - 1, knightAt(st));
  const s = setup([{ key: "squire", merges: KNIGHT_AT - 1 }], ["guard"], ["early-knighthood"]);
  const plain = setup([{ key: "squire", merges: KNIGHT_AT - 1 }], ["guard"]);
  check("early-knighthood", "a Squire at the new level becomes a Knight", s.p[0].key === "knight" && plain.p[0].key === "squire");
}
{
  const s = setup([{ key: "knight", merges: KNIGHT_AT }, "guard", "medic"], ["guard"], ["knights-oath"]);
  const d = s.p.map((u, i) => u.atk - setup([{ key: "knight", merges: KNIGHT_AT }, "guard", "medic"], ["guard"]).p[i].atk);
  const none = delta(["guard", "medic"], ["guard"], ["knights-oath"], 0);
  check("knights-oath", "with a Knight, every other unit +1 attack; without, nothing", d.join() === "0,1,1" && none.atk === 0, [d, none.atk]);
}

// --- Epics -------------------------------------------------------------------

{
  // Three Defense, two Attack: Defense units get it.
  const row = ["striker", "guard", "bulwark", "sentinel", "berserker"];
  const d = row.map((_, i) => delta(row, ["guard"], ["legion"], i));
  check("legion", "+1/+1 to the most common class only", d.map((x) => x.atk + x.hp).join() === "0,2,2,2,0", d.map((x) => [x.atk, x.hp]));
  const tie = ["striker", "guard", "berserker", "bulwark"];
  const t = tie.map((_, i) => delta(tie, ["guard"], ["legion"], i).atk);
  check("legion", "a tie goes to the front unit's class", t.join() === "1,0,1,0", t);
}
{
  const f = delta(["guard", "striker"], ["guard"], ["champion"], 0);
  const b = delta(["guard", "striker"], ["guard"], ["champion"], 1);
  check("champion", "+3/+5 to the front unit only", f.atk === 3 && f.hp === 5 && b.atk === 0, [f.atk, f.hp, b.atk]);
}
{
  const row: U[] = [{ key: "guard", merges: 2 }, { key: "striker", merges: 4 }, { key: "medic", merges: 4 }];
  const d = row.map((_, i) => delta(row, ["guard"], ["colossus"], i));
  check("colossus", "+3/+6 to the highest level, front-most on a tie", d[1].atk === 3 && d[1].hp === 6 && d[0].atk + d[2].atk === 0, d.map((x) => [x.atk, x.hp]));
}
{
  const ids = (n: number) => ["warlord", ...OFFERED_AUGMENTS.filter((a) => !a.effect && !a.traits && !a.mods && !a.hpCostShare && a.id !== "warlord").map((a) => a.id)].slice(0, n);
  const at = (n: number) => delta(["guard"], ["guard"], ids(n), 0).atk;
  check("warlord", "+1 attack per 4 upgrades held, up to +2", at(3) === 0 && at(4) === 1 && at(8) === 2 && at(12) === 2, [at(3), at(4), at(8), at(12)]);
}
{
  const s = setup(["guard"], [{ key: "striker", atk: 9 }], ["sabotage"]);
  const plain = setup(["guard"], [{ key: "striker", atk: 9 }]);
  check("sabotage", "the enemy front loses 4 attack", plain.e[0].atk - s.e[0].atk === 4, [plain.e[0].atk, s.e[0].atk]);
  const weak = setup(["guard"], [{ key: "medic", atk: 1 }], ["sabotage"]);
  check("sabotage", "never below 0", weak.e[0].atk === 0, weak.e[0].atk);
}
{
  const s = setup([{ key: "bulwark", atk: 0, hp: 1 }, "guard"], [{ key: "berserker", atk: 99, hp: 999 }], ["living-fortress"]);
  const before = s.p[0].baseMaxHp;
  const r = resolveRound(s.board);
  settleRound(r, PLAYER, s.pAug, s.board);
  check("living-fortress", "a Bulwark that fell still fortifies", occupants(s.board, PLAYER, 0)[0].baseMaxHp > before, [before, occupants(s.board, PLAYER, 0)[0].baseMaxHp]);
}
{
  // Herald's Rally 3 behind a Guard: doubled to 6, and not again with a full Support row.
  const s = setup(["guard", "herald"], ["guard"], ["sanctum"]);
  const r = buffs(resolveRound(s.board)).find((b) => b.label === "Rally");
  check("sanctum", "support abilities count twice", r?.atk === 6, r);
  const all = setup(["medic", "herald", "warden", "acolyte", "beacon"], ["guard"], ["sanctum"]);
  check("sanctum", "doesn't stack with Sanctuary", all.p[1].traits?.rally === 6, all.p[1].traits?.rally);
}

// --- Strategy ----------------------------------------------------------------

{
  const st = createAugmentState();
  takeAugment(st, "scout", []);
  check("scout", "one extra unit reroll", unitRerollsFor(st) === UNIT_REROLLS + 1);
}
{
  const st = createAugmentState();
  takeAugment(st, "tactician", []);
  check("tactician", "4 upgrade cards", augmentOfferCount(st) === 4);
}
{
  const st = createAugmentState();
  takeAugment(st, "fusion", []);
  const merged = (ratio: number) => {
    const b = newBoard();
    insertUnit(b, PLAYER, 0, 0, mk({ key: "bulwark" }, PLAYER));
    upgradeUnit(b, PLAYER, 0, 0, "bulwark", ratio);
    return occupants(b, PLAYER, 0)[0].baseMaxHp - base("bulwark").maxHp;
  };
  check("fusion", "merges give 60% instead of 50%", mergeRatioFor(st) === 0.6 && merged(0.6) > merged(0.5), [merged(0.5), merged(0.6)]);
}
{
  const s = setup([{ key: "berserker", atk: 99, hp: 999 }, "guard"], ["guard"], ["veteran"]);
  const r = resolveRound(s.board);
  settleRound(r, PLAYER, s.pAug, s.board);
  const [front, back] = occupants(s.board, PLAYER, 0);
  check("veteran", "a unit that didn't fight gains +3 health permanently", back.baseMaxHp === base("guard").maxHp + 3 && front.baseMaxHp === 999, [front.baseMaxHp, back.baseMaxHp]);
}
{
  const s = setup([{ key: "berserker", atk: 99, hp: 999 }], ["guard"], ["field-medic"], { hp: 150 });
  const r = resolveRound(s.board);
  const healed = settleRound(r, PLAYER, s.pAug, s.board);
  check("field-medic", "recover 14 HP for a round won", healed === 14 && r.board.hp.player === 164, [healed, r.board.hp.player]);
  const t = setup([{ key: "berserker", atk: 99, hp: 999 }], ["guard"], ["field-medic"], { hp: 195 });
  const r2 = resolveRound(t.board);
  check("field-medic", "not past the starting HP", settleRound(r2, PLAYER, t.pAug, t.board) === 5 && r2.board.hp.player === 200);
}
{
  const s = setup([{ key: "berserker", atk: 10 }], [{ key: "guard", atk: 0, hp: 5 }], ["war-chest"], { hp: 150 });
  const r = resolveRound(s.board);
  check("war-chest", "a round won deals 8 extra", r.bounty === 8 && r.hpLoss === 18, [r.bounty, r.hpLoss]);
  check("war-chest", "and heals 6", settleRound(r, PLAYER, s.pAug, s.board) === 6);
}
{
  const full = delta(["guard", "guard", "guard", "guard", "guard"], ["guard"], ["full-ranks"], 0);
  const four = delta(["guard", "guard", "guard", "guard"], ["guard"], ["full-ranks"], 0);
  check("full-ranks", "+1 attack with every slot filled, not with one empty", full.atk === 1 && four.atk === 0, [full.atk, four.atk]);
  const earned: U[] = [{ key: "guard", merges: 9 }, "guard", "guard", "guard", "guard"];
  const e = delta(earned, ["guard"], ["full-ranks"], 1);
  check("full-ranks", "an earned 6th slot left empty doesn't count as full", e.atk === 0, e.atk);
}

// --- Unit upgrades -----------------------------------------------------------

{
  const s = setup(["lancer"], [{ key: "guard", atk: 0, hp: 99 }, { key: "guard", atk: 0, hp: 99 }], ["long-reach"]);
  const imp = attacks(resolveRound(s.board)).find((a) => a.tag === "pierce");
  check("long-reach", "Impale deals +3 (1 + 3)", imp?.damage === 4, imp);
}
{
  const s = setup(["lancer"], [{ key: "guard", atk: 0, hp: 99 }, { key: "guard", atk: 0, hp: 99 }, { key: "guard", atk: 0, hp: 99 }], ["skewer"]);
  const r = resolveRound(s.board);
  const first = r.ticks[0].events.filter((e): e is AttackEvent => e.type === "attack" && e.tag === "pierce");
  check("skewer", "Impale reaches one deeper (two units behind)", first.length === 2 && first[1].target === s.e[2].id, first.map((a) => a.target));
}
{
  const s = setup(["guard", "herald"], ["guard"], ["war-horn"]);
  const r = buffs(resolveRound(s.board)).find((b) => b.label === "Rally");
  check("war-horn", "Rally +3 more attack (3 + 3)", r?.atk === 6, r);
}
{
  const s = setup(["guard", "herald"], ["guard"], ["banner-of-hope"]);
  const r = buffs(resolveRound(s.board)).find((b) => b.label === "Rally");
  check("banner-of-hope", "Rally also gives that much health", r?.atk === 3 && r.hp === 3, r);
  const w = setup(["guard", "herald"], ["guard"], ["war-horn", "banner-of-hope"]);
  const rw = buffs(resolveRound(w.board)).find((b) => b.label === "Rally");
  check("banner-of-hope", "with War horn: the whole Rally (6) as health", rw?.atk === 6 && rw.hp === 6, rw);
  const wr = setup(["guard", "herald"], ["guard"], ["banner-of-hope", "war-horn"]);
  const rr = buffs(resolveRound(wr.board)).find((b) => b.label === "Rally");
  check("banner-of-hope", "whichever was taken first", rr?.hp === 6, rr);
  const capped = setup(["guard", { key: "herald", merges: 7 }], ["guard"], ["banner-of-hope"], { rules: { levelCap: 8 } });
  const rc = buffs(resolveRound(capped.board)).find((b) => b.label === "Rally");
  check("banner-of-hope", "stacks with Mastery at the match's cap (8): 6 attack, 12 health", rc?.atk === 6 && rc.hp === 12, rc);
  check("banner-of-hope", "badged on the Herald", s.p[1].auras.includes("banner-of-hope") && !s.p[0].auras.includes("banner-of-hope"));
}
{
  const s = setup([{ key: "guard", hp: 99 }, "medic"], [{ key: "striker", atk: 9, hp: 999 }], ["triage"]);
  const h = heals(resolveRound(s.board)).filter((e) => e.source === s.p[1].id);
  check("triage", "Mend heals 2 more (5), 4 times a round", h.length === 4 && h.every((e) => e.amount === 5), h.map((e) => e.amount));
}
{
  const s = setup([{ key: "guard", hp: 99 }, "medic"], [{ key: "striker", atk: 9, hp: 999 }], ["stimulant"]);
  const b = buffs(resolveRound(s.board)).filter((e) => e.label === "Stimulant");
  check("stimulant", "each Mend also gives +2 attack", b.length === 3 && b.every((e) => e.atk === 2 && e.unit === s.p[0].id), b);
}
{
  const s = setup(["guard", "warden"], ["guard"], ["thick-barrier"]);
  const b = buffs(resolveRound(s.board)).find((e) => e.label === "Barrier");
  check("thick-barrier", "Barrier shields 4 more (4 + 4)", b?.shield === 8, b);
}
{
  const s = setup(["warden", "guard"], ["guard"], ["aegis"]);
  const b = buffs(resolveRound(s.board)).find((e) => e.label === "Aegis");
  check("aegis", "a Warden at the front shields itself, 2 more (4 + 2)", b?.unit === s.p[0].id && b.shield === 6, b);
}
{
  const d = delta(["guard", "acolyte"], ["guard"], ["devotion"], 1);
  check("devotion", "+6 health to Acolytes", d.hp === 6, d.hp);
  const s = setup(["guard", "acolyte"], ["guard"], ["devotion"]);
  const gift = buffs(resolveRound(s.board)).find((e) => e.label === "Lifebond" && e.unit === s.p[0].id);
  check("devotion", "so Lifebond gives more (half of 14)", gift?.hp === 7, gift);
}
{
  const s = setup(["guard", "acolyte"], ["guard"], ["blessing"]);
  const gift = buffs(resolveRound(s.board)).find((e) => e.label === "Lifebond" && e.unit === s.p[0].id);
  check("blessing", "Lifebond also gives +3 attack", gift?.atk === 3, gift);
}
{
  const row = ["herald", "medic", "warden", "acolyte", "striker"];
  const d = [...row.map((_, i) => delta(row, ["guard"], ["choir"], i)), delta(["beacon"], ["guard"], ["choir"], 0)];
  const sup = [0, 1, 2, 3, 5].map((i) => d[i]);
  check("choir", "+1/+3 to every Support unit (Beacon too), not others", sup.every((x) => x.atk === 1 && x.hp === 3) && d[4].atk === 0, d.map((x) => [x.atk, x.hp]));
}
{
  const d = delta(["skirmisher"], ["guard"], ["duelist"], 0);
  check("duelist", "Skirmishers +1/+2 and Riposte +2", d.atk === 1 && d.hp === 2 && d.unit.traits?.riposte === 2, [d.atk, d.hp, d.unit.traits?.riposte]);
}
{
  const s = setup(["guard", "beacon", "herald"], ["guard"], ["signal-fire"]);
  check("signal-fire", "Beacon relays ×2 at level 1", s.p[1].traits?.relay === 200, s.p[1].traits?.relay);
  const r = buffs(resolveRound(s.board)).find((b) => b.label === "Rally");
  check("signal-fire", "so a 3 Rally lands as 6", r?.atk === 6, r);
}
{
  const s = setup(["sentinel"], [{ key: "striker", atk: 10, hp: 999 }], ["vengeance"]);
  check("vengeance", "Sentinels reflect 60% at level 1", s.p[0].traits?.reflect === 60);
  const back = attacks(resolveRound(s.board)).find((a) => a.tag === "thorns" && a.attacker === s.p[0].id);
  // The Striker's first blow is 10 plus its Charge.
  const raw = 10 + (s.e[0].traits?.openingBonus ?? 0);
  check("vengeance", "a hit sends 60% back", back?.damage === Math.floor(raw * 0.6), [raw, back?.damage]);
}

// --- Beacon chains -------------------------------------------------------------

{
  // Herald Rally 3 behind Beacons. One: ×1.5. Two add: ×2. Three: ×2.5.
  // Three mastered (×3 each) stop at the cap, ×3: they used to multiply (×27).
  const rally = (row: U[]) => buffs(resolveRound(setup(row, ["guard"]).board)).find((b) => b.label === "Rally")?.atk;
  const b = "beacon";
  const m: U = { key: "beacon", merges: 9 };
  const got = [rally(["guard", b, "herald"]), rally(["guard", b, b, "herald"]), rally(["guard", b, b, b, "herald"]), rally(["guard", m, m, m, "herald"])];
  check("relay-chain", "Beacons add up (3 → 5, 6, 8) and stop at ×3 (9)", got.join() === "5,6,8,9", got);
}

// --- Coverage ----------------------------------------------------------------

for (const a of OFFERED_AUGMENTS) if (!covered.has(a.id)) failures.push(`${a.id}: no check in scripts/upgrades.ts`);

if (failures.length) {
  console.log(`${failures.length} problem${failures.length === 1 ? "" : "s"} (${checks} checks):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`All ${OFFERED_AUGMENTS.length} offered upgrades and the level cap check out (${checks} checks).`);
