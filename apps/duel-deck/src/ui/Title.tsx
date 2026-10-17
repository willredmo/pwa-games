import { DIFFICULTIES, START_HP_OPTIONS, type Difficulty, type MatchRules } from "../game/match";
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
  /** Settings for a new CPU match, and for a duel you host. */
  rules: MatchRules;
  onRules: (r: Partial<MatchRules>) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  onPlay: () => void;
  onResume: () => void;
  onHelp: () => void;
  onCodex: () => void;
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

        {/* Above both ways to play, since it applies to both. */}
        <h2 className="title__label">Match settings</h2>
        <p className="title__applies">
          For both <strong>🤖 matches vs the CPU</strong> and <strong>🌐 duels you host</strong>
        </p>
        <MatchSettings rules={props.rules} onRules={props.onRules} />

        <h2 className="title__label">{saved ? "New match vs CPU" : "Play vs CPU"}</h2>
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
          <small>{settingsText(props.rules)}</small>
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
          <button className="ghost-btn" onClick={props.onHost}>
            🌐 Host a duel <small>{settingsText(props.rules)}</small>
          </button>
          <button className="ghost-btn" onClick={props.onJoin}>
            Join with code <small>Host's settings</small>
          </button>
        </div>
        {props.notice && <p className="title__notice" role="status">{props.notice}</p>}

        <div className="title__links">
          <button className="link-btn" onClick={props.onTutorial}>Tutorial</button>
          <button className="link-btn" onClick={props.onHelp}>How to play</button>
          <button className="link-btn" onClick={props.onCodex}>Codex</button>
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

const TOGGLES: { key: "easy" | "synergies" | "upgrades"; label: string; hint: string }[] = [
  { key: "easy", label: "Easy mode", hint: "Undo also takes back rerolls" },
  { key: "synergies", label: "Class bonuses", hint: "Full-row bonuses for one class" },
  { key: "upgrades", label: "Upgrades", hint: `A pick every 3 rounds` },
];

/**
 * The match settings: starting health and three switches. They apply to a new
 * CPU match and to a duel you host (the guest plays under the host's).
 */
function MatchSettings({ rules, onRules }: { rules: MatchRules; onRules: (r: Partial<MatchRules>) => void }) {
  return (
    <details className="match-settings">
      <summary>
        <span className="match-settings__now">{settingsText(rules)}</span>
        <span className="match-settings__edit">Change</span>
      </summary>
      <div className="title__hp" role="radiogroup" aria-label="Starting health">
        <span className="title__hp-label">Starting health</span>
        {START_HP_OPTIONS.map((hp) => (
          <button
            key={hp}
            role="radio"
            aria-checked={hp === rules.startHp}
            className={`hp-option${hp === rules.startHp ? " hp-option--on" : ""}`}
            onClick={() => onRules({ startHp: hp })}
          >
            ♥ {hp}
            <small>{hp < 200 ? "Quick" : hp > 200 ? "Long" : "Standard"}</small>
          </button>
        ))}
      </div>
      <div className="match-settings__toggles">
        {TOGGLES.map((t) => (
          <label key={t.key} className="toggle">
            <input type="checkbox" checked={rules[t.key]} onChange={(e) => onRules({ [t.key]: e.target.checked })} />
            <span className="toggle__switch" aria-hidden="true" />
            <span>
              {t.label}
              <small>{t.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}

/** The settings in a few words, for the summary line and under each Play button. */
function settingsText(r: MatchRules): string {
  return [
    `♥${r.startHp}`,
    r.easy ? "Easy mode" : null,
    r.synergies ? null : "No class bonuses",
    r.upgrades ? null : "No upgrades",
  ]
    .filter(Boolean)
    .join(" · ");
}
