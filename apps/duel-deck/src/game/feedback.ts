import { clientId, writeAt } from "@pwa-games/backend-client";
import "../online/firebase";

// Player feedback: bug reports and feature ideas, each with an optional
// screenshot of the game. Read with `pnpm feedback` (scripts/feedback.ts),
// which also saves the screenshots to disk.
//
// Layout: feedback/duel-deck/<UTC day>-<random>
//   { kind, text, contact?, at, v, c, ua, ctx, shot? }
// Create-only in the database rules, like telemetry, and nobody can read it
// back but the Firebase CLI.
//
// The screenshot is the page re-drawn by html2canvas (the board canvases are
// copied as they are), not a capture of the screen: no permission prompt, it
// works on phones, and nothing outside the game can end up in it. html2canvas
// is ~200 KB, so it's only loaded when someone actually reports something.

const ROOT = "feedback/duel-deck";
/** The screenshot's longer side, in pixels. Enough to read the board and the text on it. */
const SHOT_MAX_SIDE = 1280;
/** Under the database rule's 1,000,000 characters, with room to spare. */
const SHOT_MAX_CHARS = 900_000;

export type FeedbackKind = "bug" | "idea";

/** A JPEG data URL of what's on screen now, or null if it couldn't be drawn. */
export async function captureScreenshot(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import("html2canvas");
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, SHOT_MAX_SIDE / Math.max(w, h));
    const canvas = await html2canvas(document.body, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#111",
      scale,
      logging: false,
      // The viewport, not the whole document: what the player is looking at.
      x: window.scrollX,
      y: window.scrollY,
      width: w,
      height: h,
      windowWidth: w,
      windowHeight: h,
      // html2canvas draws its own clone of the page, and two things come out
      // wrong in it: entrance animations restart from their first frame (the
      // title's difficulty cards fade in from opacity 0, so they vanished), and
      // a closed <details> gets its contents drawn on top of what follows.
      // Gradient text (background-clip: text) isn't supported either and draws
      // as a solid block, so it becomes plain text in the gradient's first colour.
      onclone: (doc) => {
        const style = doc.createElement("style");
        style.textContent =
          "*,*::before,*::after{animation:none!important;transition:none!important}" +
          "details:not([open])>:not(summary){display:none!important}";
        doc.head.appendChild(style);
        const view = doc.defaultView;
        if (!view) return;
        for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
          const cs = view.getComputedStyle(el);
          const clip = cs.backgroundClip || cs.getPropertyValue("-webkit-background-clip");
          if (clip !== "text") continue;
          const color = /rgba?\([^)]*\)|#[0-9a-f]{3,8}/i.exec(cs.backgroundImage)?.[0] ?? "#f0c96a";
          el.style.setProperty("background", "none", "important");
          el.style.setProperty("-webkit-text-fill-color", color, "important");
          el.style.setProperty("color", color, "important");
        }
      },
    });
    for (const quality of [0.72, 0.5, 0.3]) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (url.length <= SHOT_MAX_CHARS) return url;
    }
    return null;
  } catch {
    return null;
  }
}

/** Wait for the browser to paint twice, so a menu closed just before is gone from the capture. */
export const afterPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    setTimeout(resolve, 150); // a hidden page runs no frames
  });

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

export interface FeedbackEntry {
  kind: FeedbackKind;
  text: string;
  contact?: string;
  /** Where the player was: screen, mode, round, phase. */
  ctx: string;
  shot?: string | null;
}

/**
 * Send one report. Resolves once the server has it; rejects if the write is
 * refused, or with "timeout" if it's still queued (offline) after `timeoutMs`.
 */
export async function sendFeedback(entry: FeedbackEntry, timeoutMs = 20_000): Promise<void> {
  const at = Date.now();
  const id = `${new Date(at).toISOString().slice(0, 10)}-${randomId()}`;
  const value: Record<string, unknown> = {
    kind: entry.kind,
    text: entry.text.slice(0, 2000),
    at,
    v: __APP_VERSION__,
    c: clientId(),
    ua: navigator.userAgent.slice(0, 400),
    ctx: `${entry.ctx} · ${window.innerWidth}×${window.innerHeight}@${window.devicePixelRatio || 1}x`.slice(0, 500),
  };
  const contact = entry.contact?.trim();
  if (contact) value.contact = contact.slice(0, 120);
  if (entry.shot) value.shot = entry.shot;
  await Promise.race([
    writeAt(`${ROOT}/${id}`, value),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
  ]);
}

/** Save the screenshot as a file, so the player can attach it somewhere else too. */
export function downloadScreenshot(shot: string): void {
  const a = document.createElement("a");
  a.href = shot;
  a.download = `duel-deck-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
