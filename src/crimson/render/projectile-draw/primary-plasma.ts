// Port of crimson/render/projectile_draw/primary_plasma.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { fxDetailEnabled } from '@grim/config.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { PLASMA_PARTICLE_TYPES } from '@crimson/sim/world-defs.ts';
import { plasmaProjectileRenderConfig } from '@crimson/render/projectile-render-registry.ts';
import type { ProjectileDrawCtx } from './types.ts';

export function drawPlasmaParticles(ctx: ProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  const renderFrame = renderer.frame;
  const resources = renderFrame.resources;
  const typeId = int(ctx.typeId);
  if (!PLASMA_PARTICLE_TYPES.has(typeId)) {
    return false;
  }

  let particlesTexture;
  try {
    particlesTexture = getTexture(resources, TextureId.PARTICLES);
  } catch {
    return false;
  }

  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(EffectId.GLOW);
  if (atlas === undefined) return false;
  const grid = SIZE_CODE_GRID.get(atlas.sizeCode);
  if (!grid) return false;

  const cellW = particlesTexture.width / grid;
  const cellH = particlesTexture.height / grid;
  const atlasFrame = atlas.frame;
  const col = atlasFrame % grid;
  const row = Math.floor(atlasFrame / grid);
  const src = wgl.makeRectangle(
    cellW * col,
    cellH * row,
    Math.max(0.0, cellW - 2.0),
    Math.max(0.0, cellH - 2.0),
  );

  const speedScale = ctx.proj.speedScale;
  const fxDetail1 = renderFrame.config !== null
    ? fxDetailEnabled(renderFrame.config.display, 1)
    : true;

  const plasmaCfg = plasmaProjectileRenderConfig(typeId);
  const rgb = plasmaCfg.rgb;
  const spacing = plasmaCfg.spacing;
  const segLimit = plasmaCfg.segLimit;
  const tailSize = plasmaCfg.tailSize;
  const headSize = plasmaCfg.headSize;
  const headAlphaMul = plasmaCfg.headAlphaMul;
  const auraRgb = plasmaCfg.auraRgb;
  const auraSize = plasmaCfg.auraSize;
  const auraAlphaMul = plasmaCfg.auraAlphaMul;

  if (ctx.life >= 0.4) {
    // Reconstruct the tail length heuristic used by the native render path.
    let segCount = int(ctx.proj.travelBudget);
    if (segCount < 0) segCount = 0;
    segCount = Math.floor(segCount / 5);
    if (segCount > segLimit) segCount = segLimit;

    // The stored projectile angle is rotated by +pi/2 vs travel direction.
    const direction = Vec2.fromHeading(ctx.angle + Math.PI).mul(speedScale);

    const alpha = ctx.alpha;
    const tailTint = new RGBA(rgb[0], rgb[1], rgb[2], alpha * 0.4).toWgl();
    const headTint = new RGBA(rgb[0], rgb[1], rgb[2], alpha * headAlphaMul).toWgl();
    const auraTint = new RGBA(auraRgb[0], auraRgb[1], auraRgb[2], alpha * auraAlphaMul).toWgl();

    wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);

    if (segCount > 0) {
      const size = tailSize * ctx.scale;
      const origin = wgl.makeVector2(size * 0.5, size * 0.5);
      const step = direction.mul(spacing);
      for (let idx = 0; idx < segCount; idx++) {
        const pos = ctx.pos.add(step.mul(idx));
        const posScreen = renderer.worldToScreen(pos);
        const dst = wgl.makeRectangle(posScreen.x, posScreen.y, size, size);
        wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, tailTint);
      }
    }

    {
      const size = headSize * ctx.scale;
      const origin = wgl.makeVector2(size * 0.5, size * 0.5);
      const dst = wgl.makeRectangle(ctx.screenPos.x, ctx.screenPos.y, size, size);
      wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, headTint);
    }

    if (fxDetail1) {
      const size = auraSize * ctx.scale;
      const origin = wgl.makeVector2(size * 0.5, size * 0.5);
      const dst = wgl.makeRectangle(ctx.screenPos.x, ctx.screenPos.y, size, size);
      wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, auraTint);
    }

    wgl.endBlendMode();
    return true;
  }

  const fade = clamp(ctx.life * 2.5, 0.0, 1.0);
  const fadeAlpha = fade * ctx.alpha;
  if (fadeAlpha > 1e-3) {
    const tint = new RGBA(1.0, 1.0, 1.0, fadeAlpha).toWgl();
    const size = 56.0 * ctx.scale;
    const dst = wgl.makeRectangle(ctx.screenPos.x, ctx.screenPos.y, size, size);
    const origin = wgl.makeVector2(size * 0.5, size * 0.5);
    wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
    wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, tint);
    wgl.endBlendMode();
  }

  return true;
}
