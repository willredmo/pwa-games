import type { SurfaceKind } from "../physics/table";

// Tiny synthesized sounds: a wooden clack for hits, a buzzer for goals. No
// audio files. Browsers only allow sound after a tap, so `unlock` is called
// from the first pointer press.

let ctx: AudioContext | null = null;
let enabled = true;
let noise: AudioBuffer | null = null;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function unlockSound(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  } catch {
    ctx = null;
  }
}

const PITCH: Record<SurfaceKind | "stick", number> = { stick: 1100, rail: 520, wedge: 600, block: 760, post: 1400 };

/** A knock of wood on wood. `strength` is 0–1. */
export function clack(kind: SurfaceKind | "stick", strength: number): void {
  if (!enabled || !ctx || !noise || strength < 0.03) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = PITCH[kind];
  filter.Q.value = 6;
  const gain = ctx.createGain();
  gain.gain.value = Math.min(1, 0.15 + strength) * 0.9;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
}

/** Goal horn: two short tones. `good` = you scored. */
export function horn(good: boolean): void {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime;
  const notes = good ? [440, 660] : [330, 247];
  notes.forEach((f, i) => {
    const o = ctx!.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0, t + i * 0.16);
    g.gain.linearRampToValueAtTime(0.08, t + i * 0.16 + 0.02);
    g.gain.linearRampToValueAtTime(0, t + i * 0.16 + 0.22);
    o.connect(g).connect(ctx!.destination);
    o.start(t + i * 0.16);
    o.stop(t + i * 0.16 + 0.25);
  });
}
