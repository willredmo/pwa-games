import { DEFAULT_RULES, type MatchRules } from "../game/match";
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

/**
 * The rules version both devices must share. Each device runs the round itself,
 * so two builds with different combat rules would silently disagree. Bump it
 * with every change to what 
esolveRound/
efreshForRound compute (unit
 * stats, abilities, upgrades, caps). Rooms carry it (proto); a join with a
 * different one is refused, and the lobby asks the outdated side to update.
 * Rooms from before it existed have none, which reads as 1.
 */
export const PROTOCOL = 11;

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
  /**
   * The sender's own id for this unit. Never used as an id here (it would
   * collide with ours); the receiver maps it to one local id for the whole
   * match (`unpackCommit`'s idMap), so the same unit keeps the same identity
   * round after round — the stats, poses and replays key on it.
   */
  ref?: string;
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
  /** The host's PROTOCOL (absent = 1). */
  proto?: number;
  /** The host's match settings, fixed at creation (absent: a room from before them, the defaults). */
  rules?: MatchRules;
  /** When the current match started (bumped by a rematch). */
  startedAt: number;
  /** Which match this is in the room: 1, then +1 per rematch (absent = 1). Both devices restart when it rises. */
  match?: number;
  /** Rematch requests: each player's is the match it wants to replay, so a stale request never counts. */
  rematch?: Partial<Record<Player, number>>;
  presence?: Partial<Record<Player, boolean>>;
  commits?: Partial<Record<Player, Commit>>;
  /** Set to the player who left for good; the room is then closed. */
  left?: Player;
}

export interface Session {
  code: string;
  me: Player;
  /** The room's match settings, so a rejoin after a reload rebuilds the same match. */
  rules?: MatchRules;
  /** Which match in the room this device is playing (absent = 1); see `Room.match`. */
  match?: number;
}

/** Pack one side's row and upgrades for the wire. */
export function packCommit(round: number, lanes: Unit[][], aug: AugmentState): Commit {
  return {
    round,
    lanes: lanes.map((lane) =>
      lane.map((u) => {
        const w: WireUnit = { key: u.key, baseAtk: u.baseAtk, baseMaxHp: u.baseMaxHp, merges: u.merges, ref: u.id };
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
  /**
   * The sender's unit ids → the local ids given them, kept for the match.
   * Without it every round minted new ids for the same units, and the result
   * screen counted the opponent's row anew each round (118 "enemy units").
   */
  idMap?: Map<string, string>,
): { lanes: Unit[][]; aug: AugmentState } {
  const grants: Record<string, Grant> = {};
  const lanes = Array.from({ length: laneCount }, (_, i) =>
    (c.lanes?.[i] ?? []).map((w) => {
      const u = makeUnit(w.key, side);
      if (idMap && w.ref) {
        const known = idMap.get(w.ref);
        if (known) u.id = known;
        else idMap.set(w.ref, u.id);
      }
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
      drill: a.drill ?? 0,
      grants,
    },
  };
}

// --- Rooms ----------------------------------------------------------------

export async function hostRoom(rules: MatchRules = DEFAULT_RULES): Promise<Session> {
  const me = clientId();
  const code = await createRoom(GAME, { host: me, startedAt: Date.now(), proto: PROTOCOL, rules });
  return { code, me: "p1", rules };
}

/** update-me: the room runs newer rules than this build; update-them: older. */
export type JoinError = "not-found" | "full" | "ended" | "update-me" | "update-them";

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
    const proto = cur.proto ?? 1;
    if (proto !== PROTOCOL) {
      why = proto > PROTOCOL ? "update-me" : "update-them";
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
  return { code, me: res.data.host === me ? "p1" : "p2", rules: res.data.rules ?? DEFAULT_RULES, match: res.data.match ?? 1 };
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

// --- Emotes ------------------------------------------------------------------

/**
 * The emotes a player can send, by index. Only the index goes over the wire
 * (`emotes/<p>` = { i, n }), so the rules can check it's 0-7 and nobody can
 * send text. `n` counts up, so the same emote twice still shows twice.
 */
export const EMOTES = ["👍", "👋", "😂", "😮", "😬", "🔥", "🎉", "🤝"] as const;
export interface EmoteMsg {
  i: number;
  n: number;
}
export const sendEmote = (s: Session, i: number, n: number) => quiet(setField(GAME, s.code, `emotes/${s.me}`, { i, n }));
export const watchEmotes = (s: Session, cb: (m: EmoteMsg | null) => void) =>
  watch<EmoteMsg>(GAME, s.code, `emotes/${otherPlayer(s.me)}`, cb);

// --- Rematch ------------------------------------------------------------------
//
// A rematch needs both players. Each writes `rematch/<p>` = the match number it
// wants to replay (or removes it to take the offer back). Once both requests
// name the current match, either device may start the next one — both try, in
// a transaction, and only the first changes anything: `match` goes up, the old
// commits and requests are cleared, and every device watching `match` mounts a
// fresh Game for the new number. Same room, same code, same settings.

export const matchOf = (s: Session) => s.match ?? 1;

export const askRematch = (s: Session, on: boolean) =>
  quiet(setField(GAME, s.code, `rematch/${s.me}`, on ? matchOf(s) : null));

export const watchRematch = (s: Session, cb: (r: Partial<Record<Player, number>>) => void) =>
  watch<Partial<Record<Player, number>>>(GAME, s.code, "rematch", (v) => cb(v ?? {}));

export const watchMatch = (s: Session, cb: (match: number) => void) =>
  watch<number>(GAME, s.code, "match", (v) => cb(v ?? 1));

/** Start the next match if both players have asked for one. Safe to call from both devices. */
export function startRematch(s: Session): void {
  const match = matchOf(s);
  quiet(
    transactRoom<Room>(GAME, s.code, (cur) => {
      if (!cur) return null; // not loaded yet: see transactRoom
      if (cur.left || (cur.match ?? 1) !== match) return undefined; // closed, or already started
      if (cur.rematch?.p1 !== match || cur.rematch?.p2 !== match) return undefined;
      const { commits, rematch, ...rest } = cur;
      return { ...rest, match: match + 1, startedAt: Date.now() };
    }),
  );
}

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
