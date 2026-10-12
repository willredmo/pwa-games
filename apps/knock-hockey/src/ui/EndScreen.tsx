import { useEffect, useState } from "react";
import { DIFFICULTY_LABEL } from "../ai/cpu";
import { playerName, type MatchState, type Player, type PlayerStats } from "../game/match";
import { P1_COLOR, P2_COLOR } from "../render/board";

// End of match: who won, a side-by-side stat sheet, and a backdrop that keeps
// moving — confetti on a win, slow drifting pucks on a loss.

interface Row {
  label: string;
  p1: string | number;
  p2: string | number;
  /** Which side to highlight as better (higher wins unless `low`). */
  low?: boolean;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const acc = (s: PlayerStats) => (s.shots ? pct(s.goals / s.shots) : "—");

export interface EndScreenProps {
  match: MatchState;
  /** Online: which player this device is. */
  me?: Player;
  onRematch: () => void;
  onExit: () => void;
  onReplays: () => void;
}

export function EndScreen({ match, me, onRematch, onExit, onReplays }: EndScreenProps) {
  const pvp = match.mode === "pvp";
  const online = match.mode === "online";
  // In 2-player there's no loser's view: always celebrate the winner.
  const won = pvp || match.winner === (me ?? "p1");
  const winner = playerName(match, match.winner ?? "p1", me);
  const [asked, setAsked] = useState(false);
  const { p1, p2 } = match.stats;
  const mins = Math.max(1, Math.round((Date.now() - match.startedAt) / 60000));
  const rows: Row[] = [
    { label: "Goals", p1: p1.goals, p2: p2.goals },
    { label: "Shots", p1: p1.shots, p2: p2.shots },
    { label: "Accuracy", p1: acc(p1), p2: acc(p2) },
    { label: "Bank goals", p1: p1.bankGoals, p2: p2.bankGoals },
    { label: "Corner goals", p1: p1.cornerGoals, p2: p2.cornerGoals },
    { label: "Own goals", p1: p1.ownGoals, p2: p2.ownGoals, low: true },
    { label: "Hardest hit", p1: pct(p1.hardest), p2: pct(p2.hardest) },
  ];

  return (
    <div className="overlay overlay--end">
      <Backdrop won={won} />
      <div className="panel end" role="dialog" aria-label="Match over">
        <p className="end__kicker">
          {pvp
            ? "2 players · pass and play"
            : `${won ? "Victory" : "Defeat"} · ${online ? "online" : `vs ${DIFFICULTY_LABEL[match.difficulty]} CPU`}`}
        </p>
        <h2 className={`end__title end__title--${won ? "win" : "loss"}`}>
          {pvp ? `${winner} wins!` : won ? "You win!" : online ? "Opponent wins" : "CPU wins"}
        </h2>
        <div className="end__score">
          <span style={{ color: P1_COLOR }}>{match.score.p1}</span>
          <span className="end__dash">–</span>
          <span style={{ color: P2_COLOR }}>{match.score.p2}</span>
        </div>
        <table className="end__stats">
          <thead>
            <tr>
              <th />
              <th style={{ color: P1_COLOR }}>{playerName(match, "p1", me)}</th>
              <th style={{ color: P2_COLOR }}>{playerName(match, "p2", me)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = parseFloat(String(r.p1));
              const b = parseFloat(String(r.p2));
              const better = Number.isNaN(a) || Number.isNaN(b) || a === b ? null : (r.low ? a < b : a > b) ? "p1" : "p2";
              return (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  <td className={better === "p1" ? "end__best" : ""}>{r.p1}</td>
                  <td className={better === "p2" ? "end__best" : ""}>{r.p2}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="end__extra">
          {match.shots} shots · longest rally {match.stats.longestRally} · most bounces {match.stats.mostBounces} · {mins} min
        </p>
        {(match.goals?.length ?? 0) > 0 && (
          <button className="ghost-btn ghost-btn--wide end__replays" onClick={onReplays}>
            🎬 Watch all {match.goals!.length} goals
          </button>
        )}
        <div className="end__actions">
          <button
            className="primary-btn"
            disabled={asked}
            onClick={() => {
              setAsked(true);
              onRematch();
            }}
          >
            {asked && online ? "Starting…" : "Rematch"}
          </button>
          <button className="ghost-btn" onClick={onExit}>{pvp ? "Main menu" : online ? "Leave" : "Change opponent"}</button>
        </div>
      </div>
    </div>
  );
}

const CONFETTI = ["#2f6fd6", "#f2b632", "#f4f1ea", "#d63c3c", "#2a9d5b", "#ff7aa8"];

function Backdrop({ won }: { won: boolean }) {
  // Pieces are generated once; CSS animates them forever.
  const [pieces] = useState(() =>
    Array.from({ length: won ? 60 : 16 }, (_, i) => ({
      left: Math.random() * 100,
      delay: -Math.random() * 6,
      dur: won ? 3.5 + Math.random() * 3 : 9 + Math.random() * 6,
      color: CONFETTI[i % CONFETTI.length],
      size: won ? 6 + Math.random() * 6 : 14 + Math.random() * 14,
      spin: Math.random() < 0.5 ? -1 : 1,
    })),
  );
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  if (reduced) return null;
  return (
    <div className={`end-bg end-bg--${won ? "win" : "loss"}`} aria-hidden>
      {won && <div className="end-bg__rays" />}
      {pieces.map((p, i) => (
        <span
          key={i}
          className={won ? "end-bg__confetti" : "end-bg__puck"}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: won ? p.size * 0.45 : p.size,
            background: won ? p.color : undefined,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            ["--spin" as string]: p.spin,
          }}
        />
      ))}
    </div>
  );
}
