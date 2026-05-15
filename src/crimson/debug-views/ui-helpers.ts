// Port of crimson/debug_views/_ui_helpers.py

import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import type { Vec2 } from '@grim/geom.ts';
import { rl } from '@grim/raylib-api.ts';

export function uiLineHeight(font: SmallFontData | null, opts: { scale?: number } = {}): number {
  const scale = opts.scale ?? 1.0;
  if (font !== null) {
    return int(font.cellSize * scale);
  }
  return int(20 * scale);
}

export function drawUiText(font: SmallFontData | null, text: string, pos: Vec2, opts: { color: rl.Color; scale?: number }): void {
  const color = opts.color;
  const scale = opts.scale ?? 1.0;
  if (font !== null) {
    drawSmallText(font, text, pos, color);
  } else {
    rl.drawText(text, int(pos.x), int(pos.y), int(20 * scale), color);
  }
}
