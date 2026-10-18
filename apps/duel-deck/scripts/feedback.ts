// Player bug reports and feature ideas, as sent from the game (src/game/feedback.ts).
//
//   pnpm feedback                 list every report, newest last; save screenshots
//   pnpm feedback --kind=bug      only bugs (or --kind=idea)
//   pnpm feedback --remove=<id>   delete one report once it's dealt with
//
// Screenshots are written to apps/duel-deck/feedback/<id>.jpg (gitignored).
// Reads through the Firebase CLI (`firebase` on PATH, logged in to the
// project), which bypasses the database rules — the client can only write.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT = "roguelike-games";
const ROOT = "/feedback/duel-deck";
const OUT = join(process.cwd(), "feedback");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const firebase = (cmd: string) =>
  execSync(`firebase ${cmd} --project ${PROJECT}`, { encoding: "utf8", maxBuffer: 1 << 30 });

if (args.remove) {
  if (!/^[\w-]{1,40}$/.test(args.remove)) throw new Error(`Not a report id: ${args.remove}`);
  firebase(`database:remove ${ROOT}/${args.remove} --force`);
  console.log(`removed ${args.remove}`);
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
}

const raw = firebase(`database:get ${ROOT}`).trim();
const all: Record<string, Report> = raw && raw !== "null" ? JSON.parse(raw) : {};
const reports = Object.entries(all)
  .filter(([, r]) => !args.kind || r.kind === args.kind)
  .sort(([, a], [, b]) => a.at - b.at);

if (!reports.length) {
  console.log("No feedback.");
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
for (const [id, r] of reports) {
  let shot = "";
  if (r.shot) {
    const m = /^data:image\/(\w+);base64,(.*)$/.exec(r.shot);
    if (m) {
      const file = join(OUT, `${id}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
      writeFileSync(file, Buffer.from(m[2], "base64"));
      shot = file;
    }
  }
  console.log(`\n${r.kind === "bug" ? "🐞 BUG " : "💡 IDEA"}  ${id}  v${r.v}  ${new Date(r.at).toLocaleString()}`);
  console.log(`  ${r.text.replace(/\n/g, "\n  ")}`);
  if (r.contact) console.log(`  contact: ${r.contact}`);
  if (r.ctx) console.log(`  where:   ${r.ctx}`);
  if (r.ua) console.log(`  device:  ${r.ua}`);
  if (shot) console.log(`  shot:    ${shot}`);
}
console.log(`\n${reports.length} report${reports.length === 1 ? "" : "s"}. Remove one with --remove=<id>.`);
