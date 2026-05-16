// Port of crimson/ui/cursor.py

import { Vec2 } from "@grim/geom.ts";
import * as wgl from '@wgl';
import { effectSrcRect, EffectId } from "@crimson/effects-atlas.ts";

export const CURSOR_EFFECT_ID: number = int(EffectId.GLOW);
const WHITE = wgl.makeColor(1, 1, 1, 1);
const ORIGIN = wgl.makeVector2(0, 0);

function clamp01(value: number): number {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

function drawCircleLines(x: number, y: number, radius: number, color: wgl.Color): void {
  const innerR = Math.max(0.0, radius - 0.5);
  const outerR = radius + 0.5;
  const segments = 36;
  const step = (Math.PI * 2.0) / segments;
  const white = wgl.getWhiteTexture();

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
}

function drawLine(x1: number, y1: number, x2: number, y2: number, color: wgl.Color): void {
  const ix1 = int(x1);
  const iy1 = int(y1);
  const ix2 = int(x2);
  const iy2 = int(y2);
  if (iy1 === iy2) {
    wgl.drawRectangle(Math.min(ix1, ix2), iy1, Math.abs(ix2 - ix1), 1, color);
    return;
  }
  if (ix1 === ix2) {
    wgl.drawRectangle(ix1, Math.min(iy1, iy2), 1, Math.abs(iy2 - iy1), color);
    return;
  }
  wgl.drawRectangle(ix1, iy1, ix2 - ix1, iy2 - iy1, color);
}

export function drawCursorGlow(
  particles: wgl.Texture | null,
  opts: {
    pos: Vec2;
    pulseTime?: number | null;
    effectId?: number;
  },
): void {
  if (particles === null) return;

  const pos = opts.pos;
  const pulseTime = opts.pulseTime ?? null;
  const effectId = opts.effectId ?? CURSOR_EFFECT_ID;

  const src = effectSrcRect(
    int(effectId),
    { textureWidth: particles.width, textureHeight: particles.height },
  );
  if (src === null) return;

  const srcRect = wgl.makeRectangle(src[0], src[1], src[2], src[3]);

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);

  if (pulseTime === null) {
    const dst = wgl.makeRectangle(pos.x - 32.0, pos.y - 32.0, 64.0, 64.0);
    wgl.drawTexturePro(particles, srcRect, dst, ORIGIN, 0.0, WHITE);
  } else {
    let alpha = (Math.pow(2.0, Math.sin(pulseTime)) + 2.0) * 0.32;
    alpha = clamp01(alpha);
    const tint = wgl.makeColor(1, 1, 1, int(alpha * 255.0 + 0.5) / 255);

    const offsets: [number, number, number][] = [
      [-28.0, -28.0, 64.0],
      [-10.0, -18.0, 64.0],
      [-18.0, -10.0, 64.0],
      [-48.0, -48.0, 128.0],
    ];

    for (const [dx, dy, size] of offsets) {
      const dst = wgl.makeRectangle(pos.x + dx, pos.y + dy, size, size);
      wgl.drawTexturePro(particles, srcRect, dst, ORIGIN, 0.0, tint);
    }
  }

  wgl.endBlendMode();
}

export function drawAimCursor(
  particles: wgl.Texture | null,
  aim: wgl.Texture | null,
  opts: {
    pos: Vec2;
  },
): void {
  const pos = opts.pos;
  drawCursorGlow(particles, { pos });

  if (aim === null) {
    const r = 235 / 255;
    const g = 235 / 255;
    const b = 235 / 255;
    const a = 220 / 255;
    const color = wgl.makeColor(r, g, b, a);

    drawCircleLines(int(pos.x), int(pos.y), 10, color);
    drawLine(int(pos.x - 14.0), int(pos.y), int(pos.x - 6.0), int(pos.y), color);
    drawLine(int(pos.x + 6.0), int(pos.y), int(pos.x + 14.0), int(pos.y), color);
    drawLine(int(pos.x), int(pos.y - 14.0), int(pos.x), int(pos.y - 6.0), color);
    drawLine(int(pos.x), int(pos.y + 6.0), int(pos.x), int(pos.y + 14.0), color);
    return;
  }

  const src = wgl.makeRectangle(0, 0, aim.width, aim.height);
  const dst = wgl.makeRectangle(pos.x - 10.0, pos.y - 10.0, 20.0, 20.0);
  wgl.drawTexturePro(aim, src, dst, ORIGIN, 0.0, WHITE);
}

export function drawMenuCursor(
  particles: wgl.Texture | null,
  cursor: wgl.Texture | null,
  opts: {
    pos: Vec2;
    pulseTime: number;
  },
): void {
  const pos = opts.pos;
  const pulseTime = opts.pulseTime;
  drawCursorGlow(particles, { pos, pulseTime });

  if (cursor === null) return;

  const src = wgl.makeRectangle(0, 0, cursor.width, cursor.height);
  const dst = wgl.makeRectangle(pos.x - 2.0, pos.y - 2.0, 32.0, 32.0);
  wgl.drawTexturePro(cursor, src, dst, ORIGIN, 0.0, WHITE);
}
