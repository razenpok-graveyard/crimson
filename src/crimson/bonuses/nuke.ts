// Port of crimson/bonuses/nuke.py

import { Vec2 } from '@grim/geom.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { ownerRefForPlayer, projectileSpawn } from '@crimson/weapon-runtime/spawn.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyNuke(ctx: BonusApplyCtx): void {
  // `bonus_apply` (crimsonland.exe @ 0x00409890) starts screen shake via:
  //   camera_shake_pulses = 0x14;
  //   camera_shake_timer = 0.2f;
  ctx.state.cameraShakePulses = 0x14;
  ctx.state.cameraShakeTimer = 0.2;

  const origin = ctx.originPos;
  const rng = ctx.state.rng;

  let bulletCount = int(rng.rand({ caller: RngCallerStatic.BONUS_APPLY_NUKE_BULLET_COUNT })) & 3;
  bulletCount += 4;
  for (let i = 0; i < bulletCount; i++) {
    const angle = int(rng.rand({ caller: RngCallerStatic.BONUS_APPLY_NUKE_PISTOL_ANGLE })) % 628 * 0.01;
    const projId = projectileSpawn(ctx.state, { players: ctx.players, pos: origin, angle: angle, typeId: ProjectileTemplateId.PISTOL, owner: OwnerRef.fromLocalPlayer(0), ownerPlayerIndex: ctx.player.index });
    if (projId !== -1) {
      const speedScale = int(rng.rand({ caller: RngCallerStatic.BONUS_APPLY_NUKE_PISTOL_SPEED_SCALE })) % 50 * 0.01 + 0.5;
      ctx.state.projectiles.entries[projId].speedScale *= speedScale;
    }
  }

  const gaussAngle1 = int(rng.rand({ caller: RngCallerStatic.BONUS_APPLY_NUKE_GAUSS_ANGLE_1 })) % 628 * 0.01;
  projectileSpawn(
    ctx.state,
    { players: ctx.players, pos: origin, angle: gaussAngle1, typeId: ProjectileTemplateId.GAUSS_GUN, owner: OwnerRef.fromLocalPlayer(0), ownerPlayerIndex: ctx.player.index },
  );
  const gaussAngle2 = int(rng.rand({ caller: RngCallerStatic.BONUS_APPLY_NUKE_GAUSS_ANGLE_2 })) % 628 * 0.01;
  projectileSpawn(
    ctx.state,
    { players: ctx.players, pos: origin, angle: gaussAngle2, typeId: ProjectileTemplateId.GAUSS_GUN, owner: OwnerRef.fromLocalPlayer(0), ownerPlayerIndex: ctx.player.index },
  );

  ctx.state.effects.spawnExplosionBurst({
    pos: origin,
    scale: 1.0,
    rng: ctx.state.rng,
    detailPreset: int(ctx.detailPreset),
  });

  const creatures = ctx.creatures;
  if (creatures.length > 0) {
    const applyCreatureDamage = ctx.state.bonusPool.creatureDamageApplier;
    const prevGuard = ctx.state.bonusSpawnGuard;
    ctx.state.bonusSpawnGuard = true;
    for (const [idx, creature] of creatures.entries()) {
      // Native applies explosion damage to any active creature, including
      // those already in the death/corpse state (this shrinks corpses
      // faster via the hp<=0 path in creature_apply_damage).
      if (!creature.active) {
        continue;
      }
      const delta = creature.pos.sub(origin);
      if (Math.abs(delta.x) > 256.0 || Math.abs(delta.y) > 256.0) {
        continue;
      }
      const dist = delta.length();
      if (dist < 256.0) {
        const damage = (256.0 - dist) * 5.0;
        if (applyCreatureDamage !== null) {
          applyCreatureDamage(int(idx), damage, 3, new Vec2(), ownerRefForPlayer(ctx.player.index));
        } else {
          creature.hp -= damage;
        }
      }
    }
    ctx.state.bonusSpawnGuard = prevGuard;
  }

  ctx.state.sfxQueue.push(SfxId.EXPLOSION_LARGE);
  ctx.state.sfxQueue.push(SfxId.SHOCKWAVE);
}
