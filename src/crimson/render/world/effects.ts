// Port of crimson/render/world/effects.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { type EffectEntry, ParticleStyleId } from '@crimson/effects.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { RAD_TO_DEG } from './constants.ts';
import { WorldRenderCtx } from './context.ts';

function byteChannel(value: number): number {
  return int(clamp(value, 0.0, 1.0) * 255.0 + 0.5) / 255;
}

function colorFromRgba(r: number, g: number, b: number, a: number): wgl.Color {
  return wgl.makeColor(byteChannel(r), byteChannel(g), byteChannel(b), byteChannel(a));
}

function srcRectForEffect(
  effectId: number,
  texWidth: number,
  texHeight: number,
): wgl.Rectangle | null {
  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(effectId));
  if (atlas === undefined) return null;
  const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode));
  if (!grid) return null;
  const frame = int(atlas.frame);
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const cellW = texWidth / grid;
  const cellH = texHeight / grid;
  return wgl.makeRectangle(cellW * col, cellH * row, Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0));
}

export function drawParticlePool(
  renderCtx: WorldRenderCtx,
  opts: { camera: Vec2; viewScale: Vec2; alpha?: number },
): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const frame = renderCtx.frame;
  const texture = getTexture(frame.resources, TextureId.PARTICLES);
  const particles = frame.state.particles.entries;
  if (!particles.some((e) => e.active)) return;

  const scale = WorldRenderCtx.viewScaleAvg(viewScale);

  const srcLarge = srcRectForEffect(13, texture.width, texture.height);
  const srcNormal = srcRectForEffect(12, texture.width, texture.height);
  const srcStyle8 = srcRectForEffect(2, texture.width, texture.height);
  if (srcNormal === null || srcStyle8 === null) return;

  const config = frame.config;
  const fxDetail1 = config !== null ? config.display.fxDetailEnabled(1, true) : true;

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);

  if (fxDetail1 && srcLarge !== null) {
    const alphaByte = int(clamp(alpha * 0.065, 0.0, 1.0) * 255.0 + 0.5);
    const tint = wgl.makeColor(1, 1, 1, alphaByte / 255);
    for (let idx = 0; idx < particles.length; idx++) {
      const entry = particles[idx];
      if (!entry.active || (idx % 2) || int(entry.styleId) === int(ParticleStyleId.BUBBLEGUN)) continue;
      let radius = (Math.sin((1.0 - entry.intensity) * 1.5707964) + 0.1) * 55.0 + 4.0;
      radius = Math.max(radius, 16.0);
      const size = Math.max(0.0, radius * 2.0 * scale);
      if (size <= 0.0) continue;
      const screen = WorldRenderCtx.worldToScreenWith(entry.pos, { camera, viewScale });
      const dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      const origin = wgl.makeVector2(size * 0.5, size * 0.5);
      wgl.drawTexturePro(texture, srcLarge, dst, origin, 0.0, tint);
    }
  }

  for (const entry of particles) {
    if (!entry.active || int(entry.styleId) === int(ParticleStyleId.BUBBLEGUN)) continue;
    let radius = Math.sin((1.0 - entry.intensity) * 1.5707964) * 24.0;
    if (int(entry.styleId) === int(ParticleStyleId.BLOW_TORCH)) radius *= 0.8;
    radius = Math.max(radius, 2.0);
    const size = Math.max(0.0, radius * 2.0 * scale);
    if (size <= 0.0) continue;
    const screen = WorldRenderCtx.worldToScreenWith(entry.pos, { camera, viewScale });
    const dst = wgl.makeRectangle(screen.x, screen.y, size, size);
    const origin = wgl.makeVector2(size * 0.5, size * 0.5);
    const rotationDeg = entry.spin * RAD_TO_DEG;
    const tint = colorFromRgba(entry.scaleX, entry.scaleY, entry.scaleZ, entry.age * alpha);
    wgl.drawTexturePro(texture, srcNormal, dst, origin, rotationDeg, tint);
  }

  const alphaByte = int(clamp(alpha, 0.0, 1.0) * 255.0 + 0.5);
  for (const entry of particles) {
    if (!entry.active || int(entry.styleId) !== int(ParticleStyleId.BUBBLEGUN)) continue;
    const wobble = Math.sin(entry.spin) * 3.0;
    const halfH = (wobble + 15.0) * entry.scaleX * 7.0;
    const halfW = (15.0 - wobble) * entry.scaleX * 7.0;
    const w = Math.max(0.0, halfW * 2.0 * scale);
    const h = Math.max(0.0, halfH * 2.0 * scale);
    if (w <= 0.0 || h <= 0.0) continue;
    const screen = WorldRenderCtx.worldToScreenWith(entry.pos, { camera, viewScale });
    const dst = wgl.makeRectangle(screen.x, screen.y, w, h);
    const origin = wgl.makeVector2(w * 0.5, h * 0.5);
    const tint = wgl.makeColor(1, 1, 1, int(entry.age * alphaByte + 0.5) / 255);
    wgl.drawTexturePro(texture, srcStyle8, dst, origin, 0.0, tint);
  }

  wgl.endBlendMode();
}

export function drawSpriteEffectPool(
  renderCtx: WorldRenderCtx,
  opts: { camera: Vec2; viewScale: Vec2; alpha?: number },
): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const frame = renderCtx.frame;
  const config = frame.config;
  if (config !== null && !config.display.fxDetailEnabled(2, false)) return;

  const texture = getTexture(frame.resources, TextureId.PARTICLES);
  const effects = frame.state.spriteEffects.entries;
  if (!effects.some((e) => e.active)) return;

  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(EffectId.EXPLOSION_PUFF);
  if (atlas === undefined) return;
  const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode));
  if (!grid) return;
  const atlasFrame = int(atlas.frame);
  const col = atlasFrame % grid;
  const row = Math.floor(atlasFrame / grid);
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const src = wgl.makeRectangle(cellW * col, cellH * row, cellW, cellH);
  const scale = WorldRenderCtx.viewScaleAvg(viewScale);

  wgl.beginBlendMode(wgl.BlendMode.ALPHA);
  for (const entry of effects) {
    if (!entry.active) continue;
    const size = entry.scale * scale;
    if (size <= 0.0) continue;
    const screen = WorldRenderCtx.worldToScreenWith(entry.pos, { camera, viewScale });
    const dst = wgl.makeRectangle(screen.x, screen.y, size, size);
    const origin = wgl.makeVector2(size * 0.5, size * 0.5);
    const rotationDeg = entry.rotation * RAD_TO_DEG;
    const c = entry.color.scaledAlpha(alpha);
    const tint = colorFromRgba(c.r, c.g, c.b, c.a);
    wgl.drawTexturePro(texture, src, dst, origin, rotationDeg, tint);
  }
  wgl.endBlendMode();
}

export function drawEffectPool(
  renderCtx: WorldRenderCtx,
  opts: { camera: Vec2; viewScale: Vec2; alpha?: number },
): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const frame = renderCtx.frame;
  const texture = getTexture(frame.resources, TextureId.PARTICLES);
  const effects = frame.state.effects.entries;
  if (!effects.some((e) => e.flags && e.age >= 0.0)) return;

  const scale = WorldRenderCtx.viewScaleAvg(viewScale);

  const srcCache = new Map<number, wgl.Rectangle>();

  function srcRect(effectId: number): wgl.Rectangle | null {
    const cached = srcCache.get(effectId);
    if (cached !== undefined) return cached;

    const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(effectId));
    if (atlas === undefined) return null;
    const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode));
    if (!grid) return null;
    const f = int(atlas.frame);
    const col = f % grid;
    const row = Math.floor(f / grid);
    const cellW = texture.width / grid;
    const cellH = texture.height / grid;
    // Native effect pool clamps UVs to (cell_size - 2px) to avoid bleeding.
    const src = wgl.makeRectangle(
      cellW * col, cellH * row,
      Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0),
    );
    srcCache.set(effectId, src);
    return src;
  }

  function drawEntry(entry: EffectEntry): void {
    const effectId = int(entry.effectId);
    const src = srcRect(effectId);
    if (src === null) return;

    const screen = WorldRenderCtx.worldToScreenWith(entry.pos, { camera, viewScale });
    const halfW = entry.halfWidth;
    const halfH = entry.halfHeight;
    const localScale = entry.scale;
    const w = Math.max(0.0, halfW * 2.0 * localScale * scale);
    const h = Math.max(0.0, halfH * 2.0 * localScale * scale);
    if (w <= 0.0 || h <= 0.0) return;

    const rotationDeg = entry.rotation * RAD_TO_DEG;
    const c = entry.color.scaledAlpha(alpha);
    const tint = colorFromRgba(c.r, c.g, c.b, c.a);

    const dst = wgl.makeRectangle(screen.x, screen.y, w, h);
    const origin = wgl.makeVector2(w * 0.5, h * 0.5);
    wgl.drawTexturePro(texture, src, dst, origin, rotationDeg, tint);
  }

  wgl.beginBlendMode(wgl.BlendMode.ALPHA);
  for (const entry of effects) {
    if (!entry.flags || entry.age < 0.0) continue;
    if (int(entry.flags) & 0x40) drawEntry(entry);
  }

  wgl.endBlendMode();
  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  for (const entry of effects) {
    if (!entry.flags || entry.age < 0.0) continue;
    if (!(int(entry.flags) & 0x40)) drawEntry(entry);
  }

  wgl.endBlendMode();
}
