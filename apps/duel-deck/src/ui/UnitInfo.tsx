import type { Unit, UnitTraits } from "../engine/types";
import { UNITS } from "../engine/units";
import { getAugment } from "../game/augments";

// Hover card for a unit on the board: its numbers now, its numbers before any
// augment, and one line per augment saying exactly what that augment is doing
// to *this* unit this round. Reads `unit.auraDetails`, which applyAugments
// rebuilds with the stats, so the card can't disagree with the board.

/** Plain-language keyword text. Values mirror engine/combat.ts. */
function describeTraits(t: UnitTraits): string[] {
  const out: string[] = [];
  if (t.firstStrike) out.push("strikes first in the opening exchange");
  if (t.cleave) out.push("half its overkill (max 3) hits the next enemy");
  if (t.thorns) out.push(`reflects ${t.thorns} damage when hit`);
  if (t.lifesteal) out.push(`heals ${Math.round(t.lifesteal * 100)}% of damage dealt`);
  if (t.damageReduction) out.push(`takes ${t.damageReduction} less damage per hit`);
  if (t.executioner) out.push(`+${t.executioner} damage vs targets below half health`);
  if (t.lastBreath) out.push("parting blow of 2 if it's your first to fall");
  return out;
}

const signed = (n: number, glyph: string) => (n ? `${n > 0 ? "+" : ""}${n}${glyph}` : "");

export function UnitInfo({ unit, x, y }: { unit: Unit; x: number; y: number }) {
  const innate = UNITS[unit.key]?.traits;
  const details = unit.auraDetails ?? [];
  // Keep the card on screen: flip to the left of the pointer near the right edge.
  const flip = x > window.innerWidth - 300;
  const style = {
    left: flip ? x - 14 : x + 14,
    top: Math.min(y + 14, window.innerHeight - 40),
    transform: flip ? "translateX(-100%)" : undefined,
  };
  return (
    <div className="unit-info" style={style} role="tooltip">
      <div className="unit-info__head">
        <strong>
          {unit.side === "enemy" ? "Enemy " : ""}
          {unit.name}
        </strong>
        <span className="unit-info__stats">
          <span className="stat stat--atk">⚔{unit.atk}</span>
          <span className="stat stat--hp">♥{unit.maxHp}</span>
        </span>
      </div>
      <div className="unit-info__base">
        Base ⚔{unit.baseAtk} ♥{unit.baseMaxHp}
        {unit.merges > 0 && ` · ${unit.merges} merge${unit.merges === 1 ? "" : "s"}`}
      </div>
      {innate && (
        <div className="unit-info__line">
          <span className="unit-info__src">🛡 {unit.name} (innate)</span>
          <span className="unit-info__fx">{describeTraits(innate).join("; ")}</span>
        </div>
      )}
      {details.map((d, i) => {
        // Grants (Last stand) carry their source ids joined with "+".
        const defs = d.id.split("+").map(getAugment).filter((a) => !!a);
        const label = defs.length
          ? defs.map((a) => `${a!.icon} ${a!.name}`).join(", ")
          : "Bonus";
        const fx = [signed(d.atk, "⚔"), signed(d.hp, "♥"), ...(d.traits ? describeTraits(d.traits) : [])]
          .filter(Boolean)
          .join(" · ");
        return (
          <div className="unit-info__line" key={`${d.id}-${i}`}>
            <span className="unit-info__src">{label}</span>
            <span className="unit-info__fx">{fx}</span>
          </div>
        );
      })}
      {details.length === 0 && !innate && <div className="unit-info__none">No upgrades affecting it.</div>}
    </div>
  );
}
