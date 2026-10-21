// Background music: one loop for planning (pick / upgrade / waiting) and one
// for battles, crossfading on the phase change. Unlike the effects these are
// recorded tracks (src/assets/music, precached by the service worker), but
// they play through the same AudioContext, so they unlock with `unlockSound`
// and go quiet with Sound off as well as with Music off.
//
// Both files were levelled to the same loudness (about -20 LUFS) when they
// were added, so MUSIC_VOLUME is the only knob: it sets music against the
// effects, and neither track jumps out over the other.
//
// Music bypasses the effects' compressor and reverb (it's already mixed), so
// a loud clash doesn't pump the music down.

import { audioContext, onSoundChange, soundEnabled } from "./sound";
import planUrl from "../assets/music/plan.mp3";
import battleUrl from "../assets/music/battle.mp3";

export type Track = "plan" | "battle";

const URLS: Record<Track, string> = { plan: planUrl, battle: battleUrl };
/** Music against the effects: well under them, so hits and banners still read. */
const MUSIC_VOLUME = 0.3;
/** Seconds of crossfade when the phase changes. */
const FADE = 1.2;
/**
 * Seconds each pass of a loop overlaps the next. Neither track was written to
 * loop sample-exactly, so the wrap is a short crossfade rather than a cut.
 */
const SEAM = 1.5;
/** How far ahead the next pass is scheduled, and how often that's checked. */
const LOOKAHEAD = 3;
const TICK_MS = 500;

let musicOn = true;
/** What the game is showing: the track to play when music is audible. */
let wanted: Track | null = null;
/** Every sound-side music node goes through here: the music level and mute. */
let bus: GainNode | null = null;
const buffers = new Map<Track, Promise<AudioBuffer | null>>();

interface Playing {
  track: Track;
  /** The phase crossfade for this track. */
  gain: GainNode;
  buffer: AudioBuffer;
  sources: Set<AudioBufferSourceNode>;
  /** When the next pass of the loop starts. */
  nextAt: number;
}
let playing: Playing | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function setMusicEnabled(on: boolean): void {
  musicOn = on;
  update();
}

/** The game's current phase as a track, or null for none (title, result screen). */
export function setMusic(track: Track | null): void {
  wanted = track;
  update();
}

onSoundChange(update);
if (typeof document !== "undefined") document.addEventListener("visibilitychange", update);

function audible(): boolean {
  return musicOn && soundEnabled() && !(typeof document !== "undefined" && document.hidden);
}

/** Decode a track once; a failed fetch is forgotten, so it's retried next time. */
function load(ac: AudioContext, track: Track): Promise<AudioBuffer | null> {
  let p = buffers.get(track);
  if (!p) {
    p = fetch(URLS[track])
      .then((r) => r.arrayBuffer())
      .then((b) => ac.decodeAudioData(b))
      .catch(() => {
        buffers.delete(track);
        return null;
      });
    buffers.set(track, p);
  }
  return p;
}

function update(): void {
  const ac = audioContext();
  if (!ac) return; // not unlocked yet: `unlockSound` calls back here
  if (!bus) {
    bus = ac.createGain();
    bus.gain.value = 0;
    bus.connect(ac.destination);
  }
  bus.gain.setTargetAtTime(audible() ? MUSIC_VOLUME : 0, ac.currentTime, 0.15);
  // Muted or hidden stops the track outright rather than playing it silently,
  // so a backgrounded install isn't decoding music nobody hears.
  const target = audible() ? wanted : null;
  if (playing?.track === target) return;
  if (playing) fadeOut(ac, playing);
  playing = null;
  if (!target) return;
  void load(ac, target).then((buffer) => {
    // Still the one wanted, and nothing started while it decoded?
    if (!buffer || playing || (audible() ? wanted : null) !== target) return;
    playing = start(ac, target, buffer);
  });
  // Have the other track decoded before the phase changes to it.
  void load(ac, target === "plan" ? "battle" : "plan");
}

function start(ac: AudioContext, track: Track, buffer: AudioBuffer): Playing {
  const gain = ac.createGain();
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + FADE);
  gain.connect(bus!);
  const p: Playing = { track, gain, buffer, sources: new Set(), nextAt: now };
  pass(ac, p, false);
  timer ??= setInterval(tick, TICK_MS);
  return p;
}

/** Schedule one pass of the loop at `p.nextAt`, fading over the seams. */
function pass(ac: AudioContext, p: Playing, fadeIn: boolean): void {
  const at = p.nextAt;
  const dur = p.buffer.duration;
  const src = ac.createBufferSource();
  src.buffer = p.buffer;
  const g = ac.createGain();
  g.gain.setValueAtTime(fadeIn ? 0 : 1, at);
  if (fadeIn) g.gain.linearRampToValueAtTime(1, at + SEAM);
  g.gain.setValueAtTime(1, at + dur - SEAM);
  g.gain.linearRampToValueAtTime(0, at + dur);
  src.connect(g).connect(p.gain);
  src.onended = () => p.sources.delete(src);
  p.sources.add(src);
  src.start(at);
  src.stop(at + dur);
  p.nextAt = at + dur - SEAM;
}

function tick(): void {
  const ac = audioContext();
  if (!ac || !playing) {
    if (timer) clearInterval(timer);
    timer = null;
    return;
  }
  if (ac.currentTime > playing.nextAt - LOOKAHEAD) pass(ac, playing, true);
}

function fadeOut(ac: AudioContext, p: Playing): void {
  const now = ac.currentTime;
  p.gain.gain.cancelScheduledValues(now);
  p.gain.gain.setValueAtTime(p.gain.gain.value, now);
  p.gain.gain.linearRampToValueAtTime(0, now + FADE);
  for (const src of p.sources) src.stop(now + FADE + 0.05);
}
