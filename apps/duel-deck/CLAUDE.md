# Duel Deck — 1v1 Auto-Battler Roguelike

**Design source of truth:** [`/roguelike-projects-tracker.md`](../../roguelike-projects-tracker.md),
section "1. 1v1 Game — Duel Deck". Read that first — this file only records how
the code maps onto it and where the two intentionally differ.

## Implemented (matches the tracker)

- **Single shared row.** Both sides queue up facing each other across a centre
  line; front-most units clash. Written generic over lane count, so the future
  3-5 lane expansion is a config change (`LANES` in `game/match.ts`).
- **Front-only melee combat.** Only the front-most unit per side attacks; both
  strike simultaneously (a unit dying this tick still deals its damage); when
  one dies the next in queue steps up. No ranged, no multi-target.
- **Unit pool** — Guard 3/10, Striker 6/4, Skirmisher 5/5, Bulwark 2/14,
  Berserker 8/3 (`engine/units.ts`).
- **Pick 2 of 5 each round**, drawn from the flat pool. **No economy** — picks
  are free. The offer samples *with replacement*, so a round can offer duplicates
  (otherwise, with only five unit types, every round would offer the whole pool).
- **Win condition.** Both players hold a 100 HP pool. The side left holding the
  row wins the round, and *its total damage dealt that round* is subtracted from
  the loser's pool. First to 0 loses.
- **Persistent upgrades ("augments")** — `game/augments.ts`. All 18 from the
  tracker. A **separate offer track**, offered **every 3rd round**, and
  **match-scoped**: `AugmentState` is recreated per match and never carried over.
- **Abstract/geometric theming.** Units are flat shapes — Guard square, Striker
  triangle, Skirmisher diamond, Bulwark hexagon, Berserker circle — with colour
  encoding ownership.
- **AI opponent** — v1 random picks for both units and augments.
- **Deterministic sim.** `resolveRound` is pure (clones its input) and returns a
  per-tick event log, so a future netcode layer can replay a round from a synced
  commit rather than streaming it.

### Augment effects are recomputed, not baked in
Many augments are dynamic — Momentum stacks per round won, Desperate Measures
switches on below 30 HP, Overwhelm depends on relative unit counts, Vanguard's
Edge re-targets whoever is currently front, Tank Wall scales with tank count.
So effective stats are recomputed from **base** stats at the start of every
round (`applyAugments`), rather than mutated into units once. Stacking counters
(`momentum`, `rally`) only accrue while the augment is actually held.

## Deviations from the tracker (deliberate, decided in session)

- **Queue depth capped at 5 per side.** The tracker doesn't specify a cap. With
  +2 units/round this fills up; if the board is full when picks remain, the
  remaining picks are skipped and the round proceeds.
- **The player chooses the exact spot** for each unit, rather than it auto-
  queueing at the back. Units are placed by **dragging** from the offer onto a
  slot, and **already-placed units can be dragged to reorder** the queue — so
  which unit takes the front is a real decision.
- **Rounds are committed manually.** Spending both picks does not auto-start the
  battle; the player presses Commit. Without this there is no chance to reorder
  after the second pick.
- **The queue is always contiguous.** Dropping onto an occupied slot inserts
  ahead of that unit and pushes the rest back, rather than leaving gaps.
- **Nothing is ever lost — fallen units respawn at the end of the round**, and
  everyone returns to full health. Your row is a permanent, growing roster, not
  something attrition wears down. Implemented by snapshotting the board *as
  committed* (every unit alive, in queue order) and rebuilding the next round
  from that snapshot, carrying forward only the HP pools; `resolveRound` is pure
  so the snapshot survives combat untouched.
- **Each of the 5 offers is single-use per round**, so your 2 picks are always
  two different cards. Duplicate unit types across separate offer slots are
  still independently pickable.
- **A pick can either add a body or merge into an existing unit**, at any time —
  drop on an empty slot to place, drop on one of your units to merge.
  **Like merges with like only:** an offered Guard can only be folded into a
  Guard. The absorbed unit contributes **50% of its ATK and max HP**
  (`MERGE_RATIO`, halves round up) — e.g. a Bulwark grants +1 ⚔ / +7 ♥. So
  merging *loses* total stats versus placing the unit separately; what it buys
  is concentration, a tougher unit holding the front rather than another body
  behind it. Merges stack (+N badge). The gain raises `baseAtk`/`baseMaxHp`, so
  it survives both respawn and the per-round augment recomputation.
- **Replacing, only when the row is full.** Dropping an offer onto a unit of a
  *different* type swaps it out; the old unit and any merges baked into it are
  discarded. It's offered only when full, since otherwise there's an empty slot
  to use. Because it's destructive, the drop target renders solid orange with a
  tinted fill (vs. green for merge, gold for place) and the hint spells out
  "⚠ Replace X with Y" before release. `dropActionFor` is the single source of
  truth shared by the drop handler, the highlight colours and the hint, so what
  the player is told always matches what happens.
- The AI follows the same rules when its row is full: merge into a matching
  type if it can, otherwise swap out its weakest unit — but only when the
  incoming unit's raw stats beat it, so it never downgrades itself.
  Because dropping on a unit means "merge", queue position is set by dragging
  placed units around rather than by inserting ahead of one.
- **Units already on the board can also be merged into each other**, not just
  offers into units. Dragging a placed unit onto a **same-type** neighbour folds
  it in (same 50% rule); onto anything else it reorders. This costs a body
  rather than a pick, so it's free and available at any point in the pick phase
  — it's the only way to concentrate a row you've already filled without
  spending a pick. The gain is 50% of the source's *current* base stats, so a
  unit that has itself absorbed merges carries that value forward rather than
  reverting to printed stats, and the `+N` badge counts every body absorbed
  transitively. Same-type units are interchangeable in the queue, so nothing is
  lost by spending that gesture on merge instead of reorder.

### Click and drag are the same code path
Every board action — place, merge, replace, reorder, merge-placed — is reachable
either by dragging or by click-to-pick-up then click-to-drop. They are not two
implementations: both produce a `Grab` (the offer index, or the placed unit's
id + origin), `actionFor(cell, grab)` decides what a destination would do, and
`placeFromOffer` / `applyUnitGrab` carry it out. `grab = drag ?? selected` is the
single value the highlights, drop colours and hint text all read, so the two
input styles cannot drift apart or look different.

Two details that make clicking a peer of dragging rather than a fallback:
- **Hovering with something click-selected sets `dropCell`**, so the outcome
  preview — the orange fill and "⚠ Replace X" warning — appears before you
  commit, exactly as during a drag. Without this, replace would be one click
  from destroying a merged unit with no per-slot warning.
- **Clicking an illegal destination falls through to selecting it** if it's your
  unit, so clicking around the board switches what's in hand instead of dead-
  ending. Clicking the picked-up unit itself cancels; clicking off the board
  puts it down.

A placed unit that's click-selected is drawn with a **solid** gold ring, versus
the dashed outline of a drop target and the faded treatment of a dragged unit —
a drag has a ghost following the pointer to show what's in hand, and a click
selection needs its own way to say so.

### Augment badges are derived, never stored
Each augment carries a unique `icon`, and every unit shows the icons of the
augments currently changing its numbers (`Unit.auras`, augment ids in pick
order). `applyAugments` rebuilds that list from scratch each round alongside the
stats, and only records an augment whose delta for *this* unit is non-zero — so
Overwhelm's badge disappears when you fall behind on unit count, Momentum shows
nothing at zero stacks, and Vanguard's Edge follows whoever is front now. A
badge therefore always means "this is why the number differs from the base
stat", which is the whole point; caching the list would let it drift.

Both sides are badged, since `applyAugments` runs for the enemy too — reading
what's buffing the opposing front unit is real information, and it pairs with
the existing Enemy tab in the Upgrades panel. That panel lists each icon beside
its name and is the legend; the board badges are deliberately just a hint, since
at 10 rows on a phone they're only a few pixels across. The renderer takes an
`auraIcon` resolver in `RenderState` rather than importing the augment catalogue,
keeping `board/render.ts` generic over the game layer, and lays badges out
right-to-left with a `+N` overflow that adapts to the space the unit's name and
merge badge leave free.

### Battle playback is chained, not pre-scheduled
The `⏩` HUD button toggles a 3× playback speed (`FAST_FACTOR`), persisted to
`localStorage` so it outlives the match. Making it toggleable *mid-battle*
dictated the playback structure: frames used to be scheduled up front at
absolute offsets, which meant a speed change could only take effect by
re-running the effect — restarting the round from the first blow. Playback now
chains one timeout per frame and re-reads `speedRef` at each boundary, so
toggling applies from the next beat with no replay. `speedRef` is a ref rather
than the `fast` state precisely so it stays out of the effect's dependency
array; putting `fast` in there would reintroduce the restart.

## Deferred (not v1)

- Real 1v1 over Supabase/Firebase — the reason this app exists long-term.
  The `commit → resolveRound` boundary is where it plugs in.
- Ranged units, multi-lane boards, economy/currency, scaling/rarity tiers.
- Smarter AI (stat-scoring, then board-synergy awareness).

## Open questions

- **Merge balance.** At 50%, merging is a deliberate stat loss, so it's only
  worth it when concentration matters more than totals — a full row, or wanting
  one front-liner that survives several exchanges. Watch whether it ever pays:
  if merging is always the wrong choice while slots remain, raise `MERGE_RATIO`
  or make merges grant something placement can't (a keyword, say).
- **Accidental replaces.** Replace discards a unit outright, including merges.
  The colour coding and the "⚠ Replace X" hint are the only guards — there's no
  undo. If it bites in playtesting, an explicit confirm on replacing a merged
  unit is the obvious next step.
- Whether augment offers should scale in power over a long match.
