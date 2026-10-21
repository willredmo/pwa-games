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
    version: "1.7.2",
    date: "Oct 21, 2026",
    notes: [
      "During a battle the board takes over the screen: the cards, hint and battle log step aside and your units are drawn much bigger, so the fight is easy to follow. Everything comes back when it's time to pick.",
      "The battle log is hidden for now, and its switch is gone from ☰.",
      "Kawaii mode renames your units too. 🌸",
    ],
  },
  {
    version: "1.7.1",
    date: "Oct 21, 2026",
    notes: [
      "Beacons show what they do: a support's ability flies to the Beacon as a glowing orb, bounces off it with a ×1.5 and a boing, and flies on, bigger, to the unit in front.",
      "Clearer hover text for every support unit (they help the unit directly in front of them), the Beacon (what it bounces and how much stronger) and the Sentinel (how much damage it sends back, with an example).",
      "Psst: Match settings is hiding a secret. 🌸",
    ],
  },
  {
    version: "1.7.0",
    date: "Oct 20, 2026",
    notes: [
      "Support units now help the unit directly in front of them, not the unit at the front of the row. Where you place a Herald, Medic, Warden or Acolyte matters.",
      "New support unit, the Beacon: whatever support reaches it is passed on to the unit in front of it, 1.5× stronger (more with levels, 3× when mastered). Beacons in a row chain, so a Herald at the back can reach the front through them.",
      "New defense unit, the Sentinel: strikes back at whoever hits it for 40% of the blow (more with levels, 100% when mastered). The bigger the hit, the bigger the answer, so it's the counter to a unit stacked with attack.",
      "A Medic leading the row now heals itself, so it isn't helpless when the unit it was healing falls.",
      "A mastered Warden's Barrier now also covers the unit ahead of the one it lands on.",
      "Upgrade changes, based on what players pick and win with: Legion now buffs only units of your row's most common class. Unbreakable gives every unit at least 1 armour instead of adding to armour they already have. Desperate measures kicks in below half your HP, for +2 attack. Aegis makes Wardens shield themselves too. Bastion also covers Sentinels.",
      "New upgrades: Duelist (Skirmishers), Signal fire (Beacons relay more) and Vengeance (Sentinels strike back harder).",
      "Match settings: choose a level cap of 8, 10, 12 or 15. Units stop levelling at the cap, where their ability gets its Mastery form. Duels use the host's.",
      "More rare and epic upgrades. New rares: Phalanx, Undying and Twin fangs. New epics: Sanctum, Iron curtain, Colossus and Warlord. Battle fury, United front, Overwhelm, Mixed formation and Bloodpact are now rare.",
      "Retired upgrades nobody was taking: Steady footing, Counterstrike, Tank wall, Glass cannon pact, Last breath and Bounty. A match already holding one keeps it.",
      "Music: a laid-back jazz loop while you plan and a chiptune loop in battle, crossfading between them. Turn it off with the new Music switch on the title screen or in ☰ (Sound off silences it too).",
      "The CPU places its support units behind the units they should help.",
      "Online duels need both players on this version.",
    ],
  },
  {
    version: "1.6.0",
    date: "Oct 18, 2026",
    notes: [
      "A new main menu: pick your opponent and press Play from one card, host or join a duel from another, and find everything else in the icon bar at the bottom. Match settings open in their own panel.",
      "Built for small phones: the main menu, ☰ menu and in-game screen all fit a 320×568 screen, and the board is about a fifth bigger on phones.",
      "In a match on a phone, the top bar is one line (☰, the round, and when the next upgrade comes), leaving more room for the board.",
      "The upgrade choice no longer gets cut off on short phones: it takes the whole screen and scrolls if it has to.",
      "The end screen keeps Rematch, Replay and New match pinned to the bottom, with the stats in a compact grid above.",
    ],
  },
  {
    version: "1.5.0",
    date: "Oct 18, 2026",
    notes: [
      "Report a bug or suggest a feature from ☰, the title screen or the end screen. It takes a screenshot of the game to send with your note (you can leave it out, retake it or save it).",
      "Online duels: ask for a rematch on the end screen. It starts when both players accept, in the same room with the same settings.",
      "Rerolling now deals new cards in every slot, including the ones you've already taken this round (frozen cards still stay).",
      "Upgrades are no longer taken by a single tap: tap one to select it, then press Take. Taps right as the cards appear are ignored, so a tap meant for the battle can't pick one.",
      "Online duels need both players on this version.",
    ],
  },
  {
    version: "1.4.2",
    date: "Oct 17, 2026",
    notes: [
      "Custom starting health: besides 100, 200 and 300, type any amount from 20 to 999.",
      "The title screen scrolls when it doesn't fit (it was cut off on smaller phones).",
      "Offer cards that can upgrade a unit on your row show ⬆ and that unit's level.",
      "Replays: the other team no longer goes missing, and the banner says which round you're watching.",
      "Online duels: the end screen no longer lists the opponent's units over and over (each round counted them as new units).",
    ],
  },
  {
    version: "1.4.1",
    date: "Oct 16, 2026",
    notes: [
      "Match settings has its own section on the title screen, and says it applies to both matches vs the CPU and duels you host. Each Play button shows the settings it will use; joining a duel uses the host's.",
      "Frozen cards are sealed in a block of ice.",
    ],
  },
  {
    version: "1.4.0",
    date: "Oct 16, 2026",
    notes: [
      "Match settings: before a match, choose starting health and turn Easy mode, class bonuses and upgrades on or off.",
      "Easy mode: Undo also takes back a reroll, and gives the reroll back.",
      "Online duels use the host's match settings, shown in the lobby and at the start of the duel.",
      "Every unit that reaches level 10 opens one more slot in your row (up to 8), so long matches don't get stuck. This replaces the Reinforcements upgrade, which is gone.",
      "Class bonuses now need 5 or more units, all of one class (not every slot), so an extra slot never breaks one.",
      "Replay the last fight: ↻ Replay beside the round summary, or ↻ Replay final fight on the end screen.",
    ],
  },
  {
    version: "1.3.6",
    date: "Oct 16, 2026",
    notes: [
      "Ascendant (the one-unit epic upgrade) is out of the game for now while it gets more testing. Matches already holding it keep it.",
    ],
  },
  {
    version: "1.3.5",
    date: "Oct 15, 2026",
    notes: [
      "Choose your starting health for matches against the CPU: 100 (quick), 200 or 300 (long). Desperate measures and Bloodpact scale with it.",
      "Ascendant keeps your strongest fighter (attack × health) instead of your highest-level unit, and never a support unit if you have anything else.",
      "The CPU only takes Ascendant when its best fighter carries its row, so it no longer ends up with a lone support unit.",
    ],
  },
  {
    version: "1.3.4",
    date: "Oct 15, 2026",
    notes: [
      "Iron Line is stronger: every unit starts each round with a 5 shield (was +3 health).",
      "Full Assault reworked: +2 attack (was +1), and every unit's overkill carries on to the next enemy (was: blows can't be dodged, which only mattered against Skirmishers).",
      "Start-of-round buffs (Rally, Lifebond, Barrier) now play one unit at a time.",
      "Completing a class bonus shows its banner longer, with what it does.",
      "iOS: the victory screen's sunburst and confetti now play.",
      "Phones: Reroll no longer gets cut off, and the round summary fits on one line. Tablets: the buttons fit on one row.",
    ],
  },
  {
    version: "1.3.3",
    date: "Oct 14, 2026",
    notes: [
      "Aegis now stacks with a level 10 Warden: each one extends the shield to one more unit behind the front.",
      "Level 10 Berserker: Overflow now chains (an enemy it kills passes the rest on), so the Cleave upgrade still helps it.",
      "After taking Ascendant, you are no longer offered upgrades a single unit can't use.",
      "New icons for Battle fury, Iron will, Precision strikes and Ascendant, so no two badges look alike.",
    ],
  },
  {
    version: "1.3.2",
    date: "Oct 14, 2026",
    notes: [
      "12 new upgrades, so every unit has some built around it: Long reach and Skewer (Lancer), War horn and Banner of hope (Herald), Triage and Stimulant (Medic), Thick barrier and Aegis (Warden), Devotion and Blessing (Acolyte), Counterstrike (Skirmisher) and Choir (all Support units).",
      "Class bonus meter: while picking, see how many more units of one class your row needs, which cards count, and a celebration when you complete it.",
      "The Warden's shield now arrives at the start of the battle, like the Acolyte's and Herald's buffs.",
    ],
  },
  {
    version: "1.3.1",
    date: "Oct 14, 2026",
    notes: [
      "The Units page is now the Codex, with Units and Upgrades tabs.",
      "Units are grouped by class. Tap a unit in a class card to jump to it.",
      "Tap an upgrade on a unit to jump to it, and a unit on an upgrade to jump back.",
      "What's new is also in the ☰ menu.",
    ],
  },
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
