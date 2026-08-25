import type { UnitStats } from "./types";

// Unit pool — v1 first pass, straight from the tracker doc.
// Melee/front-line only: no ranged units in v1.
//
// `shape` drives the abstract/geometric theming (flat shapes, color encodes
// ownership). `classes` are the tags augments target ("+2 attack to all
// Strikers and Berserkers").

export const UNITS: Record<string, UnitStats> = {
  guard: {
    name: "Guard",
    atk: 3,
    maxHp: 10,
    shape: "square",
    classes: ["guard", "tank"],
    role: "Tanky, absorbs hits, low output",
  },
  striker: {
    name: "Striker",
    atk: 6,
    maxHp: 4,
    shape: "triangle",
    classes: ["striker", "aggro"],
    role: "Glass cannon",
  },
  skirmisher: {
    name: "Skirmisher",
    atk: 5,
    maxHp: 5,
    shape: "diamond",
    classes: ["skirmisher"],
    role: "Balanced all-rounder",
  },
  bulwark: {
    name: "Bulwark",
    atk: 2,
    maxHp: 14,
    shape: "hexagon",
    classes: ["bulwark", "tank"],
    role: "Max tank, meant to stall",
  },
  berserker: {
    name: "Berserker",
    atk: 8,
    maxHp: 3,
    shape: "circle",
    classes: ["berserker", "aggro"],
    role: "Highest attack, very fragile",
  },
};

export const UNIT_KEYS = Object.keys(UNITS);

export function unitsOfClass(units: { classes: string[] }[], cls: string): number {
  return units.filter((u) => u.classes.includes(cls)).length;
}
