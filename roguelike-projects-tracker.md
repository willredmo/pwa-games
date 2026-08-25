# Roguelike PWA Projects — Tracker

Four roguelike games, PWA-first. Shared philosophy: turn-based / tick-based over real-time where possible, to keep builds light, installable, and free of netcode headaches for v1.

**Stack default:** Web-native (Canvas/PixiJS or Phaser + TS/React), Supabase or Firebase realtime for turn exchange. Unity/DOTS considered only as a possible v2 native port later, leveraging existing RTS project experience.

## Infra plan (decided)

- **Frontend:** React (owns UI/state) + plain Canvas 2D (owns board rendering, driven imperatively from game state). No PixiJS for now — none of the three games need sprite-heavy/WebGL rendering.
- **Repo structure:** one monorepo with shared packages.
  ```
  /apps
    /checkers-roguelike
    /duel-deck        (1v1 game)
    /root-and-ruin     (co-op game)
    /house-edge        (incremental roulette)
  /packages
    /pwa-shell         (manifest template, service worker, install prompt UI)
    /game-ui           (shared React components: HP bars, upgrade-pick cards, buttons)
    /canvas-utils       (board/grid rendering helpers, shape/color constants)
    /backend-client     (Supabase/Firebase wrapper for realtime turn exchange)
  ```
- **Tooling:** pnpm workspaces (Turborepo optional, worth adding once iterating across all 3 apps regularly)
- **Checkers** depends only on `pwa-shell`, `game-ui`, `canvas-utils` — no backend needed, simplest deployable slice, good first target to validate the pipeline.
- **Duel Deck** and **Root & Ruin** pull in `backend-client` once their multiplayer pieces are built.

---

## 1. 1v1 Game — "Duel Deck" (working title)

**Status:** Design in progress (v1 scope locked)

**Pitch:** Continuous-skirmish auto-battler duel. No separate draft phase — players build up their board round by round, mid-match, roguelike-style. Combat resolves as an auto-battle each round (deterministic sim, both clients render the same result from a synced commit).

**Round loop:**
1. Both players see current board state (shared single row — both sides' units face each other across a center line; front-most units clash first)
2. Each player picks 2 of 5 offered unit options to add to their board
3. Periodically (cadence TBD), each player is separately offered a choice of persistent upgrades — match-scoped buffs (not units) that target specific units/classes, e.g. "+attack to all Strikers," "+health to your front-line unit." This is a separate offer track from the unit picks, not merged into the same pool.
4. Both submit simultaneously → auto-battle resolves
5. Winning side's total damage dealt that round is subtracted from the losing player's HP
6. Repeat until a player's HP hits 0

**v1 scope (locked):**
- **Layout:** Single shared row — both players' units occupy the same row/lane, facing off across a center line, rather than separate zones. Front-most units clash first. 3-5 row (Plants vs Zombies style) lane expansion is a future upgrade path, not v1.
- **Units:** No ranged units for now — melee/front-line only. Targeting: only the front-most unit on each side fights (no multi-target); when a front unit dies, the next in queue steps up.
- **Unit upgrades:** Pick 2 of 5 options per round, drawn from a flat (non-scaling) pool. Scaling/rarity tiers deferred to later.
- **Persistent upgrades:** Separate offer track from unit picks, offered every 3rd round. Match-scoped (last for the current match only, not carried between matches). Apply bonuses like added health/attack to specific units or unit classes, plus synergy-based options that reward specific board compositions.
- **Economy:** No gold/currency for v1 — picks are free. Economy system to be layered in later.
- **Win condition:** Each player has their own 100 HP pool. After each round, the winning side's total damage dealt that round is subtracted from the losing player's HP. First to 0 loses.
- **Theming:** Abstract/geometric — units rendered as flat shapes (circle, square, triangle, diamond) with color encoding ownership/type. Cheap to produce, reads clearly on a single row, easy to reskin later.
- **AI opponent:** Planned for solo testing/balancing. v1 approach: random picks for both unit picks and persistent upgrades. Smarter logic (stat-scoring, then board-synergy awareness) to be built once the game is more defined.

**Open questions:**
(none currently — core 1v1 loop, units, and upgrade pools are defined; next step is implementation or moving to another project)

**Unit pool (v1, first pass):**

| Unit | Attack | Health | Role |
|---|---|---|---|
| Guard | 3 | 10 | Tanky, absorbs hits, low output |
| Striker | 6 | 4 | Glass cannon |
| Skirmisher | 5 | 5 | Balanced all-rounder |
| Bulwark | 2 | 14 | Max tank, meant to stall |
| Berserker | 8 | 3 | Highest attack, very fragile |

**Persistent upgrade pool (v1, first pass):**

*Class-targeted:*
- Reinforced plating — +3 health to all Guards and Bulwarks
- Sharpened edge — +2 attack to all Strikers and Berserkers
- Steady footing — +2 health to all Skirmishers
- Adrenaline — +2 attack to all Berserkers
- Iron will — +4 health to all Bulwarks specifically
- Precision strikes — +1 attack, +1 health to all Strikers

*Global:*
- Battle fury — +1 attack to every unit currently on your board
- Last stand — front-most unit at pick time gains +5 health (one-time)
- Momentum — each round your board wins, all units gain +1 attack permanently (stacks); rewards a strong start/snowballing
- Desperate measures — while your HP is below 30, all units gain +3 attack; comeback mechanic
- United front — +1 health to all units for every unit on your board (stacks with count); rewards wide boards
- Overwhelm — if you have more units than your opponent, all your units gain +1 attack; rewards out-numbering
- Bloodpact — all units gain +2 attack, but max HP is reduced by 10 for the rest of the match; high-risk pure power trade

*Synergy-based:*
- Tank wall — +2 health to all Guards/Bulwarks *per* Guard/Bulwark you have (stacks with count); rewards tank-heavy boards
- Glass cannon pact — +3 attack / -1 health to all Strikers/Berserkers; rewards all-aggro commitment
- Vanguard's edge — front-most unit gets +2 attack/+2 health, re-applies each round to whoever is currently front; rewards funneling into the front-line unit
- Mixed formation — +1 attack/+1 health to all units, only if you have 3+ different unit types on board; rewards diverse boards
- Berserker's rally — whenever a Berserker dies, all remaining units gain +1 attack for the rest of the match; rewards using Berserkers as aggressive/sacrificial fodder

**Tech notes:**
- Backend: Supabase/Firebase realtime for turn exchange (simultaneous commit each round)
- No engine needed — Canvas/PixiJS
- Auto-battle sim should be deterministic so both clients can replay it locally from a synced seed/result rather than streaming the fight live

---

## 2. Co-op Game — "Root & Ruin" (working title)

**Status:** Concept

**Pitch:** Asymmetric 2-player co-op. One player is the "Warden" managing a base/economy between runs; the other is the "Runner" descending a procedural dungeon. Runner can call back to base for resource drops.

**Why turn-based for v1:** Real-time dungeon crawling is the risky part for PWA performance/sync. Scoping the Runner side as turn-based/grid crawling (Brogue-style) keeps the whole game PWA-friendly and avoids needing Unity.

**Open questions:**
- [ ] Do both players play simultaneously (Warden manages live while Runner explores) or is it turn/phase-based for both?
- [ ] What can the Warden actually send/build mid-run vs. only between runs?
- [ ] Session length target per run?

**Tech notes:**
- Warden UI: grid/resource management screen (light, PWA-friendly)
- Runner UI: turn-based grid dungeon crawl

---

## 3. Checkers Roguelike — single-player first

**Status:** Design in progress

**Pitch:** Ladder of full checkers matches against escalating AI opponents. Standard checkers rules/engine underneath — roguelike-ness comes entirely from picks made between floors (piece upgrades, board mutations), not from altered core rules.

**Run structure:**
- 10-floor ladder, single loss ends the run (permadeath, no lives/retries for v1)
- Board size grows across 3 tiers as floors progress: floors 1-3 on 6x6, floors 4-7 on standard 8x8, floors 8-10 on 10x10
- AI gets harder per floor (primarily via deeper search/lookahead) and may also receive random upgrades/picks similar to the player, for v1

**Piece upgrades (picked between floors, choose which existing piece gets it):**
- Backward strike — capture backward without being crowned
- Long leap — jump two squares in a single capture move
- Fortified — can't be captured the first time it's attacked (one-time shield)
- Swift — can move (not capture) two squares instead of one
- Early king — crowned immediately, gains king movement
- Double strike — can chain-capture across non-adjacent diagonals
- Guardian — adjacent friendly pieces can't be captured while this piece is on the board
- Phantom step — once per match, this piece can take an extra move

**Board mutations (v1 scope: size and shape only):**
- Size: 6x6 → 8x8 → 10x10 across floor tiers (core progression axis)
- Shape: rectangular variants only for v1 (wider or longer, e.g. 10x6, 6x10) rolled on certain floors instead of a standard square
- Deferred to later: hazard squares, notched corners, hourglass/diamond shapes, asymmetric start rows

**Starting setup:** Player begins each run with 4 basic pieces (not a full standard checkers set).

**Piece upgrades:** Offered as pick-1-of-3 per floor.

**Implementation note:** build move/capture logic generically off row/col bounds from the start (not hard-coded to 8x8), since non-square board variants are already planned for v1.

**Open questions:**
- [ ] Exact AI difficulty curve per floor (search depth values) — needs playtesting
- [ ] Which floors roll shape mutations vs. standard square boards, and how that's decided (fixed schedule vs. random)

**Tech notes:**
- Simplest of the three technically — good candidate to actually ship first / validate the PWA pipeline (manifest, offline support, install prompts) before tackling the other two.

---

## 4. Incremental Roulette — "House Edge" (working title)

**Status:** Built and playable (v1 scope implemented, balance pass done)

**Pitch:** An idle/incremental game about buying your way past the house edge. A
real European wheel pays −2.70% per unit staked. You start there, on the wrong
side of it, and every upgrade is a way of clawing that back and then past it.
Manual betting at first; auto-spin unlocks and takes over the grind.

**Core loop:**
1. Place chips on a roulette layout (straights, dozens, columns, red/black,
   odd/even, high/low) and spin
2. Buy upgrades with winnings — each one bends the odds a little further
3. Unlock auto-spin, which replays your layout on its own, ever faster
4. Cash out (prestige) to bank **Ivory**, wiping chips and upgrades but keeping
   Ivory and relics — and draft **1 relic from 3**
5. Repeat with a permanently stronger wheel

**Why this loop:** unlike the other three games there is no opponent and no
netcode — it is fully client-side, so it can be picked up at any time
independently of the build order.

### v1 scope (implemented)

- **Wheel:** European single-zero, 37 pockets in true physical order.
- **Bets:** straights 35:1, dozens/columns 2:1, even-money outside bets 1:1.
  Splits/streets/corners deferred — they crowd the layout on a phone.
- **Chips:** a denomination ladder (10, 50, 100, 500, 1k, …) unlocked by the
  Table Limit upgrade. Bet sizing is the main pacing decision the player owns.
- **Currency:** Chips within a cycle; **Ivory** across cycles
  (`floor(sqrt(peak / 1e6))`, paid on peak bankroll, not total earned).
- **No fail state.** Below one minimum chip the house re-stakes you. Permadeath
  belongs to the other games; an idle game needs a floor.
- **Offline earnings:** time away is simulated with the real spin resolver, at
  half rate (full rate with the Clockwork Croupier relic), capped at 8 hours.

### Upgrade pool (v1)

| Upgrade | Effect | Base cost |
|---|---|---|
| Gilded Payouts | +8% payout per level | 25 |
| Comp Points | +1.5% of losing stakes refunded per level | 250 |
| Table Limit | Unlocks the next chip denomination | 200 |
| En Prison | +20% of stake survives the zero per level | 600 |
| Hire a Croupier | Unlocks auto-spin (one-time) | 200 |
| Weighted Wheel | +1% chance the ball is nudged onto a covered pocket | 1,500 |
| Croupier's Haste | Auto-spin 8% faster per level | 250 |
| Second Ball | +1 extra ball per spin, paying 50% profit | 50,000 |

### Relic pool (v1) — drafted 1-of-3 on every cash out, kept forever

Ivory Ledger, Green Tithe, Loaded Wheel, Neighbour's Cut, Snowball, High Roller,
Crimson Devotion, Obsidian Devotion, Double Down, Marathon, Clockwork Croupier,
Comp Suite, Deep Pockets, Iron Guarantee. Relics are the only source of build
variety between cycles — upgrades are the flat idle backbone, relics bend rules.

### Balance targets (verified by headless simulation)

- Neutral wheel measures −2.70%; first Gilded Payouts level flips an even-money
  layout to +1.1%.
- **First cash-out in 20–40 minutes** — 39m betting 5% of bankroll, 29m at 10%,
  23m at 20%.
- **Table Limit cost growth must not exceed the denomination ladder's ~3.16x
  step**, or the affordable stake falls behind the bankroll every level and
  growth strangles regardless of payout multiplier.

### Physics spinner

The ball is animated with a launch solved backwards from the already-decided
pocket: exponential angular decay, with the launch speed chosen so the natural
deceleration ends exactly on target (~11 relative revolutions). Rim ride,
inward spiral, 8 deflectors and a fret rattle are perturbations shaped to be
zero at the landing, so they never move the result. 4,000-trial verification:
worst-case error 0.0000% of a pocket width.

**Open questions:**
- [ ] Is the negative-EV opening too short? One 25-chip purchase flips it.
- [ ] Straight-bet builds are only viable with the Neighbour's Cut relic.
- [ ] By 14 cash-outs every relic is owned and builds converge — rarity tiers or
      a rotating subset would keep later prestiges distinct.

**Tech notes:**
- No backend, no engine — React + Canvas 2D, same stack as the other apps.
- `resolveSpin` is pure with injected RNG, so the same function drives live
  play, offline catch-up and the balance simulations.

---

## Cross-project notes

- **Suggested build order:** Checkers roguelike (simplest, validates PWA tooling) → Duel Deck (1v1, proven genre) → Root & Ruin (co-op, most design risk). House Edge sits outside this order — no backend, no shared mechanics, pick it up any time.
- **Shared infra to build once:** PWA shell/manifest setup, account/session handling, shared backend for realtime turn exchange.
