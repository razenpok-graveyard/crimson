// Port of crimson/replay/driver/playback_pump.py

import type { SimMetadataSink } from '@crimson/sim/batch-apply.ts';
import { PresentationTickOutput, applyTickToSim } from '@crimson/sim/batch-apply.ts';
import type { FixedStepClock } from '@crimson/sim/clock.ts';
import { advanceTickRunnerFrame } from '@crimson/sim/frame-pump.ts';
import { TickResult } from '@crimson/sim/hooks.ts';
import type { FrameContext } from '@crimson/sim/input-providers.ts';
import { InputStatus } from '@crimson/sim/input-providers.ts';
import { TickBatchResult } from '@crimson/sim/tick-runner.ts';

export interface PlaybackFrameDriver {
  stepTick(tickIndex: number): TickResult;
}

export class PlaybackFrameAdvance {
  readonly outputs: readonly PresentationTickOutput[];
  readonly tickResults: readonly TickResult[];
  readonly frameIndex: number;
  readonly nextTickIndex: number;
  readonly ticksRequested: number;
  readonly ticksCompleted: number;

  constructor(opts: {
    outputs: readonly PresentationTickOutput[];
    tickResults: readonly TickResult[];
    frameIndex: number;
    nextTickIndex: number;
    ticksRequested: number;
    ticksCompleted: number;
  }) {
    this.outputs = opts.outputs;
    this.tickResults = opts.tickResults;
    this.frameIndex = opts.frameIndex;
    this.nextTickIndex = opts.nextTickIndex;
    this.ticksRequested = opts.ticksRequested;
    this.ticksCompleted = opts.ticksCompleted;
  }
}

export class PlaybackStepRunner {
  protected _driver: PlaybackFrameDriver;
  protected _tickLimit: number;

  constructor(opts: { driver: PlaybackFrameDriver; tickLimit: number }) {
    const driver = opts.driver;
    const tickLimit = opts.tickLimit;
    this._driver = driver;
    this._tickLimit = int(tickLimit);
  }

  beginFrame(frameCtx: FrameContext): void {
    const _ = frameCtx;
  }

  advanceTicks(opts: { startTick: number; ticksRequested: number; tickDt: number }): TickBatchResult {
    const startTick = opts.startTick;
    const ticksRequested = opts.ticksRequested;
    const tickDt = opts.tickDt;
    const _ = tickDt;
    const completedResults: TickResult[] = [];
    let nextTickIndex = int(startTick);
    let batchStatus = InputStatus.READY;
    while (completedResults.length < Math.max(0, int(ticksRequested))) {
      if (nextTickIndex >= int(this._tickLimit)) {
        batchStatus = InputStatus.EOS;
        break;
      }
      completedResults.push(this._driver.stepTick(nextTickIndex));
      nextTickIndex += 1;
    }

    return new TickBatchResult({ ticksCompleted: completedResults.length, batchStatus: batchStatus, nextTickIndex: int(nextTickIndex), completedResults: completedResults });
  }
}

export function advancePlaybackFrame(opts: { driver: PlaybackFrameDriver; simWorld: SimMetadataSink; clock: FixedStepClock; startTick: number; frameIndex: number; dtSeconds: number; maxTicks: number | null; tickLimit: number; gameTuneStarted: boolean }): PlaybackFrameAdvance {
  const driver = opts.driver;
  const simWorld = opts.simWorld;
  const clock = opts.clock;
  const startTick = opts.startTick;
  const frameIndex = opts.frameIndex;
  const dtSeconds = opts.dtSeconds;
  const maxTicks = opts.maxTicks;
  const tickLimit = opts.tickLimit;
  const gameTuneStarted = opts.gameTuneStarted;
  let ticksRequested = int(clock.advance(dtSeconds));
  if (maxTicks !== null) {
    ticksRequested = Math.min(int(ticksRequested), Math.max(0, int(maxTicks)));
  }

  const advance = advanceTickRunnerFrame({ runner: new PlaybackStepRunner({ driver: driver, tickLimit: int(tickLimit) }), startTick: int(startTick), frameIndex: int(frameIndex), ticksRequested: int(ticksRequested), dtSeconds: dtSeconds, tickDtSeconds: clock.dtTick, isNetworked: false, isReplay: true, refundClock: clock });
  const tickResults = Array.from(advance.batch.completedResults);
  const outputs: PresentationTickOutput[] = [];
  for (const tickResult of tickResults) {
    applyTickToSim({
      simWorld: simWorld,
      step: tickResult.payload.step,
      gameTuneStarted: gameTuneStarted,
    });
    outputs.push(new PresentationTickOutput({ tickIndex: int(tickResult.sourceTick.tickIndex), dtSim: tickResult.payload.step.dtSim, presentation: tickResult.payload.step.presentation, terrainFx: tickResult.payload.step.terrainFx }));
  }

  return new PlaybackFrameAdvance({ outputs: Array.from(outputs), tickResults: Array.from(tickResults), frameIndex: int(advance.frameIndex), nextTickIndex: int(advance.nextTickIndex), ticksRequested: int(advance.ticksRequested), ticksCompleted: int(advance.batch.ticksCompleted) });
}
