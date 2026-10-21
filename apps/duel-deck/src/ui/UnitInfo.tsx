import type { Unit, UnitTraits } from "../engine/types";
import { displayName, kawaiiName } from "../game/kawaii";
import { ARCHETYPES, MAX_LEVEL, SYNERGIES, UNITS, innateTraits, isMastered, levelOf } from "../engine/units";
import { getAugment } from "../game/augments";

// Hover card for a unit on the board: its numbers now, its numbers before any
// augment, and one line per augment saying exactly what that augment is doing
// to *this* unit this round. Reads `unit.auraDetails`, which applyAugments
// rebuilds with the stats, so the card can't disagree with the board.

/** Plain-language keyword text. Values mirror engine/combat.ts. */
function describeTraits(t: UnitTraits): string[] {
  const out: string[] = [];
  if (t.firstStrike) out.push("its first swing each round lands first");
  if (t.cleave)
    out.push(
      t.cleaveFull
        ? "all its overkill hits the next enemy"
        : `half its overkill (max ${t.cleaveCap ?? 3}) hits the next enemy`,
    );
  if (t.cleave && t.cleaveChain) out.push("an enemy its overkill kills passes the rest on");
  if (t.dodges) out.push(t.dodges === 1 ? "dodges the first hit each round" : `dodges the first ${t.dodges} hits each round`);
  if (t.riposte) out.push(`strikes back for ${t.riposte} when it dodges`);
  if (t.openingBonus)
    out.push(`+${t.openingBonus} damage on its first attack ${t.chargeEach ? "against each new enemy" : "each round"}`);
  if (t.deathBuff) {
    const b = t.deathBuff;
    const what = [b.atk ? `+${b.atk}⚔` : "", b.hp ? `+${b.hp}♥` : ""].filter(Boolean).join(" ");
    out.push(`on death: ${b.target === "allies" ? "all allies" : "the unit behind"} gain ${what}`);
  }
  if (t.growOnSurvive) {
    const g = t.growOnSurvive;
    const what = [g.atk ? `${g.atk}⚔` : "", g.hp ? `${g.hp}♥` : ""].filter(Boolean).join(" ");
    out.push(`+${what} permanently each round it survives`);
  }
  if (t.thorns) out.push(`reflects ${t.thorns} damage when hit`);
  if (t.reflect)
    out.push(`when hit, deals ${t.reflect}% of the blow back to the attacker (a 10-damage hit sends ${Math.floor((10 * t.reflect) / 100)} back)`);
  if (t.lifesteal) out.push(`heals ${Math.round(t.lifesteal * 100)}% of damage dealt`);
  if (t.damageReduction) out.push(`takes ${t.damageReduction} less damage per hit`);
  if (t.minArmour && !t.damageReduction) out.push(`takes ${t.minArmour} less damage per hit (Unbreakable)`);
  if (t.executioner) out.push(`+${t.executioner} damage vs targets below half health`);
  if (t.lastBreath) out.push("parting blow of 2 if it's your first to fall");
  if (t.pierce)
    out.push(`each blow it lands also hits the ${DEPTH[t.pierceDeeper ?? 0] ?? `${1 + (t.pierceDeeper ?? 0)} units`} behind the front for ${t.pierce}`);
  if (t.mend)
    out.push(
      `heals the unit in front of it ${t.mend}♥ after each exchange (${3 + (t.mendMore ?? 0)} times a round)${t.mendAtk ? `, each time +${t.mendAtk}⚔` : ""}; leading the row, heals itself`,
    );
  if (t.rally) out.push(`start of round: the unit in front of it gets +${t.rally}⚔${t.rallyHp ? ` +${t.rallyHp}♥` : ""}`);
  if (t.barrier)
    out.push(
      `start of round: the unit in front of it gets a ${t.barrier}-damage shield${t.barrierReach ? ` (and the ${t.barrierReach === 1 ? "unit" : `${t.barrierReach} units`} ahead of that)` : ""}${t.barrierSelf ? ", and so does the Warden" : ""}`,
    );
  if (t.relay) {
    const x = String(Math.round(t.relay) / 100);
    out.push(
      `does nothing on its own; a Rally, Mend, Barrier or Lifebond from the unit directly behind it bounces on to the unit in front of it at ×${x}, and Beacons in a row each multiply it again`,
    );
  }
  if (t.shield) out.push(`shield: the first ${t.shield} damage it takes this round is absorbed`);
  if (t.lifebond)
    out.push(`start of round: gives half its health to the unit in front of it${t.lifebond > 1 ? ` (x${t.lifebond})` : ""}${t.lifebondAtk ? `, plus +${t.lifebondAtk}⚔` : ""}`);
  if (t.trueStrike) out.push("its blows can't be dodged");
  if (t.endure) out.push("survives the first blow each round that would kill it, on 1♥");
  if (t.barrierSelf && !t.barrier) out.push("shields itself with its Barrier too");
  return out;
}

const DEPTH = ["unit", "two units", "three units", "four units"];

const signed = (n: number, glyph: string) => (n ? `${n > 0 ? "+" : ""}${n}${glyph}` : "");

/**
 * Docked: centred, with its bottom edge this many px above the window's
 * bottom. For a click-selection, where the card must stay clear of the board
 * the player is about to tap.
 */
const dockedStyle = (bottom: number) =>
  ({ left: "50%", top: "auto", bottom, transform: "translateX(-50%)" }) as const;

export function UnitInfo({
  unit,
  x = 0,
  y = 0,
  pinned = false,
  dockBottom,
  toKnight, cap = MAX_LEVEL }: {
  unit: Unit;
  x?: number;
  y?: number;
  pinned?: boolean;
  dockBottom?: number;
  /** Merges this Squire still needs to be knighted (null/undefined if not a Squire). */
  toKnight?: number | null;
  /** The match's level cap (a match setting). */
  cap?: number;
}) {
  // Grown by merges: what the ability does for *this* unit right now.
  const innateRaw = innateTraits(unit.key, unit.merges, cap);
  const innate = Object.keys(innateRaw).length > 0 ? innateRaw : undefined;
  const details = unit.auraDetails ?? [];
  // Keep the card on screen: flip to the left of the pointer near the right edge.
  const flip = x > window.innerWidth - 300;
  // Pinned (touch): a finger covers whatever is under it and a phone is too
  // narrow to sit beside it, so centre the card and open it away from the
  // finger, on whichever side of the screen has more room.
  const above = y > window.innerHeight / 2;
  const style = dockBottom !== undefined
    ? dockedStyle(dockBottom)
    : pinned
    ? {
        left: "50%",
        top: above ? y - 28 : y + 28,
        transform: `translate(-50%, ${above ? "-100%" : "0"})`,
      }
    : {
        left: flip ? x - 14 : x + 14,
        top: Math.min(y + 14, window.innerHeight - 40),
        transform: flip ? "translateX(-100%)" : undefined,
      };
  return (
    <div className={`unit-info${pinned || dockBottom !== undefined ? " unit-info--pinned" : ""}`} style={style} role="tooltip">
      <div className="unit-info__head">
        <strong>
          {unit.side === "enemy" ? "Enemy " : ""}
          {displayName(unit)}
        </strong>
        <span className="unit-info__stats">
          <span className="stat stat--atk">⚔{unit.atk}</span>
          <span className="stat stat--hp">♥{unit.maxHp}</span>
        </span>
      </div>
      <div className="unit-info__base">
        Level {levelOf(unit.merges)}
        {levelOf(unit.merges) === cap ? " (max)" : ""} · Base ⚔{unit.baseAtk} ♥{unit.baseMaxHp}
        {UNITS[unit.key] && ` · ${ARCHETYPES[UNITS[unit.key].archetype].icon} ${ARCHETYPES[UNITS[unit.key].archetype].name}`}
      </div>
      {UNITS[unit.key]?.mastery && (
        <div className={`unit-info__mastery${isMastered(unit.merges, cap) ? " unit-info__mastery--on" : ""}`}>
          ★ {isMastered(unit.merges, cap) ? "Mastery" : `At level ${cap}`}: {UNITS[unit.key].mastery}
        </div>
      )}
      {toKnight != null && toKnight > 0 && (
        <div className="unit-info__knight">
          ⚜ {toKnight} more merge{toKnight === 1 ? "" : "s"} to Knight (level {levelOf(unit.merges + toKnight)})
        </div>
      )}
      {innate && (
        <div className="unit-info__line">
          <span className="unit-info__src">
            ✦ {UNITS[unit.key]?.ability?.name ?? unit.name} (innate)
          </span>
          <span className="unit-info__fx">{describeTraits(innate).join("; ")}</span>
        </div>
      )}
      {details.map((d, i) => {
        // Grants (Last stand) carry their source ids joined with "+".
        const defs = d.id.split("+").map(getAugment).filter((a) => !!a);
        const label = d.label
          ?? (defs.length
            ? defs.map((a) => `${a!.icon} ${a!.name}`).join(", ")
            : "Bonus");
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

/**
 * Hover card for an offer: the unit's printed stats, role and innate ability,
 * so its ability is visible before it's picked. Sits above the card, centred.
 */
export function OfferInfo({
  unitKey,
  x = 0,
  y = 0,
  dockBottom,
}: {
  unitKey: string;
  x?: number;
  y?: number;
  dockBottom?: number;
}) {
  const u = UNITS[unitKey];
  if (!u) return null;
  const half = 136; // half the card's width, to keep it on screen
  const left = Math.min(Math.max(x, half + 8), window.innerWidth - half - 8);
  return (
    <div
      className="unit-info unit-info--offer"
      style={
        dockBottom !== undefined
          ? dockedStyle(dockBottom)
          : { left, top: y - 10, transform: "translate(-50%, -100%)" }
      }
      role="tooltip"
    >
      <div className="unit-info__head">
        <strong>{kawaiiName(unitKey, u.name)}</strong>
        <span className="unit-info__stats">
          <span className="stat stat--atk">⚔{u.atk}</span>
          <span className="stat stat--hp">♥{u.maxHp}</span>
        </span>
      </div>
      <div className="unit-info__base">{u.role}</div>
      <div className="unit-info__class">
        {ARCHETYPES[u.archetype].icon} {ARCHETYPES[u.archetype].name} class · a full row of one class gets{" "}
        <strong>
          {SYNERGIES[u.archetype].icon} {SYNERGIES[u.archetype].name}
        </strong>
        : {SYNERGIES[u.archetype].text}
      </div>
      {u.ability && (
        <div className="unit-info__ability">
          <div className="unit-info__ability-head">
            <span className="unit-info__ability-name">✦ {u.ability.name}</span>
            <span className="unit-info__ability-trigger">{u.ability.trigger}</span>
          </div>
          <div className="unit-info__ability-text">{u.ability.text}</div>
          {u.ability.scaling && <div className="unit-info__ability-scaling">↑ {u.ability.scaling}</div>}
          {u.mastery && (
            <div className="unit-info__ability-scaling">
              ★ Level {MAX_LEVEL} (max): {u.mastery}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
