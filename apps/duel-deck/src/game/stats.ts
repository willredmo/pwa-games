import type { Board, RoundResult, Side, Unit } from "../engine/types";
import { sideUnits } from "../engine/board";

// Running tallies for the end-of-match screen. Recorded once per round from
// the round result (the same events playback shows), saved with the match so a
// reload keeps them, and reset with a new match.

/** One unit's contribution over the match. Ids survive respawns and merges. */
export interface UnitTally {
  /** Type and name as of its latest round, so a knighted Squire reads as a Knight. */
  key: string;
  name: string;
  /** Merges as of its latest round, for its level. Absent in older saves. */
  merges?: number;
  damage: number;
  kills: number;
  /** Damage it took in fights. Absent in older saves (read as 0). */
  taken?: number;
  /** Times it fell. */
  falls?: number;
  /** Damage it blocked: armour, shields and dodges. Absent in older saves. */
  blocked?: number;
  /** Health it restored: its Mends, and its own lifesteal. Absent in older saves. */
  healing?: number;
  /** Rounds it was on the committed row. */
  rounds?: number;
  /**
   * The round count when it was last on the row. Lower than the match's
   * rounds means it left: merged into another unit or replaced.
   */
  last?: number;
}

export interface MatchStats {
  won: number;
  lost: number;
  drawn: number;
  /** HP taken off each pool by round results. */
  poolDealt: number;
  poolTaken: number;
  /** Damage your units dealt / took in fights. */
  unitDamage: number;
  unitDamageTaken: number;
  /** Damage your units blocked, and health they restored (absent in older saves). */
  unitBlocked?: number;
  unitHealing?: number;
  kills: number;
  losses: number;
  biggestHit: { amount: number; key: string; name: string } | null;
  /** Unit abilities that fired on your side (Charge, Overflow, Bodyguard…). */
  abilities: number;
  healed: number;
  streak: number;
  bestStreak: number;
  /** Your units, by id. */
  units: Record<string, UnitTally>;
  /** The opponent's units, by id, for the result screen's enemy tab. Absent in older saves. */
  foes?: Record<string, UnitTally>;
}

export function emptyStats(): MatchStats {
  return {
    won: 0,
    lost: 0,
    drawn: 0,
    poolDealt: 0,
    poolTaken: 0,
    unitDamage: 0,
    unitDamageTaken: 0,
    unitBlocked: 0,
    unitHealing: 0,
    kills: 0,
    losses: 0,
    biggestHit: null,
    abilities: 0,
    healed: 0,
    streak: 0,
    bestStreak: 0,
    units: {},
    foes: {},
  };
}

/** Rounds played so far (the round counter tallies' `last` is compared against). */
export const roundsPlayed = (s: MatchStats) => s.won + s.lost + s.drawn;

/**
 * Add one round to `stats`, from `side`'s point of view. `committed` is the
 * pre-combat roster (every unit alive), used to tell whose unit an id is.
 */
export function recordRound(
  stats: MatchStats,
  result: RoundResult,
  committed: Board,
  side: Side,
  healed: number,
): void {
  const foeSide: Side = side === "player" ? "enemy" : "player";
  const mine = new Map(sideUnits(committed, side).map((u) => [u.id, u]));
  const theirs = new Map(sideUnits(committed, foeSide).map((u) => [u.id, u]));
  if (result.roundWinner === side) {
    stats.won++;
    stats.poolDealt += result.hpLoss;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  } else if (result.roundWinner) {
    stats.lost++;
    stats.poolTaken += result.hpLoss;
    stats.streak = 0;
  } else {
    stats.drawn++;
    stats.streak = 0;
  }
  stats.healed += healed;
  const round = roundsPlayed(stats);
  const foes = (stats.foes ??= {});

  // Every unit on either row gets a tally, fighting or not, kept current:
  // units change between rounds (merges, knighthood).
  const touch = (book: Record<string, UnitTally>, u: Unit) => {
    const t = (book[u.id] ??= { key: u.key, name: u.name, damage: 0, kills: 0 });
    t.key = u.key;
    t.name = u.name;
    t.merges = u.merges;
    t.rounds = (t.rounds ?? 0) + 1;
    t.last = round;
  };
  for (const u of mine.values()) touch(stats.units, u);
  for (const u of theirs.values()) touch(foes, u);
  const tally = (id: string): UnitTally | undefined => stats.units[id] ?? (theirs.has(id) ? foes[id] : undefined);

  /** Opening blows already counted as a Charge this round. */
  const charged = new Set<string>();
  // Rally, Barrier and Lifebond fire as the round opens, before the first tick.
  for (const ev of result.opening ?? []) if (ev.type === "buff" && mine.has(ev.source)) stats.abilities++;
  for (const tick of result.ticks) {
    const dead = new Set(tick.events.flatMap((e) => (e.type === "death" ? [e.unit] : [])));
    for (const ev of tick.events) {
      if (ev.type === "death") {
        if (mine.has(ev.unit)) stats.losses++;
        const t = mine.has(ev.unit) || theirs.has(ev.unit) ? tally(ev.unit) : undefined;
        if (t) t.falls = (t.falls ?? 0) + 1;
        continue;
      }
      if (ev.type === "buff") {
        if (mine.has(ev.source)) stats.abilities++;
        continue;
      }
      // A Medic's Mend (lifesteal heals carry no source: the unit healed itself).
      if (ev.type === "heal") {
        if (ev.source && mine.has(ev.source)) stats.abilities++;
        const healer = ev.source ?? ev.unit;
        const h = mine.has(healer) || theirs.has(healer) ? tally(healer) : undefined;
        if (h) h.healing = (h.healing ?? 0) + ev.amount;
        if (mine.has(healer)) stats.unitHealing = (stats.unitHealing ?? 0) + ev.amount;
        continue;
      }
      if (ev.type !== "attack") continue;

      // Per-unit, both sides: damage dealt, damage taken, the killing blow.
      const a = tally(ev.attacker);
      const d = tally(ev.target);
      if (a) a.damage += ev.damage;
      if (d) d.taken = (d.taken ?? 0) + ev.damage;
      if (d && ev.blocked) d.blocked = (d.blocked ?? 0) + ev.blocked;
      const killing =
        dead.has(ev.target) &&
        [...tick.events].reverse().find((e) => e.type === "attack" && e.target === ev.target && e.damage > 0) === ev;
      if (a && killing) a.kills++;

      // Side-wide figures, from `side`'s point of view (unchanged).
      if (mine.has(ev.target)) {
        stats.unitDamageTaken += ev.damage;
        stats.unitBlocked = (stats.unitBlocked ?? 0) + (ev.blocked ?? 0);
        if (ev.tag === "dodge") stats.abilities++;
        continue;
      }
      if (!mine.has(ev.attacker)) continue;
      stats.unitDamage += ev.damage;
      if (killing) stats.kills++;
      const t = stats.units[ev.attacker];
      if (!stats.biggestHit || ev.damage > stats.biggestHit.amount) {
        stats.biggestHit = { amount: ev.damage, key: t.key, name: t.name };
      }
      if ((ev.opening ?? 0) > 0 && !charged.has(ev.attacker)) {
        charged.add(ev.attacker);
        stats.abilities++;
      }
      if (ev.tag === "cleave" && mine.get(ev.attacker)?.key === "berserker") stats.abilities++;
      // Impale, and Riposte / Retaliate (thorns from an upgrade aren't an ability).
      const src = mine.get(ev.attacker);
      if (ev.tag === "pierce" || (ev.tag === "thorns" && (src?.traits?.riposte || src?.traits?.reflect))) stats.abilities++;
    }
  }
  // Fortify: surviving Bulwarks.
  for (const u of sideUnits(result.board, side)) if (u.traits?.growOnSurvive) stats.abilities++;
}

/** The unit that did the most damage this match, if any fought. */
export function mvpOf(stats: MatchStats): UnitTally | null {
  let best: UnitTally | null = null;
  for (const t of Object.values(stats.units)) {
    if (!best || t.damage > best.damage || (t.damage === best.damage && t.kills > best.kills)) best = t;
  }
  return best && best.damage > 0 ? best : null;
}
