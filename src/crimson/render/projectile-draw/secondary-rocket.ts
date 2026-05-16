// Port of crimson/render/projectile_draw/secondary_rocket.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { fxDetailEnabled } from '@grim/config.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { SecondaryProjectileTypeId } from '@crimson/projectiles/types.ts';
import type { SecondaryProjectileDrawCtx } from './types.ts';

export class SecondaryRocketStyle {
  readonly baseSize: number;
  readonly glowSize: number;
  readonly glowRgb: [number, number, number];
  readonly glowAlphaMul: number;

  constructor(opts: {
    baseSize: number;
    glowSize: number;
    glowRgb: [number, number, number];
    glowAlphaMul: number;
  }) {
    this.baseSize = opts.baseSize;
    this.glowSize = opts.glowSize;
    this.glowRgb = opts.glowRgb;
    this.glowAlphaMul = opts.glowAlphaMul;
  }
}

const ROCKET_STYLE_BY_TYPE: Map<number, SecondaryRocketStyle> = new Map([
  [SecondaryProjectileTypeId.ROCKET, new SecondaryRocketStyle({
    baseSize: 14.0,
    glowSize: 60.0,
    glowRgb: [1.0, 1.0, 1.0],
    glowAlphaMul: 0.68,
  })],
  [SecondaryProjectileTypeId.HOMING_ROCKET, new SecondaryRocketStyle({
    baseSize: 10.0,
    glowSize: 40.0,
    glowRgb: [1.0, 1.0, 1.0],
    glowAlphaMul: 0.58,
  })],
  [SecondaryProjectileTypeId.ROCKET_MINIGUN, new SecondaryRocketStyle({
    baseSize: 8.0,
    glowSize: 30.0,
    glowRgb: [0.7, 0.7, 1.0],
    glowAlphaMul: 0.158,
  })],
]);

function drawFilledCircle(center: Vec2, radius: number, color: wgl.Color): void {
  const segments = Math.max(24, int(radius * 1.5 + 0.5));
  const step = (Math.PI * 2.0) / segments;
  const white = wgl.getWhiteTexture();
  wgl.beginQuads(white);
  wgl.rlTexCoord2f(0.5, 0.5);
  wgl.rlColor4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    wgl.rlVertex2f(center.x, center.y);
    wgl.rlVertex2f(center.x, center.y);
    wgl.rlVertex2f(center.x + Math.cos(a0) * radius, center.y + Math.sin(a0) * radius);
    wgl.rlVertex2f(center.x + Math.cos(a1) * radius, center.y + Math.sin(a1) * radius);
  }
  wgl.endQuads();
}

function drawSecondaryRocketGlow(ctx: SecondaryProjectileDrawCtx, style: SecondaryRocketStyle): void {
  const renderer = ctx.renderer;
  const renderFrame = renderer.frame;
  const fxDetail1 = renderFrame.config !== null
    ? fxDetailEnabled(renderFrame.config.display, 1)
    : true;

  let particlesTexture;
  try {
    particlesTexture = getTexture(renderFrame.resources, TextureId.PARTICLES);
  } catch {
    particlesTexture = null;
  }
  if (!fxDetail1 || particlesTexture === null) return;

  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(EffectId.GLOW);
  if (atlas === undefined) return;
  const grid = SIZE_CODE_GRID.get(atlas.sizeCode);
  if (!grid) return;

  const frame = atlas.frame;
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const particleCellW = particlesTexture.width / grid;
  const particleCellH = particlesTexture.height / grid;
  const src = wgl.makeRectangle(
    particleCellW * col,
    particleCellH * row,
    Math.max(0.0, particleCellW - 2.0),
    Math.max(0.0, particleCellH - 2.0),
  );

  const direction = Vec2.fromHeading(ctx.angle);
  const scale = ctx.scale;
  const alpha = ctx.alpha;

  const drawRocketFx = (opts: { size: number; offset: number; rgba: RGBA }): void => {
    const fxAlpha = opts.rgba.a;
    if (fxAlpha <= 1e-3) return;
    const tint = opts.rgba.toWgl();
    const fxPos = ctx.screenPos.sub(direction.mul(opts.offset * scale));
    const dstSize = opts.size * scale;
    const dst = wgl.makeRectangle(fxPos.x, fxPos.y, dstSize, dstSize);
    const origin = wgl.makeVector2(dstSize * 0.5, dstSize * 0.5);
    wgl.drawTexturePro(particlesTexture!, src, dst, origin, 0.0, tint);
  };

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  // Large bloom around the rocket (effect_id=0x0D).
  drawRocketFx({ size: 140.0, offset: 5.0, rgba: new RGBA(1.0, 1.0, 1.0, alpha * 0.48) });

  const [glowR, glowG, glowB] = style.glowRgb;
  drawRocketFx({ size: style.glowSize, offset: 9.0, rgba: new RGBA(glowR, glowG, glowB, alpha * style.glowAlphaMul) });
  wgl.endBlendMode();
}

export function drawSecondaryRocket(ctx: SecondaryProjectileDrawCtx): boolean {
  const style = ROCKET_STYLE_BY_TYPE.get(int(ctx.projType));
  if (style === undefined) return false;

  const renderer = ctx.renderer;
  let texture;
  try {
    texture = getTexture(renderer.frame.resources, TextureId.PROJS);
  } catch {
    return false;
  }

  const cellW = texture.width / 4.0;
  if (cellW <= 1e-6) return true;

  const alpha = ctx.alpha;
  const spriteScale = (style.baseSize * ctx.scale) / cellW;
  const baseAlpha = clamp(alpha * 0.9, 0.0, 1.0);
  const baseTint = new RGBA(0.8, 0.8, 0.8, baseAlpha).toWgl();

  drawSecondaryRocketGlow(ctx, style);

  renderer.drawAtlasSprite(texture, {
    grid: 4,
    frame: 3,
    pos: ctx.screenPos,
    scale: spriteScale,
    rotationRad: ctx.angle,
    tint: baseTint,
  });
  return true;
}

export function drawSecondaryType4Fallback(ctx: SecondaryProjectileDrawCtx): boolean {
  if (int(ctx.projType) !== SecondaryProjectileTypeId.ROCKET_MINIGUN) return false;
  const scale = ctx.scale;
  const radius = Math.max(1.0, 12.0 * scale);
  const sp = ctx.screenPos;
  const tint = wgl.makeColor(200 / 255, 120 / 255, 1.0, int(255 * ctx.alpha + 0.5) / 255);
  drawFilledCircle(new Vec2(int(sp.x), int(sp.y)), radius, tint);
  return true;
}
