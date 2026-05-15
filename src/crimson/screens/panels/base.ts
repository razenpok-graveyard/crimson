// Port of crimson/screens/panels/base.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { audioPlaySfx, audioUpdate } from '@grim/audio.ts';
import { Vec2, Rect } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { fxDetailEnabled } from '@grim/config.ts';
import { InputState } from '@grim/input.ts';
import { type GroundRenderer } from '@grim/terrain-render.ts';
import { menuWidescreenYShift } from '@crimson/ui/layout.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { GameState } from '@crimson/game/types.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_ITEM_OFFSET_X, MENU_ITEM_OFFSET_Y, MENU_LABEL_HEIGHT, MENU_LABEL_OFFSET_X, MENU_LABEL_OFFSET_Y, MENU_LABEL_ROW_BACK, MENU_LABEL_ROW_HEIGHT, MENU_LABEL_WIDTH, MENU_PANEL_HEIGHT, MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuEntry, drawMenuCursorHelper, ensureMenuGround, labelAlpha, menuGroundCamera, signLayoutScale, uiElementAnim } from '@crimson/screens/menu.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';

const PANEL_POS_X = -45.0;
const PANEL_POS_Y = 210.0;
const PANEL_BACK_POS_X = -55.0;
const PANEL_BACK_POS_Y = 430.0;
export const PANEL_TIMELINE_START_MS = 300;
export const PANEL_TIMELINE_END_MS = 0;

export const FADE_TO_GAME_ACTIONS = new Set([
  'start_survival',
  'start_rush',
  'start_typo',
  'start_tutorial',
  'start_quest',
]);

const KEY_ESCAPE = 27;
const KEY_ENTER = 13;
const MOUSE_BUTTON_LEFT = 0;

const WHITE = wgl.makeColor(1, 1, 1, 1);

export class PanelMenuView {
  state: GameState;

  private _isOpen: boolean = false;
  private _title: string;
  private _bodyLines: string[];
  protected _panelPos: Vec2;
  protected _panelOffset: Vec2;
  protected _panelHeight: number;
  protected _backPos: Vec2;
  protected _backAction: string;

  protected _ground: GroundRenderer | null = null;
  protected _entry: MenuEntry | null = null;
  protected _hovered: boolean = false;
  protected _menuScreenWidth: number = 0;
  protected _widescreenYShift: number = 0.0;
  _timelineMs: number = 0;
  protected _timelineMaxMs: number = 0;
  protected _cursorPulseTime: number = 0.0;
  protected _closing: boolean = false;
  protected _closeAction: string | null = null;
  protected _pendingAction: string | null = null;
  private _panelOpenSfxPlayed: boolean = false;

  constructor(
    state: GameState,
    opts: {
      title: string;
      body?: string | null;
      panelPos?: Vec2;
      panelOffset?: Vec2;
      panelHeight?: number;
      backPos?: Vec2;
      backAction?: string;
    },
  ) {
    this.state = state;
    this._title = opts.title;
    const body = opts.body ?? '';
    this._bodyLines = body === '' ? [] : body.split(/\r\n|\r|\n/);
    if (body.endsWith('\n') || body.endsWith('\r')) {
      this._bodyLines.pop();
    }
    this._panelPos = opts.panelPos ?? new Vec2(PANEL_POS_X, PANEL_POS_Y);
    this._panelOffset = opts.panelOffset ?? new Vec2(MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y);
    this._panelHeight = opts.panelHeight ?? MENU_PANEL_HEIGHT;
    this._backPos = opts.backPos ?? new Vec2(PANEL_BACK_POS_X, PANEL_BACK_POS_Y);
    this._backAction = opts.backAction ?? 'back_to_menu';
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._menuScreenWidth = int(layoutW);
    this._widescreenYShift = menuWidescreenYShift(layoutW);
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
      audioUpdate(this.state.audio, dt);
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
        if (!this._panelOpenSfxPlayed && this.state.audio !== null) {
          audioPlaySfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }

    const entry = this._entry;
    if (entry === null) return;

    const enabled = this._entryEnabled(entry);
    const hovered = enabled && this._hoveredEntry(entry);
    this._hovered = hovered;

    if (InputState.wasKeyPressed(KEY_ESCAPE) && enabled) {
      this._beginCloseTransition(this._backAction);
    }
    if (InputState.wasKeyPressed(KEY_ENTER) && enabled) {
      this._beginCloseTransition(this._backAction);
    }
    if (enabled && hovered && InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
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
    if (entry === null) {
      throw new Error('PanelMenuView entry must be initialized before draw()');
    }

    this._drawPanel();
    this._drawEntry(entry);
    this._drawSign();
    this._drawContents();
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

  protected _drawContents(): void {
    this._drawTitleText();
  }

  protected _assertOpen(): void {
    if (!this._isOpen) {
      throw new Error(`${this.constructor.name} must be opened before use`);
    }
  }

  private _drawTitleText(): void {
    const x = 32;
    let y = 140;
    const titleColor = wgl.makeColor(235 / 255, 235 / 255, 235 / 255, 1);
    wgl.drawText(this._title, x, y, 28, titleColor);
    y += 34;
    const bodyColor = wgl.makeColor(190 / 255, 190 / 255, 200 / 255, 1);
    for (const line of this._bodyLines) {
      wgl.drawText(line, x, y, 18, bodyColor);
      y += 22;
    }
  }

  protected _beginCloseTransition(action: string): void {
    if (this._closing) return;
    if (FADE_TO_GAME_ACTIONS.has(action)) {
      this.state.screenFadeAlpha = 0.0;
      this.state.screenFadeRamp = true;
    }
    if (this.state.audio !== null) {
      audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._closing = true;
    this._closeAction = action;
  }

  private _initGround(): void {
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
    const resources = requireRuntimeResources(this.state);
    const panel = getTexture(resources, TextureId.UI_MENU_PANEL);
    const [_angleRad, slideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: MENU_PANEL_WIDTH * this._menuItemScale(0)[0],
    });
    const [itemScale, _localYShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * itemScale;
    const panelH = this._panelHeight * itemScale;
    const panelTopLeft = new Vec2(
      this._panelPos.x + slideX,
      this._panelPos.y + this._widescreenYShift,
    ).add(this._panelOffset.mul(itemScale));
    const dst = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, panelW, panelH);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    drawClassicMenuPanel(panel, { dst, tint: WHITE, shadow: fxDetail });
  }

  protected _drawEntry(entry: MenuEntry): void {
    const resources = requireRuntimeResources(this.state);
    const item = getTexture(resources, TextureId.UI_MENU_ITEM);
    const labelTex = getTexture(resources, TextureId.UI_ITEM_TEXTS);
    const itemW = item.width;
    const itemH = item.height;
    const [_angleRad, slideX] = uiElementAnim(this, {
      index: 2,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: itemW * this._menuItemScale(entry.slot)[0],
    });
    const pos = new Vec2(this._backPos.x + slideX, entry.y + this._widescreenYShift);
    const [itemScale, localYShift] = this._menuItemScale(entry.slot);
    const offsetX = MENU_ITEM_OFFSET_X * itemScale;
    const offsetY = MENU_ITEM_OFFSET_Y * itemScale - localYShift;
    const dst = wgl.makeRectangle(pos.x, pos.y, itemW * itemScale, itemH * itemScale);
    const origin = wgl.makeVector2(-offsetX, -offsetY);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);

    if (fxDetail) {
      drawUiQuadShadow({
        texture: item,
        src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
        dst: wgl.makeRectangle(dst.x + UI_SHADOW_OFFSET, dst.y + UI_SHADOW_OFFSET, dst.w, dst.h),
        origin, rotationDeg: 0.0,
      });
    }
    wgl.drawTexturePro(
      item,
      wgl.makeRectangle(0.0, 0.0, itemW, itemH),
      dst,
      origin, 0.0, WHITE,
    );

    const alpha = labelAlpha(entry.hoverAmount);
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
    wgl.drawTexturePro(labelTex, src, labelDst, labelOrigin, 0.0, tint);

    if (this._entryEnabled(entry)) {
      wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
      wgl.drawTexturePro(
        labelTex, src, labelDst, labelOrigin, 0.0,
        wgl.makeColor(1, 1, 1, alphaNorm),
      );
      wgl.endBlendMode();
    }
  }

  protected _drawSign(): void {
    const screenW = this.state.config.display.width;
    const [scale, shiftX] = signLayoutScale(int(screenW));
    const signPos = new Vec2(
      screenW + MENU_SIGN_POS_X_PAD,
      screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL,
    );
    const signW = MENU_SIGN_WIDTH * scale;
    const signH = MENU_SIGN_HEIGHT * scale;
    const signOffsetX = MENU_SIGN_OFFSET_X * scale + shiftX;
    const signOffsetY = MENU_SIGN_OFFSET_Y * scale;
    // Quest screen is only reachable after the Play Game panel is fully visible,
    // so the sign is already locked in place. Keep it static here.
    const rotationDeg = 0.0;

    const resources = requireRuntimeResources(this.state);
    const sign = getTexture(resources, TextureId.UI_SIGN_CRIMSON);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const signSrc = wgl.makeRectangle(0.0, 0.0, sign.width, sign.height);
    const signOrigin = wgl.makeVector2(-signOffsetX, -signOffsetY);

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

  protected _entryEnabled(_entry: MenuEntry): boolean {
    return this._timelineMs >= PANEL_TIMELINE_START_MS;
  }

  protected _hoveredEntry(entry: MenuEntry): boolean {
    const [mx, my] = InputState.mousePosition();
    const mousePos = new Vec2(mx, my);
    return this._menuItemBounds(entry).contains(mousePos);
  }

  protected _menuItemScale(slot: number): [number, number] {
    if (this._menuScreenWidth < 641) {
      return [0.9, slot * 11.0];
    }
    return [1.0, 0.0];
  }

  private _menuItemBounds(entry: MenuEntry): Rect {
    const resources = requireRuntimeResources(this.state);
    const item = getTexture(resources, TextureId.UI_MENU_ITEM);
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
    const [_angleRad, slideX] = uiElementAnim(this, {
      index: 2,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: itemW * itemScale,
    });
    const pos = new Vec2(this._backPos.x + slideX, entry.y + this._widescreenYShift);
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
}
