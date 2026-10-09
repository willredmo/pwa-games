import { chooseShot, type ChooseOptions } from "./cpu";
import type { Shot } from "../physics/sim";
import type { Vec } from "../physics/table";
import type { ThinkRequest } from "./worker";

// Asks the worker for the CPU's shot. Falls back to the main thread if
// workers aren't available.

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (s: Shot) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; shot: Shot }>) => {
      pending.get(e.data.id)?.(e.data.shot);
      pending.delete(e.data.id);
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function thinkShot(at: Vec, opts: Omit<ChooseOptions, "rng">): Promise<Shot> {
  const w = getWorker();
  if (!w) return Promise.resolve(chooseShot(at, opts));
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, at, opts } satisfies ThinkRequest);
  });
}
