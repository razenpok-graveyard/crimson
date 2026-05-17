// Port of grim/music.py

import type { rl } from '@grim/raylib-api.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { CrandLike } from '@grim/rand.ts';
import { existsSync, statSync } from 'node:fs';
import * as wgl from '@wgl';
import * as paq from '@grim/paq.ts';

export const MUSIC_PAK_NAME = 'music.paq';
export const MUSIC_TRACKS: Map<string, readonly string[]> = new Map([
  ['intro', ['music/intro.ogg', 'intro.ogg']],
  ['shortie_monk', ['music/shortie_monk.ogg', 'shortie_monk.ogg']],
  ['crimson_theme', ['music/crimson_theme.ogg', 'crimson_theme.ogg']],
  ['crimsonquest', ['music/crimsonquest.ogg', 'crimsonquest.ogg']],
  ['gt1_ingame', ['music/gt1_ingame.ogg', 'gt1_ingame.ogg']],
  ['gt2_harppen', ['music/gt2_harppen.ogg', 'gt2_harppen.ogg']],
]);

function pythonStartsWith(value: string | Uint8Array, prefix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(prefix)) {
    return prefix.some((item) => pythonStartsWith(value, item));
  }
  if (typeof value === 'string' && typeof prefix === 'string') {
    return value.startsWith(prefix);
  }
  if (typeof value === 'string' || typeof prefix === 'string') {
    return false;
  }
  return value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);
}

function pythonEndsWith(value: string | Uint8Array, suffix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(suffix)) {
    return suffix.some((item) => pythonEndsWith(value, item));
  }
  if (typeof value === 'string' && typeof suffix === 'string') {
    return value.endsWith(suffix);
  }
  if (typeof value === 'string' || typeof suffix === 'string') {
    return false;
  }
  const offset = value.byteLength - suffix.byteLength;
  return offset >= 0 && suffix.every((byte, index) => value[offset + index] === byte);
}

function _pathJoin(...parts: Array<string | number>): string {
  const cleaned = parts.map((part, idx) => {
    const text = String(part);
    if (idx === 0) {
      const stripped = text.replace(/\/+$/g, '');
      if (stripped === '.') {
        return '';
      }
      return text === '/' ? '/' : stripped;
    }
    return text.replace(/^\/+|\/+$/g, '');
  }).filter((part) => part.length > 0);
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned[0] === '/') {
    return `/${cleaned.slice(1).join('/')}`;
  }
  return cleaned.join('/');
}

function _basename(path: string): string {
  const normalized = path.replace(/\/+$/g, '');
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

export class MusicState {
  ready: boolean;
  enabled: boolean;
  volume: number;
  tracks: Map<string, rl.Music>;
  activeTrack: string | null;
  playbacks: Map<string, TrackPlayback>;
  queue: string[];
  // Mirrors the original game's "start a random game tune on first hit" gate.
  gameTuneStarted: boolean;
  gameTuneTrack: string | null;
  trackIds: Map<string, number>;
  nextTrackId: number;
  paqEntries: Map<string, Uint8Array> | null;

  constructor(opts: {
    ready: boolean;
    enabled: boolean;
    volume: number;
    tracks: Map<string, rl.Music>;
    activeTrack: string | null;
    playbacks?: Map<string, TrackPlayback>;
    queue?: string[];
    gameTuneStarted?: boolean;
    gameTuneTrack?: string | null;
    trackIds?: Map<string, number>;
    nextTrackId?: number;
    paqEntries?: Map<string, Uint8Array> | null;
  }) {
    this.ready = opts.ready;
    this.enabled = opts.enabled;
    this.volume = opts.volume;
    this.tracks = opts.tracks;
    this.activeTrack = opts.activeTrack;
    this.playbacks = opts.playbacks ?? new Map();
    this.queue = opts.queue ?? [];
    this.gameTuneStarted = opts.gameTuneStarted ?? false;
    this.gameTuneTrack = opts.gameTuneTrack ?? null;
    this.trackIds = opts.trackIds ?? new Map();
    this.nextTrackId = opts.nextTrackId ?? 0;
    this.paqEntries = opts.paqEntries ?? null;
  }
}

// Runtime playback state for a loaded music stream.
export class TrackPlayback {
  music: rl.Music;
  volume: number;
  muted: boolean;

  constructor(opts: {
    music: rl.Music;
    volume: number;
    muted: boolean;
  }) {
    this.music = opts.music;
    this.volume = opts.volume;
    this.muted = opts.muted;
  }
}

export function initMusicState(opts: { ready: boolean; enabled: boolean; volume: number }): MusicState {
  const ready = opts.ready;
  const enabled = opts.enabled;
  const volume = opts.volume;
  return new MusicState({ ready, enabled, volume, tracks: new Map(), activeTrack: null, playbacks: new Map(), queue: [], gameTuneStarted: false, gameTuneTrack: null, trackIds: new Map(), nextTrackId: 0, paqEntries: null });
}

export function loadMusicTracks(state: MusicState, assetsDir: string, console: ConsoleState): void {
  if (!state.ready || !state.enabled) {
    return;
  }

  const paqPath = _pathJoin(assetsDir, MUSIC_PAK_NAME);
  if (!existsSync(String(paqPath))) {
    throw new Error(`audio: missing ${MUSIC_PAK_NAME} in ${assetsDir}`);
  }

  const entries: Map<string, Uint8Array> = new Map();
  for (let [name, data] of paq.iterEntries(paqPath)) {
    entries.set(name.replaceAll('\\', '/'), data);
  }

  let loaded = 0;
  for (let [trackName, candidates] of MUSIC_TRACKS.entries()) {
    let data = null;
    for (const candidate of candidates) {
      data = entries.get(candidate) ?? null;
      if (data !== null) {
        break;
      }
    }
    if (data === null) {
      throw new Error(`audio: missing music entry for track '${trackName}' in ${MUSIC_PAK_NAME}`);
    }
    const music = wgl.loadMusicStreamFromMemory('.ogg', data, data.length);
    wgl.setMusicVolume(music, state.volume);
    state.tracks.set(trackName, music);
    loaded += 1;
  }
  state.trackIds = new Map(Array.from(Array.from(state.tracks.keys()).entries(), ([idx, name]) => [name, idx] as const));
  state.nextTrackId = state.trackIds.size;
  state.paqEntries = entries;

  console.log.log(`audio: music tracks loaded ${loaded}/${MUSIC_TRACKS.size} from ${paqPath}`);
  console.log.flush();
}

function normalizeTrackKey(relPath: string): string {
  const name = _basename(String(relPath.replaceAll('\\', '/')));
  if (pythonEndsWith(name.toLowerCase(), '.ogg')) {
    return name.slice(0, -4);
  }
  return name;
}

function ensureMusicEntries(state: MusicState, assetsDir: string): Map<string, Uint8Array> | null {
  if (state.paqEntries !== null) {
    return state.paqEntries;
  }
  const paqPath = _pathJoin(assetsDir, MUSIC_PAK_NAME);
  if (!existsSync(String(paqPath))) {
    return null;
  }
  const entries: Map<string, Uint8Array> = new Map();
  for (let [name, data] of paq.iterEntries(paqPath)) {
    entries.set(name.replaceAll('\\', '/'), data);
  }
  state.paqEntries = entries;
  return entries;
}

export function loadMusicTrack(state: MusicState, assetsDir: string, relPath: string, opts: { console?: ConsoleState | null } = {}): [string, number] | null {
  const console = opts.console ?? null;
  const normalized = relPath.replaceAll('\\', '/');
  if (!state.ready || !state.enabled) {
    if (console !== null) {
      console.log.log(`SFX Tune ${state.nextTrackId} <- '${normalized}' FAILED`);
    }
    return null;
  }
  const key = normalizeTrackKey(normalized);
  let trackId = state.trackIds.get(key) ?? null;
  if (trackId !== null) {
    if (console !== null) {
      console.log.log(`SFX Tune ${trackId} <- '${normalized}' ok`);
    }
    return [key, int(trackId)];
  }
  if (state.tracks.has(key)) {
    trackId = state.nextTrackId;
    state.nextTrackId += 1;
    state.trackIds.set(key, trackId);
    if (console !== null) {
      console.log.log(`SFX Tune ${trackId} <- '${normalized}' ok`);
    }
    return [key, trackId];
  }
  let musicStream = null;
  const filePath = _pathJoin(assetsDir, normalized);
  if ((existsSync(String(filePath)) && statSync(String(filePath)).isFile())) {
    musicStream = wgl.loadMusicStream(String(filePath));
  }
  if (musicStream === null) {
    const entries = ensureMusicEntries(state, assetsDir);
    let data: any;
    if (entries !== null) {
      data = entries.get(normalized) ?? null;
      if (data === null) {
        data = entries.get(_basename(String(normalized))) ?? null;
      }
      if (data !== null) {
        musicStream = wgl.loadMusicStreamFromMemory('.ogg', data, data.length);
      }
    }
  }
  if (musicStream === null) {
    if (console !== null) {
      console.log.log(`SFX Tune ${state.nextTrackId} <- '${normalized}' FAILED`);
    }
    return null;
  }
  trackId = state.nextTrackId;
  state.nextTrackId += 1;
  wgl.setMusicVolume(musicStream, state.volume);
  state.tracks.set(key, musicStream);
  state.trackIds.set(key, trackId);
  if (console !== null) {
    console.log.log(`SFX Tune ${trackId} <- '${normalized}' ok`);
  }
  return [key, int(trackId)];
}

export function queueTrack(state: MusicState, trackKey: string): void {
  if (!state.ready || !state.enabled) {
    return;
  }
  state.queue.push(trackKey);
}

function setMusicVolumeSafe(music: rl.Music, volume: number): boolean {
  try {
    wgl.setMusicVolume(music, volume);
    return true;
  } catch (exc) {
    return false;
  }
}

function playMusicStreamSafe(music: rl.Music): boolean {
  try {
    wgl.playMusicStream(music);
    return true;
  } catch (exc) {
    return false;
  }
}

function stopMusicStreamSafe(music: rl.Music): boolean {
  try {
    wgl.stopMusicStream(music);
    return true;
  } catch (exc) {
    return false;
  }
}

function updateMusicStreamSafe(music: rl.Music): boolean {
  try {
    wgl.updateMusicStream(music);
    return true;
  } catch (exc) {
    return false;
  }
}

function isMusicStreamPlayingSafe(music: rl.Music): boolean {
  try {
    return wgl.isMusicStreamPlaying(music);
  } catch (exc) {
    return false;
  }
}

function unloadMusicStreamSafe(music: rl.Music): boolean {
  try {
    wgl.unloadMusicStream(music);
    return true;
  } catch (exc) {
    return false;
  }
}

export function playMusic(state: MusicState, trackName: string): void {
  if (!state.ready || !state.enabled) {
    return;
  }
  const music = state.tracks.get(trackName) ?? null;
  if (music === null) {
    return;
  }

  // Original behavior uses an "exclusive" music channel: requesting a track
  // mutes (fades out) any other currently-unmuted music ids.
  for (let [key, pb] of state.playbacks.entries()) {
    if (key !== trackName && !pb.muted) {
      pb.muted = true;
    }
  }

  let pb = state.playbacks.get(trackName) ?? null;
  if (pb === null) {
    pb = new TrackPlayback({ music: music, volume: 0.0, muted: true });
    state.playbacks.set(trackName, pb);
  }

  // Mirror `sfx_play_exclusive`: only arm/unmute the requested track when its
  // tracked volume has already faded to silence.
  if (pb.volume <= 0.0) {
    pb.muted = false;
    pb.volume = state.volume;
    setMusicVolumeSafe(music, pb.volume);
    playMusicStreamSafe(music);
  }

  state.activeTrack = trackName;
}

export function stopMusic(state: MusicState): void {
  if (!state.ready || !state.enabled) {
    return;
  }
  // Mirror `sfx_mute_all`: mark everything muted and let `update_music` ramp it down.
  for (const pb of state.playbacks.values()) {
    pb.muted = true;
  }
  state.activeTrack = null;
  state.gameTuneStarted = false;
  state.gameTuneTrack = null;
}

export function triggerGameTune(state: MusicState, opts: { rng: CrandLike }): string | null {
  // Start a random queued game tune, if it hasn't been triggered yet.
  //
  // Returns the track key if playback started, otherwise None.
  const rng = opts.rng;
  if (!state.ready || !state.enabled) {
    return null;
  }
  if (state.gameTuneStarted) {
    return null;
  }
  if (state.queue.length === 0) {
    return null;
  }

  const idx = rng.rand() % state.queue.length;
  const trackKey = state.queue[idx];

  if (!state.tracks.has(trackKey)) {
    return null;
  }

  playMusic(state, trackKey);
  state.gameTuneStarted = true;
  state.gameTuneTrack = trackKey;
  return trackKey;
}

export function updateMusic(state: MusicState, dt: number): void {
  if (!state.ready || !state.enabled) {
    return;
  }
  let frameDt = dt;
  if (frameDt <= 0.0) {
    return;
  }
  if (frameDt > _MUSIC_MAX_DT) {
    frameDt = _MUSIC_MAX_DT;
  }

  const targetVolume = state.volume;
  let pb: any;
  if (targetVolume <= 0.0) {
    // Original behavior: global music volume at 0 stops playback immediately.
    for (const trackKey of Array.from(state.playbacks.keys())) {
      pb = state.playbacks.get(trackKey) ?? null;
      state.playbacks.delete(trackKey);
      if (pb === null) {
        continue;
      }
      setMusicVolumeSafe(pb.music, 0.0);
      stopMusicStreamSafe(pb.music);
    }
    return;
  }

  for (const trackKey of Array.from(state.playbacks.keys())) {
    pb = state.playbacks.get(trackKey) ?? null;
    if (pb === null) {
      continue;
    }
    const music = pb.music;

    // Keep streams serviced while they play.
    if (isMusicStreamPlayingSafe(music)) {
      updateMusicStreamSafe(music);
    }

    const muted = pb.muted || targetVolume <= 0.0;
    if (muted) {
      pb.volume -= frameDt * _MUSIC_FADE_OUT_PER_SEC;
      if (pb.volume <= 0.0) {
        pb.volume = 0.0;
        setMusicVolumeSafe(music, 0.0);
        stopMusicStreamSafe(music);
        state.playbacks.delete(trackKey);
        continue;
      }
      setMusicVolumeSafe(music, pb.volume);
      continue;
    }

    // Unmuted track: ensure it stays playing and ramp toward target volume.
    if (!isMusicStreamPlayingSafe(music)) {
      playMusicStreamSafe(music);
    }

    if (pb.volume > targetVolume) {
      pb.volume = targetVolume;
    } else if (pb.volume < targetVolume) {
      pb.volume = Math.min(targetVolume, pb.volume + frameDt * _MUSIC_FADE_IN_PER_SEC);
    }

    setMusicVolumeSafe(music, pb.volume);
  }
}

export function setMusicVolume(state: MusicState, volume: number): void {
  if (volume < 0.0) {
    volume = 0.0;
  }
  if (volume > 1.0) {
    volume = 1.0;
  }
  state.volume = volume;
  if (!state.ready || !state.enabled) {
    return;
  }
  // Mirror original: volume decreases take effect immediately; increases are ramped
  // by `update_music`.
  for (const pb of state.playbacks.values()) {
    if (pb.muted) {
      continue;
    }
    if (pb.volume > state.volume) {
      pb.volume = state.volume;
    }
    setMusicVolumeSafe(pb.music, pb.volume);
  }
}

export function shutdownMusic(state: MusicState): void {
  if (!state.ready) {
    return;
  }
  for (const pb of Array.from(state.playbacks.values())) {
    stopMusicStreamSafe(pb.music);
  }
  state.playbacks.clear();
  for (const music of state.tracks.values()) {
    stopMusicStreamSafe(music);
    unloadMusicStreamSafe(music);
  }
  state.tracks.clear();
  state.trackIds.clear();
  state.nextTrackId = 0;
  state.paqEntries = null;
  state.activeTrack = null;
  state.gameTuneStarted = false;
  state.gameTuneTrack = null;
}

const _MUSIC_MAX_DT = 0.1;
const _MUSIC_FADE_IN_PER_SEC = 1.0;
const _MUSIC_FADE_OUT_PER_SEC = 0.5;
