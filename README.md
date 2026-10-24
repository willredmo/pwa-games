# PWA Games

A monorepo of small, installable web games: each one is a Progressive Web App
you can add to a phone's home screen and play offline. Built with React,
TypeScript and plain Canvas 2D, in a pnpm workspace.

## Play

| Game | What it is | Link |
|---|---|---|
| **Duel Deck** | 1v1 auto-battler roguelike: draft units, merge them, pick upgrades, and watch the rows fight. Against a CPU (three difficulties) or a friend online. | [duel-deck-game.web.app](https://duel-deck-game.web.app) |
| **Knock Hockey** | Tabletop knock hockey with real-time physics: vs a CPU, two players on one device, or online. | [knock-hockey.web.app](https://knock-hockey.web.app) |
| Checkers Roguelike | Checkers across a 10-floor ladder, with picks between floors that bend the rules. | in development |
| House Edge | Incremental roulette roguelike: idle income and prestige. | in development |

## What's in here

```
apps/
  duel-deck/           1v1 auto-battler roguelike
  knock-hockey/        tabletop knock hockey (physics, online play)
  checkers-roguelike/  checkers with roguelike picks
  house-edge/          incremental roulette
packages/
  backend-client/      Firebase Realtime Database rooms for online play
```

Some highlights:

- **Deterministic game engines.** Duel Deck's combat is a pure function of the
  two committed rows, so an online round is resolved independently on both
  devices and replayed blow by blow. `pnpm netcheck` plays hundreds of
  simulated online matches and fails on any disagreement between devices.
- **Simulation-driven balance.** `pnpm sim` plays thousands of AI-vs-AI
  matches headlessly through the real engine and reports win rates per unit
  and per upgrade; `pnpm upgrades` checks that every upgrade does what its
  card says.
- **CPU opponents that search.** Duel Deck's Hard CPU simulates every way to
  spend its picks against your row and a prediction of your next move, and
  values long-term growth, not just the current round.
- **Online play without a game server.** Rooms with join codes, presence and
  turn exchange over Firebase Realtime Database, with security rules in
  `database.rules.json`.
- **Mobile-first.** Every animation is written to run smoothly in iOS Safari
  (transform and opacity only, `prefers-reduced-motion` respected), and the
  games work offline once installed.

Each app has its own `CLAUDE.md` describing its rules and the design decisions
behind them.

## Running locally

Requires Node 18+ and pnpm 9.

```bash
pnpm install
pnpm dev:duel-deck
```

Other games: `pnpm dev:knock-hockey`, `pnpm dev:checkers`, `pnpm dev:house-edge`.
In `apps/duel-deck`: `pnpm sim`, `pnpm upgrades`, `pnpm netcheck`.

## Credits

Duel Deck's music tracks in `apps/duel-deck/src/assets/music/` are by other
artists and are used under their own licence:

- `menu.mp3`: "Game Music Loop 9" by xtremefreddy
- `plan.mp3`: "Fun indie game type jazz" by idoberg
- `battle.mp3`: chiptune by tatamusic

They are not covered by anything else in this repository and may not be
reused or redistributed separately from the game.

All other code and art © William Redmond. All rights reserved.
