// Port of crimson/ui/perk_menu.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { menuWidescreenYShift } from '@crimson/ui/layout.ts';
import * as wgl from '@wgl';

// Perk selection screen panel uses ui_element-style timeline animation:
// - fully hidden until end_ms
// - slides in over (end_ms..start_ms)
// - fully visible at start_ms
export const PERK_MENU_ANIM_START_MS = 400.0;
export const PERK_MENU_ANIM_END_MS = 100.0;
export const PERK_MENU_TRANSITION_MS = PERK_MENU_ANIM_START_MS;
// Layout offsets from the classic game (perk selection screen), derived from
// `perk_selection_screen_update` (see analysis/ghidra + BN).
export const MENU_PANEL_ANCHOR_X = 224.0;
export const MENU_PANEL_ANCHOR_Y = 40.0;
export const MENU_TITLE_X = 54.0;
export const MENU_TITLE_Y = 6.0;
export const MENU_TITLE_W = 128.0;
export const MENU_TITLE_H = 32.0;
export const MENU_SPONSOR_Y = -8.0;
export const MENU_SPONSOR_X_EXPERT = -26.0;
export const MENU_SPONSOR_X_MASTER = -28.0;
export const MENU_LIST_Y_NORMAL = 50.0;
export const MENU_LIST_Y_EXPERT = 40.0;
export const MENU_LIST_STEP_NORMAL = 19.0;
export const MENU_LIST_STEP_EXPERT = 18.0;
export const MENU_DESC_X = -12.0;
export const MENU_DESC_Y_AFTER_LIST = 32.0;
export const MENU_DESC_Y_EXTRA_TIGHTEN = 20.0;
export const MENU_BUTTON_X = 162.0;
export const MENU_BUTTON_Y = 276.0;
export const MENU_DESC_RIGHT_X = 480.0;

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

export class PerkMenuLayout {
  // Coordinates live in the original 640x480 UI space.
  // Capture (1024x768) shows the perk menu panel uses the 3-slice variant:
  //   open bbox (-108,119) -> (402,497)
  // which corresponds to ui_element pos (-45,110) + geom (-63,-81) and size 510x378.
  panelPos: Vec2;
  panelSize: Vec2;

  constructor(opts: {
    panelPos?: Vec2;
    panelSize?: Vec2;
  } = {}) {
    this.panelPos = opts.panelPos ?? new Vec2(-108.0, 29.0);
    this.panelSize = opts.panelSize ?? new Vec2(510.0, 378.0);
  }
}

export class PerkMenuComputedLayout {
  panel: Rect;
  title: Rect;
  sponsorPos: Vec2;
  listPos: Vec2;
  listStepY: number;
  desc: Rect;
  cancelPos: Vec2;

  constructor(opts: {
    panel: Rect;
    title: Rect;
    sponsorPos: Vec2;
    listPos: Vec2;
    listStepY: number;
    desc: Rect;
    cancelPos: Vec2;
  }) {
    this.panel = opts.panel;
    this.title = opts.title;
    this.sponsorPos = opts.sponsorPos;
    this.listPos = opts.listPos;
    this.listStepY = opts.listStepY;
    this.desc = opts.desc;
    this.cancelPos = opts.cancelPos;
  }
}

export class UiButtonState {
  label: string;
  enabled: boolean;
  hovered: boolean;
  activated: boolean;
  hoverT: number; // 0..1000
  pressT: number; // 0..1000
  alpha: number;
  forceWide: boolean;

  constructor(opts: {
    label: string;
    enabled?: boolean;
    hovered?: boolean;
    activated?: boolean;
    hoverT?: number;
    pressT?: number;
    alpha?: number;
    forceWide?: boolean;
  }) {
    this.label = opts.label;
    this.enabled = opts.enabled ?? true;
    this.hovered = opts.hovered ?? false;
    this.activated = opts.activated ?? false;
    this.hoverT = opts.hoverT ?? 0;
    this.pressT = opts.pressT ?? 0;
    this.alpha = opts.alpha ?? 1.0;
    this.forceWide = opts.forceWide ?? false;
  }
}

export function perkMenuComputeLayout(layout: PerkMenuLayout, opts: { screenW: number; origin: Vec2; scale: number; choiceCount: number; expertOwned: boolean; masterOwned: boolean; panelSlideX?: number }): PerkMenuComputedLayout {
  const screenW = opts.screenW;
  const origin = opts.origin;
  const scale = opts.scale;
  const choiceCount = opts.choiceCount;
  const expertOwned = opts.expertOwned;
  const masterOwned = opts.masterOwned;
  const panelSlideX = opts.panelSlideX ?? 0.0;
  const layoutW = scale ? screenW / scale : screenW;
  const widescreenShiftY = menuWidescreenYShift(layoutW);
  const panelPos = layout.panelPos.add(new Vec2(panelSlideX, widescreenShiftY));
  const panel = Rect.fromPosSize(origin.add(panelPos.mul(scale)), layout.panelSize.mul(scale));
  const anchorPos = new Vec2(panel.x + MENU_PANEL_ANCHOR_X * scale, panel.y + MENU_PANEL_ANCHOR_Y * scale);

  const title = Rect.fromTopLeft(anchorPos.offset({ dx: MENU_TITLE_X * scale, dy: MENU_TITLE_Y * scale }), MENU_TITLE_W * scale, MENU_TITLE_H * scale);

  const sponsorPos = new Vec2(anchorPos.x + ((masterOwned ? MENU_SPONSOR_X_MASTER : MENU_SPONSOR_X_EXPERT) * scale), anchorPos.y + MENU_SPONSOR_Y * scale);

  const listStepY = expertOwned ? MENU_LIST_STEP_EXPERT : MENU_LIST_STEP_NORMAL;
  const listPos = new Vec2(anchorPos.x, anchorPos.y + ((expertOwned ? MENU_LIST_Y_EXPERT : MENU_LIST_Y_NORMAL) * scale));

  let descPos = new Vec2(anchorPos.x + MENU_DESC_X * scale, listPos.y + choiceCount * listStepY * scale + MENU_DESC_Y_AFTER_LIST * scale);
  if (choiceCount > 5) {
    descPos = descPos.offset({ dy: -MENU_DESC_Y_EXTRA_TIGHTEN * scale });
  }

  // Keep the description within the monitor screen area and above the button.
  const descRight = panel.x + MENU_DESC_RIGHT_X * scale;
  const cancelPos = anchorPos.offset({ dx: MENU_BUTTON_X * scale, dy: MENU_BUTTON_Y * scale });
  const descSize = new Vec2(Math.max(0.0, descRight - descPos.x), Math.max(0.0, cancelPos.y - 12.0 * scale - descPos.y));
  const desc = Rect.fromPosSize(descPos, descSize);

  return new PerkMenuComputedLayout({ panel: panel, title: title, sponsorPos: sponsorPos, listPos: listPos, listStepY: listStepY * scale, desc: desc, cancelPos: cancelPos });
}

export function uiElementSlideX(tMs: number, opts: { startMs: number; endMs: number; width: number; directionFlag?: number }): number {
  //
  // Slide offset helper matching ui_element_update semantics (see MenuView._ui_element_anim).
  //
  // direction_flag=0: slide from left  (-width -> 0)
  // direction_flag=1: slide from right (+width -> 0)

  const startMs = opts.startMs;
  const endMs = opts.endMs;
  let width = opts.width;
  const directionFlag = opts.directionFlag ?? 0;
  if (startMs <= endMs || width <= 0.0) {
    return 0.0;
  }

  width = Math.abs(width);
  const t = tMs;
  let slide: number;
  if (t < endMs) {
    slide = width;
  } else if (t < startMs) {
    const elapsed = t - endMs;
    const span = startMs - endMs;
    const p = span > 1e-6 ? elapsed / span : 1.0;
    slide = (1.0 - p) * width;
  } else {
    slide = 0.0;
  }

  return int(directionFlag) ? slide : -slide;
}

export function perkMenuPanelSlideX(tMs: number, opts: { width: number }): number {
  const width = opts.width;
  return uiElementSlideX(tMs, { startMs: PERK_MENU_ANIM_START_MS, endMs: PERK_MENU_ANIM_END_MS, width: width, directionFlag: 0 });
}

function uiTextWidth(resources: RuntimeResources, text: string, scale: number): number {
  const font = resources.smallFont;
  return measureSmallTextWidth(font, text);
}

export function drawUiText(resources: RuntimeResources, text: string, pos: Vec2, opts: { scale: number; color: wgl.Color }): void {
  const scale = opts.scale;
  const color = opts.color;
  const font = resources.smallFont;
  drawSmallText(font, text, pos, color);
}

export function wrapUiText(resources: RuntimeResources, text: string, opts: { maxWidth: number; scale: number }): string[] {
  const maxWidth = opts.maxWidth;
  const scale = opts.scale;
  const lines: string[] = [];
  for (const raw of (() => { const value = pythonSplitlines(text); return value.length > 0 ? value : ['']; })()) {
    const para = raw.trim();
    if (!para) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of (() => { const value = para; const text = String(value).trim(); return text === '' ? [] : text.split(/\s+/); })()) {
      const candidate = !current ? word : `${current} ${word}`;
      if (current && uiTextWidth(resources, candidate, scale) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) {
      lines.push(current);
    }
  }
  return lines;
}

export function drawWrappedUiTextInRect(resources: RuntimeResources, text: string, opts: { rect: Rect; scale: number; color: wgl.Color }): void {
  const rect = opts.rect;
  const scale = opts.scale;
  const color = opts.color;
  const font = resources.smallFont;
  const lines = wrapUiText(resources, text, { maxWidth: rect.w, scale: scale });
  const lineH = font.cellSize * scale;
  let pos = rect.topLeft;
  const maxY = rect.bottom;
  for (const line of lines) {
    if (pos.y + lineH > maxY) {
      break;
    }
    drawUiText(resources, line, pos, { scale: scale, color: color });
    pos = pos.offset({ dy: lineH });
  }
}

export function menuItemHitRect(resources: RuntimeResources, label: string, opts: { pos: Vec2; scale: number }): Rect {
  const pos = opts.pos;
  const scale = opts.scale;
  const width = uiTextWidth(resources, label, scale);
  const height = 16.0 * scale;
  return Rect.fromTopLeft(pos, width, height);
}

export function drawMenuItem(resources: RuntimeResources, label: string, opts: { pos: Vec2; scale: number; hovered: boolean }): number {
  const pos = opts.pos;
  const scale = opts.scale;
  const hovered = opts.hovered;
  const alpha = hovered ? MENU_ITEM_ALPHA_HOVER : MENU_ITEM_ALPHA_IDLE;
  const [r, g, b] = MENU_ITEM_RGB;
  const color = wgl.makeColor(int(r) / 255, int(g) / 255, int(b) / 255, int(255 * alpha) / 255);
  drawUiText(resources, label, pos, { scale: scale, color: color });
  const width = uiTextWidth(resources, label, scale);
  const lineY = pos.y + 13.0 * scale;
  wgl.drawLine(int(pos.x), int(lineY), int(pos.x + width), int(lineY), color);
  return width;
}

function resolveButtonTextures(resources: RuntimeResources): [rl.Texture, rl.Texture] {
  return [resources.texture(TextureId.UI_BUTTON_SM), resources.texture(TextureId.UI_BUTTON_MD)];
}

export function buttonWidth(resources: RuntimeResources, label: string, opts: { scale: number; forceWide: boolean }): number {
  const scale = opts.scale;
  const forceWide = opts.forceWide;
  const textW = uiTextWidth(resources, label, scale);
  if (forceWide) {
    return 145.0 * scale;
  }
  if (textW < 40.0 * scale) {
    return 82.0 * scale;
  }
  return 145.0 * scale;
}

export function buttonHitRect(opts: { pos: Vec2; width: number }): Rect {
  // Mirrors ui_button_update: y is offset by +2, hit height is 0x1c (28).
  const pos = opts.pos;
  const width = opts.width;
  return Rect.fromTopLeft(pos.offset({ dy: 2.0 }), width, 28.0);
}

export function buttonUpdate(state: UiButtonState, opts: { pos: Vec2; width: number; dtMs: number; mouse: wgl.Vector2; click: boolean }): boolean {
  const pos = opts.pos;
  const width = opts.width;
  const dtMs = opts.dtMs;
  const mouse = opts.mouse;
  const click = opts.click;
  if (!state.enabled) {
    state.hovered = false;
  } else {
    state.hovered = buttonHitRect({ pos: pos, width: width }).contains(mouse);
  }

  const delta = (state.enabled && state.hovered) ? 6 : -4;
  state.hoverT = int(clamp(state.hoverT + int(dtMs) * delta, 0.0, 1000.0));

  if (state.pressT > 0) {
    state.pressT = int(clamp(state.pressT - int(dtMs) * 6, 0.0, 1000.0));
  }

  state.activated = state.enabled && state.hovered && click;
  if (state.activated) {
    state.pressT = 1000;
  }
  return state.activated;
}

export function buttonDraw(resources: RuntimeResources, state: UiButtonState, opts: { pos: Vec2; width: number; scale: number }): void {
  const pos = opts.pos;
  const width = opts.width;
  const scale = opts.scale;
  const [buttonSm, buttonMd] = resolveButtonTextures(resources);
  const texture = width > 120.0 * scale ? buttonMd : buttonSm;

  let r: number;
  let g: number;
  let b: number;
  if (state.hoverT > 0) {
    // ui_button_update: highlight fill uses a hover-scaled alpha and click-biased blue tint.
    // - base: (0.5, 0.5, 0.7)
    // - click_anim: +0.0005 / +0.0007, clamped to 1.0 (towards white)
    // - alpha: hover_anim * 0.001 * button.alpha
    r = 0.5;
    g = 0.5;
    b = 0.7;
    if (state.pressT > 0) {
      const clickT = state.pressT;
      g = Math.min(1.0, 0.5 + clickT * 0.0005);
      r = g;
      b = Math.min(1.0, 0.7 + clickT * 0.0007);
    }
    const a = state.hoverT * 0.001 * state.alpha;
    const hl = wgl.makeColor(int(255 * r) / 255, int(255 * g) / 255, int(255 * b) / 255, int(255 * clamp(a, 0.0, 1.0)) / 255);
    wgl.drawRectangle(int(pos.x + 12.0 * scale), int(pos.y + 5.0 * scale), int(width - 24.0 * scale), int(22.0 * scale), hl);
  }

  const plateTint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * clamp(state.alpha, 0.0, 1.0)) / 255);

  const src = wgl.makeRectangle(0.0, 0.0, texture.width, texture.height);
  const dst = wgl.makeRectangle(pos.x, pos.y, width, 32.0 * scale);
  wgl.drawTexturePro(texture, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, plateTint);

  const textA = state.hovered ? state.alpha : state.alpha * 0.7;
  const textTint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * clamp(textA, 0.0, 1.0)) / 255);
  const textW = uiTextWidth(resources, state.label, scale);
  const textPos = new Vec2(pos.x + width * 0.5 - textW * 0.5 + 1.0 * scale, pos.y + 10.0 * scale);
  drawUiText(resources, state.label, textPos, { scale: scale, color: textTint });
}

export function cursorDraw(resources: RuntimeResources, opts: { mouse: wgl.Vector2; scale: number; alpha?: number }): void {
  const mouse = opts.mouse;
  const scale = opts.scale;
  const alpha = opts.alpha ?? 1.0;
  const tex = resources.texture(TextureId.UI_CURSOR);
  const a = int(255 * clamp(alpha, 0.0, 1.0));
  const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, a / 255);
  const size = 32.0 * scale;
  const src = wgl.makeRectangle(0.0, 0.0, tex.width, tex.height);
  const dst = wgl.makeRectangle(mouse.x, mouse.y, size, size);
  wgl.drawTexturePro(tex, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);
}

export const MENU_ITEM_RGB = [0x46, 0xB4, 0xF0]; // from ui_menu_item_update: rgb(70, 180, 240)
export const MENU_ITEM_ALPHA_IDLE = 0.6;
export const MENU_ITEM_ALPHA_HOVER = 1.0;
