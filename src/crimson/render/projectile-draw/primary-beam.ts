// Port of crimson/render/projectile_draw/primary_beam.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { creatureLifecycleIsCollidable } from '@crimson/creatures/lifecycle.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { drawBeamFastStampedBody, drawBeamFastStampedHead } from '@crimson/render/rtx/beam.ts';
import { RtxRenderMode } from '@crimson/render/rtx/mode.ts';
import { BEAM_TYPES, ION_TYPES } from '@crimson/sim/world-defs.ts';
import { beamEffectScale } from '@crimson/render/projectile-render-registry.ts';
import { RAD_TO_DEG, projOrigin } from './common.ts';
import type { ProjectileDrawCtx } from './types.ts';

function drawBeamBodySprites(opts: {
  ctx: ProjectileDrawCtx;
  origin: Vec2;
  direction: Vec2;
  dist: number;
  start: number;
  span: number;
  step: number;
  baseAlpha: number;
  streakRgb: [number, number, number];
  texture: wgl.Texture;
  grid: number;
  frame: number;
  spriteScale: number;
}): void {
  const { ctx, origin, direction, dist, start, span, step, baseAlpha, streakRgb, texture, grid, frame, spriteScale } = opts;
  const renderer = ctx.renderer;
  let s = start;
  while (s < dist) {
    const t = span > 1e-6 ? (s - start) / span : 1.0;
    const segAlpha = t * baseAlpha;
    if (segAlpha > 1e-3) {
      const pos = origin.add(direction.mul(s));
      const posScreen = renderer.worldToScreen(pos);
      const tint = new RGBA(streakRgb[0], streakRgb[1], streakRgb[2], segAlpha).toWgl();
      renderer.drawAtlasSprite(texture, {
        grid,
        frame,
        pos: posScreen,
        scale: spriteScale,
        rotationRad: 0.0,
        tint,
      });
    }
    s += step;
  }
}

export function drawBeamEffect(ctx: ProjectileDrawCtx): boolean {
  const renderer = ctx.renderer;
  const renderFrame = renderer.frame;
  const resources = renderFrame.resources;
  const typeId = int(ctx.typeId);
  const texture = ctx.texture;
  if (!BEAM_TYPES.has(typeId)) return false;
  if (texture === null) return false;

  // Ion weapons and Fire Bullets use the projs.png streak effect (and Ion adds chain arcs on impact).
  let grid = 4;
  let atlasFrame = 2;

  const isFireBullets = typeId === ProjectileTemplateId.FIRE_BULLETS;
  const isIon = ION_TYPES.has(typeId);

  const origin = projOrigin(ctx.proj, ctx.pos);
  const beam = ctx.pos.sub(origin);
  const [direction, dist] = beam.normalizedWithLength();
  if (dist <= 1e-6) return true;

  // In the native renderer, Ion Gun Master increases the chain effect thickness and reach.
  let perkScale = 1.0;
  for (const player of renderFrame.players) {
    if (perkActive(player, PerkId.ION_GUN_MASTER)) {
      perkScale = 1.2;
      break;
    }
  }

  const effectScale = beamEffectScale(typeId);

  const alpha = ctx.alpha;
  const life = ctx.life;
  let baseAlpha: number;
  if (life >= 0.4) {
    baseAlpha = alpha;
  } else {
    const fade = clamp(life * 2.5, 0.0, 1.0);
    baseAlpha = fade * alpha;
  }

  if (baseAlpha <= 1e-3) return true;

  const streakRgb: [number, number, number] = isFireBullets ? [1.0, 0.6, 0.1] : [0.5, 0.6, 1.0];
  const headRgb: [number, number, number] = [1.0, 1.0, 0.7];

  // Only draw the last 256 units of the path.
  let start = 0.0;
  let span = dist;
  if (dist > 256.0) {
    start = dist - 256.0;
    span = 256.0;
  }

  const step = Math.min(effectScale * 3.1, 9.0);
  const spriteScale = effectScale * ctx.scale;

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);

  if (renderFrame.rtxMode === RtxRenderMode.RTX) {
    drawBeamFastStampedBody({
      originScreen: renderer.worldToScreen(origin),
      headScreen: ctx.screenPos,
      startDistUnits: start,
      spanDistUnits: span,
      stepUnits: step,
      effectScale,
      scale: ctx.scale,
      baseAlpha,
      streakRgb,
    });
  } else {
    drawBeamBodySprites({
      ctx, origin, direction, dist, start, span, step,
      baseAlpha, streakRgb, texture, grid, frame: atlasFrame, spriteScale,
    });
  }

  if (life >= 0.4) {
    if (renderFrame.rtxMode === RtxRenderMode.RTX) {
      drawBeamFastStampedHead({
        centerScreen: ctx.screenPos,
        rotationRad: ctx.angle,
        effectScale,
        scale: ctx.scale,
        baseAlpha,
        headRgb,
        isFire: isFireBullets,
      });
    } else {
      const headTint = new RGBA(headRgb[0], headRgb[1], headRgb[2], baseAlpha).toWgl();
      renderer.drawAtlasSprite(texture, {
        grid,
        frame: atlasFrame,
        pos: ctx.screenPos,
        scale: spriteScale,
        rotationRad: ctx.angle,
        tint: headTint,
      });
    }

    // Fire Bullets renders an extra particles.png overlay in a later pass.
    if (isFireBullets) {
      let particlesTexture;
      try {
        particlesTexture = getTexture(resources, TextureId.PARTICLES);
      } catch {
        particlesTexture = null;
      }
      if (particlesTexture !== null) {
        const glowAtlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(EffectId.GLOW);
        if (glowAtlas !== undefined) {
          const glowGrid = SIZE_CODE_GRID.get(glowAtlas.sizeCode);
          if (glowGrid) {
            const cellW = particlesTexture.width / glowGrid;
            const cellH = particlesTexture.height / glowGrid;
            const glowFrame = glowAtlas.frame;
            const col = glowFrame % glowGrid;
            const row = Math.floor(glowFrame / glowGrid);
            const src = wgl.makeRectangle(
              cellW * col,
              cellH * row,
              Math.max(0.0, cellW - 2.0),
              Math.max(0.0, cellH - 2.0),
            );
            const tint = new RGBA(1.0, 1.0, 1.0, alpha).toWgl();
            const size = 64.0 * ctx.scale;
            const dst = wgl.makeRectangle(ctx.screenPos.x, ctx.screenPos.y, size, size);
            const texOrigin = wgl.makeVector2(size * 0.5, size * 0.5);
            wgl.drawTexturePro(particlesTexture, src, dst, texOrigin, ctx.angle * RAD_TO_DEG, tint);
          }
        }
      }
    }
  } else {
    // Native draws a small blue "core" at the head during the fade stage (life_timer < 0.4).
    const coreRgb: [number, number, number] = [0.5, 0.6, 1.0];
    if (renderFrame.rtxMode === RtxRenderMode.RTX) {
      drawBeamFastStampedHead({
        centerScreen: ctx.screenPos,
        rotationRad: ctx.angle,
        effectScale,
        scale: ctx.scale,
        baseAlpha,
        headRgb: coreRgb,
        isFire: isFireBullets,
      });
    } else {
      const coreTint = new RGBA(coreRgb[0], coreRgb[1], coreRgb[2], baseAlpha).toWgl();
      renderer.drawAtlasSprite(texture, {
        grid,
        frame: atlasFrame,
        pos: ctx.screenPos,
        scale: ctx.scale,
        rotationRad: ctx.angle,
        tint: coreTint,
      });
    }

    if (isIon) {
      // Native: chain reach is derived from the streak scale (`fVar29 * perk_scale * 40.0`).
      const radius = effectScale * perkScale * 40.0;

      // Native iterates via creature_find_in_radius(pos, radius, start_index) in pool order.
      const targets: Array<{ pos: Vec2; size: number }> = [];
      const entries = renderFrame.creatures.entries;
      for (let i = 1; i < entries.length; i++) {
        const creature = entries[i];
        if (!creature.active) continue;
        if (!creatureLifecycleIsCollidable(creature.lifecycleStage)) continue;
        const d = ctx.pos.distanceTo(creature.pos);
        const threshold = creature.size * 0.14285715 + 3.0;
        if (d - radius < threshold) {
          targets.push(creature);
        }
      }

      // Native uses beam effect scale for strip thickness (10x inner, 14x outer),
      // independent of Ion Gun Master. Perk scaling only affects chain reach.
      const innerHalf = 10.0 * effectScale * ctx.scale;
      const outerHalf = 14.0 * effectScale * ctx.scale;
      const u = 0.625;
      const v0 = 0.0;
      const v1 = 0.25;

      const glowTargets: Array<{ pos: Vec2 }> = [];
      wgl.beginQuads(texture);

      for (const creature of targets) {
        const targetScreen = renderer.worldToScreen(creature.pos);
        const segment = targetScreen.sub(ctx.screenPos);
        const [directionScreen, dlen] = segment.normalizedWithLength();
        if (dlen <= 1e-3) continue;
        glowTargets.push(creature);
        const side = directionScreen.perpLeft();

        // Outer strip (softer).
        const outerTint = new RGBA(0.5, 0.6, 1.0, baseAlpha);
        const { r: oR, g: oG, b: oB, a: oA } = outerTint.toWgl();
        let sideOffset = side.mul(outerHalf);
        let p0 = ctx.screenPos.sub(sideOffset);
        let p1 = ctx.screenPos.add(sideOffset);
        let p2 = targetScreen.add(sideOffset);
        let p3 = targetScreen.sub(sideOffset);

        wgl.rlColor4f(oR, oG, oB, oA);
        wgl.rlTexCoord2f(u, v0);
        wgl.rlVertex2f(p0.x, p0.y);
        wgl.rlTexCoord2f(u, v1);
        wgl.rlVertex2f(p1.x, p1.y);
        wgl.rlTexCoord2f(u, v1);
        wgl.rlVertex2f(p2.x, p2.y);
        wgl.rlTexCoord2f(u, v0);
        wgl.rlVertex2f(p3.x, p3.y);

        // Inner strip (brighter).
        const innerTint = new RGBA(0.5, 0.6, 1.0, baseAlpha);
        const { r: iR, g: iG, b: iB, a: iA } = innerTint.toWgl();
        sideOffset = side.mul(innerHalf);
        p0 = ctx.screenPos.sub(sideOffset);
        p1 = ctx.screenPos.add(sideOffset);
        p2 = targetScreen.add(sideOffset);
        p3 = targetScreen.sub(sideOffset);

        wgl.rlColor4f(iR, iG, iB, iA);
        wgl.rlTexCoord2f(u, v0);
        wgl.rlVertex2f(p0.x, p0.y);
        wgl.rlTexCoord2f(u, v1);
        wgl.rlVertex2f(p1.x, p1.y);
        wgl.rlTexCoord2f(u, v1);
        wgl.rlVertex2f(p2.x, p2.y);
        wgl.rlTexCoord2f(u, v0);
        wgl.rlVertex2f(p3.x, p3.y);
      }

      wgl.endQuads();

      for (const creature of glowTargets) {
        const targetScreen = renderer.worldToScreen(creature.pos);
        const targetTint = new RGBA(0.5, 0.6, 1.0, baseAlpha).toWgl();
        renderer.drawAtlasSprite(texture, {
          grid,
          frame: atlasFrame,
          pos: targetScreen,
          scale: spriteScale,
          rotationRad: 0.0,
          tint: targetTint,
        });
      }
    }
  }

  wgl.endBlendMode();
  return true;
}
