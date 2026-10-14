import {
  clientId,
  createRoom,
  normalizeCode,
  presence,
  readRoom,
  setField,
  transactRoom,

  watch,
} from "@pwa-games/backend-client";
import "./firebase";
import { makeUnit } from "../engine/board";
import type { Side, Unit } from "../engine/types";
import type { AugmentState, Grant } from "../game/augments";

// Online play: two devices share a room in Firebase Realtime Database at
// rooms/duel-deck/<CODE>.
//
// Duel Deck is simultaneous, not turn-based, so there is nothing to stream:
// both players build their row in private and press Battle. Each device writes
// its own committed row and upgrades, and once BOTH commits for the round are
// in, each device assembles the same board and runs `resolveRound` on it. The
// engine has no randomness (no Math.random anywhere in src/engine), so the two
// devices produce the same blows, the same deaths and the same HP loss without
// either of them being authoritative — there is no result to send.
//
// The two devices evaluate in opposite orientations: each is "player" on its
// own screen. That only works because the engine is side-symmetric, which is
// checked by `pnpm netcheck`.


export const GAME = "duel-deck";

export type Player = "p1" | "p2";
export const otherPlayer = (p: Player): Player => (p === "p1" ? "p2" : "p1");

/**
 * One unit on the wire. Only what can't be recomputed: `key` gives the name,
 * shape and classes back, and `refreshForRound` rebuilds effective stats,
 * traits and auras from the base ones. Keeping it this small also means a
 * change to how units are *displayed* can't break an in-flight match.
 */
export interface WireUnit {
  key: string;
  baseAtk: number;
  baseMaxHp: number;
  merges: number;
  /**
   * This unit's one-off augment grant (Last Stand), if it has one. It travels
   * with the body rather than in `aug.grants`, which is keyed by unit id —
   * and ids don't survive the trip (see `unpackCommit`). Sending it here means
   * no id ever crosses the wire, and a grant can't be stranded.
   */
  grant?: Grant;
}

export interface Commit {
  /** The round this row is for. A device acts only when both sides match. */
  round: number;
  /** Front-most first, lane by lane: units[lane][spot]. */
  lanes: WireUnit[][];
  /** Needed because effective stats depend on BOTH sides' upgrades. */
  aug: AugmentState;
}

export interface Room {
  host: string;
  guest?: string;
  createdAt: number;
  /** Bumped by a rematch, so both devices restart together. */
  startedAt: number;
  presence?: Partial<Record<Player, boolean>>;
  commits?: Partial<Record<Player, Commit>>;
  /** Set to the player who left for good; the room is then closed. */
  left?: Player;
}

export interface Session {
  code: string;
  me: Player;
}

/** Pack one side's row and upgrades for the wire. */
export function packCommit(round: number, lanes: Unit[][], aug: AugmentState): Commit {
  return {
    round,
    lanes: lanes.map((lane) =>
      lane.map((u) => {
        const w: WireUnit = { key: u.key, baseAtk: u.baseAtk, baseMaxHp: u.baseMaxHp, merges: u.merges };
        const grant = aug.grants?.[u.id];
        if (grant) w.grant = grant;
        return w;
      }),
    ),
    // Grants travel on the units instead, so drop the id-keyed copy.
    aug: { ...aug, grants: {} },
  };
}

/**
 * Rebuild the opponent's row and upgrades on `side`, with fresh local ids.
 *
 * Ids are minted here rather than sent because both devices number their units
 * from zero on every page load, so the opponent's "u3" would collide with our
 * own — and ids key drags, poses, playback and grants, so the collision would
 * be silent. Nothing sends an id back, so local-only ids are safe, and the
 * grants are re-keyed onto the new ids as the units are built.
 *
 * The database also drops empty arrays, absent keys and `undefined`, so every
 * field is defaulted on the way in.
 */
export function unpackCommit(
  c: Commit,
  side: Side,
  laneCount: number,
): { lanes: Unit[][]; aug: AugmentState } {
  const grants: Record<string, Grant> = {};
  const lanes = Array.from({ length: laneCount }, (_, i) =>
    (c.lanes?.[i] ?? []).map((w) => {
      const u = makeUnit(w.key, side);
      u.baseAtk = w.baseAtk;
      u.baseMaxHp = w.baseMaxHp;
      u.merges = w.merges ?? 0;
      if (w.grant) grants[u.id] = { ...w.grant, from: w.grant.from ?? [] };
      return u;
    }),
  );
  const a = c.aug ?? ({} as Partial<AugmentState>);
  return {
    lanes,
    aug: {
      active: a.active ?? [],
      momentum: a.momentum ?? 0,
      rally: a.rally ?? 0,
      kills: a.kills ?? 0,
      grants,
    },
  };
}

// --- Rooms ----------------------------------------------------------------

export async function hostRoom(): Promise<Session> {
  const me = clientId();
  const code = await createRoom(GAME, { host: me, startedAt: Date.now() });
  return { code, me: "p1" };
}

export type JoinError = "not-found" | "full" | "ended";

/** Join (or rejoin) a room by code. */
export async function joinRoom(input: string): Promise<Session | JoinError> {
  const code = normalizeCode(input);
  if (code.length !== 5) return "not-found";
  const me = clientId();
  let why: JoinError | null = null;
  const res = await transactRoom<Room>(GAME, code, (cur) => {
    if (!cur) {
      why = "not-found";
      return null; // see transactRoom: lets the server's real copy through
    }
    if (cur.left) {
      why = "ended";
      return undefined;
    }
    if (cur.host === me) return cur; // rejoining your own room
    if (cur.guest && cur.guest !== me) {
      why = "full";
      return undefined;
    }
    return { ...cur, guest: me };
  });
  if (!res.committed || !res.data) return why ?? "not-found";
  return { code, me: res.data.host === me ? "p1" : "p2" };
}

/**
 * Fire-and-forget a write. A room can disappear under a client — the host
 * closed it, or it was cleaned up — and the database then rejects every write
 * to it. Without this those surface as unhandled promise rejections in the
 * console rather than as anything the player can act on, so failures are
 * reported through `onWriteError` and the UI says the duel has ended.
 */
let onWriteError: ((e: unknown) => void) | null = null;
export const setWriteErrorHandler = (fn: ((e: unknown) => void) | null) => {
  onWriteError = fn;
};
const quiet = (p: Promise<unknown>): void => {
  void p.catch((e) => onWriteError?.(e));
};

export const readSession = (s: Session) => readRoom<Room>(GAME, s.code);
export const watchRoom = <T,>(s: Session, field: string | undefined, cb: (v: T | null) => void) =>
  watch<T>(GAME, s.code, field, cb);
export const stayPresent = (s: Session) => presence(GAME, s.code, s.me);
export const sendCommit = (s: Session, c: Commit) => quiet(setField(GAME, s.code, `commits/${s.me}`, c));
export const leaveRoom = (s: Session) => quiet(setField(GAME, s.code, "left", s.me));

// No in-room rematch yet: when a duel ends, both players go back to the title
// and host a new one. Adding it means bumping `startedAt` and clearing
// `commits` in a transaction, with both devices restarting on the new value.

// --- This device's current online game, so a reload can rejoin -------------

const SESSION_KEY = "duel-deck:online";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* no rejoin after reload; fine */
  }
}
