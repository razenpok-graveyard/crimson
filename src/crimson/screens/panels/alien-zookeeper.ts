// Port of crimson/screens/panels/alien_zookeeper.py

import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState } from '@crimson/game/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, uiElementAnim, signLayoutScale } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from '@crimson/screens/panels/base.ts';
import * as wgl from '@wgl';

const _BOARD_SIDE = 6;
const _BOARD_CELLS = _BOARD_SIDE * _BOARD_SIDE;
const _TILE_SIZE = 32.0;
const _BOARD_SIZE = 192.0;
const _TIMER_RESET_MS = 0x2580;
const _MATCH_TIMER_BONUS_MS = 2000;
// Directly mirrored from the native flow for 1024x768 mode:
//   data_489df8 = -35, data_489dfc = 275, data_489e1c = -63, data_489e20 = -81.
const _LAYOUT_OFFSET_X = -35.0;
const _LAYOUT_OFFSET_X_SMALL = -85.0;
const _LAYOUT_POS_X = -63.0;
const _LAYOUT_POS_Y = -81.0;
const _LAYOUT_BASE_Y = 275.0;
const _TITLE_BASE_Y_OFFSET = 50.0;
const _BOARD_X_OFFSET = 220.0; // 300 - 80
const _BOARD_Y_OFFSET = 40.0;
const _TITLE = 'AlienZooKeeper';
const _SUBTITLE_1 = 'a puzzle game unfinished';
const _SUBTITLE_2 = '..or something more?';
const _LABEL_SCORE = 'score: %d';
const _LABEL_GAME_OVER = 'Game Over';
const _RESET_LABEL = 'Reset';
const _BACK_LABEL = 'Back';

export class AzkLayout {
  scale: number;
  panelX: number;
  panelY: number;
  boardX: number;
  boardY: number;
  tileSize: number;
  boardSize: number;
  titleX: number;
  titleY: number;
  subtitle1X: number;
  subtitle1Y: number;
  subtitle2X: number;
  subtitle2Y: number;
  scoreX: number;
  scoreY: number;
  gameOverX: number;
  gameOverY: number;
  resetPos: Vec2;
  backPos: Vec2;

  constructor(opts: {
    scale: number;
    panelX: number;
    panelY: number;
    boardX: number;
    boardY: number;
    tileSize: number;
    boardSize: number;
    titleX: number;
    titleY: number;
    subtitle1X: number;
    subtitle1Y: number;
    subtitle2X: number;
    subtitle2Y: number;
    scoreX: number;
    scoreY: number;
    gameOverX: number;
    gameOverY: number;
    resetPos: Vec2;
    backPos: Vec2;
  }) {
    this.scale = opts.scale;
    this.panelX = opts.panelX;
    this.panelY = opts.panelY;
    this.boardX = opts.boardX;
    this.boardY = opts.boardY;
    this.tileSize = opts.tileSize;
    this.boardSize = opts.boardSize;
    this.titleX = opts.titleX;
    this.titleY = opts.titleY;
    this.subtitle1X = opts.subtitle1X;
    this.subtitle1Y = opts.subtitle1Y;
    this.subtitle2X = opts.subtitle2X;
    this.subtitle2Y = opts.subtitle2Y;
    this.scoreX = opts.scoreX;
    this.scoreY = opts.scoreY;
    this.gameOverX = opts.gameOverX;
    this.gameOverY = opts.gameOverY;
    this.resetPos = opts.resetPos;
    this.backPos = opts.backPos;
  }
}

export class AlienZooKeeperView {
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
  protected _board: number[];
  protected _selectedIndex: number;
  protected _timerMs: number;
  protected _animTimeMs: number;
  protected _score: number;
  protected _resetButton: UiButtonState;
  protected _backButton: UiButtonState;

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
  get board(): number[] {
    return this._board;
  }
  get selectedIndex(): number {
    return this._selectedIndex;
  }
  get timerMs(): number {
    return this._timerMs;
  }
  get animTimeMs(): number {
    return this._animTimeMs;
  }
  get score(): number {
    return this._score;
  }
  get resetButton(): UiButtonState {
    return this._resetButton;
  }
  get backButton(): UiButtonState {
    return this._backButton;
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

    this._board = Array.from({ length: _BOARD_CELLS }, () => 0);
    this._selectedIndex = -1;
    this._timerMs = _TIMER_RESET_MS;
    this._animTimeMs = 0;
    this._score = 0;

    this._resetButton = new UiButtonState({ label: _RESET_LABEL, forceWide: false });
    this._backButton = new UiButtonState({ label: _BACK_LABEL, forceWide: false });
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._widescreenYShift = MenuView.menuWidescreenYShift(layoutW);
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._action = null;

    this._resetButton = new UiButtonState({ label: _RESET_LABEL, forceWide: false });
    this._backButton = new UiButtonState({ label: _BACK_LABEL, forceWide: false });

    this._animTimeMs = 0;
    this._resetState();
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this._ground = null;
    this._action = null;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
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
    if (!(this._isOpen)) throw new Error('AlienZooKeeperView must be opened before use');
  }

  protected _beginCloseTransition(action: string): void {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  protected _panelSlideX(opts: { scale: number }): number {
    const scale = opts.scale;
    const panelW = MENU_PANEL_WIDTH * scale;
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 0 });
    return slideX;
  }

  protected _layout(opts: { scale: number }): AzkLayout {
    const scale = opts.scale;
    const layoutOffsetX = this.state.config.display.width < 641.0 ? _LAYOUT_OFFSET_X_SMALL : _LAYOUT_OFFSET_X;
    const slideX = this._panelSlideX({ scale: scale });
    const anchorX = _LAYOUT_POS_X + layoutOffsetX + _BOARD_X_OFFSET + slideX;
    const titleBaseY = _LAYOUT_BASE_Y + _LAYOUT_POS_Y + _TITLE_BASE_Y_OFFSET + this._widescreenYShift;
    const boardX = anchorX + (22.0 * scale);
    const boardY = titleBaseY + (_BOARD_Y_OFFSET * scale);

    const tileSize = _TILE_SIZE * scale;
    const boardSize = _BOARD_SIZE * scale;

    return new AzkLayout({ scale: scale, panelX: _LAYOUT_POS_X + layoutOffsetX + slideX, panelY: _LAYOUT_BASE_Y + _LAYOUT_POS_Y + this._widescreenYShift, boardX: boardX, boardY: boardY, tileSize: tileSize, boardSize: boardSize, titleX: anchorX, titleY: titleBaseY - (14.0 * scale), subtitle1X: anchorX + (12.0 * scale), subtitle1Y: titleBaseY + (10.0 * scale), subtitle2X: anchorX + (18.0 * scale), subtitle2Y: titleBaseY + (23.0 * scale), scoreX: boardX + (124.0 * scale), scoreY: boardY - (16.0 * scale), gameOverX: boardX + (38.0 * scale), gameOverY: boardY + (74.0 * scale), resetPos: new Vec2(anchorX + (38.0 * scale), titleBaseY + (256.0 * scale)), backPos: new Vec2(anchorX + (138.0 * scale), titleBaseY + (256.0 * scale)) });
  }

  protected _fillEmptyCells(): void {
    for (const [i, value] of this._board.entries()) {
      if (value === -1) {
        this._board[i] = int(this.state.rng.rand({ caller: RngCallerStatic.CREDITS_SECRET_ALIEN_ZOOKEEPER_FILL_EMPTY }) % 5);
      }
    }
  }

  protected _rerollBoardNoInitialMatch(): void {
    while (true) {
      for (let i = 0; i < _BOARD_CELLS; i++) {
        this._board[i] = int(this.state.rng.rand({ caller: RngCallerStatic.CREDITS_SECRET_ALIEN_ZOOKEEPER_REROLL_FILL }) % 5);
      }
      const [hasMatch, outIdx, outDir] = creditsSecretMatch3Find(this._board);
      if (!hasMatch) {
        return;
      }
    }
  }

  protected _resetState(): void {
    this._rerollBoardNoInitialMatch();
    this._selectedIndex = -1;
    this._score = 0;
    this._timerMs = _TIMER_RESET_MS;
  }

  protected _resolveTileClick(opts: { layout: AzkLayout; mouse: wgl.Vector2 }): void {
    const layout = opts.layout;
    const mouse = opts.mouse;
    if (this._timerMs <= 0) {
      return;
    }

    for (const [index, cellValue] of this._board.entries()) {
      if (cellValue === -3) {
        continue;
      }
      const row = Math.floor(index / _BOARD_SIDE);
      const col = index % _BOARD_SIDE;
      const x = layout.boardX + col * layout.tileSize;
      const y = layout.boardY + row * layout.tileSize;
      if (!mouseInsideRect(mouse, { x: x, y: y, w: layout.tileSize, h: layout.tileSize })) {
        continue;
      }

      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_CLINK_01);
      }

      if (this._selectedIndex === -1) {
        this._selectedIndex = index;
        return;
      }

      const selected = this._selectedIndex;
      [this._board[index], this._board[selected]] = [this._board[selected], this._board[index]];
      this._selectedIndex = -1;

      const [hasMatch, outIdx, outDir] = creditsSecretMatch3Find(this._board);
      if (!hasMatch) {
        return;
      }

      this._board[outIdx] = -3;
      if (outDir === 0) {
        if ((outIdx + _BOARD_SIDE) < _BOARD_CELLS) {
          this._board[outIdx + _BOARD_SIDE] = -3;
        }
        if ((outIdx + (_BOARD_SIDE * 2)) < _BOARD_CELLS) {
          this._board[outIdx + (_BOARD_SIDE * 2)] = -3;
        }
      } else {
        if ((outIdx + 1) < _BOARD_CELLS) {
          this._board[outIdx + 1] = -3;
        }
        if ((outIdx + 2) < _BOARD_CELLS) {
          this._board[outIdx + 2] = -3;
        }
      }

      this._score += 1;
      this._timerMs += _MATCH_TIMER_BONUS_MS;
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BONUS);
      }
      return;
    }
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
      this._animTimeMs += dtMs;
      if (this._timerMs > 0) {
        this._timerMs -= dtMs;
        if (this._timerMs <= 0) {
          this._timerMs = 0;
          if (this.state.audio !== null) {
            playSfx(this.state.audio, SfxId.TROOPER_DIE_01);
          }
        }
      } else if (this._timerMs < 0) {
        this._timerMs = 0;
      }
    }

    this._fillEmptyCells();

    const interactive = this._timelineMs >= this._timelineMaxMs;
    if (InputState.wasKeyPressed(27) && interactive) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('open_statistics');
      return;
    }
    if (!interactive) {
      return;
    }

    const scale = this.state.config.display.width < 641.0 ? 0.9 : 1.0;
    const layout = this._layout({ scale: scale });
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
    if (click) {
      this._resolveTileClick({ layout: layout, mouse: mouse });
    }

    const resources = requireRuntimeResources(this.state);
    const dtMsF = dtClamped * 1000.0;

    const resetW = buttonWidth(resources, this._resetButton.label, { scale: scale, forceWide: this._resetButton.forceWide });
    if (buttonUpdate(this._resetButton, { pos: layout.resetPos, width: resetW, dtMs: dtMsF, mouse: mouse, click: click })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._resetState();
      return;
    }

    const backW = buttonWidth(resources, this._backButton.label, { scale: scale, forceWide: this._backButton.forceWide });
    if (buttonUpdate(this._backButton, { pos: layout.backPos, width: backW, dtMs: dtMsF, mouse: mouse, click: click })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('open_statistics');
      return;
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
    const font = resources.smallFont;
    const scale = this.state.config.display.width < 641.0 ? 0.9 : 1.0;
    const layout = this._layout({ scale: scale });

    let dst = wgl.makeRectangle(layout.panelX, layout.panelY, MENU_PANEL_WIDTH * scale, 378.0 * scale);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(resources.texture(TextureId.UI_MENU_PANEL), { dst: dst, tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail });

    drawSmallText(font, _TITLE, new Vec2(layout.titleX, layout.titleY), wgl.makeColor(1, 1, 1, 1));
    drawSmallText(font, _SUBTITLE_1, new Vec2(layout.subtitle1X, layout.subtitle1Y), wgl.makeColor(1, 1, 1, 1));
    drawSmallText(font, _SUBTITLE_2, new Vec2(layout.subtitle2X, layout.subtitle2Y), wgl.makeColor(1, 1, 1, 1));

    const scoreText = _LABEL_SCORE.replace(/%[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[sdif]/, String(int(this._score)));
    drawSmallText(font, scoreText, new Vec2(layout.scoreX, layout.scoreY), toColor(1.0, 1.0, 1.0, 0.7));

    const boardBg = wgl.makeRectangle(layout.boardX, layout.boardY, layout.boardSize, layout.boardSize);
    wgl.drawRectangle(boardBg.x, boardBg.y, boardBg.w, boardBg.h, toColor(0.0, 0.0, 0.0, 0.6));
    wgl.drawRectangleLinesEx(boardBg, Math.max(1.0, scale), wgl.makeColor(1, 1, 1, 1));

    let timerValue = Math.floor(this._timerMs / 100);
    if (timerValue > 0xC0) {
      timerValue = 0xC0;
    }
    const timerH = 6.0 * scale;
    const timerY = layout.boardY + (200.0 * scale);
    const timerFillW = timerValue * scale;
    wgl.drawRectangle(layout.boardX, timerY, timerFillW, timerH, toColor(0.2, 0.6, 1.0, 0.6));
    wgl.drawRectangleLinesEx(wgl.makeRectangle(layout.boardX, timerY, layout.boardSize, timerH), Math.max(1.0, scale), wgl.makeColor(1, 1, 1, 1));

    let row: number;
    let col: number;
    if (this._selectedIndex >= 0) {
      row = Math.floor(this._selectedIndex / _BOARD_SIDE);
      col = this._selectedIndex % _BOARD_SIDE;
      const selRect = wgl.makeRectangle(layout.boardX + col * layout.tileSize + (4.0 * scale), layout.boardY + row * layout.tileSize + (4.0 * scale), 24.0 * scale, 24.0 * scale);
      wgl.drawRectangle(selRect.x, selRect.y, selRect.w, selRect.h, toColor(0.2, 0.4, 0.7, 0.4));
      wgl.drawRectangleLinesEx(selRect, Math.max(1.0, scale), wgl.makeColor(1, 1, 1, 1));
    }

    const alien = resources.texture(TextureId.ALIEN);
    const frameW = alien.width / 8.0;
    const frameH = alien.height / 8.0;
    for (const [index, tile] of this._board.entries()) {
      if (tile === -3) {
        continue;
      }
      row = Math.floor(index / _BOARD_SIDE);
      col = index % _BOARD_SIDE;
      const animFrame = ((((Math.floor(this._animTimeMs / 50)) + (tile * 2)) % 32) + 32) % 32;
      const srcCol = animFrame % 8;
      const srcRow = Math.floor(animFrame / 8);
      const src = wgl.makeRectangle(srcCol * frameW, srcRow * frameH, frameW, frameH);
      dst = wgl.makeRectangle(layout.boardX + col * layout.tileSize, layout.boardY + row * layout.tileSize, layout.tileSize, layout.tileSize);
      let tint: wgl.Color;
      if (tile === 0) {
        tint = toColor(1.0, 0.5, 0.5, 1.0);
      } else if (tile === 1) {
        tint = toColor(0.5, 0.5, 1.0, 1.0);
      } else if (tile === 2) {
        tint = toColor(1.0, 0.5, 1.0, 1.0);
      } else if (tile === 3) {
        tint = toColor(0.5, 1.0, 1.0, 1.0);
      } else if (tile === 4) {
        tint = toColor(1.0, 1.0, 0.5, 1.0);
      } else {
        tint = wgl.makeColor(1, 1, 1, 1);
      }
      wgl.drawTexturePro(alien, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);
    }

    if (this._timerMs === 0 && Math.cos(this._animTimeMs * 0.005) > 0.0) {
      drawSmallText(font, _LABEL_GAME_OVER, new Vec2(layout.gameOverX, layout.gameOverY), wgl.makeColor(1, 1, 1, 1));
    }

    const resetW = buttonWidth(resources, this._resetButton.label, { scale: scale, forceWide: this._resetButton.forceWide });
    buttonDraw(
      resources,
      this._resetButton,
      { pos: layout.resetPos, width: resetW, scale: scale },
    );

    const backW = buttonWidth(resources, this._backButton.label, { scale: scale, forceWide: this._backButton.forceWide });
    buttonDraw(
      resources,
      this._backButton,
      { pos: layout.backPos, width: backW, scale: scale },
    );

    this._drawSign();
    drawMenuCursorHelper(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
  }

  protected _drawSign(): void {
    const sign = requireRuntimeResources(this.state).texture(TextureId.UI_SIGN_CRIMSON);
    const screenW = this.state.config.display.width;
    const [signScale, shiftX] = MenuView.signLayoutScale(int(screenW));
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

export function toColor(r: number, g: number, b: number, a: number): wgl.Color {
  return wgl.makeColor(int(Math.max(0.0, Math.min(1.0, r)) * 255.0 + 0.5) / 255, int(Math.max(0.0, Math.min(1.0, g)) * 255.0 + 0.5) / 255, int(Math.max(0.0, Math.min(1.0, b)) * 255.0 + 0.5) / 255, int(Math.max(0.0, Math.min(1.0, a)) * 255.0 + 0.5) / 255);
}

export function mouseInsideRect(mouse: wgl.Vector2, opts: { x: number; y: number; w: number; h: number }): boolean {
  const x = opts.x;
  const y = opts.y;
  const w = opts.w;
  const h = opts.h;
  return (x <= mouse.x && mouse.x <= (x + w)) && (y <= mouse.y && mouse.y <= (y + h));
}

export function creditsSecretMatch3Find(board: number[]): [boolean, number, number] {
  // Native order: horizontal first, then vertical.
  for (let row = 0; row < _BOARD_SIDE; row++) {
    const base = row * _BOARD_SIDE;
    for (let col = 0; col < _BOARD_SIDE - 2; col++) {
      let idx = base + col;
      let v = board[idx];
      if (v < 0) {
        continue;
      }
      if (board[idx + 1] === v && board[idx + 2] === v) {
        return [true, idx, 1];
      }
    }
  }

  for (let col = 0; col < _BOARD_SIDE; col++) {
    for (let row = 0; row < _BOARD_SIDE - 2; row++) {
      let idx = row * _BOARD_SIDE + col;
      let v = board[idx];
      if (v < 0) {
        continue;
      }
      if (board[idx + _BOARD_SIDE] === v && board[idx + (_BOARD_SIDE * 2)] === v) {
        return [true, idx, 0];
      }
    }
  }

  return [false, 0, 0];
}
