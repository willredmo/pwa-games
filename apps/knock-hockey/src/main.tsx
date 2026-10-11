import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
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

// No long-press context menu (Android, desktop right-click) outside text fields.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement | null;
  if (!el?.closest("input, textarea, [contenteditable='true']")) e.preventDefault();
});
// iOS can still start a selection on a long press; cancel any that begins
// outside a text field.
document.addEventListener("selectstart", (e) => {
  const el = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement;
  if (!el?.closest("input, textarea, [contenteditable='true']")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
