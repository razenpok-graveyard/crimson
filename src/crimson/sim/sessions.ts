// Port of crimson/sim/sessions.py

import { CrandLike, RecordingCrand } from '@grim/rand.ts';
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
import type { PlayerInput } from '@crimson/sim/input.ts';
import { normalizeInputFrame } from '@crimson/sim/input-frame.ts';
import type { GameCommand } from '@crimson/sim/input-providers.ts';
import { PerkMenuOpenCommand, PerkPickCommand, TypoBackspaceCommand, TypoCharCommand, TypoSubmitCommand } from '@crimson/sim/input-providers.ts';
import { planWorldPresentationStep } from '@crimson/sim/presentation-step.ts';
import { DeterministicStepResult, PresentationRngTrace, timeScaleReflexBoostFactor } from '@crimson/sim/step-pipeline.ts';
import { TerrainFxScratch } from '@crimson/sim/terrain-fx.ts';
import { FrameTiming } from '@crimson/sim/timing.ts';
import type { WorldState } from '@crimson/sim/world-state.ts';

export type MidStepHook = (arg0: MidStepContext) => void;
export type PostStepHook = (arg0: PostStepContext) => void;

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

// Context passed to mid-step spawn hooks during deterministic stepping.
export class MidStepContext {
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

// Context passed to post-step hooks during deterministic stepping.
export class PostStepContext {
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

export class SurvivalSpawnState {
  stage: number;
  spawnCooldownMs: number;

  constructor(opts: {
    stage?: number;
    spawnCooldownMs?: number;
  } = {}) {
    this.stage = opts.stage ?? 0;
    this.spawnCooldownMs = opts.spawnCooldownMs ?? 0.0;
  }
}

export class RushSpawnState {
  spawnCooldownMs: number;

  constructor(opts: {
    spawnCooldownMs?: number;
  } = {}) {
    this.spawnCooldownMs = opts.spawnCooldownMs ?? 0.0;
  }
}

export class QuestSpawnState {
  spawnEntries: readonly SpawnEntry[];
  spawnTimelineMs: number;
  noCreaturesTimerMs: number;
  completionTransitionMs: number;
  completed: boolean;
  playHitSfx: boolean;
  playCompletionMusic: boolean;

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
    this.spawnTimelineMs = opts.spawnTimelineMs ?? 0.0;
    this.noCreaturesTimerMs = opts.noCreaturesTimerMs ?? 0.0;
    this.completionTransitionMs = opts.completionTransitionMs ?? -1.0;
    this.completed = opts.completed ?? false;
    this.playHitSfx = opts.playHitSfx ?? false;
    this.playCompletionMusic = opts.playCompletionMusic ?? false;
  }
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
  inputTransform: ((arg0: PlayerInput[]) => PlayerInput[]) | null;

  constructor(opts: {
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
    inputTransform?: ((arg0: PlayerInput[]) => PlayerInput[]) | null;
  }) {
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
    return sessionTiming(this.world.state, dt);
  }

  stepTick(opts: { dt: number; inputs: PlayerInput[] | null; traceRng?: boolean; commands?: GameCommand[] | null }): DeterministicSessionTick {
    const dt = opts.dt;
    const inputs = opts.inputs;
    const traceRng = opts.traceRng ?? false;
    const commands = opts.commands ?? null;
    const timing = this.timingForDt(dt);
    if (this.beforeStepHook !== null) {
      this.beforeStepHook();
    }

    const postApplySfx: SfxId[] = [];
    for (const cmd of (commands || [])) {
      if (cmd instanceof PerkPickCommand) {
        const ci = cmd.choiceIndex;
        const picked = perkSelectionPick(this.world.state, this.world.players, this.world.state.perkSelection, ci, { gameMode: this.gameMode, playerCount: this.world.players.length, dt: timing.dtSim, creatures: this.world.creatures.entries, refreshChoices: true });
        if (picked !== null) {
          postApplySfx.push(SfxId.UI_BONUS);
        }
      } else if (cmd instanceof PerkMenuOpenCommand) {
        perkSelectionOpenChoices(
          this.world.state,
          this.world.players,
          this.world.state.perkSelection,
          { gameMode: this.gameMode, playerCount: this.world.players.length },
        );
      } else if (cmd instanceof TypoCharCommand || cmd instanceof TypoBackspaceCommand || cmd instanceof TypoSubmitCommand) {
        if (this.gameMode !== GameMode.TYPO) {
          throw new Error(`Typ-o command in non-Typo session: ${((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(cmd)}`);
        }
        applyTypoCommand(this.world, cmd);
      } else {
        throw new Error(`unhandled command type: ${((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(cmd)}`);
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
      const ctx = new MidStepContext({ world: this.world, elapsedBeforeMs: elapsedBeforeMs, dtSimMs: dtSimMs, dtRawMs: dtRawMs, worldSize: this.worldSize });
      const mid = this.midStepHook;
      hook = () => mid(ctx); // noqa: E731
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

    const normalizedInputs = normalizeInputFrame(tickInputs, { playerCount: this.world.players.length }).asList();
    state.gameMode = this.gameMode;
    state.demoModeActive = this.demoModeActive;

    const prevAudio = this.world.players.map((player) => [player.shotSeq, player.weapon.reloadActive, player.weapon.reloadTimer] as [any, any, any]);
    const prevPerkPending = state.perkSelection.pendingCount;

    const events = this.world.step(timing.dtSim, { applyWorldDtSteps: this.applyWorldDtSteps, dtPlayerLocal: timing.dtPlayerLocal, deferCameraShakeUpdate: this.deferCameraShakeUpdate, deferFreezeCorpseFx: false, midStepHook: hook, inputs: normalizedInputs, worldSize: this.worldSize, damageScaleByType: this.damageScaleByType, detailPreset: this.detailPreset, violenceDisabled: this.violenceDisabled, fxQueue: fxQueue, fxQueueRotated: fxQueueRotated, gameMode: this.gameMode, perkProgressionEnabled: this.perkProgressionEnabled, gameTuneStarted: this.gameTuneStarted });

    const presentationTrace = new PresentationRngTrace();
    const planNsStart = (performance.now() * 1_000_000);
    const presentation = planWorldPresentationStep({ state: state, players: this.world.players, fxQueue: fxQueue, hits: events.hits, pickups: events.pickups, eventSfx: events.sfx, prevAudio: prevAudio, prevPerkPending: prevPerkPending, gameMode: this.gameMode, demoModeActive: this.demoModeActive, perkProgressionEnabled: this.perkProgressionEnabled, rng: presentationRng, detailPreset: this.detailPreset, violenceDisabled: this.violenceDisabled, gameTuneStarted: this.gameTuneStarted, triggerGameTune: events.triggerGameTune, hitSfx: events.hitSfx });
    const presentationPlanMs = ((performance.now() * 1_000_000) - planNsStart) / 1_000_000.0;
    if (recordingRng !== null) {
      presentationTrace.drawsTotal = int(recordingRng.calls);
    }

    let step = new DeterministicStepResult({ dtSim: timing.dtSim, timing: timing, events: events, presentation: presentation, presentationPlanMs: presentationPlanMs, presentationRngTrace: presentationTrace, terrainFx: this.terrainFx.takeBatch() });
    if (postApplySfx.length > 0) {
      step = (() => { const value = step; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, postApplySfx: Array.from(postApplySfx) }); })();
    }
    if (step.presentation.triggerGameTune) {
      this.gameTuneStarted = true;
    }

    if (this.postStepHook !== null) {
      this.postStepHook(new PostStepContext({ world: this.world, stepResult: step, dtSimMs: dtSimMs, worldSize: this.worldSize, detailPreset: this.detailPreset }));
    }

    const creatureCountWorldStep = this.world.creatures.entries.filter((c) => c.active).reduce((total, c) => total + 1, 0);

    if (this.finalizePostRenderLifecycle) {
      this.world.creatures.finalizePostRenderLifecycle();
    }

    const dtElapsed = this.elapsedUsesRawDt ? dtRawMs : dtSimMs;
    this.elapsedMs = elapsedBeforeMs + dtElapsed;

    return new DeterministicSessionTick({ step: step, elapsedMs: this.elapsedMs, creatureCountWorldStep: creatureCountWorldStep });
  }
}

export function survivalMidStep(ctx: MidStepContext, spawn: SurvivalSpawnState): void {
  const state = ctx.world.state;
  survivalUpdateWeaponHandouts(
    state,
    ctx.world.players,
    { survivalElapsedMs: ctx.elapsedBeforeMs },
  );

  const playerLevel = ctx.world.players.length > 0 ? ctx.world.players[0].level : 1;
  const [stage, milestoneCalls] = advanceSurvivalSpawnStage(spawn.stage, { playerLevel: int(playerLevel) });
  spawn.stage = stage;
  for (const call of milestoneCalls) {
    ctx.world.creatures.spawnTemplate(call.templateId, call.pos, call.heading, state.rng);
  }

  const playerXp = ctx.world.players.length > 0 ? ctx.world.players[0].experience : 0;
  const [cooldown, waveSpawns] = tickSurvivalWaveSpawns(spawn.spawnCooldownMs, ctx.dtSimMs, state.rng, { playerCount: ctx.world.players.length, survivalElapsedMs: ctx.elapsedBeforeMs, playerExperience: int(playerXp), terrainWidth: int(ctx.worldSize), terrainHeight: int(ctx.worldSize) });
  spawn.spawnCooldownMs = cooldown;
  ctx.world.creatures.spawnInits(waveSpawns);
}

export function rushMidStep(ctx: MidStepContext, spawn: RushSpawnState): void {
  const state = ctx.world.state;
  const [cooldown, spawns] = tickRushModeSpawns(spawn.spawnCooldownMs, ctx.dtRawMs, state.rng, { playerCount: ctx.world.players.length, survivalElapsedMs: int(ctx.elapsedBeforeMs), terrainWidth: ctx.worldSize, terrainHeight: ctx.worldSize });
  spawn.spawnCooldownMs = cooldown;
  ctx.world.creatures.spawnInits(spawns);
}

export function questPostStep(ctx: PostStepContext, spawn: QuestSpawnState): void {
  const state = ctx.world.state;
  const dtMs = ctx.stepResult.timing.dtMsI32;
  let creaturesNoneActive = !Array.from(ctx.world.creatures.entries).some((c) => c.active);

  let entries: any;
  let timelineMs: any;
  let noCreaturesTimerMs: any;
  let spawns: any;
  [entries, timelineMs, creaturesNoneActive, noCreaturesTimerMs, spawns] = tickQuestModeSpawns(spawn.spawnEntries, spawn.spawnTimelineMs, dtMs, { terrainWidth: ctx.world.spawnEnv.terrainWidth, creaturesNoneActive: creaturesNoneActive, noCreaturesTimerMs: spawn.noCreaturesTimerMs });
  spawn.spawnEntries = entries;
  spawn.spawnTimelineMs = timelineMs;
  spawn.noCreaturesTimerMs = noCreaturesTimerMs;
  const spawnTableEmptyNow = questSpawnTableEmpty(spawn.spawnEntries);

  if (!state.demoModeActive && creaturesNoneActive && spawnTableEmptyNow) {
    state.bonuses.reflexBoost = 0.0;
    state.timeScaleActive = false;
  }

  for (const call of spawns) {
    ctx.world.creatures.spawnTemplate(call.templateId, call.pos, call.heading, state.rng);
  }

  const anyAliveAfter = Array.from(ctx.world.players).some((player) => player.health > 0.0);
  if (anyAliveAfter) {
    const [completionMs, completed, playHitSfx, playCompletionMusic] = tickQuestCompletionTransition(spawn.completionTransitionMs, dtMs, { creaturesNoneActive: creaturesNoneActive, spawnTableEmpty: spawnTableEmptyNow });
    spawn.completionTransitionMs = completionMs;
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
  return inputs.map((inp) => inp.reloadPressed ? (() => { const value = inp; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, reloadPressed: false }); })() : inp);
}

function sessionTiming(state: any, dt: number): FrameTiming {
  // Compute frame timing from world state. Used by all session types.
  return FrameTiming.compute(dt, { timeScaleActiveEntry: state.timeScaleActive, timeScaleFactor: timeScaleReflexBoostFactor({ reflexBoostTimer: state.bonuses.reflexBoost, timeScaleActive: state.timeScaleActive }), zeroGateActive: false });
}
