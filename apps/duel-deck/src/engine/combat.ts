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
/**
 * Mends per Medic per round. Uncapped, a Medic out-healed a low-attack front's
 * damage every exchange and the round ran to the tick cap as a draw.
 */
const MEND_USES = 3;

/** Round-wide tallies that persist across ticks. */
interface RoundState {
  damageDealt: Record<Side, number>;
  kills: Record<Side, number>;
  /** Whether a side has already had its first death (only that one can Last Breath). */
  firstDeathSeen: Record<Side, boolean>;
  /** Dodges each unit has used this round (Evasion). */
  dodged: Map<string, number>;
  /** Units that have made their first attack this round (Charge). */
  opened: Set<string>;
  /** Units each side has lost so far this round (Last light). */
  fallen: Record<Side, number>;
  /** Last light attack already granted to each unit this round. */
  lit: Map<string, number>;
  /** Mends each Medic has spent this round (capped at MEND_USES). */
  mends: Map<string, number>;
  /** Units whose Sanctuary has already saved them this round. */
  endured: Set<string>;
}

/** Everything one tick's blows read and write. */
interface TickCtx {
  board: Board;
  events: BattleEvent[];
  round: RoundState;
  /** HP at the start of the tick, so Executioner ignores same-tick damage. */
  startHp: Map<string, number>;
  /** Damage each unit dealt this tick, for Lifesteal. */
  dealt: Map<string, number>;
  /** Follow-up blows (cleave, thorns) held back so they emit after the main ones. */
  after: (() => void)[];
  total: number;
  /**
   * Damage swung this tick, landed or not. The stalemate guard reads this, not
   * `total`: two Evasion fronts both dodge their first hit, dealing 0, and a
   * damage-dealt check ended the round there as a draw.
   */
  attempted: number;
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

/** Living units a side has left, across every lane. */
function livingCount(board: Board, side: Side): number {
  let n = 0;
  for (const lane of board.slots[side]) for (const u of lane) if (u && u.hp > 0) n++;
  return n;
}

/** Raw damage after the target's reduction (a hit still deals at least 1). */
function reduced(raw: number, target: Unit, board: Board): number {
  // Holdout: a side's last unit standing shrugs off a little more.
  const holdout = board.mods?.[target.side]?.holdout ?? 0;
  const last = holdout > 0 && livingCount(board, target.side) === 1 ? holdout : 0;
  // Unbreakable is a floor on armour, not a bonus, so it doesn't stack with a Knight's or Bastion's.
  const dr = Math.max(target.traits?.damageReduction ?? 0, target.traits?.minArmour ?? 0) + last;
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
  /** Charge bonus folded into `raw`, recorded so playback can name it. */
  opening = 0,
): void {
  const { round, events, dealt } = ctx;
  ctx.attempted += raw;
  // Evasion: the first hit a dodger takes each round misses outright. Thorns
  // and overflow don't follow a miss.
  const used = round.dodged.get(target.id) ?? 0;
  if ((target.traits?.dodges ?? 0) > used && raw > 0 && !attacker.traits?.trueStrike) {
    round.dodged.set(target.id, used + 1);
    events.push({ type: "attack", lane, attacker: attacker.id, target: target.id, damage: 0, tag: "dodge", blocked: raw });
    // Riposte: a merged dodger answers the miss. Played back like thorns.
    const riposte = target.traits?.riposte ?? 0;
    if (riposte > 0 && tag !== "thorns") {
      ctx.after.push(() => strike(ctx, lane, target, attacker, riposte, "thorns"));
    }
    return;
  }
  let damage = reduced(raw, target, ctx.board);
  // Barrier (Warden): a shield soaks damage before health, until it's used up.
  // Counted as blocked, so playback shows it like armour.
  // What's left lives on the unit (`shieldLeft`), so tick snapshots and the
  // event carry it to the board's shield bar.
  const shield = target.shieldLeft ?? target.traits?.shield ?? 0;
  let shieldLeft: number | undefined;
  if (shield > 0 && damage > 0) {
    const soak = Math.min(shield, damage);
    damage -= soak;
    shieldLeft = shield - soak;
    target.shieldLeft = shieldLeft;
  }
  // Endure (Phoenix, Undying, Vanguard's vow): the first blow each round that
  // would kill it leaves it on 1.
  let endured = false;
  if (target.traits?.endure && target.hp > 0 && target.hp - damage <= 0 && !round.endured.has(target.id)) {
    round.endured.add(target.id);
    damage = target.hp - 1;
    endured = true;
  }
  const blocked = raw - damage;
  const hpBefore = target.hp;
  target.hp -= damage;

  round.damageDealt[attacker.side] += damage;
  dealt.set(attacker.id, (dealt.get(attacker.id) ?? 0) + damage);
  ctx.total += damage;
  if (hpBefore > 0 && target.hp <= 0) round.kills[attacker.side]++;

  const ev: AttackEvent = { type: "attack", lane, attacker: attacker.id, target: target.id, damage };
  if (tag) ev.tag = tag;
  if (blocked > 0) ev.blocked = blocked;
  if (opening > 0) ev.opening = opening;
  if (shieldLeft !== undefined) ev.shieldLeft = shieldLeft;
  if (endured) ev.endured = true;
  events.push(ev);

  // Cleave: only a main blow carries overkill on (not thorns / last breath),
  // and an Overflow blow only when it chains (a mastered Berserker).
  const isMain = !tag || tag === "first-strike" || tag === "executioner" || tag === "charge";
  const chains = tag === "cleave" && !!attacker.traits?.cleaveChain;
  if ((isMain || chains) && attacker.traits?.cleave && hpBefore > 0 && target.hp < 0) {
    // Overflow: half the overkill carries on, at most CLEAVE_MAX — the whole of
    // it made overflow a near-lock — unless the Cleave upgrade lifts the limit.
    const excess = attacker.traits.cleaveFull
      ? -target.hp
      : Math.min(attacker.traits.cleaveCap ?? CLEAVE_MAX, Math.floor(-target.hp / 2));
    ctx.after.push(() => {
      const next = nextBehind(ctx.board, target, lane);
      if (next && excess > 0) strike(ctx, lane, attacker, next, excess, "cleave");
    });
  }

  // Impale (Lancer): a landed main blow also hits the unit behind the target.
  // Queued like cleave, so it plays after the main blows; a dodge returned
  // above, so a miss doesn't impale.
  const pierce = attacker.traits?.pierce ?? 0;
  if (isMain && pierce > 0) {
    // A mastered Lancer (or Skewer) reaches deeper: each impaled unit passes it on.
    const depth = 1 + (attacker.traits?.pierceDeeper ?? 0);
    ctx.after.push(() => {
      let behind: Unit = target;
      for (let d = 0; d < depth; d++) {
        const next = nextBehind(ctx.board, behind, lane);
        if (!next) break;
        strike(ctx, lane, attacker, next, pierce, "pierce");
        behind = next;
      }
    });
  }

  // Thorns: any hit reflects, but a reflected hit never reflects again.
  const thorns = target.traits?.thorns ?? 0;
  if (thorns > 0 && tag !== "thorns") {
    ctx.after.push(() => strike(ctx, lane, target, attacker, thorns, "thorns"));
  }
  // Retaliate (Sentinel): a share of the blow's full strength goes back, so
  // the harder it's hit the more it returns. Same rule as thorns: never twice.
  const reflect = target.traits?.reflect ?? 0;
  if (reflect > 0 && tag !== "thorns") {
    const back = Math.floor((raw * reflect) / 100);
    if (back > 0) ctx.after.push(() => strike(ctx, lane, target, attacker, back, "thorns"));
  }
}

/** A front unit's blow on its opposite number, with Executioner and Charge folded in. */
function frontBlow(ctx: TickCtx, lane: number, attacker: Unit, target: Unit, firstStrike: boolean): void {
  const bonus = attacker.traits?.executioner ?? 0;
  const hurt = bonus > 0 && (ctx.startHp.get(target.id) ?? target.hp) * 2 < target.maxHp;
  // Charge: the first attack this unit makes each round hits harder.
  const opening = attacker.traits?.openingBonus ?? 0;
  // A mastered Striker charges each new enemy: the first blow per target.
  const chargeKey = attacker.traits?.chargeEach ? `${attacker.id}>${target.id}` : attacker.id;
  const charging = opening > 0 && !ctx.round.opened.has(chargeKey);
  ctx.round.opened.add(attacker.id);
  ctx.round.opened.add(chargeKey);
  const tag: AttackTag | undefined = firstStrike
    ? "first-strike"
    : charging
      ? "charge"
      : hurt
        ? "executioner"
        : undefined;
  strike(ctx, lane, attacker, target, attacker.atk + (hurt ? bonus : 0) + (charging ? opening : 0), tag, charging ? opening : 0);
}

/**
 * Death buffs (Bodyguard, Pass the torch, Last rally): each unit that fell this
 * tick boosts the ally behind it, or every living ally, for the rest of the
 * round. Runs before the dead are removed, so "behind" is still well defined.
 */
function deathBuffs(ctx: TickCtx): void {
  const { board, events } = ctx;
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      for (const dead of occupants(board, side, lane)) {
        const buff = dead.hp <= 0 ? dead.traits?.deathBuff : undefined;
        if (!buff) continue;
        const targets =
          buff.target === "allies"
            ? occupants(board, side, lane).filter((u) => u.hp > 0)
            : [nextBehind(board, dead, lane)].filter((u): u is Unit => !!u);
        for (const u of targets) {
          const atk = buff.atk ?? 0;
          const hp = buff.hp ?? 0;
          u.atk += atk;
          u.maxHp += hp;
          u.hp += hp;
          events.push({ type: "buff", unit: u.id, source: dead.id, atk, hp });
        }
      }
    }
  }
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
  // First strike is a unit's first swing of the round — at the opening, or
  // whenever it steps up to the front later. It only breaks the tie when
  // exactly one front has it ready. Decided once per pair, before any blow,
  // since swinging marks a unit as opened.
  const ready = (u: Unit) => !!u.traits?.firstStrike && !ctx.round.opened.has(u.id);
  const fast = pairs.map(({ p, e }) => {
    const pf = ready(p);
    const ef = ready(e);
    return pf === ef ? null : pf ? p : e;
  });

  pairs.forEach(({ lane, p, e }, k) => {
    const s = fast[k];
    if (s) frontBlow(ctx, lane, s, s === p ? e : p, true);
  });
  pairs.forEach(({ lane, p, e }, k) => {
    const s = fast[k];
    if (!s) {
      frontBlow(ctx, lane, p, e, false);
      frontBlow(ctx, lane, e, p, false);
    } else {
      // The slower side only answers if it survived the opening blow.
      const slow = s === p ? e : p;
      if (slow.hp > 0) frontBlow(ctx, lane, slow, s, false);
    }
  });
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

/**
 * Last light: once a side is down to one unit, that unit gains attack for
 * every ally that has fallen this round. Topped up as more fall, never twice
 * for the same loss. A buff event, so playback shows it like a death buff.
 */
function lastLight(board: Board, round: RoundState, events: BattleEvent[]): void {
  for (const side of SIDES) {
    const per = board.mods?.[side]?.lastLight ?? 0;
    if (per <= 0 || livingCount(board, side) !== 1) continue;
    const u = allUnits(board).find((x) => x.side === side && x.hp > 0);
    if (!u) continue;
    const owed = per * round.fallen[side] - (round.lit.get(u.id) ?? 0);
    if (owed <= 0) continue;
    round.lit.set(u.id, (round.lit.get(u.id) ?? 0) + owed);
    u.atk += owed;
    events.push({ type: "buff", unit: u.id, source: u.id, atk: owed, hp: 0, label: "Last light" });
  }
}

/**
 * Most a chain of Beacons can amplify a support ability, as a multiplier: one
 * mastered Beacon's ×3. Chains used to multiply (three level-1 Beacons ×3.4,
 * three mastered ×27), and three Beacons with an Acolyte behind them won
 * 97-100% of rounds against random rows of the same level, the front unit
 * gaining ~600 health at level 10 (a bug report). Now each Beacon adds its
 * bonus (the part of its Relay over ×1) and the total stops here.
 */
export const RELAY_CAP = 3;

/**
 * Where a support ability from `queue[i]` lands: the unit directly in front of
 * it. A Beacon there passes it one step further, adding its Relay's bonus, and
 * Beacons in a row chain (up to RELAY_CAP in all); one with nobody ahead
 * keeps it. Null when nothing stands in front (a support leading the row does
 * nothing). `amp` is applied once to each amount (`boost`), so a chain rounds
 * once rather than at every hop.
 */
function supportTarget(queue: Unit[], i: number): { unit: Unit; index: number; amp: number; via: string[] } | null {
  if (i <= 0) return null;
  let j = i - 1;
  let amp = 1;
  const via: string[] = [];
  while (j > 0 && (queue[j].traits?.relay ?? 0) > 0) {
    amp += queue[j].traits!.relay! / 100 - 1;
    via.push(queue[j].id);
    j--;
  }
  return { unit: queue[j], index: j, amp: Math.min(RELAY_CAP, amp), via };
}

/** An amount after a chain of Beacons: rounded once, never below what it started as. */
const boost = (n: number, amp: number) => (amp === 1 ? n : Math.max(n, Math.round(n * amp)));

/** Relay details for an event, only when Beacons were involved. */
const relayed = (t: { amp: number; via: string[] }) => (t.via.length ? { via: t.via, amp: t.amp } : {});

/**
 * Mend (Medic): each living Medic heals the living unit directly in front of
 * it (through any Beacons, amplified), up to its max HP. A Medic leading the
 * row heals itself: to help the fighting unit it has to stand right behind
 * it, so it's next in line when that unit falls. After lifesteal, so a unit's
 * own healing comes first.
 */
function mendHeals(ctx: TickCtx): void {
  const { board, events } = ctx;
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      const queue = occupants(board, side, lane).filter((u) => u.hp > 0);
      queue.forEach((u, i) => {
        const mend = u.traits?.mend ?? 0;
        if (mend <= 0) return;
        const t = supportTarget(queue, i) ?? { unit: u, index: i, amp: 1, via: [] };
        const used = ctx.round.mends.get(u.id) ?? 0;
        if (used >= MEND_USES + (u.traits?.mendMore ?? 0)) return;
        const target = t.unit;
        const gain = Math.min(boost(mend, t.amp), target.maxHp - target.hp);
        if (gain <= 0) return;
        ctx.round.mends.set(u.id, used + 1);
        target.hp += gain;
        events.push({ type: "heal", unit: target.id, amount: gain, source: u.id, ...relayed(t) });
        // Stimulant: the heal comes with a jolt of attack for the round.
        const jolt = boost(u.traits?.mendAtk ?? 0, t.amp);
        if (jolt > 0) {
          target.atk += jolt;
          events.push({ type: "buff", unit: target.id, source: u.id, atk: jolt, hp: 0, label: "Stimulant", ...relayed(t) });
        }
      });
    }
  }
}

/** One tick across all contested lanes. Adds to the round tallies in place. */function combatTick(
  board: Board,
  lanes: number[],
  events: BattleEvent[],
  round: RoundState,
): number {
  const startHp = new Map<string, number>();
  for (const u of allUnits(board)) startHp.set(u.id, u.hp);
  const ctx: TickCtx = {
    board,
    events,
    round,
    startHp,
    dealt: new Map(),
    after: [],
    total: 0,
    attempted: 0,
  };

  frontExchange(ctx, lanes);
  flushAfter(ctx); // cleave overflow, thorns
  lastBreaths(ctx);
  flushAfter(ctx); // thorns off last-breath blows
  lifestealHeals(ctx);
  mendHeals(ctx);
  deathBuffs(ctx);

  for (const u of allUnits(board)) {
    if (u.hp <= 0) events.push({ type: "death", unit: u.id, key: u.key, side: u.side });
  }
  // Remove the dead, then slide survivors forward so the next steps up.
  for (const u of allUnits(board)) if (u.hp <= 0) round.fallen[u.side]++;
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      const laneArr = board.slots[side][lane];
      for (let s = 0; s < laneArr.length; s++) {
        if (laneArr[s] && laneArr[s]!.hp <= 0) laneArr[s] = null;
      }
      compactLane(board, side, lane);
    }
  }
  lastLight(board, round, events);
  return ctx.attempted;
}

/**
 * Start-of-round support: Herald's Rally, Warden's Barrier and Acolyte's
 * Lifebond, each landing on the unit directly in front of the supporter (or
 * further, through Beacons: `supportTarget`). Applied as the round opens
 * rather than baked into the pre-round stats, so while picking every unit
 * shows its own numbers and the gift plays out as a beat before the first
 * blow. Supporters act front to back, so a gift never feeds a later one.
 * Returns the buff events, which playback shows; the board is changed in place.
 */
function openingBuffs(board: Board): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (const side of SIDES) {
    for (let lane = 0; lane < board.lanes; lane++) {
      const queue = occupants(board, side, lane);
      queue.forEach((u, i) => {
        // Aegis: the Warden shields itself too, wherever it stands.
        if (u.traits?.barrierSelf && (u.traits?.barrier ?? 0) > 0) {
          const own = u.traits.barrier!;
          u.traits = { ...u.traits, shield: (u.traits.shield ?? 0) + own };
          events.push({ type: "buff", unit: u.id, source: u.id, atk: 0, hp: 0, shield: own, label: "Aegis" });
        }
        const t = supportTarget(queue, i);
        if (!t) return;
        const target = t.unit;
        const via = relayed(t);
        const rally = u.traits?.rally ?? 0;
        if (rally > 0) {
          const atk = boost(rally, t.amp);
          const hp = boost(u.traits?.rallyHp ?? 0, t.amp);
          target.atk += atk;
          target.maxHp += hp;
          target.hp += hp;
          events.push({ type: "buff", unit: target.id, source: u.id, atk, hp, label: "Rally", ...via });
        }
        // Warden's Barrier: a shield on that unit, and on `barrierReach` more
        // ahead of it (a mastered Warden 1, Aegis +1). `traits` is shared with
        // the caller's board (cloneBoard is shallow there), so it's replaced, not mutated.
        const barrier = u.traits?.barrier ?? 0;
        if (barrier > 0) {
          const amount = boost(barrier, t.amp);
          const reach = u.traits?.barrierReach ?? 0;
          const shielded = queue.slice(Math.max(0, t.index - reach), t.index + 1).reverse();
          for (const s of shielded) {
            s.traits = { ...s.traits, shield: (s.traits?.shield ?? 0) + amount };
            events.push({ type: "buff", unit: s.id, source: u.id, atk: 0, hp: 0, shield: amount, label: "Barrier", ...via });
          }
        }
        const mult = u.traits?.lifebond ?? 0;
        const gift = mult > 0 ? Math.floor(u.maxHp / 2) : 0;
        if (gift > 0) {
          u.maxHp -= gift;
          u.hp = Math.min(u.hp, u.maxHp);
          const atk = boost(u.traits?.lifebondAtk ?? 0, t.amp);
          const hp = boost(gift * mult, t.amp);
          target.atk += atk;
          target.maxHp += hp;
          target.hp += hp;
          events.push({ type: "buff", unit: u.id, source: u.id, atk: 0, hp: -gift, label: "Lifebond" });
          events.push({ type: "buff", unit: target.id, source: u.id, atk, hp, label: "Lifebond", ...via });
        }
      });
    }
  }
  return events;
}

export function resolveRound(input: Board, opts?: { tickCap?: number }): RoundResult {
  const board = cloneBoard(input);
  const tickCap = opts?.tickCap ?? DEFAULT_TICK_CAP;
  const ticks: Tick[] = [];
  const round: RoundState = {
    damageDealt: { player: 0, enemy: 0 },
    kills: { player: 0, enemy: 0 },
    firstDeathSeen: { player: false, enemy: false },
    dodged: new Map(),
    opened: new Set(),
    fallen: { player: 0, enemy: 0 },
    lit: new Map(),
    mends: new Map(),
    endured: new Set(),
  };
  const { damageDealt, kills } = round;
  const opening = openingBuffs(board);

  for (let t = 0; t < tickCap; t++) {
    const lanes = contestedLanes(board);
    if (lanes.length === 0) break;
    const events: BattleEvent[] = [];
    const dealt = combatTick(board, lanes, events, round);
    ticks.push({ events, snapshot: cloneBoard(board) });
    if (dealt === 0) break; // stalemate guard (e.g. two 0-ATK fronts); counts swings, not landed damage
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

  // Ascendant: when both rows fall together, a side's lone champion still hits
  // the enemy pool for its attack. Without it two champions trade mutual kills
  // forever (draws deal nothing) and the match never ends.
  let ascendantHit = 0;
  if (!roundWinner && playerLeft === 0 && enemyLeft === 0) {
    for (const side of SIDES) {
      if (!input.mods?.[side]?.uncapped) continue;
      const champ = sideUnits(input, side)[0];
      const hit = Math.max(0, champ?.atk ?? 0);
      const foe = otherSide(side);
      board.hp[foe] = Math.max(0, board.hp[foe] - hit);
      ascendantHit += hit;
    }
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
    ...(ascendantHit > 0 ? { ascendantHit } : {}),
    ...(opening.length > 0 ? { opening } : {}),
    matchWinner,
  };
}
