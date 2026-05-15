// Port of crimson/bonuses/fire_bullets.py

// Fire Bullets feature hooks for deterministic presentation output.

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import type { FxQueue } from '@crimson/effects.ts';
import { f32 } from '@crimson/math-parity.ts';
import type { ProjectileHit } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';
import { bonusApplySeconds } from '@crimson/bonuses/apply-context.ts';

export function applyFireBullets(ctx: BonusApplyCtx): void {
  let shouldRegister = ctx.player.fireBulletsTimer <= 0.0;
  if (ctx.players.length > 1) {
    shouldRegister = ctx.players[0].fireBulletsTimer <= 0.0 && ctx.players[1].fireBulletsTimer <= 0.0;
  }
  if (shouldRegister) {
    ctx.registerPlayer('fire_bullets_timer');
  }
  ctx.player.fireBulletsTimer = f32(ctx.player.fireBulletsTimer + bonusApplySeconds(ctx) * ctx.economistMultiplier);
  ctx.player.weaponResetLatch = 0;
  ctx.player.weapon.shotCooldown = 0.0;
  ctx.player.weapon.reloadActive = false;
  ctx.player.weapon.reloadTimer = 0.0;
  ctx.player.weapon.reloadTimerMax = 0.0;
  ctx.player.weapon.ammo = ctx.player.weapon.clipSize;
}

export function queueLargeHitDecalStreak(opts: { hit: ProjectileHit; baseAngle: number; fxQueue: FxQueue; rng: CrandLike; freezeOrigin?: Vec2 | null; spawnFreezeShard?: ((arg0: Vec2, arg1: number) => void) | null }): void {
  // Queue the large decal streak used by Fire Bullets impact hits.
  const hit = opts.hit;
  const baseAngle = opts.baseAngle;
  const fxQueue = opts.fxQueue;
  const rng = opts.rng;
  const freezeOrigin = opts.freezeOrigin ?? null;
  const spawnFreezeShard = opts.spawnFreezeShard ?? null;
  const direction = Vec2.fromAngle(baseAngle);
  for (let i = 0; i < 6; i++) {
    let dist = rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_LARGE_STREAK_DIST }) % 100 * 0.1;
    if (dist > 4.0) {
      dist = (rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_LARGE_STREAK_DIST_GT4 }) % 90 + 10) * 0.1;
    }
    if (dist > 7.0) {
      dist = (rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_LARGE_STREAK_DIST_GT7 }) % 80 + 20) * 0.1;
    }
    // Native `projectile_update` consumes one unconditional draw per loop
    // before the freeze branch (`crt_rand` @ 0x0042184c).
    rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_LARGE_STREAK_BURN });
    if (spawnFreezeShard !== null && freezeOrigin !== null) {
      const freezePos = freezeOrigin.add(direction.mul(dist * 20.0));
      const freezeAngle = baseAngle + rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_LARGE_STREAK_FREEZE_ANGLE }) % 100 * 0.01;
      spawnFreezeShard(freezePos, freezeAngle);
    }
    fxQueue.addRandom({
      pos: hit.target.add(direction.mul(dist * 20.0)),
      rng: rng,
    });
  }
}
