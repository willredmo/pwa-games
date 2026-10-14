// Synthesized sound. No audio files: every effect is built from oscillators
// and a noise buffer, like knock-hockey's, which keeps the install small and
// means an effect is tuned by editing numbers rather than re-recording.
//
// Browsers only allow audio to start from a gesture, so `unlockSound` is
// called from the first real click (pressing Play, or turning sound on).
//
// Call sites name the *event*, not the waveform — `sfx("death")`, not "play a
// descending saw" — so the palette can be retuned, or swapped for samples,
// without touching the battle playback.

export type Sfx =
  | "hit"          // a blow lands
  | "big-hit"      // a blow of BIG_HIT or more
  | "death"        // a unit falls
  | "dodge"        // Evasion
  | "block"        // damage reduction / armour
  | "heal"         // Medic, lifesteal
  | "ability"      // a named ability fires
  | "buff"         // a unit's stats go up
  | "place"        // a unit is put on the row
  | "merge"        // two units become one
  | "knight"       // a Squire is knighted
  | "pick"         // UI: card picked up
  | "upgrade"      // an augment is taken
  | "round-win"
  | "round-loss"
  | "victory"
  | "defeat"
  | "explode"      // the losing row blows up
  | "emote";       // the opponent sent an emote

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let noise: AudioBuffer | null = null;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (master && ctx) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.01);
}

export function unlockSound(): void {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(ctx.destination);
    // A short decaying noise burst, reused for every percussive sound.
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  } catch {
    ctx = null; // no Web Audio (or blocked) — the game is silent, nothing else
  }
}

/** A filtered burst of the noise buffer: impacts, clangs, whooshes. */
function burst(opts: {
  freq: number;
  q: number;
  gain: number;
  decay: number;
  type?: BiquadFilterType;
  at?: number;
  /** Sweep the filter to this frequency over the burst (whooshes, poofs). */
  to?: number;
}): void {
  if (!ctx || !master || !noise) return;
  const t = (opts.at ?? 0) + ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? "bandpass";
  filter.frequency.setValueAtTime(opts.freq, t);
  if (opts.to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + opts.decay);
  filter.Q.value = opts.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + opts.decay + 0.02);
}

/** A pitched tone. `to` bends the pitch over the note's life. */
function tone(opts: {
  freq: number;
  to?: number;
  gain: number;
  dur: number;
  type?: OscillatorType;
  at?: number;
}): void {
  if (!ctx || !master) return;
  const t = (opts.at ?? 0) + ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = opts.type ?? "triangle";
  o.frequency.setValueAtTime(opts.freq, t);
  if (opts.to !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + opts.dur);
  const g = ctx.createGain();
  // A tiny attack, so a square/saw doesn't click on its first sample.
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(opts.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + opts.dur + 0.02);
}

/** Play a sequence of notes as one phrase. */
function phrase(notes: { freq: number; at: number; dur?: number; gain?: number; type?: OscillatorType }[]): void {
  for (const n of notes) {
    tone({ freq: n.freq, gain: n.gain ?? 0.09, dur: n.dur ?? 0.18, type: n.type ?? "triangle", at: n.at });
  }
}

/**
 * A struck bell: a sine with an inharmonic partial (×2.76, like a real bell's
 * first overtone) and a long ring. Reads as a clear "ding" over battle noise.
 */
function bell(freq: number, at: number, gain = 0.1, dur = 0.7): void {
  tone({ freq, gain, dur, type: "sine", at });
  tone({ freq: freq * 2.76, gain: gain * 0.35, dur: dur * 0.5, type: "sine", at });
  tone({ freq: freq * 2, gain: gain * 0.25, dur: dur * 0.7, type: "triangle", at });
}

/**
 * Candidate versions of sounds under review, auditioned on the dev soundboard
 * (?sounds). `sfx` plays the one in CHOSEN; once one is picked for good the
 * others can go.
 */
const DEATH: Record<string, () => void> = {
  // A cartoon vanish: a puff of air sweeping down and a soft thump. Suits the
  // round, cute characters better than a groan.
  poof: () => {
    burst({ freq: 2200, to: 260, q: 1.1, gain: 0.28, decay: 0.32 });
    tone({ freq: 520, to: 180, gain: 0.08, dur: 0.22, type: "sine" });
    burst({ freq: 140, q: 0.7, gain: 0.22, decay: 0.18, type: "lowpass", at: 0.05 });
  },
  // Knocked over: a springy downward "boing" and a bump on the floor.
  bonk: () => {
    tone({ freq: 700, to: 160, gain: 0.12, dur: 0.28, type: "triangle" });
    tone({ freq: 1050, to: 240, gain: 0.04, dur: 0.2, type: "square" });
    burst({ freq: 120, q: 0.8, gain: 0.26, decay: 0.16, type: "lowpass", at: 0.12 });
  },
  // Shattering into shards, like the death effect looks: a glassy crack and
  // falling tinkles.
  shatter: () => {
    burst({ freq: 4200, q: 2, gain: 0.2, decay: 0.12, type: "bandpass" });
    for (let i = 0; i < 4; i++) tone({ freq: 2400 - i * 330, gain: 0.045, dur: 0.12, type: "sine", at: 0.04 + i * 0.05 });
    burst({ freq: 160, q: 0.7, gain: 0.16, decay: 0.14, type: "lowpass", at: 0.02 });
  },
  // The original: a falling sawtooth groan over a thud.
  original: () => {
    tone({ freq: 300, to: 70, gain: 0.13, dur: 0.42, type: "sawtooth" });
    burst({ freq: 100, q: 0.6, gain: 0.22, decay: 0.3, type: "lowpass", at: 0.1 });
  },
};

const ROUND_WIN: Record<string, () => void> = {
  // A short brass-like fanfare: a rising triad landing on a held octave.
  fanfare: () => {
    phrase([
      { freq: 523, at: 0, dur: 0.12, gain: 0.07, type: "square" },
      { freq: 659, at: 0.09, dur: 0.12, gain: 0.07, type: "square" },
      { freq: 784, at: 0.18, dur: 0.12, gain: 0.07, type: "square" },
      { freq: 1047, at: 0.27, dur: 0.38, gain: 0.08, type: "square" },
    ]);
    tone({ freq: 1047, gain: 0.06, dur: 0.45, type: "triangle", at: 0.27 });
  },
  // Two bell strikes, a fifth apart, ringing out.
  chime: () => {
    bell(784, 0, 0.11, 0.6);
    bell(1175, 0.13, 0.12, 0.9);
  },
  // A coin-collect "ka-ching" and a sparkle of noise.
  coins: () => {
    tone({ freq: 988, gain: 0.08, dur: 0.08, type: "square" });
    tone({ freq: 1319, gain: 0.08, dur: 0.35, type: "square", at: 0.08 });
    burst({ freq: 6000, q: 0.8, gain: 0.07, decay: 0.3, type: "highpass", at: 0.08 });
  },
  // The original: two triangle notes, too close to the other cues to stand out.
  original: () => {
    phrase([
      { freq: 523, at: 0, dur: 0.16, gain: 0.07 },
      { freq: 784, at: 0.1, dur: 0.28, gain: 0.08 },
    ]);
  },
};

export const SFX_VARIANTS = { death: DEATH, "round-win": ROUND_WIN } as const;
export type VariantKind = keyof typeof SFX_VARIANTS;
const CHOSEN: Record<VariantKind, string> = { death: "poof", "round-win": "chime" };

/** The version `sfx` plays for a sound under review. */
export const chosenVariant = (kind: VariantKind) => CHOSEN[kind];
/** Switch which version `sfx` plays (the soundboard; for this page load only). */
export function chooseVariant(kind: VariantKind, name: string): void {
  if (SFX_VARIANTS[kind][name]) CHOSEN[kind] = name;
}
/** Play one specific version, for comparing on the soundboard. */
export function playVariant(kind: VariantKind, name: string): void {
  if (!enabled || !ctx) return;
  SFX_VARIANTS[kind][name]?.();
}

/**
 * Play an event. `strength` (0–1, default 0.5) scales the ones that have a
 * sense of size — a 2-damage poke and a 20-damage execution are the same
 * event but shouldn't be the same sound.
 */
export function sfx(kind: Sfx, strength = 0.5): void {
  if (!enabled || !ctx) return;
  const s = Math.max(0, Math.min(1, strength));
  switch (kind) {
    case "hit":
      // Sword on shield: a bright metallic tick over a dull body thud.
      burst({ freq: 2400 + 900 * s, q: 1.4, gain: 0.1 + 0.12 * s, decay: 0.07 });
      burst({ freq: 180, q: 0.8, gain: 0.1 + 0.14 * s, decay: 0.1, type: "lowpass" });
      break;
    case "big-hit":
      burst({ freq: 1800, q: 1, gain: 0.26, decay: 0.16 });
      burst({ freq: 120, q: 0.7, gain: 0.3, decay: 0.22, type: "lowpass" });
      tone({ freq: 160, to: 70, gain: 0.14, dur: 0.22, type: "sawtooth" });
      break;
    case "death":
      DEATH[CHOSEN.death]();
      break;
    case "dodge":
      // A whoosh of air: noise swept high, nothing pitched.
      burst({ freq: 3200, q: 0.6, gain: 0.1, decay: 0.16, type: "highpass" });
      break;
    case "block":
      burst({ freq: 900, q: 3, gain: 0.16, decay: 0.12 });
      break;
    case "heal":
      phrase([
        { freq: 660, at: 0, dur: 0.14, gain: 0.06 },
        { freq: 880, at: 0.07, dur: 0.2, gain: 0.07 },
      ]);
      break;
    case "ability":
      // A shimmer: two close tones beating against each other.
      tone({ freq: 740, to: 1180, gain: 0.07, dur: 0.26 });
      tone({ freq: 1115, gain: 0.04, dur: 0.26, at: 0.04 });
      break;
    case "buff":
      tone({ freq: 440, to: 880, gain: 0.07, dur: 0.22 });
      break;
    case "place":
      // A wooden 'tok' as the unit lands: a low knock plus a short pitched click.
      // (A bare lowpass puff at 0.12 was too quiet to hear over music or a room.)
      burst({ freq: 380, q: 1.4, gain: 0.34, decay: 0.12, type: "lowpass" });
      tone({ freq: 240, to: 150, gain: 0.14, dur: 0.09, type: "triangle" });
      burst({ freq: 2600, q: 2, gain: 0.08, decay: 0.03 });
      break;
    case "merge":
      // Two notes resolving into one, an octave up.
      phrase([
        { freq: 392, at: 0, dur: 0.16, gain: 0.07 },
        { freq: 523, at: 0.08, dur: 0.16, gain: 0.07 },
        { freq: 784, at: 0.16, dur: 0.26, gain: 0.08 },
      ]);
      break;
    case "knight":
      phrase([
        { freq: 523, at: 0, dur: 0.16, gain: 0.08, type: "square" },
        { freq: 659, at: 0.1, dur: 0.16, gain: 0.08, type: "square" },
        { freq: 784, at: 0.2, dur: 0.16, gain: 0.08, type: "square" },
        { freq: 1047, at: 0.3, dur: 0.44, gain: 0.09, type: "square" },
      ]);
      break;
    case "pick":
      tone({ freq: 620, gain: 0.05, dur: 0.07 });
      break;
    case "upgrade":
      phrase([
        { freq: 587, at: 0, dur: 0.18, gain: 0.07 },
        { freq: 880, at: 0.1, dur: 0.3, gain: 0.08 },
      ]);
      break;
    case "round-win":
      ROUND_WIN[CHOSEN["round-win"]]();
      break;
    case "round-loss":
      phrase([
        { freq: 392, at: 0, dur: 0.18, gain: 0.07 },
        { freq: 262, at: 0.11, dur: 0.32, gain: 0.07 },
      ]);
      break;
    case "victory":
      phrase([
        { freq: 523, at: 0, dur: 0.2, gain: 0.08 },
        { freq: 659, at: 0.14, dur: 0.2, gain: 0.08 },
        { freq: 784, at: 0.28, dur: 0.2, gain: 0.08 },
        { freq: 1047, at: 0.42, dur: 0.6, gain: 0.1 },
      ]);
      break;
    case "emote":
      // A soft pop: quiet, so it never talks over the battle.
      tone({ freq: 880, to: 1320, gain: 0.05, dur: 0.09, type: "sine" });
      break;
    case "explode":
      // A crack, a long low rumble and a falling thump: the noise buffer is
      // only 0.25s, so the rumble is a few overlapping lowpassed bursts.
      burst({ freq: 2600, q: 0.5, gain: 0.3, decay: 0.12, type: "highpass" });
      tone({ freq: 110, to: 32, gain: 0.32, dur: 0.9, type: "sine" });
      tone({ freq: 70, to: 28, gain: 0.18, dur: 1.1, type: "triangle", at: 0.05 });
      for (let i = 0; i < 5; i++) burst({ freq: 260 - i * 30, q: 0.6, gain: 0.32 - i * 0.05, decay: 0.3, type: "lowpass", at: i * 0.12 });
      break;
    case "defeat":
      phrase([
        { freq: 440, at: 0, dur: 0.26, gain: 0.08 },
        { freq: 349, at: 0.2, dur: 0.26, gain: 0.08 },
        { freq: 262, at: 0.4, dur: 0.7, gain: 0.08 },
      ]);
      break;
  }
}
