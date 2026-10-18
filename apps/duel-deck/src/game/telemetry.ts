import { clientId, writeAt } from "@pwa-games/backend-client";
import "../online/firebase";
import { levelOf } from "../engine/units";
import type { Unit } from "../engine/types";

// Balance telemetry: which units and upgrades players pick, and whether they
// win with them. Read with `pnpm telemetry` (scripts/telemetry.ts); anything
// older than 21 days is deleted by the prune (same script, and a daily GitHub
// Action).
//
// Layout: telemetry/duel-deck/<UTC day the match started>/<match id>/
//   meta          { v, mode, diff, at, c }
//   rounds/<n>    { offer, picks, rr, row, foe, won, hp }
//   augs/<n>      { o, t, rr, e? }
//   end           { won, rounds, hp, aug, foeAug, mvp? }
// Grouping by day makes the prune one delete per day. Every write is a new
// path, and the rules only allow creating a path, never changing one.
//
// Fire-and-forget: a failed or blocked write never reaches the match. Off in
// dev (and the sims never import this) unless the URL has ?telemetry=1, so
// testing doesn't pollute the data.

const ROOT = "telemetry/duel-deck";
const ID_KEY = "duel-deck:log";

/** A placed pick: p place, m merge, r replace; l is the unit's level after it. */
export interface PickLog {
  k: string;
  a: "p" | "m" | "r";
  l: number;
}

const enabled = (() => {
  try {
    return !import.meta.env.DEV || new URLSearchParams(location.search).has("telemetry");
  } catch {
    return false;
  }
})();

const send = (path: string, value: unknown) => {
  if (!enabled || path.startsWith("/")) return; // a MatchLog.none() log's paths start at the root
  void writeAt(`${ROOT}/${path}`, value).catch(() => {
    /* telemetry must never surface */
  });
};

/** A row as "key:level" strings, front first: compact and enough to rebuild the composition. */
export const rowLog = (units: Unit[]) => units.map((u) => `${u.key}:${levelOf(u.merges)}`);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** One match's log. Every method is safe to call more than once per key (later writes are refused). */
export class MatchLog {
  private constructor(private readonly base: string) {}

  /** A log that writes nothing (the tutorial: rigged offers would skew the data). */
  static none(): MatchLog {
    return new MatchLog("");
  }

  /**
   * The log for a CPU match: resumed from storage when continuing a save, else
   * new (and remembered, so a reload keeps writing to the same match).
   */
  static cpu(resume: boolean, difficulty: string): MatchLog {
    if (resume) {
      try {
        const saved = localStorage.getItem(ID_KEY);
        if (saved) return new MatchLog(saved);
      } catch {
        /* fall through to a new log */
      }
    }
    const at = Date.now();
    const log = new MatchLog(`${day(at)}/${randomId()}`);
    try {
      localStorage.setItem(ID_KEY, log.base);
    } catch {
      /* a reload starts a fresh log; fine */
    }
    log.meta("cpu", difficulty, at);
    return log;
  }

  /**
   * The log for one side of an online match. The id comes from the room, so a
   * reload (which rejoins the room) keeps writing to the same match. A rematch
   * in the same room gets its own (`match` > 1), or its writes would be refused.
   */
  static online(code: string, me: string, match = 1): MatchLog {
    const at = Date.now();
    const log = new MatchLog(`${day(at)}/on-${code}-${me}${match > 1 ? `-${match}` : ""}`);
    log.meta("online", "pvp", at);
    return log;
  }

  private meta(mode: string, diff: string, at: number) {
    send(`${this.base}/meta`, { v: __APP_VERSION__, mode, diff, at, c: clientId() });
  }

  round(n: number, entry: { offer: string[]; picks: PickLog[]; rr: number; row: string[]; foe: string[]; won: number; hp: [number, number] }) {
    send(`${this.base}/rounds/${n}`, entry);
  }

  /** An upgrade choice: offered (as last shown), taken, rerolls spent, and the CPU's pick that round. */
  augment(n: number, entry: { o: string[]; t: string; rr: number; e?: string }) {
    send(`${this.base}/augs/${n}`, entry);
  }

  end(entry: { won: number; rounds: number; hp: [number, number]; aug: string[]; foeAug: string[]; mvp?: string }) {
    send(`${this.base}/end`, entry);
    try {
      if (localStorage.getItem(ID_KEY) === this.base) localStorage.removeItem(ID_KEY);
    } catch {
      /* ignore */
    }
  }
}
