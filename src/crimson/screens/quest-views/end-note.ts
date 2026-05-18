// Port of crimson/screens/quest_views/end_note.py

import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from '@crimson/screens/panels/base.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { END_NOTE_AFTER_BODY_Y_GAP, END_NOTE_BODY_X_OFFSET, END_NOTE_BODY_Y_GAP, END_NOTE_BUTTON_STEP_Y, END_NOTE_BUTTON_X_OFFSET, END_NOTE_BUTTON_Y_OFFSET, END_NOTE_HEADER_X_OFFSET, END_NOTE_HEADER_Y_OFFSET, END_NOTE_LINE_STEP_Y, END_NOTE_PANEL_GEOM_X0, END_NOTE_PANEL_GEOM_Y0, END_NOTE_PANEL_H, END_NOTE_PANEL_POS_X, END_NOTE_PANEL_POS_Y, END_NOTE_PANEL_W } from '@crimson/screens/quest-views/shared.ts';
import * as wgl from '@wgl';

// Final quest "Show End Note" flow.
//
// Classic:
//   - quest_results_screen_update uses "Show End Note" instead of "Play Next" for quest 5.10
//   - clicking it transitions to state 0x15 (game_update_victory_screen @ 0x00406350)
export class EndNoteView {
  state: GameState;
  protected _ground: GroundRenderer | null;
  protected _action: string | null;
  protected _cursorPulseTime: number;
  _timelineMs: number;
  protected _timelineMaxMs: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _survivalButton: UiButtonState;
  protected _rushButton: UiButtonState;
  protected _typoButton: UiButtonState;
  protected _mainMenuButton: UiButtonState;

  get ground(): GroundRenderer | null {
    return this._ground;
  }
  get action(): string | null {
    return this._action;
  }
  get cursorPulseTime(): number {
    return this._cursorPulseTime;
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
  get survivalButton(): UiButtonState {
    return this._survivalButton;
  }
  get rushButton(): UiButtonState {
    return this._rushButton;
  }
  get typoButton(): UiButtonState {
    return this._typoButton;
  }
  get mainMenuButton(): UiButtonState {
    return this._mainMenuButton;
  }

  constructor(state: GameState) {
    this.state = state;
    this._ground = null;
    this._action = null;
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;

    this._survivalButton = new UiButtonState({ label: 'Survival', forceWide: true });
    this._rushButton = new UiButtonState({ label: '  Rush  ', forceWide: true });
    this._typoButton = new UiButtonState({ label: 'Typ\'o\'Shooter', forceWide: true });
    this._mainMenuButton = new UiButtonState({ label: 'Main Menu', forceWide: true });
  }

  open(): void {
    this._action = null;
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
  }

  close(): void {
    this._ground = null;
    this._closing = false;
    this._closeAction = null;
  }

  update(dt: number): void {
    if (this.state.audio !== null) {
      updateAudio(this.state.audio, dt);
    }
    if (this._ground !== null) {
      this._ground.processPending();
    }
    const dtStep = Math.min(dt, 0.1);
    this._cursorPulseTime += dtStep * 1.1;
    const dtMs = int(dtStep * 1000.0);
    if (this._closing) {
      if (dtMs > 0 && this._action === null) {
        this._timelineMs -= dtMs;
        if (this._timelineMs < 0 && this._closeAction !== null) {
          this._action = this._closeAction;
          this._closeAction = null;
        }
      }
      return;
    }
    if (dtMs > 0) {
      this._timelineMs = Math.min(this._timelineMaxMs, this._timelineMs + dtMs);
    }

    const enabled = this._timelineMs >= this._timelineMaxMs;
    if (InputState.wasKeyPressed(27) && enabled) {
      this._beginCloseTransition('back_to_menu');
      return;
    }

    if (!enabled) {
      return;
    }

    const screenW = wgl.getScreenWidth();
    const scale = 1.0;

    const layoutW = scale ? screenW / scale : screenW;
    const widescreenShiftY = MenuView.menuWidescreenYShift(layoutW);

    const panelTopLeft = new Vec2((END_NOTE_PANEL_GEOM_X0 + END_NOTE_PANEL_POS_X) * scale, (END_NOTE_PANEL_GEOM_Y0 + END_NOTE_PANEL_POS_Y + widescreenShiftY) * scale);
    let buttonPos = panelTopLeft.add(new Vec2(END_NOTE_BUTTON_X_OFFSET * scale, END_NOTE_BUTTON_Y_OFFSET * scale));

    const resources = requireRuntimeResources(this.state);
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);

    const survivalW = buttonWidth(resources, this._survivalButton.label, { scale: scale, forceWide: this._survivalButton.forceWide });
    if (buttonUpdate(this._survivalButton, { pos: buttonPos, width: survivalW, dtMs: dtMs, mouse: mouse, click: click })) {
      this.state.config.gameplay.mode = GameMode.SURVIVAL;
      this._beginCloseTransition('start_survival');
      return;
    }

    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const rushW = buttonWidth(resources, this._rushButton.label, { scale: scale, forceWide: this._rushButton.forceWide });
    if (buttonUpdate(this._rushButton, { pos: buttonPos, width: rushW, dtMs: dtMs, mouse: mouse, click: click })) {
      this.state.config.gameplay.mode = GameMode.RUSH;
      this._beginCloseTransition('start_rush');
      return;
    }

    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const typoW = buttonWidth(resources, this._typoButton.label, { scale: scale, forceWide: this._typoButton.forceWide });
    if (buttonUpdate(this._typoButton, { pos: buttonPos, width: typoW, dtMs: dtMs, mouse: mouse, click: click })) {
      this.state.config.gameplay.mode = GameMode.TYPO;
      this._beginCloseTransition('start_typo', { fadeToBlack: true });
      return;
    }

    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const mainW = buttonWidth(resources, this._mainMenuButton.label, { scale: scale, forceWide: this._mainMenuButton.forceWide });
    if (buttonUpdate(this._mainMenuButton, { pos: buttonPos, width: mainW, dtMs: dtMs, mouse: mouse, click: click })) {
      this._beginCloseTransition('back_to_menu');
      return;
    }
  }

  draw(): void {
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    const pauseBackground = this.state.pauseBackground;
    if (pauseBackground !== null) {
      pauseBackground.drawPauseBackground({ entityAlpha: this._worldEntityAlpha() });
    } else if (this._ground !== null) {
      this._ground.draw(menuGroundCamera(this.state));
    }
    drawScreenFade(this.state);

    const resources = requireRuntimeResources(this.state);

    const screenW = wgl.getScreenWidth();
    const scale = 1.0;
    const layoutW = scale ? screenW / scale : screenW;
    const widescreenShiftY = MenuView.menuWidescreenYShift(layoutW);

    const panelTopLeft = new Vec2((END_NOTE_PANEL_GEOM_X0 + END_NOTE_PANEL_POS_X) * scale, (END_NOTE_PANEL_GEOM_Y0 + END_NOTE_PANEL_POS_Y + widescreenShiftY) * scale);
    const panel = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, END_NOTE_PANEL_W * scale, END_NOTE_PANEL_H * scale);

    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(resources.texture(TextureId.UI_MENU_PANEL), { dst: panel, tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail });

    const font = resources.smallFont;
    const hardcore = this.state.config.gameplay.hardcore;
    const header = hardcore ? '   Incredible!' : 'Congratulations!';
    const levelsLine = this.state.preserveBugs ? 'You\'ve completed all the levels but the battle' : 'You\'ve completed all the levels, but the battle';
    const bodyLines = hardcore ? ['You\'ve done the thing we all thought was', 'virtually impossible. To reward your', 'efforts a new weapon has been unlocked ', 'for you: Splitter Gun.', '', ''] : [levelsLine, 'isn\'t over yet! With all of the unlocked perks', 'and weapons your Survival is just a bit easier.', 'You can also replay the quests in Hardcore.', 'As an additional reward for your victorious', 'playing, a completely new and different game', 'mode is unlocked for you: Typ\'o\'Shooter.'];

    const headerPos = panelTopLeft.add(new Vec2(END_NOTE_HEADER_X_OFFSET * scale, END_NOTE_HEADER_Y_OFFSET * scale));
    const headerColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);
    const bodyColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255);

    drawSmallText(font, header, headerPos, headerColor);

    let bodyPos = new Vec2(panelTopLeft.x + END_NOTE_BODY_X_OFFSET * scale, headerPos.y + END_NOTE_BODY_Y_GAP * scale);
    for (const [idx, line] of bodyLines.entries()) {
      drawSmallText(font, line, bodyPos, bodyColor);
      if (idx !== bodyLines.length - 1) {
        bodyPos = bodyPos.offset({ dy: END_NOTE_LINE_STEP_Y * scale });
      }
    }
    bodyPos = bodyPos.offset({ dy: END_NOTE_AFTER_BODY_Y_GAP * scale });
    drawSmallText(font, 'Good luck with your battles, trooper!', bodyPos, bodyColor);

    let buttonPos = panelTopLeft.add(new Vec2(END_NOTE_BUTTON_X_OFFSET * scale, END_NOTE_BUTTON_Y_OFFSET * scale));
    const survivalW = buttonWidth(resources, this._survivalButton.label, { scale: scale, forceWide: this._survivalButton.forceWide });
    buttonDraw(resources, this._survivalButton, { pos: buttonPos, width: survivalW, scale: scale });
    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const rushW = buttonWidth(resources, this._rushButton.label, { scale: scale, forceWide: this._rushButton.forceWide });
    buttonDraw(resources, this._rushButton, { pos: buttonPos, width: rushW, scale: scale });
    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const typoW = buttonWidth(resources, this._typoButton.label, { scale: scale, forceWide: this._typoButton.forceWide });
    buttonDraw(resources, this._typoButton, { pos: buttonPos, width: typoW, scale: scale });
    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const mainW = buttonWidth(resources, this._mainMenuButton.label, { scale: scale, forceWide: this._mainMenuButton.forceWide });
    buttonDraw(resources, this._mainMenuButton, { pos: buttonPos, width: mainW, scale: scale });

    drawMenuCursorHelper(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
  }

  takeAction(): string | null {
    const action = this._action;
    this._action = null;
    return action;
  }

  protected _worldEntityAlpha(): number {
    if (!this._closing) {
      return 1.0;
    }
    const span = PANEL_TIMELINE_START_MS - PANEL_TIMELINE_END_MS;
    if (span <= 0) {
      return 0.0;
    }
    const alpha = (this._timelineMs - PANEL_TIMELINE_END_MS) / span;
    if (alpha < 0.0) {
      return 0.0;
    }
    if (alpha > 1.0) {
      return 1.0;
    }
    return alpha;
  }

  protected _beginCloseTransition(action: string, opts: { fadeToBlack?: boolean } = {}): void {
    const fadeToBlack = opts.fadeToBlack ?? false;
    if (this._closing) {
      return;
    }
    if (fadeToBlack) {
      this.state.screenFadeAlpha = 0.0;
      this.state.screenFadeRamp = true;
    }
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._closing = true;
    this._closeAction = action;
  }
}
