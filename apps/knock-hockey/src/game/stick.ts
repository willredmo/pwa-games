import type { Difficulty } from "../ai/cpu";

// A stick's look. Cosmetic only — every stick hits exactly the same.

export type BladeCurve = "straight" | "mid" | "big";
export type ShaftFinish = "solid" | "two-tone" | "wood";
export type TapePattern = "solid" | "stripes" | "checker";

export interface StickLook {
  curve: BladeCurve;
  finish: ShaftFinish;
  shaft: string;
  /** Second shaft colour, for two-tone. */
  shaft2: string;
  blade: string;
  tape: string;
  pattern: TapePattern;
  knob: string;
  /** Up to 3 characters printed on the shaft. */
  decal: string;
}

export const SHAFT_COLORS = ["#c8925a", "#1d1d22", "#f4f1ea", "#d63c3c", "#2f6fd6", "#2a9d5b", "#f2b632", "#8a4fd6", "#ff7aa8", "#16b3b0"];
export const TAPE_COLORS = ["#f4f1ea", "#1d1d22", "#d63c3c", "#2f6fd6", "#f2b632", "#2a9d5b", "#ff7aa8", "#8a4fd6", "#ff8a1f", "#9ad13c"];
export const CURVES: { id: BladeCurve; label: string }[] = [
  { id: "straight", label: "Straight" },
  { id: "mid", label: "Mid curve" },
  { id: "big", label: "Big curve" },
];
export const FINISHES: { id: ShaftFinish; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "two-tone", label: "Two-tone" },
  { id: "wood", label: "Wood grain" },
];
export const PATTERNS: { id: TapePattern; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "stripes", label: "Stripes" },
  { id: "checker", label: "Checker" },
];

export const DEFAULT_LOOK: StickLook = {
  curve: "mid",
  finish: "two-tone",
  shaft: "#2f6fd6",
  shaft2: "#f4f1ea",
  blade: "#1d1d22",
  tape: "#f4f1ea",
  pattern: "solid",
  knob: "#1d1d22",
  decal: "1",
};

/** The CPU's stick at each level. */
export const CPU_LOOKS: Record<Difficulty, StickLook> = {
  easy: { curve: "straight", finish: "wood", shaft: "#c8925a", shaft2: "#c8925a", blade: "#c8925a", tape: "#f4f1ea", pattern: "solid", knob: "#f4f1ea", decal: "" },
  medium: { curve: "mid", finish: "two-tone", shaft: "#d63c3c", shaft2: "#1d1d22", blade: "#d63c3c", tape: "#1d1d22", pattern: "stripes", knob: "#1d1d22", decal: "CPU" },
  hard: { curve: "big", finish: "solid", shaft: "#1d1d22", shaft2: "#1d1d22", blade: "#1d1d22", tape: "#f2b632", pattern: "checker", knob: "#f2b632", decal: "99" },
};

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export function randomLook(): StickLook {
  const shaft = pick(SHAFT_COLORS);
  return {
    curve: pick(CURVES).id,
    finish: pick(FINISHES).id,
    shaft,
    shaft2: pick(SHAFT_COLORS.filter((c) => c !== shaft)),
    blade: pick(SHAFT_COLORS),
    tape: pick(TAPE_COLORS),
    pattern: pick(PATTERNS).id,
    knob: pick(TAPE_COLORS),
    decal: String(Math.floor(Math.random() * 99) + 1),
  };
}

/** Player 2's default in 2-player: red, so the sticks match the goals. */
export const DEFAULT_LOOK_P2: StickLook = {
  ...DEFAULT_LOOK,
  shaft: "#d63c3c",
  shaft2: "#1d1d22",
  tape: "#1d1d22",
  knob: "#f4f1ea",
  decal: "2",
};

export type LookSlot = "p1" | "p2";
// Player 1 keeps the original key so existing sticks carry over.
const LOOK_KEY: Record<LookSlot, string> = { p1: "knock-hockey:stick", p2: "knock-hockey:stick:p2" };
const LOOK_DEFAULT: Record<LookSlot, StickLook> = { p1: DEFAULT_LOOK, p2: DEFAULT_LOOK_P2 };

export const defaultLook = (slot: LookSlot) => LOOK_DEFAULT[slot];

export function loadLook(slot: LookSlot): StickLook {
  try {
    const raw = localStorage.getItem(LOOK_KEY[slot]);
    if (raw) return { ...LOOK_DEFAULT[slot], ...(JSON.parse(raw) as Partial<StickLook>) };
  } catch {
    /* storage blocked or bad JSON: use the default */
  }
  return LOOK_DEFAULT[slot];
}

export function saveLook(slot: LookSlot, look: StickLook): void {
  try {
    localStorage.setItem(LOOK_KEY[slot], JSON.stringify(look));
  } catch {
    /* not saved; fine */
  }
}
