import { chooseShot, type ChooseOptions } from "./cpu";
import type { Vec } from "../physics/table";

// Runs the CPU's search off the main thread, so the board keeps animating
// while Hard thinks (it simulates a few thousand shots).

export interface ThinkRequest {
  id: number;
  at: Vec;
  opts: Omit<ChooseOptions, "rng">;
}

self.onmessage = (e: MessageEvent<ThinkRequest>) => {
  const { id, at, opts } = e.data;
  self.postMessage({ id, shot: chooseShot(at, opts) });
};
