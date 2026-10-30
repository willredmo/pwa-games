// Blood (a setting, off by default): hits spray blood and leave splats, deaths
// burst into a bloody mess, and units look more wounded as their health falls.
// Purely cosmetic and local, so it's a module flag the app sets from its
// settings (like Kawaii mode) rather than an option threaded through every
// draw call.

let on = false;

export function setBlood(value: boolean): void {
  on = value;
}

export const bloodOn = () => on;

/** Blood colours, darkest first. */
export const BLOOD = ["#4a0509", "#7a0b12", "#a3121c", "#c8242c"] as const;
