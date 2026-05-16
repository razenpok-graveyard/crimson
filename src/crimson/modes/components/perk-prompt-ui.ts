// Port of crimson/modes/components/perk_prompt_ui.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import { drawUiText } from '@crimson/ui/perk-menu.ts';
import * as wgl from '@wgl';

export const PERK_PROMPT_MAX_TIMER_MS = 200.0;
export const PERK_PROMPT_OUTSET_X = 50.0;
// Perk prompt bar geometry comes from `ui_menu_assets_init` + `ui_menu_layout_init`:
// - `ui_menu_item_element` is set_rect(512x64, offset -72,-60)
// - the perk prompt mutates quad coords: x = (x - 300) * 0.75, y = y * 0.75
export const PERK_PROMPT_BAR_SCALE = 0.75;
export const PERK_PROMPT_BAR_BASE_OFFSET_X = -72.0;
export const PERK_PROMPT_BAR_BASE_OFFSET_Y = -60.0;
export const PERK_PROMPT_BAR_SHIFT_X = -300.0;
// `ui_textLevelUp` is set_rect(75x25, offset -230,-27), then its quad coords are:
// x = x * 0.85 - 46, y = y * 0.85 - 4
export const PERK_PROMPT_LEVEL_UP_SCALE = 0.85;
export const PERK_PROMPT_LEVEL_UP_BASE_OFFSET_X = -230.0;
export const PERK_PROMPT_LEVEL_UP_BASE_OFFSET_Y = -27.0;
export const PERK_PROMPT_LEVEL_UP_BASE_W = 75.0;
export const PERK_PROMPT_LEVEL_UP_BASE_H = 25.0;
export const PERK_PROMPT_LEVEL_UP_SHIFT_X = -46.0;
export const PERK_PROMPT_LEVEL_UP_SHIFT_Y = -4.0;
export const PERK_PROMPT_TEXT_MARGIN_X = 16.0;
export const PERK_PROMPT_TEXT_OFFSET_Y = 8.0;

export class PerkPromptUi {

  static label(config: CrimsonConfig, opts: { pendingCount: number }): string {
    const pendingCount = opts.pendingCount;
    if (!config.gameplay.showInfoTexts) {
      return '';
    }
    const pending = int(pendingCount);
    if (pending <= 0) {
      return '';
    }
    const suffix = pending > 1 ? ` (${pending})` : '';
    return `Press Mouse2 to pick a perk${suffix}`;
  }

  static hinge(opts: { screenW?: number | null } = {}): Vec2 {
    let screenW = opts.screenW ?? null;
    if (screenW === null) {
      screenW = wgl.getScreenWidth();
    }
    const hingeX = screenW + PERK_PROMPT_OUTSET_X;
    const hingeY = int(screenW) === 640 ? 80.0 : 40.0;
    return new Vec2(hingeX, hingeY);
  }

  static rect(opts: { resources: RuntimeResources; scale?: number }): Rect {
    const resources = opts.resources;
    const scale = opts.scale ?? 1.0;
    const hinge = PerkPromptUi.hinge();
    const tex = resources.texture(TextureId.UI_MENU_ITEM);
    const barW = tex.width * PERK_PROMPT_BAR_SCALE;
    const barH = tex.height * PERK_PROMPT_BAR_SCALE;
    const localX = (PERK_PROMPT_BAR_BASE_OFFSET_X + PERK_PROMPT_BAR_SHIFT_X) * PERK_PROMPT_BAR_SCALE;
    const localY = PERK_PROMPT_BAR_BASE_OFFSET_Y * PERK_PROMPT_BAR_SCALE;
    return Rect.fromTopLeft(hinge.offset({ dx: localX, dy: localY }), barW, barH);
  }

  static draw(opts: { resources: RuntimeResources; label: string; timerMs: number; pulse: number; uiTextWidth: (arg0: string, arg1: number) => number; textColor: rl.Color; scale?: number }): void {
    const resources = opts.resources;
    const label = opts.label;
    const timerMs = opts.timerMs;
    const pulse = opts.pulse;
    const uiTextWidth = opts.uiTextWidth;
    const textColor = opts.textColor;
    const scale = opts.scale ?? 1.0;
    const alpha = timerMs / PERK_PROMPT_MAX_TIMER_MS;
    if (alpha <= 1e-3) {
      return;
    }

    const hinge = PerkPromptUi.hinge();
    // Prompt swings counter-clockwise; raylib's Y-down makes positive rotation clockwise.
    const rotDeg = -(1.0 - alpha) * 90.0;
    const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha) / 255);

    const textScale = scale;
    const textW = uiTextWidth(label, textScale);
    const x = wgl.getScreenWidth() - PERK_PROMPT_TEXT_MARGIN_X - textW;
    const y = hinge.y + PERK_PROMPT_TEXT_OFFSET_Y;
    const color = wgl.makeColor(int(textColor.r * 255) / 255, int(textColor.g * 255) / 255, int(textColor.b * 255) / 255, int(255 * alpha) / 255);
    drawUiText(resources, label, new Vec2(x, y), { scale: textScale, color: color });

    let tex = resources.texture(TextureId.UI_MENU_ITEM);
    const barW = tex.width * PERK_PROMPT_BAR_SCALE;
    const barH = tex.height * PERK_PROMPT_BAR_SCALE;
    let localX = (PERK_PROMPT_BAR_BASE_OFFSET_X + PERK_PROMPT_BAR_SHIFT_X) * PERK_PROMPT_BAR_SCALE;
    let localY = PERK_PROMPT_BAR_BASE_OFFSET_Y * PERK_PROMPT_BAR_SCALE;
    // Raylib clamps out-of-range UVs when the texture wrap mode is CLAMP.
    // Using src.x=tex.width with a negative width relies on REPEAT wrap to
    // wrap UVs back into range, making the bar disappear when clamped.
    let src = wgl.makeRectangle(0.0, 0.0, -tex.width, tex.height);
    let dst = wgl.makeRectangle(hinge.x, hinge.y, barW, barH);
    let origin = wgl.makeVector2(-localX, -localY);
    wgl.drawTexturePro(tex, src, dst, origin, rotDeg, tint);

    tex = resources.texture(TextureId.UI_TEXT_LEVEL_UP);
    localX = PERK_PROMPT_LEVEL_UP_BASE_OFFSET_X * PERK_PROMPT_LEVEL_UP_SCALE + PERK_PROMPT_LEVEL_UP_SHIFT_X;
    localY = PERK_PROMPT_LEVEL_UP_BASE_OFFSET_Y * PERK_PROMPT_LEVEL_UP_SCALE + PERK_PROMPT_LEVEL_UP_SHIFT_Y;
    const w = PERK_PROMPT_LEVEL_UP_BASE_W * PERK_PROMPT_LEVEL_UP_SCALE;
    const h = PERK_PROMPT_LEVEL_UP_BASE_H * PERK_PROMPT_LEVEL_UP_SCALE;
    let pulseAlpha = (100.0 + int(pulse * 155.0 / 1000.0)) / 255.0;
    pulseAlpha = Math.max(0.0, Math.min(1.0, pulseAlpha));
    const labelAlpha = Math.max(0.0, Math.min(1.0, alpha * pulseAlpha));
    const pulseTint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * labelAlpha) / 255);
    src = wgl.makeRectangle(0.0, 0.0, tex.width, tex.height);
    dst = wgl.makeRectangle(hinge.x, hinge.y, w, h);
    origin = wgl.makeVector2(-localX, -localY);
    wgl.drawTexturePro(tex, src, dst, origin, rotDeg, pulseTint);
    if (labelAlpha > 0.0) {
      wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
      wgl.drawTexturePro(tex, src, dst, origin, rotDeg, pulseTint);
      wgl.endBlendMode();
    }
  }
}
