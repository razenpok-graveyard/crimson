// Port of crimson/render/world/effects.py

import { TextureId } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import type { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import { rl } from '@grim/raylib-api.ts';
import { EffectEntry, ParticleStyleId } from '@crimson/effects.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { RAD_TO_DEG } from '@crimson/render/world/constants.ts';
import { WorldRenderCtx } from '@crimson/render/world/context.ts';
import * as wgl from '@wgl';

export function drawParticlePool(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }
  let frame = renderCtx.frame;
  const texture = frame.resources.texture(TextureId.PARTICLES);

  const particles = frame.state.particles.entries;
  if (!particles.some((entry) => entry.active)) {
    return;
  }

  const scale = renderCtx._viewScaleAvg(viewScale);

  const srcRect = (effectId: number): rl.Rectangle | null => {
    const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(effectId)) ?? null;
    if (atlas === null) {
      return null;
    }
    const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
    if (!grid) {
      return null;
    }
    const frame = int(atlas.frame);
    const col = frame % grid;
    const row = Math.floor(frame / grid);
    const cellW = texture.width / grid;
    const cellH = texture.height / grid;
    return wgl.makeRectangle(cellW * col, cellH * row, Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0));
  };

  const srcLarge = srcRect(13);
  const srcNormal = srcRect(12);
  const srcStyle8 = srcRect(2);
  if (srcNormal === null || srcStyle8 === null) {
    return;
  }

  const fxDetail1 = frame.config !== null ? frame.config.display.fxDetailEnabled({ level: 1, default: true }) : true;

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);

  let alphaByte: number;
  let tint: wgl.Color;
  if (fxDetail1 && srcLarge !== null) {
    alphaByte = int(clamp(alpha * 0.065, 0.0, 1.0) * 255.0 + 0.5);
    tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alphaByte / 255);
    for (const [idx, entry] of particles.entries()) {
      if (!entry.active || (idx % 2) || int(entry.styleId) === int(ParticleStyleId.BUBBLEGUN)) {
        continue;
      }
      let radius = (Math.sin((1.0 - entry.intensity) * 1.5707964) + 0.1) * 55.0 + 4.0;
      radius = Math.max(radius, 16.0);
      let size = Math.max(0.0, radius * 2.0 * scale);
      if (size <= 0.0) {
        continue;
      }
      let screen = WorldRenderCtx._worldToScreenWith(entry.pos, { camera: camera, viewScale: viewScale });
      let dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      let origin = wgl.makeVector2(size * 0.5, size * 0.5);
      wgl.drawTexturePro(texture, srcLarge, dst, origin, 0.0, tint);
    }
  }

  for (const entry of particles) {
    if (!entry.active || int(entry.styleId) === int(ParticleStyleId.BUBBLEGUN)) {
      continue;
    }
    let radius = Math.sin((1.0 - entry.intensity) * 1.5707964) * 24.0;
    if (int(entry.styleId) === int(ParticleStyleId.BLOW_TORCH)) {
      radius *= 0.8;
    }
    radius = Math.max(radius, 2.0);
    let size = Math.max(0.0, radius * 2.0 * scale);
    if (size <= 0.0) {
      continue;
    }
    let screen = WorldRenderCtx._worldToScreenWith(entry.pos, { camera: camera, viewScale: viewScale });
    let dst = wgl.makeRectangle(screen.x, screen.y, size, size);
    let origin = wgl.makeVector2(size * 0.5, size * 0.5);
    const rotationDeg = entry.spin * RAD_TO_DEG;
    tint = new RGBA(entry.scaleX, entry.scaleY, entry.scaleZ, entry.age * alpha).toRl();
    wgl.drawTexturePro(texture, srcNormal, dst, origin, rotationDeg, tint);
  }

  alphaByte = int(clamp(alpha, 0.0, 1.0) * 255.0 + 0.5);
  for (const entry of particles) {
    if (!entry.active || int(entry.styleId) !== int(ParticleStyleId.BUBBLEGUN)) {
      continue;
    }
    const wobble = Math.sin(entry.spin) * 3.0;
    const halfH = (wobble + 15.0) * entry.scaleX * 7.0;
    const halfW = (15.0 - wobble) * entry.scaleX * 7.0;
    const w = Math.max(0.0, halfW * 2.0 * scale);
    const h = Math.max(0.0, halfH * 2.0 * scale);
    if (w <= 0.0 || h <= 0.0) {
      continue;
    }
    let screen = WorldRenderCtx._worldToScreenWith(entry.pos, { camera: camera, viewScale: viewScale });
    let dst = wgl.makeRectangle(screen.x, screen.y, w, h);
    let origin = wgl.makeVector2(w * 0.5, h * 0.5);
    tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(entry.age * alphaByte + 0.5) / 255);
    wgl.drawTexturePro(texture, srcStyle8, dst, origin, 0.0, tint);
  }

  wgl.endBlendMode();
}

export function drawSpriteEffectPool(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }
  let frame: typeof renderCtx.frame | number = renderCtx.frame;
  if (frame.config !== null && !frame.config.display.fxDetailEnabled({ level: 2, default: false })) {
    return;
  }
  const texture = frame.resources.texture(TextureId.PARTICLES);

  const effects = frame.state.spriteEffects.entries;
  if (!effects.some((entry) => entry.active)) {
    return;
  }

  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(EffectId.EXPLOSION_PUFF)) ?? null;
  if (atlas === null) {
    return;
  }
  const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
  if (!grid) {
    return;
  }
  frame = int(atlas.frame);
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const src = wgl.makeRectangle(cellW * col, cellH * row, cellW, cellH);
  const scale = renderCtx._viewScaleAvg(viewScale);

  wgl.beginBlendMode(wgl.BlendMode.ALPHA);
  for (const entry of effects) {
    if (!entry.active) {
      continue;
    }
    const size = entry.scale * scale;
    if (size <= 0.0) {
      continue;
    }
    const screen = WorldRenderCtx._worldToScreenWith(entry.pos, { camera: camera, viewScale: viewScale });
    const dst = wgl.makeRectangle(screen.x, screen.y, size, size);
    const origin = wgl.makeVector2(size * 0.5, size * 0.5);
    const rotationDeg = entry.rotation * RAD_TO_DEG;
    const tint = entry.color.scaledAlpha(alpha).toRl();
    wgl.drawTexturePro(texture, src, dst, origin, rotationDeg, tint);
  }
  wgl.endBlendMode();
}

export function drawEffectPool(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }
  let frame = renderCtx.frame;
  const texture = frame.resources.texture(TextureId.PARTICLES);

  const effects = frame.state.effects.entries;
  if (!effects.some((entry) => entry.flags && entry.age >= 0.0)) {
    return;
  }

  const scale = renderCtx._viewScaleAvg(viewScale);

  const srcCache: Map<number, rl.Rectangle> = new Map();

  const srcRect = (effectId: number): rl.Rectangle | null => {
    const cached = srcCache.get(effectId) ?? null;
    if (cached !== null) {
      return cached;
    }

    const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(effectId)) ?? null;
    if (atlas === null) {
      return null;
    }
    const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
    if (!grid) {
      return null;
    }
    const frame = int(atlas.frame);
    const col = frame % grid;
    const row = Math.floor(frame / grid);
    const cellW = texture.width / grid;
    const cellH = texture.height / grid;
    // Native effect pool clamps UVs to (cell_size - 2px) to avoid bleeding.
    const src = wgl.makeRectangle(cellW * col, cellH * row, Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0));
    srcCache.set(effectId, src);
    return src;
  };

  const drawEntry = (entry: EffectEntry): void => {
    const effectId = int(entry.effectId);
    const src = srcRect(effectId);
    if (src === null) {
      return;
    }

    const screen = WorldRenderCtx._worldToScreenWith(entry.pos, { camera: camera, viewScale: viewScale });

    const halfW = entry.halfWidth;
    const halfH = entry.halfHeight;
    const localScale = entry.scale;
    const w = Math.max(0.0, halfW * 2.0 * localScale * scale);
    const h = Math.max(0.0, halfH * 2.0 * localScale * scale);
    if (w <= 0.0 || h <= 0.0) {
      return;
    }

    const rotationDeg = entry.rotation * RAD_TO_DEG;
    const tint = entry.color.scaledAlpha(alpha).toRl();

    const dst = wgl.makeRectangle(screen.x, screen.y, w, h);
    const origin = wgl.makeVector2(w * 0.5, h * 0.5);
    wgl.drawTexturePro(texture, src, dst, origin, rotationDeg, tint);
  };

  wgl.beginBlendMode(wgl.BlendMode.ALPHA);
  for (const entry of effects) {
    if (!entry.flags || entry.age < 0.0) {
      continue;
    }
    if (int(entry.flags) & 0x40) {
      drawEntry(entry);
    }
  }
  wgl.endBlendMode();

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  for (const entry of effects) {
    if (!entry.flags || entry.age < 0.0) {
      continue;
    }
    if (!(int(entry.flags) & 0x40)) {
      drawEntry(entry);
    }
  }
  wgl.endBlendMode();
}
