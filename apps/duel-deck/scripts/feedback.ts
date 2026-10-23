// Player bug reports and feature ideas, as sent from the game (src/game/feedback.ts).
//
//   pnpm feedback                       open reports in full, then the closed ones one line each
//   pnpm feedback --kind=bug            only bugs (or --kind=idea)
//   pnpm feedback --open                only open reports
//   pnpm feedback --all                 closed reports in full too
//   pnpm feedback --from=<device>       one device's reports (a prefix of its id is enough)
//   pnpm feedback --fix=<id> [--in=1.7.5] [--note="…"]   mark a report fixed
//   pnpm feedback --wontfix=<id> [--note="…"]            close it without a fix (ideas, tests)
//   pnpm feedback --reopen=<id>         back to open
//   pnpm feedback --remove=<id>         delete it outright (spam; otherwise close it, to keep the history)
//
// Closing a report keeps it and records when, at which commit, in which
// release (`--in`) and why (`--note`), so the history stays. Who sent it: each
// report carries the sender's device id (`c`, `clientId()` from
// backend-client, a random id per browser/install, the same one telemetry
// counts devices by) and an optional contact they typed. There are no
// accounts, so a person on two devices is two ids.
//
// Screenshots are written to apps/duel-deck/feedback/<id>.jpg (gitignored).
// Reads and writes through the Firebase CLI (`firebase` on PATH, logged in to
// the project), which bypasses the database rules: clients can only create a
// report, never read one or change its status.

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = "roguelike-games";
const ROOT = "/feedback/duel-deck";
const OUT = join(process.cwd(), "feedback");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);

const firebase = (cmd: string) =>
  execSync(`firebase ${cmd} --project ${PROJECT}`, { encoding: "utf8", maxBuffer: 1 << 30 });

const checkId = (id: string) => {
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error(`Not a report id: ${id}`);
  return id;
};

/** Merge fields into a report (null removes one). Through a file: JSON on a Windows command line doesn't survive quoting. */
function update(id: string, fields: Record<string, unknown>): void {
  const exists = firebase(`database:get ${ROOT}/${id}/at`).trim();
  if (!exists || exists === "null") throw new Error(`No report ${id}`);
  const file = join(tmpdir(), `feedback-${id}.json`);
  writeFileSync(file, JSON.stringify(fields));
  try {
    firebase(`database:update ${ROOT}/${id} "${file}" --force`);
  } finally {
    rmSync(file, { force: true });
  }
}

const commit = () => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
};

if (args.remove) {
  firebase(`database:remove ${ROOT}/${checkId(args.remove)} --force`);
  console.log(`removed ${args.remove}`);
  process.exit(0);
}
for (const status of ["fix", "wontfix"] as const) {
  if (!args[status]) continue;
  const id = checkId(args[status]);
  update(id, {
    status: status === "fix" ? "fixed" : "wontfix",
    closedAt: Date.now(),
    commit: commit() ?? null,
    fixedIn: args.in && args.in !== "true" ? args.in : null,
    note: args.note && args.note !== "true" ? args.note : null,
  });
  console.log(`${id}: ${status === "fix" ? "fixed" : "won't fix"}${args.in ? ` in ${args.in}` : ""}`);
  process.exit(0);
}
if (args.reopen) {
  update(checkId(args.reopen), { status: null, closedAt: null, commit: null, fixedIn: null, note: null });
  console.log(`${args.reopen}: reopened`);
  process.exit(0);
}

interface Report {
  kind: "bug" | "idea";
  text: string;
  contact?: string;
  at: number;
  v: string;
  c?: string;
  ua?: string;
  ctx?: string;
  shot?: string;
  // Set by this script, never by the game.
  status?: "fixed" | "wontfix";
  closedAt?: number;
  commit?: string;
  fixedIn?: string;
  note?: string;
}

const raw = firebase(`database:get ${ROOT}`).trim();
const all: Record<string, Report> = raw && raw !== "null" ? JSON.parse(raw) : {};

// Devices get a short stable label (#1 is the first to report) and a count, so
// "who sent this" reads at a glance and repeat reporters stand out.
const byDevice = new Map<string, number>();
const label = new Map<string, string>();
for (const r of Object.values(all).sort((a, b) => a.at - b.at)) {
  const c = r.c ?? "unknown";
  byDevice.set(c, (byDevice.get(c) ?? 0) + 1);
  if (!label.has(c)) label.set(c, `#${label.size + 1}`);
}
const who = (r: Report) => {
  const c = r.c ?? "unknown";
  const n = byDevice.get(c) ?? 1;
  return `device ${label.get(c)} (${c}, ${n} report${n === 1 ? "" : "s"})${r.contact ? ` · contact: ${r.contact}` : ""}`;
};

const reports = Object.entries(all)
  .filter(([, r]) => !args.kind || r.kind === args.kind)
  .filter(([, r]) => !args.from || (r.c ?? "").startsWith(args.from) || label.get(r.c ?? "unknown") === args.from)
  .sort(([, a], [, b]) => a.at - b.at);
const open = reports.filter(([, r]) => !r.status);
const closed = reports.filter(([, r]) => r.status);

if (!reports.length) {
  console.log("No feedback.");
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const closedTag = (r: Report) =>
  r.status === "fixed"
    ? `✅ FIXED${r.fixedIn ? ` in ${r.fixedIn}` : ""}${r.commit ? ` (${r.commit})` : ""}`
    : "⚪ WON'T FIX";

function printFull(id: string, r: Report): void {
  let shot = "";
  if (r.shot) {
    const m = /^data:image\/(\w+);base64,(.*)$/.exec(r.shot);
    if (m) {
      const file = join(OUT, `${id}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
      writeFileSync(file, Buffer.from(m[2], "base64"));
      shot = file;
    }
  }
  console.log(`\n${r.kind === "bug" ? "🐞 BUG " : "💡 IDEA"}  ${id}  v${r.v}  ${new Date(r.at).toLocaleString()}${r.status ? `  ${closedTag(r)}` : ""}`);
  console.log(`  ${r.text.replace(/\n/g, "\n  ")}`);
  console.log(`  from:    ${who(r)}`);
  if (r.ctx) console.log(`  where:   ${r.ctx}`);
  if (r.ua) console.log(`  browser: ${r.ua}`);
  if (shot) console.log(`  shot:    ${shot}`);
  if (r.status) console.log(`  closed:  ${new Date(r.closedAt ?? 0).toLocaleString()}${r.note ? ` · ${r.note}` : ""}`);
}

for (const [id, r] of open) printFull(id, r);
if (closed.length && !args.open) {
  if (args.all) for (const [id, r] of closed) printFull(id, r);
  else {
    console.log(`\nClosed:`);
    for (const [id, r] of closed) {
      const text = r.text.replace(/\s+/g, " ");
      console.log(`  ${closedTag(r)}  ${id}  ${r.kind}  ${label.get(r.c ?? "unknown")}  "${text.length > 60 ? `${text.slice(0, 57)}…` : text}"${r.note ? `  · ${r.note}` : ""}`);
    }
  }
}
const devices = new Set(reports.map(([, r]) => r.c ?? "unknown")).size;
console.log(
  `\n${open.length} open, ${closed.length} closed, from ${devices} device${devices === 1 ? "" : "s"}.` +
    ` Close one with --fix=<id> [--in=x.y.z] [--note=…] or --wontfix=<id>.`,
);
