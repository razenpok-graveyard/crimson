// Port of crimson/screens/panels/databases_base.py

import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState } from '@crimson/game/types.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { hsLeftPanelPosX, hsRightPanelPosX } from '@crimson/screens/high-scores-layout.ts';
import { MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, uiElementAnim } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from '@crimson/screens/panels/base.ts';
import * as wgl from '@wgl';

// Shared panel layout (state_14/15/16 in the oracle): tall left panel + short right panel.
export const LEFT_PANEL_POS_Y = 185.0;
export const LEFT_PANEL_HEIGHT = 378.0;
export const RIGHT_PANEL_POS_Y = 200.0;
export const RIGHT_PANEL_HEIGHT = 254.0;

export abstract class DatabaseBaseView {
  state: GameState;
  protected _isOpen: boolean;
  protected _ground: GroundRenderer | null;
  protected _cursorPulseTime: number;
  protected _widescreenYShift: number;
  _timelineMs: number;
  protected _timelineMaxMs: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _pendingAction: string | null;
  protected _action: string | null;
  protected _backButton: UiButtonState;

  constructor(state: GameState) {
    this.state = state;
    this._isOpen = false;
    this._ground = null;

    this._cursorPulseTime = 0.0;
    this._widescreenYShift = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._action = null;

    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._widescreenYShift = MenuView._menuWidescreenYShift(layoutW);
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._action = null;

    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });

    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_PANELCLICK);
    }
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this._ground = null;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._action = null;
  }

  takeAction(): string | null {
    this._assertOpen();
    let action: string | null;
    if (this._pendingAction !== null) {
      action = this._pendingAction;
      this._pendingAction = null;
      this._closing = false;
      this._closeAction = null;
      this._timelineMs = this._timelineMaxMs;
      return action;
    }
    action = this._action;
    this._action = null;
    return action;
  }

  protected _assertOpen(): void {
    if (!(this._isOpen)) throw new Error(`${this.constructor.name} must be opened before use`);
  }

  protected _panelTopLeft(opts: { pos: Vec2; scale: number }): Vec2 {
    const pos = opts.pos;
    const scale = opts.scale;
    return new Vec2(pos.x + MENU_PANEL_OFFSET_X * scale, pos.y + this._widescreenYShift + MENU_PANEL_OFFSET_Y * scale);
  }

  protected _beginCloseTransition(action: string): void {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  protected _drawSign(): void {
    const sign = requireRuntimeResources(this.state).texture(TextureId.UI_SIGN_CRIMSON);
    const screenW = this.state.config.display.width;
    const [signScale, shiftX] = MenuView._signLayoutScale(int(screenW));
    const signPos = new Vec2(screenW + MENU_SIGN_POS_X_PAD, screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL);
    const signW = MENU_SIGN_WIDTH * signScale;
    const signH = MENU_SIGN_HEIGHT * signScale;
    const offsetX = MENU_SIGN_OFFSET_X * signScale + shiftX;
    const offsetY = MENU_SIGN_OFFSET_Y * signScale;
    const rotationDeg = 0.0;
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
      this._timelineMs = Math.min(this._timelineMaxMs, int(this._timelineMs + dtMs));
    }

    const enabled = this._timelineMs >= this._timelineMaxMs;

    if (InputState.wasKeyPressed(27) && enabled) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_previous');
      return;
    }

    if (!enabled) {
      return;
    }

    const screenWidth = this.state.config.display.width;
    const scale = 1.0;
    const leftPanelPosX = hsLeftPanelPosX(screenWidth);
    const leftTopLeft = this._panelTopLeft({ pos: new Vec2(leftPanelPosX, LEFT_PANEL_POS_Y), scale: scale });
    const resources = requireRuntimeResources(this.state);

    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
    this._updateContentInteraction({ leftTopLeft: leftTopLeft, scale: scale, mouse: mouse });

    const backPos = this._backButtonPos();
    const backW = buttonWidth(resources, this._backButton.label, { scale: scale, forceWide: this._backButton.forceWide });
    if (buttonUpdate(this._backButton, { pos: leftTopLeft.add(backPos.mul(scale)), width: backW, dtMs: dtMs, mouse: mouse, click: click })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_previous');
    }
  }

  draw(): void {
    this._assertOpen();
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    const pauseBackground = this.state.pauseBackground;
    if (pauseBackground !== null) {
      pauseBackground.drawPauseBackground();
    } else if (this._ground !== null) {
      this._ground.draw(menuGroundCamera(this.state));
    }
    drawScreenFade(this.state);

    const screenWidth = this.state.config.display.width;
    const scale = 1.0;
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });

    const panelW = MENU_PANEL_WIDTH * scale;
    let [angleRad, leftSlideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 0 });
    let rightSlideX: any;
    [angleRad, rightSlideX] = uiElementAnim(this, { index: 2, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 1 });

    const leftPanelPosX = hsLeftPanelPosX(screenWidth);
    const leftTopLeft = this._panelTopLeft({ pos: new Vec2(leftPanelPosX, LEFT_PANEL_POS_Y), scale: scale });
    const rightPanelPosX = hsRightPanelPosX(screenWidth);
    const rightTopLeft = this._panelTopLeft({ pos: new Vec2(rightPanelPosX, RIGHT_PANEL_POS_Y), scale: scale });
    const leftPanelTopLeft = leftTopLeft.offset({ dx: leftSlideX });
    const rightPanelTopLeft = rightTopLeft.offset({ dx: rightSlideX });

    drawClassicMenuPanel(
      requireRuntimeResources(this.state).texture(TextureId.UI_MENU_PANEL),
      { dst: wgl.makeRectangle(leftPanelTopLeft.x, leftPanelTopLeft.y, panelW, LEFT_PANEL_HEIGHT * scale), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail },
    );
    drawClassicMenuPanel(
      requireRuntimeResources(this.state).texture(TextureId.UI_MENU_PANEL),
      { dst: wgl.makeRectangle(rightPanelTopLeft.x, rightPanelTopLeft.y, panelW, RIGHT_PANEL_HEIGHT * scale), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail, flipX: true },
    );

    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;
    this._drawContents({ leftTopLeft: leftPanelTopLeft, rightTopLeft: rightPanelTopLeft, scale: scale, font: font });

    const backPos = this._backButtonPos();
    const backW = buttonWidth(resources, this._backButton.label, { scale: scale, forceWide: this._backButton.forceWide });
    buttonDraw(
      resources,
      this._backButton,
      { pos: leftPanelTopLeft.add(backPos.mul(scale)), width: backW, scale: scale },
    );

    this._drawSign();
    drawMenuCursorHelper(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
  }

  protected abstract _backButtonPos(): Vec2;

  protected abstract _drawContents(opts: { leftTopLeft: Vec2; rightTopLeft: Vec2; scale: number; font: SmallFontData }): void;

  protected _updateContentInteraction(opts: { leftTopLeft: Vec2; scale: number; mouse: wgl.Vector2 }): void {
    const leftTopLeft = opts.leftTopLeft;
    const scale = opts.scale;
    const mouse = opts.mouse;
    return;
  }
}
