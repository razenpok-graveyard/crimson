// Port of crimson/screens/high_scores_view/view.py

import { InputState } from '@grim/input.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { type RuntimeResources, TextureId, getTexture } from '@grim/assets.ts';
import { audioPlaySfx, audioUpdate } from '@grim/audio.ts';
import { fxDetailEnabled, savedNameLabels } from '@grim/config.ts';
import { measureSmallTextWidth, SmallFontData } from "@grim/fonts/small.ts";
import { Vec2, Rect } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { type GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState, HighScoresRequest } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import type { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { DropdownLayoutBase, menuWidescreenYShift } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { HS_LEFT_PANEL_POS_Y, HS_LEFT_PANEL_HEIGHT, HS_RIGHT_PANEL_POS_Y, HS_RIGHT_PANEL_HEIGHT, HS_BACK_BUTTON_X, HS_BACK_BUTTON_Y, HS_BUTTON_STEP_Y, HS_BUTTON_X, HS_BUTTON_Y0, HS_QUEST_ARROW_X, HS_QUEST_ARROW_Y, HS_RIGHT_CHECK_X, HS_RIGHT_CHECK_Y, HS_RIGHT_GAME_MODE_WIDGET_W, HS_RIGHT_GAME_MODE_WIDGET_X, HS_RIGHT_GAME_MODE_WIDGET_Y, HS_RIGHT_PLAYER_COUNT_WIDGET_W, HS_RIGHT_PLAYER_COUNT_WIDGET_X, HS_RIGHT_PLAYER_COUNT_WIDGET_Y, HS_RIGHT_SCORE_LIST_WIDGET_W, HS_RIGHT_SCORE_LIST_WIDGET_X, HS_RIGHT_SCORE_LIST_WIDGET_Y, HS_RIGHT_SHOW_SCORES_WIDGET_W, HS_RIGHT_SHOW_SCORES_WIDGET_X, HS_RIGHT_SHOW_SCORES_WIDGET_Y, hsLeftPanelPosX, hsRightPanelPosX, hsRightOptionsXShift } from '@crimson/screens/high-scores-layout.ts';
import { MENU_PANEL_WIDTH, MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_WIDTH, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, ensureMenuGround, menuGroundCamera, signLayoutScale, uiElementAnim } from '@crimson/screens/menu.ts';
import { FADE_TO_GAME_ACTIONS, PANEL_TIMELINE_START_MS, PANEL_TIMELINE_END_MS } from '@crimson/screens/panels/base.ts';
import { mouseInsideRectWithPadding } from '@crimson/screens/panels/hit-test.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { drawMainPanel } from './main-panel.ts';
import { resolveRequest, loadRecords } from './records.ts';
import { drawRightPanel } from './right-panel.ts';

const WHITE = wgl.makeColor(1, 1, 1, 1);
const ORIGIN = wgl.makeVector2(0, 0);

const KEY_ESCAPE = 27;
const KEY_UP = 38;
const KEY_DOWN = 40;
const KEY_PAGE_UP = 33;
const KEY_PAGE_DOWN = 34;
const KEY_HOME = 36;
const KEY_END = 35;
const MOUSE_BUTTON_LEFT = 0;

class ScoresDropdownLayout extends DropdownLayoutBase {
}

function gameModeFromId(modeRaw: number): GameMode {
  switch (int(modeRaw)) {
    case GameMode.DEMO:
      return GameMode.DEMO;
    case GameMode.SURVIVAL:
      return GameMode.SURVIVAL;
    case GameMode.RUSH:
      return GameMode.RUSH;
    case GameMode.QUESTS:
      return GameMode.QUESTS;
    case GameMode.TYPO:
      return GameMode.TYPO;
    case GameMode.TUTORIAL:
      return GameMode.TUTORIAL;
    default:
      return GameMode.DEMO;
  }
}

export class HighScoresView {
  state: GameState;

  private _isOpen: boolean = false;
  private _ground: GroundRenderer | null = null;
  private _action: string | null = null;
  private _cursorPulseTime: number = 0.0;
  private _widescreenYShift: number = 0.0;
  _timelineMs: number = 0;
  private _timelineMaxMs: number = PANEL_TIMELINE_START_MS;
  private _closing: boolean = false;
  private _closeAction: string | null = null;
  private _dirty: boolean = false;

  updateButton: UiButtonState;
  playButton: UiButtonState;
  backButton: UiButtonState;

  private _request: HighScoresRequest | null = null;
  private _records: HighScoreRecord[] = [];
  private _scrollIndex: number = 0;

  // Right-panel list widget state (quests variant).
  playerCountOpen: boolean = false;
  gameModeOpen: boolean = false;
  showScoresOpen: boolean = false;
  scoreListOpen: boolean = false;

  constructor(state: GameState) {
    this.state = state;
    this.updateButton = new UiButtonState({ label: 'Update scores', forceWide: true  });
    this.playButton = new UiButtonState({ label: 'Play a game', forceWide: true  });
    this.backButton = new UiButtonState({ label: 'Back', forceWide: false  });
  }

  get records(): HighScoreRecord[] {
    return this._records;
  }

  get scrollIndex(): number {
    return this._scrollIndex;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._widescreenYShift = menuWidescreenYShift(layoutW);
    this._action = null;
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._scrollIndex = 0;
    this._dirty = false;
    this.updateButton = new UiButtonState({ label: 'Update scores', forceWide: true  });
    this.playButton = new UiButtonState({ label: 'Play a game', forceWide: true  });
    this.backButton = new UiButtonState({ label: 'Back', forceWide: false  });

    this.playerCountOpen = false;
    this.gameModeOpen = false;
    this.showScoresOpen = false;
    this.scoreListOpen = false;

    const request = resolveRequest(this.state);
    this._request = request;
    this._records = loadRecords(this.state, request);
    if (this.state.audio !== null) {
      audioPlaySfx(this.state.audio, SfxId.UI_PANELCLICK);
    }
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this._request = null;
    this._records = [];
    this._scrollIndex = 0;
    this._dirty = false;
    this.playerCountOpen = false;
    this.gameModeOpen = false;
    this.showScoresOpen = false;
    this.scoreListOpen = false;
    this._closing = false;
    this._closeAction = null;
  }

  private _panelTopLeft(opts: { pos: Vec2; scale: number }): Vec2 {
    return new Vec2(
      opts.pos.x + MENU_PANEL_OFFSET_X * opts.scale,
      opts.pos.y + this._widescreenYShift + MENU_PANEL_OFFSET_Y * opts.scale,
    );
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
    const scale = 1.0;

    if (InputState.wasKeyPressed(KEY_ESCAPE) && enabled) {
      this._beginCloseTransition('back_to_previous');
      return;
    }

    const screenWidth = this.state.config.display.width;
    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;

    // Compute animated panel positions so hit-tests match the draw path even while sliding.
    const panelW = MENU_PANEL_WIDTH * scale;
    const [, leftSlideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 0,
    });
    const [, rightSlideX] = uiElementAnim(this, {
      index: 2,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 1,
    });
    const leftPanelPosX = hsLeftPanelPosX(screenWidth);
    const leftTopLeft = this._panelTopLeft({ pos: new Vec2(leftPanelPosX, HS_LEFT_PANEL_POS_Y), scale });
    const rightPanelPosX = hsRightPanelPosX(screenWidth);
    const rightTopLeft = this._panelTopLeft({ pos: new Vec2(rightPanelPosX, HS_RIGHT_PANEL_POS_Y), scale });
    const leftPanelTopLeft = leftTopLeft.offset({ dx: leftSlideX });
    const rightPanelTopLeft = rightTopLeft.offset({ dx: rightSlideX });

    if (enabled) {
      if (this._updateRightPanelWidgets({
        rightTopLeft: rightPanelTopLeft,
        scale,
        resources,
        font,
      })) {
        return;
      }
      if (this._updateQuestArrows({
        leftPanelTopLeft,
        scale,
        resources,
      })) {
        return;
      }
    }

    if (enabled) {
      const buttonBasePos = leftPanelTopLeft.add(new Vec2(HS_BUTTON_X * scale, HS_BUTTON_Y0 * scale));
      const [mx, my] = InputState.mousePosition();
      const mouse = { x: mx, y: my };
      const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);

      let w = buttonWidth(resources, this.updateButton.label, { scale, forceWide: this.updateButton.forceWide });
      if (buttonUpdate(this.updateButton, { pos: buttonBasePos, width: w, dtMs, mouse, click })) {
        // Reload scores from disk (no view transition).
        if (this.state.audio !== null) {
          audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
        }
        this.open();
        return;
      }

      w = buttonWidth(resources, this.playButton.label, { scale, forceWide: this.playButton.forceWide });
      if (buttonUpdate(this.playButton, { pos: buttonBasePos.offset({ dx: 0.0, dy: HS_BUTTON_STEP_Y * scale }), width: w, dtMs, mouse, click })) {
        this._beginCloseTransition('open_play_game');
        return;
      }

      const backW = buttonWidth(resources, this.backButton.label, { scale, forceWide: this.backButton.forceWide });
      if (buttonUpdate(this.backButton, {
        pos: leftPanelTopLeft.add(new Vec2(HS_BACK_BUTTON_X * scale, HS_BACK_BUTTON_Y * scale)),
        width: backW,
        dtMs,
        mouse,
        click,
      })) {
        this._beginCloseTransition('back_to_previous');
        return;
      }
    }

    const rows = 10;
    const maxScroll = Math.max(0, this._records.length - rows);

    if (enabled) {
      const wheel = InputState.mouseWheelDelta();
      if (wheel) {
        this._scrollIndex = Math.max(0, Math.min(maxScroll, this._scrollIndex - wheel));
      }

      if (InputState.wasKeyPressed(KEY_UP)) {
        this._scrollIndex = Math.max(0, this._scrollIndex - 1);
      }
      if (InputState.wasKeyPressed(KEY_DOWN)) {
        this._scrollIndex = Math.min(maxScroll, this._scrollIndex + 1);
      }
      if (InputState.wasKeyPressed(KEY_PAGE_UP)) {
        this._scrollIndex = Math.max(0, this._scrollIndex - rows);
      }
      if (InputState.wasKeyPressed(KEY_PAGE_DOWN)) {
        this._scrollIndex = Math.min(maxScroll, this._scrollIndex + rows);
      }
      if (InputState.wasKeyPressed(KEY_HOME)) {
        this._scrollIndex = 0;
      }
      if (InputState.wasKeyPressed(KEY_END)) {
        this._scrollIndex = maxScroll;
      }
    }
  }

  private _beginCloseTransition(action: string): void {
    if (this._dirty) {
      try {
        this.state.config.save();
        this._dirty = false;
      } catch (exc) {
        this.state.console.log.log(`config: save failed: ${exc}`);
      }
    }
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

  private _dropdownLayout(opts: { pos: Vec2; width: number; itemCount: number; scale: number }): ScoresDropdownLayout {
    const headerH = 16.0 * opts.scale;
    const rowH = 16.0 * opts.scale;
    const fullH = (opts.itemCount * 16.0 + 24.0) * opts.scale;
    return new ScoresDropdownLayout({
      pos: opts.pos,
      width: opts.width,
      headerH,
      rowH,
      rowsY0: opts.pos.y + 17.0 * opts.scale,
      fullH,
    });
  }

  private _updateDropdown(
    opts: {
      layout: ScoresDropdownLayout;
      itemCount: number;
      isOpen: boolean;
      enabled: boolean;
      scale: number;
    },
  ): [boolean, number | null, boolean] {
    const { layout, itemCount, isOpen, enabled, scale } = opts;
    const [mx, my] = InputState.mousePosition();
    const mouse = { x: mx, y: my };
    const click = enabled && InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
    const hoveredHeader = enabled && mouseInsideRectWithPadding(
      mouse, { pos: layout.pos, width: layout.width, height: 14.0 * scale },
    );
    if (hoveredHeader && click) {
      return [!isOpen, null, true];
    }
    if (!isOpen) {
      return [isOpen, null, false];
    }

    const listRect = Rect.fromTopLeft(layout.pos, layout.width, layout.fullH);
    const listHovered = listRect.contains(mouse);
    if (click && !listHovered) {
      return [false, null, true];
    }

    for (let idx = 0; idx < itemCount; idx++) {
      const itemY = layout.rowsY0 + layout.rowH * idx;
      const hovered = enabled && mouseInsideRectWithPadding(
        mouse, { pos: new Vec2(layout.pos.x, itemY), width: layout.width, height: 14.0 * scale },
      );
      if (hovered && click) {
        return [false, idx, true];
      }
    }

    return [isOpen, null, false];
  }

  private _reloadRecords(): void {
    const request = this._request;
    if (request === null) return;
    this._records = loadRecords(this.state, request);
    const rows = 10;
    this._scrollIndex = Math.max(0, Math.min(this._scrollIndex, Math.max(0, this._records.length - rows)));
  }

  private _updateRightPanelWidgets(
    opts: {
      rightTopLeft: Vec2;
      scale: number;
      resources: RuntimeResources;
      font: SmallFontData;
    },
  ): boolean {
    const { rightTopLeft, scale, resources, font } = opts;
    const request = this._request;
    if (request === null) return false;

    const dropdownBlocked = this.playerCountOpen || this.gameModeOpen || this.showScoresOpen || this.scoreListOpen;
    const smallWidthShiftX = hsRightOptionsXShift(this.state.config.display.width);
    const shiftedRightTopLeft = rightTopLeft.add(new Vec2(smallWidthShiftX * scale, 0.0));

    // Widgets are only shown in the "options" right panel (not the local-score detail panel).
    // We don't explicitly track which right panel is active; hit tests are enough.

    // Checkbox: "Show internet scores" (config.score_load_gate).
    if (!dropdownBlocked) {
      const checkTex = this.state.config.profile.showInternetScores
        ? getTexture(resources, TextureId.UI_CHECK_ON)
        : getTexture(resources, TextureId.UI_CHECK_OFF);
      const label = 'Show internet scores';
      const checkPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_CHECK_X * scale, HS_RIGHT_CHECK_Y * scale));
      const labelW = measureSmallTextWidth(font, label);
      const fontH = font.cellSize * scale;
      const rectW = checkTex.width * scale + 6.0 * scale + labelW;
      const rectH = Math.max(checkTex.height * scale, fontH);
      const [mx, my] = InputState.mousePosition();
      const mousePos = { x: mx, y: my };
      const checkRect = Rect.fromTopLeft(checkPos, rectW, rectH);
      if (checkRect.contains(mousePos)) {
        if (InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
          this.state.config.profile.showInternetScores = !this.state.config.profile.showInternetScores;
          this._dirty = true;
          this._reloadRecords();
          return true;
        }
      }
    }

    // Dropdown: show scores date filter (config.highscore_date_mode).
    const showScoresItems = ['Best of all time', 'Best of month', 'Best of week', 'Best of day'];
    const showScoresPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_SHOW_SCORES_WIDGET_X * scale, HS_RIGHT_SHOW_SCORES_WIDGET_Y * scale));
    const showScoresLayout = this._dropdownLayout({ pos: showScoresPos, width: HS_RIGHT_SHOW_SCORES_WIDGET_W * scale, itemCount: showScoresItems.length, scale });
    const showScoresEnabled = !(this.playerCountOpen || this.gameModeOpen || this.scoreListOpen);
    let consumed: boolean;
    let selected: number | null;
    [this.showScoresOpen, selected, consumed] = this._updateDropdown({
      layout: showScoresLayout,
      itemCount: showScoresItems.length,
      isOpen: this.showScoresOpen,
      enabled: showScoresEnabled,
      scale,
    });
    if (selected !== null) {
      this.state.config.profile.scoreDateMode = int(selected);
      this._dirty = true;
      this._reloadRecords();
    }
    if (consumed) {
      if (this.showScoresOpen) {
        this.playerCountOpen = false;
        this.gameModeOpen = false;
        this.scoreListOpen = false;
      }
      return true;
    }

    // Dropdown: player count (config.player_count).
    const playerItems = ['1 player', '2 players', '3 players', '4 players'];
    const playerPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_PLAYER_COUNT_WIDGET_X * scale, HS_RIGHT_PLAYER_COUNT_WIDGET_Y * scale));
    const playerLayout = this._dropdownLayout({ pos: playerPos, width: HS_RIGHT_PLAYER_COUNT_WIDGET_W * scale, itemCount: playerItems.length, scale });
    const playerEnabled = !(this.gameModeOpen || this.showScoresOpen || this.scoreListOpen);
    [this.playerCountOpen, selected, consumed] = this._updateDropdown({
      layout: playerLayout,
      itemCount: playerItems.length,
      isOpen: this.playerCountOpen,
      enabled: playerEnabled,
      scale,
    });
    if (selected !== null) {
      const newCount = selected + 1;
      if (this.state.config.gameplay.playerCount !== newCount) {
        this.state.config.gameplay.playerCount = newCount;
        this._dirty = true;
        this._reloadRecords();
      }
    }
    if (consumed) {
      if (this.playerCountOpen) {
        this.gameModeOpen = false;
        this.showScoresOpen = false;
        this.scoreListOpen = false;
      }
      return true;
    }

    // Dropdown: game mode (config.game_mode / request.game_mode_id).
    // Typ-o shooter entry is unlocked at quest_unlock_index>=40 in the native.
    const modeItems: [string, GameMode][] = [
      ['Quests', GameMode.QUESTS],
      ['Rush', GameMode.RUSH],
      ['Survival', GameMode.SURVIVAL],
    ];
    if (int(this.state.status.questUnlockIndex) >= 0x28) {
      modeItems.push(["Typ'o'Shooter", GameMode.TYPO]);
    }
    const gameModePos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_GAME_MODE_WIDGET_X * scale, HS_RIGHT_GAME_MODE_WIDGET_Y * scale));
    const gameModeLayout = this._dropdownLayout({ pos: gameModePos, width: HS_RIGHT_GAME_MODE_WIDGET_W * scale, itemCount: modeItems.length, scale });
    const gameModeEnabled = !(this.playerCountOpen || this.showScoresOpen || this.scoreListOpen);
    [this.gameModeOpen, selected, consumed] = this._updateDropdown({
      layout: gameModeLayout,
      itemCount: modeItems.length,
      isOpen: this.gameModeOpen,
      enabled: gameModeEnabled,
      scale,
    });
    if (selected !== null) {
      const [, modeId] = modeItems[Math.max(0, Math.min(selected, modeItems.length - 1))];
      this.state.config.gameplay.mode = modeId;
      request.gameModeId = modeId;
      if (modeId === GameMode.TYPO) {
        // Native forces Typ-o shooter scores to 1 player.
        this.state.config.gameplay.playerCount = 1;
      } else if (modeId === GameMode.QUESTS) {
        // Ensure quest selection exists when switching into quests.
        if (request.questLevel === null) {
          request.questLevel = this.state.config.gameplay.questLevel ?? new QuestLevel({ major: 1, minor: 1 });
        }
      }
      this._dirty = true;
      this._reloadRecords();
    }
    if (consumed) {
      if (this.gameModeOpen) {
        this.playerCountOpen = false;
        this.showScoresOpen = false;
        this.scoreListOpen = false;
      }
      return true;
    }

    // Dropdown: selected score list (profile slots). We currently expose the selection
    // but do not emulate the full native add/delete flow.
    const scoreListEnabled = !(this.playerCountOpen || this.gameModeOpen || this.showScoresOpen);
    const names = savedNameLabels(this.state.config.profile);
    const scoreListPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_SCORE_LIST_WIDGET_X * scale, HS_RIGHT_SCORE_LIST_WIDGET_Y * scale));
    const scoreListLayout = this._dropdownLayout({ pos: scoreListPos, width: HS_RIGHT_SCORE_LIST_WIDGET_W * scale, itemCount: names.length, scale });
    [this.scoreListOpen, selected, consumed] = this._updateDropdown({
      layout: scoreListLayout,
      itemCount: names.length,
      isOpen: this.scoreListOpen,
      enabled: scoreListEnabled,
      scale,
    });
    if (selected !== null) {
      this.state.config.profile.selectedSavedNameSlot = selected;
      this._dirty = true;
      this._reloadRecords();
    }
    if (consumed) {
      if (this.scoreListOpen) {
        this.playerCountOpen = false;
        this.gameModeOpen = false;
        this.showScoresOpen = false;
      }
      return true;
    }

    return false;
  }

  private _updateQuestArrows(
    opts: {
      leftPanelTopLeft: Vec2;
      scale: number;
      resources: RuntimeResources;
    },
  ): boolean {
    const { leftPanelTopLeft, scale, resources } = opts;
    const request = this._request;
    if (request === null) return false;
    if (request.gameModeId !== GameMode.QUESTS) return false;

    const level = request.questLevel;
    if (level === null) return false;

    // Clamp to a sane range.
    const globalIndex = int(level.globalIndex);
    const unlock = this.state.config.gameplay.hardcore
      ? int(this.state.status.questUnlockIndexFull)
      : int(this.state.status.questUnlockIndex);
    const maxIndex = Math.max(0, Math.min(49, unlock));
    const arrow = getTexture(resources, TextureId.UI_ARROW);

    const [mx, my] = InputState.mousePosition();
    const mouse = new Vec2(mx, my);
    const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
    const arrowW = arrow.width * scale;
    const arrowH = arrow.height * scale;

    // The native has two arrows spaced 255px apart; at 1.1 only the "next" arrow is drawn.
    const prevPos = leftPanelTopLeft.add(new Vec2((HS_QUEST_ARROW_X - 255.0) * scale, HS_QUEST_ARROW_Y * scale));
    const nextPos = leftPanelTopLeft.add(new Vec2(HS_QUEST_ARROW_X * scale, HS_QUEST_ARROW_Y * scale));
    const prevRect = Rect.fromTopLeft(prevPos, arrowW, arrowH);
    const nextRect = Rect.fromTopLeft(nextPos, arrowW, arrowH);

    const setLevel = (index: number): void => {
      index = Math.max(0, Math.min(maxIndex, int(index)));
      const newLevel = QuestLevel.fromGlobalIndex(index);
      request.questLevel = newLevel;
      this.state.config.gameplay.questLevel = newLevel;
      this._dirty = true;
      this._reloadRecords();
    };

    if (globalIndex > 0 && prevRect.contains(mouse) && click) {
      setLevel(globalIndex - 1);
      return true;
    }
    if (globalIndex < maxIndex && nextRect.contains(mouse) && click) {
      setLevel(globalIndex + 1);
      return true;
    }
    return false;
  }

  draw(): void {
    this._assertOpen();
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));

    const pauseBackground = this.state.pauseBackground;
    if (pauseBackground !== null) {
      pauseBackground.drawPauseBackground({ entityAlpha: this._worldEntityAlpha() });
    } else if (this._ground !== null) {
      this._ground.draw(menuGroundCamera(this.state));
    }
    drawScreenFade(this.state);

    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;
    const request = this._request;
    let modeId: GameMode;
    if (request !== null) {
      modeId = request.gameModeId;
    } else {
      modeId = gameModeFromId(this.state.config.gameplay.mode);
    }
    const questMajor = (request !== null && request.questLevel !== null) ? request.questLevel.major : 0;
    const questMinor = (request !== null && request.questLevel !== null) ? request.questLevel.minor : 0;

    const screenWidth = this.state.config.display.width;
    const scale = 1.0;
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const panelW = MENU_PANEL_WIDTH * scale;

    const [, leftSlideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 0,
    });
    const [, rightSlideX] = uiElementAnim(this, {
      index: 2,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 1,
    });

    const leftPanelPosX = hsLeftPanelPosX(screenWidth);
    const leftTopLeft = this._panelTopLeft({ pos: new Vec2(leftPanelPosX, HS_LEFT_PANEL_POS_Y), scale });
    const rightPanelPosXVal = hsRightPanelPosX(screenWidth);
    const rightTopLeft = this._panelTopLeft({ pos: new Vec2(rightPanelPosXVal, HS_RIGHT_PANEL_POS_Y), scale });
    const leftPanelTopLeft = leftTopLeft.offset({ dx: leftSlideX });
    const rightPanelTopLeft = rightTopLeft.offset({ dx: rightSlideX });

    const panelTex = getTexture(resources, TextureId.UI_MENU_PANEL);
    drawClassicMenuPanel(
      panelTex,
      { dst: wgl.makeRectangle(leftPanelTopLeft.x, leftPanelTopLeft.y, panelW, HS_LEFT_PANEL_HEIGHT * scale),
        tint: WHITE, shadow: fxDetail },
    );
    drawClassicMenuPanel(
      panelTex,
      { dst: wgl.makeRectangle(rightPanelTopLeft.x, rightPanelTopLeft.y, panelW, HS_RIGHT_PANEL_HEIGHT * scale),
        tint: WHITE, shadow: fxDetail, flipX: true },
    );

    const selectedRank = drawMainPanel(this, {
      resources,
      font,
      leftPanelTopLeft,
      scale,
      modeId,
      questMajor,
      questMinor,
      request,
    });

    drawRightPanel(this, {
      resources,
      font,
      rightTopLeft: rightPanelTopLeft,
      scale,
      highlightRank: selectedRank,
    });

    this._drawSign({ resources });
    this._drawMenuCursor(resources);
  }

  private _drawSign(opts: { resources: RuntimeResources }): void {
    const { resources } = opts;
    const sign = getTexture(resources, TextureId.UI_SIGN_CRIMSON);
    const screenW = this.state.config.display.width;
    const [signScale, shiftX] = signLayoutScale(int(screenW));
    const signPos = new Vec2(
      screenW + MENU_SIGN_POS_X_PAD,
      screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL,
    );
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
        texture: sign, src: signSrc,
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

  private _drawMenuCursor(resources: RuntimeResources): void {
    const particles = getTexture(resources, TextureId.PARTICLES);
    const cursorTex = getTexture(resources, TextureId.UI_CURSOR);
    const [mx, my] = InputState.mousePosition();
    const pos = new Vec2(mx, my);
    drawMenuCursor(particles, cursorTex, { pos, pulseTime: this._cursorPulseTime });
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

  takeAction(): string | null {
    this._assertOpen();
    const action = this._action;
    this._action = null;
    return action;
  }

  private _assertOpen(): void {
    if (!this._isOpen) {
      throw new Error('HighScoresView must be opened before use');
    }
  }

  _visibleRows(font: SmallFontData): number {
    const rowStep = font.cellSize;
    const tableTop = 188.0 + rowStep;
    const reservedBottom = 96.0;
    const screenH = wgl.getScreenHeight();
    const available = Math.max(0.0, screenH - tableTop - reservedBottom);
    return Math.max(1, Math.floor(available / rowStep));
  }
}
