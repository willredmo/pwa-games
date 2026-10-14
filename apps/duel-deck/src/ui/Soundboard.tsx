import { useState } from "react";
import { sfx, setSoundEnabled, unlockSound, type Sfx } from "../game/sound";

// Dev-only: every sound effect on one page, to review and retune the palette
// (game/sound.ts). Open the dev server with ?sounds. Not in production builds.

const SOUNDS: { kind: Sfx; name: string; when: string; unused?: boolean; scales?: boolean }[] = [
  { kind: "hit", name: "Hit", when: "A blow lands (the clash plays one sound per beat, from its biggest blow).", scales: true },
  { kind: "big-hit", name: "Big hit", when: "The beat's biggest blow is BIG_HIT damage or more." },
  { kind: "death", name: "Death", when: "A unit falls (slightly after the impact)." },
  { kind: "dodge", name: "Dodge", when: "A Skirmisher's Evasion dodges a blow." },
  { kind: "block", name: "Block", when: "Armour or a shield soaks part of a hit." },
  { kind: "ability", name: "Ability", when: "A named ability fires (Charge, Bodyguard, Overflow...)." },
  { kind: "place", name: "Place", when: "A unit is put on your row, or moved." },
  { kind: "merge", name: "Merge", when: "Two units become one." },
  { kind: "knight", name: "Knighted / Mastered", when: "A Squire is knighted, or a unit reaches level 10." },
  { kind: "upgrade", name: "Upgrade", when: "You take an upgrade." },
  { kind: "round-win", name: "Round won", when: "You hold the row at the end of a round." },
  { kind: "round-loss", name: "Round lost", when: "The enemy holds the row." },
  { kind: "victory", name: "Victory", when: "You win the match." },
  { kind: "defeat", name: "Defeat", when: "You lose the match." },
  { kind: "explode", name: "Explosion", when: "Your row blows up after losing the match." },
  { kind: "emote", name: "Emote", when: "Your online opponent sends an emoji." },
  { kind: "heal", name: "Heal", when: "Defined but never played (meant for Medic heals and lifesteal).", unused: true },
  { kind: "buff", name: "Buff", when: "Defined but never played (meant for stat gains).", unused: true },
  { kind: "pick", name: "Pick", when: "Defined but never played (meant for picking up a card).", unused: true },
];

export function Soundboard() {
  const [strength, setStrength] = useState(0.5);
  const play = (kind: Sfx) => {
    unlockSound();
    setSoundEnabled(true);
    sfx(kind, strength);
  };
  return (
    <div className="soundboard">
      <h1>Sound effects</h1>
      <p className="soundboard__note">
        Every sound in the game, synthesized in <code>game/sound.ts</code>. Strength only changes the ones that scale with the
        size of a blow (marked ⚖).
      </p>
      <label className="soundboard__strength">
        Strength {strength.toFixed(2)}
        <input type="range" min={0} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
      </label>
      <ul className="soundboard__list">
        {SOUNDS.map((s) => (
          <li key={s.kind} className={`soundboard__row${s.unused ? " soundboard__row--unused" : ""}`}>
            <button className="primary-btn" onClick={() => play(s.kind)} aria-label={`Play ${s.name}`}>
              ▶
            </button>
            <div>
              <strong>
                {s.name} {s.scales && <span title="Scales with strength">⚖</span>}
              </strong>{" "}
              <code>{s.kind}</code>
              <div className="soundboard__when">{s.when}</div>
            </div>
          </li>
        ))}
      </ul>
      <button className="ghost-btn" onClick={() => SOUNDS.filter((s) => !s.unused).forEach((s, i) => setTimeout(() => play(s.kind), i * 1400))}>
        ▶ Play all in order
      </button>
    </div>
  );
}
