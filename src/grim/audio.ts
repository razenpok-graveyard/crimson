// Port of grim/audio.py

import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { CrandLike } from '@grim/rand.ts';
import type { SfxId } from '@grim/sfx-map.ts';
import * as wgl from '@wgl';
import * as music from '@grim/music.ts';
import * as sfx from '@grim/sfx.ts';

export class AudioState {
  ready: boolean;
  music: music.MusicState;
  sfx: sfx.SfxState;

  constructor(opts: {
    ready: boolean;
    music: music.MusicState;
    sfx: sfx.SfxState;
  }) {
    this.ready = opts.ready;
    this.music = opts.music;
    this.sfx = opts.sfx;
  }
}

export function initAudioState(config: CrimsonConfig, assetsDir: string, console: ConsoleState): AudioState {
  const musicDisabled = config.audio.musicDisabled;
  const soundDisabled = config.audio.soundDisabled;
  const musicVolume = config.audio.musicVolume;
  const sfxVolume = config.audio.sfxVolume;

  const musicEnabled = !musicDisabled;
  const sfxEnabled = !soundDisabled;
  if (!musicEnabled && !sfxEnabled) {
    console.log.log('audio: disabled (music + sfx)');
    console.log.flush();
    return new AudioState({ ready: false, music: music.initMusicState({ ready: false, enabled: false, volume: musicVolume }), sfx: sfx.initSfxState({ ready: false, enabled: false, volume: sfxVolume }) });
  }

  if (!wgl.isAudioDeviceReady()) {
    wgl.initAudioDevice();
  }
  const ready = wgl.isAudioDeviceReady();
  if (!ready) {
    console.log.log('audio: device init failed');
    console.log.flush();
    return new AudioState({ ready: false, music: music.initMusicState({ ready: false, enabled: false, volume: musicVolume }), sfx: sfx.initSfxState({ ready: false, enabled: false, volume: sfxVolume }) });
  }

  const state = new AudioState({ ready: true, music: music.initMusicState({ ready: true, enabled: musicEnabled, volume: musicVolume }), sfx: sfx.initSfxState({ ready: true, enabled: sfxEnabled, volume: sfxVolume }) });
  sfx.loadSfxIndex(state.sfx, assetsDir, console);
  music.loadMusicTracks(state.music, assetsDir, console);
  return state;
}

export function playMusic(state: AudioState, trackName: string): void {
  music.playMusic(state.music, trackName);
}

export function stopMusic(state: AudioState | null): void {
  if (state === null) {
    return;
  }
  music.stopMusic(state.music);
}

export function triggerGameTune(state: AudioState, opts: { rng: CrandLike }): string | null {
  const rng = opts.rng;
  return music.triggerGameTune(state.music, { rng: rng });
}

export function playSfx(state: AudioState | null, sfxId: SfxId, opts: { reflexBoostTimer?: number } = {}): void {
  const reflexBoostTimer = opts.reflexBoostTimer ?? 0.0;
  if (state === null) {
    return;
  }
  sfx.playSfx(state.sfx, sfxId, { reflexBoostTimer: reflexBoostTimer });
}

export function setSfxVolume(state: AudioState | null, volume: number): void {
  if (state === null) {
    return;
  }
  sfx.setSfxVolume(state.sfx, volume);
}

export function setMusicVolume(state: AudioState | null, volume: number): void {
  if (state === null) {
    return;
  }
  music.setMusicVolume(state.music, volume);
}

export function updateAudio(state: AudioState, dt: number): void {
  music.updateMusic(state.music, dt);
}

export function shutdownAudio(state: AudioState): void {
  if (!state.ready) {
    return;
  }
  sfx.shutdownSfx(state.sfx);
  music.shutdownMusic(state.music);
  wgl.closeAudioDevice();
}
