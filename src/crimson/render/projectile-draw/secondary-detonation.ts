// Port of crimson/render/projectile_draw/secondary_detonation.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import type { SecondaryProjectileDrawCtx } from './types.ts';

function drawCircleLines(x: number, y: number, radius: number, color: wgl.Color): void {
  const r = Math.max(1.0, radius);
  const innerR = Math.max(0.0, r - 0.5);
  const outerR = r + 0.5;
  const segments = Math.max(24, int(r * 0.25 + 24.0));
  const step = (Math.PI * 2.0) / segments;
  const white = wgl.getWhiteTexture();

  wgl.beginBlendMode(wgl.BlendMode.ALPHA);
  wgl.beginQuads(white);
  wgl.rlTexCoord2f(0.5, 0.5);
  wgl.rlColor4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    wgl.rlVertex2f(x + cos0 * innerR, y + sin0 * innerR);
    wgl.rlVertex2f(x + cos0 * outerR, y + sin0 * outerR);
    wgl.rlVertex2f(x + cos1 * outerR, y + sin1 * outerR);
    wgl.rlVertex2f(x + cos1 * innerR, y + sin1 * innerR);
  }
  wgl.endQuads();
  wgl.endBlendMode();
}

export function drawSecondaryDetonation(ctx: SecondaryProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  if (int(ctx.projType) !== 3) return false;

  // Secondary projectile detonation visuals (secondary_projectile_update + render).
  const t = clamp(ctx.proj.detonationT, 0.0, 1.0);
  const detScale = ctx.proj.detonationScale;
  const fade = (1.0 - t) * ctx.alpha;
  if (fade <= 1e-3 || detScale <= 1e-6) return true;

  const scale = ctx.scale;

  let particlesTexture: wgl.Texture | null;
  try {
    particlesTexture = getTexture(renderer.frame.resources, TextureId.PARTICLES);
  } catch {
    particlesTexture = null;
  }
  if (particlesTexture === null) {
    const radius = detScale * t * 80.0;
    const alphaByte = int(clamp((1.0 - t) * 180.0 * ctx.alpha, 0.0, 255.0) + 0.5);
    const color = wgl.makeColor(1.0, 180 / 255, 100 / 255, alphaByte / 255);
    drawCircleLines(int(ctx.screenPos.x), int(ctx.screenPos.y), Math.max(1.0, radius * scale), color);
    return true;
  }

  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(EffectId.GLOW);
  if (atlas === undefined) return true;
  const grid = SIZE_CODE_GRID.get(atlas.sizeCode);
  if (!grid) return true;
  const frame = atlas.frame;
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const cellW = particlesTexture.width / grid;
  const cellH = particlesTexture.height / grid;
  const src = wgl.makeRectangle(
    cellW * col,
    cellH * row,
    Math.max(0.0, cellW - 2.0),
    Math.max(0.0, cellH - 2.0),
  );

  const drawDetonationQuad = (opts: { size: number; alphaMul: number }): void => {
    const a = fade * opts.alphaMul;
    if (a <= 1e-3) return;
    const dstSize = opts.size * scale;
    if (dstSize <= 1e-3) return;
    const tint = new RGBA(1.0, 0.6, 0.1, a).toWgl();
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
