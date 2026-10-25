import { configure, connectEmulators } from "@pwa-games/backend-client";

// The Firebase project every online feature talks to (rooms, telemetry).
// Imported for its side effect; configure() loads nothing until first use.

// Public web config: it identifies the project; the database rules guard it.
configure({
  apiKey: "AIzaSyDSy9OF5r3sJ13D3IhgEACL5oVffWm33Nk",
  // The game's own Hosting site, not roguelike-games.firebaseapp.com: Google
  // sign-in by redirect (installed iOS apps) only keeps its state when the
  // auth handler is on the same domain as the game (see backend-client auth.ts).
  authDomain: "duel-deck-game.web.app",
  databaseURL: "https://roguelike-games-default-rtdb.firebaseio.com",
  projectId: "roguelike-games",
  appId: "1:130931296377:web:6b48e09eb320de0fb62ca8",
});

// `pnpm dev:emu`: talk to the local emulators (`pnpm emulators` at the repo root).
// (`env` is Vite's: the node scripts that bundle room.ts with esbuild have none.)
if (import.meta.env?.VITE_FIREBASE_EMULATORS) connectEmulators();
