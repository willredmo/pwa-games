import { useState } from "react";
import { downloadScreenshot, sendFeedback, type FeedbackKind } from "../game/feedback";

// Report a bug / suggest a feature (☰, the title screen, the result screen).
// The screenshot is taken by App *before* this panel opens, so it shows the
// screen the player was looking at, not the form. "Retake" closes the panel,
// captures again and reopens it with what was typed kept.

export interface FeedbackDraft {
  kind: FeedbackKind;
  text: string;
  contact: string;
  withShot: boolean;
}

export const EMPTY_DRAFT: FeedbackDraft = { kind: "bug", text: "", contact: "", withShot: true };

export interface FeedbackPanelProps {
  /** The screenshot taken as the panel opened, or null if it couldn't be drawn. */
  shot: string | null;
  /** Where the player was, attached to the report. */
  context: string;
  draft: FeedbackDraft;
  onDraft: (d: FeedbackDraft) => void;
  onRetake: () => void;
  /** Close; `sent` clears the draft. */
  onClose: (sent: boolean) => void;
}

type SendState = "idle" | "sending" | "sent" | "error" | "offline";

export function FeedbackPanel({ shot, context, draft, onDraft, onRetake, onClose }: FeedbackPanelProps) {
  const [state, setState] = useState<SendState>("idle");
  const set = (patch: Partial<FeedbackDraft>) => onDraft({ ...draft, ...patch });
  const canSend = draft.text.trim().length > 0 && state !== "sending";

  const send = async () => {
    if (!canSend) return;
    setState("sending");
    try {
      await sendFeedback({
        kind: draft.kind,
        text: draft.text.trim(),
        contact: draft.contact,
        ctx: context,
        shot: draft.withShot ? shot : null,
      });
      setState("sent");
    } catch (e) {
      setState(e instanceof Error && e.message === "timeout" ? "offline" : "error");
    }
  };

  if (state === "sent") {
    return (
      <div className="overlay overlay--feedback" onClick={() => onClose(true)}>
        <div className="panel panel--center feedback" role="dialog" aria-label="Feedback sent" onClick={(e) => e.stopPropagation()}>
          <div className="feedback__done" aria-hidden="true">💌</div>
          <h2>Thanks!</h2>
          <p className="panel__hint">
            {draft.kind === "bug" ? "Your report is in. It helps a lot." : "Your idea is in. Every one gets read."}
          </p>
          <button className="primary-btn" onClick={() => onClose(true)} autoFocus>
            Back to the game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay overlay--feedback" onClick={() => onClose(false)} onKeyDown={(e) => e.key === "Escape" && onClose(false)}>
      <div className="panel feedback" role="dialog" aria-labelledby="feedback-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2 id="feedback-title">Send feedback</h2>
          <button className="close-btn" onClick={() => onClose(false)} aria-label="Close">✕</button>
        </div>

        <div className="feedback__kinds" role="radiogroup" aria-label="Kind of feedback">
          {(
            [
              ["bug", "🐞", "Report a bug", "Something broke or looks wrong"],
              ["idea", "💡", "Suggest a feature", "Something you'd like to see"],
            ] as const
          ).map(([kind, icon, label, sub]) => (
            <button
              key={kind}
              role="radio"
              aria-checked={draft.kind === kind}
              className={`hp-option feedback__kind${draft.kind === kind ? " hp-option--on" : ""}`}
              onClick={() => set({ kind })}
            >
              <span>
                <span aria-hidden="true">{icon}</span> {label}
              </span>
              <small>{sub}</small>
            </button>
          ))}
        </div>

        <label className="feedback__label">
          {draft.kind === "bug" ? "What happened? What did you expect?" : "What's your idea?"}
          <textarea
            className="feedback__text"
            value={draft.text}
            maxLength={2000}
            rows={4}
            autoFocus
            placeholder={
              draft.kind === "bug"
                ? "e.g. I merged two Guards and the level didn't go up"
                : "e.g. A unit that heals the whole row"
            }
            onChange={(e) => set({ text: e.target.value })}
          />
        </label>

        <div className="feedback__shot">
          {shot ? (
            <>
              <label className="toggle">
                <input type="checkbox" checked={draft.withShot} onChange={(e) => set({ withShot: e.target.checked })} />
                <span className="toggle__switch" aria-hidden="true" />
                <span>
                  Include screenshot
                  <small>Just the game, as it was when you opened this</small>
                </span>
              </label>
              <img
                className={`feedback__img${draft.withShot ? "" : " feedback__img--off"}`}
                src={shot}
                alt="Screenshot of the game"
              />
              <div className="feedback__shot-actions">
                <button className="ghost-btn ghost-btn--sm" onClick={onRetake} title="Close this, then take a new screenshot">
                  📸 Retake
                </button>
                <button className="ghost-btn ghost-btn--sm" onClick={() => downloadScreenshot(shot)}>
                  ⬇ Save image
                </button>
              </div>
            </>
          ) : (
            <p className="panel__hint">
              Couldn't take a screenshot.{" "}
              <button className="link-btn" onClick={onRetake}>Try again</button>
            </p>
          )}
        </div>

        <label className="feedback__label">
          Contact <small>(optional, if you'd like a reply)</small>
          <input
            className="feedback__contact"
            type="text"
            value={draft.contact}
            maxLength={120}
            placeholder="Email or username"
            onChange={(e) => set({ contact: e.target.value })}
          />
        </label>

        <p className="feedback__small">Sends your message, the screenshot if included, the game version and your device type.</p>
        {state === "error" && <p className="lobby__error" role="alert">Couldn't send. Check your connection and try again.</p>}
        {state === "offline" && (
          <p className="lobby__error" role="alert">
            Still sending — you seem to be offline. Keep the game open and it'll go through when you're back.
          </p>
        )}

        <div className="confirm-actions">
          <button className="ghost-btn" onClick={() => onClose(false)}>Cancel</button>
          <button className="primary-btn" onClick={() => void send()} disabled={!canSend}>
            {state === "sending" ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
