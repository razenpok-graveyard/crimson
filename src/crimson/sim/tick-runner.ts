// Port of crimson/sim/tick_runner.py

import { TickResult } from '@crimson/sim/hooks.ts';
import type { FrameContext, InputProvider } from '@crimson/sim/input-providers.ts';
import { InputStatus, ResolvedTick } from '@crimson/sim/input-providers.ts';
import type { DeterministicSession } from '@crimson/sim/sessions.ts';

export class TickRunnerConfig {
  readonly traceRng: boolean;

  constructor(opts: {
    traceRng?: boolean;
  } = {}) {
    this.traceRng = opts.traceRng ?? false;
  }
}

export class TickBatchResult {
  ticksCompleted: number;
  batchStatus: InputStatus;
  nextTickIndex: number;
  completedResults: TickResult[];

  constructor(opts: {
    ticksCompleted?: number;
    batchStatus?: InputStatus;
    nextTickIndex?: number;
    completedResults?: TickResult[];
  } = {}) {
    this.ticksCompleted = opts.ticksCompleted ?? 0;
    this.batchStatus = opts.batchStatus ?? InputStatus.READY;
    this.nextTickIndex = opts.nextTickIndex ?? 0;
    this.completedResults = opts.completedResults ?? [];
  }
}

export class TickRunner {
  private readonly _session: DeterministicSession;
  private readonly _inputProvider: InputProvider;
  private readonly _config: TickRunnerConfig;

  constructor(opts: { session: DeterministicSession; inputProvider: InputProvider; config?: TickRunnerConfig | null }) {
    const session = opts.session;
    const inputProvider = opts.inputProvider;
    const config = opts.config ?? null;
    this._session = session;
    this._inputProvider = inputProvider;
    this._config = config !== null ? config : new TickRunnerConfig();
  }

  beginFrame(frameCtx: FrameContext): void {
    this._inputProvider.beginFrame(frameCtx);
  }

  advanceTicks(opts: { startTick: number; ticksRequested: number; tickDt: number }): TickBatchResult {
    let startTick = opts.startTick;
    let ticksRequested = opts.ticksRequested;
    const tickDt = opts.tickDt;
    startTick = Math.trunc(startTick);
    ticksRequested = Math.max(0, Math.trunc(ticksRequested));

    if (tickDt <= 0.0) {
      throw new Error('tick_dt must be positive');
    }

    if (ticksRequested <= 0) {
      return new TickBatchResult({ ticksCompleted: 0, batchStatus: InputStatus.READY, nextTickIndex: Math.trunc(startTick), completedResults: [] });
    }

    let ticksCompleted = 0;
    let batchStatus = InputStatus.READY;
    const completedResults: TickResult[] = [];

    for (let tickOffset = 0; tickOffset < ticksRequested; tickOffset++) {
      const tickIndex = Math.trunc(startTick + tickOffset);
      const tickSupply = this._inputProvider.pullTick(tickIndex, tickDt);
      const status = tickSupply.status;
      if (status === InputStatus.STALLED) {
        if (tickSupply.tick !== null) {
          throw new Error('stalled tick supply must not carry a resolved tick');
        }
        batchStatus = InputStatus.STALLED;
        break;
      }
      if (status === InputStatus.EOS) {
        if (tickSupply.tick !== null) {
          throw new Error('eos tick supply must not carry a resolved tick');
        }
        batchStatus = InputStatus.EOS;
        break;
      }

      const sourceTick = TickRunner._validatedSourceTick({ tickSupply: tickSupply, expectedTickIndex: tickIndex });
      const tickInputs = Array.from(sourceTick.inputs);
      const commands = Array.from(sourceTick.commands);

      const tick = this._session.stepTick({ dt: sourceTick.dtSeconds, inputs: tickInputs, traceRng: this._config.traceRng, commands: commands });
      const result = new TickResult({ sourceTick: sourceTick, payload: tick });
      completedResults.push(result);
      ticksCompleted += 1;
    }

    return new TickBatchResult({ ticksCompleted: ticksCompleted, batchStatus: batchStatus, nextTickIndex: Math.trunc(startTick) + Math.trunc(ticksCompleted), completedResults: Array.from(completedResults) });
  }

  static _validatedSourceTick(opts: { tickSupply: any; expectedTickIndex: number }): ResolvedTick {
    const tickSupply = opts.tickSupply;
    const expectedTickIndex = opts.expectedTickIndex;
    const sourceTick = tickSupply.tick;
    if (sourceTick === null) {
      throw new Error('ready tick supply must carry a resolved tick');
    }
    if (Math.trunc(sourceTick.tickIndex) !== Math.trunc(expectedTickIndex)) {
      throw new Error(`resolved tick index mismatch: expected=${Math.trunc(expectedTickIndex)} got=${Math.trunc(sourceTick.tickIndex)}`);
    }
    const dtSeconds = sourceTick.dtSeconds;
    if (dtSeconds <= 0.0) {
      throw new Error('resolved tick dt_seconds must be positive');
    }
    return new ResolvedTick({ tickIndex: Math.trunc(sourceTick.tickIndex), dtSeconds: dtSeconds, inputs: Array.from(sourceTick.inputs), commands: Array.from(sourceTick.commands) });
  }
}
