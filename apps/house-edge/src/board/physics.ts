import { POCKET_COUNT, wheelIndex } from "../engine";

/** Angular width of one pocket. */
export const SLICE = (Math.PI * 2) / POCKET_COUNT;

/** Angle, relative to the wheel, at which a given pocket sits. */
export function angleOfPocket(pocket: number): number {
  return wheelIndex(pocket) * SLICE;
}

/** Deflector diamonds on the stationary apron. Eight is the modern standard. */
export const DEFLECTORS = 8;

/**
 * Where the diamonds sit, in the same 0..1 units as `SpinSample.radius`. The
 * renderer places them from this rather than from its own geometry, so a strike
 * detected here lands on the diamond the player can actually see. If the two
 * drift apart the ball bounces off thin air.
 */
export const DEFLECTOR_BALL_RADIUS = 0.634;
/** How close to that radius counts as clipping a diamond. */
const STRIKE_BAND = 0.16;
/** A ball crossing the diamond ring can clip a few on the way down. */
const MAX_STRIKES = 3;

/**
 * A launched-ball roulette spin, solved backwards from a known outcome.
 *
 * The pocket is decided by `resolveSpin` before anything is drawn — that is the
 * game's fairness model, and every Edge modifier is already computed against
 * it. So the animation may not *choose* where the ball lands; it has to look
 * like real physics while arriving exactly where it was told to. A croupier
 * launches at a slightly different speed every time anyway, so we solve for the
 * one launch speed whose decay ends on the target pocket.
 *
 * The motion follows what a real ball actually does, which is two distinct
 * regimes rather than one smooth curve:
 *
 *   1. TRACK  — riding the stationary ball track, shedding speed *linearly*
 *               under near-constant rolling friction. It stays fast here.
 *   2. FALL   — at a critical velocity, centripetal force no longer holds it to
 *               the track and it leaves abruptly, crossing the apron, striking a
 *               deflector diamond and dropping onto the rotor.
 *   3. RATTLE — bouncing between the frets until it seats, then riding the rotor.
 *
 * Linear decay is the important part: an exponential eases the ball down gently
 * across the whole flight, which reads as a prize wheel winding down. Real
 * roulette holds speed and then lets go all at once.
 */

/** Critical angular velocity — below this the ball leaves the track. rad/s. */
const CRITICAL_SPEED = [5.0, 7.5] as const;
/** Relative revolutions aimed for; the solve nudges this to the nearest fit. */
const REVS_RANGE = [9, 16] as const;
/** Flight time is scaled by this much, so no two throws take equally long. */
const DURATION_JITTER = [0.88, 1.12] as const;
/** Rotor speed, rad/s. Counter to the ball, and nudged per throw. */
export const ROTOR_SPEED = 1.6;
const ROTOR_JITTER = [0.82, 1.2] as const;

/**
 * Fraction of the flight spent riding the track before it lets go, and then
 * crossing the apron onto the rotor. Whatever is left is the scatter.
 *
 * These are the scatter's *budget*, not just pacing. The ball now covers a mean
 * of eight pockets on the rotor, and how long it has to do that in is the whole
 * difference between skittering and being flung. Releasing late leaves a few
 * tenths of a second for the entire settle, so the early hops have to cross the
 * rotor at a speed nothing on a real wheel does.
 */
const RELEASE_RANGE = [0.42, 0.55] as const;
const FALL_RANGE = [0.12, 0.18] as const;

/**
 * Pockets between the ball's first contact with the rotor and where it comes to
 * rest — the *scatter*, and the single biggest source of unpredictability on a
 * real wheel. It is the reason wheel-clocking works on the ball track but falls
 * apart at the drop: a player can time the release and still be a dozen pockets
 * out.
 *
 * Published figures cluster around nine pockets from the dominant diamond to
 * rest, with a long right tail and a strong dependence on fret profile — low
 * frets let the ball roll across several dividers on its side instead of being
 * caught by the first one. So this is drawn skewed rather than uniform: most
 * spins scatter modestly, a few skitter right across the rotor.
 *
 * `2 + u^1.6 * 16` has a mean near 8 pockets over a 2..18 range.
 */
const SCATTER_MIN = 2;
const SCATTER_SPAN = 16;
const SCATTER_SKEW = 1.6;
/**
 * How the remaining distance shrinks per hop. Above 1 the early hops cover most
 * of the ground and the last few are small, which is what a decaying bounce
 * does; at 1 the ball would cross the rotor at a constant rate and read as a
 * slide rather than a series of bounces.
 */
const SETTLE_CURVE = 1.5;

/**
 * How high a bounce may go, where 1 is the ball track's own height above the
 * rotor. Above 1 the ball is popping up past the level it was riding at, which
 * is what a real ball does off a fret.
 *
 * This used to be clamped at 1, which tied "how high the ball can bounce" to
 * "how high the ball track sits" — two unrelated things that happened to share
 * a number. The renderer maps height to pixels linearly with no ceiling of its
 * own, and the ball's shadow takes its ground from `radius` rather than from
 * `height`, so the shadow stays on the surface however high the ball goes.
 */
export const HOP_CEILING = 1.8;

/**
 * The ball's own geometry, as fractions of the wheel's radius. This lives here
 * rather than in the renderer because it is physics, not decoration: how wide
 * the ball is decides when two of them touch. The renderer draws at these
 * numbers, so the collision the solver computes is the one you see.
 *
 * Was 0.036. Shrinking it is the one real lever on ball-on-ball overlap, but it
 * works on *frequency*, not on depth: overlapping samples fall from 1.56% to
 * 1.19%, while penetration measured as a fraction of a ball barely moves (p50
 * 19.8% to 21.1%). That is the expected shape — a smaller ball that overlaps is
 * still overlapping by the same proportion of itself, it just does so less
 * often and by fewer pixels. Absolute overlap depth falls about 17%, and the
 * two together cut visible interpenetration by roughly a third.
 */
export const BALL_SIZE = 0.028;
/** Orbit radius out on the ball track, and down in the pockets. */
export const BALL_ORBIT_TRACK = 0.86;
export const BALL_ORBIT_POCKET = 0.405;
/**
 * One unit of `height` expressed in the same wheel-radius units as the orbit,
 * so a lift can be measured against a radial or angular gap. The renderer
 * places the ball with the same figure (`WALL * BALL_H_TRACK`).
 */
export const BALL_HEIGHT_SCALE = 0.26 * 0.27;

/** Orbit radius for a `radius` of 0 (pocket) to 1 (track). */
export function ballOrbit(radius: number): number {
  return BALL_ORBIT_POCKET + (BALL_ORBIT_TRACK - BALL_ORBIT_POCKET) * radius;
}

/**
 * How far apart two ball centres are, in radians, at the moment their surfaces
 * touch. It grows as the balls fall inward — the same ball subtends a wider
 * angle on a tighter orbit — which is why this cannot be one fixed number:
 * 0.084 rad out on the track against 0.178 rad down in the pockets.
 */
export function touchAngle(radius: number): number {
  return (2 * BALL_SIZE) / ballOrbit(radius);
}

export interface SpinSample {
  /** Ball angle relative to the wheel, radians. */
  rel: number;
  /** Wheel's own rotation, radians. */
  wheelAngle: number;
  /** 0 = down in the pocket ring, 1 = out on the ball track. */
  radius: number;
  /** 0 = seated, 1 = up on the track. Drives the shadow and the bounces. */
  height: number;
}

/** One clip of a deflector diamond, found geometrically at plan time. */
interface Strike {
  /** Where in the fall it happens, 0..1. */
  s: number;
  hard: number;
  dir: number;
  /** How much air this one gives it. Usually very little. */
  lift: number;
  /** How many times it hops before the kick has died out. */
  bounces: number;
  width: number;
}

/**
 * The shape of a collision response, over its window.
 *
 * A collision is an *impulse*: velocity changes in an instant, so position has
 * a corner at the moment of contact and then relaxes. The previous profile was
 * a sine arc, which eases in — position, velocity and acceleration all
 * continuous — and that is precisely the shape of a gentle push rather than a
 * hit. Reading it back, the ball appeared to curve around the diamond instead
 * of striking it.
 *
 * `t·e^(1-t/tau)` is the impulse response: exactly zero at contact so nothing
 * teleports, maximum slope at contact so the velocity change is abrupt, then an
 * exponential relaxation. The trailing `(1 - t)` guarantees it is exactly zero
 * at the end of its window, which is what keeps a strike from leaving a step in
 * the ball's angle when the next phase takes over.
 */
const STRIKE_TAU = 0.16;
function strikeRaw(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const x = t / STRIKE_TAU;
  return x * Math.exp(1 - x) * (1 - t);
}
/** Normalised so an amplitude of 1 means a peak of 1. */
const STRIKE_PEAK = (() => {
  let m = 0;
  for (let i = 1; i < 400; i++) m = Math.max(m, strikeRaw(i / 400));
  return m;
})();

/**
 * Height response is separately shaped: a hit does not lift the ball once and
 * set it down, it throws it into a short series of decaying hops. Still zero at
 * both ends of the window, and still sharp at contact — |sin| has a corner at
 * the origin, which is the same reason it reads as an impact.
 */
function hopRaw(t: number, bounces: number): number {
  if (t <= 0 || t >= 1) return 0;
  return (1 - t) * Math.exp(-2 * t) * Math.abs(Math.sin(Math.PI * bounces * t));
}
const HOP_PEAK = [0, 1, 2, 3].map((b) => {
  if (b === 0) return 1;
  let m = 0;
  for (let i = 1; i < 400; i++) m = Math.max(m, hopRaw(i / 400, b));
  return m;
});

export interface SpinPlan {
  durationMs: number;
  /**
   * The rotor speed this throw actually drew. Balls sharing a spin must share
   * it, or each would imply a different rotor angle for the same instant.
   */
  rotor: number;
  sample(elapsedMs: number): SpinSample;
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function planSpin(opts: {
  pocket: number;
  /** Ball's relative angle where the previous spin left it. */
  fromRel: number;
  /** Wheel rotation at launch. */
  fromWheel: number;
  durationMs: number;
  rng?: () => number;
  /**
   * Pin the rotor speed and the flight time to another ball's throw. Every
   * other quality of the throw — launch strength, release point, which diamond
   * it catches, how it scatters — is still drawn independently, so the balls
   * take visibly different routes to arrive at the same moment on the same
   * rotor. Without this each ball jitters its own duration and rotor speed, and
   * two balls in one spin would neither land together nor agree on where the
   * rotor is.
   */
  lockTo?: { rotor: number; durationMs: number };
}): SpinPlan {
  const { pocket, fromRel, fromWheel, rng = Math.random, lockTo } = opts;
  const target = angleOfPocket(pocket);

  // Every throw differs: launch strength, how long it rides, where it lets go,
  // how the rotor happens to be turning, which diamond it catches.
  // Draw both regardless, so the rng consumption is identical whether or not
  // this ball is locked — otherwise a locked ball would run a different random
  // sequence from an unlocked one and the two would not be comparable.
  const drawnDuration = opts.durationMs * lerp(DURATION_JITTER, rng());
  const drawnRotor = ROTOR_SPEED * lerp(ROTOR_JITTER, rng());
  const durationMs = lockTo?.durationMs ?? drawnDuration;
  const D = durationMs / 1000;
  const rotor = lockTo?.rotor ?? drawnRotor;
  const uRelease = lerp(RELEASE_RANGE, rng());
  const uLand = Math.min(0.95, uRelease + lerp(FALL_RANGE, rng()));
  const omegaC = lerp(CRITICAL_SPEED, rng());

  const tTrack = uRelease * D;
  const tFall = (uLand - uRelease) * D;

  const rattleDir = rng() < 0.5 ? 1 : -1;
  // Micro-chatter only. The real travel across the rotor is swept angle now,
  // not a perturbation — see `settle`.
  const rattleAmp = 0.02 + rng() * 0.05;
  const rattleBeats = 7 + Math.floor(rng() * 5);
  /** Pockets the ball skitters after first contact, before it settles. */
  const scatterPockets = SCATTER_MIN + Math.pow(rng(), SCATTER_SKEW) * SCATTER_SPAN;
  const sScatter = scatterPockets * SLICE;
  /**
   * How high it kicks off the frets before it settles. Height 1 is the ball
   * track, so this is a real fraction of the bowl's depth rather than a nudge —
   * the frets are the bounciest thing the ball touches and the drop should read
   * as hopping, not as settling. Above 1 the ball clears the height it was
   * riding at; HOP_CEILING is the only limit.
   */
  const rattleLift = 1.15 + rng() * 0.5;
  const trackWobble = rng() * Math.PI * 2;

  // The fall sweeps a fixed amount: speed bleeds linearly from critical to zero.
  const sFall = (omegaC * tFall) / 2;

  // Solve total sweep: any S with (fromRel − S) ≡ target (mod 2π) lands on the
  // pocket, so take the one nearest the revolution count we want — then make
  // sure it implies a launch faster than the critical speed, or it would have
  // fallen off the track before it started.
  const base = fromRel - target;
  const twoPi = Math.PI * 2;
  let n = Math.max(1, Math.round((lerp(REVS_RANGE, rng()) * twoPi - base) / twoPi));
  let sTotal = base + n * twoPi;
  let omega0 = (2 * (sTotal - sFall - sScatter)) / tTrack - omegaC;
  while (omega0 < omegaC * 1.3) {
    n += 1;
    sTotal = base + n * twoPi;
    omega0 = (2 * (sTotal - sFall - sScatter)) / tTrack - omegaC;
  }
  // The scatter is real swept angle, taken out of the track phase: the ball
  // genuinely arrives `scatterPockets` short and skitters the rest of the way.
  // Bolting it on as a perturbation instead would put a step in the ball's
  // angle at touchdown, teleporting it across the rotor in one frame.
  const sTrack = sTotal - sFall - sScatter;
  // Constant friction deceleration on the track.
  const alpha = (omega0 - omegaC) / tTrack;


  /** The fall's underlying radius curve, before any diamond knocks it about. */
  const fallRadius = (s: number) => 0.95 * (1 - easeInOut(s));

  // Which diamonds it actually catches. Rather than picking a strike moment out
  // of the air, walk the fall and find where the ball's *absolute* angle crosses
  // a diamond while it happens to be at diamond radius. The diamonds are on the
  // stationary bowl, so this is a genuine geometric crossing — which is why the
  // count varies from throw to throw instead of always being exactly one.
  const strikes: Strike[] = [];
  {
    const step = (Math.PI * 2) / DEFLECTORS;
    const offset = Math.PI / DEFLECTORS;
    const N = 480;
    let prev: number | null = null;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const u = uRelease + s * (uLand - uRelease);
      const absolute = fromRel - swept(u) + fromWheel + rotor * D * u;
      const bucket = Math.floor((absolute - offset) / step);
      const inBand = Math.abs(fallRadius(s) - DEFLECTOR_BALL_RADIUS) < STRIKE_BAND;
      if (prev !== null && bucket !== prev && inBand && s > 0.04 && s < 0.86) {
        // Most clips are glancing and just knock the ball sideways. Only some
        // catch it squarely enough to throw it up in the air — a ball that
        // launches off every single diamond looks like a pinball.
        const lofted = rng() < 0.3;
        strikes.push({
          s,
          hard: 0.55 + rng() * 1.15,
          dir: rng() < 0.5 ? 1 : -1,
          lift: lofted ? 0.8 + rng() * 0.55 : 0.09 + rng() * 0.16,
          // A square hit skips a couple of times; a glancing one just deflects.
          bounces: lofted ? 2 + Math.floor(rng() * 2) : 1,
          // Kept clear of s = 1 so every strike has died out by touchdown.
          width: Math.min(0.32, 0.98 - s),
        });
        if (strikes.length >= MAX_STRIKES) break;
      }
      prev = bucket;
    }
    // A slow, shallow drop can thread between the diamonds. It still deserves
    // one glancing hit — a ball that crosses the ring untouched looks wrong.
    if (strikes.length === 0) {
      strikes.push({
        s: 0.42,
        hard: 0.5 + rng() * 0.6,
        dir: rng() < 0.5 ? 1 : -1,
        lift: 0.1 + rng() * 0.12,
        bounces: 1,
        width: 0.3,
      });
    }
  }

  /** How hard this strike is pushing right now, 0..1, peaking at contact. */
  function bump(k: Strike, s: number): number {
    return strikeRaw((s - k.s) / k.width) / STRIKE_PEAK;
  }

  /** How high this strike has the ball right now, 0..1 of its own lift. */
  function hopOf(k: Strike, s: number): number {
    return hopRaw((s - k.s) / k.width, k.bounces) / HOP_PEAK[k.bounces];
  }

  /**
   * Fraction of the scatter covered, 0 at first contact and exactly 1 at rest.
   * Stepped once per hop: the ball is carried while it is in the air and holds
   * station while it is against a fret, which is what makes the travel read as
   * bouncing rather than sliding.
   */
  function settle(s: number): number {
    const remainingAfter = (hop: number) =>
      Math.pow(Math.max(0, 1 - hop / rattleBeats), SETTLE_CURVE);
    const phase = Math.min(rattleBeats, s * rattleBeats);
    const hop = Math.min(rattleBeats - 1, Math.floor(phase));
    // Linear across each hop, not eased. A ball in the air carries constant
    // horizontal speed and stops dead on contact, so the corner at each hop
    // boundary is the correct shape. Easing within the hop instead put the peak
    // speed at twice the hop's average, which is where the ball's flight across
    // the rotor was getting its flung look.
    const across = phase - hop;
    const remaining =
      remainingAfter(hop) + (remainingAfter(hop + 1) - remainingAfter(hop)) * across;
    return 1 - remaining;
  }

  /** Angle swept since launch, positive. Exact: equals sTotal at u = 1. */
  function swept(u: number): number {
    if (u <= uRelease) {
      const t = u * D;
      return omega0 * t - (alpha * t * t) / 2;
    }
    if (u <= uLand) {
      const t = (u - uRelease) * D;
      const b = omegaC / tFall;
      return sTrack + omegaC * t - (b * t * t) / 2;
    }
    return sTrack + sFall + sScatter * settle((u - uLand) / (1 - uLand));
  }

  /** Perturbations. Shaped to be exactly zero at u = 1 so the landing stands. */
  function perturb(u: number): number {
    if (u <= uRelease) {
      // Track chatter. This belongs to the *ball*, not the rotor: it used to be
      // added to `wheelAngle`, which was harmless with one ball but means two
      // balls each demand their own rotor angle for the same instant — and one
      // rotor cannot wobble two ways. Windowed by sin(pi*s) so it is exactly
      // zero at launch and at release, leaving no step where the phases meet.
      const s = uRelease > 0 ? u / uRelease : 0;
      return Math.sin(trackWobble + u * 40) * 0.002 * Math.sin(Math.PI * s);
    }
    if (u <= uLand) {
      const s = (u - uRelease) / (uLand - uRelease);
      let d = 0;
      for (const k of strikes) d += bump(k, s) * 0.085 * k.hard * k.dir;
      return d;
    }
    const s = (u - uLand) / (1 - uLand);
    // Chatter against the frets, including the occasional backward nudge. Small
    // — the ball's actual journey across the rotor is swept angle.
    return rattleDir * rattleAmp * (1 - s) * Math.exp(-3.4 * s) * Math.sin(s * Math.PI * rattleBeats * 2);
  }

  /** 1 on the track, 0 seated in a pocket. */
  function radiusAt(u: number): number {
    if (u <= uRelease) {
      // Riding the track, sagging onto the apron as it slows.
      return 1 - 0.05 * (u / uRelease);
    }
    if (u <= uLand) {
      const s = (u - uRelease) / (uLand - uRelease);
      let kick = 0;
      for (const k of strikes) kick += bump(k, s) * 0.2 * k.hard;
      return Math.max(0, Math.min(1, fallRadius(s) + kick));
    }
    return 0;
  }

  /** Height above the rotor: 1 up on the track, 0 seated. Never negative. */
  function heightAt(u: number): number {
    if (u <= uRelease) return 1;
    if (u <= uLand) {
      const s = (u - uRelease) / (uLand - uRelease);
      // Drops to roughly diamond height by the time it reaches diamond radius,
      // then hops off whatever it clips on the way down.
      const fall = 1 - easeInOut(Math.min(1, s * 1.3));
      let hop = 0;
      for (const k of strikes) hop += hopOf(k, s) * k.lift;
      return Math.max(0, Math.min(HOP_CEILING, fall + hop));
    }
    const s = (u - uLand) / (1 - uLand);
    // Damped hops between the frets, forced to exactly zero at rest.
    // The frets are the bounciest part of the drop: sharp, repeated kicks that
    // die away, rather than one soft settle.
    return Math.min(
      HOP_CEILING,
      Math.max(
        0,
        rattleLift * (1 - s) * Math.exp(-1.3 * s) * Math.abs(Math.sin(s * Math.PI * rattleBeats)),
      ),
    );
  }

  return {
    durationMs,
    rotor,
    sample(elapsedMs: number): SpinSample {
      const u = Math.max(0, Math.min(1, elapsedMs / durationMs));
      return {
        rel: fromRel - swept(u) + perturb(u),
        // The rotor is a rigid body: its angle depends only on time, never on
        // any ball, so every ball in a spin agrees on where it is.
        wheelAngle: fromWheel + rotor * D * u,
        radius: radiusAt(u),
        height: heightAt(u),
      };
    },
  };
}

/* ---- ball-on-ball contact ------------------------------------------------ */

/** Vertical hop a touch imparts, in ball-track heights. */
const TOUCH_LIFT = 0.22;
/**
 * How much of a contact is resolved by climbing rather than by shoving
 * sideways. Two balls bound for different pockets *have* to cross, so at equal
 * radius no amount of angular separation keeps them apart — one has to ride
 * over the other, which is what real balls do. Without this, deep overlap
 * stayed common (p90 penetration 79.9%) however hard the sideways push ran.
 */
const TOUCH_CLIMB = 0.75;
/** Closing speed, in radians per unit of flight, that counts as a full hit. */
const TOUCH_FULL_SPEED = 1.2;
/** Trajectory samples the contact solver works on. */
const TOUCH_SAMPLES = 480;
/** Relaxation passes. Pushing one pair apart can push it into a third ball. */
const TOUCH_PASSES = 8;
/**
 * Where the separation displacement starts being wound back down. Everything
 * here has to be exactly zero by u = 1 or it would move the landing, and the
 * last stretch of the flight is the ball settling into its pocket, where the
 * remaining overlap is a fraction of a ball rather than a pass-through.
 */
const TOUCH_RELEASE_U = 0.82;

function wrapPi(a: number): number {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v < -Math.PI) v += Math.PI * 2;
  return v;
}

/**
 * Make a set of balls from one spin solid to each other.
 *
 * This is a **positional constraint, not an impulse**. The first version
 * applied a decaying kick at the moment of contact, which is the same shape
 * used for the deflector strikes — and it did not work: an impulse acts after
 * the fact, so at track speeds the balls flew straight through one another and
 * were shoved apart on the way out. Measured penetration was 100%, meaning
 * centres coinciding. Solidity is a statement about where the balls *are*, so
 * it has to be solved as position.
 *
 * Each flight is sampled onto a grid and overlaps are relaxed away in place,
 * repeatedly, because separating one pair can push a ball into a third. The
 * resulting displacement is angular only — radial position is the fall
 * trajectory, and moving it would desynchronise the diamond strikes and the
 * seat in the pocket.
 *
 * The displacement is wound down to **exactly zero by u = 1**, so like every
 * other perturbation here it cannot move the landing. What that costs is the
 * settling phase: balls coming to rest in adjacent pockets are 0.170 rad apart
 * and are 0.178 rad wide, so they touch by a sliver no matter what. That is
 * also what real balls in adjacent pockets do, separated by the fret.
 */
export function coupleBalls(plans: SpinPlan[]): SpinPlan[] {
  if (plans.length < 2) return plans;
  const n = plans.length;
  const D = plans[0].durationMs;
  const S = TOUCH_SAMPLES;

  const base: SpinSample[][] = plans.map((p) => {
    const arr: SpinSample[] = [];
    for (let k = 0; k <= S; k++) arr.push(p.sample((D * k) / S));
    return arr;
  });

  /** Angular displacement applied to each ball at each sample. */
  const push: Float64Array[] = plans.map(() => new Float64Array(S + 1));
  /** Height added by a bounce, so a contact reads as a knock and not a slide. */
  const lift: Float64Array[] = plans.map(() => new Float64Array(S + 1));
  /** Height added purely to clear another ball. */
  const climb: Float64Array[] = plans.map(() => new Float64Array(S + 1));

  const touching = new Set<string>();

  for (let pass = 0; pass < TOUCH_PASSES; pass++) {
    // Between passes, not after them. Smoothing applied once at the end blurs
    // every correction back out — measured as zero improvement in worst-case
    // penetration. Relaxing again afterwards is what makes it hold.
    if (pass > 0 && pass < TOUCH_PASSES - 1) {
      for (const arr of [...push, ...climb]) {
        let prev = arr[0];
        for (let k = 1; k < S; k++) {
          const cur = arr[k];
          arr[k] = (prev + cur + arr[k + 1]) / 3;
          prev = cur;
        }
      }
    }
    for (let k = 0; k <= S; k++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = base[i][k];
          const b = base[j][k];
          const ra = ballOrbit(a.radius);
          const rb = ballOrbit(b.radius);
          const gap = wrapPi(
            a.wheelAngle + a.rel + push[i][k] - (b.wheelAngle + b.rel + push[j][k]),
          );
          const mean = (ra + rb) / 2;
          const dh =
            (a.height + climb[i][k] - (b.height + climb[j][k])) * BALL_HEIGHT_SCALE;
          // Centre-to-centre distance in wheel-radius units, all three axes.
          const dist = Math.hypot(ra - rb, gap * mean, dh);
          const deficit = 2 * BALL_SIZE - dist;
          if (deficit <= 0) continue;
          // Separate along the angular axis, half each, converting the linear
          // shortfall into radians on their own orbits.
          const dir = gap === 0 ? (i < j ? 1 : -1) : Math.sign(gap);
          const half = deficit / 2 / mean;
          push[i][k] += dir * half;
          push[j][k] -= dir * half;
          // ...and the rest by one riding over the other. Whichever is already
          // higher keeps climbing, so a pair resolves the same way throughout
          // instead of trading places from one sample to the next.
          const over = a.height + climb[i][k] >= b.height + climb[j][k] ? i : j;
          climb[over][k] += (deficit * TOUCH_CLIMB) / BALL_HEIGHT_SCALE;

          if (pass === 0) {
            const key = `${i}:${j}`;
            const wasTouching = touching.has(key + ":" + (k - 1));
            if (!wasTouching) {
              const prev = k > 0 ? base[i][k - 1] : a;
              const prevB = k > 0 ? base[j][k - 1] : b;
              const closing =
                Math.abs(
                  wrapPi(a.wheelAngle + a.rel - (b.wheelAngle + b.rel)) -
                    wrapPi(prev.wheelAngle + prev.rel - (prevB.wheelAngle + prevB.rel)),
                ) * S;
              const strength = Math.min(1, closing / TOUCH_FULL_SPEED);
              // A short hop for each of them, from the moment they meet.
              for (let m = k; m <= S; m++) {
                const x = (m - k) / Math.max(1, S - k);
                lift[i][m] += TOUCH_LIFT * strength * (hopRaw(x, 2) / HOP_PEAK[2]);
                lift[j][m] += TOUCH_LIFT * strength * (hopRaw(x, 2) / HOP_PEAK[2]);
              }
            }
            touching.add(key + ":" + k);
          }
        }
      }
    }
  }

  // Wind everything down to exactly zero at touchdown.
  for (let i = 0; i < n; i++) {
    for (let k = 0; k <= S; k++) {
      const u = k / S;
      if (u <= TOUCH_RELEASE_U) continue;
      const x = (u - TOUCH_RELEASE_U) / (1 - TOUCH_RELEASE_U);
      const w = 1 - x * x * (3 - 2 * x); // smoothstep down, flat at both ends
      push[i][k] *= w;
      lift[i][k] *= w;
      climb[i][k] *= w;
    }
    push[i][S] = 0;
    lift[i][S] = 0;
    climb[i][S] = 0;
  }

  return plans.map((plan, i) => {
    const dRel = push[i];
    const dH = lift[i];
    const dC = climb[i];
    let moved = false;
    for (let k = 0; k <= S; k++) {
      if (dRel[k] !== 0 || dH[k] !== 0 || dC[k] !== 0) { moved = true; break; }
    }
    if (!moved) return plan;
    return {
      durationMs: plan.durationMs,
      rotor: plan.rotor,
      sample(elapsedMs: number): SpinSample {
        const s = plan.sample(elapsedMs);
        const u = Math.max(0, Math.min(1, elapsedMs / plan.durationMs));
        const t = u * S;
        const k = Math.min(S - 1, Math.floor(t));
        const f = t - k;
        return {
          rel: s.rel + dRel[k] + (dRel[k + 1] - dRel[k]) * f,
          wheelAngle: s.wheelAngle,
          radius: s.radius,
          height: Math.min(
            HOP_CEILING,
            s.height + dH[k] + (dH[k + 1] - dH[k]) * f + dC[k] + (dC[k + 1] - dC[k]) * f,
          ),
        };
      },
    };
  });
}
