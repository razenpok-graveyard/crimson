// Port of crimson/world/standalone_tick_harness.py

import type { GameMode } from '@crimson/game-modes.ts';
import { applyPresentationOutputs, applySimMetadataBatch } from '@crimson/sim/batch-apply.ts';
import { FixedStepClock } from '@crimson/sim/clock.ts';
import { advanceTickRunnerFrame } from '@crimson/sim/frame-pump.ts';
import type { PlayerInput } from '@crimson/sim/input.ts';
import type { FrameContext } from '@crimson/sim/input-providers.ts';
import { LocalInputProvider } from '@crimson/sim/input-providers.ts';
import { PostApplyReaction, applyPostApplyReaction, buildPostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import { DeterministicSession } from '@crimson/sim/sessions.ts';
import type { TickBatchResult } from '@crimson/sim/tick-runner.ts';
import { TickRunner, TickRunnerConfig } from '@crimson/sim/tick-runner.ts';
import type { WorldRuntime } from '@crimson/world/runtime.ts';

export type WorldTickInputBuilder = (arg0: FrameContext) => readonly PlayerInput[];

// Standalone local runner for demo/debug screens outside BaseGameplayMode.
export class StandaloneTickHarness {
  gameMode: GameMode;
  buildInputs: WorldTickInputBuilder;
  tickRate: number;
  session: DeterministicSession | null;
  runner: TickRunner | null;
  worldState: unknown | null;
  playerCount: number;
  clock: FixedStepClock;
  frameIndex: number;
  nextTickIndex: number;

  constructor(opts: {
    gameMode: GameMode;
    buildInputs: WorldTickInputBuilder;
    tickRate?: number;
    session?: DeterministicSession | null;
    runner?: TickRunner | null;
    worldState?: unknown | null;
    playerCount?: number;
    clock?: FixedStepClock;
    frameIndex?: number;
    nextTickIndex?: number;
  }) {
    this.gameMode = opts.gameMode;
    this.buildInputs = opts.buildInputs;
    this.tickRate = opts.tickRate ?? 60;
    this.session = opts.session ?? null;
    this.runner = opts.runner ?? null;
    this.worldState = opts.worldState ?? null;
    this.playerCount = opts.playerCount ?? 0;
    this.frameIndex = opts.frameIndex ?? 0;
    this.nextTickIndex = opts.nextTickIndex ?? 0;
    this.tickRate = Math.max(1, int(this.tickRate));
    this.clock = new FixedStepClock({ tickRate: int(this.tickRate) });
  }

  reset(): void {
    this.session = null;
    this.runner = null;
    this.worldState = null;
    this.playerCount = 0;
    this.clock = new FixedStepClock({ tickRate: int(this.tickRate) });
    this.frameIndex = 0;
    this.nextTickIndex = 0;
  }

  _ensureRunner(runtime: WorldRuntime): [TickRunner, DeterministicSession] {
    const worldState = runtime.simWorld.worldState;
    const playerCount = runtime.simWorld.players.length;
    let session = this.session;
    let runner = this.runner;
    if (session !== null && runner !== null && this.worldState === worldState && int(this.playerCount) === int(playerCount)) {
      return [runner, session];
    }

    let detailPreset = 5;
    let violenceDisabled = 0;
    const config = runtime.config;
    if (config !== null) {
      detailPreset = config.display.detailPreset;
      violenceDisabled = config.display.violenceDisabled;
    }

    session = new DeterministicSession({ world: worldState, worldSize: runtime.worldSize, damageScaleByType: runtime.simWorld.damageScaleByType, gameMode: this.gameMode, detailPreset: int(detailPreset), violenceDisabled: int(violenceDisabled), gameTuneStarted: runtime.simWorld.gameTuneStarted, demoModeActive: runtime.demoModeActive, perkProgressionEnabled: false, applyWorldDtSteps: true });
    const provider = new LocalInputProvider({ playerCount: int(playerCount), buildInputs: this.buildInputs.bind(this) });
    runner = new TickRunner({ session: session, inputProvider: provider, config: new TickRunnerConfig() });
    this.session = session;
    this.runner = runner;
    this.worldState = worldState;
    this.playerCount = int(playerCount);
    this.clock = new FixedStepClock({ tickRate: int(this.tickRate) });
    this.frameIndex = 0;
    this.nextTickIndex = 0;
    return [runner, session];
  }

  _applyTickBatch(runtime: WorldRuntime, opts: { batch: TickBatchResult; session: DeterministicSession }): number {
    const batch = opts.batch;
    const session = opts.session;
    const outputs = applySimMetadataBatch({ simWorld: runtime.simWorld, completedResults: batch.completedResults, gameTuneStarted: session.gameTuneStarted });
    const reactions = new Map(Array.from(batch.completedResults, (result) => [int(result.sourceTick.tickIndex), buildPostApplyReaction({ tickResult: result })] as const));
    applyPresentationOutputs({
      outputs: outputs,
      syncAudioBridgeState: runtime.syncAudioBridgeState.bind(runtime),
      applyAudioPlan: (plan, shouldApplyAudio) => runtime.audioBridge.applyPlan({ plan: plan, applyAudio: shouldApplyAudio }),
      applyTerrainFx: runtime.renderResources.consumeTerrainFxBatch.bind(runtime.renderResources),
      updateCamera: runtime.updateCamera.bind(runtime),
      onOutputApplied: (output) => applyPostApplyReaction({ reaction: reactions.get(int(output.tickIndex)) ?? new PostApplyReaction(), playSfx: runtime.audioBridge.router.playSfx.bind(runtime.audioBridge.router) }),
      applyAudio: true,
    });
    return outputs.length;
  }

  advanceFrame(runtime: WorldRuntime, dt: number): number {
    if (runtime.simWorld.players.length === 0) {
      return 0;
    }
    runtime.terrainRuntime.processPending();
    const [runner, session] = this._ensureRunner(runtime);
    session.demoModeActive = runtime.demoModeActive;
    const ticksRequested = int(this.clock.advance(dt));
    const advance = advanceTickRunnerFrame({ runner: runner, startTick: int(this.nextTickIndex), frameIndex: int(this.frameIndex), ticksRequested: int(ticksRequested), dtSeconds: dt, tickDtSeconds: this.clock.dtTick, isNetworked: false, isReplay: false, refundClock: this.clock });
    this.frameIndex = int(advance.frameIndex);
    this.nextTickIndex = int(advance.nextTickIndex);
    return this._applyTickBatch(runtime, { batch: advance.batch, session: session });
  }

  ensureRunner(runtime: WorldRuntime): [TickRunner, DeterministicSession] {
    return this._ensureRunner(runtime);
  }

  applyTickBatch(runtime: WorldRuntime, opts: { batch: TickBatchResult; session: DeterministicSession }): number {
    const batch = opts.batch;
    const session = opts.session;
    return this._applyTickBatch(runtime, { batch: batch, session: session });
  }
}
