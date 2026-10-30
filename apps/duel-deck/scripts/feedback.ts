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
// counts devices by), an optional contact they typed, and the account (`u`)
// when they were signed in. A guest on two devices is two ids.
//
// Screenshots are written to apps/duel-deck/feedback/<id>.jpg (gitignored).
// Reads and writes through scripts/feedbackDb.ts (the Firebase CLI), shared
// with the web view, `pnpm feedback:ui`.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeReport, deviceLabels, readReports, removeReport, reopenReport, type Report } from "./feedbackDb";

const OUT = join(process.cwd(), "feedback");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);
const given = (v: string | undefined) => (v && v !== "true" ? v : undefined);

if (args.remove) {
  removeReport(args.remove);
  console.log(`removed ${args.remove}`);
  process.exit(0);
}
for (const status of ["fix", "wontfix"] as const) {
  if (!args[status]) continue;
  const id = args[status];
  closeReport(id, status === "fix" ? "fixed" : "wontfix", given(args.in), given(args.note));
  console.log(`${id}: ${status === "fix" ? "fixed" : "won't fix"}${args.in ? ` in ${args.in}` : ""}`);
  process.exit(0);
}
if (args.reopen) {
  reopenReport(args.reopen);
  console.log(`${args.reopen}: reopened`);
  process.exit(0);
}

const all = readReports();

// Devices get a short stable label (#1 is the first to report) and a count, so
// "who sent this" reads at a glance and repeat reporters stand out.
const { label, count: byDevice } = deviceLabels(all);
const who = (r: Report) => {
  const c = r.c ?? "unknown";
  const n = byDevice.get(c) ?? 1;
  return `device ${label.get(c)} (${c}, ${n} report${n === 1 ? "" : "s"})${r.contact ? ` · contact: ${r.contact}` : ""}${r.u ? ` · account: ${r.u}` : ""}`;
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
