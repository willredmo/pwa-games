import { configure } from "@pwa-games/backend-client";

// The Firebase project every online feature talks to (rooms, telemetry).
// Imported for its side effect; configure() loads nothing until first use.

// Public web config: it identifies the project; the database rules guard it.
configure({
  apiKey: "AIzaSyDSy9OF5r3sJ13D3IhgEACL5oVffWm33Nk",
  authDomain: "roguelike-games.firebaseapp.com",
  databaseURL: "https://roguelike-games-default-rtdb.firebaseio.com",
  projectId: "roguelike-games",
  appId: "1:130931296377:web:6b48e09eb320de0fb62ca8",
});
