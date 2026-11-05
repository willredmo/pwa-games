import { useEffect, useRef, useState } from "react";
import { MAX_LEVEL, STARTER, STARTER_UNITS, levelOf, rewardInfo, rewardsAt, type Reward } from "../game/progression";
import { UNITS } from "../engine/units";
import { sfx } from "../game/sound";
import { prefersReducedMotion } from "../board/anim";
import { UnitPortrait } from "./UnitPortrait";
import { claimTo, useProgress, type XpAward } from "../online/progress";

// The progression track: levels 1 to MAX_LEVEL, each unlocking one upgrade,
// unit or battle style, from the title screen's level chip and the result
// screen's XP bar. A guest sees the same track, at level 1, and is told
// progression needs an account. Reached levels are claimed here (Claim, or
// Claim all) before their rewards count; the title's chip badges how many wait.
//
// Motion: the bar runs up from where the player last saw it (`SEEN_KEY`),
// wrapping at each level (`useXpRun`), and claiming reveals each reward on a
// card of its own (`ClaimReveal`), then its level pops in with its ✓ stamped
// on. Transform and opacity only.

/** The XP the track showed the last time it was opened on this device. */
const SEEN_KEY = "duel-deck:xp-seen";

function readSeen(): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return v === null ? null : Number(v) || 0;
  } catch {
    return null;
  }
}

function writeSeen(xp: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(xp));
  } catch {
    // Private mode: the bar just won't animate next time.
  }
}

/** The bar waits this long: a beat after the panel opens, and for the result screen's entrance. */
const XP_PANEL_DELAY_MS = 350;
const XP_RESULT_DELAY_MS = 900;

/** How long the XP run takes, plus a beat for each level it crosses, up to a limit. */
const XP_RUN_MS = 1100;
const XP_RUN_LEVEL_MS = 500;
const XP_RUN_MAX_MS = 3200;

/**
 * Run the shown XP from `from` up to `to` after `delay` ms: the bar fills,
 * and each level crossed flashes it (`ups` counts them) and starts it again
 * from empty. Driven by frame time, so ProMotion phones run it at the same
 * speed; under reduced motion it just lands on `to`.
 */
function useXpRun(from: number, to: number, delay: number) {
  const [xp, setXp] = useState(from);
  const [ups, setUps] = useState(0);
  useEffect(() => {
    if (from >= to) {
      setXp(to);
      return;
    }
    if (prefersReducedMotion()) {
      const t = window.setTimeout(() => setXp(to), delay);
      return () => window.clearTimeout(t);
    }
    const start = levelOf(from).level;
    const ms = Math.min(XP_RUN_MAX_MS, XP_RUN_MS + (levelOf(to).level - start) * XP_RUN_LEVEL_MS);
    let level = start;
    let began = 0;
    let frame = 0;
    const tick = (now: number) => {
      began ||= now;
      const t = Math.min(1, (now - began) / ms);
      const shown = Math.round(from + (to - from) * (1 - (1 - t) ** 3));
      setXp(shown);
      const reached = levelOf(shown).level;
      if (reached > level) {
        level = reached;
        setUps((n) => n + 1);
        sfx("buff");
      }
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    const wait = window.setTimeout(() => (frame = requestAnimationFrame(tick)), delay);
    return () => {
      window.clearTimeout(wait);
      cancelAnimationFrame(frame);
    };
  }, [from, to, delay]);
  return { xp, ups, done: xp >= to };
}

/** A level's progress bar. Scaled, not resized: iOS stutters on width changes. `ups` flashes it on a level up. */
export function XpBar({ into, need, ups = 0 }: { into: number; need: number; ups?: number }) {
  return (
    <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={need || 1} aria-valuenow={need ? into : 1}>
      <div className="xp-bar__fill" style={{ transform: `scaleX(${need > 0 ? Math.min(1, into / need) : 1})` }} />
      {ups > 0 && <span key={ups} className="xp-bar__flash" aria-hidden="true" />}
    </div>
  );
}

/** A reward as a pill: icon and name, its rarity's (or unit's, style's) border. */
export function RewardChip({ reward }: { reward: Reward }) {
  const r = rewardInfo(reward);
  return (
    <span className={`result-upgrade result-upgrade--${r.tone}`} title={r.description}>
      {r.icon} {r.name}
    </span>
  );
}

const KIND_LABEL = { upgrade: "Upgrade", unit: "New unit", style: "Battle style" } as const;

/** A reward on the track: what it is and what it does. */
function RewardCard({ reward }: { reward: Reward }) {
  const r = rewardInfo(reward);
  const tone = reward.kind === "upgrade" ? `${r.tone[0].toUpperCase()}${r.tone.slice(1)} upgrade` : KIND_LABEL[reward.kind];
  return (
    <span className={`reward reward--${r.tone}`}>
      <span className="reward__icon" aria-hidden="true">
        {reward.kind === "unit" ? <UnitPortrait unitKey={reward.id} side="player" size={26} /> : r.icon}
      </span>
      <span className="reward__text">
        <span className="reward__name">
          {r.name} <small className="reward__kind">{tone}</small>
        </span>
        <span className="reward__desc">{r.description}</span>
      </span>
    </span>
  );
}

/** The title screen's chip: the level, how far into it, and a badge while upgrades wait to be claimed. */
export function LevelChip({ onClick }: { onClick: () => void }) {
  const p = useProgress();
  const { into, need } = levelOf(p.xp);
  const label = `Level ${p.level}.${p.newUpgrades ? ` ${p.newUpgrades} new unlock${p.newUpgrades === 1 ? "" : "s"} to claim.` : ""} Open the progression track`;
  return (
    <button className={`title-level${p.newUpgrades ? " title-level--new" : ""}`} onClick={onClick} aria-label={label}>
      {p.newUpgrades > 0 && (
        <span className="title-level__badge" aria-hidden="true">
          {p.newUpgrades}
        </span>
      )}
      <span className="title-level__star" aria-hidden="true">⭐</span>
      <span className="title-level__num">Lv {p.level}</span>
      <span className="title-level__bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${need ? into / need : 1})` }} />
      </span>
    </button>
  );
}

/** The result screen's block: XP earned, the bar filling, anything it unlocked. A guest gets a sign-in nudge. */
export function XpResult({ award, onOpen }: { award: XpAward; onOpen?: () => void }) {
  // After the panel's own entrance. Seen here, so the track doesn't run it again.
  const run = useXpRun(award.counts ? award.from : award.to, award.to, XP_RESULT_DELAY_MS);
  useEffect(() => {
    if (award.counts) writeSeen(award.to);
  }, [award]);
  if (!award.counts) {
    return (
      <div className="xp-result">
        <p className="xp-result__note">
          ⭐ Sign in to earn XP. This match would have given <b>+{award.gained} XP</b> toward unlocking new units,
          upgrades and styles.
        </p>
        {onOpen && (
          <button className="link-btn" onClick={onOpen}>
            See the progression track ›
          </button>
        )}
      </div>
    );
  }
  const before = levelOf(award.from);
  const now = levelOf(run.xp);
  return (
    <div className="xp-result">
      <div className="xp-result__head">
        <span className="xp-result__gain">⭐ +{run.xp - award.from} XP</span>
        <span key={now.level} className={`xp-result__level${now.level > before.level ? " xp-level-pop" : ""}`}>
          {now.level > before.level ? (
            <>
              Level up! <b>{before.level} → {now.level}</b>
            </>
          ) : (
            <>Level {now.level}</>
          )}
        </span>
      </div>
      <XpBar into={now.into} need={now.need} ups={run.ups} />
      {award.unlocked.length > 0 && (
        <div className={`xp-result__unlocks${run.done ? " xp-result__unlocks--on" : ""}`}>
          <span className="xp-result__label">Ready to claim</span>
          {award.unlocked.map((r) => (
            <RewardChip key={`${r.kind}:${r.id}`} reward={r} />
          ))}
        </div>
      )}
      {onOpen && (
        <button className="link-btn" onClick={onOpen}>
          {award.unlocked.length > 0 ? "Claim them in Progression ›" : "See the progression track ›"}
        </button>
      )}
    </div>
  );
}

/** How long each reward's card stays (`CLAIM_TOTAL_MS` shared out, within these). */
const CLAIM_CARD_MS = 1500;
const CLAIM_CARD_MIN_MS = 550;
const CLAIM_TOTAL_MS = 5000;
const CLAIM_RAYS = 12;
const CLAIM_SPARKS = 14;
const SPARK_MS = 900;
const TONE: Record<string, string> = {
  gold: "#e2b24a",
  prismatic: "#c99bff",
  unit: "#8fbfff",
  style: "#ff9cc7",
  silver: "#d6dbe6",
};

/**
 * Rays turning behind a claimed reward, and sparks flying off as it lands, by
 * frame time. A canvas like ResultBackdrop's: iOS dropped the CSS version
 * (masked conic gradient, keyframes reading custom properties). Reduced
 * motion: the rays, still, and no sparks.
 */
function ClaimBurst({ tone }: { tone: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const color = TONE[tone] ?? "#ffd36b";
    const size = canvas.clientWidth;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const c = size / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0.1, `${color}66`);
    glow.addColorStop(1, `${color}00`);
    const calm = prefersReducedMotion();
    let start = 0;
    let frame = 0;
    const draw = (now: number) => {
      start ||= now;
      const t = now - start;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = glow;
      for (let i = 0; i < CLAIM_RAYS; i++) {
        const a = (i / CLAIM_RAYS) * Math.PI * 2 + (t / 7000) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, c, a, a + Math.PI / CLAIM_RAYS / 1.6);
        ctx.closePath();
        ctx.fill();
      }
      if (!calm && t < SPARK_MS) {
        const p = t / SPARK_MS;
        const out = 1 - (1 - p) ** 3;
        ctx.fillStyle = color;
        ctx.globalAlpha = 1 - p;
        for (let i = 0; i < CLAIM_SPARKS; i++) {
          const a = (i / CLAIM_SPARKS) * Math.PI * 2 + 0.2;
          const r = 16 + out * (64 + (i % 3) * 26);
          ctx.beginPath();
          ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 3.5 * (1 - p * 0.7), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (!calm) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [tone]);
  return <canvas ref={ref} className="claim-card__burst" aria-hidden="true" />;
}

/**
 * Claiming: each reward takes the stage on its own card, rays turning behind
 * it and sparks flying off, and goes by itself. A tap moves on; Skip ends it.
 * Only for show: the claim itself has already gone.
 */
export function ClaimReveal({ rewards, onDone }: { rewards: Reward[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const next = () => (i + 1 < rewards.length ? setI(i + 1) : onDone());
  const hold = Math.max(CLAIM_CARD_MIN_MS, Math.min(CLAIM_CARD_MS, CLAIM_TOTAL_MS / rewards.length));
  useEffect(() => {
    sfx("upgrade");
    const t = window.setTimeout(next, hold);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, hold]);
  const reward = rewards[i];
  const r = rewardInfo(reward);
  return (
    <div className="claim-reveal" role="status" aria-live="polite" onClick={next}>
      <div key={i} className={`claim-card claim-card--${r.tone}`}>
        <ClaimBurst tone={r.tone} />
        <span className="claim-card__label">Unlocked!</span>
        <span className="claim-card__icon" aria-hidden="true">
          {reward.kind === "unit" ? <UnitPortrait unitKey={reward.id} side="player" size={84} pose="dance" /> : r.icon}
        </span>
        <strong className="claim-card__name">{r.name}</strong>
        <span className="claim-card__kind">{reward.kind === "upgrade" ? `${r.tone} upgrade` : KIND_LABEL[reward.kind]}</span>
        <span className="claim-card__desc">{r.description}</span>
      </div>
      {rewards.length > 1 && (
        <div className="claim-reveal__foot">
          <span>
            {i + 1} of {rewards.length}
          </span>
          <button
            className="link-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDone();
            }}
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

/** The whole track. */
export function ProgressPanel({ onClose, onSignIn }: { onClose: () => void; onSignIn: () => void }) {
  const p = useProgress();
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
  }, []);
  const guest = p.owner === "guest";
  // Run the bar up from where this device last saw it, and say how much was
  // earned since.
  const [seen] = useState(() => {
    const v = readSeen();
    return guest || v === null ? p.xp : Math.min(v, p.xp);
  });
  const run = useXpRun(seen, p.xp, XP_PANEL_DELAY_MS);
  const { level, into, need } = levelOf(run.xp);
  useEffect(() => {
    if (!guest) writeSeen(p.xp);
  }, [guest, p.xp]);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  /** Levels claimed while the panel is open: their rewards pop in. */
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  /** What's being claimed, on stage (`ClaimReveal`); its levels pop in on the track after. */
  const [reveal, setReveal] = useState<{ rewards: Reward[]; levels: number[] } | null>(null);
  const endReveal = () => {
    if (reveal) setFresh((f) => new Set([...f, ...reveal.levels]));
    setReveal(null);
  };
  const claim = (to: number) => {
    setClaiming(true);
    setError("");
    const from = p.unlockedLevel;
    const levels = Array.from({ length: Math.max(0, to - from) }, (_, i) => from + 1 + i);
    const claimed = claimTo(to);
    setReveal({ rewards: levels.flatMap(rewardsAt), levels });
    claimed
      .catch(() => {
        setReveal(null);
        setFresh(new Set());
        setError("Couldn't claim. Check your connection and try again.");
      })
      .finally(() => setClaiming(false));
  };
  return (
    // Fixed and on top (like Account), since it also opens over the result screen.
    <div className="overlay overlay--feedback" onClick={onClose}>
      <div
        className="panel progress-panel"
        role="dialog"
        aria-labelledby="progress-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="panel__head">
          <h2 id="progress-title">⭐ Progression</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close" autoFocus>
            ✕
          </button>
        </div>
        <div className="progress-panel__now">
          <strong key={level} className={run.ups > 0 ? "xp-level-pop" : undefined}>Level {level}</strong>
          <span>
            {run.xp > seen && <b className="progress-panel__since">+{run.xp - seen} XP </b>}
            {need ? `${into} / ${need} XP` : `${p.xp} XP · max level`}
          </span>
        </div>
        <XpBar into={into} need={need} ups={run.ups} />
        <p className="panel__hint">
          Every finished match earns XP, a win more than a loss, and more again the higher the starting health. Each
          level unlocks a new unit, upgrade or battle style to claim; the CPU can always use all of them.
        </p>
        {p.newUpgrades > 0 && (
          <div className="progress-panel__claim">
            <span>
              <b>
                {p.newUpgrades} new unlock{p.newUpgrades === 1 ? "" : "s"}
              </b>{" "}
              to claim. Claimed units and upgrades join your offers.
            </span>
            <button className="primary-btn" disabled={claiming || p.claimable <= p.unlockedLevel} onClick={() => claim(p.claimable)}>
              Claim all
            </button>
          </div>
        )}
        {error && <p className="lobby__error" role="alert">{error}</p>}
        {guest && (
          <div className="progress-panel__guest">
            <span>Progression is for accounts. As a guest you earn no XP and play with the starting units and upgrades.</span>
            <button className="primary-btn" onClick={onSignIn}>
              Sign in
            </button>
          </div>
        )}
        <ol className="progress-track">
          <li className={`progress-level progress-level--done`}>
            <span className="progress-level__num">1</span>
            <span className="progress-level__rewards">
              <span className="progress-level__starter">
                {STARTER_UNITS.map((k) => UNITS[k].name).join(", ")} and {STARTER.length} starting upgrades
              </span>
            </span>
          </li>
          {Array.from({ length: MAX_LEVEL - 1 }, (_, i) => i + 2).map((lv) => {
            const reached = lv <= p.level;
            const claimed = lv <= p.unlockedLevel;
            const waiting = reached && !claimed && !guest;
            // Scroll to the first level waiting to be claimed, else the next to reach.
            const focus = p.newUpgrades > 0 ? lv === p.unlockedLevel + 1 : lv === Math.min(MAX_LEVEL, p.level + 1);
            return (
              <li
                key={lv}
                ref={focus ? current : undefined}
                className={`progress-level${claimed ? " progress-level--done" : ""}${waiting ? " progress-level--claim" : ""}${lv === p.level + 1 ? " progress-level--next" : ""}${claimed && fresh.has(lv) ? " progress-level--fresh" : ""}`}
                style={{ "--d": `${[...fresh].sort((a, b) => a - b).indexOf(lv) * 90}ms` } as React.CSSProperties}
              >
                <span className="progress-level__num">{lv}</span>
                <span className="progress-level__rewards">
                  {rewardsAt(lv).map((r) => (
                    <RewardCard key={`${r.kind}:${r.id}`} reward={r} />
                  ))}
                </span>
                {waiting ? (
                  <button
                    className="progress-level__claim"
                    disabled={claiming || lv > p.claimable}
                    title={lv > p.claimable ? "Saving your XP first…" : lv > p.unlockedLevel + 1 ? "Claims this level and the ones before it" : undefined}
                    onClick={() => claim(lv)}
                  >
                    Claim
                  </button>
                ) : (
                  <span className="progress-level__state" aria-label={claimed ? "claimed" : "locked"}>
                    {claimed ? "✓" : "🔒"}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {reveal && reveal.rewards.length > 0 && <ClaimReveal rewards={reveal.rewards} onDone={endReveal} />}
      </div>
    </div>
  );
}
