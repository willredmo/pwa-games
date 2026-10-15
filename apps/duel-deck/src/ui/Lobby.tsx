import { useEffect, useRef, useState } from "react";
import {
  hostRoom,
  joinRoom,
  leaveRoom,
  readSession,
  saveSession,
  watchRoom,
  type JoinError,
  type Session,
} from "../online/room";
import { THIS_BUILD, newerDeploy, updateNow, type DeployInfo } from "../pwa";

// Getting two devices into one room. Host: a room is made and its code shown
// (with a link to share); the match starts as soon as someone joins. Join:
// type the code, or open a shared link (?join=CODE) which fills it in.
//
// Unlike knock-hockey there's no "who goes first" to explain — both players
// build their row at the same time — so the small print sets that expectation
// instead.

export interface LobbyProps {
  kind: "host" | "join";
  /** Host: an existing room still waiting (rejoined after a reload). */
  session?: Session;
  /** Join: code from a shared link. */
  code?: string;
  onReady: (s: Session) => void;
  onClose: () => void;
}

const JOIN_ERROR: Record<JoinError, string> = {
  "not-found": "No game with that code. Check it and try again.",
  full: "That game already has two players.",
  ended: "That game has ended.",
  "update-me": "That game is on a newer version of Duel Deck. Update to join it.",
  "update-them": "Your opponent is on an older version of Duel Deck. Ask them to update the app, then host again.",
};

export function Lobby({ kind, session: initialSession, code: initialCode, onReady, onClose }: LobbyProps) {
  const [session, setSession] = useState<Session | null>(initialSession ?? null);
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  /**
   * Online play needs both devices on the same rules, so check for a newer
   * deploy before hosting or joining: "checking", then null (up to date, or
   * couldn't tell) or the newer deploy to update to.
   */
  const [gate, setGate] = useState<"checking" | DeployInfo | null>("checking");
  useEffect(() => {
    let live = true;
    void newerDeploy().then((d) => live && setGate(d));
    return () => {
      live = false;
    };
  }, []);
  const ready = gate === null;
  const [updating, setUpdating] = useState(false);

  // Host: make the room.
  useEffect(() => {
    if (!ready || kind !== "host" || session || started.current) return;
    started.current = true;
    setBusy(true);
    hostRoom()
      .then((s) => {
        saveSession(s);
        setSession(s);
      })
      .catch(() => setError("Couldn't reach the server. Check your connection and try again."))
      .finally(() => setBusy(false));
  }, [ready, kind, session]);

  // Host: start when the guest arrives.
  useEffect(() => {
    if (kind !== "host" || !session) return;
    return watchRoom<string>(session, "guest", (guest) => {
      if (guest) onReady(session);
    });
  }, [kind, session, onReady]);

  // Join: a shared link fills the code in; try it straight away.
  useEffect(() => {
    if (ready && kind === "join" && initialCode && !started.current) {
      started.current = true;
      void join(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function join(input: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await joinRoom(input);
      if (typeof res === "string") {
        setError(JOIN_ERROR[res]);
        return;
      }
      saveSession(res);
      const room = await readSession(res);
      if (room) onReady(res);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const link = session ? `${location.origin}${location.pathname}?join=${session.code}` : "";
  const share = async () => {
    if (!session) return;
    const text = `Duel me at Duel Deck! Code ${session.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Duel Deck", text, url: link });
        return;
      }
    } catch {
      return; // share sheet dismissed
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy. Read out the code instead.");
    }
  };

  const cancel = () => {
    // A host abandoning an empty room closes it.
    if (kind === "host" && session) {
      void leaveRoom(session);
      saveSession(null);
    }
    onClose();
  };

  return (
    <div className="overlay" onClick={cancel}>
      <div className="panel lobby" role="dialog" aria-label="Online game" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2>{kind === "host" ? "Online duel" : "Join a duel"}</h2>
          <button className="close-btn" onClick={cancel} aria-label="Close">✕</button>
        </div>

        {gate === "checking" ? (
          <p className="lobby__waiting">
            <span className="lobby__spinner" aria-hidden /> Checking for updates…
          </p>
        ) : gate ? (
          <div className="lobby__update">
            <p className="lobby__hint">
              <strong>Update needed.</strong> Version {gate.version} is out (you have {THIS_BUILD.version}). Both players need the
              same version to duel online.
            </p>
            <button className="primary-btn primary-btn--wide" disabled={updating} onClick={() => {
              setUpdating(true);
              void updateNow();
            }}>
              {updating ? "Updating…" : "Update now"}
            </button>
          </div>
        ) : kind === "host" ? (
          <>
            <p className="lobby__hint">Share this code with your opponent. The duel starts when they join.</p>
            <div className="lobby__code" aria-live="polite">
              {session ? (
                session.code.split("").map((ch, i) => <span key={i}>{ch}</span>)
              ) : (
                <span className="lobby__dots">· · · · ·</span>
              )}
            </div>
            <button className="primary-btn primary-btn--wide" disabled={!session} onClick={() => void share()}>
              {copied ? "✓ Link copied" : "Share invite link"}
            </button>
            <p className="lobby__waiting">
              {session ? (
                <>
                  <span className="lobby__spinner" aria-hidden /> Waiting for your opponent…
                </>
              ) : busy ? (
                "Making a room…"
              ) : null}
            </p>
          </>
        ) : (
          <form
            className="lobby__join"
            onSubmit={(e) => {
              e.preventDefault();
              void join(code);
            }}
          >
            <label className="lobby__hint" htmlFor="join-code">
              Enter the 5-letter code from your opponent.
            </label>
            <input
              id="join-code"
              className="lobby__input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
              placeholder="ABCDE"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              maxLength={5}
              autoFocus={!initialCode}
            />
            <button className="primary-btn primary-btn--wide" disabled={busy || code.length !== 5}>
              {busy ? "Joining…" : "Join"}
            </button>
          </form>
        )}
        <p className="lobby__small">
          You both build your row at the same time, then the rows clash. No waiting for turns.
        </p>
        {error && <p className="lobby__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
