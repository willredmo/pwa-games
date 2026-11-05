// What Hard knows about real players (src/game/learned.json), distilled from
// telemetry. The free Firebase plan has no server code, so learning happens
// here: run this, then release, and the next build plays with what it found.
//
//   pnpm learn [--file=dump.json] [--dry]
//
// Counts carry over between runs, so they outlive telemetry's three-week
// retention, and fade with a 30-day half-life, so what players did on an old
// balance patch stops counting. Only finished UTC days are read, each once
// (`through`). Never writes to the database, and never prunes it.

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Learned, Tally } from "../src/game/match";

const OUT = "src/game/learned.json";
const HALF_LIFE_DAYS = 30;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

interface Pick { k: string; a: "p" | "m" | "r"; l: number }
interface RoundLog { offer?: string[]; picks?: Pick[]; won: number }
interface CpuLog { pred?: string[]; est?: number }
interface MatchLog {
  meta?: { mode: string; diff: string };
  rounds?: Record<string, RoundLog> | RoundLog[];
  cpu?: Record<string, CpuLog> | CpuLog[];
  end?: { won: number; aug?: string[]; foeAug?: string[] };
}

function readTelemetry(): Record<string, Record<string, MatchLog>> {
  if (args.file) return JSON.parse(readFileSync(args.file, "utf8"));
  // To a file: piped, the Firebase CLI can exit before a big read is written.
  const dir = mkdtempSync(join(tmpdir(), "learn-"));
  const file = join(dir, "telemetry.json");
  try {
    execSync(`firebase database:get /telemetry/duel-deck --output "${file}" --project roguelike-games`, { stdio: "ignore" });
    return JSON.parse(readFileSync(file, "utf8")) ?? {};
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const values = <T,>(x: Record<string, T> | T[] | undefined): T[] => (x ? Object.values(x).filter(Boolean) : []);
const DAY_MS = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const fade = (days: number) => 0.5 ** (days / HALF_LIFE_DAYS);

const old: Learned = JSON.parse(readFileSync(OUT, "utf8"));
const keep = old.through ? fade(daysBetween(old.through, today)) : 1;
const scale = <T extends Record<string, number>>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * keep])) as T;
const scaleAll = (m: Record<string, Tally>) => Object.fromEntries(Object.entries(m).map(([k, t]) => [k, scale(t)]));

const out: Learned = {
  through: old.through,
  matches: old.matches * keep,
  picks: old.picks * keep,
  merges: old.merges * keep,
  cards: Object.fromEntries(Object.entries(old.cards).map(([k, c]) => [k, scale(c)])),
  human: scaleAll(old.human),
  cpu: scaleAll(old.cpu),
  humanBase: scale(old.humanBase),
  cpuBase: scale(old.cpuBase),
};

const tally = (m: Record<string, Tally>, id: string, won: boolean, w: number) => {
  const t = (m[id] ??= { n: 0, won: 0 });
  t.n += w;
  if (won) t.won += w;
};

const data = readTelemetry();
const fresh = Object.keys(data)
  .filter((d) => d > old.through && d < today)
  .sort();
let read = 0;
let guessed = 0;
let guessedRight = 0;
for (const day of fresh) {
  const w = fade(daysBetween(day, today));
  for (const m of Object.values(data[day])) {
    if (!m.meta) continue;
    for (const r of values(m.rounds)) {
      for (const k of r.offer ?? []) (out.cards[k] ??= { offered: 0, taken: 0 }).offered += w;
      for (const p of r.picks ?? []) {
        (out.cards[p.k] ??= { offered: 0, taken: 0 }).taken += w;
        out.picks += w;
        if (p.a === "m") out.merges += w;
      }
    }
    // How well the CPU read the player: its predicted row against the row played.
    const rounds = m.rounds ?? {};
    Object.entries(m.cpu ?? {}).forEach(([n, c]) => {
      const row = (rounds as Record<string, RoundLog & { row?: string[] }>)[n]?.row;
      if (!c?.pred || !row) return;
      guessed += row.length;
      const left = [...c.pred];
      for (const u of row) {
        const i = left.indexOf(u);
        if (i >= 0) {
          guessedRight++;
          left.splice(i, 1);
        }
      }
    });
    if (!m.end) continue;
    read++;
    out.matches += w;
    const humanWon = m.end.won > 0;
    for (const id of new Set(m.end.aug ?? [])) {
      tally(out.human, id, humanWon, w);
      out.humanBase.n += w;
      if (humanWon) out.humanBase.won += w;
    }
    if (m.meta.mode !== "cpu") continue;
    for (const id of new Set(m.end.foeAug ?? [])) {
      tally(out.cpu, id, m.end.won < 0, w);
      out.cpuBase.n += w;
      if (m.end.won < 0) out.cpuBase.won += w;
    }
  }
}
if (fresh.length) out.through = fresh[fresh.length - 1];

// Two decimals: enough for a rate, and the file stays readable in a diff.
const rounded = JSON.stringify(out, (_, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v), 2);
if (!args.dry) writeFileSync(OUT, rounded + "\n");

console.log(`read ${fresh.length} day(s), ${read} finished match(es); through ${out.through || "nothing"}`);
console.log(`weight now: ${out.matches.toFixed(1)} matches, ${out.picks.toFixed(0)} picks`);
console.log(`players merge ${((100 * out.merges) / (out.picks || 1)).toFixed(0)}% of picks`);
const rate = (t: Tally) => (t.n ? `${((100 * t.won) / t.n).toFixed(0)}%` : "n/a");
console.log(`upgrade holders win: players ${rate(out.humanBase)}, CPU ${rate(out.cpuBase)}`);
if (guessed) console.log(`CPU's predicted rows matched ${((100 * guessedRight) / guessed).toFixed(0)}% of the units played`);
console.log(args.dry ? "(dry run: nothing written)" : `wrote ${OUT}; release to ship it`);
