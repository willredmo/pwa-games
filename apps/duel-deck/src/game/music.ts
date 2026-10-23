// Background music: a loop for the menus, one for planning (pick / upgrade /
// waiting) and one for battles, crossfading on every change. Unlike the effects these are
// recorded tracks (src/assets/music, precached by the service worker), but
// they play through the same AudioContext, so they unlock with `unlockSound`
// and go quiet with Sound off as well as with Music off.
//
// All three files were levelled to the same loudness (about -20 LUFS) when they
// were added, so MUSIC_VOLUME is the only knob: it sets music against the
// effects, and neither track jumps out over the other.
//
// Music bypasses the effects' compressor and reverb (it's already mixed), so
// a loud clash doesn't pump the music down.

import { audioContext, onSoundChange, soundEnabled } from "./sound";
import planUrl from "../assets/music/plan.mp3";
import battleUrl from "../assets/music/battle.mp3";
import menuUrl from "../assets/music/menu.mp3";

export type Track = "menu" | "plan" | "battle";

const URLS: Record<Track, string> = { menu: menuUrl, plan: planUrl, battle: battleUrl };
/** The track to have decoded before leaving this one. */
const NEXT: Record<Track, Track> = { menu: "plan", plan: "battle", battle: "plan" };
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
/**
 * Every track still sounding, the current one and any fading out. A switch
 * fades all of them, not just `playing`, so nothing can be left running that
 * this module has lost track of.
 */
const live = new Set<Playing>();
let timer: ReturnType<typeof setInterval> | null = null;
/** Set when the dev server swaps this module out (see the end of the file). */
let disposed = false;

export function setMusicEnabled(on: boolean): void {
  musicOn = on;
  update();
}

/** What's on screen as a track: the menus, or the match's phase; null for none (result screen). */
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
  if (disposed) return;
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
  for (const p of live) {
    fadeOut(ac, p);
    // The menu track is heard once a session or so: don't keep ~25 MB of
    // decoded audio for it through a match. It decodes again on the way back.
    if (p.track === "menu" && target !== "menu") buffers.delete("menu");
  }
  live.clear();
  playing = null;
  if (!target) return;
  void load(ac, target).then((buffer) => {
    // Still the one wanted, and nothing started while it decoded?
    if (disposed || !buffer || playing || (audible() ? wanted : null) !== target) return;
    playing = start(ac, target, buffer);
    live.add(playing);
  });
  // Have the next track decoded before the screen changes to it.
  void load(ac, NEXT[target]);
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

// Running locally, Vite re-runs this module when it (or a file it imports)
// changes, without reloading the page. The old copy would keep its track
// playing, stay subscribed to sound changes with its last track (the menu's)
// and start it again on the next tap, under whatever the new copy plays: the
// menu music carried on into a match. `hot.dispose` doesn't help (Vite only
// calls it on the module that accepts the update, App or Game here), so each
// copy registers a stop on the page and the next copy calls it as it loads,
// taking over what the screen wants. Dev only: `import.meta.hot` is absent in
// a build, where this module runs once.
if (import.meta.hot) {
  const page = globalThis as { __duelDeckMusic?: () => { wanted: Track | null; musicOn: boolean } };
  const prev = page.__duelDeckMusic?.();
  page.__duelDeckMusic = () => {
    disposed = true;
    const ac = audioContext();
    if (ac) for (const p of live) fadeOut(ac, p);
    live.clear();
    playing = null;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", update);
    return { wanted, musicOn };
  };
  if (prev) {
    wanted = prev.wanted;
    musicOn = prev.musicOn;
    update();
  }
}
