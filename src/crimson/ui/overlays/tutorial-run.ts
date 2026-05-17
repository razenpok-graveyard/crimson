// Port of crimson/ui/overlays/tutorial_run.py

import { Vec2 } from '@grim/geom.ts';
import type { TutorialOverlayState } from '@crimson/tutorial/index.ts';
import * as wgl from '@wgl';

export type DrawUiText = (arg0: string, arg1: Vec2, arg2: wgl.Color, arg3: number) => void;
export type MeasureUiTextWidth = (arg0: string, arg1: number) => number;
export type MeasureUiLineHeight = (arg0: number) => number;

export const TUTORIAL_PANEL_POS = new Vec2(0.0, 64.0);
export const TUTORIAL_PANEL_PADDING = new Vec2(20.0, 8.0);

function pythonSplitlines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(text)) {
    lines.pop();
  }
  return lines;
}

export function tutorialPromptPanelRect(text: string, opts: { measureTextWidth: MeasureUiTextWidth; measureLineHeight: MeasureUiLineHeight; pos: Vec2; scale: number }): [wgl.Rectangle, string[], number] {
  const measureTextWidth = opts.measureTextWidth;
  const measureLineHeight = opts.measureLineHeight;
  const pos = opts.pos;
  const scale = opts.scale;
  const lines = text.length > 0 ? pythonSplitlines(text) : [''];
  const lineH = measureLineHeight(scale);
  let maxW = 0.0;
  for (const line of lines) {
    maxW = Math.max(maxW, measureTextWidth(line, scale));
  }

  const padX = TUTORIAL_PANEL_PADDING.x * scale;
  const padY = TUTORIAL_PANEL_PADDING.y * scale;
  const width = maxW + padX * 2.0;
  const height = lines.length * lineH + padY * 2.0;
  const screenW = wgl.getScreenWidth();
  const x = (screenW - width) * 0.5;
  const rect = wgl.makeRectangle(x, pos.y, width, height);
  return [rect, lines, lineH];
}

export function drawTutorialPromptPanel(text: string, opts: { alpha: number; pos: Vec2; drawText: DrawUiText; measureTextWidth: MeasureUiTextWidth; measureLineHeight: MeasureUiLineHeight }): void {
  const alpha = opts.alpha;
  const pos = opts.pos;
  const drawText = opts.drawText;
  const measureTextWidth = opts.measureTextWidth;
  const measureLineHeight = opts.measureLineHeight;
  if (alpha <= 1e-3) {
    return;
  }
  const [rect, lines, lineH] = tutorialPromptPanelRect(text, { measureTextWidth: measureTextWidth, measureLineHeight: measureLineHeight, pos: pos, scale: 1.0 });
  const fill = wgl.makeColor(0 / 255, 0 / 255, 0 / 255, int(255 * alpha * 0.8) / 255);
  const border = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha) / 255);
  wgl.drawRectangle(int(rect.x), int(rect.y), int(rect.w), int(rect.h), fill);
  wgl.drawRectangleLines(int(rect.x), int(rect.y), int(rect.w), int(rect.h), border);

  const textAlpha = int(255 * Math.min(1.0, Math.max(0.0, alpha * 0.9)));
  const color = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, textAlpha / 255);
  const x = rect.x + TUTORIAL_PANEL_PADDING.x;
  let lineY = rect.y + TUTORIAL_PANEL_PADDING.y;
  for (const line of lines) {
    drawText(line, new Vec2(x, lineY), color, 1.0);
    lineY += lineH;
  }
}

export function drawTutorialOverlayPanels(overlay: TutorialOverlayState, opts: { drawText: DrawUiText; measureTextWidth: MeasureUiTextWidth; measureLineHeight: MeasureUiLineHeight }): void {
  const drawText = opts.drawText;
  const measureTextWidth = opts.measureTextWidth;
  const measureLineHeight = opts.measureLineHeight;
  if (overlay.promptText && overlay.promptAlpha > 1e-3) {
    drawTutorialPromptPanel(
      overlay.promptText,
      { alpha: overlay.promptAlpha, pos: TUTORIAL_PANEL_POS, drawText: drawText, measureTextWidth: measureTextWidth, measureLineHeight: measureLineHeight },
    );
  }
  if (overlay.hintText && overlay.hintAlpha > 1e-3) {
    drawTutorialPromptPanel(
      overlay.hintText,
      { alpha: overlay.hintAlpha, pos: TUTORIAL_PANEL_POS.offset({ dy: 84.0 }), drawText: drawText, measureTextWidth: measureTextWidth, measureLineHeight: measureLineHeight },
    );
  }
}
