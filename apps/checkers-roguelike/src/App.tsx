import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyMove, capturesFrom, movesFrom, winner } from "./engine/moves";
import { chooseTurn } from "./engine/ai";
import { UPGRADE, hasUpgrade } from "./engine/upgrades";
import type { Board, Coord, Move, Player } from "./engine/types";
import { coordsEqual, opponent } from "./engine/types";
import { draw, pixelToCoord } from "./board/render";
import {
  AI,
  PLAYER,
  FINAL_FLOOR,
  applyUpgrade,
  boardLabel,
  buildFloorBoard,
  createRoster,
  floorConfig,
  type RosterPiece,
} from "./game/run";
import { pickUpgradeChoices, type UpgradeDef } from "./game/upgrades";
import { ResultPanel, UpgradePanel } from "./ui/Overlays";
import "./App.css";

const AI_DELAY_MS = 350; // let the player see their own move land first
const UPGRADE_CHOICES = 3; // pick-1-of-N between floors

type Phase = "playing" | "choose-upgrade" | "game-over" | "run-complete";

/** A restorable point within the current match, pushed before each applied hop. */
interface Snapshot {
  board: Board;
  toMove: Player;
  chainFrom: Coord | null;
  phantomFrom: Coord | null;
  phantomUsed: string[];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Run (meta) state.
  const [floor, setFloor] = useState(1);
  const [roster, setRoster] = useState<RosterPiece[]>(() => createRoster());
  const [phase, setPhase] = useState<Phase>("playing");
  const [choices, setChoices] = useState<UpgradeDef[]>([]);

  // Match state for the current floor.
  const cfg = floorConfig(floor);
  const [board, setBoard] = useState<Board>(() =>
    buildFloorBoard(floorConfig(1), createRoster()),
  );
  const [toMove, setToMove] = useState<Player>(PLAYER);
  const [selected, setSelected] = useState<Coord | null>(null);
  const [chainFrom, setChainFrom] = useState<Coord | null>(null);
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]);
  // Phantom Step: when set, the player is taking a once-per-match bonus move
  // with the piece at this square (turn has not passed). `phantomUsed` holds the
  // ids of pieces that have already spent their bonus this match.
  const [phantomFrom, setPhantomFrom] = useState<Coord | null>(null);
  const [phantomUsed, setPhantomUsed] = useState<string[]>([]);

  const win = useMemo(() => winner(board, toMove), [board, toMove]);

  const legalFromSelected: Move[] = useMemo(() => {
    if (!selected) return [];
    if (chainFrom) return capturesFrom(board, selected, true);
    return movesFrom(board, selected, toMove);
  }, [board, selected, toMove, chainFrom]);

  const targets = useMemo(
    () => legalFromSelected.map((m) => m.to),
    [legalFromSelected],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas, { board, selected, targets });
  }, [board, selected, targets]);

  useEffect(() => {
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  // Resolve a finished match into the next run phase.
  useEffect(() => {
    if (phase !== "playing" || !win) return;
    if (win === PLAYER) {
      if (floor >= FINAL_FLOOR) {
        setPhase("run-complete");
      } else {
        setChoices(pickUpgradeChoices(UPGRADE_CHOICES));
        setPhase("choose-upgrade");
      }
    } else {
      setPhase("game-over");
    }
  }, [win, phase, floor]);

  // AI turn. Applies its whole turn (incl. a full multi-jump) at once. The
  // setTimeout + cleanup keeps this safe under StrictMode's double-invoke.
  useEffect(() => {
    if (phase !== "playing" || win || toMove !== AI) return;
    setThinking(true);
    const id = setTimeout(() => {
      const turn = chooseTurn(board, AI, cfg.aiDepth);
      if (turn) {
        setHistory((h) => [
          ...h,
          { board, toMove: AI, chainFrom: null, phantomFrom: null, phantomUsed },
        ]);
        let b = board;
        for (const hop of turn.moves) b = applyMove(b, hop);
        setBoard(b);
        setToMove(PLAYER);
      }
      setThinking(false);
    }, AI_DELAY_MS);
    return () => clearTimeout(id);
  }, [toMove, board, win, phase, cfg.aiDepth, phantomUsed]);

  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "playing" || win || toMove !== PLAYER) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const c = pixelToCoord(canvas, board, e.clientX - rect.left, e.clientY - rect.top);
      if (!c) return;

      if (selected) {
        const move = legalFromSelected.find((m) => coordsEqual(m.to, c));
        if (move) {
          const next = applyMove(board, move);
          const canChain =
            move.captures.length > 0 &&
            !move.crowns &&
            capturesFrom(next, move.to, true).length > 0;
          setHistory((h) => [
            ...h,
            { board, toMove, chainFrom, phantomFrom, phantomUsed },
          ]);
          setBoard(next);

          if (canChain) {
            setChainFrom(move.to);
            setSelected(move.to);
            return;
          }

          const moved = next.squares[move.to.row][move.to.col];

          // This move was itself the phantom bonus → spend it and end the turn.
          if (phantomFrom) {
            if (moved && !phantomUsed.includes(moved.id)) {
              setPhantomUsed((u) => [...u, moved.id]);
            }
            setPhantomFrom(null);
            setToMove(opponent(toMove));
            setChainFrom(null);
            setSelected(null);
            return;
          }

          // Offer a Phantom Step bonus if the moved piece has one unused and can
          // still move; otherwise pass the turn normally.
          const canPhantom =
            moved &&
            hasUpgrade(moved, UPGRADE.PhantomStep) &&
            !phantomUsed.includes(moved.id) &&
            movesFrom(next, move.to, moved.owner).length > 0;
          if (canPhantom) {
            setPhantomFrom(move.to);
            setSelected(move.to);
            setChainFrom(null);
            return;
          }

          setToMove(opponent(toMove));
          setChainFrom(null);
          setSelected(null);
          return;
        }
      }

      if (chainFrom || phantomFrom) return; // locked mid-chain / mid-bonus

      const piece = board.squares[c.row][c.col];
      if (piece && piece.owner === toMove) {
        setSelected(coordsEqual(selected ?? { row: -1, col: -1 }, c) ? null : c);
      } else {
        setSelected(null);
      }
    },
    [board, selected, legalFromSelected, toMove, chainFrom, phantomFrom, phantomUsed, win, phase],
  );

  // Decline the Phantom Step bonus and pass the turn (the step is not spent).
  const skipPhantom = () => {
    if (!phantomFrom) return;
    setHistory((h) => [
      ...h,
      { board, toMove, chainFrom, phantomFrom, phantomUsed },
    ]);
    setPhantomFrom(null);
    setToMove(opponent(toMove));
    setChainFrom(null);
    setSelected(null);
  };

  // Undo steps back to the player's previous decision point within this match,
  // reverting the AI's reply and the player's own move (and any in-progress
  // jump chain). It does not cross floor boundaries.
  const undo = () => {
    if (history.length === 0 || thinking || phase !== "playing") return;
    let h = history;
    let target: Snapshot;
    do {
      target = h[h.length - 1];
      h = h.slice(0, -1);
    } while (h.length > 0 && !(target.toMove === PLAYER && target.chainFrom === null));
    setBoard(target.board);
    setToMove(target.toMove);
    setChainFrom(target.chainFrom);
    setSelected(target.chainFrom);
    setPhantomFrom(target.phantomFrom);
    setPhantomUsed(target.phantomUsed);
    setHistory(h);
  };

  // Start a floor with a specific roster (passed explicitly to avoid stale state).
  const startFloor = (nextFloor: number, nextRoster: RosterPiece[]) => {
    setBoard(buildFloorBoard(floorConfig(nextFloor), nextRoster));
    setToMove(PLAYER);
    setSelected(null);
    setChainFrom(null);
    setThinking(false);
    setHistory([]);
    setPhantomFrom(null);
    setPhantomUsed([]);
    setPhase("playing");
  };

  const onApplyUpgrade = (upgradeId: string, pieceIndex: number) => {
    const nextRoster = applyUpgrade(roster, pieceIndex, upgradeId);
    const nextFloor = floor + 1;
    setRoster(nextRoster);
    setFloor(nextFloor);
    startFloor(nextFloor, nextRoster);
  };

  const newRun = () => {
    const freshRoster = createRoster();
    setRoster(freshRoster);
    setFloor(1);
    startFloor(1, freshRoster);
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1>Checkers Roguelike</h1>
        <p className="app__subtitle">
          Floor {floor} / {FINAL_FLOOR} · {boardLabel(cfg)} · depth {cfg.aiDepth}
        </p>
      </header>

      <div className="app__status">
        {thinking ? (
          <span>
            <span className={`dot dot--${AI}`} /> AI thinking…
          </span>
        ) : chainFrom ? (
          <span>
            <span className={`dot dot--${toMove}`} /> Continue jumping…
          </span>
        ) : phantomFrom ? (
          <span>
            <span className={`dot dot--${toMove}`} /> Phantom Step — take a bonus move
          </span>
        ) : (
          <span>
            <span className={`dot dot--${toMove}`} />{" "}
            {toMove === PLAYER ? "Your move" : "AI to move"}
          </span>
        )}
      </div>

      <div className="app__stage">
        <canvas ref={canvasRef} className="app__board" onClick={onCanvasClick} />

        {phase === "choose-upgrade" && (
          <UpgradePanel
            floor={floor}
            choices={choices}
            roster={roster}
            onApply={onApplyUpgrade}
          />
        )}
        {(phase === "game-over" || phase === "run-complete") && (
          <ResultPanel kind={phase} floor={floor} onNewRun={newRun} />
        )}
      </div>

      <div className="app__controls">
        {phantomFrom && (
          <button onClick={skipPhantom}>Skip extra move</button>
        )}
        <button
          onClick={undo}
          disabled={history.length === 0 || thinking || phase !== "playing"}
        >
          Undo
        </button>
        <button onClick={newRun}>New run</button>
      </div>
    </div>
  );
}
