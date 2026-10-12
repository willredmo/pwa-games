import { useEffect, useRef, useState } from "react";
import { playerName, type GoalRecord, type MatchState, type Player } from "../game/match";
import type { StickLook } from "../game/stick";
import { Table } from "../render/table";
import { boardFor } from "../physics/board";
import { layoutFor } from "../physics/table";

// Goal replays. Each goal was saved with the exact shot that scored it (where
// the puck was and how it left the stick), and the physics is deterministic,
// so playing that shot again on a fresh table reproduces the goal exactly —
// same bounces, same finish. The table is the game's own, so the stick lines
// up and swings just as it did.

/** After the winning goal's instant replay, before the results. */
const INSTANT_AFTER_MS = 3500;
/** Pause before the stick moves, and after the puck goes in before the next goal. */
const LEAD_MS = 600;
const AFTER_MS = 1800;
/** Replay speeds (share of real time for the puck), cycled by the speed button. Starts at the first. */
const SPEEDS = [0.5, 0.25, 1] as const;
const SPEED_LABEL: Record<(typeof SPEEDS)[number], string> = { 0.5: "½×", 0.25: "¼×", 1: "1×" };

export interface ReplaysProps {
  match: MatchState;
  looks: Record<Player, StickLook>;
  /** Online: this device's side (names, and the guest's turned-round board). */
  me?: Player;
  /** Start at this goal (index into match.goals). */
  start?: number;
  /** Roll on to the next goal after each one (off when replaying just the latest). */
  autoplay?: boolean;
  /**
   * The instant replay when a match is won: just the winning goal at half
   * speed under an "INSTANT REPLAY" title, closing itself when done (or Skip).
   */
  instant?: boolean;
  onClose: () => void;
}

export function Replays({ match, looks, me, start = 0, autoplay = true, instant = false, onClose }: ReplaysProps) {
  const goals = match.goals ?? [];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableRef = useRef<Table | null>(null);
  const timer = useRef(0);
  const [index, setIndex] = useState(Math.min(start, Math.max(0, goals.length - 1)));
  const [auto, setAuto] = useState(autoplay);
  // The instant replay is proper slow motion; browsing replays starts at ½×.
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(instant ? 0.25 : SPEEDS[0]);
  /** Bumped to replay the current goal again. */
  const [take, setTake] = useState(0);
  const [done, setDone] = useState(false);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const table = new Table(
      canvas,
      {
        onPull: () => {},
        onFire: () => {},
        onShot: () => {
          setDone(true);
          window.clearTimeout(timer.current);
          // The instant replay closes itself after the explosion settles.
          if (instant) {
            timer.current = window.setTimeout(() => onCloseRef.current(), INSTANT_AFTER_MS);
            return;
          }
          // Carry on to the next goal unless paused (or this was the last).
          timer.current = window.setTimeout(() => {
            if (!autoRef.current) return;
            setIndex((i) => (i + 1 < goals.length ? i + 1 : i));
          }, AFTER_MS);
        },
      },
      goals[0]?.launch ?? { x: 150, y: 300 },
      looks,
    );
    table.flipped = me === "p2";
    // The same board the goals were scored on.
    table.board = boardFor(match.boardSeed, match.corners);
    table.layout = layoutFor(match.corners);
    table.aimLine = false;
    tableRef.current = table;
    return () => {
      window.clearTimeout(timer.current);
      table.destroy();
      tableRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tableRef.current) tableRef.current.timeScale = speed;
  }, [speed]);

  // Play the current goal.
  useEffect(() => {
    const table = tableRef.current;
    const g = goals[index];
    if (!table || !g) return;
    window.clearTimeout(timer.current);
    setDone(false);
    table.placePuck(g.launch);
    // Every goal blows up again as it did live; the match winner's is the big one.
    const winning = !!match.winner && index === goals.length - 1;
    table.explodeInto = { [g.scorer === "p1" ? "top" : "bottom"]: winning ? "big" : "normal" };
    table.beginTurn(g.by, "remote");
    timer.current = window.setTimeout(() => tableRef.current?.playRemote(g.launch, true), LEAD_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, take]);

  // Keyboard: ← → previous/next, Space replay, Esc close.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(goals.length - 1, i + 1));
      else if (e.key === " ") setTake((t) => t + 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Capture phase, so the game underneath doesn't also act on these keys.
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [goals.length, onClose]);

  const g = goals[index];
  const isLast = index === goals.length - 1;

  return (
    <div className="overlay overlay--replay" role="dialog" aria-label="Goal replays">
      <div className="replay">
        <div className="replay__head">
          {instant ? <h2 className="replay__instant">Instant replay</h2> : <h2>Goal replays</h2>}
          {instant ? (
            <button className="ghost-btn ghost-btn--sm" onClick={onClose}>
              Skip ▸
            </button>
          ) : (
            <button className="close-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        {g ? (
          <>
            <Caption goal={g} n={index + 1} of={goals.length} match={match} me={me} winning={!!match.winner && isLast} />
            <div className="replay__board">
              <canvas ref={canvasRef} className="game__canvas" />
            </div>
            {!instant && (
              <>
            <div className="replay__controls">
              <button className="nudge-btn" aria-label="Previous goal" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                ⏮
              </button>
              <button className="ghost-btn" onClick={() => setTake((t) => t + 1)}>
                ↻ Again
              </button>
              <button className="nudge-btn" aria-label="Next goal" disabled={isLast} onClick={() => setIndex(index + 1)}>
                ⏭
              </button>
            </div>
            <div className="replay__toggles">
              <button
                className="ghost-btn ghost-btn--sm"
                title="Replay speed"
                onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
              >
                🐢 Speed {SPEED_LABEL[speed]}
              </button>
              <button
                className={`ghost-btn ghost-btn--sm${auto ? " ghost-btn--on" : ""}`}
                aria-pressed={auto}
                title="Play the next goal automatically"
                onClick={() => setAuto(!auto)}
              >
                {auto ? "✓ Auto-play next" : "Auto-play next"}
              </button>
            </div>
            <p className="replay__hint">{done && isLast ? "That's every goal." : "← → previous / next · Space replay"}</p>
              </>
            )}
          </>
        ) : (
          <>
            <p className="replay__empty">No goals yet. Score one and it'll be here.</p>
            <canvas ref={canvasRef} hidden />
          </>
        )}
      </div>
    </div>
  );
}

function Caption({ goal, n, of, match, me, winning }: { goal: GoalRecord; n: number; of: number; match: MatchState; me?: Player; winning: boolean }) {
  const name = (p: Player) => playerName(match, p, me);
  const how = goal.ownGoal ? `Own goal by ${name(goal.by)}` : goal.corner ? "Off the corner" : goal.bank ? "Bank shot" : "Straight in";
  return (
    <div className={`replay__caption replay__caption--${goal.scorer}`}>
      <span className="replay__n">{winning ? "🏆 Winning goal" : `Goal ${n} of ${of}`}</span>
      {/* "You score", "CPU scores". */}
      <strong>{name(goal.scorer) === "You" ? "You score" : `${name(goal.scorer)} scores`}</strong>
      <span>
        {how} · {Math.round(goal.launch.power * 100)}% power · {goal.score.p1}–{goal.score.p2}
      </span>
    </div>
  );
}
