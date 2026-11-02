import { useEffect, useRef, useState } from "react";
import { MAX_LEVEL, STARTER, STARTER_UNITS, levelOf, rewardInfo, rewardsAt, type Reward } from "../game/progression";
import { UNITS } from "../engine/units";
import { sfx } from "../game/sound";
import { UnitPortrait } from "./UnitPortrait";
import { claimTo, useProgress, type XpAward } from "../online/progress";

// The progression track: levels 1 to MAX_LEVEL, each unlocking one upgrade,
// unit or battle style, from the title screen's level chip and the result
// screen's XP bar. A guest sees the same track, at level 1, and is told
// progression needs an account. Reached levels are claimed here (Claim, or
// Claim all) before their rewards count; the title's chip badges how many wait.
//
// Motion (feedback 2026-10-30): opening the track fills the bar from where
// the player last saw it (`SEEN_KEY`), and a claimed level's reward pops in
// with its ✓ stamped on. Transform and opacity only.

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

/**
 * A level's progress bar. `from` (a fraction) animates up to `into / need`
 * when given. Scaled, not resized: iOS stutters on width transitions.
 */
export function XpBar({ into, need, from }: { into: number; need: number; from?: number }) {
  const frac = need > 0 ? Math.min(1, into / need) : 1;
  const start = from === undefined ? frac : Math.min(1, from);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Grow from where it started, a beat after the panel opens.
    const el = fill.current;
    if (!el || start === frac) return;
    el.style.transition = "none";
    el.style.transform = `scaleX(${start})`;
    void el.offsetWidth;
    el.style.transition = "";
    const t = window.setTimeout(() => {
      el.style.transform = `scaleX(${frac})`;
    }, 350);
    return () => window.clearTimeout(t);
  }, [start, frac]);
  return (
    <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={need || 1} aria-valuenow={need ? into : 1}>
      <div ref={fill} className="xp-bar__fill" style={{ transform: `scaleX(${frac})` }} />
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
  const after = levelOf(award.to);
  const levelled = after.level > before.level;
  return (
    <div className="xp-result">
      <div className="xp-result__head">
        <span className="xp-result__gain">⭐ +{award.gained} XP</span>
        <span className="xp-result__level">
          {levelled ? (
            <>
              Level up! <b>{before.level} → {after.level}</b>
            </>
          ) : (
            <>Level {after.level}</>
          )}
        </span>
      </div>
      <XpBar into={after.into} need={after.need} from={levelled ? 0 : before.need ? before.into / before.need : 1} />
      {award.unlocked.length > 0 && (
        <div className="xp-result__unlocks">
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

/** The whole track. */
export function ProgressPanel({ onClose, onSignIn }: { onClose: () => void; onSignIn: () => void }) {
  const p = useProgress();
  const { into, need } = levelOf(p.xp);
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
  }, []);
  const guest = p.owner === "guest";
  // Fill the bar from where it stood last time this device opened the track
  // (from empty after a level up), and say how much was earned since.
  const [since] = useState(() => {
    const seen = readSeen();
    if (guest || seen === null || seen >= p.xp) return { from: undefined, gained: 0 };
    const was = levelOf(seen);
    return { from: was.level < levelOf(p.xp).level ? 0 : was.need ? was.into / was.need : 1, gained: p.xp - seen };
  });
  useEffect(() => {
    if (!guest) writeSeen(p.xp);
  }, [guest, p.xp]);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  /** Levels claimed while the panel is open: their rewards pop in. */
  const [fresh, setFresh] = useState<ReadonlySet<number>>(new Set());
  const claim = (level: number) => {
    setClaiming(true);
    setError("");
    const from = p.unlockedLevel;
    const claimed = claimTo(level);
    setFresh((f) => new Set([...f, ...Array.from({ length: Math.max(0, level - from) }, (_, i) => from + 1 + i)]));
    sfx("upgrade");
    claimed
      .catch(() => {
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
          <strong>Level {p.level}</strong>
          <span>
            {since.gained > 0 && <b className="progress-panel__since">+{since.gained} XP </b>}
            {need ? `${into} / ${need} XP` : `${p.xp} XP · max level`}
          </span>
        </div>
        <XpBar into={into} need={need} from={since.from} />
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
      </div>
    </div>
  );
}
