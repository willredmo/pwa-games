import type { Difficulty } from "../ai/cpu";
import type { Contact, Launch } from "../physics/sim";
import { newBoardSeed } from "../physics/board";
import { CENTER, type Corners, type GoalSide, type Vec } from "../physics/table";

// Match rules. Players take turns, one hit each, and may hit the puck
// wherever it stopped. Player 1 (blue, at the bottom) shoots at the top goal;
// Player 2 (red — the CPU, or a second person passing the device) at the
// bottom one. A goal into your own net counts for
// the other side. After a goal the puck goes back to centre ice and whoever
// was scored on hits first. First to 10 wins, but you must be 2 ahead.

export type Player = "p1" | "p2";
export const other = (p: Player): Player => (p === "p1" ? "p2" : "p1");
export const attacksTop = (p: Player) => p === "p1";
export const goalFor = (goal: GoalSide): Player => (goal === "top" ? "p1" : "p2");

export const TARGET = 10;
/** You also need this big a lead: at 10–9 play goes on until someone is 2 up. */
export const WIN_BY = 2;

/** Whether `p` has won: at least TARGET goals and WIN_BY clear. */
export const hasWon = (score: Record<Player, number>, p: Player) => score[p] >= TARGET && score[p] - score[other(p)] >= WIN_BY;

/** Bounces slower than this (head-on, units/s) are the puck brushing a rail, not a real bank. */
const REAL_BOUNCE = 60;

/**
 * How a goal went in, from what the puck hit on the way. Exclusive: a corner
 * goal's last real bounce was off a corner wedge (the side-to-corner shot); a
 * bank goal bounced off a rail or diamond; anything else went straight in.
 * Goal posts and glancing touches don't count as bounces.
 */
export function goalKind(contacts: Contact[]): { bank: boolean; corner: boolean } {
  const real = contacts.filter((c) => c.kind !== "post" && c.speed >= REAL_BOUNCE);
  const lastReal = real[real.length - 1];
  const corner = lastReal?.kind === "wedge";
  return { corner, bank: real.length > 0 && !corner };
}

/**
 * vs the CPU, two people taking turns on one device, or two devices online
 * (the room's host is Player 1, the guest Player 2).
 */
export type Mode = "cpu" | "pvp" | "online";

/** How a player is named on screen. `me` is this device's player, online. */
export function playerName(m: Pick<MatchState, "mode">, p: Player, me?: Player): string {
  if (m.mode === "pvp") return p === "p1" ? "Blue" : "Red";
  if (m.mode === "online") return p === me ? "You" : "Opponent";
  return p === "p1" ? "You" : "CPU";
}

/** Who takes this player's shots on this device. */
export function controllerOf(m: Pick<MatchState, "mode">, p: Player, me?: Player): "local" | "cpu" | "remote" {
  if (m.mode === "online") return p === me ? "local" : "remote";
  if (m.mode === "pvp") return "local";
  return p === "p1" ? "local" : "cpu";
}

export interface PlayerStats {
  shots: number;
  goals: number;
  ownGoals: number;
  /** Goals that bounced off a rail or diamond on the way in (not corner goals). */
  bankGoals: number;
  /** Goals whose last bounce was off a corner wedge. */
  cornerGoals: number;
  /** Hardest hit, as a share of full power. */
  hardest: number;
  /** Most goals in a row (no goal against in between). Absent in older saves. */
  bestRun?: number;
}

export interface MatchStats {
  p1: PlayerStats;
  p2: PlayerStats;
  /**
   * Each player's current run: their own shots that scored, back to back. A
   * shot of theirs that doesn't score (an own goal included) ends it; the
   * other side scoring doesn't.
   */
  runs?: Record<Player, number>;
  /** Most hits in a row without a goal. */
  longestRally: number;
  rally: number;
  /** Most bounces on one shot. */
  mostBounces: number;
}

/** One goal, with the exact shot that scored it, for replays. */
export interface GoalRecord {
  launch: Launch;
  /** Who took the shot (differs from the scorer on an own goal). */
  by: Player;
  scorer: Player;
  ownGoal: boolean;
  bank: boolean;
  corner: boolean;
  /** The score just after this goal. */
  score: Record<Player, number>;
}

export interface MatchState {
  mode: Mode;
  /** This match's board character (physics/board.ts). Absent: a perfectly true board. */
  boardSeed?: number;
  /** This match's corners (physics/table.ts). Absent: the standard steep corners. */
  corners?: Corners;
  /** Every goal so far, oldest first. Absent in saves from before replays. */
  goals?: GoalRecord[];
  /** The CPU's level (unused in 2-player). */
  difficulty: Difficulty;
  score: Record<Player, number>;
  turn: Player;
  puck: Vec;
  shots: number;
  winner: Player | null;
  stats: MatchStats;
  startedAt: number;
}

const emptyPlayer = (): PlayerStats => ({ shots: 0, goals: 0, ownGoals: 0, bankGoals: 0, cornerGoals: 0, hardest: 0, bestRun: 0 });

/** The callout for a run of scoring shots, or null for fewer than two. */
export function runLabel(n: number | undefined): string | null {
  if (!n || n < 2) return null;
  if (n === 2) return "Two in a row!";
  if (n === 3) return "Hat trick! 🎩";
  if (n === 4) return "Four in a row — on fire! 🔥";
  return `${n} in a row — unstoppable!`;
}

/** How a match's board is set up: fixed for the match, kept by a rematch. */
export interface BoardSetup {
  /** A board with a little character (physics/board.ts); off, perfectly true. */
  naturalBoard?: boolean;
  /** Steep corners (the standard board) or 45°. */
  corners?: Corners;
}

/** A match's board setup, to start another (a rematch) the same way. */
export const setupOf = (m: Pick<MatchState, "boardSeed" | "corners">): BoardSetup => ({
  naturalBoard: m.boardSeed != null,
  corners: m.corners ?? "steep",
});

/** A fresh match; `first` takes the first shot. */
export function newMatch(mode: Mode, difficulty: Difficulty, setup: BoardSetup = {}, first: Player = "p1"): MatchState {
  return {
    mode,
    // Omitted rather than undefined when unused: the online database rejects undefined.
    ...((setup.naturalBoard ?? true) ? { boardSeed: newBoardSeed() } : {}),
    ...(setup.corners === "45" ? { corners: "45" as const } : {}),
    difficulty,
    score: { p1: 0, p2: 0 },
    turn: first,
    puck: { ...CENTER },
    shots: 0,
    winner: null,
    goals: [],
    stats: { p1: emptyPlayer(), p2: emptyPlayer(), longestRally: 0, rally: 0, mostBounces: 0 },
    startedAt: Date.now(),
  };
}

export interface ShotOutcome {
  goal: GoalSide | null;
  rest: Vec;
  contacts: Contact[];
  power: number;
  /** The shot as it left the stick (recorded with goals for replays). */
  launch?: Launch;
}

export interface ShotReport {
  state: MatchState;
  /** Who scored, if anyone. */
  scorer: Player | null;
  ownGoal: boolean;
  bank: boolean;
  corner: boolean;
  /** The shooter's goals in a row, counting this one (0 on a miss or own goal). */
  run?: number;
}

/** Apply a finished shot by the player whose turn it was. */
export function applyShot(prev: MatchState, out: ShotOutcome): ShotReport {
  const shooter = prev.turn;
  const s: MatchState = structuredClone(prev);
  const me = s.stats[shooter];
  me.shots++;
  me.hardest = Math.max(me.hardest, out.power);
  s.shots++;
  s.stats.mostBounces = Math.max(s.stats.mostBounces, out.contacts.length);

  // Runs count the shooter's own scoring shots; anything else ends theirs.
  const runs = (s.stats.runs ??= { p1: 0, p2: 0 });
  const scored = !!out.goal && goalFor(out.goal) === shooter;
  runs[shooter] = scored ? runs[shooter] + 1 : 0;
  if (scored) me.bestRun = Math.max(me.bestRun ?? 0, runs[shooter]);

  if (!out.goal) {
    s.puck = { ...out.rest };
    s.turn = other(shooter);
    s.stats.rally++;
    s.stats.longestRally = Math.max(s.stats.longestRally, s.stats.rally);
    return { state: s, scorer: null, ownGoal: false, bank: false, corner: false, run: 0 };
  }

  const scorer = goalFor(out.goal);
  const ownGoal = scorer !== shooter;
  const { bank, corner } = goalKind(out.contacts);
  s.score[scorer]++;
  s.stats.rally++;
  s.stats.longestRally = Math.max(s.stats.longestRally, s.stats.rally);
  s.stats.rally = 0;
  if (ownGoal) me.ownGoals++;
  else {
    me.goals++;
    if (bank) me.bankGoals++;
    if (corner) me.cornerGoals++;
  }
  if (out.launch) {
    // The database stores no empty arrays, so a fresh match may come back without one.
    s.goals = [...(s.goals ?? []), { launch: out.launch, by: shooter, scorer, ownGoal, bank, corner, score: { ...s.score } }];
  }
  s.puck = { ...CENTER };
  s.turn = other(scorer);
  if (hasWon(s.score, scorer)) s.winner = scorer;
  return { state: s, scorer, ownGoal, bank, corner, run: runs[shooter] };
}

// --- Saving ---------------------------------------------------------------

const MATCH_KEY = "knock-hockey:match";

export function loadMatch(): MatchState | null {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as MatchState;
    if (!m || !m.score || !m.puck || m.winner || m.mode === "online") return null;
    m.mode ??= "cpu"; // saves from before 2-player
    return m;
  } catch {
    return null;
  }
}

export function saveMatch(m: MatchState | null): void {
  if (m?.mode === "online") return; // online matches live in their room
  try {
    if (m && !m.winner) localStorage.setItem(MATCH_KEY, JSON.stringify(m));
    else localStorage.removeItem(MATCH_KEY);
  } catch {
    /* not saved */
  }
}

export interface Settings {
  difficulty: Difficulty;
  aimLine: boolean;
  sound: boolean;
  /** New matches get a natural board (physics/board.ts); off for a perfectly true one. */
  naturalBoard: boolean;
  /** New matches' corners: the standard steep ones, or 45°. */
  corners: Corners;
}

/** Whether a match was started with a natural board. */
export const hasNaturalBoard = (m: Pick<MatchState, "boardSeed">) => m.boardSeed != null;

const SETTINGS_KEY = "knock-hockey:settings";
const DEFAULT_SETTINGS: Settings = { difficulty: "medium", aimLine: true, sound: true, naturalBoard: true, corners: "steep" };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* defaults */
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* not saved */
  }
}
