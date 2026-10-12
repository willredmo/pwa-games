import { useEffect, useRef, useState } from "react";
import type { BoardSetup, MatchState } from "../game/match";
import { setupSummary } from "./MatchSetup";
import type { StickLook } from "../game/stick";
import {
  fixMatch,
  hostRoom,
  joinRoom,
  leaveRoom,
  readSession,
  saveSession,
  watchRoom,
  type JoinError,
  type Session,
} from "../online/room";

// Getting two devices into one room. Host: a room is made and its code shown
// (with a link to share); the match starts as soon as someone joins. Join:
// type the code, or open a shared link (?join=CODE) which fills it in.

export interface LobbyProps {
  kind: "host" | "join";
  /** Host: an existing room still waiting (rejoined after a reload). */
  session?: Session;
  /** Join: code from a shared link. */
  code?: string;
  look: StickLook;
  /** Host making a room: the board settings chosen for it (absent when rejoining a waiting room). */
  setup?: BoardSetup;
  onReady: (s: Session, m: MatchState) => void;
  onClose: () => void;
}

const JOIN_ERROR: Record<JoinError, string> = {
  "not-found": "No game with that code. Check it and try again.",
  full: "That game already has two players.",
  ended: "That game has ended.",
};

export function Lobby({ kind, session: initialSession, code: initialCode, look, setup, onReady, onClose }: LobbyProps) {
  const [session, setSession] = useState<Session | null>(initialSession ?? null);
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  // Host: make the room.
  useEffect(() => {
    if (kind !== "host" || session || started.current) return;
    started.current = true;
    setBusy(true);
    hostRoom(look, setup ?? {})
      .then((s) => {
        saveSession(s);
        setSession(s);
      })
      .catch(() => setError("Couldn't reach the server. Check your connection and try again."))
      .finally(() => setBusy(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, session, look]);

  // Host: start when the guest arrives.
  useEffect(() => {
    if (kind !== "host" || !session) return;
    return watchRoom<string>(session, "guest", (guest) => {
      if (!guest) return;
      void readSession(session).then((room) => room && onReady(session, fixMatch(room.match)));
    });
  }, [kind, session, onReady]);

  // Join: a shared link fills the code in; try it straight away.
  useEffect(() => {
    if (kind === "join" && initialCode && !started.current) {
      started.current = true;
      void join(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function join(input: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await joinRoom(input, look);
      if (typeof res === "string") {
        setError(JOIN_ERROR[res]);
        return;
      }
      saveSession(res);
      const room = await readSession(res);
      if (room) onReady(res, fixMatch(room.match));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const link = session ? `${location.origin}${location.pathname}?join=${session.code}` : "";
  const share = async () => {
    if (!session) return;
    const text = `Play me at Knock Hockey! Code ${session.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Knock Hockey", text, url: link });
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
          <h2>{kind === "host" ? "Online game" : "Join a game"}</h2>
          <button className="close-btn" onClick={cancel} aria-label="Close">✕</button>
        </div>

        {kind === "host" ? (
          <>
            <p className="lobby__hint">Share this code with your opponent. The game starts when they join.</p>
            <div className="lobby__code" aria-live="polite">
              {session ? session.code.split("").map((ch, i) => <span key={i}>{ch}</span>) : <span className="lobby__dots">· · · · ·</span>}
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
            <p className="lobby__small">
              You're blue and take the first shot.
              {setup && ` ${setupSummary(setup)}.`}
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
            <p className="lobby__small">You'll be red. Your goal shows at the bottom, same as always.</p>
          </form>
        )}
        {error && <p className="lobby__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
