// Port of crimson/world/audio_bridge.py

import type { AudioState } from '@grim/audio.ts';
import type { Crand } from '@grim/rand.ts';
import { AudioRouter } from '@crimson/audio-router.ts';
import type { PresentationStepCommands } from '@crimson/sim/presentation-step.ts';
import { applyPresentationPlan } from '@crimson/sim/presentation-step.ts';

function zeroReflexBoost(): number {
  return 0.0;
}

export class AudioBridge {
  audioRng: Crand;
  demoModeActive: boolean;
  reflexBoostTimerSource: () => number;
  audio: AudioState | null;
  router: AudioRouter;

  constructor(opts: {
    audioRng: Crand;
    demoModeActive?: boolean;
    reflexBoostTimerSource?: () => number;
    audio?: AudioState | null;
    router?: AudioRouter;
  }) {
    this.audioRng = opts.audioRng;
    this.demoModeActive = opts.demoModeActive ?? false;
    this.reflexBoostTimerSource = opts.reflexBoostTimerSource ?? zeroReflexBoost;
    this.audio = opts.audio ?? null;
    this.router = new AudioRouter({ audioRng: this.audioRng, audio: this.audio, demoModeActive: this.demoModeActive, reflexBoostTimerSource: this.reflexBoostTimerSource });
  }

  sync(opts: { audio: AudioState | null; audioRng: Crand; demoModeActive: boolean }): void {
    const audio = opts.audio;
    const audioRng = opts.audioRng;
    const demoModeActive = opts.demoModeActive;
    this.audio = audio;
    this.audioRng = audioRng;
    this.demoModeActive = demoModeActive;
    this.router.audio = audio;
    this.router.audioRng = audioRng;
    this.router.demoModeActive = demoModeActive;
  }

  applyPlan(opts: { plan: PresentationStepCommands; applyAudio?: boolean }): void {
    const plan = opts.plan;
    const applyAudio = opts.applyAudio ?? true;
    applyPresentationPlan({
      plan: plan,
      audioSink: this.router,
      applyAudio: applyAudio,
    });
  }
}
