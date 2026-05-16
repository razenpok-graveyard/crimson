// Port of crimson/ui/overlays/quest_run.py

import type { GrimMonoFont } from '@grim/fonts/grim-mono.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { drawQuestTitleOverlay } from '@crimson/ui/overlays/quest-title.ts';
import * as wgl from '@wgl';

export const QUEST_TITLE_FADE_IN_MS = 500.0;
export const QUEST_TITLE_HOLD_MS = 1000.0;
export const QUEST_TITLE_FADE_OUT_MS = 500.0;
export const QUEST_TITLE_TOTAL_MS = QUEST_TITLE_FADE_IN_MS + QUEST_TITLE_HOLD_MS + QUEST_TITLE_FADE_OUT_MS;
export const QUEST_COMPLETE_BANNER_BASE_W = 256.0;
export const QUEST_COMPLETE_BANNER_BASE_H = 32.0;
export const QUEST_COMPLETE_BANNER_SCALE_BASE = 0.95;
export const QUEST_COMPLETE_BANNER_SCALE_RATE = 0.0004 * 0.13;
export const QUEST_COMPLETE_BANNER_FADE_IN_MS = 500.0;
export const QUEST_COMPLETE_BANNER_HOLD_END_MS = 1500.0;
export const QUEST_COMPLETE_BANNER_FADE_OUT_END_MS = 2000.0;

export function questTitleAlpha(timerMs: number): number {
  if (timerMs <= 0.0 || timerMs > QUEST_TITLE_TOTAL_MS) {
    return 0.0;
  }
  if (timerMs < QUEST_TITLE_FADE_IN_MS && QUEST_TITLE_FADE_IN_MS > 1e-3) {
    return timerMs / QUEST_TITLE_FADE_IN_MS;
  }
  if (timerMs < (QUEST_TITLE_FADE_IN_MS + QUEST_TITLE_HOLD_MS)) {
    return 1.0;
  }
  const t = timerMs - (QUEST_TITLE_FADE_IN_MS + QUEST_TITLE_HOLD_MS);
  return Math.max(0.0, 1.0 - (t / Math.max(1e-3, QUEST_TITLE_FADE_OUT_MS)));
}

export function questCompleteBannerAlpha(timerMs: number): number {
  const t = timerMs;
  if (t <= 0.0) {
    return 0.0;
  }
  if (t < QUEST_COMPLETE_BANNER_FADE_IN_MS) {
    return clamp(t / QUEST_COMPLETE_BANNER_FADE_IN_MS, 0.0, 1.0);
  }
  if (t < QUEST_COMPLETE_BANNER_HOLD_END_MS) {
    return 1.0;
  }
  if (t < QUEST_COMPLETE_BANNER_FADE_OUT_END_MS) {
    return clamp((QUEST_COMPLETE_BANNER_FADE_OUT_END_MS - t) / QUEST_COMPLETE_BANNER_FADE_IN_MS, 0.0, 1.0);
  }
  return 0.0;
}

export function drawQuestTitleTimerOverlay(font: GrimMonoFont, title: string, number: string, opts: { timerMs: number }): void {
  const timerMs = opts.timerMs;
  const alpha = questTitleAlpha(timerMs);
  if (alpha <= 0.0) {
    return;
  }
  drawQuestTitleOverlay(font, title, number, { alpha: alpha });
}

export function drawQuestCompleteBannerOverlay(texture: rl.Texture, opts: { timerMs: number }): void {
  const timerMs = opts.timerMs;
  if (timerMs <= 0.0) {
    return;
  }
  const alpha = questCompleteBannerAlpha(timerMs);
  if (alpha <= 0.0) {
    return;
  }
  const scale = QUEST_COMPLETE_BANNER_SCALE_BASE + timerMs * QUEST_COMPLETE_BANNER_SCALE_RATE;
  const width = QUEST_COMPLETE_BANNER_BASE_W * scale;
  const height = QUEST_COMPLETE_BANNER_BASE_H * scale;
  const centerX = wgl.getScreenWidth() * 0.5;
  const centerY = wgl.getScreenHeight() * 0.5;
  const src = wgl.makeRectangle(0.0, 0.0, texture.width, texture.height);
  const dst = wgl.makeRectangle(centerX - width * 0.5, centerY - height * 0.5, width, height);
  const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, Math.trunc(clamp(alpha, 0.0, 1.0) * 255.0) / 255);
  wgl.drawTexturePro(texture, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);
}
