import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { money } from "../game/format";
import { CHANGE_MIN_TAKE, changePayout } from "../game/state";
import {
  CHANGE_BILL_FROM,
  CHANGE_CUP_SPEED,
  CHANGE_DROPS,
  type ChangeMods,
} from "../game/upgrades";
import { prefersReducedMotion } from "./motion";

/** Logical play-area size. The canvas is scaled to this, so speeds are stable. */
const W = 320;
const H = 310;
const CUP_MOUTH_RY = 7;
const CUP_BODY_H = 46;
/** y of the mouth. The body hangs below it, so it is not flush to the floor. */
const CUP_Y = H - CUP_BODY_H - 10;
/**
 * The cup moves at exactly CHANGE_CUP_SPEED, always. No per-press step and no
 * easing: both make the first moment of a press faster than the rest of it,
 * which is what reads as a jump. A tap covers however far that speed carries it
 * in the time the key was down — small, but predictable, which matters more
 * than assistance when you are lining up under a falling coin.
 */
const CUP_SPEED = CHANGE_CUP_SPEED;
const COIN_R = 11;
/** Bills are wider and flatter than coins, and catch on their own footprint. */
const BILL_HW = 17;
const BILL_HH = 9;
/**
 * The drop runs at a constant rate. It used to accelerate, which was there to
 * eventually outrun the cup and bound the payout — but paying face value for
 * the change already bounds it, and a difficulty ramp on an untimed game just
 * punishes a long run. One brisk speed the whole way through instead.
 */
const FALL_SPEED = 138;
const FALL_JITTER = 26;
const SPAWN_GAP = 250;
/** Chance a spill drops two at once, so the floor is not a single file. */
const SPAWN_DOUBLE = 0.45;

/**
 * Twenty denominations is too many to hand-colour, and a table of them would
 * drift out of step with CHANGE_COINS. Derived instead: the dollar is gold, and
 * everything below it is silver brightening with value, so worth is legible at
 * a glance even before the number is readable.
 */
function drawCoin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cents: number,
  spin = 0,
): void {
  // A disc turning about its vertical axis is just a circle whose width
  // narrows to nothing and back. Cheaper than any sprite and it reads
  // correctly, including the moment it goes edge-on.
  const face = Math.cos(spin);
  const squash = Math.abs(face);
  let fill: string;
  let rim: string;
  if (cents >= 100) {
    fill = "#d9b64a";
    rim = "#8c7420";
  } else {
    const l = Math.round(148 + ((cents - 5) / 90) * 66);
    fill = `rgb(${l},${l - 3},${l - 10})`;
    rim = `rgb(${l - 46},${l - 47},${l - 52})`;
  }
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.6, COIN_R * squash), COIN_R, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Edge-on there is no face to print a number on.
  if (squash < 0.45) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(squash, 1);
  ctx.translate(-x, -y);
  ctx.fillStyle = "#2a2313";
  ctx.font = "bold 9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(cents >= 100 ? "$1" : String(cents), x, y);
  ctx.restore();
}

/** A folded note. Shaped and coloured so it never reads as a big coin. */
function drawBill(ctx: CanvasRenderingContext2D, x: number, y: number, cents: number): void {
  ctx.save();
  ctx.translate(x, y);
  // A slight tilt keyed to position, so a drift of notes is not a stack of
  // identical rectangles.
  ctx.rotate(Math.sin(x * 0.35) * 0.16);
  ctx.beginPath();
  ctx.roundRect(-BILL_HW, -BILL_HH, BILL_HW * 2, BILL_HH * 2, 2);
  ctx.fillStyle = "#3f6f4d";
  ctx.fill();
  ctx.strokeStyle = "#20402c";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, 0, BILL_HW * 0.62, BILL_HH * 0.62, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(214,236,220,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#eaf5ec";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`$${cents / 100}`, 0, 0);
  ctx.restore();
}

/**
 * The catcher: a paper takeaway cup, seen slightly from above so the mouth
 * reads as an opening rather than a flat lid — the drops have to look like they
 * are landing *in* something. The mouth ellipse is also the collision surface,
 * so what is drawn and what catches are the same width by construction.
 */
/**
 * `lean` tips the cup a few degrees into its travel. It is applied **here and
 * nowhere else** — the catch test in the loop keeps using the upright mouth
 * position. A tilt that moved the hitbox would quietly change how hard the
 * game is, and difficulty is not a thing to alter while adding polish.
 */
function drawCup(
  ctx: CanvasRenderingContext2D,
  x: number,
  cupW: number,
  lean = 0,
): void {
  const rx = cupW / 2;
  const footRx = rx * 0.74;
  const bottom = CUP_Y + CUP_BODY_H;
  const lip = rx * 1.04;

  // Contact shadow, so it sits on the floor rather than floating over it.
  // Drawn before the tilt: the shadow stays on the ground while the cup leans.
  ctx.beginPath();
  ctx.ellipse(x, bottom, footRx * 1.15, 4, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();

  // Everything from here leans. Pivoting at the base keeps the cup planted.
  ctx.save();
  ctx.translate(x, bottom);
  ctx.rotate(lean);
  ctx.translate(-x, -bottom);

  // Tapered body.
  const body = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  body.addColorStop(0, "#9d9a92");
  body.addColorStop(0.16, "#dcd8cf");
  body.addColorStop(0.42, "#faf8f3");
  body.addColorStop(0.76, "#d2cec5");
  body.addColorStop(1, "#8f8c84");
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y, rx, CUP_MOUTH_RY, 0, Math.PI, 0);
  ctx.lineTo(x + footRx, bottom - 2);
  ctx.ellipse(x, bottom - 2, footRx, CUP_MOUTH_RY * 0.72, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();

  // Corrugated sleeve. The one detail that says "takeaway" rather than "beaker".
  const sleeveTop = CUP_Y + CUP_BODY_H * 0.32;
  const sleeveBot = CUP_Y + CUP_BODY_H * 0.72;
  const tTop = 0.32;
  const tBot = 0.72;
  const wTop = rx + (footRx - rx) * tTop;
  const wBot = rx + (footRx - rx) * tBot;
  const sleeve = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  sleeve.addColorStop(0, "#5d4429");
  sleeve.addColorStop(0.4, "#a97f4f");
  sleeve.addColorStop(1, "#4e3821");
  ctx.beginPath();
  ctx.moveTo(x - wTop, sleeveTop);
  ctx.lineTo(x + wTop, sleeveTop);
  ctx.lineTo(x + wBot, sleeveBot);
  ctx.lineTo(x - wBot, sleeveBot);
  ctx.closePath();
  ctx.fillStyle = sleeve;
  ctx.fill();
  ctx.strokeStyle = "rgba(40,28,15,0.45)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const f = i / 6;
    ctx.beginPath();
    ctx.moveTo(x - wTop + wTop * 2 * f, sleeveTop);
    ctx.lineTo(x - wBot + wBot * 2 * f, sleeveBot);
    ctx.stroke();
  }
  // Grubby patches. Fixed offsets, not random per frame — a stain that moves
  // every frame is noise, and the cup is the thing the eye is tracking.
  ctx.fillStyle = "rgba(48,30,14,0.35)";
  for (const [off, up, r] of [
    [-0.42, 0.3, 4.5],
    [0.12, 0.62, 3.2],
    [0.55, 0.25, 2.6],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(
      x + wTop * off,
      sleeveTop + (sleeveBot - sleeveTop) * up,
      r,
      r * 0.75,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Drips down the outside, drawn under the sleeve edge so they look like they
  // ran from the rim rather than being painted on.
  ctx.fillStyle = "rgba(78,45,22,0.42)";
  for (const [off, len, wide] of [
    [-0.52, 0.5, 1.7],
    [0.28, 0.78, 1.3],
    [0.66, 0.34, 1.1],
  ] as const) {
    const dx = x + rx * off;
    ctx.beginPath();
    ctx.moveTo(dx - wide, CUP_Y + 2);
    ctx.lineTo(dx + wide, CUP_Y + 2);
    ctx.lineTo(dx + wide * 0.35, CUP_Y + 2 + CUP_BODY_H * len);
    ctx.lineTo(dx - wide * 0.35, CUP_Y + 2 + CUP_BODY_H * len);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(dx, CUP_Y + 2 + CUP_BODY_H * len, wide * 0.7, wide * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The inside: empty. Two things sell that. First the tones are pale paper,
  // not a dark pool — a dark disc filling a cup opening is exactly what a full
  // cup looks like. Second the base is drawn *small and high*: the cup tapers,
  // and looking down into it the base projects toward the far side, leaving a
  // broad crescent of shadowed inner wall along the near rim. A base ellipse
  // that fills the opening reads as a surface, however it is coloured.
  const cavity = ctx.createLinearGradient(0, CUP_Y - CUP_MOUTH_RY, 0, CUP_Y + CUP_MOUTH_RY);
  cavity.addColorStop(0, "#8d8579");
  cavity.addColorStop(0.45, "#6f6960");
  cavity.addColorStop(1, "#4b463f");
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y + 1, rx - 3.2, CUP_MOUTH_RY - 1.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = cavity;
  ctx.fill();

  const baseRx = rx * 0.56;
  const baseRy = Math.max(1.1, CUP_MOUTH_RY * 0.38);
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y - 1.4, baseRx, baseRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#cbc4b6";
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y - 1.4, baseRx * 0.82, baseRy * 0.72, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(118,72,34,0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + baseRx * 0.3, CUP_Y - 1.2, baseRx * 0.22, baseRy * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(108,66,30,0.4)";
  ctx.fill();

  // Rolled rim last, and wider than the body — that overhang is what makes it
  // read as paper rather than as a plastic beaker. Stained on one side, which
  // is the detail that reads as "used" more than any amount of grime elsewhere.
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y, lip, CUP_MOUTH_RY * 1.06, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#f7f4ec";
  ctx.lineWidth = 3.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y, lip, CUP_MOUTH_RY * 1.06, 0, Math.PI * 0.12, Math.PI * 0.88);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y, lip, CUP_MOUTH_RY * 1.06, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.strokeStyle = "rgba(120,116,106,0.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, CUP_Y, lip, CUP_MOUTH_RY * 1.06, 0, Math.PI * 0.2, Math.PI * 0.55);
  ctx.strokeStyle = "rgba(96,58,28,0.6)";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

/** Cents as dollars. Every amount in this game is a whole multiple of 5c. */
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface Coin {
  x: number;
  y: number;
  /** Value in cents. */
  v: number;
  vy: number;
  /** Rotation phase. Purely cosmetic — nothing tests against it. */
  spin: number;
  /** Radians per second. */
  spinRate: number;
}

/** A sparkle thrown when something lands in the cup. */
interface Fleck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Props {
  /** Bankroll the player already holds, in whole dollars. */
  chips: number;
  /** Everything the shop upgrades about this game. */
  mods: ChangeMods;
  onSettle: (collected: number) => void;
}

function rollCoin(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < CHANGE_DROPS.length; i++) {
    r -= weights[i];
    if (r <= 0) return CHANGE_DROPS[i];
  }
  return CHANGE_DROPS[0];
}

/**
 * Scramble for dropped change. Positions live in a ref and are driven by one
 * rAF loop; React state only carries the discrete facts the HUD shows, so the
 * component re-renders on events rather than on every frame.
 */
export function LooseChange({ chips, mods, onSettle }: Props) {
  // Read through a ref inside the loop: the loop is started once and must not
  // be torn down and restarted mid-scramble just because a prop identity moved.
  const modsRef = useRef(mods);
  modsRef.current = mods;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [caught, setCaught] = useState(0);
  const [total, setTotal] = useState(0);
  const [showOdds, setShowOdds] = useState(false);

  const world = useRef({
    cup: W / 2,
    coins: [] as Coin[],
    keyLeft: false,
    keyRight: false,
    pointer: null as number | null,
    flecks: [] as Fleck[],
    /** Smoothed cup velocity, in px/s, for the draw-only lean. */
    lean: 0,
    // Coins are already in the air on frame one. The rules are two lines and
    // the cup starts centred, so a "move to start" gate only ever read as the
    // game being broken for the first second.
    nextSpawn: 0,
  });

  const totalRef = useRef(0);
  const settledRef = useRef(onSettle);
  settledRef.current = onSettle;

  // --- input --------------------------------------------------------------
  useEffect(() => {
    /**
     * Matched on `code` as well as `key`. `key` carries the *character*, so it
     * follows the keyboard layout and any held modifier; `code` is the physical
     * key and never moves. The legacy "Left"/"Right" names are accepted because
     * some embedded webviews still send them.
     */
    const dirOf = (e: KeyboardEvent): "left" | "right" | null => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "Left" || e.code === "ArrowLeft" || e.code === "KeyA") {
        return "left";
      }
      if (k === "ArrowRight" || k === "Right" || e.code === "ArrowRight" || e.code === "KeyD") {
        return "right";
      }
      return k === "a" || k === "A" ? "left" : k === "d" || k === "D" ? "right" : null;
    };

    const onDown = (e: KeyboardEvent) => {
      const dir = dirOf(e);
      if (!dir) return;
      // The play area owns these while it is up, or the page scrolls out from
      // under the overlay every time you move.
      e.preventDefault();
      const w = world.current;
      if (dir === "left") w.keyLeft = true;
      else w.keyRight = true;
      // A key beats a stale pointer position, or the tray stays pinned where
      // the mouse last left it and the keys look dead.
      w.pointer = null;
    };

    const onUp = (e: KeyboardEvent) => {
      const dir = dirOf(e);
      if (!dir) return;
      const w = world.current;
      if (dir === "left") w.keyLeft = false;
      else w.keyRight = false;
    };

    // Capture phase: a focused button inside the overlay would otherwise eat
    // the arrow keys before they reached the window.
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, []);

  const trackPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      world.current.pointer = ((e.clientX - rect.left) / rect.width) * W;
    },
    [],
  );

  // --- loop ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = world.current;

      const m = modsRef.current;
      const steer = (w.keyRight ? 1 : 0) - (w.keyLeft ? 1 : 0);
      if (w.pointer !== null) {
        w.cup = w.pointer;
      } else if (steer !== 0) {
        w.cup += steer * CUP_SPEED * dt;
      } else if (m.autoSpeed > 0) {
        // Only ever drifts when the player has let go, and never faster than
        // they could move themselves — it is a steady hand, not an autopilot.
        let best: Coin | null = null;
        for (const c of w.coins) if (!best || c.y > best.y) best = c;
        if (best) {
          const gap = best.x - w.cup;
          const step = Math.min(Math.abs(gap), m.autoSpeed * dt);
          w.cup += Math.sign(gap) * step;
        }
      }
      const moved = w.cup;
      w.cup = Math.max(m.cupW / 2, Math.min(W - m.cupW / 2, w.cup));
      // Smoothed so the cup does not snap upright the instant a key is
      // released. Cosmetic only — see drawCup.
      const velocity = dt > 0 ? (w.cup - moved) / dt : 0;
      w.lean += (velocity / CUP_SPEED - w.lean) * Math.min(1, dt * 9);

      w.nextSpawn -= dt * 1000;
      if (w.nextSpawn <= 0) {
        w.nextSpawn = SPAWN_GAP * (0.7 + Math.random() * 0.6);
        const drop = () =>
          w.coins.push({
            x: BILL_HW + Math.random() * (W - BILL_HW * 2),
            y: -COIN_R,
            v: rollCoin(m.weights),
            vy: FALL_SPEED + Math.random() * FALL_JITTER,
            spin: Math.random() * Math.PI * 2,
            spinRate: (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 3.4),
          });
        drop();
        // Pairs land at once rather than being metered out one at a time, so
        // there are real choices about which one to go for.
        if (Math.random() < SPAWN_DOUBLE) drop();
      }

      for (let i = w.coins.length - 1; i >= 0; i--) {
        const c = w.coins[i];
        c.y += c.vy * dt;
        c.spin += c.spinRate * dt;
        const bill = c.v >= CHANGE_BILL_FROM;
        const hw = bill ? BILL_HW : COIN_R;
        const hh = bill ? BILL_HH : COIN_R;
        // Caught at the mouth only. Matching the whole body would let a drop
        // land halfway down the side of the cup and still count.
        const inCup =
          c.y + hh >= CUP_Y - CUP_MOUTH_RY &&
          c.y - hh <= CUP_Y + CUP_MOUTH_RY * 2 &&
          Math.abs(c.x - w.cup) <= m.cupW / 2 + hw * 0.5;
        if (inCup) {
          w.coins.splice(i, 1);
          totalRef.current += c.v;
          setTotal(totalRef.current);
          setCaught((n) => n + 1);
          // A little sparkle at the mouth, so a catch registers even when you
          // are watching the next drop rather than the total.
          if (!prefersReducedMotion()) {
            for (let n = 0; n < 6; n++) {
              w.flecks.push({
                x: c.x,
                y: CUP_Y,
                vx: (Math.random() - 0.5) * 90,
                vy: -40 - Math.random() * 90,
                life: 1,
              });
            }
          }
        } else if (c.y - hh > H) {
          // Missing costs nothing. There is no fail state here at all.
          w.coins.splice(i, 1);
        }
      }

      // --- paint ---
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, "#16211a");
        bg.addColorStop(1, "#0e1712");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        for (const c of w.coins) {
          if (c.v >= CHANGE_BILL_FROM) drawBill(ctx, c.x, c.y, c.v);
          else drawCoin(ctx, c.x, c.y, c.v);
        }

        drawCup(ctx, w.cup, m.cupW);
      }

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  /**
   * Read off the same table the game rolls against, rather than written out by
   * hand — a hand-kept odds list is wrong the first time anyone touches the
   * weights, and wrong odds are worse than none.
   */
  const odds = useMemo(() => {
    const sum = mods.weights.reduce((a, b) => a + b, 0);
    return CHANGE_DROPS.map((v, i) => ({ v, pct: (mods.weights[i] / sum) * 100 })).sort(
      (a, b) => b.v - a.v,
    );
  }, [mods.weights]);

  // The line is measured against everything in hand, not just what has been
  // scooped up this round — a player who came in with most of a stake does not
  // have to earn the whole thing again.
  const inHand = chips * 100 + total;
  const armed = inHand >= CHANGE_MIN_TAKE;
  const payout = changePayout(chips, total);
  const toGo = Math.max(0, CHANGE_MIN_TAKE - inHand);

  return (
    <div className="overlay">
      <div className="overlay-inner change">
        <h2>Loose Change</h2>
        <p className="muted change-help">
          Somebody knocked over a rack. Scoop it up with <b>A</b>/<b>D</b> or the arrow keys —
          drag works too. Nothing is lost if you miss one, and you keep whatever you scoop
          up — once you are holding <b>{dollars(CHANGE_MIN_TAKE)}</b> all in, what you came
          with plus what you catch, you can stop whenever you like.
        </p>

        <div className="change-hud">
          <span>
            Caught <b>{caught}</b>
          </span>
          <span className={armed ? "win" : "muted"}>
            {armed ? "Yours to take · stop whenever" : `${dollars(toGo)} to go`}
          </span>
          <span className="change-total">
            <b>{dollars(total)}</b>
          </span>
        </div>

        <div className="change-stage">
          <canvas
            ref={canvasRef}
            className="change-canvas"
            onPointerDown={trackPointer}
            onPointerMove={(e) => e.buttons && trackPointer(e)}
            onPointerLeave={() => (world.current.pointer = null)}
          />
          {/* Laid over the play area rather than added below it: the panel is
              tall, and pushing the canvas down mid-round moves the cup out from
              under the player's hand. Nothing is lost while it is open — the
              round cannot be failed. */}
          {showOdds && (
            <div className="odds-panel">
              <div className="odds-grid">
                {odds.map(({ v, pct }) => (
                  <span key={v} className={v >= CHANGE_BILL_FROM ? "odds-row bill" : "odds-row"}>
                    <b>{v >= 100 ? `$${v / 100}` : `${v}\u00a2`}</b>
                    <span>{pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {armed ? (
          <p className="change-verdict safe">
            {dollars(total)} in change — {payout > 0 ? `${money(payout)} the moment you stop` : "you are already good for a stake"}.
          </p>
        ) : (
          <p className="muted">{dollars(toGo)} more before you can walk away with it.</p>
        )}

        <div className="change-actions">
          <button
            type="button"
            className="odds-toggle"
            onClick={() => setShowOdds((v) => !v)}
          >
            {showOdds ? "Hide drop chances" : "Drop chances"}
          </button>
          <button
            type="button"
            className="spin"
            disabled={!armed}
            onClick={() => settledRef.current(total)}
          >
            {!armed
              ? `${dollars(toGo)} to go`
              : payout > 0
                ? `Stop — take ${money(payout)}`
                : "Leave the floor"}
          </button>
        </div>
      </div>
    </div>
  );
}
