# Roguelike PWA Games — Monorepo

Four roguelike games, PWA-first, built as a pnpm workspace monorepo.

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
- **Backend (for duel-deck and root-and-ruin only):** Supabase or Firebase
  realtime, used for simultaneous-commit turn exchange. Checkers and House Edge
  are fully client-side, no backend.
- **Package manager:** pnpm workspaces.

## Repo structure
```
/apps
  /checkers-roguelike   — single-player checkers roguelike (build first)
  /duel-deck            — 1v1 auto-battler roguelike
  /root-and-ruin        — 2-player co-op roguelike
  /house-edge           — incremental roulette roguelike (idle + prestige)
/packages
  /pwa-shell            — manifest template, service worker, install prompt UI
  /game-ui             — shared React components (HP bars, upgrade-pick
                          cards, buttons, menus)
  /canvas-utils         — board/grid rendering helpers, shape/color constants
  /backend-client       — Supabase/Firebase wrapper for realtime turn exchange
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

`house-edge` sits outside that order — it needs no backend and shares no
mechanics with the other three, so it can be picked up whenever.
