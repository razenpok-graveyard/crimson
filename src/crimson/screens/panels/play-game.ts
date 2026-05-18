// Port of crimson/screens/panels/play_game.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import { updateAudio } from '@grim/audio.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { debugEnabled } from '@crimson/debug.ts';
import type { GameState } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_LABEL_ROW_HEIGHT, MENU_LABEL_ROW_PLAY_GAME, MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, uiElementAnim } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS, PanelMenuView } from '@crimson/screens/panels/base.ts';
import { mouseInsideRectWithPadding } from '@crimson/screens/panels/hit-test.ts';
import * as wgl from '@wgl';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function pythonSplitlines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(text)) {
    lines.pop();
  }
  return lines;
}

export class PlayGameModeEntry {
  key: string;
  label: string;
  tooltip: string;
  action: string;
  gameMode: number | null;
  showCount: boolean;

  constructor(opts: {
    key: string;
    label: string;
    tooltip: string;
    action: string;
    gameMode?: number | null;
    showCount?: boolean;
  }) {
    this.key = opts.key;
    this.label = opts.label;
    this.tooltip = opts.tooltip;
    this.action = opts.action;
    this.gameMode = opts.gameMode ?? null;
    this.showCount = opts.showCount ?? false;
  }
}

export class PlayGameContentLayout {
  readonly scale: number;
  readonly basePos: Vec2;
  readonly dropPos: Vec2;

  constructor(opts: {
    scale: number;
    basePos: Vec2;
    dropPos: Vec2;
  }) {
    this.scale = opts.scale;
    this.basePos = opts.basePos;
    this.dropPos = opts.dropPos;
  }
}

export class PlayerCountWidgetLayout {
  readonly pos: Vec2;
  readonly width: number;
  readonly headerH: number;
  readonly rowH: number;
  readonly rowsY0: number;
  readonly fullH: number;
  readonly arrowPos: Vec2;
  readonly arrowSize: Vec2;
  readonly textPos: Vec2;
  readonly textScale: number;

  constructor(opts: {
    pos: Vec2;
    width: number;
    headerH: number;
    rowH: number;
    rowsY0: number;
    fullH: number;
    arrowPos: Vec2;
    arrowSize: Vec2;
    textPos: Vec2;
    textScale: number;
  }) {
    this.pos = opts.pos;
    this.width = opts.width;
    this.headerH = opts.headerH;
    this.rowH = opts.rowH;
    this.rowsY0 = opts.rowsY0;
    this.fullH = opts.fullH;
    this.arrowPos = opts.arrowPos;
    this.arrowSize = opts.arrowSize;
    this.textPos = opts.textPos;
    this.textScale = opts.textScale;
  }
}

// Play Game mode select panel.
//
// Layout and gating are based on `sub_44ed80` (crimsonland.exe).
export class PlayGameMenuView extends PanelMenuView {
  protected _PLAYER_COUNT_LABELS: string[] = ['1 player', '2 players', '3 players', '4 players'] as const;
  protected _playerListOpen: boolean;
  protected _dirty: boolean;
  protected _tooltipMs: Map<string, number>;
  protected _modeButtons: Map<string, UiButtonState>;

  get PLAYER_COUNT_LABELS(): string[] {
    return this._PLAYER_COUNT_LABELS;
  }
  get playerListOpen(): boolean {
    return this._playerListOpen;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  get tooltipMs(): Map<string, number> {
    return this._tooltipMs;
  }
  get modeButtons(): Map<string, UiButtonState> {
    return this._modeButtons;
  }

  constructor(state: GameState) {
    super(state, { title: 'Play Game', panelOffset: new Vec2(-63.0, MENU_PANEL_OFFSET_Y), panelHeight: 278.0, backPos: new Vec2(-55.0, 462.0) });
    this._playerListOpen = false;
    this._dirty = false;

    // Hover fade timers for tooltips (0..1000ms-ish; original uses ~0.0009 alpha scale).
    this._tooltipMs = new Map();
    this._modeButtons = new Map();
  }

  open(): void {
    super.open();
    this._playerListOpen = false;
    this._dirty = false;
    this._tooltipMs.clear();
    this._modeButtons.clear();
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

    // Close transition (matches PanelMenuView).
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
      if (this._timelineMs >= this._timelineMaxMs) {
        this.state.menuSignLocked = true;
      }
    }

    const entry = this._entry;
    if (entry === null) {
      return;
    }

    const enabled = this._entryEnabled(entry);
    const hoveredBack = enabled && this._hoveredEntry(entry);
    this._hovered = hoveredBack;

    // ESC always goes back; Enter should not auto-back on this screen.
    if (InputState.wasKeyPressed(27) && enabled) {
      this._beginCloseTransition(this._backAction);
    }
    if (enabled && hoveredBack && InputState.wasMouseButtonPressed(0)) {
      this._beginCloseTransition(this._backAction);
    }

    if (hoveredBack) {
      entry.hoverAmount += dtMs * 6;
    } else {
      entry.hoverAmount -= dtMs * 2;
    }
    entry.hoverAmount = Math.max(0, Math.min(1000, entry.hoverAmount));

    if (entry.readyTimerMs < 0x100) {
      entry.readyTimerMs = Math.min(0x100, entry.readyTimerMs + dtMs);
    }

    if (!enabled) {
      return;
    }

    const layout = this._contentLayout();
    const scale = layout.scale;
    const basePos = layout.basePos;
    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;

    const consumedClick = this._updatePlayerCount(layout.dropPos, scale, { font: font });
    if (consumedClick) {
      return;
    }

    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
    const buttonEnabled = !this._playerListOpen;

    let y = basePos.y;
    const [entries, yStep, yStart, yEnd] = this._modeEntries();
    y += yStart * scale;
    for (const mode of entries) {
      const [clicked, hovered] = this._updateModeButton(mode, new Vec2(basePos.x, y), scale, { resources: resources, dtMs: dtMs, mouse: mouse, click: click, enabled: buttonEnabled });
      this._updateTooltipTimer(mode.key, hovered, dtMs);
      if (clicked) {
        this._activateMode(mode);
        return;
      }
      y += yStep * scale;
    }

    // Decay timers for modes that aren't visible right now.
    const visible = new Set(Array.from(entries).map((m) => m.key));
    for (const key of Array.from(this._tooltipMs.keys())) {
      if ((visible as ReadonlySet<unknown>).has(key)) {
        continue;
      }
      this._tooltipMs.set(key, Math.max(0, mapGetOrThrow(this._tooltipMs, key) - dtMs * 2));
    }
  }

  protected _beginCloseTransition(action: string): void {
    if (this._dirty) {
      let _trySucceeded168 = false;
      try {
        this.state.config.save();
        _trySucceeded168 = true;
      } catch (exc) {
        this.state.console.log.log(`config: save failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
      if (_trySucceeded168) {
        this._dirty = false;
      }
    }
    super._beginCloseTransition(action);
  }

  protected _contentLayout(): PlayGameContentLayout {
    const [panelScale, localShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW });
    const panelTopLeft = (new Vec2(this._panelPos.x + slideX, this._panelPos.y + this._widescreenYShift).add(this._panelOffset.mul(panelScale)));

    // `sub_44ed80`:
    //   xy = panel_offset_x + panel_x + 330 - 64  (+ animated X offset)
    //   var_1c = panel_offset_y + panel_y + 50
    const basePos = panelTopLeft.add(new Vec2(266.0 * panelScale, 50.0 * panelScale));
    const dropPos = basePos.add(new Vec2(80.0 * panelScale, 1.0 * panelScale));

    return new PlayGameContentLayout({ scale: panelScale, basePos: basePos, dropPos: dropPos });
  }

  protected _questsTotalPlayed(): number {
    const counts = this.state.status.questPlayCounts;
    if (!counts) {
      return 0;
    }
    // `sub_44ed80` sums 40 ints from game_status_blob+0x104..0x1a4.
    // Our `quest_play_counts` array starts at blob+0xd8, so this is indices 11..50.
    return int(counts.slice(11, 51).reduce((total, v) => total + int(v), 0));
  }

  protected _lanLockstepEnabled(): boolean {
    const cvar = this.state.console.cvars.get('cv_lanLockstepEnabled') ?? null;
    if (cvar === null) {
      return true;
    }
    return Boolean(cvar.valueF);
  }

  protected _modeEntries(): [PlayGameModeEntry[], number, number, number] {
    const config = this.state.config;
    const status = this.state.status;

    // Clamp to a valid range; older configs in the repo can contain 0 here,
    // which would incorrectly hide the Tutorial entry (it is gated on == 1).
    let playerCount = config.gameplay.playerCount;
    if (playerCount < 1) {
      playerCount = 1;
    }
    if (playerCount > this._PLAYER_COUNT_LABELS.length) {
      playerCount = this._PLAYER_COUNT_LABELS.length;
    }
    const questUnlock = int(status.questUnlockIndex);
    const fullVersion = !this.state.demoEnabled;

    const questsTotal = this._questsTotalPlayed();
    const rushTotal = int(status.modePlayCountForMode(GameMode.RUSH));
    const survivalTotal = int(status.modePlayCountForMode(GameMode.SURVIVAL));
    // Matches the tutorial placement gating in `sub_44ed80` (excludes Typ-o).
    const mainTotal = questsTotal + rushTotal + survivalTotal;

    // `sub_44ed80` uses tighter spacing when quest_unlock>=40 and player_count==1.
    const tightSpacing = !(questUnlock < 0x28 || playerCount > 1);
    const yStep = tightSpacing ? 28.0 : 32.0;
    const yStart = tightSpacing ? 26.0 : 32.0;

    const hasTypo = tightSpacing && fullVersion && playerCount === 1;
    const showTutorial = playerCount === 1;

    const entries: PlayGameModeEntry[] = [];
    if (showTutorial && mainTotal <= 0) {
      entries.push(new PlayGameModeEntry({ key: 'tutorial', label: 'Tutorial', tooltip: 'Learn how to play Crimsonland.', action: 'start_tutorial', gameMode: GameMode.TUTORIAL }));
    }

    entries.push(...[new PlayGameModeEntry({ key: 'quests', label: ' Quests ', tooltip: 'Unlock new weapons and perks in Quest mode.', action: 'open_quests', showCount: true }), new PlayGameModeEntry({ key: 'rush', label: '  Rush  ', tooltip: 'Face a rush of aliens in Rush mode.', action: 'start_rush', gameMode: GameMode.RUSH, showCount: true }), new PlayGameModeEntry({ key: 'survival', label: 'Survival', tooltip: 'Gain perks and weapons and fight back.', action: 'start_survival', gameMode: GameMode.SURVIVAL, showCount: true })]);

    if (hasTypo) {
      entries.push(new PlayGameModeEntry({ key: 'typo', label: 'Typ\'o\'Shooter', tooltip: 'Use your typing skills as the weapon to lay\nthem down.', action: 'start_typo', gameMode: GameMode.TYPO, showCount: true }));
    }

    if (showTutorial && mainTotal > 0) {
      entries.push(new PlayGameModeEntry({ key: 'tutorial', label: 'Tutorial', tooltip: 'Learn how to play Crimsonland.', action: 'start_tutorial', gameMode: GameMode.TUTORIAL }));
    }

    if (this._lanLockstepEnabled()) {
      entries.push(new PlayGameModeEntry({ key: 'lan', label: ' Network ', tooltip: 'Host or join a rollback-first network session.', action: 'open_lan_session' }));
    }

    // The y after the last row is used as a tooltip anchor in `sub_44ed80`.
    const yEnd = yStart + yStep * entries.length;
    return [entries, yStep, yStart, yEnd];
  }

  protected _modeButtonState(mode: PlayGameModeEntry): UiButtonState {
    let state = this._modeButtons.get(mode.key) ?? null;
    if (state === null) {
      state = new UiButtonState({ label: mode.label });
      this._modeButtons.set(mode.key, state);
    } else {
      state.label = mode.label;
    }
    return state;
  }

  protected _updateModeButton(mode: PlayGameModeEntry, pos: Vec2, scale: number, opts: { resources: RuntimeResources; dtMs: number; mouse: wgl.Vector2; click: boolean; enabled: boolean }): [boolean, boolean] {
    const resources = opts.resources;
    const dtMs = opts.dtMs;
    const mouse = opts.mouse;
    const click = opts.click;
    const enabled = opts.enabled;
    const state = this._modeButtonState(mode);
    state.enabled = enabled;
    const width = buttonWidth(resources, state.label, { scale: scale, forceWide: state.forceWide });
    const clicked = buttonUpdate(state, { pos: pos, width: width, dtMs: dtMs, mouse: mouse, click: click });
    return [clicked, state.hovered];
  }

  protected _activateMode(mode: PlayGameModeEntry): void {
    if (mode.gameMode !== null) {
      this.state.config.gameplay.mode = (() => { const value = int(mode.gameMode); if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
      this._dirty = true;
    }
    this._beginCloseTransition(mode.action);
  }

  protected _updateTooltipTimer(key: string, hovered: boolean, dtMs: number): void {
    let value = int(this._tooltipMs.get(key) ?? 0);
    if (hovered) {
      value += dtMs * 6;
    } else {
      value -= dtMs * 2;
    }
    this._tooltipMs.set(key, Math.max(0, Math.min(1000, value)));
  }

  protected _playerCountWidgetLayout(pos: Vec2, scale: number, opts: { font: SmallFontData }): PlayerCountWidgetLayout {
    const font = opts.font;
    // Return Play Game player-count dropdown metrics.
    //
    // `ui_list_widget_update` (0x43efc0):
    //   - width = max(label_w) + 0x30
    //   - header height = 16
    //   - open height = (count * 16) + 0x18
    //   - arrow icon = 16x16 at (x + width - 16 - 1, y)
    //   - selected label at (x + 4, y + 1)
    //   - list rows start at y + 17, step 16
    const textScale = 1.0 * scale;
    let maxLabelW = 0.0;
    for (const label of this._PLAYER_COUNT_LABELS) {
      maxLabelW = Math.max(maxLabelW, measureSmallTextWidth(font, label));
    }
    const width = maxLabelW + 48.0 * scale;
    const headerH = 16.0 * scale;
    const rowH = 16.0 * scale;
    const fullH = (this._PLAYER_COUNT_LABELS.length * 16.0 + 24.0) * scale;
    const arrow = 16.0 * scale;
    return new PlayerCountWidgetLayout({ pos: pos, width: width, headerH: headerH, rowH: rowH, rowsY0: pos.y + 17.0 * scale, fullH: fullH, arrowPos: new Vec2(pos.x + width - arrow - 1.0 * scale, pos.y), arrowSize: new Vec2(arrow, arrow), textPos: pos.add(new Vec2(4.0 * scale, 1.0 * scale)), textScale: textScale });
  }

  protected _updatePlayerCount(pos: Vec2, scale: number, opts: { font: SmallFontData }): boolean {
    const font = opts.font;
    const config = this.state.config;
    const layout = this._playerCountWidgetLayout(pos, scale, { font: font });

    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const hoveredHeader = mouseInsideRectWithPadding(mouse, { pos: layout.pos, width: layout.width, height: 14.0 * scale });
    if (hoveredHeader && InputState.wasMouseButtonPressed(0)) {
      this._playerListOpen = !this._playerListOpen;
      return true;
    }

    if (!this._playerListOpen) {
      return false;
    }

    // Close if we click outside the dropdown + list.
    const listHovered = Rect.fromTopLeft(layout.pos, layout.width, layout.fullH).contains(mouse);
    if (InputState.wasMouseButtonPressed(0) && !listHovered) {
      this._playerListOpen = false;
      return true;
    }

    for (const [idx, label] of this._PLAYER_COUNT_LABELS.entries()) {
      const itemY = layout.rowsY0 + layout.rowH * idx;
      const itemHovered = mouseInsideRectWithPadding(mouse, { pos: new Vec2(layout.pos.x, itemY), width: layout.width, height: 14.0 * scale });
      if (itemHovered && InputState.wasMouseButtonPressed(0)) {
        config.gameplay.playerCount = idx + 1;
        this._dirty = true;
        this._playerListOpen = false;
        return true;
      }
    }
    return false;
  }

  protected _drawContents(): void {
    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;
    const labelsTex = resources.texture(TextureId.UI_ITEM_TEXTS);
    const layout = this._contentLayout();
    const basePos = layout.basePos;
    const scale = layout.scale;
    const textScale = 1.0 * scale;
    const textColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);

    // `sub_44ed80`: title label at (xy - 64, var_1c - 8), size 128x32.
    const titleW = 128.0;
    const titleH = MENU_LABEL_ROW_HEIGHT;
    const titlePos = basePos.add(new Vec2(-64.0 * scale, -8.0 * scale));

    const src = wgl.makeRectangle(0.0, MENU_LABEL_ROW_PLAY_GAME * MENU_LABEL_ROW_HEIGHT, titleW, titleH);
    const dst = wgl.makeRectangle(titlePos.x, titlePos.y, titleW * scale, titleH * scale);
    wgl.drawTexturePro(labelsTex, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    const [entries, yStep, yStart, yEnd] = this._modeEntries();
    let y = basePos.y + yStart * scale;
    const showCounts = debugEnabled() && InputState.isKeyDown(112);

    if (showCounts) {
      drawSmallText(font, 'times played:', basePos.add(new Vec2(132.0 * scale, 16.0 * scale)), textColor);
    }

    for (const mode of entries) {
      this._drawModeButton(mode, new Vec2(basePos.x, y), scale, { resources: resources, font: font });
      if (showCounts && mode.showCount) {
        this._drawModeCount(
          mode.key,
          new Vec2(basePos.x + 158.0 * scale, y + 8.0 * scale),
          textScale,
          textColor,
          { font: font },
        );
      }
      y += yStep * scale;
    }

    // `sub_44ed80`: the list widget is drawn before tooltips, so tooltips can overlay it.
    this._drawPlayerCount(layout.dropPos, scale, { resources: resources, font: font });
    this._drawTooltips(entries, basePos, yEnd, scale, { font: font });
  }

  protected _drawPlayerCount(pos: Vec2, scale: number, opts: { resources: RuntimeResources; font: SmallFontData }): void {
    const resources = opts.resources;
    const font = opts.font;
    const dropOn = resources.texture(TextureId.UI_DROP_ON);
    const dropOff = resources.texture(TextureId.UI_DROP_OFF);
    const layout = this._playerCountWidgetLayout(pos, scale, { font: font });

    // `ui_list_widget_update` draws a single bordered black rect for the widget.
    const widgetH = this._playerListOpen ? layout.fullH : layout.headerH;
    wgl.drawRectangle(int(layout.pos.x), int(layout.pos.y), int(layout.width), int(widgetH), wgl.makeColor(1, 1, 1, 1));
    const innerW = Math.max(0, int(layout.width) - 2);
    const innerH = Math.max(0, int(widgetH) - 2);
    wgl.drawRectangle(int(layout.pos.x) + 1, int(layout.pos.y) + 1, innerW, innerH, wgl.makeColor(0, 0, 0, 1));

    // Arrow icon (the ui_drop* assets are 16x16 icons, not the background).
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const hoveredHeader = mouseInsideRectWithPadding(mouse, { pos: layout.pos, width: layout.width, height: 14.0 * scale });
    const arrowTex = (this._playerListOpen || hoveredHeader) ? dropOn : dropOff;
    if (this._playerListOpen || hoveredHeader) {
      const lineH = Math.max(1, int(1.0 * scale));
      wgl.drawRectangle(int(layout.pos.x), int(layout.pos.y + 15.0 * scale), int(layout.width), lineH, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 128 / 255));
    }
    wgl.drawTexturePro(arrowTex, wgl.makeRectangle(0.0, 0.0, arrowTex.width, arrowTex.height), wgl.makeRectangle(layout.arrowPos.x, layout.arrowPos.y, layout.arrowSize.x, layout.arrowSize.y), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    let playerCount = this.state.config.gameplay.playerCount;
    if (playerCount < 1) {
      playerCount = 1;
    }
    if (playerCount > this._PLAYER_COUNT_LABELS.length) {
      playerCount = this._PLAYER_COUNT_LABELS.length;
    }
    const label = this._PLAYER_COUNT_LABELS[playerCount - 1];
    const headerAlpha = hoveredHeader ? 242 : 191; // 0x3f733333 / 0x3f400000
    drawSmallText(font, label, layout.textPos, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, headerAlpha / 255));

    if (!this._playerListOpen) {
      return;
    }

    for (const [idx, item] of this._PLAYER_COUNT_LABELS.entries()) {
      const itemY = layout.rowsY0 + layout.rowH * idx;
      const hovered = mouseInsideRectWithPadding(mouse, { pos: new Vec2(layout.pos.x, itemY), width: layout.width, height: 14.0 * scale });
      let alpha = 153; // 0x3f19999a
      if (hovered) {
        alpha = 242; // 0x3f733333
      }
      if (idx === (playerCount - 1)) {
        alpha = Math.max(alpha, 245); // 0x3f75c28f
      }
      drawSmallText(font, item, new Vec2(layout.textPos.x, itemY), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255));
    }
  }

  protected _drawModeButton(mode: PlayGameModeEntry, pos: Vec2, scale: number, opts: { resources: RuntimeResources; font: SmallFontData }): void {
    const resources = opts.resources;
    const font = opts.font;
    const state = this._modeButtonState(mode);
    const width = buttonWidth(resources, state.label, { scale: scale, forceWide: state.forceWide });
    buttonDraw(resources, state, { pos: pos, width: width, scale: scale });
  }

  protected _drawModeCount(key: string, pos: Vec2, scale: number, color: wgl.Color, opts: { font: SmallFontData }): void {
    const font = opts.font;
    const status = this.state.status;
    let count: number;
    if (key === 'quests') {
      count = this._questsTotalPlayed();
    } else if (key === 'rush') {
      count = int(status.modePlayCountForMode(GameMode.RUSH));
    } else if (key === 'survival') {
      count = int(status.modePlayCountForMode(GameMode.SURVIVAL));
    } else if (key === 'typo') {
      count = int(status.modePlayCountForMode(GameMode.TYPO));
    } else {
      return;
    }
    drawSmallText(font, `${count}`, pos, color);
  }

  protected _drawTooltips(entries: PlayGameModeEntry[], basePos: Vec2, yEnd: number, scale: number, opts: { font: SmallFontData }): void {
    const font = opts.font;
    // `sub_44ed80` draws these below the mode list based on per-button hover timers.
    const tooltipX = basePos.x - 55.0 * scale;
    const tooltipY = basePos.y + (yEnd + 16.0) * scale;

    const offsets: Record<string, [number, number]> = { "quests": [-8.0, 0.0], "rush": [32.0, 0.0], "survival": [20.0, 0.0], "typo": [0.0, -12.0], "tutorial": [38.0, 0.0] };

    for (const mode of entries) {
      const ms = int(this._tooltipMs.get(mode.key) ?? 0);
      if (ms <= 0) {
        continue;
      }
      const alphaF = Math.min(1.0, ms * 0.0009);
      const alpha = int(255 * alphaF);
      const [offX, offY] = offsets[mode.key] ?? [0.0, 0.0];
      const x = tooltipX + offX * scale;
      let y = tooltipY + offY * scale;
      for (const line of pythonSplitlines(mode.tooltip)) {
        drawSmallText(font, line, new Vec2(x, y), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255));
        y += font.cellSize * 1.0 * scale;
      }
    }
  }
}
