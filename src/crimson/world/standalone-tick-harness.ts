// Port of crimson/world/standalone_tick_harness.py

import { GameMode } from '@crimson/game-modes.ts';
import { applyPresentationOutputs, applySimMetadataBatch } from '@crimson/sim/batch-apply.ts';
import { FixedStepClock } from '@crimson/sim/clock.ts';
import { advanceTickRunnerFrame } from '@crimson/sim/frame-pump.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import { FrameContext, LocalInputProvider } from '@crimson/sim/input-providers.ts';
import { applyPostApplyReaction, buildPostApplyReaction, PostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import { DeterministicSession } from '@crimson/sim/sessions.ts';
import { TickBatchResult, TickRunner, TickRunnerConfig } from '@crimson/sim/tick-runner.ts';
import type { WorldRuntime } from '@crimson/world/runtime.ts';

export type WorldTickInputBuilder = (ctx: FrameContext) => readonly PlayerInput[];

// Standalone local runner for demo/debug screens outside BaseGameplayMode.
export class StandaloneTickHarness {
  gameMode: GameMode;
  buildInputs: WorldTickInputBuilder;
  tickRate: number;
  session: DeterministicSession | null = null;
  runner: TickRunner | null = null;
  worldState: object | null = null;
  playerCount = 0;
  clock: FixedStepClock;
  frameIndex = 0;
  nextTickIndex = 0;

  constructor(opts: {
    gameMode: GameMode;
    buildInputs: WorldTickInputBuilder;
    tickRate?: number;
  }) {
    this.gameMode = opts.gameMode;
    this.buildInputs = opts.buildInputs;
    this.tickRate = Math.max(1, int(opts.tickRate ?? 60));
    this.clock = new FixedStepClock({ tickRate: this.tickRate });
  }

  reset(): void {
    this.session = null;
    this.runner = null;
    this.worldState = null;
    this.playerCount = 0;
    this.clock = new FixedStepClock({ tickRate: this.tickRate });
    this.frameIndex = 0;
    this.nextTickIndex = 0;
  }

  private _ensureRunner(runtime: WorldRuntime): [TickRunner, DeterministicSession] {
    const worldState = runtime.simWorld.worldState;
    const playerCount = runtime.simWorld.players.length;

    if (
      this.session !== null &&
      this.runner !== null &&
      this.worldState === worldState &&
      int(this.playerCount) === int(playerCount)
    ) {
      return [this.runner, this.session];
    }

    let detailPreset = 5;
    let violenceDisabled = 0;
    const config = runtime.config;
    if (config !== null) {
      detailPreset = config.display.detailPreset;
      violenceDisabled = config.display.violenceDisabled;
    }

    const session = new DeterministicSession({
      world: worldState,
      worldSize: runtime.worldSize,
      damageScaleByType: runtime.simWorld.damageScaleByType,
      gameMode: this.gameMode,
      detailPreset: int(detailPreset),
      violenceDisabled: int(violenceDisabled),
      gameTuneStarted: Boolean(runtime.simWorld.gameTuneStarted),
      demoModeActive: Boolean(runtime.demoModeActive),
      perkProgressionEnabled: false,
      applyWorldDtSteps: true,
    });

    const provider = new LocalInputProvider({
      playerCount: int(playerCount),
      buildInputs: this.buildInputs,
    });

    const runner = new TickRunner({
      session,
      inputProvider: provider,
      config: new TickRunnerConfig(),
    });

    this.session = session;
    this.runner = runner;
    this.worldState = worldState;
    this.playerCount = int(playerCount);
    this.clock = new FixedStepClock({ tickRate: this.tickRate });
    this.frameIndex = 0;
    this.nextTickIndex = 0;
    return [runner, session];
  }

  private _applyTickBatch(
    runtime: WorldRuntime,
    opts: {
      batch: TickBatchResult,
      session: DeterministicSession,
    },
  ): number {
    const { batch, session } = opts;
    const outputs = applySimMetadataBatch({
      simWorld: runtime.simWorld,
      completedResults: batch.completedResults,
      gameTuneStarted: session.gameTuneStarted,
    });

    const reactions = new Map<number, PostApplyReaction>();
    for (const result of batch.completedResults) {
      reactions.set(
        int(result.sourceTick.tickIndex),
        buildPostApplyReaction({ tickResult: result }),
      );
    }

    applyPresentationOutputs({
      outputs,
      syncAudioBridgeState: () => runtime.syncAudioBridgeState(),
      applyAudioPlan: (plan, shouldApplyAudio) =>
        runtime.audioBridge.applyPlan({ plan, applyAudio: Boolean(shouldApplyAudio) }),
      applyTerrainFx: (batch) => runtime.renderResources.consumeTerrainFxBatch(batch),
      updateCamera: (dtSim) => runtime.updateCamera(dtSim),
      onOutputApplied: (output) => {
        const reaction = reactions.get(int(output.tickIndex)) ?? new PostApplyReaction();
        applyPostApplyReaction({
          reaction,
          playSfx: (sfx) => runtime.audioBridge.router.playSfx(sfx),
        });
      },
      applyAudio: true,
    });

    return outputs.length;
  }

  advanceFrame(runtime: WorldRuntime, dt: number): number {
    if (runtime.simWorld.players.length === 0) return 0;
    runtime.terrainRuntime.processPending();

    const [runner, session] = this._ensureRunner(runtime);
    session.demoModeActive = Boolean(runtime.demoModeActive);

    dt = Number(dt);
    const ticksRequested = int(this.clock.advance(dt));
    const advance = advanceTickRunnerFrame({
      runner,
      startTick: int(this.nextTickIndex),
      frameIndex: int(this.frameIndex),
      ticksRequested: int(ticksRequested),
      dtSeconds: dt,
      tickDtSeconds: this.clock.dtTick,
      isNetworked: false,
      isReplay: false,
      refundClock: this.clock,
    });

    this.frameIndex = int(advance.frameIndex);
    this.nextTickIndex = int(advance.nextTickIndex);

    return this._applyTickBatch(runtime, { batch: advance.batch, session });
  }
}
