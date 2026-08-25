import { colorOf, covers, spotById } from "../engine";
import type { Layout } from "../engine";
import { money } from "../game/format";
import type { Heat } from "../game/state";

interface Props {
  layout: Layout;
  /** How much a tap places. */
  denom: number;
  /** Betting is closed while the ball is in the air. */
  disabled: boolean;
  /** Pocket from the last settled spin, for win highlighting. */
  last: number | null;
  /** Per-pocket run of luck so far, indexed by number. Straights only. */
  heat: readonly Heat[];
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

/** The even-money row, in table order: six bets across twelve number columns. */
const EVEN_MONEY = ["low", "even", "red", "black", "odd", "high"];

const NUMBER_COLS = 12;
/** Grid column the numbers start at — the zero occupies the first track. */
const FIRST_NUMBER_COL = 2;
/** Grid column holding the three 2:1 column bets, right of the number rows. */
const COLUMN_BET_COL = FIRST_NUMBER_COL + NUMBER_COLS;

export function BetLayout({
  layout,
  denom,
  disabled,
  last,
  heat,
  spinKey,
  mode,
  onPlace,
  onRemove,
}: Props) {
  const cell = (
    id: string,
    label: string,
    className: string,
    style?: React.CSSProperties,
    run?: Heat,
  ) => {
    const staked = layout[id] ?? 0;
    const spot = spotById(id);
    const hit = last !== null && spot !== undefined && covers(spot, last);
    return (
      <button
        key={hit ? `${id}:${spinKey}` : id}
        type="button"
        className={`cell ${className}${staked > 0 ? " staked" : ""}${hit ? " hit" : ""}`}
        style={style}
        disabled={disabled}
        onClick={() => (mode === "add" ? onPlace(id) : onRemove(id))}
        onContextMenu={(e) => {
          e.preventDefault();
          onRemove(id);
        }}
        aria-label={`${label}${staked > 0 ? `, ${money(staked)}` : ""}${
          run ? `, running ${run}` : ""
        }`}
        title={
          run === "hot"
            ? "Has come up more than its share so far"
            : run === "cold"
              ? "Has come up less than its share so far"
              : undefined
        }
      >
        <span className="cell-label">{label}</span>
        {staked > 0 && <span className="chip-badge">{money(staked)}</span>}
      </button>
    );
  };

  return (
    <div className="table" aria-label="Betting layout">
      {/*
        One grid for everything, rather than the number grid plus separate
        equal-thirds rows underneath. Those rows could not line up by
        construction: three equal columns across the full width do not fall on
        the same boundaries as twelve, and none of them accounted for the
        zero's track at the far left.

        Laid out as a real table instead. The 2:1 column bets sit at the end of
        the row they actually pay on — the top row is 3, 6, 9 ... 36, which is
        column 3 — and each dozen spans exactly the four number columns it
        covers.
      */}
      <div className="table-main">
        {cell("straight:0", "0", "zero")}

        {Array.from({ length: 3 }, (_, r) =>
          Array.from({ length: NUMBER_COLS }, (_, c) => {
            const n = c * 3 + (3 - r);
            const run = heat[n] ?? null;
            return cell(
              `straight:${n}`,
              String(n),
              `${colorOf(n)}${run ? ` ${run}` : ""}`,
              { gridColumn: FIRST_NUMBER_COL + c, gridRow: r + 1 },
              run,
            );
          }),
        )}

        {[3, 2, 1].map((value, r) => {
          const spot = spotById(`column:${value}`);
          if (!spot) return null;
          return cell(`column:${value}`, spot.label, "outside-cell outside-bet col-bet", {
            gridColumn: COLUMN_BET_COL,
            gridRow: r + 1,
          });
        })}

        {[1, 2, 3].map((d) => {
          const spot = spotById(`dozen:${d}`);
          if (!spot) return null;
          return cell(`dozen:${d}`, spot.label, "outside-cell outside-bet", {
            gridColumn: `${FIRST_NUMBER_COL + (d - 1) * 4} / span 4`,
            gridRow: 4,
          });
        })}

        {EVEN_MONEY.map((id, i) => {
          const spot = spotById(id);
          if (!spot) return null;
          // Red/Black reuse the number colours, so they need a separate marker
          // for sizing — otherwise the rule would catch all 36 numbers too.
          const tone = id === "red" ? "red" : id === "black" ? "black" : "outside-cell";
          return cell(id, spot.label, `${tone} outside-bet`, {
            gridColumn: `${FIRST_NUMBER_COL + i * 2} / span 2`,
            gridRow: 5,
          });
        })}
      </div>
      <p className="table-hint">
        {mode === "add"
          ? `Tap to place ${money(denom)} — right-click takes one back`
          : `Take-back mode: tap to remove ${money(denom)}`}
      </p>
    </div>
  );
}
