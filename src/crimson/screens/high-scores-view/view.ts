// Port of crimson/screens/high_scores_view/view.py

import { QuestLevel } from '@crimson/quests/level.ts';
import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import { HighScoreDateMode } from '@grim/config.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState, HighScoresRequest } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import type { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { DropdownLayoutBase } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { HS_BACK_BUTTON_X, HS_BACK_BUTTON_Y, HS_BUTTON_STEP_Y, HS_BUTTON_X, HS_BUTTON_Y0, HS_LEFT_PANEL_HEIGHT, HS_LEFT_PANEL_POS_Y, HS_QUEST_ARROW_X, HS_QUEST_ARROW_Y, HS_RIGHT_CHECK_X, HS_RIGHT_CHECK_Y, HS_RIGHT_GAME_MODE_WIDGET_W, HS_RIGHT_GAME_MODE_WIDGET_X, HS_RIGHT_GAME_MODE_WIDGET_Y, HS_RIGHT_PANEL_HEIGHT, HS_RIGHT_PANEL_POS_Y, HS_RIGHT_PLAYER_COUNT_WIDGET_W, HS_RIGHT_PLAYER_COUNT_WIDGET_X, HS_RIGHT_PLAYER_COUNT_WIDGET_Y, HS_RIGHT_SCORE_LIST_WIDGET_W, HS_RIGHT_SCORE_LIST_WIDGET_X, HS_RIGHT_SCORE_LIST_WIDGET_Y, HS_RIGHT_SHOW_SCORES_WIDGET_W, HS_RIGHT_SHOW_SCORES_WIDGET_X, HS_RIGHT_SHOW_SCORES_WIDGET_Y, hsLeftPanelPosX, hsRightOptionsXShift, hsRightPanelPosX } from '@crimson/screens/high-scores-layout.ts';
import { MENU_PANEL_OFFSET_X, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, uiElementAnim, signLayoutScale } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { FADE_TO_GAME_ACTIONS, PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from '@crimson/screens/panels/base.ts';
import { mouseInsideRectWithPadding } from '@crimson/screens/panels/hit-test.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { drawMainPanel } from '@crimson/screens/high-scores-view/main-panel.ts';
import { loadRecords, resolveRequest } from '@crimson/screens/high-scores-view/records.ts';
import { drawRightPanel } from '@crimson/screens/high-scores-view/right-panel.ts';
import * as wgl from '@wgl';

export class ScoresDropdownLayout extends DropdownLayoutBase {
}

export class HighScoresView {
  state: GameState;
  protected _isOpen: boolean;
  protected _ground: GroundRenderer | null;
  protected _action: string | null;
  protected _cursorPulseTime: number;
  protected _widescreenYShift: number;
  _timelineMs: number;
  protected _timelineMaxMs: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _updateButton: UiButtonState;
  protected _playButton: UiButtonState;
  protected _backButton: UiButtonState;
  protected _request: HighScoresRequest | null;
  protected _records: HighScoreRecord[];
  protected _scrollIndex: number;
  protected _dirty: boolean;
  protected _playerCountOpen: boolean;
  protected _gameModeOpen: boolean;
  protected _showScoresOpen: boolean;
  protected _scoreListOpen: boolean;

  get isOpen(): boolean {
    return this._isOpen;
  }
  get ground(): GroundRenderer | null {
    return this._ground;
  }
  get action(): string | null {
    return this._action;
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
  get updateButton(): UiButtonState {
    return this._updateButton;
  }
  get playButton(): UiButtonState {
    return this._playButton;
  }
  get backButton(): UiButtonState {
    return this._backButton;
  }
  get request(): HighScoresRequest | null {
    return this._request;
  }
  get records(): HighScoreRecord[] {
    return this._records;
  }
  get scrollIndex(): number {
    return this._scrollIndex;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  get playerCountOpen(): boolean {
    return this._playerCountOpen;
  }
  get gameModeOpen(): boolean {
    return this._gameModeOpen;
  }
  get showScoresOpen(): boolean {
    return this._showScoresOpen;
  }
  get scoreListOpen(): boolean {
    return this._scoreListOpen;
  }

  constructor(state: GameState) {
    this.state = state;
    this._isOpen = false;
    this._ground = null;
    this._action = null;
    this._cursorPulseTime = 0.0;
    this._widescreenYShift = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._updateButton = new UiButtonState({ label: 'Update scores', forceWide: true });
    this._playButton = new UiButtonState({ label: 'Play a game', forceWide: true });
    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });

    this._request = null;
    this._records = [];
    this._scrollIndex = 0;
    this._dirty = false;

    // Right-panel list widget state (quests variant).
    this._playerCountOpen = false;
    this._gameModeOpen = false;
    this._showScoresOpen = false;
    this._scoreListOpen = false;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._widescreenYShift = MenuView.menuWidescreenYShift(layoutW);
    this._action = null;
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._scrollIndex = 0;
    this._dirty = false;
    this._updateButton = new UiButtonState({ label: 'Update scores', forceWide: true });
    this._playButton = new UiButtonState({ label: 'Play a game', forceWide: true });
    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });

    this._playerCountOpen = false;
    this._gameModeOpen = false;
    this._showScoresOpen = false;
    this._scoreListOpen = false;

    const request = resolveRequest(this.state);
    this._request = request;
    this._records = loadRecords(this.state, request);
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_PANELCLICK);
    }
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this._request = null;
    this._records = [];
    this._scrollIndex = 0;
    this._dirty = false;
    this._playerCountOpen = false;
    this._gameModeOpen = false;
    this._showScoresOpen = false;
    this._scoreListOpen = false;
    this._closing = false;
    this._closeAction = null;
  }

  protected _panelTopLeft(opts: { pos: Vec2; scale: number }): Vec2 {
    const pos = opts.pos;
    const scale = opts.scale;
    return new Vec2(pos.x + MENU_PANEL_OFFSET_X * scale, pos.y + this._widescreenYShift + MENU_PANEL_OFFSET_Y * scale);
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
      this._timelineMs = Math.min(this._timelineMaxMs, int(this._timelineMs + dtMs));
    }

    const enabled = this._timelineMs >= this._timelineMaxMs;

    if (InputState.wasKeyPressed(27) && enabled) {
      this._beginCloseTransition('back_to_previous');
      return;
    }

    const screenWidth = this.state.config.display.width;
    const scale = 1.0;
    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;

    // Compute animated panel positions so hit-tests match the draw path even while sliding.
    const panelW = MENU_PANEL_WIDTH * scale;
    let [angleRad, leftSlideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 0 });
    let rightSlideX: ReturnType<typeof uiElementAnim>[1];
    [angleRad, rightSlideX] = uiElementAnim(this, { index: 2, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 1 });
    const leftPanelPosX = hsLeftPanelPosX(screenWidth);
    const leftTopLeft = this._panelTopLeft({ pos: new Vec2(leftPanelPosX, HS_LEFT_PANEL_POS_Y), scale: scale });
    const rightPanelPosX = hsRightPanelPosX(screenWidth);
    const rightTopLeft = this._panelTopLeft({ pos: new Vec2(rightPanelPosX, HS_RIGHT_PANEL_POS_Y), scale: scale });
    const leftPanelTopLeft = leftTopLeft.offset({ dx: leftSlideX });
    const rightPanelTopLeft = rightTopLeft.offset({ dx: rightSlideX });

    if (enabled) {
      if (this._updateRightPanelWidgets({ rightTopLeft: rightPanelTopLeft, scale: scale, resources: resources, font: font })) {
        return;
      }
      if (this._updateQuestArrows({ leftPanelTopLeft: leftPanelTopLeft, scale: scale, resources: resources })) {
        return;
      }
    }

    let w: ReturnType<typeof buttonWidth>;
    if (enabled) {
      const buttonBasePos = leftPanelTopLeft.add(new Vec2(HS_BUTTON_X * scale, HS_BUTTON_Y0 * scale));
      const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
      const click = InputState.wasMouseButtonPressed(0);
      w = buttonWidth(resources, this._updateButton.label, { scale: scale, forceWide: this._updateButton.forceWide });
      if (buttonUpdate(this._updateButton, { pos: buttonBasePos, width: w, dtMs: dtMs, mouse: mouse, click: click })) {
        // Reload scores from disk (no view transition).
        if (this.state.audio !== null) {
          playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
        }
        this.open();
        return;
      }
      w = buttonWidth(resources, this._playButton.label, { scale: scale, forceWide: this._playButton.forceWide });
      if (buttonUpdate(this._playButton, { pos: buttonBasePos.offset({ dy: HS_BUTTON_STEP_Y * scale }), width: w, dtMs: dtMs, mouse: mouse, click: click })) {
        this._beginCloseTransition('open_play_game');
        return;
      }
      const backW = buttonWidth(resources, this._backButton.label, { scale: scale, forceWide: this._backButton.forceWide });
      if (buttonUpdate(this._backButton, { pos: leftPanelTopLeft.add(new Vec2(HS_BACK_BUTTON_X * scale, HS_BACK_BUTTON_Y * scale)), width: backW, dtMs: dtMs, mouse: mouse, click: click })) {
        this._beginCloseTransition('back_to_previous');
        return;
      }
    }

    const rows = 10;
    const maxScroll = Math.max(0, this._records.length - rows);

    if (enabled) {
      const wheel = int(InputState.mouseWheelDelta());
      if (wheel) {
        this._scrollIndex = Math.max(0, Math.min(maxScroll, int(this._scrollIndex) - wheel));
      }

      if (InputState.wasKeyPressed(38)) {
        this._scrollIndex = Math.max(0, int(this._scrollIndex) - 1);
      }
      if (InputState.wasKeyPressed(40)) {
        this._scrollIndex = Math.min(maxScroll, int(this._scrollIndex) + 1);
      }
      if (InputState.wasKeyPressed(33)) {
        this._scrollIndex = Math.max(0, int(this._scrollIndex) - rows);
      }
      if (InputState.wasKeyPressed(34)) {
        this._scrollIndex = Math.min(maxScroll, int(this._scrollIndex) + rows);
      }
      if (InputState.wasKeyPressed(36)) {
        this._scrollIndex = 0;
      }
      if (InputState.wasKeyPressed(35)) {
        this._scrollIndex = maxScroll;
      }
    }
  }

  protected _beginCloseTransition(action: string): void {
    if (this._dirty) {
      let _trySucceeded239 = false;
      try {
        this.state.config.save();
        _trySucceeded239 = true;
      } catch (exc) {
        this.state.console.log.log(`config: save failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
      if (_trySucceeded239) {
        this._dirty = false;
      }
    }
    if (this._closing) {
      return;
    }
    if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(FADE_TO_GAME_ACTIONS, action)) {
      this.state.screenFadeAlpha = 0.0;
      this.state.screenFadeRamp = true;
    }
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this._closing = true;
    this._closeAction = action;
  }

  protected _dropdownLayout(opts: { pos: Vec2; width: number; itemCount: number; scale: number }): ScoresDropdownLayout {
    const pos = opts.pos;
    const width = opts.width;
    const itemCount = opts.itemCount;
    const scale = opts.scale;
    const headerH = 16.0 * scale;
    const rowH = 16.0 * scale;
    const fullH = (itemCount * 16.0 + 24.0) * scale;
    return new ScoresDropdownLayout({ pos: pos, width: width, headerH: headerH, rowH: rowH, rowsY0: pos.y + 17.0 * scale, fullH: fullH });
  }

  protected _updateDropdown(opts: { layout: ScoresDropdownLayout; itemCount: number; isOpen: boolean; enabled: boolean; scale: number }): [boolean, number | null, boolean] {
    const layout = opts.layout;
    const itemCount = opts.itemCount;
    const isOpen = opts.isOpen;
    const enabled = opts.enabled;
    const scale = opts.scale;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = enabled && InputState.wasMouseButtonPressed(0);
    const hoveredHeader = enabled && mouseInsideRectWithPadding(mouse, { pos: layout.pos, width: layout.width, height: 14.0 * scale });
    if (hoveredHeader && click) {
      return [!isOpen, null, true];
    }
    if (!isOpen) {
      return [isOpen, null, false];
    }

    const listHovered = Rect.fromTopLeft(layout.pos, layout.width, layout.fullH).contains(Vec2.fromXY(mouse));
    if (click && !listHovered) {
      return [false, null, true];
    }

    for (let idx = 0; idx < itemCount; idx++) {
      const itemY = layout.rowsY0 + layout.rowH * idx;
      const hovered = enabled && mouseInsideRectWithPadding(mouse, { pos: new Vec2(layout.pos.x, itemY), width: layout.width, height: 14.0 * scale });
      if (hovered && click) {
        return [false, idx, true];
      }
    }

    return [isOpen, null, false];
  }

  protected _reloadRecords(): void {
    const request = this._request;
    if (request === null) {
      return;
    }
    this._records = loadRecords(this.state, request);
    const rows = 10;
    this._scrollIndex = Math.max(0, Math.min(int(this._scrollIndex), Math.max(0, this._records.length - rows)));
  }

  protected _updateRightPanelWidgets(opts: { rightTopLeft: Vec2; scale: number; resources: RuntimeResources; font: SmallFontData }): boolean {
    const rightTopLeft = opts.rightTopLeft;
    const scale = opts.scale;
    const resources = opts.resources;
    const font = opts.font;
    const request = this._request;
    if (request === null) {
      return false;
    }

    // Widgets are only shown in the "options" right panel (not the local-score detail panel).
    // We don't explicitly track which right panel is active; hit tests are enough.
    const dropdownBlocked = this._playerCountOpen || this._gameModeOpen || this._showScoresOpen || this._scoreListOpen;
    const smallWidthShiftX = hsRightOptionsXShift(this.state.config.display.width);
    const shiftedRightTopLeft = rightTopLeft.add(new Vec2(smallWidthShiftX * scale, 0.0));

    // Checkbox: "Show internet scores" (config.score_load_gate).
    if (!dropdownBlocked) {
      const checkTex = this.state.config.profile.showInternetScores ? resources.texture(TextureId.UI_CHECK_ON) : resources.texture(TextureId.UI_CHECK_OFF);
      const label = 'Show internet scores';
      const checkPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_CHECK_X * scale, HS_RIGHT_CHECK_Y * scale));
      const labelW = measureSmallTextWidth(font, label);
      const fontH = font.cellSize * scale;
      const rectW = checkTex.width * scale + 6.0 * scale + labelW;
      const rectH = Math.max(checkTex.height * scale, fontH);
      const mousePos = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
      if (Rect.fromTopLeft(checkPos, rectW, rectH).contains(mousePos)) {
        if (InputState.wasMouseButtonPressed(0)) {
          this.state.config.profile.showInternetScores = !this.state.config.profile.showInternetScores;
          this._dirty = true;
          this._reloadRecords();
          return true;
        }
      }
    }

    // Dropdown: show scores date filter (config.highscore_date_mode).
    const showScoresItems: [string, string, string, string] = ['Best of all time', 'Best of month', 'Best of week', 'Best of day'];
    const showScoresPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_SHOW_SCORES_WIDGET_X * scale, HS_RIGHT_SHOW_SCORES_WIDGET_Y * scale));
    const showScoresLayout = this._dropdownLayout({ pos: showScoresPos, width: HS_RIGHT_SHOW_SCORES_WIDGET_W * scale, itemCount: showScoresItems.length, scale: scale });
    const showScoresEnabled = !(this._playerCountOpen || this._gameModeOpen || this._scoreListOpen);
    let [_selfShowScoresOpen, showScoresSelected, consumed] = this._updateDropdown({ layout: showScoresLayout, itemCount: showScoresItems.length, isOpen: this._showScoresOpen, enabled: Boolean(showScoresEnabled), scale: scale });
    this._showScoresOpen = _selfShowScoresOpen;
    if (showScoresSelected !== null) {
      this.state.config.profile.scoreDateMode = (() => { const value = int(showScoresSelected); if (!Object.values(HighScoreDateMode).includes(value as HighScoreDateMode)) { throw new Error('invalid HighScoreDateMode'); } return value as HighScoreDateMode; })();
      this._dirty = true;
      this._reloadRecords();
    }
    if (consumed) {
      // Close other dropdowns when this one opens.
      if (this._showScoresOpen) {
        this._playerCountOpen = false;
        this._gameModeOpen = false;
        this._scoreListOpen = false;
      }
      return true;
    }

    // Dropdown: player count (config.player_count).
    const playerItems: [string, string, string, string] = ['1 player', '2 players', '3 players', '4 players'];
    const playerPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_PLAYER_COUNT_WIDGET_X * scale, HS_RIGHT_PLAYER_COUNT_WIDGET_Y * scale));
    const playerLayout = this._dropdownLayout({ pos: playerPos, width: HS_RIGHT_PLAYER_COUNT_WIDGET_W * scale, itemCount: playerItems.length, scale: scale });
    const playerEnabled = !(this._gameModeOpen || this._showScoresOpen || this._scoreListOpen);
    let _selfPlayerCountOpen: boolean;
    let playerSelected: number | null;
    [_selfPlayerCountOpen, playerSelected, consumed] = this._updateDropdown({ layout: playerLayout, itemCount: playerItems.length, isOpen: this._playerCountOpen, enabled: Boolean(playerEnabled), scale: scale });
    this._playerCountOpen = _selfPlayerCountOpen;
    if (playerSelected !== null) {
      const newCount = int(playerSelected) + 1;
      if (this.state.config.gameplay.playerCount !== newCount) {
        this.state.config.gameplay.playerCount = newCount;
        this._dirty = true;
        this._reloadRecords();
      }
    }
    if (consumed) {
      if (this._playerCountOpen) {
        this._gameModeOpen = false;
        this._showScoresOpen = false;
        this._scoreListOpen = false;
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
      modeItems.push(['Typ\'o\'Shooter', GameMode.TYPO]);
    }
    const gameModePos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_GAME_MODE_WIDGET_X * scale, HS_RIGHT_GAME_MODE_WIDGET_Y * scale));
    const gameModeLayout = this._dropdownLayout({ pos: gameModePos, width: HS_RIGHT_GAME_MODE_WIDGET_W * scale, itemCount: modeItems.length, scale: scale });
    const gameModeEnabled = !(this._playerCountOpen || this._showScoresOpen || this._scoreListOpen);
    let _selfGameModeOpen: boolean;
    let gameModeSelected: number | null;
    [_selfGameModeOpen, gameModeSelected, consumed] = this._updateDropdown({ layout: gameModeLayout, itemCount: modeItems.length, isOpen: this._gameModeOpen, enabled: Boolean(gameModeEnabled), scale: scale });
    this._gameModeOpen = _selfGameModeOpen;
    if (gameModeSelected !== null) {
      const [label, modeId] = modeItems[Math.max(0, Math.min(int(gameModeSelected), modeItems.length - 1))];
      this.state.config.gameplay.mode = modeId;
      request.gameModeId = modeId;
      switch (modeId) {
        case GameMode.TYPO:
          // Native forces Typ-o shooter scores to 1 player.
          this.state.config.gameplay.playerCount = 1;
          break;
        case GameMode.QUESTS:
          // Ensure quest selection exists when switching into quests.
          if (request.questLevel === null) {
            request.questLevel = this.state.config.gameplay.questLevel || new QuestLevel({ major: 1, minor: 1 });
          }
          break;
        default:
          break;
      }
      this._dirty = true;
      this._reloadRecords();
    }
    if (consumed) {
      if (this._gameModeOpen) {
        this._playerCountOpen = false;
        this._showScoresOpen = false;
        this._scoreListOpen = false;
      }
      return true;
    }

    // Dropdown: selected score list (profile slots). We currently expose the selection
    // but do not emulate the full native add/delete flow.
    const scoreListEnabled = !(this._playerCountOpen || this._gameModeOpen || this._showScoresOpen);
    const names = Array.from(this.state.config.profile.savedNameLabels());
    const scoreListPos = shiftedRightTopLeft.add(new Vec2(HS_RIGHT_SCORE_LIST_WIDGET_X * scale, HS_RIGHT_SCORE_LIST_WIDGET_Y * scale));
    const scoreListLayout = this._dropdownLayout({ pos: scoreListPos, width: HS_RIGHT_SCORE_LIST_WIDGET_W * scale, itemCount: names.length, scale: scale });
    let _selfScoreListOpen: boolean;
    let scoreListSelected: number | null;
    [_selfScoreListOpen, scoreListSelected, consumed] = this._updateDropdown({ layout: scoreListLayout, itemCount: names.length, isOpen: this._scoreListOpen, enabled: Boolean(scoreListEnabled), scale: scale });
    this._scoreListOpen = _selfScoreListOpen;
    if (scoreListSelected !== null) {
      this.state.config.profile.selectedSavedNameSlot = int(scoreListSelected);
      this._dirty = true;
      this._reloadRecords();
    }
    if (consumed) {
      if (this._scoreListOpen) {
        this._playerCountOpen = false;
        this._gameModeOpen = false;
        this._showScoresOpen = false;
      }
      return true;
    }

    return false;
  }

  protected _updateQuestArrows(opts: { leftPanelTopLeft: Vec2; scale: number; resources: RuntimeResources }): boolean {
    const leftPanelTopLeft = opts.leftPanelTopLeft;
    const scale = opts.scale;
    const resources = opts.resources;
    const request = this._request;
    if (request === null) {
      return false;
    }
    if (request.gameModeId !== GameMode.QUESTS) {
      return false;
    }

    const level = request.questLevel;
    if (level === null) {
      return false;
    }

    // Clamp to a sane range.
    const globalIndex = int(level.globalIndex);

    const unlock = this.state.config.gameplay.hardcore ? int(this.state.status.questUnlockIndexFull) : int(this.state.status.questUnlockIndex);
    const maxIndex = Math.max(0, Math.min(49, unlock));
    const arrow = resources.texture(TextureId.UI_ARROW);

    const mouse = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    const click = InputState.wasMouseButtonPressed(0);
    const arrowW = arrow.width * scale;
    const arrowH = arrow.height * scale;

    // The native has two arrows spaced 255px apart; at 1.1 only the "next" arrow is drawn.
    const prevPos = leftPanelTopLeft.add(new Vec2((HS_QUEST_ARROW_X - 255.0) * scale, HS_QUEST_ARROW_Y * scale));
    const nextPos = leftPanelTopLeft.add(new Vec2(HS_QUEST_ARROW_X * scale, HS_QUEST_ARROW_Y * scale));
    const prevRect = Rect.fromTopLeft(prevPos, arrowW, arrowH);
    const nextRect = Rect.fromTopLeft(nextPos, arrowW, arrowH);

    const _setLevel = (index: number): void => {
      index = Math.max(0, Math.min(maxIndex, int(index)));
      const level = QuestLevel.fromGlobalIndex(index);
      request.questLevel = level;
      this.state.config.gameplay.questLevel = level;
      this._dirty = true;
      this._reloadRecords();
    };

    if (globalIndex > 0 && prevRect.contains(mouse) && click) {
      _setLevel(globalIndex - 1);
      return true;
    }
    if (globalIndex < maxIndex && nextRect.contains(mouse) && click) {
      _setLevel(globalIndex + 1);
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
      try {
        modeId = (() => { const value = this.state.config.gameplay.mode; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
      } catch (exc) {
        modeId = GameMode.DEMO;
      }
    }
    const questMajor = request !== null && request.questLevel !== null ? int(request.questLevel.major) : 0;
    const questMinor = request !== null && request.questLevel !== null ? int(request.questLevel.minor) : 0;

    const screenWidth = this.state.config.display.width;
    const scale = 1.0;
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    const panelW = MENU_PANEL_WIDTH * scale;
    let [angleRad, leftSlideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 0 });
    let rightSlideX: ReturnType<typeof uiElementAnim>[1];
    [angleRad, rightSlideX] = uiElementAnim(this, { index: 2, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 1 });

    const leftPanelPosX = hsLeftPanelPosX(screenWidth);
    const leftTopLeft = this._panelTopLeft({ pos: new Vec2(leftPanelPosX, HS_LEFT_PANEL_POS_Y), scale: scale });
    const rightPanelPosX = hsRightPanelPosX(screenWidth);
    const rightTopLeft = this._panelTopLeft({ pos: new Vec2(rightPanelPosX, HS_RIGHT_PANEL_POS_Y), scale: scale });
    const leftPanelTopLeft = leftTopLeft.offset({ dx: leftSlideX });
    const rightPanelTopLeft = rightTopLeft.offset({ dx: rightSlideX });

    drawClassicMenuPanel(
      resources.texture(TextureId.UI_MENU_PANEL),
      { dst: wgl.makeRectangle(leftPanelTopLeft.x, leftPanelTopLeft.y, panelW, HS_LEFT_PANEL_HEIGHT * scale), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail },
    );
    drawClassicMenuPanel(
      resources.texture(TextureId.UI_MENU_PANEL),
      { dst: wgl.makeRectangle(rightPanelTopLeft.x, rightPanelTopLeft.y, panelW, HS_RIGHT_PANEL_HEIGHT * scale), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail, flipX: true },
    );

    const selectedRank = drawMainPanel(this, { resources: resources, font: font, leftPanelTopLeft: leftPanelTopLeft, scale: scale, modeId: modeId, questMajor: questMajor, questMinor: questMinor, request: request });

    drawRightPanel(
      this,
      { resources: resources, font: font, rightTopLeft: rightPanelTopLeft, scale: scale, highlightRank: selectedRank },
    );
    this._drawSign({ resources: resources });
    drawMenuCursorHelper(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
  }

  protected _drawSign(opts: { resources: RuntimeResources }): void {
    const resources = opts.resources;
    const sign = resources.texture(TextureId.UI_SIGN_CRIMSON);
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

  takeAction(): string | null {
    this._assertOpen();
    const action = this._action;
    this._action = null;
    return action;
  }

  protected _assertOpen(): void {
    if (!(this._isOpen)) throw new Error('HighScoresView must be opened before use');
  }

  protected _visibleRows(font: any): number {
    const rowStep = font.cellSize;
    const tableTop = 188.0 + rowStep;
    const reservedBottom = 96.0;
    const available = Math.max(0.0, wgl.getScreenHeight() - tableTop - reservedBottom);
    return Math.max(1, int(Math.floor(available / rowStep)));
  }
}
