import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  capacityOf,
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
  reserveUnitIds,
  sideUnits,
  unitMergeGain,
  upgradeUnit,
} from "./engine/board";
import { resolveRound } from "./engine/combat";
import { KNIGHTING_BONUS, UNITS, mergesInto } from "./engine/units";
import type { AttackEvent, BattleEvent, Board, RoundResult, Tick, Unit } from "./engine/types";
import {
  AUGMENT_EVERY,
  AUGMENT_OFFER_COUNT,
  ENEMY,
  PICK_COUNT,
  PLAYER,
  START_HP,
  aiCommit,
  aiTakeAugment,
  isAugmentRound,
  knightAt,
  unitRerollsFor,
  upgradeTier,
  AUGMENT_REROLLS,
  newBoard,
  refreshForRound,
  rollOffer,
} from "./game/match";
import {
  AUGMENTS,
  createAugmentState,
  getAugment,
  mergeRatioFor,
  offerAugments,
  takeAugment,
  transferGrant,
  type AugmentDef,
  type AugmentState,
} from "./game/augments";
import { settleRound } from "./game/roundEnd";

/** Badge glyph for an augment id — "✦" if an id ever outlives its definition. */
const auraIcon = (id: string) => getAugment(id)?.icon ?? "✦";
import { cellCenter, draw, pixelToCell, type Cell, type TargetKind } from "./board/render";
import { POSE_MS, prefersReducedMotion, type Pose, type PoseState } from "./board/anim";
import { FxLayer, type FxKind } from "./board/fx";
import { HpBar } from "./ui/HpBar";
import { RoundBanner, type BannerTone } from "./ui/RoundBanner";
import { UnitPortrait } from "./ui/UnitPortrait";
import { UnitInfo } from "./ui/UnitInfo";
import {
  AugmentPanel,
  AugmentsView,
  ConfirmPanel,
  HelpPanel,
  ResultPanel,
  UnitsView,
} from "./ui/Overlays";
import "./App.css";

// Battle playback pacing. Each tick is three beats: wind-up (lunge toward the
// clash), clash (impact, damage, hold), settle (survivors step forward).
const REVEAL_MS = 450;
/** Wind-up ends at this fraction of the attack pose — where the lunge connects. */
const CLASH_AT = 0.55;
const WINDUP_MS = POSE_MS.attack * CLASH_AT;
const HOLD_MS = 340;
const HOLD_KILL_MS = 480;
const SETTLE_MS = 380;
/** Extra freeze on a big blow (ms, before speed scaling). */
const HIT_STOP_MS = 70;
const BIG_HIT = 7;
/** Pause on the round-result banner before the next round deals. */
const RESULT_MS = 1100;
/** How much fast mode compresses battle playback. */
const FAST_FACTOR = 3;
const FAST_KEY = "duel-deck:fast";
const MATCH_KEY = "duel-deck:match";
/** Bump when the saved shape changes — older saves are then ignored. */
const SAVE_VERSION = 5;
/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

interface SavedMatch {
  version: number;
  board: Board;
  round: number;
  offer: string[];
  player: AugmentState;
  enemy: AugmentState;
  /**
   * The round opens with an upgrade choice that hasn't been made yet. Saved so
   * a reload lands back on the choice instead of skipping it.
   */
  augmentPending?: boolean;
}

function loadMatch(): SavedMatch | null {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedMatch;
    if (s.version !== SAVE_VERSION || !s.board || !s.player || !s.enemy) return null;
    if (!Number.isInteger(s.round) || !Array.isArray(s.offer)) return null;
    reserveUnitIds(s.board);
    return s;
  } catch {
    return null; // corrupt or storage disabled — start fresh
  }
}

function saveMatch(s: Omit<SavedMatch, "version">) {
  try {
    localStorage.setItem(MATCH_KEY, JSON.stringify({ ...s, version: SAVE_VERSION }));
  } catch {
    /* not persisting is fine — the match still plays */
  }
}

function clearMatch() {
  try {
    localStorage.removeItem(MATCH_KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

type Phase = "pick" | "augment" | "battle" | "over";

/** Everything a pick-phase action can change, captured just before it. */
interface UndoEntry {
  board: Board;
  usedOffers: number[];
  picksLeft: number;
  /**
   * Merges move augment grants (Last Stand) between unit ids by mutating the
   * augment state, so the grants are snapshotted too — restoring only the
   * board would strand a grant on a unit that no longer exists.
   */
  grants: AugmentState["grants"];
}

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
  kind: "windup" | "clash" | "settle";
  /** Board to show during the beat (pre-blow for windup/clash, snapshot for settle). */
  board: Board;
  events: BattleEvent[];
  duration: number;
}

function buildFrames(committed: Board, ticks: Tick[]): Frame[] {
  const frames: Frame[] = [];
  let prev = committed;
  for (const tick of ticks) {
    // First strikes get their own quick beat ahead of the main clash. Deaths
    // they cause belong to that beat, so the clash doesn't replay them.
    const strikes = tick.events.filter((e): e is AttackEvent => e.type === "attack" && e.tag === "first-strike");
    let events = tick.events;
    if (strikes.length > 0) {
      const struck = new Set(strikes.map((s) => s.target));
      const strikeEvents = tick.events.filter(
        (e) => strikes.includes(e as AttackEvent) || (e.type === "death" && struck.has(e.unit)),
      );
      events = tick.events.filter((e) => !strikeEvents.includes(e));
      frames.push({ kind: "windup", board: prev, events: strikeEvents, duration: WINDUP_MS * 0.7 });
      frames.push({ kind: "clash", board: prev, events: strikeEvents, duration: HOLD_MS * 0.6 });
    }
    const killed = events.some((e) => e.type === "death");
    frames.push({ kind: "windup", board: prev, events, duration: WINDUP_MS });
    frames.push({
      kind: "clash",
      board: prev,
      events,
      duration: killed ? HOLD_KILL_MS : HOLD_MS,
    });
    frames.push({ kind: "settle", board: tick.snapshot, events: [], duration: SETTLE_MS });
    prev = tick.snapshot;
  }
  return frames;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** A saved match, read once; resuming always lands in the pick phase. */
  const [saved] = useState(loadMatch);
  const [board, setBoard] = useState<Board>(() => saved?.board ?? newBoard());
  const [round, setRound] = useState(saved?.round ?? 1);
  const [offer, setOffer] = useState<string[]>(() => saved?.offer ?? rollOffer());
  const [picksLeft, setPicksLeft] = useState(PICK_COUNT);
  /** Click-selected and awaiting a destination click. Mirrors `drag`. */
  const [selected, setSelected] = useState<Grab | null>(null);
  /** Offer slots already taken this round — each of the 5 is single-use. */
  const [usedOffers, setUsedOffers] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>(saved?.augmentPending ? "augment" : "pick");
  const [result, setResult] = useState<RoundResult | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [banner, setBanner] = useState<{ message: string | null; tone: BannerTone; nonce: number }>({
    message: null,
    tone: "neutral",
    nonce: 0,
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showUnits, setShowUnits] = useState(false);
  /** Commit was pressed with picks still unspent; waiting on "commit anyway?". */
  const [confirmCommit, setConfirmCommit] = useState(false);
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
  const [augOffers, setAugOffers] = useState<AugmentDef[]>(() =>
    saved?.augmentPending
      ? offerAugments(saved.player, AUGMENT_OFFER_COUNT, upgradeTier(saved.round))
      : [],
  );
  const [lastRound, setLastRound] = useState<string | null>(null);
  /** Unit-offer rerolls left this round (Scout adds one). */
  const [unitRerolls, setUnitRerolls] = useState(() =>
    unitRerollsFor(saved?.player ?? createAugmentState()),
  );
  /** Rerolls left on the current upgrade choice. */
  const [augRerolls, setAugRerolls] = useState(AUGMENT_REROLLS);
  /** Part of the offer-card key, so a reroll replays the deal-in. */
  const [rerollN, setRerollN] = useState(0);
  /**
   * Pick-phase states to step back to, newest last. Cleared whenever a round
   * starts, so a committed round can never be undone.
   */
  const [history, setHistory] = useState<UndoEntry[]>([]);

  // Drag state. `drag` is null until the pointer passes the drag threshold, so
  // a tap still behaves as a click.
  const [drag, setDrag] = useState<Grab | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  /**
   * Pointer position over the board while something is click-selected, so the
   * ghost follows the pointer for a click-then-click move exactly as for a drag.
   */
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  /** Unit under the pointer while nothing is in hand, for the stat breakdown. */
  const [info, setInfo] = useState<{ unit: Unit; x: number; y: number } | null>(null);
  const [dropCell, setDropCell] = useState<Cell | null>(null);
  const pending = useRef<{ drag: Grab; x: number; y: number } | null>(null);

  /**
   * Read by the playback loop at each frame boundary. A ref, not the state
   * value: the playback effect must not re-run when the speed changes, or the
   * round would restart from the first blow.
   */
  const speedRef = useRef(fast ? FAST_FACTOR : 1);

  /** Animation state, read every frame by the render loop (never React state). */
  const posesRef = useRef<Record<string, PoseState>>({});
  const fxRef = useRef<FxLayer>(null as unknown as FxLayer);
  if (!fxRef.current) fxRef.current = new FxLayer();
  const viewRef = useRef<Parameters<typeof draw>[1] | null>(null);

  const showBanner = useCallback((message: string, tone: BannerTone) => {
    setBanner((b) => ({ message, tone, nonce: b.nonce + 1 }));
  }, []);

  /** Scale a duration by playback speed, and halve it under reduced motion. */
  const scaled = (ms: number) => (ms / speedRef.current) * (prefersReducedMotion() ? 0.5 : 1);

  const setPose = (id: string, pose: Pose, ms: number) => {
    posesRef.current[id] = { pose, start: performance.now(), duration: scaled(ms) };
  };

  /** Fire an fx at a board cell, resolved to canvas pixels. */
  const fxAt = (
    b: Board,
    cell: Cell,
    kind: FxKind,
    extra: { amount?: number; lethal?: boolean } = {},
  ) => {
    const canvas = canvasRef.current;
    const c = canvas && cellCenter(canvas, b, cell);
    if (c) fxRef.current.add({ kind, x: c.x, y: c.y, size: c.size, side: cell.side, ...extra }, performance.now());
  };

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

  const playerAug = useRef<AugmentState>(saved?.player ?? createAugmentState());
  const enemyAug = useRef<AugmentState>(saved?.enemy ?? createAugmentState());
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
        // Reinforcements/capacity can cap the row below the board depth.
        return cell.spot >= occupants(board, PLAYER, cell.lane).length &&
          cell.spot < capacityOf(board, PLAYER)
          ? "place"
          : "invalid";
      }
      // With room in the row, landing on a unit inserts the new one there and
      // pushes the rest back (a twin's right half too — its left half merges).
      // Without room, a twin merges and anything else is replaced. Every click
      // on your row therefore does something, rather than silently switching
      // the selection to the unit that was clicked.
      if (mergesInto(unit.key, key)) return !boardFull && cell.zone === "right" ? "place" : "merge";
      return boardFull ? "replace" : "place";
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
      // Twins: the left half (the character) merges, the right half just moves.
      if (mergesInto(target.key, d.key)) return cell.zone === "right" ? "reorder" : "merge";
      return "reorder";
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

  // The loop reads this ref, so it is created once and never torn down on render.
  /** Whether merging into `target` (absorbing `source`, or one offered unit) knights it. */
  const knightsIt = (target: Unit, source: Unit | null): boolean =>
    target.key === "squire" &&
    target.merges + (source ? source.merges + 1 : 1) >= knightAt(playerAug.current);

  /** What each valid target would do with the thing in hand, for the badges. */
  const targetKinds: Record<string, TargetKind> = {};
  if (grab) {
    for (const c of validTargets) {
      const k = actionFor(c, grab);
      if (k === "invalid") continue;
      const occupant = board.slots.player[c.lane][c.spot];
      const twin = !!occupant && mergesInto(occupant.key, grab.key);
      targetKinds[`${c.lane},${c.spot}`] =
        grab.kind === "unit"
          ? twin
            ? "merge-or-move"
            : k
          : twin && !boardFull
            ? "merge-or-add"
            : k === "place" && occupant
              ? "insert"
              : k;
    }
  }

  /** Short outcome label for the hovered slot, drawn on the board itself. */
  const dropLabel = ((): string | null => {
    if (!grab || !dropCell || dropCell.side !== PLAYER) return null;
    const kind = actionFor(dropCell, grab);
    const target = board.slots.player[dropCell.lane][dropCell.spot];
    const ratio = mergeRatioFor(playerAug.current);
    if (kind === "merge" && target) {
      const source = grab.kind === "unit" ? board.slots.player[grab.lane][grab.from] : null;
      const base = source
        ? unitMergeGain(source, ratio, target.merges)
        : mergeGain(grab.key, ratio, target.merges);
      // Knighting adds its one-off bonus on top, so the preview matches the result.
      const knighted = knightsIt(target, source);
      const gain = knighted
        ? { atk: base.atk + KNIGHTING_BONUS.atk, hp: base.hp + KNIGHTING_BONUS.hp }
        : base;
      return `MERGE ⚔${target.atk}→${target.atk + gain.atk} ♥${target.maxHp}→${target.maxHp + gain.hp}${knighted ? " ⚜ KNIGHT!" : ""}`;
    }
    if (kind === "replace" && target) {
      return `REPLACE ${target.name}${target.merges > 0 ? ` (+${target.merges} lost)` : ""}`;
    }
    if (kind === "place" && target) return `↧ INSERT ${UNITS[grab.key].name} at #${dropCell.spot + 1}`;
    if (kind === "place") return `＋ ADD ${UNITS[grab.key].name}`;
    if (kind === "reorder") return `MOVE TO #${dropCell.spot + 1}`;
    return null;
  })();

  viewRef.current = {
    board,
    validTargets,
    targetKinds,
    dropLabel,
    heldKey: grab?.kind === "offer" ? grab.key : null,
    hits: [],
    // Nothing in hand means nothing to preview — otherwise the last hovered
    // slot keeps its outline after a click resolves the selection.
    dropCell: grab ? dropCell : null,
    dropKind: grab ? actionFor(dropCell, grab) : undefined,
    draggingId: drag?.kind === "unit" ? drag.unitId : null,
    selectedId: !drag && selected?.kind === "unit" ? selected.unitId : null,
    auraIcon,
  };

  // Render loop: draws every frame (also covers resizes, since draw sizes the canvas).
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const canvas = canvasRef.current;
      const view = viewRef.current;
      if (canvas && view) {
        draw(canvas, { ...view, time: performance.now(), poses: posesRef.current, fx: fxRef.current });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Click-selected unit holds the `selected` pose for as long as it is selected.
  const selectedUnitId = selected?.kind === "unit" ? selected.unitId : null;
  useEffect(() => {
    const poses = posesRef.current;
    for (const id of Object.keys(poses)) if (poses[id].pose === "selected") delete poses[id];
    if (selectedUnitId) poses[selectedUnitId] = { pose: "selected", start: performance.now(), duration: 600 };
  }, [selectedUnitId]);

  // Opening (or resumed) round announcement.
  useEffect(() => {
    showBanner(`Round ${round}`, "neutral");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshed = useCallback((b: Board): Board => {
    const next = cloneBoard(b);
    refreshForRound(next, playerAug.current, enemyAug.current);
    return next;
  }, []);

  // Fresh load with no save: persist the opening pick phase too.
  useEffect(() => {
    if (!saved) saveMatch({ board, round, offer, player: playerAug.current, enemy: enemyAug.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRound = useCallback(
    (base: Board, roundNum: number) => {
      const next = refreshed(base);
      const nextOffer = rollOffer();
      // Fallen units respawn with the same ids, so a held `dying` pose (its last
      // frame is fully faded) would leave them invisible. Replay their entrance.
      const now = performance.now();
      const poses: Record<string, PoseState> = {};
      for (const side of [PLAYER, ENEMY]) {
        for (const u of sideUnits(next, side)) {
          if (posesRef.current[u.id]?.pose === "dying") {
            poses[u.id] = { pose: "spawn", start: now, duration: POSE_MS.spawn };
          }
        }
      }
      posesRef.current = poses;
      // Upgrade rounds open with the upgrade, so it can shape this round's picks.
      // The pool is never refilled, so an exhausted one just skips the choice.
      const augs = isAugmentRound(roundNum)
        ? offerAugments(playerAug.current, AUGMENT_OFFER_COUNT, upgradeTier(roundNum))
        : [];
      saveMatch({
        board: next,
        round: roundNum,
        offer: nextOffer,
        player: playerAug.current,
        enemy: enemyAug.current,
        augmentPending: augs.length > 0,
      });
      setAugOffers(augs);
      setAugRerolls(AUGMENT_REROLLS);
      setUnitRerolls(unitRerollsFor(playerAug.current));
      setBoard(next);
      setRound(roundNum);
      setOffer(nextOffer);
      setPicksLeft(PICK_COUNT);
      setUsedOffers([]);
      setHistory([]);
      setSelected(null);
      setResult(null);
      setFrames([]);
      setPeeking(false);
      showBanner(augs.length > 0 ? `Round ${roundNum} · Upgrade!` : `Round ${roundNum}`, "neutral");
      setPhase(augs.length > 0 ? "augment" : "pick");
    },
    [refreshed, showBanner],
  );

  const commit = useCallback((current: Board) => {
    const committed = cloneBoard(current);
    aiCommit(committed, ENEMY, enemyAug.current);
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

  /** Commit the picks. Upgrades are chosen at the start of the round, so this always goes to battle. */
  const finishPicks = useCallback((current: Board) => commit(current), [commit]);

  // Note: picks never auto-commit. The player stays in the pick phase until
  // they press Commit, so there's always a chance to reorder the queue first.

  /** The current pick-phase state, for the undo stack. */
  const snapshot = (): UndoEntry => ({
    board,
    usedOffers,
    picksLeft,
    grants: JSON.parse(JSON.stringify(playerAug.current.grants)),
  });
  const pushUndo = () => {
    const entry = snapshot();
    setHistory((h) => [...h, entry]);
  };

  /** Step back one pick-phase action. Only ever reaches back to this round's start. */
  const undo = () => {
    if (phase !== "pick" || history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    playerAug.current.grants = prev.grants;
    setBoard(prev.board);
    setUsedOffers(prev.usedOffers);
    setPicksLeft(prev.picksLeft);
    setSelected(null);
  };

  // Ctrl/⌘+Z. Read through a ref so the listener isn't re-bound every render.
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** A Squire was just knighted: make it an occasion. */
  const announceKnight = (b: Board, cell: Cell) => {
    showBanner("⚜ Squire knighted!", "win");
    fxAt(b, cell, "bounty");
  };

  /** Place a new unit from the offer into the queue at `cell`. */
  const placeFromOffer = useCallback(
    (offerIndex: number, cell: Cell) => {
      if (picksLeft <= 0 || usedOffers.includes(offerIndex)) return;
      const next = cloneBoard(board);
      const key = offer[offerIndex];
      const action = dropActionFor(cell, key);
      const ok =
        action === "merge"
          ? upgradeUnit(next, PLAYER, cell.lane, cell.spot, key, mergeRatioFor(playerAug.current))
          : action === "replace"
            ? replaceUnit(next, PLAYER, cell.lane, cell.spot, key)
            : action === "place"
              ? insertUnit(next, PLAYER, cell.lane, cell.spot, makeUnit(key, PLAYER))
              : false;
      if (!ok) return;
      pushUndo();
      refreshForRound(next, playerAug.current, enemyAug.current);
      const landed = next.slots.player[cell.lane][cell.spot];
      if (landed) {
        if (action === "merge") {
          setPose(landed.id, "merge", POSE_MS.merge);
          fxAt(next, cell, "merge");
          const before = board.slots.player[cell.lane][cell.spot];
          if (before?.key === "squire" && landed.key === "knight") announceKnight(next, cell);
        } else {
          if (action === "replace") fxAt(next, cell, "replace");
          setPose(landed.id, "spawn", POSE_MS.spawn);
          fxAt(next, cell, "spawn");
        }
      }
      setBoard(next);
      setSelected(null);
      setUsedOffers((u) => [...u, offerIndex]);
      setPicksLeft(picksLeft - 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const undo = snapshot();
      if (action === "merge") {
        // Merging is free — it costs a body, not a pick.
        const targetId = next.slots.player[cell.lane][cell.spot]?.id;
        if (!mergePlaced(next, PLAYER, g.lane, g.from, cell.spot, mergeRatioFor(playerAug.current))) return;
        // Last Stand and friends live on the unit id — carry them to the survivor.
        if (targetId) {
          transferGrant(playerAug.current, g.unitId, targetId);
          const wasSquire = board.slots.player[cell.lane][cell.spot]?.key === "squire";
          refreshForRound(next, playerAug.current, enemyAug.current);
          const at = findUnitCell(next, targetId);
          if (at) {
            setPose(targetId, "merge", POSE_MS.merge);
            fxAt(next, at, "merge");
            if (wasSquire && next.slots.player[at.lane][at.spot]?.key === "knight") {
              announceKnight(next, at);
            }
          }
        }
      } else {
        moveUnit(next, PLAYER, g.lane, g.from, cell.spot);
      }
      setHistory((h) => [...h, undo]);
      refreshForRound(next, playerAug.current, enemyAug.current);
      setBoard(next);
      setSelected(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Nothing in hand: hovering a unit (either side) explains its numbers.
    if (!drag && !pending.current && !selected) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cell = pixelToCell(canvas, board, e.clientX - rect.left, e.clientY - rect.top);
      const unit = cell ? board.slots[cell.side][cell.lane]?.[cell.spot] : null;
      setInfo(unit ? { unit, x: e.clientX, y: e.clientY } : null);
      return;
    }
    setInfo(null);
    if (phase !== "pick" || drag || pending.current || !selected) return;
    setDropCell(cellAt(e.clientX, e.clientY));
    setHoverPos({ x: e.clientX, y: e.clientY });
  };

  const onBoardPointerLeave = () => {
    if (!drag && !pending.current) setDropCell(null);
    setHoverPos(null);
    setInfo(null);
  };

  // A new selection starts without a ghost until the pointer is over the board.
  useEffect(() => {
    if (!selected) setHoverPos(null);
  }, [selected]);

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

  /**
   * Reroll the cards not yet taken this round. Taken cards stay (their units
   * are on the board), so this works mid-round. Undo can't reach back past it —
   * the history's offer indices would point at the old cards.
   */
  const rerollOffer = () => {
    if (phase !== "pick" || unitRerolls <= 0 || picksLeft <= 0) return;
    const fresh = rollOffer();
    setOffer(offer.map((k, i) => (usedOffers.includes(i) ? k : fresh[i])));
    setUnitRerolls(unitRerolls - 1);
    setRerollN((n) => n + 1);
    setHistory([]);
    setSelected(null);
  };

  /** Reroll the upgrade choice: three fresh cards from the unlocked rarities. */
  const rerollAugments = () => {
    if (phase !== "augment" || augRerolls <= 0) return;
    setAugOffers(offerAugments(playerAug.current, AUGMENT_OFFER_COUNT, upgradeTier(round)));
    setAugRerolls(augRerolls - 1);
  };

  const onPickAugment = (id: string) => {
    const units = sideUnits(board, PLAYER);
    const cost = takeAugment(playerAug.current, id, units);
    const next = cloneBoard(board);
    if (cost) next.hp.player = Math.max(1, next.hp.player - cost);

    // Same tiered offer and reroll allowance as the player, picked for its row.
    aiTakeAugment(next, ENEMY, enemyAug.current, round);
    refreshForRound(next, playerAug.current, enemyAug.current);
    // The upgrade is locked in: re-save without the pending flag, so a reload
    // now resumes in this round's picks rather than offering it again.
    saveMatch({ board: next, round, offer, player: playerAug.current, enemy: enemyAug.current });
    setBoard(next);
    setPeeking(false);
    // Scout taken just now applies to this round's picks.
    setUnitRerolls(unitRerollsFor(playerAug.current));
    setPhase("pick");
  };

  /**
   * Rounds until the next upgrade choice: 0 while choosing one, null once the
   * pool is exhausted.
   */
  const upgradeIn =
    AUGMENTS.length - playerAug.current.active.length <= 0
      ? null
      : phase === "augment"
        ? 0
        : (Math.floor(round / AUGMENT_EVERY) + 1) * AUGMENT_EVERY - round;

  useEffect(() => {
    if (phase !== "battle" || !result) return;
    let timer = 0;
    let i = 0;
    /** Delayed fx (extra-hit numbers, heals) — cleared if playback is torn down. */
    const fxTimers: number[] = [];
    const later = (ms: number, fn: () => void) => {
      fxTimers.push(window.setTimeout(fn, scaled(ms)));
    };

    const finish = () => {
      // Momentum, rally, Veteran etc. — before the respawn snapshot is used.
      const committed = committedRef.current ?? result.board;
      const healed = settleRound(result, PLAYER, playerAug.current, committed);
      const enemyHealed = settleRound(result, ENEMY, enemyAug.current, committed);
      const { damageDealt: dealt, roundWinner: winner } = result;
      const bountyAmt = result.bounty ?? 0;
      const bounty = bountyAmt > 0 ? ` · +${bountyAmt} bounty` : "";
      if (bountyAmt > 0) {
        fxAt(committed, { side: PLAYER, lane: 0, spot: 0 }, "bounty", { amount: bountyAmt });
      }
      // Round damage is the winner's survivors' attack, so name the survivors.
      const left = result.survivors?.ids.length ?? 0;
      const standing = `${left} unit${left === 1 ? "" : "s"} left standing`;
      setLastRound(
        `${winner ? `${winner === PLAYER ? "You" : "Enemy"} held the row with ${standing}` : "Both rows wiped"}` +
          ` · dealt ${dealt.player} / took ${dealt.enemy}` +
          (winner ? ` · ${winner === PLAYER ? "Enemy" : "You"} lost ${result.hpLoss} HP` : " · no HP lost") +
          (healed > 0 ? ` · you healed ${healed} (Field medic)` : "") +
          (enemyHealed > 0 ? ` · enemy healed ${enemyHealed}` : "") +
          bounty,
      );
      if (winner === PLAYER) showBanner(`You hold the row! ${left} left · −${result.hpLoss}${bounty}`, "win");
      else if (winner === ENEMY) showBanner(`Wiped out! ${left} left · −${result.hpLoss}${bounty}`, "lose");
      else showBanner(`Both rows fall${bounty}`, "draw");
      // Let the result banner land before the next round deals.
      timer = window.setTimeout(() => {
        if (result.matchWinner) {
          clearMatch();
          setPhase("over");
        } else {
          // Everyone who fell comes back: rebuild from the pre-combat roster,
          // carrying forward only the HP pools that combat changed.
          const respawned = cloneBoard(committedRef.current ?? result.board);
          respawned.hp = { ...result.board.hp };
          startRound(respawned, round + 1);
        }
      }, scaled(RESULT_MS));
    };

    /** Both front units lunge at each other. */
    const windup = (f: Frame) => {
      for (const ev of f.events) {
        if (ev.type !== "attack") continue;
        // Cleave / thorns / last breath are side effects, not lunges.
        if (ev.tag === "cleave" || ev.tag === "thorns" || ev.tag === "last-breath") continue;
        setPose(ev.attacker, "attack", POSE_MS.attack);
      }
    };

    /** The blows land: impact, slashes, numbers, hit/death poses, shake. Returns extra hold (ms). */
    const clash = (f: Frame): number => {
      const all = f.events.filter((e): e is AttackEvent => e.type === "attack");
      const isExtra = (e: AttackEvent) =>
        e.tag === "cleave" || e.tag === "thorns" || e.tag === "last-breath";
      const attacks = all.filter((e) => !isExtra(e));
      const extras = all.filter(isExtra);
      const dying = new Set(f.events.flatMap((e) => (e.type === "death" ? [e.unit] : [])));
      const dmg = new Map<string, number>();
      let biggest = 0;
      for (const ev of all) {
        if (ev.blocked && ev.blocked > 0) {
          const at = findUnitCell(f.board, ev.target);
          if (at) fxAt(f.board, at, "block", { amount: ev.blocked });
        }
      }
      for (const ev of attacks) {
        if (ev.tag === "first-strike") {
          const at = findUnitCell(f.board, ev.attacker);
          if (at) fxAt(f.board, at, "first-strike");
        }
        dmg.set(ev.target, (dmg.get(ev.target) ?? 0) + ev.damage);
        biggest = Math.max(biggest, ev.damage);
        const from = findUnitCell(f.board, ev.attacker);
        const to = findUnitCell(f.board, ev.target);
        const canvas = canvasRef.current;
        const a = canvas && from && cellCenter(canvas, f.board, from);
        const b = canvas && to && cellCenter(canvas, f.board, to);
        if (a && b) {
          fxRef.current.add(
            { kind: "impact", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, size: a.size },
            performance.now(),
          );
        }
      }
      for (const [id, amount] of dmg) {
        const cell = findUnitCell(f.board, id);
        const lethal = dying.has(id);
        if (cell) {
          fxAt(f.board, cell, "slash");
          fxAt(f.board, cell, "damage", { amount, lethal });
          if (lethal) fxAt(f.board, cell, "death");
        }
        setPose(id, lethal ? "dying" : "hit", lethal ? POSE_MS.dying : POSE_MS.hit);
      }
      // Side-effect hits, nudged later so their numbers don't stack on one frame.
      extras.forEach((ev, n) => {
        const kind = ev.tag as "cleave" | "thorns" | "last-breath";
        const lethal = dying.has(ev.target);
        const src = findUnitCell(f.board, ev.attacker);
        const cell = findUnitCell(f.board, ev.target);
        const fxCell = kind === "last-breath" ? src : cell;
        if (fxCell) fxAt(f.board, fxCell, kind);
        if (!cell) return;
        if (!dmg.has(ev.target)) setPose(ev.target, lethal ? "dying" : "hit", lethal ? POSE_MS.dying : POSE_MS.hit);
        later(120 + n * 70, () => {
          fxAt(f.board, cell, "damage", { amount: ev.damage, lethal });
          if (lethal) fxAt(f.board, cell, "death");
        });
      });
      f.events.forEach((ev, n) => {
        if (ev.type !== "heal") return;
        const cell = findUnitCell(f.board, ev.unit);
        if (cell) later(160 + n * 50, () => fxAt(f.board, cell, "heal", { amount: ev.amount }));
      });
      const total = [...dmg.values()].reduce((x, y) => x + y, 0);
      if (!prefersReducedMotion() && total > 0) {
        const intensity = Math.min(1, 0.2 + total / 18 + (dying.size > 0 ? 0.3 : 0));
        fxRef.current.shake(intensity, performance.now());
      }
      const big = biggest >= BIG_HIT || dying.size > 0;
      return big && !prefersReducedMotion() ? HIT_STOP_MS : 0;
    };

    // Frames are chained rather than all scheduled up front at absolute
    // offsets, so `speedRef` is re-read at every beat — toggling fast mode
    // mid-battle takes effect on the next frame instead of replaying the round.
    const step = () => {
      if (i >= frames.length) return finish();
      const frame = frames[i++];
      setBoard(frame.board);
      let wait = scaled(frame.duration);
      if (frame.kind === "windup") windup(frame);
      else if (frame.kind === "clash") wait += scaled(clash(frame));
      timer = window.setTimeout(step, wait);
    };

    timer = window.setTimeout(step, scaled(REVEAL_MS));
    return () => {
      clearTimeout(timer);
      fxTimers.forEach(clearTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, frames, result, round, startRound, showBanner]);

  const newMatch = () => {
    playerAug.current = createAugmentState();
    enemyAug.current = createAugmentState();
    committedRef.current = null;
    posesRef.current = {};
    fxRef.current.clear();
    clearMatch();
    setLastRound(null);
    startRound(newBoard(), 1);
  };

  // The pick count lives on the label right above the offer cards (`pickLabel`),
  // where the eye already is when choosing; the header just names the phase.
  const phaseLabel =
    phase === "pick"
      ? "Build your row"
      : phase === "augment"
        ? "Choose an upgrade"
        : phase === "battle"
          ? "Battle!"
          : "Match over";

  // The ghost follows the pointer for a drag, or over the board for a click-selection.
  const ghostKey = drag ? drag.key : selected && hoverPos ? selected.key : null;
  const ghostPos = drag ? dragPos : hoverPos;
  const ghostUnit = ghostKey ? UNITS[ghostKey] : null;

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
        const gain = unitMergeGain(source, mergeRatioFor(playerAug.current), target.merges);
        const knighted = knightsIt(target, source) ? " — knights it!" : "";
        return source.key === target.key
          ? `Merge the two ${source.name}s → +${gain.atk}⚔ +${gain.hp}♥ (one fewer body)${knighted}`
          : `Merge ${source.name} into ${target.name} → +${gain.atk}⚔ +${gain.hp}♥ (one fewer body)`;
      }
      // moveUnit re-inserts at exactly this index, so the slot number is honest
      // in both directions (position 1 is the front, the only one that fights).
      if (action === "reorder" && dropCell) return `Move to position ${dropCell.spot + 1}`;
      return null;
    }

    const action = dropActionFor(dropCell, g.key);
    const gain = mergeGain(g.key, mergeRatioFor(playerAug.current), target?.merges ?? 0);
    switch (action) {
      case "merge":
        return `Merge into ${target?.name} → +${gain.atk}⚔ +${gain.hp}♥${target && knightsIt(target, null) ? " — knights it!" : ""}`;
      case "replace":
        return `⚠ Replace ${target?.name}${target && target.merges > 0 ? ` (+${target.merges} merged)` : ""} with ${UNITS[g.key].name}`;
      case "place":
        return target
          ? `Insert ${UNITS[g.key].name} at position ${dropCell!.spot + 1}, pushing the rest back`
          : `Add ${UNITS[g.key].name} to the back of your row`;
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
        ? `Drop on a slot to move it. On another ${name}: left half merges, right half just moves`
        : `${name} picked up — click a slot to move it. On another ${name}: left half merges, right half moves. Click it again to cancel`;
    }
    const name = UNITS[g.key].name;
    return boardFull
      ? `Row full — ${verb.toLowerCase()} a ${name} to merge, or another unit to replace it`
      : `${verb} an empty slot to add, a unit to insert ahead of it, or a ${name}'s left half to merge`;
  };

  const grabHint = grab ? (outcomeHint(grab) ?? optionsHint(grab)) : "";

  return (
    <div className="app">
      <header className="app__header">
        <h1>Duel Deck</h1>
        <p className="app__subtitle">
          Round {round} · {phaseLabel}
          {playerAug.current.active.length > 0 &&
            ` · ${playerAug.current.active.length} upgrade${playerAug.current.active.length === 1 ? "" : "s"}`}
        </p>
        {upgradeIn !== null && upgradeIn > 0 && (
          <p className={`next-upgrade${upgradeIn === 1 ? " next-upgrade--soon" : ""}`}>
            <span className="next-upgrade__pips" aria-hidden="true">
              {Array.from({ length: AUGMENT_EVERY }, (_, i) => (
                <span
                  key={i}
                  className={`next-upgrade__pip${i < AUGMENT_EVERY - upgradeIn ? " next-upgrade__pip--on" : ""}`}
                />
              ))}
            </span>
            ⬆ Upgrade {upgradeIn === 1 ? "next round" : `in ${upgradeIn} rounds`}
          </p>
        )}
      </header>

      <HpBar side={ENEMY} label="Enemy" hp={Math.max(0, board.hp.enemy)} max={START_HP} />

      <div className="app__stage">
        <canvas
          ref={canvasRef}
          className={`app__board${drag ? " app__board--dragging" : ""}`}
          onPointerDown={onBoardPointerDown}
          onPointerMove={onBoardPointerMove}
          onPointerLeave={onBoardPointerLeave}
          onClick={onBoardClick}
        />
        <RoundBanner message={banner.message} tone={banner.tone} nonce={banner.nonce} />
        {phase === "augment" && (
          <AugmentPanel
            round={round}
            offers={augOffers}
            onPick={onPickAugment}
            peeking={peeking}
            onPeek={() => setPeeking((p) => !p)}
            rerollsLeft={augRerolls}
            onReroll={rerollAugments}
          />
        )}
        {phase === "over" && result?.matchWinner && (
          <ResultPanel winner={result.matchWinner} round={round} onNewMatch={newMatch} />
        )}
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
        {showUnits && <UnitsView onClose={() => setShowUnits(false)} />}
        {confirmCommit && phase === "pick" && (
          <ConfirmPanel
            title="Commit with picks left?"
            message={`You still have ${picksLeft} pick${picksLeft === 1 ? "" : "s"} left this round. Unused picks are lost.`}
            confirmLabel="Commit anyway"
            cancelLabel="Keep picking"
            onConfirm={() => {
              setConfirmCommit(false);
              finishPicks(board);
            }}
            onCancel={() => setConfirmCommit(false)}
          />
        )}
        {showAugments && (
          <AugmentsView
            player={playerAug.current}
            enemy={enemyAug.current}
            onClose={() => setShowAugments(false)}
          />
        )}
      </div>

      <HpBar side={PLAYER} label="You" hp={Math.max(0, board.hp.player)} max={START_HP} />

      {lastRound && <p className="app__log">{lastRound}</p>}

      <div className="hud">
        <button
          className="primary-btn"
          // Unspent picks are almost always a misclick, not a plan — ask first.
          onClick={() => (picksLeft > 0 ? setConfirmCommit(true) : finishPicks(board))}
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
        <button
          className="ghost-btn"
          onClick={undo}
          disabled={phase !== "pick" || history.length === 0}
          title="Undo your last move this round (Ctrl/⌘+Z)"
        >
          ↶ Undo
        </button>
        <button className="ghost-btn" onClick={() => setShowAugments(true)}>
          Upgrades {playerAug.current.active.length}/{enemyAug.current.active.length}
        </button>
        <button className="ghost-btn" onClick={() => setShowUnits(true)}>📖 Units</button>
        <button className="ghost-btn" onClick={() => setShowHelp(true)}>?</button>
        <button className="ghost-btn" onClick={newMatch}>New match</button>
      </div>

      {phase === "pick" && (
        <div className="pick-row">
          <p
            key={picksLeft}
            className={`pick-label${picksLeft > 0 ? " pick-label--open" : " pick-label--done"}`}
          >
            {picksLeft > 0
              ? `Pick ${picksLeft}${boardFull ? " — row full: merge or replace" : ""}`
              : "✓ Picks done — arrange your row, then commit"}
          </p>
          {picksLeft > 0 && (
            <button
              className="ghost-btn ghost-btn--sm reroll-btn"
              onClick={rerollOffer}
              disabled={unitRerolls <= 0}
              title="Swap the cards you haven't taken for new ones"
            >
              🎲 Reroll ({unitRerolls})
            </button>
          )}
        </div>
      )}
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
                key={`${round}-${rerollN}-${key}-${i}`}
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
                <UnitPortrait unitKey={key} side="player" size={58} />
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
              ? "Drag or click your units to reorder — onto a matching unit's left half to merge"
              : boardFull
                ? "Row full — merge an offer into a unit of the same type"
                : "Drag or click: empty slot to place, matching unit to merge"}
        </p>
      )}

      {/* What's making a hovered unit's numbers what they are. */}
      {info && !grab && <UnitInfo unit={info.unit} x={info.x} y={info.y} />}

      {/* Ghost of the unit in hand, following the pointer. */}
      {ghostKey && ghostPos && ghostUnit && (
        // Offset to the lower right of the pointer (the CSS centres it on
        // left/top), so it never covers the slot and outcome label being aimed at.
        <div className="ghost" style={{ left: ghostPos.x + 44, top: ghostPos.y + 74 }}>
          <UnitPortrait unitKey={ghostKey} side="player" size={58} />
          <span className="ghost__name">{ghostUnit.name}</span>
          <span className="ghost__stats">⚔{ghostUnit.atk} ♥{ghostUnit.maxHp}</span>
        </div>
      )}
    </div>
  );
}
