import { OFFER_KEYS, UNITS } from "../engine/units";
import { OFFERED_AUGMENTS, getAugment } from "./augments";
import { START_HP } from "./match";
import type { Look } from "./save";

// The progression track: an account levels up by playing, and each level
// unlocks one thing: an upgrade, a unit or a battle style. Some of each is
// open from the start (`STARTER`, `STARTER_UNITS`, Normal style); the rest
// come one a level up to `MAX_LEVEL`. Units unlock weakest first, by how real
// players' rows holding them did (telemetry, 2026-11-01), Sentinel last;
// an upgrade built around a unit comes after that unit.
//
// Pure: no storage, no account. online/progress.ts keeps the XP and decides
// whose unlocks apply (a guest only ever plays with the starters).
//
// Only the player's own offers are gated. The CPU draws from every unit and
// upgrade, and online each device rolls its own offers, so two players with
// different unlocks need nothing synced: only what's taken travels.

/** The last level; XP past it still counts, but there's nothing left to unlock. */
export const MAX_LEVEL = 64;

/** Upgrades everyone has, level 1, signed in or not (dealt once their unit is unlocked, see `NEEDS`). */
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

/** One unit of each class, open from the start. */
export const STARTER_UNITS: readonly string[] = ["striker", "guard", "warden"];

/** A level's reward. */
export type Reward = { kind: "upgrade"; id: string } | { kind: "unit"; id: string } | { kind: "style"; id: Look };

const up = (id: string): Reward => ({ kind: "upgrade", id });
const unit = (id: string): Reward => ({ kind: "unit", id });
const style = (id: Look): Reward => ({ kind: "style", id });

/**
 * What each level unlocks (2 to `MAX_LEVEL`, one each). Every offered upgrade
 * is a starter or on here once, and every offered unit and style too.
 */
export const TRACK: Readonly<Record<number, Reward>> = {
  2: up("first-strike"),
  3: unit("skirmisher"),
  4: up("lifesteal"),
  5: up("spearwall"),
  6: style("kawaii"),
  7: up("holdout"),
  8: unit("lancer"),
  9: up("shield-wall"),
  10: up("twin-fangs"),
  11: up("duelist"),
  12: up("bloodpact"),
  13: unit("medic"),
  14: up("long-reach"),
  15: up("last-light"),
  16: style("bloody"),
  17: up("opening-salvo"),
  18: unit("bulwark"),
  19: up("triage"),
  20: up("mixed-formation"),
  21: up("second-line"),
  22: up("drill-sergeant"),
  23: unit("berserker"),
  24: up("cleave"),
  25: up("iron-curtain"),
  26: up("thick-barrier"),
  27: up("berserkers-rally"),
  28: up("bloodbond"),
  29: unit("herald"),
  30: up("war-horn"),
  31: up("colossus"),
  32: up("undying"),
  33: up("warlord"),
  34: up("banner-of-hope"),
  35: unit("beacon"),
  36: up("stimulant"),
  37: up("skewer"),
  38: up("signal-fire"),
  39: up("hawk-eye"),
  40: up("aegis"),
  41: unit("squire"),
  42: up("early-knighthood"),
  43: up("avalanche"),
  44: up("field-promotion"),
  45: up("living-fortress"),
  46: up("spiked-line"),
  47: up("commission"),
  48: unit("acolyte"),
  49: up("devotion"),
  50: up("blessing"),
  51: up("sanctum"),
  52: up("mantis-shrimp"),
  53: up("tactician"),
  54: up("blood-moon"),
  55: up("mirror-shield"),
  56: unit("sentinel"),
  57: up("heroic-legion"),
  58: up("vengeance"),
  59: up("ironclad"),
  60: up("vanguards-vow"),
  61: up("golden-fleece"),
  62: up("phoenix"),
  63: up("mirror-image"),
  64: up("apotheosis"),
};

/**
 * Upgrades that only do anything for certain units: not dealt until one of
 * them is unlocked, whatever their own level (so a starter like Adrenaline
 * waits for the Berserker).
 */
export const NEEDS: Readonly<Record<string, readonly string[]>> = {
  adrenaline: ["berserker"],
  "iron-will": ["bulwark"],
  "squires-drill": ["squire"],
  "knights-oath": ["squire"],
  "early-knighthood": ["squire"],
  lifesteal: ["skirmisher"],
  duelist: ["skirmisher"],
  cleave: ["berserker"],
  "berserkers-rally": ["berserker"],
  "living-fortress": ["bulwark"],
  "long-reach": ["lancer"],
  skewer: ["lancer"],
  "war-horn": ["herald"],
  "banner-of-hope": ["herald"],
  triage: ["medic"],
  stimulant: ["medic"],
  devotion: ["acolyte"],
  blessing: ["acolyte"],
  "signal-fire": ["beacon"],
  vengeance: ["sentinel"],
};

const LISTED = new Map<string, number>([
  ...STARTER.map((id) => [`upgrade:${id}`, 1] as const),
  ...STARTER_UNITS.map((id) => [`unit:${id}`, 1] as const),
  ["style:normal", 1] as const,
  ...Object.entries(TRACK).map(([lv, r]) => [`${r.kind}:${r.id}`, Number(lv)] as const),
]);

/** The level that unlocks a unit (1 = from the start). A Knight comes with the Squire. */
export const unitUnlockLevel = (key: string): number => LISTED.get(`unit:${key === "knight" ? "squire" : key}`) ?? 1;

/** The level that unlocks a battle style. */
export const styleUnlockLevel = (look: Look): number => LISTED.get(`style:${look}`) ?? 1;

/**
 * The level from which an upgrade can be dealt (1 = from the start): its own
 * level, or its unit's if that comes later (`NEEDS`). An upgrade on no list is open to all.
 */
export const unlockLevel = (id: string): number => {
  const own = LISTED.get(`upgrade:${id}`) ?? 1;
  const needs = NEEDS[id];
  return needs ? Math.max(own, Math.min(...needs.map(unitUnlockLevel))) : own;
};

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

/** The upgrade ids a player who has claimed up to `level` may be offered. */
export function unlockedAt(level: number): Set<string> {
  return new Set(OFFERED_AUGMENTS.filter((a) => unlockLevel(a.id) <= level).map((a) => a.id));
}

/** The unit types such a player may be offered. */
export const unitsAt = (level: number): string[] => OFFER_KEYS.filter((k) => unitUnlockLevel(k) <= level);

/** A level's rewards (one, or none for level 1 and past the top). */
export const rewardsAt = (level: number): Reward[] => (TRACK[level] ? [TRACK[level]] : []);

const STYLE_INFO: Record<Look, { icon: string; name: string; description: string }> = {
  normal: { icon: "⚔️", name: "Normal style", description: "The standard look." },
  kawaii: {
    icon: "🌸",
    name: "Kawaii style",
    description: "Your units turn pink and cute, the battle goes uwu, and nobody dies: they hop away happy. Pick it in Style.",
  },
  bloody: {
    icon: "🩸",
    name: "Bloody style",
    description: "Hits bleed, wounds show as health falls, and defeated units are torn apart. Pick it in Style.",
  },
};

/** How a reward is shown: icon, name, what it does, and a tone (rarity for upgrades). */
export function rewardInfo(r: Reward): { icon: string; name: string; description: string; tone: string } {
  if (r.kind === "upgrade") {
    const a = getAugment(r.id);
    return { icon: a?.icon ?? "⬆", name: a?.name ?? r.id, description: a?.description ?? "", tone: a?.rarity ?? "silver" };
  }
  if (r.kind === "style") return { ...STYLE_INFO[r.id], tone: "style" };
  const u = UNITS[r.id];
  return {
    icon: "🆕",
    name: `${u.name} unit`,
    description: `${u.atk}⚔ ${u.maxHp}♥${u.ability ? ` · ${u.ability.name}: ${u.ability.text}` : ""}${r.id === "squire" ? " Grows into a Knight." : ""}`,
    tone: "unit",
  };
}

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
