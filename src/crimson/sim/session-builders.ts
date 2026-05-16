// Port of crimson/sim/session_builders.py

import { GameMode } from '@crimson/game-modes.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { SpawnEntry } from '@crimson/quests/types.ts';
import type { WorldState } from '@crimson/sim/world-state.ts';
import { resetTutorialState } from '@crimson/tutorial/index.ts';
import { tutorialBeforeStep, tutorialInputTransform, tutorialPostStep } from '@crimson/tutorial/runtime.ts';
import { typoBeforeStep, typoInputTransform, typoMidStep, typoPostStep } from '@crimson/typo/runtime.ts';
import { resetTypoState } from '@crimson/typo/state.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { DeterministicSession, QuestSpawnState, RushSpawnState, SurvivalSpawnState, questPostStep, rushInputTransform, rushMidStep, survivalMidStep } from '@crimson/sim/sessions.ts';

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

export function buildSurvivalSession(opts: { world: WorldState; worldSize: number; damageScaleByType: Map<number, number>; detailPreset: number; violenceDisabled: number; gameTuneStarted: boolean; finalizePostRenderLifecycle: boolean; applyWorldDtSteps?: boolean }): [DeterministicSession, SurvivalSpawnState] {
  const world = opts.world;
  const worldSize = opts.worldSize;
  const damageScaleByType = opts.damageScaleByType;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  const gameTuneStarted = opts.gameTuneStarted;
  const finalizePostRenderLifecycle = opts.finalizePostRenderLifecycle;
  const applyWorldDtSteps = opts.applyWorldDtSteps ?? false;
  const spawnState = new SurvivalSpawnState();
  const session = new DeterministicSession({ world: world, worldSize: worldSize, damageScaleByType: damageScaleByType, gameMode: GameMode.SURVIVAL, perkProgressionEnabled: true, detailPreset: detailPreset, violenceDisabled: violenceDisabled, gameTuneStarted: gameTuneStarted, applyWorldDtSteps: applyWorldDtSteps, finalizePostRenderLifecycle: finalizePostRenderLifecycle, midStepHook: (ctx) => survivalMidStep(ctx, spawnState) });
  return [session, spawnState];
}

export function buildRushSession(opts: { world: WorldState; worldSize: number; damageScaleByType: Map<number, number>; detailPreset: number; violenceDisabled: number; gameTuneStarted: boolean; finalizePostRenderLifecycle: boolean }): [DeterministicSession, RushSpawnState] {
  const world = opts.world;
  const worldSize = opts.worldSize;
  const damageScaleByType = opts.damageScaleByType;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  const gameTuneStarted = opts.gameTuneStarted;
  const finalizePostRenderLifecycle = opts.finalizePostRenderLifecycle;
  const spawnState = new RushSpawnState();
  const session = new DeterministicSession({ world: world, worldSize: worldSize, damageScaleByType: damageScaleByType, gameMode: GameMode.RUSH, perkProgressionEnabled: false, detailPreset: detailPreset, violenceDisabled: violenceDisabled, gameTuneStarted: gameTuneStarted, finalizePostRenderLifecycle: finalizePostRenderLifecycle, elapsedUsesRawDt: true, midStepHook: (ctx) => rushMidStep(ctx, spawnState), beforeStepHook: () => enforceRushLoadout(world), inputTransform: rushInputTransform });
  return [session, spawnState];
}

export function buildQuestSession(opts: { world: WorldState; worldSize: number; damageScaleByType: Map<number, number>; detailPreset: number; violenceDisabled: number; gameTuneStarted: boolean; demoModeActive: boolean; applyWorldDtSteps: boolean; finalizePostRenderLifecycle: boolean; spawnEntries: readonly SpawnEntry[]; questLevel: QuestLevel | null; startWeaponId: WeaponId | null }): [DeterministicSession, QuestSpawnState] {
  const world = opts.world;
  const worldSize = opts.worldSize;
  const damageScaleByType = opts.damageScaleByType;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  const gameTuneStarted = opts.gameTuneStarted;
  const demoModeActive = opts.demoModeActive;
  const applyWorldDtSteps = opts.applyWorldDtSteps;
  const finalizePostRenderLifecycle = opts.finalizePostRenderLifecycle;
  const spawnEntries = opts.spawnEntries;
  const questLevel = opts.questLevel;
  const startWeaponId = opts.startWeaponId;
  world.state.questLevel = questLevel;

  const weaponId = startWeaponId === null || startWeaponId === WeaponId.NONE ? WeaponId.PISTOL : startWeaponId;
  for (const player of world.players) {
    weaponAssignPlayer(player, weaponId, { state: world.state });
  }

  world.creatures.captureSpawnEventsAuthoritative = false;
  const questState = new QuestSpawnState({ spawnEntries: Array.from(spawnEntries) });
  const session = new DeterministicSession({ world: world, worldSize: worldSize, damageScaleByType: damageScaleByType, gameMode: GameMode.QUESTS, perkProgressionEnabled: true, detailPreset: detailPreset, violenceDisabled: violenceDisabled, gameTuneStarted: gameTuneStarted, demoModeActive: demoModeActive, applyWorldDtSteps: applyWorldDtSteps, finalizePostRenderLifecycle: finalizePostRenderLifecycle, postStepHook: (ctx) => questPostStep(ctx, questState) });
  return [session, questState];
}

export function buildTypoSession(opts: { world: WorldState; worldSize: number; damageScaleByType: Map<number, number>; detailPreset: number; violenceDisabled: number; gameTuneStarted: boolean; dictionaryWords?: readonly string[]; highscoreNames?: readonly string[] }): DeterministicSession {
  const world = opts.world;
  const worldSize = opts.worldSize;
  const damageScaleByType = opts.damageScaleByType;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  const gameTuneStarted = opts.gameTuneStarted;
  const dictionaryWords = opts.dictionaryWords ?? [];
  const highscoreNames = opts.highscoreNames ?? [];
  resetTypoState(
    world.state.typo,
    { creatureCapacity: world.creatures.entries.length, dictionaryWords: dictionaryWords, highscoreNames: highscoreNames },
  );
  const session = new DeterministicSession({ world: world, worldSize: worldSize, damageScaleByType: damageScaleByType, gameMode: GameMode.TYPO, perkProgressionEnabled: false, detailPreset: detailPreset, violenceDisabled: violenceDisabled, gameTuneStarted: gameTuneStarted, beforeStepHook: () => typoBeforeStep(world), midStepHook: typoMidStep, postStepHook: typoPostStep, inputTransform: (inputs) => typoInputTransform(world, inputs) });
  return session;
}

export function buildTutorialSession(opts: { world: WorldState; worldSize: number; damageScaleByType: Map<number, number>; detailPreset: number; violenceDisabled: number; gameTuneStarted: boolean; demoModeActive: boolean }): DeterministicSession {
  const world = opts.world;
  const worldSize = opts.worldSize;
  const damageScaleByType = opts.damageScaleByType;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  const gameTuneStarted = opts.gameTuneStarted;
  const demoModeActive = opts.demoModeActive;
  resetTutorialState(
    world.state.tutorial,
    world.state.tutorialOverlay,
    { preserveBugs: world.state.preserveBugs },
  );
  const session = new DeterministicSession({ world: world, worldSize: worldSize, damageScaleByType: damageScaleByType, gameMode: GameMode.TUTORIAL, perkProgressionEnabled: true, detailPreset: detailPreset, violenceDisabled: violenceDisabled, gameTuneStarted: gameTuneStarted, demoModeActive: demoModeActive, beforeStepHook: () => tutorialBeforeStep(world), postStepHook: tutorialPostStep, inputTransform: (inputs) => tutorialInputTransform(world, inputs) });
  return session;
}
