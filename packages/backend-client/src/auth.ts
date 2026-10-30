// Optional player accounts, on Firebase Authentication: Google, and email +
// password with the address confirmed by Firebase's own verification link.
//
// Accounts are optional and guests are the default, so this never loads for
// someone who hasn't signed in: firebase/auth is fetched only when a game opens
// its account screen (watchAccount) or when this device signed in before
// (hasAccountHint, a flag kept beside the client id). A guest's game behaves
// exactly as it did before accounts existed.
//
// Google sign-in in an installed iOS web app: a popup opens in a sheet that
// can't post its result back, so standalone iOS uses a redirect (Google's page
// and back). For the redirect to keep its state under Safari's storage
// partitioning, the game's Firebase config must use the game's own Hosting
// domain as `authDomain` (Hosting serves /__/auth/ on every site), and the
// service worker must not answer /__/ navigations with the app shell.

import type { Auth, User } from "firebase/auth";
import { emulatorConfig, firebaseApp } from "./index";

type AuthModule = typeof import("firebase/auth");

export interface Account {
  uid: string;
  email: string | null;
  /** Display name: Google's, or what was typed when the account was made. */
  name: string | null;
  provider: "google" | "password" | "other";
  /** Email confirmed. Google accounts always are; email ones once the link is opened. */
  verified: boolean;
}

/** "1" while this device is signed in; "redirect" while a Google redirect is under way. */
const HINT_KEY = "pwa-games:account";

function hint(): string | null {
  try {
    return localStorage.getItem(HINT_KEY);
  } catch {
    return null;
  }
}

function setHint(v: string | null): void {
  try {
    if (v) localStorage.setItem(HINT_KEY, v);
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* storage blocked: accounts then last for the page */
  }
}

/** Whether this device was signed in (or mid-sign-in) last time, so auth is worth loading at startup. */
export function hasAccountHint(): boolean {
  return hint() !== null;
}

/** Whether this page load is the return from a Google redirect (finishGoogleRedirect has the result). */
export function googleRedirectPending(): boolean {
  return hint() === "redirect";
}

let ready: Promise<{ auth: Auth; m: AuthModule }> | null = null;

function authBackend(): Promise<{ auth: Auth; m: AuthModule }> {
  ready ??= (async () => {
    const [app, m] = await Promise.all([firebaseApp(), import("firebase/auth")]);
    const auth = m.getAuth(app);
    const emu = emulatorConfig();
    if (emu) m.connectAuthEmulator(auth, `http://${emu.host}:${emu.auth}`, { disableWarnings: true });
    return { auth, m };
  })();
  return ready;
}

function toAccount(u: User): Account {
  const ids = u.providerData.map((p) => p.providerId);
  return {
    uid: u.uid,
    email: u.email,
    name: u.displayName,
    provider: ids.includes("google.com") ? "google" : ids.includes("password") ? "password" : "other",
    verified: u.emailVerified,
  };
}

/**
 * Follow the signed-in account (null = guest). Loads Firebase Auth. Fires
 * once with the current state, then on sign-in, sign-out and verification.
 */
export function watchAccount(cb: (account: Account | null) => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void authBackend().then(({ auth, m }) => {
    if (cancelled) return;
    // Token changes, not just sign-in/out: confirming an email refreshes the
    // token (checkVerified), and that's how `verified` reaches the game.
    off = m.onIdTokenChanged(auth, (u) => {
      if (hint() !== "redirect") setHint(u ? "1" : null);
      cb(u ? toAccount(u) : null);
    });
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

/**
 * After a Google redirect, collect its result. Resolves to the account (or
 * null if there was no redirect) and rejects with the sign-in error.
 */
export async function finishGoogleRedirect(): Promise<Account | null> {
  if (hint() !== "redirect") return null;
  const { auth, m } = await authBackend();
  try {
    const res = await m.getRedirectResult(auth);
    return res ? toAccount(res.user) : null;
  } finally {
    setHint(auth.currentUser ? "1" : null);
  }
}

/** Whether Google sign-in should leave the page rather than open a popup (installed iOS app). */
export function prefersRedirect(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iosStandalone || (ios && matchMedia("(display-mode: standalone)").matches);
}

/**
 * Sign in (or sign up) with Google. A popup where that works, falling back to
 * a redirect if the popup is blocked; a redirect leaves the page, and the
 * result is collected by finishGoogleRedirect on the way back.
 */
export async function signInWithGoogle(opts: { redirect?: boolean } = {}): Promise<Account | null> {
  const { auth, m } = await authBackend();
  const provider = new m.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const redirect = async () => {
    setHint("redirect");
    await m.signInWithRedirect(auth, provider);
    return null;
  };
  if (opts.redirect ?? prefersRedirect()) return redirect();
  try {
    return toAccount((await m.signInWithPopup(auth, provider)).user);
  } catch (e) {
    if (errorCode(e) === "auth/popup-blocked") return redirect();
    throw e;
  }
}

/** Where the verification link's Continue button leads: back to this page. */
function continueUrl(): { url: string } {
  return { url: location.origin + location.pathname };
}

/** Create an email account and send the verification link. */
export async function createEmailAccount(email: string, password: string, name?: string): Promise<Account> {
  const { auth, m } = await authBackend();
  const { user } = await m.createUserWithEmailAndPassword(auth, email.trim(), password);
  const trimmed = name?.trim();
  if (trimmed) await m.updateProfile(user, { displayName: trimmed.slice(0, 40) });
  await m.sendEmailVerification(user, continueUrl());
  return toAccount(user);
}

export async function signInWithEmail(email: string, password: string): Promise<Account> {
  const { auth, m } = await authBackend();
  return toAccount((await m.signInWithEmailAndPassword(auth, email.trim(), password)).user);
}

/** Send the verification link again. */
export async function resendVerification(): Promise<void> {
  const { auth, m } = await authBackend();
  if (auth.currentUser) await m.sendEmailVerification(auth.currentUser, continueUrl());
}

/**
 * Ask the server whether the email has been confirmed yet (the link is opened
 * elsewhere, usually in another browser, so nothing tells this page). Once it
 * has, the token is refreshed so database rules see `email_verified`, and
 * watchAccount fires with `verified: true`.
 */
export async function checkVerified(): Promise<boolean> {
  const { auth } = await authBackend();
  const u = auth.currentUser;
  if (!u) return false;
  if (u.emailVerified) return true;
  await u.reload();
  if (u.emailVerified) await u.getIdToken(true);
  return u.emailVerified;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { auth, m } = await authBackend();
  await m.sendPasswordResetEmail(auth, email.trim(), continueUrl());
}

export async function signOutAccount(): Promise<void> {
  const { auth, m } = await authBackend();
  await m.signOut(auth);
  setHint(null);
}

/** Firebase's error code ("auth/…") from a rejected call, or "" for anything else. */
export function errorCode(e: unknown): string {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "";
}
