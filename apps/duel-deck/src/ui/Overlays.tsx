import { useState } from "react";
import type { AugmentDef, AugmentState } from "../game/augments";
import { getAugment } from "../game/augments";
import { UNITS, UNIT_KEYS } from "../engine/units";
import { AUGMENT_EVERY, PICK_COUNT } from "../game/match";

// Overlays: the augment offer track, the match-over panel, and help.
// Presentational — match state is owned by App.

interface AugmentPanelProps {
  round: number;
  offers: AugmentDef[];
  onPick: (id: string) => void;
  /** Temporarily hide this panel so the board underneath is visible. */
  onPeek: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  class: "Class",
  global: "Global",
  synergy: "Synergy",
};

export function AugmentPanel({ round, offers, onPick, onPeek }: AugmentPanelProps) {
  return (
    <div className="overlay">
      <div className="panel panel--wide">
        <div className="panel__head">
          <h2>Persistent upgrade</h2>
          {/* Several upgrades scale off your board, so let the player check it. */}
          <button className="ghost-btn ghost-btn--sm" onClick={onPeek}>
            View board
          </button>
        </div>
        <p className="panel__hint">
          Round {round} · lasts this match only
        </p>
        <div className="cards">
          {offers.map((a) => (
            <button key={a.id} className="card-row" onClick={() => onPick(a.id)}>
              <span className="card-row__head">
                <span className="card-row__name">
                  <span className="aura-icon">{a.icon}</span> {a.name}
                </span>
                <span className={`tag tag--${a.category}`}>{CATEGORY_LABEL[a.category]}</span>
              </span>
              <span className="card-row__desc">{a.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AugmentList({ ids, empty }: { ids: string[]; empty: string }) {
  const defs = ids.map(getAugment).filter((a): a is AugmentDef => !!a);
  if (defs.length === 0) return <p className="panel__hint">{empty}</p>;
  return (
    <div className="cards">
      {defs.map((a) => (
        <div key={a.id} className="card-row card-row--static">
          <span className="card-row__head">
            <span className="card-row__name">
              <span className="aura-icon">{a.icon}</span> {a.name}
            </span>
            <span className={`tag tag--${a.category}`}>{CATEGORY_LABEL[a.category]}</span>
          </span>
          <span className="card-row__desc">{a.description}</span>
        </div>
      ))}
    </div>
  );
}

interface AugmentsViewProps {
  player: AugmentState;
  enemy: AugmentState;
  onClose: () => void;
}

/** Side-by-side view of both players' active upgrades. */
export function AugmentsView({ player, enemy, onClose }: AugmentsViewProps) {
  const [tab, setTab] = useState<"you" | "enemy">("you");
  const current = tab === "you" ? player : enemy;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel panel--wide panel--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head panel__head--sticky">
          <div className="tabs">
            <button
              className={`tab${tab === "you" ? " tab--on" : ""}`}
              onClick={() => setTab("you")}
            >
              You ({player.active.length})
            </button>
            <button
              className={`tab${tab === "enemy" ? " tab--on" : ""}`}
              onClick={() => setTab("enemy")}
            >
              Enemy ({enemy.active.length})
            </button>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <AugmentList
          ids={current.active}
          empty={
            tab === "you"
              ? "No upgrades yet — you're offered one every 3rd round."
              : "The enemy has no upgrades yet."
          }
        />

        {(current.momentum > 0 || current.rally > 0) && (
          <>
            <h3>Stacks</h3>
            <ul className="rules">
              {current.momentum > 0 && <li>Momentum: +{current.momentum} attack (rounds won)</li>}
              {current.rally > 0 && <li>Berserker's rally: +{current.rally} attack</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

interface ResultPanelProps {
  winner: "player" | "enemy";
  round: number;
  onNewMatch: () => void;
}

export function ResultPanel({ winner, round, onNewMatch }: ResultPanelProps) {
  const won = winner === "player";
  return (
    <div className="overlay">
      <div className="panel panel--center">
        <h2>{won ? "Victory 🏆" : "Defeat"}</h2>
        <p className="panel__hint">
          {won ? "You emptied their HP pool" : "Your HP pool hit zero"} on round {round}.
        </p>
        <button className="primary-btn" onClick={onNewMatch}>New match</button>
      </div>
    </div>
  );
}

interface HelpPanelProps {
  onClose: () => void;
}

export function HelpPanel({ onClose }: HelpPanelProps) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel panel--wide panel--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head panel__head--sticky">
          <h2>Units &amp; rules</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cards">
          {UNIT_KEYS.map((key) => {
            const u = UNITS[key];
            return (
              <div key={key} className="card-row card-row--static">
                <span className="card-row__head">
                  <span className="card-row__name">{u.name}</span>
                  <span className="card-row__stats">⚔{u.atk} · ♥{u.maxHp}</span>
                </span>
                <span className="card-row__desc">{u.role}</span>
              </div>
            );
          })}
        </div>

        <h3>How a round works</h3>
        <ul className="rules">
          <li>Pick {PICK_COUNT} of {5} offered units each round. Picks are free — there's no economy. Each offer can only be taken once, so your {PICK_COUNT} picks are always different cards.</li>
          <li>Drag an offer onto an <em>empty slot</em> to add it as a new unit, or onto <em>one of your units of the same type</em> to merge. Only like merges with like.</li>
          <li><strong>Clicking works everywhere dragging does.</strong> Click an offer or one of your units to pick it up, then click where it should go. Click it again to put it back down. Dashed outlines show the legal destinations.</li>
          <li>A merged unit gives <strong>half</strong> its attack and health to the target, permanently (shown as a +N badge). You lose stats overall versus placing it separately — what you gain is concentration: a tougher unit holding the front instead of another body behind it.</li>
          <li>When your row is <strong>full</strong>, you can also drop an offer onto a unit of a <em>different</em> type to <strong>replace</strong> it. The old unit is discarded, along with anything merged into it — the slot outlines orange to warn you.</li>
          <li>Move placed units to reorder the queue — only the front one fights, so position matters.</li>
          <li>Putting a placed unit onto <em>another of the same type</em> merges the two instead: the one you moved is absorbed for half its stats and leaves the board. Free — it costs a body, not a pick.</li>
          <li>Only the front-most unit on each side fights. Both strike at once, so a unit that dies still deals its damage.</li>
          <li>When a front unit dies, the next in your queue steps up.</li>
          <li>The round ends when one side's row is empty. The winner's <em>total damage dealt that round</em> comes off the loser's HP.</li>
          <li>Nothing is lost: fallen units respawn at the end of the round, and everyone returns to full health. Your row only ever grows.</li>
          <li>Every {AUGMENT_EVERY} rounds you're offered a persistent upgrade — a separate track from unit picks. They last this match only.</li>
          <li>Units show a small icon for each upgrade currently boosting them, so you can see where their numbers come from. Conditional upgrades (Overwhelm, Desperate measures) only show while they're actually firing. Open <strong>Upgrades</strong> to match an icon to its name — the enemy's units are badged too.</li>
          <li>First player to 0 HP loses.</li>
        </ul>
      </div>
    </div>
  );
}
