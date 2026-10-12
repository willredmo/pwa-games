import { useState } from "react";
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty } from "../ai/cpu";
import type { BoardSetup } from "../game/match";

// Match settings, chosen as a game starts: the CPU's level (vs the CPU), and
// the board — natural or perfectly true, standard or 45° corners. Fixed for
// the match and kept by a rematch. Online, only the host sees this; the guest
// plays on the host's choices. Opens on the last choices made.

export type SetupMode = "cpu" | "pvp" | "online";

export interface MatchChoice extends Required<BoardSetup> {
  difficulty: Difficulty;
}

const BLURB: Record<Difficulty, string> = {
  easy: "Swings wild. Good for learning the bounces.",
  medium: "Knows its bank shots, misses some.",
  hard: "Finds the corner shot and won't leave you an easy one.",
};

const HEADING: Record<SetupMode, { title: string; start: string; note?: string }> = {
  cpu: { title: "Play vs CPU", start: "Start match" },
  pvp: { title: "2 players · same device", start: "Start match" },
  online: { title: "Online game", start: "Create game", note: "You're the host: these settings apply to both players." },
};

export interface MatchSetupProps {
  mode: SetupMode;
  initial: MatchChoice;
  onStart: (choice: MatchChoice) => void;
  onClose: () => void;
}

export function MatchSetup({ mode, initial, onStart, onClose }: MatchSetupProps) {
  const [choice, setChoice] = useState<MatchChoice>(initial);
  const set = <K extends keyof MatchChoice>(k: K, v: MatchChoice[K]) => setChoice((c) => ({ ...c, [k]: v }));
  const head = HEADING[mode];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel setup" role="dialog" aria-label="Match settings" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2>{head.title}</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {head.note && <p className="setup__note">{head.note}</p>}

        {mode === "cpu" && (
          <div className="field">
            <span className="field__label">CPU</span>
            <div className="segmented" role="radiogroup" aria-label="CPU difficulty">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={d === choice.difficulty}
                  className={`segmented__opt${d === choice.difficulty ? " segmented__opt--on" : ""}`}
                  onClick={() => set("difficulty", d)}
                >
                  {DIFFICULTY_LABEL[d]}
                </button>
              ))}
            </div>
            <p className="title__blurb">{BLURB[choice.difficulty]}</p>
          </div>
        )}

        <div className="field">
          <span className="field__label">Board</span>
          <label className="toggle-row">
            <span>
              🪵 Natural board
              <small>
                {choice.naturalBoard ? "Rails and surface have a little character, like real wood" : "Perfectly true: every bounce exactly the same"}
              </small>
            </span>
            <input type="checkbox" role="switch" checked={choice.naturalBoard} onChange={(e) => set("naturalBoard", e.target.checked)} />
          </label>
          <label className="toggle-row">
            <span>
              📐 45° corners
              <small>
                {choice.corners === "45"
                  ? "Square-cut corners: a shot up the side runs across the end"
                  : "Standard steep corners: up the side, off the corner, behind the diamond"}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={choice.corners === "45"}
              onChange={(e) => set("corners", e.target.checked ? "45" : "steep")}
            />
          </label>
        </div>

        <p className="setup__small">Set for the whole match. A rematch keeps them.</p>
        <button className="primary-btn primary-btn--wide" onClick={() => onStart(choice)}>
          {head.start}
        </button>
      </div>
    </div>
  );
}

/** One line describing a match's board, e.g. "Natural board · 45° corners". */
export function setupSummary(s: BoardSetup): string {
  return `${s.naturalBoard === false ? "True board" : "Natural board"} · ${s.corners === "45" ? "45° corners" : "standard corners"}`;
}
