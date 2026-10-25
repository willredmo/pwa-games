import { useSyncExternalStore } from "react";
import {
  checkVerified,
  clientId,
  errorCode,
  finishGoogleRedirect,
  hasAccountHint,
  watchAccount,
  writeAt,
  type Account,
} from "@pwa-games/backend-client";
import "./firebase";

// The player's optional account, as the app sees it. Guests are the default
// and nothing here loads Firebase for them: `startAccount` only follows the
// account when this device signed in before, and the account screen calls
// `followAccount` when it opens.
//
// What an account does today: it links this device's id (`clientId()`, which
// telemetry and feedback already record as `c`) to the account, at
// users/<uid>/devices/<clientId>, and telemetry and feedback add the account
// as `u`. That joins one player's devices together. Only verified accounts
// count (Google, or email once the link is opened), and the database rules
// insist on it.

export type AccountState =
  /** Not known yet: auth is loading. */
  | { status: "loading" }
  | { status: "guest" }
  | { status: "signed-in"; account: Account };

let state: AccountState = hasAccountHint() ? { status: "loading" } : { status: "guest" };
const listeners = new Set<() => void>();
let following = false;
/** A Google redirect that came back with an error, for the account screen to show. */
let redirectError = "";

function set(next: AccountState) {
  state = next;
  for (const l of listeners) l();
}

/** React: the current account state (re-renders on change). */
export function useAccount(): AccountState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** The verified account's id, for telemetry and feedback, or undefined for a guest (or still loading). */
export function accountUid(): string | undefined {
  return state.status === "signed-in" && state.account.verified ? state.account.uid : undefined;
}

/** Take (and clear) the error a Google redirect came back with. */
export function takeRedirectError(): string {
  const e = redirectError;
  redirectError = "";
  return e;
}

/** At startup: follow the account only if this device has one. Guests load nothing. */
export function startAccount(): void {
  if (hasAccountHint()) followAccount();
}

/** Load auth and follow the account (the account screen; startup when signed in). */
export function followAccount(): void {
  if (following) return;
  following = true;
  if (state.status === "guest") set({ status: "loading" });
  finishGoogleRedirect().catch((e) => {
    redirectError = errorCode(e) || "unknown";
    for (const l of listeners) l();
  });
  watchAccount((account) => {
    set(account ? { status: "signed-in", account } : { status: "guest" });
    if (account?.verified) linkDevice(account);
  });
  // The verification link is opened in a mail app or another browser, so
  // coming back to the game is the moment to ask whether it worked.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.status === "signed-in" && !state.account.verified) {
      void checkVerified().catch(() => {});
    }
  });
}

const linked = new Set<string>();
/** A retry's wait. Right after an email is confirmed the database can still hold the old token (no `email_verified`) for a moment. */
const LINK_RETRY_MS = 1500;

/** Record this device under the account (once per account per page). */
function linkDevice(a: Account) {
  if (linked.has(a.uid)) return;
  linked.add(a.uid);
  const base = `users/${a.uid}`;
  const write = () =>
    Promise.all([
      writeAt(`${base}/devices/${clientId()}`, Date.now()),
      a.name ? writeAt(`${base}/name`, a.name.slice(0, 40)) : null,
    ]);
  write()
    .catch(() => new Promise((r) => setTimeout(r, LINK_RETRY_MS)).then(write))
    .catch(() => linked.delete(a.uid));
}

/** A sign-in error as a sentence for the player, or "" for ones to ignore (a closed popup). */
export function accountErrorText(code: string): string {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "";
    case "auth/email-already-in-use":
      return "That email already has an account. Sign in instead.";
    case "auth/invalid-email":
      return "That doesn't look like an email address.";
    case "auth/missing-password":
      return "Enter a password.";
    case "auth/weak-password":
      return "Use a password of at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return "Wrong email or password.";
    case "auth/too-many-requests":
      return "Too many tries. Wait a minute and try again.";
    case "auth/network-request-failed":
      return "Couldn't reach the server. Check your connection.";
    case "auth/account-exists-with-different-credential":
      return "That email signs in another way. Try the other option.";
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found":
    case "auth/unauthorized-domain":
    case "auth/unauthorized-continue-uri":
      return "Accounts aren't switched on yet. You can keep playing as a guest.";
    default:
      return `Something went wrong${code ? ` (${code.replace("auth/", "")})` : ""}. Try again.`;
  }
}
