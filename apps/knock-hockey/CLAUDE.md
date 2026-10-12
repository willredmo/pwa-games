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
  on hits first. A new match starts with Player 1; a rematch starts with the
  previous match's loser. On one device both players tap their own Rematch
  button before it starts. First to 10 (`TARGET`), win
  by 2 (`WIN_BY`; `hasWon`): at 10–9 play goes on. The header shows "Game
  point" when the next goal could win and "Win by 2" when level at 9+.
- Runs (`stats.runs`): each player's own shots that scored, back to back. A
  shot of theirs that doesn't score (an own goal included) resets it; the
  other side scoring doesn't, and an opponent's own goal doesn't add to it.
  The goal banner calls out 2+
  (`runLabel`: "Two in a row!", "Hat trick!", "Four in a row — on fire!",
  "N in a row — unstoppable!"); the end screen shows each side's best run.
- Goal kinds (`goalKind`, used for stats, banners and replay captions) are
  exclusive. Corner goal: the last real bounce was off a corner wedge. Bank
  goal: a real bounce off a rail or diamond. Otherwise straight in. Goal posts
  and glancing touches (head-on speed under 60) don't count.

## Board (physics/table.ts)
Portrait rectangle, W×H = 300×600 board units, no centre wall. Every surface is
a line segment; segment ends act as round posts.
- Goal: a slot in the middle of each end rail. The puck's centre crossing the
  goal line scores.
- Diamond block (square on its point) in front of each goal, centred 50
  units off the end rail, leaving a 26-unit gap behind it (the puck is 18).
- Corner wedges, steeper than 45° on the standard board (42 along the end
  rail, 58 along the side; ≈54° to the end rail). A match can use true 45°
  corners instead (50 × 50): the "📐 45° corners" match setting (saved as
  `MatchState.corners`, absent = steep). Each
  variant is a `Layout` in `LAYOUTS` (physics/table.ts) with its own
  segments; the physics, drawing, CPU (`corners` to the worker), board
  character and replays all take the match's layout. Like the natural board
  it's fixed per match, kept by a rematch, and the host's choice online. **The signature shot depends on this:** from beside a side
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

## Match settings (ui/MatchSetup.tsx)
Chosen when a game starts, not on the title screen: Play vs CPU, Same device
and Online game each open a settings sheet (CPU difficulty for vs CPU;
Natural board and 45° corners for all) with a Start / Create game button.
The sheet opens on the last choices (`Settings`). Fixed for the match, shown
in the ☰ menu, kept by a rematch (`setupOf`). Online, only the host sets
them, before the room is made; the lobby lists them, and the guest gets a
"Host's settings: …" note as the match starts and can't change them.

## Board character (physics/board.ts)
A match setting, chosen when a game starts (see Match settings below):
"🪵 Natural board" (default on). On, the match gets a `boardSeed` (saved in
`MatchState`; off, there's no seed and the board is perfectly true) that gives
its board a little character, fixed for the whole game:
- Rails, wedges and diamonds: along each segment, bounciness varies up to
  ±0.06 (of 0.8) and the bounce comes off up to ≈1.4° from true. Both scale
  with how hard the puck hits (full strength at 900 units/s head-on).
- Surface: a few smooth slow patches, up to +18% friction, never faster.
It's deterministic from the seed and uses only + − × ÷ and sqrt in the step,
so replays are exact, online devices agree, and the CPU plans on the real
board (`boardSeed` goes to the worker). Older saves have no seed: a true
board. `pnpm sim feel` measures it: no physics escapes; a shot's resting spot
moves ~30 units vs a true board (the per-hit wobble moves it ~50); the
perfectly aimed corner shot goes from ~93% to ~87%; CPU scoring unchanged.
Strengths are in `FEEL`.

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

## Goal explosions and the instant replay
Every goal blows the puck up, Rocket League style: a flash, two shockwave
rings, a fan of splinters and sparks in the scorer's colour, and a short
board shake (skipped with Reduce Motion). A goal that would win the match
gets the big one (1.6× — more, faster debris, bigger rings and shake): the
game tells the table before each shot (`Table.explodeInto`, per goal,
"normal" or "big"; either goal — own goals count). Replays explode the same
way. After the winning goal's banner, an "INSTANT REPLAY" of it plays in
slow motion (¼×; `Replays` with `instant`, Skip button, closes 3.5 s after
the goal so the explosion plays out) and the results screen follows. The end
screen's confetti and drifting pucks avoid `var()` in @keyframes (iOS Safari
ignores it there); with Reduce Motion they stand still rather than disappear.

## Goal replays (ui/Replays.tsx)
Every goal is saved in `match.goals` with the exact `Launch` that scored it
(start position and launch velocity, wobble already applied), who shot, who
scored, how (own goal / bank / corner) and the score after. Because the
physics is deterministic, replaying that launch on a fresh `Table`
(`beginTurn(by, "remote")` + `playRemote(launch)`) reproduces the goal
exactly, stick swing included. Right after a goal, the banner has a
"▶ Watch replay" button, and a "▶ Replay last goal" chip stays on the board
until the next shot (both open just that goal, auto-play off). While replays
are open the match is paused: the next turn, the CPU's shot and an online
opponent's incoming shot/result are held (`whenUnpaused` in ui/Game.tsx) and
carried on when closed. Also opened from the ☰ menu mid-match and from the
end screen: one goal after another (auto-play toggle), ⏮ ⏭, Again,
a speed button (½× by default, then ¼×, 1×; `Table.timeScale`, puck only). The stick lines up at the CPU's unhurried pace (`playRemote(launch, true)`), not an online opponent's quick one. Keys: ← → previous/next, Space
again, Esc close. Goals sync online with the match, so both players can
watch them. Saves from before replays simply have none.

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
- **Rematch:** each player asks (`rematch/<p>` in the room); the end screen
  shows "Your opponent wants a rematch!" / "Waiting for your opponent…". The
  second ask starts it in one transaction (`requestRematch`): same board
  setup, the loser shoots first, requests cleared. Both devices see the new
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
- `pnpm sim fuzz | corner | wobble | feel | rates | match` — physics checks
  and CPU tuning; add `--corners=45` to fuzz, corner or rates for the 45° board
- `firebase deploy --only database` (repo root) — publish database rules
- `pnpm run release` — build and deploy to Firebase Hosting target
  `knock-hockey`. PWA update flow, version.json and the ☰ About section are
  the same as Duel Deck's (src/pwa.ts).
