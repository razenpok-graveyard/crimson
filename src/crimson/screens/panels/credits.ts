// Port of crimson/screens/panels/credits.py

import { getTexture, TextureId } from "@grim/assets.ts";
import { audioPlaySfx, audioUpdate } from "@grim/audio.ts";
import { drawSmallText, measureSmallTextWidth, SmallFontData } from "@grim/fonts/small.ts";
import { Vec2 } from "@grim/geom.ts";
import * as wgl from "@wgl";
import { SfxId } from "@grim/sfx-map.ts";
import { fxDetailEnabled } from "@grim/config.ts";
import { InputState } from "@grim/input.ts";
import { type GroundRenderer } from "@grim/terrain-render.ts";
import { debugEnabled } from "@crimson/debug.ts";
import { menuWidescreenYShift } from "@crimson/ui/layout.ts";
import { drawUiQuadShadow, UI_SHADOW_OFFSET } from "@crimson/ui/shadow.ts";
import { type GameState } from "@crimson/game/types.ts";
import { drawClassicMenuPanel } from "@crimson/ui/menu-panel.ts";
import { buttonDraw, buttonUpdate, buttonWidth, UiButtonState } from "@crimson/ui/perk-menu.ts";
import { requireRuntimeResources } from "@crimson/screens/assets.ts";
import { MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, signLayoutScale, uiElementAnim } from "@crimson/screens/menu.ts";
import { drawScreenFade } from "@crimson/screens/transitions.ts";
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from "./base.ts";

// Measured from ui_render_trace_oracle_1024x768.json (state_17:credits, timeline=300).
const CREDITS_PANEL_POS_X = -119.0;
const CREDITS_PANEL_POS_Y = 185.0;
const CREDITS_PANEL_HEIGHT = 378.0;

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

const _CREDITS_SECRET_LINES: readonly string[] = [
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
if (_CREDITS_SECRET_LINES.length !== _CREDITS_SECRET_LINE_COUNT) {
  throw new Error('credits secret line count mismatch');
}

const KEY_ESCAPE = 27;
const MOUSE_BUTTON_LEFT = 0;

const WHITE = wgl.makeColor(1, 1, 1, 1);

class CreditsLine {
  text: string;
  flags: number;

  constructor(opts: { text?: string; flags?: number } = {}) {
    this.text = opts.text ?? '';
    this.flags = opts.flags ?? 0;
  }
}

function creditsBuildLines(): { lines: CreditsLine[]; lineMaxIndex: number; secretLineBaseIndex: number } {
  const lines: CreditsLine[] = [];
  for (let i = 0; i < _CREDITS_TABLE_SIZE; i++) {
    lines.push(new CreditsLine());
  }
  let lineMaxIndex = 0;

  function lineSet(index: number, text: string, flags: number): void {
    lines[index] = new CreditsLine({ text, flags });
    lineMaxIndex = index;
  }

  lineSet(0x00, '2026 Remake:', _FLAG_HEADING);
  lineSet(0x01, 'banteg', 0);
  lineSet(0x02, '', 0);
  lineSet(0x03, 'Crimsonland', _FLAG_HEADING);
  lineSet(0x04, 'Game Design:', _FLAG_HEADING);
  lineSet(0x05, 'Tero Alatalo', 0);
  lineSet(0x06, '', 0);
  lineSet(0x07, 'Programming:', _FLAG_HEADING);
  lineSet(0x08, 'Tero Alatalo', 0);
  lineSet(0x09, '', 0);
  lineSet(0x0A, 'Producer:', _FLAG_HEADING);
  lineSet(0x0B, 'Zach Young', 0);
  lineSet(0x0C, '', 0);
  lineSet(0x0D, '2D Art:', _FLAG_HEADING);
  lineSet(0x0E, 'Tero Alatalo', 0);
  lineSet(0x0F, '', 0);
  lineSet(0x10, '3D Modelling:', _FLAG_HEADING);
  lineSet(0x11, 'Tero Alatalo', 0);
  lineSet(0x12, 'Timo Palonen', 0);
  lineSet(0x13, '', 0);
  lineSet(0x14, 'Music:', _FLAG_HEADING);
  lineSet(0x15, 'Valtteri Pihlajam', 0);
  lineSet(0x16, 'Ville Eriksson', 0);
  lineSet(0x17, '', 0);
  lineSet(0x18, 'Sound Effects:', _FLAG_HEADING);
  lineSet(0x19, 'Ion Hardie', 0);
  lineSet(0x1A, 'Tero Alatalo', 0);
  lineSet(0x1B, 'Valtteri Pihlajam', 0);
  lineSet(0x1C, 'Ville Eriksson', 0);
  lineSet(0x1D, '', 0);
  lineSet(0x1E, 'Manual:', _FLAG_HEADING);
  lineSet(0x1F, 'Miikka Kulmala', 0);
  lineSet(0x20, 'Zach Young', 0);
  lineSet(0x21, '', 0);
  lineSet(0x22, 'Special thanks to:', _FLAG_HEADING);
  lineSet(0x23, 'Petri J', 0);
  lineSet(0x24, 'Peter Hajba / Remedy', 0);
  lineSet(0x25, '', 0);
  lineSet(0x26, 'Play testers:', _FLAG_HEADING);
  lineSet(0x27, 'Avraham Petrosyan', 0);
  lineSet(0x28, 'Bryce Baker', 0);
  lineSet(0x29, 'Dan Ruskin', 0);
  lineSet(0x2A, 'Dirk Bunk', 0);
  lineSet(0x2B, 'Eric Dallaire', 0);
  lineSet(0x2C, 'Erik Van Pelt', 0);
  lineSet(0x2D, 'Ernie Ramirez', 0);
  lineSet(0x2E, 'Ion Hardie', 0);
  lineSet(0x2F, 'James C. Smith', 0);
  lineSet(0x30, 'Jarkko Forsbacka', 0);
  lineSet(0x31, 'Jeff McAteer', 0);
  lineSet(0x32, 'Juha Alatalo', 0);
  lineSet(0x33, 'Kalle Hahl', 0);
  lineSet(0x34, 'Lars Brubaker', 0);
  lineSet(0x35, 'Lee Cooper', 0);
  lineSet(0x36, 'Markus Lassila', 0);
  lineSet(0x37, 'Matti Alanen', 0);
  lineSet(0x38, 'Miikka Kulmala', 0);
  lineSet(0x39, 'Mika Alatalo', 0);
  lineSet(0x3A, 'Mike Colonnese', 0);
  lineSet(0x3B, 'Simon Hallam', 0);
  lineSet(0x3C, 'Toni Nurminen', 0);
  lineSet(0x3D, 'Valtteri Pihlajam', 0);
  lineSet(0x3E, 'Ville Eriksson', 0);
  lineSet(0x3F, 'Ville M', 0);
  lineSet(0x40, 'Zach Young', 0);
  lineSet(0x41, '', 0);

  // This repeated index sequence is present in the decompile.
  lineSet(0x42, 'Greeting to:', 0);
  lineSet(0x42, 'Chaos^', 0);
  lineSet(0x42, 'Matricks', 0);
  lineSet(0x42, 'Muzzy', 0);
  lineSet(0x42, '', 0);

  lineSet(0x43, '', 0);
  lineSet(0x44, '2003 (c) 10tons entertainment', 0);
  lineSet(0x45, '10tons logo by', 0);
  lineSet(0x46, 'Pasi Heinonen', 0);
  lineSet(0x47, '', 0);
  lineSet(0x48, '', 0);
  lineSet(0x49, '', 0);
  lineSet(0x4A, 'Uses Vorbis Audio Decompression', 0);
  lineSet(0x4B, '2003 (c) Xiph.Org Foundation', 0);
  lineSet(0x4C, '(see vorbis.txt)', 0);

  for (let index = 0x4D; index < 0x54; index++) {
    lineSet(index, '', 0);
  }

  const secretLineBaseIndex = 0x54;
  lineSet(0x54, '', 0);
  lineSet(0x55, '', 0);
  lineSet(0x56, '', 0);
  lineSet(0x57, 'You can stop watching now.', 0);

  for (let index = 0x58; index < 0x77; index++) {
    lineSet(index, '', 0);
  }

  lineSet(0x77, 'Click the ones with the round ones!', 0);
  lineSet(0x78, '(and be patient!)', 0);

  for (let index = 0x79; index < 0x7E; index++) {
    lineSet(index, '', 0);
  }

  return { lines, lineMaxIndex, secretLineBaseIndex };
}

function creditsLineClearFlag(lines: CreditsLine[], index: number): boolean {
  while (index >= 0) {
    if (lines[index].flags & _FLAG_CLICKED) {
      lines[index].flags &= ~_FLAG_CLICKED;
      return true;
    }
    index -= 1;
  }
  return false;
}

function creditsAllRoundLinesFlagged(lines: CreditsLine[]): boolean {
  for (const line of lines) {
    if (line.text && line.text.indexOf('o') !== -1 && (line.flags & _FLAG_CLICKED) === 0) {
      return false;
    }
  }
  return true;
}

function creditsUnlockSecretLines(lines: CreditsLine[], baseIndex: number): void {
  for (let offset = 0; offset < _CREDITS_SECRET_LINES.length; offset++) {
    const line = lines[baseIndex + offset];
    line.flags |= _FLAG_CLICKED;
    line.text = _CREDITS_SECRET_LINES[offset];
  }
}

export class CreditsView {
  state: GameState;

  private _isOpen: boolean = false;
  private _ground: GroundRenderer | null = null;

  private _cursorPulseTime: number = 0.0;
  private _widescreenYShift: number = 0.0;
  _timelineMs: number = 0;
  private _timelineMaxMs: number = PANEL_TIMELINE_START_MS;
  private _closing: boolean = false;
  private _closeAction: string | null = null;
  private _pendingAction: string | null = null;
  private _action: string | null = null;

  private _lines: CreditsLine[] = [];
  private _lineMaxIndex: number = 0;
  private _secretLineBaseIndex: number = 0x54;
  private _secretUnlock: boolean = false;
  private _scrollTimeS: number = 0.0;
  private _scrollLineStartIndex: number = 0;
  private _scrollLineEndIndex: number = 0;

  private _backButton: UiButtonState;
  private _secretButton: UiButtonState;

  constructor(state: GameState) {
    this.state = state;
    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });
    this._secretButton = new UiButtonState({ label: 'Secret', forceWide: false });
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._widescreenYShift = menuWidescreenYShift(layoutW);
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._action = null;

    const built = creditsBuildLines();
    this._lines = built.lines;
    this._lineMaxIndex = built.lineMaxIndex;
    this._secretLineBaseIndex = built.secretLineBaseIndex;
    this._secretUnlock = false;
    this._scrollTimeS = 0.0;
    this._scrollLineStartIndex = 0;
    this._scrollLineEndIndex = 0;

    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });
    this._secretButton = new UiButtonState({ label: 'Secret', forceWide: false });

    if (this.state.audio !== null) {
      audioPlaySfx(this.state.audio, SfxId.UI_PANELCLICK);
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
    if (this._pendingAction !== null) {
      const action = this._pendingAction;
      this._pendingAction = null;
      this._closing = false;
      this._closeAction = null;
      this._timelineMs = this._timelineMaxMs;
      return action;
    }
    const action = this._action;
    this._action = null;
    return action;
  }

  private _assertOpen(): void {
    if (!this._isOpen) {
      throw new Error('CreditsView must be opened before use');
    }
  }

  private _beginCloseTransition(action: string): void {
    if (this._closing) return;
    this._closing = true;
    this._closeAction = action;
  }

  private _panelTopLeft(opts: { scale: number }): Vec2 {
    const scale = opts.scale;
    return new Vec2(
      CREDITS_PANEL_POS_X + MENU_PANEL_OFFSET_X * scale,
      CREDITS_PANEL_POS_Y + this._widescreenYShift + MENU_PANEL_OFFSET_Y * scale,
    );
  }

  private static _scrollFractionPx(scrollTimeS: number, opts: { scale: number }): number {
    const scale = opts.scale;
    let frac = scrollTimeS * (_TEXT_LINE_HEIGHT * scale);
    const lineH = _TEXT_LINE_HEIGHT * scale;
    while (frac > lineH) {
      frac -= lineH;
    }
    return frac;
  }

  private _updateScrollWindow(): void {
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

  private _panelSlideX(opts: { scale: number }): number {
    const scale = opts.scale;
    const panelW = MENU_PANEL_WIDTH * scale;
    const [_angleRad, slideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 0,
    });
    return slideX;
  }

  private static _mouseInsideRect(
    mouse: { x: number; y: number },
    opts: { x: number; y: number; w: number; h: number },
  ): boolean {
    const x = opts.x;
    const y = opts.y;
    const w = opts.w;
    const h = opts.h;
    return (x <= mouse.x && mouse.x <= (x + w)) && (y <= mouse.y && mouse.y <= (y + h));
  }

  private static _lineColor(flags: number, opts: { alpha: number }): wgl.Color {
    const alpha = opts.alpha;
    let r: number, g: number, b: number;
    if ((flags & _FLAG_CLICKED) === 0) {
      if ((flags & _FLAG_HEADING) === 0) {
        r = 0.4; g = 0.5; b = 0.7;
      } else {
        r = 1.0; g = 1.0; b = 1.0;
      }
    } else {
      if ((flags & _FLAG_HEADING) === 0) {
        r = 0.4; g = 0.7; b = 0.7;
      } else {
        r = 0.9; g = 1.0; b = 0.9;
      }
    }
    const a = Math.max(0.0, Math.min(1.0, alpha));
    return wgl.makeColor(
      int(r * 255.0 + 0.5) / 255,
      int(g * 255.0 + 0.5) / 255,
      int(b * 255.0 + 0.5) / 255,
      int(a * 255.0 + 0.5) / 255,
    );
  }

  private _lineAlpha(opts: {
    y: number;
    baseY: number;
    visibleCount: number;
    scale: number;
  }): number {
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
    if (alpha < 0.0) return 0.0;
    if (alpha > 1.0) return 1.0;
    return alpha;
  }

  private _updateLineClicks(opts: {
    panelTopLeft: Vec2;
    scale: number;
    font: SmallFontData;
    mouse: { x: number; y: number };
    click: boolean;
  }): void {
    const panelTopLeft = opts.panelTopLeft;
    const scale = opts.scale;
    const font = opts.font;
    const mouse = opts.mouse;
    const click = opts.click;
    const visibleCount = this._scrollLineEndIndex - this._scrollLineStartIndex;
    if (visibleCount <= 0 || !click) return;

    const baseY = panelTopLeft.y + (_TEXT_BASE_Y * scale);
    const fracPx = CreditsView._scrollFractionPx(this._scrollTimeS, { scale });
    const centerX = panelTopLeft.x + ((_TEXT_ANCHOR_X + _TEXT_CENTER_OFFSET_X) * scale);

    for (let row = 0; row < visibleCount; row++) {
      const index = this._scrollLineStartIndex + row;
      if (index < 0 || index >= this._lines.length) continue;
      const line = this._lines[index];
      const textW = measureSmallTextWidth(font, line.text);
      const x = centerX - (textW * 0.5);
      const y = baseY + (row * (_TEXT_LINE_HEIGHT * scale)) - fracPx;
      if (!CreditsView._mouseInsideRect(mouse, { x, y, w: textW, h: _TEXT_RECT_H * scale })) {
        continue;
      }

      if (line.text.indexOf('o') !== -1) {
        if ((line.flags & _FLAG_CLICKED) === 0 && this.state.audio !== null) {
          audioPlaySfx(this.state.audio, SfxId.UI_BONUS);
        }
        line.flags |= _FLAG_CLICKED;
      } else {
        if (creditsLineClearFlag(this._lines, index) && this.state.audio !== null) {
          audioPlaySfx(this.state.audio, SfxId.TROOPER_INPAIN_01);
        }
      }
      return;
    }
  }

  private _updateSecretUnlock(): void {
    if (this._secretUnlock) return;
    if (!creditsAllRoundLinesFlagged(this._lines)) return;
    this._secretUnlock = true;
    creditsUnlockSecretLines(this._lines, this._secretLineBaseIndex);
  }

  private _secretButtonVisible(): boolean {
    return this._secretUnlock || debugEnabled();
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      audioUpdate(this.state.audio, dt);
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
      this._timelineMs = Math.min(this._timelineMaxMs, this._timelineMs + dtMs);
    }
    this._scrollTimeS += dtClamped;
    this._updateScrollWindow();

    const interactive = this._timelineMs >= this._timelineMaxMs;
    if (InputState.wasKeyPressed(KEY_ESCAPE) && interactive) {
      if (this.state.audio !== null) {
        audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_previous');
      return;
    }

    if (!interactive) return;

    const scale = this.state.config.display.width < 641 ? 0.9 : 1.0;
    const slideX = this._panelSlideX({ scale });
    const panelTopLeft = this._panelTopLeft({ scale }).offset({ dx: slideX });
    const resources = requireRuntimeResources(this.state);
    const [mx, my] = InputState.mousePosition();
    const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);

    const mouse = { x: mx, y: my };
    this._updateLineClicks({
      panelTopLeft,
      scale,
      font: resources.smallFont,
      mouse,
      click,
    });
    this._updateSecretUnlock();

    const dtMsF = dtClamped * 1000.0;

    const backW = buttonWidth(resources, this._backButton.label, { scale, forceWide: this._backButton.forceWide });
    const backPos = panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale));
    if (buttonUpdate(this._backButton, { pos: backPos, width: backW, dtMs: dtMsF, mouse, click })) {
      if (this.state.audio !== null) {
        audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_previous');
      return;
    }

    if (this._secretButtonVisible()) {
      const secretW = buttonWidth(resources, this._secretButton.label, { scale, forceWide: this._secretButton.forceWide });
      const secretPos = panelTopLeft.add(new Vec2(_SECRET_BUTTON_X * scale, _SECRET_BUTTON_Y * scale));
      if (buttonUpdate(this._secretButton, { pos: secretPos, width: secretW, dtMs: dtMsF, mouse, click })) {
        if (this.state.audio !== null) {
          audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
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

    const scale = this.state.config.display.width < 641 ? 0.9 : 1.0;
    const slideX = this._panelSlideX({ scale });
    const panelTopLeft = this._panelTopLeft({ scale }).offset({ dx: slideX });

    const panelW = MENU_PANEL_WIDTH * scale;
    const panelH = CREDITS_PANEL_HEIGHT * scale;
    const dst = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, panelW, panelH);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const panel = getTexture(resources, TextureId.UI_MENU_PANEL);
    drawClassicMenuPanel(panel, { dst, tint: WHITE, shadow: fxDetail });

    const font = resources.smallFont;
    const titlePos = panelTopLeft.add(new Vec2(_TITLE_X * scale, _TITLE_Y * scale));
    drawSmallText(font, 'credits', titlePos, wgl.makeColor(1, 1, 1, 1));

    const visibleCount = this._scrollLineEndIndex - this._scrollLineStartIndex;
    if (visibleCount > 0) {
      const baseY = panelTopLeft.y + (_TEXT_BASE_Y * scale);
      const fracPx = CreditsView._scrollFractionPx(this._scrollTimeS, { scale });
      const centerX = panelTopLeft.x + ((_TEXT_ANCHOR_X + _TEXT_CENTER_OFFSET_X) * scale);

      for (let row = 0; row < visibleCount; row++) {
        const index = this._scrollLineStartIndex + row;
        if (index < 0 || index >= this._lines.length) continue;
        const line = this._lines[index];
        const y = baseY + (row * (_TEXT_LINE_HEIGHT * scale)) - fracPx;
        const alpha = this._lineAlpha({ y, baseY, visibleCount, scale });
        const color = CreditsView._lineColor(line.flags, { alpha });
        const textW = measureSmallTextWidth(font, line.text);
        drawSmallText(font, line.text, new Vec2(centerX - (textW * 0.5), y), color);
      }
    }

    const backW = buttonWidth(resources, this._backButton.label, { scale, forceWide: this._backButton.forceWide });
    const backPos = panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale));
    buttonDraw(resources, this._backButton, { pos: backPos, width: backW, scale });

    if (this._secretButtonVisible()) {
      const secretW = buttonWidth(resources, this._secretButton.label, { scale, forceWide: this._secretButton.forceWide });
      const secretPos = panelTopLeft.add(new Vec2(_SECRET_BUTTON_X * scale, _SECRET_BUTTON_Y * scale));
      buttonDraw(resources, this._secretButton, { pos: secretPos, width: secretW, scale });
    }

    this._drawSign();
    drawMenuCursorHelper(this.state, { resources, pulseTime: this._cursorPulseTime });
  }

  private _drawSign(): void {
    const resources = requireRuntimeResources(this.state);
    const sign = getTexture(resources, TextureId.UI_SIGN_CRIMSON);
    const screenW = this.state.config.display.width;
    const [signScale, shiftX] = signLayoutScale(int(screenW));
    const signPosY = screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL;
    const signPos = new Vec2(screenW + MENU_SIGN_POS_X_PAD, signPosY);
    const signW = MENU_SIGN_WIDTH * signScale;
    const signH = MENU_SIGN_HEIGHT * signScale;
    const offsetX = MENU_SIGN_OFFSET_X * signScale + shiftX;
    const offsetY = MENU_SIGN_OFFSET_Y * signScale;
    const rotationDeg = 0.0;
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const signSrc = wgl.makeRectangle(0.0, 0.0, sign.width, sign.height);
    const signOrigin = wgl.makeVector2(-offsetX, -offsetY);

    if (fxDetail) {
      drawUiQuadShadow({
        texture: sign,
        src: signSrc,
        dst: wgl.makeRectangle(signPos.x + UI_SHADOW_OFFSET, signPos.y + UI_SHADOW_OFFSET, signW, signH),
        origin: signOrigin,
        rotationDeg,
      });
    }
    wgl.drawTexturePro(
      sign, signSrc,
      wgl.makeRectangle(signPos.x, signPos.y, signW, signH),
      signOrigin, rotationDeg, WHITE,
    );
  }

}
