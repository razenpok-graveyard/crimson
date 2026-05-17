// Port of crimson/screens/quest_views/quest_failed.py

import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
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
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { QUEST_FAILED_BANNER_H, QUEST_FAILED_BANNER_W, QUEST_FAILED_BANNER_X_OFFSET, QUEST_FAILED_BANNER_Y_OFFSET, QUEST_FAILED_BUTTON_STEP_Y, QUEST_FAILED_BUTTON_X_OFFSET, QUEST_FAILED_BUTTON_Y_OFFSET, QUEST_FAILED_MESSAGE_X_OFFSET, QUEST_FAILED_MESSAGE_Y_OFFSET, QUEST_FAILED_PANEL_GEOM_X0, QUEST_FAILED_PANEL_GEOM_Y0, QUEST_FAILED_PANEL_H, QUEST_FAILED_PANEL_POS_X, QUEST_FAILED_PANEL_POS_Y, QUEST_FAILED_PANEL_SLIDE_DURATION_MS, QUEST_FAILED_PANEL_W, QUEST_FAILED_SCORE_X_OFFSET, QUEST_FAILED_SCORE_Y_OFFSET, playerNameDefault } from '@crimson/screens/quest-views/shared.ts';
import type { QuestRunOutcome } from '@crimson/modes/quest-mode.ts';
import { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { questByLevel } from '@crimson/quests/index.ts';
import * as wgl from '@wgl';
export { QUEST_FAILED_PANEL_SLIDE_DURATION_MS, QUEST_FAILED_PANEL_W } from '@crimson/screens/quest-views/shared.ts';

export class QuestFailedView {
  state: GameState;
  protected _ground: GroundRenderer | null;
  protected _outcome: QuestRunOutcome | null;
  protected _record: HighScoreRecord | null;
  protected _questTitle: string;
  protected _action: string | null;
  protected _cursorPulseTime: number;
  protected _introMs: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _retryButton: UiButtonState;
  protected _questListButton: UiButtonState;
  protected _mainMenuButton: UiButtonState;

  constructor(state: GameState) {
    this.state = state;
    this._ground = null;
    this._outcome = null;
    this._record = null;
    this._questTitle = '';
    this._action = null;
    this._cursorPulseTime = 0.0;
    this._introMs = 0.0;
    this._closing = false;
    this._closeAction = null;
    this._retryButton = new UiButtonState({ label: 'Play Again', forceWide: true });
    this._questListButton = new UiButtonState({ label: 'Play Another', forceWide: true });
    this._mainMenuButton = new UiButtonState({ label: 'Main Menu', forceWide: true });
  }

  open(): void {
    this._action = null;
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this._cursorPulseTime = 0.0;
    this._introMs = 0.0;
    this._closing = false;
    this._closeAction = null;
    this._outcome = this.state.questOutcome;
    this.state.questOutcome = null;
    this._questTitle = '';
    this._record = null;
    this._retryButton = new UiButtonState({ label: 'Play Again', forceWide: true });
    this._questListButton = new UiButtonState({ label: 'Play Another', forceWide: true });
    this._mainMenuButton = new UiButtonState({ label: 'Main Menu', forceWide: true });
    const outcome = this._outcome;
    if (outcome !== null) {

      const quest = questByLevel(outcome.level);
      this._questTitle = quest !== null ? quest.title : '';
    }

    this._buildScorePreview(outcome);
  }

  close(): void {
    this._ground = null;
    this._outcome = null;
    this._record = null;
    this._questTitle = '';
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
    const dtMs = dtStep * 1000.0;
    if (this._closing) {
      this._introMs = Math.max(0.0, this._introMs - dtMs);
      if (this._introMs <= 1e-3 && this._closeAction !== null) {
        this._action = this._closeAction;
        this._closeAction = null;
      }
      return;
    }
    this._introMs = Math.min(QUEST_FAILED_PANEL_SLIDE_DURATION_MS, this._introMs + dtMs);

    const outcome = this._outcome;
    if (InputState.wasKeyPressed(27)) {
      this._activateMainMenu();
      return;
    }
    if (outcome !== null && InputState.wasKeyPressed(13)) {
      this._activateRetry();
      return;
    }
    if (InputState.wasKeyPressed(81)) {
      this._activatePlayAnother();
      return;
    }

    const panelTopLeft = this._panelTopLeft();
    if (outcome === null) {
      return;
    }
    const scale = 1.0;

    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
    const resources = requireRuntimeResources(this.state);
    let buttonPos = panelTopLeft.add(new Vec2(QUEST_FAILED_BUTTON_X_OFFSET * scale, QUEST_FAILED_BUTTON_Y_OFFSET * scale));

    const retryW = buttonWidth(resources, this._retryButton.label, { scale: scale, forceWide: this._retryButton.forceWide });
    if (buttonUpdate(this._retryButton, { pos: buttonPos, width: retryW, dtMs: dtMs, mouse: mouse, click: click })) {
      this._activateRetry();
      return;
    }
    buttonPos = buttonPos.offset({ dy: QUEST_FAILED_BUTTON_STEP_Y * scale });

    const playAnotherW = buttonWidth(resources, this._questListButton.label, { scale: scale, forceWide: this._questListButton.forceWide });
    if (buttonUpdate(this._questListButton, { pos: buttonPos, width: playAnotherW, dtMs: dtMs, mouse: mouse, click: click })) {
      this._activatePlayAnother();
      return;
    }
    buttonPos = buttonPos.offset({ dy: QUEST_FAILED_BUTTON_STEP_Y * scale });

    const mainMenuW = buttonWidth(resources, this._mainMenuButton.label, { scale: scale, forceWide: this._mainMenuButton.forceWide });
    if (buttonUpdate(this._mainMenuButton, { pos: buttonPos, width: mainMenuW, dtMs: dtMs, mouse: mouse, click: click })) {
      this._activateMainMenu();
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

    const panelTopLeft = this._panelTopLeft();
    const resources = requireRuntimeResources(this.state);
    const panelTex = resources.texture(TextureId.UI_MENU_PANEL);
    const panel = wgl.makeRectangle(panelTopLeft.x, panelTopLeft.y, QUEST_FAILED_PANEL_W, QUEST_FAILED_PANEL_H);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(panelTex, { dst: panel, tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail });

    const reaperTex = resources.texture(TextureId.UI_TEXT_REAPER);
    const src = wgl.makeRectangle(0.0, 0.0, reaperTex.width, reaperTex.height);
    const bannerPos = panelTopLeft.add(new Vec2(QUEST_FAILED_BANNER_X_OFFSET, QUEST_FAILED_BANNER_Y_OFFSET));
    const dst = wgl.makeRectangle(bannerPos.x, bannerPos.y, QUEST_FAILED_BANNER_W, QUEST_FAILED_BANNER_H);
    wgl.drawTexturePro(reaperTex, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    const font = resources.smallFont;
    const textColor = wgl.makeColor(235 / 255, 235 / 255, 235 / 255, 255 / 255);
    drawSmallText(font, this._failureMessage(), panelTopLeft.add(new Vec2(QUEST_FAILED_MESSAGE_X_OFFSET, QUEST_FAILED_MESSAGE_Y_OFFSET)), textColor);
    this._drawScorePreview(font, { panelTopLeft: panelTopLeft });

    const scale = 1.0;
    let buttonPos = panelTopLeft.add(new Vec2(QUEST_FAILED_BUTTON_X_OFFSET, QUEST_FAILED_BUTTON_Y_OFFSET));

    const retryW = buttonWidth(resources, this._retryButton.label, { scale: scale, forceWide: this._retryButton.forceWide });
    buttonDraw(resources, this._retryButton, { pos: buttonPos, width: retryW, scale: scale });
    buttonPos = buttonPos.offset({ dy: QUEST_FAILED_BUTTON_STEP_Y });

    const playAnotherW = buttonWidth(resources, this._questListButton.label, { scale: scale, forceWide: this._questListButton.forceWide });
    buttonDraw(
      resources,
      this._questListButton,
      { pos: buttonPos, width: playAnotherW, scale: scale },
    );
    buttonPos = buttonPos.offset({ dy: QUEST_FAILED_BUTTON_STEP_Y });

    const mainMenuW = buttonWidth(resources, this._mainMenuButton.label, { scale: scale, forceWide: this._mainMenuButton.forceWide });
    buttonDraw(
      resources,
      this._mainMenuButton,
      { pos: buttonPos, width: mainMenuW, scale: scale },
    );

    drawMenuCursorHelper(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
  }

  takeAction(): string | null {
    const action = this._action;
    this._action = null;
    return action;
  }

  protected _panelOrigin(): Vec2 {
    const screenW = wgl.getScreenWidth();
    const widescreenShiftY = MenuView._menuWidescreenYShift(screenW);
    return new Vec2(QUEST_FAILED_PANEL_GEOM_X0 + QUEST_FAILED_PANEL_POS_X, QUEST_FAILED_PANEL_GEOM_Y0 + QUEST_FAILED_PANEL_POS_Y + widescreenShiftY);
  }

  protected _panelSlideX(): number {
    if (QUEST_FAILED_PANEL_SLIDE_DURATION_MS <= 1e-6) {
      return 0.0;
    }
    let t = this._introMs / QUEST_FAILED_PANEL_SLIDE_DURATION_MS;
    if (t < 0.0) {
      t = 0.0;
    } else if (t > 1.0) {
      t = 1.0;
    }
    const eased = 1.0 - (1.0 - t) ** 3;
    return -QUEST_FAILED_PANEL_W * (1.0 - eased);
  }

  protected _worldEntityAlpha(): number {
    if (!this._closing) {
      return 1.0;
    }
    if (QUEST_FAILED_PANEL_SLIDE_DURATION_MS <= 1e-6) {
      return 0.0;
    }
    const alpha = this._introMs / QUEST_FAILED_PANEL_SLIDE_DURATION_MS;
    if (alpha < 0.0) {
      return 0.0;
    }
    if (alpha > 1.0) {
      return 1.0;
    }
    return alpha;
  }

  protected _panelTopLeft(): Vec2 {
    return this._panelOrigin().offset({ dx: this._panelSlideX() });
  }

  protected _failureMessage(): string {
    const retryCount = int(this.state.questFailRetryCount);
    if (retryCount === 1) {
      return 'You didn\'t make it, do try again.';
    }
    if (retryCount === 2) {
      return 'Third time no good.';
    }
    if (retryCount === 3) {
      return 'No luck this time, have another go?';
    }
    if (retryCount === 4) {
      if (this.state.preserveBugs) {
        return 'Persistence will be rewared.';
      }
      return 'Persistence will be rewarded.';
    }
    if (retryCount === 5) {
      return 'Try one more time?';
    }
    return 'Quest failed, try again.';
  }

  protected _buildScorePreview(outcome: QuestRunOutcome | null): void {

    this._record = null;
    if (outcome === null) {
      return;
    }

    const level = outcome.level;
    const [major, minor] = [level.major, level.minor];

    const record = HighScoreRecord.blank();
    record.setName(playerNameDefault(this.state.config) || 'Player');
    record.gameModeId = GameMode.QUESTS;
    record.questStageMajor = major;
    record.questStageMinor = minor;
    record.survivalElapsedMs = Math.max(1, int(outcome.baseTimeMs));
    record.scoreXp = int(outcome.experience);
    record.creatureKillCount = int(outcome.killCount);
    record.mostUsedWeaponId = outcome.mostUsedWeaponId;
    const fired = Math.max(0, int(outcome.shotsFired));
    const hit = Math.max(0, Math.min(int(outcome.shotsHit), fired));
    record.shotsFired = fired;
    record.shotsHit = hit;

    this._record = record;
  }

  protected _activateRetry(): void {
    const outcome = this._outcome;
    if (outcome === null) {
      return;
    }
    this.state.questFailRetryCount = int(this.state.questFailRetryCount) + 1;
    const level = outcome.level;
    this.state.pendingQuestLevel = level;
    this.state.config.gameplay.mode = GameMode.QUESTS;
    this.state.config.gameplay.questLevel = level;
    try {
      this.state.config.save();
    } catch (exc) {
      this.state.console.log.log(`quest failed: failed to save quest selection config: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._beginClose('start_quest');
  }

  protected _activatePlayAnother(): void {
    this.state.questFailRetryCount = 0;
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._beginClose('open_quests');
  }

  protected _activateMainMenu(): void {
    this.state.questFailRetryCount = 0;
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._beginClose('back_to_menu');
  }

  protected _beginClose(action: string): void {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  protected _textWidth(text: string, scale: number): number {
    return measureSmallTextWidth(requireRuntimeResources(this.state).smallFont, text);
  }

  protected _drawScorePreview(font: SmallFontData, opts: { panelTopLeft: Vec2 }): void {
    const panelTopLeft = opts.panelTopLeft;
    const record = this._record;
    if (record === null) {
      return;
    }

    const scorePos = panelTopLeft.add(new Vec2(QUEST_FAILED_SCORE_X_OFFSET, QUEST_FAILED_SCORE_Y_OFFSET));

    const labelColor = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, int(255 * 0.8) / 255);
    const valueColor = wgl.makeColor(230 / 255, 230 / 255, 255 / 255, 255 / 255);
    // `ui_text_input_render`: data_4965f8/5fc/600 = (149,175,198)/255.
    const separatorColor = wgl.makeColor(149 / 255, 175 / 255, 198 / 255, int(255 * 0.7) / 255);

    const scoreLabel = 'Score';
    const scoreLabelW = this._textWidth(scoreLabel, 1.0);
    drawSmallText(font, scoreLabel, scorePos.offset({ dx: 32.0 - scoreLabelW * 0.5 }), labelColor);

    const scoreValue = `${(int(record.survivalElapsedMs) * 0.001).toFixed(2)} secs`;
    const scoreValueW = this._textWidth(scoreValue, 1.0);
    drawSmallText(font, scoreValue, scorePos.add(new Vec2(32.0 - scoreValueW * 0.5, 15.0)), valueColor);

    const sepPos = scorePos.offset({ dx: 80.0 });
    wgl.drawLine(int(sepPos.x), int(sepPos.y), int(sepPos.x), int(sepPos.y + 48.0), separatorColor);

    const col2Pos = scorePos.offset({ dx: 96.0 });
    drawSmallText(font, 'Experience', col2Pos, valueColor);
    const xpValue = `${int(record.scoreXp)}`;
    const xpW = this._textWidth(xpValue, 1.0);
    drawSmallText(font, xpValue, col2Pos.add(new Vec2(32.0 - xpW * 0.5, 15.0)), labelColor);

    // `FUN_004411c0`: horizontal 192px separator at x-16 after the score row.
    const linePos = scorePos.add(new Vec2(-16.0, 52.0));
    wgl.drawRectangle(int(linePos.x), int(linePos.y), int(192.0), int(1.0), separatorColor);
  }
}
