import { UPGRADE, type UpgradeId } from "../engine/upgrades";

// Player-facing upgrade catalog. The full v1 pool from the design doc is listed
// here; `active` marks the ones whose gameplay effects are implemented in the
// engine today. Only active upgrades are offered as picks, so every choice the
// player is given actually does something.

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  active: boolean;
}

export const UPGRADE_CATALOG: UpgradeDef[] = [
  {
    id: UPGRADE.BackwardStrike,
    name: "Backward Strike",
    description: "Capture backward without being crowned.",
    active: true,
  },
  {
    id: UPGRADE.Swift,
    name: "Swift",
    description: "Move (not capture) two squares instead of one.",
    active: true,
  },
  {
    id: UPGRADE.EarlyKing,
    name: "Early King",
    description: "Crowned immediately; gains king movement.",
    active: true,
  },
  {
    id: UPGRADE.Guardian,
    name: "Guardian",
    description: "Adjacent friendly pieces can't be captured.",
    active: true,
  },
  {
    id: UPGRADE.LongLeap,
    name: "Long Leap",
    description: "Capture an enemy two squares away, landing beyond it.",
    active: true,
  },
  {
    id: UPGRADE.Fortified,
    name: "Fortified",
    description: "Survive the first capture against it (one-time shield).",
    active: true,
  },
  {
    id: UPGRADE.DoubleStrike,
    name: "Double Strike",
    description: "Chain-capture across non-adjacent diagonals.",
    active: true,
  },
  {
    id: UPGRADE.PhantomStep,
    name: "Phantom Step",
    description: "Once per match, this piece takes a bonus move.",
    active: true,
  },
];

const byId = new Map(UPGRADE_CATALOG.map((u) => [u.id, u]));

export function upgradeName(id: string): string {
  return byId.get(id as UpgradeId)?.name ?? id;
}

export function activeUpgrades(): UpgradeDef[] {
  return UPGRADE_CATALOG.filter((u) => u.active);
}

/** Sample `n` distinct active upgrades for a pick-1-of-n choice. */
export function pickUpgradeChoices(n: number): UpgradeDef[] {
  const pool = [...activeUpgrades()];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}
