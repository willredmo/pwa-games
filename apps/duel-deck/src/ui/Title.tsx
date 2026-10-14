import { DIFFICULTIES, type Difficulty } from "../game/match";
import type { SavedMatch } from "../game/save";
import { DIFFICULTY_INFO } from "./Overlays";

// The main menu. Everything that used to be decided inside a running match —
// which opponent, whether a save is resumed — is decided here instead, so the
// match itself starts already knowing what it is.

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };

export interface TitleProps {
  saved: SavedMatch | null;
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  onPlay: () => void;
  onResume: () => void;
  onHelp: () => void;
  onUnits: () => void;
  onNotes: () => void;
  /** Patch notes for this version haven't been opened yet: show a dot. */
  newNotes: boolean;
  /** Start the first-match tutorial. */
  onTutorial: () => void;
  /** Lead with the tutorial: nothing saved and it's never been finished or skipped. */
  suggestTutorial: boolean;
  /** An online duel this device can rejoin after a reload. */
  rejoinCode: string | null;
  notice: string | null;
  onHost: () => void;
  onJoin: () => void;
  onRejoin: () => void;
}

export function Title(props: TitleProps) {
  const { saved, difficulty } = props;
  const savedLabel = saved
    ? `Round ${saved.round}${saved.difficulty ? ` · ${DIFFICULTY_LABEL[saved.difficulty]}` : ""}`
    : null;

  return (
    <div className="title">
      <div className="title__hero">
        <div className="title__emblem" aria-hidden="true">⚔</div>
        <h1>Duel Deck</h1>
        <p className="title__tagline">Build a row. Merge it. Outlast them.</p>
      </div>

      <div className="panel title__panel">
        {saved && (
          <button className="primary-btn primary-btn--wide" onClick={props.onResume}>
            Continue <small>{savedLabel}</small>
          </button>
        )}

        {props.suggestTutorial && (
          <button className="primary-btn primary-btn--wide title__tutorial" onClick={props.onTutorial}>
            🎓 New here? Play the tutorial <small>A guided first match, about 3 minutes</small>
          </button>
        )}

        <h2 className="title__label">{saved ? "New match" : "Play"}</h2>
        <div className="title__options">
          {DIFFICULTIES.map((d, i) => {
            const info = DIFFICULTY_INFO[d] ?? { icon: "🤖", blurb: "" };
            return (
              <button
                key={d}
                // Radios, not buttons that start a match: the opponent is a
                // setting you compare, and Play is the single commit point.
                role="radio"
                aria-checked={d === difficulty}
                className={`start-option start-option--${d}${d === difficulty ? " start-option--on" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
                onClick={() => props.onDifficulty(d)}
              >
                <span className="start-option__icon" aria-hidden="true">{info.icon}</span>
                <span className="start-option__text">
                  <strong>{DIFFICULTY_LABEL[d]}</strong>
                  <span>{info.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button
          className={`${saved || props.suggestTutorial ? "ghost-btn" : "primary-btn"} primary-btn--wide`}
          onClick={props.onPlay}
        >
          {saved ? `New match vs ${DIFFICULTY_LABEL[difficulty]}` : `Play vs ${DIFFICULTY_LABEL[difficulty]}`}
        </button>
        {saved && (
          <p className="title__warn">Starting a new match ends the one in progress.</p>
        )}

        <h2 className="title__label">Online duel</h2>
        {props.rejoinCode && (
          <button className="primary-btn primary-btn--wide" onClick={props.onRejoin}>
            Rejoin duel <small>Code {props.rejoinCode}</small>
          </button>
        )}
        <div className="title__row">
          <button className="ghost-btn" onClick={props.onHost}>🌐 Host a duel</button>
          <button className="ghost-btn" onClick={props.onJoin}>Join with code</button>
        </div>
        {props.notice && <p className="title__notice" role="status">{props.notice}</p>}

        <div className="title__links">
          <button className="link-btn" onClick={props.onTutorial}>Tutorial</button>
          <button className="link-btn" onClick={props.onHelp}>How to play</button>
          <button className="link-btn" onClick={props.onUnits}>Units</button>
          <button className="link-btn" onClick={props.onNotes}>
            What's new{props.newNotes && <span className="link-btn__dot" aria-label="(new)" />}
          </button>
          <button
            className="link-btn"
            onClick={() => props.onSound(!props.sound)}
            aria-pressed={props.sound}
          >
            {props.sound ? "🔊 Sound on" : "🔇 Sound off"}
          </button>
        </div>
      </div>
    </div>
  );
}
