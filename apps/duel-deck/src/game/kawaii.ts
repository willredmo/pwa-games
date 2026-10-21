import { setKawaiiCharacters } from "../board/characters";

// Kawaii mode: a hidden setting (tap "Match settings" in the settings sheet
// five times). Your units turn pink and cute (board/characters.ts), and the
// battle's words go uwu. Purely cosmetic and local: the opponent's screen,
// the engine and online play are untouched.

let on = false;

export function setKawaii(value: boolean): void {
  on = value;
  setKawaiiCharacters(value);
}

export const isKawaii = () => on;

const FACES = [" uwu", " owo", " >w<", " ^w^", " (◕ᴗ◕✿)", " ✧w✧"];
let face = 0;

/** "Rally" → "Wawwy", "Bonus" → "Bonyus". Leaves text alone when the mode is off. */
export function uwuWords(text: string): string {
  if (!on) return text;
  return text
    .replace(/[rl]/g, "w")
    .replace(/[RL]/g, "W")
    .replace(/n([aeiou])/g, "ny$1")
    .replace(/N([aeiou])/g, "Ny$1");
}

/** Your units' names in kawaii mode. Hand-picked rather than run through uwuWords. */
const KAWAII_NAMES: Record<string, string> = {
  guard: "Guawd-kun",
  striker: "Stwikey",
  skirmisher: "Skiwmi",
  bulwark: "Buwwy",
  berserker: "Bewsy",
  squire: "Squiwe-chan",
  knight: "Sir Fwuffs",
  herald: "Hewawd-chan",
  lancer: "Wancey",
  medic: "Nuwse Medi",
  warden: "Wawdie",
  acolyte: "Acowyte-chan",
  beacon: "Bwinky",
  sentinel: "Sentiny",
};

/** A unit type's kawaii name while the mode is on (for your side), else its usual name. */
export function kawaiiName(key: string, name: string): string {
  return on ? (KAWAII_NAMES[key] ?? uwuWords(name)) : name;
}

/** What to call a unit on screen: your units get their kawaii names in kawaii mode; the opponent's never do. */
export function displayName(u: { key: string; name: string; side: string }): string {
  return u.side === "player" ? kawaiiName(u.key, u.name) : u.name;
}

/** uwuWords plus a face on the end, for a callout. */
export function uwu(text: string): string {
  if (!on) return text;
  return uwuWords(text) + FACES[face++ % FACES.length];
}
