// Port of crimson/debug_views/_ui_helpers.py

import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import type { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import * as wgl from '@wgl';

export function uiLineHeight(font: SmallFontData | null, opts: { scale?: number } = {}): number {
  const scale = opts.scale ?? 1.0;
  if (font !== null) {
    return Math.trunc(font.cellSize * scale);
  }
  return Math.trunc(20 * scale);
}

export function drawUiText(font: SmallFontData | null, text: string, pos: Vec2, opts: { color: rl.Color; scale?: number }): void {
  const color = opts.color;
  const scale = opts.scale ?? 1.0;
  if (font !== null) {
    drawSmallText(font, text, pos, color);
  } else {
    wgl.drawText(text, Math.trunc(pos.x), Math.trunc(pos.y), Math.trunc(20 * scale), color);
  }
}
