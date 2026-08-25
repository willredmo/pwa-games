import { money } from "../game/format";
import { levelOf, UPGRADE_BY_ID, UPGRADES, type Upgrade } from "../game/upgrades";
import { upgradeCost, type GameState } from "../game/state";

interface Props {
  state: GameState;
  onBuy: (id: string) => void;
}

const SECTIONS: { key: "table" | "change"; title: string; blurb: string }[] = [
  { key: "table", title: "The Table", blurb: "Bend the wheel's edge back toward you." },
  { key: "change", title: "Loose Change", blurb: "Scrape the floor faster, and keep more of it." },
];

export function Shop({ state, onBuy }: Props) {
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
    return (
      <div key={u.id} className={`card${maxed ? " maxed" : ""}${locked ? " locked" : ""}`}>
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
