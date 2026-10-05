import type { Board, RoundResult, Side } from "../engine/types";
import { sideUnits } from "../engine/board";

// Running tallies for the end-of-match screen. Recorded once per round from
// the round result (the same events playback shows), saved with the match so a
// reload keeps them, and reset with a new match.

/** One unit's contribution over the match. Ids survive respawns and merges. */
export interface UnitTally {
  key: string;
  name: string;
  damage: number;
  kills: number;
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
  kills: number;
  losses: number;
  biggestHit: { amount: number; key: string; name: string } | null;
  /** Unit abilities that fired on your side (Charge, Overflow, Bodyguard…). */
  abilities: number;
  healed: number;
  streak: number;
  bestStreak: number;
  units: Record<string, UnitTally>;
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
    kills: 0,
    losses: 0,
    biggestHit: null,
    abilities: 0,
    healed: 0,
    streak: 0,
    bestStreak: 0,
    units: {},
  };
}

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
  const mine = new Map(sideUnits(committed, side).map((u) => [u.id, u]));
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

  const tally = (id: string): UnitTally | null => {
    const u = mine.get(id);
    if (!u) return null;
    return (stats.units[id] ??= { key: u.key, name: u.name, damage: 0, kills: 0 });
  };
  /** Opening blows already counted as a Charge this round. */
  const charged = new Set<string>();
  for (const tick of result.ticks) {
    const dead = new Set(tick.events.flatMap((e) => (e.type === "death" ? [e.unit] : [])));
    for (const ev of tick.events) {
      if (ev.type === "death") {
        if (mine.has(ev.unit)) stats.losses++;
        continue;
      }
      if (ev.type === "buff") {
        if (mine.has(ev.source)) stats.abilities++;
        continue;
      }
      if (ev.type !== "attack") continue;
      if (mine.has(ev.target)) {
        stats.unitDamageTaken += ev.damage;
        if (ev.tag === "dodge") stats.abilities++;
        continue;
      }
      const t = tally(ev.attacker);
      if (!t) continue;
      stats.unitDamage += ev.damage;
      t.damage += ev.damage;
      if (dead.has(ev.target)) {
        // Credit the kill once, to the blow that was dealt last to that target.
        const lastBlow = [...tick.events]
          .reverse()
          .find((e) => e.type === "attack" && e.target === ev.target && e.damage > 0);
        if (lastBlow === ev) {
          t.kills++;
          stats.kills++;
        }
      }
      if (!stats.biggestHit || ev.damage > stats.biggestHit.amount) {
        stats.biggestHit = { amount: ev.damage, key: t.key, name: t.name };
      }
      if ((ev.opening ?? 0) > 0 && !charged.has(ev.attacker)) {
        charged.add(ev.attacker);
        stats.abilities++;
      }
      const src = mine.get(ev.attacker);
      if (ev.tag === "cleave" && src?.key === "berserker") stats.abilities++;
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
