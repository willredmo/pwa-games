import { useEffect, useRef, useState } from "react";
import { EMOTES, sendEmote, watchEmotes, type Session } from "../online/room";
import { sfx } from "../game/sound";

// Online only: a small fixed set of emoji the two players can send each other.
// Fixed and sent by index (see EMOTES in room.ts), so there's no text to
// moderate. Limits keep it from becoming spam: one every COOLDOWN_MS and at
// most PER_ROUND a round. Bubbles sit over each side's half of the board (theirs
// at the top, yours at the bottom) and fade on their own. The opponent's can
// be muted from the tray; the choice is remembered on this device.

const COOLDOWN_MS = 3000;
const PER_ROUND = 5;
const BUBBLE_MS = 2500;
const MUTE_KEY = "duel-deck:mute-emotes";

interface Bubble {
  id: number;
  emoji: string;
  mine: boolean;
}

export function EmoteBar({ session, round }: { session: Session; round: number }) {
  const [open, setOpen] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sentThisRound, setSentThisRound] = useState(0);
  const [coolUntil, setCoolUntil] = useState(0);
  const [, tick] = useState(0);
  const seq = useRef(0);
  const nextId = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => setSentThisRound(0), [round]);

  const show = (emoji: string, mine: boolean) => {
    const id = nextId.current++;
    setBubbles((b) => [...b.filter((x) => x.mine !== mine), { id, emoji, mine }]);
    window.setTimeout(() => setBubbles((b) => b.filter((x) => x.id !== id)), BUBBLE_MS);
  };

  // The opponent's: show each new `n`, ignoring whatever was there when we joined.
  useEffect(() => {
    let seen: number | null = null;
    return watchEmotes(session, (m) => {
      if (!m || typeof m.i !== "number") return;
      if (seen === null) {
        seen = m.n;
        return;
      }
      if (m.n === seen) return;
      seen = m.n;
      const emoji = EMOTES[m.i];
      if (!emoji || mutedRef.current) return;
      show(emoji, false);
      sfx("emote");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Re-render when the cooldown ends, so the buttons re-enable.
  useEffect(() => {
    const left = coolUntil - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => tick((n) => n + 1), left + 20);
    return () => window.clearTimeout(t);
  }, [coolUntil]);

  const cooling = Date.now() < coolUntil;
  const capped = sentThisRound >= PER_ROUND;
  const send = (i: number) => {
    if (cooling || capped) return;
    // Start from the clock so a reload never repeats an `n` the other side saw.
    seq.current = Math.max(seq.current + 1, Date.now());
    sendEmote(session, i, seq.current);
    show(EMOTES[i], true);
    setSentThisRound((n) => n + 1);
    setCoolUntil(Date.now() + COOLDOWN_MS);
    setOpen(false);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      /* this session only */
    }
    if (next) setBubbles((b) => b.filter((x) => x.mine));
  };

  return (
    <>
      {bubbles.map((b) => (
        <div key={b.id} className={`emote-bubble emote-bubble--${b.mine ? "mine" : "theirs"}`} aria-live="polite">
          {b.emoji}
        </div>
      ))}
      <div className="emote-bar">
        {open && (
          <div className="emote-tray" role="menu" aria-label="Send an emote">
            {EMOTES.map((e, i) => (
              <button
                key={e}
                className="emote-tray__btn"
                role="menuitem"
                disabled={cooling || capped}
                onClick={() => send(i)}
                aria-label={i === EMOTES.length - 1 ? "Good game" : `Send ${e}`}
              >
                {e}
                {i === EMOTES.length - 1 && <span className="emote-tray__gg">GG</span>}
              </button>
            ))}
            <button className="emote-tray__mute" onClick={toggleMute} aria-pressed={muted}>
              {muted ? "🔇 Opponent muted" : "🔈 Mute opponent"}
            </button>
            {capped && <span className="emote-tray__note">{PER_ROUND} a round max</span>}
          </div>
        )}
        <button
          className={`emote-fab${open ? " emote-fab--open" : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Emotes"
          title="Send an emote"
        >
          💬
        </button>
      </div>
    </>
  );
}
