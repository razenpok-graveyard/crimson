// Port of crimson/sim/batch_apply.py

import type { TickResult } from '@crimson/sim/hooks.ts';
import type { PresentationStepCommands } from '@crimson/sim/presentation-step.ts';
import type { DeterministicStepResult } from '@crimson/sim/step-pipeline.ts';
import { TerrainFxBatch } from '@crimson/sim/terrain-fx.ts';
import type { WorldEvents } from '@crimson/sim/world-state.ts';

export interface SimMetadataSink {
  applyStepMetadata(opts: { events: WorldEvents; presentation: PresentationStepCommands; dtSim: number; gameTuneStarted: boolean }): void;
}

export class PresentationTickOutput {
  readonly tickIndex: number;
  readonly dtSim: number;
  readonly presentation: PresentationStepCommands | null;
  readonly terrainFx: TerrainFxBatch;

  constructor(opts: {
    tickIndex: number;
    dtSim: number;
    presentation: PresentationStepCommands | null;
    terrainFx?: TerrainFxBatch;
  }) {
    this.tickIndex = opts.tickIndex;
    this.dtSim = opts.dtSim;
    this.presentation = opts.presentation;
    this.terrainFx = opts.terrainFx ?? new TerrainFxBatch();
  }
}

export function applySimMetadataTickResult(opts: { simWorld: SimMetadataSink; tickResult: TickResult; gameTuneStarted: boolean }): PresentationTickOutput {
  const simWorld = opts.simWorld;
  const tickResult = opts.tickResult;
  const gameTuneStarted = opts.gameTuneStarted;
  const step = tickResult.payload.step;

  applyTickToSim({
    simWorld: simWorld,
    step: step,
    gameTuneStarted: gameTuneStarted,
  });
  return new PresentationTickOutput({ tickIndex: int(tickResult.sourceTick.tickIndex), dtSim: step.dtSim, presentation: step.presentation, terrainFx: step.terrainFx });
}

export function applyTickToSim(opts: { simWorld: SimMetadataSink; step: DeterministicStepResult; gameTuneStarted: boolean }): void {
  const simWorld = opts.simWorld;
  const step = opts.step;
  const gameTuneStarted = opts.gameTuneStarted;
  simWorld.applyStepMetadata({
    events: step.events,
    presentation: step.presentation,
    dtSim: step.dtSim,
    gameTuneStarted: gameTuneStarted,
  });
}

export function applySimMetadataBatch(opts: { simWorld: SimMetadataSink; completedResults: readonly TickResult[]; gameTuneStarted: boolean }): PresentationTickOutput[] {
  const simWorld = opts.simWorld;
  const completedResults = opts.completedResults;
  const gameTuneStarted = opts.gameTuneStarted;
  return completedResults.map((tickResult) => applySimMetadataTickResult({ simWorld: simWorld, tickResult: tickResult, gameTuneStarted: gameTuneStarted }));
}

export function applyPresentationOutputs(opts: { outputs: readonly PresentationTickOutput[]; syncAudioBridgeState: () => void; applyAudioPlan: (arg0: PresentationStepCommands, arg1: boolean) => void; applyTerrainFx: ((arg0: TerrainFxBatch) => void) | null; updateCamera: ((arg0: number) => void) | null; onOutputApplied?: ((arg0: PresentationTickOutput) => void) | null; applyAudio: boolean }): void {
  const outputs = opts.outputs;
  const syncAudioBridgeState = opts.syncAudioBridgeState;
  const applyAudioPlan = opts.applyAudioPlan;
  const applyTerrainFx = opts.applyTerrainFx;
  const updateCamera = opts.updateCamera;
  const onOutputApplied = opts.onOutputApplied ?? null;
  const applyAudio = opts.applyAudio;
  if (outputs.length === 0) {
    return;
  }

  syncAudioBridgeState();
  for (const output of outputs) {
    if (output.presentation !== null) {
      applyAudioPlan(output.presentation, applyAudio);
      if (updateCamera !== null) {
        updateCamera(output.dtSim);
      }
    }
    if (applyTerrainFx !== null && !output.terrainFx.isEmpty()) {
      applyTerrainFx(output.terrainFx);
    }
    if (onOutputApplied !== null) {
      onOutputApplied(output);
    }
  }
}
