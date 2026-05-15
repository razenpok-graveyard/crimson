// Port of crimson/creatures/lifecycle.py

export const CREATURE_LIFECYCLE_ALIVE = 16.0;
export const CREATURE_LIFECYCLE_COLLIDABLE_MIN = 5.0;
export const CREATURE_CORPSE_DESPAWN_LIFECYCLE = -10.0;

export enum CreatureLifecyclePhase {
  ALIVE = 0,
  DEATH_STAGING = 1,
  CORPSE_FADING = 2,
  DESPAWNED = 3,
}

export function creatureLifecycleIsAlive(lifecycleStage: number): boolean {
  return lifecycleStage === CREATURE_LIFECYCLE_ALIVE;
}

export function creatureLifecycleIsCollidable(lifecycleStage: number): boolean {
  return lifecycleStage > CREATURE_LIFECYCLE_COLLIDABLE_MIN;
}

export function classifyCreatureLifecycle(lifecycleStage: number): CreatureLifecyclePhase {
  if (creatureLifecycleIsAlive(lifecycleStage)) {
    return CreatureLifecyclePhase.ALIVE;
  }
  if (lifecycleStage > 0.0) {
    return CreatureLifecyclePhase.DEATH_STAGING;
  }
  if (lifecycleStage >= CREATURE_CORPSE_DESPAWN_LIFECYCLE) {
    return CreatureLifecyclePhase.CORPSE_FADING;
  }
  return CreatureLifecyclePhase.DESPAWNED;
}
