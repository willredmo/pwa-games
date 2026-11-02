import { useMemo, useState } from "react";
import { sideUnits } from "../engine/board";
import { UNITS } from "../engine/units";
import { getAugment, rarityOf } from "../game/augments";
import {
  challengeRound,
  dailyChallenge,
  dayKey,
  grownUnit,
  loadResults,
  pastDays,
  type ChallengeAnswer,
  type ChallengeLevel,
} from "../game/challenge";
import { ENEMY, PLAYER } from "../game/match";
import { UnitPortrait } from "./UnitPortrait";

// The daily challenge screen: the day's enemy row, the units and upgrades
// you're dealt, and your row. Pick up to five units (tap to add, ↑ ↓ to
// reorder, ✕ to take one out) and two upgrades, then Battle: App plays the
// round in a Game and comes back here with the result. Past days are playable
// too; results are kept on this device (game/challenge.ts).

const LEVEL_LABEL: Record<ChallengeLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

function dayLabel(day: string): string {
  const today = dayKey();
  if (day === today) return "Today";
  if (day === pastDays(today, 2)[1]) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface ChallengeScreenProps {
  day: string;
  answer?: ChallengeAnswer;
  /** The last try's result, to show as the screen comes back. */
  last?: boolean;
  onDay: (day: string) => void;
  onPlay: (day: string, answer: ChallengeAnswer) => void;
  onClose: () => void;
}

export function ChallengeScreen({ day, answer, last, onDay, onPlay, onClose }: ChallengeScreenProps) {
  const ch = useMemo(() => dailyChallenge(day), [day]);
  const [row, setRow] = useState<number[]>(() => answer?.row ?? []);
  const [ups, setUps] = useState<string[]>(() => answer?.upgrades ?? []);
  const results = useMemo(loadResults, [day, last]);
  const result = results[day];
  // The enemy as it will fight: its upgrades applied.
  const enemy = useMemo(() => sideUnits(challengeRound(ch, { row: [], upgrades: [] }).board, ENEMY), [ch]);
  const pool = useMemo(() => ch.units.map((u) => grownUnit(u, PLAYER)), [ch]);

  const toggleUnit = (i: number) =>
    setRow((r) => (r.includes(i) ? r.filter((x) => x !== i) : r.length < ch.slots ? [...r, i] : r));
  const move = (at: number, by: number) =>
    setRow((r) => {
      const to = at + by;
      if (to < 0 || to >= r.length) return r;
      const next = [...r];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });
  const toggleUp = (id: string) =>
    setUps((u) => (u.includes(id) ? u.filter((x) => x !== id) : u.length < ch.pickUpgrades ? [...u, id] : [...u.slice(1), id]));
  const ready = row.length > 0 && ups.length === ch.pickUpgrades;

  return (
    <div className="overlay overlay--feedback" onClick={onClose}>
      <div className="panel challenge" role="dialog" aria-labelledby="challenge-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2 id="challenge-title">📅 Daily challenge</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close" autoFocus>
            ✕
          </button>
        </div>
        <div className="challenge__day">
          <select value={day} onChange={(e) => onDay(e.target.value)} aria-label="Day">
            {pastDays().map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
                {results[d]?.wonAt ? " ✓" : ""}
              </option>
            ))}
          </select>
          <span className={`challenge__level challenge__level--${ch.difficulty}`}>{LEVEL_LABEL[ch.difficulty]}</span>
          <span className="challenge__status">
            {result?.wonAt
              ? `✓ Won in ${result.wonIn} ${result.wonIn === 1 ? "try" : "tries"}`
              : result
                ? `${result.tries} ${result.tries === 1 ? "try" : "tries"}`
                : "Not tried yet"}
          </span>
        </div>
        {last !== undefined && (
          <p className={`challenge__last challenge__last--${last ? "won" : "lost"}`} role="status">
            {last ? "🏆 You held the row!" : "💥 Not this time. Change your row or upgrades and try again."}
          </p>
        )}
        <p className="panel__hint">
          One round against this row. Pick up to {ch.slots} units, in order (the first leads), and {ch.pickUpgrades} upgrades.
          Everything is unlocked here.
        </p>

        <h3 className="challenge__h">Enemy</h3>
        <ol className="challenge-row challenge-row--enemy">
          {enemy.map((u) => (
            <li key={u.id} className="challenge-unit">
              <UnitPortrait unitKey={u.key} side="enemy" size={34} merges={u.merges} />
              <span className="challenge-unit__name">
                {u.name} <small>Lv{u.merges + 1}</small>
              </span>
              <span className="challenge-unit__stats">
                <span className="stat stat--atk">⚔{u.atk}</span> <span className="stat stat--hp">♥{u.maxHp}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="challenge__ups">
          {ch.enemy.upgrades.map((id) => {
            const a = getAugment(id);
            return a ? (
              <span key={id} className={`result-upgrade result-upgrade--${rarityOf(a)}`} title={a.description}>
                {a.icon} {a.name}
              </span>
            ) : null;
          })}
        </div>

        <h3 className="challenge__h">
          Your upgrades <small>{ups.length} / {ch.pickUpgrades}</small>
        </h3>
        <div className="challenge__upgrades">
          {ch.upgrades.map((id) => {
            const a = getAugment(id);
            if (!a) return null;
            const on = ups.includes(id);
            return (
              <button
                key={id}
                className={`challenge-up challenge-up--${rarityOf(a)}${on ? " challenge-up--on" : ""}`}
                aria-pressed={on}
                onClick={() => toggleUp(id)}
              >
                <span className="challenge-up__name">
                  {a.icon} {a.name} {on && "✓"}
                </span>
                <span className="challenge-up__desc">{a.description}</span>
              </button>
            );
          })}
        </div>

        <h3 className="challenge__h">
          Your row <small>{row.length} / {ch.slots}</small>
        </h3>
        {row.length === 0 ? (
          <p className="panel__hint">Tap units below to add them. The first one leads.</p>
        ) : (
          <ol className="challenge-row">
            {row.map((i, at) => {
              const u = pool[i];
              return (
                <li key={i} className="challenge-unit">
                  <UnitPortrait unitKey={u.key} side="player" size={34} merges={u.merges} />
                  <span className="challenge-unit__name">
                    {u.name} <small>Lv{u.merges + 1}</small>
                  </span>
                  <span className="challenge-unit__moves">
                    <button onClick={() => move(at, -1)} disabled={at === 0} aria-label={`Move ${u.name} up`}>
                      ↑
                    </button>
                    <button onClick={() => move(at, 1)} disabled={at === row.length - 1} aria-label={`Move ${u.name} down`}>
                      ↓
                    </button>
                    <button onClick={() => toggleUnit(i)} aria-label={`Take ${u.name} out`}>
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <h3 className="challenge__h">Units</h3>
        <div className="challenge__pool">
          {pool.map((u, i) => {
            const on = row.includes(i);
            const stats = UNITS[u.key];
            return (
              <button
                key={i}
                className={`challenge-card${on ? " challenge-card--on" : ""}`}
                aria-pressed={on}
                disabled={!on && row.length >= ch.slots}
                onClick={() => toggleUnit(i)}
                title={stats.ability ? `${stats.ability.name}: ${stats.ability.text}` : undefined}
              >
                <UnitPortrait unitKey={u.key} side="player" size={40} merges={u.merges} />
                <span className="challenge-card__name">{u.name}</span>
                <span className="challenge-card__lv">Lv{u.merges + 1}</span>
                <span className="challenge-card__stats">
                  ⚔{u.baseAtk} ♥{u.baseMaxHp}
                </span>
              </button>
            );
          })}
        </div>

        <div className="challenge__go">
          <button className="primary-btn" disabled={!ready} onClick={() => onPlay(day, { row, upgrades: ups })}>
            ⚔ Battle
          </button>
        </div>
      </div>
    </div>
  );
}
