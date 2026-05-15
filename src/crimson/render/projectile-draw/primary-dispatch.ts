// Port of crimson/render/projectile_draw/primary_dispatch.py

import { drawBeamEffect } from '@crimson/render/projectile-draw/primary-beam.ts';
import { drawBulletTrail } from '@crimson/render/projectile-draw/primary-bullet.ts';
import { drawPlasmaParticles } from '@crimson/render/projectile-draw/primary-plasma.ts';
import { drawPlagueSpreader, drawPulseGun, drawSplitterOrBlade } from '@crimson/render/projectile-draw/primary-special.ts';
import type { ProjectileDrawCtx } from '@crimson/render/projectile-draw/types.ts';

const PRIMARY_PROJECTILE_DRAW_HANDLERS = [
  drawBulletTrail,
  drawPlasmaParticles,
  drawBeamEffect,
  drawPulseGun,
  drawSplitterOrBlade,
  drawPlagueSpreader,
];

export function drawProjectileFromRegistry(ctx: ProjectileDrawCtx): boolean {
  for (const handler of PRIMARY_PROJECTILE_DRAW_HANDLERS) {
    if (handler(ctx)) {
      return true;
    }
  }
  return false;
}
