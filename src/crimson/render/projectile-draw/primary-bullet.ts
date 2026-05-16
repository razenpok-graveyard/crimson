// Port of crimson/render/projectile_draw/primary_bullet.py

import { TextureId } from '@grim/assets.ts';
import { clamp } from '@grim/math.ts';
import { RAD_TO_DEG, projOrigin } from '@crimson/render/projectile-draw/common.ts';
import type { ProjectileDrawCtx } from '@crimson/render/projectile-draw/types.ts';
import * as wgl from '@wgl';

export function drawBulletTrail(ctx: ProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  const resources = renderer.frame.resources;
  const typeId = Math.trunc(ctx.typeId);
  if (!renderer.isBulletTrailType(typeId)) {
    return false;
  }

  const lifeAlpha = Math.trunc(clamp(ctx.life, 0.0, 1.0) * 255.0);
  const alphaByte = Math.trunc(clamp(lifeAlpha * ctx.alpha, 0.0, 255.0) + 0.5);
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
    const src = wgl.makeRectangle(0.0, 0.0, bullet.width, bullet.height);
    const dst = wgl.makeRectangle(ctx.screenPos.x, ctx.screenPos.y, size, size);
    origin = wgl.makeVector2(size * 0.5, size * 0.5);
    const tint = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, Math.trunc(alphaByte) / 255);
    wgl.drawTexturePro(bullet, src, dst, origin, ctx.angle * RAD_TO_DEG, tint);
    drawn = true;
  }

  return drawn;
}
