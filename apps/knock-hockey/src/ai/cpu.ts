import { quickShot, type Shot } from "../physics/sim";
import { BLOCK_D, H, PUCK_R, W, insideSolid, type GoalSide, type Vec } from "../physics/table";

// The CPU picks a shot by trying candidates with the real (deterministic)
// physics and scoring where each one ends up. Levels differ in how many shots
// they try, how they judge them, and how much aim error they add afterwards:
//
//   Easy   — a handful of random shots, big aim error, sometimes just picks
//            any shot it tried.
//   Medium — a full sweep of angles and powers, so it finds bank shots and the
//            corner shot; moderate aim error.
//   Hard   — a finer sweep, then refines the best shots and prefers ones that
//            still score if its aim is slightly off; looks one move ahead and
//            avoids leaving you an easy goal; tiny aim error.

export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

interface Level {
  /** Evenly spaced angles to try (0 = random shots instead). */
  angles: number;
  powers: number[];
  /** Random shots, when `angles` is 0. */
  randoms: number;
  /** Chance of ignoring the search and taking any shot it tried. */
  sloppy: number;
  /** Aim error, one standard deviation: degrees and power. */
  aimDeg: number;
  powerErr: number;
  /** Fine passes around the best shots, and shots that hold up to small aim error. */
  refine: boolean;
  /** Simulate the opponent's replies for the best few candidates. */
  lookahead: boolean;
}

const LEVELS: Record<Difficulty, Level> = {
  easy: { angles: 0, powers: [], randoms: 10, sloppy: 0.35, aimDeg: 9, powerErr: 0.25, refine: false, lookahead: false },
  medium: { angles: 180, powers: [0.35, 0.55, 0.75, 0.95], randoms: 0, sloppy: 0, aimDeg: 2.6, powerErr: 0.09, refine: false, lookahead: false },
  hard: {
    angles: 360,
    powers: [0.3, 0.42, 0.55, 0.68, 0.82, 0.96],
    randoms: 0,
    sloppy: 0,
    aimDeg: 1.9,
    powerErr: 0.06,
    refine: true,
    lookahead: true,
  },
};

export interface ChooseOptions {
  difficulty: Difficulty;
  /** Which goal this shooter attacks. Player 1 (bottom) attacks the top. */
  attacksTop: boolean;
  rng?: () => number;
}

const GOAL = 1000;

interface Candidate {
  shot: Shot;
  value: number;
  goal: GoalSide | null;
  rest: Vec;
}

/** Pick a shot for the shooter at `at`. Synchronous: run it in a worker (see worker.ts). */
export function chooseShot(at: Vec, opts: ChooseOptions): Shot {
  const level = LEVELS[opts.difficulty];
  const rng = opts.rng ?? Math.random;
  const mine: GoalSide = opts.attacksTop ? "top" : "bottom";

  const judge = (shot: Shot): Candidate => {
    const r = quickShot(at, shot);
    const rest = { x: r.x, y: r.y };
    const value = r.goal === mine ? GOAL : r.goal ? -GOAL : restValue(rest, opts.attacksTop);
    return { shot, value, goal: r.goal, rest };
  };

  let cands: Candidate[] = [];
  if (level.angles === 0) {
    for (let i = 0; i < level.randoms; i++) cands.push(judge({ angle: rng() * Math.PI * 2, power: 0.3 + rng() * 0.7 }));
  } else {
    for (let i = 0; i < level.angles; i++) {
      const angle = (i / level.angles) * Math.PI * 2;
      for (const power of level.powers) cands.push(judge({ angle, power }));
    }
  }
  cands.sort((a, b) => b.value - a.value);

  if (level.refine) cands = refine(cands, judge, mine);
  if (level.lookahead) cands = lookahead(cands, opts.attacksTop);

  let pick = cands[0];
  if (level.sloppy && rng() < level.sloppy) pick = cands[Math.floor(rng() * cands.length)];
  return {
    angle: pick.shot.angle + gauss(rng) * ((level.aimDeg * Math.PI) / 180),
    power: Math.min(1, Math.max(0.05, pick.shot.power + gauss(rng) * level.powerErr)),
  };
}

/**
 * Where a missed shot leaves the puck, from the shooter's view. Far from your
 * own goal is good. Resting by the side rails near your own end is bad (that
 * sets up the opponent's corner shot), and so is the pocket behind your own
 * diamond (a tap-in).
 */
function restValue(p: Vec, attacksTop: boolean): number {
  // 0 at your own end rail, 1 at the far one.
  const far = attacksTop ? 1 - p.y / H : p.y / H;
  let v = 40 * far;
  const ownEnd = 1 - far;
  if (ownEnd > 0.62 && (p.x < 40 || p.x > W - 40)) v -= 25 * (ownEnd - 0.62) / 0.38 + 10;
  if (ownEnd > 1 - BLOCK_D / H && Math.abs(p.x - W / 2) < 60) v -= 50;
  return v;
}

/** Search near the best shots, and score goals by how well they hold up to aim error. */
function refine(cands: Candidate[], judge: (s: Shot) => Candidate, mine: GoalSide): Candidate[] {
  const seeds = cands.slice(0, 8);
  const more: Candidate[] = [];
  const step = Math.PI / 180;
  for (const s of seeds) {
    for (let da = -1; da <= 1.001; da += 0.25) {
      for (const dp of [-0.06, 0, 0.06]) {
        const power = s.shot.power + dp;
        if (power <= 0.05 || power > 1) continue;
        more.push(judge({ angle: s.shot.angle + da * step, power }));
      }
    }
  }
  const all = [...cands, ...more].sort((a, b) => b.value - a.value);
  // Goal shots: prefer ones whose neighbours (±0.5°, ±0.03 power) also score.
  for (const c of all.slice(0, 24)) {
    if (c.goal !== mine) continue;
    let hold = 0;
    for (const [da, dp] of [[-0.5, 0], [0.5, 0], [0, -0.03], [0, 0.03]]) {
      if (judge({ angle: c.shot.angle + da * step, power: Math.min(1, c.shot.power + dp) }).goal === mine) hold++;
    }
    c.value = GOAL * (0.5 + hold / 8);
  }
  return all.sort((a, b) => b.value - a.value);
}

/** For the best non-scoring shots, check how easy a goal each leaves the opponent. */
function lookahead(cands: Candidate[], attacksTop: boolean): Candidate[] {
  if (cands[0].value >= GOAL * 0.75) return cands; // a reliable goal beats anything
  const theirs: GoalSide = attacksTop ? "bottom" : "top";
  const pool = cands.filter((c) => !c.goal).slice(0, 12);
  for (const c of pool) {
    let scored = 0;
    let tried = 0;
    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * Math.PI * 2;
      for (const power of [0.45, 0.7, 0.95]) {
        tried++;
        if (quickShot(c.rest, { angle, power }).goal === theirs) scored++;
      }
    }
    c.value -= (scored / tried) * 600;
  }
  return cands.sort((a, b) => b.value - a.value);
}

function gauss(rng: () => number): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Small seeded RNG, for repeatable sims. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random legal resting spot on the board. */
export function randomSpot(rng: () => number): Vec {
  for (;;) {
    const p = { x: PUCK_R + rng() * (W - 2 * PUCK_R), y: PUCK_R + rng() * (H - 2 * PUCK_R) };
    if (!insideSolid(p, PUCK_R)) return p;
  }
}
