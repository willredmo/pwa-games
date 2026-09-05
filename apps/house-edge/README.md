# House Edge

An incremental roulette roguelike. You start on the wrong side of the house
edge and spend the game clawing your way onto the right side of it.

A real European wheel pays **−2.70%** per dollar staked. That number isn't
flavour text — it's the opening state of the game, and every upgrade, relic and
prestige is a way of dragging it upward. The Cash Out tab shows your *realised*
edge as you play, so you can watch it move.

Runs entirely in the browser. No account, no backend, no network. Progress
saves to `localStorage`.

---

## Playing

**Place bets** by tapping the layout. Tap adds one chip, right-click takes one
back. Chip size is chosen with the `$10 / $50 / $100 / $1k` buttons, and
`½ / ×2 / ×5 / ×10 / Max` scale everything on the table at once.

**Spin** with the button or the **spacebar**.

| Bet | Pays |
| --- | --- |
| Straight (single number) | 35:1 |
| Dozen / Column | 2:1 |
| Red / Black, Odd / Even, 1–18 / 19–36 | 1:1 |

The zero loses every outside bet. That is the house edge, modelled honestly —
it is where the −2.70% comes from, and it's why "cover red and black" is not a
winning idea.

You start with **$400**. If you fall below the minimum stake, you top up by
playing **Loose Change** rather than being handed money.

---

## Progression

### Upgrades — the shop

Fifteen upgrades in two sections. **The Table** improves the wheel itself:

| Upgrade | Effect |
| --- | --- |
| Comp Points | Hands back a share of what a losing spin cost you |
| En Prison | Part of your stake survives the zero |
| Hire a Croupier | Unlocks auto-spin |
| Croupier's Haste | Auto-spin cadence |
| Weighted Wheel | Small chance the ball is nudged onto a covered pocket |
| Long Shot | Extra payout on single numbers — the only bet paying 8:1 or better |
| Second Ball | Extra balls per spin — the best single ball takes the spin |
| Gild a Pocket | Mark a number to pay double when it lands |
| House Account | Mark a number that hands your stake back |
| Linked Pair | Wire two numbers together — a straight on one pays 35% on the other |

The last three are **placed, not just bought**. Buying grants an allowance and
drops you on the table to choose the number; a pocket holds one mark, and a
placement is permanent until you cash out.

**Loose Change** upgrades the mini game: Wider Cup, Rush Hour (change falls
faster), Double Take (a chance a catch counts twice), Lucky Spill (better
denominations fall), Steady Hands (the cup drifts toward drops on its own, never
faster than you can move it).

> Note: buying **Hire a Croupier** produces no visible change in the shop. It
> unlocks an **Auto** button in the bet controls on the Table tab, and it starts
> switched off.

### Relics

Fifteen of them, drafted one from three every time you cash out and kept
permanently. Only equipped relics do anything; you start with 5 slots and gain
one every 5 cash outs, to a maximum of 8. Duplicates stack at reduced value.

They are deliberately build-defining rather than incremental — Green Tithe makes
the zero pay you, Neighbour's Cut pays out on the pockets either side of your
straights, Crimson Devotion only fires on red.

### Cash Out (prestige)

Banks your **peak** bankroll this cycle as **Ivory**: `floor(sqrt(peak / 1e6))`.
Cash, upgrades and layout are wiped; Ivory and relics are kept. Each Ivory is
worth +2% payout forever, and every cash out drafts a relic.

Paying on *peak* rather than total earnings matters: it means the reward tracks
how far you actually got, instead of rewarding a losing player for churning
spins.

---

## Loose Change

The bankroll has a floor, because a bankroll below the minimum chip can't place
a legal bet and the game would simply stop. But the floor is **claimed, not
granted** — open Loose Change from the ☕ button and catch the spill.

- Move with **A/D** or the **arrow keys**; dragging works too.
- **No fail state and no clock.** Missing a drop costs nothing.
- You can stop once bankroll plus change in hand reaches **$20**, and there is
  no upper limit — keep going as long as you like.
- Drop speed is constant on purpose: a difficulty ramp on an untimed game only
  punishes a long run.

---

## A note on the wheel

The wheel isn't decoration over a random number generator, and it isn't a
simulation either. The pocket is decided by the resolver **before anything is
drawn** — that's the fairness model, since every modifier is computed against
it — and the animation's job is to look like a real throw while arriving exactly
where it was told.

So the ball rides the track under near-constant friction, drops off it abruptly
at a critical speed, clips a deflector diamond, and scatters across the frets,
all with the landing pinned to the pocket the engine chose. With Second Ball,
several balls share one rotor, collide with each other, and land together.

If you want the reasoning behind any of it — why the scatter is swept angle
rather than a wobble, why collisions are a positional constraint rather than an
impulse, why settling per *net* is what closes the red/black hedge — that's all
in [CLAUDE.md](CLAUDE.md), along with the measurements behind each decision.

---

## Running it

From the repo root:

```bash
pnpm install
```

```bash
pnpm --filter house-edge dev
```

Other scripts: `build` (typechecks, then builds), `preview`, `typecheck`.

### Testing controls — not shipping

The row under the wheel holds scaffolding meant to be stripped before release:

- **Speed** (2× down to 0.1×) — replays a spin slowly. Safe by construction: the
  physics solves for a longer flight, so it's the same throw stretched out and
  the landing is unaffected.
- **Reset** — wipes the save.
- **+$1k / +$100k** — hidden. Set `SHOW_DEV_GRANTS` in `App.tsx` to bring them
  back. They raise `peak` alongside cash, so **any balance measurement taken
  after pressing one is meaningless** — which is why they are a flag rather than
  a deletion, and why the speed control stays visible while these do not.

---

## Stack

React for UI and state, plain Canvas 2D for the wheel driven imperatively from
a game-state object, TypeScript throughout, Vite + `vite-plugin-pwa`. No game
engine and no sprite library — the whole wheel is drawn with paths and
gradients.
