import { OFFERED_AUGMENTS, getAugment, type AugmentDef } from "./augments";
import { START_HP } from "./match";

// The progression track: an account levels up by playing, and levels unlock
// upgrades. About half of each rarity is open from the start (`STARTER`); the
// rest come one or two a level up to `MAX_LEVEL`, prismatics mostly late.
//
// Pure: no storage, no account. online/progress.ts keeps the XP and decides
// whose unlocks apply (a guest only ever plays with the starters).
//
// Only the player's own offers are gated. The CPU draws from every upgrade,
// and online each device rolls its own offers, so two players with different
// unlocks need nothing synced: only the upgrades taken travel.

/** The last level; XP past it still counts, but there's nothing left to unlock. */
export const MAX_LEVEL = 30;

/** Upgrades everyone has, level 1, signed in or not. */
export const STARTER: readonly string[] = [
  // silver
  "reinforced-plating", "sharpened-edge", "adrenaline", "iron-will", "precision-strikes", "last-stand",
  "vanguards-edge", "executioner", "squires-drill", "knights-oath", "scout", "fusion", "veteran",
  "field-medic", "whetstone", "iron-skin",
  // gold
  "battle-fury", "momentum", "desperate-measures", "thorns", "bastion", "bloodthirst", "war-chest",
  "full-ranks", "choir", "phalanx", "rear-guard", "heros-mark",
  // prismatic
  "united-front", "overwhelm", "legion", "champion", "unbreakable", "sabotage", "golden-age", "juggernaut",
];

/** What each level unlocks (levels 2 to `MAX_LEVEL`). Every offered upgrade is a starter or on here, once. */
export const TRACK: Readonly<Record<number, readonly string[]>> = {
  2: ["first-strike", "lifesteal"],
  3: ["spearwall", "holdout"],
  4: ["shield-wall", "twin-fangs"],
  5: ["bloodpact"],
  6: ["duelist", "cleave"],
  7: ["last-light", "opening-salvo"],
  8: ["war-horn", "long-reach"],
  9: ["mixed-formation", "second-line"],
  10: ["drill-sergeant", "triage"],
  11: ["iron-curtain"],
  12: ["thick-barrier", "banner-of-hope"],
  13: ["berserkers-rally", "bloodbond"],
  14: ["colossus", "devotion"],
  15: ["undying", "early-knighthood"],
  16: ["warlord", "signal-fire"],
  17: ["stimulant", "skewer"],
  18: ["hawk-eye", "vengeance"],
  19: ["aegis", "blessing"],
  20: ["avalanche", "field-promotion"],
  21: ["spiked-line", "commission"],
  22: ["living-fortress", "sanctum"],
  23: ["mantis-shrimp", "tactician"],
  24: ["blood-moon"],
  25: ["mirror-shield", "heroic-legion"],
  26: ["ironclad"],
  27: ["vanguards-vow", "golden-fleece"],
  28: ["phoenix"],
  29: ["mirror-image"],
  30: ["apotheosis"],
};

const UNLOCK_LEVEL = new Map<string, number>([
  ...STARTER.map((id) => [id, 1] as const),
  ...Object.entries(TRACK).flatMap(([lv, ids]) => ids.map((id) => [id, Number(lv)] as const)),
]);

/** The level that unlocks an upgrade (1 = from the start). An upgrade on neither list is open to all. */
export const unlockLevel = (id: string): number => UNLOCK_LEVEL.get(id) ?? 1;

/** XP to go from `level` to the next: 150 at level 1, +15 a level (570 for the last). */
export const xpToNext = (level: number): number => 150 + 15 * (level - 1);

/** Where `xp` stands on the track. `into`/`need` are this level's progress (need 0 at the top). */
export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  return { level, into: level < MAX_LEVEL ? left : 0, need: level < MAX_LEVEL ? xpToNext(level) : 0 };
}

/** The ids a player at `level` may be offered. */
export function unlockedAt(level: number): Set<string> {
  return new Set(OFFERED_AUGMENTS.filter((a) => unlockLevel(a.id) <= level).map((a) => a.id));
}

/** The upgrades a level unlocks, as definitions. */
export const rewardsAt = (level: number): AugmentDef[] =>
  (TRACK[level] ?? []).map((id) => getAugment(id)).filter((a): a is AugmentDef => !!a);

/** XP for a finished match, before the starting-health scale. Wins earn more. */
export const XP_PLAYED = 60;
export const XP_WON = 150;
/** The most one match can award (999 starting health, a win), which the database rules also cap. */
export const MAX_MATCH_XP = 750;

/**
 * XP for a finished match: more for a win, scaled by the starting health
 * (a 300-health match runs longer than a 100 one, so it earns more). At least 10.
 */
export function matchXp(won: boolean, startHp: number): number {
  const base = won ? XP_WON : XP_PLAYED;
  return Math.min(MAX_MATCH_XP, Math.max(10, Math.round((base * startHp) / START_HP)));
}
