// Realtime rooms for turn-based online play, on Firebase Realtime Database.
// Generic: a game picks its own room shape. Each room lives at
// rooms/<game>/<code>, where the code is a short, unambiguous join code that
// players read to each other or share as a link.
//
// No sign-in: a device is identified by a random id kept in localStorage, and
// a room is only reachable by knowing its code. The database rules
// (database.rules.json at the repo root) check the shape of every write.
//
// Firebase is loaded on first use, so games that only use this for an
// optional online mode don't pay for it up front.

import type { FirebaseOptions } from "firebase/app";
import type { Database, DatabaseReference } from "firebase/database";

export type { FirebaseOptions };

type DbModule = typeof import("firebase/database");

let options: FirebaseOptions | null = null;
let ready: Promise<{ db: Database; m: DbModule }> | null = null;

/** Set the Firebase web config. Call once at startup; nothing loads until a room is used. */
export function configure(config: FirebaseOptions): void {
  options = config;
}

function backend(): Promise<{ db: Database; m: DbModule }> {
  if (!options) throw new Error("backend-client: call configure() first");
  const config = options;
  ready ??= (async () => {
    const [{ initializeApp, getApps }, m] = await Promise.all([import("firebase/app"), import("firebase/database")]);
    const app = getApps()[0] ?? initializeApp(config);
    return { db: m.getDatabase(app), m };
  })();
  return ready;
}

const ID_KEY = "pwa-games:client-id";
let memoryId: string | null = null;

/** This device's stable id (random, kept in localStorage; per-tab if storage is blocked). */
export function clientId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = randomId(16);
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return (memoryId ??= randomId(16));
  }
}

/** Join codes avoid look-alikes (0/O, 1/I/L). */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

function randomId(n: number, chars = "abcdefghijklmnopqrstuvwxyz0123456789"): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Normalize what someone typed into a code: uppercase, letters and digits only. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

const path = (game: string, code: string, sub?: string) => `rooms/${game}/${code}${sub ? `/${sub}` : ""}`;

async function ref(game: string, code: string, sub?: string): Promise<{ r: DatabaseReference; m: DbModule }> {
  const { db, m } = await backend();
  return { r: m.ref(db, path(game, code, sub)), m };
}

/**
 * Create a room with a fresh code. `initial` is written as the room's data
 * (plus `createdAt`); retries on the rare code collision.
 */
export async function createRoom(game: string, initial: Record<string, unknown>): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomId(CODE_LENGTH, CODE_CHARS);
    const { r, m } = await ref(game, code);
    const res = await m.runTransaction(r, (cur) => (cur === null ? { ...initial, createdAt: Date.now() } : undefined));
    if (res.committed) return code;
  }
  throw new Error("Couldn't create a room. Try again.");
}

/**
 * Change a room atomically: `fn` gets the current data and returns the new
 * data, or undefined to leave it alone. Resolves to the data afterwards and
 * whether `fn`'s change was written.
 *
 * `fn` is often first called with null before the server's copy has loaded.
 * When it sees null, return null (not undefined) unless you mean to create
 * the room: writing null over a room that does exist fails the check and
 * reruns `fn` with the real data, while aborting would stop right there.
 */
export async function transactRoom<T>(
  game: string,
  code: string,
  fn: (cur: T | null) => T | null | undefined,
): Promise<{ committed: boolean; data: T | null }> {
  const { r, m } = await ref(game, code);
  const res = await m.runTransaction(r, (cur) => fn(cur as T | null));
  return { committed: res.committed, data: res.snapshot.val() as T | null };
}

/** Read a room once. */
export async function readRoom<T>(game: string, code: string): Promise<T | null> {
  const { r, m } = await ref(game, code);
  return (await m.get(r)).val() as T | null;
}

/** Overwrite one field (or nested path) of a room. */
export async function setField(game: string, code: string, field: string, value: unknown): Promise<void> {
  const { r, m } = await ref(game, code, field);
  await m.set(r, value ?? null);
}

/** Write several fields at once (keys may be nested paths like "presence/p1"). */
export async function updateRoom(game: string, code: string, fields: Record<string, unknown>): Promise<void> {
  const { r, m } = await ref(game, code);
  await m.update(r, fields);
}

/** Follow a room (or one field of it). Returns an unsubscribe function. */
export function watch<T>(game: string, code: string, field: string | undefined, cb: (value: T | null) => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void ref(game, code, field).then(({ r, m }) => {
    if (cancelled) return;
    off = m.onValue(r, (snap) => cb(snap.val() as T | null));
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

/**
 * Mark `slot` present in the room while this page is connected: the server
 * clears it on disconnect (closed tab, lost signal) and it is set again on
 * reconnect. Returns a function that leaves cleanly.
 */
export function presence(game: string, code: string, slot: string): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void backend().then(({ db, m }) => {
    if (cancelled) return;
    const me = m.ref(db, path(game, code, `presence/${slot}`));
    const conn = m.ref(db, ".info/connected");
    const off = m.onValue(conn, (snap) => {
      if (snap.val() !== true) return;
      void m.onDisconnect(me)
        .remove()
        .then(() => m.set(me, true));
    });
    stop = () => {
      off();
      void m.onDisconnect(me).cancel();
      void m.remove(me);
    };
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

/** Whether the database connection is up right now (for "reconnecting…" UI). */
export function watchConnection(cb: (connected: boolean) => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void backend().then(({ db, m }) => {
    if (cancelled) return;
    off = m.onValue(m.ref(db, ".info/connected"), (snap) => cb(snap.val() === true));
  });
  return () => {
    cancelled = true;
    off?.();
  };
}
