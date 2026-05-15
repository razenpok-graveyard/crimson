// Port of crimson/screens/pause_menu.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { audioPlaySfx, audioUpdate } from '@grim/audio.ts';
import { Vec2, Rect } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { fxDetailEnabled } from '@grim/config.ts';
import { InputState } from '@grim/input.ts';
import { menuWidescreenYShift } from '@crimson/ui/layout.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { type GameState } from '@crimson/game/types.ts';
import { type PauseBackground } from '@crimson/pause-background.ts';
import { requireRuntimeResources } from './assets.ts';
import { MENU_LABEL_WIDTH, MENU_LABEL_HEIGHT, MENU_LABEL_BASE_Y, MENU_LABEL_ROW_HEIGHT, MENU_LABEL_ROW_BACK, MENU_LABEL_ROW_OPTIONS, MENU_LABEL_ROW_QUIT, MENU_LABEL_OFFSET_X, MENU_LABEL_OFFSET_Y, MENU_ITEM_OFFSET_X, MENU_ITEM_OFFSET_Y, MENU_LABEL_STEP, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_WIDTH, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_POS_X_PAD, MenuEntry, menuSlotEndMs, menuSlotPosX, menuSlotStartMs, uiElementAnim, labelAlpha, signLayoutScale, drawMenuCursorHelper } from './menu.ts';
import { drawScreenFade } from './transitions.ts';

export const PAUSE_MENU_TO_MAIN_MENU_FADE_MS = 500;

const KEY_ESCAPE = 27;
const KEY_ENTER = 13;
const KEY_TAB = 9;
const KEY_LEFT_SHIFT = 16;
const KEY_RIGHT_SHIFT = 345;
const MOUSE_BUTTON_LEFT = 0;

const WHITE = wgl.makeColor(1, 1, 1, 1);

export class PauseMenuView {
  state: GameState;

  private _isOpen: boolean = false;
  private _menuEntries: MenuEntry[] = [];
  private _selectedIndex: number = 0;
  private _focusTimerMs: number = 0;
  private _hoveredIndex: number | null = null;
  _timelineMs: number = 0;
  private _timelineMaxMs: number = 0;
  private _cursorPulseTime: number = 0.0;
  private _widescreenYShift: number = 0.0;
  private _menuScreenWidth: number = 0;
  private _closing: boolean = false;
  private _closeAction: string | null = null;
  private _pendingAction: string | null = null;
  private _panelOpenSfxPlayed: boolean = false;

  constructor(state: GameState) {
    this.state = state;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._menuScreenWidth = int(layoutW);
    this._widescreenYShift = menuWidescreenYShift(layoutW);
    const ys = [
      MENU_LABEL_BASE_Y + this._widescreenYShift,
      MENU_LABEL_BASE_Y + MENU_LABEL_STEP + this._widescreenYShift,
      MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 2.0 + this._widescreenYShift,
    ];
    this._menuEntries = [
      new MenuEntry({ slot: 0, row: MENU_LABEL_ROW_OPTIONS, y: ys[0] }),
      new MenuEntry({ slot: 1, row: MENU_LABEL_ROW_QUIT, y: ys[1] }),
      new MenuEntry({ slot: 2, row: MENU_LABEL_ROW_BACK, y: ys[2] }),
    ];
    this._selectedIndex = this._menuEntries.length > 0 ? 0 : -1;
    this._focusTimerMs = 0;
    this._hoveredIndex = null;
    this._timelineMs = 0;
    this._timelineMaxMs = 300;
    for (const entry of this._menuEntries) {
      const ms = menuSlotStartMs(entry.slot);
      if (ms > this._timelineMaxMs) this._timelineMaxMs = ms;
    }
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
      audioUpdate(this.state.audio, dt);
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
        if (!this._panelOpenSfxPlayed && this.state.audio !== null) {
          audioPlaySfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }

    if (this._menuEntries.length === 0) return;

    this._hoveredIndex = this._hoveredEntryIndex();

    if (InputState.wasKeyPressed(KEY_TAB)) {
      const reverse = InputState.isKeyDown(KEY_LEFT_SHIFT) || InputState.isKeyDown(KEY_RIGHT_SHIFT);
      const delta = reverse ? -1 : 1;
      this._selectedIndex = ((this._selectedIndex + delta) % this._menuEntries.length + this._menuEntries.length) % this._menuEntries.length;
      this._focusTimerMs = 1000;
    }

    let activatedIndex: number | null = null;
    if (InputState.wasKeyPressed(KEY_ESCAPE)) {
      // ESC behaves like selecting Back.
      activatedIndex = this._entryIndexForRow(MENU_LABEL_ROW_BACK);
    } else if (InputState.wasKeyPressed(KEY_ENTER) && 0 <= this._selectedIndex && this._selectedIndex < this._menuEntries.length) {
      const entry = this._menuEntries[this._selectedIndex];
      if (this._menuEntryEnabled(entry)) {
        activatedIndex = this._selectedIndex;
      }
    }

    if (activatedIndex === null && this._hoveredIndex !== null) {
      if (InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
        const hovered = this._hoveredIndex;
        const entry = this._menuEntries[hovered];
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
    if (pauseBackground != null) {
      pauseBackground.drawPauseBackground({ entityAlpha: this._pauseBackgroundEntityAlpha() });
    }

    drawScreenFade(this.state);

    this._drawMenuItems();
    this._drawMenuSign();
    drawMenuCursorHelper(this.state, {
      resources: requireRuntimeResources(this.state),
      pulseTime: this._cursorPulseTime,
    });
  }

  takeAction(): string | null {
    this._assertOpen();
    const action = this._pendingAction;
    this._pendingAction = null;
    return action;
  }

  private _assertOpen(): void {
    if (!this._isOpen) {
      throw new Error('PauseMenuView must be opened before use');
    }
  }

  private _pauseBackground(): PauseBackground | null {
    return this.state.pauseBackground;
  }

  private _pauseBackgroundEntityAlpha(): number {
    // Native gameplay_render_world keeps gameplay entities fully visible for most transitions,
    // but fades them out when pause menu closes to main menu (ui_element_slot_28 timing = 0x1f4 ms).
    if (!this._closing || this._closeAction !== 'back_to_menu') {
      return 1.0;
    }
    const alpha = this._timelineMs / PAUSE_MENU_TO_MAIN_MENU_FADE_MS;
    if (alpha < 0.0) return 0.0;
    if (alpha > 1.0) return 1.0;
    return alpha;
  }

  private _activateMenuEntry(index: number): void {
    if (!(0 <= index && index < this._menuEntries.length)) return;
    const entry = this._menuEntries[index];
    const action = PauseMenuView._actionForEntry(entry);
    if (action === null) return;
    if (this.state.audio !== null) audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    this._beginCloseTransition(action);
  }

  private static _actionForEntry(entry: MenuEntry): string | null {
    if (entry.row === MENU_LABEL_ROW_OPTIONS) return 'open_options';
    if (entry.row === MENU_LABEL_ROW_QUIT) return 'back_to_menu';
    if (entry.row === MENU_LABEL_ROW_BACK) return 'back_to_previous';
    return null;
  }

  private _beginCloseTransition(action: string): void {
    if (this._closing) return;
    this._closing = true;
    this._closeAction = action;
  }

  private _menuItemScale(slot: number): [number, number] {
    if (this._menuScreenWidth < (MENU_SCALE_SMALL_THRESHOLD + 1)) {
      return [0.9, slot * 11.0];
    }
    return [1.0, 0.0];
  }

  private _uiElementAnim(
    opts: {
      index: number;
      startMs: number;
      endMs: number;
      width: number;
    },
  ): [number, number] {
    const { index, startMs, endMs, width } = opts;
    // Matches ui_element_update: angle lerps pi/2 -> 0 over [end_ms, start_ms].
    // Direction flag (element+0x314) appears to be 0 for menu elements.
    return uiElementAnim(this, { index, startMs, endMs, width, directionFlag: 0 });
  }

  private _menuItemBounds(entry: MenuEntry): Rect {
    const item = getTexture(requireRuntimeResources(this.state), TextureId.UI_MENU_ITEM);
    const itemW = item.width;
    const itemH = item.height;
    const [itemScale, localYShift] = this._menuItemScale(entry.slot);
    const offsetMin = new Vec2(
      MENU_ITEM_OFFSET_X * itemScale,
      MENU_ITEM_OFFSET_Y * itemScale - localYShift,
    );
    const offsetMax = new Vec2(
      (MENU_ITEM_OFFSET_X + itemW) * itemScale,
      (MENU_ITEM_OFFSET_Y + itemH) * itemScale - localYShift,
    );
    const size = offsetMax.sub(offsetMin);
    const pos = new Vec2(menuSlotPosX(entry.slot), entry.y);
    const topLeft = pos.add(new Vec2(
      offsetMin.x + size.x * 0.54,
      offsetMin.y + size.y * 0.28,
    ));
    const bottomRight = pos.add(new Vec2(
      offsetMax.x - size.x * 0.05,
      offsetMax.y - size.y * 0.10,
    ));
    const br = bottomRight.sub(topLeft);
    return Rect.fromPosSize(topLeft, br);
  }

  private _hoveredEntryIndex(): number | null {
    if (this._menuEntries.length === 0) return null;
    const [mx, my] = InputState.mousePosition();
    const mousePos = new Vec2(mx, my);
    for (let idx = 0; idx < this._menuEntries.length; idx++) {
      const entry = this._menuEntries[idx];
      if (!this._menuEntryEnabled(entry)) continue;
      if (this._menuItemBounds(entry).contains(mousePos)) {
        return idx;
      }
    }
    return null;
  }

  private _updateReadyTimers(dtMs: number): void {
    for (const entry of this._menuEntries) {
      if (entry.readyTimerMs < 0x100) {
        entry.readyTimerMs = Math.min(0x100, entry.readyTimerMs + dtMs);
      }
    }
  }

  private _updateHoverAmounts(dtMs: number): void {
    const hoveredIndex = this._hoveredIndex;
    for (let idx = 0; idx < this._menuEntries.length; idx++) {
      const entry = this._menuEntries[idx];
      const hover = hoveredIndex !== null && idx === hoveredIndex;
      if (hover) {
        entry.hoverAmount += dtMs * 6;
      } else {
        entry.hoverAmount -= dtMs * 2;
      }
      entry.hoverAmount = Math.max(0, Math.min(1000, entry.hoverAmount));
    }
  }

  private _menuEntryEnabled(entry: MenuEntry): boolean {
    return this._timelineMs >= menuSlotStartMs(entry.slot);
  }

  private _drawMenuItems(): void {
    if (this._menuEntries.length === 0) return;
    const resources = requireRuntimeResources(this.state);
    const item = getTexture(resources, TextureId.UI_MENU_ITEM);
    const labelTex = getTexture(resources, TextureId.UI_ITEM_TEXTS);
    const itemW = item.width;
    const itemH = item.height;
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);

    for (let idx = this._menuEntries.length - 1; idx >= 0; idx--) {
      const entry = this._menuEntries[idx];
      const pos = new Vec2(menuSlotPosX(entry.slot), entry.y);
      const [angleRad, _slideX] = this._uiElementAnim({
        index: entry.slot + 2,
        startMs: menuSlotStartMs(entry.slot),
        endMs: menuSlotEndMs(entry.slot),
        width: itemW,
      });
      // slide is ignored for render_mode==0 (transform) elements
      const [itemScale, localYShift] = this._menuItemScale(entry.slot);
      const offsetX = MENU_ITEM_OFFSET_X * itemScale;
      const offsetY = MENU_ITEM_OFFSET_Y * itemScale - localYShift;
      const dst = wgl.makeRectangle(
        pos.x,
        pos.y,
        itemW * itemScale,
        itemH * itemScale,
      );
      const origin = wgl.makeVector2(-offsetX, -offsetY);
      const rotationDeg = angleRad * (180.0 / Math.PI);

      if (fxDetail) {
        drawUiQuadShadow({
          texture: item,
          src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
          dst: wgl.makeRectangle(dst.x + UI_SHADOW_OFFSET, dst.y + UI_SHADOW_OFFSET, dst.w, dst.h),
          origin, rotationDeg,
        });
      }
      wgl.drawTexturePro(
        item,
        wgl.makeRectangle(0.0, 0.0, itemW, itemH),
        dst,
        origin, rotationDeg, WHITE,
      );

      let counterValue = entry.hoverAmount;
      if (idx === this._selectedIndex && this._focusTimerMs > 0) {
        counterValue = this._focusTimerMs;
      }
      const alpha = labelAlpha(counterValue);
      const alphaNorm = alpha / 255;
      const tint = wgl.makeColor(1, 1, 1, alphaNorm);
      const src = wgl.makeRectangle(
        0.0,
        entry.row * MENU_LABEL_ROW_HEIGHT,
        MENU_LABEL_WIDTH,
        MENU_LABEL_ROW_HEIGHT,
      );
      const labelOffsetX = MENU_LABEL_OFFSET_X * itemScale;
      const labelOffsetY = MENU_LABEL_OFFSET_Y * itemScale - localYShift;
      const labelDst = wgl.makeRectangle(
        pos.x,
        pos.y,
        MENU_LABEL_WIDTH * itemScale,
        MENU_LABEL_HEIGHT * itemScale,
      );
      const labelOrigin = wgl.makeVector2(-labelOffsetX, -labelOffsetY);
      wgl.drawTexturePro(labelTex, src, labelDst, labelOrigin, rotationDeg, tint);

      if (this._menuEntryEnabled(entry)) {
        let glowAlpha = alpha;
        if (0 <= entry.readyTimerMs && entry.readyTimerMs < 0x100) {
          glowAlpha = 0xFF - Math.floor(entry.readyTimerMs / 2);
        }
        const glowAlphaNorm = glowAlpha / 255;
        wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
        wgl.drawTexturePro(
          labelTex, src, labelDst, labelOrigin, rotationDeg,
          wgl.makeColor(1, 1, 1, glowAlphaNorm),
        );
        wgl.endBlendMode();
      }
    }
  }

  private _drawMenuSign(): void {
    const screenW = this.state.config.display.width;
    const [scale, shiftX] = signLayoutScale(int(screenW));
    const signPosY = screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL;
    const signPos = new Vec2(screenW + MENU_SIGN_POS_X_PAD, signPosY);
    const signW = MENU_SIGN_WIDTH * scale;
    const signH = MENU_SIGN_HEIGHT * scale;
    const offsetX = MENU_SIGN_OFFSET_X * scale + shiftX;
    const offsetY = MENU_SIGN_OFFSET_Y * scale;
    let rotationDeg = 0.0;
    if (!this.state.menuSignLocked) {
      const [angleRad, _slideX] = this._uiElementAnim({
        index: 0,
        startMs: 300,
        endMs: 0,
        width: signW,
      });
      rotationDeg = angleRad * (180.0 / Math.PI);
    }
    const resources = requireRuntimeResources(this.state);
    const sign = getTexture(resources, TextureId.UI_SIGN_CRIMSON);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const signSrc = wgl.makeRectangle(0.0, 0.0, sign.width, sign.height);
    const signOrigin = wgl.makeVector2(-offsetX, -offsetY);

    if (fxDetail) {
      drawUiQuadShadow({
        texture: sign,
        src: signSrc,
        dst: wgl.makeRectangle(signPos.x + UI_SHADOW_OFFSET, signPos.y + UI_SHADOW_OFFSET, signW, signH),
        origin: signOrigin, rotationDeg,
      });
    }
    wgl.drawTexturePro(
      sign, signSrc,
      wgl.makeRectangle(signPos.x, signPos.y, signW, signH),
      signOrigin, rotationDeg, WHITE,
    );
  }

  private _entryIndexForRow(row: number): number | null {
    for (let idx = 0; idx < this._menuEntries.length; idx++) {
      if (this._menuEntries[idx].row === row) return idx;
    }
    return null;
  }
}
