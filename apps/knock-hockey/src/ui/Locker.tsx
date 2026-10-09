import type { Dispatch, SetStateAction } from "react";
import { CURVES, FINISHES, PATTERNS, SHAFT_COLORS, TAPE_COLORS, defaultLook, randomLook, type LookSlot, type StickLook } from "../game/stick";
import type { Looks } from "../App";
import { StickPreview } from "./StickPreview";

// Customize the sticks. Looks only: every stick hits the same. Player 1's is
// yours against the CPU (and Blue's in 2-player); Player 2's is Red's.

export interface LockerProps {
  slot: LookSlot;
  onSlot: (slot: LookSlot) => void;
  looks: Looks;
  onChange: Dispatch<SetStateAction<Looks>>;
  onClose: () => void;
}

export function Locker({ slot, onSlot, looks, onChange, onClose }: LockerProps) {
  const look = looks[slot];
  const replace = (next: StickLook) => onChange((prev) => ({ ...prev, [slot]: next }));
  const set = <K extends keyof StickLook>(k: K, v: StickLook[K]) =>
    onChange((prev) => ({ ...prev, [slot]: { ...prev[slot], [k]: v } }));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel locker" role="dialog" aria-label="Locker" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head">
          <h2>Locker</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="segmented segmented--two" role="tablist" aria-label="Whose stick">
          {(["p1", "p2"] as const).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={p === slot}
              className={`segmented__opt segmented__opt--${p}${p === slot ? " segmented__opt--on" : ""}`}
              onClick={() => onSlot(p)}
            >
              {p === "p1" ? "Player 1 · Blue" : "Player 2 · Red"}
            </button>
          ))}
        </div>
        <div className="locker__preview">
          <StickPreview look={look} />
        </div>
        <div className="locker__actions">
          <button className="ghost-btn ghost-btn--sm" onClick={() => replace(randomLook())}>🎲 Randomize</button>
          <button className="ghost-btn ghost-btn--sm" onClick={() => replace(defaultLook(slot))}>Reset</button>
        </div>

        <div className="locker__body">
          <Field label="Blade">
            <Chips options={CURVES} value={look.curve} onPick={(v) => set("curve", v)} />
          </Field>
          <Field label="Blade colour">
            <Swatches colors={SHAFT_COLORS} value={look.blade} onPick={(v) => set("blade", v)} />
          </Field>
          <Field label="Shaft">
            <Chips options={FINISHES} value={look.finish} onPick={(v) => set("finish", v)} />
          </Field>
          <Field label={look.finish === "two-tone" ? "Shaft top" : look.finish === "wood" ? "Wood stain" : "Shaft colour"}>
            <Swatches colors={SHAFT_COLORS} value={look.shaft} onPick={(v) => set("shaft", v)} />
          </Field>
          {look.finish === "two-tone" && (
            <Field label="Shaft bottom">
              <Swatches colors={SHAFT_COLORS} value={look.shaft2} onPick={(v) => set("shaft2", v)} />
            </Field>
          )}
          <Field label="Tape">
            <Chips options={PATTERNS} value={look.pattern} onPick={(v) => set("pattern", v)} />
          </Field>
          <Field label="Tape colour">
            <Swatches colors={TAPE_COLORS} value={look.tape} onPick={(v) => set("tape", v)} />
          </Field>
          <Field label="Knob tape">
            <Swatches colors={TAPE_COLORS} value={look.knob} onPick={(v) => set("knob", v)} />
          </Field>
          <Field label="Decal">
            <input
              className="locker__decal"
              value={look.decal}
              maxLength={3}
              placeholder="e.g. 99"
              aria-label="Decal, up to 3 characters"
              onChange={(e) => set("decal", e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <button className="primary-btn primary-btn--wide" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      {children}
    </div>
  );
}

function Chips<T extends string>({ options, value, onPick }: { options: { id: T; label: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.id} className={`chip${o.id === value ? " chip--on" : ""}`} aria-pressed={o.id === value} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Swatches({ colors, value, onPick }: { colors: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch${c === value ? " swatch--on" : ""}`}
          style={{ background: c }}
          aria-label={c}
          aria-pressed={c === value}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}
