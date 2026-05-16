// Port of grim/fonts/grim_mono.py

import { TextureId, runtimeResourcesFor } from '@grim/assets.ts';
import type { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import * as wgl from '@wgl';

export const GRIM_MONO_ADVANCE = 16.0;
export const GRIM_MONO_DRAW_SIZE = 32.0;
export const GRIM_MONO_LINE_HEIGHT = 28.0;
export const GRIM_MONO_TEXTURE_FILTER = wgl.TextureFilter.BILINEAR;

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

export class GrimMonoFont {
  readonly texture: rl.Texture;
  readonly grid: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly advance: number;

  constructor(opts: {
    texture: rl.Texture;
    grid?: number;
    cellWidth?: number;
    cellHeight?: number;
    advance?: number;
  }) {
    this.texture = opts.texture;
    this.grid = opts.grid ?? 16;
    this.cellWidth = opts.cellWidth ?? 16.0;
    this.cellHeight = opts.cellHeight ?? 16.0;
    this.advance = opts.advance ?? GRIM_MONO_ADVANCE;
  }
}

export function loadGrimMonoFont(assetsRoot: string): GrimMonoFont {
  const texture = runtimeResourcesFor(assetsRoot).texture(TextureId.DEFAULT_FONT_COURIER);
  wgl.setTextureFilter(texture, GRIM_MONO_TEXTURE_FILTER);
  const grid = 16;
  const cellWidth = texture.width / grid;
  const cellHeight = texture.height / grid;
  return new GrimMonoFont({ texture: texture, grid: grid, cellWidth: cellWidth, cellHeight: cellHeight, advance: GRIM_MONO_ADVANCE });
}

export function drawGrimMonoText(font: GrimMonoFont, text: string, pos: Vec2, scale: number, color: rl.Color): void {
  let xPos = pos.x;
  let yPos = pos.y;
  const advance = font.advance * scale;
  const drawSize = GRIM_MONO_DRAW_SIZE * scale;
  const lineHeight = GRIM_MONO_LINE_HEIGHT * scale;
  const origin = wgl.makeVector2(0.0, 0.0);
  let skipAdvance = false;
  for (const value of latin1EncodeReplace(text)) {
    if (value === 0x0A) {
      xPos = pos.x;
      yPos += lineHeight;
      continue;
    }
    if (value === 0x0D) {
      continue;
    }
    if (value === 0xA7) {
      skipAdvance = true;
      continue;
    }

    if (skipAdvance) {
      skipAdvance = false;
    } else {
      xPos += advance;
    }

    const col = value % font.grid;
    const row = Math.floor(value / font.grid);
    const src = wgl.makeRectangle(col * font.cellWidth, row * font.cellHeight, font.cellWidth, font.cellHeight);
    const dst = wgl.makeRectangle(xPos, yPos + 1.0, drawSize, drawSize);
    wgl.drawTexturePro(font.texture, src, dst, origin, 0.0, color);
  }
}

export function measureGrimMonoTextHeight(font: GrimMonoFont, text: string, scale: number): number {
  const lineCount = pythonStringCount(text, '\n') + 1;
  return GRIM_MONO_LINE_HEIGHT * scale * lineCount;
}
