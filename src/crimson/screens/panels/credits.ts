// Port of crimson/screens/panels/credits.py

import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import { debugEnabled } from '@crimson/debug.ts';
import type { GameState } from '@crimson/game/types.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, uiElementAnim } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from '@crimson/screens/panels/base.ts';
import * as wgl from '@wgl';

// Measured from ui_render_trace_oracle_1024x768.json (state_17:credits, timeline=300).
export const CREDITS_PANEL_POS_X = -119.0;
export const CREDITS_PANEL_POS_Y = 185.0;
export const CREDITS_PANEL_HEIGHT = 378.0;
// Child layout inside the panel (relative to panel top-left).
const _TITLE_X = 202.0;
const _TITLE_Y = 46.0;
const _TEXT_ANCHOR_X = 198.0;
const _TEXT_CENTER_OFFSET_X = 140.0;
const _TEXT_BASE_Y = 60.0;
const _TEXT_LINE_HEIGHT = 16.0;
const _TEXT_FADE_PX = 24.0;
const _TEXT_RECT_H = 16.0;
const _BACK_BUTTON_X = 298.0;
const _BACK_BUTTON_Y = 310.0;
const _SECRET_BUTTON_X = 392.0;
const _SECRET_BUTTON_Y = 310.0;
const _FLAG_HEADING = 0x1;
const _FLAG_CLICKED = 0x4;
const _CREDITS_TABLE_SIZE = 0x100;
const _CREDITS_SECRET_LINE_COUNT = 10;
const _CREDITS_SECRET_LINES = [
  'Inside Dead Let Mighty Blood',
  'Do Firepower See Mark Of',
  'The Sacrifice Old Center',
  'Yourself Ground First For',
  'Triangle Cube Last Not Flee',
  '0001001110000010101110011',
  '0101001011100010010101100',
  '011111001000111',
  '(4 bits for index) <- OOOPS I meant FIVE!',
  '(4 bits for index)',
];

if (!(_CREDITS_SECRET_LINES.length === _CREDITS_SECRET_LINE_COUNT)) throw new Error();

export class CreditsLine {
  text: string;
  flags: number;

  constructor(opts: {
    text?: string;
    flags?: number;
  } = {}) {
    this.text = opts.text ?? '';
    this.flags = opts.flags ?? 0;
  }
}

export class CreditsView {
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
  protected _lines: CreditsLine[];
  protected _lineMaxIndex: number;
  protected _secretLineBaseIndex: number;
  protected _secretUnlock: boolean;
  protected _scrollTimeS: number;
  protected _scrollLineStartIndex: number;
  protected _scrollLineEndIndex: number;
  protected _backButton: UiButtonState;
  protected _secretButton: UiButtonState;

  get isOpen(): boolean {
    return this._isOpen;
  }
  get ground(): GroundRenderer | null {
    return this._ground;
  }
  get cursorPulseTime(): number {
    return this._cursorPulseTime;
  }
  get widescreenYShift(): number {
    return this._widescreenYShift;
  }
  get timelineMaxMs(): number {
    return this._timelineMaxMs;
  }
  get closing(): boolean {
    return this._closing;
  }
  get closeAction(): string | null {
    return this._closeAction;
  }
  get pendingAction(): string | null {
    return this._pendingAction;
  }
  get action(): string | null {
    return this._action;
  }
  get lines(): CreditsLine[] {
    return this._lines;
  }
  get lineMaxIndex(): number {
    return this._lineMaxIndex;
  }
  get secretLineBaseIndex(): number {
    return this._secretLineBaseIndex;
  }
  get secretUnlock(): boolean {
    return this._secretUnlock;
  }
  get scrollTimeS(): number {
    return this._scrollTimeS;
  }
  get scrollLineStartIndex(): number {
    return this._scrollLineStartIndex;
  }
  get scrollLineEndIndex(): number {
    return this._scrollLineEndIndex;
  }
  get backButton(): UiButtonState {
    return this._backButton;
  }
  get secretButton(): UiButtonState {
    return this._secretButton;
  }

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

    this._lines = [];
    this._lineMaxIndex = 0;
    this._secretLineBaseIndex = 0x54;
    this._secretUnlock = false;
    this._scrollTimeS = 0.0;
    this._scrollLineStartIndex = 0;
    this._scrollLineEndIndex = 0;

    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });
    this._secretButton = new UiButtonState({ label: 'Secret', forceWide: false });
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

    [this._lines, this._lineMaxIndex, this._secretLineBaseIndex] = creditsBuildLines();
    this._secretUnlock = false;
    this._scrollTimeS = 0.0;
    this._scrollLineStartIndex = 0;
    this._scrollLineEndIndex = 0;

    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });
    this._secretButton = new UiButtonState({ label: 'Secret', forceWide: false });

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
    if (!(this._isOpen)) throw new Error('CreditsView must be opened before use');
  }

  protected _beginCloseTransition(action: string): void {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  protected _panelTopLeft(opts: { scale: number }): Vec2 {
    const scale = opts.scale;
    return new Vec2(CREDITS_PANEL_POS_X + MENU_PANEL_OFFSET_X * scale, CREDITS_PANEL_POS_Y + this._widescreenYShift + MENU_PANEL_OFFSET_Y * scale);
  }

  protected static _scrollFractionPx(scrollTimeS: number, opts: { scale: number }): number {
    const scale = opts.scale;
    let frac = scrollTimeS * (_TEXT_LINE_HEIGHT * scale);
    const lineH = _TEXT_LINE_HEIGHT * scale;
    while (frac > lineH) {
      frac -= lineH;
    }
    return frac;
  }

  protected _updateScrollWindow(): void {
    if ((this._lineMaxIndex + 2) < this._scrollLineStartIndex) {
      this._scrollTimeS = 0.0;
      this._scrollLineStartIndex = 0;
    }

    const wholeScroll = int(this._scrollTimeS);
    this._scrollLineStartIndex = wholeScroll - 0x0F;
    this._scrollLineEndIndex = wholeScroll + 1;
    if (this._lineMaxIndex < this._scrollLineEndIndex) {
      this._scrollLineEndIndex = this._lineMaxIndex;
    }
  }

  protected _panelSlideX(opts: { scale: number }): number {
    const scale = opts.scale;
    const panelW = MENU_PANEL_WIDTH * scale;
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 0 });
    return slideX;
  }

  protected static _mouseInsideRect(mouse: wgl.Vector2, opts: { x: number; y: number; w: number; h: number }): boolean {
    const x = opts.x;
    const y = opts.y;
    const w = opts.w;
    const h = opts.h;
    return (x <= mouse.x && mouse.x <= (x + w)) && (y <= mouse.y && mouse.y <= (y + h));
  }

  protected static _lineColor(flags: number, opts: { alpha: number }): wgl.Color {
    const alpha = opts.alpha;
    let r: number;
    let g: number;
    let b: number;
    if ((flags & _FLAG_CLICKED) === 0) {
      if ((flags & _FLAG_HEADING) === 0) {
        [r, g, b] = [0.4, 0.5, 0.7];
      } else {
        [r, g, b] = [1.0, 1.0, 1.0];
      }
    } else {
      if ((flags & _FLAG_HEADING) === 0) {
        [r, g, b] = [0.4, 0.7, 0.7];
      } else {
        [r, g, b] = [0.9, 1.0, 0.9];
      }
    }
    return wgl.makeColor(int(r * 255.0 + 0.5) / 255, int(g * 255.0 + 0.5) / 255, int(b * 255.0 + 0.5) / 255, int(Math.max(0.0, Math.min(1.0, alpha)) * 255.0 + 0.5) / 255);
  }

  protected _lineAlpha(opts: { y: number; baseY: number; visibleCount: number; scale: number }): number {
    const y = opts.y;
    const baseY = opts.baseY;
    const visibleCount = opts.visibleCount;
    const scale = opts.scale;
    const fadePx = _TEXT_FADE_PX * scale;
    const top = baseY + (8.0 * scale);
    let alpha = 1.0;
    if (y < top) {
      alpha = 1.0 - ((top - y) / fadePx);
    } else {
      const bottom = baseY + ((visibleCount - 1) * (_TEXT_LINE_HEIGHT * scale)) - fadePx;
      if (y > bottom) {
        alpha = ((bottom - y) / fadePx) + 1.0;
      }
    }
    if (alpha < 0.0) {
      return 0.0;
    }
    if (alpha > 1.0) {
      return 1.0;
    }
    return alpha;
  }

  protected _updateLineClicks(opts: { panelTopLeft: Vec2; scale: number; font: SmallFontData; mouse: wgl.Vector2; click: boolean }): void {
    const panelTopLeft = opts.panelTopLeft;
    const scale = opts.scale;
    const font = opts.font;
    const mouse = opts.mouse;
    const click = opts.click;
    const visibleCount = this._scrollLineEndIndex - this._scrollLineStartIndex;
    if (visibleCount <= 0 || !click) {
      return;
    }

    const baseY = panelTopLeft.y + (_TEXT_BASE_Y * scale);
    const fracPx = CreditsView._scrollFractionPx(this._scrollTimeS, { scale: scale });
    const centerX = panelTopLeft.x + ((_TEXT_ANCHOR_X + _TEXT_CENTER_OFFSET_X) * scale);

    for (let row = 0; row < visibleCount; row++) {
      const index = this._scrollLineStartIndex + row;
      if (index < 0 || index >= this._lines.length) {
        continue;
      }
      const line = this._lines[index];
      const textW = measureSmallTextWidth(font, line.text);
      const x = centerX - (textW * 0.5);
      const y = baseY + (row * (_TEXT_LINE_HEIGHT * scale)) - fracPx;
      if (!CreditsView._mouseInsideRect(mouse, { x: x, y: y, w: textW, h: _TEXT_RECT_H * scale })) {
        continue;
      }

      if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(line.text, 'o')) {
        if ((line.flags & _FLAG_CLICKED) === 0 && this.state.audio !== null) {
          playSfx(this.state.audio, SfxId.UI_BONUS);
        }
        line.flags |= _FLAG_CLICKED;
      } else {
        if (creditsLineClearFlag(this._lines, index) && this.state.audio !== null) {
          playSfx(this.state.audio, SfxId.TROOPER_INPAIN_01);
        }
      }
      return;
    }
  }

  protected _updateSecretUnlock(): void {
    if (this._secretUnlock) {
      return;
    }
    if (!creditsAllRoundLinesFlagged(this._lines)) {
      return;
    }
    this._secretUnlock = true;
    creditsUnlockSecretLines(this._lines, this._secretLineBaseIndex);
  }

  protected _secretButtonVisible(): boolean {
    return this._secretUnlock || debugEnabled();
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      updateAudio(this.state.audio, dt);
    }
    if (this._ground !== null) {
      this._ground.processPending();
    }
    const dtClamped = Math.min(dt, 0.1);
    const dtMs = int(dtClamped * 1000.0);
    this._cursorPulseTime += dtClamped * 1.1;

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
    this._scrollTimeS += dtClamped;
    this._updateScrollWindow();

    const interactive = this._timelineMs >= this._timelineMaxMs;
    if (InputState.wasKeyPressed(27) && interactive) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_previous');
      return;
    }

    if (!interactive) {
      return;
    }

    const scale = this.state.config.display.width < 641.0 ? 0.9 : 1.0;
    const slideX = this._panelSlideX({ scale: scale });
    const panelTopLeft = this._panelTopLeft({ scale: scale }).offset({ dx: slideX });
    const resources = requireRuntimeResources(this.state);
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);

    this._updateLineClicks({
      panelTopLeft: panelTopLeft,
      scale: scale,
      font: resources.smallFont,
      mouse: mouse,
      click: click,
    });
    this._updateSecretUnlock();

    const dtMsF = dtClamped * 1000.0;

    const backW = buttonWidth(resources, this._backButton.label, { scale: scale, forceWide: this._backButton.forceWide });
    if (buttonUpdate(this._backButton, { pos: panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale)), width: backW, dtMs: dtMsF, mouse: mouse, click: click })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_previous');
      return;
    }

    if (this._secretButtonVisible()) {
      const secretW = buttonWidth(resources, this._secretButton.label, { scale: scale, forceWide: this._secretButton.forceWide });
      if (buttonUpdate(this._secretButton, { pos: panelTopLeft.add(new Vec2(_SECRET_BUTTON_X * scale, _SECRET_BUTTON_Y * scale)), width: secretW, dtMs: dtMsF, mouse: mouse, click: click })) {
        if (this.state.audio !== null) {
          playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('open_alien_zookeeper');
        return;
      }
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

    const resources = requireRuntimeResources(this.state);

    const scale = this.state.config.display.width < 641.0 ? 0.9 : 1.0;
    const slideX = this._panelSlideX({ scale: scale });
    const panelTopLeft = this._panelTopLeft({ scale: scale }).offset({ dx: slideX });

    const dst = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, MENU_PANEL_WIDTH * scale, CREDITS_PANEL_HEIGHT * scale);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(resources.texture(TextureId.UI_MENU_PANEL), { dst: dst, tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail });

    const font = resources.smallFont;
    drawSmallText(font, 'credits', panelTopLeft.add(new Vec2(_TITLE_X * scale, _TITLE_Y * scale)), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255));

    const visibleCount = this._scrollLineEndIndex - this._scrollLineStartIndex;
    if (visibleCount > 0) {
      const baseY = panelTopLeft.y + (_TEXT_BASE_Y * scale);
      const fracPx = CreditsView._scrollFractionPx(this._scrollTimeS, { scale: scale });
      const centerX = panelTopLeft.x + ((_TEXT_ANCHOR_X + _TEXT_CENTER_OFFSET_X) * scale);

      for (let row = 0; row < visibleCount; row++) {
        const index = this._scrollLineStartIndex + row;
        if (index < 0 || index >= this._lines.length) {
          continue;
        }
        const line = this._lines[index];
        const y = baseY + (row * (_TEXT_LINE_HEIGHT * scale)) - fracPx;
        const alpha = this._lineAlpha({ y: y, baseY: baseY, visibleCount: visibleCount, scale: scale });
        const color = CreditsView._lineColor(line.flags, { alpha: alpha });
        const textW = measureSmallTextWidth(font, line.text);
        drawSmallText(font, line.text, new Vec2(centerX - (textW * 0.5), y), color);
      }
    }

    const backW = buttonWidth(resources, this._backButton.label, { scale: scale, forceWide: this._backButton.forceWide });
    buttonDraw(
      resources,
      this._backButton,
      { pos: panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale)), width: backW, scale: scale },
    );

    if (this._secretButtonVisible()) {
      const secretW = buttonWidth(resources, this._secretButton.label, { scale: scale, forceWide: this._secretButton.forceWide });
      buttonDraw(
        resources,
        this._secretButton,
        { pos: panelTopLeft.add(new Vec2(_SECRET_BUTTON_X * scale, _SECRET_BUTTON_Y * scale)), width: secretW, scale: scale },
      );
    }

    this._drawSign();
    drawMenuCursorHelper(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
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
}

export function creditsBuildLines(): [CreditsLine[], number, number] {
  const lines = Array.from({ length: Math.max(0, _CREDITS_TABLE_SIZE) }, (_, i) => i).map((_) => new CreditsLine());
  let lineMaxIndex = 0;

  const _lineSet = (index: number, text: string, flags: number): void => {
    lines[index] = new CreditsLine({ text: text, flags: flags });
    lineMaxIndex = index;
  };

  _lineSet(0x00, '2026 Remake:', _FLAG_HEADING);
  _lineSet(0x01, 'banteg', 0);
  _lineSet(0x02, '', 0);
  _lineSet(0x03, 'Crimsonland', _FLAG_HEADING);
  _lineSet(0x04, 'Game Design:', _FLAG_HEADING);
  _lineSet(0x05, 'Tero Alatalo', 0);
  _lineSet(0x06, '', 0);
  _lineSet(0x07, 'Programming:', _FLAG_HEADING);
  _lineSet(0x08, 'Tero Alatalo', 0);
  _lineSet(0x09, '', 0);
  _lineSet(0x0A, 'Producer:', _FLAG_HEADING);
  _lineSet(0x0B, 'Zach Young', 0);
  _lineSet(0x0C, '', 0);
  _lineSet(0x0D, '2D Art:', _FLAG_HEADING);
  _lineSet(0x0E, 'Tero Alatalo', 0);
  _lineSet(0x0F, '', 0);
  _lineSet(0x10, '3D Modelling:', _FLAG_HEADING);
  _lineSet(0x11, 'Tero Alatalo', 0);
  _lineSet(0x12, 'Timo Palonen', 0);
  _lineSet(0x13, '', 0);
  _lineSet(0x14, 'Music:', _FLAG_HEADING);
  _lineSet(0x15, 'Valtteri Pihlajam', 0);
  _lineSet(0x16, 'Ville Eriksson', 0);
  _lineSet(0x17, '', 0);
  _lineSet(0x18, 'Sound Effects:', _FLAG_HEADING);
  _lineSet(0x19, 'Ion Hardie', 0);
  _lineSet(0x1A, 'Tero Alatalo', 0);
  _lineSet(0x1B, 'Valtteri Pihlajam', 0);
  _lineSet(0x1C, 'Ville Eriksson', 0);
  _lineSet(0x1D, '', 0);
  _lineSet(0x1E, 'Manual:', _FLAG_HEADING);
  _lineSet(0x1F, 'Miikka Kulmala', 0);
  _lineSet(0x20, 'Zach Young', 0);
  _lineSet(0x21, '', 0);
  _lineSet(0x22, 'Special thanks to:', _FLAG_HEADING);
  _lineSet(0x23, 'Petri J', 0);
  _lineSet(0x24, 'Peter Hajba / Remedy', 0);
  _lineSet(0x25, '', 0);
  _lineSet(0x26, 'Play testers:', _FLAG_HEADING);
  _lineSet(0x27, 'Avraham Petrosyan', 0);
  _lineSet(0x28, 'Bryce Baker', 0);
  _lineSet(0x29, 'Dan Ruskin', 0);
  _lineSet(0x2A, 'Dirk Bunk', 0);
  _lineSet(0x2B, 'Eric Dallaire', 0);
  _lineSet(0x2C, 'Erik Van Pelt', 0);
  _lineSet(0x2D, 'Ernie Ramirez', 0);
  _lineSet(0x2E, 'Ion Hardie', 0);
  _lineSet(0x2F, 'James C. Smith', 0);
  _lineSet(0x30, 'Jarkko Forsbacka', 0);
  _lineSet(0x31, 'Jeff McAteer', 0);
  _lineSet(0x32, 'Juha Alatalo', 0);
  _lineSet(0x33, 'Kalle Hahl', 0);
  _lineSet(0x34, 'Lars Brubaker', 0);
  _lineSet(0x35, 'Lee Cooper', 0);
  _lineSet(0x36, 'Markus Lassila', 0);
  _lineSet(0x37, 'Matti Alanen', 0);
  _lineSet(0x38, 'Miikka Kulmala', 0);
  _lineSet(0x39, 'Mika Alatalo', 0);
  _lineSet(0x3A, 'Mike Colonnese', 0);
  _lineSet(0x3B, 'Simon Hallam', 0);
  _lineSet(0x3C, 'Toni Nurminen', 0);
  _lineSet(0x3D, 'Valtteri Pihlajam', 0);
  _lineSet(0x3E, 'Ville Eriksson', 0);
  _lineSet(0x3F, 'Ville M', 0);
  _lineSet(0x40, 'Zach Young', 0);
  _lineSet(0x41, '', 0);

  // This repeated index sequence is present in the decompile.
  _lineSet(0x42, 'Greeting to:', 0);
  _lineSet(0x42, 'Chaos^', 0);
  _lineSet(0x42, 'Matricks', 0);
  _lineSet(0x42, 'Muzzy', 0);
  _lineSet(0x42, '', 0);

  _lineSet(0x43, '', 0);
  _lineSet(0x44, '2003 (c) 10tons entertainment', 0);
  _lineSet(0x45, '10tons logo by', 0);
  _lineSet(0x46, 'Pasi Heinonen', 0);
  _lineSet(0x47, '', 0);
  _lineSet(0x48, '', 0);
  _lineSet(0x49, '', 0);
  _lineSet(0x4A, 'Uses Vorbis Audio Decompression', 0);
  _lineSet(0x4B, '2003 (c) Xiph.Org Foundation', 0);
  _lineSet(0x4C, '(see vorbis.txt)', 0);

  for (let index = 0x4D; index < 0x54; index++) {
    _lineSet(index, '', 0);
  }

  const secretLineBaseIndex = 0x54;
  _lineSet(0x54, '', 0);
  _lineSet(0x55, '', 0);
  _lineSet(0x56, '', 0);
  _lineSet(0x57, 'You can stop watching now.', 0);

  for (let index = 0x58; index < 0x77; index++) {
    _lineSet(index, '', 0);
  }

  _lineSet(0x77, 'Click the ones with the round ones!', 0);
  _lineSet(0x78, '(and be patient!)', 0);

  for (let index = 0x79; index < 0x7E; index++) {
    _lineSet(index, '', 0);
  }

  return [lines, lineMaxIndex, secretLineBaseIndex];
}

export function creditsLineClearFlag(lines: CreditsLine[], index: number): boolean {
  while (index >= 0) {
    if (lines[index].flags & _FLAG_CLICKED) {
      lines[index].flags &= ~_FLAG_CLICKED;
      return true;
    }
    index -= 1;
  }
  return false;
}

export function creditsAllRoundLinesFlagged(lines: CreditsLine[]): boolean {
  for (const line of lines) {
    if (line.text && (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(line.text, 'o')) && ((line.flags & _FLAG_CLICKED) === 0)) {
      return false;
    }
  }
  return true;
}

export function creditsUnlockSecretLines(lines: CreditsLine[], baseIndex: number): void {
  for (const [offset, text] of _CREDITS_SECRET_LINES.entries()) {
    const line = lines[baseIndex + offset];
    line.flags |= _FLAG_CLICKED;
    line.text = text;
  }
}
