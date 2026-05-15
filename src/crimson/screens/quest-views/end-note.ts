// Port of crimson/screens/quest_views/end_note.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { InputState } from '@grim/input.ts';
import { audioPlaySfx, audioUpdate } from '@grim/audio.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { type GroundRenderer } from '@grim/terrain-render.ts';
import { fxDetailEnabled } from '@grim/config.ts';
import { type GameState } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { menuWidescreenYShift } from '@crimson/ui/layout.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { drawMenuCursorHelper, ensureMenuGround, menuGroundCamera } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_START_MS, PANEL_TIMELINE_END_MS } from '@crimson/screens/panels/base.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { END_NOTE_AFTER_BODY_Y_GAP, END_NOTE_BODY_X_OFFSET, END_NOTE_BODY_Y_GAP, END_NOTE_BUTTON_STEP_Y, END_NOTE_BUTTON_X_OFFSET, END_NOTE_BUTTON_Y_OFFSET, END_NOTE_HEADER_X_OFFSET, END_NOTE_HEADER_Y_OFFSET, END_NOTE_LINE_STEP_Y, END_NOTE_PANEL_GEOM_X0, END_NOTE_PANEL_GEOM_Y0, END_NOTE_PANEL_H, END_NOTE_PANEL_POS_X, END_NOTE_PANEL_POS_Y, END_NOTE_PANEL_W } from './shared.ts';

const KEY_ESCAPE = 27;
const MOUSE_BUTTON_LEFT = 0;

const WHITE = wgl.makeColor(1, 1, 1, 1);

// Final quest "Show End Note" flow.
//
// Classic:
//   - quest_results_screen_update uses "Show End Note" instead of "Play Next" for quest 5.10
//   - clicking it transitions to state 0x15 (game_update_victory_screen @ 0x00406350)
export class EndNoteView {
  private state: GameState;
  private _ground: GroundRenderer | null = null;
  private _action: string | null = null;
  private _cursorPulseTime: number = 0.0;
  private _timelineMs: number = 0;
  private _timelineMaxMs: number = PANEL_TIMELINE_START_MS;
  private _closing: boolean = false;
  private _closeAction: string | null = null;

  private _survivalButton: UiButtonState;
  private _rushButton: UiButtonState;
  private _typoButton: UiButtonState;
  private _mainMenuButton: UiButtonState;

  constructor(state: GameState) {
    this.state = state;
    this._survivalButton = new UiButtonState({ label: 'Survival', forceWide: true });
    this._rushButton = new UiButtonState({ label: '  Rush  ', forceWide: true });
    this._typoButton = new UiButtonState({ label: "Typ'o'Shooter", forceWide: true });
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
      audioUpdate(this.state.audio, dt);
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
    if (InputState.wasKeyPressed(KEY_ESCAPE) && enabled) {
      this._beginCloseTransition('back_to_menu');
      return;
    }

    if (!enabled) return;

    const screenW = wgl.getScreenWidth();
    const scale = 1.0;
    const layoutW = scale ? screenW / scale : screenW;
    const widescreenShiftY = menuWidescreenYShift(layoutW);

    const panelTopLeft = new Vec2(
      (END_NOTE_PANEL_GEOM_X0 + END_NOTE_PANEL_POS_X) * scale,
      (END_NOTE_PANEL_GEOM_Y0 + END_NOTE_PANEL_POS_Y + widescreenShiftY) * scale,
    );
    let buttonPos = panelTopLeft.add(new Vec2(
      END_NOTE_BUTTON_X_OFFSET * scale,
      END_NOTE_BUTTON_Y_OFFSET * scale,
    ));

    const resources = requireRuntimeResources(this.state);
    const [mx, my] = InputState.mousePosition();
    const mouse = { x: mx, y: my };
    const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);

    const survivalW = buttonWidth(resources, this._survivalButton.label, { scale, forceWide: this._survivalButton.forceWide });
    if (buttonUpdate(this._survivalButton, { pos: buttonPos, width: survivalW, dtMs, mouse, click })) {
      this.state.config.gameplay.mode = GameMode.SURVIVAL;
      this._beginCloseTransition('start_survival');
      return;
    }

    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const rushW = buttonWidth(resources, this._rushButton.label, { scale, forceWide: this._rushButton.forceWide });
    if (buttonUpdate(this._rushButton, { pos: buttonPos, width: rushW, dtMs, mouse, click })) {
      this.state.config.gameplay.mode = GameMode.RUSH;
      this._beginCloseTransition('start_rush');
      return;
    }

    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const typoW = buttonWidth(resources, this._typoButton.label, { scale, forceWide: this._typoButton.forceWide });
    if (buttonUpdate(this._typoButton, { pos: buttonPos, width: typoW, dtMs, mouse, click })) {
      this.state.config.gameplay.mode = GameMode.TYPO;
      this._beginCloseTransition('start_typo', { fadeToBlack: true });
      return;
    }

    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const mainW = buttonWidth(resources, this._mainMenuButton.label, { scale, forceWide: this._mainMenuButton.forceWide });
    if (buttonUpdate(this._mainMenuButton, { pos: buttonPos, width: mainW, dtMs, mouse, click })) {
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

    const screenW = wgl.getScreenWidth();
    const resources = requireRuntimeResources(this.state);
    const scale = 1.0;
    const layoutW = scale ? screenW / scale : screenW;
    const widescreenShiftY = menuWidescreenYShift(layoutW);

    const panelTopLeft = new Vec2(
      (END_NOTE_PANEL_GEOM_X0 + END_NOTE_PANEL_POS_X) * scale,
      (END_NOTE_PANEL_GEOM_Y0 + END_NOTE_PANEL_POS_Y + widescreenShiftY) * scale,
    );

    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const panelTex = getTexture(resources, TextureId.UI_MENU_PANEL);
    drawClassicMenuPanel(
      panelTex,
      { dst: wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, END_NOTE_PANEL_W * scale, END_NOTE_PANEL_H * scale),
      tint: WHITE, shadow: fxDetail },
    );

    const font = resources.smallFont;
    const hardcore = this.state.config.gameplay.hardcore;
    const header = hardcore ? '   Incredible!' : 'Congratulations!';
    const levelsLine = this.state.preserveBugs
      ? "You've completed all the levels but the battle"
      : "You've completed all the levels, but the battle";

    const bodyLines = hardcore
      ? [
          "You've done the thing we all thought was",
          'virtually impossible. To reward your',
          'efforts a new weapon has been unlocked ',
          'for you: Splitter Gun.',
          '',
          '',
        ]
      : [
          levelsLine,
          "isn't over yet! With all of the unlocked perks",
          'and weapons your Survival is just a bit easier.',
          'You can also replay the quests in Hardcore.',
          'As an additional reward for your victorious',
          'playing, a completely new and different game',
          "mode is unlocked for you: Typ'o'Shooter.",
        ];

    const headerPos = panelTopLeft.add(new Vec2(
      END_NOTE_HEADER_X_OFFSET * scale,
      END_NOTE_HEADER_Y_OFFSET * scale,
    ));
    const headerColor = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.8) / 255);
    const bodyColor = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.5) / 255);

    drawSmallText(font, header, headerPos, headerColor);

    let bodyPos = new Vec2(
      panelTopLeft.x + END_NOTE_BODY_X_OFFSET * scale,
      headerPos.y + END_NOTE_BODY_Y_GAP * scale,
    );
    for (let idx = 0; idx < bodyLines.length; idx++) {
      drawSmallText(font, bodyLines[idx], bodyPos, bodyColor);
      if (idx !== bodyLines.length - 1) {
        bodyPos = bodyPos.offset({ dy: END_NOTE_LINE_STEP_Y * scale });
      }
    }
    bodyPos = bodyPos.offset({ dy: END_NOTE_AFTER_BODY_Y_GAP * scale });
    drawSmallText(font, 'Good luck with your battles, trooper!', bodyPos, bodyColor);

    let buttonPos = panelTopLeft.add(new Vec2(
      END_NOTE_BUTTON_X_OFFSET * scale,
      END_NOTE_BUTTON_Y_OFFSET * scale,
    ));
    const survivalW = buttonWidth(resources, this._survivalButton.label, { scale, forceWide: this._survivalButton.forceWide });
    buttonDraw(resources, this._survivalButton, { pos: buttonPos, width: survivalW, scale });
    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const rushW = buttonWidth(resources, this._rushButton.label, { scale, forceWide: this._rushButton.forceWide });
    buttonDraw(resources, this._rushButton, { pos: buttonPos, width: rushW, scale });
    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const typoW = buttonWidth(resources, this._typoButton.label, { scale, forceWide: this._typoButton.forceWide });
    buttonDraw(resources, this._typoButton, { pos: buttonPos, width: typoW, scale });
    buttonPos = buttonPos.offset({ dy: END_NOTE_BUTTON_STEP_Y * scale });
    const mainW = buttonWidth(resources, this._mainMenuButton.label, { scale, forceWide: this._mainMenuButton.forceWide });
    buttonDraw(resources, this._mainMenuButton, { pos: buttonPos, width: mainW, scale });

    drawMenuCursorHelper(this.state, { resources, pulseTime: this._cursorPulseTime });
  }

  takeAction(): string | null {
    const action = this._action;
    this._action = null;
    return action;
  }

  private _worldEntityAlpha(): number {
    if (!this._closing) return 1.0;
    const span = PANEL_TIMELINE_START_MS - PANEL_TIMELINE_END_MS;
    if (span <= 0) return 0.0;
    let alpha = (this._timelineMs - PANEL_TIMELINE_END_MS) / span;
    if (alpha < 0.0) return 0.0;
    if (alpha > 1.0) return 1.0;
    return alpha;
  }

  private _beginCloseTransition(action: string, opts: { fadeToBlack?: boolean } = {}): void {
    const fadeToBlack = opts.fadeToBlack ?? false;
    if (this._closing) return;
    if (fadeToBlack) {
      this.state.screenFadeAlpha = 0.0;
      this.state.screenFadeRamp = true;
    }
    if (this.state.audio !== null) {
      audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._closing = true;
    this._closeAction = action;
  }
}
