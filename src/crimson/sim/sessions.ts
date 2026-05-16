// Port of crimson/sim/sessions.py

import type { CrandLike } from '@grim/rand.ts';
import { RecordingCrand } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { advanceSurvivalSpawnStage, tickRushModeSpawns, tickSurvivalWaveSpawns } from '@crimson/creatures/spawn.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { survivalUpdateWeaponHandouts } from '@crimson/gameplay.ts';
import { preparePerkAvailability } from '@crimson/perks/availability.ts';
import { perkSelectionOpenChoices, perkSelectionPick } from '@crimson/perks/selection.ts';
import { tickQuestCompletionTransition } from '@crimson/quests/runtime.ts';
import { questSpawnTableEmpty, tickQuestModeSpawns } from '@crimson/quests/timeline.ts';
import type { SpawnEntry } from '@crimson/quests/types.ts';
import { applyTypoCommand } from '@crimson/typo/runtime.ts';
import { prepareWeaponAvailability } from '@crimson/weapon-runtime/availability.ts';
import { PlayerInput } from './input.ts';
import { normalizeInputFrame } from './input-frame.ts';
import type { GameCommand } from './input-providers.ts';
import { planWorldPresentationStep } from './presentation-step.ts';
import { DeterministicStepResult, PresentationRngTrace, timeScaleReflexBoostFactor } from './step-pipeline.ts';
import { TerrainFxScratch } from './terrain-fx.ts';
import { FrameTiming } from './timing.ts';
import type { WorldState } from './world-state.ts';

// ---------------------------------------------------------------------------
// Tick result types
// ---------------------------------------------------------------------------

export class DeterministicSessionTick {
  step: DeterministicStepResult;
  elapsedMs: number;
  creatureCountWorldStep: number;

  constructor(opts: {
    step: DeterministicStepResult;
    elapsedMs: number;
    creatureCountWorldStep: number;
  }) {
    this.step = opts.step;
    this.elapsedMs = opts.elapsedMs;
    this.creatureCountWorldStep = opts.creatureCountWorldStep;
  }
}

// ---------------------------------------------------------------------------
// Mid-/post-step hook system (spawn strategies)
// ---------------------------------------------------------------------------

export class MidStepContext {
  // Context passed to mid-step spawn hooks during deterministic stepping.

  readonly world: WorldState;
  readonly elapsedBeforeMs: number;
  readonly dtSimMs: number;
  readonly dtRawMs: number;
  readonly worldSize: number;

  constructor(opts: {
    world: WorldState;
    elapsedBeforeMs: number;
    dtSimMs: number;
    dtRawMs: number;
    worldSize: number;
  }) {
    this.world = opts.world;
    this.elapsedBeforeMs = opts.elapsedBeforeMs;
    this.dtSimMs = opts.dtSimMs;
    this.dtRawMs = opts.dtRawMs;
    this.worldSize = opts.worldSize;
  }
}

export type MidStepHook = (ctx: MidStepContext) => void;

export class PostStepContext {
  // Context passed to post-step hooks during deterministic stepping.

  readonly world: WorldState;
  readonly stepResult: DeterministicStepResult;
  readonly dtSimMs: number;
  readonly worldSize: number;
  readonly detailPreset: number;

  constructor(opts: {
    world: WorldState;
    stepResult: DeterministicStepResult;
    dtSimMs: number;
    worldSize: number;
    detailPreset: number;
  }) {
    this.world = opts.world;
    this.stepResult = opts.stepResult;
    this.dtSimMs = opts.dtSimMs;
    this.worldSize = opts.worldSize;
    this.detailPreset = opts.detailPreset;
  }
}

export type PostStepHook = (ctx: PostStepContext) => void;

export class SurvivalSpawnState {
  stage = 0;
  spawnCooldownMs = 0.0;

  constructor(opts: { stage?: number; spawnCooldownMs?: number } = {}) {
    this.stage = opts.stage ?? this.stage;
    this.spawnCooldownMs = opts.spawnCooldownMs ?? this.spawnCooldownMs;
  }
}

export class RushSpawnState {
  spawnCooldownMs = 0.0;

  constructor(opts: { spawnCooldownMs?: number } = {}) {
    this.spawnCooldownMs = opts.spawnCooldownMs ?? this.spawnCooldownMs;
  }
}

export class QuestSpawnState {
  spawnEntries: readonly SpawnEntry[] = [];
  spawnTimelineMs = 0.0;
  noCreaturesTimerMs = 0.0;
  completionTransitionMs = -1.0;
  completed = false;
  playHitSfx = false;
  playCompletionMusic = false;

  constructor(opts: {
    spawnEntries?: readonly SpawnEntry[];
    spawnTimelineMs?: number;
    noCreaturesTimerMs?: number;
    completionTransitionMs?: number;
    completed?: boolean;
    playHitSfx?: boolean;
    playCompletionMusic?: boolean;
  } = {}) {
    this.spawnEntries = Array.from(opts.spawnEntries ?? []);
    this.spawnTimelineMs = opts.spawnTimelineMs ?? this.spawnTimelineMs;
    this.noCreaturesTimerMs = opts.noCreaturesTimerMs ?? this.noCreaturesTimerMs;
    this.completionTransitionMs = opts.completionTransitionMs ?? this.completionTransitionMs;
    this.completed = opts.completed ?? this.completed;
    this.playHitSfx = opts.playHitSfx ?? this.playHitSfx;
    this.playCompletionMusic = opts.playCompletionMusic ?? this.playCompletionMusic;
  }
}

export function survivalMidStep(ctx: MidStepContext, spawn: SurvivalSpawnState): void {
  const state = ctx.world.state;

  survivalUpdateWeaponHandouts(state, ctx.world.players, { survivalElapsedMs: ctx.elapsedBeforeMs });

  const playerLevel = ctx.world.players.length > 0 ? ctx.world.players[0].level : 1;
  const [stage, milestoneCalls] = advanceSurvivalSpawnStage(spawn.stage, { playerLevel: int(playerLevel) });
  spawn.stage = stage;

  for (const call of milestoneCalls) {
    ctx.world.creatures.spawnTemplate(call.templateId, call.pos, call.heading, state.rng);
  }

  const playerXp = ctx.world.players.length > 0 ? ctx.world.players[0].experience : 0;
  const [cooldown, waveSpawns] = tickSurvivalWaveSpawns(
    spawn.spawnCooldownMs,
    ctx.dtSimMs,
    state.rng,
    {
      playerCount: ctx.world.players.length,
      survivalElapsedMs: ctx.elapsedBeforeMs,
      playerExperience: int(playerXp),
      terrainWidth: int(ctx.worldSize),
      terrainHeight: int(ctx.worldSize),
    },
  );
  spawn.spawnCooldownMs = cooldown;
  ctx.world.creatures.spawnInits(waveSpawns);
}

export function rushMidStep(ctx: MidStepContext, spawn: RushSpawnState): void {
  const state = ctx.world.state;
  const [cooldown, spawns] = tickRushModeSpawns(
    spawn.spawnCooldownMs,
    ctx.dtRawMs,
    state.rng,
    {
      playerCount: ctx.world.players.length,
      survivalElapsedMs: int(ctx.elapsedBeforeMs),
      terrainWidth: ctx.worldSize,
      terrainHeight: ctx.worldSize,
    },
  );
  spawn.spawnCooldownMs = cooldown;
  ctx.world.creatures.spawnInits(spawns);
}

export function questPostStep(ctx: PostStepContext, spawn: QuestSpawnState): void {
  const state = ctx.world.state;
  const dtMs = ctx.stepResult.timing.dtMsI32;
  const creaturesNoneActive = !ctx.world.creatures.entries.some((c) => c.active);

  const [
    entries,
    timelineMs,
    resultCreaturesNoneActive,
    noCreaturesTimerMs,
    spawns,
  ] = tickQuestModeSpawns(
    spawn.spawnEntries,
    spawn.spawnTimelineMs,
    dtMs,
    {
      terrainWidth: ctx.world.spawnEnv.terrainWidth,
      creaturesNoneActive,
      noCreaturesTimerMs: spawn.noCreaturesTimerMs,
    },
  );

  spawn.spawnEntries = entries;
  spawn.spawnTimelineMs = timelineMs;
  spawn.noCreaturesTimerMs = noCreaturesTimerMs;

  const spawnTableEmptyNow = questSpawnTableEmpty(spawn.spawnEntries);
  if (!state.demoModeActive && resultCreaturesNoneActive && spawnTableEmptyNow) {
    state.bonuses.reflexBoost = 0.0;
    state.timeScaleActive = false;
  }

  for (const call of spawns) {
    ctx.world.creatures.spawnTemplate(call.templateId, call.pos, call.heading, state.rng);
  }

  const anyAliveAfter = ctx.world.players.some((player) => player.health > 0.0);

  if (anyAliveAfter) {
    const [
      completionTransitionMs,
      completed,
      playHitSfx,
      playCompletionMusic,
    ] = tickQuestCompletionTransition(
      spawn.completionTransitionMs,
      dtMs,
      {
        creaturesNoneActive: resultCreaturesNoneActive,
        spawnTableEmpty: spawnTableEmptyNow,
      },
    );
    spawn.completionTransitionMs = completionTransitionMs;
    spawn.completed = completed;
    spawn.playHitSfx = playHitSfx;
    spawn.playCompletionMusic = playCompletionMusic;
  } else {
    spawn.completionTransitionMs = -1.0;
    spawn.completed = false;
    spawn.playHitSfx = false;
    spawn.playCompletionMusic = false;
  }
}

export function rushInputTransform(inputs: PlayerInput[]): PlayerInput[] {
  return inputs.map((inp) =>
    inp.reloadPressed ? new PlayerInput({
      move: inp.move,
      aim: inp.aim,
      moveMode: inp.moveMode,
      aimScheme: inp.aimScheme,
      fireDown: inp.fireDown,
      firePressed: inp.firePressed,
      reloadPressed: false,
      reloadDown: inp.reloadDown,
      moveToCursorPressed: inp.moveToCursorPressed,
      moveForwardPressed: inp.moveForwardPressed,
      moveBackwardPressed: inp.moveBackwardPressed,
      turnLeftPressed: inp.turnLeftPressed,
      turnRightPressed: inp.turnRightPressed,
    }) : inp,
  );
}

// ---------------------------------------------------------------------------
// Shared timing helper
// ---------------------------------------------------------------------------

function _sessionTiming(
  state: { timeScaleActive: boolean; bonuses: { reflexBoost: number } },
  dt: number,
): FrameTiming {
  // Compute frame timing from world state. Used by all session types.
  return FrameTiming.compute(dt, {
    timeScaleActiveEntry: Boolean(state.timeScaleActive),
    timeScaleFactor: timeScaleReflexBoostFactor({
      reflexBoostTimer: Number(state.bonuses.reflexBoost),
      timeScaleActive: Boolean(state.timeScaleActive),
    }),
    zeroGateActive: false,
  });
}

// ---------------------------------------------------------------------------
// Unified deterministic session (replaces Survival/Rush/Tutorial/Typo/WorldTick)
// ---------------------------------------------------------------------------

export interface DeterministicSessionOpts {
  world: WorldState;
  worldSize: number;
  damageScaleByType: Map<number, number>;
  gameMode: GameMode;
  perkProgressionEnabled: boolean;
  detailPreset?: number;
  violenceDisabled?: number;
  gameTuneStarted?: boolean;
  demoModeActive?: boolean;
  applyWorldDtSteps?: boolean;
  deferCameraShakeUpdate?: boolean;
  finalizePostRenderLifecycle?: boolean;
  elapsedUsesRawDt?: boolean;
  elapsedMs?: number;
  terrainFx?: TerrainFxScratch;
  midStepHook?: MidStepHook | null;
  postStepHook?: PostStepHook | null;
  beforeStepHook?: (() => void) | null;
  inputTransform?: ((inputs: PlayerInput[]) => PlayerInput[]) | null;
}

export class DeterministicSession {
  // Core state
  world: WorldState;
  worldSize: number;
  damageScaleByType: Map<number, number>;

  // Mode identity
  gameMode: GameMode;
  perkProgressionEnabled: boolean;

  // Sim config
  detailPreset: number;
  violenceDisabled: number;
  gameTuneStarted: boolean;
  demoModeActive: boolean;
  applyWorldDtSteps: boolean;
  deferCameraShakeUpdate: boolean;
  finalizePostRenderLifecycle: boolean;
  elapsedUsesRawDt: boolean;

  // Mutable timing
  elapsedMs: number;
  terrainFx: TerrainFxScratch;

  // Optional hooks (provided by modes / callers)
  midStepHook: MidStepHook | null;
  postStepHook: PostStepHook | null;
  beforeStepHook: (() => void) | null;
  inputTransform: ((inputs: PlayerInput[]) => PlayerInput[]) | null;

  constructor(opts: DeterministicSessionOpts) {
    this.world = opts.world;
    this.worldSize = opts.worldSize;
    this.damageScaleByType = opts.damageScaleByType;
    this.gameMode = opts.gameMode;
    this.perkProgressionEnabled = opts.perkProgressionEnabled;
    this.detailPreset = opts.detailPreset ?? 5;
    this.violenceDisabled = opts.violenceDisabled ?? 0;
    this.gameTuneStarted = opts.gameTuneStarted ?? false;
    this.demoModeActive = opts.demoModeActive ?? false;
    this.applyWorldDtSteps = opts.applyWorldDtSteps ?? true;
    this.deferCameraShakeUpdate = opts.deferCameraShakeUpdate ?? false;
    this.finalizePostRenderLifecycle = opts.finalizePostRenderLifecycle ?? false;
    this.elapsedUsesRawDt = opts.elapsedUsesRawDt ?? false;
    this.elapsedMs = opts.elapsedMs ?? 0.0;
    this.terrainFx = opts.terrainFx ?? new TerrainFxScratch();
    this.midStepHook = opts.midStepHook ?? null;
    this.postStepHook = opts.postStepHook ?? null;
    this.beforeStepHook = opts.beforeStepHook ?? null;
    this.inputTransform = opts.inputTransform ?? null;

    const state = this.world.state;
    state.gameMode = this.gameMode;
    state.demoModeActive = this.demoModeActive;
    prepareWeaponAvailability(state);
    preparePerkAvailability(state);
  }

  timingForDt(dt: number): FrameTiming {
    return _sessionTiming(this.world.state, dt);
  }

  stepTick(opts: {
    dt: number;
    inputs: PlayerInput[] | null;
    traceRng?: boolean;
    commands?: GameCommand[] | null;
  }): DeterministicSessionTick {
    const { dt, inputs } = opts;
    const traceRng = opts.traceRng ?? false;
    const commands = opts.commands ?? null;

    const timing = this.timingForDt(dt);

    if (this.beforeStepHook !== null) {
      this.beforeStepHook();
    }

    const postApplySfx: SfxId[] = [];
    if (commands !== null) {
      for (const cmd of commands) {
        const commandTypeName = cmd.constructor.name;
        switch (cmd.tag) {
          case 'perk_pick': {
            const ci = cmd.choiceIndex;
            const picked = perkSelectionPick(
              this.world.state,
              this.world.players,
              this.world.state.perkSelection,
              ci,
              {
                gameMode: this.gameMode,
                playerCount: this.world.players.length,
                dt: timing.dtSim,
                creatures: this.world.creatures.entries,
                refreshChoices: true,
              },
            );
            if (picked !== null) {
              postApplySfx.push(SfxId.UI_BONUS);
            }
            break;
          }
          case 'perk_menu_open': {
            perkSelectionOpenChoices(
              this.world.state,
              this.world.players,
              this.world.state.perkSelection,
              { gameMode: this.gameMode, playerCount: this.world.players.length },
            );
            break;
          }
          case 'typo_char':
          case 'typo_backspace':
          case 'typo_submit': {
            if (this.gameMode !== GameMode.TYPO) {
              throw new Error(`Typ-o command in non-Typo session: ${cmd.constructor.name}`);
            }
            applyTypoCommand(this.world, cmd);
            break;
          }
          default:
            throw new Error(`unhandled command type: ${commandTypeName}`);
        }
      }
    }

    let tickInputs = inputs;
    if (tickInputs !== null && this.inputTransform !== null) {
      tickInputs = this.inputTransform(tickInputs);
    }

    const state = this.world.state;
    const dtSimMs = timing.dtSimMsI32;
    const dtRawMs = timing.dtMsI32;
    const elapsedBeforeMs = this.elapsedMs;

    let hook: (() => void) | null = null;
    if (this.midStepHook !== null) {
      const ctx = new MidStepContext({
        world: this.world,
        elapsedBeforeMs,
        dtSimMs,
        dtRawMs,
        worldSize: this.worldSize,
      });
      const mid = this.midStepHook;
      hook = () => mid(ctx);
    }

    const fxQueue = this.terrainFx.decals;
    const fxQueueRotated = this.terrainFx.corpses;

    let presentationRng: CrandLike;
    let recordingRng: RecordingCrand | null = null;
    if (traceRng) {
      recordingRng = new RecordingCrand(state.rng);
      presentationRng = recordingRng;
    } else {
      presentationRng = state.rng;
    }

    const normalizedInputs = normalizeInputFrame(
      tickInputs,
      { playerCount: this.world.players.length },
    ).asList();

    state.gameMode = this.gameMode;
    state.demoModeActive = this.demoModeActive;

    const prevAudio: [number, boolean, number][] = this.world.players.map(
      (player) => [player.shotSeq, player.weapon.reloadActive, player.weapon.reloadTimer],
    );
    const prevPerkPending = this.world.state.perkSelection.pendingCount;

    const events = this.world.step(timing.dtSim, {
      inputs: normalizedInputs,
      fxQueue,
      fxQueueRotated,
      worldSize: this.worldSize,
      damageScaleByType: this.damageScaleByType,
      detailPreset: this.detailPreset,
      gameMode: this.gameMode,
      perkProgressionEnabled: this.perkProgressionEnabled,
      gameTuneStarted: this.gameTuneStarted,
      midStepHook: hook,
      dtPlayerLocal: timing.dtPlayerLocal,
      applyWorldDtSteps: this.applyWorldDtSteps,
      deferCameraShakeUpdate: this.deferCameraShakeUpdate,
      deferFreezeCorpseFx: false,
      violenceDisabled: this.violenceDisabled,
    });

    const presentationRngTrace = new PresentationRngTrace();

    const presT0 = performance.now();
    const presentation = planWorldPresentationStep({
      state: this.world.state,
      players: this.world.players,
      fxQueue,
      hits: events.hits,
      pickups: events.pickups,
      eventSfx: events.sfx,
      prevAudio,
      prevPerkPending,
      gameMode: this.gameMode,
      demoModeActive: this.demoModeActive,
      perkProgressionEnabled: this.perkProgressionEnabled,
      rng: presentationRng,
      detailPreset: this.detailPreset,
      violenceDisabled: this.violenceDisabled,
      gameTuneStarted: this.gameTuneStarted,
      triggerGameTune: events.triggerGameTune,
      hitSfx: events.hitSfx,
    });
    const presT1 = performance.now();
    const presentationPlanMs = presT1 - presT0;

    if (recordingRng !== null) {
      presentationRngTrace.drawsTotal = int(recordingRng.calls);
    }

    const terrainFxBatch = this.terrainFx.takeBatch();

    const step = new DeterministicStepResult({
      dtSim: timing.dtSim,
      timing,
      events,
      presentation,
      presentationPlanMs,
      presentationRngTrace,
      terrainFx: terrainFxBatch,
    });
    if (postApplySfx.length > 0) {
      step.postApplySfx = Array.from(postApplySfx);
    }

    if (step.presentation.triggerGameTune) {
      this.gameTuneStarted = true;
    }

    if (this.postStepHook !== null) {
      this.postStepHook(new PostStepContext({
        world: this.world,
        stepResult: step,
        dtSimMs,
        worldSize: this.worldSize,
        detailPreset: this.detailPreset,
      }));
    }

    const creatureCountWorldStep = this.world.creatures.entries.filter(c => c.active).length;

    if (this.finalizePostRenderLifecycle) {
      this.world.creatures.finalizePostRenderLifecycle();
    }

    const dtElapsed = this.elapsedUsesRawDt ? dtRawMs : dtSimMs;
    this.elapsedMs = elapsedBeforeMs + dtElapsed;

    return new DeterministicSessionTick({
      step,
      elapsedMs: this.elapsedMs,
      creatureCountWorldStep,
    });
  }
}
