import {
  clientId,
  configure,
  createRoom,
  normalizeCode,
  presence,
  readRoom,
  setField,
  transactRoom,
  updateRoom,
  watch,
} from "@pwa-games/backend-client";
import { newMatch, other, setupOf, type BoardSetup, type MatchState, type Player } from "../game/match";
import type { StickLook } from "../game/stick";
import type { Launch } from "../render/table";

// Online play: two devices share a room in Firebase Realtime Database at
// rooms/knock-hockey/<CODE>. The host is Player 1 (blue, bottom of the board);
// the guest is Player 2 (the guest sees the board turned round, so their goal
// is at the bottom too).
//
// A turn goes: the shooter streams their aim (`aim`) while lining up, writes
// the exact launch (`shot`) the moment the stick swings, and once the puck
// stops writes the outcome (`result`, with the match after it). The other
// device replays the launch with the same deterministic physics, so both
// screens show the same shot; the shooter's `result` is the final word.

// Public web config: it identifies the project; the database rules guard it.
configure({
  apiKey: "AIzaSyDSy9OF5r3sJ13D3IhgEACL5oVffWm33Nk",
  authDomain: "roguelike-games.firebaseapp.com",
  databaseURL: "https://roguelike-games-default-rtdb.firebaseio.com",
  projectId: "roguelike-games",
  appId: "1:130931296377:web:6b48e09eb320de0fb62ca8",
});

export const GAME = "knock-hockey";

export interface ShotMsg extends Launch {
  /** The match's shot count after this shot (so stale messages are ignored). */
  seq: number;
  by: Player;
}

export interface ResultMsg {
  seq: number;
  match: MatchState;
  scorer?: Player;
  ownGoal?: boolean;
  bank?: boolean;
  corner?: boolean;
}

export interface AimMsg {
  by: Player;
  angle: number;
  power: number;
}

export interface Room {
  host: string;
  guest?: string;
  createdAt: number;
  presence?: Partial<Record<Player, boolean>>;
  looks?: Partial<Record<Player, StickLook>>;
  match: MatchState;
  shot?: ShotMsg;
  result?: ResultMsg;
  aim?: AimMsg;
  /** Set to the player who left for good. */
  left?: Player;
}

export interface Session {
  code: string;
  me: Player;
}

/** The database drops nulls; put back what MatchState expects. */
export function fixMatch(m: MatchState): MatchState {
  // Lists come back as arrays, or not at all when empty.
  const goals = m.goals ? Object.values(m.goals) : [];
  return { ...m, goals, winner: m.winner ?? null, mode: "online" };
}

export async function hostRoom(look: StickLook, setup: BoardSetup): Promise<Session> {
  const me = clientId();
  // The host's board setup applies to both players.
  const match = newMatch("online", "medium", setup);
  const code = await createRoom(GAME, { host: me, looks: { p1: look }, match });
  return { code, me: "p1" };
}

export type JoinError = "not-found" | "full" | "ended";

/** Join (or rejoin) a room by code. */
export async function joinRoom(input: string, look: StickLook): Promise<Session | JoinError> {
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
    return { ...cur, guest: me, looks: { ...cur.looks, p2: look } };
  });
  if (!res.committed || !res.data) return why ?? "not-found";
  return { code, me: res.data.host === me ? "p1" : "p2" };
}

export const readSession = (s: Session) => readRoom<Room>(GAME, s.code);
export const watchRoom = <T,>(s: Session, field: string | undefined, cb: (v: T | null) => void) => watch<T>(GAME, s.code, field, cb);
export const stayPresent = (s: Session) => presence(GAME, s.code, s.me);
export const sendShot = (s: Session, shot: ShotMsg) => setField(GAME, s.code, "shot", shot);
export const sendAim = (s: Session, aim: AimMsg) => setField(GAME, s.code, "aim", aim);
export const sendLook = (s: Session, look: StickLook) => setField(GAME, s.code, `looks/${s.me}`, look);
export const sendResult = (s: Session, r: ResultMsg) => updateRoom(GAME, s.code, { result: r, match: r.match, aim: null });
export const leaveRoom = (s: Session) => setField(GAME, s.code, "left", s.me);

/** Start a new match in the room after one ends; the loser goes first. */
export async function rematch(s: Session): Promise<void> {
  await transactRoom<Room>(GAME, s.code, (cur) => {
    if (!cur) return null;
    if (!cur.match?.winner) return undefined; // someone already started one
    const fresh = newMatch("online", "medium", setupOf(cur.match), other(cur.match.winner));
    // Drop the old turn's messages (the database can't store undefined).
    const { shot: _s, result: _r, aim: _a, ...rest } = cur;
    return { ...rest, match: fresh };
  });
}

// --- This device's current online game, so a reload can rejoin -------------

const SESSION_KEY = "knock-hockey:online";

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
