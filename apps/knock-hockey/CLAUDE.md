# Knock Hockey

Top-down tabletop knock hockey. Not a roguelike: no runs, no upgrades. Three
modes: vs the CPU (Easy, Medium or Hard), local 2-player pass-and-play on one
device (Blue vs Red), and online 2-player across two devices. `PLAN.md` has the original plan and the decisions
behind it.

## Rules (game/match.ts)
- Strict turns, one hit each. You may hit the puck wherever it stopped,
  including against a rail — it is never moved for you.
- Player 1 (blue, "You" vs the CPU) is at the bottom and shoots at the top
  goal; Player 2 (red: the CPU, or a second person) shoots at the bottom goal.
  A puck into your own net scores for the other side.
- 2-player (`mode: "pvp"`): both sides use the same controls; the board never
  rotates. Names, banners, Hit button colour and the end screen follow
  `playerName` / `isHuman` in match.ts.
- After a goal the puck goes back to centre ice and the side that was scored
  on hits first. A new match starts with you. First to 10 (`TARGET`).

## Board (physics/table.ts)
Portrait rectangle, W×H = 300×600 board units, no centre wall. Every surface is
a line segment; segment ends act as round posts.
- Goal: a slot in the middle of each end rail. The puck's centre crossing the
  goal line scores.
- Diamond block (square on its point) in front of each goal, centred 50
  units off the end rail, leaving a 26-unit gap behind it (the puck is 18).
- Corner wedges, steeper than 45° (WEDGE_X 42 along the end rail, WEDGE_Y 58
  along the side). **The signature shot depends on this:** from beside a side
  rail, hit straight up into the wedge; it glances off behind the diamond and
  into the goal. If you change the wedges, diamonds, goal width or friction,
  run `pnpm sim corner` — it fails if the shot stops working.

## Physics (physics/sim.ts)
Fixed 1/240 s step, no randomness: the same position and shot always play out
the same. The CPU searches with `quickShot`; the screen plays the chosen shot
back with `step`. One deliberate exception: every real hit — yours and the
CPU's — gets a small random **wobble** (`wobble`/`WOBBLE` in sim.ts: σ 0.9°
of angle and 6% of power, capped at 2σ) when the stick strikes, so the same
shot isn't a sure thing twice. A perfectly aimed corner shot still scores ~91%
(`pnpm sim wobble`); turn `WOBBLE` up or down to taste. Friction is a
constant slow-down plus speed-proportional drag; bounces keep 80% of head-on
speed. Shot power maps to launch speed on a curve (`shotSpeed`) so low power
gives fine control. No spin yet (planned: "English", where the stick strikes).

## CPU (ai/cpu.ts, runs in ai/worker.ts)
Simulates candidate shots and scores where each ends: goal, own goal, or the
resting spot (far from your own goal good; by your own side rails or behind
your own diamond bad — those set up the opponent).
- Easy: 10 random shots, often takes a random one, ±9° aim error.
- Medium: 180 angles × 4 powers, ±2.6°.
- Hard: 360 × 6, refines the best, prefers goals that still go in if its aim
  is off a little, and checks how easy a goal each miss leaves you; ±1.9°.

Tuning (`pnpm sim rates`, from random spots, wobble included): Easy scores
~10% of shots, Medium ~16%, Hard ~37%. `--wobble=0` turns the wobble off. `pnpm sim match --a=hard --b=medium` plays CPU vs CPU;
over first-to-10 the stronger level wins ~90%+. Aim error is the main dial.

## Screen (render/table.ts)
The `Table` class owns the canvas: draws, takes input, animates the CPU's
stick, plays shots. React (ui/Game.tsx) owns the rules and the turn loop.
- Drag (main control): press anywhere on the board and drag back like a
  slingshot. Angle = from the finger toward the press point; power = drag
  length (`DRAG_FULL` = 150 board units for 100%, after a 6-unit dead zone).
  A white ring marks the press point and a dashed white line runs to the
  finger while dragging. Letting go keeps angle and power; nothing fires.
- Fine-tune: ↺ ↻ buttons (tap 0.25°, hold ramps 20→150°/s; `HOLD` in
  ui/Game.tsx) and the power bar (ui/PowerBar.tsx, position = power).
- Hit: the "Hit!" button is the only way to shoot (live once some power is
  set). Every turn starts at zero power.
- The CPU's stick visibly turns, pulls back and swings with the same pose.
- The aim line is short and never shows bounces. It can be turned off in ☰.

## Online (online/room.ts, ui/Lobby.tsx, packages/backend-client)
Firebase Realtime Database, project `roguelike-games`, via the shared
`@pwa-games/backend-client` package (Firebase is lazy-loaded, so CPU and
same-device players never download it). Rooms live at
`rooms/knock-hockey/<CODE>` (5-character codes, no look-alike characters).
- **Lobby:** "Online game" makes a room and shows the code plus a share link
  (`?join=CODE`, which joins on open); "Join with code" types it in. The host
  is Player 1 (blue) and shoots first; the guest is Player 2 and sees the board
  turned 180° (`Table.flipped`) so their own goal is at the bottom too.
- **A turn:** the shooter streams `aim` (≈10/s) while lining up, writes `shot`
  (start position and exact launch velocity, wobble already applied) when the
  stick swings, and `result` (+ `match`) once the puck stops. The other device
  replays the launch with the same physics, which only uses + − × ÷ and sqrt
  after launch, so it's bit-identical across browsers. The shooter's `result`
  is final; if it never arrives (they dropped mid-shot), the watcher's own
  replay is applied after 5 s.
- **Presence and leaving:** each side holds `presence/<p>` (cleared by the
  server on disconnect) — the other sees "Opponent disconnected". Leaving
  writes `left`; the room is then closed. Reloading offers "Rejoin online
  game" (`knock-hockey:online` in localStorage holds the code and side).
- **Rematch:** either player; the loser shoots first. Both devices see the new
  `match.startedAt` and restart.
- **No sign-in:** devices are identified by a random id
  (`pwa-games:client-id`); a room is only reachable by its code. Rules in
  `database.rules.json` (repo root) check the shape of every field. Firebase
  Auth can't be switched on through the API without billing; enabling
  Anonymous sign-in in the console would allow rules that tie each side to
  its device.
- **Testing two players on one machine:** both tabs on one origin share
  localStorage and so the same device id; override `pwa-games:client-id` in
  the second tab (or use a private window).

## Sticks (game/stick.ts, render/stick.ts)
Two saved sticks: Player 1's (`knock-hockey:stick`, yours vs the CPU and
Blue's) and Player 2's (`knock-hockey:stick:p2`, Red's). The Locker has a tab
for each.
Cosmetic only. Blade curve, blade colour, shaft finish (solid / two-tone /
wood grain) and colours, tape pattern and colour, knob tape, a 3-character
decal. Edited in the Locker; the preview uses the game's own drawing code.
Each CPU level has its own fixed stick.

## Saving
localStorage, every read/write in try/catch: `knock-hockey:match` (after
every shot, cleared when a match ends or is abandoned), `knock-hockey:stick`,
`knock-hockey:settings` (last difficulty, aim line, sound).

## Commands
- `pnpm dev` (port 5177 via the root launch config `knock-hockey`)
- `pnpm sim fuzz | corner | wobble | rates | match` — physics checks and CPU
  tuning
- `firebase deploy --only database` (repo root) — publish database rules
- `pnpm run release` — build and deploy to Firebase Hosting target
  `knock-hockey`. PWA update flow, version.json and the ☰ About section are
  the same as Duel Deck's (src/pwa.ts).
