# PWA Games — Monorepo

Installable web games, PWA-first, built as a pnpm workspace monorepo. Most are
roguelikes (the original four below), but the repo isn't limited to them — a
game that isn't a roguelike belongs here too, as long as it's a PWA.

## Philosophy
- Turn-based / tick-based over real-time where possible — keeps builds light,
  installable, and free of netcode complexity for v1.
- Ship the simplest game first (checkers roguelike) to validate the PWA
  pipeline before tackling multiplayer sync in the other two.

## Tech stack
- **Frontend:** React (owns UI/state and component chrome) + plain Canvas 2D
  (owns board rendering, driven imperatively from a game-state object). No
  PixiJS — none of these games are sprite/particle-heavy enough to need it.
- **Language:** TypeScript throughout.
- **Backend:** Firebase Realtime Database (project `roguelike-games`), through
  `packages/backend-client` — generic rooms with join codes, transactions,
  presence and live fields; Firebase is lazy-loaded. Knock Hockey's online mode
  uses it; duel-deck and root-and-ruin are meant to. Checkers and House Edge
  are fully client-side, no backend. Database rules: `database.rules.json`,
  deployed with `firebase deploy --only database`; add a block under `rooms`
  for each game that uses it.
- **Package manager:** pnpm workspaces.

## Repo structure
```
/apps
  /checkers-roguelike   — single-player checkers roguelike (build first)
  /duel-deck            — 1v1 auto-battler roguelike
  /root-and-ruin        — 2-player co-op roguelike
  /house-edge           — incremental roulette roguelike (idle + prestige)
  /knock-hockey         — tabletop knock hockey: vs CPU, same-device or
                          online 2-player (not a roguelike)
/packages
  /pwa-shell            — manifest template, service worker, install prompt UI
  /game-ui             — shared React components (HP bars, upgrade-pick
                          cards, buttons, menus)
  /canvas-utils         — board/grid rendering helpers, shape/color constants
  /backend-client       — Firebase Realtime Database rooms for online turn
                          exchange (built; used by knock-hockey)
```

## Conventions
- Each app has its own `CLAUDE.md` (or `GAME_DESIGN.md`) with that game's
  specific rules/scope. Read the relevant app's doc before working on it —
  don't assume rules from one game apply to another.
- Shared packages should stay generic — no game-specific logic in
  `/packages`, only reusable primitives.
- Board/grid logic in `canvas-utils` should work off generic row/col bounds,
  not hard-coded dimensions, since multiple games use non-square or
  variable-size boards.
- Prefer flat, geometric placeholder art (shapes + color) over image assets
  for now — cheap to produce, easy to reskin later.

## Build order
1. `checkers-roguelike` — validates the PWA pipeline (manifest, offline,
   install prompts), no backend needed.
2. `duel-deck` — first game needing the realtime backend.
3. `root-and-ruin` — most design risk (asymmetric co-op), build last.

`house-edge` and `knock-hockey` sit outside that order — they share no
mechanics with the others, so they can be picked up whenever.

## Deploying
All games deploy to one Firebase project as separate
Hosting sites (one per game, so each is its own installable PWA). The
project's ID is `roguelike-games` — fixed from before the repo was broadened;
Firebase ids can't be renamed. Config is at
the repo root: `firebase.json` has one `hosting` entry per app, keyed by a
deploy `target`; `.firebaserc` maps each target to its site.

| App | Target | URL |
|---|---|---|
| duel-deck | `duel-deck` | https://duel-deck-game.web.app |
| knock-hockey | `knock-hockey` | https://knock-hockey.web.app |

To ship an app: `pnpm run release` in its folder (build + `firebase deploy
--only hosting:<target>`). Use `pnpm run`, not `pnpm deploy`, which is a pnpm
built-in. To add a game: `firebase hosting:sites:create <site>`, add a hosting
entry with its `target` and `public: "apps/<app>/dist"`, map it in
`.firebaserc`, and give the app a `release` script. Site ids are global across
Firebase, so the plain name may be taken (`duel-deck` was).

Cache headers keep installs current: HTML, the manifest and the service worker
are `no-cache`; hashed `/assets/**` are immutable.
