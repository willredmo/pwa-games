import type { Board, RoundResult, Side } from "../engine/types";
import { countBerserkerDeaths, getAugment, hasAugment, type AugmentState } from "./augments";
import { START_HP } from "./match";

// Round-end bookkeeping for one side's augments (Momentum stacks, Rally deaths,
// Overwhelm kills, Veteran growth). Shared by App and the balance sim so the two
// can't drift.


/** Permanent health a Veteran unit gains for each round it sat out. */
const VETERAN_HP = 3;
/**
 * Update `state` after a round, and apply permanent growth to `committed` (the
 * pre-combat roster the next round is rebuilt from). Mutates both arguments,
 * and `result.board.hp` for Field medic. Returns the pool HP healed.
 *  - Momentum: +1 if `side` won the round and holds Momentum.
 *  - Berserker's rally: add this side's Berserker deaths if held.
 *  - kills: enemies `side` killed this round (read by Overwhelm next round).
 *  - Veteran: units of `side` in `committed` that never appear as attacker or
 *    target in any attack event gain VETERAN_HP baseMaxHp.
 */
export function settleRound(
  result: RoundResult,
  side: Side,
  state: AugmentState,
  committed: Board,
): number {
  if (result.roundWinner === side && hasAugment(state, "momentum")) state.momentum += 1;
  const events = result.ticks.flatMap((t) => t.events);
  if (hasAugment(state, "berserkers-rally")) {
    state.rally += countBerserkerDeaths(events, side);
  }
  state.kills = result.kills?.[side] ?? 0;

  if (hasAugment(state, "veteran")) {
    const fought = new Set<string>();
    for (const e of events) {
      if (e.type === "attack") {
        fought.add(e.attacker);
        fought.add(e.target);
      }
    }
    for (const lane of committed.slots[side]) {
      for (const u of lane) if (u && !fought.has(u.id)) u.baseMaxHp += VETERAN_HP;
    }
  }

  // Heal-on-win (Field medic, War chest): winning a round patches the side's
  // own pool back up. Applied to the round result's HP, which is what the next
  // round carries forward.
  let healed = 0;
  const heal = state.active.reduce((sum, id) => sum + (getAugment(id)?.healOnWin ?? 0), 0);
  if (result.roundWinner === side && heal > 0 && !result.matchWinner) {
    const hp = result.board.hp[side];
    healed = Math.max(0, Math.min(heal, START_HP - hp));
    result.board.hp[side] = hp + healed;
  }
  return healed;
}
