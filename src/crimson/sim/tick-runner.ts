// Port of crimson/sim/tick_runner.py

import { TickResult } from './hooks.ts';
import type { FrameContext, InputProvider } from './input-providers.ts';
import { InputStatus, ResolvedTick } from './input-providers.ts';
import type { GameCommand } from './input-providers.ts';
import type { DeterministicSession } from './sessions.ts';
import type { PlayerInput } from './input.ts';

export class TickRunnerConfig {
  readonly traceRng: boolean;

  constructor(opts: { traceRng?: boolean } = {}) {
    this.traceRng = opts.traceRng ?? false;
  }
}

export class TickBatchResult {
  ticksCompleted: number;
  batchStatus: InputStatus;
  nextTickIndex: number;
  completedResults: TickResult[];

  constructor(opts?: {
    ticksCompleted?: number;
    batchStatus?: InputStatus;
    nextTickIndex?: number;
    completedResults?: TickResult[];
  }) {
    this.ticksCompleted = opts?.ticksCompleted ?? 0;
    this.batchStatus = opts?.batchStatus ?? InputStatus.READY;
    this.nextTickIndex = opts?.nextTickIndex ?? 0;
    this.completedResults = Array.from(opts?.completedResults ?? []);
  }
}
export class TickRunner {
  private readonly _session: DeterministicSession;
  private readonly _inputProvider: InputProvider;
  private readonly _config: TickRunnerConfig;

  constructor(opts: {
    session: DeterministicSession;
    inputProvider: InputProvider;
    config?: TickRunnerConfig;
  }) {
    this._session = opts.session;
    this._inputProvider = opts.inputProvider;
    this._config = opts.config ?? new TickRunnerConfig();
  }

  beginFrame(frameCtx: FrameContext): void {
    this._inputProvider.beginFrame(frameCtx);
  }

  advanceTicks(opts: {
    startTick: number;
    ticksRequested: number;
    tickDt: number;
  }): TickBatchResult {
    let startTick = int(opts.startTick);
    let ticksRequested = Math.max(0, int(opts.ticksRequested));
    const tickDt = Number(opts.tickDt);

    if (tickDt <= 0.0) {
      throw new Error('tick_dt must be positive');
    }

    if (ticksRequested <= 0) {
      return new TickBatchResult({
        ticksCompleted: 0,
        batchStatus: InputStatus.READY,
        nextTickIndex: startTick,
        completedResults: [],
      });
    }

    let ticksCompleted = 0;
    let batchStatus = InputStatus.READY;
    const completedResults: TickResult[] = [];

    for (let tickOffset = 0; tickOffset < ticksRequested; tickOffset++) {
      const tickIndex = int(startTick + tickOffset);
      const tickSupply = this._inputProvider.pullTick(tickIndex, tickDt);
      const status = tickSupply.status;

      if (status === InputStatus.STALLED) {
        if (tickSupply.tick !== null) {
          throw new Error(
            'stalled tick supply must not carry a resolved tick',
          );
        }
        batchStatus = InputStatus.STALLED;
        break;
      }

      if (status === InputStatus.EOS) {
        if (tickSupply.tick !== null) {
          throw new Error(
            'eos tick supply must not carry a resolved tick',
          );
        }
        batchStatus = InputStatus.EOS;
        break;
      }

      const sourceTick = TickRunner._validatedSourceTick({
        tickSupply,
        expectedTickIndex: tickIndex,
      });

      const tickInputs: PlayerInput[] = [...sourceTick.inputs];
      const commands: GameCommand[] = [...sourceTick.commands];

      const tick = this._session.stepTick({
        dt: sourceTick.dtSeconds,
        inputs: tickInputs,
        traceRng: this._config.traceRng,
        commands,
      });

      const result = new TickResult({
        sourceTick,
        payload: tick,
      });
      completedResults.push(result);
      ticksCompleted += 1;
    }

    return new TickBatchResult({
      ticksCompleted,
      batchStatus,
      nextTickIndex: int(startTick) + int(ticksCompleted),
      completedResults,
    });
  }

  private static _validatedSourceTick(opts: {
    tickSupply: { status: InputStatus; tick: ResolvedTick | null };
    expectedTickIndex: number;
  }): ResolvedTick {
    const { tickSupply, expectedTickIndex } = opts;
    const sourceTick = tickSupply.tick;
    if (sourceTick === null) {
      throw new Error('ready tick supply must carry a resolved tick');
    }
    if (int(sourceTick.tickIndex) !== int(expectedTickIndex)) {
      throw new Error(
        `resolved tick index mismatch: expected=${int(expectedTickIndex)} got=${int(sourceTick.tickIndex)}`,
      );
    }
    const dtSeconds = Number(sourceTick.dtSeconds);
    if (dtSeconds <= 0.0) {
      throw new Error('resolved tick dt_seconds must be positive');
    }
    return new ResolvedTick({
      tickIndex: int(sourceTick.tickIndex),
      dtSeconds,
      inputs: [...sourceTick.inputs],
      commands: [...sourceTick.commands],
    });
  }
}
