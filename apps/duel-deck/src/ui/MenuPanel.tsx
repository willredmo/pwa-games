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

// The ☰ menu: things you reach for now and then (codex, rules, difficulty, a
// new match) plus an About section saying which build this device is running
// and when the newest one was deployed — the same idea as the partner check-in
// app's settings, but it also says whether this device is behind.

export interface MenuPanelProps<D extends string> {
  onClose: () => void;
  onUnits: () => void;
  onHelp: () => void;
  onNewMatch: () => void;
  difficulty: D;
  difficulties: readonly D[];
  difficultyLabel: Record<D, string>;
  difficultyLocked: boolean;
  onDifficulty: (d: D) => void;
}

type CheckState = "idle" | "checking" | "done";

export function MenuPanel<D extends string>(props: MenuPanelProps<D>) {
  const { onClose, onUnits, onHelp, onNewMatch, difficulty, difficulties, difficultyLabel, difficultyLocked, onDifficulty } = props;
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
          <button className="menu-item" onClick={onUnits}>
            <span className="menu-item__icon">📖</span>
            <span>Units<small>Every unit, its ability and its story</small></span>
          </button>
          <button className="menu-item" onClick={onHelp}>
            <span className="menu-item__icon">❓</span>
            <span>How to play<small>Rounds, merging, upgrades</small></span>
          </button>
          <label className={`menu-item menu-item--select${difficultyLocked ? " menu-item--locked" : ""}`}>
            <span className="menu-item__icon">{difficultyLocked ? "🔒" : "🤖"}</span>
            <span>
              AI difficulty
              <small>{difficultyLocked ? "Locked for this match — start a new one to change it" : "Locks once you commit round 1"}</small>
            </span>
            <select value={difficulty} disabled={difficultyLocked} onChange={(e) => onDifficulty(e.target.value as D)}>
              {difficulties.map((d) => (
                <option key={d} value={d}>{difficultyLabel[d]}</option>
              ))}
            </select>
          </label>
          {confirmNew ? (
            <div className="menu-item menu-item--confirm">
              <span className="menu-item__icon">⚠️</span>
              <span>Abandon this match?<small>Your current run is lost.</small></span>
              <span className="menu-item__actions">
                <button className="ghost-btn ghost-btn--sm" onClick={() => setConfirmNew(false)}>Cancel</button>
                <button className="primary-btn primary-btn--danger" onClick={onNewMatch}>New match</button>
              </span>
            </div>
          ) : (
            <button className="menu-item" onClick={() => setConfirmNew(true)}>
              <span className="menu-item__icon">🔄</span>
              <span>New match<small>Start over from round 1</small></span>
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
