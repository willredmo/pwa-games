import { useEffect, useMemo, useRef, useState } from "react";
import "./overlays.css";
import type { AugmentDef, AugmentState } from "../game/augments";
import { AUGMENTS, RALLY_CAP, getAugment, rarityOf, unitsAffectedBy, type Rarity } from "../game/augments";
import { KNIGHT_AT, UNITS, UNIT_KEYS } from "../engine/units";
import { AUGMENT_EVERY, PICK_COUNT, START_HP } from "../game/match";
import { mvpOf, type MatchStats } from "../game/stats";
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
}: AugmentPanelProps) {
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
            title="Draw three new upgrades"
          >
            🎲 Reroll ({rerollsLeft})
          </button>
        </div>
        <div className={`cards cards--deal${picked ? " cards--picked" : ""}`}>
          {offers.map((a, i) => (
            <button
              key={a.id}
              className={`card-row card-row--deal card-row--${a.category} card-row--${rarityOf(a)}${
                picked ? (picked === a.id ? " card-row--chosen" : " card-row--away") : ""
              }`}
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
            <UnitPortrait unitKey={mvp.key} side="player" size={72} />
            <div>
              <span className="result-mvp__tag">★ MVP</span>
              <strong>{mvp.name}</strong>
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
                  <p className="unit-entry__role">{u.role}</p>
                  {u.ability && (
                    <p className="unit-entry__ability">
                      <span className="unit-entry__ability-name">✦ {u.ability.name}</span>
                      <span className="unit-entry__ability-trigger">{u.ability.trigger}</span>
                      <span className="unit-entry__ability-text">{u.ability.text}</span>
                      {u.ability.scaling && (
                        <span className="unit-entry__ability-scaling">↑ {u.ability.scaling}</span>
                      )}
                    </p>
                  )}
                  {u.offered === false && (
                    <p className="unit-entry__earned">
                      Never offered: a Squire is knighted after {KNIGHT_AT} merges. Stats shown are at
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
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel panel--wide panel--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head panel__head--sticky">
          <h2>Units &amp; rules</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cards">
          {UNIT_KEYS.map((key, i) => {
            const u = UNITS[key];
            return (
              <div key={key} className="card-row card-row--static" style={{ "--i": i } as React.CSSProperties}>
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
          <li>The round ends when one side's row is empty. Each of the winner's <em>surviving units</em> then hits the loser's HP for its attack — so keeping units alive matters, not just winning.</li>
          <li>Nothing is lost: fallen units respawn at the end of the round, and everyone returns to full health. Your row only ever grows.</li>
          <li>Every {AUGMENT_EVERY} rounds, before you pick units, you choose a persistent upgrade — a separate track from unit picks. They last this match only. The header shows when the next one is due.</li>
          <li>Units show a small icon for each upgrade currently boosting them, so you can see where their numbers come from. Conditional upgrades (Overwhelm, Desperate measures) only show while they're actually firing. Open <strong>Upgrades</strong> to match an icon to its name — the enemy's units are badged too.</li>
          <li>First player to 0 HP loses.</li>
        </ul>
      </div>
    </div>
  );
}
