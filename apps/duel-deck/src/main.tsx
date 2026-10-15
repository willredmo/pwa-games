import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Soundboard } from "./ui/Soundboard";
import "./index.css";

// No pinch zoom. iOS Safari ignores `user-scalable=no` in the viewport meta,
// so block its gesture events and any multi-finger touch move here as well.
// Double-tap zoom is off via `touch-action: manipulation` in index.css.
const block = (e: Event) => e.preventDefault();
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, block, { passive: false });
}
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

// Dev only: ?sounds opens a page to review every sound effect.
const soundboard = import.meta.env.DEV && new URLSearchParams(location.search).has("sounds");

createRoot(document.getElementById("root")!).render(<StrictMode>{soundboard ? <Soundboard /> : <App />}</StrictMode>);
