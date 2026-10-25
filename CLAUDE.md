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
  presence and live fields; Firebase is lazy-loaded. Knock Hockey and Duel Deck
  use it for online play; root-and-ruin is meant to. Checkers and House Edge
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
                          exchange (built; used by knock-hockey), plus
                          optional accounts on Firebase Authentication
                          (auth.ts; used by duel-deck)
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

## Animation rules (every game; must work in iOS Safari)
Players install these on iPhones, so every animation has to work in iOS
Safari, not just Chrome. Baseline: iOS 15.4+ (what `100dvh` needs). A
Chromium preview proves nothing about WebKit; test Safari-specific features
in WebKit (Playwright's `webkit`) or on a phone.
- **Animate `transform` and `opacity` only.** Never animate layout (`height`,
  `max-height`, `width`, `top`, margins), `filter` or `backdrop-filter`: iPhones
  stutter on them, and a max-height collapse didn't visibly animate at all
  (duel-deck 1.7.3). To animate a size or position change, use FLIP: measure
  the old and new box, then animate a `transform` from one to the other.
- **Prefixes Safari still needs:** `-webkit-backdrop-filter` (Safari before 18),
  `-webkit-mask` / `-webkit-mask-image`, and `-webkit-background-clip: text`.
  Write the prefixed property alongside the standard one.
- **Web Animations API:** fine, but feature-check `el.animate` and
  `el.getAnimations?.()`, and set `transform-origin` on the element rather than
  inside keyframes.
- **Canvas:** never `ctx.filter` (Safari ignores it; fake blur with
  gradients), no `ctx.roundRect` or `letterSpacing` without a fallback. Drive
  motion from frame *time*, not frame count: ProMotion iPhones run rAF at 120 Hz.
- **One-shot entrances** (`from` only) use `animation-fill-mode: backwards`,
  not `both` or `forwards`: holding the last frame pins `transform` and cancels
  the element's own `:active` and `:hover` transforms. Use `both` only when the
  end state must stay (a card flipped away).
- **Positioned elements** (`transform: translateX(-50%)` centring): keyframes
  must include that transform, or the element jumps while animating.
- **`prefers-reduced-motion`:** wrap motion in
  `@media (prefers-reduced-motion: no-preference)` (CSS) or check
  `prefersReducedMotion()` (canvas, WAAPI), and keep a static or faded
  version. iPhones with Reduce Motion on are common, so "I see no animation"
  may be that setting.
- **Audio started by an animation or screen:** iOS only unlocks audio on the end
  of a tap (`touchend`/`click`), not `pointerdown`, and an AudioContext can be
  `"interrupted"` (a call, backgrounding), so resume whenever it isn't `"running"`.
- **Hidden tabs** run no rAF and pause CSS/WAAPI animations. Don't schedule game
  logic off animation callbacks, and expect a hidden preview pane to show
  frozen frames.
- **Dev only:** Vite hot-reloads modules without reloading the page, so a
  module that owns long-lived audio or timers must stop the previous copy of
  itself when it loads (see duel-deck's `game/music.ts`).

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
