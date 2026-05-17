// Port of crimson/screens/panels/base.py

import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState } from '@crimson/game/types.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_ITEM_OFFSET_X, MENU_ITEM_OFFSET_Y, MENU_LABEL_HEIGHT, MENU_LABEL_OFFSET_X, MENU_LABEL_OFFSET_Y, MENU_LABEL_ROW_BACK, MENU_LABEL_ROW_HEIGHT, MENU_LABEL_WIDTH, MENU_PANEL_HEIGHT, MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuEntry, MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, uiElementAnim } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import * as wgl from '@wgl';

export const PANEL_POS_X = -45.0;
export const PANEL_POS_Y = 210.0;
export const PANEL_BACK_POS_X = -55.0;
export const PANEL_BACK_POS_Y = 430.0;
export const PANEL_TIMELINE_START_MS = 300;
export const PANEL_TIMELINE_END_MS = 0;
export const FADE_TO_GAME_ACTIONS: ReadonlySet<string> = new Set([
  'start_survival',
  'start_rush',
  'start_typo',
  'start_tutorial',
  'start_quest',
]);

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

export class PanelMenuView {
  state: GameState;
  protected _isOpen: boolean;
  protected _title: string;
  protected _bodyLines: string[];
  protected _panelPos: Vec2;
  protected _panelOffset: Vec2;
  protected _panelHeight: number;
  protected _backPos: Vec2;
  protected _backAction: string;
  protected _ground: GroundRenderer | null;
  protected _entry: MenuEntry | null;
  protected _hovered: boolean;
  protected _menuScreenWidth: number;
  protected _widescreenYShift: number;
  _timelineMs: number;
  protected _timelineMaxMs: number;
  protected _cursorPulseTime: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _pendingAction: string | null;
  protected _panelOpenSfxPlayed: boolean;

  constructor(state: GameState, opts: { title: string; body?: string | null; panelPos?: Vec2; panelOffset?: Vec2; panelHeight?: number; backPos?: Vec2; backAction?: string }) {
    const title = opts.title;
    const body = opts.body ?? null;
    const panelPos = opts.panelPos ?? new Vec2(PANEL_POS_X, PANEL_POS_Y);
    const panelOffset = opts.panelOffset ?? new Vec2(MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y);
    const panelHeight = opts.panelHeight ?? MENU_PANEL_HEIGHT;
    const backPos = opts.backPos ?? new Vec2(PANEL_BACK_POS_X, PANEL_BACK_POS_Y);
    const backAction = opts.backAction ?? 'back_to_menu';
    this.state = state;
    this._isOpen = false;
    this._title = title;
    this._bodyLines = pythonSplitlines((body || ''));
    this._panelPos = panelPos;
    this._panelOffset = panelOffset;
    this._panelHeight = panelHeight;
    this._backPos = backPos;
    this._backAction = backAction;
    this._ground = null;
    this._entry = null;
    this._hovered = false;
    this._menuScreenWidth = 0;
    this._widescreenYShift = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = 0;
    this._cursorPulseTime = 0.0;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._panelOpenSfxPlayed = false;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._menuScreenWidth = int(layoutW);
    this._widescreenYShift = MenuView._menuWidescreenYShift(layoutW);
    this._entry = new MenuEntry({ slot: 0, row: MENU_LABEL_ROW_BACK, y: this._backPos.y });
    this._hovered = false;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._cursorPulseTime = 0.0;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._panelOpenSfxPlayed = false;
    this._initGround();
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this._ground = null;
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      updateAudio(this.state.audio, dt);
    }
    if (this._ground !== null) {
      this._ground.processPending();
    }
    this._cursorPulseTime += Math.min(dt, 0.1) * 1.1;
    const dtMs = int(Math.min(dt, 0.1) * 1000.0);
    if (this._closing) {
      if (dtMs > 0 && this._pendingAction === null) {
        this._timelineMs -= dtMs;
        if (this._timelineMs < 0 && this._closeAction !== null) {
          this._pendingAction = this._closeAction;
          this._closeAction = null;
        }
      }
      return;
    }

    if (dtMs > 0) {
      this._timelineMs = Math.min(this._timelineMaxMs, this._timelineMs + dtMs);
      if (this._timelineMs >= this._timelineMaxMs) {
        this.state.menuSignLocked = true;
        if (!this._panelOpenSfxPlayed && (this.state.audio !== null)) {
          playSfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }

    const entry = this._entry;
    if (entry === null) {
      return;
    }

    const enabled = this._entryEnabled(entry);
    const hovered = enabled && this._hoveredEntry(entry);
    this._hovered = hovered;

    if (InputState.wasKeyPressed(27) && enabled) {
      this._beginCloseTransition(this._backAction);
    }
    if (InputState.wasKeyPressed(13) && enabled) {
      this._beginCloseTransition(this._backAction);
    }
    if (enabled && hovered && InputState.wasMouseButtonPressed(0)) {
      this._beginCloseTransition(this._backAction);
    }

    if (hovered) {
      entry.hoverAmount += dtMs * 6;
    } else {
      entry.hoverAmount -= dtMs * 2;
    }
    entry.hoverAmount = Math.max(0, Math.min(1000, entry.hoverAmount));

    if (entry.readyTimerMs < 0x100) {
      entry.readyTimerMs = Math.min(0x100, entry.readyTimerMs + dtMs);
    }
  }

  draw(): void {
    this._assertOpen();
    this._drawBackground();
    drawScreenFade(this.state);
    const entry = this._entry;
    if (!(entry !== null)) throw new Error('PanelMenuView entry must be initialized before draw()');
    this._drawPanel();
    this._drawEntry(entry);
    this._drawSign();
    this._drawContents();
    drawMenuCursorHelper(
      this.state,
      { resources: requireRuntimeResources(this.state), pulseTime: this._cursorPulseTime },
    );
  }

  takeAction(): string | null {
    this._assertOpen();
    const action = this._pendingAction;
    this._pendingAction = null;
    return action;
  }

  protected _assertOpen(): void {
    if (!(this._isOpen)) throw new Error(`${this.constructor.name} must be opened before use`);
  }

  protected _drawContents(): void {
    this._drawTitleText();
  }

  protected _drawTitleText(): void {
    const x = 32;
    let y = 140;
    wgl.drawText(this._title, x, y, 28, wgl.makeColor(235 / 255, 235 / 255, 235 / 255, 255 / 255));
    y += 34;
    for (const line of this._bodyLines) {
      wgl.drawText(line, x, y, 18, wgl.makeColor(190 / 255, 190 / 255, 200 / 255, 255 / 255));
      y += 22;
    }
  }

  protected _beginCloseTransition(action: string): void {
    if (this._closing) {
      return;
    }
    if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(FADE_TO_GAME_ACTIONS, action)) {
      this.state.screenFadeAlpha = 0.0;
      this.state.screenFadeRamp = true;
    }
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._closing = true;
    this._closeAction = action;
  }

  protected _initGround(): void {
    if (this.state.pauseBackground !== null) {
      this._ground = null;
      return;
    }
    this._ground = ensureMenuGround(this.state);
  }

  protected _drawBackground(): void {
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    const pauseBackground = this.state.pauseBackground;
    if (pauseBackground !== null) {
      pauseBackground.drawPauseBackground();
      return;
    }
    if (this._ground !== null) {
      this._ground.draw(menuGroundCamera(this.state));
    }
  }

  protected _drawPanel(): void {
    const panel = requireRuntimeResources(this.state).texture(TextureId.UI_MENU_PANEL);
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: MENU_PANEL_WIDTH * this._menuItemScale(0)[0] });
    const [itemScale, localYShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * itemScale;
    const panelH = this._panelHeight * itemScale;
    const panelTopLeft = (new Vec2(this._panelPos.x + slideX, this._panelPos.y + this._widescreenYShift).add(this._panelOffset.mul(itemScale)));
    const dst = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, panelW, panelH);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(panel, { dst: dst, tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail });
  }

  protected _drawEntry(entry: MenuEntry): void {
    const resources = requireRuntimeResources(this.state);
    const item = resources.texture(TextureId.UI_MENU_ITEM);
    const labelTex = resources.texture(TextureId.UI_ITEM_TEXTS);
    const itemW = item.width;
    const itemH = item.height;
    const [angleRad, slideX] = uiElementAnim(this, { index: 2, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: itemW * this._menuItemScale(entry.slot)[0] });
    const pos = new Vec2(this._backPos.x + slideX, entry.y + this._widescreenYShift);
    const [itemScale, localYShift] = this._menuItemScale(entry.slot);
    const offsetX = MENU_ITEM_OFFSET_X * itemScale;
    const offsetY = MENU_ITEM_OFFSET_Y * itemScale - localYShift;
    const dst = wgl.makeRectangle(pos.x, pos.y, itemW * itemScale, itemH * itemScale);
    const origin = wgl.makeVector2(-offsetX, -offsetY);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    if (fxDetail) {
      drawUiQuadShadow({
        texture: item,
        src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
        dst: wgl.makeRectangle(dst.x + UI_SHADOW_OFFSET, dst.y + UI_SHADOW_OFFSET, dst.w, dst.h),
        origin: origin,
        rotationDeg: 0.0,
      });
    }
    wgl.drawTexturePro(item, wgl.makeRectangle(0.0, 0.0, itemW, itemH), dst, origin, 0.0, wgl.makeColor(1, 1, 1, 1));
    const alpha = MenuView._labelAlpha(entry.hoverAmount);
    const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255);
    const src = wgl.makeRectangle(0.0, entry.row * MENU_LABEL_ROW_HEIGHT, MENU_LABEL_WIDTH, MENU_LABEL_ROW_HEIGHT);
    const labelOffsetX = MENU_LABEL_OFFSET_X * itemScale;
    const labelOffsetY = MENU_LABEL_OFFSET_Y * itemScale - localYShift;
    const labelDst = wgl.makeRectangle(pos.x, pos.y, MENU_LABEL_WIDTH * itemScale, MENU_LABEL_HEIGHT * itemScale);
    const labelOrigin = wgl.makeVector2(-labelOffsetX, -labelOffsetY);
    wgl.drawTexturePro(labelTex, src, labelDst, labelOrigin, 0.0, tint);
    if (this._entryEnabled(entry)) {
      wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
      wgl.drawTexturePro(labelTex, src, labelDst, labelOrigin, 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255));
      wgl.endBlendMode();
    }
  }

  protected _drawSign(): void {
    const screenW = this.state.config.display.width;
    const [scale, shiftX] = MenuView._signLayoutScale(int(screenW));
    const signPos = new Vec2(screenW + MENU_SIGN_POS_X_PAD, screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL);
    const signW = MENU_SIGN_WIDTH * scale;
    const signH = MENU_SIGN_HEIGHT * scale;
    const offsetX = MENU_SIGN_OFFSET_X * scale + shiftX;
    const offsetY = MENU_SIGN_OFFSET_Y * scale;
    // Quest screen is only reachable after the Play Game panel is fully visible,
    // so the sign is already locked in place. Keep it static here.
    const rotationDeg = 0.0;
    const sign = requireRuntimeResources(this.state).texture(TextureId.UI_SIGN_CRIMSON);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    if (fxDetail) {
      drawUiQuadShadow({
        texture: sign,
        src: wgl.makeRectangle(0.0, 0.0, sign.width, sign.height),
        dst: wgl.makeRectangle(signPos.x + UI_SHADOW_OFFSET, signPos.y + UI_SHADOW_OFFSET, signW, signH),
        origin: wgl.makeVector2(-offsetX, -offsetY),
        rotationDeg: rotationDeg,
      });
    }
    wgl.drawTexturePro(sign, wgl.makeRectangle(0.0, 0.0, sign.width, sign.height), wgl.makeRectangle(signPos.x, signPos.y, signW, signH), wgl.makeVector2(-offsetX, -offsetY), rotationDeg, wgl.makeColor(1, 1, 1, 1));
  }

  protected _entryEnabled(entry: MenuEntry): boolean {
    return this._timelineMs >= PANEL_TIMELINE_START_MS;
  }

  protected _hoveredEntry(entry: MenuEntry): boolean {
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const mousePos = Vec2.fromXY(mouse);
    return this._menuItemBounds(entry).contains(mousePos);
  }

  protected _menuItemScale(slot: number): [number, number] {
    if (this._menuScreenWidth < 641) {
      return [0.9, slot * 11.0];
    }
    return [1.0, 0.0];
  }

  protected _menuItemBounds(entry: MenuEntry): Rect {
    const item = requireRuntimeResources(this.state).texture(TextureId.UI_MENU_ITEM);
    const itemW = item.width;
    const itemH = item.height;
    const [itemScale, localYShift] = this._menuItemScale(entry.slot);
    const offsetMin = new Vec2(MENU_ITEM_OFFSET_X * itemScale, MENU_ITEM_OFFSET_Y * itemScale - localYShift);
    const offsetMax = new Vec2((MENU_ITEM_OFFSET_X + itemW) * itemScale, (MENU_ITEM_OFFSET_Y + itemH) * itemScale - localYShift);
    const size = offsetMax.sub(offsetMin);
    const [angleRad, slideX] = uiElementAnim(this, { index: 2, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: itemW * itemScale });
    const pos = new Vec2(this._backPos.x + slideX, entry.y + this._widescreenYShift);
    const topLeft = pos.add(new Vec2(offsetMin.x + size.x * 0.54, offsetMin.y + size.y * 0.28));
    const bottomRight = pos.add(new Vec2(offsetMax.x - size.x * 0.05, offsetMax.y - size.y * 0.10));
    return Rect.fromPosSize(topLeft, bottomRight.sub(topLeft));
  }
}
