// Port of crimson/screens/quest_views/quests_menu.py

import { QuestLevel } from '@crimson/quests/level.ts';
import { questCompletedCounterIndex, questGamesCounterIndex } from '@crimson/quests/status.ts';
import { TextureId } from '@grim/assets.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import { debugEnabled } from '@crimson/debug.ts';
import type { GameState } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, MENU_SCALE_SMALL_THRESHOLD, MENU_SIGN_HEIGHT, MENU_SIGN_OFFSET_X, MENU_SIGN_OFFSET_Y, MENU_SIGN_POS_X_PAD, MENU_SIGN_POS_Y, MENU_SIGN_POS_Y_SMALL, MENU_SIGN_WIDTH, MenuView, drawMenuCursorHelper, ensureMenuGround, menuGroundCamera, uiElementAnim } from '@crimson/screens/menu.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { FADE_TO_GAME_ACTIONS, PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS } from '@crimson/screens/panels/base.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { QUEST_BACK_BUTTON_X_OFFSET, QUEST_BACK_BUTTON_Y_OFFSET, QUEST_HARDCORE_CHECKBOX_X_OFFSET, QUEST_HARDCORE_CHECKBOX_Y_OFFSET, QUEST_HARDCORE_LIST_Y_SHIFT, QUEST_HARDCORE_UNLOCK_INDEX, QUEST_LIST_HOVER_BOTTOM_PAD, QUEST_LIST_HOVER_LEFT_PAD, QUEST_LIST_HOVER_RIGHT_PAD, QUEST_LIST_HOVER_TOP_PAD, QUEST_LIST_NAME_X_OFFSET, QUEST_LIST_ROW_STEP, QUEST_LIST_Y_OFFSET, QUEST_MENU_BASE_X, QUEST_MENU_BASE_Y, QUEST_MENU_PANEL_OFFSET_X, QUEST_PANEL_HEIGHT, QUEST_STAGE_ICON_SCALE_UNSELECTED, QUEST_STAGE_ICON_SIZE, QUEST_STAGE_ICON_STEP, QUEST_STAGE_ICON_X_OFFSET, QUEST_STAGE_ICON_Y_OFFSET, QUEST_TITLE_H, QUEST_TITLE_W, QUEST_TITLE_X_OFFSET, QUEST_TITLE_Y_OFFSET, QuestMenuLayout } from '@crimson/screens/quest-views/shared.ts';
import { questByLevel } from '@crimson/quests/index.ts';
import * as wgl from '@wgl';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

// Quest selection menu.
//
// Layout and gating are based on `sub_447d40` (crimsonland.exe).
//
// The classic game treats this as a distinct UI state (transition target `0x0b`),
// entered from the Play Game panel.
export class QuestsMenuView {
  state: GameState;
  protected _isOpen: boolean;
  protected _ground: GroundRenderer | null;
  protected _backButton: UiButtonState;
  protected _menuScreenWidth: number;
  protected _widescreenYShift: number;
  protected _stage: number;
  protected _action: string | null;
  protected _dirty: boolean;
  protected _cursorPulseTime: number;
  _timelineMs: number;
  protected _timelineMaxMs: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _panelOpenSfxPlayed: boolean;

  get isOpen(): boolean {
    return this._isOpen;
  }
  get ground(): GroundRenderer | null {
    return this._ground;
  }
  get backButton(): UiButtonState {
    return this._backButton;
  }
  get menuScreenWidth(): number {
    return this._menuScreenWidth;
  }
  get widescreenYShift(): number {
    return this._widescreenYShift;
  }
  get stage(): number {
    return this._stage;
  }
  get action(): string | null {
    return this._action;
  }
  get dirty(): boolean {
    return this._dirty;
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
  get panelOpenSfxPlayed(): boolean {
    return this._panelOpenSfxPlayed;
  }

  constructor(state: GameState) {
    this.state = state;
    this._isOpen = false;
    this._ground = null;
    this._backButton = new UiButtonState({ label: 'Back' });

    this._menuScreenWidth = 0;
    this._widescreenYShift = 0.0;

    this._stage = 1;
    this._action = null;
    this._dirty = false;
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._panelOpenSfxPlayed = false;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._menuScreenWidth = int(layoutW);
    this._widescreenYShift = MenuView._menuWidescreenYShift(layoutW);
    // Sign and ground match the main menu/panels.
    this._initGround();
    this._action = null;
    this._dirty = false;
    this._stage = Math.max(1, Math.min(5, int(this._stage)));
    this._cursorPulseTime = 0.0;
    this._timelineMs = 0;
    this._timelineMaxMs = PANEL_TIMELINE_START_MS;
    this._closing = false;
    this._closeAction = null;
    this._panelOpenSfxPlayed = false;
    this._backButton = new UiButtonState({ label: 'Back' });

    // Ensure the quest registry is populated so titles render.
    // (The package import registers all tier builders.)
    void import('@crimson/quests/index.ts');
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    if (this._dirty) {
      try {
        this.state.config.save();
      } catch (exc) {
        this.state.console.log.log(`failed to save quest menu config: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
      this._dirty = false;
    }
    this._ground = null;
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
    let dtMs = int(Math.min(dt, 0.1) * 1000.0);

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
      if (this._timelineMs >= this._timelineMaxMs) {
        this.state.menuSignLocked = true;
        if (!this._panelOpenSfxPlayed && (this.state.audio !== null)) {
          playSfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }

    const config = this.state.config;
    const status = this.state.status;

    // The original forcibly clears hardcore in the demo build.
    if (this.state.demoEnabled) {
      if (config.gameplay.hardcore) {
        config.gameplay.hardcore = false;
        this._dirty = true;
      }
    }

    if (debugEnabled() && InputState.wasKeyPressed(116)) {
      const unlock = 49;
      if (int(status.questUnlockIndex) < unlock) {
        status.questUnlockIndex = unlock;
      }
      if (int(status.questUnlockIndexFull) < unlock) {
        status.questUnlockIndexFull = unlock;
      }
      this.state.console.log.log('debug: unlocked all quests');
    }

    const enabled = this._timelineMs >= this._timelineMaxMs;

    if (InputState.wasKeyPressed(27) && enabled) {
      this._beginCloseTransition('open_play_game');
      return;
    }

    if (!enabled) {
      return;
    }

    if (InputState.wasKeyPressed(37)) {
      this._stage = Math.max(1, this._stage - 1);
    }
    if (InputState.wasKeyPressed(39)) {
      this._stage = Math.min(5, this._stage + 1);
    }

    const layout = this._layout();

    // Stage icons: hover is tracked, but stage selection requires a click.
    const hoveredStage = this._hoveredStage(layout);
    if (hoveredStage !== null && InputState.wasMouseButtonPressed(0)) {
      this._stage = hoveredStage;
      return;
    }

    if (this._hardcoreCheckboxClicked(layout)) {
      return;
    }

    const backPos = new Vec2(layout.listPos.x, this._rowsY0(layout)).add(new Vec2(QUEST_BACK_BUTTON_X_OFFSET, QUEST_BACK_BUTTON_Y_OFFSET));
    dtMs = Math.min(dt, 0.1) * 1000.0;
    const resources = requireRuntimeResources(this.state);
    const backW = buttonWidth(resources, this._backButton.label, { scale: 1.0, forceWide: this._backButton.forceWide });
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
    if (buttonUpdate(this._backButton, { pos: backPos, width: backW, dtMs: dtMs, mouse: mouse, click: Boolean(click) })) {
      this._beginCloseTransition('open_play_game');
      return;
    }

    // Quick-select row numbers 1..0 (10).
    const rowFromKey = QuestsMenuView._digitRowPressed();
    if (rowFromKey !== null) {
      this._tryStartQuest(this._stage, rowFromKey);
      return;
    }

    const hoveredRow = this._hoveredRow(layout);
    if (hoveredRow !== null && InputState.wasMouseButtonPressed(0)) {
      this._tryStartQuest(this._stage, hoveredRow);
      return;
    }

    if (hoveredRow !== null && InputState.wasKeyPressed(13)) {
      this._tryStartQuest(this._stage, hoveredRow);
      return;
    }
  }

  draw(): void {
    this._assertOpen();
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    if (this._ground !== null) {
      this._ground.draw(menuGroundCamera(this.state));
    }
    drawScreenFade(this.state);

    this._drawPanel();
    this._drawSign();
    this._drawContents();
    drawMenuCursorHelper(
      this.state,
      { resources: requireRuntimeResources(this.state), pulseTime: this._cursorPulseTime },
    );
  }

  takeAction(): string | null {
    this._assertOpen();
    const action = this._action;
    this._action = null;
    return action;
  }

  protected _assertOpen(): void {
    if (!(this._isOpen)) throw new Error('QuestsMenuView must be opened before use');
  }

  protected _initGround(): void {
    this._ground = ensureMenuGround(this.state);
  }

  protected _layout(): QuestMenuLayout {
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: MENU_PANEL_WIDTH });
    // `sub_447d40` base sums:
    //   x_sum = <ui_element_x> + <ui_element_offset_x>  (x=-5)
    //   y_sum = <ui_element_y> + <ui_element_offset_y>  (y=185 + widescreen shift via ui_menu_layout_init)
    const xSum = QUEST_MENU_BASE_X + slideX + QUEST_MENU_PANEL_OFFSET_X;
    const ySum = QUEST_MENU_BASE_Y + MENU_PANEL_OFFSET_Y + this._widescreenYShift;

    const titlePos = new Vec2(xSum + QUEST_TITLE_X_OFFSET, ySum + QUEST_TITLE_Y_OFFSET);
    const iconsStartPos = titlePos.add(new Vec2(QUEST_STAGE_ICON_X_OFFSET, QUEST_STAGE_ICON_Y_OFFSET));
    const lastIconX = iconsStartPos.x + QUEST_STAGE_ICON_STEP * 4.0;
    const listPos = new Vec2(lastIconX - 208.0 + 16.0, titlePos.y + QUEST_LIST_Y_OFFSET);
    return new QuestMenuLayout({ titlePos: titlePos, iconsStartPos: iconsStartPos, listPos: listPos });
  }

  protected _hoveredStage(layout: QuestMenuLayout): number | null {
    const titleY = layout.titlePos.y;
    const x0 = layout.iconsStartPos.x;
    const mousePos = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    for (let stage = 1; stage < 6; stage++) {
      const x = x0 + (stage - 1) * QUEST_STAGE_ICON_STEP;
      // Hover bounds are fixed 32x32, anchored at (x, title_y) (not icons_y).
      const stageRect = Rect.fromTopLeft(new Vec2(x, titleY), QUEST_STAGE_ICON_SIZE, QUEST_STAGE_ICON_SIZE);
      if (stageRect.contains(mousePos)) {
        return stage;
      }
    }
    return null;
  }

  protected _hardcoreCheckboxClicked(layout: QuestMenuLayout): boolean {
    const status = this.state.status;
    if (int(status.questUnlockIndex) < QUEST_HARDCORE_UNLOCK_INDEX) {
      return false;
    }
    const resources = requireRuntimeResources(this.state);
    const checkOn = resources.texture(TextureId.UI_CHECK_ON);
    const config = this.state.config;
    const hardcore = config.gameplay.hardcore;

    const font = resources.smallFont;
    const textScale = 1.0;
    const label = 'Hardcore';
    const labelW = measureSmallTextWidth(font, label);

    const checkPos = layout.listPos.add(new Vec2(QUEST_HARDCORE_CHECKBOX_X_OFFSET, QUEST_HARDCORE_CHECKBOX_Y_OFFSET));
    const rectW = checkOn.width + 6.0 + labelW;
    const rectH = Math.max(checkOn.height, font.cellSize * textScale);

    const mousePos = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    const hovered = Rect.fromTopLeft(checkPos, rectW, rectH).contains(mousePos);
    if (hovered && InputState.wasMouseButtonPressed(0)) {
      config.gameplay.hardcore = !hardcore;
      this._dirty = true;
      if (this.state.demoEnabled) {
        config.gameplay.hardcore = false;
      }
      return true;
    }
    return false;
  }

  protected static _digitRowPressed(): number | null {
    const keys: [number, number][] = [[49, 0], [50, 1], [51, 2], [52, 3], [53, 4], [54, 5], [55, 6], [56, 7], [57, 8], [48, 9]];
    for (let [key, row] of keys) {
      if (InputState.wasKeyPressed(key)) {
        return row;
      }
    }
    return null;
  }

  protected _rowsY0(layout: QuestMenuLayout): number {
    // `sub_447d40` adds +10 to the list Y after rendering the Hardcore checkbox.
    const status = this.state.status;
    let y0 = layout.listPos.y;
    if (int(status.questUnlockIndex) >= QUEST_HARDCORE_UNLOCK_INDEX) {
      y0 += QUEST_HARDCORE_LIST_Y_SHIFT;
    }
    return y0;
  }

  protected _hoveredRow(layout: QuestMenuLayout): number | null {
    const listX = layout.listPos.x;
    const y0 = this._rowsY0(layout);
    const mousePos = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    for (let row = 0; row < 10; row++) {
      const y = y0 + row * QUEST_LIST_ROW_STEP;
      const left = listX - QUEST_LIST_HOVER_LEFT_PAD;
      const top = y - QUEST_LIST_HOVER_TOP_PAD;
      const right = listX + QUEST_LIST_HOVER_RIGHT_PAD;
      const bottom = y + QUEST_LIST_HOVER_BOTTOM_PAD;
      const rowRect = Rect.fromTopLeft(new Vec2(left, top), right - left, bottom - top);
      if (rowRect.contains(mousePos)) {
        return row;
      }
    }
    return null;
  }

  protected _questUnlocked(stage: number, row: number): boolean {
    const status = this.state.status;
    const config = this.state.config;
    let unlock = int(status.questUnlockIndex);
    if (config.gameplay.hardcore) {
      unlock = int(status.questUnlockIndexFull);
    }
    const level = new QuestLevel({ major: int(stage), minor: int(row) + 1 });
    return unlock >= int(level.globalIndex);
  }

  protected _tryStartQuest(stage: number, row: number): void {
    if (!this._questUnlocked(stage, row)) {
      return;
    }
    const level = new QuestLevel({ major: int(stage), minor: int(row) + 1 });
    this.state.pendingQuestLevel = level;
    this.state.config.gameplay.mode = GameMode.QUESTS;
    this.state.config.gameplay.questLevel = level;
    this._dirty = true;
    this._beginCloseTransition('start_quest');
  }

  protected _questTitle(stage: number, row: number): string {

    const quest = questByLevel(new QuestLevel({ major: int(stage), minor: int(row) + 1 }));
    if (quest === null) {
      return '???';
    }
    return quest.title;
  }

  protected static _questRowColors(opts: { hardcore: boolean }): [wgl.Color, wgl.Color] {
    const hardcore = opts.hardcore;
    // `sub_447d40` uses different RGB when hardcore is toggled.
    let r: number;
    let g: number;
    let b: number;
    if (hardcore) {
      // (0.980392, 0.274509, 0.235294, alpha)
      [r, g, b] = [250, 70, 60];
    } else {
      // (0.274509, 0.707..., 0.941..., alpha)
      [r, g, b] = [70, 180, 240];
    }
    return [wgl.makeColor(r / 255, g / 255, b / 255, 153 / 255), wgl.makeColor(r / 255, g / 255, b / 255, 255 / 255)];
  }

  protected _questCounts(opts: { stage: number; row: number }): [number, number] | null {
    const stage = opts.stage;
    const row = opts.row;
    // In `sub_447d40`, counts are indexed by (row + stage*10) and split across two
    // arrays at offsets 0xDC (games) and 0x17C (completed) within game.cfg.
    //
    // Stage 5 does not fit cleanly in the saved blob:
    // - The "games" index range would overlap stage-1 completion counters.
    // - The "completed" index range reads into trailing fields (mode counters,
    //   game_sequence_id, and unknown tail bytes), and the last row would run past
    //   the decoded payload.
    //
    // We emulate this layout so the debug `F1` overlay matches the classic build.
    const level = new QuestLevel({ major: int(stage), minor: int(row) + 1 });
    const globalIndex = int(level.globalIndex);

    const status = this.state.status;
    const gamesIdx = questGamesCounterIndex(level);
    const completedIdx = questCompletedCounterIndex(level);
    let games: ReturnType<typeof int>;
    try {
      games = int(status.questPlayCount(gamesIdx));
    } catch (exc) {
      if (!(exc instanceof RangeError)) {
        throw exc;
      }
      return null;
    }

    let completed: number;
    try {
      completed = int(status.questPlayCount(completedIdx));
    } catch (exc) {
      if (!(exc instanceof RangeError)) {
        throw exc;
      }
      // Stage-5 completed reads into trailing fields (and beyond).
      if (int(stage) !== 5) {
        return null;
      }
      const tailSlot = int(globalIndex) - 40;
      if (tailSlot === 0) {
        completed = int(status.modePlayCountForMode(GameMode.SURVIVAL));
      } else if (tailSlot === 1) {
        completed = int(status.modePlayCountForMode(GameMode.RUSH));
      } else if (tailSlot === 2) {
        completed = int(status.modePlayCountForMode(GameMode.TYPO));
      } else if (tailSlot === 3) {
        completed = int(status.modePlayOther);
      } else if (tailSlot === 4) {
        completed = int(status.gameSequenceId);
      } else if (5 <= tailSlot && tailSlot <= 8) {
        const tail = status.unknownTail;
        const off = (tailSlot - 5) * 4;
        if (tail.length < off + 4) {
          completed = 0;
        } else {
          completed = (((bytes: ArrayLike<number>) => Array.from(bytes).reduce((value, byte, index) => value + byte * (256 ** index), 0))(tail.slice(off, off + 4)) >>> 0);
        }
      } else {
        completed = 0;
      }
    }
    return [completed, games];
  }

  protected _drawContents(): void {
    const resources = requireRuntimeResources(this.state);
    const layout = this._layout();
    const titlePos = layout.titlePos;
    const iconsStartPos = layout.iconsStartPos;
    const listPos = layout.listPos;

    let stage = int(this._stage);
    if (stage < 1) {
      stage = 1;
    }
    if (stage > 5) {
      stage = 5;
    }

    const hoveredStage = this._hoveredStage(layout);
    const hoveredRow = this._hoveredRow(layout);
    const showCounts = debugEnabled() && InputState.isKeyDown(112);

    // Title texture is tinted by (0.7, 0.7, 0.7, 0.7).
    const titleTex = resources.texture(TextureId.UI_TEXT_QUEST);
    wgl.drawTexturePro(titleTex, wgl.makeRectangle(0.0, 0.0, titleTex.width, titleTex.height), wgl.makeRectangle(titlePos.x, titlePos.y, QUEST_TITLE_W, QUEST_TITLE_H), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(179 / 255, 179 / 255, 179 / 255, 179 / 255));

    // Stage icons (1..5).
    const hoverTint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 204 / 255); // 0.8 alpha
    const baseTint = wgl.makeColor(179 / 255, 179 / 255, 179 / 255, 179 / 255); // 0.7 RGBA
    const selectedTint = wgl.makeColor(1, 1, 1, 1);
    const stageIcons = new Map([[1, resources.texture(TextureId.UI_NUM1)], [2, resources.texture(TextureId.UI_NUM2)], [3, resources.texture(TextureId.UI_NUM3)], [4, resources.texture(TextureId.UI_NUM4)], [5, resources.texture(TextureId.UI_NUM5)]]);
    for (let idx = 1; idx < 6; idx++) {
      const icon = mapGetOrThrow(stageIcons, idx);
      const x = iconsStartPos.x + (idx - 1) * QUEST_STAGE_ICON_STEP;
      const localScale = idx === stage ? 1.0 : QUEST_STAGE_ICON_SCALE_UNSELECTED;
      const size = QUEST_STAGE_ICON_SIZE * localScale;
      let tint = baseTint;
      if (hoveredStage === idx) {
        tint = hoverTint;
      }
      if (idx === stage) {
        tint = selectedTint;
      }
      wgl.drawTexturePro(icon, wgl.makeRectangle(0.0, 0.0, icon.width, icon.height), wgl.makeRectangle(x, iconsStartPos.y, size, size), wgl.makeVector2(0.0, 0.0), 0.0, tint);
    }

    const config = this.state.config;
    const status = this.state.status;
    const hardcoreFlag = config.gameplay.hardcore;
    const [baseColor, hoverColor] = QuestsMenuView._questRowColors({ hardcore: hardcoreFlag });

    const font = resources.smallFont;

    const y0 = this._rowsY0(layout);
    // Hardcore checkbox (only drawn once tier5 is reachable in normal mode).
    if (int(status.questUnlockIndex) >= QUEST_HARDCORE_UNLOCK_INDEX) {
      const checkTex = hardcoreFlag ? resources.texture(TextureId.UI_CHECK_ON) : resources.texture(TextureId.UI_CHECK_OFF);
      const checkPos = listPos.add(new Vec2(QUEST_HARDCORE_CHECKBOX_X_OFFSET, QUEST_HARDCORE_CHECKBOX_Y_OFFSET));
      wgl.drawTexturePro(checkTex, wgl.makeRectangle(0.0, 0.0, checkTex.width, checkTex.height), wgl.makeRectangle(checkPos.x, checkPos.y, checkTex.width, checkTex.height), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
      drawSmallText(font, 'Hardcore', checkPos.add(new Vec2(checkTex.width + 6.0, 1.0)), baseColor);
    }

    // Quest list (10 rows).
    for (let row = 0; row < 10; row++) {
      const y = y0 + row * QUEST_LIST_ROW_STEP;
      const unlocked = this._questUnlocked(stage, row);
      const color = hoveredRow === row ? hoverColor : baseColor;

      drawSmallText(font, `${stage}.${row + 1}`, new Vec2(listPos.x, y), color);

      let title: string;
      if (unlocked) {
        title = this._questTitle(stage, row);
      } else {
        title = '???';
      }
      drawSmallText(font, title, new Vec2(listPos.x + QUEST_LIST_NAME_X_OFFSET, y), color);
      const titleW = unlocked ? measureSmallTextWidth(font, title) : 0.0;
      if (unlocked) {
        const lineY = y + 13.0;
        wgl.drawLine(int(listPos.x), int(lineY), int(listPos.x + titleW + 32.0), int(lineY), color);
      }

      if (showCounts && unlocked) {
        const counts = this._questCounts({ stage: stage, row: row });
        if (counts !== null) {
          const [completed, games] = counts;
          const countsX = listPos.x + QUEST_LIST_NAME_X_OFFSET + titleW + 12.0;
          drawSmallText(font, `(${completed}/${games})`, new Vec2(countsX, y), color);
        }
      }
    }

    if (showCounts) {
      // Header is drawn below the list, aligned with the count column.
      const headerX = listPos.x + 96.0;
      const headerY = y0 + QUEST_LIST_ROW_STEP * 10.0 - 2.0;
      drawSmallText(font, '(completed/games)', new Vec2(headerX, headerY), baseColor);
    }

    // Back button.
    const backPos = new Vec2(listPos.x, y0).add(new Vec2(QUEST_BACK_BUTTON_X_OFFSET, QUEST_BACK_BUTTON_Y_OFFSET));
    const backW = buttonWidth(resources, this._backButton.label, { scale: 1.0, forceWide: this._backButton.forceWide });
    buttonDraw(
      resources,
      this._backButton,
      { pos: backPos, width: backW, scale: 1.0 },
    );
  }

  protected _drawSign(): void {
    const screenW = this.state.config.display.width;
    const [scale, shiftX] = MenuView._signLayoutScale(int(screenW));
    const signPos = new Vec2(screenW + MENU_SIGN_POS_X_PAD, screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL);
    const signW = MENU_SIGN_WIDTH * scale;
    const signH = MENU_SIGN_HEIGHT * scale;
    const offsetX = MENU_SIGN_OFFSET_X * scale + shiftX;
    const offsetY = MENU_SIGN_OFFSET_Y * scale;
    let rotationDeg = 0.0;
    if (!this.state.menuSignLocked) {
      const [angleRad, slideX] = uiElementAnim(this, { index: 0, startMs: 300, endMs: 0, width: signW });
      const _ = slideX;
      rotationDeg = (angleRad) * (180.0 / Math.PI);
    }
    const sign = requireRuntimeResources(this.state).texture(TextureId.UI_SIGN_CRIMSON);
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

  protected _drawPanel(): void {
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: MENU_PANEL_WIDTH });
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(
      requireRuntimeResources(this.state).texture(TextureId.UI_MENU_PANEL),
      { dst: wgl.makeRectangle((QUEST_MENU_BASE_X + slideX + QUEST_MENU_PANEL_OFFSET_X), (QUEST_MENU_BASE_Y + MENU_PANEL_OFFSET_Y + this._widescreenYShift), MENU_PANEL_WIDTH, QUEST_PANEL_HEIGHT), shadow: fxDetail },
    );
  }

  protected _beginCloseTransition(action: string): void {
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
}
