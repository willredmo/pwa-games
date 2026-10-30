import { LOOKS, type Look } from "../game/save";

// The Style setting: how battles look (Normal, Kawaii, Bloody). Cosmetic and
// local, so it can change mid-match; shown in the title's settings sheet and
// the in-game menu.

const LABEL: Record<Look, string> = { normal: "⚔️ Normal", kawaii: "🌸 Kawaii", bloody: "🩸 Bloody" };
const BLURB: Record<Look, string> = {
  normal: "The standard look",
  kawaii: "Your units pink and cute, the battle uwu, and nobody dies: they hop away happy",
  bloody: "Hits bleed, deaths splatter, wounds show as health falls",
};

export function LookSelect({ look, onLook }: { look: Look; onLook: (look: Look) => void }) {
  return (
    <label className={`look-select look-select--${look}`}>
      <span className="look-select__head">
        Style
        <select value={look} onChange={(e) => onLook(e.target.value as Look)}>
          {LOOKS.map((l) => (
            <option key={l} value={l}>
              {LABEL[l]}
            </option>
          ))}
        </select>
      </span>
      <small>{BLURB[look]}</small>
    </label>
  );
}
