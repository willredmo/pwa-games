// Feedback reports in the Realtime Database, shared by `pnpm feedback` (the
// CLI, scripts/feedback.ts) and `pnpm feedback:ui` (the web view,
// scripts/feedback-ui.ts), so both read and close reports the same way.
//
// Everything goes through the Firebase CLI (`firebase` on PATH, logged in to
// the project), which bypasses the database rules: clients can only create a
// report, never read one or change its status.

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = "roguelike-games";
const ROOT = "/feedback/duel-deck";

export interface Report {
  kind: "bug" | "idea";
  text: string;
  contact?: string;
  at: number;
  v: string;
  /** The sender's device id (`clientId()`). */
  c?: string;
  /** The sender's account (verified accounts only). */
  u?: string;
  ua?: string;
  ctx?: string;
  shot?: string;
  // Set by these scripts, never by the game.
  status?: "fixed" | "wontfix";
  closedAt?: number;
  commit?: string;
  fixedIn?: string;
  note?: string;
}

function firebase(...args: string[]): string {
  return execFileSync("firebase", [...args, "--project", PROJECT], { encoding: "utf8", maxBuffer: 1 << 30 });
}

/** A report id, or throws: ids end up in database paths. */
export function checkId(id: string): string {
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error(`Not a report id: ${id}`);
  return id;
}

/**
 * Read a path's JSON. Through a file (`--output`): piped, the CLI can exit
 * before a large value (screenshots make it ~700 KB) is fully written, and
 * the JSON arrives cut short.
 */
function getJson<T>(path: string): T | null {
  const file = join(tmpdir(), `feedback-get-${process.pid}-${Date.now()}.json`);
  try {
    firebase("database:get", path, "--output", file);
    const raw = readFileSync(file, "utf8").trim();
    return raw && raw !== "null" ? (JSON.parse(raw) as T) : null;
  } finally {
    rmSync(file, { force: true });
  }
}

/** Every report, keyed by id. */
export function readReports(): Record<string, Report> {
  return getJson<Record<string, Report>>(ROOT) ?? {};
}

/** Merge fields into a report (null removes one). Through a file: JSON on a Windows command line doesn't survive quoting. */
export function updateReport(id: string, fields: Record<string, unknown>): void {
  checkId(id);
  if (getJson<number>(`${ROOT}/${id}/at`) === null) throw new Error(`No report ${id}`);
  const file = join(tmpdir(), `feedback-${id}.json`);
  writeFileSync(file, JSON.stringify(fields));
  try {
    firebase("database:update", `${ROOT}/${id}`, file, "--force");
  } finally {
    rmSync(file, { force: true });
  }
}

/** Delete a report outright: spam only. Otherwise close it, to keep the history. */
export function removeReport(id: string): void {
  firebase("database:remove", `${ROOT}/${checkId(id)}`, "--force");
}

/** HEAD's short hash, recorded on a closed report (so close after committing the fix). */
export function headCommit(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/** Close a report as fixed or won't-fix, recording when, at which commit, in which release and why. */
export function closeReport(id: string, status: "fixed" | "wontfix", fixedIn?: string, note?: string): void {
  updateReport(id, {
    status,
    closedAt: Date.now(),
    commit: headCommit() ?? null,
    fixedIn: fixedIn || null,
    note: note || null,
  });
}

/** Back to open. */
export function reopenReport(id: string): void {
  updateReport(id, { status: null, closedAt: null, commit: null, fixedIn: null, note: null });
}

/**
 * Who sent what: each device gets a short stable label (#1 is the first to
 * report) and a report count, so repeat reporters stand out.
 */
export function deviceLabels(all: Record<string, Report>): { label: Map<string, string>; count: Map<string, number> } {
  const label = new Map<string, string>();
  const count = new Map<string, number>();
  for (const r of Object.values(all).sort((a, b) => a.at - b.at)) {
    const c = r.c ?? "unknown";
    count.set(c, (count.get(c) ?? 0) + 1);
    if (!label.has(c)) label.set(c, `#${label.size + 1}`);
  }
  return { label, count };
}
