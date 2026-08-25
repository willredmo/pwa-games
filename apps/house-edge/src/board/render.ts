import { colorOf, POCKET_COUNT, WHEEL_ORDER } from "../engine";
import {
  angleOfPocket,
  ballOrbit,
  BALL_SIZE,
  DEFLECTOR_BALL_RADIUS,
  DEFLECTORS,
  SLICE,
} from "./physics";

/** One ball in flight. A spin may have several, all landing together. */
export interface BallView {
  /** Ball position relative to the rotor, radians. */
  rel: number;
  /** 0 = down in the pocket ring, 1 = out on the ball track. */
  radius: number;
  /** 0 = seated, 1 = up on the track. */
  height: number;
  /**
   * The ball that took the spin. Only meaningful once they have all landed —
   * in flight no ball has won yet, so nothing is marked.
   */
  picked?: boolean;
  /**
   * Sub-frame ball positions from earlier in this frame's interval, oldest
   * first, expressed in the *current* rotor frame. On the track the ball sweeps
   * roughly 19 degrees between frames, which strobes however high the frame
   * rate is — the fix is more samples per frame, not more frames.
   */
  trail?: ReadonlyArray<{ rel: number; radius: number; height: number; alpha: number }>;
}

/**
 * A speck thrown off a collision. Positions are in the same wheel-local terms
 * as a ball — angle relative to the rotor, radius, height — so a spark sits in
 * the scene rather than floating on top of it.
 *
 * These are *owned by the caller*, not by the renderer. The renderer paints
 * what it is handed and keeps no state between frames, the same reason it works
 * out deflector strikes from the ball's position instead of being told.
 */
export interface Spark {
  rel: number;
  radius: number;
  height: number;
  /** 1 at birth, 0 when it should be gone. */
  life: number;
  /** Relative scale; a hard knock throws bigger specks. */
  size: number;
}

/** Everything the renderer needs. It knows nothing about game state. */
export interface WheelView {
  /** Rotation of the rotor, radians. */
  wheelAngle: number;
  /** Every ball in this spin. Drawn in order, each depth-sorted separately. */
  balls: readonly BallView[];
  /** Pockets to ring once the balls have settled. */
  highlights: readonly number[];
  /**
   * How long the balls have been at rest, in milliseconds of *playback* time —
   * scaled by the speed control, so the flourish stays in step with a spin
   * played at a tenth speed. Null while anything is still in the air.
   *
   * A fact rather than a verdict: the flare works out its own progress from
   * this, so nothing has to tell the renderer "celebrate now".
   */
  settledMs: number | null;
  /** Live collision specks. */
  sparks: readonly Spark[];
}

/** How long the winning pocket glows after the balls stop, in playback ms. */
const FLARE_MS = 620;

/**
 * The wheel is drawn as a bowl seen at an angle. Radii are squashed vertically
 * by TILT, and height above the rotor plane lifts a point up the screen.
 *
 * The silhouette runs high at the centre and low at the edge: the turret is the
 * tallest thing on the wheel, the rim is roughly half its height, and the pocket
 * ring between them is the trough. A rim that out-tops the turret makes the
 * middle read as a sunken flat disc, which is what kills the sense of depth.
 *
 * The bowl is one *continuous funnel*: each band's outer edge is higher than its
 * inner edge, and every band starts exactly where the previous one ended.
 *
 * TILT and WALL are coupled: a band inverts (its inner edge drawing *below* its
 * outer edge) once the height drop across it exceeds its radial width times
 * TILT. The apron is the tightest band, so WALL is chosen to stay under that.
 * The cone is steeper than that limit, so it is drawn as a solid silhouette
 * rather than as a band.
 */
const TILT = 0.58;
const WALL = 0.26;
/** How much bigger the ball draws on the near pass than the far one. */
const DEPTH = 0.14;

// The funnel profile: radius (fraction of bowl) and height (fraction of wall).
const RIM_OUT = 1.0;
const RIM_IN = 0.92;
const TRACK_OUT = 0.92;
const TRACK_IN = 0.8;
const APRON_IN = 0.58;
const NUMBERS_IN = 0.49;
const POCKET_IN = 0.3;
const TURRET_R = 0.075;
/** Vertical squash on the number ring: full TILT is unreadably flat. */
const NUMBER_SQUASH = 0.74;

const H_TURRET = 0.72; // the high point of the whole wheel
const H_RIM = 0.34;
const H_TRACK = 0.2;
const H_ROTOR = 0;
const H_BASE = -0.45; // underside of the bowl, below the rotor plane

/**
 * The apron reads asymmetrically and H_RIM is the reason. Lifting the rim moves
 * its *near* edge up the screen, so every unit of rim height is subtracted from
 * the gap along the bottom and added to the gap along the top:
 *
 *   near gap = TILT * (1 - APRON_IN) - WALL * H_RIM
 *   far  gap = TILT * (1 - APRON_IN) + WALL * H_RIM
 *
 * Some of that split is just perspective and should stay. Too much of it and
 * the near apron is crushed to nothing, leaving the ball no visible room to
 * ride on the half of the wheel the player is actually looking at.
 */

/** Where the ball rides, midway across each surface. */
const BALL_H_TRACK = (H_RIM + H_TRACK) / 2;

/**
 * Vertical extent above / below the rotor plane, in units of R. Above, the far
 * lip of the rim ellipse reaches higher than the turret does, so both have to
 * be considered — budgeting for the turret alone clips the far numbers off.
 */
const EXTENT_UP = Math.max(TILT + WALL * H_RIM, WALL * H_TURRET + TURRET_R * TILT + 0.05);
const EXTENT_DOWN = RIM_OUT * 0.97 * TILT - WALL * H_BASE;

/**
 * The cone's profile from base to turret: (radius, height as a fraction of
 * H_TURRET). It is a shallow dome that necks into a slim spindle, not a
 * straight-sided pyramid — a straight flank from a full-width base reads as a
 * lump of chocolate. Heights are relative so that changing H_TURRET cannot
 * leave an intermediate ring poking out above the top.
 */
const CONE_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.245, 0.24],
  [0.2, 0.44],
  [0.15, 0.56],
  [0.11, 0.68],
  [0.088, 0.85],
  [TURRET_R, 1],
];

const GOLD = "#c9a227";
const GOLD_DIM = "#8c7420";
const FELT = "#f0ece1";
const COLORS = { red: "#b8342c", black: "#171b18", green: "#2e7d52" } as const;

/** Direction the wheel is lit from, in screen-space angle: upper left. */
const LIGHT = (-3 * Math.PI) / 4;

/** Screen-space angle: 0 points up (away from the viewer), positive clockwise. */
function screen(angle: number): number {
  return angle - Math.PI / 2;
}

/** Size the backing store to the element's CSS box at device resolution. */
export function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

export function drawWheel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: WheelView,
): void {
  ctx.clearRect(0, 0, w, h);

  const R = Math.max(1, Math.min(w / 2 - 2, (h - 4) / (EXTENT_UP + EXTENT_DOWN)));
  const cx = w / 2;
  const wall = R * WALL;
  // Centre the silhouette, which is taller below the rotor plane than above it.
  const cy = h / 2 + ((EXTENT_UP - EXTENT_DOWN) * R) / 2;

  const yAt = (t: number) => cy - wall * t;
  const ellipse = (f: number, t: number, from = 0, to = Math.PI * 2, back = false) =>
    ctx.ellipse(cx, yAt(t), R * f, R * f * TILT, 0, from, to, back);

  /**
   * A gradient running along LIGHT across the bowl. The bands used to be shaded
   * purely by height, which left every surface uniformly dark — and a shadow
   * cast onto a near-black surface is invisible no matter how opaque it is.
   */
  const litAcross = (lit: string, shade: string) => {
    const g = ctx.createLinearGradient(
      cx + Math.cos(LIGHT) * R,
      cy + Math.sin(LIGHT) * R * TILT,
      cx - Math.cos(LIGHT) * R,
      cy - Math.sin(LIGHT) * R * TILT,
    );
    g.addColorStop(0, lit);
    g.addColorStop(1, shade);
    return g;
  };

  /** A sloped annulus: outer edge at one height, inner edge at another. */
  const band = (
    rOut: number,
    hOut: number,
    rIn: number,
    hIn: number,
    fill: string | CanvasGradient,
  ) => {
    ctx.beginPath();
    ellipse(rOut, hOut);
    ellipse(rIn, hIn, 0, Math.PI * 2, true);
    ctx.fillStyle = fill;
    ctx.fill("evenodd");
  };

  // ---- outer body: the bowl seen from outside ----------------------------
  ctx.beginPath();
  ellipse(RIM_OUT * 0.97, H_BASE);
  ctx.fillStyle = "#0b0806";
  ctx.fill();

  const bodyFill = ctx.createLinearGradient(0, yAt(H_RIM), 0, yAt(H_BASE) + R * TILT);
  bodyFill.addColorStop(0, "#31220f");
  bodyFill.addColorStop(0.55, "#1c1309");
  bodyFill.addColorStop(1, "#0b0806");
  ctx.beginPath();
  ellipse(RIM_OUT, H_RIM, 0, Math.PI);
  ellipse(RIM_OUT * 0.97, H_BASE, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = bodyFill;
  ctx.fill();

  // ---- the funnel, outermost band inwards --------------------------------
  band(RIM_OUT, H_RIM, RIM_IN, H_RIM, litAcross("#5a4028", "#241810")); // flat rim top
  band(TRACK_OUT, H_RIM, TRACK_IN, H_TRACK, litAcross("#5c452a", "#241a10")); // ball track
  band(TRACK_IN, H_TRACK, APRON_IN, H_ROTOR, litAcross("#8a6840", "#3a2917")); // apron

  // Metal banding on the rim, thin — a wide solid gold hoop reads as a toy.
  for (const [f, t] of [
    [RIM_OUT - 0.005, H_RIM],
    [RIM_IN + 0.005, H_RIM],
  ] as const) {
    ctx.beginPath();
    ellipse(f, t);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1.5, R * 0.012);
    ctx.stroke();
  }

  // ---- deflectors: mounted on the STATIONARY apron, not the rotor --------
  // Whether the ball is on a given diamond is derivable from the ball's own
  // position, so the collision reads on screen without the physics having to
  // tell the renderer anything. Adding a "struck" flag to WheelView would be a
  // second source of truth for the same event, free to disagree with the first.
  // With several balls in flight a diamond reacts to whichever is closest to
  // striking it, so two balls cannot each cancel the other's collision.
  const onRingOf = (b: BallView) =>
    1 - Math.min(1, Math.abs(b.radius - DEFLECTOR_BALL_RADIUS) / 0.13);
  // Derived from the physics constant, not from the bowl's own geometry: the
  // ball has to visibly hit the diamond the solver says it hit.
  const deflectorR = ballOrbit(DEFLECTOR_BALL_RADIUS);
  const deflectorH = (H_TRACK + H_ROTOR) / 2;
  // Real bowls alternate the diamonds' orientation around the ring — half set
  // with their long axis radial, half tangential — so the ball's deflection is
  // not the same every time it clips one. Uniform diamonds read as a decorative
  // border rather than as hardware.
  const drawDeflector = (i: number, nearHalf: boolean) => {
    const own = (i / DEFLECTORS) * Math.PI * 2 + Math.PI / DEFLECTORS;
    const a = screen(own);
    if (Math.sin(a) > 0 !== nearHalf) return;
    // Wrapped angular distance from each ball to this diamond.
    let hit = 0;
    for (const b of view.balls) {
      let gap = (view.wheelAngle + b.rel - own) % (Math.PI * 2);
      if (gap > Math.PI) gap -= Math.PI * 2;
      if (gap < -Math.PI) gap += Math.PI * 2;
      hit = Math.max(hit, onRingOf(b) * Math.max(0, 1 - Math.abs(gap) / 0.2));
    }
    // Struck diamonds sit up slightly. A real one does not move, but a static
    // shape at the moment of impact reads as the ball passing through it.
    const s = R * 0.05 * (1 + Math.sin(a) * DEPTH) * (1 + hit * 0.18);
    const radial = i % 2 === 0;
    const lr = radial ? s : s * 0.52;
    const lt = radial ? s * 0.52 : s;

    ctx.save();
    ctx.translate(
      cx + Math.cos(a) * R * deflectorR,
      yAt(deflectorH) + Math.sin(a) * R * deflectorR * TILT,
    );
    ctx.scale(1, 0.78); // laid on the apron, then projected
    ctx.rotate(a);

    // Lit from LIGHT, which sits at (LIGHT - a) once we are in the diamond's
    // own frame.
    const la = LIGHT - a;
    const face = ctx.createLinearGradient(
      -Math.cos(la) * lr,
      -Math.sin(la) * lt,
      Math.cos(la) * lr,
      Math.sin(la) * lt,
    );
    face.addColorStop(0, hit > 0 ? "#fff4cf" : "#f0d271");
    face.addColorStop(0.5, hit > 0 ? "#f2d97f" : GOLD);
    face.addColorStop(1, hit > 0 ? "#b8991f" : GOLD_DIM);

    ctx.beginPath();
    ctx.moveTo(lr, 0);
    ctx.lineTo(0, lt);
    ctx.lineTo(-lr, 0);
    ctx.lineTo(0, -lt);
    ctx.closePath();
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = "rgba(60,44,12,0.7)";
    ctx.lineWidth = Math.max(1, R * 0.004);
    ctx.stroke();
    if (hit > 0) {
      ctx.strokeStyle = `rgba(255,244,210,${0.85 * hit})`;
      ctx.lineWidth = Math.max(1.5, R * 0.008);
      ctx.stroke();
    }
    ctx.restore();
  };
  // ---- the ball ----------------------------------------------------------
  // The ball orbits at a radius well outside the cone's base, but on the far
  // half it still projects to roughly the same screen height as the turret top,
  // so painting it unconditionally last makes it read as passing in *front* of
  // the cone on the back stretch. Depth-sort it against the cone instead.
  const drawBall = (ball: BallView) => {
    const ba = screen(view.wheelAngle + ball.rel);
    for (const g of ball.trail ?? []) {
      const ga = screen(view.wheelAngle + g.rel);
      const gr = R * ballOrbit(g.radius);
      const gs = R * (BALL_SIZE - 0.002) * (1 + Math.sin(ga) * DEPTH);
      ctx.beginPath();
      ctx.ellipse(
        cx + Math.cos(ga) * gr,
        yAt(BALL_H_TRACK * g.height) + Math.sin(ga) * gr * TILT,
        gs,
        gs,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = `rgba(226,221,208,${g.alpha})`;
      ctx.fill();
    }

    const rBall = R * ballOrbit(ball.radius);
    const by = yAt(BALL_H_TRACK * ball.height) + Math.sin(ba) * rBall * TILT;
    const byGround = yAt(BALL_H_TRACK * ball.radius) + Math.sin(ba) * rBall * TILT;
    const bx = cx + Math.cos(ba) * rBall;
    const size = R * BALL_SIZE * (1 + Math.sin(ba) * DEPTH);

    // Shadow. It is cast *away* from LIGHT, and the further the ball is above
    // the surface the further it slides out, the wider it spreads and the
    // softer it gets — a shadow pinned directly under the ball at constant
    // opacity is what makes a ball look pasted onto the wheel rather than
    // sitting on it. The gradient is the soft edge; canvas shadowBlur would
    // cost a full-canvas composite every frame.
    const lift = ball.height;
    const throwOut = size * 1.7 * lift;
    const sx = bx - Math.cos(LIGHT) * throwOut;
    const sy = byGround - Math.sin(LIGHT) * throwOut * TILT;
    const spread = size * (1.15 + lift * 0.9);
    const dark = 0.72 - lift * 0.24;

    const shadow = ctx.createRadialGradient(sx, sy, 0, sx, sy, spread);
    shadow.addColorStop(0, `rgba(0,0,0,${dark})`);
    shadow.addColorStop(0.5, `rgba(0,0,0,${dark * 0.62})`);
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.ellipse(sx, sy, spread, spread * TILT * 0.85, 0, 0, Math.PI * 2);
    ctx.fillStyle = shadow;
    ctx.fill();

    const hx = bx + Math.cos(LIGHT) * size * 0.38;
    const hy = by + Math.sin(LIGHT) * size * 0.38;
    const shine = ctx.createRadialGradient(hx, hy, size * 0.08, bx, by, size);
    shine.addColorStop(0, "#ffffff");
    shine.addColorStop(0.55, "#e8e3d8");
    shine.addColorStop(1, "#9c9484");
    ctx.beginPath();
    ctx.ellipse(bx, by, size, size, 0, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();

    // The ball that was paid. Ringed rather than recoloured: a gold ball would
    // read as a different kind of ball rather than as the same ball marked.
    if (ball.picked) {
      ctx.beginPath();
      ctx.ellipse(bx, by, size * 1.6, size * 1.6, 0, 0, Math.PI * 2);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = Math.max(1.5, R * 0.008);
      ctx.stroke();
    }
  };
  /**
   * Depth against the diamond ring. The diamonds stand on the apron, so a ball
   * outside their radius is further from the viewer on the far half and nearer
   * on the near half — the two cases sort opposite ways. Painting the ball on
   * one fixed side of them is what let it slide straight through a diamond.
   *
   * Each ball sorts on its own: two balls in the same spin are routinely on
   * opposite sides of the wheel, so a single shared verdict would paint one of
   * them through the hardware.
   */
  const bucketOf = (b: BallView) => {
    const far = Math.sin(screen(view.wheelAngle + b.rel)) <= 0;
    const outside = b.radius > DEFLECTOR_BALL_RADIUS;
    if (far) return outside ? 0 : 1;
    return outside ? 3 : 2;
  };
  const drawBucket = (n: number) => {
    for (const b of view.balls) if (bucketOf(b) === n) drawBall(b);
  };

  drawBucket(0);

  for (let i = 0; i < DEFLECTORS; i++) drawDeflector(i, false);

  // ---- the rotor ---------------------------------------------------------
  band(APRON_IN, H_ROTOR, NUMBERS_IN, H_ROTOR, "#0d100e"); // number ring

  for (let i = 0; i < POCKET_COUNT; i++) {
    const pocket = WHEEL_ORDER[i];
    const mid = view.wheelAngle + i * SLICE;
    ctx.beginPath();
    ellipse(NUMBERS_IN, H_ROTOR, screen(mid - SLICE / 2), screen(mid + SLICE / 2));
    ellipse(POCKET_IN, H_ROTOR, screen(mid + SLICE / 2), screen(mid - SLICE / 2), true);
    ctx.closePath();
    ctx.fillStyle = COLORS[colorOf(pocket)];
    ctx.fill();
  }

  // Frets: thin metal separators. Drawn as hairlines — as filled slabs they
  // read as gear teeth and swamp the pocket colours.
  ctx.lineWidth = Math.max(1, R * 0.006);
  for (let i = 0; i < POCKET_COUNT; i++) {
    const a = screen(view.wheelAngle + (i - 0.5) * SLICE);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * R * POCKET_IN, yAt(H_ROTOR) + Math.sin(a) * R * POCKET_IN * TILT);
    ctx.lineTo(cx + Math.cos(a) * R * NUMBERS_IN, yAt(H_ROTOR) + Math.sin(a) * R * NUMBERS_IN * TILT);
    // Lit from a fixed direction rather than by which half of the wheel the
    // fret is on. A near/far split is a step function: every fret changes tone
    // the instant it crosses the halfway line, so the whole ring appears to
    // twinkle as the rotor turns, and the seam sits in a fixed place on screen.
    const lit = (1 + Math.cos(a - LIGHT)) / 2;
    ctx.strokeStyle = `rgba(${172 + 62 * lit},${168 + 62 * lit},${158 + 62 * lit},${0.55 + 0.35 * lit})`;
    ctx.stroke();
  }

  // Numbers, on the ring outside the pockets.
  if (R > 92) {
    for (let i = 0; i < POCKET_COUNT; i++) {
      const pocket = WHEEL_ORDER[i];
      const sa = screen(view.wheelAngle + i * SLICE);
      const rr = (R * (APRON_IN + NUMBERS_IN)) / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(sa) * rr, yAt(H_ROTOR) + Math.sin(sa) * rr * TILT);
      // Radial, tops pointing outward, exactly as a real number ring is printed.
      // Squash first, then rotate, so the glyph is laid flat on the rotor plane
      // and *then* projected — rotating after the squash would shear it.
      // The near half therefore reads upside down, which is what a real wheel
      // does at this viewing angle. Flipping it is not an option: the flip has
      // to happen somewhere, and wherever it happens the number snaps through
      // 180 degrees mid-spin, which is far more obvious than the inversion.
      ctx.scale(1, NUMBER_SQUASH);
      ctx.rotate(sa + Math.PI / 2);
      ctx.fillStyle = FELT;
      ctx.font = `600 ${Math.max(7, R * 0.058)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(pocket), 0, 0);
      ctx.restore();
    }
  }

  // The winning pocket. A flat outline is all this used to get, which is very
  // little punctuation for the moment the whole spin has been building to.
  // `settledMs` drives a bloom that fades out and leaves the outline behind, so
  // the marker is still there once the flourish has finished.
  const flare =
    view.settledMs === null ? 0 : Math.max(0, 1 - view.settledMs / FLARE_MS);
  for (const highlight of view.highlights) {
    const mid = view.wheelAngle + angleOfPocket(highlight);
    ctx.beginPath();
    ellipse(NUMBERS_IN, H_ROTOR, screen(mid - SLICE / 2), screen(mid + SLICE / 2));
    ellipse(POCKET_IN, H_ROTOR, screen(mid + SLICE / 2), screen(mid - SLICE / 2), true);
    ctx.closePath();
    if (flare > 0) {
      // Eased so it blooms fast and lingers rather than fading linearly, which
      // reads as a dimmer switch instead of a flash.
      const glow = flare * flare;
      ctx.fillStyle = `rgba(201, 162, 39, ${0.5 * glow})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(240, 214, 130, ${0.35 + 0.65 * glow})`;
      ctx.lineWidth = 2 + 3 * glow;
    } else {
      ctx.strokeStyle = FELT;
      ctx.lineWidth = 2;
    }
    ctx.stroke();
  }

  drawBucket(1);

  // ---- the cone: the tallest thing on the wheel --------------------------
  // Too steep to draw as a band (it would invert), so it is built as a solid
  // silhouette: the near half of its base, up the left flank through the
  // profile, across the far edge of the turret collar, back down the right.
  const coneFill = ctx.createLinearGradient(
    cx - R * POCKET_IN,
    yAt(H_TURRET),
    cx + R * POCKET_IN * 0.6,
    yAt(H_ROTOR) + R * POCKET_IN * TILT,
  );
  coneFill.addColorStop(0, "#5c452b");
  coneFill.addColorStop(0.4, "#33240f");
  coneFill.addColorStop(1, "#0f0b07");
  ctx.beginPath();
  ellipse(POCKET_IN, H_ROTOR, 0, Math.PI);
  for (const [r, hh] of CONE_PROFILE) ctx.lineTo(cx - R * r, yAt(hh * H_TURRET));
  ellipse(TURRET_R, H_TURRET, Math.PI, Math.PI * 2);
  for (let i = CONE_PROFILE.length - 1; i >= 0; i--) {
    const [r, hh] = CONE_PROFILE[i];
    ctx.lineTo(cx + R * r, yAt(hh * H_TURRET));
  }
  ctx.closePath();
  ctx.fillStyle = coneFill;
  ctx.fill();

  // Turret collar and knob, sitting on top of the cone.
  ctx.beginPath();
  ellipse(TURRET_R, H_TURRET);
  ctx.fillStyle = GOLD_DIM;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, yAt(H_TURRET) - R * 0.04, R * 0.03, R * 0.03 * TILT, 0, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();

  drawBucket(2);

  for (let i = 0; i < DEFLECTORS; i++) drawDeflector(i, true);
  // A ball still out beyond the diamond ring is nearer to the viewer than the
  // near-side diamonds are, so it belongs in front of them.
  drawBucket(3);

  // ---- collision specks --------------------------------------------------
  // Painted last: they are small, bright and short-lived, and sorting each one
  // through the bowl would cost more than it could possibly show.
  for (const p of view.sparks) {
    if (p.life <= 0) continue;
    const pa = screen(view.wheelAngle + p.rel);
    const pr = R * ballOrbit(p.radius);
    const px = cx + Math.cos(pa) * pr;
    const py = yAt(BALL_H_TRACK * p.height) + Math.sin(pa) * pr * TILT;
    const size = R * 0.008 * p.size * (0.4 + p.life) * (1 + Math.sin(pa) * DEPTH);
    ctx.beginPath();
    ctx.ellipse(px, py, size, size, 0, 0, Math.PI * 2);
    // Warm at birth, cooling to the bowl's own tone as it dies.
    ctx.fillStyle = `rgba(255, ${Math.round(210 + 40 * p.life)}, ${Math.round(150 + 60 * p.life)}, ${0.75 * p.life})`;
    ctx.fill();
  }
}
