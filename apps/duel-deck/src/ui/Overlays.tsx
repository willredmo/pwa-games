import { useEffect, useRef, useState } from "react";
import "./overlays.css";
import { kawaiiName } from "../game/kawaii";
import type { AugmentDef, AugmentState } from "../game/augments";
import { OFFERED_AUGMENTS as AUGMENTS, RALLY_CAP, getAugment, rarityOf, unitsAffectedBy, type Rarity } from "../game/augments";
import { ARCHETYPES, KNIGHT_LEVEL, MAX_LEVEL, SYNERGIES, UNITS, UNIT_KEYS, levelOf } from "../engine/units";
import { levelLabel, levelTier } from "../board/render";
import type { Unit } from "../engine/types";
import { AUGMENT_EVERY, PICK_COUNT } from "../game/match";
import { mvpOf, roundsPlayed, type MatchStats, type UnitTally } from "../game/stats";
import { prefersReducedMotion } from "../board/anim";
import { UNIT_LORE } from "../game/lore";
import { UnitPortrait } from "./UnitPortrait";
import { ResultBackdrop } from "./ResultBackdrop";
import type { Growth } from "../game/roundEnd";

// Overlays: the augment offer track, the match-over panel, and help.
// Presentational — match state is owned by App.

interface AugmentPanelProps {
  round: number;
  offers: AugmentDef[];
  /** Take an upgrade; a choose-a-unit one comes with the unit it lands on. */
  onPick: (id: string, unitId?: string) => void;
  /**
   * Showing the board through the panel. The panel stays mounted and in place
   * (just faded out), so the toggle button never moves under the pointer.
   */
  peeking: boolean;
  /** Toggle `peeking`. */
  onPeek: () => void;
  /** Rerolls left on each card, by position, and the action that spends one. */
  rerollsLeft: number[];
  onReroll: (index: number) => void;
  /** Your row, for choose-a-unit upgrades. */
  units: Unit[];
  /** Whether choose-a-unit upgrade `id` can land on `unit`. */
  canTarget: (id: string, unit: Unit) => boolean;
}

/**
 * Taps on the upgrade cards are ignored this long after they're dealt (the
 * panel opening, or a reroll). The panel opens right as a battle ends, so a
 * tap meant for the board could otherwise land on a card still dealing in.
 */
const AUGMENT_ARM_MS = 600;

const RARITY_LABEL: Record<Rarity, string> = { silver: "Silver", gold: "Gold", prismatic: "Prismatic" };

/** Rarity chip; silvers get one too so the tiers read as a scale. */
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

/**
 * The upgrade choice, laid out like League's ARAM Mayhem: tall cards of one
 * rarity, each with its own reroll under it. Taking one is two steps (tap a
 * card, then "Take"), and a choose-a-unit upgrade adds a third: which unit.
 */
export function AugmentPanel({
  round,
  offers,
  onPick,
  peeking,
  onPeek,
  rerollsLeft,
  onReroll,
  units,
  canTarget,
}: AugmentPanelProps) {
  // Two steps, so one stray tap can't lock in an upgrade for the whole match:
  // tapping a card only selects it, and "Take" commits the selection.
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  /** A choose-a-unit upgrade taken, waiting for its unit. */
  const [targeting, setTargeting] = useState<AugmentDef | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const armedAt = useRef(0);
  // Re-arm whenever the cards change (opening, a reroll), and drop a selection
  // that was rerolled away.
  const offerKey = offers.map((a) => a.id).join();
  useEffect(() => {
    armedAt.current = performance.now() + AUGMENT_ARM_MS;
    setSelected((s) => (s && offers.some((a) => a.id === s) ? s : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerKey]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const select = (id: string) => {
    if (picked || peeking || performance.now() < armedAt.current) return;
    setSelected(id);
  };
  const selectedDef = offers.find((a) => a.id === selected);
  const choose = (id: string, unitId?: string) => {
    if (picked || peeking) return;
    if (prefersReducedMotion()) return onPick(id, unitId);
    setPicked(id);
    timer.current = window.setTimeout(() => onPick(id, unitId), 450);
  };
  const take = (def: AugmentDef) => {
    if (def.target) {
      setTargeting(def);
      setTargetId(null);
    } else choose(def.id);
  };
  // The cards' rarity (they share one; a pool that ran dry can mix them).
  const rarity = offers[0] ? rarityOf(offers[0]) : "silver";
  const targetUnit = units.find((u) => u.id === targetId);
  return (
    <div className={`overlay overlay--augment${peeking ? " overlay--peek" : ""}`}>
      <div className={`panel panel--wide aug-panel aug-panel--${rarity}${peeking ? " panel--peek" : ""}`}>
        <div className="panel__head">
          <h2 className="aug-panel__title">
            <span className={`aug-panel__rarity aug-panel__rarity--${rarity}`}>{RARITY_LABEL[rarity]}</span> upgrade
          </h2>
          {/* Several upgrades scale off your board, so let the player check it. */}
          <button className="ghost-btn ghost-btn--sm peek-toggle" onClick={onPeek}>
            {peeking ? "← Back to upgrades" : "View board"}
          </button>
        </div>
        <div className="panel__hint">
          Round {round} · lasts this match only · both players draw {RARITY_LABEL[rarity].toLowerCase()}
        </div>
        {targeting ? (
          <div className="aug-target">
            <div className="aug-target__head">
              <span className="aug-target__icon">{targeting.icon}</span>
              <span>
                <strong>{targeting.name}</strong>: choose the unit that {targeting.target?.verb}.
              </span>
            </div>
            <div className="aug-target__units">
              {units.map((u) => {
                const ok = canTarget(targeting.id, u);
                return (
                  <button
                    key={u.id}
                    className={`aug-unit${targetId === u.id ? " aug-unit--on" : ""}`}
                    disabled={!ok || !!picked || peeking}
                    onClick={() => setTargetId(u.id)}
                    aria-pressed={targetId === u.id}
                  >
                    <UnitPortrait unitKey={u.key} side="player" size={40} merges={u.merges} />
                    <span className="aug-unit__name">{UNITS[u.key]?.name ?? u.key}</span>
                    <span className="aug-unit__lv">
                      Lv {u.merges + 1} · ⚔{u.atk} ♥{u.maxHp}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="aug-target__actions">
              <button className="ghost-btn" onClick={() => setTargeting(null)} disabled={!!picked || peeking}>
                ← Other upgrades
              </button>
              <button
                className="primary-btn take-btn"
                disabled={!targetUnit || !!picked || peeking}
                onClick={() => targetUnit && choose(targeting.id, targetUnit.id)}
              >
                {targetUnit ? `${targeting.icon} ${UNITS[targetUnit.key]?.name ?? targetUnit.key}` : "Tap a unit"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`aug-cards${offers.length > 3 ? " aug-cards--many" : ""}${picked ? " aug-cards--picked" : ""}`}
              style={{ "--n": offers.length } as React.CSSProperties}
            >
              {offers.map((a, i) => (
                <div className="aug-col" key={`${i}:${a.id}`}>
                  <button
                    className={`aug-card aug-card--${rarityOf(a)}${
                      picked ? (picked === a.id ? " aug-card--chosen" : " aug-card--away") : ""
                    }${selected === a.id && !picked ? " aug-card--selected" : ""}`}
                    style={{ "--i": i } as React.CSSProperties}
                    onClick={() => select(a.id)}
                    aria-pressed={selected === a.id}
                    tabIndex={peeking ? -1 : undefined}
                  >
                    <span className="aug-card__bg" aria-hidden="true" />
                    <span className="aug-card__inner">
                      <span className="aug-card__icon" aria-hidden="true">
                        {a.icon}
                      </span>
                      <span className="aug-card__name">{a.name}</span>
                      <span className="aug-card__tag">{a.target ? "Choose a unit" : CATEGORY_LABEL[a.category]}</span>
                      <span className="aug-card__desc">{a.description}</span>
                    </span>
                    {selected === a.id && !picked && (
                      <span className="aug-card__check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                  <button
                    className="aug-reroll"
                    onClick={() => onReroll(i)}
                    disabled={(rerollsLeft[i] ?? 0) <= 0 || peeking || !!picked}
                    aria-label={`Reroll ${a.name}`}
                    title={(rerollsLeft[i] ?? 0) > 0 ? "Reroll this card" : "Already rerolled"}
                  >
                    ↻
                  </button>
                </div>
              ))}
            </div>
            <button
              className="primary-btn primary-btn--wide take-btn"
              onClick={() => selectedDef && take(selectedDef)}
              disabled={!selectedDef || !!picked || peeking}
              tabIndex={peeking ? -1 : undefined}
            >
              {selectedDef ? (
                <>
                  Take {selectedDef.icon} {selectedDef.name}
                </>
              ) : (
                "Tap an upgrade to choose it"
              )}
            </button>
          </>
        )}
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
  /** What both pools started at. */
  startHp: number;
  /** Your upgrades, in pick order. */
  upgrades: string[];
  /** Who it was against, e.g. "Normal AI" or "online duel". */
  opponent: string;
  onNewMatch: () => void;
  /** The New match button's label (online it leaves the duel). */
  newMatchLabel?: string;
  /** Watch the final fight again (absent when there's none to show). */
  onReplay?: () => void;
  /** Online only: the rematch handshake (both players must ask). */
  rematch?: RematchState;
  /** Report a bug or suggest a feature. */
  onFeedback?: () => void;
  /** The match's level cap, for the level chips. */
  levelCap?: number;
}

export interface RematchState {
  /** This player has asked for a rematch. */
  asked: boolean;
  /** The opponent has asked for one. */
  offered: boolean;
  /** Why a rematch can't happen (the opponent left), if it can't. */
  unavailable?: string;
  /** The opponent is disconnected right now (they may come back). */
  away: boolean;
  onAsk: () => void;
  onCancel: () => void;
}

/** The rematch line on an online result screen: ask, accept, wait or take it back. */
function RematchBlock({ r }: { r: RematchState }) {
  if (r.unavailable) return <p className="result-rematch result-rematch--off">{r.unavailable}</p>;
  if (r.asked && r.offered) {
    return (
      <p className="result-rematch result-rematch--go" role="status">
        <span className="lobby__spinner" aria-hidden="true" /> Both ready — starting the rematch…
      </p>
    );
  }
  if (r.asked) {
    return (
      <div className="result-rematch" role="status">
        <span>
          <span className="lobby__spinner" aria-hidden="true" />{" "}
          {r.away ? "Rematch asked — your opponent is offline right now…" : "Rematch asked — waiting for your opponent to accept…"}
        </span>
        <button className="ghost-btn ghost-btn--sm" onClick={r.onCancel}>Take it back</button>
      </div>
    );
  }
  if (r.offered) {
    return (
      <div className="result-rematch result-rematch--offer" role="status">
        <span>🔁 Your opponent wants a rematch!</span>
        <button className="primary-btn" onClick={r.onAsk} autoFocus>
          Accept<span className="hud__long"> rematch</span>
        </button>
      </div>
    );
  }
  return (
    <div className="result-rematch result-rematch--ask">
      <button className="primary-btn" onClick={r.onAsk}>🔁 Rematch</button>
      <small>{r.away ? "Your opponent is offline right now." : "Starts when your opponent accepts too. Same settings."}</small>
    </div>
  );
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
  hard: { icon: "🔥", blurb: "Simulates every pick against your row, predicts what you'll add, and builds toward maxed units." },
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
function LevelChip({ merges, cap = MAX_LEVEL }: { merges: number; cap?: number }) {
  const lv = levelOf(merges);
  const tier = levelTier(lv, cap);
  return (
    <span className="result-mvp__level" style={{ background: tier.fill, color: tier.ink }}>
      {levelLabel(lv, cap)}
    </span>
  );
}

/**
 * Every unit that fought this match, per side: damage dealt and taken, kills,
 * falls. Units that left the row (merged into another, or replaced) stay
 * listed, faded, so the totals add up.
 */
function UnitLedger({ stats, winner, cap, round }: { stats: MatchStats; winner: "player" | "enemy" | null; cap?: number; round?: boolean }) {
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
              <th title="Damage dealt">⚔<span className="ledger__word"> Dealt</span></th>
              <th title="Damage taken">💢<span className="ledger__word"> Taken</span></th>
              <th title="Damage blocked by armour, shields and dodges">🛡<span className="ledger__word"> Blocked</span></th>
              <th title="Health restored (Mend, lifesteal)">✚<span className="ledger__word"> Healed</span></th>
              <th title="Kills">☠<span className="ledger__word"> Kills</span></th>
              <th title="Times it fell">↓<span className="ledger__word"> Fell</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([id, t]) => {
              const gone = (t.last ?? total) < total;
              return (
                <tr key={id} className={gone ? "ledger__row--gone" : undefined} title={gone ? "Left the row (merged or replaced)" : undefined}>
                  <td className="ledger__unit">
                    {/* The winners dance, the losers mope. */}
                    <UnitPortrait unitKey={t.key} side={tab} size={30} merges={t.merges ?? 0} pose={!winner ? "idle" : tab === winner ? "dance" : "sad"} bleed={8} />
                    <span className="ledger__name">
                      <span>
                        {tab === "player" ? kawaiiName(t.key, t.name) : t.name} <LevelChip merges={t.merges ?? 0} cap={cap} />
                      </span>
                      {t.rounds && !round ? (
                        <small>
                          {t.rounds} round{t.rounds === 1 ? "" : "s"}
                          {gone ? " · left the row" : ""}
                        </small>
                      ) : null}
                    </span>
                  </td>
                  <td>{t.damage}</td>
                  <td>{t.taken ?? 0}</td>
                  <td>{t.blocked ?? 0}</td>
                  <td>{t.healing ?? 0}</td>
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
              <td>{sum((t) => t.blocked ?? 0)}</td>
              <td>{sum((t) => t.healing ?? 0)}</td>
              <td>{sum((t) => t.kills)}</td>
              <td>{sum((t) => t.falls ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}

export function ResultPanel({ winner, round, stats, hp, startHp, upgrades, opponent, onNewMatch, newMatchLabel, onReplay, rematch, onFeedback, levelCap }: ResultPanelProps) {
  const won = winner === "player";
  const mvp = mvpOf(stats);
  const rounds = stats.won + stats.lost + stats.drawn;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / startHp) * 100))}%`;
  return (
    <div className={`overlay overlay--result ${won ? "overlay--victory" : "overlay--defeat"}`}>
      <ResultBackdrop won={won} />
      <div className={`panel panel--center panel--result ${won ? "panel--victory" : "panel--defeat"}`}>
        <div className="result-emblem" aria-hidden="true">{won ? "🏆" : "🛡️"}</div>
        <h2>{won ? "Victory" : "Defeat"}</h2>
        <p className="result-sub">
          {won ? "You emptied their HP pool" : "Your HP pool hit zero"} on round {round} · {opponent}
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
                {kawaiiName(mvp.key, mvp.name)} <LevelChip merges={mvp.merges ?? 0} cap={levelCap} />
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
          <Stat i={4} label="Unit damage dealt" value={stats.unitDamage} sub={`${stats.unitDamageTaken} taken · ${stats.unitBlocked ?? 0} blocked`} />
          <Stat
            i={5}
            label="Biggest hit"
            value={stats.biggestHit?.amount ?? 0}
            sub={stats.biggestHit ? `by a ${stats.biggestHit.name}` : undefined}
          />
          <Stat i={6} label="Abilities fired" value={stats.abilities} sub={stats.unitHealing ? `${stats.unitHealing} healing done` : undefined} />
          <Stat i={7} label="Best win streak" value={stats.bestStreak} sub={stats.healed > 0 ? `healed ${stats.healed} HP` : undefined} />
        </div>

        <UnitLedger stats={stats} winner={winner} cap={levelCap} />

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

        {/* Pinned to the bottom of the screen while the stats scroll under
            it, so Rematch / New match never sit a phone-screen away. */}
        <div className="result-footer">
        {rematch && <RematchBlock r={rematch} />}

        <div className="result-actions">
          {onReplay && (
            <button className="ghost-btn" onClick={onReplay}>
              ↻ Replay<span className="hud__long"> final fight</span>
            </button>
          )}
          <button className={rematch ? "ghost-btn" : "primary-btn"} onClick={onNewMatch}>{newMatchLabel ?? "New match"}</button>
        </div>
        {onFeedback && (
          <button className="link-btn result-feedback" onClick={onFeedback}>🐞 Report a bug or suggest a feature</button>
        )}
        </div>
      </div>
    </div>
  );
}

type CodexTab = "units" | "upgrades";
const CLASS_ORDER = ["attack", "defense", "support"] as const;
const unitAnchor = (key: string) => `codex-unit-${key}`;
const augAnchor = (id: string) => `codex-aug-${id}`;
/** The upgrades built around a unit (not the ones that touch every unit). */
const upgradesFor = (key: string) => AUGMENTS.filter((a) => !isGeneral(a.id) && (AFFECTS.get(a.id) ?? []).includes(key));

/**
 * The codex: every unit (by class, with its ability, story and upgrades) and
 * every upgrade (with the units it's built around), cross-linked both ways.
 */
export function CodexView({ onClose, initialTab = "units" }: { onClose: () => void; initialTab?: CodexTab }) {
  const [tab, setTab] = useState<CodexTab>(initialTab);
  /** The entry to scroll to and flash once the tab it lives on has rendered. */
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) {
      scroller.current?.scrollTo({ top: 0 });
      return;
    }
    const el = document.getElementById(focus.id);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.classList.remove("codex-flash");
    void el.offsetWidth; // restart the flash when it's the same entry again
    el.classList.add("codex-flash");
  }, [focus, tab]);

  const go = (t: CodexTab, id: string) => {
    setTab(t);
    setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };
  const switchTab = (t: CodexTab) => {
    setTab(t);
    setFocus(null);
  };

  return (
    // Full-window, not inside the board like the other overlays: the stories
    // need reading width.
    <div className="overlay overlay--full" onClick={onClose}>
      <div ref={scroller} className="panel panel--wide panel--scroll panel--codex" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head panel__head--sticky">
          <h2>Codex</h2>
          <div className="tabs" role="tablist">
            {(["units", "upgrades"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " tab--on" : ""}`} onClick={() => switchTab(t)}>
                {t === "units" ? `Units (${UNIT_KEYS.length})` : `Upgrades (${AUGMENTS.length})`}
              </button>
            ))}
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {tab === "units" ? (
          <CodexUnits onUnit={(k) => go("units", unitAnchor(k))} onAug={(id) => go("upgrades", augAnchor(id))} />
        ) : (
          <CodexUpgrades onUnit={(k) => go("units", unitAnchor(k))} />
        )}
      </div>
    </div>
  );
}

function CodexUnits({ onUnit, onAug }: { onUnit: (key: string) => void; onAug: (id: string) => void }) {
  let n = 0;
  return (
    <>
      {/* Classes first: they decide which units belong together. */}
      <section className="class-guide" aria-label="Classes">
        <p className="class-guide__intro">
          Every unit has a class. Field <strong>5 or more units, all of one class</strong>, and the whole row gets
          that class's bonus each round. Tap a unit to jump to it.
        </p>
        <div className="class-guide__list">
          {CLASS_ORDER.map((a) => (
            <div key={a} className={`class-card class-card--${a}`}>
              <div className="class-card__head">
                <span className="class-card__icon" aria-hidden="true">{ARCHETYPES[a].icon}</span>
                <h3>{ARCHETYPES[a].name}</h3>
              </div>
              <div className="class-card__units">
                {UNIT_KEYS.filter((k) => UNITS[k].archetype === a).map((k) => (
                  <button key={k} className="class-card__unit" onClick={() => onUnit(k)}>
                    <UnitPortrait unitKey={k} side="player" size={28} />
                    {UNITS[k].name}
                  </button>
                ))}
              </div>
              <p className="class-card__bonus">
                <strong>
                  {SYNERGIES[a].icon} {SYNERGIES[a].name}:
                </strong>{" "}
                {SYNERGIES[a].text}
              </p>
            </div>
          ))}
        </div>
      </section>
      {CLASS_ORDER.map((a) => (
        <section key={a} className="unit-codex" aria-label={ARCHETYPES[a].name}>
          <h3 className={`codex-class codex-class--${a}`}>
            {ARCHETYPES[a].icon} {ARCHETYPES[a].name}
          </h3>
          {UNIT_KEYS.filter((k) => UNITS[k].archetype === a).map((key) => {
            const u = UNITS[key];
            const lore = UNIT_LORE[key];
            const related = upgradesFor(key);
            return (
              <article key={key} id={unitAnchor(key)} className="unit-entry codex-anchor" style={{ "--i": n++ } as React.CSSProperties}>
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
                      {u.ability.scaling && <span className="unit-entry__ability-scaling">↑ {u.ability.scaling}</span>}
                      {u.mastery && (
                        <span className="unit-entry__ability-scaling">
                          ★ At the level cap ({MAX_LEVEL} unless the match sets another): {u.mastery}
                        </span>
                      )}
                    </p>
                  )}
                  {u.offered === false && (
                    <p className="unit-entry__earned">
                      Never offered: a Squire is knighted when it reaches level {KNIGHT_LEVEL}. Stats shown are at the
                      moment of knighting, before upgrades.
                    </p>
                  )}
                  {lore && <p className="unit-entry__story">{lore.story}</p>}
                  {related.length > 0 && (
                    <p className="unit-entry__augs">
                      <span className="unit-entry__augs-label">Upgrades:</span>
                      {related.map((a) => (
                        <button key={a.id} className="unit-entry__aug" title={a.description} onClick={() => onAug(a.id)}>
                          {a.icon} {a.name}
                        </button>
                      ))}
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      ))}
    </>
  );
}

function CodexUpgrades({ onUnit }: { onUnit: (key: string) => void }) {
  return (
    <>
      <p className="panel__hint">
        Every upgrade that can be offered. You pick one every {AUGMENT_EVERY} rounds and each can be taken once per
        match. Each choice deals three cards of one rarity, the same for both players: silver, gold or prismatic,
        at 50%, 35% and 15% every time. Each card can be rerolled once.
      </p>
      {CATEGORY_ORDER.map((cat) => {
        const defs = AUGMENTS.filter((a) => a.category === cat);
        if (defs.length === 0) return null;
        return (
          <section key={cat}>
            <h3>{CATEGORY_LABEL[cat]}</h3>
            <div className="cards">
              {defs.map((a, i) => {
                const units = isGeneral(a.id) ? [] : (AFFECTS.get(a.id) ?? []);
                return (
                  <div
                    key={a.id}
                    id={augAnchor(a.id)}
                    className={`card-row card-row--static card-row--${a.category} codex-anchor`}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <span className="card-row__head">
                      <span className="card-row__name">
                        <span className="aura-icon">{a.icon}</span> {a.name}
                      </span>
                      <RarityTag rarity={rarityOf(a)} />
                    </span>
                    <span className="card-row__desc">{a.description}</span>
                    {units.length > 0 && (
                      <span className="unit-entry__augs">
                        <span className="unit-entry__augs-label">Units:</span>
                        {units.map((k) => (
                          <button key={k} className="unit-entry__aug codex-unit-chip" onClick={() => onUnit(k)}>
                            <UnitPortrait unitKey={k} side="player" size={18} />
                            {UNITS[k].name}
                          </button>
                        ))}
                      </span>
                    )}
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

/**
 * The last round, unit by unit (opened from the log row between rounds): who
 * dealt, took, blocked and healed what. `stats` holds that round alone.
 */
export function RoundStatsPanel({ round, stats, winner, cap, onClose }: {
  round: number;
  stats: MatchStats;
  winner: "player" | "enemy" | null;
  cap?: number;
  onClose: () => void;
}) {
  const verdict = winner === "player" ? "You held the row" : winner === "enemy" ? "The enemy held the row" : "Both rows fell";
  const foes = Object.values(stats.foes ?? {});
  const foeSum = (k: (t: UnitTally) => number) => foes.reduce((n, t) => n + k(t), 0);
  const rows: [string, number, number][] = [
    ["⚔ Damage dealt", stats.unitDamage, stats.unitDamageTaken],
    ["🛡 Blocked", stats.unitBlocked ?? 0, foeSum((t) => t.blocked ?? 0)],
    ["✚ Healed", stats.unitHealing ?? 0, foeSum((t) => t.healing ?? 0)],
    ["☠ Kills", stats.kills, stats.losses],
  ];
  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div
        className="panel panel--center panel--round-stats"
        role="dialog"
        aria-labelledby="round-stats-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="round-stats-title">Round {round}</h2>
        <p className="panel__hint">{verdict}</p>
        <table className="round-stats__vs">
          <thead>
            <tr>
              <th />
              <th className="round-stats__you">You</th>
              <th className="round-stats__foe">Enemy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, you, foe]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className={you > foe ? "round-stats__more" : undefined}>{you}</td>
                <td className={foe > you ? "round-stats__more" : undefined}>{foe}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <UnitLedger stats={stats} winner={winner} cap={cap} round />
        <div className="confirm-actions">
          <button className="primary-btn" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The "units upgraded" step: which of your units just gained permanent stats
 * (Veteran, Fortify, a choose-a-unit upgrade…) and from what, before the
 * round's picks. Gains are easy to miss as a number on the board.
 */
export function GrowthPanel({ rows, onClose }: { rows: { unit: Unit; gains: Growth[] }[]; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div
        className="panel panel--center panel--growth"
        role="dialog"
        aria-labelledby="growth-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="growth-title">⬆ Units upgraded</h2>
        <p className="panel__hint">Permanent, for the rest of the match.</p>
        <ul className="growth-list">
          {rows.map(({ unit, gains }, i) => (
            <li key={unit.id} className="growth-row" style={{ "--i": i } as React.CSSProperties}>
              <UnitPortrait unitKey={unit.key} side="player" size={36} merges={unit.merges} pose="dance" bleed={8} />
              <span className="growth-row__name">
                {kawaiiName(unit.key, unit.name)} <LevelChip merges={unit.merges} />
              </span>
              <span className="growth-row__gains">
                {gains.map((g, j) => (
                  <span key={j} className="growth-gain">
                    <span className="growth-gain__stats">
                      {g.levels ? <b className="growth-gain__lv">+{g.levels} Lv</b> : null}
                      {g.atk > 0 ? <b className="stat stat--atk">+{g.atk}⚔</b> : null}
                      {g.hp > 0 ? <b className="stat stat--hp">+{g.hp}♥</b> : null}
                    </span>
                    <small>
                      <span aria-hidden="true">{g.icon}</span> {g.source}
                    </small>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="confirm-actions">
          <button className="primary-btn" onClick={onClose} autoFocus>
            Got it
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
          <li><strong>Merging</strong> adds half the card's stats and a level. At the level cap (MAX, {MAX_LEVEL} unless the match settings change it) a unit's ability gets stronger.</li>
          <li><strong>Upgrades</strong>: every {AUGMENT_EVERY} rounds, pick one that lasts the whole match.</li>
          <li>
            <strong>Classes</strong>: field 5 or more units, all one class, for a bonus each round:{" "}
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