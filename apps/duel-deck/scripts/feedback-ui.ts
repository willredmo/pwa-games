// A web view of player bug reports and ideas: `pnpm feedback:ui`, then
// http://localhost:5180 (launch config `duel-deck-feedback`).
//
// The same data and actions as `pnpm feedback` (scripts/feedback.ts), through
// the same helpers (scripts/feedbackDb.ts, the Firebase CLI): Open / Closed
// tabs, bug / idea filters, screenshots inline, and Fixed / Won't fix /
// Reopen / Remove. Closing keeps the report and records when, at which commit
// (HEAD's, so fix after committing), in which release and why.
//
// The database is read once per page load (no polling; Refresh reloads).
// It listens on localhost only, and actions are a JSON POST from the page's
// own origin, so another site open in the browser can't close reports.
// Report text is from players: the page only ever puts it in as text.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeReport, deviceLabels, readReports, removeReport, reopenReport, type Report } from "./feedbackDb";

const PORT = 5180;
const ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const VERSION: string = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;

/** The last read, so screenshots can be served without reading again. */
let cache: Record<string, Report> = {};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}
const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, "application/json", JSON.stringify(value));

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10_000) reject(new Error("too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Every report without its screenshot (served separately), plus who sent it. */
function listing() {
  cache = readReports();
  const { label, count } = deviceLabels(cache);
  const reports = Object.entries(cache)
    .map(([id, r]) => {
      const { shot, ...rest } = r;
      const c = r.c ?? "unknown";
      return { id, ...rest, shot: !!shot && /^data:image\/(jpeg|png|webp);base64,/.test(shot), device: label.get(c), deviceReports: count.get(c) };
    })
    .sort((a, b) => b.at - a.at);
  return { version: VERSION, reports };
}

async function act(req: IncomingMessage, res: ServerResponse) {
  // A JSON POST from this page only: another origin's fetch would need a
  // preflight, which this server never answers.
  if (!ORIGINS.has(req.headers.origin ?? "") || !(req.headers["content-type"] ?? "").startsWith("application/json")) {
    return json(res, 403, { error: "forbidden" });
  }
  const { id, action, fixedIn, note } = JSON.parse(await body(req)) as Record<string, string | undefined>;
  if (!id) return json(res, 400, { error: "no id" });
  const text = (v: string | undefined, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
  if (action === "fixed" || action === "wontfix") closeReport(id, action, text(fixedIn, 20), text(note, 300));
  else if (action === "reopen") reopenReport(id);
  else if (action === "remove") removeReport(id);
  else return json(res, 400, { error: "unknown action" });
  json(res, 200, { ok: true });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", PAGE);
    if (req.method === "GET" && url.pathname === "/api/reports") return json(res, 200, listing());
    const shot = /^\/shot\/([\w-]{1,40})$/.exec(url.pathname);
    if (req.method === "GET" && shot) {
      const m = /^data:image\/(jpeg|png|webp);base64,(.*)$/.exec(cache[shot[1]]?.shot ?? "");
      return m ? send(res, 200, `image/${m[1]}`, Buffer.from(m[2], "base64")) : send(res, 404, "text/plain", "no screenshot");
    }
    if (req.method === "POST" && url.pathname === "/api/action") return await act(req, res);
    send(res, 404, "text/plain", "not found");
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Feedback: http://localhost:${PORT}`));

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Duel Deck feedback</title>
<style>
  :root { color-scheme: dark; --bg: #14121f; --panel: #1f1b2e; --line: #3a3454; --fg: #eeeaf8; --muted: #9a93b8; --gold: #f0b429; --red: #ff8a7a; --green: #7fdc9a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, -apple-system, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1rem; padding: 0.8rem 1rem; background: rgba(20, 18, 31, 0.95); border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 1.15rem; }
  .group { display: flex; gap: 0.25rem; padding: 0.2rem; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); }
  .group button { font: inherit; font-size: 0.85rem; padding: 0.3rem 0.7rem; border: 0; border-radius: 7px; background: none; color: var(--muted); cursor: pointer; }
  .group button[aria-pressed="true"] { background: #3b3360; color: #fff; font-weight: 700; }
  .spacer { flex: 1; }
  .btn { font: inherit; font-size: 0.85rem; padding: 0.35rem 0.8rem; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
  .btn:hover { border-color: #6a5fa0; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn--fix { border-color: #3f7a52; color: var(--green); }
  .btn--danger { color: var(--red); }
  main { max-width: 52rem; margin: 0 auto; padding: 1rem; display: grid; gap: 0.9rem; }
  .status { color: var(--muted); text-align: center; padding: 2rem 0; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 0.9rem 1rem; display: grid; gap: 0.55rem; }
  .card__head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.7rem; font-size: 0.82rem; color: var(--muted); }
  .kind { font-weight: 800; font-size: 0.78rem; letter-spacing: 0.05em; padding: 0.1rem 0.5rem; border-radius: 999px; }
  .kind--bug { background: rgba(255, 138, 122, 0.15); color: var(--red); }
  .kind--idea { background: rgba(240, 180, 41, 0.15); color: var(--gold); }
  .closed { font-weight: 700; color: var(--fg); }
  .text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 1rem; }
  dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.8rem; font-size: 0.82rem; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .shot img { display: block; max-width: min(100%, 22rem); max-height: 28rem; border-radius: 10px; border: 1px solid var(--line); cursor: zoom-in; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding-top: 0.3rem; border-top: 1px solid var(--line); }
  .actions input { font: inherit; font-size: 0.85rem; padding: 0.35rem 0.55rem; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
  .actions .in { width: 6rem; }
  .actions .note { flex: 1; min-width: 10rem; }
  .err { color: var(--red); font-size: 0.85rem; }
  @media (max-width: 34rem) { dl { grid-template-columns: 1fr; } dt { margin-top: 0.3rem; } }
</style>
</head>
<body>
<header>
  <h1>🐞 Duel Deck feedback</h1>
  <div class="group" id="tabs">
    <button data-tab="open" aria-pressed="true">Open</button>
    <button data-tab="closed" aria-pressed="false">Closed</button>
  </div>
  <div class="group" id="kinds">
    <button data-kind="all" aria-pressed="true">All</button>
    <button data-kind="bug" aria-pressed="false">🐞 Bugs</button>
    <button data-kind="idea" aria-pressed="false">💡 Ideas</button>
  </div>
  <span class="spacer"></span>
  <button class="btn" id="refresh">Refresh</button>
</header>
<main id="list"><p class="status">Loading…</p></main>
<script>
const state = { tab: "open", kind: "all", data: null };
const list = document.getElementById("list");

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null && k !== false) e.append(k);
  return e;
}
const when = (ms) => new Date(ms).toLocaleString();

async function load() {
  list.replaceChildren(el("p", { class: "status" }, "Loading…"));
  try {
    const res = await fetch("/api/reports");
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    state.data = await res.json();
    render();
  } catch (e) {
    list.replaceChildren(el("p", { class: "status err" }, "Couldn't read reports: " + e.message));
  }
}

async function act(id, action, extra, card) {
  const buttons = card.querySelectorAll("button, input");
  buttons.forEach((b) => (b.disabled = true));
  try {
    const res = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    await load();
  } catch (e) {
    buttons.forEach((b) => (b.disabled = false));
    card.append(el("p", { class: "err" }, "Failed: " + e.message));
  }
}

function card(r) {
  const c = el("article", { class: "card" });
  const closedTag = r.status === "fixed"
    ? "✅ Fixed" + (r.fixedIn ? " in " + r.fixedIn : "") + (r.commit ? " (" + r.commit + ")" : "")
    : r.status === "wontfix" ? "⚪ Won't fix" : null;
  c.append(
    el("div", { class: "card__head" },
      el("span", { class: "kind kind--" + r.kind }, r.kind === "bug" ? "🐞 BUG" : "💡 IDEA"),
      el("span", {}, "v" + r.v),
      el("span", {}, when(r.at)),
      el("span", {}, r.id),
      closedTag && el("span", { class: "closed" }, closedTag)),
    el("div", { class: "text" }, r.text),
  );
  const info = el("dl", {});
  const row = (k, v) => v && info.append(el("dt", {}, k), el("dd", {}, v));
  row("From", "device " + r.device + " (" + (r.c || "unknown") + ", " + r.deviceReports + " report" + (r.deviceReports === 1 ? "" : "s") + ")");
  row("Account", r.u);
  row("Contact", r.contact);
  row("Where", r.ctx);
  row("Browser", r.ua);
  if (r.status) row("Closed", when(r.closedAt) + (r.note ? " · " + r.note : ""));
  c.append(info);
  if (r.shot) {
    const src = "/shot/" + encodeURIComponent(r.id);
    c.append(el("a", { class: "shot", href: src, target: "_blank", rel: "noopener" }, el("img", { src, alt: "Screenshot", loading: "lazy" })));
  }
  const actions = el("div", { class: "actions" });
  if (r.status) {
    actions.append(el("button", { class: "btn", onclick: () => act(r.id, "reopen", {}, c) }, "Reopen"));
  } else {
    const fixedIn = el("input", { class: "in", value: state.data.version, "aria-label": "Fixed in version", title: "Fixed in version" });
    const note = el("input", { class: "note", placeholder: "Note (optional)", "aria-label": "Note" });
    actions.append(
      fixedIn, note,
      el("button", { class: "btn btn--fix", onclick: () => act(r.id, "fixed", { fixedIn: fixedIn.value, note: note.value }, c) }, "Fixed"),
      el("button", { class: "btn", onclick: () => act(r.id, "wontfix", { note: note.value }, c) }, "Won't fix"),
    );
  }
  actions.append(el("span", { class: "spacer" }), el("button", {
    class: "btn btn--danger",
    title: "Delete it outright: for spam. Otherwise close it, to keep the history.",
    onclick: () => confirm("Delete this report for good? Use this for spam; otherwise close it.") && act(r.id, "remove", {}, c),
  }, "Remove"));
  c.append(actions);
  return c;
}

function render() {
  const all = state.data.reports;
  const open = all.filter((r) => !r.status), closed = all.filter((r) => r.status);
  document.querySelector('[data-tab="open"]').textContent = "Open (" + open.length + ")";
  document.querySelector('[data-tab="closed"]').textContent = "Closed (" + closed.length + ")";
  const shown = (state.tab === "open" ? open : closed).filter((r) => state.kind === "all" || r.kind === state.kind);
  list.replaceChildren(...(shown.length ? shown.map(card) : [el("p", { class: "status" }, "Nothing here.")]));
}

function pick(groupId, key, attr) {
  document.getElementById(groupId).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state[key] = b.dataset[attr];
    for (const x of e.currentTarget.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
    if (state.data) render();
  });
}
pick("tabs", "tab", "tab");
pick("kinds", "kind", "kind");
document.getElementById("refresh").addEventListener("click", load);
load();
</script>
</body>
</html>
`;
