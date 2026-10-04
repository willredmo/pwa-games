import { useEffect, useRef, useState } from "react";
import type { Side } from "../engine/types";
import { prefersReducedMotion } from "../board/anim";

// Player HP pool bar: eased fill, lingering ghost chunk, hit flash, counting number.
export interface HpBarProps {
  side: Side;
  label: string;
  hp: number;
  max: number;
}

export function HpBar({ side, label, hp, max }: HpBarProps) {
  const target = Math.max(0, hp);
  const pct = Math.max(0, Math.min(100, (target / max) * 100));
  const [shown, setShown] = useState(target);
  const [ghostPct, setGhostPct] = useState(pct);
  const [hitKey, setHitKey] = useState(0);
  const prev = useRef(target);
  const shownRef = useRef(target);

  // Count the number toward the target.
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (prefersReducedMotion()) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const dur = 500;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const v = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // Ghost chunk: lingers, then drains. Heals snap it up immediately.
  useEffect(() => {
    if (target < prev.current) {
      setHitKey((k) => k + 1);
      const id = window.setTimeout(() => setGhostPct(pct), 400);
      prev.current = target;
      return () => window.clearTimeout(id);
    }
    prev.current = target;
    setGhostPct(pct);
  }, [target, pct]);

  const low = pct < 30 && target > 0;
  return (
    <div className={`hpbar hpbar--${side}${low ? " hpbar--low" : ""}`}>
      <span className="hpbar__label">{label}</span>
      <div key={hitKey} className={`hpbar__track${hitKey > 0 ? " hpbar__track--hit" : ""}`}>
        <div className="hpbar__ghost" style={{ transform: `scaleX(${ghostPct / 100})` }} />
        <div className={`hpbar__fill hpbar__fill--${side}`} style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <span className="hpbar__hp">{shown}</span>
    </div>
  );
}
