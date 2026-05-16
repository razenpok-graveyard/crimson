// Port of grim/fonts/small.py

import { runtimeResourcesFor } from '@grim/assets.ts';
import type { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import * as wgl from '@wgl';

export const SMALL_FONT_FILTER = wgl.TextureFilter.POINT;

function pythonStringCount(text: string, needle: string): number {
  if (needle === '') {
    return Array.from(text).length + 1;
  }
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(needle, start);
    if (index === -1) {
      return count;
    }
    count += 1;
    start = index + needle.length;
  }
}

function latin1EncodeReplace(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes.push(codePoint <= 0xff ? codePoint : 0x3f);
  }
  return bytes;
}

export class SmallFontData {
  readonly widths: number[];
  readonly texture: rl.Texture;
  readonly cellSize: number;
  readonly grid: number;

  constructor(opts: {
    widths: number[];
    texture: rl.Texture;
    cellSize?: number;
    grid?: number;
  }) {
    this.widths = opts.widths;
    this.texture = opts.texture;
    this.cellSize = opts.cellSize ?? 16;
    this.grid = opts.grid ?? 16;
  }
}

export function loadSmallFont(assetsRoot: string): SmallFontData {
  return runtimeResourcesFor(assetsRoot).smallFont;
}

export function drawSmallText(font: SmallFontData, text: string, pos: Vec2, color: rl.Color): void {
  let xPos = int(pos.x);
  let yPos = int(pos.y);
  const baseX = xPos;
  const lineHeight = font.cellSize;
  const origin = wgl.makeVector2(0.0, 0.0);
  for (const value of latin1EncodeReplace(text)) {
    if (value === 0x0A) {
      xPos = baseX;
      yPos += lineHeight;
      continue;
    }
    if (value === 0x0D) {
      continue;
    }
    const width = font.widths[value];
    if (width <= 0) {
      continue;
    }
    const col = value % font.grid;
    const row = Math.floor(value / font.grid);
    // Native Grim2D applies a 1/512 UV inset on the DX8 path. Raylib/OpenGL
    // renders visibly cropped glyphs with that bias, so we intentionally use
    // the full glyph rect here.
    const src = wgl.makeRectangle(col * font.cellSize, row * font.cellSize, width, font.cellSize);
    const dst = wgl.makeRectangle(xPos, yPos, width, font.cellSize);
    wgl.drawTexturePro(font.texture, src, dst, origin, 0.0, color);
    xPos += width;
  }
}

export function measureSmallTextHeight(font: SmallFontData, text: string): number {
  const lineCount = pythonStringCount(text, '\n') + 1;
  return font.cellSize * lineCount;
}

export function measureSmallTextWidth(font: SmallFontData, text: string): number {
  // Return the maximum line width for `text` when rendered with `draw_small_text`.
  let x = 0.0;
  let best = 0.0;
  for (const value of latin1EncodeReplace(text)) {
    if (value === 0x0A) {
      best = Math.max(best, x);
      x = 0.0;
      continue;
    }
    if (value === 0x0D) {
      continue;
    }
    const width = font.widths[value];
    if (width <= 0) {
      continue;
    }
    x += width;
  }
  best = Math.max(best, x);
  return best;
}
