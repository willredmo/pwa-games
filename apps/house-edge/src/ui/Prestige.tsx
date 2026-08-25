import { money } from "../game/format";
import { Stats } from "./Stats";
import { RELIC_BY_ID, RELICS } from "../game/relics";
import { IVORY_PAYOUT, STACK_FALLOFF } from "../game/upgrades";
import {
  canCashOut,
  canEquip,
  countOf,
  pendingIvory,
  relicSlots,
  IVORY_SCALE,
  type GameState,
} from "../game/state";

interface Props {
  state: GameState;
  onCashOut: () => void;
  onEquip: (id: string) => void;
  onUnequip: (id: string) => void;
}

export function Prestige({ state, onCashOut, onEquip, onUnequip }: Props) {
  const pending = pendingIvory(state);
  const slots = relicSlots(state);
  const ownedIds = [...new Set(state.relics)].sort(
    (a, b) => RELICS.findIndex((r) => r.id === a) - RELICS.findIndex((r) => r.id === b),
  );
  // Peak needed for the next Ivory, so the ask is a number and not a mystery.
  const nextAt = Math.pow(pending + 1, 2) * IVORY_SCALE;

  return (
    <div className="panel">
      <Stats state={state} />

      <div className="card">
        <div className="card-head">
          <span className="card-icon">♜</span>
          <span className="card-name">Cash Out</span>
          <span className="card-level">{state.ivory} ivory</span>
        </div>
        <p className="card-desc">
          Bank your peak bankroll as Ivory, then start over with a fresh table.
          Cash, upgrades and your layout are cleared; Ivory and relics are kept.
          Each Ivory is worth +{(IVORY_PAYOUT * 100).toFixed(0)}% payout forever,
          and every cash out drafts one relic from three.
        </p>
        <p className="card-desc muted">
          Peak this cycle {money(state.peak)} · next Ivory at {money(nextAt)}
        </p>
        <button
          type="button"
          className="buy prestige"
          disabled={!canCashOut(state)}
          onClick={onCashOut}
        >
          {pending > 0 ? `Cash out for ${pending} ivory` : "Not worth cashing out yet"}
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-icon">✦</span>
          <span className="card-name">Relics</span>
          <span className="card-level">
            {state.activeRelics.length}/{slots} equipped
          </span>
        </div>
        {ownedIds.length === 0 ? (
          <p className="card-desc muted">None yet — your first cash out drafts one.</p>
        ) : (
          <>
            <p className="card-desc muted">
              Only equipped relics do anything. Duplicates stack at{" "}
              {(STACK_FALLOFF * 100).toFixed(0)}% each. A slot opens every 5 cash outs.
            </p>
            <ul className="relic-list">
              {ownedIds.map((id) => {
                const relic = RELIC_BY_ID.get(id);
                if (!relic) return null;
                const active = countOf(state.activeRelics, id);
                const held = countOf(state.relics, id);
                return (
                  <li key={id} className={active > 0 ? "equipped" : ""}>
                    <div className="relic-row">
                      <span className="card-icon">{relic.icon}</span>
                      <b>{relic.name}</b>
                      <span className="card-level">
                        {active}/{held}
                      </span>
                      <button
                        type="button"
                        className="slot-btn"
                        disabled={active === 0}
                        onClick={() => onUnequip(id)}
                        aria-label={`Unequip ${relic.name}`}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="slot-btn"
                        disabled={!canEquip(state, id)}
                        onClick={() => onEquip(id)}
                        aria-label={`Equip ${relic.name}`}
                      >
                        +
                      </button>
                    </div>
                    <span className="card-desc">{relic.desc}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

interface OfferProps {
  offer: string[];
  onTake: (id: string) => void;
}

export function RelicOffer({ offer, onTake }: OfferProps) {
  return (
    <div className="overlay">
      <div className="overlay-inner">
        <h2>Choose a relic</h2>
        <p className="muted">Kept for good, across every future cash out.</p>
        <div className="offer">
          {offer.map((id) => {
            const relic = RELIC_BY_ID.get(id);
            if (!relic) return null;
            return (
              <button
                key={id}
                type="button"
                className="relic-card"
                onClick={() => onTake(id)}
              >
                <span className="relic-icon">{relic.icon}</span>
                <b>{relic.name}</b>
                <span className="card-desc">{relic.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
