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
- **Win condition.** Both players hold a 200 HP pool (`START_HP`). The side
  left holding the row wins the round, and each of its *surviving* units hits
  the loser's pool for its attack (plus Bounty). First to 0 loses. (Deviations:
  the tracker's pool is 100 HP, and it charged the winner's total damage dealt;
  survivor damage rewards keeping units alive. The median match is ~18-19
  rounds under `pnpm sim`.)
- **Persistent upgrades ("augments")** — `game/augments.ts`. The 18 from the
  tracker plus 12 added in session (see "Combat keywords" below), 30 in all. A **separate offer track**, offered **every 3rd round**, and
  **match-scoped**: `AugmentState` is recreated per match and never carried over.
- **Abstract/geometric theming.** Units are flat shapes — Guard square, Striker
  triangle, Skirmisher diamond, Bulwark hexagon, Berserker circle — with colour
  encoding ownership.
- **AI opponent** — `aiCommit` in `game/match.ts`. Takes the best-valued offer
  (a type it already owns, so it can merge, then highest ATK), merges before
  placing, and sorts its row highest-ATK-first. Augments are chosen from a static
  score table (`AUGMENT_SCORE`) of measured holder win rates, plus a rarity
  premium (`RARITY_BONUS`) and fit to its own row (`aiAugmentScore`: unit-
  specific augments score up when it fields those units, down when it fields
  none). `aiTakeAugment` runs its whole upgrade turn — tiered offer, rerolls
  while the best card scores below `AI_REROLL_BELOW` — for both the app and the
  sim. The win-rate table alone left it taking commons over rares/epics, since
  augments are balanced to similar win rates.
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
  battle; the player presses ⚔ Battle. Without this there is no chance to reorder
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
  behind it. Merges stack, shown as the unit's **level** (every unit starts at Lv1;
  each body merged in adds one — `levelOf` in `engine/units.ts`). The gain raises `baseAtk`/`baseMaxHp`, so
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
- **Every drop on your row does something** (`dropActionFor`): an empty slot
  adds to the back; a different unit type inserts the new unit at that spot
  (pushing the rest back) while there's room, and is replaced once the row is
  full; a same-type unit merges. While there's room a same-type slot is split
  — left half (the character) merges, right half inserts — and the same split
  applies when moving a placed unit onto its twin (right half just moves), so
  twins with different merges can still be reordered. The board badges every
  target with its outcome and labels the hovered one (`targetKinds`,
  `dropLabel` in `RenderState`).
- **Units already on the board can also be merged into each other**, not just
  offers into units. Dragging a placed unit onto a **same-type** neighbour folds
  it in (same 50% rule); onto anything else it reorders. This costs a body
  rather than a pick, so it's free and available at any point in the pick phase
  — it's the only way to concentrate a row you've already filled without
  spending a pick. The gain is 50% of the source's *current* base stats, so a
  unit that has itself absorbed merges carries that value forward rather than
  reverting to printed stats, and the level counts every body absorbed
  transitively. Same-type units are interchangeable in the queue, so nothing is
  lost by spending that gesture on merge instead of reorder.

Replace is recoverable: like every pick-phase action it pushes an undo
snapshot (board with merges, used offers, picks, grants) first, so ↶ Undo /
Ctrl/⌘+Z restores the discarded unit until Commit or a unit reroll. No confirm
dialog is needed on top of the colour coding and hint.

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

### Touch: long-press is hover
Touch has no hover, so on touch and pen (never mouse) a **long-press**
(`LONG_PRESS_MS`) on any unit, either side, or on an offer card opens its info
card (`pinned` in App.tsx). A plain tap does the same where a tap has no other
job: an enemy unit, or any unit outside the pick phase. The card stays open
until the next press anywhere, and that press's click is swallowed
(`swallowClick`) so closing a card never also places or selects. A pinned unit
is held by id and read from the live board, so it tracks merges and battle.
`UnitInfo pinned` centres the card and opens it away from the finger. Mouse
hover is unchanged and is gated on `pointerType === "mouse"`, so a touch drag no
longer flashes hover cards.

Picking something up by click or tap (a placed unit or an offer) also shows its
card, for mouse and touch alike: **docked** (`dockBottom`) over the offer row,
just above the hint line. Not by the pointer, since the next tap is aimed at
the board, and not over the hint, which carries the replace warning. It is
`pointer-events: none`, so taps go through, and it goes when the selection does.

### Second wave: Herald, new upgrades, Freeze, AI fit
- **Herald** (star, 1/5, classes `herald` + `support`): innate `rally` trait.
  At round start every Herald *behind* the front adds its rally (3, +1 every 2
  levels) to the front unit's attack (post-pass at the end of `applyAugments`,
  shown as a "📯 Herald's rally" detail). Sim: 47-48% holder rate, in line with
  other units. It's the first unit worth buying for the back of the row.
- **Lancer** (kite, 3/5, class `lancer`): innate `pierce`. Each landed main
  blow also strikes the unit behind its target for 1 (+1 every 2 levels),
  queued in `strike` like cleave and tagged `"pierce"`, so a dodge doesn't
  impale. Played back as a side hit ("Impale N"). Sim 51%. At 3/4 it measured
  47.5%.
- **Medic** (cross, 1/6, classes `medic` + `support`): innate `mend`. After
  each exchange, every living Medic behind its lane's front heals that front
  3 (+1 every 2 levels), `MEND_USES` = 3 times a round. Uncapped it could
  out-heal a low-attack front indefinitely and run the round to the tick cap.
  Heal events carry `source`, which the feed names. Sim 51%. At 2 healing it
  measured 46%.
- Lancer and Medic deliberately don't share classes with existing units, so
  "Strikers and Berserkers" style augments don't silently cover them.
- **Squire offer weight** (`offerWeight` in match.ts): with nine offered
  types Squires came up 1 card in 9, rarely reached knighthood and won 36-44%.
  `rollOffer` is now weighted: Squires `SQUIRE_WEIGHT` 1.3, +`SQUIRE_AUGMENT_WEIGHT`
  0.5 while that side holds a Squire upgrade, so the upgrades find you Squires.
  Every caller passes the side's augment state (app, AI, sim). SQUIRE_AUGMENT_WEIGHT
  was then cut 0.5 -> 0.2 and the AI's Squire `NUDGE` 1 -> 0.5: under AI picks the
  Squire upgrades had reached 63-65% (stacked offer weight + pick nudge), now
  55-58%; with random picks 48-51%. Sim: Squire 47.7%. At 1.6/0.8
  Knights became so common their holders won 71%. Knight holders still win ~70%:
  partly selection (a Knight means the plan already paid off), up from ~60%.
- **Character size**: `CHAR_SIZE` 0.58 of the slot height (was 0.78) so body
  and legs fit inside the row; centre `CHAR_X` and text column `TEXT_X` moved in.
- **MVP tally** (`game/stats.ts`): every tally's `key`/`name`/`merges` is
  refreshed from the roster each round, so a knighted Squire is credited as a
  Knight and the result screen shows the MVP's level in its tier colour.
- **MVP dance**: the result screen's MVP portrait loops the `dance` pose (clock-
  driven like idle; `UnitPortrait pose`): a hop on every beat, a lean and leg
  kick to alternating sides, its weapon waved overhead, happy eyes. It plays
  under prefers-reduced-motion too, at half amplitude (other portraits go
  still), and draws into a `bleed` margin past its box so it isn't clipped.
- **Reroll after picks**: the unit reroll stays available once both picks are
  made, to find cards worth freezing for next round.
- **Mixed formation** needs 5 unit types (was 4; with nine offered types 4 came
  too easily, 54.7%). Now 49%.
- **New upgrades** (all balanced with `pnpm sim 20000 --aug=random`):
  Holdout (common, `SideMods.holdout`, last unit takes 2 less per hit, ~45%:
  rarely decisive, insensitive to size), Full ranks (common, +1 attack if every
  slot is filled, 53%; +1/+1 measured 58%), Tactician (rare, 4 upgrade cards via
  `augmentOfferCount`; unmeasurable with random picks), Last light (rare,
  `SideMods.lastLight`, combat tops the last unit up by 2 attack per fallen ally
  and emits a labelled buff, 50%), Sabotage (epic, `SABOTAGE_ATK` = 4 off the
  enemy front at round start, applied in `refreshForRound` after both sides,
  51.5%), Living fortress (epic, Fortify fires for fallen Bulwarks too, in
  `settleRound`, 56%; an extra +1 attack measured 59-71%).
- **Freeze**: offer cards can be frozen (❄ beside each card). A frozen slot
  survives rerolls and carries into the next round's offer in the same slot,
  until taken (which unfreezes it; undo restores it) or unfrozen. Saved with
  the match (`SavedMatch.frozen`), re-saved on each toggle via `lastSave`. One
  upgrade can be frozen per choice (`AugmentState.frozen`): `offerAugments`
  deals it first at the next choice, whatever the tier, until taken. Player
  only; the AI doesn't freeze.
- **AI fit** (`augmentFit` in match.ts): Normal's unit picks add `FIT_BONUS`
  (1) per held augment built around a type, so it fields the units its
  augments need. Skirmisher and Striker upgrades still sit at 44-46%: those
  units are rarely fielded even so (~10-15% of rows), since a full row merges
  into types it already owns.
- **Sim reports** now include unit level percentiles and a per-unit holder
  win rate (sides fielding that type at match end).
- **Legs**: every character has two stubby legs with light shoes
  (`drawLegs` in characters.ts), drawn behind the body, with
  an idle shuffle, a scamper when attacking, buckled knees when hit, tucked
  feet when hopping and a splay when falling. Characters sit 0.12R higher to
  keep their feet in the row. Enemies are drawn upright too (they used to be
  flipped vertically, which read as upside down once they had legs); only the
  forward lunge offset (`fwd * s`) points toward the opponent.

### Battle presentation
- **Damage numbers** (`drawNumbers` in `board/fx.ts`) are large, red-gradient
  and heavily outlined, with a brief glow; the killing blow is bigger still
  ("☠ −N"). Heals, blocks and bounty stay smaller beside them.
- **Battle focus** (`RenderState.battle`): the clash zone glows red above and
  blue below the centre line, each side's front unit (first living unit in the
  lane) gets a halo in its colour, and the queue behind it is drawn at half
  opacity. Dying units keep full opacity so their fall reads.
- **Battle feed**: while a round plays, the offer row shows the last
  `FEED_MAX` events: hits, dodges, deaths and every ability label, with unit
  names coloured by side. Fed from the same playback beats as the effects
  (`pushFeed` in `clash`, the side-hit sequence and `abilityLabel`), so it is
  in step with the board. Side-hit victims are announced after their own hit.
- **Level tiers** (`LEVEL_TIERS` in `board/render.ts`) colour the level badge:
  1 faint grey, 2 green, 5 blue, 10 purple, 15 gold, 20 red. Set from
  `pnpm sim`'s level report: median unit ends at 5, a row's strongest at 13
  (p90 19, p99 ~25).
- **Empty slots** are a faint wash with a dotted edge and their queue position
  number, so filled slots stand out. The page backdrop is gradients only:
  enemy red light from above, yours from below, a woven floor, a vignette.
- **Side panels** (`ui/SidePanels.tsx`, ≥1100px wide only): your upgrades and
  match tallies on the left, the enemy's upgrades and difficulty on the right.

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
level badge leave free.

### Battle playback is chained, not pre-scheduled
The HUD speed button **cycles 1× → 2× → 3× → 1×** (`SPEEDS` in game/save.ts),
persisted with the settings so it outlives the match. One button rather than
three: it's pressed mid-battle and the HUD row is already tight on a phone, so
the label always names the speed in force and the tooltip names the next one.
Speed was a `fast` boolean (3× only) until 2× was added; `loadSettings`
migrates both the old blob field and the older `duel-deck:fast` key to 3×,
rather than quietly resetting anyone who had it on. Measured on one round:
19.8s / 8.3s / 6.0s.

Being changeable *mid-battle* dictated the playback structure: frames used to
be scheduled up front at absolute offsets, which meant a speed change could
only take effect by re-running the effect — restarting the round from the first
blow. Playback now chains one timeout per frame and re-reads `speedRef` at each
boundary, so a change applies from the next beat with no replay. `speedRef` is
a ref rather than the `speed` prop precisely so it stays out of the effect's
dependency array; putting `speed` in there would reintroduce the restart.

### Combat keywords and side mods
Augments can grant more than stat deltas. `traits` puts combat keywords on a
unit (`UnitTraits`: first strike, cleave, thorns, lifesteal, damage reduction,
executioner, last breath), rebuilt each round alongside the stats and read by
`resolveRound`, which tags the resulting events so playback can show them.
`mods` are side-wide (`SideMods`: bounty, capacity) and land on `board.mods` in
`refreshForRound`. Capacity is always set explicitly per side — Reinforcements
grows the board to 6 rows, and an implicit default would hand the other side
the extra slot too. Round-end bookkeeping (Momentum, Rally, kills for Overwhelm,
Veteran growth) lives in `game/roundEnd.ts`, shared by the app and `pnpm sim`.

First strike and Charge are both "first swing of the round" effects, tracked
per unit in `RoundState.opened` — so a Striker that steps up mid-round gets
them too, not just the one leading at tick 0 (that was a bug). The front-slot
augments (Vanguard's edge, Champion, Shield wall, Spearwall) are different: they
apply to the unit leading the row when the round starts, recomputed each round,
and their descriptions say so.

### Unit abilities
Every unit has an innate ability (`UnitStats.ability` for display;
`innateTraits(key, merges)` for the mechanics, seeded into `unit.traits` before
augments each round). Abilities grow with merges (`ability.scaling`), and that
one function feeds combat, the hover breakdown and the Units screen alike.
Evasion stays at one dodge — a second made merged Skirmishers near-untouchable
(63–84%) — so its merges add a riposte instead. Abilities: Guard
Bodyguard and Squire Pass the torch (`deathBuff` on the unit behind), Knight
Armour + Last rally (`deathBuff` on all allies), Striker Charge
(`openingBonus`), Skirmisher Evasion (`dodgeFirst`), Bulwark Fortify
(`growOnSurvive`, applied in `settleRound`), Berserker Overflow (`cleave`; the
Cleave upgrade adds `cleaveFull`). Stats were scaled down ~⅓ alongside, and
units were tuned with a round-robin of single-unit builds (every one within
~44–56% of the others). The stalemate guard counts swings, not landed damage,
so two dodging fronts don't end a round as a draw.

### Squire → Knight
The late-game unit. Player-facing rule: **a Squire is knighted at level 7**
(`KNIGHT_LEVEL`; level 6 with Early knighthood). Internally that is `KNIGHT_AT`
= 6 merges. Every Squire, either side, shows the countdown on its row ("⚜ N more
to Knight", shortened to "⚜ N" or dropped when the stats leave no room) and on
its info card. Both read `squireToGo` in App.tsx, which uses that side's own
`knightAt`, so Early knighthood is counted. It reaches the renderer as the
injected `promoteIn` resolver, like `auraIcon`. A Squire is the weakest body in the offer (2/4), but its
merges don't use `MERGE_RATIO`: the n-th merge into a Squire line adds
n × `SQUIRE_STEP` (`engine/units.ts`), so each is bigger than the last. At
`KNIGHT_AT` merges (`knightAt` — Early knighthood lowers it by one) it is
promoted in place to a Knight (`promoteToKnight`): same id, merges and grown
stats, plus `KNIGHTING_BONUS` and innate `damageReduction` 1 (`UnitStats.traits`,
seeded into `unit.traits` before augments each round). Knights are never offered
(`OFFER_KEYS`), and Squires keep merging into them (`mergesInto`). Promotion
runs in `refreshForRound`, which follows every merge path, so none can skip it.

Balancing note: the sim showed an AI that leans into one ever-growing unit wins
far more often regardless of the unit's stats — concentration is the dominant
plan in front-only combat, and the Squire's escalation amplifies it. The AI
values a fresh Squire like a mid-tier pick (`SQUIRE_PICK_VALUE`) and only
nudges it up when holding a Squire augment; raising that nudge makes Squire
augments read far stronger than they are.

### Rarity, rerolls and the AI's row
Augments carry a `rarity` (absent = common). `offerAugments(state, n, tier)`
only offers rarities unlocked by `upgradeTier(round)` — commons from the first
upgrade round, rares from the second, epics from the third (`RARITY_UNLOCK`) —
and the round a rarity unlocks guarantees one card of it. Each upgrade choice
has `AUGMENT_REROLLS` (2); unit picking has `UNIT_REROLLS` (1) per round, plus
one with Scout, rerolling only the cards not yet taken (undo can't cross it).
This rarity ladder is the answer to "should offers scale over a long match"
(settled): with upgrades every 3rd round, rares arrive at round 6 and epics at
round 9. Nothing unlocks after that, so a median 18-round match spends its
second half at full power. The AI fills its row before merging (`deployToBack`): merging first left it
fielding two or three bodies, and with survivor damage empty slots are lost
damage. Hovering a unit shows `UnitInfo`, built from `unit.auraDetails`, which
`applyAugments` rebuilds with the stats.

### Ability beats
Charge and death buffs (Bodyguard, Pass the torch, Last rally) get their own
`"ability"` frame (`ABILITY_MS`) — Charge before the lunge, death buffs after
the clash — so the beam/flame/banner, the named label ("Bodyguard +3♥") and the
recipient's stat gain (`"stat-gain"` fx, "+2⚔") can be read before the battle
moves on. In-swing abilities (dodge, Overflow, Riposte) extend the clash hold
by `ABILITY_HOLD_MS` instead. Labels carry the actual numbers applied.

Unit stats on the board change in step with the beats, not at the tick's end:
`applyEvents`/`applyEvent` in App.tsx replay a tick's events (hits, heals,
buffs) onto the shown board, and `liveBoard` applies delayed ones (a cleave, a
buff arriving) the moment their number appears. So a hit's health loss shows
before any ability fires, and a buff's gain shows when it lands. The tick's
engine snapshot is still authoritative at settle (the replay matches it exactly).

### Side-hit sequencing and the end screen
Side hits (Overflow, Thorns, Riposte, Last breath) play one at a time after the
main blows (`EXTRA_GAP_MS`, `EXTRA_STEP_MS`): Overflow's shockwave sets off from
the unit it killed only once that unit's damage is up, and its own damage lands
on arrival (`OVERFLOW_TRAVEL_MS`). The clash holds until the sequence is done.

`game/stats.ts` keeps match tallies (`recordRound`, called in playback's
`finish`), saved with the match. Every unit on either row gets a tally (damage
dealt and taken, kills, falls, rounds fielded, last round seen; `foes` holds
the enemy's), shown on the result screen's unit ledger with Your / Enemy tabs.
Units that left the row (merged away, replaced) stay listed, faded. `ResultPanel` shows them full-window over a
continuous backdrop (confetti rain and rays for a win, embers for a loss),
with an MVP (most damage) and the upgrades taken.

### AI difficulty
Chosen on a start screen (`DifficultyPanel`) when a match begins: on a fresh
load with no save, and after New match. The round-1 banner waits for the pick.
It's fixed for the match and saved with it (a resumed save skips the start
screen); the ☰ menu just shows it. The last choice is remembered
(`duel-deck:difficulty`) and marked `last pick` next time. `aiCommit(..., { difficulty, oppAug, scout })`:
- **Easy** — two random cards, no rerolls, no arranging; random upgrade.
- **Normal** — the value-table AI described above.
- **Hard** — searches every ordered pair of offer cards × two ways of adding
  (fill-first, or merge into its most-merged match) × four formations,
  simulates each with `resolveRound` against `scout` (your row as it stood at
  the start of the round — never this round's picks) and keeps the best. It
  rerolls when even the best line loses, and gets one extra upgrade reroll
  with a higher reroll bar.
Hard also predicts the opponent's two picks this round (Normal's logic run on
the scouted row, with cards it rolls itself: no hidden information) and scores
each candidate against both the scouted and the predicted row. Without that it
had slipped to 55-60% as units gained mid-round abilities and Normal improved.
Sim (`--player=` / `--enemy=`, 2026-10-08): Normal beats Easy ~94%; Hard beats Normal ~68%.

### Screens: App owns the match, Game plays it
`App.tsx` is the shell — title screen, settings, the saved match, the online
session — and `ui/Game.tsx` is one match from round 1 to the result. Starting a
match mounts a fresh `Game` keyed by a run id; leaving unmounts it. That split
is why "New match" doesn't reset state in place: resetting means reproducing
every piece of match state by hand and missing one, whereas dropping the
component can't. The opponent used to be chosen by `DifficultyPanel` *inside*
the match; it's picked on the title screen now, so a match starts already
knowing what it is. ☰ has both "Main menu" (keeps the save) and "New match"
(clears it, with a confirm).

### Online duel (online/room.ts, ui/Lobby.tsx, packages/backend-client)
Firebase Realtime Database, project `roguelike-games`, via the shared
`@pwa-games/backend-client` (lazy-loaded, so a CPU match never downloads it —
the build puts it in its own chunks). Rooms at `rooms/duel-deck/<CODE>`,
5-character codes, `?join=CODE` invite links, presence for disconnects, `left`
to close a room. Host is `p1`.

**Nothing is streamed and nobody is authoritative.** Duel Deck is simultaneous,
so there are no turns to relay: both players build a row in private, press
Battle, and each device writes only its own `commits/<p>`. Once both commits
for the round are in, *each device assembles the same round itself* and runs
`resolveRound`. The engine has no randomness (no `Math.random` anywhere under
`src/engine`), so the two devices produce the same blows, deaths and HP loss —
there is no result to send, and no host to trust. This is the
`commit → resolveRound` boundary the tracker always named as the netcode seam.

Three things make that safe, and none are obvious:
- **The engine is side-symmetric.** Each device is `player` on its own screen,
  so the two boards are mirror images. `combat.ts` does swing player-before-
  enemy (`frontExchange`) and does break a mutual-zero in the player's favour
  (`matchWinner`), but that branch is unreachable — only the round *winner*
  damages a pool, so two pools can't empty in one round.
- **Both sides' upgrades must travel**, because effective stats depend on them
  (Sabotage hits the enemy front, Overwhelm reads relative unit counts), so the
  commit carries the row *and* the `AugmentState`.
- **Unit ids don't survive the trip.** Both devices number units from zero on
  every page load, so the opponent's "u3" would collide with ours — and ids key
  drags, poses, playback and augment grants. `unpackCommit` mints fresh local
  ids. That breaks `AugmentState.grants`, which is id-keyed, so a grant travels
  on the `WireUnit` that carries it and is re-keyed on arrival. Nothing sends an
  id back, so local-only ids are safe.

`pnpm netcheck` is the guard: it plays whole matches between two simulated
devices exchanging commits through a JSON round-trip that strips empty values
the way the database does, and fails on any disagreement. It currently reports
0 desyncs over ~2800 rounds.

Other notes: an online match is **not** saved to `localStorage` (half of it is
the opponent's; `save()` is a no-op online) — a reload rejoins via the room, and
`duel-deck:online` holds the code and side. Waiting on the other player is a
`"waiting"` phase shown where the offer cards sit, so the board keeps its
height. Each side rolls its own unit and upgrade offers; they're independent and
need no shared RNG. There's no in-room rematch yet — both players return to the
title and host again. Rules live in `database.rules.json` at the repo root and
must be deployed (`firebase deploy --only database`) before online works at all;
without the `duel-deck` block every write is a 401.

### Sound (game/sound.ts)
Synthesized, no audio files — oscillators and one noise buffer, like
knock-hockey's. Call sites name the *event* (`sfx("death")`), never the
waveform, so the palette can be retuned or swapped for samples without touching
playback. Unlocked from the first real click (Play, or turning sound on), since
browsers won't start audio otherwise; stored in `duel-deck:settings` and
toggled in two places — the title screen and ☰, since a battle is exactly when
you want to silence it and the title is a whole match away.

One rule worth keeping: **one sound per beat, not per event.** Both fronts
swing at once, so playing a clang per `attack` gives four overlapping hits that
read as noise rather than as a big blow. The clash picks a single sound from
the loudest damage in the beat (`BIG_HIT` switches it to the heavier one), and
death is delayed ~90ms so the fall reads as the consequence of the impact.
Knighting deliberately overrides the merge sound that triggers it.

### Save and resume
The match is saved to `localStorage` (`duel-deck:match`) at the start of every
pick phase — never mid-battle — so a reload lands back at the start of the
current round's picks. Unit ids come from a module counter that restarts at 0
per page load, so restoring a save calls `reserveUnitIds` to move it past the
restored ids; without that, new units would alias restored ones (ids key drags,
playback and augment grants).

### Balance simulation
`pnpm sim [matches] [--draw=…] [--cap=…] [--player=…] [--enemy=…]` (`scripts/sim.ts`) plays AI-vs-AI
matches headlessly through the real engine and reports match length, draw rate
and damage by round, and per-augment holder win rate. It's how the merge
question was settled: merging first beats placing ~59% of the time, because one
concentrated front unit wastes less damage to overkill.

### Draws (settled: no tiebreak rule)
A round where both rows die in the same tick deals no damage. After the
abilities/rescale pass this is 3.9% of rounds overall (`pnpm sim 5000`,
Normal vs Normal): 21% of round 1, 9% of round 2, then 2-4% from round 3 on.
Early-round draws are accepted as fine, so the `--draw=more-damage|both` rules
in the sim are not used in the game. Revisit only if late-round draws climb.

## Deferred (not v1)

- Ranged units, multi-lane boards, economy/currency, scaling/rarity tiers.
- In-room rematch, and a turn timer (online currently waits indefinitely,
  which was a deliberate call — see "Online duel").
- Board-synergy-aware AI (picks that build toward an augment it holds).

## Open questions

- **Augment balance.** After the balance pass every augment's holder win rate
  sat at 46-56% under `pnpm sim 60000 --aug=random` (was 41-95%). Since the
  abilities pass it has drifted to 44-57% across 41 augments: Bloodpact top at
  57% (accepted — the 80 HP cost is 40% of the pool), Legion/Champion 56%;
  Precision strikes, First strike, Field medic, Scout, Lifesteal and Steady
  footing bottom at 44%. Four were then buffed (Steady footing +1⚔/+2♥,
  Precision strikes +2⚔/+1♥, Lifesteal 100%, Field medic 14 HP) but the sim
  can't confirm the unit-specific ones: the AI never builds toward its
  augments, so even +10/+10 Steady footing only reached 47%. Field medic barely
  responds to heal size (8→26 HP moved it 44→46%). Re-measure once the AI
  picks units to suit its augments, or judge these in playtesting. Always
  balance with `--aug=random`: the default score-based picking leaves weak
  augments nearly unsampled. Tank augments (Iron will, Shield wall, Tank wall)
  and Scout read low partly because of the AI, which always fronts its highest-
  ATK units and only rerolls when stuck — a human may get more from them.

### Deploy and updates
Live at https://duel-deck-game.web.app (Firebase project `roguelike-games`;
see the root CLAUDE.md). `pnpm run release` builds and deploys. The service
worker is in `prompt` mode: a new deploy downloads in the background and
`ui/UpdatePrompt.tsx` shows an Update toast (checked on launch, on returning to
the foreground and hourly), so a build never swaps mid-battle and iOS installs
that are never fully closed still update. Bump `version` in package.json for
releases. The build writes `/version.json` (version + deploy time; no-cache,
never precached). The ☰ menu's About section (`ui/MenuPanel.tsx`) shows this
build's version and deploy time beside the latest deploy's, and offers Check
for updates / Update now. Update state is shared via `src/pwa.ts`.
`duel-deck-hosting` in `.claude/launch.json` serves `dist` through the Hosting
emulator (port 5176) to test the service worker and headers locally.

### Layout
The app is exactly one screen (`height: 100dvh`, no page scroll): the board's
stage is `flex: 1` and takes whatever height the chrome leaves, and the canvas
reads its client size each frame. The rows that come and go between phases (round
log, pick label, hint, offer cards) always reserve their space, so the board
keeps one size from picks through battle. Pinch and double-tap zoom are off
(viewport meta, `touch-action: manipulation`, and iOS gesture events blocked in
`main.tsx`, since Safari ignores `user-scalable=no`).

Phones (≤480px, `COMPACT_QUERY` in App.tsx matches App.css) get a one-row HUD
(Commit, speed, Undo, ⬆ upgrades), five offer cards across with smaller
portraits, and a board sized so the pick phase fits a 375×667 screen without
scrolling. Units, rules, sound, AI difficulty, Main menu and New match (with a
confirm) live in the ☰ menu.

**The board's size is set by leftover *height*, never by width.** `layout()`
takes `laneW = min(canvasWidth, MAX_LANE_W 320, rowH * MAX_LANE_ASPECT 8)`, and
on one lane the 320px cap almost always wins — so a wider window adds nothing
and the only lever is `rowH`, which is `canvasHeight / (depth * 2)`. Anything
that frees vertical space makes the board bigger; anything else does not.

That gives exactly two layouts, and they are complementary — there is no band
with full-size chrome in a single column, which was the worst of both:

- **Under 45rem (720px): one column, compact chrome.** The phone treatment
  (one-row HUD, five small offer cards, smaller portraits) now runs all the way
  up to the two-column breakpoint, not just to 480px. `COMPACT_QUERY` in
  Game.tsx must match this query in App.css.
- **45rem and up (and ≥34rem tall): two columns** — board on the left, HUD,
  pick row, offer cards and hint stacked on the right (`.app__controls`).
  720px is where the controls column can still hold five cards at full portrait
  size (~340px) beside the 320px board; below that the cards are worse off than
  the board gains. Below the breakpoint `.app__controls` is `display: contents`
  so the wrapper vanishes and the column layout is exactly what it always was.

Measured `rowH`: 42 at 500-719px (one column), 61 at 730px, 58 at 1024×768,
71 at 1440×900, 84 at 768×1024. It now rises monotonically with available
space instead of collapsing to 36 in the middle.

Two gotchas the grid cost: `.app`'s flex `align-items: center` has to become
`stretch`, or the stage centres in its track instead of absorbing the `1fr` row
and collapses; and the fixed side panels were positioned for a ~34rem centre
column (`calc(50% - 33rem)`), so against a ~52rem one they need both a wider
offset and a higher breakpoint (88rem) or they sit on top of the board.
