// Port of crimson/ui/overlays/quest_title.py

import type { GrimMonoFont } from '@grim/fonts/grim-mono.ts';
import { drawGrimMonoText } from '@grim/fonts/grim-mono.ts';
import { Vec2 } from '@grim/geom.ts';
import * as wgl from '@wgl';

export const QUEST_TITLE_ALPHA = 1.0;
export const QUEST_NUMBER_ALPHA_RATIO = 0.5;
// Game base scale: 0.75 at 640px width, 0.8 at larger widths.
export const QUEST_TITLE_SCALE_SMALL = 0.75;
export const QUEST_TITLE_SCALE_LARGE = 0.8;
export const QUEST_TITLE_SCALE_THRESHOLD_PX = 640;
// Title overlay baseline is centered vertically and shifted up by 32px (0x20).
export const QUEST_TITLE_Y_OFFSET = 32.0;
// Number is drawn at a slightly smaller scale.
export const QUEST_NUMBER_SCALE_DELTA = 0.2;
// Game X formula: x = title_x - (strlen * scale * 8.0) - (scale * 32.0) - 4.0
// where 8.0 = advance/2, 32.0 = base gap, 4.0 = fixed offset.
export const QUEST_NUMBER_HALF_ADVANCE = 8.0;
export const QUEST_NUMBER_BASE_GAP = 32.0;
export const QUEST_NUMBER_FIXED_OFFSET = 4.0;
// Game Y formula: y = title_y + number_scale * (23.36 - 16.0) = title_y + number_scale * 7.36
export const QUEST_NUMBER_Y_MULTIPLIER = 7.36;

export class QuestTitleOverlayLayout {
  readonly titlePos: Vec2;
  readonly titleScale: number;
  readonly numberPos: Vec2;
  readonly numberScale: number;

  constructor(opts: {
    titlePos: Vec2;
    titleScale: number;
    numberPos: Vec2;
    numberScale: number;
  }) {
    this.titlePos = opts.titlePos;
    this.titleScale = opts.titleScale;
    this.numberPos = opts.numberPos;
    this.numberScale = opts.numberScale;
  }
}

export function questTitleBaseScale(screenWidth: number): number {
  return screenWidth <= QUEST_TITLE_SCALE_THRESHOLD_PX ? QUEST_TITLE_SCALE_SMALL : QUEST_TITLE_SCALE_LARGE;
}

export function questNumberScale(titleScale: number): number {
  return Math.max(0.0, titleScale - QUEST_NUMBER_SCALE_DELTA);
}

export function layoutQuestTitleOverlay(opts: { screenWidth: number; screenHeight: number; title: string; number: string; fontAdvance: number }): QuestTitleOverlayLayout {
  const screenWidth = opts.screenWidth;
  const screenHeight = opts.screenHeight;
  const title = opts.title;
  const number = opts.number;
  const fontAdvance = opts.fontAdvance;
  const titleScale = questTitleBaseScale(int(screenWidth));
  const numberScale = questNumberScale(titleScale);

  const titleWidth = Array.from(title).length * fontAdvance * titleScale;
  // The game uses integer division for screen center (width/2, height/2) before converting to float.
  const centerX = Math.floor(int(screenWidth) / 2);
  const centerY = Math.floor(int(screenHeight) / 2);
  const titlePos = new Vec2(centerX - (titleWidth / 2.0), centerY - QUEST_TITLE_Y_OFFSET);

  const numberX = titlePos.x - (Array.from(number).length * numberScale * QUEST_NUMBER_HALF_ADVANCE) - (numberScale * QUEST_NUMBER_BASE_GAP) - QUEST_NUMBER_FIXED_OFFSET;
  const numberY = titlePos.y + (numberScale * QUEST_NUMBER_Y_MULTIPLIER);

  return new QuestTitleOverlayLayout({ titlePos: titlePos, titleScale: titleScale, numberPos: new Vec2(numberX, numberY), numberScale: numberScale });
}

export function drawQuestTitleOverlay(font: GrimMonoFont, title: string, number: string, opts: { alpha?: number } = {}): void {
  let alpha = opts.alpha ?? 1.0;
  alpha = Math.max(0.0, Math.min(1.0, alpha));
  const layout = layoutQuestTitleOverlay({ screenWidth: wgl.getScreenWidth(), screenHeight: wgl.getScreenHeight(), title: title, number: number, fontAdvance: font.advance });

  const titleColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * QUEST_TITLE_ALPHA * alpha) / 255);
  const numberColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * QUEST_TITLE_ALPHA * QUEST_NUMBER_ALPHA_RATIO * alpha) / 255);

  drawGrimMonoText(font, title, layout.titlePos, layout.titleScale, titleColor);
  drawGrimMonoText(font, number, layout.numberPos, layout.numberScale, numberColor);
}
