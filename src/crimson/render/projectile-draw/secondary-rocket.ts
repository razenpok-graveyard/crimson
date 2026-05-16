// Port of crimson/render/projectile_draw/secondary_rocket.py

import { TextureId } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { SecondaryProjectileTypeId } from '@crimson/projectiles/types.ts';
import type { SecondaryProjectileDrawCtx } from '@crimson/render/projectile-draw/types.ts';
import * as wgl from '@wgl';

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
  [SecondaryProjectileTypeId.ROCKET, new SecondaryRocketStyle({ baseSize: 14.0, glowSize: 60.0, glowRgb: [1.0, 1.0, 1.0], glowAlphaMul: 0.68 })],
  [SecondaryProjectileTypeId.HOMING_ROCKET, new SecondaryRocketStyle({ baseSize: 10.0, glowSize: 40.0, glowRgb: [1.0, 1.0, 1.0], glowAlphaMul: 0.58 })],
  [SecondaryProjectileTypeId.ROCKET_MINIGUN, new SecondaryRocketStyle({ baseSize: 8.0, glowSize: 30.0, glowRgb: [0.7, 0.7, 1.0], glowAlphaMul: 0.158 })],
]);

export function drawSecondaryRocket(ctx: SecondaryProjectileDrawCtx): boolean {
  const style = ROCKET_STYLE_BY_TYPE.get(ctx.projType) ?? null;
  if (style === null) {
    return false;
  }

  const renderer = ctx.renderer;
  const texture = renderer.frame.resources.texture(TextureId.PROJS);
  if (texture === null) {
    return false;
  }

  const cellW = texture.width / 4.0;
  if (cellW <= 1e-6) {
    return true;
  }

  const alpha = ctx.alpha;
  const spriteScale = (style.baseSize * ctx.scale) / cellW;
  const baseAlpha = clamp(alpha * 0.9, 0.0, 1.0);
  const baseTint = new RGBA(0.8, 0.8, 0.8, baseAlpha).toRl();

  drawSecondaryRocketGlow(ctx, { style: style });

  renderer._drawAtlasSprite(
    texture,
    { grid: 4, frame: 3, pos: ctx.screenPos, scale: spriteScale, rotationRad: ctx.angle, tint: baseTint },
  );
  return true;
}

export function drawSecondaryType4Fallback(ctx: SecondaryProjectileDrawCtx): boolean {
  if (ctx.projType !== SecondaryProjectileTypeId.ROCKET_MINIGUN) {
    return false;
  }
  wgl.drawCircle(int(ctx.screenPos.x), int(ctx.screenPos.y), Math.max(1.0, 12.0 * ctx.scale), wgl.makeColor(200 / 255, 120 / 255, 255 / 255, int(255 * ctx.alpha + 0.5) / 255));
  return true;
}

function drawSecondaryRocketGlow(ctx: SecondaryProjectileDrawCtx, opts: { style: SecondaryRocketStyle }): void {
  const style = opts.style;
  const renderer = ctx.renderer;
  const renderFrame = renderer.frame;
  const fxDetail1 = renderFrame.config !== null ? renderFrame.config.display.fxDetailEnabled({ level: 1, default: true }) : true;
  const particlesTexture = renderFrame.resources.texture(TextureId.PARTICLES);
  if (!fxDetail1 || particlesTexture === null) {
    return;
  }

  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(EffectId.GLOW)) ?? null;
  if (atlas === null) {
    return;
  }
  const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
  if (!grid) {
    return;
  }

  const frame = int(atlas.frame);
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const particleCellW = particlesTexture.width / grid;
  const particleCellH = particlesTexture.height / grid;
  const src = wgl.makeRectangle(particleCellW * col, particleCellH * row, Math.max(0.0, particleCellW - 2.0), Math.max(0.0, particleCellH - 2.0));

  const direction = Vec2.fromHeading(ctx.angle);
  const scale = ctx.scale;
  const alpha = ctx.alpha;

  const drawRocketFx = (opts: { size: number; offset: number; rgba: RGBA }): void => {
    const size = opts.size;
    const offset = opts.offset;
    const rgba = opts.rgba;
    const fxAlpha = rgba.a;
    if (fxAlpha <= 1e-3) {
      return;
    }
    const tint = rgba.toRl();
    const fxPos = ctx.screenPos.sub(direction.mul(offset * scale));
    const dstSize = size * scale;
    const dst = wgl.makeRectangle(fxPos.x, fxPos.y, dstSize, dstSize);
    const origin = wgl.makeVector2(dstSize * 0.5, dstSize * 0.5);
    wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, tint);
  };

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  // Large bloom around the rocket (effect_id=0x0D).
  drawRocketFx({ size: 140.0, offset: 5.0, rgba: new RGBA(1.0, 1.0, 1.0, alpha * 0.48) });

  const [glowR, glowG, glowB] = style.glowRgb;
  drawRocketFx({
    size: style.glowSize,
    offset: 9.0,
    rgba: new RGBA(glowR, glowG, glowB, alpha * style.glowAlphaMul),
  });
  wgl.endBlendMode();
}
