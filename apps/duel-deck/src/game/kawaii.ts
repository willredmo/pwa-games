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

/** uwuWords plus a face on the end, for a callout. */
export function uwu(text: string): string {
  if (!on) return text;
  return uwuWords(text) + FACES[face++ % FACES.length];
}
