// Port of crimson/render/world/creatures.py

import type { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { creatureAnimSelectFrame } from '@crimson/creatures/anim.ts';
import type { CreatureTypeId } from '@crimson/creatures/spawn.ts';
import { CREATURE_ANIM } from '@crimson/sim/world-defs.ts';
import { RAD_TO_DEG } from '@crimson/render/world/constants.ts';
import type { WorldRenderCtx } from '@crimson/render/world/context.ts';
import * as wgl from '@wgl';

export function drawCreatureSprite(renderCtx: WorldRenderCtx, texture: rl.Texture, opts: { typeId: CreatureTypeId; flags: number; phase: number; mirrorLong?: boolean | null; shadowAlpha?: number | null; pos: Vec2; screenPos?: Vec2 | null; rotationRad: number; scale: number; sizeScale: number; tint: rl.Color; shadow?: boolean }): void {
  const typeId = opts.typeId;
  const flags = opts.flags;
  const phase = opts.phase;
  const mirrorLong = opts.mirrorLong ?? null;
  const shadowAlpha = opts.shadowAlpha ?? null;
  const pos = opts.pos;
  let screenPos = opts.screenPos ?? null;
  const rotationRad = opts.rotationRad;
  const scale = opts.scale;
  const sizeScale = opts.sizeScale;
  const tint = opts.tint;
  const shadow = opts.shadow ?? false;
  const info = CREATURE_ANIM.get(typeId) ?? null;
  if (info === null) {
    return;
  }
  const mirrorFlag = mirrorLong === null ? info.mirror : mirrorLong;
  // Long-strip mirroring is handled by frame index selection, not texture flips.
  const [index, , ] = creatureAnimSelectFrame(phase, { baseFrame: info.base, mirrorLong: mirrorFlag, flags: flags });
  if (index < 0) {
    return;
  }

  if (screenPos === null) {
    screenPos = renderCtx.worldToScreen(pos);
  }
  const width = texture.width / 8.0 * sizeScale * scale;
  const height = texture.height / 8.0 * sizeScale * scale;
  const srcX = index % 8 * Math.floor(texture.width / 8);
  const srcY = Math.floor(index / 8) * Math.floor(texture.height / 8);
  const src = wgl.makeRectangle(srcX, srcY, texture.width / 8.0, texture.height / 8.0);

  const rotationDeg = rotationRad * RAD_TO_DEG;

  if (shadow) {
    // In the original exe this is a "darken" blend pass gated by fx_detail_0
    // (creature_render_type). We approximate it with a black silhouette draw.
    // The observed pass is slightly bigger than the main sprite and offset
    // down-right by ~1px at default sizes.
    const alpha = shadowAlpha !== null ? int(shadowAlpha) : int(clamp((tint.a * 255) * 0.4, 0.0, 255.0) + 0.5);
    const shadowTint = wgl.makeColor(0 / 255, 0 / 255, 0 / 255, alpha / 255);
    const shadowScale = 1.07;
    const shadowW = width * shadowScale;
    const shadowH = height * shadowScale;
    const offset = width * 0.035 - 0.7 * scale;
    const shadowDst = wgl.makeRectangle(screenPos.x + offset, screenPos.y + offset, shadowW, shadowH);
    const shadowOrigin = wgl.makeVector2(shadowW * 0.5, shadowH * 0.5);
    wgl.drawTexturePro(texture, src, shadowDst, shadowOrigin, rotationDeg, shadowTint);
  }

  const dst = wgl.makeRectangle(screenPos.x, screenPos.y, width, height);
  const origin = wgl.makeVector2(width * 0.5, height * 0.5);
  wgl.drawTexturePro(texture, src, dst, origin, rotationDeg, tint);
}
