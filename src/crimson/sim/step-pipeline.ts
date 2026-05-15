// Port of crimson/sim/step_pipeline.py

import type { SfxId } from '@grim/sfx-map.ts';
import { f32 } from '@crimson/math-parity.ts';
import type { PresentationStepCommands } from '@crimson/sim/presentation-step.ts';
import { TerrainFxBatch } from '@crimson/sim/terrain-fx.ts';
import type { FrameTiming } from '@crimson/sim/timing.ts';
import type { WorldEvents } from '@crimson/sim/world-state.ts';

export function timeScaleReflexBoostBonus(opts: { reflexBoostTimer: number; timeScaleActive: boolean; dt: number }): number {
  // Apply Reflex Boost time scaling, matching the classic frame loop latch semantics.

  // Native stores frame delta time in float32 (`frame_dt`). Many downstream systems
  // multiply `frame_dt` before rounding back to float32, so the *input* precision
  // matters even when Reflex Boost is inactive.
  const reflexBoostTimer = opts.reflexBoostTimer;
  const timeScaleActive = opts.timeScaleActive;
  const dt = opts.dt;
  const dtF32 = f32(dt);
  if (!(dtF32 > 0.0)) {
    return dtF32;
  }
  if (!timeScaleActive) {
    return dtF32;
  }

  const timeScaleFactor = timeScaleReflexBoostFactor({ reflexBoostTimer: reflexBoostTimer, timeScaleActive: timeScaleActive });
  return f32(dtF32 * timeScaleFactor);
}

export function timeScaleReflexBoostFactor(opts: { reflexBoostTimer: number; timeScaleActive: boolean }): number {
  const reflexBoostTimer = opts.reflexBoostTimer;
  const timeScaleActive = opts.timeScaleActive;
  if (!timeScaleActive) {
    return 1.0;
  }
  const reflexF32 = f32(reflexBoostTimer);
  let timeScaleFactor = f32(0.3);
  if (reflexF32 < 1.0) {
    timeScaleFactor = f32((1.0 - reflexF32) * 0.7 + 0.3);
  }
  return timeScaleFactor;
}

export class PresentationRngTrace {
  drawsTotal: number;

  constructor(opts: {
    drawsTotal?: number;
  } = {}) {
    this.drawsTotal = opts.drawsTotal ?? 0;
  }
}

export class DeterministicStepResult {
  dtSim: number;
  timing: FrameTiming;
  events: WorldEvents;
  presentation: PresentationStepCommands;
  presentationPlanMs: number;
  presentationRngTrace: PresentationRngTrace;
  terrainFx: TerrainFxBatch;
  postApplySfx: readonly SfxId[];

  constructor(opts: {
    dtSim: number;
    timing: FrameTiming;
    events: WorldEvents;
    presentation: PresentationStepCommands;
    presentationPlanMs: number;
    presentationRngTrace: PresentationRngTrace;
    terrainFx?: TerrainFxBatch;
    postApplySfx?: readonly SfxId[];
  }) {
    this.dtSim = opts.dtSim;
    this.timing = opts.timing;
    this.events = opts.events;
    this.presentation = opts.presentation;
    this.presentationPlanMs = opts.presentationPlanMs;
    this.presentationRngTrace = opts.presentationRngTrace;
    this.terrainFx = opts.terrainFx ?? new TerrainFxBatch();
    this.postApplySfx = opts.postApplySfx ?? [];
  }
}
