import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  capacityOf,
  cloneBoard,
  mergeCapFor,
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
  writeLane,
} from "../engine/board";
import { resolveRound } from "../engine/combat";
import { ARCHETYPES, KNIGHTING_BONUS, MAX_LEVEL, SYNERGIES, SYNERGY_MIN, UNITS, canAbsorb, isMastered, levelOf, mergesInto, synergyOf } from "../engine/units";
import type { Archetype, AttackEvent, BattleEvent, Board, RoundResult, Side, Tick, Unit } from "../engine/types";
import {
  AUGMENT_EVERY,
  augmentOfferCount,
  ENEMY,
  OFFER_COUNT,
  PICK_COUNT,
  PLAYER,
  START_HP,
  aiCommit,
  aiTakeAugment,
  drillFor,
  rowMaxed,
  type Difficulty,
  isAugmentRound,
  knightAt,
  unitRerollsFor,
  upgradeTier,
  AUGMENT_REROLLS,
  newBoard,
  refreshForRound,
  rollOffer,
} from "../game/match";
import {
  AUGMENTS,
  createAugmentState,
  frozenAugments,
  getAugment,
  mergeRatioFor,
  offerAugments,
  takeAugment,
  toggleFrozenAugment,
  transferGrant,
  type AugmentDef,
  type AugmentState,
} from "../game/augments";
import { settleRound } from "../game/roundEnd";

/** Badge glyph for an augment id — "✦" if an id ever outlives its definition. */
const auraIcon = (id: string) =>
  getAugment(id)?.icon ??
  (id === "herald" ? "📯" : id === "warden" ? "🔰" : id === "acolyte" ? "💞" : id === "drill" ? "🎯" : id.startsWith("syn-") ? (SYNERGIES[id.slice(4) as Archetype]?.icon ?? "✦") : "✦");
import { cellCenter, draw, pixelToCell, type Cell, type TargetKind } from "../board/render";
import { POSE_MS, prefersReducedMotion, type Pose, type PoseState } from "../board/anim";
import { FxLayer, type FxKind } from "../board/fx";
import { HpBar } from "./HpBar";
import { EmoteBar } from "./EmoteBar";
import { Tutorial } from "./Tutorial";
import { HP_BAR_BLAST_MS, HpBarBlast } from "./HpBarBlast";
import { RoundBanner, type BannerTone } from "./RoundBanner";
import { PatchNotes } from "./PatchNotes";
import { UnitPortrait } from "./UnitPortrait";
import { OfferInfo, UnitInfo } from "./UnitInfo";
import {
  AugmentPanel,
  AugmentsView,
  ConfirmPanel,
  HelpPanel,
  ResultPanel,
  CodexView,
} from "./Overlays";
import { emptyStats, mvpOf, recordRound, type MatchStats } from "../game/stats";
import { MatchLog, rowLog, type PickLog } from "../game/telemetry";
import { SPEEDS, clearMatch, saveMatch, type SavedMatch, type Speed } from "../game/save";
import { sfx } from "../game/sound";
import {
  otherPlayer,
  packCommit,
  sendCommit,
  setWriteErrorHandler,
  stayPresent,
  unpackCommit,
  watchRoom,
  type Commit,
  type Player,
  type Session,
} from "../online/room";
import { UpdatePrompt } from "./UpdatePrompt";
import { MenuPanel } from "./MenuPanel";
import { SidePanels } from "./SidePanels";

// Battle playback pacing. Each tick is three beats: wind-up (lunge toward the
// clash), clash (impact, damage, hold), settle (survivors step forward).
const REVEAL_MS = 650;
/** Wind-up ends at this fraction of the attack pose — where the lunge connects. */
const CLASH_AT = 0.55;
const WINDUP_MS = POSE_MS.attack * CLASH_AT;
const HOLD_MS = 520;
const HOLD_KILL_MS = 720;
const SETTLE_MS = 520;
/** Extra freeze on a big blow (ms, before speed scaling). */
const HIT_STOP_MS = 70;
const BIG_HIT = 7;
/**
 * An ability beat: playback pauses on death buffs and Charge so the beam,
 * the name and the numbers can be read before the battle moves on.
 */
const ABILITY_MS = 1100;
/** After the main blows, before the first side hit (Overflow, Thorns…) plays. */
const EXTRA_GAP_MS = 450;
/** Overflow's shockwave travel: its damage lands on the second target on arrival. */
const OVERFLOW_TRAVEL_MS = 620;
/** Between consecutive side hits. */
const EXTRA_STEP_MS = 380;
/** Extra hold on a clash with an in-swing ability (dodge, Overflow, Riposte). */
const ABILITY_HOLD_MS = 650;
/** Pause on the round-result banner before the next round deals. */
const RESULT_MS = 1500;
/** Matches the phone breakpoint in App.css. */
const COMPACT_QUERY = "(max-width: 44.99rem)";
const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
/** Pointer travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** Lines kept in the battle feed (the oldest fade out as new ones arrive). */
const FEED_MAX = 4;
/** A piece of a feed line: plain text, or a unit name coloured by its side. */
type FeedPart = string | { text: string; side: Side };
interface FeedItem {
  id: number;
  tone: "hit" | "death" | "ability" | "dodge";
  parts: FeedPart[];
}

/** Touch has no hover: holding this long on a unit or offer card opens its info card. */
const LONG_PRESS_MS = 450;
/**
 * The tutorial's first two offers, so the lesson always has what it needs:
 * round 1 deals Strikers and Guards, round 2 deals both again, so whatever
 * the player took, a merge is on offer when the merge step comes up.
 */
const TUTORIAL_OFFERS: Record<number, string[]> = {
  1: ["striker", "guard", "berserker", "striker", "guard"],
  2: ["striker", "guard", "berserker", "medic", "bulwark"],
};
/** Losing the match: wait for the last fall to read, then the blast plays this long before the result screen. */
const EXPLOSION_DELAY_MS = 350;
const EXPLOSION_MS = 1700;
/** Winning the match: a beat after the last blow, the enemy's HP bar blows up (see HpBarBlast). */
const BAR_BLAST_DELAY_MS = 300;

/**
 * "waiting" is online only: your row is committed and locked, and the round
 * can't resolve until the opponent commits theirs too.
 */
type Phase = "pick" | "augment" | "battle" | "over" | "waiting";

/** Everything a pick-phase action can change, captured just before it. */
interface UndoEntry {
  board: Board;
  usedOffers: number[];
  /** Taking a frozen card unfreezes it, so undo must put that back. */
  frozen: number[];
  picksLeft: number;
  /** The round's telemetry picks, so an undone pick isn't logged. */
  picks: PickLog[];
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
  kind: "windup" | "clash" | "settle" | "ability";
  /** Board to show during the beat (pre-blow for windup/clash, snapshot for settle). */
  board: Board;
  events: BattleEvent[];
  duration: number;
}

/**
 * The board after some of a tick's events, before the dead are removed: hits
 * take health off, heals and death buffs add it. Mirrors what combat.ts did,
 * so each beat can show its own changes instead of waiting for the tick's
 * end snapshot — damage lands before any ability fires.
 */
function applyEvents(board: Board, events: BattleEvent[]): Board {
  const next = cloneBoard(board);
  for (const ev of events) applyEvent(next, ev);
  return next;
}

/** Apply one event's stat change to `board` in place. */
function applyEvent(board: Board, ev: BattleEvent): void {
  const id = ev.type === "attack" ? ev.target : ev.type === "heal" || ev.type === "buff" ? ev.unit : null;
  const cell = id ? findUnitCell(board, id) : null;
  const u = cell ? board.slots[cell.side][cell.lane][cell.spot] : null;
  if (!u) return;
  if (ev.type === "attack") {
    u.hp -= ev.damage;
    if (ev.shieldLeft !== undefined) u.shieldLeft = ev.shieldLeft;
  }
  else if (ev.type === "heal") u.hp += ev.amount;
  else if (ev.type === "buff") {
    u.atk += ev.atk;
    u.maxHp += ev.hp;
    u.hp += ev.hp;
  }
}

/** A stat change as playback labels it: "+2⚔ +3♥", or "−4♥" for a loss. */
const statText = (atk: number, hp: number) =>
  [atk ? `${atk > 0 ? "+" : "−"}${Math.abs(atk)}⚔` : "", hp ? `${hp > 0 ? "+" : "−"}${Math.abs(hp)}♥` : ""].filter(Boolean).join(" ");

function buildFrames(committed: Board, ticks: Tick[], opening: BattleEvent[] = []): Frame[] {
  const frames: Frame[] = [];
  let prev = committed;
  // Start-of-round support (Rally, Lifebond) gets its own beat before anyone
  // moves, so the gift is seen landing rather than already baked in.
  if (opening.length > 0) {
    frames.push({ kind: "ability", board: prev, events: opening, duration: ABILITY_MS });
    prev = applyEvents(prev, opening);
  }
  for (const tick of ticks) {
    // Charge gets its own beat before any lunge — ahead of a first strike too,
    // since a Striker's first swing can be both.
    const charges = tick.events.filter((e) => e.type === "attack" && (e.opening ?? 0) > 0);
    if (charges.length > 0) frames.push({ kind: "ability", board: prev, events: charges, duration: ABILITY_MS * 0.7 });
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
      prev = applyEvents(prev, strikeEvents);
    }
    // Death buffs get their own beat after the blows, so they aren't lost in the clash.
    const buffs = events.filter((e) => e.type === "buff");
    events = events.filter((e) => e.type !== "buff");
    const killed = events.some((e) => e.type === "death");
    frames.push({ kind: "windup", board: prev, events, duration: WINDUP_MS });
    frames.push({
      kind: "clash",
      board: prev,
      events,
      duration: killed ? HOLD_KILL_MS : HOLD_MS,
    });
    // The ability beat opens on the board with this tick's hits already taken.
    const struck = applyEvents(prev, events);
    if (buffs.length > 0) frames.push({ kind: "ability", board: struck, events: buffs, duration: ABILITY_MS });
    frames.push({ kind: "settle", board: tick.snapshot, events: [], duration: SETTLE_MS });
    prev = tick.snapshot;
  }
  return frames;
}

export interface GameProps {
  /**
   * A match to resume, or null to start a fresh one. Read once on mount —
   * App remounts Game (via `key`) to start a different match, so this never
   * has to be watched for changes.
   */
  resume: SavedMatch | null;
  /** Opponent for a fresh match; a resumed one keeps the one it was saved with. */
  difficulty: Difficulty;
  /** Battle playback multiplier, cycled by the HUD button. */
  speed: Speed;
  onSpeed: (speed: Speed) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  battleLog: boolean;
  onBattleLog: (on: boolean) => void;
  /** Back to the title screen (New match, or leaving a finished one). */
  onExit: () => void;
  /** Set for an online match: the opponent is a person, not `aiCommit`. */
  online?: Session;
  /** The first-match tutorial: coach card, set first offers, never saved or logged. */
  tutorial?: boolean;
}

export function Game({ resume, difficulty: startDifficulty, speed, onSpeed, sound, onSound, battleLog, onBattleLog, onExit, online, tutorial }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** The match being resumed, if any; resuming always lands in the pick phase. */
  const [saved] = useState(() => resume);
  const [board, setBoard] = useState<Board>(() => saved?.board ?? newBoard());
  const [round, setRound] = useState(saved?.round ?? 1);
  const [offer, setOffer] = useState<string[]>(
    () => saved?.offer ?? (tutorial ? TUTORIAL_OFFERS[1].slice() : rollOffer(OFFER_COUNT, saved?.player)),
  );
  const [picksLeft, setPicksLeft] = useState(PICK_COUNT);
  /** Click-selected and awaiting a destination click. Mirrors `drag`. */
  const [selected, setSelected] = useState<Grab | null>(null);
  /** Offer slots already taken this round — each of the 5 is single-use. */
  const [usedOffers, setUsedOffers] = useState<number[]>([]);
  /**
   * Freeze: offer slots the player has locked. A frozen card survives rerolls
   * and carries into the next round's offer in the same slot, until it's taken
   * (which unfreezes it) or unfrozen. Refs, because startRound is a callback
   * created once and must read the latest.
   */
  const [frozen, setFrozen] = useState<number[]>(() => saved?.frozen ?? []);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const offerRef = useRef(offer);
  offerRef.current = offer;
  /** The last save, so a freeze toggle can re-save it with the change. */
  const lastSave = useRef<Omit<SavedMatch, "version"> | null>(null);
  const save = (s: Omit<SavedMatch, "version">) => {
    lastSave.current = s;
    // An online match lives in the room, not in localStorage: half of it is
    // the opponent's, so a local restore would put the two devices out of
    // step. Reloading rejoins through the room instead.
    // The tutorial isn't saved either: it mustn't replace a real match in progress.
    if (!online && !tutorial) saveMatch(s);
  };
  /** Balance telemetry for this match (game/telemetry.ts). */
  const [matchLog] = useState(() =>
    tutorial ? MatchLog.none() : online ? MatchLog.online(online.code, online.me) : MatchLog.cpu(!!saved, saved?.difficulty ?? startDifficulty),
  );
  /**
   * This round's log so far: the cards as dealt, each pick, and rerolls spent.
   * The picks are snapshotted for undo along with the board.
   */
  const roundLog = useRef<{ offer: string[]; picks: PickLog[]; rr: number; augRr: number }>({
    offer: offer.slice(),
    picks: [],
    rr: 0,
    augRr: 0,
  });
  /** The win's slow-motion HP-bar explosion is playing (and the bar stays gone). */
  const [barBlast, setBarBlast] = useState(false);
  const [phase, setPhase] = useState<Phase>(saved?.augmentPending ? "augment" : "pick");
  const [result, setResult] = useState<RoundResult | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [banner, setBanner] = useState<{ message: string | null; tone: BannerTone; nonce: number }>({
    message: null,
    tone: "neutral",
    nonce: 0,
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  /** Phone-width layout: smaller card portraits so five cards fit on one line. */
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const [showUnits, setShowUnits] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  /** Battle was pressed with picks still unspent; waiting on "battle anyway?". */
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [showAugments, setShowAugments] = useState(false);
  /** Augment offer temporarily hidden so the player can inspect the board. */
  const [peeking, setPeeking] = useState(false);
  /**
   * Enemy AI difficulty: the title screen's choice for a fresh match, or
   * whatever a resumed one was saved with. Fixed for the match either way, so
   * it's read once rather than followed.
   */
  const [difficulty] = useState<Difficulty>(() => saved?.difficulty ?? startDifficulty);
  const difficultyRef = useRef(difficulty);
  const [augOffers, setAugOffers] = useState<AugmentDef[]>(() =>
    saved?.augmentPending
      ? offerAugments(saved.player, augmentOfferCount(saved.player), upgradeTier(saved.round))
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
  /** Offer card under the pointer, for its unit's ability card. */
  const [offerInfo, setOfferInfo] = useState<{ key: string; x: number; y: number } | null>(null);
  /** Unit under the pointer while nothing is in hand, for the stat breakdown. */
  const [info, setInfo] = useState<{ unit: Unit; x: number; y: number } | null>(null);
  const [dropCell, setDropCell] = useState<Cell | null>(null);
  const pending = useRef<{ drag: Grab; x: number; y: number } | null>(null);

  /**
   * Touch stand-in for hover: an info card opened by a long-press (or a tap
   * that has nothing else to do), held open until the next tap anywhere. A
   * unit is kept by id and looked up on the live board, so the card follows
   * its numbers through merges and battle rather than freezing a snapshot.
   */
  const [pinned, setPinned] = useState<
    { kind: "unit"; id: string; x: number; y: number } | { kind: "offer"; key: string; x: number; y: number } | null
  >(null);
  /**
   * Battle feed: a running account of the round, shown where the offer cards
   * sit while they're away. Unit names are coloured by side, so "Guard hits
   * Guard" still reads. Cleared as each battle starts; newest last.
   */
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedId = useRef(0);
  /**
   * Append a line to the battle feed. Gated here rather than at the render:
   * with the log off this is called several times a beat and every call would
   * be a state update whose result is never shown.
   */
  const logRef = useRef(battleLog);
  logRef.current = battleLog;
  const pushFeed = (tone: FeedItem["tone"], parts: FeedItem["parts"]) => {
    if (!logRef.current) return;
    setFeed((f) => [...f.slice(-(FEED_MAX - 1)), { id: feedId.current++, tone, parts }]);
  };
  const nameOf = (u: Unit): FeedPart => ({ text: u.name, side: u.side });

  /** The hint line: a click-selection's details card docks just above it. */
  const hintRef = useRef<HTMLParagraphElement>(null);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Set when a press opened or closed a card, so its trailing click does nothing else. */
  const swallowClick = useRef(false);
  /** How the last board press was made (a click isn't a PointerEvent in older Safari). */
  const boardPointerType = useRef("mouse");

  /**
   * Read by the playback loop at each frame boundary. A ref, not the state
   * value: the playback effect must not re-run when the speed changes, or the
   * round would restart from the first blow.
   */
  const speedRef = useRef<number>(speed);

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
    extra: { amount?: number; lethal?: boolean; text?: string } = {},
  ) => {
    const canvas = canvasRef.current;
    const c = canvas && cellCenter(canvas, b, cell);
    if (c) fxRef.current.add({ kind, x: c.x, y: c.y, size: c.size, side: cell.side, ...extra }, performance.now());
  };

  /** An effect that travels from one cell to another (beam, flame, shockwave). */
  const fxBetween = (b: Board, from: Cell, to: Cell, kind: FxKind) => {
    const canvas = canvasRef.current;
    const a = canvas && cellCenter(canvas, b, from);
    const c = canvas && cellCenter(canvas, b, to);
    if (a && c) {
      fxRef.current.add({ kind, x: a.x, y: a.y, size: a.size, side: from.side, tx: c.x, ty: c.y }, performance.now());
    }
  };

  /**
   * The match is lost: every unit on your row bursts, then the whole row goes
   * up in one blast from its middle. Vibrates where the browser allows it
   * (Android; iOS Safari has no vibration API, so it's simply skipped).
   */
  const explodeRow = (b: Board) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cap = capacityOf(b, PLAYER);
    const first = cellCenter(canvas, b, { side: PLAYER, lane: 0, spot: 0 });
    const last = cellCenter(canvas, b, { side: PLAYER, lane: 0, spot: Math.max(0, cap - 1) });
    if (!first || !last) return;
    const now = performance.now();
    sideUnits(b, PLAYER).forEach((u, i) => {
      const cell = findUnitCell(b, u.id);
      if (cell) window.setTimeout(() => fxAt(b, cell, "death"), i * 55);
    });
    fxRef.current.add({ kind: "explosion", x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, size: first.size, side: PLAYER }, now);
    sfx("explode");
    try {
      if (sound) navigator.vibrate?.([60, 40, 140]);
    } catch {
      /* not supported */
    }
  };

  /** Float an ability's name over the unit that used it, so players learn what fired. */
  /** Every named ability announces itself the same way. */
  const abilityLabel = (b: Board, cell: Cell, name: string) => {
    sfx("ability");
    fxAt(b, cell, "ability-label", { text: `✦ ${name}` });
    const u = b.slots[cell.side][cell.lane][cell.spot];
    if (u) pushFeed("ability", [nameOf(u), ` ✦ ${name}`]);
  };

  /** The unit (and its cell) with this id on a board, if it's there. */
  const unitAt = (b: Board, id: string) => {
    const cell = findUnitCell(b, id);
    return cell ? { cell, unit: b.slots[cell.side][cell.lane][cell.spot]! } : null;
  };

  /**
   * Step to the next playback speed, wrapping 1 -> 2 -> 3 -> 1. One button
   * rather than three, because it's pressed mid-battle and the row is already
   * tight on a phone; the label always names the speed in force.
   *
   * The ref is written here rather than in an effect on `speed`: the playback
   * loop reads it at the next frame boundary, and an effect only flushes after
   * paint. App owns the stored preference.
   */
  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    speedRef.current = next;
    onSpeed(next);
  };

  const playerAug = useRef<AugmentState>(saved?.player ?? createAugmentState());
  const enemyAug = useRef<AugmentState>(saved?.enemy ?? createAugmentState());
  /**
   * The board as committed, before any blows land — every unit alive and in
   * queue order. Fallen units respawn at the end of the round, so this snapshot
   * (not the post-combat board) is what the next round is built from.
   */
  const committedRef = useRef<Board | null>(null);
  /**
   * Your row as it stood when the round began. Hard simulates against this —
   * what a player could see too — not the picks you're committing now.
   */
  const scoutRef = useRef<Board | null>(saved?.board ?? null);
  /** Match tallies for the end screen; saved with the match. */
  const statsRef = useRef<MatchStats>(saved?.stats ?? emptyStats());

  const boardFull = emptySpotCount(board, PLAYER) === 0;

  /**
   * What dropping `key` on a slot would do. Single source of truth shared by
   * the drop handler, the highlight colours and the hint — so what the player
   * is told is always exactly what will happen.
   */
  type DropAction = "place" | "merge" | "replace" | "reorder" | "invalid";
  /** Ascendant: one unit, no cap, and every card merges into it whatever its type. */
  const ascendant = mergeCapFor(board, PLAYER) === Infinity;
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
      if (mergesInto(unit.key, key) || ascendant) {
        // A twin at its level cap can't take more: with room the card inserts
        // beside it; with the row full there's nothing to do here (replacing a
        // maxed unit with its own type would only throw its levels away).
        if (!canAbsorb(unit.key, unit.merges, key, 1, mergeCapFor(board, PLAYER))) return boardFull ? "invalid" : "place";
        return !boardFull && cell.zone === "right" ? "place" : "merge";
      }
      return boardFull ? "replace" : "place";
    },
    [board, boardFull, ascendant],
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
      if (mergesInto(target.key, d.key) || ascendant) {
        const source = board.slots.player[d.lane][d.from];
        const fits = !!source && canAbsorb(target.key, target.merges, source.key, source.merges + 1, mergeCapFor(board, PLAYER));
        return fits && cell.zone !== "right" ? "merge" : "reorder";
      }
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
      // A twin only offers the merge while it's under the cap.
      const grabbed = grab.kind === "unit" ? board.slots.player[grab.lane][grab.from] : null;
      const twin =
        !!occupant &&
        canAbsorb(occupant.key, occupant.merges, grab.key, grabbed ? grabbed.merges + 1 : 1, mergeCapFor(board, PLAYER));
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
      return `MERGE ⚔${target.atk} ♥${target.maxHp} → ⚔${target.atk + gain.atk} ♥${target.maxHp + gain.hp}${knighted ? " ⚜ KNIGHT!" : ""}`;
    }
    if (kind === "replace" && target) {
      return `REPLACE ${target.name}${target.merges > 0 ? ` (Lv${levelOf(target.merges)} lost)` : ""}`;
    }
    if (kind === "place" && target) return `↧ INSERT ${UNITS[grab.key].name} at #${dropCell.spot + 1}`;
    if (kind === "place") return `＋ ADD ${UNITS[grab.key].name}`;
    if (kind === "reorder") return `MOVE TO #${dropCell.spot + 1}`;
    if (target && mergesInto(target.key, grab.key) && !ascendant) return `MAX LEVEL ${MAX_LEVEL}`;
    return null;
  })();

  /**
   * Progress toward a full-row synergy, for the pick label: the synergy's name
   * once the row is all one class, or "🔥 3/5" once three or more share one.
   */
  const classNote = ((): string | null => {
    const units = sideUnits(board, PLAYER);
    const cap = capacityOf(board, PLAYER);
    const syn = synergyOf(units, cap);
    if (syn) return `${SYNERGIES[syn].icon} ${SYNERGIES[syn].name}`;
    if (cap < SYNERGY_MIN) return null;
    const counts = new Map<Archetype, number>();
    for (const u of units) counts.set(UNITS[u.key].archetype, (counts.get(UNITS[u.key].archetype) ?? 0) + 1);
    const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    // Only while every unit so far shares the class (a mixed row would need replacing first).
    return best && n >= 3 && n === units.length ? `${SYNERGIES[best].icon} ${n}/${cap}` : null;
  })();

  /** Merges a Squire still needs to be knighted, by its own side's threshold. */
  const squireToGo = (u: Unit): number | null =>
    u.key === "squire" ? knightAt(u.side === PLAYER ? playerAug.current : enemyAug.current) - u.merges : null;

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
    classIcon: (u: Unit) => ARCHETYPES[UNITS[u.key]?.archetype]?.icon,
    promoteIn: squireToGo,
    battle: phase === "battle",
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

  // Opening (or resumed) round announcement. The opponent is already chosen on
  // the title screen, so this fires for a fresh match too.
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
    const opening = { board, round, offer, player: playerAug.current, enemy: enemyAug.current, difficulty: difficultyRef.current, stats: statsRef.current, frozen, augmentPending: saved?.augmentPending };
    if (!saved) save(opening);
    else lastSave.current = opening;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRound = useCallback(
    (base: Board, roundNum: number) => {
      // Drill lasts one round.
      playerAug.current.drill = 0;
      enemyAug.current.drill = 0;
      const next = refreshed(base);
      scoutRef.current = next;
      // Frozen cards keep their slot; the rest are dealt fresh.
      const keep = frozenRef.current;
      const prevOffer = offerRef.current;
      const dealt = tutorial && TUTORIAL_OFFERS[roundNum] ? TUTORIAL_OFFERS[roundNum].slice() : rollOffer(OFFER_COUNT, playerAug.current);
      const nextOffer = dealt.map((k, i) => (keep.includes(i) && prevOffer[i] ? prevOffer[i] : k));
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
        ? offerAugments(playerAug.current, augmentOfferCount(playerAug.current), upgradeTier(roundNum))
        : [];
      save({
        board: next,
        round: roundNum,
        offer: nextOffer,
        player: playerAug.current,
        enemy: enemyAug.current,
        augmentPending: augs.length > 0,
        difficulty: difficultyRef.current,
        stats: statsRef.current,
        frozen: keep,
      });
      roundLog.current = { offer: nextOffer.slice(), picks: [], rr: 0, augRr: 0 };
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
      // A full row of one class announces its synergy with the round.
      const syn = synergyOf(sideUnits(next, PLAYER), capacityOf(next, PLAYER));
      const synNote = syn ? ` · ${SYNERGIES[syn].icon} ${SYNERGIES[syn].name}!` : "";
      showBanner(augs.length > 0 ? `Round ${roundNum} · Upgrade!${synNote}` : `Round ${roundNum}${synNote}`, "neutral");
      setPhase(augs.length > 0 ? "augment" : "pick");
    },
    [refreshed, showBanner],
  );

  /**
   * Online: the row as committed, held until the opponent's arrives. A ref,
   * not state, because the room watcher is subscribed once and must read the
   * current value rather than close over the one from its subscribe render.
   */
  const pendingCommit = useRef<Board | null>(null);
  const roundRef = useRef(round);
  roundRef.current = round;
  /** The opponent's connection, for the waiting screen. */
  const [oppPresent, setOppPresent] = useState(true);
  /** Set when the opponent leaves for good — the match can't continue. */
  const [oppLeft, setOppLeft] = useState(false);

  /** Start playback of a fully-assembled round (both rows final, stats applied). */
  const playRound = useCallback((committed: Board) => {
    // resolveRound clones its input, so `committed` keeps the full roster.
    const res = resolveRound(committed);
    committedRef.current = committed;
    setBoard(committed);
    setResult(res);
    setFrames(buildFrames(committed, res.ticks, res.opening));
    setSelected(null);
    setPhase("battle");
  }, []);

  /**
   * Both sides have committed: build the round and play it. Each device does
   * this independently and must reach the same board — which is why the
   * opponent's upgrades travel with their row (effective stats depend on both
   * sides') and why nothing here may consult local-only state.
   */
  const resolveOnline = useCallback(
    (mine: Board, theirs: Commit) => {
      const committed = cloneBoard(mine);
      const { lanes, aug } = unpackCommit(theirs, ENEMY, committed.lanes);
      for (let lane = 0; lane < committed.lanes; lane++) {
        writeLane(committed, ENEMY, lane, lanes[lane]);
      }
      enemyAug.current = aug;
      refreshForRound(committed, playerAug.current, enemyAug.current);
      playRound(committed);
    },
    [playRound],
  );

  const commit = useCallback(
    (current: Board, unusedPicks = 0) => {
      // Drill: a maxed row turns its unspent picks into attack for this round.
      // On the augment state, so it travels with an online commit.
      playerAug.current.drill = drillFor(current, PLAYER, unusedPicks);
      if (online) {
        // Lock the row in and publish it. The round can't be built until the
        // opponent's arrives, so there is nothing to show but the wait.
        const mine = cloneBoard(current);
        pendingCommit.current = mine;
        void sendCommit(
          online,
          packCommit(
            roundRef.current,
            Array.from({ length: mine.lanes }, (_, lane) => occupants(mine, PLAYER, lane)),
            playerAug.current,
          ),
        );
        setSelected(null);
        setPhase("waiting");
        return;
      }
      const committed = cloneBoard(current);
      const aiPicked = aiCommit(committed, ENEMY, enemyAug.current, {
        difficulty: difficultyRef.current,
        oppAug: playerAug.current,
        scout: scoutRef.current ?? current,
      });
      enemyAug.current.drill = drillFor(committed, ENEMY, PICK_COUNT - aiPicked.length);
      refreshForRound(committed, playerAug.current, enemyAug.current);
      playRound(committed);
    },
    [online, playRound],
  );

  /** Commit the picks. Upgrades are chosen at the start of the round, so this always goes to battle. */
  const finishPicks = (current: Board) => commit(current, picksLeft);

  // --- Online: the room ----------------------------------------------------

  const resolveRef = useRef(resolveOnline);
  resolveRef.current = resolveOnline;

  useEffect(() => (online ? stayPresent(online) : undefined), [online]);

  // A write that the server refuses means the room is gone (host closed it, or
  // it was cleaned up). Nothing can be committed after that, so say so rather
  // than leaving the player waiting on an opponent who can never arrive.
  useEffect(() => {
    if (!online) return;
    setWriteErrorHandler(() => setOppLeft(true));
    return () => setWriteErrorHandler(null);
  }, [online]);

  /**
   * Watch the room for the opponent's commit. Subscribed once per session, so
   * everything inside reads refs: re-subscribing each round would drop and
   * re-add the listener at exactly the moment the commit is due.
   *
   * A commit only counts for the round both sides are on. Each side overwrites
   * its own slot every round, so a stale commit is simply one whose `round`
   * hasn't caught up — no clearing between rounds, and nothing to race.
   */
  useEffect(() => {
    if (!online) return;
    const them = otherPlayer(online.me);
    const offCommits = watchRoom<Partial<Record<Player, Commit>>>(online, "commits", (c) => {
      const theirs = c?.[them];
      const mine = pendingCommit.current;
      if (!theirs || !mine || theirs.round !== roundRef.current) return;
      pendingCommit.current = null;
      resolveRef.current(mine, theirs);
    });
    const offPresence = watchRoom<boolean>(online, `presence/${them}`, (v) => setOppPresent(v === true));
    const offLeft = watchRoom<Player>(online, "left", (v) => {
      if (v && v !== online.me) setOppLeft(true);
    });
    return () => {
      offCommits();
      offPresence();
      offLeft();
    };
  }, [online]);

  // Note: picks never auto-commit. The player stays in the pick phase until
  // they press Battle, so there's always a chance to reorder the queue first.

  /** The current pick-phase state, for the undo stack. */
  const snapshot = (): UndoEntry => ({
    board,
    usedOffers,
    frozen,
    picksLeft,
    picks: roundLog.current.picks.slice(),
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
    setFrozen(prev.frozen);
    setPicksLeft(prev.picksLeft);
    roundLog.current.picks = prev.picks;
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
    // Overrides the merge sound that always precedes it: knighting is the
    // payoff for the whole Squire line, so it shouldn't share a sound with
    // the ordinary merge that happened to trigger it.
    sfx("knight");
  };

  /** A unit just reached the level cap: its ability takes its Mastery form. */
  const announceMastery = (b: Board, cell: Cell, name: string) => {
    showBanner(`★ ${name} mastered!`, "win");
    fxAt(b, cell, "bounty");
    sfx("knight");
  };
  /** Whether a merge carried a unit from below the cap to it (or past it: Ascendant). */
  const justMastered = (before: Unit | null | undefined, after: Unit | null | undefined) =>
    !!before && !!after && !isMastered(before.merges) && isMastered(after.merges);

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
        roundLog.current.picks.push({ k: key, a: action === "merge" ? "m" : action === "replace" ? "r" : "p", l: levelOf(landed.merges) });
        if (action === "merge") {
          setPose(landed.id, "merge", POSE_MS.merge);
          fxAt(next, cell, "merge");
          sfx("merge");
          const before = board.slots.player[cell.lane][cell.spot];
          if (before?.key === "squire" && landed.key === "knight") announceKnight(next, cell);
          else if (justMastered(before, landed)) announceMastery(next, cell, landed.name);
        } else {
          if (action === "replace") fxAt(next, cell, "replace");
          setPose(landed.id, "spawn", POSE_MS.spawn);
          fxAt(next, cell, "spawn");
          sfx("place");
        }
      }
      setBoard(next);
      setSelected(null);
      setUsedOffers((u) => [...u, offerIndex]);
      setFrozen((f) => f.filter((i) => i !== offerIndex));
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
          const before = board.slots.player[cell.lane][cell.spot];
          refreshForRound(next, playerAug.current, enemyAug.current);
          const at = findUnitCell(next, targetId);
          if (at) {
            setPose(targetId, "merge", POSE_MS.merge);
            fxAt(next, at, "merge");
            sfx("merge");
            const after = next.slots.player[at.lane][at.spot];
            if (wasSquire && after?.key === "knight") {
              announceKnight(next, at);
            } else if (justMastered(before, after)) announceMastery(next, at, after!.name);
          }
        }
      } else {
        moveUnit(next, PLAYER, g.lane, g.from, cell.spot);
        sfx("place", 0.3);
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

  /** The unit under client coords on either side, for the info card. */
  const unitUnder = (clientX: number, clientY: number): Unit | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cell = pixelToCell(canvas, board, clientX - rect.left, clientY - rect.top);
    return cell ? (board.slots[cell.side][cell.lane]?.[cell.spot] ?? null) : null;
  };

  // --- Touch info cards -----------------------------------------------------

  const cancelLongPress = () => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  /** Arm a long-press (touch and pen only — a mouse has hover). */
  const armLongPress = (e: React.PointerEvent, open: () => void) => {
    cancelLongPress();
    if (e.pointerType === "mouse") return;
    const timer = window.setTimeout(() => {
      longPress.current = null;
      pending.current = null; // a hold is a look, not the start of a drag
      swallowClick.current = true;
      open();
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
    longPress.current = { timer, x: e.clientX, y: e.clientY };
  };

  // Any press closes an open card (and that press's click does nothing else);
  // moving or lifting the finger cancels a long-press that hasn't fired yet.
  useEffect(() => {
    const onDown = () => {
      swallowClick.current = !!pinnedRef.current;
      if (pinnedRef.current) setPinned(null);
    };
    const onMove = (e: PointerEvent) => {
      const lp = longPress.current;
      if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) >= DRAG_THRESHOLD_PX * 2) cancelLongPress();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cancelLongPress);
    window.addEventListener("pointercancel", cancelLongPress);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cancelLongPress);
      window.removeEventListener("pointercancel", cancelLongPress);
    };
  }, []);

  /** The pinned unit as it stands on the current board, or null once it's gone. */
  const pinnedUnit = useMemo(() => {
    if (pinned?.kind !== "unit") return null;
    for (const side of [PLAYER, ENEMY] as const)
      for (const lane of board.slots[side]) for (const u of lane) if (u?.id === pinned.id) return u;
    return null;
  }, [pinned, board]);

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
    // Mouse only — touch has no hover, and gets the long-press card instead.
    if (e.pointerType === "mouse" && !drag && !pending.current && !selected) {
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
    boardPointerType.current = e.pointerType;
    const pressed = unitUnder(e.clientX, e.clientY);
    if (pressed) {
      const { clientX: x, clientY: y } = e;
      armLongPress(e, () => setPinned({ kind: "unit", id: pressed.id, x, y }));
    }
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
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    // A touch tap that can't act on anything (an enemy unit, or any unit
    // outside the pick phase) opens the info card instead of doing nothing.
    const touch = boardPointerType.current !== "mouse";
    const tapped = touch ? unitUnder(e.clientX, e.clientY) : null;
    if (tapped && (phase !== "pick" || tapped.side === ENEMY)) {
      setPinned({ kind: "unit", id: tapped.id, x: e.clientX, y: e.clientY });
      return;
    }
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
    // Allowed after both picks too: rerolling then is a look at more cards, to
    // freeze any worth keeping for next round.
    if (phase !== "pick" || unitRerolls <= 0) return;
    const fresh = rollOffer(OFFER_COUNT, playerAug.current);
    setOffer(offer.map((k, i) => (usedOffers.includes(i) || frozen.includes(i) ? k : fresh[i])));
    setUnitRerolls(unitRerolls - 1);
    roundLog.current.rr++;
    setRerollN((n) => n + 1);
    setHistory([]);
    setSelected(null);
  };

  /** Freeze or unfreeze an untaken offer card. Saved at once, so a reload keeps it. */
  const toggleFreeze = (i: number) => {
    if (phase !== "pick" || usedOffers.includes(i)) return;
    const next = frozen.includes(i) ? frozen.filter((x) => x !== i) : [...frozen, i];
    setFrozen(next);
    if (lastSave.current) save({ ...lastSave.current, frozen: next });
  };

  /**
   * Freeze an upgrade to be offered first at the next choice (up to
   * MAX_FROZEN_AUGMENTS; the panel disables the rest once that's reached).
   * Lives on the player's augment state, which is saved with the match.
   */
  const toggleFreezeAug = (id: string) => {
    const st = playerAug.current;
    if (!toggleFrozenAugment(st, id)) return;
    setAugOffers((o) => [...o]); // re-render the panel
    if (lastSave.current) save({ ...lastSave.current });
  };

  /** Reroll the upgrade choice: three fresh cards from the unlocked rarities. */
  const rerollAugments = () => {
    if (phase !== "augment" || augRerolls <= 0) return;
    setAugOffers(offerAugments(playerAug.current, augmentOfferCount(playerAug.current), upgradeTier(round)));
    setAugRerolls(augRerolls - 1);
    roundLog.current.augRr++;
  };

  const onPickAugment = (id: string) => {
    sfx("upgrade");
    const units = sideUnits(board, PLAYER);
    const cost = takeAugment(playerAug.current, id, units);
    const next = cloneBoard(board);
    if (cost) next.hp.player = Math.max(1, next.hp.player - cost);

    // Against the CPU, it upgrades now too. Online, the opponent is choosing
    // at the same time on their own device; their pick reaches us with their
    // commit, so there's nothing to do here but take ours.
    const enemyHad = enemyAug.current.active.length;
    if (!online) aiTakeAugment(next, ENEMY, enemyAug.current, round, difficultyRef.current);
    matchLog.augment(round, {
      o: augOffers.map((a) => a.id),
      t: id,
      rr: roundLog.current.augRr,
      ...(enemyAug.current.active.length > enemyHad ? { e: enemyAug.current.active[enemyAug.current.active.length - 1] } : {}),
    });
    refreshForRound(next, playerAug.current, enemyAug.current);
    // The upgrade is locked in: re-save without the pending flag, so a reload
    // now resumes in this round's picks rather than offering it again.
    save({ board: next, round, offer, player: playerAug.current, enemy: enemyAug.current, difficulty: difficultyRef.current, stats: statsRef.current, frozen });
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
    setFeed([]);
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
      // Fortify: surviving Bulwarks visibly harden before the next round.
      for (const side of [PLAYER, ENEMY]) {
        for (const u of sideUnits(result.board, side)) {
          const grow = u.traits?.growOnSurvive?.hp ?? 0;
          const cell = grow > 0 ? findUnitCell(result.board, u.id) : null;
          if (cell) {
            fxAt(result.board, cell, "fortify", { amount: grow });
            abilityLabel(result.board, cell, `Fortify +${grow}♥`);
          }
        }
      }
      const healed = settleRound(result, PLAYER, playerAug.current, committed);
      const enemyHealed = settleRound(result, ENEMY, enemyAug.current, committed);
      recordRound(statsRef.current, result, committed, PLAYER, healed);
      const log = roundLog.current;
      matchLog.round(round, {
        offer: log.offer,
        picks: log.picks,
        rr: log.rr,
        row: rowLog(sideUnits(committed, PLAYER)),
        foe: rowLog(sideUnits(committed, ENEMY)),
        won: result.roundWinner === PLAYER ? 1 : result.roundWinner ? -1 : 0,
        hp: [result.board.hp.player, result.board.hp.enemy],
      });
      if (result.matchWinner) {
        matchLog.end({
          won: result.matchWinner === PLAYER ? 1 : -1,
          rounds: round,
          hp: [result.board.hp.player, result.board.hp.enemy],
          aug: [...playerAug.current.active],
          foeAug: [...enemyAug.current.active],
          ...(mvpOf(statsRef.current) ? { mvp: mvpOf(statsRef.current)!.key } : {}),
        });
      }
      // The HP bars read the shown board, which still holds the pre-round
      // pools — show the hit as the banner lands. (On the final round there is
      // no next round to carry it, so the loser's bar stayed above zero.)
      setBoard((b) => ({ ...b, hp: { ...result.board.hp } }));
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
          (result.ascendantHit ? ` · 👑 champions struck the pools for ${result.ascendantHit}` : "") +
          bounty,
      );
      if (winner === PLAYER) showBanner(`You hold the row! ${left} left · −${result.hpLoss}${bounty}`, "win");
      else if (winner === ENEMY) showBanner(`Wiped out! ${left} left · −${result.hpLoss}${bounty}`, "lose");
      else showBanner(`Both rows fall${bounty}`, "draw");
      // The round's verdict, on the banner rather than the last blow — a draw
      // gets nothing, since neither sting would be true.
      if (winner === PLAYER) sfx("round-win");
      else if (winner === ENEMY) sfx("round-loss");
      // Losing the match blows your row up before the result screen; winning
      // blows up the enemy's HP bar, in slow motion. Neither follows the battle
      // speed: they happen once, at the very end.
      const boom = result.matchWinner === ENEMY;
      const blast = result.matchWinner === PLAYER;
      if (blast) window.setTimeout(() => setBarBlast(true), BAR_BLAST_DELAY_MS);
      if (boom) later(EXPLOSION_DELAY_MS, () => explodeRow(committed));
      // Let the result banner land before the next round deals.
      timer = window.setTimeout(() => {
        if (result.matchWinner) {
          // Online and tutorial matches were never saved; clearing would drop a real one.
          if (!online && !tutorial) clearMatch();
          sfx(result.matchWinner === PLAYER ? "victory" : "defeat");
          setPhase("over");
        } else {
          // Everyone who fell comes back: rebuild from the pre-combat roster,
          // carrying forward only the HP pools that combat changed.
          const respawned = cloneBoard(committedRef.current ?? result.board);
          respawned.hp = { ...result.board.hp };
          startRound(respawned, round + 1);
        }
      }, scaled(RESULT_MS) + (boom ? scaled(EXPLOSION_DELAY_MS) + EXPLOSION_MS : 0) + (blast ? BAR_BLAST_DELAY_MS + HP_BAR_BLAST_MS : 0));
    };

    /** Both front units lunge at each other. */
    const windup = (f: Frame) => {
      for (const ev of f.events) {
        if (ev.type !== "attack") continue;
        // Cleave / thorns / last breath are side effects, not lunges.
        if (ev.tag === "cleave" || ev.tag === "thorns" || ev.tag === "last-breath" || ev.tag === "pierce") continue;
        setPose(ev.attacker, "attack", POSE_MS.attack);
      }
    };

    /**
     * A working copy of the beat's board that its delayed changes (a cleave
     * landing, a buff arriving) are applied to as they happen, so each unit's
     * health and attack change exactly when its number appears. A late timer
     * from a beat that has already moved on is ignored — the next beat's board
     * is authoritative.
     */
    const liveBoard = (f: Frame) => {
      const shown = cloneBoard(f.board);
      const beat = i;
      return (ev: BattleEvent) => {
        applyEvent(shown, ev);
        if (i === beat) setBoard(cloneBoard(shown));
      };
    };

    /**
     * An ability beat, with the numbers it applies: Charge winding up, or a
     * fallen unit's death buff travelling to whoever receives it. Returns the
     * extra hold (ms) needed for every gain to land.
     */
    const ability = (f: Frame): number => {
      /** Fallen units whose ability has been named this beat. */
      const named = new Set<string>();
      const apply = liveBoard(f);
      let n = 0;
      let last = 0;
      for (const ev of f.events) {
        if (ev.type === "attack" && (ev.opening ?? 0) > 0) {
          const src = unitAt(f.board, ev.attacker);
          if (!src) continue;
          fxAt(f.board, src.cell, "charge-up");
          // Pulse the glow again so the wind-up reads across the whole beat.
          later(350, () => fxAt(f.board, src.cell, "charge-up"));
          abilityLabel(f.board, src.cell, `Charge +${ev.opening} dmg`);
          continue;
        }
        if (ev.type !== "buff") continue;
        const cell = findUnitCell(f.board, ev.unit);
        const src = unitAt(f.board, ev.source);
        if (!cell || !src) continue;
        const key = src.unit.key;
        if (!named.has(ev.source)) {
          named.add(ev.source);
          const gain = statText(ev.atk, ev.hp);
          const name = ev.label ?? (key === "guard" ? "Bodyguard" : key === "squire" ? "Pass the torch" : "Last rally");
          const scope = !ev.label && key === "knight" ? " all" : "";
          if (key === "knight" || ev.label) fxAt(f.board, src.cell, "rally");
          abilityLabel(f.board, src.cell, `${name} ${gain}${scope}`);
        }
        // Allies receive one after another, so a Last rally can be followed.
        const at = 300 + n++ * 140;
        // A self-buff (Last light, an Acolyte giving its health away) has
        // nothing to travel: it lands at once. Others fly from the source.
        const self = ev.source === ev.unit;
        const travels = !self && (key === "guard" || key === "squire" || key === "herald" || key === "acolyte");
        later(at, () => {
          if (!travels) return;
          if (key === "guard" || key === "acolyte") fxBetween(f.board, src.cell, cell, "bodyguard");
          else fxBetween(f.board, src.cell, cell, "torch");
        });
        const lands = at + (travels ? 520 : 0);
        last = Math.max(last, lands);
        later(lands, () => {
          apply(ev);
          if (ev.hp > 0) fxAt(f.board, cell, "heal");
          if (ev.atk > 0) fxAt(f.board, cell, "merge");
          fxAt(f.board, cell, "stat-gain", { text: statText(ev.atk, ev.hp) });
        });
      }
      // Leave the last gain on screen long enough to read before moving on.
      return Math.max(0, last + 500 - ABILITY_MS);
    };

    /** The blows land: impact, slashes, numbers, hit/death poses, shake. Returns extra hold (ms). */
    const clash = (f: Frame): number => {
      const all = f.events.filter((e): e is AttackEvent => e.type === "attack");
      const isExtra = (e: AttackEvent) =>
        e.tag === "cleave" || e.tag === "thorns" || e.tag === "last-breath" || e.tag === "pierce";
      const attacks = all.filter((e) => !isExtra(e));
      /** An in-swing ability fired, so hold the beat long enough to read it. */
      let abilityFired = false;
      const extras = all.filter(isExtra);
      const dying = new Set(f.events.flatMap((e) => (e.type === "death" ? [e.unit] : [])));
      const dmg = new Map<string, number>();
      let biggest = 0;
      // Health comes off as the blows land — before any ability beat that follows.
      const apply = liveBoard(f);
      for (const ev of attacks) apply(ev);
      for (const ev of all) {
        if (ev.blocked && ev.blocked > 0) {
          const at = findUnitCell(f.board, ev.target);
          if (at) fxAt(f.board, at, "block", { amount: ev.blocked });
        }
      }
      for (const ev of attacks) {
        const a = unitAt(f.board, ev.attacker)?.unit;
        const d = unitAt(f.board, ev.target)?.unit;
        if (a && d) {
          if (ev.tag === "dodge") pushFeed("dodge", [nameOf(d), " dodges ", nameOf(a)]);
          else pushFeed("hit", [nameOf(a), " hits ", nameOf(d), ` for ${ev.damage}`]);
        }
      }
      // One sound per beat, not per event: both fronts swing at once, and
      // four overlapping clangs read as noise rather than as a bigger hit.
      // The loudest thing that happened picks the sound.
      const landed = attacks.filter((e) => e.tag !== "dodge");
      if (landed.length > 0) {
        const top = Math.max(...landed.map((e) => e.damage));
        sfx(top >= BIG_HIT ? "big-hit" : "hit", Math.min(1, top / (BIG_HIT * 2)));
      } else if (attacks.some((e) => e.tag === "dodge")) {
        sfx("dodge");
      }
      if (all.some((e) => (e.blocked ?? 0) > 0)) sfx("block");
      // Deaths from the main blows now; a side hit's victim is announced when
      // that hit lands, after its own line.
      const mainKills = new Set(attacks.filter((e) => e.tag !== "dodge" && dying.has(e.target)).map((e) => e.target));
      for (const id of mainKills) {
        const u = unitAt(f.board, id)?.unit;
        if (u) pushFeed("death", ["☠ ", nameOf(u), " falls"]);
      }
      // Just after the impact, so the fall reads as its consequence.
      if (dying.size > 0) window.setTimeout(() => sfx("death"), 90);
      for (const ev of attacks) {
        // Evasion: the target sidesteps — afterimages and "DODGE!", no slash,
        // number or flinch for a miss.
        if (ev.tag === "dodge") {
          const at = findUnitCell(f.board, ev.target);
          if (at) fxAt(f.board, at, "dodge");
          setPose(ev.target, "dodge", POSE_MS.dodge);
          abilityFired = true;
          continue;
        }
        if (ev.tag === "first-strike" || ev.tag === "charge") {
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
      // Side hits (Overflow, Thorns, Riposte, Last breath) play one after
      // another once the main blows have registered, so each target's damage is
      // readable on its own: the Overflow shockwave only sets off after the
      // first target's number is up, and its damage lands when it arrives.
      let t = EXTRA_GAP_MS;
      for (const ev of extras) {
        const src = unitAt(f.board, ev.attacker);
        const cell = findUnitCell(f.board, ev.target);
        if (!src || !cell) continue;
        const lethal = dying.has(ev.target);
        const overflow = ev.tag === "cleave" && src.unit.key === "berserker";
        const riposte = ev.tag === "thorns" && src.unit.key === "skirmisher" && (src.unit.traits?.riposte ?? 0) > 0;
        if (overflow || riposte) abilityFired = true;
        const start = t;
        const lands = overflow ? start + OVERFLOW_TRAVEL_MS : start;
        later(start, () => {
          if (overflow) {
            // The shockwave carries on from the unit it just killed.
            const first = attacks.find((a) => a.attacker === ev.attacker)?.target;
            const from = (first && findUnitCell(f.board, first)) || src.cell;
            fxBetween(f.board, from, cell, "overflow");
            abilityLabel(f.board, src.cell, `Overflow ${ev.damage} carries on`);
          } else if (riposte) abilityLabel(f.board, src.cell, `Riposte ${ev.damage} dmg`);
          else if (ev.tag === "pierce") abilityLabel(f.board, src.cell, `Impale ${ev.damage}`);
        });
        later(lands, () => {
          apply(ev);
          const target = f.board.slots[cell.side][cell.lane][cell.spot];
          if (target) {
            const how = ev.tag === "cleave" ? " carries on into " : ev.tag === "thorns" ? " strikes back at " : ev.tag === "pierce" ? " impales " : " lands a parting blow on ";
            pushFeed("hit", [nameOf(src.unit), how, nameOf(target), ` for ${ev.damage}`]);
            if (lethal && !mainKills.has(ev.target)) pushFeed("death", ["☠ ", nameOf(target), " falls"]);
          }
          if (ev.tag === "pierce") fxAt(f.board, cell, "slash");
          else {
            const kind = ev.tag as "cleave" | "thorns" | "last-breath";
            fxAt(f.board, kind === "last-breath" ? src.cell : cell, kind);
          }
          if (!dmg.has(ev.target) || overflow) setPose(ev.target, lethal ? "dying" : "hit", lethal ? POSE_MS.dying : POSE_MS.hit);
          fxAt(f.board, cell, "damage", { amount: ev.damage, lethal });
          if (lethal) fxAt(f.board, cell, "death");
          if (overflow && !prefersReducedMotion()) fxRef.current.shake(0.35, performance.now());
        });
        t = lands + EXTRA_STEP_MS;
      }
      let healAt = extras.length > 0 ? t : 160;
      for (const ev of f.events) {
        if (ev.type !== "heal") continue;
        const cell = findUnitCell(f.board, ev.unit);
        if (!cell) continue;
        later(healAt, () => {
          apply(ev);
          fxAt(f.board, cell, "heal", { amount: ev.amount });
          // A Medic's Mend: name it on the feed (lifesteal heals carry no source).
          const healer = ev.source ? unitAt(f.board, ev.source)?.unit : undefined;
          const target = f.board.slots[cell.side][cell.lane][cell.spot];
          if (healer && target) {
            fxAt(f.board, findUnitCell(f.board, healer.id) ?? cell, "rally");
            pushFeed("ability", [nameOf(healer), " mends ", nameOf(target), ` +${ev.amount}♥`]);
          }
        });
        healAt += 120;
      }
      /** Hold the beat until the last side hit or heal has been on screen a moment. */
      const sequenceHold = Math.max(0, Math.max(t, healAt) + 350 - f.duration);
      const total = [...dmg.values()].reduce((x, y) => x + y, 0);
      if (!prefersReducedMotion() && total > 0) {
        const intensity = Math.min(1, 0.2 + total / 18 + (dying.size > 0 ? 0.3 : 0));
        fxRef.current.shake(intensity, performance.now());
      }
      const big = biggest >= BIG_HIT || dying.size > 0;
      const stop = big && !prefersReducedMotion() ? HIT_STOP_MS : 0;
      return Math.max(stop + (abilityFired ? ABILITY_HOLD_MS : 0), sequenceHold);
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
      else if (frame.kind === "ability") wait += scaled(ability(frame));
      timer = window.setTimeout(step, wait);
    };

    timer = window.setTimeout(step, scaled(REVEAL_MS));
    return () => {
      clearTimeout(timer);
      fxTimers.forEach(clearTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, frames, result, round, startRound, showBanner]);

  /**
   * Abandon this match and go back to the title, where the opponent is picked
   * and a fresh Game is mounted. Resetting in place would mean reproducing
   * every piece of match state here; dropping the component can't miss one.
   */
  const newMatch = () => {
    if (!online && !tutorial) clearMatch();
    onExit();
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
          : phase === "waiting"
            ? "Waiting for your opponent"
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
        const lv = `Lv${levelOf(target.merges)} → Lv${levelOf(target.merges + source.merges + 1)}`;
        const after = `${lv}, ⚔${target.atk} ♥${target.maxHp} → ⚔${target.atk + gain.atk} ♥${target.maxHp + gain.hp}`;
        return source.key === target.key
          ? `Merge the two ${source.name}s: ${after} (one fewer body)${knighted}`
          : `Merge ${source.name} into ${target.name}: ${after} (one fewer body)`;
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
        return target
          ? `Merge into ${target.name}: Lv${levelOf(target.merges)} → Lv${levelOf(target.merges + 1)}, ⚔${target.atk} ♥${target.maxHp} → ⚔${target.atk + gain.atk} ♥${target.maxHp + gain.hp}${knightsIt(target, null) ? " — knights it!" : ""}`
          : null;
      case "replace":
        return `⚠ Replace ${target?.name}${target && target.merges > 0 ? ` (level ${levelOf(target.merges)})` : ""} with ${UNITS[g.key].name}`;
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
      <UpdatePrompt />
      <SidePanels
        player={playerAug.current}
        enemy={enemyAug.current}
        stats={statsRef.current}
        difficulty={DIFFICULTY_LABEL[difficulty]}
      />
      <header className="app__header">
        <button className="menu-btn" onClick={() => setShowMenu(true)} aria-label="Menu" title="Menu">
          ☰
        </button>
        <h1>Duel Deck</h1>
        <p className="app__subtitle">
          Round {round} · {phaseLabel}
          {playerAug.current.active.length > 0 &&
            ` · ${playerAug.current.active.length} upgrade${playerAug.current.active.length === 1 ? "" : "s"}`}
        </p>
        {upgradeIn !== null && upgradeIn > 0 && phase !== "over" && (
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

      <HpBar side={ENEMY} label="Enemy" hp={Math.max(0, board.hp.enemy)} max={START_HP} blown={barBlast} />

      <div className="app__stage">
        <canvas
          ref={canvasRef}
          className={`app__board${drag ? " app__board--dragging" : ""}`}
          onPointerDown={onBoardPointerDown}
          onPointerMove={onBoardPointerMove}
          onPointerLeave={onBoardPointerLeave}
          onClick={onBoardClick}
          onContextMenu={(e) => e.preventDefault()}
        />
        <RoundBanner message={banner.message} tone={banner.tone} nonce={banner.nonce} />
        {online && phase !== "over" && <EmoteBar session={online} />}
        {barBlast && <HpBarBlast selector=".hpbar--enemy" side="enemy" />}
        {tutorial && phase !== "over" && (
          <Tutorial
            state={{
              phase,
              round,
              picksLeft,
              units: sideUnits(board, PLAYER).length,
              topLevel: Math.max(0, ...sideUnits(board, PLAYER).map((u) => levelOf(u.merges))),
            }}
          />
        )}
        {phase === "augment" && (
          <AugmentPanel
            round={round}
            offers={augOffers}
            onPick={onPickAugment}
            peeking={peeking}
            onPeek={() => setPeeking((p) => !p)}
            rerollsLeft={augRerolls}
            onReroll={rerollAugments}
            frozenIds={frozenAugments(playerAug.current)}
            onFreeze={toggleFreezeAug}
          />
        )}
        {phase === "over" && result?.matchWinner && (
          <ResultPanel
            winner={result.matchWinner}
            round={round}
            stats={statsRef.current}
            hp={result.board.hp}
            upgrades={playerAug.current.active}
            difficulty={DIFFICULTY_LABEL[difficulty]}
            onNewMatch={newMatch}
          />
        )}
        {showMenu && (
          <MenuPanel
            onClose={() => setShowMenu(false)}
            onCodex={() => {
              setShowMenu(false);
              setShowUnits(true);
            }}
            onNotes={() => {
              setShowMenu(false);
              setShowNotes(true);
            }}
            onHelp={() => {
              setShowMenu(false);
              setShowHelp(true);
            }}
            onNewMatch={() => {
              setShowMenu(false);
              newMatch();
            }}
            onExit={() => {
              setShowMenu(false);
              onExit();
            }}
            sound={sound}
            onSound={onSound}
            battleLog={battleLog}
            onBattleLog={onBattleLog}
            difficultyLabel={DIFFICULTY_LABEL[difficulty]}
          />
        )}
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
        {showUnits && <CodexView onClose={() => setShowUnits(false)} />}
        {showNotes && <PatchNotes onClose={() => setShowNotes(false)} />}
        {confirmCommit && phase === "pick" && (
          <ConfirmPanel
            title="Battle with picks left?"
            message={`You still have ${picksLeft} pick${picksLeft === 1 ? "" : "s"} left this round. Unused picks are lost.`}
            confirmLabel="Battle anyway"
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

      {/* Always rendered: the board fills the space left over, so rows that came
          and went would resize it between phases. */}
      <p className="app__log">{lastRound ?? ""}</p>

      {/* The board's chrome. Wrapped so a wide screen can stand it beside
          the board instead of under it, which is the only way the board
          gets taller — its size is driven by leftover height, never width. */}
      <div className="app__controls">
      <div className="hud">
        <button
          className="primary-btn"
          // Unspent picks are almost always a misclick, not a plan — ask first.
          // (A maxed row's unspent picks aren't a misclick: they're Drill.)
          onClick={() => (picksLeft > 0 && !rowMaxed(board, PLAYER) ? setConfirmCommit(true) : finishPicks(board))}
          disabled={phase !== "pick"}
        >
          ⚔ Battle
        </button>
        <button
          className={`ghost-btn${speed > 1 ? " ghost-btn--on" : ""}`}
          onClick={cycleSpeed}
          title={`Battle speed ${speed}× — click for ${SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]}×`}
        >
          {speed > 1 ? `⏩ ${speed}×` : "▶ 1×"}
        </button>
        <button
          className="ghost-btn"
          onClick={undo}
          disabled={phase !== "pick" || history.length === 0}
          title="Undo your last move this round (Ctrl/⌘+Z)"
        >
          ↶ Undo
        </button>
        <button className="ghost-btn" onClick={() => setShowAugments(true)} title="Upgrades: yours / the enemy's">
          <span className="hud__long">Upgrades </span>
          <span className="hud__short" aria-hidden="true">⬆ </span>
          {playerAug.current.active.length}/{enemyAug.current.active.length}
        </button>
      </div>

      <div className={`pick-row${phase === "pick" ? "" : " pick-row--idle"}`}>
        <p
          key={picksLeft}
          className={`pick-label${picksLeft > 0 ? " pick-label--open" : " pick-label--done"}`}
        >
          {classNote && <span className="pick-label__class">{classNote} · </span>}
          {picksLeft > 0 && rowMaxed(board, PLAYER)
            ? `Row maxed · unused picks → 🎯 Drill +${picksLeft}⚔`
            : picksLeft > 0
            ? `Pick ${picksLeft}${boardFull ? " · row full" : ""}`
            : unitRerolls > 0
              ? "✓ Picks done · ❄ freeze for next round"
              : "✓ Picks done — arrange your row, then battle"}
        </p>
        {(picksLeft > 0 || unitRerolls > 0) && (
          <button
            className="ghost-btn ghost-btn--sm reroll-btn"
            onClick={rerollOffer}
            disabled={unitRerolls <= 0}
            title={
              picksLeft > 0
                ? "Swap the cards you haven't taken (or frozen) for new ones"
                : "Picks done: reroll to find cards worth freezing for next round"
            }
          >
            🎲 Reroll ({unitRerolls})
          </button>
        )}
      </div>
      <div className="hand">
        {phase === "pick" ? (
          offer.map((key, i) => {
            const u = UNITS[key];
            const isDragging = drag?.kind === "offer" && drag.index === i;
            const isSelected = selected?.kind === "offer" && selected.index === i;
            const taken = usedOffers.includes(i);
            const spent = taken || picksLeft <= 0;
            const isFrozen = frozen.includes(i);
            return (
              // A frozen card keeps its key, so it stays put through a reroll or a
              // new round instead of being dealt in again like the fresh cards.
              <div className="card-wrap" key={isFrozen ? `frozen-${key}-${i}` : `${round}-${rerollN}-${key}-${i}`}>
              <button
                className={
                  `card${isSelected ? " card--selected" : ""}` +
                  `${isDragging ? " card--dragging" : ""}${taken ? " card--taken" : ""}${isFrozen ? " card--frozen" : ""}`
                }
                disabled={spent}
                onPointerDown={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  armLongPress(e, () =>
                    setPinned({ kind: "offer", key, x: r.left + r.width / 2, y: r.top }),
                  );
                  if (!spent) beginPress({ kind: "offer", index: i, key }, e);
                }}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "mouse") return;
                  const r = e.currentTarget.getBoundingClientRect();
                  setOfferInfo({ key, x: r.left + r.width / 2, y: r.top });
                }}
                onPointerLeave={() => setOfferInfo(null)}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => {
                  if (swallowClick.current) {
                    swallowClick.current = false;
                    return;
                  }
                  if (!spent) setSelected(isSelected ? null : { kind: "offer", index: i, key });
                }}
              >
                <span className={`card__class card__class--${u.archetype}`} title={`${ARCHETYPES[u.archetype].name} class`}>
                  {ARCHETYPES[u.archetype].icon}
                </span>
                <UnitPortrait unitKey={key} side="player" size={compact ? 44 : 58} />
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
              {!taken && (
                <button
                  className={`freeze-btn${isFrozen ? " freeze-btn--on" : ""}`}
                  onClick={() => toggleFreeze(i)}
                  aria-pressed={isFrozen}
                  aria-label={`${isFrozen ? "Unfreeze" : "Freeze"} ${u.name}`}
                  title={isFrozen ? "Frozen: kept for next round. Click to unfreeze" : "Freeze: keep this card for next round"}
                >
                  ❄
                </button>
              )}
              </div>
            );
          })
        ) : phase === "waiting" ? (
          // Where the offer cards were: your row is locked in, so the only
          // thing left to report is the other side.
          <div className="waiting" role="status">
            <span className="waiting__spinner" aria-hidden="true" />
            <span className="waiting__text">
              {oppLeft
                ? "Your opponent left the match."
                : oppPresent
                  ? "Row committed — waiting for your opponent to commit theirs…"
                  : "Opponent disconnected — waiting for them to come back…"}
            </span>
          </div>
        ) : (
          phase === "battle" || phase === "over" ? (
            // Hidden by the setting, but the row still reserves its height:
            // collapsing it would resize the board mid-battle, which the whole
            // layout is built to avoid.
            !battleLog ? null : (
            <ol className="feed" aria-live="polite">
              {feed.length === 0 && <li className="feed__line feed__line--idle">⚔ The rows close in…</li>}
              {feed.map((item, k) => (
                <li
                  key={item.id}
                  className={`feed__line feed__line--${item.tone}`}
                  style={{ opacity: 0.4 + 0.6 * ((k + 1) / feed.length) }}
                >
                  {item.parts.map((p, j) =>
                    typeof p === "string" ? (
                      <span key={j}>{p}</span>
                    ) : (
                      <span key={j} className={`feed__name feed__name--${p.side}`}>
                        {p.side === PLAYER ? "Your " : "Enemy "}
                        {p.text}
                      </span>
                    ),
                  )}
                </li>
              ))}
            </ol>
            )
          ) : (
            <p className="hand__empty">{phase === "augment" ? "Choose an upgrade above." : ""}</p>
          )
        )}
      </div>

      <p className="app__hint" ref={hintRef}>
        {phase !== "pick"
          ? ""
          : grab
            ? grabHint
            : picksLeft <= 0
              ? "Drag or click your units to reorder — onto a matching unit's left half to merge"
              : boardFull
                ? "Row full — merge an offer into a unit of the same type"
                : "Drag or click: empty slot to place, matching unit to merge"}
      </p>
      </div>

      {/* A hovered offer card's unit: stats and its innate ability. */}
      {offerInfo && !drag && !selected && phase === "pick" && (
        <OfferInfo unitKey={offerInfo.key} x={offerInfo.x} y={offerInfo.y} />
      )}

      {/* What's making a hovered unit's numbers what they are. */}
      {info && !grab && <UnitInfo unit={info.unit} x={info.x} y={info.y} toKnight={squireToGo(info.unit)} />}

      {/* Picked up by a click or tap: its details, docked over the offer row
          and just above the hint (which carries the outcome warnings), so it
          never covers the board slots the next tap is aimed at. */}
      {selected && !drag && phase === "pick" && !pinned && (() => {
        const dockBottom = window.innerHeight - (hintRef.current?.getBoundingClientRect().top ?? window.innerHeight) + 6;
        if (selected.kind === "offer") return <OfferInfo unitKey={selected.key} dockBottom={dockBottom} />;
        const unit = board.slots.player[selected.lane]?.[selected.from];
        return unit && unit.id === selected.unitId ? <UnitInfo unit={unit} dockBottom={dockBottom} toKnight={squireToGo(unit)} /> : null;
      })()}

      {/* Touch: the long-pressed (or tapped) unit or offer, until the next tap. */}
      {pinnedUnit && pinned && <UnitInfo unit={pinnedUnit} x={pinned.x} y={pinned.y} pinned toKnight={squireToGo(pinnedUnit)} />}
      {pinned?.kind === "offer" && phase === "pick" && (
        <OfferInfo unitKey={pinned.key} x={pinned.x} y={pinned.y} />
      )}

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
