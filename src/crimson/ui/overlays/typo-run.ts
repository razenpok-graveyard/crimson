// Port of crimson/ui/overlays/typo_run.py

import { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import * as wgl from '@wgl';

export type DrawUiText = (arg0: string, arg1: Vec2, arg2: wgl.Color, arg3: number) => void;
export type MeasureUiTextWidth = (arg0: string, arg1: number) => number;
export type WorldToScreen = (arg0: Vec2) => Vec2;

export const NAME_LABEL_SCALE = 1.0;
export const NAME_LABEL_BG_ALPHA = 0.67;
export const TYPING_PANEL_WIDTH = 182.0;
export const TYPING_PANEL_HEIGHT = 53.0;
export const TYPING_PANEL_ALPHA = 0.7;
export const TYPING_TEXT_X = 6.0;
export const TYPING_PROMPT = '>';
export const TYPING_CURSOR = '_';
export const TYPING_CURSOR_X_OFFSET = 14.0;

export function drawTypoNameLabels(opts: { creatures: readonly CreatureState[]; names: readonly string[]; worldToScreen: WorldToScreen; drawText: DrawUiText; measureTextWidth: MeasureUiTextWidth }): void {
  const creatures = opts.creatures;
  const names = opts.names;
  const worldToScreen = opts.worldToScreen;
  const drawText = opts.drawText;
  const measureTextWidth = opts.measureTextWidth;
  if (names.length === 0) {
    return;
  }

  for (const [idx, creature] of creatures.entries()) {
    if (!creature.active) {
      continue;
    }
    if (!(idx >= 0 && idx < names.length)) {
      continue;
    }
    const text = names[idx];
    if (!text) {
      continue;
    }

    let labelAlpha = 1.0;
    const hitbox = creature.lifecycleStage;
    if (hitbox < 0.0) {
      labelAlpha = Math.max(0.0, Math.min(1.0, (hitbox + 10.0) * 0.1));
    }
    if (labelAlpha <= 1e-3) {
      continue;
    }

    const screenPos = worldToScreen(creature.pos);
    const y = screenPos.y - 50.0;
    const textW = measureTextWidth(text, NAME_LABEL_SCALE);
    const textH = 15.0;
    const x = screenPos.x - textW * 0.5;

    const bgAlpha = labelAlpha * NAME_LABEL_BG_ALPHA;
    const bg = wgl.makeColor(0 / 255, 0 / 255, 0 / 255, int(255 * bgAlpha) / 255);
    const fg = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * labelAlpha) / 255);
    wgl.drawRectangle(x - 4.0, y, textW + 8.0, textH, bg);
    drawText(text, new Vec2(x, y), fg, NAME_LABEL_SCALE);
  }
}

export function drawTypingBox(panelTexture: rl.Texture, opts: { text: string; cursorPulseTime: number; drawText: DrawUiText; measureTextWidth: MeasureUiTextWidth }): void {
  const text = opts.text;
  const cursorPulseTime = opts.cursorPulseTime;
  const drawText = opts.drawText;
  const measureTextWidth = opts.measureTextWidth;
  const screenH = wgl.getScreenHeight();
  const panelX = -1.0;
  const panelY = screenH - 144.0;
  const textY = screenH - 127.0;

  const src = wgl.makeRectangle(0.0, 0.0, panelTexture.width, panelTexture.height);
  const dst = wgl.makeRectangle(panelX, panelY, TYPING_PANEL_WIDTH, TYPING_PANEL_HEIGHT);
  const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * TYPING_PANEL_ALPHA) / 255);
  wgl.drawTexturePro(panelTexture, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);

  drawText(TYPING_PROMPT + text, new Vec2(TYPING_TEXT_X, textY), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255), 1.0);

  const cursorDim = Math.sin(cursorPulseTime * 4.0) > 0.0;
  const cursorAlpha = cursorDim ? 0.4 : 1.0;
  const cursorColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * cursorAlpha) / 255);
  const textW = measureTextWidth(text, 1.0);
  const cursorX = textW + TYPING_CURSOR_X_OFFSET;
  drawText(TYPING_CURSOR, new Vec2(cursorX, textY), cursorColor, 1.0);
}
