import { colorOf } from "../engine";
import { money } from "../game/format";
import { wheelStats, type GameState } from "../game/state";

interface Props {
  state: GameState;
}

/** Wheel-frequency stats for the current cycle. */
export function Stats({ state }: Props) {
  const s = wheelStats(state.pocketCounts);
  // Outside bets are settled on 36 pockets, not 37 — the zero is not red, not
  // even and not low. Showing these as a share of *all* spins would make a fair
  // wheel look like it favours nothing, which is the opposite of the point: the
  // 2.7% the zero takes is exactly the house edge.
  const outside = s.spins - s.zero;
  const pct = (n: number) => (outside === 0 ? "—" : `${((n / outside) * 100).toFixed(1)}%`);

  const pair = (
    label: string,
    aName: string,
    a: number,
    bName: string,
    b: number,
    aClass = "",
    bClass = "",
  ) => (
    <div className="stat-row" key={label}>
      <span className="stat-row-label">{label}</span>
      <span className="stat-bar" role="img" aria-label={`${aName} ${pct(a)}, ${bName} ${pct(b)}`}>
        <span
          className={`stat-fill ${aClass}`}
          style={{ width: outside === 0 ? "50%" : `${(a / outside) * 100}%` }}
        />
        <span
          className={`stat-fill ${bClass}`}
          style={{ width: outside === 0 ? "50%" : `${(b / outside) * 100}%` }}
        />
      </span>
      <span className="stat-row-nums">
        <b>{pct(a)}</b> / <b>{pct(b)}</b>
      </span>
    </div>
  );

  const wagered = state.wagered ?? 0;
  const returned = state.returned ?? 0;
  const net = returned - wagered;
  // The realised edge: what every dollar pushed across the felt actually came
  // back as. A neutral wheel converges on -2.70%, and the whole progression is
  // dragging this number above zero.
  const edge = wagered > 0 ? (net / wagered) * 100 : 0;

  const hot = s.ranked.slice(0, 5);
  const cold = s.ranked.slice(-5).reverse();

  return (
    <div className="card stats-card">
      <div className="card-head">
        <span className="card-icon">▦</span>
        <span className="card-name">This Table</span>
        <span className="card-level">{s.spins} spins</span>
      </div>

      {s.spins === 0 ? (
        <p className="card-desc muted">Nothing yet — spin the wheel.</p>
      ) : (
        <>
          {pair("Colour", "red", s.red, "black", s.black, "red", "black")}
          {pair("Odd / Even", "odd", s.odd, "even", s.even)}
          {pair("Low / High", "1–18", s.low, "19–36", s.high)}

          <div className="stat-row">
            <span className="stat-row-label">Zero</span>
            <span className="stat-row-nums wide">
              <b>{s.zero}</b> ({s.spins === 0 ? "—" : `${((s.zero / s.spins) * 100).toFixed(2)}%`})
              <span className="muted"> · the house edge is 2.70%</span>
            </span>
          </div>

          <div className="stat-row">
            <span className="stat-row-label">Wagered</span>
            <span className="stat-row-nums wide">
              <b>{money(wagered)}</b> out · <b>{money(returned)}</b> back
            </span>
          </div>

          <div className="stat-row">
            <span className="stat-row-label">Net</span>
            <span className="stat-row-nums wide">
              <b className={net > 0 ? "win" : net < 0 ? "loss" : ""}>
                {net >= 0 ? "+" : "\u2212"}
                {money(Math.abs(net))}
              </b>
              {wagered > 0 && (
                <span className="muted">
                  {" "}
                  · {edge >= 0 ? "+" : "\u2212"}
                  {Math.abs(edge).toFixed(2)}% per dollar staked
                </span>
              )}
            </span>
          </div>

          <div className="stat-row">
            <span className="stat-row-label">Biggest</span>
            <span className="stat-row-nums wide">
              <b className="win">+{money(state.bestWin ?? 0)}</b> won ·{" "}
              <b className="loss">−{money(Math.abs(state.worstLoss ?? 0))}</b> lost
            </span>
          </div>

          <div className="stat-row">
            <span className="stat-row-label">Best streak</span>
            <span className="stat-row-nums wide">
              <b>{state.bestStreak}</b> wins in a row
            </span>
          </div>

          <div className="stat-cols">
            <div>
              <span className="stat-row-label">Hot</span>
              <div className="stat-pockets">
                {hot.map(({ pocket, count }) => (
                  <span key={pocket} className={`pocket ${colorOf(pocket)}`} title={`${count} hits`}>
                    {pocket}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="stat-row-label">Cold</span>
              <div className="stat-pockets">
                {cold.map(({ pocket, count }) => (
                  <span key={pocket} className={`pocket ${colorOf(pocket)}`} title={`${count} hits`}>
                    {pocket}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="card-desc muted">
            Hot and cold are the gambler's fallacy in table form — every pocket stays
            1 in 37 whatever this says.
          </p>
        </>
      )}
    </div>
  );
}
