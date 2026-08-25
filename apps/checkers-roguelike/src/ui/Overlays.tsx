import { useState } from "react";
import type { UpgradeDef } from "../game/upgrades";
import { upgradeName } from "../game/upgrades";
import { canReceive, type RosterPiece } from "../game/run";

// Between-floor and run-end overlays. Presentational — all run/roster state is
// owned by App and passed in; these just collect the player's choice.

interface UpgradePanelProps {
  floor: number;
  choices: UpgradeDef[];
  roster: RosterPiece[];
  onApply: (upgradeId: string, pieceIndex: number) => void;
}

export function UpgradePanel({ floor, choices, roster, onApply }: UpgradePanelProps) {
  const [pickedUpgrade, setPickedUpgrade] = useState<string | null>(null);

  return (
    <div className="overlay">
      <div className="panel">
        <h2>Floor {floor} cleared</h2>

        {!pickedUpgrade ? (
          <>
            <p className="panel__hint">Choose an upgrade</p>
            <div className="cards">
              {choices.map((u) => (
                <button
                  key={u.id}
                  className="card"
                  onClick={() => setPickedUpgrade(u.id)}
                >
                  <span className="card__name">{u.name}</span>
                  <span className="card__desc">{u.description}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="panel__hint">
              Apply <strong>{upgradeName(pickedUpgrade)}</strong> to which piece?
            </p>
            <div className="pieces">
              {roster.map((p, i) => {
                const ok = canReceive(p, pickedUpgrade);
                return (
                  <button
                    key={i}
                    className="piece-chip"
                    disabled={!ok}
                    onClick={() => onApply(pickedUpgrade, i)}
                  >
                    <span className="piece-chip__title">
                      Piece {i + 1}
                      {p.king ? " ♔" : ""}
                    </span>
                    <span className="piece-chip__upgrades">
                      {p.upgrades.length
                        ? p.upgrades.map(upgradeName).join(", ")
                        : "no upgrades"}
                    </span>
                  </button>
                );
              })}
            </div>
            <button className="link-btn" onClick={() => setPickedUpgrade(null)}>
              ← back to upgrades
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface ResultPanelProps {
  kind: "game-over" | "run-complete";
  floor: number;
  onNewRun: () => void;
}

export function ResultPanel({ kind, floor, onNewRun }: ResultPanelProps) {
  const won = kind === "run-complete";
  return (
    <div className="overlay">
      <div className="panel panel--center">
        <h2>{won ? "Run complete! 🏆" : "Run over"}</h2>
        <p className="panel__hint">
          {won
            ? `You climbed all ${floor} floors.`
            : `You fell on floor ${floor}.`}
        </p>
        <button className="primary-btn" onClick={onNewRun}>
          New run
        </button>
      </div>
    </div>
  );
}
