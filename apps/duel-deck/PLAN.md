# Duel Deck — Plan: levels cap, classes, synergies, emotes, loss FX, telemetry

**Status (Oct 13, 2026): all 8 steps built and committed, as v1.3.0 (not yet
deployed).** Decisions taken: up to 2 frozen upgrades; Ascendant makes your row
a single uncapped unit that every pick merges into (not "one unit past 10");
telemetry is always on with no toggle; the version check prompts an outdated
player to update before hosting or joining. Tuning moved from the starting
numbers below after testing: Full Assault +1 attack (not +2), Iron Line +3
health (no armour), Sanctuary is the front unit's endure only (doubling
Herald/Medic was far too strong). `CLAUDE.md` has the final rules and numbers.

Written Oct 13, 2026, against `main` at `0044443` (v1.2.1). Seven requests, put
in an order where each step either stands alone or builds on one already
shipped. `CLAUDE.md` describes how the game works today; this file is the
plan for changing it.

## The order, at a glance

| # | Step | Size | Depends on | Ships as |
|---|---|---|---|---|
| 0 | Settle the open decisions below | — | — | — |
| 1 | Freeze: more than one upgrade | S | — | 1.3.0 |
| 2 | Telemetry: log picks and upgrades, 3-week retention | M | — | 1.3.0 |
| 3 | Loss explosion (iOS, Android, web) | M | — | 1.3.0 |
| 4 | Max level 10 + Mastery powers | L | 2 (for a baseline) | 1.4.0 |
| 5 | "Ascendant" upgrade: one unit past 10 | M | 4 | 1.4.0 |
| 6 | Unit classes: Attack / Defense / Support | S | — | 1.5.0 |
| 7 | Class synergies (full row of one class) | L | 4, 6 | 1.5.0 |
| 8 | PvP emotes | M | — | any time |

Why this order:
- **Small and independent first.** Steps 1–3 don't touch combat balance, so
  they can ship together straight away.
- **Telemetry before any balance change.** It should be live, and collecting,
  before steps 4 and 7. That way there's real-player data from *before* the
  big changes to compare against afterwards. The sim tells you how AIs play.
  Telemetry tells you how people play.
- **Max level before synergies.** A level cap changes the game's main
  strategy. Right now that strategy is to pile everything into one unit:
  `CLAUDE.md` notes that "concentration is the dominant plan". A cap pushes
  players toward wider rows instead, which changes how often a full row of
  one class happens. If synergies were balanced first, the cap would undo
  that balancing, so the cap goes in first.
- **Classes are cheap but go in with synergies.** Classes are a data tag
  plus a badge. On their own they do nothing, so ship them with step 7. Build
  them first so steps 7's UI has something to show.
- **Emotes don't touch the engine.** Do them whenever there's a gap. They
  need a database rules deploy, so batch them with another online change if
  one comes up.

Every step that touches the engine has to keep `pnpm netcheck` at 0 desyncs.
Online play relies on both devices computing the same result. Every balance
step ends with `pnpm sim 20000 --aug=random` and a Normal-vs-Hard run.

---

## 0. Decisions to make first

| Question | Recommendation | Why |
|---|---|---|
| "Can't freeze multiple upgrades": should more than one be allowed, or is one the rule? | **Allow up to 2.** | Today a second ❄ silently moves the freeze from the first upgrade, which reads as broken. Freezing all 3 would let a player bank a whole hand and skip the rarity ladder, so cap it at 2. |
| Max level | **10** (9 merges) | See step 4 for the numbers. |
| What does a same-type card do when that type is maxed? | It **can't merge**. It can still be placed or replace another unit. | Simple, and the drop highlight already shows what's legal. |
| What happens when every unit on the row is maxed? | Spare picks turn into **Drill**: +1 ⚔ to every unit **for that round only**. | It isn't permanent, so it can't snowball. It isn't healing, so it can't stall a match. Details in step 4. |
| Ascendant's new cap | **Level 20** | That's where the existing red level tier already sits. With no cap at all, piling into one unit becomes the dominant plan again. |
| Which class is each unit? | Table in step 6 | Squire, Skirmisher and Lancer are the ones you might argue over. |
| Does a synergy need *every* slot filled? | **Yes:** all 5 (or 6 with Reinforcements), all one class. | That's how you described it. A partial version (say 3 of 5) would fire almost every match. |
| Can players opt out of telemetry? | **Yes**, with a toggle in ☰. It's anonymous either way. | It costs little and keeps the game honest about what it sends. |
| Emote set | 8 fixed emoji; a cooldown; a mute toggle | Details in step 8. |

---

## 1. Freeze more than one upgrade (S)

**Today:**
- `AugmentState.frozen` is a single `string`.
- `toggleAugmentFreeze` in `ui/Game.tsx` (~1278) swaps it.
- `offerAugments` deals that one upgrade first.

**Change:**
- `frozen?: string` becomes `frozen?: string[]`.
- `offerAugments` deals every still-unheld frozen upgrade first, then fills
  the rest of the offer as now.
- The ❄ toggle adds or removes an upgrade from the list. It refuses a third
  and shows "2 frozen max" on the button's tooltip and in the hint line.
- `Overlays.tsx` (`frozenId` → `frozenIds`):
  - Both frozen rows get the frozen style.
  - The reroll tooltip changes to "frozen ones stay".
- The help text in `Overlays.tsx` (~763) gets the same change.

**Compatibility:**
- **Saves:** `loadMatch` migrates a string to `[string]`. There's no need to
  bump `SAVE_VERSION`, because a bump would throw away saves in progress.
- **Online:** `AugmentState` travels in the commit (`aug`). `frozen` is
  player-only and has no effect on combat, so leave it out of `packCommit`.

**Done when:**
- You can freeze 2 upgrades, and both lead the next offer.
- A third ❄ is refused.
- A reload keeps both.
- Undo restores a freeze on a card you'd taken.

---

## 2. Telemetry: what gets picked, and what wins (M)

**Goal:** see which units and upgrades real players pick and whether those
players win, so you know what to buff or nerf. Delete anything older than 3
weeks.

### Where the data goes
Use the same Firebase Realtime Database the online rooms already use, under
a new path:

```
telemetry/duel-deck/<YYYY-MM-DD>/<matchId>/
  meta     { v, mode: "cpu"|"online", difficulty, startedAt, client }  (written at round 1)
  rounds/<n> { offer[5], picks[{key, act: "place"|"merge"|"replace", lvl}],
               rerolls, frozen, aiPicks?[...], won: -1|0|1 }        (one per round)
  augs/<n> { offered[], taken, rerolls, side: "p"|"e" }                (on each upgrade choice)
  end      { result, rounds, hpLeft, row[{key, lvl}], foeRow[...],
             augs[], foeAugs[], mvp }                                  (on match end)
```

- **Grouped by day** (`<YYYY-MM-DD>`), so deleting old data is one delete
  per day rather than a scan of every record.
- **Written every round**, not once at the end. A match the player abandons,
  or an iOS PWA that gets killed in the background, still leaves its rounds
  behind. Code that runs as the page closes isn't reliable on iOS.
- **CPU matches also log the AI's picks** (`aiPicks`, `side: "e"`). That
  doubles the data for each match, and the AI's picks are unbiased
  baselines.
- **`v` is the app version.** Comparisons stay valid across balance changes:
  1.3.0 data won't get mixed in with 1.4.0's.
- **`client` is the existing anonymous random device id**
  (`pwa-games:client-id`). It's never an email, a name or an IP address.
- **Size:** about 1 KB per round, so a typical match is about 20 KB. Even
  hundreds of matches a day stays well inside the free Spark plan (1 GB
  stored, 10 GB downloaded per month).

### Code
- **`packages/backend-client`:** add a generic `appendLog(path, value)`
  (a `set` at a pushed key) and `setLog`. They stay game-agnostic, as the
  root CLAUDE.md requires. Firebase is already lazy-loaded, so the first
  log write loads it the same way the online lobby does.
- **`src/game/telemetry.ts`** (new):
  - `logMatchStart`, `logRound`, `logAugmentChoice`, `logMatchEnd`.
  - All of them do nothing when the toggle is off, or in dev unless
    `?telemetry=1`, so local testing doesn't pollute the data.
  - Writes are queued. If offline, they're kept in `localStorage`
    (capped at about 50 entries) and flushed on the next launch.
  - Failures are swallowed, so logging can never break a match.
- **Call sites** (all in `ui/Game.tsx`): `finish` (round), the upgrade
  choice, the result screen and the start of a match.
  - For online matches, each device logs only its own side.
- **☰ menu:** a "Share anonymous balance data" toggle
  (`duel-deck:settings`), plus one line about what it sends in Help.

### Database rules (`database.rules.json`)
```
"telemetry": { "duel-deck": { "$day": { "$match": {
  ".read": false,
  ".write": "!data.exists() || data.child('meta/client').val() === newData.child('meta/client').val()",
  ...shape + size validation per field, "$other": false
}}}}
```
- Nobody can read through the client. You read through the CLI or the
  Admin SDK, which bypass rules.
- Each field's shape and size is validated.
- Deploy with `firebase deploy --only database`.

### Reading it
`pnpm telemetry [--days=7] [--v=1.4.0]` (new `scripts/telemetry.ts`):
1. Pulls the data with
   `firebase database:get /telemetry/duel-deck --project roguelike-games`.
2. Prints the same tables `pnpm sim` prints, from real data:
   - Pick rate and win rate per unit, and per upgrade (offered → taken →
     won).
   - Levels reached.
   - Match length.
   - Win rate against each difficulty.
3. Prints sim vs real side by side, which is where the useful surprises
   will show up.

### Deleting data older than 3 weeks
The Realtime Database has no built-in expiry, so something has to run the
delete:
- **Recommended: a scheduled GitHub Action** (`.github/workflows/telemetry-prune.yml`).
  - It runs every day, lists the day keys (shallow get), and removes every
    day before today minus 21.
  - It authenticates with a Firebase service-account key stored as a repo
    secret. It's free and needs no Blaze plan.
- **Fallback:** `pnpm telemetry` prunes too, so old data still gets cleared
  whenever you read it, even if the Action is off.
- A Cloud Function (`onSchedule`) would also work, but it needs the paid
  Blaze plan.

**Done when:**
- Playing a match writes `meta`, the rounds and `end`.
- `pnpm telemetry` prints the tables.
- With logging off, nothing is written.
- Running the prune on a test day key older than 21 days deletes it.

---

## 3. Explosion when the player loses (M)

**Today:** a loss shows the result screen with drifting embers
(`ResultFx` in `Overlays.tsx`).

**Change:** before the result screen, the losing row blows up on the board.

**Sequence:**
1. The player's final unit falls.
2. The screen shakes for about 300 ms.
3. A white flash.
4. A fireball and shockwave ring centred on the player's half.
5. Debris: each unit's shape breaks into 4–6 shards in its own colour and
   flies outward with gravity.
6. Smoke puffs.
7. Embers settle. About 1.6 s in, the result panel fades in over them, and
   its embers carry the effect on.

**Code:**
- **`board/fx.ts`:** a new `"explosion"` effect kind, drawn by the existing
  canvas loop.
- **`ui/Game.tsx`:** when the match ends in a loss, queue it and delay the
  result screen by its length.
- **`game/sound.ts`:** add a `sfx("explode")` (a noise burst with a low
  sine thump).
- Online, a loss explodes on the loser's screen. The winner gets the normal
  win screen.

**Works the same on iOS, Android and web:**
- **Plain Canvas 2D only:** arcs, paths, `globalAlpha`, radial gradients,
  `globalCompositeOperation = "lighter"`.
  - **Don't use `ctx.filter`.** Safari doesn't support it, so blur would
    silently disappear on iOS.
  - Don't use `OffscreenCanvas`, for older iOS.
  - Fake the blur with layered radial gradients.
- **Timed by frame delta (`performance.now()`), not by frame count.** Then
  120 Hz iPhones and Android phones and 60 Hz screens run at the same speed.
- **Capped at about 120 particles** and drawn at the canvas's existing DPR,
  so low-end Android phones hold 60 fps.
- **The shake is a canvas translate, not a CSS transform on the page.** That
  avoids iOS repainting the whole layout.
- **Phone vibration:** `navigator.vibrate([60, 40, 120])` on Android. iOS
  Safari has no vibration API, so this is simply skipped. Respect the sound
  toggle for the boom.
- **Reduced motion:** no shake and fewer particles, but the flash and
  fireball stay. The same approach as the MVP dance: tone it down, don't
  remove it.
- **Test on:**
  - iOS Safari, in the browser **and** as an installed PWA (standalone mode
    has its own audio-unlock quirks).
  - Android Chrome, both in the browser and installed.
  - Desktop Chrome, Firefox and Safari.
  - The in-app browser's mobile preset, for quick checks.

**Done when:**
- The loss plays the explosion and then the result screen, on all three
  platforms.
- No dropped frames on a mid-range Android phone.
- Reduced motion gives the toned-down version.
- A win is unchanged.

---

## 4. Max level 10, and Mastery at max (L)

### What changes
- **A unit stops at level 10**, which is 9 merges. Add `MAX_LEVEL = 10` and
  `MAX_MERGES` next to `levelOf` in `engine/units.ts`.
- **`canMerge` in `engine/board.ts` refuses** a merge that would go past the
  cap. That covers:
  - an offer card onto a unit
  - a placed unit onto a placed unit
  - the AI's merges

  `dropActionFor` reads `canMerge`, so the drop highlight, the badge and the
  hint all stay correct for free.
- **Merging two placed units** adds their levels together, so 6 + 6 would
  be 12. Allowed only if the total is 10 or less. Otherwise the drop just
  reorders, and the hint says "Max level 10".
- **Squire → Knight is unchanged:** knighted at 7, then 3 more levels to 10.
  `SQUIRE_STEP` makes those last three the biggest merges in the game, which
  fits the Knight being the strongest unit.

### Mastery: what level 10 gives
Every unit at max gets a stronger form of its ability. These are the
`innateTraits(key, merges)` rules with a cap-level branch, so combat, the
info card and the Units screen all pick it up from the one function:

| Unit | Mastery (level 10) |
|---|---|
| Guard | Bodyguard shields **every** unit behind it, not just the next one |
| Striker | Charge fires on its first hit against **each new** enemy, not once per round |
| Skirmisher | **Two** dodges a round (one was a deliberate limit; at the cap it's earned) |
| Bulwark | Fortify also gives **+1 ⚔** each round it survives |
| Berserker | Overflow carries **all** the excess, with no cap |
| Herald | Rally also gives the front **+3 ♥** |
| Lancer | Impale hits the **two** units behind the front |
| Medic | Mend **5** times a round (not 3), and overhealing spills to the unit behind |
| Knight | Armour **2** (takes 2 less per hit) |
| Squire | — (a Squire is knighted at 7, before it can reach 10) |

**What players see:**
- A gold **MAX** badge in place of "Lv 10".
- A "★ Mastery" line on the info card.
- A one-off flourish when a unit reaches it (reuse the knighting effect and
  sound).
- `LEVEL_TIERS` gets reworked, because 15 and 20 can no longer be reached
  without step 5: 1 grey, 3 green, 5 blue, 8 purple, 10 gold, and above 10
  red (Ascendant only).

### "What happens if all units get to max level?"
Rough numbers: 5 units at level 10 is 50 bodies, which is 25 rounds of
picks. That's assuming every pick merges and nothing gets replaced. The
median match is about 18–19 rounds. So it will be rare, but long matches
(and 6-slot rows) will hit it.

When it does:
- **Picks become optional.**
  - The offer still shows, and replacing still works: you can swap a maxed
    unit for a fresh one to change classes.
  - The hint reads "Row maxed: unused picks become Drill".
- **Drill:** each pick you don't spend gives every unit +1 ⚔ for that round
  only.
  - Two unused picks means +2 ⚔ that round.
  - It's shown as a ⚔ aura with its own detail line.
  - It's applied in `refreshForRound` like Sabotage, so it's deterministic
    and goes out in the online commit as a number.
- **Why not stat growth or healing?** Permanent stats would just remove the
  cap. Healing the HP pool could stall two maxed rows forever. A one-round
  attack bonus ends matches faster, which a late game should.
- **The AI:** Normal and Hard spend picks on replacements when one beats a
  maxed unit, and otherwise keep them for Drill. Add this to `aiCommit` and
  the Hard search.

### Balance work
- `pnpm sim` already reports level percentiles. Today:
  - The median unit ends at level 5.
  - A row's strongest unit ends at 13 (p90 19, p99 25).
  
  After the cap, check the share of rows that reach max and the share that
  go fully maxed.
- **Expect units that grow with merges to lose ground**: Squire/Knight,
  Bulwark, and any augment that rewards one big unit (Champion, Legion).
  Re-tune `SQUIRE_WEIGHT`, the Squire upgrades and Champion.
- **Expect the first-round draw rate and match length to move.** Recheck
  the 3.9% draw figure and the 18–19 round median.
- **Hard's lead over Normal (~68%) may shrink.** It searched for exactly the
  concentrated rows that the cap now removes.

### Compatibility
- **Saves with units over 10:** grandfather them. The cap stops further
  merges, but nothing is removed.
- **Online:** the cap and Mastery are pure rules, so both devices apply
  them identically. But **an old client and a new client in the same room
  would desync**. Add `proto: 2` to the room, and have `joinRoom` refuse a
  mismatch with "Update the app to play this room". This is worth doing at
  the start of this step regardless, because every later engine change
  needs it.

**Done when:**
- Merges stop at 10 everywhere: dragging, clicking, placed-onto-placed, and
  the AI.
- Mastery shows and works for every unit, and `pnpm netcheck` reports 0
  desyncs.
- A fully maxed row gives Drill.
- Every unit's win rate in the sim is back within about 44–56%.

---

## 5. Ascendant: one unit past level 10 (M)

**What it is:** a new **epic** upgrade.
- *Ascendant — choose a unit: it can level past 10 (to 20). Only one
  Ascendant unit can exist.*
- **Picking the unit:** nothing in the game asks the player to choose a
  unit yet. The existing grants, like Last Stand's, go automatically to the
  front unit. So this needs a new step:
  - After taking the upgrade, the board highlights your units and you tap
    one. This reuses the click-to-pick-up targeting.
  - The mark is stored as a grant (`ascendant: true` in
    `AugmentState.grants` on that unit's id).
  - The AI's mark goes automatically to its highest-level unit.
  - Budget for this step: it's most of the work in step 5.
- **Only one per side.**
  - It's an augment, and augments are never offered twice, so a side can
    hold it once.
  - The grant goes on exactly one unit.
  - If that unit is replaced, the Ascendant mark is lost. Show a warning
    hint when you're about to replace it, and add a replace confirm because
    this one can't be undone.
  - If it's merged into another unit of the same type, the mark carries
    over: `transferGrant` already moves grants on merge.
- **The cap moves:** `canMerge` reads the unit's grant, and the cap becomes
  `ASCENDANT_MAX = 20` for that unit only.
- **What players see:**
  - The level badge runs red above 10.
  - A crown or halo is drawn on the character.
  - The info card reads "Ascendant (past the cap)".
  - Mastery still applies; the unit just keeps growing.
- **The AI:** takes it at epic weight and puts it on its highest-level unit.
- **Balance:** measure it with `--aug=random`. It's expected to land high,
  because it partly brings back the concentration plan. If it's too strong,
  try a cap of 15 or have it unlock a round later. The sim will show which.
- **Online:** the grant travels on the `WireUnit` like every other grant,
  so nothing new is needed on the wire.

**Done when:**
- Exactly one unit can pass level 10.
- Losing it loses the mark.
- Merging carries the mark.
- The sim shows it within the epic band (about 50–57%).

---

## 6. Unit classes: Attack, Defense, Support (S)

**A new field, not a reuse of an old one:**
- Add `archetype: "attack" | "defense" | "support"` to `UnitStats`.
- Don't reuse `classes`. Those tags (`tank`, `aggro`, `support`, `guard`…)
  are what existing upgrades target, so changing them would quietly change
  what Tank Wall and friends do.
- Don't use the name `role` either. That's already the unit's flavour line.

| Class | Units | Note |
|---|---|---|
| ⚔ Attack | Striker, Berserker, Lancer, Skirmisher | Skirmisher is 3/2 with Evasion: it plays as an attacker |
| 🛡 Defense | Guard, Bulwark, Squire, Knight | Squire grows into the tankiest unit |
| ✚ Support | Herald, Medic | Only two types, so an all-Support row means Heralds and Medics (see 7) |

**What players see:**
- A small class icon on each offer card and on the info card.
- A "Class" column on the Units screen.
- A class tint behind the level badge.

The board itself stays uncluttered: the badges are already only a few
pixels across on a phone.

**A possible follow-up:** a third Support unit. Two types is thin for a
class. Something like a Banner-bearer, which gives the unit behind it armour,
would fit. Don't add it in this step: a new unit means its own round of
balancing.

---

## 7. Class synergies: a full row of one class (L)

**The rule:** if every slot on the row is filled (5, or 6 with
Reinforcements) and every unit shares one class, the row gets that class's
synergy for the round. You don't need an upgrade for it.

- **Checked each round in `refreshForRound`**, after the augments, so it's
  deterministic and needs nothing new on the wire.
- **Shown** as an aura on every unit, plus a banner across the row
  ("⚔ Full Assault").

| Synergy | Effect (starting numbers, to be tuned in the sim) |
|---|---|
| ⚔ **Full Assault** (all Attack) | +2 ⚔ to every unit, and the front unit's first blow each round can't be dodged |
| 🛡 **Iron Line** (all Defense) | Every unit takes 1 less damage per hit (stacks with the Knight's Armour), and +3 ♥ |
| ✚ **Sanctuary** (all Support) | The front unit can't be one-shot (it survives at 1 the first time each round), and every Herald's and Medic's ability counts double |

**Sanctuary** needs the most care. An all-Support row is five units at
about 1 ⚔, so it can hold the front for a long time but barely deals damage.
Its effect has to turn that into wins, or nobody will build it. Watch two
things in the sim:
- the tick-cap stalemate guard, since an unkillable front plus healing
  could stall
- the draw rate

**Interactions to check:**
- **Mixed formation** (an upgrade that wants 5 different types) can't
  happen alongside a synergy. That's fine: those are the two opposite plans.
- **The level cap from step 4 helps synergies.** A row can't stay one maxed
  unit plus filler, so it needs five real units.
- **Reinforcements** makes a synergy harder to get (6 slots to fill).
  Consider making it 5 of 6 when the row has 6 slots. Let the sim decide.

**The AI:**
- Normal gets a `FIT_BONUS`-style nudge toward the most common class it
  already fields, once 3 or more of its units share one. It's the same
  approach as `augmentFit`.
- Hard's search scores rows with the synergy applied, so it finds them
  without being told.

**Balance:**
- Add a "synergy rows" section to `pnpm sim`: how often each synergy fires,
  and the win rate of the side that has it.
- Target: each one fires in about 5–15% of matches by mid-game, with
  holders at about 52–58%. Rewarding, but not mandatory.
- Then compare against telemetry from step 2: real players may chase
  synergies more than the AI does.

**Done when:**
- All three synergies fire, show and are covered by `pnpm netcheck`.
- The sim numbers are in their bands.
- The Units screen and Help explain them.

---

## 8. PvP emotes (M)

**What players get:**
- A 💬 button in the HUD, shown in online matches only.
- It opens a small tray of **8 fixed emoji**: 👍 👋 😂 😮 😬 🔥 🎉 🙏.
  - There's no free text and nothing custom, so there's nothing to
    moderate.
  - One of them carries "GG" text 🤝 for the end of a match.
- **The sender** sees their emoji in a bubble on their own side.
- **The opponent** sees it pop in a bubble over the enemy half of their
  board, with a soft pop sound. It fades after 2.5 s.

**Limits:**
- **Cooldown:** 1 emote every 3 s.
- **Cap:** at most 5 per round.
- **Mute:** a "Mute opponent's emotes" toggle in ☰, which also hides the
  bubbles.
- **Works in every phase:** picking, waiting and battle, plus the result
  screen.

**Wire:**
- Each player writes only their own `emotes/<p>` = `{ i: <index 0–7>, n:
  <seq> }`.
- The other device watches that field and shows each new `n`.
- **Sending an index rather than the emoji** means the rules can validate
  it (`i` must be a number from 0 to 7), so nobody can inject text.
- Add the field to the `duel-deck` room rules:
  ```
  "emotes": { "p1": { ".validate": "newData.child('i').isNumber() && newData.child('i').val() >= 0 && newData.child('i').val() <= 7 && newData.child('n').isNumber()" }, "p2": {…}, "$other": { ".validate": false } }
  ```
- Deploy with `firebase deploy --only database`.

**Code:**
- `online/room.ts`: `sendEmote` and `watchEmotes`.
- A small `ui/EmoteBar.tsx`.
- Bubbles drawn as DOM overlays above the canvas, not inside it. The
  canvas has no business knowing about chat.

**Done when:**
- Two browsers in one room can emote both ways.
- The cooldown and the cap hold.
- Mute works.
- Rules reject an out-of-range index.

---

## Release checklist (each version)
1. Bump `version` in `apps/duel-deck/package.json`.
2. Run `pnpm sim 20000 --aug=random`, `pnpm sim --player=hard --enemy=normal`
   and `pnpm netcheck`, and record the headline numbers in `CLAUDE.md`.
3. Update `CLAUDE.md`, and the Help text in the app.
4. If `database.rules.json` changed, run `firebase deploy --only database`.
   Steps 2 and 8 change it.
5. `pnpm run release`, then check `/version.json`.
6. Commit and push.
