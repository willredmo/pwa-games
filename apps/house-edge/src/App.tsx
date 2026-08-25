import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCountUp } from "./ui/useCountUp";
import { winTier } from "./ui/celebration";
import { Rules } from "./ui/Rules";
import type { SpinResult } from "./engine";
import { colorOf } from "./engine";
import { Wheel } from "./ui/Wheel";
import { BetLayout } from "./ui/BetLayout";
import { Shop } from "./ui/Shop";
import { Prestige, RelicOffer } from "./ui/Prestige";
import { LooseChange } from "./ui/LooseChange";
import { fmtDuration, money } from "./game/format";
import { changeMods, unlockedDenoms } from "./game/upgrades";
import {
  applyReturn,
  commitStake,
  autoUnlocked,
  buyUpgrade,
  canSpin,
  cashOut,
  catchUp,
  outsideHeat,
  pocketHeat,
  clearSave,
  edgeOf,
  equipRelic,
  initialState,
  intervalOf,
  load,
  maxLayout,
  MIN_CHIP,
  rollSpin,
  scaleLayout,
  save,
  settleChange,
  stakeOf,
  takeRelic,
  unequipRelic,
  type CatchUpReport,
  type GameState,
  type Layout,
} from "./game/state";
import "./App.css";

/** A hand-thrown ball gets long enough for the physics to actually read. */
const MANUAL_SPIN_MS = 5000;
/** Auto-spin keeps the ball inside its own cadence, however fast that gets. */
const MAX_AUTO_SPIN_MS = 2_200;
const SAVE_EVERY_MS = 1000;
/**
 * Playback rates for watching the physics. The ball's flight is the same
 * throw at every setting — `planSpin` is handed a longer duration and solves
 * for a slower launch, so the landing pocket is unaffected.
 */
const SPEEDS = [2, 1, 0.5, 0.25, 0.1] as const;
/**
 * Testing scaffolding: hand yourself cash to reach a part of the curve without
 * playing to it. `peak` is raised alongside so granted money cannot *lower* the
 * Ivory a cash-out would pay, but note that it does inflate prestige — these
 * buttons are not a balanced income source and are not meant to survive.
 */
const DEV_GRANTS = [1_000, 100_000] as const;

type Tab = "table" | "shop" | "relics";

export default function App() {
  const [state, setState] = useState<GameState>(load);
  const [tab, setTab] = useState<Tab>("table");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [pending, setPending] = useState<SpinResult | null>(null);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [report, setReport] = useState<CatchUpReport | null>(null);
  const [speed, setSpeed] = useState<number>(1);
  // Deliberately not part of GameState: which screen is open is not progress,
  // and persisting it would reopen the rules on every reload.
  const [rulesOpen, setRulesOpen] = useState(false);

  const resetEverything = useCallback(() => {
    if (!confirm("Wipe everything — cash, ivory and relics?")) return;
    clearSave();
    setResult(null);
    setState(initialState());
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingRef = useRef<SpinResult | null>(null);

  const runCatchUp = useCallback(() => {
    if (pendingRef.current) return;
    const { state: next, report: r } = catchUp(stateRef.current, Date.now(), Math.random);
    setState(next);
    if (r && r.spins > 0) setReport(r);
  }, []);

  // --- persistence --------------------------------------------------------
  // `lastSeen` is only advanced while the game is actually on screen. The
  // moment it goes to the background the clock freezes, and the time since is
  // paid out as offline earnings on return — otherwise a backgrounded tab
  // earns nothing at all, since rAF is suspended and the spin loop stalls.
  useEffect(() => {
    const stamp = (s: GameState) => ({ ...s, lastSeen: Date.now() });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") stateRef.current = stamp(stateRef.current);
      save(stateRef.current);
    }, SAVE_EVERY_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stateRef.current = stamp(stateRef.current);
        save(stateRef.current);
      } else {
        runCatchUp();
      }
    };
    const flush = () => save(stamp(stateRef.current));

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [runCatchUp]);

  // --- offline catch-up, exactly once ------------------------------------
  const caughtUp = useRef(false);
  useEffect(() => {
    if (caughtUp.current) return;
    caughtUp.current = true;
    runCatchUp();
  }, [runCatchUp]);

  // --- spinning -----------------------------------------------------------
  const doSpin = useCallback(() => {
    if (pendingRef.current) return;
    const rolled = rollSpin(stateRef.current, Math.random);
    if (!rolled) return;
    pendingRef.current = rolled;
    setPending(rolled);
    setSpinKey((k) => k + 1);
    // Stake leaves the bankroll on launch; the payout lands with the ball.
    setState((s) => commitStake(s, rolled));
  }, []);

  const onSettled = useCallback(() => {
    const settled = pendingRef.current;
    if (!settled) return;
    pendingRef.current = null;
    setPending(null);
    setResult(settled);
    // Applied functionally, so an upgrade bought mid-animation is not clobbered.
    setState((s) => applyReturn(s, settled));
  }, []);

  const doSpinRef = useRef(doSpin);
  doSpinRef.current = doSpin;

  const interval = intervalOf(state);
  const auto = state.autoOn && autoUnlocked(state);

  useEffect(() => {
    if (!auto) return;
    let cancelled = false;
    let timer = 0;
    const loop = () => {
      if (cancelled) return;
      doSpinRef.current();
      timer = window.setTimeout(loop, intervalOf(stateRef.current));
    };
    timer = window.setTimeout(loop, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [auto]);

  /**
   * Space spins. Scoped to the Table tab so it cannot fight the browser's own
   * use of space for activating a focused control — on the Shop and Cash Out
   * tabs the buttons are the point, and stealing space there would break
   * keyboard buying. On the Table tab space always means spin, whatever
   * happens to hold focus, so clicking a bet cell and then pressing space does
   * not silently place another bet instead.
   *
   * `preventDefault` is doing two jobs: stopping the page scrolling, and
   * stopping a focused Spin button from firing its own click on top of this
   * handler.
   */
  useEffect(() => {
    if (tab !== "table" || state.miniGame || state.offer || rulesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      // A held key would otherwise queue a spin per repeat.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      doSpinRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, state.miniGame, state.offer, rulesOpen]);

  // --- betting ------------------------------------------------------------
  /**
   * Which of ½ / ×2 / Max would actually change anything. All three refuse in
   * ordinary situations — ½ of a minimum bet is still a minimum bet, ×2 past
   * the bankroll is refused rather than clamped — and a button that silently
   * declines is indistinguishable from a broken one.
   */
  const scaleOptions = useMemo(() => {
    const same = (a: Layout, b: Layout) => {
      const ka = Object.keys(a);
      return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
    };
    return (
      [
        ["\u00bd", (s: GameState) => scaleLayout(s, 0.5)],
        ["\u00d72", (s: GameState) => scaleLayout(s, 2)],
        ["Max", (s: GameState) => maxLayout(s)],
      ] as const
    ).map(([label, apply]) => ({ label, apply, noop: same(state.layout, apply(state).layout) }));
  }, [state]);

  const denoms = useMemo(() => unlockedDenoms(state.upgrades), [state.upgrades]);
  const chipIndex = Math.min(state.chipIndex, denoms.length - 1);
  const denom = denoms[chipIndex];
  const stake = stakeOf(state);
  const betsLocked = pending !== null;

  const place = useCallback(
    (id: string) => {
      setState((s) => {
        if (stakeOf(s) + denom > s.chips) return s;
        return { ...s, layout: { ...s.layout, [id]: (s.layout[id] ?? 0) + denom } };
      });
    },
    [denom],
  );

  const remove = useCallback(
    (id: string) => {
      setState((s) => {
        const current = s.layout[id] ?? 0;
        if (current <= 0) return s;
        const layout = { ...s.layout };
        const next = current - denom;
        if (next > 0) layout[id] = next;
        else delete layout[id];
        return { ...s, layout };
      });
    },
    [denom],
  );

  const edge = edgeOf(state);
  const netClass = result ? (result.net > 0 ? "win" : result.net < 0 ? "loss" : "") : "";
  // The roll-up has to finish inside one spin, or at high Croupier's Haste the
  // figure would be permanently chasing a bankroll it never catches. Auto-spin
  // at max haste lands every ~200ms, so the roll-up gets most of that and no
  // more. Display only — `state.chips` is already correct underneath.
  const rollMs = auto ? Math.min(450, interval * 0.5) : 450;
  const shownChips = useCountUp(state.chips, rollMs);
  // Judged against the stake, not the amount — see ui/celebration.ts.
  //
  // Two tiers, because they are wanted at two different moments. The wheel's
  // celebration fires the instant the ball stops, which is *before* `result`
  // has been set — reading it there decorated every win with the previous
  // spin's tier, one spin permanently behind. `pending` is the spin in the air
  // and already knows what it paid.
  //
  // The readout is the opposite case: while a spin is in flight it shows "No
  // more bets…", so it has to drop the old tier rather than keep glowing gold
  // over the next throw.
  const wheelTier = pending
    ? winTier(pending.net, pending.stake)
    : result
      ? winTier(result.net, result.stake)
      : 0;
  const readoutTier = !pending && result ? winTier(result.net, result.stake) : 0;
  // Recomputed only when the tally actually changes, not on every render — it
  // walks all 37 pockets and the table re-renders on every chip placed.
  const heat = useMemo(() => pocketHeat(state.pocketCounts), [state.pocketCounts]);
  const outHeat = useMemo(() => outsideHeat(state.pocketCounts), [state.pocketCounts]);

  return (
    <div className="app">
      <header className="hud">
        <div className="stat">
          <span className="stat-label">Cash</span>
          <b>{money(shownChips)}</b>
        </div>
        <div className="stat">
          <span className="stat-label">Stake</span>
          <b className={stake > state.chips ? "loss" : ""}>{money(stake)}</b>
        </div>
        <div className="stat">
          <span className="stat-label">Ivory</span>
          <b>{state.ivory}</b>
        </div>
        <div className="stat">
          <span className="stat-label">Payout</span>
          <b>×{edge.payoutMult.toFixed(2)}</b>
        </div>
      </header>

      <nav className="tabs">
        {(["table", "shop", "relics"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "table" ? "Table" : t === "shop" ? "Shop" : "Cash Out"}
            {t === "relics" && state.offer && <span className="pip" />}
          </button>
        ))}
        <button
          type="button"
          className="tab-action"
          title="Loose Change"
          aria-label="Loose Change"
          onClick={() => setState((s) => ({ ...s, miniGame: true }))}
        >
          <span aria-hidden="true">☕</span>
        </button>
        <button
          type="button"
          className="tab-action"
          title="How winnings work"
          aria-label="How winnings work"
          onClick={() => setRulesOpen(true)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </nav>

      <main className="table-view" hidden={tab !== "table"}>
          <div className="wheel-wrap">
            <Wheel
              pockets={pending?.balls ?? result?.balls ?? null}
              winner={pending?.winner ?? result?.winner ?? 0}
              tier={wheelTier}
              spinKey={spinKey}
              durationMs={
                (auto ? Math.min(MAX_AUTO_SPIN_MS, interval * 0.62) : MANUAL_SPIN_MS) / speed
              }
              speed={speed}
              onSettled={onSettled}
            />
          </div>

          <div className="speed-row">
            <span className="speed-label">Speed</span>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`denom scale${speed === s ? " active" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s === 1 ? "1\u00d7" : `${s}\u00d7`}
              </button>
            ))}
            <span className="denom-sep" aria-hidden="true" />
            {/* Testing only. Along with the speed control above, this whole row
                is scaffolding — see the DEV note in CLAUDE.md before shipping. */}
            {DEV_GRANTS.map((amount) => (
              <button
                key={amount}
                type="button"
                className="denom scale"
                title="Testing: add cash"
                onClick={() =>
                  setState((st) => ({
                    ...st,
                    chips: st.chips + amount,
                    peak: Math.max(st.peak, st.chips + amount),
                  }))
                }
              >
                +{money(amount)}
              </button>
            ))}
            <button
              type="button"
              className="denom scale"
              title="Testing: wipe the save"
              onClick={resetEverything}
            >
              Reset
            </button>
          </div>

          <div className={`readout tier-${readoutTier}`} key={spinKey}>
            {pending ? (
              <span className="muted">No more bets…</span>
            ) : result ? (
              <>
                <span className={`pocket ${colorOf(result.pocket)}`}>{result.pocket}</span>
                <b className={netClass}>
                  {result.net >= 0 ? "+" : "−"}
                  {money(Math.abs(result.net))}
                </b>
                {result.magnetised && <span className="tag">nudged</span>}
                {result.doubled && <span className="tag">doubled</span>}
                {result.balls.length > 1 && (
                  // Show every ball, with the paid one picked out. The bare
                  // "+N ball" count said a multi-ball spin happened but not
                  // which pocket the money actually came from, which is the
                  // only part the player needs.
                  <span className="balls" title="Best ball takes the spin">
                    {result.balls.map((p, i) => (
                      <span
                        key={i}
                        className={`ball-chip ${colorOf(p)}${i === result.winner ? " picked" : ""}`}
                      >
                        {p}
                      </span>
                    ))}
                  </span>
                )}
                {state.streak > 1 && (
                  <span className="tag streak">{state.streak}× streak</span>
                )}
              </>
            ) : (
              <span className="muted">Place a bet and spin.</span>
            )}
          </div>

          <div className="history">
            {state.history.map((p, i) => (
              <span key={`${i}-${p}`} className={`dot ${colorOf(p)}`}>
                {p}
              </span>
            ))}
          </div>

          <div className="controls">
            <div className="denoms">
              {denoms.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  className={`denom${i === chipIndex ? " active" : ""}`}
                  disabled={d > state.chips}
                  onClick={() => setState((s) => ({ ...s, chipIndex: i }))}
                >
                  {money(d)}
                </button>
              ))}
              <span className="denom-sep" aria-hidden="true" />
              {/* Updaters take React's previous state, never a ref: an updater
                  that reads a ref is impure and compounds when React invokes
                  it more than once, which silently scales the layout twice. */}
              {scaleOptions.map(({ label, apply, noop }) => (
                <button
                  key={label}
                  type="button"
                  className="denom scale"
                  disabled={betsLocked || stake === 0 || noop}
                  onClick={() => setState(apply)}
                  title={`${label} every bet on the table`}
                >
                  {label}
                </button>
              ))}
              <span className="stake-note">
                Stake <b>{money(stake)}</b>
              </span>
            </div>
            <div className="actions">
              <button
                type="button"
                className="spin"
                disabled={betsLocked || !canSpin(state)}
                onClick={doSpin}
                title="Spin (space)"
              >
                Spin
              </button>
              <button
                type="button"
                className={mode === "remove" ? "active" : ""}
                onClick={() => setMode((m) => (m === "add" ? "remove" : "add"))}
              >
                {mode === "add" ? "Take back" : "Placing"}
              </button>
              <button
                type="button"
                disabled={betsLocked || stake === 0}
                onClick={() => setState((s) => ({ ...s, layout: {} }))}
              >
                Clear
              </button>
              {autoUnlocked(state) && (
                <button
                  type="button"
                  className={auto ? "active" : ""}
                  onClick={() => setState((s) => ({ ...s, autoOn: !s.autoOn }))}
                >
                  Auto {auto ? `· ${(interval / 1000).toFixed(1)}s` : "off"}
                </button>
              )}
            </div>
          </div>

          {!betsLocked && state.chips < MIN_CHIP && (
            <p className="warn">
              Out of cash. Scrape some together with <b>☕ Loose Change</b>.
            </p>
          )}
          {stake === 0 && <p className="warn">Nothing on the table.</p>}
          {stake > state.chips && <p className="warn">Your stake is more than your bankroll.</p>}

          <BetLayout
            layout={state.layout}
            denom={denom}
            disabled={betsLocked}
            last={result?.pocket ?? null}
            heat={heat}
            outHeat={outHeat}
            spinKey={spinKey}
            mode={mode}
            onPlace={place}
            onRemove={remove}
          />
      </main>

      {tab === "shop" && (
        <main>
          <p className="edge-line">
            Payout ×{edge.payoutMult.toFixed(2)} · rebate {(edge.rebate * 100).toFixed(1)}% ·
            nudge {(edge.magnetism * 100).toFixed(0)}% · zero {(edge.zeroInsurance * 100).toFixed(0)}%
            {edge.extraBalls > 0 && ` · ${edge.extraBalls} extra ball`}
          </p>
          <Shop state={state} onBuy={(id) => setState((s) => buyUpgrade(s, id))} />
        </main>
      )}

      {tab === "relics" && (
        <main>
          <Prestige
            state={state}
            onCashOut={() => {
              setResult(null);
              setState((s) => cashOut(s, Math.random));
            }}
            onEquip={(id) => setState((s) => equipRelic(s, id))}
            onUnequip={(id) => setState((s) => unequipRelic(s, id))}
          />
          <button type="button" className="reset" onClick={resetEverything}>
            Reset everything
          </button>
        </main>
      )}

      {state.miniGame && (
        <LooseChange chips={state.chips} mods={changeMods(state.upgrades)} onSettle={(collected) => setState((s) => settleChange(s, collected))} />
      )}

      {rulesOpen && <Rules state={state} onClose={() => setRulesOpen(false)} />}

      {state.offer && (
        <RelicOffer
          offer={state.offer}
          onTake={(id) => setState((s) => takeRelic(s, id))}
        />
      )}

      {report && (
        <div className="overlay" onClick={() => setReport(null)}>
          <div className="overlay-inner">
            <h2>While you were away</h2>
            <p>
              The croupier ran {report.spins.toLocaleString()} spins over{" "}
              {fmtDuration(report.awayMs)}.
            </p>
            <p className={report.net >= 0 ? "win" : "loss"}>
              <b>
                {report.net >= 0 ? "+" : "−"}
                {money(Math.abs(report.net))}
              </b>
            </p>
            {report.brokeEarly && (
              <p className="warn">The table stopped — your bankroll could not cover the stake.</p>
            )}
            <button type="button" className="buy" onClick={() => setReport(null)}>
              Back to the table
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
