// Port of crimson/screens/panels/stats.py

import { getTexture, TextureId } from "@grim/assets.ts";
import { audioPlayMusic, audioPlaySfx, audioStopMusic, audioUpdate } from "@grim/audio.ts";
import { drawSmallText } from "@grim/fonts/small.ts";
import { Vec2 } from "@grim/geom.ts";
import * as wgl from "@wgl";
import { SfxId } from "@grim/sfx-map.ts";
import { fxDetailEnabled } from "@grim/config.ts";
import { InputState } from "@grim/input.ts";
import { type GroundRenderer } from "@grim/terrain-render.ts";
import { menuWidescreenYShift } from "@crimson/ui/layout.ts";
import { drawUiQuadShadow, UI_SHADOW_OFFSET } from "@crimson/ui/shadow.ts";
import { type GameState } from "@crimson/game/types.ts";
import { RngCallerStatic } from "@crimson/rng-caller-static.ts";
import { drawClassicMenuPanel } from "@crimson/ui/menu-panel.ts";
import { buttonDraw, buttonUpdate, buttonWidth, UiButtonState } from "@crimson/ui/perk-menu.ts";
import { requireRuntimeResources } from "@crimson/screens/assets.ts";
import { MENU_LABEL_ROW_HEIGHT, MENU_LABEL_ROW_STATISTICS, MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, signLayoutScale, uiElementAnim } from "@crimson/screens/menu.ts";
import { drawScreenFade } from "@crimson/screens/transitions.ts";
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from "./base.ts";

// Measured from ui_render_trace_oracle_1024x768.json (state_4:played for # hours # minutes, timeline=300).
const STATISTICS_PANEL_POS_X = -89.0;
const STATISTICS_PANEL_POS_Y = 185.0;
const STATISTICS_PANEL_HEIGHT = 378.0;

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

const KEY_ESCAPE = 27;
const MOUSE_BUTTON_LEFT = 0;

const WHITE = wgl.makeColor(1, 1, 1, 1);

function statsMenuEasterRoll(currentRoll: number, rng: { rand(opts?: { caller?: number }): number }): number {
  if (int(currentRoll) !== _STATS_EASTER_ROLL_UNSET) {
    return int(currentRoll);
  }
  return int(rng.rand({ caller: RngCallerStatic.REWRITE_STATS_MENU_EASTER_ROLL }) % 32);
}

function isOrbesVolantesDay(date: Date): boolean {
  return int(date.getMonth() + 1) === 3 && int(date.getDate()) === 3;
}

export function formatPlaytimeText(gameSequenceMs: number, opts: { preserveBugs?: boolean } = {}): string {
  const preserveBugs = opts.preserveBugs ?? false;
  const totalMinutes = Math.floor(Math.floor(Math.max(0, int(gameSequenceMs)) / 1000) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (preserveBugs) {
    return `played for ${hours} hours ${minutes} minutes`;
  }
  const hourLabel = hours === 1 ? 'hour' : 'hours';
  const minuteLabel = minutes === 1 ? 'minute' : 'minutes';
  return `played for ${hours} ${hourLabel} ${minutes} ${minuteLabel}`;
}

// Classic "Statistics" menu (state_id=4).
//
// This is a small hub panel with buttons for:
//   - High scores
//   - Weapons / Perks databases
//   - Credits
export class StatisticsMenuView {
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

  private _btnHighScores: UiButtonState;
  private _btnWeapons: UiButtonState;
  private _btnPerks: UiButtonState;
  private _btnCredits: UiButtonState;
  private _btnBack: UiButtonState;

  constructor(state: GameState) {
    this.state = state;
    this._btnHighScores = new UiButtonState({ label: 'High scores', forceWide: true });
    this._btnWeapons = new UiButtonState({ label: 'Weapons', forceWide: true });
    this._btnPerks = new UiButtonState({ label: 'Perks', forceWide: true });
    this._btnCredits = new UiButtonState({ label: 'Credits', forceWide: true });
    this._btnBack = new UiButtonState({ label: 'Back', forceWide: false });
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._widescreenYShift = menuWidescreenYShift(layoutW);
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
        audioStopMusic(this.state.audio);
      }
      audioPlayMusic(this.state.audio, 'shortie_monk');
      audioPlaySfx(this.state.audio, SfxId.UI_PANELCLICK);
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
      audioPlaySfx(this.state.audio, SfxId.UI_PANELCLICK);
    }
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
      throw new Error('StatisticsMenuView must be opened before use');
    }
  }

  private _panelTopLeft(opts: { scale: number }): Vec2 {
    const scale = opts.scale;
    return new Vec2(
      STATISTICS_PANEL_POS_X + MENU_PANEL_OFFSET_X * scale,
      STATISTICS_PANEL_POS_Y + this._widescreenYShift + MENU_PANEL_OFFSET_Y * scale,
    );
  }

  private _beginCloseTransition(action: string): void {
    if (this._closing) return;
    this._closing = true;
    this._closeAction = action;
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      if (!this._closing) {
        audioPlayMusic(this.state.audio, 'shortie_monk');
      }
      audioUpdate(this.state.audio, dt);
    }
    this.state.statsMenuEasterEggRoll = statsMenuEasterRoll(
      this.state.statsMenuEasterEggRoll,
      this.state.rng,
    );
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
    }
    const interactive = this._timelineMs >= this._timelineMaxMs;

    if (InputState.wasKeyPressed(KEY_ESCAPE) && interactive) {
      if (this.state.audio !== null) audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      this._beginCloseTransition('back_to_menu');
      return;
    }

    if (!interactive) return;

    const scale = this.state.config.display.width < 641 ? 0.9 : 1.0;
    const panelW = MENU_PANEL_WIDTH * scale;
    const [_angleRad, slideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 0,
    });
    const panelTopLeft = this._panelTopLeft({ scale }).offset({ dx: slideX, dy: 0 });
    const resources = requireRuntimeResources(this.state);

    const [mx, my] = InputState.mousePosition();
    const mouse = { x: mx, y: my };
    const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
    const dtMsF = Math.min(dt, 0.1) * 1000.0;

    function updateButton(btn: UiButtonState, opts: { pos: Vec2 }): boolean {
      const pos = opts.pos;
      const w = buttonWidth(resources, btn.label, { scale, forceWide: btn.forceWide });
      return buttonUpdate(btn, { pos, width: w, dtMs: dtMsF, mouse, click });
    }

    const buttonBase = panelTopLeft.add(new Vec2(_BUTTON_X * scale, _BUTTON_Y0 * scale));
    if (updateButton(this._btnHighScores, { pos: buttonBase.offset({ dx: 0, dy: _BUTTON_STEP_Y * 0.0 * scale }) })) {
      if (this.state.audio !== null) audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      this._beginCloseTransition('open_high_scores');
      return;
    }
    if (updateButton(this._btnWeapons, { pos: buttonBase.offset({ dx: 0, dy: _BUTTON_STEP_Y * 1.0 * scale }) })) {
      if (this.state.audio !== null) audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      this._beginCloseTransition('open_weapon_database');
      return;
    }
    if (updateButton(this._btnPerks, { pos: buttonBase.offset({ dx: 0, dy: _BUTTON_STEP_Y * 2.0 * scale }) })) {
      if (this.state.audio !== null) audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      this._beginCloseTransition('open_perk_database');
      return;
    }
    if (updateButton(this._btnCredits, { pos: buttonBase.offset({ dx: 0, dy: _BUTTON_STEP_Y * 3.0 * scale }) })) {
      if (this.state.audio !== null) audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      this._beginCloseTransition('open_credits');
      return;
    }

    const backPos = panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale));
    if (updateButton(this._btnBack, { pos: backPos })) {
      if (this.state.audio !== null) audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
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

    const scale = this.state.config.display.width < 641 ? 0.9 : 1.0;
    const panelW = MENU_PANEL_WIDTH * scale;
    const [_angleRad, slideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 0,
    });
    const panelTopLeft = this._panelTopLeft({ scale }).offset({ dx: slideX, dy: 0 });
    const dst = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, panelW, STATISTICS_PANEL_HEIGHT * scale);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const panel = getTexture(resources, TextureId.UI_MENU_PANEL);
    drawClassicMenuPanel(panel, { dst, tint: WHITE, shadow: fxDetail });

    // Title: full-size row from ui_itemTexts.jaz (128x32).
    const labelTex = getTexture(resources, TextureId.UI_ITEM_TEXTS);
    const rowH = MENU_LABEL_ROW_HEIGHT;
    const src = wgl.makeRectangle(0.0, MENU_LABEL_ROW_STATISTICS * rowH, labelTex.width, rowH);
    wgl.drawTexturePro(
      labelTex, src,
      wgl.makeRectangle(
        panelTopLeft.x + _TITLE_X * scale,
        panelTopLeft.y + _TITLE_Y * scale,
        _TITLE_W * scale,
        _TITLE_H * scale,
      ),
      wgl.makeVector2(0, 0), 0.0, WHITE,
    );

    // "played for # hours # minutes"
    const font = resources.smallFont;
    const playtimeMs = this.state.status.gameSequenceId;
    const playtimeText = formatPlaytimeText(playtimeMs, { preserveBugs: this.state.preserveBugs });
    const playtimePos = panelTopLeft.add(new Vec2(_PLAYTIME_X * scale, _PLAYTIME_Y * scale));
    drawSmallText(font, playtimeText, playtimePos, wgl.makeColor(1, 1, 1, int(255 * 0.8) / 255));

    const today = new Date();
    if (isOrbesVolantesDay(today) && int(this.state.statsMenuEasterEggRoll) === _STATS_EASTER_TRIGGER_ROLL) {
      this.state.statsMenuEasterEggRoll = _STATS_EASTER_ROLL_UNSET;
      const easterX = this.state.rng.rand({ caller: RngCallerStatic.REWRITE_STATS_MENU_EASTER_TEXT_X }) % 64 + 16;
      drawSmallText(font, _STATS_EASTER_TEXT, new Vec2(easterX, _STATS_EASTER_TEXT_Y), wgl.makeColor(51 / 255, 1, 153 / 255, 128 / 255));
    }

    // Buttons.
    const buttonBase = panelTopLeft.add(new Vec2(_BUTTON_X * scale, _BUTTON_Y0 * scale));
    const buttons = [this._btnHighScores, this._btnWeapons, this._btnPerks, this._btnCredits];
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const w = buttonWidth(resources, btn.label, { scale, forceWide: btn.forceWide });
      const btnPos = buttonBase.offset({ dx: 0, dy: _BUTTON_STEP_Y * i * scale });
      buttonDraw(resources, btn, { pos: btnPos, width: w, scale });
    }

    const backW = buttonWidth(resources, this._btnBack.label, { scale, forceWide: this._btnBack.forceWide });
    const backPos = panelTopLeft.add(new Vec2(_BACK_BUTTON_X * scale, _BACK_BUTTON_Y * scale));
    buttonDraw(resources, this._btnBack, { pos: backPos, width: backW, scale });

    this._drawSign({ scale });
    drawMenuCursorHelper(this.state, { resources, pulseTime: this._cursorPulseTime });
  }

  private _drawSign(_opts: { scale: number }): void {
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
