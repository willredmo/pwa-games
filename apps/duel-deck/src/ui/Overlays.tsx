import { useEffect, useMemo, useRef, useState } from "react";
import "./overlays.css";
import type { AugmentDef, AugmentState } from "../game/augments";
import { AUGMENTS, MAX_FROZEN_AUGMENTS, RALLY_CAP, getAugment, rarityOf, unitsAffectedBy, type Rarity } from "../game/augments";
import { ARCHETYPES, KNIGHT_LEVEL, MAX_LEVEL, SYNERGIES, UNITS, UNIT_KEYS, levelOf } from "../engine/units";
import { levelLabel, levelTier } from "../board/render";
import { AUGMENT_EVERY, PICK_COUNT, START_HP } from "../game/match";
import { mvpOf, roundsPlayed, type MatchStats, type UnitTally } from "../game/stats";
import { prefersReducedMotion } from "../board/anim";
import { UNIT_LORE } from "../game/lore";
import { UnitPortrait } from "./UnitPortrait";

// Overlays: the augment offer track, the match-over panel, and help.
// Presentational — match state is owned by App.

interface AugmentPanelProps {
  round: number;
  offers: AugmentDef[];
  onPick: (id: string) => void;
  /**
   * Showing the board through the panel. The panel stays mounted and in place
   * (just faded out), so the toggle button never moves under the pointer.
   */
  peeking: boolean;
  /** Toggle `peeking`. */
  onPeek: () => void;
  /** Rerolls left on this choice, and the action that spends one. */
  rerollsLeft: number;
  onReroll: () => void;
  /** Upgrades frozen for the next choice (up to MAX_FROZEN_AUGMENTS). */
  frozenIds: string[];
  onFreeze: (id: string) => void;
}

const RARITY_LABEL: Record<Rarity, string> = { common: "Common", rare: "Rare", epic: "Epic" };

/** Rarity chip; commons get one too so the tiers read as a scale. */
function RarityTag({ rarity }: { rarity: Rarity }) {
  return <span className={`rarity rarity--${rarity}`}>{RARITY_LABEL[rarity]}</span>;
}

const CATEGORY_LABEL: Record<string, string> = {
  class: "Class",
  global: "Global",
  synergy: "Synergy",
  combat: "Combat",
  strategy: "Strategy",
};

const CONFETTI_COLORS = ["#f0b429", "#ff6b6b", "#4cc9f0", "#7bd88f", "#b26eff", "#fff6c8"];

export function AugmentPanel({
  round,
  offers,
  onPick,
  peeking,
  onPeek,
  rerollsLeft,
  onReroll,
  frozenIds,
  onFreeze,
}: AugmentPanelProps) {
  const freezeFull = frozenIds.length >= MAX_FROZEN_AUGMENTS;
  const [picked, setPicked] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const choose = (id: string) => {
    if (picked || peeking) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return onPick(id);
    setPicked(id);
    timer.current = window.setTimeout(() => onPick(id), 450);
  };
  return (
    <div className={`overlay${peeking ? " overlay--peek" : ""}`}>
      <div className={`panel panel--wide${peeking ? " panel--peek" : ""}`}>
        <div className="panel__head">
          <h2>Persistent upgrade</h2>
          {/* Several upgrades scale off your board, so let the player check it. */}
          <button className="ghost-btn ghost-btn--sm peek-toggle" onClick={onPeek}>
            {peeking ? "← Back to upgrades" : "View board"}
          </button>
        </div>
        <div className="panel__hint panel__hint--row">
          <span>Round {round} · lasts this match only</span>
          <button
            className="ghost-btn ghost-btn--sm"
            onClick={onReroll}
            disabled={rerollsLeft <= 0 || peeking || !!picked}
            title="Draw new upgrades (frozen ones stay)"
          >
            🎲 Reroll ({rerollsLeft})
          </button>
        </div>
        <div className={`cards cards--deal${picked ? " cards--picked" : ""}`}>
          {offers.map((a, i) => {
            const isFrozen = frozenIds.includes(a.id);
            return (
            <div className="card-row-wrap" key={a.id}>
            <button
              className={`card-row card-row--deal card-row--${a.category} card-row--${rarityOf(a)}${
                picked ? (picked === a.id ? " card-row--chosen" : " card-row--away") : ""
              }${frozenIds.includes(a.id) ? " card-row--frozen" : ""}`}
              style={{ "--i": i } as React.CSSProperties}
              onClick={() => choose(a.id)}
              tabIndex={peeking ? -1 : undefined}
            >
              <span className="card-row__head">
                <span className="card-row__name">
                  <span className="aura-icon">{a.icon}</span> {a.name}
                </span>
                <span className="tags">
                  <RarityTag rarity={rarityOf(a)} />
                  <span className={`tag tag--${a.category}`}>{CATEGORY_LABEL[a.category]}</span>
                </span>
              </span>
              <span className="card-row__desc">{a.description}</span>
            </button>
            {/* Freeze: offered first at your next upgrade choice. */}
            <button
              className={`freeze-btn freeze-btn--row${isFrozen ? " freeze-btn--on" : ""}`}
              onClick={() => onFreeze(a.id)}
              disabled={peeking || !!picked || (freezeFull && !isFrozen)}
              aria-pressed={isFrozen}
              aria-label={`Freeze ${a.name} for your next upgrade choice`}
              title={
                isFrozen
                  ? "Frozen: offered first next time. Click to unfreeze"
                  : freezeFull
                    ? `${MAX_FROZEN_AUGMENTS} frozen max: unfreeze one first`
                    : "Freeze: offer this first at your next upgrade choice"
              }
            >
              ❄
            </button>
            </div>
            );
          })}
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
      {defs.map((a, i) => (
        <div key={a.id} className="card-row card-row--static" style={{ "--i": i } as React.CSSProperties}>
          <span className="card-row__head">
            <span className="card-row__name">
              <span className="aura-icon">{a.icon}</span> {a.name}
            </span>
            <span className="tags">
              <RarityTag rarity={rarityOf(a)} />
              <span className={`tag tag--${a.category}`}>{CATEGORY_LABEL[a.category]}</span>
            </span>
          </span>
          <span className="card-row__desc">{a.description}</span>
        </div>
      ))}
    </div>
  );
}

const CATEGORY_ORDER = ["class", "global", "synergy", "combat", "strategy"];

/** Which unit types each augment affects; computed once, it never changes. */
const AFFECTS = new Map(AUGMENTS.map((a) => [a.id, unitsAffectedBy(a)]));
/** Touches every type, or none (strategy picks): not specific to any unit. */
const isGeneral = (id: string) => {
  const n = AFFECTS.get(id)?.length ?? 0;
  return n === 0 || n === UNIT_KEYS.length;
};

/** Every upgrade in the game, grouped by category, marked with who holds it. */
function AllAugments({ player, enemy }: { player: AugmentState; enemy: AugmentState }) {
  /** "all", "general", or a unit key: only upgrades specific to that unit. */
  const [filter, setFilter] = useState<string>("all");
  const shown = (id: string) =>
    filter === "all"
      ? true
      : filter === "general"
        ? isGeneral(id)
        : !isGeneral(id) && (AFFECTS.get(id) ?? []).includes(filter);
  const chips = ["all", ...UNIT_KEYS, "general"];
  const label = (c: string) => (c === "all" ? "All" : c === "general" ? "Any unit" : UNITS[c].name);
  return (
    <>
      <p className="panel__hint">
        Every upgrade that can be offered. Each can be taken once per match.
      </p>
      <div className="unit-filter" role="group" aria-label="Filter by unit">
        {chips.map((c) => (
          <button
            key={c}
            className={`unit-chip${filter === c ? " unit-chip--on" : ""}`}
            aria-pressed={filter === c}
            onClick={() => setFilter(c)}
          >
            {label(c)}
          </button>
        ))}
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const defs = AUGMENTS.filter((a) => a.category === cat && shown(a.id));
        if (defs.length === 0) return null;
        return (
          <section key={cat}>
            <h3>{CATEGORY_LABEL[cat]}</h3>
            <div className="cards">
              {defs.map((a, i) => {
                const mine = player.active.includes(a.id);
                const theirs = enemy.active.includes(a.id);
                return (
                  <div
                    key={a.id}
                    className={`card-row card-row--static card-row--${a.category}`}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <span className="card-row__head">
                      <span className="card-row__name">
                        <span className="aura-icon">{a.icon}</span> {a.name}
                      </span>
                      <span className="owned-tags">
                        <RarityTag rarity={rarityOf(a)} />
                        {mine && <span className="owned owned--you">You</span>}
                        {theirs && <span className="owned owned--enemy">Enemy</span>}
                      </span>
                    </span>
                    <span className="card-row__desc">{a.description}</span>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}

interface AugmentsViewProps {
  player: AugmentState;
  enemy: AugmentState;
  onClose: () => void;
}

/** Side-by-side view of both players' active upgrades. */
export function AugmentsView({ player, enemy, onClose }: AugmentsViewProps) {
  const [tab, setTab] = useState<"you" | "enemy" | "all">("you");
  const current = tab === "enemy" ? enemy : player;
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
            <button
              className={`tab${tab === "all" ? " tab--on" : ""}`}
              onClick={() => setTab("all")}
            >
              All ({AUGMENTS.length})
            </button>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {tab === "all" ? (
          <AllAugments player={player} enemy={enemy} />
        ) : (
        <AugmentList
          ids={current.active}
          empty={
            tab === "you"
              ? "No upgrades yet — you're offered one every 3rd round."
              : "The enemy has no upgrades yet."
          }
        />
        )}

        {tab !== "all" && (current.momentum > 0 || current.rally > 0) && (
          <>
            <h3>Stacks</h3>
            {/* Mirrors the effect fns in game/augments.ts (1 per 3 wins; 1 per 4 deaths, capped). */}
            <ul className="rules">
              {current.momentum > 0 && (
                <li>
                  Momentum: {current.momentum} rounds won → +{Math.floor(current.momentum / 3)} attack
                </li>
              )}
              {current.rally > 0 && (
                <li>
                  Berserker's rally: {current.rally} Berserkers fallen → +{Math.min(RALLY_CAP, Math.floor(current.rally / 4))} attack
                </li>
              )}
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
  stats: MatchStats;
  /** Both pools at the end. */
  hp: { player: number; enemy: number };
  /** Your upgrades, in pick order. */
  upgrades: string[];
  difficulty: string;
  onNewMatch: () => void;
}

/** Count a number up from 0 once, eased; instant under reduced motion. */
function useCountUp(target: number, delay: number): number {
  const [v, setV] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (prefersReducedMotion()) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const dur = 900;
    const step = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      setV(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, delay]);
  return v;
}

function Stat({ label, value, i, suffix = "", sub }: { label: string; value: number; i: number; suffix?: string; sub?: string }) {
  const n = useCountUp(value, 500 + i * 90);
  return (
    <div className="result-stat" style={{ "--i": i } as React.CSSProperties}>
      <span className="result-stat__value">
        {n}
        {suffix}
      </span>
      <span className="result-stat__label">{label}</span>
      {sub && <span className="result-stat__sub">{sub}</span>}
    </div>
  );
}

/** Shared with the title screen, which offers the same choice. */
export const DIFFICULTY_INFO: Record<string, { icon: string; blurb: string }> = {
  easy: { icon: "🌱", blurb: "Picks cards at random and never arranges its row. Good for learning the units." },
  normal: { icon: "⚔️", blurb: "Builds sensibly: fills its row, merges, and takes upgrades that suit it." },
  hard: { icon: "🔥", blurb: "Simulates every pair of picks against your row, and predicts what you'll add." },
};

/**
 * Start screen: pick the opponent before round 1. Shown for a fresh match and
 * after New match; the choice is fixed for the match.
 */
export function DifficultyPanel<D extends string>({
  options,
  labels,
  current,
  onChoose,
}: {
  options: readonly D[];
  labels: Record<D, string>;
  /** Last match's choice, marked so a repeat pick is one tap. */
  current: D;
  onChoose: (d: D) => void;
}) {
  return (
    <div className="overlay overlay--full overlay--start">
      <div className="panel panel--center start-panel">
        <div className="start-panel__emblem" aria-hidden="true">⚔</div>
        <h2>Duel Deck</h2>
        <p className="start-panel__sub">Choose your opponent</p>
        <div className="start-panel__options">
          {options.map((d, i) => {
            const info = DIFFICULTY_INFO[d] ?? { icon: "🤖", blurb: "" };
            return (
              <button
                key={d}
                className={`start-option start-option--${d}${d === current ? " start-option--last" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
                onClick={() => onChoose(d)}
              >
                <span className="start-option__icon" aria-hidden="true">{info.icon}</span>
                <span className="start-option__text">
                  <strong>
                    {labels[d]}
                    {d === current && <em>last pick</em>}
                  </strong>
                  <span>{info.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="start-panel__note">Fixed for the match. Start a new match from ☰ to change it.</p>
      </div>
    </div>
  );
}

/** A level chip in the board's tier colours. */
function LevelChip({ merges }: { merges: number }) {
  const lv = levelOf(merges);
  const tier = levelTier(lv);
  return (
    <span className="result-mvp__level" style={{ background: tier.fill, color: tier.ink }}>
      {levelLabel(lv)}
    </span>
  );
}

/**
 * Every unit that fought this match, per side: damage dealt and taken, kills,
 * falls. Units that left the row (merged into another, or replaced) stay
 * listed, faded, so the totals add up.
 */
function UnitLedger({ stats, winner }: { stats: MatchStats; winner: "player" | "enemy" }) {
  const [tab, setTab] = useState<"player" | "enemy">("player");
  const total = roundsPlayed(stats);
  const bookFor = (s: "player" | "enemy") => (s === "player" ? stats.units : (stats.foes ?? {}));
  const rows = Object.entries(bookFor(tab)).sort(
    ([, a], [, b]) => b.damage - a.damage || (b.taken ?? 0) - (a.taken ?? 0),
  );
  const sum = (k: (t: UnitTally) => number) => rows.reduce((n, [, t]) => n + k(t), 0);
  return (
    <section className="ledger">
      <div className="ledger__tabs" role="tablist">
        {(["player", "enemy"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            className={`ledger__tab ledger__tab--${s}${tab === s ? " ledger__tab--on" : ""}`}
            onClick={() => setTab(s)}
          >
            {s === "player" ? "Your units" : "Enemy units"} ({Object.keys(bookFor(s)).length})
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="ledger__empty">No units recorded for this side.</p>
      ) : (
        <table className="ledger__table">
          <thead>
            <tr>
              <th className="ledger__unit">Unit</th>
              <th title="Damage dealt">⚔ Dealt</th>
              <th title="Damage taken">🛡 Taken</th>
              <th title="Kills">☠ Kills</th>
              <th title="Times it fell">↓ Fell</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, t]) => {
              const gone = (t.last ?? total) < total;
              return (
                <tr key={id} className={gone ? "ledger__row--gone" : undefined} title={gone ? "Left the row (merged or replaced)" : undefined}>
                  <td className="ledger__unit">
                    {/* The winners dance, the losers mope. */}
                    <UnitPortrait unitKey={t.key} side={tab} size={30} merges={t.merges ?? 0} pose={tab === winner ? "dance" : "sad"} bleed={8} />
                    <span className="ledger__name">
                      <span>
                        {t.name} <LevelChip merges={t.merges ?? 0} />
                      </span>
                      {t.rounds ? (
                        <small>
                          {t.rounds} round{t.rounds === 1 ? "" : "s"}
                          {gone ? " · left the row" : ""}
                        </small>
                      ) : null}
                    </span>
                  </td>
                  <td>{t.damage}</td>
                  <td>{t.taken ?? 0}</td>
                  <td>{t.kills}</td>
                  <td>{t.falls ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="ledger__unit">Total</td>
              <td>{sum((t) => t.damage)}</td>
              <td>{sum((t) => t.taken ?? 0)}</td>
              <td>{sum((t) => t.kills)}</td>
              <td>{sum((t) => t.falls ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

/** Continuous backdrop: sunburst and confetti rain for a win, drifting embers for a loss. */
function ResultBackdrop({ won }: { won: boolean }) {
  const bits = useMemo(
    () =>
      Array.from({ length: won ? 46 : 34 }, (_, i) => ({
        "--x": `${(Math.random() * 100).toFixed(1)}%`,
        "--drift": `${Math.round((Math.random() - 0.5) * 160)}px`,
        "--r": `${Math.round(360 + Math.random() * 720)}deg`,
        "--d": `${(won ? 3.2 : 6) + Math.random() * 3}s`,
        "--dl": `${(-Math.random() * 8).toFixed(2)}s`,
        "--s": (0.6 + Math.random() * 0.8).toFixed(2),
        "--c": won ? CONFETTI_COLORS[i % CONFETTI_COLORS.length] : i % 3 ? "#ff7a45" : "#ffcf6b",
      })) as React.CSSProperties[],
    [won],
  );
  return (
    <div className={`result-fx ${won ? "result-fx--win" : "result-fx--lose"}`} aria-hidden="true">
      <div className="result-fx__rays" />
      <div className="result-fx__glow" />
      {bits.map((st, i) => (
        <i key={i} className={won ? "result-fx__confetti" : "result-fx__ember"} style={st} />
      ))}
    </div>
  );
}

export function ResultPanel({ winner, round, stats, hp, upgrades, difficulty, onNewMatch }: ResultPanelProps) {
  const won = winner === "player";
  const mvp = mvpOf(stats);
  const rounds = stats.won + stats.lost + stats.drawn;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / START_HP) * 100))}%`;
  return (
    <div className={`overlay overlay--result ${won ? "overlay--victory" : "overlay--defeat"}`}>
      <ResultBackdrop won={won} />
      <div className={`panel panel--center panel--result ${won ? "panel--victory" : "panel--defeat"}`}>
        <div className="result-emblem" aria-hidden="true">{won ? "🏆" : "🛡️"}</div>
        <h2>{won ? "Victory" : "Defeat"}</h2>
        <p className="result-sub">
          {won ? "You emptied their HP pool" : "Your HP pool hit zero"} on round {round} · {difficulty} AI
        </p>

        <div className="result-hp">
          <div className="result-hp__row">
            <span>You</span>
            <div className="result-hp__track"><div className="result-hp__fill result-hp__fill--player" style={{ width: pct(hp.player) }} /></div>
            <b>{Math.max(0, hp.player)}</b>
          </div>
          <div className="result-hp__row">
            <span>Enemy</span>
            <div className="result-hp__track"><div className="result-hp__fill result-hp__fill--enemy" style={{ width: pct(hp.enemy) }} /></div>
            <b>{Math.max(0, hp.enemy)}</b>
          </div>
        </div>

        {mvp && (
          <div className="result-mvp">
            <UnitPortrait unitKey={mvp.key} side="player" size={84} merges={mvp.merges ?? 0} pose={won ? "dance" : "sad"} bleed={40} />
            <div>
              <span className="result-mvp__tag">★ MVP</span>
              <strong>
                {mvp.name} <LevelChip merges={mvp.merges ?? 0} />
              </strong>
              <span>
                {mvp.damage} damage · {mvp.kills} kill{mvp.kills === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        )}

        <div className="result-stats">
          <Stat i={0} label="Rounds won" value={stats.won} sub={`${stats.won}W · ${stats.lost}L · ${stats.drawn}D of ${rounds}`} />
          <Stat i={1} label="Damage to enemy HP" value={stats.poolDealt} />
          <Stat i={2} label="Damage taken" value={stats.poolTaken} />
          <Stat i={3} label="Enemies slain" value={stats.kills} sub={`${stats.losses} of yours fell`} />
          <Stat i={4} label="Unit damage dealt" value={stats.unitDamage} sub={`${stats.unitDamageTaken} taken`} />
          <Stat
            i={5}
            label="Biggest hit"
            value={stats.biggestHit?.amount ?? 0}
            sub={stats.biggestHit ? `by a ${stats.biggestHit.name}` : undefined}
          />
          <Stat i={6} label="Abilities fired" value={stats.abilities} />
          <Stat i={7} label="Best win streak" value={stats.bestStreak} sub={stats.healed > 0 ? `healed ${stats.healed} HP` : undefined} />
        </div>

        <UnitLedger stats={stats} winner={winner} />

        {upgrades.length > 0 && (
          <div className="result-upgrades">
            {upgrades.map((id, i) => {
              const def = getAugment(id);
              if (!def) return null;
              return (
                <span key={id} className={`result-upgrade result-upgrade--${rarityOf(def)}`} style={{ "--i": i } as React.CSSProperties} title={`${def.name}: ${def.description}`}>
                  {def.icon} {def.name}
                </span>
              );
            })}
          </div>
        )}

        <button className="primary-btn" onClick={onNewMatch}>New match</button>
      </div>
    </div>
  );
}

/** Every unit: animated portrait, stats, backstory, and the upgrades built around it. */
export function UnitsView({ onClose }: { onClose: () => void }) {
  return (
    // Full-window, not inside the board like the other overlays: the stories
    // need reading width.
    <div className="overlay overlay--full" onClick={onClose}>
      <div className="panel panel--wide panel--scroll panel--codex" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head panel__head--sticky">
          <h2>Units</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {/* Classes first: they decide which units belong together. */}
        <section className="class-guide" aria-label="Classes">
          <p className="class-guide__intro">
            Every unit has a class. Fill <strong>every slot</strong> of your row with one class (5 units, or 6 with
            Reinforcements) and the whole row gets that class's bonus each round.
          </p>
          <div className="class-guide__list">
            {(["attack", "defense", "support"] as const).map((a) => {
              const members = UNIT_KEYS.filter((k) => UNITS[k].archetype === a);
              return (
                <div key={a} className={`class-card class-card--${a}`}>
                  <div className="class-card__head">
                    <span className="class-card__icon" aria-hidden="true">{ARCHETYPES[a].icon}</span>
                    <h3>{ARCHETYPES[a].name}</h3>
                  </div>
                  <div className="class-card__units">
                    {members.map((k) => (
                      <span key={k} className="class-card__unit">
                        <UnitPortrait unitKey={k} side="player" size={28} />
                        {UNITS[k].name}
                      </span>
                    ))}
                  </div>
                  <p className="class-card__bonus">
                    <strong>
                      {SYNERGIES[a].icon} {SYNERGIES[a].name}:
                    </strong>{" "}
                    {SYNERGIES[a].text}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
        <div className="unit-codex">
          {UNIT_KEYS.map((key, i) => {
            const u = UNITS[key];
            const lore = UNIT_LORE[key];
            const related = AUGMENTS.filter(
              (a) => !isGeneral(a.id) && (AFFECTS.get(a.id) ?? []).includes(key),
            );
            return (
              <article
                key={key}
                className="unit-entry"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="unit-entry__portrait">
                  <UnitPortrait unitKey={key} side="player" size={72} />
                </div>
                <div className="unit-entry__body">
                  <header className="unit-entry__head">
                    <h3>{u.name}</h3>
                    <span className="unit-entry__stats">
                      <span className="stat stat--atk">⚔{u.atk}</span>
                      <span className="stat stat--hp">♥{u.maxHp}</span>
                    </span>
                  </header>
                  {lore && <p className="unit-entry__title">{lore.title}</p>}
                  <p className="unit-entry__role">
                    {u.role} · {ARCHETYPES[u.archetype].icon} {ARCHETYPES[u.archetype].name}
                  </p>
                  {u.ability && (
                    <p className="unit-entry__ability">
                      <span className="unit-entry__ability-name">✦ {u.ability.name}</span>
                      <span className="unit-entry__ability-trigger">{u.ability.trigger}</span>
                      <span className="unit-entry__ability-text">{u.ability.text}</span>
                      {u.ability.scaling && (
                        <span className="unit-entry__ability-scaling">↑ {u.ability.scaling}</span>
                      )}
                      {u.mastery && (
                        <span className="unit-entry__ability-scaling">
                          ★ Level {MAX_LEVEL} (max): {u.mastery}
                        </span>
                      )}
                    </p>
                  )}
                  {u.offered === false && (
                    <p className="unit-entry__earned">
                      Never offered: a Squire is knighted when it reaches level {KNIGHT_LEVEL}. Stats shown are at
                      the moment of knighting, before upgrades.
                    </p>
                  )}
                  {lore && <p className="unit-entry__story">{lore.story}</p>}
                  {related.length > 0 && (
                    <p className="unit-entry__augs">
                      <span className="unit-entry__augs-label">Upgrades:</span>
                      {related.map((a) => (
                        <span key={a.id} className="unit-entry__aug" title={a.description}>
                          {a.icon} {a.name}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface ConfirmPanelProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small yes/no prompt over the board. Escape or a backdrop click cancels. */
export function ConfirmPanel(p: ConfirmPanelProps) {
  return (
    <div
      className="overlay"
      onClick={p.onCancel}
      onKeyDown={(e) => e.key === "Escape" && p.onCancel()}
    >
      <div
        className="panel panel--center panel--confirm"
        role="alertdialog"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{p.title}</h2>
        <p className="panel__hint">{p.message}</p>
        <div className="confirm-actions">
          {/* Cancel is focused first: Enter on a stray keypress keeps picking. */}
          <button className="ghost-btn" onClick={p.onCancel} autoFocus>
            {p.cancelLabel}
          </button>
          <button className="primary-btn" onClick={p.onConfirm}>
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface HelpPanelProps {
  onClose: () => void;
}

export function HelpPanel({ onClose }: HelpPanelProps) {
  // Short on purpose: the tutorial teaches by playing, the info cards (press
  // and hold a unit) and the Units screen hold the details.
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel panel--wide panel--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head panel__head--sticky">
          <h2>How to play</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <h3>The goal</h3>
        <ul className="rules">
          <li>Build a row of up to 5 units. Bring the enemy's HP to 0 before they do the same to you.</li>
        </ul>

        <h3>Each round</h3>
        <ul className="rules">
          <li>Take {PICK_COUNT} of the 5 cards dealt. Drop one on an empty slot to add it, or on a unit of the <strong>same type</strong> to merge.</li>
          <li>Press <strong>⚔ Battle</strong>. Only the two <strong>front</strong> units fight; when one falls, the next steps up.</li>
          <li>The side still standing wins the round. Each of its survivors hits the loser's HP for its attack.</li>
          <li>Fallen units come back next round at full health. Your row only grows.</li>
        </ul>

        <h3>Getting stronger</h3>
        <ul className="rules">
          <li><strong>Merging</strong> adds half the card's stats and a level. At level 10 (MAX) a unit's ability gets stronger.</li>
          <li><strong>Upgrades</strong>: every {AUGMENT_EVERY} rounds, pick one that lasts the whole match.</li>
          <li>
            <strong>Classes</strong>: fill every slot with one class for a bonus each round:{" "}
            {(["attack", "defense", "support"] as const).map((a, i) => (
              <span key={a}>
                {i ? ", " : ""}
                {ARCHETYPES[a].icon} {SYNERGIES[a].name}
              </span>
            ))}
            .
          </li>
        </ul>

        <h3>Handy</h3>
        <ul className="rules">
          <li>Press and hold (or hover) any unit or card to see what it does.</li>
          <li>Tap instead of dragging: tap a card or unit, then tap where it goes. Drag placed units to reorder.</li>
          <li>🎲 Reroll swaps untaken cards. ❄ keeps a card (or up to 2 upgrades) for next time. ↶ Undo takes a move back.</li>
          <li>With a full row, dropping on a different unit <strong>replaces</strong> it (outlined orange).</li>
        </ul>
      </div>
    </div>
  );
}