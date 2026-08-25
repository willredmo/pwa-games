# House Edge — Incremental Roulette Roguelike

**Design source of truth:** [`/roguelike-projects-tracker.md`](../../roguelike-projects-tracker.md),
section "4. Incremental Roulette — House Edge". Read that first — this file only
records how the code maps onto it and where the two intentionally differ.

## The premise, and why the numbers matter

A European single-zero wheel pays **−2.70%** per unit staked. That is not
flavour text — it is the opening state of the game, and every upgrade is a way
of clawing that edge back and then past it. The whole progression is the player
moving from the wrong side of the house edge to the right side of it, which is
why the balance numbers below are load-bearing rather than decorative.

Verified by headless simulation against the shipping code (400k–600k spins):
the neutral wheel measures **-2.7027%**, matching the analytic figure exactly.

The turning point is **Comp Points level 3**, around $530 all in: an even-money
layout needs roughly 5.3% back to break even against the zero, and level 3 gives
7.5%. Measured at +0.83% on red and +4.95% on a straight.

## Implemented

- **Real European wheel** — 37 pockets in true physical order, correct red/black
  set, `engine/wheel.ts`.
- **Bets** — straights (35:1), dozens and columns (2:1), red/black, odd/even,
  high/low (1:1). `engine/bets.ts`. The zero loses every outside bet; that is
  the edge being modelled.
- **12 upgrades** (`game/upgrades.ts`) and **15 relics** (`game/relics.ts`).
  Upgrades carry a `section` — `"table"` or `"change"` — and the shop groups by
  it, so the Loose Change upgrades do not bury the wheel's own.
- **Loose Change** (`ui/LooseChange.tsx`) — the coin-catching mini game that
  replaced the automatic bailout. See below.
- **Manual first, auto-spin unlocked** — "Hire a Croupier" (200 chips) turns on
  auto-spin; Croupier's Haste compresses the cadence from there.
- **Prestige ("Cash Out")** — bank `floor(sqrt(peak / 1e6))` Ivory, wipe chips,
  upgrades and layout, keep Ivory and relics, and draft **1 relic from 3**.
- **Offline earnings** — time away is paid out by running the real resolver
  headlessly, not an analytic EV, so every relic is honoured.

### Stats are derived from one pocket tally
`pocketCounts` is a 37-slot array of how often each pocket has come up, and
every statistic on the Cash Out tab — colour, odd/even, low/high, zero rate, hot
and cold — is computed from it by `wheelStats`. Keeping separate red/black/odd
counters would let them drift apart or be double-counted, and each new statistic
would need a save migration; this way none do.

Money is tracked as `wagered` and `returned` rather than a single net, because
net alone cannot distinguish grinding out a small loss over thousands of spins
from losing it in one — and the ratio between them is the **realised house
edge**, the number this game is actually about. A neutral wheel converges on
-2.70% and the whole progression is dragging it above zero, so the panel shows
it as "per dollar staked".

`wagered` is counted in `commitStake`, not on landing: that is where the money
actually leaves, and a spin abandoned mid-flight still cost you the stake. The
two totals reconcile exactly against the bankroll — verified live:
`5000 - 80 + 21.75 = 4941.75`, which is what `chips` read.

Outside-bet percentages are shares of **36** pockets, not 37: the zero is not
red, not even and not low, so it is excluded rather than quietly inflating
"even". Showing them against all spins would make a fair wheel look like it
favours nothing, when the 2.7% the zero takes *is* the house edge — the premise
of the whole game.

The tally clears on cash out, along with the bankroll: a wheel history carried
across a prestige describes a table you no longer play. Saves written before the
field existed start their count from zero, so for one cycle the panel's spin
count will read lower than the game's own.

### Money is dollars, and `money()` is the only thing that knows it
`game/format.ts` exports `fmt` (bare magnitudes) and `money` (a `$` prefix).
Every bankroll-facing number goes through `money`. **Ivory deliberately does
not** — it is a prestige token, not currency, and a dollar sign on it implies
you could bet it.

### Ivory pays on *peak*, not on total earned
`peak` is the highest the bankroll reached this cycle. Paying on cumulative
winnings would let a losing player farm Ivory by churning spins; paying on peak
means the reward tracks how far you actually got. Note that Loose Change feeds
`peak` too, since the change is added to the bankroll.

### The Edge object is rebuilt every spin, never mutated
`buildEdge` flattens upgrade levels + relics + Ivory into one `Edge`
(`engine/types.ts`) that the engine consumes. Several relics are dynamic —
Snowball scales with the current streak, High Roller depends on stake versus
bankroll, Crimson only fires on red. So the `Edge` is recomputed from scratch
rather than baked into state; caching it would let it drift out of sync with the
thing it describes. The engine itself knows nothing about upgrades or relics.

### A spin is rolled on launch and committed on landing
`rollSpin` produces the result when Spin is pressed; `applyResult` commits it
when the ball lands, applied **functionally** against the latest state. Two
things fall out of this: the bankroll only moves when the ball actually drops
(the reveal is not spoiled), and buying an upgrade mid-animation cannot be
clobbered by a stale snapshot taken at launch.

### The physics is solved backwards from the result
`board/physics.ts`. The pocket is decided by `resolveSpin` before anything is
drawn — that is the fairness model, and every modifier is already computed
against it. So the animation may not *choose* where the ball lands; it has to
look like a real throw and arrive where it was told.

A real ball does not decay smoothly from launch to landing, and modelling it
that way is what made the old wheel feel wrong. `planSpin` uses two regimes:

- **Track ride** — angular velocity decays **linearly** under near-constant
  rolling friction, so the ball holds speed for most of the flight. 96.1% of all
  travel happens here.
- **Release** — at a critical velocity the ball drops off the track abruptly.
  Not an eased transition; this is the moment the spin turns over. It happens at
  0.53–0.69 of the flight.
- **Fall** — across the apron into a deflector strike, then a damped rattle
  between the frets with the ball's height decaying to exactly zero.

Linear decay makes the backwards solve closed-form rather than an exponential
inversion: swept angle over the track phase is `(ω₀ + ω_c)/2 · T`, so the launch
speed for a required sweep falls straight out. A whole number of extra
revolutions is added until launch comfortably exceeds critical speed, which is
why relative revolutions land in 8.5–16.5 rather than a fixed count.

Nothing is nudged in flight. The chatter and the rattle are perturbations shaped
to be **exactly zero at u = 1**, so they can never move the landing. Verified
over 5,000 randomised trials: worst-case landing error 0.0000% of a pocket
width, zero wrong pockets, zero direction reversals on the track, and height
exactly 0 at rest.

### Scatter is swept angle, not a wobble
After first contact the ball travels a **mean of 8 pockets** (median 7, p90 15,
range 2–18) before it settles, and it never rests in the pocket it first
touched. This is the *scatter*, and on a real wheel it is the single biggest
source of unpredictability — the reason wheel-clocking works on the ball track
and falls apart at the drop. Published advantage-play figures cluster around
nine pockets from the dominant diamond to rest, with a long right tail, so the
draw here is skewed (`2 + u^1.6 * 16`) rather than uniform.

The important structural point: the scatter is taken **out of the track phase**,
not added on top of it. `sTrack = sTotal - sFall - sScatter`, so the ball
genuinely arrives `scatterPockets` short of its pocket and skitters the rest of
the way in. The earlier version bolted the rattle on as a perturbation around a
sweep that had already finished, which is why it could only ever wobble within a
pocket — widening it would have put a step in the ball's angle at touchdown and
teleported it across the rotor in one frame.

`settle()` steps the remaining distance down once per hop rather than easing it
continuously, so the ball is carried while it is in the air and holds station
against a fret. `SETTLE_CURVE` above 1 makes the early hops cover most of the
ground; at 1 the ball crosses the rotor at a constant rate and reads as sliding.
It is exactly 1 at the end, which is what preserves the landing invariant.

Travel **within** a hop is linear, not eased. A ball in the air carries constant
horizontal speed and stops dead on contact, so the corner at each hop boundary
is the correct shape — and easing instead puts the peak speed at twice the hop's
average, which is what made the ball look flung across the rotor rather than
skittering. `RELEASE_RANGE` and `FALL_RANGE` are the scatter's time *budget*
rather than pacing: releasing late leaves a few tenths of a second for eight
pockets of travel, and no amount of shaping fixes that.

Currently 1.8s on the rotor, averaging 4.7 pockets/s with a 14 pockets/s peak
just after the drop.

### A collision is an impulse, not a push
Strikes on the deflector diamonds use `t·e^(1-t/tau)·(1-t)` — the impulse
response — rather than a sine arc. The distinction is the whole difference
between hitting a diamond and curving around one: an arc eases in, so position,
velocity *and* acceleration are all continuous, which is the shape of a gentle
shove. The impulse is exactly zero at contact so nothing teleports, has maximum
slope at contact so the velocity change is abrupt, then relaxes. Height is
shaped separately, as a short series of decaying hops rather than one arc, since
a square hit skips the ball a couple of times.

Both profiles are still exactly zero at the ends of their window, which is what
keeps a strike from leaving a step in the ball's angle when the next phase takes
over — and so keeps the landing invariant intact.

### The renderer works out the collision for itself
A struck diamond brightens and swells while the ball is on it. Nothing tells the
renderer a strike happened: whether the ball is on a given diamond is derivable
from the ball's own angle and radius, both of which `WheelView` already carries.
A `struck` flag would be a second source of truth for the same event, free to
disagree with the first — and it would have to be threaded through the plan, the
sample and the component to say something the renderer can already see.

### Bounce height is not tied to track height
`HOP_CEILING` (1.8) is how high a bounce may go, where 1 is the ball track's own
height above the rotor. It used to be clamped at 1, which quietly tied *how high
the ball can bounce* to *how high the track sits* — two unrelated things that
happened to share a number, and it capped the tallest possible hop at 17.6px
against an 18px ball.

Nothing else had to change for this, which is worth knowing before anyone
"fixes" it back: the renderer maps height to pixels linearly with no ceiling of
its own, and the ball's shadow takes its ground from `radius`, not `height`, so
the shadow stays on the surface however high the ball goes. Paint order already
put the ball after the bowl bands, so a tall hop correctly overlaps the rim.

### The renderer's silhouette runs high in the middle, low at the edge
`board/render.ts` draws the wheel as a bowl at an angle. Two rules keep it from
reading as a flat disc. First, the **turret is the tallest point** and the rim
is roughly half its height — a rim that out-tops the turret makes the middle
look sunken. Second, the bowl is one **continuous funnel**: each band's outer
edge sits higher than its inner edge and every band begins exactly where the
previous one ended. Drawing bands as flat rings at differing heights leaves the
rotor looking like a disc floating out of alignment with the bowl around it.

TILT and WALL are coupled by this: a band **inverts** once its height drop
exceeds its radial width times TILT. The apron is the tightest band and sets the
ceiling on WALL. The cone is deliberately steeper than that limit, so it is
built as a solid silhouette from a profile polyline instead of as a band.

The number ring is printed **radially with the tops pointing outward**, as a
real wheel is, which means the near half reads upside down at this viewing
angle. That is correct rather than a bug, and it is not fixable by flipping the
near half: the flip has to happen somewhere on the ring, and wherever it happens
the number snaps through 180 degrees mid-spin — far more obvious than the
inversion it was meant to hide.

Paint order carries the depth: the far deflectors go down before the rotor and
the near ones after it, and the ball is **depth-sorted against the cone** — on
the back stretch it projects to roughly the turret's screen height, so painting
it last would float it in front of the cone it should be passing behind.
Anything shaded by which *half* of the wheel it is on is a bug in waiting: that
is a step function, so it snaps as the rotor turns and leaves a seam at a fixed
place on screen. The frets are lit from a fixed direction instead.

The deflectors are drawn at **fixed** angles — they are mounted on the
stationary apron, not the rotor. Rotating them with the rotor (as the first
version did) means every feature on screen turns together and the whole thing
reads as a prize spinner.

## Loose Change

The bankroll still has a floor — an idle game needs one, since a bankroll under
the smallest chip cannot place a legal bet and the game would simply stop. But
the floor is **claimed, not granted**: there is no automatic re-stake and no
cooldown. A broke player opens Loose Change from the ☕ button in the tab row
and scrambles for it.

Rules, all of which are the result of deliberate removals:

- **No fail state.** Missing a drop costs nothing.
- **No clock.** Both a lives system and a timer existed at various points and
  were taken out.
- **You may stop once bankroll + change in hand reaches `CHANGE_MIN_TAKE`**
  ($20, tied to `HOUSE_STAKE` so the line and the floor are the same event).
  Measuring the two together matters: someone arriving with $15 already has most
  of a stake and should not have to earn the whole thing again.
- **What bounds it is the tin, not difficulty.** With no lives, no clock and no
  forced ending, nothing else stops a patient player scrambling all night. The
  spill stops dead at `capCents` (Tip Jar, $20 at level 0). The drop speed is
  deliberately **constant** — a difficulty ramp on an untimed game only punishes
  a long run.

### The floor is on the resulting bankroll, not on the payout
`changePayout(chips, cents)` returns `max(HOUSE_STAKE, chips + value) - chips`.
Flooring the *payout* instead would hand a solvent player $20 for opening the
game and quitting immediately, which is a free money button. This way the floor
only ever tops a player up, and anyone already above it is paid exactly what
they caught.

Related: change is **added** to the bankroll, never replaces it. A broke player
cannot tell the difference, but the game is usually opened voluntarily, and
replacing would wipe out a rich player for the crime of playing it.

### Change rounds down, in whole dollars
Whole dollars rather than whole chips, because the take-home line is measured
against the bankroll and the two have to be in the same units — snapping to the
$10 chip would let a player on $15 catch $5, watch it round to nothing, and
still be told they had reached $20.

### The drop table is 1/value weighted
`changeWeights` in `game/upgrades.ts`. A drop's frequency is inversely
proportional to what it is worth, so **every denomination contributes the same
expected amount** and the game is a scramble rather than a wait. Lucky Spill
raises that curve to a power below 1, flattening it toward uniform; scaling the
big denominations up directly would raise the average just as well but leave the
nickel exactly as common, which is not what the upgrade claims.

Bills ($5/$10/$20) sit on the same curve with a boost, because on the raw curve
they land at 0.5% between them — rare enough that most runs never show one,
which makes them a mechanic nobody discovers.

### Steady Hands never outruns the player
`autoSpeedAt` is capped at `CHANGE_CUP_SPEED` by construction, and the drift
only applies when the player is giving no input. A cup that outruns you turns
the game into watching.

### The cup moves at a constant speed, with no easing and no per-press step
Both were tried. A step applied on keydown teleports the cup; easing toward a
target makes the start of a press faster than the rest. Either one reads as a
jump. Keys are matched on `e.code` as well as `e.key`, since `key` carries the
character and so follows the keyboard layout.

## Auto-spin cadence

`BASE_SPIN_MS` is **2600**, not the original 900. At 900 the ball had no room to
ride the track before the next spin overwrote it, so auto-spin read as a number
generator with a wheel-shaped decoration attached. `MAX_AUTO_SPIN_MS` (App.tsx)
rose to 2200 to match. Croupier's Haste still buys roughly 8x back across its 25
levels, bottoming out near 320ms, so the upgrade is not weaker — the *floor* is
the fast state now, rather than the opening.

Note that Hire a Croupier is easy to mistake for a no-op: it unlocks an **Auto**
button that appears only in the bet-controls row on the Table tab, and it starts
**off**. Buying it in the shop produces no visible change anywhere.

### Space spins, but only on the Table tab
The hotkey is scoped to the Table tab and suppressed while the Loose Change or
relic-draft overlay is up. Two reasons, and neither is fussiness: on the Shop
and Cash Out tabs space is how the keyboard activates a focused button, and
stealing it there would break buying; and on the Table tab space has to mean
spin *whatever* holds focus, or clicking a bet cell and then pressing space
would quietly place another bet instead of spinning.

`preventDefault` does two jobs — stops the page scrolling, and stops a focused
Spin button from firing its own click on top of the handler. Auto-repeat is
dropped so a held key cannot queue a spin per repeat, and `doSpin` already
refuses while a ball is in the air.

## The animation layer

Before this there was no animation anywhere outside the wheel — no keyframes,
no transitions, no reduced-motion handling. Everything snapped.

Three rules hold it together.

**Presentation never reaches into physics.** The pocket is decided before
anything is drawn, and every perturbation in `planSpin` is exactly zero at
touchdown. Nothing in this layer adds to that: it is DOM/CSS, or additive paint
on a `WheelView` that already existed. The invariant harnesses are re-run after
any change here.

**The renderer stays a painter.** `WheelView` gained `settledMs` (elapsed since
the balls stopped) and `sparks` — a *fact* and a list of *positions*, never a
verdict. Particle state lives in `Wheel.tsx`, which owns the rAF loop. The flare
works out its own progress from `settledMs` rather than being told to celebrate.

**Effects are measured in playback time, not wall time.** Everything ages by
`dt * speed`, so a spin watched at 0.1x keeps its sparks in step with the ball
instead of having them flick past while it crawls.

### Contacts come from the solver, not from a second guess
`SpinPlan.contacts` exposes what `planSpin` and `coupleBalls` already worked
out: when each diamond is clipped and when balls meet. Re-deriving that in the
renderer would be a second source of truth for the same event — the exact
mistake the deflector-highlight code already warns about.

Ball contacts are far more common than diamond strikes — **13.4 a spin against
2.5** — so sparking every one is a constant shower that communicates nothing.
Only knocks above `BALL_SPARK_MIN` are marked.

### `TOUCH_FULL_SPEED` was wrong by two orders of magnitude
Exposing `strength` revealed the bug. It was 1.2, and **every** ball contact
clamped to exactly 1 — so the value carried no information, and the hop meant to
scale with impact was applied at full force to balls barely drifting together,
the opposite of what the surrounding comments claimed.

Calibrating it needed the right distribution. Only *first* contact is recorded,
and that is systematically the fastest moment of an encounter, so it runs far
quicker than a sample across all overlapping frames (median 42 rad per unit
flight against 4.5). At **120** fewer than 5% saturate and strength spreads
across its range: p10 0.06, p50 0.36, p90 0.83.

The lift it scales is decorative — it feeds `height`, not the separation solver
— so the landing and overlap figures are unaffected, and were re-verified.

### Win celebrations are tiered by multiple, never by amount
`ui/celebration.ts`. How loudly a win is celebrated is judged against the
**stake**, not the figure. Bankrolls here grow without limit, so a
million-dollar win means nothing at a billion-dollar table and any absolute
threshold is obsolete within an hour of play.

The boundaries sit in the gaps between what the layout can actually pay,
measured over 300k spins per layout:

| multiple | what pays it | hit rate |
| --- | --- | --- |
| 1x | even-money bets | 48.5% |
| 2x | a dozen or column | 32.4% |
| 5x | a straight inside a six-straight spread | 16.2% |
| 9x | a straight alongside outside bets | 19.0% |
| 35x | a straight on its own | 2.8% |

So **3x** separates "the table paid" from "you hit something" and **12x**
separates that from "you hit a straight". Nothing falls between a tier and its
boundary, which is what stops the same event celebrating differently on
different spins.

Tier 1 is deliberately identical to an ordinary spin. Roughly half of all spins
win something, and a game that throws a party every other spin has nothing left
to say when the rare one lands. Tier 2 brightens and lengthens the flare; tier 3
adds a coin eruption from the winning pocket and turns the figure gold.

### The celebration tier comes from `pending`, not `result`
A subtle ordering trap, and it silently suppressed the entire coin eruption
until a pixel probe caught it. The wheel's celebration fires the instant the
ball stops — which is *before* `onSettled` has set `result`. Reading the tier
from `result` there decorated each win with the **previous** spin's tier, one
spin permanently behind, so a straight hit celebrated on the following spin
instead.

`pending` is the spin currently in the air and already knows what it paid, so
the wheel reads that. The readout is the opposite case: while a spin is in
flight it shows "No more bets…", so it must drop the tier rather than keep
glowing gold over the next throw. Hence two separate tiers in `App.tsx`.

Verified by counting coin-gold pixels on the canvas across a settle: 28,407
baseline against 30,415 at peak on a 35x win. Before the fix the two were
identical, which is what exposed it.

### The betting layout is one grid, not a stack of rows
`ui/BetLayout.tsx`. The numbers, the zero, the 2:1 column bets, the dozens and
the even-money row all share the same tracks:
`26px repeat(12, 1fr) minmax(30px, 46px)`.

It was previously the number grid plus three separate rows of equal-width
buttons underneath, which could not line up *by construction*: three equal
columns across the full width do not fall on the same boundaries as twelve, and
none of the rows accounted for the zero's track at the far left. So a dozen sat
across arbitrary fractions of the numbers it covers.

Now it reads like a real table. The **column bets sit at the end of the row
they pay on** — `column:3` covers multiples of three, which is the top row —
and each dozen spans exactly the four number columns it covers. Verified by
measuring the rendered boxes rather than by eye: every dozen's left and right
edges match its first and last number, every column bet's top and bottom match
its row, and the even-money row starts and ends with the numbers, at both 537px
and 375px wide.

One trap worth remembering: Red and Black reuse the *number* colour classes, so
any CSS keyed on `.cell.red` catches all 36 numbers too. The outside bets carry
an explicit `outside-bet` marker for sizing.

### Hot and cold marks are a ranking, not a significance test
`pocketHeat` and `outsideHeat` in `game/state.ts`. The **three most-drawn
numbers** get an orange corner pip and the **three least-drawn** a blue one, and
each group of competing outside bets marks its leader: hottest dozen, hottest
column, and whichever of Red/Black, Odd/Even and 1-18/19-36 is ahead. Five
outside marks, always exactly one per group.

This replaced a significance test — marks only for pockets more than N sigma
from their expected count. That version was statistically honest but wrong for
the job twice over. First it was tuned badly: at 1.5 sigma each test fires ~13%
of the time, which across 37 numbers is ~5 marks on a *perfectly fair wheel* —
the multiple-comparisons problem, and the board looked covered in signal that
was pure noise. Then, corrected to under one mark per group, it was usually
empty, because on a fair wheel there frequently *are* no outliers.

A ranking answers the question players actually ask — "what has been running
hot" — rather than "is this wheel provably biased". The cost is worth stating
plainly, and the rules screen states it: **on a fair wheel the top three are
noise.** Three numbers sit at the top whether or not anything is happening.

Details that matter:

- Ties break toward the lower pocket and, in a group, toward the first member,
  so marks never flicker between equal counts from one render to the next.
- A number cannot be both hot and cold, which is reachable on a sparse tally.
- The floor is one full pass of the wheel (37 spins). Below that most pockets
  are tied on zero and "the coldest three" is just whichever three the sort left
  last. Verified: nothing marked at 36 spins, and nothing on an empty table.
- Cold is deliberately not shown for the outside groups. In a two-way group the
  loser is the one without a mark, so a second colour would add nothing.

Verified over 500 random tallies: exactly 3 hot and 3 cold numbers, and exactly
one mark per outside group, every time.

The marks are a **corner pip rather than a tint**: the cells already use red,
black and green to mean something, and recolouring them for a run of luck would
collide with the one thing on the table that must never be ambiguous. The pip
sits top-left because the staked chip badge owns the bottom-right.

### The rules screen explains what cannot be observed
`ui/Rules.tsx`, behind the **?** button in the tab row. It exists for two rules
that are genuinely invisible during play and that nobody works out by watching:
bonuses apply to a spin's **net** rather than to each bet, and a multi-ball spin
pays only its **best** ball. The payout table people deduce on their own; those
two they cannot.

It also states the consequence directly — covering red and black nets zero — so
the first thing anyone tries on noticing a payout multiplier is answered before
they spend an hour on it.

It also covers **Ivory and relics**, which matter more than they look: with the
flat payout multiplier withdrawn from the shop, Ivory and relics are now the
*only* things that move the multiplier at all, so cashing out is the progression
rather than an optional reset. The screen says so outright.

Two things keep it honest. Every number is read from the code rather than
retyped — payouts from `OUTSIDE_SPOTS` and `STRAIGHT_PAYOUT`, tiers from
`celebration.ts`, `IVORY_PAYOUT`, `IVORY_SCALE`, `STACK_FALLOFF`, the relic
slot constants and `RELICS.length` — so none of it can drift from behaviour the
way the "12 upgrades and 14 relics" line in this file did. And it adapts to the
player: the multiplier is their live `edge.payoutMult`, the Ivory paragraph
computes their own next threshold from `peak`, the relic line shows their own
equipped-to-slots count, and the best-ball section is hidden entirely until
Second Ball is owned so it never explains a mechanic that is not in play.

The Ivory wording is deliberate about one thing: a cash out **adds** to the
Ivory you hold, it does not replace it. Showing "you hold 7, this would pay 7"
reads as a swap, so the line spells out the arithmetic.

`rulesOpen` is component state, not `GameState` — which screen is open is not
progress, and persisting it would reopen the rules on every reload. It also
joins the list of overlays that suppress the spacebar, so space cannot spin a
wheel hidden behind it.

### Cadence is the constraint that sizes everything
At max Croupier's Haste plus a haste relic, a spin lands every **120–200ms**.
So celebrations are short, and a new throw **cancels the previous one outright**
by clearing sparks and the flare. The HUD roll-up shortens itself to the cadence
in play (`interval * 0.5`), or the figure would permanently chase a bankroll it
never catches. Measured under that load with four balls: **0 long frames, 0 JS
errors** across 14 spins.

### Things that must stay draw-only
The Loose Change cup leans into its travel, applied inside `drawCup` and nowhere
else. The catch test keeps using the upright mouth. A tilt that moved the hitbox
would quietly change how hard the game is, and difficulty is not something to
alter while adding polish.

Balls also now launch spread around the track rather than all from angle 0,
which previously stacked them on top of each other at the start of a cold spin.

## DEV scaffolding — remove before shipping

Two testing controls live in the row under the wheel in `App.tsx`, and neither
is meant to survive:

- **Speed** (`SPEEDS`) — plays a spin at 2x down to 0.1x. Safe by construction:
  `planSpin` is handed a longer duration and solves for a slower launch, so it
  is the same throw stretched out and the landing pocket is unaffected. Not
  persisted, so it resets to 1x on reload.
- **+$1k / +$100k** (`DEV_GRANTS`) — hands you cash to reach a part of the curve
  without playing to it. It raises `peak` alongside `chips`, so granted money
  inflates prestige as well; any balance measurement taken after pressing it is
  meaningless.

## Deliberate deviations from the tracker

- **`refit` rebuilds an unaffordable layout.** A layout left over from richer
  times can cost more than the bankroll, which makes `canSpin` quietly false and
  leaves auto-spin ticking forever doing nothing. Bets are scaled down
  proportionally and snapped to whole chips, so the result is a layout the
  player could have built by hand. An **empty** table is left empty — refit never
  invents a bet. It no longer does anything else; the re-stake and the
  wall-clock cooldown that used to live here are gone, which is why `now` is no
  longer threaded through `applyReturn`/`spin`/`catchUp`.
- **`lastSeen` only advances while the game is on screen.** A backgrounded tab
  suspends rAF, so the spin loop stalls; if the autosave kept stamping
  `lastSeen`, that stretch would earn nothing live *and* nothing offline.
  Instead the clock freezes on `visibilitychange` and the gap is paid out as
  offline earnings on return.
- **Splits, streets and corners are not implemented.** Straights plus the
  outside bets carry the whole design and keep the layout usable on a phone.

## Net settlement — how the hedge hole was closed

Covering red **and** black returns the whole stake on every non-zero pocket:
the winning side pays 1:1, so `S(1 + payout) = 2S`. The layout is risk-free
except for the zero. That made it a solvent for anything that adds value to a
win or softens a loss, because such a bonus applied to a position that never
had anything at risk. Measured on the old per-bet settlement, **seven of the
nine bonuses were individually profitable on a hedge**:

| bonus | hedge EV (old) |
| --- | --- |
| neutral | −2.69% |
| Second Ball x1 | **+21.64%** |
| Crimson + Obsidian | **+11.86%** |
| Ivory x10 (payout 1.2) | **+6.97%** |
| Green Tithe (zeroBounty 3) | **+5.42%** |
| Comp Suite (rebate .10) | **+2.43%** |
| Double Down / Snowball | **+2.14% / +2.12%** |

So this was never fixable field by field — Gilded Payouts and Comp Points were
only the cheapest two doors. `resolveSpin` now settles on the **net**.

Both were withdrawn at the time as a stopgap. **Comp Points has since come
back**, because net settlement removed the reason it was pulled — see below.
Gilded Payouts stays retired: a flat multiplier on every win is a different
thing from softening a loss, and Ivory already fills that role.

Each ball is tallied twice: once at true European odds with no edge at all
(`baseProfit`), and once with every win-side multiplier applied
(`bonusProfit`). Then:

- **`trueNet > 0`** — a genuine win. Net is `trueNet * (bonusProfit /
  baseProfit)`. Taking the *ratio* rather than a flat multiplier is what keeps
  Long Shot's per-bet weighting intact.
- **`trueNet <= 0`** — a genuine loss. Credits (rebate, zero insurance,
  neighbour pay) soften it but are clamped: `min(0, trueNet + softCredit)`.
  They can carry a loss up to zero and never above it.

A hedge has `trueNet` of exactly 0 on every non-zero pocket, and zero times any
multiplier is still zero.

One effect could not be expressed as a net and is priced against risk instead:

- **`zeroBounty`** (Green Tithe) deliberately pays a *profit* on the zero, which
  net settlement cannot express — on a hedge the zero is the only losing pocket,
  so an unconditional bounty hands back exactly what the hedge is missing. It is
  scaled by `(1 - covered/37) * (1 - insured)`: the first term prices it against
  how much of the wheel is actually at risk, the second against how much the
  zero actually costs. Without the second term, En Prison at max (100%) plus
  Green Tithe was a hedge that could not lose *and* got paid — worth +0.80%.

**Verified** across every risk-free layout (red+black, odd+even, low+high, all
three dozens) against all eleven bonuses and all of them stacked at once: worst
case **0.000%**, never positive. `returned` is never negative. The neutral wheel
still measures exactly **-2.7027%**, and real layouts still scale hard — a
straight bet with everything equipped runs +1554%.

The one build that reaches exactly 0.000% is En Prison at max level, which makes
a hedge genuinely lossless. That is fine: 0% cannot grow a bankroll.

### Comp Points is back, and only net settlement makes that safe
A rebate hands back a share of a losing spin. Under the old per-bet settlement
that was a money printer: 7.5% back took a red/black hedge to **+1.15%**,
because the losing half of a risk-free position collected a rebate it had never
risked anything to earn.

Under net settlement the same upgrade is harmless. The rebate comes off what the
spin **actually lost**, and the loss branch is clamped at zero, so a position
that never loses never collects. Driven through the real `buildEdge` path rather
than a hand-made Edge, with every loss-side relic stacked:

| build | red | straight | hedge r+b |
| --- | --- | --- | --- |
| nothing | -2.48% | -2.44% | -2.71% |
| Comp Points L3 | +0.83% | +4.95% | -2.47% |
| Comp Points L12 (max) | +12.91% | +25.89% | -1.89% |
| max + Comp Suite x3 | +22.58% | +45.82% | -1.34% |
| max + En Prison max | +14.67% | +29.99% | **0.00%** |
| everything, 60 Ivory | +509% | +7674% | **0.00%** |

Worst risk-free-layout EV across the lot: **0.000%**, never positive. The 0.00%
rows are the known En Prison case — a fully insured zero makes a hedge lossless
but still unable to grow.

`REBATE_PER_LEVEL` is 2.5% over 12 levels. An even-money bet needs about
**5.3%** back to break even against the zero, so level 3 is the turning point —
about $530 all in against a $400 opening bankroll. That is deliberate: it
restores a first act that had gone missing, since with the flat multiplier
withdrawn nothing in the shop moved the edge on its own.

Note it is **no longer in `RETIRED_UPGRADES`**. Leaving it there would have had
`load()` delete the level on every load, so the upgrade would have been
unbuyable in the least obvious way possible.

### Best ball takes the spin
Every ball is settled in full against the whole layout and the **single best
outcome is paid** — highest win, or failing that smallest loss. Only one ball is
ever paid, so a spin's ceiling is one bet's payout however many balls are in the
air.

The smallest-loss half is not a special case. Losing balls genuinely differ:
zero insurance applies only to a ball in the zero, and Neighbour's Cut pays on
the two pockets either side of a straight, so which ball loses least is a real
question.

This replaced an additive model where every winning ball paid 50% profit. That
version made each extra ball worth a **flat** slab of EV on top of the last
(+24.5, +23.6, +24.4, +25.1 points on an even-money layout), which no
compounding cost curve can track. Best-ball is self-limiting instead: it
saturates, because a second red ball is worth nothing when the first already
won.

| extra balls | straight:7 | red | dozen | marginal (red) | cost |
| --- | --- | --- | --- | --- | --- |
| 0 | -2.8% | -2.6% | -2.9% | — | — |
| 1 | +95.1% | +47.5% | +63.2% | +50.0 | $50,000 |
| 2 | +186.2% | +72.9% | +107.2% | +25.5 | $700,000 |
| 3 | +272.3% | +86.2% | +137.3% | +13.2 | $9,800,000 |
| 4 | +359.9% | +92.9% | +157.7% | +6.7 | $137,200,000 |

Two consequences worth knowing. Best-ball pays the winning ball at **full**
rate where the old extra balls paid half, so despite being self-limiting it is
*stronger* overall — four extra balls on a straight went from +190% to +360%.
And on outside bets it saturates toward +100% (with enough balls one of them is
always red), while straights stay near-linear because double hits are rare.

The cost curve has **not** been refitted to this and is now badly wrong in the
opposite direction: benefit halves each level while price multiplies by 14, so
only the first level is ever worth buying.

`pocketCounts` tallies **every** ball, not just the paid one. They are all fair
draws of the same wheel, and counting only the winner would bias the stats
toward whatever the player covers — wrecking the one thing that panel exists
for, showing the zero at its honest 2.70%.

Magnetism still nudges only ball 0; the other balls are straight draws.

Extra balls are drawn **without replacement** — a pocket holds one ball, so two
balls can never come to rest in the same one. Rejection sampling keeps the draw
uniform over whatever is still free. With four balls a duplicate would otherwise
have turned up on about one spin in six, and the two would have been painted
exactly on top of each other, so the spin would simply have looked like it was
missing a ball. Verified: 0 duplicates over 240,000 spins.

### Balls collide with each other
`coupleBalls` in `board/physics.ts`. This is a **positional constraint, not an
impulse**. The first attempt applied a decaying kick at the moment of contact —
the same shape as the deflector strikes — and it did not work: an impulse acts
after the fact, so at track speed the balls flew straight through one another
and were shoved apart on the way out. Measured penetration stayed at 100%,
meaning centres coinciding. Solidity is a claim about where the balls *are*, so
it has to be solved as position.

Each flight is sampled onto a grid and overlaps are relaxed away in place,
repeatedly, since separating one pair can push a ball into a third. Two escape
routes are used together:

- **Sideways**, an angular shove split evenly between the pair.
- **Climbing**, one ball riding over the other. This is not decoration. Two
  balls bound for different pockets *have* to cross, so at equal radius no
  amount of angular separation keeps them apart — with sideways push alone, p90
  penetration stayed at 79.9%. Whichever ball is already higher keeps climbing,
  so a pair resolves the same way throughout rather than trading places sample
  to sample.

Radial position is deliberately left alone: it is the fall trajectory, and
moving it would desynchronise the diamond strikes and the seat in the pocket.

Smoothing runs **between** relaxation passes, never after them. Applied once at
the end it blurs every correction back out, which measured as no improvement at
all.

The displacement winds down to **exactly zero by u = 1**, so like every other
perturbation here it cannot move the landing — verified at 0.0000% error and
zero wrong pockets over 2,000 randomised multi-ball spins.

**This does not fully eliminate overlap, and cannot.** Every ball is bound to a
pocket decided before the animation starts, so the balls are *required* to cross
each other; rigid non-overlap and a predetermined landing are in direct
conflict. The constraint roughly halves median penetration (44% to 20%) and
makes contacts read as shoves and hops, but fast crossings still interpenetrate.
`BALL_SIZE` is the one real lever, and it is now **0.028**, down from 0.036.
Worth knowing before anyone reaches for it again: it works on the *frequency* of
overlap, not on the depth.

| BALL_SIZE | samples overlapping | p50 depth (of a ball) | p50 depth (absolute) |
| --- | --- | --- | --- |
| 0.036 | 1.563% | 19.8% | 0.0143 R |
| 0.032 | 1.354% | 20.1% | 0.0129 R |
| **0.028** | **1.188%** | **21.1%** | **0.0118 R** |
| 0.024 | 0.951% | 22.4% | 0.0108 R |
| 0.020 | 0.780% | 23.4% | 0.0094 R |

Relative penetration is flat — slightly *worse*, in fact — across the whole
range, which is the expected shape: a smaller ball that overlaps still overlaps
by the same proportion of itself. What improves is how often it happens and how
many pixels deep it goes. At 0.028 the two together cut visible interpenetration
by roughly a third; 0.020 would cut it by two thirds, at a ball small enough to
lose on a phone.

Balls seated in *adjacent* pockets still touch by a sliver whatever the size —
0.170 rad apart against 0.178 rad wide at 0.036, and the gap closes
proportionally as the ball shrinks — which is what real balls separated by a
fret do anyway.

### What this changes for normal play
A mixed layout that wins on one bet while losing another now pays less than it
used to, because the multiplier applies to the net rather than to the winning
bet's gross. With `payoutMult 1.2`, `red $20 + straight:7 $10` landing on red
pays **+$12** (`10 net x 1.2`), where the old engine paid +$14
(`20 x 1.2 + 20 - 30`). Single-bet layouts are unchanged: a $10 straight at
1.2x still pays +$420.

## Balance targets (re-check the sims after changing any cost curve)

- First cash-out in **20–40 minutes**. Measured by bet sizing: 39m conservative
  (5% of bankroll), 29m moderate (10%), 23m aggressive (20%).
- **Table Limit's cost growth must not exceed the denomination ladder's ~3.16×
  step.** This is the single most important number in the economy: if limits get
  relatively more expensive each level, the affordable stake falls further behind
  the bankroll every level and growth strangles no matter how high the payout
  multiplier climbs. That bug alone cost 20 hours to first prestige.
- Relics land between roughly +2.5% and +29% of EV gain on the layout they are
  for. The top of that band (Neighbour's Cut, High Roller, Crimson/Obsidian) is
  conditional — each demands you commit your layout or your bankroll.

## Deferred (not v1)

- Splits/streets/corners; American double-zero wheel as a "worse table" tier.
- Relic synergies and rarity tiers; relic removal/rerolling.
- Bet-strategy automation (martingale and friends) beyond flat auto-replay.

## Open questions

- **Is the opening act now the right length?** Comp Points level 3 flips an
  even-money layout positive for about $530 against a $400 start, so it is a
  short grind rather than the single 25-chip purchase it used to be, and no
  longer the unmeasured void it became when the rebate was withdrawn. Whether
  $530 is the right ask has not been playtested.
- **Straight-bet builds are only viable with Neighbour's Cut.** Straights carry
  brutal variance; without that relic they are a trap. Either that is the point,
  or straights need a second support.
- **The relic pool is drafted, never removed.** By 14 cash-outs everyone has
  everything and builds converge. Rarity tiers or a rotating subset would keep
  later prestiges distinct.
- **Is Loose Change too good an income?** It is repeatable with no cooldown and
  pays face value, so it is roughly $20/40s at level 0 — meaningful against a
  $400 starting bankroll, irrelevant once the table scales. It also feeds
  `peak`, and so prestige. The levers if it needs curbing are a cooldown on the
  voluntary route, or excluding voluntary winnings from `peak`.
- **The balance sims have not been re-run since Loose Change landed.** The
  20–40 minute first cash-out target was measured without it.
