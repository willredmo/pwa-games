import { getAugment, rarityOf, type AugmentState } from "../game/augments";
import type { MatchStats } from "../game/stats";

// Wide desktop screens only (CSS hides these below 1100px): the space either
// side of the board holds what otherwise sits behind the Upgrades button and
// the end screen — each side's upgrades, and your running match tallies.

function UpgradeList({ state, empty }: { state: AugmentState; empty: string }) {
  if (state.active.length === 0) return <p className="side-panel__empty">{empty}</p>;
  return (
    <ul className="side-panel__upgrades">
      {state.active.map((id) => {
        const def = getAugment(id);
        if (!def) return null;
        return (
          <li key={id} className={`side-upgrade side-upgrade--${rarityOf(def)}`}>
            <span className="side-upgrade__head">
              <span aria-hidden="true">{def.icon}</span> {def.name}
            </span>
            <span className="side-upgrade__desc">{def.description}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function SidePanels({
  player,
  enemy,
  stats,
  difficulty,
}: {
  player: AugmentState;
  enemy: AugmentState;
  stats: MatchStats;
  difficulty: string;
}) {
  const rows: [string, string | number][] = [
    ["Rounds won · lost", `${stats.won} · ${stats.lost}${stats.drawn ? ` · ${stats.drawn} drawn` : ""}`],
    ["HP dealt · taken", `${stats.poolDealt} · ${stats.poolTaken}`],
    ["Kills · losses", `${stats.kills} · ${stats.losses}`],
    ["Biggest hit", stats.biggestHit ? `${stats.biggestHit.amount} (${stats.biggestHit.name})` : "—"],
    ["Win streak", `${stats.streak} (best ${stats.bestStreak})`],
  ];
  return (
    <>
      <aside className="side-panel side-panel--player" aria-label="Your upgrades and match stats">
        <h2 className="side-panel__title">You</h2>
        <h3 className="side-panel__heading">Upgrades</h3>
        <UpgradeList state={player} empty="None yet — the first comes in round 3." />
        <h3 className="side-panel__heading">This match</h3>
        <dl className="side-panel__stats">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </aside>
      <aside className="side-panel side-panel--enemy" aria-label="Enemy upgrades">
        <h2 className="side-panel__title">Enemy · {difficulty}</h2>
        <h3 className="side-panel__heading">Upgrades</h3>
        <UpgradeList state={enemy} empty="None yet." />
      </aside>
    </>
  );
}
