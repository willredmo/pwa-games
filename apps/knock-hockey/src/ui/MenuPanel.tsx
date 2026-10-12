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
import type { Settings } from "../game/match";

// The ☰ menu: rules, the Locker, settings, a new match, and an About section
// saying which build this device is running and when the newest one was
// deployed (and whether this device is behind). Same layout as Duel Deck's.

export interface MenuPanelProps {
  onClose: () => void;
  onHelp: () => void;
  onLocker: () => void;
  onNewMatch: () => void;
  /** This match's opponent, for display (it's chosen on the start screen). */
  opponentLabel: string;
  /** Online match: "New match" becomes "Leave game" (the opponent is told). */
  online?: boolean;
  /** This match's board: natural (with character) or perfectly true. */
  naturalBoard: boolean;
  /** This match has 45° corners (not the standard steep ones). */
  corners45: boolean;
  /** Goals so far, for the replays item. */
  goalCount: number;
  onReplays: () => void;
  settings: Settings;
  onSettings: (f: (s: Settings) => Settings) => void;
}

type CheckState = "idle" | "checking" | "done";

export function MenuPanel(props: MenuPanelProps) {
  const { onClose, onHelp, onLocker, onNewMatch, opponentLabel, online, goalCount, onReplays, naturalBoard, corners45, settings, onSettings } = props;
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

        <div className="menu-list">
          <button className="menu-item" onClick={onHelp}>
            <span className="menu-item__icon">❓</span>
            <span>How to play<small>Power, aim, hit, and the corner shot</small></span>
          </button>
          <button className="menu-item" onClick={onReplays} disabled={goalCount === 0}>
            <span className="menu-item__icon">🎬</span>
            <span>
              Goal replays
              <small>{goalCount === 0 ? "No goals yet" : `Watch ${goalCount === 1 ? "the goal" : `all ${goalCount} goals`} again`}</small>
            </span>
          </button>
          <button className="menu-item" onClick={onLocker}>
            <span className="menu-item__icon">🏒</span>
            <span>Locker<small>Customize your stick</small></span>
          </button>
          <label className="menu-item menu-item--toggle">
            <span className="menu-item__icon">🎯</span>
            <span>Aim line<small>Off for a harder game</small></span>
            <input
              type="checkbox"
              checked={settings.aimLine}
              onChange={(e) => onSettings((s) => ({ ...s, aimLine: e.target.checked }))}
            />
          </label>
          <label className="menu-item menu-item--toggle">
            <span className="menu-item__icon">🔊</span>
            <span>Sound<small>Clacks and the goal horn</small></span>
            <input
              type="checkbox"
              checked={settings.sound}
              onChange={(e) => onSettings((s) => ({ ...s, sound: e.target.checked }))}
            />
          </label>
          <div className="menu-item menu-item--locked">
            <span className="menu-item__icon">🤖</span>
            <span>
              Opponent: {opponentLabel}
              <small>{online ? "Leave to play someone else." : "Chosen when the match started. New match to pick again."}</small>
            </span>
          </div>
          <div className="menu-item menu-item--locked">
            <span className="menu-item__icon">🪵</span>
            <span>
              Board: {naturalBoard ? "natural" : "perfectly true"}, {corners45 ? "45° corners" : "standard corners"}
              <small>{online ? "Set by the host for this match." : "Set for this match. Choose again when you start a new game."}</small>
            </span>
          </div>
          {confirmNew ? (
            <div className="menu-item menu-item--confirm">
              <span className="menu-item__icon">⚠️</span>
              <span>
                {online ? "Leave this game?" : "Leave this match?"}
                <small>{online ? "Your opponent will see that you left." : "The score so far is lost."}</small>
              </span>
              <span className="menu-item__actions">
                <button className="ghost-btn ghost-btn--sm" onClick={() => setConfirmNew(false)}>Cancel</button>
                <button className="primary-btn primary-btn--danger" onClick={onNewMatch}>{online ? "Leave" : "New match"}</button>
              </span>
            </div>
          ) : (
            <button className="menu-item" onClick={() => setConfirmNew(true)}>
              <span className="menu-item__icon">🔄</span>
              {online ? (
                <span>Leave game<small>Back to the start screen</small></span>
              ) : (
                <span>New match<small>Back to the start screen to pick an opponent</small></span>
              )}
            </button>
          )}
        </div>

        <h3 className="menu-heading">About</h3>
        <dl className="menu-about">
          <dt>Version</dt>
          <dd>v{THIS_BUILD.version}</dd>
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
      </div>
    </div>
  );
}
