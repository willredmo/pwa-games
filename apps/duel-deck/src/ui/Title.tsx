import { useState } from "react";
import { DIFFICULTIES, LEVEL_CAP_OPTIONS, START_HP_MAX, START_HP_MIN, START_HP_OPTIONS, clampStartHp, type Difficulty, type MatchRules } from "../game/match";
import type { SavedMatch } from "../game/save";
import { DIFFICULTY_INFO } from "./Overlays";
import { UnitPortrait } from "./UnitPortrait";

// The main menu. Everything that used to be decided inside a running match —
// which opponent, whether a save is resumed — is decided here instead, so the
// match itself starts already knowing what it is.
//
// Laid out to fit a 360×640 phone without scrolling: the hero, then the one
// thing you're most likely here to do (Continue, or the tutorial the first
// time), a "vs CPU" card with the opponent as a segmented control and one Play
// button, an online card, the match settings as a one-line chip that opens a
// sheet, and the rest as an icon dock. It still scrolls when it can't fit
// (a save, a rejoin and the tutorial all at once on a short phone).

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };

/** The lineup under the logo: one of each class, facing each other across the middle. */
const HERO_UNITS: { key: string; side: "player" | "enemy" }[] = [
  { key: "guard", side: "player" },
  { key: "striker", side: "player" },
  { key: "herald", side: "player" },
  { key: "berserker", side: "enemy" },
  { key: "bulwark", side: "enemy" },
];

export interface TitleProps {
  saved: SavedMatch | null;
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  /** Settings for a new CPU match, and for a duel you host. */
  rules: MatchRules;
  onRules: (r: Partial<MatchRules>) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  music: boolean;
  onMusic: (on: boolean) => void;
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
  /** Report a bug or suggest a feature. */
  onFeedback: () => void;
}

export function Title(props: TitleProps) {
  const { saved, difficulty } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const info = DIFFICULTY_INFO[difficulty] ?? { icon: "🤖", blurb: "" };
  const savedLabel = saved
    ? `Round ${saved.round}${saved.difficulty ? ` · vs ${DIFFICULTY_LABEL[saved.difficulty]}` : ""}`
    : null;

  return (
    <div className="title">
      <header className="title__hero">
        <div className="title__emblem" aria-hidden="true">⚔</div>
        <h1>Duel Deck</h1>
        <p className="title__tagline">Build a row. Merge it. Outlast them.</p>
        <div className="title__lineup" aria-hidden="true">
          {HERO_UNITS.map((u, i) => (
            <span key={u.key} className={`title__unit title__unit--${u.side}`} style={{ "--i": i } as React.CSSProperties}>
              <UnitPortrait unitKey={u.key} side={u.side} size={40} />
            </span>
          ))}
        </div>
      </header>

      <main className="title__main">
        {saved && (
          <button className="title-cta title-cta--continue" onClick={props.onResume}>
            <span className="title-cta__icon" aria-hidden="true">▶</span>
            <span className="title-cta__text">
              Continue
              <small>{savedLabel}</small>
            </span>
          </button>
        )}

        {props.suggestTutorial && (
          <button className="title-nudge" onClick={props.onTutorial}>
            <span aria-hidden="true">🎓</span>
            <span className="title-nudge__text">
              New here? <strong>Play the tutorial</strong>
              <small>A guided first match, about 3 minutes</small>
            </span>
            <span className="title-nudge__go" aria-hidden="true">›</span>
          </button>
        )}

        <section className="title-card" aria-labelledby="title-cpu">
          <h2 id="title-cpu" className="title-card__label">
            <span aria-hidden="true">🤖</span> {saved ? "New match vs CPU" : "Play vs CPU"}
          </h2>
          {/* Radios, not buttons that start a match: the opponent is a setting
              you compare, and Play is the single commit point. */}
          <div className="segmented" role="radiogroup" aria-label="Opponent">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={d === difficulty}
                className={`segmented__opt segmented__opt--${d}${d === difficulty ? " segmented__opt--on" : ""}`}
                onClick={() => props.onDifficulty(d)}
              >
                <span aria-hidden="true">{DIFFICULTY_INFO[d]?.icon}</span> {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="title-card__blurb" aria-live="polite">{info.blurb}</p>
          <button className={`title-play${saved ? " title-play--quiet" : ""}`} onClick={props.onPlay}>
            {saved ? `New match vs ${DIFFICULTY_LABEL[difficulty]}` : `Play vs ${DIFFICULTY_LABEL[difficulty]}`}
          </button>
          {saved && <p className="title__warn">Ends the match in progress.</p>}
        </section>

        <section className="title-card" aria-labelledby="title-online">
          <h2 id="title-online" className="title-card__label">
            <span aria-hidden="true">🌐</span> Online duel
          </h2>
          {props.rejoinCode && (
            <button className="title-play" onClick={props.onRejoin}>
              Rejoin duel · {props.rejoinCode}
            </button>
          )}
          <div className="title__row">
            <button className="title-btn" onClick={props.onHost}>
              Host a duel <small>Your settings</small>
            </button>
            <button className="title-btn" onClick={props.onJoin}>
              Join with code <small>Host's settings</small>
            </button>
          </div>
          {props.notice && <p className="title__notice" role="status">{props.notice}</p>}
        </section>

        {/* One line, since most matches use the defaults; the sheet holds the rest. */}
        <button className="settings-chip" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
          <span aria-hidden="true">⚙️</span>
          <span className="settings-chip__text">
            Match settings <strong>{settingsText(props.rules)}</strong>
          </span>
          <span className="settings-chip__go" aria-hidden="true">›</span>
        </button>
      </main>

      <nav className="title-dock" aria-label="More">
        <DockButton icon="🎓" label="Tutorial" onClick={props.onTutorial} />
        <DockButton icon="❓" label="Rules" onClick={props.onHelp} />
        <DockButton icon="📖" label="Codex" onClick={props.onCodex} />
        <DockButton icon="✨" label="New" onClick={props.onNotes} dot={props.newNotes} />
        <DockButton
          icon={props.sound ? "🔊" : "🔇"}
          label={props.sound ? "Sound" : "Muted"}
          onClick={() => props.onSound(!props.sound)}
          pressed={props.sound}
        />
        <DockButton
          icon={props.music ? "🎵" : "🔕"}
          label="Music"
          onClick={() => props.onMusic(!props.music)}
          pressed={props.music}
        />
        <DockButton icon="🐞" label="Feedback" onClick={props.onFeedback} />
      </nav>

      {settingsOpen && (
        <div className="overlay overlay--sheet" onClick={() => setSettingsOpen(false)}>
          <div
            className="panel sheet"
            role="dialog"
            aria-labelledby="settings-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setSettingsOpen(false)}
          >
            <div className="panel__head">
              <h2 id="settings-title">Match settings</h2>
              <button className="close-btn" onClick={() => setSettingsOpen(false)} aria-label="Close">✕</button>
            </div>
            <p className="panel__hint">
              For both <strong>🤖 matches vs the CPU</strong> and <strong>🌐 duels you host</strong>. Joining a duel uses the host's.
            </p>
            <MatchSettings rules={props.rules} onRules={props.onRules} />
            <button className="primary-btn primary-btn--wide sheet__done" onClick={() => setSettingsOpen(false)} autoFocus>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DockButton(p: { icon: string; label: string; onClick: () => void; dot?: boolean; pressed?: boolean }) {
  return (
    <button className="dock-btn" onClick={p.onClick} aria-pressed={p.pressed}>
      <span className="dock-btn__icon" aria-hidden="true">
        {p.icon}
        {p.dot && <span className="dock-btn__dot" />}
      </span>
      <span className="dock-btn__label">
        {p.label}
        {p.dot && <span className="sr-only"> (new)</span>}
      </span>
    </button>
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
  const preset = (START_HP_OPTIONS as readonly number[]).includes(rules.startHp);
  /** Custom health: open while picked, holding what's typed until it's a valid number. */
  const [custom, setCustom] = useState(!preset);
  const [draft, setDraft] = useState(String(rules.startHp));
  const commitDraft = () => {
    const hp = clampStartHp(parseInt(draft, 10));
    if (hp === null) return setDraft(String(rules.startHp));
    setDraft(String(hp));
    onRules({ startHp: hp });
  };
  return (
    <div className="match-settings">
      <span className="match-settings__label">Starting health</span>
      <div className="title__hp" role="radiogroup" aria-label="Starting health">
        {START_HP_OPTIONS.map((hp) => (
          <button
            key={hp}
            role="radio"
            aria-checked={!custom && hp === rules.startHp}
            className={`hp-option${!custom && hp === rules.startHp ? " hp-option--on" : ""}`}
            onClick={() => {
              setCustom(false);
              setDraft(String(hp));
              onRules({ startHp: hp });
            }}
          >
            ♥ {hp}
            <small>{hp < 200 ? "Quick" : hp > 200 ? "Long" : "Standard"}</small>
          </button>
        ))}
        <button
          role="radio"
          aria-checked={custom}
          className={`hp-option${custom ? " hp-option--on" : ""}`}
          onClick={() => setCustom(true)}
        >
          ♥ ?
          <small>Custom</small>
        </button>
      </div>
      {custom && (
        <label className="hp-custom">
          Your own starting health
          <input
            type="number"
            inputMode="numeric"
            min={START_HP_MIN}
            max={START_HP_MAX}
            step={10}
            value={draft}
            autoFocus
            onChange={(e) => {
              setDraft(e.target.value);
              const n = parseInt(e.target.value, 10);
              if (n >= START_HP_MIN && n <= START_HP_MAX) onRules({ startHp: n });
            }}
            onBlur={commitDraft}
            onKeyDown={(e) => e.key === "Enter" && commitDraft()}
          />
          <small>
            {START_HP_MIN} to {START_HP_MAX}
          </small>
        </label>
      )}
      <span className="match-settings__label">Level cap</span>
      <div className="title__hp" role="radiogroup" aria-label="Level cap">
        {LEVEL_CAP_OPTIONS.map((cap) => (
          <button
            key={cap}
            role="radio"
            aria-checked={cap === rules.levelCap}
            className={`hp-option${cap === rules.levelCap ? " hp-option--on" : ""}`}
            onClick={() => onRules({ levelCap: cap })}
          >
            Lv {cap}
            <small>{cap < 10 ? "Short" : cap > 10 ? "Long" : "Standard"}</small>
          </button>
        ))}
      </div>
      <small className="match-settings__note">
        Units stop levelling at the cap, where their ability gets its Mastery form. Higher caps make Knights stronger.
      </small>
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
    </div>
  );
}

/** The settings in a few words, for the settings chip. */
function settingsText(r: MatchRules): string {
  const parts = [
    `♥${r.startHp}`,
    r.easy ? "Easy mode" : null,
    r.synergies ? null : "No class bonuses",
    r.upgrades ? null : "No upgrades",
    r.levelCap !== 10 ? `Lv cap ${r.levelCap}` : null,
  ].filter(Boolean);
  return parts.length === 1 ? `${parts[0]} · Standard` : parts.join(" · ");
}
