// Port of grim/sfx.py

import type { rl } from '@grim/raylib-api.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { SfxId } from '@grim/sfx-map.ts';
import { SFX_NATIVE_ORDER, SFX_SPECS } from '@grim/sfx-map.ts';
import { existsSync } from 'node:fs';
import * as wgl from '@wgl';
import * as paq from '@grim/paq.ts';

export const SFX_PAK_NAME = 'sfx.paq';
export const DEFAULT_VOICE_COUNT = 4;
const _SFX_RATE_BASE_HZ = 44100;
const _SFX_RATE_MIN_HZ = 22050;

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

function _pathExtname(path: string): string {
  const base = _basename(path);
  if (base === '' || base === '.' || base === '..') {
    return '';
  }
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

const _pythonObjectIds = new WeakMap<object, number>();
let _pythonNextObjectId = 1;

function pythonId(value: unknown): number {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    const text = `${typeof value}:${String(value)}`;
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash, 31) + text.charCodeAt(index) | 0;
    }
    return hash;
  }
  const objectValue = value as object;
  let objectId = _pythonObjectIds.get(objectValue);
  if (objectId === undefined) {
    objectId = _pythonNextObjectId;
    _pythonNextObjectId += 1;
    _pythonObjectIds.set(objectValue, objectId);
  }
  return objectId;
}

function pyRound(value: number): number {
  const floorValue = Math.floor(value);
  const frac = value - floorValue;
  if (frac < 0.5) {
    return floorValue;
  }
  if (frac > 0.5) {
    return floorValue + 1;
  }
  return floorValue % 2 === 0 ? floorValue : floorValue + 1;
}

const _f32buf = new Float32Array(1);
const _u32buf = new Uint32Array(_f32buf.buffer);

export class SfxSample {
  entryName: string;
  source: rl.Sound;
  aliases: rl.Sound[];
  nextVoice: number;

  constructor(opts: {
    entryName: string;
    source: rl.Sound;
    aliases: rl.Sound[];
    nextVoice?: number;
  }) {
    this.entryName = opts.entryName;
    this.source = opts.source;
    this.aliases = opts.aliases;
    this.nextVoice = opts.nextVoice ?? 0;
  }

  *voices(): Iterable<rl.Sound> {
    yield this.source;
    yield* this.aliases;
  }

  acquireVoice(): rl.Sound {
    for (const voice of this.voices()) {
      if (!wgl.isSoundPlaying(voice)) {
        return voice;
      }
    }
    const voices = [this.source, ...this.aliases];
    const idx = this.nextVoice % voices.length;
    this.nextVoice += 1;
    return voices[idx];
  }
}

export class SfxState {
  ready: boolean;
  enabled: boolean;
  volume: number;
  voiceCount: number;
  samples: Map<SfxId, SfxSample>;
  rateScaleHz: number;

  constructor(opts: {
    ready: boolean;
    enabled: boolean;
    volume: number;
    voiceCount: number;
    samples: Map<SfxId, SfxSample>;
    rateScaleHz: number;
  }) {
    this.ready = opts.ready;
    this.enabled = opts.enabled;
    this.volume = opts.volume;
    this.voiceCount = opts.voiceCount;
    this.samples = opts.samples;
    this.rateScaleHz = opts.rateScaleHz;
  }

  sample(sfxId: SfxId): SfxSample {
    const sample = this.samples.get(sfxId) ?? null;
    if (sample === null) {
      const entryName = SFX_SPECS.get(sfxId)!.entryName;
      throw new Error(`runtime sfx is not available: ${entryName}`);
    }
    return sample;
  }
}

function stopSoundSafe(sound: rl.Sound): boolean {
  try {
    wgl.stopSound(sound);
    return true;
  } catch (exc) {
    return false;
  }
}

function unloadSoundAliasSafe(sound: rl.Sound): boolean {
  try {
    wgl.unloadSoundAlias(sound);
    return true;
  } catch (exc) {
    return false;
  }
}

function unloadSoundSafe(sound: rl.Sound): boolean {
  try {
    wgl.unloadSound(sound);
    return true;
  } catch (exc) {
    return false;
  }
}

function setSoundPitchSafe(sound: rl.Sound, pitch: number): boolean {
  try {
    wgl.setSoundPitch(sound, pitch);
    return true;
  } catch (exc) {
    return false;
  }
}

function f32(value: number): number {
  return (() => { _f32buf[0] = value; return _f32buf[0]; })();
}

function nextRateScaleHz(opts: { currentRateScaleHz: number; reflexBoostTimer: number }): number {
  // Native `sfx_play` / `sfx_play_panned` update a global rate scalar from
  // `bonus_reflex_boost_timer` before each voice start.
  const currentRateScaleHz = opts.currentRateScaleHz;
  const reflexBoostTimer = opts.reflexBoostTimer;
  const reflexF32 = f32(reflexBoostTimer);
  if (reflexF32 <= 0.0) {
    return int(_SFX_RATE_BASE_HZ);
  }
  if (reflexF32 <= 1.0) {
    if (reflexF32 < 1.0) {
      const rateExpr = f32((f32(1.0) - reflexF32 + f32(1.0)) * f32(_SFX_RATE_MIN_HZ));
      // `__ftol` follows host FP rounding mode (nearest on native defaults).
      return int(pyRound(rateExpr));
    }
    // Native keeps prior `sfx_rate_scale` when timer is exactly 1.0.
    return int(currentRateScaleHz);
  }
  return int(_SFX_RATE_MIN_HZ);
}

function pitchScaleFromRateHz(rateScaleHz: number): number {
  return f32(rateScaleHz / _SFX_RATE_BASE_HZ);
}

export function initSfxState(opts: { ready: boolean; enabled: boolean; volume: number; voiceCount?: number }): SfxState {
  const ready = opts.ready;
  const enabled = opts.enabled;
  const volume = opts.volume;
  const voiceCount = opts.voiceCount ?? DEFAULT_VOICE_COUNT;
  return new SfxState({ ready, enabled, volume, voiceCount: Math.max(1, int(voiceCount)), samples: new Map(), rateScaleHz: int(_SFX_RATE_BASE_HZ) });
}

function loadSampleFromData(state: SfxState, opts: { entryName: string; data: Uint8Array }): SfxSample {
  const entryName = opts.entryName;
  const data = opts.data;
  const fileType = _pathExtname(String(entryName)).toLowerCase();
  const wave = wgl.loadWaveFromMemory(fileType, data, data.length);
  const source = wgl.loadSoundFromWave(wave);
  wgl.unloadWave(wave);
  const aliases = Array.from({ length: Math.max(0, Math.max(1, state.voiceCount) - 1) }, (_, i) => i).map((_) => wgl.loadSoundAlias(source));
  const sample = new SfxSample({ entryName: entryName, source: source, aliases: aliases });
  for (const voice of sample.voices()) {
    wgl.setSoundVolume(voice, state.volume);
  }
  return sample;
}

export function loadSfxIndex(state: SfxState, assetsDir: string, console: ConsoleState): void {
  if (!state.ready || !state.enabled) {
    return;
  }

  const paqPath = _pathJoin(assetsDir, SFX_PAK_NAME);
  if (!existsSync(String(paqPath))) {
    throw new Error(`audio: missing ${SFX_PAK_NAME} in ${assetsDir}`);
  }

  const paqEntries: Map<string, Uint8Array> = new Map();
  for (let [name, data] of paq.iterEntries(paqPath)) {
    const normalized = name.replaceAll('\\', '/');
    if (_pathExtname(String(normalized)).toLowerCase() !== '.ogg' && _pathExtname(String(normalized)).toLowerCase() !== '.wav') {
      continue;
    }
    paqEntries.set(normalized, data);
  }

  const missingEntries = Array.from(SFX_SPECS.values()).filter((spec) => !paqEntries.has(spec.entryName)).map((spec) => spec.entryName);
  if (missingEntries.length > 0) {
    const missing = Array.from(missingEntries).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).join(", ");
    throw new Error(`audio: missing declared sfx assets in ${SFX_PAK_NAME}: ${missing}`);
  }

  const loadedByEntryName: Map<string, SfxSample> = new Map();
  state.samples.clear();
  for (let [sfxId, spec] of SFX_SPECS.entries()) {
    let sample = loadedByEntryName.get(spec.entryName) ?? null;
    if (sample === null) {
      sample = loadSampleFromData(state, { entryName: spec.entryName, data: paqEntries.get(spec.entryName)! });
      loadedByEntryName.set(spec.entryName, sample);
    }
    state.samples.set(sfxId, sample);
  }

  console.log.log(`audio: sfx loaded ${loadedByEntryName.size} samples for ${state.samples.size} ids from ${SFX_PAK_NAME}`);
  console.log.flush();
}

export function playSfx(state: SfxState | null, sfx: SfxId, opts: { reflexBoostTimer?: number } = {}): void {
  const reflexBoostTimer = opts.reflexBoostTimer ?? 0.0;
  if (state === null || !state.ready || !state.enabled) {
    return;
  }

  const sample = state.sample(sfx);
  state.rateScaleHz = nextRateScaleHz({ currentRateScaleHz: int(state.rateScaleHz), reflexBoostTimer: reflexBoostTimer });
  const voice = sample.acquireVoice();
  setSoundPitchSafe(voice, pitchScaleFromRateHz(int(state.rateScaleHz)));
  wgl.playSound(voice);
}

export function sfxIdForNativeId(sfxId: number): SfxId | null {
  if (sfxId < 0) {
    return null;
  }
  if (sfxId >= SFX_NATIVE_ORDER.length) {
    return null;
  }
  return SFX_NATIVE_ORDER[sfxId];
}

export function playSfxId(state: SfxState | null, sfxId: number): void {
  const resolved = sfxIdForNativeId(int(sfxId));
  if (resolved === null) {
    return;
  }
  playSfx(state, resolved);
}

export function setSfxVolume(state: SfxState | null, volume: number): void {
  if (state === null) {
    return;
  }
  if (volume < 0.0) {
    volume = 0.0;
  }
  if (volume > 1.0) {
    volume = 1.0;
  }
  state.volume = volume;
  const seen: Set<number> = new Set();
  for (const sample of state.samples.values()) {
    const sampleId = pythonId(sample);
    if (seen.has(sampleId)) {
      continue;
    }
    seen.add(sampleId);
    for (const voice of sample.voices()) {
      wgl.setSoundVolume(voice, state.volume);
    }
  }
}

export function shutdownSfx(state: SfxState): void {
  if (!state.ready) {
    return;
  }
  const seen: Set<number> = new Set();
  for (const sample of state.samples.values()) {
    const sampleId = pythonId(sample);
    if (seen.has(sampleId)) {
      continue;
    }
    seen.add(sampleId);
    for (const alias of sample.aliases) {
      stopSoundSafe(alias);
      unloadSoundAliasSafe(alias);
    }
    stopSoundSafe(sample.source);
    unloadSoundSafe(sample.source);
  }
  state.samples.clear();
}
