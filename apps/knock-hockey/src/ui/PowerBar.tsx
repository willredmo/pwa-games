import { useRef } from "react";
import { MIN_POWER, capture } from "../render/table";

// The power bar beside the board. Touch or drag it to set how far the stick
// pulls back — top is a tap, bottom is full power. Letting go keeps the power;
// nothing fires until you press Hit. It also shows the CPU's pull-back as it
// lines up.

export interface PowerBarProps {
  power: number;
  /** Your turn: the bar takes input. */
  active: boolean;
  cpu: boolean;
  onPull: (power: number) => void;
}

export function PowerBar({ power, active, cpu, onPull }: PowerBarProps) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  const set = (clientY: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    onPull(Math.max(0, Math.min(1, (clientY - r.top) / r.height)));
  };

  return (
    <div
      className={`power${active ? " power--active" : ""}${cpu ? " power--cpu" : ""}`}
      role="slider"
      aria-label="Power"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(power * 100)}
      onPointerDown={(e) => {
        if (!active) return;
        capture(e.currentTarget, e.pointerId);
        drag.current = e.pointerId;
        set(e.clientY);
      }}
      onPointerMove={(e) => {
        if (drag.current === e.pointerId) set(e.clientY);
      }}
      onPointerUp={(e) => {
        if (drag.current === e.pointerId) drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div className="power__track" ref={track}>
        <div className="power__fill" style={{ height: `${power * 100}%` }} />
        <div className="power__handle" style={{ top: `${power * 100}%` }} />
      </div>
      <span className="power__label">
        {power >= MIN_POWER ? `${Math.round(power * 100)}%` : active ? "Power ↓" : ""}
      </span>
    </div>
  );
}
