// Port of crimson/replay/driver/setup.py

import type { Vec2 } from '@grim/geom.ts';
import { FxQueue, FxQueueRotated } from '@crimson/effects.ts';
import type { GameMode } from '@crimson/game-modes.ts';
import { f32 } from '@crimson/math-parity.ts';
import { GameStatus, GameStatusData } from '@crimson/persistence/save-status.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { timeScaleReflexBoostBonus as _timeScaleReflexBoostBonus } from '@crimson/sim/step-pipeline.ts';
import { mostUsedWeaponIdForPlayer } from '@crimson/weapon-runtime/index.ts';
import { WEAPON_TABLE, WeaponId } from '@crimson/weapons.ts';
import { resetWorldPlayers } from '@crimson/world/sim-world-state.ts';

export class ReplayRunnerError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ReplayRunnerError';
  }
}


export class RunResult {
  readonly gameModeId: GameMode;
  readonly tickRate: number;
  readonly ticks: number;
  readonly elapsedMs: number;
  readonly scoreXp: number;
  readonly creatureKillCount: number;
  readonly mostUsedWeaponId: WeaponId;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly rngState: number;

  constructor(opts: {
    gameModeId: GameMode;
    tickRate: number;
    ticks: number;
    elapsedMs: number;
    scoreXp: number;
    creatureKillCount: number;
    mostUsedWeaponId: WeaponId;
    shotsFired: number;
    shotsHit: number;
    rngState: number;
  }) {
    this.gameModeId = opts.gameModeId;
    this.tickRate = opts.tickRate;
    this.ticks = opts.ticks;
    this.elapsedMs = opts.elapsedMs;
    this.scoreXp = opts.scoreXp;
    this.creatureKillCount = opts.creatureKillCount;
    this.mostUsedWeaponId = opts.mostUsedWeaponId;
    this.shotsFired = opts.shotsFired;
    this.shotsHit = opts.shotsHit;
    this.rngState = opts.rngState;
  }
}

export function buildDamageScaleByType(): Map<number, number> {
  const damageScaleByType: Map<number, number> = new Map();
  for (const entry of WEAPON_TABLE) {
    if (entry.weaponId <= WeaponId.NONE) {
      continue;
    }
    damageScaleByType.set(entry.weaponId, entry.damageScale);
  }
  return damageScaleByType;
}

export function buildEmptyFxQueues(): [FxQueue, FxQueueRotated] {
  // Headless runners still need FX queues to satisfy sim APIs.
  return [new FxQueue(), new FxQueueRotated()];
}

export function statusFromReplayStatusFields(opts: { questUnlockIndex: number; questUnlockIndexFull: number; weaponUsageCounts?: readonly number[] }): GameStatus {
  const questUnlockIndex = opts.questUnlockIndex;
  const questUnlockIndexFull = opts.questUnlockIndexFull;
  const weaponUsageCounts = opts.weaponUsageCounts ?? [];
  return GameStatus.fromData({ path: 'replay://status', data: new GameStatusData({ questUnlockIndex: Math.trunc(questUnlockIndex), questUnlockIndexFull: Math.trunc(questUnlockIndexFull), weaponUsageCounts: Array.from(weaponUsageCounts) }) });
}

export function resetPlayers(players: PlayerState[], opts: { state: GameplayState; worldSize: number; playerCount: number; spawnPos?: Vec2 | null }): void {
  // Reset `players` to the classic initial layout used by runtime reset.

  const state = opts.state;
  const worldSize = opts.worldSize;
  const playerCount = opts.playerCount;
  const spawnPos = opts.spawnPos ?? null;
  resetWorldPlayers(
    players,
    { state: state, worldSize: worldSize, playerCount: Math.trunc(playerCount), spawnPos: spawnPos },
  );
}

export function player0Shots(state: GameplayState): [number, number] {
  if (state.shotsFired.length <= 0 || state.shotsHit.length <= 0) {
    return [0, 0];
  }
  let fired = Math.trunc(state.shotsFired[0]);
  let hit = Math.trunc(state.shotsHit[0]);
  fired = Math.max(0, Math.trunc(fired));
  hit = Math.max(0, Math.min(Math.trunc(hit), fired));
  return [fired, hit];
}

export function player0MostUsedWeaponId(state: GameplayState, players: PlayerState[]): WeaponId {
  let fallbackWeaponId = WeaponId.PISTOL;
  if (players.length > 0) {
    fallbackWeaponId = players[0].weapon.weaponId;
  }
  return mostUsedWeaponIdForPlayer(state, { playerIndex: 0, fallbackWeaponId: fallbackWeaponId });
}

export function timeScaleReflexBoostBonus(state: GameplayState, dt: number): number {
  // Time scale (Reflex Boost bonus), mirroring deterministic world-step timing.
  return _timeScaleReflexBoostBonus({ reflexBoostTimer: state.bonuses.reflexBoost, timeScaleActive: state.timeScaleActive, dt: dt });
}

export function timeScaleReflexBoostBonusF32(state: GameplayState, dt: number): number {
  // Time scale, preserving native float32 input rounding (dt_f32).
  const dtF32 = f32(dt);
  return timeScaleReflexBoostBonus(state, dtF32);
}
