# Knock Hockey — Build Plan

A top-down, physics-based take on the wooden knock-hockey board. Two players
take turns hitting a puck with a mini hockey stick, banking it off the walls
and around the blocks to get it into the other player's goal. You can play
against an Easy, Medium or Hard CPU, or pass-and-play against another person
on the same device. Sticks can be customized (looks only).

It's a PWA in this monorepo. It isn't a roguelike: there are no runs and no
upgrades.

**Status (Oct 8, 2026):** steps 1–8 are built (deployed to
https://knock-hockey.web.app), and local PvP is built too. Shooting changed
from pull-back-and-release to: set power on the bar, aim, press Hit; every hit
gets a slight random wobble. See `CLAUDE.md` for how it
works now. Two changes from this plan: a puck that stops against a rail is
played where it lies (no nudge), and the board is 300×600 rather than 300×520.

---

## 1. The game

### Board (portrait, so it fits a phone held upright)
```
 ┌──╲────[ GOAL ]────╱──┐   ← CPU / Player 2 end
 │   ╲       ◇      ╱   │   ← a diamond block guards each goal
 │                      │      (a square turned so a corner points at the goal)
 │                      │
 │           ●          │   ← puck starts at centre ice
 │                      │
 │                      │
 │   ╱       ◇      ╲   │   ← slanted wood fills each corner (a triangle)
 └──╱────[ GOAL ]────╲──┘   ← Player 1 end
```
- The board is a rectangle with raised wooden rails. There's no centre wall:
  the whole board is open.
- **Goals:** a slot cut in the middle of each end rail. The puck scores once it
  has fully crossed into the slot.
- **Diamond blocks:** a square block turned on its corner sits just in front
  of each goal. It blocks a straight shot, so the main ways in are bank shots
  that come around or behind it.
- **Corner wedges:** each of the four corners is filled with a slanted piece
  of flat wood, making a triangle. The puck bounces off the slanted face.
- **The key trick works on purpose.** A shot from the side, straight into a
  corner wedge, glances off it into the gap behind the diamond and into the
  goal. The wedge angle, the diamond's size and position, and the goal width
  are tuned together so this shot reliably works when it's well aimed.
  - The headless sim (§2) checks that this shot exists from a range of
    side positions.
  - Without that check, a small change to the geometry could quietly break
    the game's main strategy.
- All art is flat and geometric, per the repo convention: wood-tone fills, a
  painted floor, and drawn line markings. No image assets.

### Turns
- **Strict alternation.** Players take turns, one hit each. On your turn you
  can hit the puck wherever it is on the board, in either half.
- The puck slides until it stops, then the turn passes to the other player.
- **Start of the match and after each goal:** the puck is placed at centre
  ice. The player who was just scored on takes the first hit. Who goes first
  in the match is decided by a coin flip; in vs CPU, the human goes first.
- **Puck against a rail:** it's played where it stops. The stick can hit it
  from any angle.
- A match is **first to 10** goals.

### Shooting controls: aim, then pull back (like billiards)
One input scheme for both mouse and touch, in two parts:
1. **Aim.** Drag anywhere on the board to turn the stick around the puck. The
   stick follows your finger. Dragging far from the puck gives finer aim. A
   dotted aim line shows the direction.
2. **Pull back for power.** Grab the stick, or the power bar beside the
   board, and pull it back along the aim line. The stick visibly slides back
   from the puck. The further back, the harder the hit, and a power meter
   shows how hard.
3. **Release to hit.** The stick snaps forward into the puck, which gets an
   impulse from the angle and the pull-back distance.
- Pushing the stick back to the puck before releasing cancels the shot.
- The aim line is short and shows no bounces, so bank shots take skill. A
  setting can turn off the line for a harder game.
- **Spin is planned for later** (see §7). The controls leave room for it: a
  later version could add an "English" picker, like billiards, for where on
  the puck the stick hits.

## 2. Physics (`src/physics/`)
Build it by hand. No physics library is needed for one circle among static
shapes.

- **Fixed timestep** of 1/120 s, updated with an accumulator so the result
  doesn't depend on frame rate.
- The sim is **deterministic**: same start position plus same shot gives the
  same result every time. This matters because the CPU picks shots by
  simulating them (§3).
- **Shapes:**
  - the puck is a circle;
  - the rails, the four corner wedges, and the two diamonds are all convex
    polygons made of line segments, with the end of each segment treated as a
    round cap so the puck bounces properly off corners and points;
  - each goal mouth is a gap in the end rail, with short posts on each side.
- **Bounces:**
  - restitution of about 0.8 on wood, which can be tuned per surface;
  - sliding friction slows the puck by a constant amount, with a little extra
    drag in proportion to speed;
  - the puck stops once its speed drops below a small threshold.
- No spin for now. The puck's state is just position and velocity. Spin later
  only needs an angular velocity added, plus a rule for how it changes bounces.
- **Tunnelling guard:** each step is split into sub-steps when the puck is fast
  (a swept circle check), so hard shots can't pass through thin walls.
- **API:**
  - `simulateShot(state, shot) → { path, rest, goal }`, used by both the CPU
    and replays;
  - `step(world, dt)`, used for live playback.
- A **headless test script** (`pnpm sim`, like Duel Deck's) checks:
  - over thousands of random shots, the puck never leaves the board, never gets
    stuck, and every shot finishes in a bounded number of steps;
  - **the corner shot:** from a spread of positions along each side rail, at
    least one angle and power bounces off the wedge, goes behind the diamond and
    scores.

## 3. CPU opponents (`src/ai/`)
Every level picks a shot by *simulating candidates* with the deterministic
engine and scoring where each one ends up. The levels differ in how many
candidates they try, how they score them, and how much error they add to the
chosen shot.

Since the diamond blocks most straight shots, even Easy has to find banks
sometimes. Otherwise it would almost never score.

| | Easy | Medium | Hard |
|---|---|---|---|
| Candidates | ~16 random angle/power pairs | ~90 angles × 4 powers | ~240 angles × 6 powers, plus refined passes around the best |
| Shots it finds | lucky banks; no real plan | single banks, including the corner-wedge shot | multi-bank shots, the corner shot from more spots, plus a **defensive** score |
| Aim error | large (±8°, ±25% power) | small (±2.5°, ±10%) | tiny (±0.6°, ±3%) |
| Mistakes | often leaves the puck in a good spot for you | sometimes | rarely |

- **How a shot is scored:**
  - a big bonus for scoring;
  - a big penalty for an own goal;
  - otherwise, where the puck stops matters: deep in your half and far from the
    CPU's own goal is good. Leaving the puck by the side rails near the CPU's
    own end is bad, because that sets up your corner shot.
- **Hard looks one move ahead.** For each candidate's resting spot, Hard checks
  how good *your* best reply would be, using a cheaper search, and avoids
  shots that leave you an easy goal.
- The CPU "thinks" for 400–900 ms (longer on Hard). Its stick visibly turns to
  aim, then pulls back before swinging, using the same pull-back animation a
  human shot has. You can see what it's doing.
- Each search runs in small chunks with `requestIdleCallback` (or a Web Worker
  if Hard is too slow on phones), so the UI never freezes.
- **Tuning:** the headless sim plays CPU against CPU. Targets are
  Hard beats Medium about 70% of the time and Medium beats Easy about 85%,
  the same approach as Duel Deck's difficulty tuning.

## 4. Modes
- **vs CPU:** pick Easy, Medium or Hard on the start screen. Difficulty is
  locked once the first shot is taken, like Duel Deck's lock.
- **Local PvP (pass-and-play):** two people share one device. Player 1 defends
  the bottom goal and Player 2 the top. The board stays fixed and never
  rotates.
  - A banner shows whose turn it is ("Blue's shot"), and only the current
    player's input is accepted.
- **Online PvP is out of scope for v1.** The deterministic engine makes it easy
  later: send only `{angle, power}` per turn through the shared
  `backend-client` Firebase package and replay it on both devices.

## 5. Stick customization ("Locker")
The sticks look like mini hockey sticks: a shaft, a curved blade and tape.

- **Parts you can change:**
  - **Blade shape:** straight, mid curve or big curve. Looks only, like every other option here: no stick changes how a shot plays.
  - **Shaft colour and finish:** solid, two-tone or wood grain, drawn as
    stripes.
  - **Blade colour.**
  - **Tape:** colour and pattern (solid, striped or checker) on the blade, plus
    the knob at the end of the shaft.
  - **Decal:** a short text or number on the shaft, up to 3 characters.
- **Locker screen:** a big live preview of the stick, drawn with the same
  canvas code used in the game, above swatch pickers. A Randomize button sits
  beside it.
- Each player gets their own stick. In PvP, Player 2 has a separate saved
  stick. The CPU uses a fixed look per difficulty: wood for Easy, red for
  Medium, black carbon for Hard.
- Sticks are saved to `localStorage`, with try/catch around every read and
  write and defaults if storage is unavailable.
- **Possible later addition:** unlock patterns and colours by beating each
  difficulty (Hard unlocks gold tape) and track a win record per difficulty.

## 6. App shell (reuse what Duel Deck already proved)
- Vite 5, React 18, Canvas 2D and TypeScript.
- Copy Duel Deck's working pieces:
  - `vite.config.ts`: the PWA plugin with `registerType: "prompt"` and the
    `version.json` emitter;
  - `src/pwa.ts`;
  - `UpdatePrompt`;
  - `MenuPanel`, with the "last deployed" About section.
- That makes two apps with the same PWA code. Moving it into
  `packages/pwa-shell` (already planned in the root CLAUDE.md) is a good
  follow-up, but it's kept out of the critical path.
- **Screens:**
  - Title, with a Play vs CPU button (and a difficulty picker), a 2 Players
    button and a Locker button;
  - Game;
  - Goal toast and score bump;
  - End screen with stats: shots taken, goals, bank-shot goals, longest rally
    and fastest shot;
  - the ☰ menu.
- The current match is saved to `localStorage`, so a reload resumes it, like
  Duel Deck's `SavedMatch`.
- Sound (wooden clack, goal buzzer) is optional and off until the first tap,
  because of browser autoplay rules.

### Suggested file layout
```
apps/knock-hockey/
  CLAUDE.md            game rules + conventions (written from this plan)
  src/physics/         world.ts (board geometry), step.ts, collide.ts, simulate.ts
  src/ai/              cpu.ts (candidate search + scoring per difficulty)
  src/game/            match.ts (turns, faceoffs, scoring), stats.ts, save.ts
  src/render/          board.ts, stick.ts (shared with Locker), fx.ts
  src/ui/              Title, Locker, Hud, EndScreen, MenuPanel, UpdatePrompt
  scripts/sim.ts       physics fuzz + CPU-vs-CPU tuning
```

## 7. Build order (each step is playable or testable before moving on)
1. **Scaffold.**
   - Create the app from Duel Deck's config.
   - Add the PWA manifest and icons (a puck and stick drawn as an SVG).
   - Add the `dev` launch config and a `release` script.
   - **Done when:** it builds and installs.
2. **Physics sandbox.**
   - Board geometry (rails, corner wedges, diamonds, goal slots), puck,
     bounces and friction.
   - Drag to flick the puck, before the stick visuals exist.
   - Headless fuzz in `pnpm sim`.
   - Tune the wedge angle, diamond size and goal width until the corner shot
     works, and add its check to `pnpm sim`.
   - **Done when:** the puck feels right, never escapes or sticks, and the
     corner shot reliably scores.
3. **Rules.**
   - Strict turns, centre-ice restarts after goals, the rail nudge, goals and
     first to 10.
   - Local PvP works at this point, since the game is now playable.
4. **Stick and shot feel.**
   - Draw the stick and build aim-then-pull-back: the stick slides back with
     the power meter, then snaps forward on release.
   - Add hit effects (a small wood-chip flash, a screen nudge on hard hits).
5. **CPU.**
   - Build Easy, then Medium, then Hard.
   - Tune them with CPU-vs-CPU runs in `pnpm sim`.
   - Make the CPU's thinking visible: the stick lines up before it swings.
6. **Locker.**
   - The customization screen, saved sticks, and per-player sticks in PvP.
7. **Menus and polish.**
   - Title screen, end screen with stats, resume after reload.
   - ☰ menu with deploy info, phone layout pass at 375×667 and 375×812, and
     reduced-motion support.
8. **Deploy.**
   - Run `firebase hosting:sites:create knock-hockey`. If that name is taken,
     use `knock-hockey-game`.
   - Add a hosting entry with target `knock-hockey` and map it in
     `.firebaserc`.
   - Add a row to the root CLAUDE.md deploy table, then `pnpm run release`.
9. **Follow-ups (not part of v1):**
   - **Spin ("English"):** choose where on the puck the stick hits, so it curls
     and bounces differently off walls.
   - Move shared code into `pwa-shell`.
   - Unlockable looks, and online PvP.

## 8. Decisions made
- **Turns:** strict alternation, and you can hit the puck anywhere on the
  board on your turn.
- **Board:** a rectangle with no centre wall, a diamond block in front of each
  goal, and a slanted wedge in each corner. The side-to-corner shot behind the
  diamond is the key strategy.
- **PvP:** the board stays fixed.
- **Match:** first to 10.
- **Shooting:** aim, then pull back for power, like billiards.
- **Spin:** later, not in v1.
- **Customization:** looks only.
