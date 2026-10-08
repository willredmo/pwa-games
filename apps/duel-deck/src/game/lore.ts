// Flavour text for the Units screen. Kept apart from engine/units.ts so the
// stats stay pure data and the story can be rewritten freely.

export interface UnitLore {
  /** Short epithet shown under the name. */
  title: string;
  /** A few sentences of backstory. */
  story: string;
}

export const UNIT_LORE: Record<string, UnitLore> = {
  lancer: {
    title: "The Long Reach",
    story:
      "Lancers were cut from the same stone as Strikers, then filed into kites so they " +
      "could carry a weapon twice their height. A Lancer's blow goes straight through the " +
      "front of the enemy queue and into whoever is hiding behind it. They say every Bulwark " +
      "has a recurring dream, and there is a Lancer in it.",
  },
  medic: {
    title: "The Steady Hand",
    story:
      "Medics are crosses because they were made to stand where lines meet. A Medic never " +
      "asks to be at the front. It stays one step behind, staff raised, and patches up whoever " +
      "is holding the line, three times a round and not once more, because even a Medic has " +
      "to breathe. Put one in front and it apologises a lot.",
  },
  herald: {
    title: "Voice of the Row",
    story:
      "Heralds are stars because they were cut to be seen from far away. A Herald has " +
      "never won a fight and doesn't plan to start. It stands at the back of the queue with " +
      "its banner up and shouts the front unit's name until the front unit believes it. " +
      "Put a Herald in front and it simply waves the flag at the enemy, which helps nobody.",
  },
  guard: {
    title: "The Square Oath",
    story:
      "Guards are cut from the old city walls: four even sides, no weak corner. " +
      "Each one swears the Square Oath on the day it is set in place: hold the line, " +
      "and never step back. Most of them keep it. They aren't fast and they don't hit " +
      "hard, but a Guard in the front of the queue buys every unit behind it one more breath.",
  },
  striker: {
    title: "Point of the Spear",
    story:
      "Strikers are triangles because they were made to arrive first. They train on " +
      "the long road to the front, where their only lesson is to never be the second one " +
      "to swing. Strikers carry very little armour on purpose. A Striker that has to block " +
      "has already lost the exchange, and they all know it.",
  },
  skirmisher: {
    title: "The Turning Edge",
    story:
      "Skirmishers keep their footing on a single corner, which lets them pivot faster " +
      "than any other shape on the field. They grew up as messengers between the lines, " +
      "dodging both armies, and they still fight like they are passing through. " +
      "Balanced to a fault, they are the unit commanders reach for when they don't yet " +
      "know what the enemy will send.",
  },
  bulwark: {
    title: "The Six-Sided Wall",
    story:
      "Bulwarks are hexagons, the shape that bees, basalt and fortresses all agree on. " +
      "One was once left alone at a river crossing for three days and was still standing " +
      "when relief arrived; nobody asked it to move, so it hadn't. They barely fight back, " +
      "but an enemy that has to chip through ten layers of patience rarely has much left after.",
  },
  berserker: {
    title: "The Unbroken Circle",
    story:
      "Berserkers are circles: no corners, no edges, no point at which they decide to " +
      "stop. They come from the outer rings, where fights are settled before anyone finishes " +
      "a sentence. A Berserker hits harder than anything else in the queue and falls just as " +
      "fast. Their kin say that's fine, because a circle always comes back around.",
  },
  squire: {
    title: "The Unfinished Shield",
    story:
      "Every Squire is a shield that hasn't been finished yet: the right shape, half " +
      "the size, wearing a borrowed pot for a helmet. They lose most of the fights they " +
      "start, and they know it. But Squires learn from each other, and each lesson is bigger " +
      "than the last. Merge enough of them and one stops being an apprentice.",
  },
  knight: {
    title: "Sworn of the Sixth Lesson",
    story:
      "No one recruits a Knight. A Squire becomes one on the day it has absorbed six " +
      "lessons, when the borrowed pot is swapped for a plumed helm and the wooden sword for " +
      "steel. Knights carry real armour, so every blow lands a little softer, and they keep " +
      "training: a Knight still takes in Squires, and each one makes it stronger than the last.",
  },
};
