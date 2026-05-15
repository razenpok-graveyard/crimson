// Port of crimson/sim/session_builders.py

import { GameMode } from '@crimson/game-modes.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { SpawnEntry } from '@crimson/quests/types.ts';
import type { PlayerInput } from './input.ts';
import type { WorldState } from './world-state.ts';
import { resetTutorialState } from '@crimson/tutorial/state.ts';
import { tutorialBeforeStep, tutorialInputTransform, tutorialPostStep } from '@crimson/tutorial/runtime.ts';
import { typoBeforeStep, typoInputTransform, typoMidStep, typoPostStep } from '@crimson/typo/runtime.ts';
import { resetTypoState } from '@crimson/typo/state.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { DeterministicSession, type MidStepContext, type PostStepContext, QuestSpawnState, RushSpawnState, SurvivalSpawnState, questPostStep, rushInputTransform, rushMidStep, survivalMidStep } from './sessions.ts';

export const RUSH_WEAPON_ID = WeaponId.ASSAULT_RIFLE;
export const RUSH_FORCED_AMMO = 30.0;

export function enforceRushLoadout(world: WorldState): void {
  for (const player of world.players) {
    if (player.weapon.weaponId !== RUSH_WEAPON_ID) {
      weaponAssignPlayer(player, RUSH_WEAPON_ID, { state: world.state });
    }
    // Native `rush_mode_update` forces assault rifle + 30 ammo every frame.
    player.weapon.ammo = RUSH_FORCED_AMMO;
  }
}

export function buildSurvivalSession(opts: {
  world: WorldState;
  worldSize: number;
  damageScaleByType: Map<number, number>;
  detailPreset: number;
  violenceDisabled: number;
  gameTuneStarted: boolean;
  finalizePostRenderLifecycle: boolean;
  applyWorldDtSteps?: boolean;
}): [DeterministicSession, SurvivalSpawnState] {
  const spawnState = new SurvivalSpawnState();
  const session = new DeterministicSession({
    world: opts.world,
    worldSize: opts.worldSize,
    damageScaleByType: opts.damageScaleByType,
    gameMode: GameMode.SURVIVAL,
    perkProgressionEnabled: true,
    detailPreset: opts.detailPreset,
    violenceDisabled: opts.violenceDisabled,
    gameTuneStarted: opts.gameTuneStarted,
    applyWorldDtSteps: opts.applyWorldDtSteps ?? false,
    finalizePostRenderLifecycle: opts.finalizePostRenderLifecycle,
    midStepHook: (ctx: MidStepContext) => survivalMidStep(ctx, spawnState),
  });
  return [session, spawnState];
}

export function buildRushSession(opts: {
  world: WorldState;
  worldSize: number;
  damageScaleByType: Map<number, number>;
  detailPreset: number;
  violenceDisabled: number;
  gameTuneStarted: boolean;
  finalizePostRenderLifecycle: boolean;
}): [DeterministicSession, RushSpawnState] {
  const spawnState = new RushSpawnState();
  const session = new DeterministicSession({
    world: opts.world,
    worldSize: opts.worldSize,
    damageScaleByType: opts.damageScaleByType,
    gameMode: GameMode.RUSH,
    perkProgressionEnabled: false,
    detailPreset: opts.detailPreset,
    violenceDisabled: opts.violenceDisabled,
    gameTuneStarted: opts.gameTuneStarted,
    finalizePostRenderLifecycle: opts.finalizePostRenderLifecycle,
    elapsedUsesRawDt: true,
    midStepHook: (ctx: MidStepContext) => rushMidStep(ctx, spawnState),
    beforeStepHook: () => enforceRushLoadout(opts.world),
    inputTransform: rushInputTransform,
  });
  return [session, spawnState];
}

export function buildQuestSession(opts: {
  world: WorldState;
  worldSize: number;
  damageScaleByType: Map<number, number>;
  detailPreset: number;
  violenceDisabled: number;
  gameTuneStarted: boolean;
  demoModeActive: boolean;
  applyWorldDtSteps: boolean;
  finalizePostRenderLifecycle: boolean;
  spawnEntries: SpawnEntry[];
  questLevel: QuestLevel | null;
  startWeaponId: WeaponId | null;
}): [DeterministicSession, QuestSpawnState] {
  opts.world.state.questLevel = opts.questLevel;

  const weaponId =
    opts.startWeaponId == null || opts.startWeaponId === WeaponId.NONE
      ? WeaponId.PISTOL
      : opts.startWeaponId;

  for (const player of opts.world.players) {
    weaponAssignPlayer(player, weaponId, { state: opts.world.state });
  }

  opts.world.creatures.captureSpawnEventsAuthoritative = false;

  const questState = new QuestSpawnState({ spawnEntries: opts.spawnEntries });

  const session = new DeterministicSession({
    world: opts.world,
    worldSize: opts.worldSize,
    damageScaleByType: opts.damageScaleByType,
    gameMode: GameMode.QUESTS,
    perkProgressionEnabled: true,
    detailPreset: opts.detailPreset,
    violenceDisabled: opts.violenceDisabled,
    gameTuneStarted: opts.gameTuneStarted,
    demoModeActive: opts.demoModeActive,
    applyWorldDtSteps: opts.applyWorldDtSteps,
    finalizePostRenderLifecycle: opts.finalizePostRenderLifecycle,
    postStepHook: (ctx: PostStepContext) => questPostStep(ctx, questState),
  });
  return [session, questState];
}

export function buildTypoSession(opts: {
  world: WorldState;
  worldSize: number;
  damageScaleByType: Map<number, number>;
  detailPreset: number;
  violenceDisabled: number;
  gameTuneStarted: boolean;
  dictionaryWords?: readonly string[];
  highscoreNames?: readonly string[];
}): DeterministicSession {
  const dictionaryWords = opts.dictionaryWords ?? [];
  const highscoreNames = opts.highscoreNames ?? [];

  resetTypoState(
    opts.world.state.typo,
    { creatureCapacity: opts.world.creatures.entries.length, dictionaryWords, highscoreNames },
  );

  const session = new DeterministicSession({
    world: opts.world,
    worldSize: opts.worldSize,
    damageScaleByType: opts.damageScaleByType,
    gameMode: GameMode.TYPO,
    perkProgressionEnabled: false,
    detailPreset: opts.detailPreset,
    violenceDisabled: opts.violenceDisabled,
    gameTuneStarted: opts.gameTuneStarted,
    beforeStepHook: () => typoBeforeStep(opts.world),
    midStepHook: typoMidStep,
    postStepHook: typoPostStep,
    inputTransform: (inputs: PlayerInput[]) =>
      typoInputTransform(opts.world, inputs),
  });
  return session;
}

export function buildTutorialSession(opts: {
  world: WorldState;
  worldSize: number;
  damageScaleByType: Map<number, number>;
  detailPreset: number;
  violenceDisabled: number;
  gameTuneStarted: boolean;
  demoModeActive: boolean;
}): DeterministicSession {
  resetTutorialState(
    opts.world.state.tutorial,
    opts.world.state.tutorialOverlay,
    { preserveBugs: opts.world.state.preserveBugs },
  );

  const session = new DeterministicSession({
    world: opts.world,
    worldSize: opts.worldSize,
    damageScaleByType: opts.damageScaleByType,
    gameMode: GameMode.TUTORIAL,
    perkProgressionEnabled: true,
    detailPreset: opts.detailPreset,
    violenceDisabled: opts.violenceDisabled,
    gameTuneStarted: opts.gameTuneStarted,
    demoModeActive: opts.demoModeActive,
    beforeStepHook: () => tutorialBeforeStep(opts.world),
    postStepHook: tutorialPostStep,
    inputTransform: (inputs: PlayerInput[]) =>
      tutorialInputTransform(opts.world, inputs),
  });
  return session;
}
