// Port of crimson/tooling/audio_bootstrap.py

import type { AudioState } from '@grim/audio.ts';
import { initAudioState } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import { ensureCrimsonCfg } from '@grim/config.ts';
import { ConsoleLog, ConsoleState } from '@grim/console.ts';
import type { CrandLike } from '@grim/rand.ts';
import { Crand } from '@grim/rand.ts';
import { downloadMissingPaqs } from '@crimson/assets-fetch.ts';
import { defaultRuntimeDir } from '@crimson/paths.ts';

export async function initViewAudio(assetsDir: string, opts: { seed?: number } = {}): Promise<ViewAudioBootstrap> {
  const seed = opts.seed ?? 0xBEEF;
  const audioRng = new Crand(seed);
  const runtimeDir = defaultRuntimeDir();
  let config: ReturnType<typeof ensureCrimsonCfg>;
  try {
    config = ensureCrimsonCfg(runtimeDir);
  } catch (exc) {
    return new ViewAudioBootstrap({ config: null, console: null, audio: null, audioRng: audioRng });
  }

  const console = new ConsoleState({ baseDir: runtimeDir, log: new ConsoleLog({ baseDir: runtimeDir }), assetsDir: assetsDir });
  try {
    downloadMissingPaqs(assetsDir, console);
  } catch (exc) {
    console.log.log(`assets: download failed: ${exc instanceof Error ? exc.message : String(exc)}`);
    console.log.flush();
  }

  let audio: Awaited<ReturnType<typeof initAudioState>>;
  try {
    audio = await initAudioState(config, assetsDir, console);
  } catch (exc) {
    return new ViewAudioBootstrap({ config: config, console: console, audio: null, audioRng: audioRng });
  }

  return new ViewAudioBootstrap({ config: config, console: console, audio: audio, audioRng: audioRng });
}

export class ViewAudioBootstrap {
  config: CrimsonConfig | null;
  console: ConsoleState | null;
  audio: AudioState | null;
  audioRng: CrandLike;

  constructor(opts: {
    config: CrimsonConfig | null;
    console: ConsoleState | null;
    audio: AudioState | null;
    audioRng: CrandLike;
  }) {
    this.config = opts.config;
    this.console = opts.console;
    this.audio = opts.audio;
    this.audioRng = opts.audioRng;
  }
}
