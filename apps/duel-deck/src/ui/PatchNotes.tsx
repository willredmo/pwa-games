// Patch notes: what changed in each released version, newest first, shown from
// the title screen. Add an entry here whenever package.json's version is bumped
// for a release. Written for players: what they'll notice, not how it's built.

interface Release {
  version: string;
  date: string;
  notes: string[];
}

export const PATCH_NOTES: Release[] = [
  {
    version: "1.3.0",
    date: "Oct 14, 2026",
    notes: [
      "Level cap: units max out at level 10, and their ability gets stronger (Mastery). Extra picks on a maxed row turn into attack (Drill).",
      "New epic upgrade, Ascendant: only one unit on your board, but it has no level cap.",
      "Classes: every unit is Attack, Defense or Support. Fill your row with one class for a bonus: Full Assault, Iron Line or Sanctuary.",
      "New support units: the Warden shields the front unit, and the Acolyte gives the front half its health.",
      "Herald and Acolyte now buff at the start of the battle, so you see their stats in full while picking.",
      "Freeze up to 2 upgrades at once.",
      "Online: emotes during duels (with mute), and both players must be on the same version.",
      "New-player tutorial, and a shorter How to play.",
      "Your row explodes when you lose; the enemy's health bar explodes in slow motion when you win. Winners dance on the end screen; losers mope.",
      "Shield bar under shielded units, class icons on every unit, and units no longer get huge on big screens.",
      "Sound pass: new death and round-won sounds, a louder place sound, and fuller sound overall.",
    ],
  },
  {
    version: "1.2.1",
    date: "Oct 11, 2026",
    notes: ["Setting to hide the battle log."],
  },
  {
    version: "1.2.0",
    date: "Oct 11, 2026",
    notes: ["Main menu.", "Online duels with a join code.", "Sound effects.", "Wide-screen layout."],
  },
  {
    version: "1.1.3",
    date: "Oct 8, 2026",
    notes: ["Pick the difficulty when starting a match.", "Unit table on the result screen."],
  },
  {
    version: "1.1.2",
    date: "Oct 8, 2026",
    notes: ["Squire upgrades, a tougher Hard AI and the Mixed formation.", "Reroll after taking picks."],
  },
  {
    version: "1.1.1",
    date: "Oct 7, 2026",
    notes: ["Enemy units are drawn upright."],
  },
  {
    version: "1.1.0",
    date: "Oct 7, 2026",
    notes: ["New units: Herald, Lancer and Medic.", "New upgrades.", "Freeze a card for next time.", "Visual pass."],
  },
  {
    version: "1.0.0",
    date: "Oct 5, 2026",
    notes: ["First release: unit abilities, AI difficulty and the end screen."],
  },
];

const SEEN_KEY = "duel-deck:notes-seen";

/** True when the newest notes haven't been opened on this device yet. */
export function hasUnseenNotes(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== PATCH_NOTES[0].version;
  } catch {
    return false;
  }
}

function markNotesSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, PATCH_NOTES[0].version);
  } catch {
    /* the dot just shows again; harmless */
  }
}

export function PatchNotes({ onClose }: { onClose: () => void }) {
  markNotesSeen();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel panel--wide panel--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="panel__head panel__head--sticky">
          <h2>What's new</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {PATCH_NOTES.map((r) => (
          <section key={r.version} className="notes__release">
            <h3>
              {r.version} <small className="notes__date">{r.date}</small>
            </h3>
            <ul className="rules">
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
