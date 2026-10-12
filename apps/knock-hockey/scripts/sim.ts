// Headless checks and CPU tuning for Knock Hockey.
// Usage: pnpm sim <mode> [options]
//   fuzz [n=20000]          random shots from random spots: the puck never leaves
//                           the board, never rests inside a block, always settles
//   corner                  the signature shot exists: from spots along each side
//                           rail, a shot up into the corner wedge goes behind the
//                           diamond and scores
//   rates [n=300]           how often each CPU level scores per shot, from random spots
//   feel [boards=20]        how much each match's board character changes play:
//                           physics safety, the corner shot, CPU scoring, and how
//                           far shots end up from where a true board sends them
//   --corners=45            fuzz, corner and rates on the 45°-corner board
//   match [n=40] --a=hard --b=medium [--to=10]
//                           CPU vs CPU matches; reports a's win rate (sides and the
//                           first shot alternate)
import { simulateShot, escapes, quickShot, wobble } from "../src/physics/sim";
import { makeBoard } from "../src/physics/board";
import { CENTER, H, PUCK_R, W, insideSolid, layoutFor, type Corners, type Vec } from "../src/physics/table";
import { chooseShot, mulberry, randomSpot, type Difficulty } from "../src/ai/cpu";

const args = process.argv.slice(2);
const mode = args[0] ?? "fuzz";
const num = (i: number, d: number) => (args[i] && !args[i].startsWith("--") ? Number(args[i]) : d);
const flag = (name: string, d: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? d;
/** Scale of the per-hit wobble (1 = the game's, 0 = off). */
const WOB = Number(flag("wobble", "1"));
/** Which corners to test (`--corners=45`); standard steep by default. */
const CORNERS = flag("corners", "steep") as Corners;
const LAYOUT = layoutFor(CORNERS);

if (mode === "fuzz") {
  const n = num(1, 20000);
  const rng = mulberry(7);
  let goals = 0;
  let inside = 0;
  let maxSteps = 0;
  let unsettled = 0;
  for (let i = 0; i < n; i++) {
    const at = randomSpot(rng, LAYOUT);
    const r = simulateShot(at, { angle: rng() * Math.PI * 2, power: rng() }, null, LAYOUT);
    maxSteps = Math.max(maxSteps, r.steps);
    if (r.goal) goals++;
    else {
      if (insideSolid(r.rest, PUCK_R - 1.5, LAYOUT)) inside++;
      if (r.steps >= 240 * 12) unsettled++;
    }
  }
  console.log(`${n} shots: ${goals} goals (${((goals / n) * 100).toFixed(1)}%), longest ${(maxSteps / 240).toFixed(2)} s`);
  console.log(`escapes ${escapes}, resting inside a block/wedge ${inside}, never settled ${unsettled}`);
  if (escapes || inside || unsettled) process.exitCode = 1;
}

if (mode === "corner") {
  // Puck against the left/right side rail, Player 1 shooting up at the top goal.
  let ok = 0;
  let total = 0;
  for (const side of ["left", "right"] as const) {
    for (let y = 90; y <= H - 150; y += 20) {
      const at: Vec = { x: side === "left" ? PUCK_R + 2 : W - PUCK_R - 2, y };
      let hits = 0;
      let best = "";
      for (let a = -100; a <= -80; a += 0.25) {
        for (let pw = 0.2; pw <= 1.0001; pw += 0.05) {
          const r = simulateShot(at, { angle: (a * Math.PI) / 180, power: pw }, null, LAYOUT);
          if (r.goal === "top" && r.contacts[0]?.kind === "wedge" && !r.contacts.some((c) => c.kind === "block")) {
            hits++;
            if (!best) best = `${a.toFixed(2)}° @${pw.toFixed(2)}`;
          }
        }
      }
      total++;
      if (hits) ok++;
      console.log(`${side.padEnd(5)} y=${String(y).padStart(3)}: ${hits ? `${String(hits).padStart(3)} scoring shots, e.g. ${best}` : "—"}`);
    }
  }
  console.log(`corner shot works from ${ok}/${total} side spots`);
  if (ok < total * 0.6) process.exitCode = 1;
}

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];

if (mode === "rates") {
  const n = num(1, 300);
  for (const d of DIFFS) {
    const rng = mulberry(11);
    let goals = 0;
    let own = 0;
    let ms = 0;
    for (let i = 0; i < n; i++) {
      const at = randomSpot(rng, LAYOUT);
      const t0 = performance.now();
      const shot = chooseShot(at, { difficulty: d, attacksTop: true, corners: CORNERS, rng });
      ms += performance.now() - t0;
      const r = quickShot(at, wobble(shot, rng, WOB), null, LAYOUT);
      if (r.goal === "top") goals++;
      if (r.goal === "bottom") own++;
    }
    console.log(
      `${d.padEnd(6)} scores ${((goals / n) * 100).toFixed(1)}% of shots, own goals ${((own / n) * 100).toFixed(1)}%, ${(ms / n).toFixed(0)} ms/shot`,
    );
  }
}

if (mode === "match") {
  const n = num(1, 40);
  const a = flag("a", "hard") as Difficulty;
  const b = flag("b", "medium") as Difficulty;
  const to = Number(flag("to", "10"));
  const rng = mulberry(3);
  let aWins = 0;
  let shots = 0;
  for (let m = 0; m < n; m++) {
    // a plays the bottom (attacks top) in even matches; who shoots first alternates.
    const aTop = m % 2 === 0;
    let turnA = Math.floor(m / 2) % 2 === 0;
    let puck: Vec = { ...CENTER };
    let sa = 0;
    let sb = 0;
    // First to `to`, win by 2.
    const won = (x: number, y: number) => x >= to && x - y >= 2;
    while (!won(sa, sb) && !won(sb, sa)) {
      const diff = turnA ? a : b;
      const attacksTop = turnA ? aTop : !aTop;
      const shot = chooseShot(puck, { difficulty: diff, attacksTop, rng });
      const r = quickShot(puck, wobble(shot, rng, WOB));
      shots++;
      if (r.goal) {
        const aScored = (r.goal === "top") === aTop;
        if (aScored) sa++;
        else sb++;
        puck = { ...CENTER };
        turnA = !aScored; // scored-on side restarts
      } else {
        puck = { x: r.x, y: r.y };
        turnA = !turnA;
      }
    }
    if (sa > sb) aWins++;
    process.stdout.write(`${sa}-${sb} `);
  }
  console.log(`\n${a} beats ${b} ${((aWins / n) * 100).toFixed(0)}% of ${n} matches (${(shots / n).toFixed(0)} shots/match)`);
}


if (mode === "wobble") {
  // How often a perfectly aimed corner shot still scores once the hit wobbles.
  // For each side spot, take the corner shot in the middle of its widest
  // scoring window (what a careful player would aim for) and hit it 300 times.
  const rng = mulberry(5);
  let sum = 0;
  let spots = 0;
  for (const side of ["left", "right"] as const) {
    for (let y = 90; y <= H - 150; y += 40) {
      const at: Vec = { x: side === "left" ? PUCK_R + 2 : W - PUCK_R - 2, y };
      let best: { a: number; p: number; run: number } | null = null;
      for (let pw = 0.3; pw <= 1.0001; pw += 0.1) {
        let run = 0;
        for (let a = -96; a <= -84; a += 0.05) {
          const r = simulateShot(at, { angle: (a * Math.PI) / 180, power: pw });
          if (r.goal === "top") {
            run++;
            if (!best || run > best.run) best = { a: a - (run * 0.05) / 2, p: pw, run };
          } else run = 0;
        }
      }
      if (!best) continue;
      let ok = 0;
      for (let i = 0; i < 300; i++) {
        const shot = wobble({ angle: (best.a * Math.PI) / 180, power: best.p }, rng, WOB);
        if (quickShot(at, shot).goal === "top") ok++;
      }
      sum += ok / 300;
      spots++;
      console.log(`${side.padEnd(5)} y=${String(y).padStart(3)}: window ${(best.run * 0.05).toFixed(2)}°, scores ${((ok / 3) | 0)}%`);
    }
  }
  console.log(`perfectly aimed corner shot scores ${((sum / spots) * 100).toFixed(0)}% on average (wobble ×${WOB})`);
}

if (mode === "feel") {
  const boards = Array.from({ length: num(1, 20) }, (_, i) => makeBoard(1000 + i * 7919));
  const rng = mulberry(9);
  const esc0 = escapes;

  // 1. Safety on varied boards.
  let inside = 0;
  let unsettled = 0;
  for (const b of boards) {
    for (let i = 0; i < 2000; i++) {
      const r = simulateShot(randomSpot(rng), { angle: rng() * Math.PI * 2, power: rng() }, b);
      if (!r.goal && insideSolid(r.rest, PUCK_R - 1.5)) inside++;
      if (r.steps >= 240 * 12) unsettled++;
    }
  }
  console.log(`safety: escapes ${escapes - esc0}, resting inside ${inside}, never settled ${unsettled}`);

  // 2. How far a shot ends up from where a true board sends it.
  let sum = 0;
  let n = 0;
  let sameGoal = 0;
  let goals = 0;
  for (let i = 0; i < 1500; i++) {
    const at = randomSpot(rng);
    const shot = { angle: rng() * Math.PI * 2, power: 0.2 + rng() * 0.8 };
    const t = simulateShot(at, shot);
    const v = simulateShot(at, shot, boards[i % boards.length]);
    if (t.goal || v.goal) {
      goals++;
      if (t.goal === v.goal) sameGoal++;
      continue;
    }
    sum += Math.hypot(t.rest.x - v.rest.x, t.rest.y - v.rest.y);
    n++;
  }
  console.log(`resting spot moves ${(sum / n).toFixed(1)} units on average (board is 300 × 600); ${((sameGoal / goals) * 100).toFixed(0)}% of goals on a true board are still goals`);

  // 3. The corner shot, aimed perfectly for a true board, with the usual wobble.
  let trueOk = 0;
  let feelOk = 0;
  let tries = 0;
  for (const side of ["left", "right"] as const) {
    for (let y = 90; y <= H - 150; y += 60) {
      const at: Vec = { x: side === "left" ? PUCK_R + 2 : W - PUCK_R - 2, y };
      let best: { a: number; p: number; run: number } | null = null;
      for (let pw = 0.3; pw <= 1.0001; pw += 0.1) {
        let run = 0;
        for (let a = -96; a <= -84; a += 0.05) {
          if (simulateShot(at, { angle: (a * Math.PI) / 180, power: pw }).goal === "top") {
            run++;
            if (!best || run > best.run) best = { a: a - (run * 0.05) / 2, p: pw, run };
          } else run = 0;
        }
      }
      if (!best) continue;
      for (let i = 0; i < 60; i++) {
        const shot = wobble({ angle: (best.a * Math.PI) / 180, power: best.p }, rng);
        tries++;
        if (quickShot(at, shot).goal === "top") trueOk++;
        if (quickShot(at, shot, boards[i % boards.length]).goal === "top") feelOk++;
      }
    }
  }
  console.log(`corner shot (perfect aim + wobble): ${((trueOk / tries) * 100).toFixed(0)}% on a true board, ${((feelOk / tries) * 100).toFixed(0)}% on varied boards`);

  // 4. The CPU, planning on the board it's playing.
  for (const d of DIFFS) {
    let a = 0;
    let b = 0;
    const k = 150;
    const r1 = mulberry(31);
    const r2 = mulberry(31);
    for (let i = 0; i < k; i++) {
      const at = randomSpot(r1);
      randomSpot(r2);
      const seed = 1000 + (i % boards.length) * 7919;
      if (quickShot(at, wobble(chooseShot(at, { difficulty: d, attacksTop: true, rng: r1 }), r1)).goal === "top") a++;
      if (quickShot(at, wobble(chooseShot(at, { difficulty: d, attacksTop: true, boardSeed: seed, rng: r2 }), r2), boards[i % boards.length]).goal === "top") b++;
    }
    console.log(`${d.padEnd(6)} scores ${((a / k) * 100).toFixed(0)}% on a true board, ${((b / k) * 100).toFixed(0)}% on varied boards`);
  }
}
