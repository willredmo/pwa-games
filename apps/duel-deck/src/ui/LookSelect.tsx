import { styleUnlockLevel } from "../game/progression";
import { LOOKS, type Look } from "../game/save";
import { useProgress } from "../online/progress";

// The Style setting: how battles look (Normal, Kawaii, Bloody). Cosmetic and
// local, so it can change mid-match; shown in the title's settings sheet and
// the in-game menu. Kawaii and Bloody are progression unlocks: locked ones
// are listed with their level, and can't be picked.

const LABEL: Record<Look, string> = { normal: "⚔️ Normal", kawaii: "🌸 Kawaii", bloody: "🩸 Bloody" };
const BLURB: Record<Look, string> = {
  normal: "The standard look",
  kawaii: "Your units pink and cute, the battle uwu, and nobody dies: they hop away happy",
  bloody: "Hits bleed, deaths splatter, wounds show as health falls",
};

export function LookSelect({ look, onLook }: { look: Look; onLook: (look: Look) => void }) {
  const { unlockedLevel } = useProgress();
  return (
    <label className={`look-select look-select--${look}`}>
      <span className="look-select__head">
        Style
        <select value={look} onChange={(e) => onLook(e.target.value as Look)}>
          {LOOKS.map((l) => {
            const at = styleUnlockLevel(l);
            return (
              <option key={l} value={l} disabled={at > unlockedLevel}>
                {LABEL[l]}
                {at > unlockedLevel ? ` · 🔒 Lv ${at}` : ""}
              </option>
            );
          })}
        </select>
      </span>
      <small>{BLURB[look]}</small>
    </label>
  );
}
