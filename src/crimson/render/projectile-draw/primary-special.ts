// Port of crimson/render/projectile_draw/primary_special.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { KNOWN_PROJ_FRAMES } from '@crimson/sim/world-defs.ts';
import { projOrigin } from '@crimson/render/projectile-draw/common.ts';
import type { ProjectileDrawCtx } from '@crimson/render/projectile-draw/types.ts';
import * as wgl from '@wgl';

function beginDarkenSrcZeroBlend(): void {
  // Native projectile_render switches Plague Spreader to D3D8 SRC=ZERO / DST=INVSRCALPHA.
  wgl.rlSetBlendFactorsSeparate(wgl.RL_ZERO, wgl.RL_ONE_MINUS_SRC_ALPHA, wgl.RL_FUNC_ADD, wgl.RL_ZERO, wgl.RL_ONE, wgl.RL_FUNC_ADD);
  wgl.beginBlendMode(wgl.BlendMode.CUSTOM);
  wgl.rlSetBlendFactorsSeparate(wgl.RL_ZERO, wgl.RL_ONE_MINUS_SRC_ALPHA, wgl.RL_FUNC_ADD, wgl.RL_ZERO, wgl.RL_ONE, wgl.RL_FUNC_ADD);
}

export function drawPulseGun(ctx: ProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  if (ctx.typeId !== ProjectileTemplateId.PULSE_GUN) {
    return false;
  }
  if (ctx.texture === null) {
    return false;
  }

  const mapping = KNOWN_PROJ_FRAMES.get(ctx.typeId) ?? null;
  if (mapping === null) {
    return true;
  }
  const [grid, frame] = mapping;
  const cellW = ctx.texture.width / grid;

  const alpha = ctx.alpha;
  const life = ctx.life;
  let desiredSize: number;
  let spriteScale: number;
  let tint: wgl.Color;
  if (life >= 0.4) {
    const origin = projOrigin(ctx.proj, ctx.pos);
    const dist = origin.distanceTo(ctx.pos);

    desiredSize = dist * 0.16 * ctx.scale;
    if (desiredSize <= 1e-3) {
      return true;
    }
    spriteScale = cellW > 1e-6 ? desiredSize / cellW : 0.0;
    if (spriteScale <= 1e-6) {
      return true;
    }

    tint = new RGBA(0.1, 0.6, 0.2, alpha * 0.7).toRl();
    wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
    renderer.drawAtlasSprite(
      ctx.texture,
      { grid: grid, frame: frame, pos: ctx.screenPos, scale: spriteScale, rotationRad: ctx.angle, tint: tint },
    );
    wgl.endBlendMode();
    return true;
  }

  const fade = clamp(life * 2.5, 0.0, 1.0);
  const fadeAlpha = fade * alpha;
  if (fadeAlpha <= 1e-3) {
    return true;
  }

  desiredSize = 56.0 * ctx.scale;
  spriteScale = cellW > 1e-6 ? desiredSize / cellW : 0.0;
  if (spriteScale <= 1e-6) {
    return true;
  }

  tint = new RGBA(1.0, 1.0, 1.0, fadeAlpha).toRl();
  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  renderer.drawAtlasSprite(
    ctx.texture,
    { grid: grid, frame: frame, pos: ctx.screenPos, scale: spriteScale, rotationRad: ctx.angle, tint: tint },
  );
  wgl.endBlendMode();
  return true;
}

export function drawSplitterOrBlade(ctx: ProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  const typeId = ctx.typeId;
  if (typeId !== ProjectileTemplateId.SPLITTER_GUN && typeId !== ProjectileTemplateId.BLADE_GUN) {
    return false;
  }
  if (ctx.texture === null) {
    return false;
  }

  const mapping = KNOWN_PROJ_FRAMES.get(typeId) ?? null;
  if (mapping === null) {
    return true;
  }
  const [grid, frame] = mapping;
  const cellW = ctx.texture.width / grid;

  if (ctx.life < 0.4) {
    return true;
  }

  const origin = projOrigin(ctx.proj, ctx.pos);
  const dist = origin.distanceTo(ctx.pos);

  const desiredSize = Math.min(dist, 20.0) * ctx.scale;
  if (desiredSize <= 1e-3) {
    return true;
  }

  const spriteScale = cellW > 1e-6 ? desiredSize / cellW : 0.0;
  if (spriteScale <= 1e-6) {
    return true;
  }

  let rotationRad = ctx.angle;
  let rgb: [number, number, number] = [1.0, 1.0, 1.0];
  if (typeId === ProjectileTemplateId.BLADE_GUN) {
    rotationRad = int(ctx.projIndex) * 0.1 - renderer.frame.elapsedMs * 0.1;
    rgb = [0.8, 0.8, 0.8];
  }

  const tint = new RGBA(rgb[0], rgb[1], rgb[2], ctx.alpha).toRl();
  renderer.drawAtlasSprite(
    ctx.texture,
    { grid: grid, frame: frame, pos: ctx.screenPos, scale: spriteScale, rotationRad: rotationRad, tint: tint },
  );
  return true;
}

export function drawPlagueSpreader(ctx: ProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  if (ctx.typeId !== ProjectileTemplateId.PLAGUE_SPREADER) {
    return false;
  }
  const texture = ctx.texture;
  if (texture === null) {
    return false;
  }

  const grid = 4;
  const frame = 2;
  const cellW = texture.width / grid;

  const alpha = ctx.alpha;
  const life = ctx.life;
  let tint: wgl.Color;
  if (life >= 0.4) {
    tint = new RGBA(1.0, 1.0, 1.0, alpha).toRl();

    const drawPlagueQuad = (opts: { pos: Vec2; size: number }): void => {
      const pos = opts.pos;
      const size = opts.size;
      if (size <= 1e-3) {
        return;
      }
      const desiredSize = size * ctx.scale;
      const spriteScale = cellW > 1e-6 ? desiredSize / cellW : 0.0;
      if (spriteScale <= 1e-6) {
        return;
      }
      const posScreen = renderer.worldToScreen(pos);
      renderer.drawAtlasSprite(
        texture,
        { grid: grid, frame: frame, pos: posScreen, scale: spriteScale, rotationRad: 0.0, tint: tint },
      );
    };

    beginDarkenSrcZeroBlend();
    let offset: ReturnType<typeof Vec2.fromHeading>;
    let phase: ReturnType<typeof int>;
    let cosPhase: ReturnType<typeof Math.cos>;
    let sinPhase: ReturnType<typeof Math.sin>;
    let sinPhase120: ReturnType<typeof Math.sin>;
    try {
      drawPlagueQuad({ pos: ctx.pos, size: 60.0 });

      offset = Vec2.fromHeading(ctx.angle + Math.PI).mul(15.0);
      drawPlagueQuad({
        pos: ctx.pos.add(offset),
        size: 60.0,
      });

      phase = int(ctx.projIndex) + renderer.frame.elapsedMs * 0.01;
      cosPhase = Math.cos(phase);
      sinPhase = Math.sin(phase);
      drawPlagueQuad({
        pos: ctx.pos.offset({ dx: cosPhase * cosPhase - 5.0, dy: sinPhase * 11.0 - 5.0 }),
        size: 52.0,
      });

      const phase120 = phase + 2.0943952;
      sinPhase120 = Math.sin(phase120);
      drawPlagueQuad({
        pos: ctx.pos.add(Vec2.fromPolar(phase120, 10.0)),
        size: 62.0,
      });

      const phase240 = phase + 4.1887903;
      drawPlagueQuad({
        pos: ctx.pos.add(new Vec2(Math.cos(phase240) * 10.0, Math.sin(phase240) * sinPhase120)),
        size: 62.0,
      });
    } finally {
      wgl.endBlendMode();
    }
    return true;
  }

  const fade = clamp(life * 2.5, 0.0, 1.0);
  const fadeAlpha = fade * alpha;
  if (fadeAlpha <= 1e-3) {
    return true;
  }

  const desiredSize = (fade * 40.0 + 32.0) * ctx.scale;
  const spriteScale = cellW > 1e-6 ? desiredSize / cellW : 0.0;
  if (spriteScale <= 1e-6) {
    return true;
  }

  tint = new RGBA(1.0, 1.0, 1.0, fadeAlpha).toRl();
  beginDarkenSrcZeroBlend();
  try {
    renderer.drawAtlasSprite(
      texture,
      { grid: grid, frame: frame, pos: ctx.screenPos, scale: spriteScale, rotationRad: 0.0, tint: tint },
    );
  } finally {
    wgl.endBlendMode();
  }
  return true;
}
