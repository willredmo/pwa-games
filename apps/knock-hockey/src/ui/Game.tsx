import { useCallback, useEffect, useRef, useState } from "react";
import { DIFFICULTY_LABEL } from "../ai/cpu";
import { thinkShot } from "../ai/client";
import {
  applyShot,
  controllerOf,
  other,
  playerName,
  saveMatch,
  TARGET,
  WIN_BY,
  type MatchState,
  type Player,
  type Settings,
  type ShotOutcome,
  type ShotReport,
} from "../game/match";
import { CPU_LOOKS, defaultLook, type StickLook } from "../game/stick";
import { horn } from "../game/sound";
import { CENTER } from "../physics/table";
import { MIN_POWER, Table, capture, type Controller, type Launch } from "../render/table";
import {
  fixMatch,
  leaveRoom,
  rematch,
  saveSession,
  sendAim,
  sendLook,
  sendResult,
  sendShot,
  stayPresent,
  watchRoom,
  type AimMsg,
  type ResultMsg,
  type Session,
  type ShotMsg,
} from "../online/room";
import type { Looks } from "../App";
import { PowerBar } from "./PowerBar";
import { MenuPanel } from "./MenuPanel";
import { EndScreen } from "./EndScreen";
import { Replays } from "./Replays";

// One match: vs the CPU, two people passing one device, or two devices
// online. The Table (render/table.ts) runs the canvas; this component runs
// the turn loop: hand the stick to whoever's up, apply each finished shot to
// the match, celebrate goals, and save after every shot.
//
// Online (see online/room.ts): your shots are sent as you take them and their
// outcome once the puck stops; the opponent's arrive the same way and are
// replayed on the table. Their result is the final word on their shot.

/** Pause after a goal before the puck goes back to centre ice. */
const GOAL_PAUSE_MS = 1700;
/** Pause between turns when nobody scored. */
const TURN_GAP_MS = 280;
/** The CPU always "thinks" at least this long, so its turn doesn't feel instant. */
const MIN_THINK_MS = { easy: 450, medium: 650, hard: 900 } as const;
/**
 * Holding an aim button or arrow key: a tap moves `tap`; holding (after
 * HOLD_DELAY_S) moves continuously at a rate rising from `start` by `ramp`
 * per second, up to `max`. Aim is in degrees, power in 0–1 per second.
 */
const HOLD_DELAY_S = 0.18;
const HOLD = {
  aim: { tap: 0.25, start: 20, ramp: 160, max: 150 },
  power: { tap: 0.02, start: 0.2, ramp: 1.2, max: 0.8 },
} as const;
/** How often your aim is sent to an online opponent while you line up. */
const AIM_SEND_MS = 90;
/** If an opponent's result hasn't arrived this long after their puck stopped, use ours. */
const RESULT_WAIT_MS = 5000;

interface Banner {
  text: string;
  sub?: string;
  /** Colour: the scorer's. */
  kind: Player;
  key: number;
}

export interface GameProps {
  initial: MatchState;
  settings: Settings;
  onSettings: (f: (s: Settings) => Settings) => void;
  looks: Looks;
  /** Set for an online match. */
  online?: Session;
  /** Online: the room started a new match (a rematch). */
  onRoomMatch?: (m: MatchState) => void;
  onLocker: () => void;
  onHelp: () => void;
  onRematch: () => void;
  onExit: () => void;
}

export function Game(props: GameProps) {
  const { initial, settings, online } = props;
  const mode = initial.mode;
  const pvp = mode === "pvp";
  const me = online?.me;
  /** "You", vs the CPU or online. */
  const you: Player | null = pvp ? null : (me ?? "p1");
  const oppName = mode === "online" ? "Opponent" : "CPU";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tableRef = useRef<Table | null>(null);
  const matchRef = useRef(initial);
  /** Bumped on unmount and new turns, so a late CPU answer is ignored. */
  const turnRef = useRef(0);
  const [match, setMatch] = useState(initial);
  const [power, setPower] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [oppLook, setOppLook] = useState<StickLook | null>(null);
  const [oppOnline, setOppOnline] = useState(true);
  const [oppLeft, setOppLeft] = useState(false);
  /** Goal replays open, at this goal. */
  const [replay, setReplay] = useState<number | null>(null);

  // Online bookkeeping, in a ref so the table's callbacks always see the latest.
  const remote = useRef({
    /** The shot number we're waiting on from the opponent (their turn has begun here). */
    awaiting: 0,
    /** Their shot, if it arrived before their turn began here. */
    pendingShot: null as ShotMsg | null,
    /** Replaying their shot (line-up through the puck stopping). */
    rolling: false,
    pendingResult: null as ResultMsg | null,
    /** What our replay of their shot came to: the fallback if their result never comes. */
    localOut: null as ShotOutcome | null,
    fallback: 0,
  });

  const looks = useCallback((): Record<Player, StickLook> => {
    if (mode === "pvp") return { p1: props.looks.p1, p2: props.looks.p2 };
    if (mode === "cpu") return { p1: props.looks.p1, p2: CPU_LOOKS[initial.difficulty] };
    // Online: your Player 1 stick is yours whichever side you're on.
    const mine = me ?? "p1";
    const theirs = other(mine);
    return { [mine]: props.looks.p1, [theirs]: oppLook ?? defaultLook(theirs) } as Record<Player, StickLook>;
  }, [mode, props.looks, initial.difficulty, me, oppLook]);

  const playRemoteShot = useCallback((s: ShotMsg) => {
    const r = remote.current;
    r.pendingShot = null;
    r.awaiting = 0;
    r.rolling = true;
    setBusy(true);
    tableRef.current?.playRemote(s);
  }, []);

  const startTurn = useCallback(
    (m: MatchState) => {
      const table = tableRef.current;
      if (!table) return;
      const token = ++turnRef.current;
      if (m.winner) {
        table.idle();
        return;
      }
      setBusy(false);
      const c = controllerOf(m, m.turn, me);
      table.beginTurn(m.turn, c);
      if (c === "remote") {
        const r = remote.current;
        r.awaiting = m.shots + 1;
        // Their shot may already be here (sent while we were celebrating).
        if (r.pendingShot?.seq === r.awaiting) playRemoteShot(r.pendingShot);
        return;
      }
      if (c !== "cpu") return;
      setThinking(true);
      const t0 = performance.now();
      void thinkShot(m.puck, { difficulty: m.difficulty, attacksTop: false }).then((shot) => {
        const wait = Math.max(0, MIN_THINK_MS[m.difficulty] - (performance.now() - t0));
        window.setTimeout(() => {
          if (turnRef.current !== token) return;
          setThinking(false);
          tableRef.current?.playCpu(shot);
        }, wait);
      });
    },
    [me, playRemoteShot],
  );

  /** Show a finished shot's outcome and move to the next turn. */
  const finishShot = useCallback(
    (report: ShotReport) => {
      const m = report.state;
      matchRef.current = m;
      setMatch(m);
      saveMatch(m);
      setBusy(true);
      if (!report.scorer) {
        window.setTimeout(() => startTurn(m), TURN_GAP_MS);
        return;
      }
      const scorer = report.scorer;
      const offender = other(scorer);
      const name = (p: Player) => playerName(m, p, me);
      // Happy horn for your goals (and for everyone's, passing one device).
      horn(pvp || scorer === you);
      setBanner({
        text: report.ownGoal ? "Own goal!" : pvp ? `${name(scorer)} scores!` : scorer === you ? "GOAL!" : `${oppName} scores`,
        sub: report.ownGoal
          ? pvp
            ? `${name(offender)} put it in their own net`
            : offender === you
              ? "Off your stick into your own net"
              : `The ${oppName === "CPU" ? "CPU" : "opponent"} knocked it into their own net`
          : report.corner
            ? "Off the corner"
            : report.bank
              ? "Bank shot"
              : undefined,
        kind: scorer,
        key: Date.now(),
      });
      const token = ++turnRef.current;
      window.setTimeout(() => {
        if (turnRef.current !== token) return;
        setBanner(null);
        if (m.winner) {
          tableRef.current?.idle();
          return;
        }
        tableRef.current?.placePuck(CENTER);
        startTurn(m);
      }, GOAL_PAUSE_MS);
    },
    [startTurn, pvp, you, me, oppName],
  );

  /** Apply the opponent's shot once their result is in and our replay has finished. */
  const tryRemoteResult = useCallback(() => {
    const r = remote.current;
    if (!r.pendingResult || r.rolling) return;
    const res = r.pendingResult;
    r.pendingResult = null;
    r.localOut = null;
    r.awaiting = 0;
    window.clearTimeout(r.fallback);
    const state = fixMatch(res.match);
    // Their device has the final word on where the puck ended up.
    if (!res.scorer) tableRef.current?.placePuck(state.puck);
    finishShot({ state, scorer: res.scorer ?? null, ownGoal: !!res.ownGoal, bank: !!res.bank, corner: !!res.corner });
  }, [finishShot]);

  const onShot = useCallback(
    (out: ShotOutcome) => {
      const r = remote.current;
      if (r.rolling) {
        // Our replay of their shot finished. Wait for their result; if it never
        // comes (they dropped mid-shot), our own replay stands in for it.
        r.rolling = false;
        r.localOut = out;
        tryRemoteResult();
        if (r.localOut && online) {
          const before = matchRef.current;
          r.fallback = window.setTimeout(() => {
            if (!r.localOut || matchRef.current !== before) return;
            const report = applyShot(before, r.localOut);
            r.localOut = null;
            void sendResult(online, toResult(report));
            finishShot(report);
          }, RESULT_WAIT_MS);
        }
        return;
      }
      const report = applyShot(matchRef.current, out);
      if (online) void sendResult(online, toResult(report));
      finishShot(report);
    },
    [finishShot, tryRemoteResult, online],
  );

  const onFire = useCallback(
    (l: Launch, by: Controller) => {
      setBusy(true);
      if (online && by === "local") void sendShot(online, { ...l, seq: matchRef.current.shots + 1, by: online.me });
    },
    [online],
  );

  // Your aim, sent to an online opponent a few times a second.
  const aimSent = useRef({ at: 0, timer: 0, latest: null as AimMsg | null });
  const onAim = useCallback(
    (angle: number, power: number) => {
      if (!online) return;
      const a = aimSent.current;
      a.latest = { by: online.me, angle, power };
      if (a.timer) return;
      const wait = Math.max(0, AIM_SEND_MS - (performance.now() - a.at));
      a.timer = window.setTimeout(() => {
        a.timer = 0;
        a.at = performance.now();
        if (a.latest) void sendAim(online, a.latest);
      }, wait);
    },
    [online],
  );

  // The table lives as long as this match. Its callbacks go through a ref so
  // they always reach this render's handlers.
  const handlers = useRef({ onShot, onFire, onAim });
  handlers.current = { onShot, onFire, onAim };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const table = new Table(
      canvas,
      {
        onPull: setPower,
        onFire: (l, by) => handlers.current.onFire(l, by),
        onShot: (o) => handlers.current.onShot(o),
        onAim: online ? (a, p) => handlers.current.onAim(a, p) : undefined,
      },
      matchRef.current.puck,
      looks(),
    );
    // The online guest sees the board turned round, so their goal is at the bottom.
    table.flipped = me === "p2";
    table.aimLine = settings.aimLine;
    tableRef.current = table;
    startTurn(matchRef.current);
    return () => {
      turnRef.current++;
      window.clearTimeout(remote.current.fallback);
      table.destroy();
      tableRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => tableRef.current?.setLooks(looks()), [looks]);
  useEffect(() => {
    if (tableRef.current) tableRef.current.aimLine = settings.aimLine;
  }, [settings.aimLine]);

  // --- Online: follow the room ----------------------------------------------
  useEffect(() => {
    if (!online) return;
    const r = remote.current;
    const theirs = other(online.me);
    const offs = [
      stayPresent(online),
      watchRoom<ShotMsg>(online, "shot", (s) => {
        if (!s || s.by !== theirs || s.seq !== matchRef.current.shots + 1) return;
        if (r.rolling || r.pendingShot?.seq === s.seq) return; // already have it
        if (r.awaiting === s.seq) playRemoteShot(s);
        else r.pendingShot = s; // their turn hasn't started here yet
      }),
      watchRoom<ResultMsg>(online, "result", (res) => {
        if (!res || res.seq !== matchRef.current.shots + 1 || res.match?.startedAt !== matchRef.current.startedAt) return;
        r.pendingResult = res;
        tryRemoteResult();
      }),
      watchRoom<AimMsg>(online, "aim", (a) => {
        if (a && a.by === theirs && matchRef.current.turn === theirs) tableRef.current?.setRemoteAim(a.angle, a.power);
      }),
      watchRoom<Partial<Record<Player, boolean>>>(online, "presence", (p) => setOppOnline(!!p?.[theirs])),
      watchRoom<Partial<Record<Player, StickLook>>>(online, "looks", (l) => setOppLook(l?.[theirs] ?? null)),
      watchRoom<Player>(online, "left", (who) => setOppLeft(who === theirs)),
      watchRoom<MatchState>(online, "match", (m) => {
        // A rematch started (by either of us).
        if (m && m.startedAt !== matchRef.current.startedAt && !m.winner && m.shots === 0) props.onRoomMatch?.(fixMatch(m));
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.code, online?.me]);

  // Your stick (from the Locker) is what the opponent sees.
  useEffect(() => {
    if (online) void sendLook(online, props.looks.p1);
  }, [online, props.looks.p1]);

  const c = match.winner ? null : controllerOf(match, match.turn, me);
  /** A person on this device is up and can shoot. */
  const yourTurn = c === "local" && !busy && !banner;
  const watching = (c === "cpu" || c === "remote") && !busy && !banner;
  const status =
    match.winner || banner ? "" : busy ? "…" : thinking ? "CPU is lining up…" : c === "cpu" ? "CPU's shot" : c === "remote" ? "Opponent's shot" : "";

  // Aiming: the ↺ ↻ buttons (or ← → keys) are the only way to turn the stick.
  // A tap turns a fine 0.25°; holding turns continuously, speeding up from
  // TURN_START to TURN_MAX degrees a second, so a big swing is quick and a
  // small correction is still easy. ↑ ↓ change the power the same way.
  type HoldKind = "aim" | "power";
  const holds = useRef<Partial<Record<HoldKind, number>>>({});
  const startHold = (kind: HoldKind, dir: -1 | 1) => {
    if (holds.current[kind]) return;
    const rate = HOLD[kind];
    const apply = (amount: number) => {
      const table = tableRef.current;
      if (!table) return;
      if (kind === "aim") table.nudge(dir * amount);
      else table.addPower(dir * amount);
    };
    apply(rate.tap);
    const t0 = performance.now();
    let last = t0;
    holds.current[kind] = window.setInterval(() => {
      const t = performance.now();
      const held = (t - t0) / 1000 - HOLD_DELAY_S;
      const dt = (t - last) / 1000;
      last = t;
      if (held > 0) apply(Math.min(rate.max, rate.start + rate.ramp * held) * dt);
    }, 16);
  };
  const stopHold = (kind?: HoldKind) => {
    for (const k of kind ? [kind] : (["aim", "power"] as const)) {
      window.clearInterval(holds.current[k]);
      delete holds.current[k];
    }
  };
  const startTurning = (dir: -1 | 1) => startHold("aim", dir);
  const stopTurning = () => stopHold("aim");
  useEffect(() => () => stopHold(), []);

  // Keyboard: ← → turn, ↑ ↓ change power (hold to keep going), Space hits.
  const keyState = useRef({ yourTurn: false, blocked: false });
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e) || keyState.current.blocked) return;
      if (e.key === " ") {
        // Space shoots (and never "clicks" whichever button has focus).
        e.preventDefault();
        if (!e.repeat && keyState.current.yourTurn) tableRef.current?.hit();
        return;
      }
      const map: Record<string, [HoldKind, -1 | 1]> = {
        ArrowLeft: ["aim", -1],
        ArrowRight: ["aim", 1],
        ArrowUp: ["power", 1],
        ArrowDown: ["power", -1],
      };
      const m = map[e.key];
      if (!m) return;
      e.preventDefault();
      if (!e.repeat && keyState.current.yourTurn) startHold(m[0], m[1]);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") e.preventDefault();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") stopHold("aim");
      if (e.key === "ArrowUp" || e.key === "ArrowDown") stopHold("power");
    };
    const blur = () => stopHold();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Stop turning when the turn ends mid-hold.
  useEffect(() => {
    if (!yourTurn) stopHold();
  }, [yourTurn]);
  // Keys only act on your turn, and not under the menu or end screen.
  keyState.current = { yourTurn, blocked: menu || !!match.winner || replay !== null };

  /** Leave the match: online, for good (the opponent is told); otherwise the save is dropped. */
  const leave = () => {
    if (online) {
      void leaveRoom(online);
      saveSession(null);
    } else saveMatch(null);
    props.onExit();
  };

  const nm = (p: Player) => playerName(match, p, me);
  return (
    <div className="game">
      <header className="game__head">
        <button className="menu-btn" onClick={() => setMenu(true)} aria-label="Menu">
          ☰
        </button>
        <div className="scoreboard" aria-label={`${nm("p1")} ${match.score.p1}, ${nm("p2")} ${match.score.p2}`}>
          <span className={`scoreboard__side scoreboard__side--p1${match.turn === "p1" && !match.winner ? " scoreboard__side--up" : ""}`}>
            <span className="scoreboard__name">{nm("p1")}</span>
            <span className="scoreboard__num" key={`p1-${match.score.p1}`}>
              {match.score.p1}
            </span>
          </span>
          {matchPoint(match) ? (
            <span className="scoreboard__to scoreboard__to--hot">{matchPoint(match)}</span>
          ) : (
            <span className="scoreboard__to">
              to {TARGET} · win by {WIN_BY}
            </span>
          )}
          <span className={`scoreboard__side scoreboard__side--p2${match.turn === "p2" && !match.winner ? " scoreboard__side--up" : ""}`}>
            <span className="scoreboard__num" key={`p2-${match.score.p2}`}>
              {match.score.p2}
            </span>
            <span className="scoreboard__name">{mode === "cpu" ? `CPU · ${DIFFICULTY_LABEL[match.difficulty]}` : nm("p2")}</span>
          </span>
        </div>
      </header>

      <div className="game__stage">
        <div className="game__board">
          <canvas ref={canvasRef} className="game__canvas" />
          {banner && (
            <div className={`goal-banner goal-banner--${banner.kind}`} key={banner.key}>
              <strong>{banner.text}</strong>
              {banner.sub && <span>{banner.sub}</span>}
            </div>
          )}
          {online && (oppLeft || !oppOnline) && !match.winner && (
            <div className="net-pill" role="status">
              <span>{oppLeft ? "Your opponent left the game" : "Opponent disconnected — waiting for them…"}</span>
              {oppLeft && (
                <button className="link-btn" onClick={leave}>
                  Leave
                </button>
              )}
            </div>
          )}
        </div>
        <PowerBar power={power} active={yourTurn} cpu={watching} onPull={(p) => tableRef.current?.barPull(p)} />
      </div>

      <footer className="game__foot">
        <button
          className="nudge-btn"
          aria-label="Turn aim left"
          disabled={!yourTurn}
          onPointerDown={(e) => {
            capture(e.currentTarget, e.pointerId);
            startTurning(-1);
          }}
          onPointerUp={stopTurning}
          onPointerCancel={stopTurning}
          onLostPointerCapture={stopTurning}
          onContextMenu={(e) => e.preventDefault()}
        >
          ↺
        </button>
        {yourTurn ? (
          <div className={`turn-status turn-status--you turn-status--${match.turn}`}>
            {pvp && <strong className="turn-status__who">{nm(match.turn)}'s shot</strong>}
            <button className={`lock-btn lock-btn--hit lock-btn--${match.turn}`} disabled={power < MIN_POWER} onClick={() => tableRef.current?.hit()}>
              🏒 Hit!
            </button>
            <small>{power < MIN_POWER ? "Drag back on the board to aim and set power" : "Drag again to adjust, or hit"}</small>
          </div>
        ) : (
          <div className="turn-status">
            <strong>{status}</strong>
          </div>
        )}
        <button
          className="nudge-btn"
          aria-label="Turn aim right"
          disabled={!yourTurn}
          onPointerDown={(e) => {
            capture(e.currentTarget, e.pointerId);
            startTurning(1);
          }}
          onPointerUp={stopTurning}
          onPointerCancel={stopTurning}
          onLostPointerCapture={stopTurning}
          onContextMenu={(e) => e.preventDefault()}
        >
          ↻
        </button>
      </footer>

      {menu && (
        <MenuPanel
          onClose={() => setMenu(false)}
          onHelp={() => {
            setMenu(false);
            props.onHelp();
          }}
          onLocker={() => {
            setMenu(false);
            props.onLocker();
          }}
          onNewMatch={leave}
          goalCount={match.goals?.length ?? 0}
          onReplays={() => {
            setMenu(false);
            setReplay(0);
          }}
          online={!!online}
          opponentLabel={
            mode === "pvp" ? "2 players · pass and play" : online ? `Online · room ${online.code}` : `CPU · ${DIFFICULTY_LABEL[match.difficulty]}`
          }
          settings={settings}
          onSettings={props.onSettings}
        />
      )}
      {match.winner && !banner && (
        <EndScreen
          match={match}
          me={me}
          onReplays={() => setReplay(0)}
          onRematch={online ? () => void rematch(online) : props.onRematch}
          onExit={online ? leave : props.onExit}
        />
      )}
      {replay !== null && <Replays match={match} looks={looks()} me={me} start={replay} onClose={() => setReplay(null)} />}
    </div>
  );
}

/** Near the end: "Game point" when the next goal could win, "Win by 2" when level past it. */
function matchPoint(m: MatchState): string | null {
  if (m.winner) return null;
  const { p1, p2 } = m.score;
  const could = (a: number, b: number) => a + 1 >= TARGET && a + 1 - b >= WIN_BY;
  if (could(p1, p2) || could(p2, p1)) return "Game point";
  if (p1 === p2 && p1 >= TARGET - 1) return `Win by ${WIN_BY}`;
  return null;
}

function toResult(r: ShotReport): ResultMsg {
  const msg: ResultMsg = { seq: r.state.shots, match: r.state };
  // The database can't store undefined; only include what's set.
  if (r.scorer) Object.assign(msg, { scorer: r.scorer, ownGoal: r.ownGoal, bank: r.bank, corner: r.corner });
  return msg;
}
