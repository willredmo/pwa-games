import { useEffect, useRef, useState } from "react";
import { MAX_LEVEL, STARTER, levelOf, rewardsAt } from "../game/progression";
import { rarityOf } from "../game/augments";
import { claimTo, useProgress, type XpAward } from "../online/progress";

// The progression track: levels 1 to MAX_LEVEL, each with the upgrades it
// unlocks, from the title screen's level chip and the result screen's XP bar.
// A guest sees the same track, at level 1, and is told progression needs an
// account. Reached levels' upgrades are claimed here (Claim, or Claim all)
// before they're dealt; the title's chip badges how many are waiting.

/** A level's progress bar. `from` (a fraction) animates up to `to` when given. */
export function XpBar({ into, need, from }: { into: number; need: number; from?: number }) {
  const pct = need > 0 ? Math.min(100, (into / need) * 100) : 100;
  const start = from === undefined ? pct : Math.min(100, from * 100);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Grow from where the match started, a beat after the panel opens.
    const el = fill.current;
    if (!el || start === pct) return;
    el.style.width = `${start}%`;
    const t = window.setTimeout(() => {
      el.style.width = `${pct}%`;
    }, 350);
    return () => window.clearTimeout(t);
  }, [start, pct]);
  return (
    <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={need || 1} aria-valuenow={need ? into : 1}>
      <div ref={fill} className="xp-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** The title screen's chip: the level, how far into it, and a badge while upgrades wait to be claimed. */
export function LevelChip({ onClick }: { onClick: () => void }) {
  const p = useProgress();
  const { into, need } = levelOf(p.xp);
  const label = `Level ${p.level}.${p.newUpgrades ? ` ${p.newUpgrades} new upgrade${p.newUpgrades === 1 ? "" : "s"} to claim.` : ""} Open the progression track`;
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
        <span style={{ width: `${need ? (into / need) * 100 : 100}%` }} />
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
          ⭐ Sign in to earn XP. This match would have given <b>+{award.gained} XP</b> toward unlocking new upgrades.
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
          {award.unlocked.map((a) => (
            <span key={a.id} className={`result-upgrade result-upgrade--${rarityOf(a)}`} title={a.description}>
              {a.icon} {a.name}
            </span>
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
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const claim = (level: number) => {
    setClaiming(true);
    setError("");
    claimTo(level)
      .catch(() => setError("Couldn't claim. Check your connection and try again."))
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
          <span>{need ? `${into} / ${need} XP` : `${p.xp} XP · max level`}</span>
        </div>
        <XpBar into={into} need={need} />
        <p className="panel__hint">
          Every finished match earns XP, a win more than a loss, and more again the higher the starting health. Each
          level has upgrades to claim; the CPU can always draw any of them.
        </p>
        {p.newUpgrades > 0 && (
          <div className="progress-panel__claim">
            <span>
              <b>{p.newUpgrades} new upgrade{p.newUpgrades === 1 ? "" : "s"}</b> to claim. Claimed upgrades join your
              upgrade choices.
            </span>
            <button className="primary-btn" disabled={claiming || p.claimable <= p.unlockedLevel} onClick={() => claim(p.claimable)}>
              Claim all
            </button>
          </div>
        )}
        {error && <p className="lobby__error" role="alert">{error}</p>}
        {guest && (
          <div className="progress-panel__guest">
            <span>Progression is for accounts. As a guest you earn no XP and play with the starting upgrades.</span>
            <button className="primary-btn" onClick={onSignIn}>
              Sign in
            </button>
          </div>
        )}
        <ol className="progress-track">
          <li className={`progress-level progress-level--done`}>
            <span className="progress-level__num">1</span>
            <span className="progress-level__rewards">
              <span className="progress-level__starter">{STARTER.length} starting upgrades</span>
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
                className={`progress-level${claimed ? " progress-level--done" : ""}${waiting ? " progress-level--claim" : ""}${lv === p.level + 1 ? " progress-level--next" : ""}`}
              >
                <span className="progress-level__num">{lv}</span>
                <span className="progress-level__rewards">
                  {rewardsAt(lv).map((a) => (
                    <span key={a.id} className={`result-upgrade result-upgrade--${rarityOf(a)}`} title={a.description}>
                      {a.icon} {a.name}
                    </span>
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
