// Port of crimson/sim/frame_pump.py

import type { FixedStepClock } from '@crimson/sim/clock.ts';
import { FrameContext, InputStatus } from '@crimson/sim/input-providers.ts';
import type { TickBatchResult } from '@crimson/sim/tick-runner.ts';

export interface TickFrameRunner {
  beginFrame(frameCtx: FrameContext): void;
  advanceTicks(opts: { startTick: number; ticksRequested: number; tickDt: number }): TickBatchResult;
}

export class TickFrameAdvance {
  readonly batch: TickBatchResult;
  readonly frameIndex: number;
  readonly nextTickIndex: number;
  readonly ticksRequested: number;

  constructor(opts: {
    batch: TickBatchResult;
    frameIndex: number;
    nextTickIndex: number;
    ticksRequested: number;
  }) {
    this.batch = opts.batch;
    this.frameIndex = opts.frameIndex;
    this.nextTickIndex = opts.nextTickIndex;
    this.ticksRequested = opts.ticksRequested;
  }
}

export function advanceTickRunnerFrame(opts: { runner: TickFrameRunner; startTick: number; frameIndex: number; ticksRequested: number; dtSeconds: number; tickDtSeconds: number; isNetworked: boolean; isReplay: boolean; refundClock?: FixedStepClock | null }): TickFrameAdvance {
  const runner = opts.runner;
  const startTick = opts.startTick;
  const frameIndex = opts.frameIndex;
  let ticksRequested = opts.ticksRequested;
  const dtSeconds = opts.dtSeconds;
  const tickDtSeconds = opts.tickDtSeconds;
  const isNetworked = opts.isNetworked;
  const isReplay = opts.isReplay;
  const refundClock = opts.refundClock ?? null;
  const nextFrameIndex = Math.trunc(frameIndex) + 1;
  ticksRequested = Math.max(0, Math.trunc(ticksRequested));

  runner.beginFrame(new FrameContext({ dtSeconds: dtSeconds, tickDtSeconds: tickDtSeconds, frameIndex: Math.trunc(nextFrameIndex), candidateTicks: Math.trunc(ticksRequested), isNetworked: isNetworked, isReplay: isReplay }));
  const batch = runner.advanceTicks({ startTick: Math.trunc(startTick), ticksRequested: Math.trunc(ticksRequested), tickDt: tickDtSeconds });
  const nextTickIndex = Math.trunc(batch.nextTickIndex);

  if (refundClock !== null && (batch.batchStatus === InputStatus.STALLED || batch.batchStatus === InputStatus.EOS)) {
    const unconsumedTicks = Math.max(0, Math.trunc(ticksRequested) - Math.trunc(batch.ticksCompleted));
    if (unconsumedTicks > 0) {
      refundClock.accum += unconsumedTicks * tickDtSeconds;
    }
  }

  return new TickFrameAdvance({ batch: batch, frameIndex: Math.trunc(nextFrameIndex), nextTickIndex: Math.trunc(nextTickIndex), ticksRequested: Math.trunc(ticksRequested) });
}
