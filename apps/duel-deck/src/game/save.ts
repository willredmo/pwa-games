import { reserveUnitIds } from "../engine/board";
import type { Board } from "../engine/types";
import type { AugmentState } from "./augments";
import type { Difficulty } from "./match";
import type { MatchStats } from "./stats";

// The saved match, and the settings that outlive it.
//
// Lives here rather than in the match component because the title screen reads
// the save too — it needs the round and difficulty for its Continue button
// without mounting the game. Only matches against the CPU are saved; an online
// match is rejoined through the room instead (online/room.ts), since the
// opponent's row is the server's copy, not ours to restore.

const MATCH_KEY = "duel-deck:match";
/** Bump when the saved shape changes — older saves are then ignored. */
const SAVE_VERSION = 6;

export interface SavedMatch {
  version: number;
  board: Board;
  round: number;
  offer: string[];
  player: AugmentState;
  enemy: AugmentState;
  /**
   * The round opens with an upgrade choice that hasn't been made yet. Saved so
   * a reload lands back on the choice instead of skipping it.
   */
  augmentPending?: boolean;
  /** Enemy AI difficulty, fixed once the first round is committed. */
  difficulty?: Difficulty;
  /** Running tallies for the end-of-match screen. */
  stats?: MatchStats;
  /** Unit-offer slots frozen to carry into the next round. */
  frozen?: number[];
}

export function loadMatch(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedMatch;
    if (s.version !== SAVE_VERSION || !s.board || !s.player || !s.enemy) return null;
    if (!Number.isInteger(s.round) || !Array.isArray(s.offer)) return null;
    reserveUnitIds(s.board);
    return s;
  } catch {
    return null; // corrupt or storage disabled — start fresh
  }
}

export function saveMatch(s: Omit<SavedMatch, "version">) {
  try {
    localStorage.setItem(MATCH_KEY, JSON.stringify({ ...s, version: SAVE_VERSION }));
  } catch {
    /* not persisting is fine — the match still plays */
  }
}

export function clearMatch() {
  try {
    localStorage.removeItem(MATCH_KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

// --- Settings -------------------------------------------------------------

const SETTINGS_KEY = "duel-deck:settings";

/** Battle playback speeds, cycled by the HUD button in this order. */
export const SPEEDS = [1, 2, 3] as const;
export type Speed = (typeof SPEEDS)[number];

export interface Settings {
  /** Opponent chosen on the title screen; carried into the next match. */
  difficulty: Difficulty;
  /** Battle playback multiplier. */
  speed: Speed;
  sound: boolean;
}

const DEFAULTS: Settings = { difficulty: "normal", speed: 1, sound: true };

/**
 * Read the saved settings, falling back per field so a partial or older blob
 * still yields a usable set. Migrates the two keys these used to live under.
 */
export function loadSettings(): Settings {
  const read = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  let saved: Partial<Settings> & { fast?: boolean } = {};
  try {
    saved = JSON.parse(read(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
  } catch {
    saved = {};
  }
  // Speed used to be a boolean ("fast", meaning 3×), in this blob and before
  // that in its own key. Both read as the top speed rather than resetting
  // someone who had it on back to 1×.
  const legacyFast = saved.fast ?? read("duel-deck:fast") === "1";
  const speed = SPEEDS.includes(saved.speed as Speed) ? (saved.speed as Speed) : legacyFast ? 3 : DEFAULTS.speed;
  return {
    difficulty: saved.difficulty ?? (read("duel-deck:difficulty") as Difficulty | null) ?? DEFAULTS.difficulty,
    speed,
    sound: saved.sound ?? DEFAULTS.sound,
  };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* settings just won't persist */
  }
}
