import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cloneBoard,
  emptySpotCount,
  findUnitCell,
  insertUnit,
  makeUnit,
  mergeGain,
  mergePlaced,
  moveUnit,
  occupants,
  replaceUnit,
  sideUnits,
  unitMergeGain,
  upgradeUnit,
} from "./engine/board";
import { resolveRound } from "./engine/combat";
import { UNITS } from "./engine/units";
import type { Board, RoundResult, Side, Tick } from "./engine/types";
import {
  AUGMENT_OFFER_COUNT,
  ENEMY,
  PICK_COUNT,
  PLAYER,
  START_HP,
  aiCommit,
  aiPickAugment,
  isAugmentRound,
  newBoard,
  refreshForRound,
  rollOffer,
} from "./game/match";
import {
  createAugmentState,
  getAugment,
  offerAugments,
  takeAugment,
  type AugmentDef,
  type AugmentState,
} from "./game/augments";

/** Badge glyph for an augment id — "✦" if an id ever outlives its definition. */
const auraIcon = (id: string) => getAugment(id)?.icon ?? "✦";
import { draw, pixelToCell, type Cell, type CellHit } from "./board/render";
import { AugmentPanel, AugmentsView, HelpPanel, ResultPanel } from "./ui/Overlays";
import "./App.css";

// Battle playback pacing — deliberately unhurried so each exchange is readable.
const REVEAL_MS = 700;
const IMPACT_MS = 900;
const SETTLE_MS = 600;
/** How much fast mode compresses battle playback. */
const FAST_FACTOR = 3;
const FAST_KEY = "duel-deck:fast";
/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

type Phase = "pick" | "augment" | "battle" | "over";

/**
 * Something the player has "in hand": either a new unit from the offer, or one
 * already placed. The same payload drives both input styles — dragging it, or
 * click-selecting it and clicking a destination — so every gesture available to
 * one is available to the other.
 */
type Grab =
  | { kind: "offer"; index: number; key: string }
  | { kind: "unit"; unitId: string; key: string; lane: number; from: number };

type UnitGrab = Extract<Grab, { kind: "unit" }>;

interface Frame {
  board: Board;
  hits: CellHit[];
  duration: number;
}

function buildFrames(committed: Board, ticks: Tick[]): Frame[] {
  const frames: Frame[] = [];
  let prev = committed;
  for (const tick of ticks) {
    const dmg = new Map<string, number>();
    for (const ev of tick.events) {
      if (ev.type === "attack") dmg.set(ev.target, (dmg.get(ev.target) ?? 0) + ev.damage);
    }
    const dying = new Set(
      tick.events.filter((e) => e.type === "death").map((e) => (e as { unit: string }).unit),
    );
    const hits: CellHit[] = [];
    for (const [id, amount] of dmg) {
      const cell = findUnitCell(prev, id);
      if (cell) hits.push({ ...cell, amount, dying: dying.has(id) });
    }
    frames.push({ board: prev, hits, duration: IMPACT_MS });
    frames.push({ board: tick.snapshot, hits: [], duration: SETTLE_MS });
    prev = tick.snapshot;
  }
  return frames;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [board, setBoard] = useState<Board>(newBoard);
  const [round, setRound] = useState(1);
  const [offer, setOffer] = useState<string[]>(rollOffer);
  const [picksLeft, setPicksLeft] = useState(PICK_COUNT);
  /** Click-selected and awaiting a destination click. Mirrors `drag`. */
  const [selected, setSelected] = useState<Grab | null>(null);
  /** Offer slots already taken this round — each of the 5 is single-use. */
  const [usedOffers, setUsedOffers] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [result, setResult] = useState<RoundResult | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [hits, setHits] = useState<CellHit[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [showAugments, setShowAugments] = useState(false);
  /** Augment offer temporarily hidden so the player can inspect the board. */
  const [peeking, setPeeking] = useState(false);
  /** Compressed battle playback. A preference, so it outlives the match. */
  const [fast, setFast] = useState(() => {
    try {
      return localStorage.getItem(FAST_KEY) === "1";
    } catch {
      return false; // private mode / storage disabled — just default to normal
    }
  });
  const [augOffers, setAugOffers] = useState<AugmentDef[]>([]);
  const [lastRound, setLastRound] = useState<string | null>(null);

  // Drag state. `drag` is null until the pointer passes the drag threshold, so
  // a tap still behaves as a click.
  const [drag, setDrag] = useState<Grab | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dropCell, setDropCell] = useState<Cell | null>(null);
  const pending = useRef<{ drag: Grab; x: number; y: number } | null>(null);

  /**
   * Read by the playback loop at each frame boundary. A ref, not the state
   * value: the playback effect must not re-run when the speed changes, or the
   * round would restart from the first blow.
   */
  const speedRef = useRef(fast ? FAST_FACTOR : 1);

  /**
   * Flip playback speed. The ref and the stored preference are written here
   * rather than in an effect on `fast`: an effect only flushes after paint, so
   * a click immediately followed by closing the tab would lose the setting.
   */
  const toggleFast = () => {
    const next = !fast;
    setFast(next);
    speedRef.current = next ? FAST_FACTOR : 1;
    try {
      localStorage.setItem(FAST_KEY, next ? "1" : "0");
    } catch {
      /* not persisting is fine — the toggle still works this session */
    }
  };

  const playerAug = useRef<AugmentState>(createAugmentState());
  const enemyAug = useRef<AugmentState>(createAugmentState());
  /**
   * The board as committed, before any blows land — every unit alive and in
   * queue order. Fallen units respawn at the end of the round, so this snapshot
   * (not the post-combat board) is what the next round is built from.
   */
  const committedRef = useRef<Board | null>(null);

  const boardFull = emptySpotCount(board, PLAYER) === 0;

  /**
   * What dropping `key` on a slot would do. Single source of truth shared by
   * the drop handler, the highlight colours and the hint — so what the player
   * is told is always exactly what will happen.
   */
  type DropAction = "place" | "merge" | "replace" | "reorder" | "invalid";
  const dropActionFor = useCallback(
    (cell: Cell | null, key: string | null): DropAction => {
      if (!cell || !key || cell.side !== PLAYER) return "invalid";
      const unit = board.slots.player[cell.lane][cell.spot];
      if (!unit) {
        // Queue stays contiguous, so only the append position is a real slot.
        return cell.spot >= occupants(board, PLAYER, cell.lane).length ? "place" : "invalid";
      }
      if (unit.key === key) return "merge";
      // Swapping a unit out is only offered when there's no room to add one.
      return boardFull ? "replace" : "invalid";
    },
    [board, boardFull],
  );

  /**
   * What dropping a unit that's *already placed* onto a slot would do. Same
   * like-with-like rule as the offer: landing on a unit of your own type merges
   * the two, anything else is a reorder. (Two units of the same type are
   * interchangeable in the queue, so nothing useful is lost by spending that
   * gesture on the merge.)
   */
  const unitDropActionFor = useCallback(
    (cell: Cell | null, d: UnitGrab): DropAction => {
      if (!cell || cell.side !== PLAYER || cell.lane !== d.lane) return "invalid";
      const target = board.slots.player[cell.lane][cell.spot];
      if (!target || target.id === d.unitId) return "invalid";
      return target.key === d.key ? "merge" : "reorder";
    },
    [board],
  );

  /**
   * What the thing in hand would do at `cell` — the one entry point, so a drag
   * and a click-then-click resolve identically.
   */
  const actionFor = useCallback(
    (cell: Cell | null, g: Grab | null): DropAction => {
      if (!g) return "invalid";
      return g.kind === "offer" ? dropActionFor(cell, g.key) : unitDropActionFor(cell, g);
    },
    [dropActionFor, unitDropActionFor],
  );

  /**
   * Whatever is in hand right now. A drag wins over a lingering click-selection
   * — it's the more recent intent — and everything downstream (highlights, drop
   * colours, hints) reads this one value, so both input styles look identical.
   */
  const grab: Grab | null = drag ?? selected;

  /**
   * Queue positions the player may drop onto. New units may also land at the
   * back of the queue (one past the last unit); reorders may not.
   */
  const validTargets: Cell[] = useMemo(() => {
    if (phase !== "pick" || !grab) return [];
    const cells: Cell[] = [];
    for (let lane = 0; lane < board.lanes; lane++) {
      for (let spot = 0; spot < board.depth; spot++) {
        const cell: Cell = { side: PLAYER, lane, spot };
        if (actionFor(cell, grab) !== "invalid") cells.push(cell);
      }
    }
    return cells;
  }, [phase, grab, board, actionFor]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      draw(canvas, {
        board,
        validTargets,
        hits,
        // Nothing in hand means nothing to preview — otherwise the last hovered
        // slot keeps its outline after a click resolves the selection.
        dropCell: grab ? dropCell : null,
        dropKind: grab ? actionFor(dropCell, grab) : undefined,
        draggingId: drag?.kind === "unit" ? drag.unitId : null,
        selectedId: !drag && selected?.kind === "unit" ? selected.unitId : null,
        auraIcon,
      });
    }
  }, [board, validTargets, hits, dropCell, drag, selected, grab, actionFor]);


  useEffect(() => {
    redraw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [redraw]);

  const refreshed = useCallback((b: Board): Board => {
    const next = cloneBoard(b);
    refreshForRound(next, playerAug.current, enemyAug.current);
    return next;
  }, []);

  const startRound = useCallback(
    (base: Board, roundNum: number) => {
      setBoard(refreshed(base));
      setRound(roundNum);
      setOffer(rollOffer());
      setPicksLeft(PICK_COUNT);
      setUsedOffers([]);
      setSelected(null);
      setResult(null);
      setFrames([]);
      setHits([]);
      setPeeking(false);
      setPhase("pick");
    },
    [refreshed],
  );

  const commit = useCallback((current: Board) => {
    const committed = cloneBoard(current);
    aiCommit(committed, ENEMY);
    refreshForRound(committed, playerAug.current, enemyAug.current);
    // resolveRound clones its input, so `committed` keeps the full roster.
    const res = resolveRound(committed);
    committedRef.current = committed;
    setBoard(committed);
    setResult(res);
    setFrames(buildFrames(committed, res.ticks));
    setSelected(null);
    setPhase("battle");
  }, []);

  const finishPicks = useCallback(
    (current: Board, roundNum: number) => {
      if (isAugmentRound(roundNum)) {
        setAugOffers(offerAugments(playerAug.current, AUGMENT_OFFER_COUNT));
        setBoard(current);
        setPhase("augment");
      } else {
        commit(current);
      }
    },
    [commit],
  );

  // Note: picks never auto-commit. The player stays in the pick phase until
  // they press Commit, so there's always a chance to reorder the queue first.

  /** Place a new unit from the offer into the queue at `cell`. */
  const placeFromOffer = useCallback(
    (offerIndex: number, cell: Cell) => {
      if (picksLeft <= 0 || usedOffers.includes(offerIndex)) return;
      const next = cloneBoard(board);
      const key = offer[offerIndex];
      const action = dropActionFor(cell, key);
      const ok =
        action === "merge"
          ? upgradeUnit(next, PLAYER, cell.lane, cell.spot, key)
          : action === "replace"
            ? replaceUnit(next, PLAYER, cell.lane, cell.spot, key)
            : action === "place"
              ? insertUnit(next, PLAYER, cell.lane, cell.spot, makeUnit(key, PLAYER))
              : false;
      if (!ok) return;
      refreshForRound(next, playerAug.current, enemyAug.current);
      setBoard(next);
      setSelected(null);
      setUsedOffers((u) => [...u, offerIndex]);
      setPicksLeft(picksLeft - 1);
    },
    [board, offer, picksLeft, usedOffers, dropActionFor],
  );

  /**
   * Move or merge a unit that's already on the board. Shared by the drop
   * handler and the click handler so the two can't drift apart.
   */
  const applyUnitGrab = useCallback(
    (g: UnitGrab, cell: Cell) => {
      const action = unitDropActionFor(cell, g);
      if (action === "invalid") return;
      const next = cloneBoard(board);
      if (action === "merge") {
        // Merging is free — it costs a body, not a pick.
        if (!mergePlaced(next, PLAYER, g.lane, g.from, cell.spot)) return;
      } else {
        moveUnit(next, PLAYER, g.lane, g.from, cell.spot);
      }
      refreshForRound(next, playerAug.current, enemyAug.current);
      setBoard(next);
      setSelected(null);
    },
    [board, unitDropActionFor],
  );

  /** Translate client coords to a player queue slot, or null if off-target. */
  const cellAt = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const cell = pixelToCell(canvas, board, clientX - rect.left, clientY - rect.top);
      return cell && cell.side === PLAYER ? cell : null;
    },
    [board],
  );

  // --- Drag lifecycle -------------------------------------------------------

  const beginPress = (d: Grab, e: React.PointerEvent) => {
    if (phase !== "pick") return;
    pending.current = { drag: d, x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    if (phase !== "pick") return;

    const onMove = (e: PointerEvent) => {
      const p = pending.current;
      if (p && !drag) {
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (moved < DRAG_THRESHOLD_PX) return;
        setDrag(p.drag); // promote the press into a drag
      }
      if (!pending.current) return;
      setDragPos({ x: e.clientX, y: e.clientY });
      setDropCell(cellAt(e.clientX, e.clientY));
    };

    const onUp = (e: PointerEvent) => {
      const p = pending.current;
      pending.current = null;
      const wasDragging = drag;
      setDrag(null);
      setDragPos(null);
      setDropCell(null);
      if (!p || !wasDragging) return; // a tap, not a drag — let onClick handle it

      const cell = cellAt(e.clientX, e.clientY);
      if (!cell) return; // dropped outside the board: cancel

      if (wasDragging.kind === "offer") placeFromOffer(wasDragging.index, cell);
      else applyUnitGrab(wasDragging, cell);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [phase, drag, cellAt, placeFromOffer, applyUnitGrab]);

  /**
   * Hovering with something click-selected previews the outcome exactly as a
   * drag does — which matters most for replace, whose only warning is that
   * preview. During a drag the window-level handler owns `dropCell`.
   */
  const onBoardPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phase !== "pick" || drag || pending.current || !selected) return;
    setDropCell(cellAt(e.clientX, e.clientY));
  };

  const onBoardPointerLeave = () => {
    if (!drag && !pending.current) setDropCell(null);
  };

  /** Press on the board: start dragging one of your placed units. */
  const onBoardPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phase !== "pick") return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    const unit = board.slots.player[cell.lane][cell.spot];
    if (!unit) return;
    beginPress(
      { kind: "unit", unitId: unit.id, key: unit.key, lane: cell.lane, from: cell.spot },
      e,
    );
  };

  /**
   * Click equivalent of a drag: with something in hand, a click resolves the
   * same action a drop would; with nothing in hand, clicking your own unit
   * picks it up. Every drag gesture is therefore reachable by tapping, which
   * matters on touch where a precise drag over small slots is fiddly.
   */
  const onBoardClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (phase !== "pick") return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) {
      setSelected(null); // clicked off the board — put it back down
      return;
    }
    const unit = board.slots.player[cell.lane][cell.spot];

    if (selected) {
      // Clicking the unit you picked up cancels, rather than being a no-op.
      if (selected.kind === "unit" && unit?.id === selected.unitId) {
        setSelected(null);
        return;
      }
      if (actionFor(cell, selected) !== "invalid") {
        if (selected.kind === "offer") placeFromOffer(selected.index, cell);
        else applyUnitGrab(selected, cell);
        return;
      }
      // Not a legal destination — fall through, so clicking another of your
      // units switches the selection to it instead of doing nothing.
    }
    setSelected(
      unit
        ? { kind: "unit", unitId: unit.id, key: unit.key, lane: cell.lane, from: cell.spot }
        : null,
    );
  };

  // --- Augments & playback --------------------------------------------------

  const onPickAugment = (id: string) => {
    const units = sideUnits(board, PLAYER);
    const cost = takeAugment(playerAug.current, id, units);
    const next = cloneBoard(board);
    if (cost) next.hp.player = Math.max(1, next.hp.player - cost);

    const enemyChoice = aiPickAugment(offerAugments(enemyAug.current, AUGMENT_OFFER_COUNT));
    if (enemyChoice) {
      const eCost = takeAugment(enemyAug.current, enemyChoice.id, sideUnits(next, ENEMY));
      if (eCost) next.hp.enemy = Math.max(1, next.hp.enemy - eCost);
    }
    refreshForRound(next, playerAug.current, enemyAug.current);
    setBoard(next);
    commit(next);
  };

  useEffect(() => {
    if (phase !== "battle" || !result) return;
    let timer = 0;
    let i = 0;

    const finish = () => {
      setHits([]);
      if (result.roundWinner === PLAYER && playerAug.current.active.includes("momentum")) {
        playerAug.current.momentum += 1;
      }
      if (result.roundWinner === ENEMY && enemyAug.current.active.includes("momentum")) {
        enemyAug.current.momentum += 1;
      }
      const evts = result.ticks.flatMap((t) => t.events);
      if (playerAug.current.active.includes("berserkers-rally")) {
        playerAug.current.rally += evts.filter(
          (e) => e.type === "death" && e.side === PLAYER && e.key === "berserker",
        ).length;
      }
      if (enemyAug.current.active.includes("berserkers-rally")) {
        enemyAug.current.rally += evts.filter(
          (e) => e.type === "death" && e.side === ENEMY && e.key === "berserker",
        ).length;
      }
      setLastRound(
        result.roundWinner
          ? `${result.roundWinner === PLAYER ? "You" : "Enemy"} held the row — ${result.hpLoss} damage dealt`
          : "Both rows wiped — no damage",
      );
      if (result.matchWinner) {
        setPhase("over");
      } else {
        // Everyone who fell comes back: rebuild from the pre-combat roster,
        // carrying forward only the HP pools that combat changed.
        const respawned = cloneBoard(committedRef.current ?? result.board);
        respawned.hp = { ...result.board.hp };
        startRound(respawned, round + 1);
      }
    };

    // Frames are chained rather than all scheduled up front at absolute
    // offsets, so `speedRef` is re-read at every beat — toggling fast mode
    // mid-battle takes effect on the next frame instead of replaying the round.
    const step = () => {
      if (i >= frames.length) return finish();
      const frame = frames[i++];
      setBoard(frame.board);
      setHits(frame.hits);
      timer = window.setTimeout(step, frame.duration / speedRef.current);
    };

    timer = window.setTimeout(step, REVEAL_MS / speedRef.current);
    return () => clearTimeout(timer);
  }, [phase, frames, result, round, startRound]);

  const newMatch = () => {
    playerAug.current = createAugmentState();
    enemyAug.current = createAugmentState();
    committedRef.current = null;
    setLastRound(null);
    startRound(newBoard(), 1);
  };

  const hpPct = (side: Side) =>
    Math.max(0, Math.min(100, (board.hp[side] / START_HP) * 100));

  const renderHp = (side: Side, label: string) => (
    <div className={`hpbar hpbar--${side}`}>
      <span className="hpbar__label">{label}</span>
      <div className="hpbar__track">
        <div className={`hpbar__fill hpbar__fill--${side}`} style={{ width: `${hpPct(side)}%` }} />
      </div>
      <span className="hpbar__hp">{Math.max(0, board.hp[side])}</span>
    </div>
  );

  const phaseLabel =
    phase === "pick"
      ? picksLeft > 0
        ? `Pick ${picksLeft} more${boardFull ? " — row full, merge instead" : ""}`
        : "Arrange your row, then commit"
      : phase === "augment"
        ? "Choose an upgrade"
        : phase === "battle"
          ? "Battle!"
          : "Match over";

  const dragUnit = drag ? UNITS[drag.key] : null;

  /**
   * What acting on `dropCell` right now would do — the safety net for replace,
   * which discards whatever is standing there. Null when the hovered slot isn't
   * a legal destination, so the caller can fall back to naming the options.
   */
  const outcomeHint = (g: Grab): string | null => {
    const target = dropCell ? board.slots.player[dropCell.lane][dropCell.spot] : null;

    // A unit that's already on the board: reorder, or fold it into a twin. The
    // merge is destructive (one body becomes stats), so name it.
    if (g.kind === "unit") {
      const action = unitDropActionFor(dropCell, g);
      const source = board.slots.player[g.lane][g.from];
      if (action === "merge" && source && target) {
        const gain = unitMergeGain(source);
        // Both names are the same by definition, so say it once.
        return `Merge the two ${source.name}s → +${gain.atk}⚔ +${gain.hp}♥ (one fewer body)`;
      }
      // moveUnit re-inserts at exactly this index, so the slot number is honest
      // in both directions (position 1 is the front, the only one that fights).
      if (action === "reorder" && dropCell) return `Move to position ${dropCell.spot + 1}`;
      return null;
    }

    const action = dropActionFor(dropCell, g.key);
    const gain = mergeGain(g.key);
    switch (action) {
      case "merge":
        return `Merge into ${target?.name} → +${gain.atk}⚔ +${gain.hp}♥`;
      case "replace":
        return `⚠ Replace ${target?.name}${target && target.merges > 0 ? ` (+${target.merges} merged)` : ""} with ${UNITS[g.key].name}`;
      case "place":
        return `Place ${UNITS[g.key].name} here`;
      default:
        return null;
    }
  };

  /**
   * The options, for when no legal slot is under the pointer. Worded for the
   * gesture in progress: a drag is released, a click-selection is clicked.
   */
  const optionsHint = (g: Grab): string => {
    const verb = g === drag ? "Drop on" : "Click";
    if (g.kind === "unit") {
      const name = board.slots.player[g.lane][g.from]?.name ?? "Unit";
      return g === drag
        ? "Drop on a slot to reorder, or on a matching unit to merge"
        : `${name} picked up — click a slot to move it, another ${name} to merge, or click it again to cancel`;
    }
    const name = UNITS[g.key].name;
    return boardFull
      ? `Row full — ${verb.toLowerCase()} a ${name} to merge, or another unit to replace it`
      : `${verb} an empty slot to place, or a ${name} to merge`;
  };

  const grabHint = grab ? (outcomeHint(grab) ?? optionsHint(grab)) : "";

  return (
    <div className="app">
      <header className="app__header">
        <h1>Duel Deck</h1>
        <p className="app__subtitle">
          Round {round} · {phaseLabel}
          {playerAug.current.active.length > 0 && ` · ${playerAug.current.active.length} upgrades`}
        </p>
      </header>

      {renderHp(ENEMY, "Enemy")}

      <div className="app__stage">
        <canvas
          ref={canvasRef}
          className={`app__board${drag ? " app__board--dragging" : ""}`}
          onPointerDown={onBoardPointerDown}
          onPointerMove={onBoardPointerMove}
          onPointerLeave={onBoardPointerLeave}
          onClick={onBoardClick}
        />
        {phase === "augment" && !peeking && (
          <AugmentPanel
            round={round}
            offers={augOffers}
            onPick={onPickAugment}
            onPeek={() => setPeeking(true)}
          />
        )}
        {phase === "over" && result?.matchWinner && (
          <ResultPanel winner={result.matchWinner} round={round} onNewMatch={newMatch} />
        )}
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
        {showAugments && (
          <AugmentsView
            player={playerAug.current}
            enemy={enemyAug.current}
            onClose={() => setShowAugments(false)}
          />
        )}
      </div>

      {renderHp(PLAYER, "You")}

      {lastRound && <p className="app__log">{lastRound}</p>}

      <div className="hud">
        <button
          className="primary-btn"
          onClick={() => finishPicks(board, round)}
          disabled={phase !== "pick"}
        >
          Commit
        </button>
        <button
          className={`ghost-btn${fast ? " ghost-btn--on" : ""}`}
          onClick={toggleFast}
          aria-pressed={fast}
          title={`Battle speed: ${fast ? `${FAST_FACTOR}×` : "normal"}`}
        >
          {fast ? `⏩ ${FAST_FACTOR}×` : "▶ 1×"}
        </button>
        <button className="ghost-btn" onClick={() => setShowAugments(true)}>
          Upgrades {playerAug.current.active.length}/{enemyAug.current.active.length}
        </button>
        <button className="ghost-btn" onClick={() => setShowHelp(true)}>?</button>
        <button className="ghost-btn" onClick={newMatch}>New match</button>
      </div>

      <div className="hand">
        {phase === "pick" ? (
          offer.map((key, i) => {
            const u = UNITS[key];
            const isDragging = drag?.kind === "offer" && drag.index === i;
            const isSelected = selected?.kind === "offer" && selected.index === i;
            const taken = usedOffers.includes(i);
            const spent = taken || picksLeft <= 0;
            return (
              <button
                key={`${key}-${i}`}
                className={
                  `card${isSelected ? " card--selected" : ""}` +
                  `${isDragging ? " card--dragging" : ""}${taken ? " card--taken" : ""}`
                }
                disabled={spent}
                onPointerDown={(e) => !spent && beginPress({ kind: "offer", index: i, key }, e)}
                onClick={() =>
                  !spent && setSelected(isSelected ? null : { kind: "offer", index: i, key })
                }
              >
                <span className="card__name">{u.name}</span>
                {taken ? (
                  <span className="card__stats">taken</span>
                ) : (
                  <span className="card__stats">
                    <span className="stat stat--atk">⚔{u.atk}</span>
                    <span className="stat stat--hp">♥{u.maxHp}</span>
                  </span>
                )}
              </button>
            );
          })
        ) : phase === "augment" && peeking ? (
          // Lives in the normal flow, below the board — an absolutely
          // positioned button would cover the last unit slot.
          <button className="peek-back" onClick={() => setPeeking(false)}>
            ← Back to upgrades
          </button>
        ) : (
          <p className="hand__empty">
            {phase === "battle" ? "Resolving…" : phase === "augment" ? "Choose an upgrade above." : ""}
          </p>
        )}
      </div>

      {phase === "pick" && (
        <p className="app__hint">
          {grab
            ? grabHint
            : picksLeft <= 0
              ? "Drag or click your units to reorder, or onto a matching unit to merge"
              : boardFull
                ? "Row full — merge an offer into a unit of the same type"
                : "Drag or click: empty slot to place, matching unit to merge"}
        </p>
      )}

      {/* Drag ghost, following the pointer. */}
      {drag && dragPos && dragUnit && (
        <div className="ghost" style={{ left: dragPos.x, top: dragPos.y }}>
          <span className="ghost__name">{dragUnit.name}</span>
          <span className="ghost__stats">⚔{dragUnit.atk} ♥{dragUnit.maxHp}</span>
        </div>
      )}
    </div>
  );
}
