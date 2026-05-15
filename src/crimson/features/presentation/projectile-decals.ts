// Port of crimson/features/presentation/projectile_decals.py

import type { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { queueLargeHitDecalStreak } from '@crimson/bonuses/fire-bullets.ts';
import type { FxQueue } from '@crimson/effects.ts';
import type { ProjectileHit } from '@crimson/projectiles/types.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';

export function queueProjectileLargeStreakDecal(opts: { hit: ProjectileHit; baseAngle: number; fxQueue: FxQueue; rng: CrandLike; freezeOrigin?: Vec2 | null; spawnFreezeShard?: ((arg0: Vec2, arg1: number) => void) | null }): boolean {
  const hit = opts.hit;
  const baseAngle = opts.baseAngle;
  const fxQueue = opts.fxQueue;
  const rng = opts.rng;
  const freezeOrigin = opts.freezeOrigin ?? null;
  const spawnFreezeShard = opts.spawnFreezeShard ?? null;
  const typeId = hit.typeId;
  if (typeId !== ProjectileTemplateId.GAUSS_GUN && typeId !== ProjectileTemplateId.FIRE_BULLETS) {
    return false;
  }
  queueLargeHitDecalStreak({
    hit: hit,
    baseAngle: baseAngle,
    fxQueue: fxQueue,
    rng: rng,
    freezeOrigin: freezeOrigin,
    spawnFreezeShard: spawnFreezeShard,
  });
  return true;
}
