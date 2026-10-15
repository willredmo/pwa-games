import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

// Service-worker updates, shared by the update toast and the menu's About
// section. The worker serves the cached build instantly; a new deploy installs
// in the background and then waits for the player to apply it, so a build never
// swaps mid-battle. Waiting matters on iOS, where a home screen app is rarely
// fully closed — without a prompt it could sit on an old build for days.
// Updates are checked on launch, whenever the app returns to the foreground,
// hourly, and on demand from the menu.

const CHECK_EVERY_MS = 60 * 60 * 1000;

/** What /version.json says about the newest deploy. */
export interface DeployInfo {
  version: string;
  deployedAt: string;
}

/** This build, baked in at build time. */
export const THIS_BUILD: DeployInfo = { version: __APP_VERSION__, deployedAt: __BUILD_TIME__ };

let needRefresh = false;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let started = false;
/** Register the worker once and start the background checks. */
function start(): void {
  if (started || !("serviceWorker" in navigator)) return;
  started = true;
  applyUpdate = registerSW({
    onNeedRefresh: () => {
      needRefresh = true;
      emit();
    },
    onRegisteredSW: (_url, r) => {
      registration = r;
    },
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  });
  window.setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
}

/** Ask the server for a newer worker. Resolves once the check has finished. */
export async function checkForUpdate(): Promise<void> {
  if (!registration || !navigator.onLine) return;
  try {
    await registration.update();
  } catch {
    /* offline or server hiccup — the next check will try again */
  }
}

/** Reload into the waiting build (or just reload if none is waiting). */
export function update(): void {
  if (needRefresh && applyUpdate) void applyUpdate(true);
  else window.location.reload();
}

/** The newest deploy's version and time, fetched past every cache. */
export async function fetchLatestDeploy(): Promise<DeployInfo | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as DeployInfo) : null;
  } catch {
    return null;
  }
}

/**
 * Update to the newest deploy even if it hasn't finished downloading yet: the
 * worker serves the cached build, so a plain reload would land back on the old
 * one. Asks for the new worker and waits (up to `waitMs`) for it to install.
 */
export async function updateNow(waitMs = 10_000): Promise<void> {
  start();
  if (!needRefresh) {
    await checkForUpdate();
    const until = Date.now() + waitMs;
    while (!needRefresh && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  }
  update();
}

/** -1, 0 or 1 comparing dotted versions ("1.10.0" > "1.9.2"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The newest deploy if it's newer than this build, else null. Null too when it
 * can't be checked (offline, or ite dev with no version.json) — never block
 * on a failed check. Also starts downloading it, so "Update now" is quick.
 */
export async function newerDeploy(): Promise<DeployInfo | null> {
  const latest = await fetchLatestDeploy();
  if (!latest || compareVersions(latest.version, THIS_BUILD.version) <= 0) return null;
  void checkForUpdate();
  return latest;
}

/** Whether a newer build is downloaded and waiting. */
export function usePwaUpdate(): boolean {
  const [ready, setReady] = useState(needRefresh);
  useEffect(() => {
    start();
    const l = () => setReady(needRefresh);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return ready;
}

/** "Oct 4, 2026, 3:12 PM" — the way the About section shows a deploy. */
export function formatDeploy(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "unknown"
    : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
