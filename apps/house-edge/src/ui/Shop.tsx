import { money } from "../game/format";
import { useRef } from "react";
import { levelOf, UPGRADE_BY_ID, UPGRADES, type Upgrade } from "../game/upgrades";
import { spotsSpare } from "../game/state";
import { upgradeCost, type GameState } from "../game/state";

/** Shop entries whose level is an allowance to place, not an effect on its own. */
const PLACEABLE: Record<string, "double" | "free" | "link"> = {
  spotDouble: "double",
  spotFree: "free",
  spotLink: "link",
};

interface Props {
  state: GameState;
  onBuy: (id: string) => void;
  /** Start choosing a pocket for a mark that has been bought but not placed. */
  onPlaceSpot: (kind: "double" | "free" | "link") => void;
}

const SECTIONS: { key: "table" | "pocket" | "change"; title: string; blurb: string }[] = [
  { key: "table", title: "The Table", blurb: "Bend the wheel's edge back toward you." },
  {
    key: "pocket",
    title: "The Pockets",
    // These are the only upgrades with a decision attached, so the section says
    // so — a player who buys one expecting a level to tick up has to know the
    // purchase is only half of it.
    blurb: "Bought once, then placed on a number. Permanent until you cash out.",
  },
  { key: "change", title: "Loose Change", blurb: "Scrape the floor faster, and keep more of it." },
];

export function Shop({ state, onBuy, onPlaceSpot }: Props) {
  // Levels as of the previous render. Without this, `level > 0` would mean
  // every upgrade you already own flashes each time the Shop tab is opened —
  // the list arriving, rather than feedback for the thing you just bought.
  const seen = useRef<Record<string, number>>({});
  const justBought = (id: string, level: number) => {
    const before = seen.current[id];
    seen.current[id] = level;
    return before !== undefined && level > before;
  };

  const card = (u: Upgrade) => {
    // Gated upgrades are shown, not hidden. Hiding them keeps the early shop
    // short but also hides the shape of the tree, so a prerequisite looks like
    // a dead end rather than a door.
    const locked = !!u.requires && levelOf(state.upgrades, u.requires) === 0;
    const needs = u.requires ? UPGRADE_BY_ID.get(u.requires)?.name : null;
    const level = levelOf(state.upgrades, u.id);
    const maxed = level >= u.maxLevel;
    const cost = upgradeCost(state, u.id);
    const afford = cost !== null && cost <= state.chips;
    const bought = justBought(u.id, level);
    const kind = PLACEABLE[u.id];
    const spare = kind ? spotsSpare(state, kind, u.id) : 0;
    return (
      // Keyed on the level so buying re-mounts the card and its flash fires.
      // A class alone would not: a CSS animation does not restart on an element
      // that simply keeps the class it already had.
      <div
        key={`${u.id}:${level}`}
        className={`card${maxed ? " maxed" : ""}${locked ? " locked" : ""}${
          bought ? " bought" : ""
        }`}
      >
        <div className="card-head">
          <span className="card-icon">{locked ? "\u{1F512}" : u.icon}</span>
          <span className="card-name">{u.name}</span>
          <span className="card-level">
            {locked ? "" : u.maxLevel === 1 ? (maxed ? "owned" : "") : `${level}/${u.maxLevel}`}
          </span>
        </div>
        <p className="card-desc">{u.desc(maxed ? level : level + 1)}</p>
        <button type="button" className="buy" disabled={locked || maxed || !afford} onClick={() => onBuy(u.id)}>
          {locked ? `Needs ${needs}` : maxed ? "Maxed" : `${money(cost ?? 0)}`}
        </button>
        {kind && spare > 0 && (
          // Buying only grants the allowance; the pocket is chosen on the
          // table. Without this the card would sit at a level with nothing to
          // show for it, which is exactly how Hire a Croupier reads as a no-op.
          <button type="button" className="buy place" onClick={() => onPlaceSpot(kind)}>
            Place {spare} on the table
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="panel">
      {SECTIONS.map(({ key, title, blurb }) => {
        const cards = UPGRADES.filter((u) => (u.section ?? "table") === key).map(card);
        return (
          <section key={key} className="shop-section">
            <h3 className="shop-heading">
              {title}
              <span>{blurb}</span>
            </h3>
            {cards}
          </section>
        );
      })}
    </div>
  );
}
