import { useMemo, useState } from "react";
import { sideUnits } from "../engine/board";
import { getAugment, rarityOf } from "../game/augments";
import {
  PAST_DAYS,
  challengeRound,
  dailyChallenge,
  dayKey,
  difficultyOf,
  loadResults,
  pastDays,
  type ChallengeLevel,
} from "../game/challenge";
import { ENEMY } from "../game/match";
import { UnitPortrait } from "./UnitPortrait";

// The daily challenge screen: a calendar of the playable days (the last
// PAST_DAYS, today included), each marked with its difficulty and a ✓ once
// beaten on this device, and the chosen day's enemy and Play. Playing mounts
// a Game in challenge mode, which runs the picks on the normal board
// (game/challenge.ts has the rules); App comes back here with the result.

const LEVEL_LABEL: Record<ChallengeLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const monthOf = (day: string) => day.slice(0, 7);

function longDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** The month's days as calendar weeks (Monday first), null for padding. */
function weeksOf(month: string): (string | null)[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

export interface ChallengeScreenProps {
  day: string;
  /** The last try's result, to show as the screen comes back. */
  last?: boolean;
  onDay: (day: string) => void;
  onPlay: (day: string) => void;
  onClose: () => void;
}

export function ChallengeScreen({ day, last, onDay, onPlay, onClose }: ChallengeScreenProps) {
  const today = dayKey();
  const playable = useMemo(() => new Set(pastDays(today, PAST_DAYS)), [today]);
  const months = useMemo(() => [...new Set([...playable].map(monthOf))].sort(), [playable]);
  const [month, setMonth] = useState(() => monthOf(day));
  const results = useMemo(loadResults, [day, last]);
  const result = results[day];
  const ch = useMemo(() => dailyChallenge(day), [day]);
  // The enemy as it will fight: its upgrades applied.
  const enemy = useMemo(() => sideUnits(challengeRound(ch, { row: [], upgrades: [] }).board, ENEMY), [ch]);
  const won = [...playable].filter((d) => results[d]?.wonAt).length;
  const at = months.indexOf(month);

  return (
    <div className="overlay overlay--feedback" onClick={onClose}>
      <div className="panel challenge" role="dialog" aria-labelledby="challenge-title" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2 id="challenge-title">📅 Daily challenge</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close" autoFocus>
            ✕
          </button>
        </div>
        <p className="panel__hint">
          One round, the same for everyone each day. Take two of the day's upgrades, place its units on the board, and
          beat the enemy row. Every unit and upgrade is available. {won > 0 && <b>{won} completed.</b>}
        </p>

        <div className="cal">
          <div className="cal__head">
            <button className="cal__nav" onClick={() => setMonth(months[at - 1])} disabled={at <= 0} aria-label="Previous month">
              ‹
            </button>
            <span className="cal__month">
              {new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
            </span>
            <button className="cal__nav" onClick={() => setMonth(months[at + 1])} disabled={at >= months.length - 1} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="cal__grid" role="grid">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="cal__wd" aria-hidden="true">
                {w}
              </span>
            ))}
            {weeksOf(month)
              .flat()
              .map((d, i) => {
                if (!d) return <span key={i} />;
                const open = playable.has(d);
                const done = !!results[d]?.wonAt;
                const tried = !!results[d] && !done;
                const level = open ? difficultyOf(d) : null;
                return (
                  <button
                    key={d}
                    className={
                      `cal__day${open ? ` cal__day--${level}` : ""}${done ? " cal__day--done" : ""}` +
                      `${tried ? " cal__day--tried" : ""}${d === day ? " cal__day--on" : ""}${d === today ? " cal__day--today" : ""}`
                    }
                    disabled={!open}
                    aria-pressed={d === day}
                    aria-label={`${longDate(d)}${open ? `, ${LEVEL_LABEL[level!]}` : ""}${done ? ", completed" : tried ? ", tried" : ""}`}
                    onClick={() => onDay(d)}
                  >
                    <span className="cal__num">{Number(d.slice(8))}</span>
                    <span className="cal__mark" aria-hidden="true">
                      {done ? "✓" : open ? "•" : ""}
                    </span>
                  </button>
                );
              })}
          </div>
          <p className="cal__legend">
            <span className="cal__key cal__key--easy">• Easy</span>
            <span className="cal__key cal__key--medium">• Medium</span>
            <span className="cal__key cal__key--hard">• Hard</span>
            <span className="cal__key cal__key--done">✓ Completed</span>
          </p>
        </div>

        <div className="challenge__pick">
          <div className="challenge__day">
            <strong>{dayTitle(day, today)}</strong>
            <span className={`challenge__level challenge__level--${ch.difficulty}`}>{LEVEL_LABEL[ch.difficulty]}</span>
            <span className={`challenge__status${result?.wonAt ? " challenge__status--done" : ""}`}>
              {result?.wonAt
                ? `✓ Completed in ${result.wonIn} ${result.wonIn === 1 ? "try" : "tries"}`
                : result
                  ? `${result.tries} ${result.tries === 1 ? "try" : "tries"}`
                  : "Not tried yet"}
            </span>
          </div>
          {last !== undefined && (
            <p className={`challenge__last challenge__last--${last ? "won" : "lost"}`} role="status">
              {last ? "🏆 You held the row! Challenge complete." : "💥 Not this time. Try a different row or upgrades."}
            </p>
          )}
          <div className="challenge__enemy" aria-label="Enemy row, front first">
            {enemy.map((u) => (
              <span key={u.id} className="challenge__foe" title={`${u.name} Lv${u.merges + 1}: ⚔${u.atk} ♥${u.maxHp}`}>
                <UnitPortrait unitKey={u.key} side="enemy" size={30} merges={u.merges} />
                <small>Lv{u.merges + 1}</small>
              </span>
            ))}
          </div>
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
          <button className="primary-btn challenge__play" onClick={() => onPlay(day)}>
            {result?.wonAt ? "↻ Play again" : result ? "↻ Try again" : "▶ Play"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Today", "Yesterday" or the date. */
function dayTitle(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === pastDays(today, 2)[1]) return "Yesterday";
  return longDate(day);
}
