import { colorOf, covers, spotById } from "../engine";
import type { Layout } from "../engine";
import { money } from "../game/format";

interface Props {
  layout: Layout;
  /** How much a tap places. */
  denom: number;
  /** Betting is closed while the ball is in the air. */
  disabled: boolean;
  /** Pocket from the last settled spin, for win highlighting. */
  last: number | null;
  /**
   * Bumped once per spin. Used only as part of the React key on winning cells,
   * so their flash animation restarts each result — a CSS animation on an
   * element that merely keeps a class does not re-fire, and two spins landing
   * on the same pocket would otherwise flash once and then sit lit.
   */
  spinKey: number;
  /** Whether a plain tap adds or takes back a stake. */
  mode: "add" | "remove";
  onPlace: (spotId: string) => void;
  onRemove: (spotId: string) => void;
}

const OUTSIDE_ROWS: string[][] = [
  ["column:1", "column:2", "column:3"],
  ["dozen:1", "dozen:2", "dozen:3"],
  ["low", "even", "red", "black", "odd", "high"],
];

export function BetLayout({
  layout,
  denom,
  disabled,
  last,
  spinKey,
  mode,
  onPlace,
  onRemove,
}: Props) {
  const cell = (id: string, label: string, className: string) => {
    const staked = layout[id] ?? 0;
    const spot = spotById(id);
    const hit = last !== null && spot !== undefined && covers(spot, last);
    return (
      <button
        key={hit ? `${id}:${spinKey}` : id}
        type="button"
        className={`cell ${className}${staked > 0 ? " staked" : ""}${hit ? " hit" : ""}`}
        disabled={disabled}
        onClick={() => (mode === "add" ? onPlace(id) : onRemove(id))}
        onContextMenu={(e) => {
          e.preventDefault();
          onRemove(id);
        }}
        aria-label={`${label}${staked > 0 ? `, ${money(staked)}` : ""}`}
      >
        <span className="cell-label">{label}</span>
        {staked > 0 && <span className="chip-badge">{money(staked)}</span>}
      </button>
    );
  };

  return (
    <div className="table" aria-label="Betting layout">
      <div className="table-main">
        {cell("straight:0", "0", "zero")}
        <div className="numbers">
          {Array.from({ length: 3 }, (_, r) =>
            Array.from({ length: 12 }, (_, c) => {
              const n = c * 3 + (3 - r);
              return cell(`straight:${n}`, String(n), colorOf(n));
            }),
          )}
        </div>
      </div>
      {OUTSIDE_ROWS.map((row, i) => (
        <div className="outside" key={i}>
          {row.map((id) => {
            const spot = spotById(id);
            if (!spot) return null;
            const tone =
              id === "red" ? "red" : id === "black" ? "black" : "outside-cell";
            return cell(id, spot.label, tone);
          })}
        </div>
      ))}
      <p className="table-hint">
        {mode === "add"
          ? `Tap to place ${money(denom)} — right-click takes one back`
          : `Take-back mode: tap to remove ${money(denom)}`}
      </p>
    </div>
  );
}
