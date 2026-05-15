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
  const nextFrameIndex = int(frameIndex) + 1;
  ticksRequested = Math.max(0, int(ticksRequested));

  runner.beginFrame(new FrameContext({ dtSeconds: dtSeconds, tickDtSeconds: tickDtSeconds, frameIndex: int(nextFrameIndex), candidateTicks: int(ticksRequested), isNetworked: isNetworked, isReplay: isReplay }));
  const batch = runner.advanceTicks({ startTick: int(startTick), ticksRequested: int(ticksRequested), tickDt: tickDtSeconds });
  const nextTickIndex = int(batch.nextTickIndex);

  if (refundClock !== null && (batch.batchStatus === InputStatus.STALLED || batch.batchStatus === InputStatus.EOS)) {
    const unconsumedTicks = Math.max(0, int(ticksRequested) - int(batch.ticksCompleted));
    if (unconsumedTicks > 0) {
      refundClock.accum += unconsumedTicks * tickDtSeconds;
    }
  }

  return new TickFrameAdvance({ batch: batch, frameIndex: int(nextFrameIndex), nextTickIndex: int(nextTickIndex), ticksRequested: int(ticksRequested) });
}
