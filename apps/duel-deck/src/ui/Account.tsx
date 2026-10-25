import { useEffect, useState } from "react";
import {
  checkVerified,
  createEmailAccount,
  errorCode,
  resendVerification,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutAccount,
  type Account,
} from "@pwa-games/backend-client";
import { accountErrorText, followAccount, takeRedirectError, useAccount } from "../online/account";

// The account screen (title screen's 👤). Accounts are optional: a guest sees
// what one is for, Google, and an email form, and closing it just carries on
// as a guest. An email account waits here until its link is opened; a
// signed-in one shows who it is and Sign out.

type Mode = "sign-in" | "create";
/** How often to ask whether the email has been confirmed, while this screen waits for it. */
const VERIFY_POLL_MS = 4000;

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const acc = useAccount();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Opening the screen is what loads Firebase Auth for a guest.
  useEffect(() => {
    followAccount();
  }, []);
  useEffect(() => {
    const e = takeRedirectError();
    if (e) setError(accountErrorText(e));
  }, [acc]);

  /** Run a sign-in call, showing its error (if any) instead of throwing. */
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(accountErrorText(errorCode(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay overlay--feedback" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="panel feedback account" role="dialog" aria-labelledby="account-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2 id="account-title">Account</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {acc.status === "loading" ? (
          <p className="panel__hint">Loading…</p>
        ) : acc.status === "guest" ? (
          <GuestView busy={busy} run={run} onClose={onClose} />
        ) : acc.account.verified ? (
          <SignedInView account={acc.account} busy={busy} run={run} />
        ) : (
          <VerifyView account={acc.account} busy={busy} run={run} />
        )}
        {error && <p className="lobby__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

function GuestView({ busy, run, onClose }: { busy: boolean; run: Run; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => (mode === "create" ? createEmailAccount(email, password, name) : signInWithEmail(email, password)));
  };
  return (
    <>
      <p className="panel__hint">
        You're playing as a <strong>guest</strong>, and that's fine: nothing needs an account. Signing in links this
        device to you, so your games on all your devices count as one player.
      </p>
      <button className="primary-btn primary-btn--wide account__google" onClick={() => void run(() => signInWithGoogle())} disabled={busy}>
        <span className="account__g" aria-hidden="true">G</span> Continue with Google
      </button>
      <div className="account__or"><span>or with email</span></div>
      <div className="feedback__kinds" role="tablist" aria-label="Email">
        {(
          [
            ["sign-in", "Sign in"],
            ["create", "Create account"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`hp-option feedback__kind${mode === m ? " hp-option--on" : ""}`}
            onClick={() => setMode(m)}
          >
            {label}
          </button>
        ))}
      </div>
      <form className="account__form" onSubmit={submit}>
        {mode === "create" && (
          <label className="feedback__label">
            Name <small>(optional)</small>
            <input className="feedback__contact" type="text" value={name} maxLength={40} autoComplete="nickname" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="feedback__label">
          Email
          <input
            className="feedback__contact"
            type="email"
            value={email}
            required
            autoComplete="email"
            inputMode="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="feedback__label">
          Password {mode === "create" && <small>(at least 6 characters)</small>}
          <input
            className="feedback__contact"
            type="password"
            value={password}
            required
            minLength={mode === "create" ? 6 : undefined}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button className="primary-btn primary-btn--wide" type="submit" disabled={busy}>
          {busy ? "One moment…" : mode === "create" ? "Create account" : "Sign in"}
        </button>
        {mode === "create" ? (
          <small className="feedback__small">We'll email you a link to confirm the address.</small>
        ) : resetSent ? (
          <small className="feedback__small" role="status">If that email has an account, a reset link is on its way.</small>
        ) : (
          <button
            type="button"
            className="link-btn account__forgot"
            disabled={busy || !email.trim()}
            title={email.trim() ? undefined : "Type your email first"}
            onClick={() => void run(async () => {
              await sendPasswordReset(email);
              setResetSent(true);
            })}
          >
            Forgot password?
          </button>
        )}
      </form>
      <button className="ghost-btn account__guest" onClick={onClose}>Keep playing as a guest</button>
    </>
  );
}

function VerifyView({ account, busy, run }: { account: Account; busy: boolean; run: Run }) {
  const [resent, setResent] = useState(false);
  // The link is opened elsewhere (a mail app, often another browser), so keep
  // asking while this screen is up and visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void checkVerified().catch(() => {});
    }, VERIFY_POLL_MS);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="feedback__done" aria-hidden="true">📬</div>
      <p className="panel__hint">
        Confirm your email: we sent a link to <strong>{account.email}</strong>. Open it, then come back here. This
        screen notices by itself.
      </p>
      <p className="feedback__small">Not there? Check spam. Until then you play as a guest.</p>
      <div className="confirm-actions">
        <button
          className="ghost-btn"
          disabled={busy || resent}
          onClick={() => void run(async () => {
            await resendVerification();
            setResent(true);
          })}
        >
          {resent ? "Sent again" : "Resend link"}
        </button>
        <button className="primary-btn" disabled={busy} onClick={() => void run(checkVerified)}>
          I've confirmed it
        </button>
      </div>
      <button className="link-btn account__forgot" onClick={() => void run(signOutAccount)} disabled={busy}>
        Use a different account
      </button>
    </>
  );
}

function SignedInView({ account, busy, run }: { account: Account; busy: boolean; run: Run }) {
  return (
    <>
      <div className="account__who">
        <span className="account__avatar" aria-hidden="true">{(account.name || account.email || "?").slice(0, 1).toUpperCase()}</span>
        <span>
          <strong>{account.name || account.email}</strong>
          <small>
            {account.name && account.email ? `${account.email} · ` : ""}
            {account.provider === "google" ? "Google" : "Email"}
          </small>
        </span>
      </div>
      <p className="panel__hint">This device is linked to your account.</p>
      <button className="ghost-btn" onClick={() => void run(signOutAccount)} disabled={busy}>
        Sign out
      </button>
      <small className="feedback__small">Signing out keeps your saved match on this device.</small>
    </>
  );
}
