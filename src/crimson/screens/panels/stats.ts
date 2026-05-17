// Port of crimson/screens/panels/stats.py

import { TextureId } from '@grim/assets.ts';
import { playMusic, playSfx, stopMusic, updateAudio } from '@grim/audio.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState } from '@crimson/game/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_LABEL_ROW_HEIGHT, MENU_LABEL_ROW_STATISTICS, MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, uiElementAnim } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from '@crimson/screens/panels/base.ts';
import * as wgl from '@wgl';

// Measured from ui_render_trace_oracle_1024x768.json (state_4:played for # hours # minutes, timeline=300).
export const STATISTICS_PANEL_POS_X = -89.0;
export const STATISTICS_PANEL_POS_Y = 185.0;
export const STATISTICS_PANEL_HEIGHT = 378.0;
// Child layout inside the panel (relative to panel top-left).
const _TITLE_X = 290.0;
const _TITLE_Y = 52.0;
const _TITLE_W = 128.0;
const _TITLE_H = 32.0;
const _BUTTON_X = 270.0;
const _BUTTON_Y0 = 104.0;
const _BUTTON_STEP_Y = 34.0;
const _BACK_BUTTON_X = 394.0;
const _BACK_BUTTON_Y = 290.0;
const _PLAYTIME_X = 204.0;
const _PLAYTIME_Y = 334.0;
const _STATS_EASTER_ROLL_UNSET = -1;
const _STATS_EASTER_TRIGGER_ROLL = 3;
const _STATS_EASTER_TEXT = 'Orbes Volantes Exstare';
const _STATS_EASTER_TEXT_Y = 5.0;

//
// Classic "Statistics" menu (state_id=4).
//
// This is a small hub panel with buttons for:
//   - High scores
//   - Weapons / Perks databases
//   - Credits
export class StatisticsMenuView {
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
  protected _btnHighScores: UiButtonState;
  protected _btnWeapons: UiButtonState;
  protected _btnPerks: UiButtonState;
  protected _btnCredits: UiButtonState;
  protected _btnBack: UiButtonState;

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
  get btnHighScores(): UiButtonState {
    return this._btnHighScores;
  }
  get btnWeapons(): UiButtonState {
    return this._btnWeapons;
  }
  get btnPerks(): UiButtonState {
    return this._btnPerks;
  }
  get btnCredits(): UiButtonState {
    return this._btnCredits;
  }
  get btnBack(): UiButtonState {
    return this._btnBack;
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

    this._btnHighScores = new UiButtonState({ label: 'High scores', forceWide: true });
    this._btnWeapons = new UiButtonState({ label: 'Weapons', forceWide: true });
    this._btnPerks = new UiButtonState({ label: 'Perks', forceWide: true });
    this._btnCredits = new UiButtonState({ label: 'Credits', forceWide: true });
    this._btnBack = new UiButtonState({ label: 'Back', forceWide: false });
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._widescreenYShift = MenuView._menuWidescreenYShift(layoutW);
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this._cursorPulseTime = 0.0;
    this._action = null;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;

    this._btnHighScores = new UiButtonState({ label: 'High scores', forceWide: true });
    this._btnWeapons = new UiButtonState({ label: 'Weapons', forceWide: true });
    this._btnPerks = new UiButtonState({ label: 'Perks', forceWide: true });
    this._btnCredits = new UiButtonState({ label: 'Credits', forceWide: true });
    this._btnBack = new UiButtonState({ label: 'Back', forceWide: false });

    if (this.state.audio !== null) {
      if (this.state.audio.music.activeTrack !== 'shortie_monk') {
        stopMusic(this.state.audio);
      }
      playMusic(this.state.audio, 'shortie_monk');
      playSfx(this.state.audio, SfxId.UI_PANELCLICK);
    }
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

  reopenFromChild(): void {
    this._action = null;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._btnHighScores = new UiButtonState({ label: 'High scores', forceWide: true });
    this._btnWeapons = new UiButtonState({ label: 'Weapons', forceWide: true });
    this._btnPerks = new UiButtonState({ label: 'Perks', forceWide: true });
    this._btnCredits = new UiButtonState({ label: 'Credits', forceWide: true });
    this._btnBack = new UiButtonState({ label: 'Back', forceWide: false });
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_PANELCLICK);
    }
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
    if (!(this._isOpen)) throw new Error('StatisticsMenuView must be opened before use');
  }

  protected _panelTopLeft(opts: { scale: number }): Vec2 {
    const scale = opts.scale;
    return new Vec2(STATISTICS_PANEL_POS_X + MENU_PANEL_OFFSET_X * scale, STATISTICS_PANEL_POS_Y + this._widescreenYShift + MENU_PANEL_OFFSET_Y * scale);
  }

  protected _beginCloseTransition(action: string): void {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      if (!this._closing) {
        playMusic(this.state.audio, 'shortie_monk');
      }
      updateAudio(this.state.audio, dt);
    }
    this.state.statsMenuEasterEggRoll = statsMenuEasterRoll(this.state.statsMenuEasterEggRoll, { rng: this.state.rng });
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
    const interactive = this._timelineMs >= this._timelineMaxMs;

    if (InputState.wasKeyPressed(27) && interactive) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_menu');
      return;
    }

    if (!interactive) {
      return;
    }

    const scale = this.state.config.display.width < 641.0 ? 0.9 : 1.0;
    const panelW = MENU_PANEL_WIDTH * scale;
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 0 });
    const panelTopLeft = this._panelTopLeft({ scale: scale }).offset({ dx: slideX });
    const resources = requireRuntimeResources(this.state);

    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
    const dtMsF = Math.min(dt, 0.1) * 1000.0;

    const _updateButton = (btn: UiButtonState, opts: { pos: Vec2 }): boolean => {
      const pos = opts.pos;
      const w = buttonWidth(resources, btn.label, { scale: scale, forceWide: btn.forceWide });
      return buttonUpdate(btn, { pos: pos, width: w, dtMs: dtMsF, mouse: mouse, click: click });
    };

    const buttonBase = panelTopLeft.add(new Vec2(_BUTTON_X * scale, _BUTTON_Y0 * scale));
    if (_updateButton(this._btnHighScores, { pos: buttonBase.offset({ dy: _BUTTON_STEP_Y * 0.0 * scale }) })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('open_high_scores');
      return;
    }
    if (_updateButton(this._btnWeapons, { pos: buttonBase.offset({ dy: _BUTTON_STEP_Y * 1.0 * scale }) })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('open_weapon_database');
      return;
    }
    if (_updateButton(this._btnPerks, { pos: buttonBase.offset({ dy: _BUTTON_STEP_Y * 2.0 * scale }) })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('open_perk_database');
      return;
    }
    if (_updateButton(this._btnCredits, { pos: buttonBase.offset({ dy: _BUTTON_STEP_Y * 3.0 * scale }) })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('open_credits');
      return;
    }

    if (_updateButton(this._btnBack, { pos: panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale)) })) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_menu');
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

    const scale = this.state.config.display.width < 641.0 ? 0.9 : 1.0;
    const panelW = MENU_PANEL_WIDTH * scale;
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 0 });
    const panelTopLeft = this._panelTopLeft({ scale: scale }).offset({ dx: slideX });
    const dst = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, panelW, STATISTICS_PANEL_HEIGHT * scale);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(resources.texture(TextureId.UI_MENU_PANEL), { dst: dst, tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail });

    // Title: full-size row from ui_itemTexts.jaz (128x32).
    const labelTex = resources.texture(TextureId.UI_ITEM_TEXTS);
    const rowH = MENU_LABEL_ROW_HEIGHT;
    const src = wgl.makeRectangle(0.0, MENU_LABEL_ROW_STATISTICS * rowH, labelTex.width, rowH);
    wgl.drawTexturePro(labelTex, src, wgl.makeRectangle(panelTopLeft.x + _TITLE_X * scale, panelTopLeft.y + _TITLE_Y * scale, _TITLE_W * scale, _TITLE_H * scale), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    // "played for # hours # minutes"
    const font = resources.smallFont;
    drawSmallText(font, formatPlaytimeText(int(this.state.status.gameSequenceId), { preserveBugs: this.state.preserveBugs }), panelTopLeft.add(new Vec2(_PLAYTIME_X * scale, _PLAYTIME_Y * scale)), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255));

    if (isOrbesVolantesDay(new Date()) && int(this.state.statsMenuEasterEggRoll) === _STATS_EASTER_TRIGGER_ROLL) {
      this.state.statsMenuEasterEggRoll = _STATS_EASTER_ROLL_UNSET;
      const x = (this.state.rng.rand({ caller: RngCallerStatic.REWRITE_STATS_MENU_EASTER_TEXT_X }) % 64 + 16);
      drawSmallText(font, _STATS_EASTER_TEXT, new Vec2(x, _STATS_EASTER_TEXT_Y), wgl.makeColor(51 / 255, 255 / 255, 153 / 255, 128 / 255));
    }

    // Buttons.
    const buttonBase = panelTopLeft.add(new Vec2(_BUTTON_X * scale, _BUTTON_Y0 * scale));
    for (const [i, btn] of [this._btnHighScores, this._btnWeapons, this._btnPerks, this._btnCredits].entries()) {
      const w = buttonWidth(resources, btn.label, { scale: scale, forceWide: btn.forceWide });
      buttonDraw(
        resources,
        btn,
        { pos: buttonBase.offset({ dy: _BUTTON_STEP_Y * i * scale }), width: w, scale: scale },
      );
    }

    const backW = buttonWidth(resources, this._btnBack.label, { scale: scale, forceWide: this._btnBack.forceWide });
    buttonDraw(
      resources,
      this._btnBack,
      { pos: panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale)), width: backW, scale: scale },
    );

    this._drawSign({ scale: scale });
    drawMenuCursorHelper(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
  }

  protected _drawSign(opts: { scale: number }): void {
    const scale = opts.scale;
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

export function statsMenuEasterRoll(currentRoll: number, opts: { rng: CrandLike }): number {
  const rng = opts.rng;
  if (int(currentRoll) !== _STATS_EASTER_ROLL_UNSET) {
    return int(currentRoll);
  }
  return int(rng.rand({ caller: RngCallerStatic.REWRITE_STATS_MENU_EASTER_ROLL }) % 32);
}

export function isOrbesVolantesDay(today: Date): boolean {
  return int(today.getMonth() + 1) === 3 && int(today.getDate()) === 3;
}

export function formatPlaytimeText(gameSequenceMs: number, opts: { preserveBugs?: boolean } = {}): string {
  const preserveBugs = opts.preserveBugs ?? false;
  const totalMinutes = Math.floor((Math.floor(Math.max(0, int(gameSequenceMs)) / 1000)) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (preserveBugs) {
    return `played for ${hours} hours ${minutes} minutes`;
  }
  const hourLabel = hours === 1 ? 'hour' : 'hours';
  const minuteLabel = minutes === 1 ? 'minute' : 'minutes';
  return `played for ${hours} ${hourLabel} ${minutes} ${minuteLabel}`;
}
