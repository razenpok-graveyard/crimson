// Port of crimson/render/projectile_draw/primary_bullet.py

import { TextureId } from '@grim/assets.ts';
import { clamp } from '@grim/math.ts';
import { rl } from '@grim/raylib-api.ts';
import { RAD_TO_DEG, projOrigin } from '@crimson/render/projectile-draw/common.ts';
import type { ProjectileDrawCtx } from '@crimson/render/projectile-draw/types.ts';

export function drawBulletTrail(ctx: ProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  const resources = renderer.frame.resources;
  const typeId = int(ctx.typeId);
  if (!renderer.isBulletTrailType(typeId)) {
    return false;
  }

  const lifeAlpha = int(clamp(ctx.life, 0.0, 1.0) * 255.0);
  const alphaByte = int(clamp(lifeAlpha * ctx.alpha, 0.0, 255.0) + 0.5);
  let drawn = false;

  const bulletTrail = resources.texture(TextureId.BULLET_TRAIL);
  let origin: { x: number; y: number };
  if (bulletTrail !== null) {
    origin = projOrigin(ctx.proj, ctx.pos);
    const originScreen = renderer.worldToScreen(origin);
    drawn = renderer.drawBulletTrail(originScreen, ctx.screenPos, { typeId: typeId, alpha: alphaByte, scale: ctx.scale, angle: ctx.angle });
  }

  const bullet = resources.texture(TextureId.BULLET_I);
  if (bullet !== null && ctx.life >= 0.39) {
    const size = renderer.bulletSpriteSize(typeId, { scale: ctx.scale });
    const src = rl.makeRectangle(0.0, 0.0, bullet.width, bullet.height);
    const dst = rl.makeRectangle(ctx.screenPos.x, ctx.screenPos.y, size, size);
    origin = rl.makeVector2(size * 0.5, size * 0.5);
    const tint = rl.makeColor(220 / 255, 220 / 255, 220 / 255, int(alphaByte) / 255);
    rl.drawTexturePro(bullet, src, dst, origin, ctx.angle * RAD_TO_DEG, tint);
    drawn = true;
  }

  return drawn;
}
