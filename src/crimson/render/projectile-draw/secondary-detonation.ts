// Port of crimson/render/projectile_draw/secondary_detonation.py

import { TextureId } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { clamp } from '@grim/math.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import type { SecondaryProjectileDrawCtx } from '@crimson/render/projectile-draw/types.ts';
import * as wgl from '@wgl';

export function drawSecondaryDetonation(ctx: SecondaryProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  if (int(ctx.projType) !== 3) {
    return false;
  }

  // Secondary projectile detonation visuals (secondary_projectile_update + render).
  const t = clamp(ctx.proj.detonationT, 0.0, 1.0);
  const detScale = ctx.proj.detonationScale;
  const fade = (1.0 - t) * ctx.alpha;
  if (fade <= 1e-3 || detScale <= 1e-6) {
    return true;
  }

  const scale = ctx.scale;
  const particlesTexture = renderer.frame.resources.texture(TextureId.PARTICLES);
  if (particlesTexture === null) {
    const radius = detScale * t * 80.0;
    const alphaByte = int(clamp((1.0 - t) * 180.0 * ctx.alpha, 0.0, 255.0) + 0.5);
    const color = wgl.makeColor(255 / 255, 180 / 255, 100 / 255, alphaByte / 255);
    wgl.drawCircleLines(int(ctx.screenPos.x), int(ctx.screenPos.y), Math.max(1.0, radius * scale), color);
    return true;
  }

  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(EffectId.GLOW)) ?? null;
  if (atlas === null) {
    return true;
  }
  const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
  if (!grid) {
    return true;
  }
  const frame = int(atlas.frame);
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const cellW = particlesTexture.width / grid;
  const cellH = particlesTexture.height / grid;
  const src = wgl.makeRectangle(cellW * col, cellH * row, Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0));

  const drawDetonationQuad = (opts: { size: number; alphaMul: number }): void => {
    const size = opts.size;
    const alphaMul = opts.alphaMul;
    const a = fade * alphaMul;
    if (a <= 1e-3) {
      return;
    }
    const dstSize = size * scale;
    if (dstSize <= 1e-3) {
      return;
    }
    const tint = new RGBA(1.0, 0.6, 0.1, a).toRl();
    const dst = wgl.makeRectangle(ctx.screenPos.x, ctx.screenPos.y, dstSize, dstSize);
    const origin = wgl.makeVector2(dstSize * 0.5, dstSize * 0.5);
    wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, tint);
  };

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  drawDetonationQuad({ size: detScale * t * 64.0, alphaMul: 1.0 });
  drawDetonationQuad({ size: detScale * t * 200.0, alphaMul: 0.3 });
  wgl.endBlendMode();
  return true;
}
