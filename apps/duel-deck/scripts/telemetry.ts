// Real-player balance report, from the telemetry the game writes
// (src/game/telemetry.ts). The same questions `pnpm sim` answers for AIs:
// what gets picked, and what wins.
//
//   pnpm telemetry [--days=7] [--v=1.3.0] [--mode=cpu|online] [--file=dump.json]
//   pnpm telemetry --prune            delete days older than RETAIN_DAYS
//
// Reads through the Firebase CLI (`firebase` on PATH, logged in to the
// project), which bypasses the database rules — the client can only write.
// Every run also prunes, so old data goes even if the daily Action is off.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROJECT = "roguelike-games";
const ROOT = "/telemetry/duel-deck";
/** Keep three weeks. The same number is in .github/workflows/telemetry-prune.yml. */
const RETAIN_DAYS = 21;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const firebase = (cmd: string) =>
  execSync(`firebase ${cmd} --project ${PROJECT}`, { encoding: "utf8", maxBuffer: 1 << 30 });

const today = new Date();
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => dayStr(new Date(today.getTime() - n * 86_400_000));

function prune(): void {
  const cutoff = daysAgo(RETAIN_DAYS);
  const raw = firebase(`database:get ${ROOT} --shallow`).trim();
  const days = raw && raw !== "null" ? Object.keys(JSON.parse(raw)) : [];
  const old = days.filter((d) => d < cutoff);
  for (const d of old) firebase(`database:remove ${ROOT}/${d} --force`);
  console.log(`prune: ${old.length ? `removed ${old.join(", ")}` : "nothing older than " + cutoff}`);
}

// A --file run is offline (testing the report), so it doesn't touch the database.
if (!args.file) prune();
if (args.prune) process.exit(0);

// --- Load ------------------------------------------------------------------

interface Pick { k: string; a: "p" | "m" | "r"; l: number }
interface RoundLog { offer?: string[]; picks?: Pick[]; rr?: number; row?: string[]; foe?: string[]; won: number; hp?: number[] }
interface AugLog { o?: string[]; t: string; rr?: number; e?: string }
interface EndLog { won: number; rounds: number; hp?: number[]; aug?: string[]; foeAug?: string[]; mvp?: string }
interface MatchLog {
  meta?: { v: string; mode: string; diff: string; at: number; c: string };
  rounds?: Record<string, RoundLog> | RoundLog[];
  augs?: Record<string, AugLog> | AugLog[];
  end?: EndLog;
}

const data: Record<string, Record<string, MatchLog>> =
  (args.file ? JSON.parse(readFileSync(args.file, "utf8")) : JSON.parse(firebase(`database:get ${ROOT}`) || "null")) ?? {};

const since = args.days ? daysAgo(Number(args.days)) : "";
/** The database turns dense numeric keys into arrays, sparse ones into objects. */
const values = <T,>(x: Record<string, T> | T[] | undefined): T[] => (x ? Object.values(x).filter(Boolean) : []);

const matches: MatchLog[] = [];
for (const [day, byId] of Object.entries(data)) {
  if (day < since) continue;
  for (const m of Object.values(byId)) {
    if (!m.meta) continue;
    if (args.v && m.meta.v !== args.v) continue;
    if (args.mode && m.meta.mode !== args.mode) continue;
    matches.push(m);
  }
}
const ended = matches.filter((m) => m.end);
console.log(`\n${matches.length} matches (${ended.length} finished)${since ? ` since ${since}` : ""}${args.v ? `, v${args.v}` : ""}\n`);
if (!matches.length) process.exit(0);

// --- Report ----------------------------------------------------------------

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
const table = (title: string, rows: (string | number)[][], head: string[]) => {
  console.log(title);
  const all = [head, ...rows].map((r) => r.map(String));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  for (const r of all) console.log("  " + r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join("  "));
  console.log();
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Results by opponent.
const byDiff = new Map<string, { n: number; won: number }>();
for (const m of ended) {
  const k = `${m.meta!.mode}/${m.meta!.diff}`;
  const e = byDiff.get(k) ?? { n: 0, won: 0 };
  e.n++;
  if (m.end!.won > 0) e.won++;
  byDiff.set(k, e);
}
table("Player results", [...byDiff].map(([k, e]) => [k, e.n, pct(e.won, e.n)]), ["opponent", "matches", "won"]);
console.log(`Match length: median ${median(ended.map((m) => m.end!.rounds))} rounds\n`);

// Units: how often a dealt card is taken, how it's used, and whether rows ending with it win.
const unit = new Map<string, { offered: number; taken: number; merge: number; held: number; heldWon: number; aiHeld: number; aiWon: number }>();
const u = (k: string) => {
  let e = unit.get(k);
  if (!e) unit.set(k, (e = { offered: 0, taken: 0, merge: 0, held: 0, heldWon: 0, aiHeld: 0, aiWon: 0 }));
  return e;
};
const levels: number[] = [];
for (const m of matches) {
  const rounds = values(m.rounds);
  for (const r of rounds) {
    for (const k of r.offer ?? []) u(k).offered++;
    for (const p of r.picks ?? []) {
      u(p.k).taken++;
      if (p.a === "m") u(p.k).merge++;
    }
  }
  const last = rounds[rounds.length - 1];
  if (!m.end || !last) continue;
  const types = (row?: string[]) => new Set((row ?? []).map((s) => s.split(":")[0]));
  for (const k of types(last.row)) {
    u(k).held++;
    if (m.end.won > 0) u(k).heldWon++;
  }
  // The CPU's rows are a second sample (online, the other device logs its own).
  if (m.meta!.mode === "cpu") {
    for (const k of types(last.foe)) {
      u(k).aiHeld++;
      if (m.end.won < 0) u(k).aiWon++;
    }
  }
  for (const s of last.row ?? []) levels.push(Number(s.split(":")[1]));
}
table(
  "Units (players' picks; win rate of rows holding the type at match end)",
  [...unit].sort((a, b) => b[1].taken - a[1].taken).map(([k, e]) => [k, e.offered, e.taken, pct(e.taken, e.offered), pct(e.merge, e.taken), e.held, pct(e.heldWon, e.held), pct(e.aiWon, e.aiHeld)]),
  ["unit", "dealt", "taken", "take", "merged", "held", "won", "cpu won"],
);
levels.sort((a, b) => a - b);
if (levels.length) {
  const q = (p: number) => levels[Math.min(levels.length - 1, Math.floor(p * levels.length))];
  console.log(`Final unit levels: median ${q(0.5)}, p90 ${q(0.9)}, max ${levels[levels.length - 1]}\n`);
}

// Upgrades: offered → taken, and the holder's match win rate.
const aug = new Map<string, { offered: number; taken: number; held: number; won: number; aiHeld: number; aiWon: number }>();
const a = (k: string) => {
  let e = aug.get(k);
  if (!e) aug.set(k, (e = { offered: 0, taken: 0, held: 0, won: 0, aiHeld: 0, aiWon: 0 }));
  return e;
};
for (const m of matches) {
  for (const c of values(m.augs)) {
    for (const k of c.o ?? []) a(k).offered++;
    a(c.t).taken++;
  }
  if (!m.end) continue;
  for (const k of m.end.aug ?? []) {
    a(k).held++;
    if (m.end.won > 0) a(k).won++;
  }
  if (m.meta!.mode === "cpu") {
    for (const k of m.end.foeAug ?? []) {
      a(k).aiHeld++;
      if (m.end.won < 0) a(k).aiWon++;
    }
  }
}
table(
  "Upgrades (players' choices; holder match win rate)",
  [...aug].sort((x, y) => y[1].taken / (y[1].offered || 1) - x[1].taken / (x[1].offered || 1)).map(([k, e]) => [k, e.offered, e.taken, pct(e.taken, e.offered), e.held, pct(e.won, e.held), pct(e.aiWon, e.aiHeld)]),
  ["upgrade", "offered", "taken", "take", "held", "won", "cpu won"],
);
