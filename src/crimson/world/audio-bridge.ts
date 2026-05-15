// Port of crimson/world/audio_bridge.py

import type { AudioState } from '@grim/audio.ts';
import type { CrandLike } from '@grim/rand.ts';
import { AudioRouter } from '@crimson/audio-router.ts';
import { type PresentationStepCommands, applyPresentationPlan } from '@crimson/sim/presentation-step.ts';

function _zeroReflexBoost(): number {
  return 0.0;
}

export class AudioBridge {
  audioRng: CrandLike;
  demoModeActive: boolean;
  reflexBoostTimerSource: () => number;
  audio: AudioState | null;
  router: AudioRouter;

  constructor(opts: {
    audioRng: CrandLike;
    demoModeActive?: boolean;
    reflexBoostTimerSource?: () => number;
    audio?: AudioState | null;
  }) {
    this.audioRng = opts.audioRng;
    this.demoModeActive = opts.demoModeActive ?? false;
    this.reflexBoostTimerSource = opts.reflexBoostTimerSource ?? _zeroReflexBoost;
    this.audio = opts.audio ?? null;
    this.router = new AudioRouter({
      audioRng: this.audioRng,
      audio: this.audio,
      demoModeActive: this.demoModeActive,
      reflexBoostTimerSource: this.reflexBoostTimerSource,
    });
  }

  sync(opts: { audio: AudioState | null; audioRng: CrandLike; demoModeActive: boolean }): void {
    this.audio = opts.audio;
    this.audioRng = opts.audioRng;
    this.demoModeActive = Boolean(opts.demoModeActive);
    this.router.audio = opts.audio;
    this.router.audioRng = opts.audioRng;
    this.router.demoModeActive = Boolean(opts.demoModeActive);
  }

  applyPlan(opts: { plan: PresentationStepCommands; applyAudio?: boolean }): void {
    const applyAudio = opts.applyAudio ?? true;
    applyPresentationPlan({ plan: opts.plan, audioSink: this.router, applyAudio: Boolean(applyAudio) });
  }
}
