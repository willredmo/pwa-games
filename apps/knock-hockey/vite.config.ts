import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

// https://vite.dev/config/
const buildTime = new Date().toISOString();

export default defineConfig({
  // Shown in the menu, so you can tell which build a device is running.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  // The CPU searches in a module worker (ai/worker.ts).
  worker: { format: "es" },
  plugins: [
    react(),
    // /version.json describes the newest deploy. Served no-cache and never
    // precached, so the menu can compare it with the build it is running.
    {
      name: "version-json",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({ version: pkg.version, deployedAt: buildTime }),
        });
      },
    },
    VitePWA({
      // "prompt": a new build waits until the player taps Update (see
      // ui/UpdatePrompt.tsx) instead of swapping code mid-shot. The app
      // registers the worker itself, so nothing is injected.
      registerType: "prompt",
      injectRegister: false,
      workbox: { cleanupOutdatedCaches: true },
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Knock Hockey",
        short_name: "Knock Hockey",
        description: "Tabletop knock hockey: take turns banking the puck into the other goal.",
        theme_color: "#1a2230",
        background_color: "#1a2230",
        display: "standalone",
        orientation: "portrait",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          // Full-bleed background with the art inside the 80% safe zone, so
          // Android's mask can crop it to any shape without clipping the stick.
          { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
