import { useSyncExternalStore } from "react";
import { hasAccountHint, transactAt, watchAt, writeAt } from "@pwa-games/backend-client";
import { MAX_MATCH_XP, levelOf, matchXp, rewardsAt, unlockedAt } from "../game/progression";
import type { AugmentDef } from "../game/augments";
import { accountState, onAccountChange } from "./account";

// The player's progression XP, and so which upgrades they may be dealt.
//
// XP lives on the account, at users/<uid>/duel-deck/xp. Progression is for
// accounts only: a guest (or an email account still waiting for its link)
// earns no XP and plays with the starter upgrades. "Pending" is XP an account
// earned that isn't on the server yet (offline, or auth still loading at the
// end of the match), kept on the device so nothing earned is lost.
//
// Reaching a level doesn't unlock its upgrades by itself: the player claims
// them on the progression track. The account keeps the highest level claimed
// (users/<uid>/duel-deck/claimed, absent = 1), claims go in order, and only
// claimed upgrades are dealt. Until then the ⭐ chip carries a badge.
//
// The client adds its own XP (free plan, no Cloud Functions), so the database
// rules only let it rise, by at most `MAX_MATCH_XP` a write, and only let a
// claim reach a level the stored XP has reached. That bounds a tampered
// client, which can only unlock upgrades for itself anyway.

const PENDING_KEY = "duel-deck:xp-pending";
/** The last verified account's XP and claims, so its unlocks apply before auth loads (or offline). */
const CACHE_KEY = "duel-deck:xp-cache";

function readNumber(key: string): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function readCache(): { uid: string; xp: number; claimed: number } | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    return c && typeof c.uid === "string" && typeof c.xp === "number" ? { ...c, claimed: Number(c.claimed) || 1 } : null;
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode or full storage: progress just won't outlive the page.
  }
}

export interface ProgressState {
  /**
   * Whose XP this is: a verified account's ("account"), the last one's while
   * auth loads ("loading"), or nobody's ("guest": no XP, starters only).
   */
  owner: "account" | "loading" | "guest";
  /** XP shown on the track: the account's plus anything not yet written to it (0 for a guest). */
  xp: number;
  /** The level `xp` reaches. */
  level: number;
  /** The highest level claimed, whose upgrades (and every level's below) may be dealt. 1 for a guest. */
  unlockedLevel: number;
  /** The highest level that can be claimed now: reached by the XP the server holds. */
  claimable: number;
  /** Upgrades reached but not claimed yet: the chip's badge. */
  newUpgrades: number;
}

let uid: string | null = null;
let accountXp = 0;
let accountClaimed = 1;
let pending = readNumber(PENDING_KEY);
let state: ProgressState = compute();
const listeners = new Set<() => void>();
let stopWatch: (() => void) | null = null;

function compute(): ProgressState {
  const acc = accountState();
  if (uid) return withClaims("account", accountXp, accountClaimed);
  // Signed in before and auth is still loading: trust the last account's.
  const cache = acc.status === "loading" && hasAccountHint() ? readCache() : null;
  if (cache) return withClaims("loading", cache.xp, cache.claimed);
  return { owner: "guest", xp: 0, level: 1, unlockedLevel: 1, claimable: 1, newUpgrades: 0 };
}

/** An account's state from what the server holds (`stored`) and its claimed level. */
function withClaims(owner: "account" | "loading", stored: number, claimed: number): ProgressState {
  const xp = stored + pending;
  const level = levelOf(xp).level;
  const claimable = levelOf(stored).level;
  let newUpgrades = 0;
  for (let lv = claimed + 1; lv <= level; lv++) newUpgrades += rewardsAt(lv).length;
  return { owner, xp, level, unlockedLevel: Math.min(claimed, level), claimable, newUpgrades };
}

function update() {
  state = compute();
  for (const l of listeners) l();
}

/** Follow the account: watch its XP while it's verified, and send it anything pending. */
function follow() {
  const acc = accountState();
  const next = acc.status === "signed-in" && acc.account.verified ? acc.account.uid : null;
  if (next === uid) return update();
  stopWatch?.();
  stopWatch = null;
  uid = next;
  accountXp = 0;
  accountClaimed = 1;
  if (uid) {
    const me = uid;
    const cache = readCache();
    if (cache?.uid === me) [accountXp, accountClaimed] = [cache.xp, cache.claimed];
    stopWatch = watchAt<{ xp?: number; claimed?: number }>(`users/${me}/duel-deck`, (v) => {
      if (uid !== me) return;
      accountXp = typeof v?.xp === "number" ? v.xp : 0;
      accountClaimed = typeof v?.claimed === "number" ? v.claimed : 1;
      store(CACHE_KEY, JSON.stringify({ uid: me, xp: accountXp, claimed: accountClaimed }));
      update();
    });
    void flush();
  }
  update();
}
onAccountChange(follow);

let flushing = false;
/** Add pending XP to the verified account, in steps the rules allow. */
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (uid && pending > 0) {
      const me = uid;
      const step = Math.min(pending, MAX_MATCH_XP);
      const res = await transactAt<number>(`users/${me}/duel-deck/xp`, (cur) => (cur ?? 0) + step);
      if (!res.committed || uid !== me) break;
      pending -= step;
      store(PENDING_KEY, pending > 0 ? String(pending) : null);
    }
  } catch {
    // Offline or refused: it stays pending and goes with the next match or sign-in.
  } finally {
    flushing = false;
    update();
  }
}

/** React: the player's progress (re-renders on change). */
export function useProgress(): ProgressState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/**
 * Claim every level up to `level` (claims go in order, so the levels below
 * come too). Only up to `claimable`: the rules check it against the stored XP.
 */
export async function claimTo(level: number): Promise<void> {
  const me = uid;
  if (!me || level <= accountClaimed || level > state.claimable) return;
  const before = accountClaimed;
  accountClaimed = level;
  update();
  try {
    await writeAt(`users/${me}/duel-deck/claimed`, level);
  } catch (e) {
    if (uid === me) accountClaimed = before;
    update();
    throw e;
  }
}

/** The upgrades the player may be dealt right now. */
export function unlockedUpgrades(): Set<string> {
  return unlockedAt(state.unlockedLevel);
}

/** What a finished match earned, for the result screen. */
export interface XpAward {
  gained: number;
  /** Total XP before and after. */
  from: number;
  to: number;
  /** Upgrades reached by levelling up this match, waiting to be claimed. */
  unlocked: AugmentDef[];
  /** False for a guest: nothing was earned, and `gained` is what an account would have got. */
  counts: boolean;
}

/** Award a finished match's XP (to an account; a guest earns none). The tutorial and replays never call this. */
export function awardMatch(won: boolean, startHp: number): XpAward {
  const gained = matchXp(won, startHp);
  if (state.owner === "guest") return { gained, from: 0, to: 0, unlocked: [], counts: false };
  const from = state.xp;
  pending += gained;
  store(PENDING_KEY, String(pending));
  update();
  void flush();
  const before = levelOf(from).level;
  const after = levelOf(from + gained).level;
  const unlocked: AugmentDef[] = [];
  for (let lv = before + 1; lv <= after; lv++) unlocked.push(...rewardsAt(lv));
  return { gained, from, to: from + gained, unlocked, counts: true };
}
