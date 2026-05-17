// Port of crimson/screens/pause_menu.py

import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GameState } from '@crimson/game/types.ts';
import type { PauseBackground } from '@crimson/pause-background.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_ITEM_OFFSET_X, MENU_ITEM_OFFSET_Y, MENU_LABEL_BASE_Y, MENU_LABEL_HEIGHT, MENU_LABEL_OFFSET_X, MENU_LABEL_OFFSET_Y, MENU_LABEL_ROW_BACK, MENU_LABEL_ROW_HEIGHT, MENU_LABEL_ROW_OPTIONS, MENU_LABEL_ROW_QUIT, MENU_LABEL_STEP, MENU_LABEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuEntry, MenuView, drawMenuCursorHelper } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import * as wgl from '@wgl';

export const PAUSE_MENU_TO_MAIN_MENU_FADE_MS = 500;

export class PauseMenuView {
  state: GameState;
  protected _isOpen: boolean;
  protected _menuEntries: MenuEntry[];
  protected _selectedIndex: number;
  protected _focusTimerMs: number;
  protected _hoveredIndex: number | null;
  _timelineMs: number;
  protected _timelineMaxMs: number;
  protected _cursorPulseTime: number;
  protected _widescreenYShift: number;
  protected _menuScreenWidth: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _pendingAction: string | null;
  protected _panelOpenSfxPlayed: boolean;

  constructor(state: GameState) {
    this.state = state;
    this._isOpen = false;
    this._menuEntries = [];
    this._selectedIndex = 0;
    this._focusTimerMs = 0;
    this._hoveredIndex = null;
    this._timelineMs = 0;
    this._timelineMaxMs = 0;
    this._cursorPulseTime = 0.0;
    this._widescreenYShift = 0.0;
    this._menuScreenWidth = 0;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._panelOpenSfxPlayed = false;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._menuScreenWidth = int(layoutW);
    this._widescreenYShift = MenuView._menuWidescreenYShift(layoutW);
    const ys = [MENU_LABEL_BASE_Y + this._widescreenYShift, MENU_LABEL_BASE_Y + MENU_LABEL_STEP + this._widescreenYShift, MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 2.0 + this._widescreenYShift];
    this._menuEntries = [new MenuEntry({ slot: 0, row: MENU_LABEL_ROW_OPTIONS, y: ys[0] }), new MenuEntry({ slot: 1, row: MENU_LABEL_ROW_QUIT, y: ys[1] }), new MenuEntry({ slot: 2, row: MENU_LABEL_ROW_BACK, y: ys[2] })];
    this._selectedIndex = this._menuEntries.length > 0 ? 0 : -1;
    this._focusTimerMs = 0;
    this._hoveredIndex = null;
    this._timelineMs = 0;
    this._timelineMaxMs = Math.max(300, ...Array.from(this._menuEntries, (entry) => MenuView._menuSlotStartMs(entry.slot)));
    this._cursorPulseTime = 0.0;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._panelOpenSfxPlayed = false;
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this._menuEntries = [];
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      updateAudio(this.state.audio, dt);
    }
    this._cursorPulseTime += Math.min(dt, 0.1) * 1.1;

    const dtMs = int(Math.min(dt, 0.1) * 1000.0);
    if (this._closing) {
      if (dtMs > 0 && this._pendingAction === null) {
        this._timelineMs -= dtMs;
        this._focusTimerMs = Math.max(0, this._focusTimerMs - dtMs);
        if (this._timelineMs < 0 && this._closeAction !== null) {
          this._pendingAction = this._closeAction;
          this._closeAction = null;
        }
      }
      return;
    }

    if (dtMs > 0) {
      this._timelineMs = Math.min(this._timelineMaxMs, this._timelineMs + dtMs);
      this._focusTimerMs = Math.max(0, this._focusTimerMs - dtMs);
      if (this._timelineMs >= this._timelineMaxMs) {
        this.state.menuSignLocked = true;
        if (!this._panelOpenSfxPlayed && (this.state.audio !== null)) {
          playSfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }

    if (this._menuEntries.length === 0) {
      return;
    }

    this._hoveredIndex = this._hoveredEntryIndex();

    if (InputState.wasKeyPressed(9)) {
      const reverse = InputState.isKeyDown(16) || InputState.isKeyDown(16);
      const delta = reverse ? -1 : 1;
      this._selectedIndex = ((this._selectedIndex + delta) + this._menuEntries.length) % this._menuEntries.length;
      this._focusTimerMs = 1000;
    }

    let activatedIndex: number | null = null;
    let entry: any;
    if (InputState.wasKeyPressed(27)) {
      // ESC behaves like selecting Back.
      activatedIndex = this._entryIndexForRow(MENU_LABEL_ROW_BACK);
    } else if (InputState.wasKeyPressed(13) && this._selectedIndex >= 0 && this._selectedIndex < this._menuEntries.length) {
      entry = this._menuEntries[this._selectedIndex];
      if (this._menuEntryEnabled(entry)) {
        activatedIndex = this._selectedIndex;
      }
    }

    if (activatedIndex === null && this._hoveredIndex !== null) {
      if (InputState.wasMouseButtonPressed(0)) {
        const hovered = this._hoveredIndex;
        entry = this._menuEntries[hovered];
        if (this._menuEntryEnabled(entry)) {
          this._selectedIndex = hovered;
          this._focusTimerMs = 1000;
          activatedIndex = hovered;
        }
      }
    }

    if (activatedIndex !== null) {
      this._activateMenuEntry(activatedIndex);
    }

    this._updateReadyTimers(dtMs);
    this._updateHoverAmounts(dtMs);
  }

  draw(): void {
    this._assertOpen();
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    const pauseBackground = this._pauseBackground();
    if (pauseBackground !== null) {
      pauseBackground.drawPauseBackground({ entityAlpha: this._pauseBackgroundEntityAlpha() });
    }
    drawScreenFade(this.state);

    this._drawMenuItems();
    this._drawMenuSign();
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
    if (!(this._isOpen)) throw new Error('PauseMenuView must be opened before use');
  }

  protected _pauseBackground(): PauseBackground | null {
    return this.state.pauseBackground;
  }

  protected _pauseBackgroundEntityAlpha(): number {
    // Native gameplay_render_world keeps gameplay entities fully visible for most transitions,
    // but fades them out when pause menu closes to main menu (ui_element_slot_28 timing = 0x1f4 ms).
    if (!this._closing || (this._closeAction !== 'back_to_menu')) {
      return 1.0;
    }
    const alpha = this._timelineMs / PAUSE_MENU_TO_MAIN_MENU_FADE_MS;
    if (alpha < 0.0) {
      return 0.0;
    }
    if (alpha > 1.0) {
      return 1.0;
    }
    return alpha;
  }

  protected _activateMenuEntry(index: number): void {
    if (!(index >= 0 && index < this._menuEntries.length)) {
      return;
    }
    const entry = this._menuEntries[index];
    const action = PauseMenuView._actionForEntry(entry);
    if (action === null) {
      return;
    }
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._beginCloseTransition(action);
  }

  protected static _actionForEntry(entry: MenuEntry): string | null {
    if (entry.row === MENU_LABEL_ROW_OPTIONS) {
      return 'open_options';
    }
    if (entry.row === MENU_LABEL_ROW_QUIT) {
      return 'back_to_menu';
    }
    if (entry.row === MENU_LABEL_ROW_BACK) {
      return 'back_to_previous';
    }
    return null;
  }

  protected _beginCloseTransition(action: string): void {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  protected _menuItemScale(slot: number): [number, number] {
    if (this._menuScreenWidth < (MENU_SCALE_SMALL_THRESHOLD + 1)) {
      return [0.9, slot * 11.0];
    }
    return [1.0, 0.0];
  }

  protected _uiElementAnim(opts: { index: number; startMs: number; endMs: number; width: number }): [number, number] {
    const index = opts.index;
    const startMs = opts.startMs;
    const endMs = opts.endMs;
    const width = opts.width;
    // Matches ui_element_update: angle lerps pi/2 -> 0 over [end_ms, start_ms].
    // Direction flag (element+0x314) appears to be 0 for menu elements.
    if (startMs <= endMs || width <= 0.0) {
      return [0.0, 0.0];
    }
    const t = this._timelineMs;
    let angle: number;
    let offsetX: number;
    if (t < endMs) {
      angle = 1.5707964;
      offsetX = -Math.abs(width);
    } else if (t < startMs) {
      const elapsed = t - endMs;
      const span = (startMs - endMs);
      const p = elapsed / span;
      angle = 1.5707964 * (1.0 - p);
      offsetX = -((1.0 - p) * Math.abs(width));
    } else {
      angle = 0.0;
      offsetX = 0.0;
    }
    if (index === 0) {
      angle = -Math.abs(angle);
    }
    return [angle, offsetX];
  }

  protected _menuItemBounds(entry: MenuEntry): Rect {
    const item = requireRuntimeResources(this.state).texture(TextureId.UI_MENU_ITEM);
    const itemW = item.width;
    const itemH = item.height;
    const [itemScale, localYShift] = this._menuItemScale(entry.slot);
    const offsetMin = new Vec2(MENU_ITEM_OFFSET_X * itemScale, MENU_ITEM_OFFSET_Y * itemScale - localYShift);
    const offsetMax = new Vec2((MENU_ITEM_OFFSET_X + itemW) * itemScale, (MENU_ITEM_OFFSET_Y + itemH) * itemScale - localYShift);
    const size = offsetMax.sub(offsetMin);
    const pos = new Vec2(MenuView._menuSlotPosX(entry.slot), entry.y);
    const topLeft = pos.add(new Vec2(offsetMin.x + size.x * 0.54, offsetMin.y + size.y * 0.28));
    const bottomRight = pos.add(new Vec2(offsetMax.x - size.x * 0.05, offsetMax.y - size.y * 0.10));
    return Rect.fromPosSize(topLeft, bottomRight.sub(topLeft));
  }

  protected _hoveredEntryIndex(): number | null {
    if (this._menuEntries.length === 0) {
      return null;
    }
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const mousePos = Vec2.fromXY(mouse);
    for (const [idx, entry] of this._menuEntries.entries()) {
      if (!this._menuEntryEnabled(entry)) {
        continue;
      }
      if (this._menuItemBounds(entry).contains(mousePos)) {
        return idx;
      }
    }
    return null;
  }

  protected _updateReadyTimers(dtMs: number): void {
    for (const entry of this._menuEntries) {
      if (entry.readyTimerMs < 0x100) {
        entry.readyTimerMs = Math.min(0x100, entry.readyTimerMs + dtMs);
      }
    }
  }

  protected _updateHoverAmounts(dtMs: number): void {
    const hoveredIndex = this._hoveredIndex;
    for (const [idx, entry] of this._menuEntries.entries()) {
      const hover = hoveredIndex !== null && idx === hoveredIndex;
      if (hover) {
        entry.hoverAmount += dtMs * 6;
      } else {
        entry.hoverAmount -= dtMs * 2;
      }
      entry.hoverAmount = Math.max(0, Math.min(1000, entry.hoverAmount));
    }
  }

  protected _menuEntryEnabled(entry: MenuEntry): boolean {
    return this._timelineMs >= MenuView._menuSlotStartMs(entry.slot);
  }

  protected _drawMenuItems(): void {
    if (this._menuEntries.length === 0) {
      return;
    }
    const resources = requireRuntimeResources(this.state);
    const item = resources.texture(TextureId.UI_MENU_ITEM);
    const labelTex = resources.texture(TextureId.UI_ITEM_TEXTS);
    const itemW = item.width;
    const itemH = item.height;
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    for (let idx = this._menuEntries.length - 1; -1 >= 0 ? idx < -1 : idx > -1; idx += -1) {
      const entry = this._menuEntries[idx];
      const pos = new Vec2(MenuView._menuSlotPosX(entry.slot), entry.y);
      const [angleRad, slideX] = this._uiElementAnim({ index: entry.slot + 2, startMs: MenuView._menuSlotStartMs(entry.slot), endMs: MenuView._menuSlotEndMs(entry.slot), width: itemW });
      const _ = slideX; // slide is ignored for render_mode==0 (transform) elements
      const [itemScale, localYShift] = this._menuItemScale(entry.slot);
      const offsetX = MENU_ITEM_OFFSET_X * itemScale;
      const offsetY = MENU_ITEM_OFFSET_Y * itemScale - localYShift;
      const dst = wgl.makeRectangle(pos.x, pos.y, itemW * itemScale, itemH * itemScale);
      const origin = wgl.makeVector2(-offsetX, -offsetY);
      const rotationDeg = (angleRad) * (180.0 / Math.PI);
      if (fxDetail) {
        drawUiQuadShadow({
          texture: item,
          src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
          dst: wgl.makeRectangle(dst.x + UI_SHADOW_OFFSET, dst.y + UI_SHADOW_OFFSET, dst.w, dst.h),
          origin: origin,
          rotationDeg: rotationDeg,
        });
      }
      wgl.drawTexturePro(item, wgl.makeRectangle(0.0, 0.0, itemW, itemH), dst, origin, rotationDeg, wgl.makeColor(1, 1, 1, 1));
      let counterValue = entry.hoverAmount;
      if (idx === this._selectedIndex && this._focusTimerMs > 0) {
        counterValue = this._focusTimerMs;
      }
      const alpha = MenuView._labelAlpha(counterValue);
      const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255);
      const src = wgl.makeRectangle(0.0, entry.row * MENU_LABEL_ROW_HEIGHT, MENU_LABEL_WIDTH, MENU_LABEL_ROW_HEIGHT);
      const labelOffsetX = MENU_LABEL_OFFSET_X * itemScale;
      const labelOffsetY = MENU_LABEL_OFFSET_Y * itemScale - localYShift;
      const labelDst = wgl.makeRectangle(pos.x, pos.y, MENU_LABEL_WIDTH * itemScale, MENU_LABEL_HEIGHT * itemScale);
      const labelOrigin = wgl.makeVector2(-labelOffsetX, -labelOffsetY);
      wgl.drawTexturePro(labelTex, src, labelDst, labelOrigin, rotationDeg, tint);
      let glowAlpha: any;
      if (this._menuEntryEnabled(entry)) {
        glowAlpha = alpha;
        if (0 <= entry.readyTimerMs && entry.readyTimerMs < 0x100) {
          glowAlpha = 0xFF - (Math.floor(entry.readyTimerMs / 2));
        }
        wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
        wgl.drawTexturePro(labelTex, src, labelDst, labelOrigin, rotationDeg, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, glowAlpha / 255));
        wgl.endBlendMode();
      }
    }
  }

  protected _drawMenuSign(): void {
    const screenW = this.state.config.display.width;
    const [scale, shiftX] = MenuView._signLayoutScale(int(screenW));
    const signPos = new Vec2(screenW + MENU_SIGN_POS_X_PAD, screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL);
    const signW = MENU_SIGN_WIDTH * scale;
    const signH = MENU_SIGN_HEIGHT * scale;
    const offsetX = MENU_SIGN_OFFSET_X * scale + shiftX;
    const offsetY = MENU_SIGN_OFFSET_Y * scale;
    let rotationDeg = 0.0;
    if (!this.state.menuSignLocked) {
      const [angleRad, slideX] = this._uiElementAnim({ index: 0, startMs: 300, endMs: 0, width: signW });
      const _ = slideX;
      rotationDeg = (angleRad) * (180.0 / Math.PI);
    }
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

  protected _entryIndexForRow(row: number): number | null {
    for (const [idx, entry] of this._menuEntries.entries()) {
      if (entry.row === row) {
        return idx;
      }
    }
    return null;
  }
}
