// Port of crimson/ui/cursor.py

import type { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import { EffectId, effectSrcRect } from '@crimson/effects-atlas.ts';
import * as wgl from '@wgl';

export const CURSOR_EFFECT_ID = int(EffectId.GLOW);

function clamp01(value: number): number {
  if (value < 0.0) {
    return 0.0;
  }
  if (value > 1.0) {
    return 1.0;
  }
  return value;
}

export function drawCursorGlow(particles: rl.Texture | null, opts: { pos: Vec2; pulseTime?: number | null; effectId?: number }): void {
  const pos = opts.pos;
  const pulseTime = opts.pulseTime ?? null;
  const effectId = opts.effectId ?? CURSOR_EFFECT_ID;
  if (particles === null) {
    return;
  }
  const src = effectSrcRect(int(effectId), { textureWidth: particles.width, textureHeight: particles.height });
  if (src === null) {
    return;
  }

  const srcRect = wgl.makeRectangle(src[0], src[1], src[2], src[3]);
  const origin = wgl.makeVector2(0.0, 0.0);

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  let dst: wgl.Rectangle;
  let alpha: number;
  if (pulseTime === null) {
    dst = wgl.makeRectangle(pos.x - 32.0, pos.y - 32.0, 64.0, 64.0);
    wgl.drawTexturePro(particles, srcRect, dst, origin, 0.0, wgl.makeColor(1, 1, 1, 1));
  } else {
    alpha = (Math.pow(2.0, Math.sin(pulseTime)) + 2.0) * 0.32;
    alpha = clamp01(alpha);
    const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(alpha * 255.0 + 0.5) / 255);
    for (const [dx, dy, size] of [
      [-28.0, -28.0, 64.0],
      [-10.0, -18.0, 64.0],
      [-18.0, -10.0, 64.0],
      [-48.0, -48.0, 128.0],
    ]) {
      dst = wgl.makeRectangle(pos.x + dx, pos.y + dy, size, size);
      wgl.drawTexturePro(particles, srcRect, dst, origin, 0.0, tint);
    }
  }
  wgl.endBlendMode();
}

export function drawAimCursor(particles: rl.Texture | null, aim: rl.Texture | null, opts: { pos: Vec2 }): void {
  const pos = opts.pos;
  drawCursorGlow(particles, { pos: pos });
  if (aim === null) {
    const color = wgl.makeColor(235 / 255, 235 / 255, 235 / 255, 220 / 255);
    wgl.drawCircleLines(int(pos.x), int(pos.y), 10, color);
    wgl.drawLine(int(pos.x - 14.0), int(pos.y), int(pos.x - 6.0), int(pos.y), color);
    wgl.drawLine(int(pos.x + 6.0), int(pos.y), int(pos.x + 14.0), int(pos.y), color);
    wgl.drawLine(int(pos.x), int(pos.y - 14.0), int(pos.x), int(pos.y - 6.0), color);
    wgl.drawLine(int(pos.x), int(pos.y + 6.0), int(pos.x), int(pos.y + 14.0), color);
    return;
  }
  const src = wgl.makeRectangle(0.0, 0.0, aim.width, aim.height);
  const dst = wgl.makeRectangle(pos.x - 10.0, pos.y - 10.0, 20.0, 20.0);
  wgl.drawTexturePro(aim, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
}

export function drawMenuCursor(particles: rl.Texture | null, cursor: rl.Texture | null, opts: { pos: Vec2; pulseTime: number }): void {
  const pos = opts.pos;
  const pulseTime = opts.pulseTime;
  drawCursorGlow(particles, { pos: pos, pulseTime: pulseTime });
  if (cursor === null) {
    return;
  }
  const src = wgl.makeRectangle(0.0, 0.0, cursor.width, cursor.height);
  const dst = wgl.makeRectangle(pos.x - 2.0, pos.y - 2.0, 32.0, 32.0);
  wgl.drawTexturePro(cursor, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
}
