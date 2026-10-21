import { useEffect, useState } from "react";
import {
  THIS_BUILD,
  checkForUpdate,
  fetchLatestDeploy,
  formatDeploy,
  update,
  usePwaUpdate,
  type DeployInfo,
} from "../pwa";

// The ☰ menu: things you reach for now and then (codex, rules, a new match)
// plus an About section saying which build this device is running and when the
// newest one was deployed — the same idea as the partner check-in app's
// settings, but it also says whether this device is behind.
//
// Compact enough to fit a 360×640 phone without scrolling: four tiles, two
// switches, one line for this match's settings, the exits side by side, and
// About folded away (open by itself when an update is waiting).

export interface MenuPanelProps {
  onClose: () => void;
  onCodex: () => void;
  onNotes: () => void;
  onHelp: () => void;
  /** Report a bug or suggest a feature (screenshots the game first). */
  onFeedback: () => void;
  onNewMatch: () => void;
  /** Back to the title screen, keeping this match saved to resume. */
  onExit: () => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  music: boolean;
  onMusic: (on: boolean) => void;
  battleLog: boolean;
  onBattleLog: (on: boolean) => void;
  /** This match's opponent, for display (it's chosen on the title screen). */
  difficultyLabel: string;
  /** This match's settings that differ from the defaults, or "Standard". */
  rulesLabel: string;
  /** An online duel: one "Leave duel" instead of Main menu / New match. */
  online?: boolean;
}

type CheckState = "idle" | "checking" | "done";

export function MenuPanel(props: MenuPanelProps) {
  const { onClose, onCodex, onNotes, onHelp, onFeedback, onNewMatch, onExit, sound, onSound, music, onMusic, difficultyLabel, rulesLabel, online } = props;
  const waiting = usePwaUpdate();
  const [latest, setLatest] = useState<DeployInfo | null>(null);
  const [check, setCheck] = useState<CheckState>("idle");
  const [confirmNew, setConfirmNew] = useState(false);

  useEffect(() => {
    void fetchLatestDeploy().then(setLatest);
  }, []);

  const behind = waiting || (!!latest && latest.deployedAt !== THIS_BUILD.deployedAt && !import.meta.env.DEV);

  const runCheck = async () => {
    setCheck("checking");
    const [info] = await Promise.all([fetchLatestDeploy(), checkForUpdate()]);
    setLatest(info);
    setCheck("done");
  };

  return (
    <div className="overlay overlay--menu" onClick={onClose}>
      <div className="panel menu-panel" role="dialog" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2>Menu</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="menu-tiles">
          <button className="menu-tile" onClick={onCodex}>
            <span className="menu-tile__icon" aria-hidden="true">📖</span>
            Codex
            <small>Units and upgrades</small>
          </button>
          <button className="menu-tile" onClick={onHelp}>
            <span className="menu-tile__icon" aria-hidden="true">❓</span>
            How to play
            <small>Rounds, merging</small>
          </button>
          <button className="menu-tile" onClick={onNotes}>
            <span className="menu-tile__icon" aria-hidden="true">✨</span>
            What's new
            <small>Patch notes</small>
          </button>
          <button className="menu-tile" onClick={onFeedback}>
            <span className="menu-tile__icon" aria-hidden="true">🐞</span>
            Bugs &amp; ideas
            <small>Sends a screenshot</small>
          </button>
        </div>

        {/* Sound is also on the title screen, but a battle is exactly when you
            want to silence it, and the title is a whole match away from here. */}
        <div className="menu-group">
          <label className="toggle">
            <input type="checkbox" checked={sound} onChange={(e) => onSound(e.target.checked)} />
            <span className="toggle__switch" aria-hidden="true" />
            <span>
              {sound ? "🔊" : "🔇"} Sound
              <small>Battle and menu sounds</small>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={music} onChange={(e) => onMusic(e.target.checked)} />
            <span className="toggle__switch" aria-hidden="true" />
            <span>
              {music ? "🎵" : "🔕"} Music
              <small>{!sound ? "Needs Sound on" : music ? "Calm while picking, faster in battle" : "Off"}</small>
            </span>
          </label>
          {/* Battle log: hidden for now (battle view gives the board the screen),
              so its switch is too. The setting and props stay for when it returns. */}
        </div>

        <p className="menu-match">
          <span>
            {online ? "🌐 Online duel" : `🤖 vs ${difficultyLabel}`} · ⚙️ {rulesLabel}
          </span>
          <small>Fixed for this match{online ? "" : ". New match to change them"}.</small>
        </p>

        {confirmNew ? (
          <div className="menu-confirm" role="alert">
            <span>
              ⚠️ Abandon this match?<small>Your current run is lost.</small>
            </span>
            <span className="menu-confirm__actions">
              <button className="ghost-btn ghost-btn--sm" onClick={() => setConfirmNew(false)}>Cancel</button>
              <button className="primary-btn primary-btn--danger" onClick={onNewMatch}>New match</button>
            </span>
          </div>
        ) : online ? (
          <div className="menu-actions menu-actions--one">
            <button className="menu-action" onClick={onExit}>
              🚪 Leave duel<small>Ends it for both players</small>
            </button>
          </div>
        ) : (
          <div className="menu-actions">
            {/* Leaving mid-match is safe — the save is written at the start of
                every pick phase, so Continue picks this run back up. */}
            <button className="menu-action" onClick={onExit}>
              🏠 Main menu<small>This match is saved</small>
            </button>
            <button className="menu-action menu-action--danger" onClick={() => setConfirmNew(true)}>
              🔄 New match<small>Start over</small>
            </button>
          </div>
        )}

        {/* Rarely needed, so folded away — except when an update is waiting. */}
        <details className="menu-about-box" open={behind}>
          <summary>
            About · v{THIS_BUILD.version}
            {behind && <span className="menu-about-box__new">Update available</span>}
          </summary>
          <dl className="menu-about">
            <dt>This build</dt>
            <dd>deployed {formatDeploy(THIS_BUILD.deployedAt)}</dd>
            <dt>Latest</dt>
            <dd>{latest ? `v${latest.version} · deployed ${formatDeploy(latest.deployedAt)}` : "—"}</dd>
          </dl>
          <div className={`menu-status${behind ? " menu-status--behind" : ""}`}>
            {behind ? (
              <>
                <span>✨ A newer version is available</span>
                <button className="primary-btn" onClick={update}>Update now</button>
              </>
            ) : (
              <>
                <span>
                  {import.meta.env.DEV
                    ? "Dev server — no deploy to compare"
                    : check === "done" && latest
                      ? "✓ You're on the latest version"
                      : latest
                        ? "✓ Up to date"
                        : "Can't reach the server"}
                </span>
                <button className="ghost-btn ghost-btn--sm" onClick={() => void runCheck()} disabled={check === "checking"}>
                  {check === "checking" ? "Checking…" : "Check for updates"}
                </button>
              </>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
