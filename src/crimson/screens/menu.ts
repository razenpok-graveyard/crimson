// Port of crimson/screens/menu.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import { playMusic, playSfx, stopMusic, updateAudio } from '@grim/audio.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { GroundRenderer } from '@grim/terrain-render.ts';
import { GameState } from '@crimson/game/types.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { resolveTerrainSlots } from '@crimson/terrain-slots.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { existsSync, readdirSync } from 'node:fs';
import * as wgl from '@wgl';

export interface TimelineView {
  _timelineMs: number;
}

export const MENU_LABEL_WIDTH = 122.0;
export const MENU_LABEL_HEIGHT = 28.0;
export const MENU_LABEL_ROW_HEIGHT = 32.0;
export const MENU_LABEL_ROW_PLAY_GAME = 1;
export const MENU_LABEL_ROW_OPTIONS = 2;
export const MENU_LABEL_ROW_STATISTICS = 3;
export const MENU_LABEL_ROW_MODS = 4;
export const MENU_LABEL_ROW_OTHER_GAMES = 5;
export const MENU_LABEL_ROW_QUIT = 6;
export const MENU_LABEL_ROW_BACK = 7;
export const MENU_LABEL_BASE_X = -60.0;
export const MENU_LABEL_BASE_Y = 210.0;
export const MENU_LABEL_OFFSET_X = 271.0;
export const MENU_LABEL_OFFSET_Y = -37.0;
export const MENU_LABEL_STEP = 60.0;
export const MENU_ITEM_OFFSET_X = -71.0;
export const MENU_ITEM_OFFSET_Y = -59.0;
export const MENU_PANEL_WIDTH = 510.0;
export const MENU_PANEL_HEIGHT = 254.0;
// Measured from ui_render_trace at 1024x768 (stable timeline):
// panel top-left is (pos_x + 21, pos_y - 81) and size is 510x254, plus a shadow pass at +7,+7.
export const MENU_PANEL_OFFSET_X = 21.0;
export const MENU_PANEL_OFFSET_Y = -81.0;
export const MENU_PANEL_BASE_X = -45.0;
export const MENU_PANEL_BASE_Y = 210.0;
export const MENU_SCALE_SMALL_THRESHOLD = 640;
export const MENU_SCALE_LARGE_MIN = 801;
export const MENU_SCALE_LARGE_MAX = 1024;
export const MENU_SCALE_SMALL = 0.8;
export const MENU_SCALE_LARGE = 1.2;
export const MENU_SCALE_SHIFT = 10.0;
export const MENU_SIGN_WIDTH = 571.44;
export const MENU_SIGN_HEIGHT = 141.36;
export const MENU_SIGN_OFFSET_X = -576.44;
export const MENU_SIGN_OFFSET_Y = -61.0;
export const MENU_SIGN_POS_Y = 70.0;
export const MENU_SIGN_POS_Y_SMALL = 60.0;
export const MENU_SIGN_POS_X_PAD = 4.0;
// Measured in the shareware/demo attract loop trace:
// {"event":"demo_mode_start","dt_since_start_ms":23024,"game_state_id":0,"demo_mode_active":0,...}
export const MENU_DEMO_IDLE_START_MS = 23_000;

function _pathJoin(...parts: Array<string | number>): string {
  const cleaned = parts.map((part, idx) => {
    const text = String(part);
    if (idx === 0) {
      const stripped = text.replace(/\/+$/g, '');
      if (stripped === '.') {
        return '';
      }
      return text === '/' ? '/' : stripped;
    }
    return text.replace(/^\/+|\/+$/g, '');
  }).filter((part) => part.length > 0);
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned[0] === '/') {
    return `/${cleaned.slice(1).join('/')}`;
  }
  return cleaned.join('/');
}

function _globPath(dir: string, pattern: string): string[] {
  const regexp = _globPattern(pattern);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && regexp.test(entry.name))
    .map((entry) => _pathJoin(dir, entry.name));
}

function _globPattern(pattern: string): RegExp {
  let source = '';
  for (const char of pattern) {
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
    }
  }
  return new RegExp(`^${source}$`);
}

function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left !== null && left !== undefined && typeof left === 'object') {
    const equal = Reflect.get(left, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(left, right));
    }
  }
  if (right !== null && right !== undefined && typeof right === 'object') {
    const equal = Reflect.get(right, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(right, left));
    }
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => pythonEquals(value, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));
  }
  return false;
}

function zip<A, B>(a: readonly A[], b: readonly B[], opts?: { strict?: boolean }): [A, B][];
function zip<A, B, C>(a: readonly A[], b: readonly B[], c: readonly C[], opts?: { strict?: boolean }): [A, B, C][];
function zip(...args: unknown[]): unknown[][] {
  const last = args.at(-1);
  const hasOpts = last !== null && typeof last === 'object' && !Array.isArray(last) && Object.prototype.hasOwnProperty.call(last, 'strict');
  const arrays = (hasOpts ? args.slice(0, -1) : args) as readonly unknown[][];
  const length = arrays.length === 0 ? 0 : Math.min(...arrays.map((array) => array.length));
  return Array.from({ length }, (_, index) => arrays.map((array) => array[index]));
}

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0 && !Number.isNaN(value);
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }
  return true;
}

export class MenuEntry {
  slot: number;
  row: number;
  y: number;
  hoverAmount: number;
  readyTimerMs: number;

  constructor(opts: {
    slot: number;
    row: number;
    y: number;
    hoverAmount?: number;
    readyTimerMs?: number;
  }) {
    this.slot = opts.slot;
    this.row = opts.row;
    this.y = opts.y;
    this.hoverAmount = opts.hoverAmount ?? 0;
    this.readyTimerMs = opts.readyTimerMs ?? 0x100;
  }
}

export class MenuView {
  state: GameState;
  protected _isOpen: boolean;
  protected _ground: GroundRenderer | null;
  protected _menuEntries: MenuEntry[];
  protected _selectedIndex: number;
  protected _focusTimerMs: number;
  protected _hoveredIndex: number | null;
  protected _fullVersion: boolean;
  _timelineMs: number;
  protected _timelineMaxMs: number;
  protected _idleMs: number;
  protected _lastMousePos: Vec2;
  protected _cursorPulseTime: number;
  protected _widescreenYShift: number;
  protected _menuScreenWidth: number;
  protected _closing: boolean;
  protected _closeAction: string | null;
  protected _pendingAction: string | null;
  protected _panelOpenSfxPlayed: boolean;

  get isOpen(): boolean {
    return this._isOpen;
  }
  get ground(): GroundRenderer | null {
    return this._ground;
  }
  get menuEntries(): MenuEntry[] {
    return this._menuEntries;
  }
  get selectedIndex(): number {
    return this._selectedIndex;
  }
  get focusTimerMs(): number {
    return this._focusTimerMs;
  }
  get hoveredIndex(): number | null {
    return this._hoveredIndex;
  }
  get fullVersion(): boolean {
    return this._fullVersion;
  }
  get timelineMaxMs(): number {
    return this._timelineMaxMs;
  }
  get idleMs(): number {
    return this._idleMs;
  }
  get lastMousePos(): Vec2 {
    return this._lastMousePos;
  }
  get cursorPulseTime(): number {
    return this._cursorPulseTime;
  }
  get widescreenYShift(): number {
    return this._widescreenYShift;
  }
  get menuScreenWidth(): number {
    return this._menuScreenWidth;
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
  get panelOpenSfxPlayed(): boolean {
    return this._panelOpenSfxPlayed;
  }

  constructor(state: GameState) {
    this.state = state;
    this._isOpen = false;
    this._ground = null;
    this._menuEntries = [];
    this._selectedIndex = 0;
    this._focusTimerMs = 0;
    this._hoveredIndex = null;
    this._fullVersion = false;
    this._timelineMs = 0;
    this._timelineMaxMs = 0;
    this._idleMs = 0;
    this._lastMousePos = new Vec2();
    this._cursorPulseTime = 0.0;
    this._widescreenYShift = 0.0;
    this._menuScreenWidth = 0;
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._panelOpenSfxPlayed = false;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._menuScreenWidth = int(layoutW);
    this._widescreenYShift = MenuView._menuWidescreenYShift(layoutW);
    // Shareware gating is controlled by the --demo flag (see GameState.demo_enabled),
    // not by a persisted config byte.
    this._fullVersion = !this.state.demoEnabled;
    this._menuEntries = this._menuEntriesForFlags(this._fullVersion, this._modsAvailable(), this._otherGamesEnabled());
    this._selectedIndex = this._menuEntries.length > 0 ? 0 : -1;
    this._focusTimerMs = 0;
    this._hoveredIndex = null;
    this._timelineMs = 0;
    this._idleMs = 0;
    this._cursorPulseTime = 0.0;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    this._lastMousePos = Vec2.fromXY(mouse);
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._panelOpenSfxPlayed = false;
    this._timelineMaxMs = MenuView._menuMaxTimelineMs(this._fullVersion, this._modsAvailable(), this._otherGamesEnabled());
    this._initGround();
    if (this.state.audio !== null) {
      const theme = this.state.demoEnabled ? 'crimsonquest' : 'crimson_theme';
      if (this.state.audio.music.activeTrack !== theme) {
        stopMusic(this.state.audio);
      }
      playMusic(this.state.audio, theme);
    }
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
    this._ground = null;
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      if (!this._closing) {
        const theme = this.state.demoEnabled ? 'crimsonquest' : 'crimson_theme';
        playMusic(this.state.audio, theme);
      }
      updateAudio(this.state.audio, dt);
    }
    if (this._ground !== null) {
      this._ground.processPending();
    }
    this._cursorPulseTime += Math.min(dt, 0.1) * 1.1;
    const dtMs = int(Math.min(dt, 0.1) * 1000.0);
    if (this._closing) {
      if (dtMs > 0 && this._pendingAction === null) {
        this._timelineMs -= dtMs;
        this._focusTimerMs = Math.max(0, this._focusTimerMs - dtMs);
        if (this._timelineMs < 0 && this._closeAction !== null) {
          this._pendingAction = this._closeAction;
          this._closeAction = null;
        }
      }
      return;
    }

    if (dtMs > 0) {
      const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
      const mousePos = Vec2.fromXY(mouse);
      const mouseMoved = !pythonEquals(mousePos, this._lastMousePos);
      if (mouseMoved) {
        this._lastMousePos = mousePos;
      }

      const anyKey = InputState.getKeyPressed() !== 0;
      const anyClick = (InputState.wasMouseButtonPressed(0) || InputState.wasMouseButtonPressed(2) || InputState.wasMouseButtonPressed(1));

      if (anyKey || anyClick || mouseMoved) {
        this._idleMs = 0;
      } else {
        this._idleMs += dtMs;
      }
    }

    if (dtMs > 0) {
      this._timelineMs = Math.min(this._timelineMaxMs, this._timelineMs + dtMs);
      this._focusTimerMs = Math.max(0, this._focusTimerMs - dtMs);
      if (this._timelineMs >= this._timelineMaxMs) {
        this.state.menuSignLocked = true;
        if (!this._panelOpenSfxPlayed && (this.state.audio !== null)) {
          playSfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }
    if (this._menuEntries.length === 0) {
      return;
    }

    const resources = requireRuntimeResources(this.state);
    this._hoveredIndex = this._hoveredEntryIndex(resources);

    if (InputState.wasKeyPressed(9)) {
      const reverse = InputState.isKeyDown(16) || InputState.isKeyDown(16);
      const delta = reverse ? -1 : 1;
      this._selectedIndex = (((this._selectedIndex + delta) % this._menuEntries.length) + this._menuEntries.length) % this._menuEntries.length;
      this._focusTimerMs = 1000;
    }

    let activatedIndex: number | null = null;
    let entry: any;
    if (InputState.wasKeyPressed(13) && this._selectedIndex >= 0 && this._selectedIndex < this._menuEntries.length) {
      entry = this._menuEntries[this._selectedIndex];
      if (this._menuEntryEnabled(entry)) {
        activatedIndex = this._selectedIndex;
      }
    }

    if (activatedIndex === null && this._hoveredIndex !== null) {
      if (InputState.wasMouseButtonPressed(0)) {
        const hovered = this._hoveredIndex;
        entry = this._menuEntries[hovered];
        if (this._menuEntryEnabled(entry)) {
          this._selectedIndex = hovered;
          this._focusTimerMs = 1000;
          activatedIndex = hovered;
        }
      }
    }

    if (activatedIndex !== null) {
      this._activateMenuEntry(activatedIndex);
    }
    if (!this._closing && this._pendingAction === null && this.state.demoEnabled && this._timelineMs >= this._timelineMaxMs && this._idleMs >= MENU_DEMO_IDLE_START_MS) {
      this._beginCloseTransition('start_demo');
    }
    this._updateReadyTimers(dtMs);
    this._updateHoverAmounts(dtMs);
  }

  draw(): void {
    this._assertOpen();
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    if (this._ground !== null) {
      this._ground.draw(menuGroundCamera(this.state));
    }
    drawScreenFade(this.state);
    const resources = requireRuntimeResources(this.state);
    this._drawMenuItems(resources);
    this._drawMenuSign(resources);
    _drawMenuCursor(this.state, { resources: resources, pulseTime: this._cursorPulseTime });
  }

  takeAction(): string | null {
    this._assertOpen();
    const action = this._pendingAction;
    this._pendingAction = null;
    return action;
  }

  _assertOpen(): void {
    if (!(this._isOpen)) throw new Error('MenuView must be opened before use');
  }

  _activateMenuEntry(index: number): void {
    if (!(index >= 0 && index < this._menuEntries.length)) {
      return;
    }
    const entry = this._menuEntries[index];
    if (this.state.audio !== null) {
      playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
    }
    this.state.console.log.log(`menu select: ${index} (row ${entry.row})`);
    this.state.console.log.flush();
    if (entry.row === MENU_LABEL_ROW_QUIT) {
      this._beginQuitTransition();
    } else if (entry.row === MENU_LABEL_ROW_PLAY_GAME) {
      this._beginCloseTransition('open_play_game');
    } else if (entry.row === MENU_LABEL_ROW_OPTIONS) {
      this._beginCloseTransition('open_options');
    } else if (entry.row === MENU_LABEL_ROW_STATISTICS) {
      this._beginCloseTransition('open_statistics');
    } else if (entry.row === MENU_LABEL_ROW_MODS) {
      this._beginCloseTransition('open_mods');
    } else if (entry.row === MENU_LABEL_ROW_OTHER_GAMES) {
      this._beginCloseTransition('open_other_games');
    }
  }

  _beginCloseTransition(action: string): void {
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  _beginQuitTransition(): void {
    this.state.menuSignLocked = false;
    this._beginCloseTransition(this.state.demoEnabled ? 'quit_after_demo' : 'quit_app');
  }

  _initGround(): void {
    this._ground = ensureMenuGround(this.state);
  }

  _menuEntriesForFlags(fullVersion: boolean, modsAvailable: boolean, otherGames: boolean): MenuEntry[] {
    const rows = MenuView._menuLabelRows(fullVersion, otherGames);
    const slotYs = MenuView._menuSlotYs(otherGames, this._widescreenYShift);
    const active = MenuView._menuSlotActive(fullVersion, modsAvailable, otherGames);
    const entries: MenuEntry[] = [];
    for (const [slot, [row, y, enabled]] of zip(rows, slotYs, active, { strict: false }).entries()) {
      if (!enabled) {
        continue;
      }
      entries.push(new MenuEntry({ slot: slot, row: row, y: y }));
    }
    return entries;
  }

  static _menuLabelRows(fullVersion: boolean, otherGames: boolean): number[] {
    // Label atlas rows in ui_itemTexts.jaz:
    //   0 BUY NOW (unused in rewrite), 1 PLAY GAME, 2 OPTIONS, 3 STATISTICS, 4 MODS,
    //   5 OTHER GAMES, 6 QUIT, 7 BACK
    const top = 4;
    if (otherGames) {
      return [top, 1, 2, 3, 5, 6];
    }
    // ui_menu_layout_init swaps table idx 6/7 depending on config var 100:
    // when empty, QUIT becomes idx 6 and the idx 7 element is inactive.
    return [top, 1, 2, 3, 6, 7];
  }

  static _menuSlotYs(otherGames: boolean, yShift: number): number[] {
    const ys = [MENU_LABEL_BASE_Y, MENU_LABEL_BASE_Y + MENU_LABEL_STEP, MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 2.0, MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 3.0, MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 4.0, MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 5.0];
    return ys.map((y) => y + yShift);
  }

  static _menuSlotActive(fullVersion: boolean, modsAvailable: boolean, otherGames: boolean): boolean[] {
    const showTop = modsAvailable;
    if (otherGames) {
      return [showTop, true, true, true, true, true];
    }
    return [showTop, true, true, true, true, false];
  }

  _drawMenuItems(resources: RuntimeResources): void {
    if (this._menuEntries.length === 0) {
      return;
    }
    const item = resources.texture(TextureId.UI_MENU_ITEM);
    const labelTex = resources.texture(TextureId.UI_ITEM_TEXTS);
    const itemW = item.width;
    const itemH = item.height;
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    // Matches ui_elements_update_and_render reverse table iteration:
    // later entries draw first, earlier entries draw last (on top).
    for (let idx = this._menuEntries.length - 1; -1 >= 0 ? idx < -1 : idx > -1; idx += -1) {
      const entry = this._menuEntries[idx];
      const pos = new Vec2(MenuView._menuSlotPosX(entry.slot), entry.y);
      const [angleRad, slideX] = this._uiElementAnim({ index: entry.slot + 2, startMs: MenuView._menuSlotStartMs(entry.slot), endMs: MenuView._menuSlotEndMs(entry.slot), width: itemW });
      const _ = slideX; // slide is ignored for render_mode==0 (transform) elements
      const [itemScale, localYShift] = this._menuItemScale(entry.slot);
      const offsetX = MENU_ITEM_OFFSET_X * itemScale;
      const offsetY = MENU_ITEM_OFFSET_Y * itemScale - localYShift;
      const dst = wgl.makeRectangle(pos.x, pos.y, itemW * itemScale, itemH * itemScale);
      const origin = wgl.makeVector2(-offsetX, -offsetY);
      const rotationDeg = (angleRad) * (180.0 / Math.PI);
      if (fxDetail) {
        MenuView._drawUiQuadShadow({
          texture: item,
          src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
          dst: wgl.makeRectangle(dst.x + UI_SHADOW_OFFSET, dst.y + UI_SHADOW_OFFSET, dst.w, dst.h),
          origin: origin,
          rotationDeg: rotationDeg,
        });
      }
      MenuView._drawUiQuad({
        texture: item,
        src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
        dst: dst,
        origin: origin,
        rotationDeg: rotationDeg,
        tint: wgl.makeColor(1, 1, 1, 1),
      });
      let counterValue = entry.hoverAmount;
      if (idx === this._selectedIndex && this._focusTimerMs > 0) {
        counterValue = this._focusTimerMs;
      }
      const alpha = MenuView._labelAlpha(counterValue);
      const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255);
      const src = wgl.makeRectangle(0.0, entry.row * MENU_LABEL_ROW_HEIGHT, MENU_LABEL_WIDTH, MENU_LABEL_ROW_HEIGHT);
      const labelOffsetX = MENU_LABEL_OFFSET_X * itemScale;
      const labelOffsetY = MENU_LABEL_OFFSET_Y * itemScale - localYShift;
      const labelDst = wgl.makeRectangle(pos.x, pos.y, MENU_LABEL_WIDTH * itemScale, MENU_LABEL_HEIGHT * itemScale);
      const labelOrigin = wgl.makeVector2(-labelOffsetX, -labelOffsetY);
      MenuView._drawUiQuad({
        texture: labelTex,
        src: src,
        dst: labelDst,
        origin: labelOrigin,
        rotationDeg: rotationDeg,
        tint: tint,
      });
      let glowAlpha: number;
      if (this._menuEntryEnabled(entry)) {
        glowAlpha = alpha;
        if (0 <= entry.readyTimerMs && entry.readyTimerMs < 0x100) {
          glowAlpha = 0xFF - (Math.floor(entry.readyTimerMs / 2));
        }
        wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
        MenuView._drawUiQuad({
          texture: labelTex,
          src: src,
          dst: labelDst,
          origin: labelOrigin,
          rotationDeg: rotationDeg,
          tint: wgl.makeColor(255 / 255, 255 / 255, 255 / 255, glowAlpha / 255),
        });
        wgl.endBlendMode();
      }
    }
  }

  _modsAvailable(): boolean {
    const modsDir = _pathJoin(this.state.baseDir, 'mods');
    if (!existsSync(String(modsDir))) {
      return false;
    }
    return Array.from(_globPath(String(modsDir), '*.dll')).some(pythonTruthy);
  }

  _otherGamesEnabled(): boolean {
    // Original game checks a config string via grim_get_config_var(100).
    // Our config-var system is not implemented yet; allow a simple env opt-in.
    return (((globalThis.process?.env?.['CRIMSON_GRIM_CONFIG_VAR_100'] ?? '')).trim()) !== '';
  }

  _hoveredEntryIndex(resources: RuntimeResources): number | null {
    if (this._menuEntries.length === 0) {
      return null;
    }
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const mousePos = Vec2.fromXY(mouse);
    for (const [idx, entry] of this._menuEntries.entries()) {
      if (!this._menuEntryEnabled(entry)) {
        continue;
      }
      if (this._menuItemBounds(entry, resources).contains(mousePos)) {
        return idx;
      }
    }
    return null;
  }

  _updateReadyTimers(dtMs: number): void {
    for (const entry of this._menuEntries) {
      if (entry.readyTimerMs < 0x100) {
        entry.readyTimerMs = Math.min(0x100, entry.readyTimerMs + dtMs);
      }
    }
  }

  _updateHoverAmounts(dtMs: number): void {
    const hoveredIndex = this._hoveredIndex;
    for (const [idx, entry] of this._menuEntries.entries()) {
      const hover = hoveredIndex !== null && idx === hoveredIndex;
      if (hover) {
        entry.hoverAmount += dtMs * 6;
      } else {
        entry.hoverAmount -= dtMs * 2;
      }
      entry.hoverAmount = Math.max(0, Math.min(1000, entry.hoverAmount));
    }
  }

  static _labelAlpha(counterValue: number): number {
    // ui_element_render: alpha = 100 + floor(counter_value * 155 / 1000)
    return 100 + Math.floor((counterValue * 155) / 1000);
  }

  _menuEntryEnabled(entry: MenuEntry): boolean {
    return this._timelineMs >= MenuView._menuSlotStartMs(entry.slot);
  }

  static _menuWidescreenYShift(screenW: number): number {
    // ((screen_width / 640.0) * 150.0) - 150.0
    return (screenW * 0.0015625 * 150.0) - 150.0;
  }

  _menuItemScale(slot: number): [number, number] {
    if (this._menuScreenWidth < 641) {
      return [0.9, slot * 11.0];
    }
    return [1.0, 0.0];
  }

  _menuItemBounds(entry: MenuEntry, resources: RuntimeResources): Rect {
    // FUN_0044fb50: inset bounds derived from quad0 v0/v2 and pos_x/pos_y.
    const item = resources.texture(TextureId.UI_MENU_ITEM);
    const itemW = item.width;
    const itemH = item.height;
    const [itemScale, localYShift] = this._menuItemScale(entry.slot);
    const offsetMin = new Vec2(MENU_ITEM_OFFSET_X * itemScale, MENU_ITEM_OFFSET_Y * itemScale - localYShift);
    const offsetMax = new Vec2((MENU_ITEM_OFFSET_X + itemW) * itemScale, (MENU_ITEM_OFFSET_Y + itemH) * itemScale - localYShift);
    const size = offsetMax.sub(offsetMin);
    const pos = new Vec2(MenuView._menuSlotPosX(entry.slot), entry.y);
    const topLeft = pos.add(new Vec2(offsetMin.x + size.x * 0.54, offsetMin.y + size.y * 0.28));
    const bottomRight = pos.add(new Vec2(offsetMax.x - size.x * 0.05, offsetMax.y - size.y * 0.10));
    return Rect.fromPosSize(topLeft, bottomRight.sub(topLeft));
  }

  static _menuSlotPosX(slot: number): number {
    // ui_menu_layout_init: subtract 20, 40, ... from later menu items
    return MENU_LABEL_BASE_X - slot * 20;
  }

  static _menuSlotStartMs(slot: number): number {
    // ui_menu_layout_init: start_time_ms is the fully-visible time.
    return (slot + 2) * 100 + 300;
  }

  static _menuSlotEndMs(slot: number): number {
    // ui_menu_layout_init: end_time_ms is the fully-hidden time.
    return (slot + 2) * 100;
  }

  static _menuMaxTimelineMs(fullVersion: boolean, modsAvailable: boolean, otherGames: boolean): number {
    let maxMs = 300; // sign element at index 0
    const showTop = modsAvailable;
    const slotActive = [showTop, true, true, true, true, otherGames];
    for (const [slot, active] of slotActive.entries()) {
      if (!active) {
        continue;
      }
      maxMs = Math.max(maxMs, (slot + 2) * 100 + 300);
    }
    return maxMs;
  }

  _uiElementAnim(opts: { index: number; startMs: number; endMs: number; width: number; directionFlag?: number }): [number, number] {
    const index = opts.index;
    const startMs = opts.startMs;
    const endMs = opts.endMs;
    const width = opts.width;
    const directionFlag = opts.directionFlag ?? 0;
    // Matches ui_element_update: angle lerps pi/2 -> 0 over [end_ms, start_ms].
    // direction_flag=0 slides from left  (-width -> 0)
    // direction_flag=1 slides from right (+width -> 0)
    if (startMs <= endMs || width <= 0.0) {
      return [0.0, 0.0];
    }
    const dirSign = int(directionFlag) ? 1.0 : -1.0;
    const t = int(this._timelineMs);
    let angle: number;
    let offsetX: number;
    if (t < endMs) {
      angle = 1.5707964;
      offsetX = dirSign * Math.abs(width);
    } else if (t < startMs) {
      const elapsed = t - endMs;
      const span = (startMs - endMs);
      const p = elapsed / span;
      angle = 1.5707964 * (1.0 - p);
      offsetX = dirSign * ((1.0 - p) * Math.abs(width));
    } else {
      angle = 0.0;
      offsetX = 0.0;
    }
    if (index === 0) {
      angle = -Math.abs(angle);
    }
    return [angle, offsetX];
  }

  static _drawUiQuad(opts: { texture: rl.Texture; src: wgl.Rectangle; dst: wgl.Rectangle; origin: wgl.Vector2; rotationDeg: number; tint: wgl.Color }): void {
    const texture = opts.texture;
    const src = opts.src;
    const dst = opts.dst;
    const origin = opts.origin;
    const rotationDeg = opts.rotationDeg;
    const tint = opts.tint;
    wgl.drawTexturePro(texture, src, dst, origin, rotationDeg, tint);
  }

  static _drawUiQuadShadow(opts: { texture: rl.Texture; src: wgl.Rectangle; dst: wgl.Rectangle; origin: wgl.Vector2; rotationDeg: number }): void {
    const texture = opts.texture;
    const src = opts.src;
    const dst = opts.dst;
    const origin = opts.origin;
    const rotationDeg = opts.rotationDeg;
    drawUiQuadShadow({ texture: texture, src: src, dst: dst, origin: origin, rotationDeg: rotationDeg });
  }

  _drawMenuSign(resources: RuntimeResources): void {
    const screenW = this.state.config.display.width;
    const [scale, shiftX] = MenuView._signLayoutScale(int(screenW));
    const signPos = new Vec2(screenW + MENU_SIGN_POS_X_PAD, screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL);
    const signW = MENU_SIGN_WIDTH * scale;
    const signH = MENU_SIGN_HEIGHT * scale;
    const offsetX = MENU_SIGN_OFFSET_X * scale + shiftX;
    const offsetY = MENU_SIGN_OFFSET_Y * scale;
    let rotationDeg = 0.0;
    if (!this.state.menuSignLocked) {
      const [angleRad, slideX] = this._uiElementAnim({ index: 0, startMs: 300, endMs: 0, width: signW });
      const _ = slideX; // slide is ignored for render_mode==0 (transform) elements
      rotationDeg = (angleRad) * (180.0 / Math.PI);
    }
    const sign = resources.texture(TextureId.UI_SIGN_CRIMSON);
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    if (fxDetail) {
      MenuView._drawUiQuadShadow({
        texture: sign,
        src: wgl.makeRectangle(0.0, 0.0, sign.width, sign.height),
        dst: wgl.makeRectangle(signPos.x + UI_SHADOW_OFFSET, signPos.y + UI_SHADOW_OFFSET, signW, signH),
        origin: wgl.makeVector2(-offsetX, -offsetY),
        rotationDeg: rotationDeg,
      });
    }
    MenuView._drawUiQuad({
      texture: sign,
      src: wgl.makeRectangle(0.0, 0.0, sign.width, sign.height),
      dst: wgl.makeRectangle(signPos.x, signPos.y, signW, signH),
      origin: wgl.makeVector2(-offsetX, -offsetY),
      rotationDeg: rotationDeg,
      tint: wgl.makeColor(1, 1, 1, 1),
    });
  }

  static _signLayoutScale(width: number): [number, number] {
    if (width <= MENU_SCALE_SMALL_THRESHOLD) {
      return [MENU_SCALE_SMALL, MENU_SCALE_SHIFT];
    }
    if (MENU_SCALE_LARGE_MIN <= width && width <= MENU_SCALE_LARGE_MAX) {
      return [MENU_SCALE_LARGE, MENU_SCALE_SHIFT];
    }
    return [1.0, 0.0];
  }
}

export function labelAlpha(counterValue: number): number {
  return MenuView._labelAlpha(counterValue);
}

export function uiElementAnim(view: TimelineView, opts: { index: number; startMs: number; endMs: number; width: number; directionFlag?: number }): [number, number] {
  const index = opts.index;
  const startMs = opts.startMs;
  const endMs = opts.endMs;
  const width = opts.width;
  const directionFlag = opts.directionFlag ?? 0;
  if (startMs <= endMs || width <= 0.0) {
    return [0.0, 0.0];
  }
  const dirSign = int(directionFlag) ? 1.0 : -1.0;
  const t = int(view._timelineMs);
  let angle: number;
  let offsetX: number;
  if (t < endMs) {
    angle = 1.5707964;
    offsetX = dirSign * Math.abs(width);
  } else if (t < startMs) {
    const elapsed = t - endMs;
    const span = startMs - endMs;
    const p = elapsed / span;
    angle = 1.5707964 * (1.0 - p);
    offsetX = dirSign * ((1.0 - p) * Math.abs(width));
  } else {
    angle = 0.0;
    offsetX = 0.0;
  }
  if (index === 0) {
    angle = -Math.abs(angle);
  }
  return [angle, offsetX];
}

export function signLayoutScale(width: number): [number, number] {
  return MenuView._signLayoutScale(width);
}

export function menuSlotPosX(slot: number): number {
  return MenuView._menuSlotPosX(slot);
}

export function menuSlotStartMs(slot: number): number {
  return MenuView._menuSlotStartMs(slot);
}

export function menuSlotEndMs(slot: number): number {
  return MenuView._menuSlotEndMs(slot);
}

export { _drawMenuCursor as drawMenuCursorHelper };

export function menuGroundCamera(state: GameState): Vec2 {
  const camera = state.menuGroundCamera;
  if (camera instanceof Vec2) {
    return camera;
  }
  return new Vec2();
}

export function ensureMenuGround(state: GameState, opts: { regenerate?: boolean } = {}): GroundRenderer {
  const regenerate = opts.regenerate ?? false;
  const resources = requireRuntimeResources(state);
  let ground: GroundRenderer | null = state.menuGround;
  const generatedNewTerrain = ground === null || regenerate;

  let terrain!: ReturnType<typeof advanceUnlockTerrain>;
  let base: any;
  let overlay: any;
  let detail: any;
  if (generatedNewTerrain) {
    terrain = advanceUnlockTerrain(state.rng, { unlockIndex: int(state.status.questUnlockIndex), width: 1024, height: 1024 });
    [base, overlay, detail] = resolveTerrainSlots(terrain.terrainSlots, resources.texture.bind(resources));
  } else {
    if (!(ground !== null)) throw new Error();
    base = ground.texture;
    overlay = ground.overlay;
    detail = ground.overlayDetail;
  }

  if (ground === null) {
    ground = new GroundRenderer({ texture: base, overlay: overlay, overlayDetail: detail, width: 1024, height: 1024, textureScale: state.config.display.textureScale });
    state.menuGround = ground;
  } else {
    ground.texture = base;
    ground.overlay = overlay;
    ground.overlayDetail = detail;
  }
  if (generatedNewTerrain) {
    if (!(ground !== null)) throw new Error();
    ground.scheduleGenerate(terrain.terrainSeed);
    state.menuGroundCamera = null;
  }
  return ground;
}

function _drawMenuCursor(state: GameState, opts: { resources: RuntimeResources; pulseTime: number }): void {
  const resources = opts.resources;
  const pulseTime = opts.pulseTime;
  const particles = resources.texture(TextureId.PARTICLES);
  const cursorTex = resources.texture(TextureId.UI_CURSOR);

  const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
  drawMenuCursor(particles, cursorTex, { pos: Vec2.fromXY(mouse), pulseTime: pulseTime });
}
