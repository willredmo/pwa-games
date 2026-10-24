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

**Compact and capped (2026-10-23, a bug report):** the full card grew upward
from the hint and, with an 8-slot row and six upgrades, covered the bottom
slots: the ones the player was choosing between. A picked-up card is now
compact (`UnitInfoCompact`: name, stats, level, class, ability name, upgrade
icons; an offer's adds its ability text), and `dockFor` in Game places it
centred over the hint's column (the controls column on wide screens), with a
`maxHeight` of the room between the board and the hint wherever the two share
a column, so it can never reach a slot. Game re-renders on resize so it follows
rotation. Checked at 320×568, 402×812, 768×1024 and 1280×800: always clear of
the board. Hover and long-press keep the full card, which got smaller overall
(0.7rem, 15rem wide, one line per upgrade) and is clamped on screen
horizontally (it used to flip off the left edge in narrow windows).

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
  A slot's contents stop growing at `UNIT_MAX_H` (52px): rows still fill a big
  screen, but `drawUnit` draws its contents in a space scaled by `contentScale`,
  so characters and stats stay readable-sized instead of filling 80px rows.
  Phones (rowH ~42) are unaffected. Each unit's name is led by its class glyph
  (`classIcon` in `RenderState`).
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
  the match (`SavedMatch.frozen`), re-saved on each toggle via `lastSave`. Up
  to two upgrades can be frozen (`MAX_FROZEN_AUGMENTS`, `AugmentState.frozen`,
  read via `frozenAugments` since old saves hold a single string):
  `offerAugments` deals them first at the next choice, whatever the tier, until
  taken. The third ❄ is disabled; all three would let a player bank a whole hand
  and skip the rarity ladder. Player only; the AI doesn't freeze.
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
  It can be turned off in ☰ (`Settings.battleLog`); the board and damage
  numbers still carry everything it says. Two details: the row **keeps its
  reserved height** when the feed is hidden, because collapsing it would
  resize the board mid-battle — the one thing the layout exists to prevent;
  and `pushFeed` itself is gated on the setting rather than the render, since
  it fires several times a beat and would otherwise be a stream of state
  updates whose result is never shown. (The one-line round summary under the
  board, `.app__log`, is a separate thing and always shown.)
- **Level tiers** (`LEVEL_TIERS` in `board/render.ts`) colour the level badge:
  1 faint grey, 2 green, 5 blue, 10 purple, 15 gold, 20 red. Set from
  `pnpm sim`'s level report: median unit ends at 5, a row's strongest at 13
  (p90 19, p99 ~25).
- **Empty slots** are a faint wash with a dotted edge and their queue position
  number, so filled slots stand out. The page backdrop is gradients only:
  enemy red light from above, yours from below, a woven floor, a vignette.
- **Side panels** (`ui/SidePanels.tsx`, ≥1100px wide only): your upgrades and
  match tallies on the left, the enemy's upgrades and difficulty on the right.

### Losing explodes your row
When the match is lost (`matchWinner === ENEMY`, so online too), every unit on
your row bursts and then one blast goes off from the middle of the row
(`explodeRow` in Game.tsx, fx kind `"explosion"` in board/fx.ts, `sfx("explode")`):
white flash, a fireball of layered radial gradients that cools from white to
red, two shockwave rings, side-coloured debris, sparks, then smoke and rising
embers. The result screen waits `EXPLOSION_DELAY_MS` + `EXPLOSION_MS` longer,
and its own embers carry on from there. Built to look the same everywhere:
plain Canvas 2D only (no `ctx.filter`, which Safari ignores; blur is faked with
gradients), particles integrated by frame time so 120 Hz phones don't run it
fast, ~130 particles. Shake is the fx layer's canvas translate, not a CSS
transform. Android vibrates (`navigator.vibrate`, only with sound on); iOS has
no vibration API, so it's skipped. Reduced motion keeps the flash and fireball
and drops the shake and most debris. A hidden browser pane doesn't run rAF, so
it was checked by stepping an `FxLayer` by hand onto a test canvas.
### Winning blows up the enemy's HP bar; the end screen celebrates and mopes
When you win the match, a beat after the last blow the enemy's HP bar explodes
in slow motion (`ui/HpBarBlast.tsx`): the same `"explosion"` fx as a loss plus
smaller bursts along the bar, on a full-screen canvas whose fx clock runs at
`SLOW` (0.4) of real time, the boom pitched down (`sfx(..., rate 0.6)`), the
bar hidden in the flash (`HpBar blown`). It ignores the battle speed: it
happens once, at the very end. The result screen waits `HP_BAR_BLAST_MS`.

On the result screen the winning side's units dance and the losing side's are
sad (`pose: "sad"` in characters.ts: slumped, slow sway, droopy eyes with the
inner brows raised, a frown and a tear rolling down), in the unit table's
portraits and the MVP's. Both poses play under reduced motion at half strength.
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
one function feeds combat, the hover breakdown and the Codex alike.
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

### Level cap, Mastery and Drill
Units stop at **level 10** (`MAX_LEVEL`, `MAX_MERGES` = 9 in `engine/units.ts`).
A cap of 12 was tried on 2026-10-16 and dropped for earned slots (below); it
had lifted Knight rows to 66% (`POST_KNIGHT_STEP` 4 brought them back to 59%).

**Earned slots:** every unit that reaches the cap opens one more slot in its
side's row (`Board.earnedSlots`, set in `refreshForRound` as the most maxed
units the side has had, up to `MAX_EARNED_SLOTS` 3, so a row of 8). It never
shrinks, so replacing a maxed unit keeps its slot. This replaced the
Reinforcements upgrade (retired) as the answer to long matches stalling on a
full, maxed row. Ascendant keeps its single slot. Sim: median match 20 rounds,
Knight rows 62%. On a 375×667 phone a full 8-slot row on both sides draws
units ~13px tall; 375×812 is fine (~24px).
`canAbsorb` is the one rule (like with like, within the cap), used by
`canMerge`/`mergePlaced` in board.ts (so the AI and every merge path obey it),
by the drop rules in Game.tsx and by the AI's pick values. Placed-onto-placed
merges add levels, so two level-6 units can't fold into a 12. A maxed twin
can't take a card: with room the drop inserts beside it, with a full row it's
not a target at all (replacing a maxed unit with its own type would only throw
its levels away); the board label reads "MAX LEVEL 10". `mergeCapFor` returns
Infinity for a side whose mods say `uncapped` (Ascendant).

At the cap a unit's ability takes its **Mastery** form, a branch in
`innateTraits`, so combat, the info card and the Codex share it
(`UnitStats.mastery` is the text): Guard's Bodyguard covers every ally;
Striker charges each new enemy (`chargeEach`: Charge keyed per target);
Skirmisher dodges twice; Bulwark's Fortify adds +1 attack; Berserker's
Overflow chains (`cleaveChain`: an enemy its Overflow kills passes the rest
on; it was uncapped overflow until 2026-10-14, the same as the Cleave upgrade); Herald's rally adds as much health
(`rallyHp`); Lancer impales two deep (`pierceDeeper` 1, units beyond the
first); Medic mends 5 times (`mendMore` 2, mends beyond the usual 3); Knight's armour is 2. The badge reads gold "MAX"
(`levelLabel`); `LEVEL_TIERS` became 1/2/5/8/10/11+, red being past the cap.
Reaching it gets a banner and the knighting sound.

**Drill:** once every slot holds a maxed unit (`rowMaxed` in match.ts), picks
can only replace, so each pick left unspent at Battle gives every unit +1
attack for that round (`drillFor` → `AugmentState.drill`, applied in
`applyAugments`, cleared at the next round, sent with the online commit). Not
permanent stats (that would undo the cap) and not healing (two maxed rows could
stall). The Battle button skips the "picks left?" confirm then.

Sim after the cap (`pnpm sim 12000 --aug=random`, 2026-10-13): units 44-59%
(Knight 59%, Skirmisher 58%; Squire 44% as an unknighted Squire at match end),
upgrades 43-60% (Bloodpact, Champion, Legion top; Squire upgrades fell to
44-45%), median match 21 rounds, median unit level 7 and most rows' best unit
at 10, Drill in 0.7% of rounds.
### Match settings (title screen, and the host's for a duel)
`MatchRules` (game/match.ts): starting health, **Easy mode**, **Class
bonuses** and **Upgrades**. Set in the title screen's collapsible "Match
settings" block (`Settings`), used for a new CPU match and for a duel you
host: the room stores them (`Room.rules`, create-only in the database rules,
startHp must be 100/200/300) and the guest's `Session.rules` comes from the
room, so both devices build the same board. They ride on the board
(`Board.startHp`, and `Board.rules` holding only the switches that differ from
the defaults) and are read through `rulesOf`. Easy mode is UI-only: a unit
reroll goes on the undo stack (`UndoEntry.offer`/`unitRerolls`) and undoing it
brings the old cards and the reroll back. Class bonuses off makes
`refreshForRound` pass no synergy and hides the meter; Upgrades off means no
round offers a choice (`isAugmentRound` gated in Game), so the CPU never takes
one either. Non-default settings show on the round-1 banner, in ☰ and in the
host's lobby. The tutorial always uses the defaults. `PROTOCOL` 7.

Starting health: both pools start at 100, 200 (default) or 300 (`START_HP_OPTIONS`), or a
custom whole number from `START_HP_MIN` 20 to `START_HP_MAX` 999 (`clampStartHp`; the
database rules check the same range for a hosted duel's `rules.startHp`),
stored on the board as `Board.startHp` (absent = 200, so
old saves read right) and read through `startHpOf`. Everything that assumed 200
scales with it: the HP bars' max, the result screen's bars, Field medic's heal
cap, Desperate measures (below 30% of the start) and Bloodpact (costs 40% of
the start, `hpCostShare`/`hpCostOf`).
### Ascendant (epic): one unit, no cap
**Retired 2026-10-16** (`retired: true`): not offered, not listed in the Codex
or the upgrades panel (`OFFERED_AUGMENTS`), pending more testing. Its code stays
so a saved match that already holds it still plays; delete the flag to bring it
back.
Taking it trims your row to one unit (`keepChampion` in `refreshForRound`,
choosing `championOf`: the strongest fighter by base attack × health, front-
most on a tie, and a support unit only when the row has nothing else, since
support abilities work from behind the front; deterministic for online). It
was the highest level until 2026-10-15, which let the CPU keep a lone Acolyte.
The AI scores Ascendant by fit (`aiAugmentScore`): never with a support
champion, and up or down with the champion's share of the row's power
(`ASCENDANT_SHARE` 0.35 breaks even). Sim with AI picks: holders 52.5% →
54.6%; with random picks 48.4%. Its and its mods are `capacity: 1` (beating Reinforcements) and
`uncapped`. Uncapped means `mergeCapFor` is Infinity and `canAbsorb` lets
**any** type merge into the champion, since with one slot it would otherwise
only grow on the rare matching card. Merges use the card's own gain (half its
stats; a Squire card its escalation step). The badge goes red past 10.
Two champions kept killing each other in the same blow, and a draw deals
nothing, so mirror matches ran to the 300-round sim cap: now, when both rows
fall together, an Ascendant side's champion still hits the enemy pool for its
attack (`RoundResult.ascendantHit`). Sim (12k, `--aug=random`): holder 47%,
0 cap hits, longest match 53 rounds.
### Warden and Acolyte (support, third wave)
- **Warden** (octagon, 1/6), **Barrier**: from behind the front, the front
  starts the round with a shield of 4 (+1 a level) that soaks damage before
  health (`shield`, spent in `strike` and counted as blocked). Mastery shields
  the unit behind the front too. A shield never adds health, so unlike
  uncapped healing it can't stall a round. Sim (10k, `--aug=random`): 3 + 1
  every 2 levels was 41%, 4 + 1 a level 52%.
- **Acolyte** (teardrop, 1/8), **Lifebond**: from behind the front, it gives
  up half its health and the front gains it for the round (`lifebond` is the
  multiplier on the gift; it still only loses half). Mastery adds +2 attack to
  the front. Sim 50%.
- Sanctuary doubles them (barrier, and the gift) along with rally and mend.
- **Shield bar:** a shielded unit shows `🔰N` after its stats and a blue bar
  under its HP bar (`COLORS.shield`). Combat records what's left on the unit
  (`shieldLeft`, cleared each round by `applyAugments`) and on the hit event,
  so playback drains it blow by blow.
- **Rally, Lifebond and Barrier happen as the round opens,** not in the
  pre-round stats: `openingBuffs` in combat.ts applies them and returns buff
  events (`RoundResult.opening`; Barrier's carry `shield`), which playback
  shows as their own beat before the first blow (the Acolyte's `−N♥`, the
  front's gain, `+N🔰`). While picking, every unit shows its own, unbuffed
  numbers. Playback gives each supporting unit its own beat
  (`OPENING_BEAT_MS`), one after another. `openingBuffs` replaces a unit's `traits` rather than mutating it:
  `resolveRound`'s clone shares traits objects with the caller's board.
### Supports help the unit directly in front (1.7.0); Beacon and Sentinel
Since 1.7.0 every support ability lands on the unit **directly in front** of
the supporter, not the row's front unit (`supportTarget` in combat.ts, used by
`openingBuffs` for Rally, Barrier and Lifebond, and by `mendHeals`). A support
leading the row does nothing. Supporters act front to back, so one gift never
feeds a later one. Barrier's reach (a mastered Warden, Aegis) now extends
*ahead* of the shielded unit, so it adds nothing when the target is the front.

**Beacon** (support, lantern, 1/6), **Relay** (`relay`, a percent): a support
ability reaching it goes on to the unit in front of it at ×1.5 (+0.1 a level,
×3 mastered, `BEACON_MASTER_RELAY`). Beacons in a row chain, each **adding**
its bonus over ×1 (two level-1 Beacons ×2), up to `RELAY_CAP` ×3 in all; the
total is applied once and rounded once (`boost`, never below the original).
Chains multiplied until 2026-10-23 (three mastered ×27): three Beacons and an
Acolyte won 97-100% of rounds against random rows of the same level (a
one-round head-to-head like `pnpm synergy`), the front gaining ~600 health at
level 10; a player reported it. Now 53-68%, below one Beacon and an Acolyte
(74-80%, unchanged, since one Beacon never passed ×3). A cap of 2.5 measured
45-53% but would cut a lone mastered Beacon below its ×3. The bounce labels
show the chain's running total (×1.5, ×2, ×2.5). `pnpm upgrades` checks it.
A Beacon with nobody ahead keeps what it gets. Buff and heal events carry
`via` (the Beacons passed) and `amp`, so playback hops the effect through each
Beacon (`HOP_MS`) and labels it "· Beacon ×1.5". Sanctuary doubles abilities
before any Beacon amplifies them.

**Relay playback** (`relayHops` in Game.tsx, fx kind `"relay"`): a relayed
buff or Mend is shown hop by hop, `RELAY_HOP_MS` (560) each: a gold orb arcs
from the source to the first Beacon (the arc bulges sideways, since rows are
stacked and an upward arc overshot), bounces off it (squash ring, sparkles,
"×1.5 ↑", `sfx("relay")`, the Beacon's attack pose) and flies on, bigger
(`amount`, capped at 2×), to the next Beacon or the unit it lands on, where
the buff applies. A relayed Mend's heal waits for the orb to arrive. The
browser pane doesn't run animation frames while hidden, so it was checked by
stepping an `FxLayer` by hand onto test canvases. Hover text (`UnitInfo`'s
trait lines) says "the unit in front of it" for every support, explains the
Beacon's bounce and gives the Sentinel's reflect with a 10-damage example.

**Sentinel** (defense, pillar, 2/8), **Retaliate** (`reflect`, a percent):
each blow it takes sends `floor(raw × reflect%)` back at the attacker, 40% +5%
a level, 100% mastered. Based on the blow's full strength, before its own
armour or shields, so it scales with the attacker's attack: the counter to a
runaway hitter. Played as a thorns blow (never reflects again, so two
Sentinels can't loop), labelled "Retaliate". Its own class tag (`sentinel`, not
`tank`), so the tank upgrades whose text names Guards and Bulwarks don't
silently cover it.

**CPU arrangement** (`supportOrder` in match.ts): sorted by attack, supports
sat at the back buffing each other. Now: the strongest fighter, every Beacon,
then a support; then each further fighter followed by one support. Normal uses
it; Hard tries it alongside its other formations. `PROTOCOL` 10.

Medic is structurally weaker under this rule: to heal the fighting unit it
must stand right behind it, so when that unit falls the Medic is next in line.
A bigger heal (5) barely moved it (38% → 42%). The fix: **a Medic leading the
row heals itself** (`mendHeals` falls back to the Medic when `supportTarget`
finds nobody ahead). Aegis became the Warden's equivalent (`barrierSelf`).

### Upgrade review (2026-10-20, telemetry Oct 14–20 + sim)
Telemetry is thin (104 matches, one device played 74), so a change needed the
sim and real players to agree, or real players ignoring an upgrade outright:
- **Legion** (sim 58%, real 83% n=40, most taken): +1/+1 now only for units
  of the row's most common class (`legionClass`; a tie goes to the front
  unit's class). Sim 52.6%.
- **Unbreakable** (sim 57%, real 86% n=35): stacked with Knight armour and
  Bastion. Now `minArmour` 1, a floor `reduced()` takes the max of rather than
  a sum. Sim 56%. Armour already never takes a hit below 1.
- **Desperate measures** (taken 0 of 23 offers): below 50% HP, +2 attack
  (was 30%, +3). Sim 54.5%.
- **Aegis**: Barrier's reach ahead was mostly wasted under the new rule; now
  the Warden shields itself (`barrierSelf`). **Bastion** covers Sentinels.
- **Retired** (`retired: true`, code kept for saves): Steady footing (0 of 19),
  Glass cannon pact (0 of 15), Tank wall (4%), Last breath (5%), Bounty (6%, a
  weaker War chest), Counterstrike (4%).
- **New**: Duelist (Skirmishers +1/+2, Riposte +2; replaces Steady footing and
  Counterstrike), Signal fire (Beacons' `relay` +50), Vengeance (Sentinels'
  `reflect` +20). Sim 45–48%, where unit upgrades always read (the CPU rarely
  builds around them).
Left alone: Bloodpact (sim 62% but taken 4% for real; its HP cost was accepted
in an earlier pass), United front and Overwhelm (57-58% sim, no real signal).

Sim after all of it (12000, `--aug=random`): units Knight 63%, Sentinel 50%,
Acolyte 49%, Warden 46%, Herald 46%, Medic 42%, Beacon 40% (n=592); median
match 23 rounds.

**More rares and epics** (same day): there were 38 commons, 12 rares and 5
epics, so from round 9 the same epics kept coming up. Now 33 / 20 / 9.
Promoted to rare (the strongest commons in the sim): Battle fury, United front,
Overwhelm, Mixed formation, Bloodpact. New rares: Phalanx (first two units −1
damage per hit, 47%), Undying (the *back* unit endures once a round; on the
front it measured 61%, now 45%), Twin fangs (Strikers and Berserkers +1 attack
per other one, up to +3; 45%). New epics: Sanctum (Sanctuary's doubling without
the full row, not stacking with it; `doubleSupport`, shared), Iron curtain
(shield of a tenth of base health, at least 2: a quarter measured 71%, an
eighth 59%), Colossus (highest-level unit +3/+6: +4/+8 was 58%), Warlord (+1
attack per 4 upgrades held, up to +2, via `AugmentContext.upgrades`: per 2 up to
+3 was 68%). All four epics now 56–58%, beside Champion and Unbreakable.

**Level cap 12 or 13** was re-tested the same day (8000 games each): Knight
rows 62% at 10, 69% at 12, 72% at 13; match length unchanged (median 23).
So rather than raise the default, the cap became a **match setting**
(`MatchRules.levelCap`, `LEVEL_CAP_OPTIONS` 8/10/12/15, not below 8 because a
Squire is knighted at 7). It rides on the board (`Board.levelCap`, absent = 10,
read through `levelCapOf` in engine/board.ts) like `startHp`, and everything
that read `MAX_LEVEL` now takes the board's cap: `mergeCapFor` (cap − 1
merges), `isMastered`/`innateTraits` (Mastery at the cap, passed into
`applyAugments`), earned slots, the board's level badge (`levelTiers(cap)`:
fixed tiers below, gold at the cap, red past it), `UnitInfo`, the result
screen's chips and the "MAX LEVEL N" drop label. `MAX_LEVEL` stays as the
default. The settings sheet has a Level cap row; the chip and `rulesSummary`
show a non-default cap. Duels use the host's: `rules.levelCap` is create-only
in the database rules (8/10/12/15).

**Fixed 2026-10-21:** `cloneBoard` didn't copy `levelCap`, and the board is
cloned every round (the respawn snapshot), so from round 2 every match fell
back to cap 10: at cap 8 units never mastered, at 12/15 they mastered and
stopped at 10. Any new `Board` field must be added to `cloneBoard`.

### Upgrade buffs (2026-10-23, telemetry 1.7.x + sim)
Upgrades both the sim and real picks (18 matches on 1.7) left for dead,
buffed: **Aegis** (sim 43%, taken 0 of 7) also +2 Barrier; **Devotion**
(46%, 1 of 12) +6 health (was +4); **Twin fangs** (44%, 0 of 3) +1 health
per other Striker/Berserker as well as attack; **War chest** (46.5%, 1 of 9)
8 damage / heal 6 (was 6 / 4); **Squire's drill** (43.5%, 0 of 3) Squires
+2 health, Knights +1/+2 (was +1 health / +1 attack). Sim after (12000,
`--aug=random`): War chest 49.8%, Aegis 46.0%, Twin fangs 46.2%, Devotion
46.4%, Squire's drill 43.9% — the unit upgrades still under-read because the
CPU doesn't build around them. Left alone: Bloodpact 59.6%, United front
58.7%, Overwhelm 56.5% (sim-high but rarely taken for real); Knight 63.6%
and Medic 41.9% as units (real players field Medics and Beacons a lot and
win, so their low sim rate is likely the CPU's play).

### Upgrade check (`pnpm upgrades`, scripts/upgrades.ts)
One small scenario per offered upgrade, through the real engine
(`refreshForRound`, `resolveRound`, `settleRound`), asserting what its
description says, plus the level cap surviving a round at every cap. It fails
if an offered upgrade has no check, so a new upgrade needs one. Run it with
netcheck after any change to upgrades or the engine. The first run
(2026-10-21) found:
- the level cap bug above;
- **Bloodpact online:** the cost was only charged on the taker's device, so
  the two devices disagreed about their health from then on (and about
  Desperate measures). `chargeNewUpgrades` charges it on the other device
  when the commit first shows it; netcheck now keeps one view of both pools
  per device and takes Bloodpact often, and found 238 desyncs without it;
- **Banner of hope** read the Herald's Rally without War horn and at cap 10
  whatever the match's cap. It's now a post-pass in `applyAugments` that reads
  the finished Rally (before any doubling, which then doubles both). Sim 51%;
- the info card wrote nothing for upgrades that only add to an ability
  (Skewer, Stimulant, Blessing, Banner of hope): `describeTraits` has lines
  for those now.
`PROTOCOL` 11 (12 with the 2026-10-23 upgrade buffs).

### Third-wave upgrades (one or two for every unit)
Lancer, the four supports and the Skirmisher had no upgrades built around
them. Added 2026-10-14, each leaning on the unit's ability: Long reach (Impale
+3), Skewer (rare, Impale one deeper), War horn (Rally +3), Banner of hope
(rare, Rally also gives that much health), Triage (Mend +2 and once more),
Stimulant (rare, each Mend also +2 attack on the front, a labelled buff in
`mendHeals`), Thick barrier (Barrier +4), Aegis (rare, Barrier covers one more
the unit behind the front), Devotion (Acolytes +4 health), Blessing (rare,
Lifebond also +3 attack), Counterstrike (Riposte +3) and Choir (rare, Support
units +1/+3). The rares echo Masteries but stack with them (hence
`pierceDeeper`/`mendMore` as extras over the default rather than absolute
values). Sim (12k, `--aug=random`): 45-49%, after buffing the first draft
(43.8-49.4%); the AI rarely fields supports, so like the other unit upgrades
they under-read.

**No upgrade may duplicate a Mastery or be dead on arrival** (review
2026-10-14). Aegis and Cleave used to be exactly a mastered Warden's and
Berserker's ability, so they did nothing for those units: Barrier's reach is
now a count (`barrierReach`) that Aegis adds to, and Berserker's Mastery became
chaining. Ascendant `excludes` the upgrades a one-unit row can't use
(Reinforcements, Mixed formation, United front, Last light, Knight's oath,
Veteran), so `offerAugments` stops dealing them once it's held. Upgrade icons
must also differ from the board's non-upgrade badges (🔥🧱🕊 synergies, 🎯
Drill, 📯🔰💞 supports): Battle fury, Iron will, Precision strikes and
Ascendant were moved off clashing icons. `PROTOCOL` 4.
### Classes and full-row synergies
Every unit has a class (`UnitStats.archetype`, separate from `classes`, the tags
upgrades target): **Attack** Striker, Berserker, Lancer, Skirmisher;
**Defense** Guard, Bulwark, Squire, Knight; **Support** Herald, Medic, Warden, Acolyte. Shown on
offer cards (top corner), info cards and the Codex. When every slot of
a row has at least `SYNERGY_MIN` (5) units, all of one class (not "every
slot", since earned slots grow rows past 5; never a 1-unit Ascendant row), `synergyOf` picks its synergy and
`applyAugments` applies it for the round, badged and itemised (`syn-<class>`
auras): **🔥 Full Assault** +2 attack and Overflow for every unit (half the
overkill, up to 3; Berserkers keep their own); **🧱 Iron Line** a 5 shield on every unit each round
(`IRON_LINE_SHIELD`, shown on the shield bar); **🕊 Sanctuary** every support
ability counts twice (Herald rally and its Mastery health, Medic mend). The
`endure` trait (front survives a lethal blow on 1) is still in combat but unused. The round
banner announces it. While picking, a **synergy meter** leads the pick label
(`SynergyMeter` in Game.tsx): the class the row is closest to (most units;
ties go to the front unit's class), one pip per slot (filled for that class,
hatched for another, hollow for empty) and "N more", "swap N" or the
synergy's name in gold once it's on. It shows once two units share a class.
Offer cards of that class get a glowing class badge. Completing it while
picking gets a banner with the bonus, the knighting sound and sparkles on
every unit; breaking it (a replace) gets a quiet banner. Banners with a second
line (`sub`, the synergy's effect) stay up ~3 s instead of 1.7; emoji in a
banner are wrapped (`withEmoji`) since the gradient text turns them to blobs. Only pick-to-pick
changes count, since the board also changes as units fall in battle. Normal leans toward a class once 3 share it
(`SYNERGY_NUDGE`); Hard finds synergies through its search.

Tuning: `pnpm synergy [trials] [--level=N]` (scripts/synergy.ts) plays a
one-class row with its synergy on vs off, one round against random rows at
the same level, and prints what it's worth. 2026-10-15, levels 2 / 5 / 8:
Assault (+2 attack, Overflow for all) +30 / +20 / +18; Iron Line (5 shield) +40 /
+33 / +28; Sanctuary +35 / +48 / +57 (an all-Support row is weak without it:
44% / 28% / 12%). Before: Assault at +1 attack +22 / +18 / +18, felt weak
because true strike only matters against Skirmishers; Iron Line at +3 health
+27 / +24 / +15, fading as health grows. True strike was dropped (it only
matters against Skirmishers; the trait is still in combat, unused, like
`endure`). Tried and dropped: +2 attack with true strike (+28 / +18 / +18),
with Charge +2 for all (+29 / +18 / +17), plain +2 attack (fades to +12 at
level 8), and First strike for all (99% on: far too strong). A permanent +1 health per round won was the other Iron Line idea.
At match level (`pnpm sim 10000 --aug=random`) Iron Line
holders win 49% (45% at +2, 56% at +4); synergies fire in ~4% of AI rows
(Defense 3.8%, Attack 0.8%, Support never: the AI doesn't build five
supports), so real-player telemetry will be the better measure.
### Codex (ui/Overlays.tsx `CodexView`)
The reference screen, from the title screen and ☰ (it was "Units"; renamed so
it can hold more than units). Two tabs: **Units**, with the three classes and
their full-row bonuses at the top and the units grouped under their class, and
**Upgrades**, every augment by category. They link both ways: a unit in a
class card jumps to its entry, a unit's upgrade chips jump to the upgrade, and
an upgrade's unit chips jump back (`unitsAffectedBy`; upgrades touching every
unit or none list no units). The target scrolls under the sticky header
(`scroll-margin-top`) and flashes gold. ☰ also has What's new.
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
one with Scout, rerolling every slot that isn't frozen, including ones already taken this round (their units stay on the board, spent picks stay spent; undo can't cross it outside easy mode).
This rarity ladder is the answer to "should offers scale over a long match"
(settled): with upgrades every 3rd round, rares arrive at round 6 and epics at
round 9. Nothing unlocks after that, so a median 18-round match spends its
second half at full power. The AI fills its row before merging (`deployToBack`): merging first left it
fielding two or three bodies, and with survivor damage empty slots are lost
damage. Hovering a unit shows `UnitInfo`, built from `unit.auraDetails`, which
`applyAugments` rebuilds with the stats.

**Choosing an upgrade takes two steps** (`AugmentPanel`): a tap only selects a
card (glow and ✓), and "Take <name>" under the cards commits it. A single tap
used to commit, and players picked the wrong one by accident. Taps are also
ignored for `AUGMENT_ARM_MS` (600) after the cards are dealt (the panel opens
right as a battle ends, while cards are still flipping in, and again after a
reroll), and a reroll drops a selection it replaced. Freezing doesn't re-arm.

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

### Replay last fight
`playRound` keeps the round's committed board and its `RoundResult`
(`lastFight`); `resolveRound` is pure, so they replay blow for blow. "↻ Replay"
beside the round summary (pick phase) and "↻ Replay final fight" on the result
screen run them through the normal playback with `replayFrom` set, which makes
`finish` skip everything with consequences (HP, settleRound, stats, telemetry,
explosions, the next round) and, after a beat, restore the phase and board the
replay interrupted (`endReplay`, also the "⏹ Stop replay" button). Poses are
cleared on the way back, or units that fell in the replay would stay mid-fall.
Local only: online, the other player never sees it.
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
continuous backdrop (confetti rain and rays for a win, embers for a loss;
`ui/ResultBackdrop.tsx`, a canvas: the CSS version, a 160vmax masked
conic-gradient and keyframes reading per-piece custom properties, didn't play
on iOS),
with an MVP (most damage) and the upgrades taken.

### AI difficulty
Chosen on a start screen (`DifficultyPanel`) when a match begins: on a fresh
load with no save, and after New match. The round-1 banner waits for the pick.
It's fixed for the match and saved with it (a resumed save skips the start
screen); the ☰ menu just shows it. The last choice is remembered
(`duel-deck:difficulty`) and marked `last pick` next time. `aiCommit(..., { difficulty, oppAug, scout })`:
- **Easy** — two random cards, no rerolls, no arranging; random upgrade.
- **Normal** — the value-table AI described above.
- **Hard** — searches every ordered pair of offer cards × every way of adding
  each (the next empty slot, merged into *any* unit that takes it, or with a
  full row a replacement or an unspent pick), de-duplicated by the row it
  makes. Each row is fought with `resolveRound` against `scout` (your row as
  it stood at the start of the round — never this round's picks) in the
  default formation; the best `HARD_SHORTLIST` (6) are tried in every
  formation. Score = the fight plus `growthValue`: `HARD_TUNING.level` (24)
  per level on the row and `conc` × that × level²/cap per unit, so a
  replaced or unspent pick costs a level and stacking one unit toward its
  Mastery pays. It rerolls when even the best line loses the fight, and gets
  one extra upgrade reroll with a higher reroll bar.
Hard also predicts the opponent's two picks this round (Normal's logic run on
the scouted row, with cards it rolls itself: no hidden information) and scores
each candidate against both the scouted and the predicted row. Without that it
had slipped to 55-60% as units gained mid-round abilities and Normal improved.
Sim (`--player=` / `--enemy=`, 2026-10-08): Normal beats Easy ~94%; Hard beats Normal ~68%.

**Growth-aware Hard (2026-10-23).** Real players beat Hard ~85% (44 of 56
telemetry matches since 1.3, nearly all one device). Their rows grew faster:
the human's summed unit levels gained ~6 per 3 rounds (every pick used),
Hard's ~4.5 — it replaced units and merged wherever this round's fight
looked best, since that fight was all it scored — and the human's top unit
was ~1.5 levels higher from round 6 on. Hard now values growth (above).
Tuned against the previous Hard (800 games each, `--tune-enemy=level,conc`):
the fuller search with no growth term lost 68–32; 4,0.5 broke even; 12,1
won 60%; 20,1 to 30,1 64%. Shipped 24,1: beats the old Hard 64%, Normal 86%
(was 75% under the same sim). Two extra unit rerolls for Hard added ~3%
(noise), so it plays with the player's allowance. Its search takes ~12 ms
a round on a desktop (node), once per round at Battle.

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
  id back, so local-only ids are safe. Each wire unit also carries the sender's
  own id as `ref`, which the receiver maps to one local id for the whole match
  (`unpackCommit`'s idMap, `oppIds` in Game.tsx). Without it the same units got
  new ids every round and the result screen counted the opponent's row anew
  each round ("Enemy units (118)" after 25 rounds); it also kept fallen poses
  stuck on the dead ids. `ref` is never used as an id itself.

`pnpm netcheck` is the guard: it plays whole matches between two simulated
devices exchanging commits through a JSON round-trip that strips empty values
the way the database does, and fails on any disagreement. It currently reports
0 desyncs over ~2800 rounds.

**Versions must match.** Since each device computes the round, two builds with
different rules would desync silently. Two guards: the lobby checks
`/version.json` before hosting or joining (`newerDeploy` in pwa.ts) and, if a
newer deploy exists, shows "Update needed" with Update now (`updateNow` asks
the service worker for the new build and waits for it, since a plain reload
would serve the cached old one); and rooms carry `proto` (`PROTOCOL` in
room.ts, absent = 1), so a join across protocols is refused with "update"
or "ask your opponent to update". **Bump `PROTOCOL` with every change to what
the engine or `refreshForRound` computes.** Deploy the database rules before
hosting: the rules reject unknown room fields, so a build that writes `proto`
can't host against older rules.
**Emotes** (`ui/EmoteBar.tsx`): a 💬 button at the board's bottom-right in
online matches opens 8 fixed emoji (`EMOTES` in room.ts; the last is 🤝 GG).
Each player writes only `emotes/<p>` = `{ i, n }`: the index, so the rules can
require 0-7 and no text can be sent, and a rising `n` so a repeat still shows.
The watcher ignores whatever was there when it subscribed. One a second, no
per-round cap (decided 2026-10-13); bubbles over each side's half fade after 2.5 s with a soft pop. The tray
has "Mute opponent" (`duel-deck:mute-emotes`, this device).
Other notes: an online match is **not** saved to `localStorage` (half of it is
the opponent's; `save()` is a no-op online) — a reload rejoins via the room, and
`duel-deck:online` holds the code and side. Waiting on the other player is a
`"waiting"` phase shown where the offer cards sit, so the board keeps its
height. Each side rolls its own unit and upgrade offers; they're independent and
need no shared RNG. Rules live in `database.rules.json` at the repo root and
must be deployed (`firebase deploy --only database`) before online works at all;
without the `duel-deck` block every write is a 401.

**Rematch** (room.ts "Rematch", `RematchBlock` in ui/Overlays.tsx): the online
result screen offers 🔁 Rematch, and **both players must ask**. Each writes
`rematch/<p>` = the match number it wants to replay (`Room.match`, absent = 1;
`Session.match`), or removes it ("Take it back"); a request for an older match
never counts. Once both requests name the current match, *each* device runs
`startRematch`, a transaction that only the first one gets through: `match`
+1, `startedAt` now, `commits` and `rematch` cleared. Both devices watch
`match`, and when it rises Game calls `onRematch` and App mounts a fresh Game
in the same room with the same settings — the usual remount, so no match state
carries over. The other side's request pings (`sfx("emote")`) and glows gold.
"Leave duel" (was New match) closes the room as before, which turns the other
side's rematch block into "Your opponent left the duel." A rejoin after a
reload takes `match` from the room. Telemetry ids get `-<match>` from the
second match on (`MatchLog.online`), since the paths are create-only. The
database rules allow `match` only to go up by one. `PROTOCOL` 9, so both
sides of a duel have rematch.

### Kawaii mode (game/kawaii.ts) — a hidden setting
Tapping the settings sheet's "Match settings" heading 5 times within 3 s
(`SECRET_TAPS`, `SECRET_WINDOW_MS` in Title.tsx) reveals a 🌸 Kawaii mode
switch; it stays visible while the mode is on. Saved as `Settings.kawaii`.
Your units only: a pink palette (`KAWAII_PLAYER`), bigger pupils with two
sparkles, blush, an ω mouth and a bow (`drawBow`), all in board/characters.ts
behind a module flag (`setKawaiiCharacters`, set by `setKawaii` from App), so
the board, portraits and offer cards all follow it. Text goes uwu
(`uwuWords`: r/l → w, n+vowel → ny; `uwu` adds a face): ability callouts, the
battle log (unit names too) and round banners. Cosmetic and local: the
engine, telemetry and the opponent's screen are untouched. Your units also
get hand-picked names (`KAWAII_NAMES`: Guawd-kun, Sir Fwuffs, Bwinky…) through
`displayName`/`kawaiiName`: on the board (`RenderState.unitName`), offer cards,
info cards, the battle log and the result screen; the Codex keeps the real
names. The 1.7.1 patch note only hints at it.

### Feedback (game/feedback.ts, ui/Feedback.tsx, scripts/feedback.ts)
"Report a bug or suggest a feature" in ☰, on the title screen (🐞 Bugs & ideas)
and on the result screen. App screenshots the page *before* opening the form
(`openFeedback`: wait for the menu to paint away, then `captureScreenshot`),
so it shows what the player was looking at; Retake closes the form, captures
again and reopens it with the draft kept. The screenshot is html2canvas
(lazy-loaded, its own ~200 KB chunk), not a screen capture: no permission
prompt, works on phones, and only the game can be in it. Longest side
1280px, JPEG stepped down until it's under 900k characters. html2canvas
draws a clone of the page and gets three things wrong, fixed in `onclone`:
entrance animations restart at frame one (cards at opacity 0), closed
`<details>` draw their contents, and gradient text (`background-clip: text`)
draws as a block (it becomes its gradient's first colour). The player can
untick the screenshot, save it (⬇ Save image) and add an optional contact.

Reports go to `feedback/duel-deck/<UTC day>-<random>` = `{ kind: bug|idea,
text, contact?, at, v, c, ua, ctx, shot? }`, where `ctx` is the mode, room,
round, phase, HP and viewport (`feedbackContext` in Game.tsx). The rules make
it create-only, size-capped and unreadable by clients, like telemetry. `pnpm
feedback [--kind=bug|idea] [--open] [--all] [--from=<device>]` lists them
through the Firebase CLI (open ones in full, closed ones a line each) and
writes the screenshots to `feedback/<id>.jpg` (gitignored).

**Close reports, don't delete them** (decided 2026-10-23, for tracking):
`--fix=<id> [--in=x.y.z] [--note=…]` or `--wontfix=<id>` adds `status`,
`closedAt`, `commit` (HEAD's short hash, so fix after committing), `fixedIn`
and `note` to the report; `--reopen=<id>` clears them. The CLI bypasses the
rules, and clients can't write those fields (`$other` is rejected), so only
this script closes a report. `--remove=<id>` is for spam only.

**Web view:** `pnpm feedback:ui` (scripts/feedback-ui.ts, launch config
`duel-deck-feedback`) serves the same on http://localhost:5180: Open / Closed
and bug / idea filters, screenshots inline, and Fixed / Won't fix / Reopen /
Remove buttons. It reads the database once per page load (no polling; Refresh
reloads). Both scripts share `scripts/feedbackDb.ts`. Actions take a JSON POST
from the page's own origin only, so another site can't close reports.

**Who sent it:** `c`, the sender's device id (`clientId()`, random per
browser/install, the same id telemetry's `meta.c` records), shown as a short
label (#1 is the first device to report) with its report count, plus the
optional `contact`. There are no accounts: a person on two devices is two ids,
and clearing site data makes a new one. As of 2026-10-23 every report (4) came
from one iPhone, with no contact. Nothing prunes reports.

### Telemetry (game/telemetry.ts, scripts/telemetry.ts)
Balance data from real players, always on and not shown in the UI. Each match
writes to `telemetry/duel-deck/<UTC day>/<match id>/` in the Realtime Database:
`meta` at the start, `rounds/<n>` after every round (cards as dealt, each pick
as place/merge/replace with the level it reached, rerolls, both rows as
`key:level`, the round result, HP), `augs/<n>` at each upgrade choice (offered,
taken, rerolls, and the CPU's pick) and `end`. Per round rather than once at
the end so abandoned matches and killed iOS PWAs still count. The id is kept in
`duel-deck:log` so a resumed save keeps writing to the same match; online it's
derived from the room code and side. Off under `vite dev` unless the URL has
`?telemetry=1`; the sims never import it.

The database rules make every telemetry path create-only (`!data.exists()`),
shape-checked, and unreadable by clients. `pnpm telemetry [--days=N] [--v=x.y.z]
[--mode=cpu|online]` reads it through the Firebase CLI and prints pick rates,
how often a pick merges, and the win rate of rows holding each unit and of each
upgrade's holders, for players and for the CPU. Compare it with `pnpm sim`.

Retention is three weeks. Grouping by day makes a prune one delete per day:
`pnpm telemetry` prunes on every run (`--prune` only prunes), and
`.github/workflows/telemetry-prune.yml` does it daily once the repo secret
`FIREBASE_SERVICE_ACCOUNT` (a service-account key) is set.
### Sound (game/sound.ts)
Effects are synthesized, no audio files (`?sounds` on the dev server plays every one). The
master chain is a compressor plus a short generated room reverb, and combat
sounds vary ±4% in pitch per play; death is a cartoon \"poof\" and round won
two bells (chosen 2026-10-13).  — oscillators and one noise buffer, like
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

**Music** (`game/music.ts`, added in 1.7.0) is the exception to "no audio
files": two recorded loops in `src/assets/music`, `plan.mp3` (pick, augment
and waiting; "Fun indie game type jazz" by idoberg) and `battle.mp3` (battle,
replays too; a chiptune by tatamusic), chosen by the user from their
downloads. Game.tsx calls `setMusic(track)` on every phase change, `null` on
the result screen, and App sets `null` on the title. A change crossfades over
`FADE` (1.2s, linear, so the two never sum above full); each phase starts its
track from the top. Neither track loops sample-exactly, so each pass overlaps
the next by `SEAM` (1.5s) with a crossfade, scheduled on the AudioContext
clock `LOOKAHEAD` ahead. Both are decoded once into AudioBuffers (~50 MB of
PCM in memory together); the other track is decoded in the background so the
first switch is instant.

Levels: both files were re-encoded with ffmpeg to 96 kbps stereo and levelled
to the same loudness, about -20.4 LUFS (the jazz track was -16.5, the chiptune
-10.7; plain gain, `volume=-3.5dB` and `-9.3dB`, so their dynamics are
untouched); the chiptune's 2.5s of trailing silence was cut (`-t 78.97`).
Re-encode any replacement the same way, then `MUSIC_VOLUME` (0.3) is the only
knob and sets music against the effects. Music goes straight to the output, not
through the effects' compressor and reverb, so a big clash doesn't pump it.
It plays only when Sound *and* Music are on and the page is visible (a hidden
tab or backgrounded install stops it rather than playing silently). Music
on/off is `Settings.music`, a 🎵 button beside Sound in the title dock and a
switch under Sound in ☰. The service worker precaches `**/*.mp3` (vite.config.ts;
~2.4 MB together, under Workbox's 2 MB per-file limit), so music works offline.

**Menu music** (added 2026-10-23): `menu.mp3` ("Game Music Loop 9" by
xtremefreddy, from the user's downloads), the `"menu"` track. App sets it on
every screen outside a match (it used to set `null` there); Game takes over
per phase. Encoded the same way: 96 kbps stereo, `volume=-1.9dB` to -20.4 LUFS
(it was -18.0), its 1.4 s of trailing silence cut (`-t 57.81`). `NEXT` says
which track to pre-decode (menu → plan → battle → plan), and the menu's buffer
is dropped when it fades out, so a match doesn't hold three decoded tracks. Since
the title now has music, App unlocks audio on the first tap or key anywhere
(once, while Sound is on); before, the first unlock was Play.

**Dev server gotcha:** Vite re-runs `music.ts` on a hot update without
reloading the page, and the old copy kept playing (and restarted the menu
track on the next tap, as it was still subscribed to sound changes), so the
menu music carried on into a match when running locally. `hot.dispose` never
fires for it (Vite calls it on the accepting module, App or Game), so each copy
registers a stop on `globalThis.__duelDeckMusic` and the next copy calls it as
it loads and takes over `wanted`. Switching tracks also fades every track in
`live`, not just `playing`. Checked by recording every AudioBufferSourceNode
start/stop across a module swap: one track sounding at a time. Builds don't
have `import.meta.hot`, so players never had this.

### Tutorial (ui/Tutorial.tsx)
A guided first match against Easy, offered first on the title screen until
it's finished or skipped (`duel-deck:tutorial-done`), and always from the
Tutorial link. A coach card walks through 12 steps; each either waits for the
player to do the thing (place, take a second card, Battle, merge, take the
round-3 upgrade) or has Next, and outlines what it's about (`tut-spot`). Steps
that are only read move on by themselves once the round does (`playedOn`), so
ignoring Next never strands it; `waitFor` only gates a step's first
appearance (the upgrade step used to vanish once the upgrade closed). The
first two offers are set (`TUTORIAL_OFFERS` in Game.tsx: Strikers and Guards
twice) so a merge is always on offer. A tutorial match is never saved (it
mustn't replace a real one, and it doesn't clear one either) and never logged
(`MatchLog.none()`: set offers would skew the data). The card sits at the top
while picking, since the cards are at the bottom, and at the bottom during
battles and upgrades.
### Save and resume
The match is saved to `localStorage` (`duel-deck:match`) at the start of every
pick phase — never mid-battle — so a reload lands back at the start of the
current round's picks. Unit ids come from a module counter that restarts at 0
per page load, so restoring a save calls `reserveUnitIds` to move it past the
restored ids; without that, new units would alias restored ones (ids key drags,
playback and augment grants).

### Balance simulation
`pnpm sim [matches] [--draw=…] [--cap=…] [--player=…] [--enemy=…] [--tune-enemy=level,conc]` (`scripts/sim.ts`) plays AI-vs-AI
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
- A turn timer (online currently waits indefinitely, which was a deliberate
  call — see "Online duel").
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
releases, and add that version's player-facing notes to `PATCH_NOTES` in
`ui/PatchNotes.tsx` (the title screen's "What's new", dotted until opened
on this device, `duel-deck:notes-seen`). The build writes `/version.json` (version + deploy time; no-cache,
never precached). The ☰ menu's About section (`ui/MenuPanel.tsx`) shows this
build's version and deploy time beside the latest deploy's, and offers Check
for updates / Update now. Update state is shared via `src/pwa.ts`.
`duel-deck-hosting` in `.claude/launch.json` serves `dist` through the Hosting
emulator (port 5176) to test the service worker and headers locally.

### Battle view (1.7.2): the board takes the screen during a battle
`.app--battle` on `.app` while `phase === "battle"` hides the round summary,
pick row, offer row (where the battle log was) and hint; on wide screens the
grid drops to one centred column (header, HP bars, board, HUD), and the header
goes compact (one row, no title). In `board/render.ts`, `setBattleView` (set by
Game as it renders, and by `draw` from `RenderState.battle`) raises the lane cap
(`MAX_LANE_W_BATTLE` 560) and the unit cap (`UNIT_MAX_H_BATTLE` 96), so units
really grow; picking keeps 320 / 52, so the "maximum drawn size" rule below
still holds wherever the board shares the screen. Measured: 360×640 board 306 →
498px tall; 1024×768 352×558 → 640×584 (rows are height-bound there). This
deliberately trades the old "board never resizes between phases" rule for a
bigger fight: the board grows at Battle and shrinks back for picks. The battle
log is hidden for now (its ☰ switch removed; the setting and feed code stay).

**Animated (1.7.4).** A FLIP animation on `.app__stage` (Game.tsx): when
`phase === "battle"` flips, a layout effect compares the board's box before
(`stageRect`, refreshed on resize) and after, and animates it from the old box
with `translate` + a uniform `scale` (old height / new height, from its top
centre, so units don't stretch) back to none, 460 ms, via Web Animations. Any
board animation still running is cancelled before measuring, or its transform
skews the box. The rows collapse instantly; `render.ts` still eases the lane
and unit caps (`battleT`, `BATTLE_VIEW_MS` 420), which is what widens the
board on desktop, where the stage's height barely changes and the FLIP is
mostly a slide to the centre column. `.app__controls` slides back in
(`controls-in`) when picking starts. Reduced motion: a 220 ms fade instead.
1.7.3 animated the rows' max-height instead; it didn't show for the user, so
it was replaced. A hidden browser pane runs no frames, so the animations were
checked by reading `getAnimations()` keyframes: 360×640 scale 0.62 in / 1.62
out; 1024×768 translate(−72, 38) in / (72, −38) out.

**Slower (2026-10-23):** `BOARD_ZOOM_MS` 700 (was 460; the user found it
rushed), with `BATTLE_VIEW_MS` and `controls-in` matched to it so the board,
its units and the controls move as one.

**iOS Safari pass (same day),** following the root CLAUDE.md's animation rules,
which every new animation here must follow:
- the FLIP feature-checks `animate`/`getAnimations` and sets
  `transform-origin` on the element, not in the keyframes;
- overlays: `-webkit-backdrop-filter` added everywhere (Safari before 18 ignored
  the blur), and `ov-fade` no longer animates the blur, only opacity;
- the title's rise-in uses `backwards`, so it doesn't pin the buttons'
  pressed transform;
- audio unlocks on `touchend`/`click` as well as `pointerdown` (iOS doesn't
  count a finger's pointerdown), and `unlockSound` resumes any state but
  `"running"` (iOS's `"interrupted"`).
The canvas code (board, fx, characters, the title duel) already avoided
`ctx.filter` and runs on frame time.

### Small screens (checked at 320×568, 360×640, 375×812)
Every screen is meant to work on a 320×568 phone without anything important
off screen. What that took, screen by screen:
- **Title** (`ui/Title.tsx`): hero, Continue (gold) or the tutorial nudge, a
  "vs CPU" card (opponent as a three-way segmented control, its blurb, one
  Play button), an online card, match settings as a one-line chip that opens
  a bottom sheet, and an icon dock (Tutorial, Rules, Codex, New, Sound,
  Music, Feedback). Fits 360×640 with no scroll; `max-height` 700px and 600px steps
  drop the unit lineup, shrink the emblem, then hide the tagline. It still
  scrolls itself if it must (`.title` is the scroller; the page never is).
  **Title animation (2026-10-23):** the lineup is a live duel
  (`ui/TitleDuel.tsx`, one canvas, `drawCharacter` and an `FxLayer`): three
  of yours against three of theirs, the fronts lunge sideways (drawCharacter's
  own lunge is vertical, for the board) and trade blows every `BEAT_MS` with
  sparks and damage numbers, and every `FALL_EVERY`th exchange one front falls,
  its row slides up and it respawns at the back, alternating sides. The canvas's
  top 32px is headroom that tucks under the tagline, so the strip costs 58px
  (the old lineup 44). Around it: a light sweep across the title, a turning
  glow ring and pulse on the emblem, and the hero, cards and dock rising in on
  open, staggered. Reduced motion: the lineup drawn once, still, and none of
  the rest. Still hidden under 700px tall.
- **In a match** (phones, under 45rem): the header is one row — ☰, round and
  phase (ellipsised), and the upgrade countdown as a pill ("⬆ in 2"); the
  "Duel Deck" heading is hidden, since its line is worth more as board. Gaps
  drop to 0.25rem below 740px tall. At 360×640 the board went from 255px to
  300px tall. Under 23.75rem (380px) wide, Undo is just ↶ so the four HUD
  buttons fit.
- **Upgrade choice:** on phones the overlay is `position: fixed` over the
  whole screen and scrolls (`overlay--augment`), instead of filling the
  board's box, which at 320×568 is 234px tall and pushed the heading and View
  board off the top. Card tags wrap under the name; Take sticks to the bottom.
- **☰ menu:** a 2×2 tile grid, three switches (Sound, Music, Battle log; their
  subtitles hidden under 600px tall), one line for this match's
  settings, the exits side by side (online: one "Leave duel"), and About
  folded into a `<details>` that opens itself when an update is waiting.
  Fits 320×568.
- **Result screen:** `.result-footer` (rematch block, actions, feedback link)
  is `position: sticky; bottom: 0`, so the actions never sit a screen away;
  under 520px the stats are two columns of short horizontal tiles and the
  long labels shorten (`hud__long`: "↻ Replay", "Accept").
- Lobby, Codex, Help, What's new and Feedback already fit; the tutorial card's
  text shrinks below 600px tall.

### Layout

> **Rule: units have a maximum drawn size.** A unit's contents (character,
> name, stats, badges, HP bar) are never taller than `UNIT_MAX_H` (52 CSS px,
> in `board/render.ts`), however big the screen and its rows get. Slots may
> grow; what's drawn in them may not.
> - Draw anything that belongs to a unit inside `drawUnit`'s scaled block, or
>   size it with `contentScale(h)` (the drag preview, the empty-slot number
>   and the slot labels like + ADD / MERGE do). Never size unit art or text
>   straight off `rowH`/`h` outside it. The same cap covers row text: slot
>   labels and battle effects (`cellCenter`'s `size`, which every fx scales by).
> - Don't raise `UNIT_MAX_H` or `CHAR_SIZE` without checking a tablet
>   (768×1024, rowH ~84) and a wide desktop as well as a phone.
> - The same goes for unit portraits in the DOM (offer cards, info cards, the
>   result screen): give them a fixed or `min()`-capped size, never one that
>   scales with the viewport.
>
> Why: everything used to scale with the row height, so big screens showed
> giant characters and 37px stat text.

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
