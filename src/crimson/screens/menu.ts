// Port of crimson/screens/menu.py

import { type RuntimeResources, TextureId, getTexture } from '@grim/assets.ts';
import { audioPlaySfx, audioPlayMusic, audioStopMusic, audioUpdate } from '@grim/audio.ts';
import { Vec2, Rect } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { fxDetailEnabled } from '@grim/config.ts';
import { InputState } from '@grim/input.ts';
import { GroundRenderer } from '@grim/terrain-render.ts';
import { type GameState } from '@crimson/game/types.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { resolveTerrainSlots } from '@crimson/terrain-slots.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import { requireRuntimeResources } from './assets.ts';
import { drawScreenFade } from './transitions.ts';

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

const KEY_TAB = 9;
const KEY_ENTER = 13;
const KEY_LEFT_SHIFT = 16;
const KEY_RIGHT_SHIFT = 16;
const MOUSE_BUTTON_LEFT = 0;
const MOUSE_BUTTON_RIGHT = 2;
const MOUSE_BUTTON_MIDDLE = 1;

const WHITE = wgl.makeColor(1, 1, 1, 1);

export function menuGroundCamera(state: GameState): Vec2 {
  const camera = state.menuGroundCamera;
  if (camera instanceof Vec2) {
    return camera;
  }
  return new Vec2();
}

export function ensureMenuGround(
  state: GameState,
  opts: { regenerate?: boolean } = {},
): GroundRenderer {
  const regenerate = opts.regenerate ?? false;
  const resources = requireRuntimeResources(state);
  let ground = state.menuGround;
  const generatedNewTerrain = ground === null || regenerate;

  let base: wgl.Texture;
  let overlay: wgl.Texture;
  let detail: wgl.Texture;
  let terrainSeed = 0;

  if (generatedNewTerrain) {
    const terrain = advanceUnlockTerrain(
      state.rng,
      { unlockIndex: int(state.status.questUnlockIndex), width: 1024, height: 1024 },
    );
    [base, overlay, detail] = resolveTerrainSlots(
      terrain.terrainSlots,
      (id: TextureId) => getTexture(resources, id),
    );
    terrainSeed = terrain.terrainSeed;
  } else {
    base = ground!.texture;
    overlay = ground!.overlay;
    detail = ground!.overlayDetail;
  }

  if (ground === null) {
    ground = new GroundRenderer({
      texture: base,
      overlay,
      overlayDetail: detail,
      width: 1024,
      height: 1024,
      textureScale: state.config.display.textureScale,
    });
    state.menuGround = ground;
  } else {
    ground.texture = base;
    ground.overlay = overlay;
    ground.overlayDetail = detail;
  }

  if (generatedNewTerrain) {
    ground.scheduleGenerate(terrainSeed);
    state.menuGroundCamera = null;
  }

  return ground;
}

export function drawMenuCursorHelper(
  state: GameState,
  opts: { resources: RuntimeResources; pulseTime: number },
): void {
  const { resources, pulseTime } = opts;
  const particles = getTexture(resources, TextureId.PARTICLES);
  const cursorTex = getTexture(resources, TextureId.UI_CURSOR);
  const [mx, my] = InputState.mousePosition();
  const pos = new Vec2(mx, my);
  drawMenuCursor(particles, cursorTex, { pos, pulseTime });
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

export function labelAlpha(counterValue: number): number {
  // ui_element_render: alpha = 100 + floor(counter_value * 155 / 1000)
  return 100 + Math.floor((counterValue * 155) / 1000);
}

interface TimelineView {
  _timelineMs: number;
}

export function uiElementAnim(
  view: TimelineView,
  opts: {
    index: number;
    startMs: number;
    endMs: number;
    width: number;
    directionFlag?: number;
  },
): [number, number] {
  const { index, startMs, endMs, width, directionFlag = 0 } = opts;
  // Matches ui_element_update: angle lerps pi/2 -> 0 over [end_ms, start_ms].
  // direction_flag=0 slides from left  (-width -> 0)
  // direction_flag=1 slides from right (+width -> 0)
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

export class MenuView {
  state: GameState;
  private _isOpen: boolean = false;
  private _ground: GroundRenderer | null = null;
  private _menuEntries: MenuEntry[] = [];
  private _selectedIndex: number = 0;
  private _focusTimerMs: number = 0;
  private _hoveredIndex: number | null = null;
  private _fullVersion: boolean = false;
  _timelineMs: number = 0;
  private _timelineMaxMs: number = 0;
  private _idleMs: number = 0;
  private _lastMousePos: Vec2 = new Vec2();
  private _cursorPulseTime: number = 0.0;
  private _widescreenYShift: number = 0.0;
  private _menuScreenWidth: number = 0;
  private _closing: boolean = false;
  private _closeAction: string | null = null;
  private _pendingAction: string | null = null;
  private _panelOpenSfxPlayed: boolean = false;

  constructor(state: GameState) {
    this.state = state;
  }

  open(): void {
    const layoutW = this.state.config.display.width;
    this._menuScreenWidth = int(layoutW);
    this._widescreenYShift = MenuView._menuWidescreenYShift(layoutW);
    // Shareware gating is controlled by the --demo flag (see GameState.demo_enabled),
    // not by a persisted config byte.
    this._fullVersion = !this.state.demoEnabled;
    this._menuEntries = this._menuEntriesForFlags(
      this._fullVersion,
      this._modsAvailable(),
      this._otherGamesEnabled(),
    );
    this._selectedIndex = this._menuEntries.length > 0 ? 0 : -1;
    this._focusTimerMs = 0;
    this._hoveredIndex = null;
    this._timelineMs = 0;
    this._idleMs = 0;
    this._cursorPulseTime = 0.0;
    const [mx, my] = InputState.mousePosition();
    this._lastMousePos = new Vec2(mx, my);
    this._closing = false;
    this._closeAction = null;
    this._pendingAction = null;
    this._panelOpenSfxPlayed = false;
    this._timelineMaxMs = MenuView._menuMaxTimelineMs(
      this._fullVersion,
      this._modsAvailable(),
      this._otherGamesEnabled(),
    );
    this._initGround();
    if (this.state.audio !== null) {
      const theme = this.state.demoEnabled ? 'crimsonquest' : 'crimson_theme';
      if (this.state.audio.music.activeTrack !== theme) {
        audioStopMusic(this.state.audio);
      }
      audioPlayMusic(this.state.audio, theme);
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
        audioPlayMusic(this.state.audio, theme);
      }
      audioUpdate(this.state.audio, dt);
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
      const [mx, my] = InputState.mousePosition();
      const mousePos = new Vec2(mx, my);
      const mouseMoved = mousePos.x !== this._lastMousePos.x || mousePos.y !== this._lastMousePos.y;
      if (mouseMoved) {
        this._lastMousePos = mousePos;
      }

      const anyKey = InputState.firstKeyPressed() !== null;
      const anyClick = (
        InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT) ||
        InputState.wasMouseButtonPressed(MOUSE_BUTTON_RIGHT) ||
        InputState.wasMouseButtonPressed(MOUSE_BUTTON_MIDDLE)
      );

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
        if (!this._panelOpenSfxPlayed && this.state.audio !== null) {
          audioPlaySfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }
    if (this._menuEntries.length === 0) {
      return;
    }

    const resources = requireRuntimeResources(this.state);
    this._hoveredIndex = this._hoveredEntryIndex(resources);

    if (InputState.wasKeyPressed(KEY_TAB)) {
      const reverse = InputState.isKeyDown(KEY_LEFT_SHIFT) || InputState.isKeyDown(KEY_RIGHT_SHIFT);
      const delta = reverse ? -1 : 1;
      this._selectedIndex = ((this._selectedIndex + delta) % this._menuEntries.length + this._menuEntries.length) % this._menuEntries.length;
      this._focusTimerMs = 1000;
    }

    let activatedIndex: number | null = null;
    if (InputState.wasKeyPressed(KEY_ENTER) && 0 <= this._selectedIndex && this._selectedIndex < this._menuEntries.length) {
      const entry = this._menuEntries[this._selectedIndex];
      if (this._menuEntryEnabled(entry)) {
        activatedIndex = this._selectedIndex;
      }
    }

    if (activatedIndex === null && this._hoveredIndex !== null) {
      if (InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
        const hovered = this._hoveredIndex;
        const entry = this._menuEntries[hovered];
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
    if (
      !this._closing &&
      this._pendingAction === null &&
      this.state.demoEnabled &&
      this._timelineMs >= this._timelineMaxMs &&
      this._idleMs >= MENU_DEMO_IDLE_START_MS
    ) {
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
    drawMenuCursorHelper(this.state, { resources, pulseTime: this._cursorPulseTime });
  }

  takeAction(): string | null {
    this._assertOpen();
    const action = this._pendingAction;
    this._pendingAction = null;
    return action;
  }

  private _assertOpen(): void {
    if (!this._isOpen) {
      throw new Error('MenuView must be opened before use');
    }
  }

  private _activateMenuEntry(index: number): void {
    if (!(0 <= index && index < this._menuEntries.length)) {
      return;
    }
    const entry = this._menuEntries[index];
    if (this.state.audio !== null) {
      audioPlaySfx(this.state.audio, SfxId.UI_BUTTONCLICK);
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

  private _beginCloseTransition(action: string): void {
    if (this._closing) return;
    this._closing = true;
    this._closeAction = action;
  }

  private _beginQuitTransition(): void {
    this.state.menuSignLocked = false;
    this._beginCloseTransition(this.state.demoEnabled ? 'quit_after_demo' : 'quit_app');
  }

  private _initGround(): void {
    this._ground = ensureMenuGround(this.state);
  }

  private _menuEntriesForFlags(
    fullVersion: boolean,
    modsAvailable: boolean,
    otherGames: boolean,
  ): MenuEntry[] {
    const rows = MenuView._menuLabelRows(fullVersion, otherGames);
    const slotYs = MenuView._menuSlotYs(otherGames, this._widescreenYShift);
    const active = MenuView._menuSlotActive(fullVersion, modsAvailable, otherGames);
    const entries: MenuEntry[] = [];
    for (let slot = 0; slot < rows.length; slot++) {
      if (!active[slot]) continue;
      entries.push(new MenuEntry({ slot, row: rows[slot], y: slotYs[slot] }));
    }
    return entries;
  }

  private static _menuLabelRows(_fullVersion: boolean, otherGames: boolean): number[] {
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

  private static _menuSlotYs(_otherGames: boolean, yShift: number): number[] {
    const ys = [
      MENU_LABEL_BASE_Y,
      MENU_LABEL_BASE_Y + MENU_LABEL_STEP,
      MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 2.0,
      MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 3.0,
      MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 4.0,
      MENU_LABEL_BASE_Y + MENU_LABEL_STEP * 5.0,
    ];
    return ys.map(y => y + yShift);
  }

  private static _menuSlotActive(
    _fullVersion: boolean,
    modsAvailable: boolean,
    otherGames: boolean,
  ): boolean[] {
    const showTop = modsAvailable;
    if (otherGames) {
      return [showTop, true, true, true, true, true];
    }
    return [showTop, true, true, true, true, false];
  }

  private _drawMenuItems(resources: RuntimeResources): void {
    if (this._menuEntries.length === 0) return;
    const item = getTexture(resources, TextureId.UI_MENU_ITEM);
    const labelTex = getTexture(resources, TextureId.UI_ITEM_TEXTS);
    const itemW = item.width;
    const itemH = item.height;
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    // Matches ui_elements_update_and_render reverse table iteration:
    // later entries draw first, earlier entries draw last (on top).
    for (let idx = this._menuEntries.length - 1; idx >= 0; idx--) {
      const entry = this._menuEntries[idx];
      const posX = MenuView._menuSlotPosX(entry.slot);
      const posY = entry.y;
      const [angleRad, _slideX] = this._uiElementAnim({
        index: entry.slot + 2,
        startMs: MenuView._menuSlotStartMs(entry.slot),
        endMs: MenuView._menuSlotEndMs(entry.slot),
        width: itemW,
      });
      // slide is ignored for render_mode==0 (transform) elements
      const [itemScale, localYShift] = this._menuItemScale(entry.slot);
      const offsetX = MENU_ITEM_OFFSET_X * itemScale;
      const offsetY = MENU_ITEM_OFFSET_Y * itemScale - localYShift;
      const dst = wgl.makeRectangle(posX, posY, itemW * itemScale, itemH * itemScale);
      const origin = wgl.makeVector2(-offsetX, -offsetY);
      const rotationDeg = angleRad * (180.0 / Math.PI);
      if (fxDetail) {
        MenuView._drawUiQuadShadow({
          texture: item,
          src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
          dst: wgl.makeRectangle(dst.x + UI_SHADOW_OFFSET, dst.y + UI_SHADOW_OFFSET, dst.w, dst.h),
          origin,
          rotationDeg,
        });
      }
      MenuView._drawUiQuad({
        texture: item,
        src: wgl.makeRectangle(0.0, 0.0, itemW, itemH),
        dst,
        origin,
        rotationDeg,
        tint: WHITE,
      });
      let counterValue = entry.hoverAmount;
      if (idx === this._selectedIndex && this._focusTimerMs > 0) {
        counterValue = this._focusTimerMs;
      }
      const alpha = MenuView._labelAlpha(counterValue);
      const alphaNorm = alpha / 255;
      const tint = wgl.makeColor(1, 1, 1, alphaNorm);
      const src = wgl.makeRectangle(
        0.0,
        entry.row * MENU_LABEL_ROW_HEIGHT,
        MENU_LABEL_WIDTH,
        MENU_LABEL_ROW_HEIGHT,
      );
      const labelOffsetX = MENU_LABEL_OFFSET_X * itemScale;
      const labelOffsetY = MENU_LABEL_OFFSET_Y * itemScale - localYShift;
      const labelDst = wgl.makeRectangle(
        posX,
        posY,
        MENU_LABEL_WIDTH * itemScale,
        MENU_LABEL_HEIGHT * itemScale,
      );
      const labelOrigin = wgl.makeVector2(-labelOffsetX, -labelOffsetY);
      MenuView._drawUiQuad({
        texture: labelTex,
        src,
        dst: labelDst,
        origin: labelOrigin,
        rotationDeg,
        tint,
      });
      if (this._menuEntryEnabled(entry)) {
        let glowAlpha = alpha;
        if (0 <= entry.readyTimerMs && entry.readyTimerMs < 0x100) {
          glowAlpha = 0xFF - Math.floor(entry.readyTimerMs / 2);
        }
        const glowAlphaNorm = glowAlpha / 255;
        wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
        MenuView._drawUiQuad({
          texture: labelTex,
          src,
          dst: labelDst,
          origin: labelOrigin,
          rotationDeg,
          tint: wgl.makeColor(1, 1, 1, glowAlphaNorm),
        });
        wgl.endBlendMode();
      }
    }
  }

  private _modsAvailable(): boolean {
    // WebGL cannot synchronously scan base_dir/mods/*.dll; native mod loading is unavailable.
    return false;
  }

  private _otherGamesEnabled(): boolean {
    // Original game checks a config string via grim_get_config_var(100).
    // Our config-var system is not implemented yet; allow a simple env opt-in.
    return typeof process !== 'undefined' && String(process.env?.CRIMSON_GRIM_CONFIG_VAR_100 ?? '').trim() !== '';
  }

  private _hoveredEntryIndex(resources: RuntimeResources): number | null {
    if (this._menuEntries.length === 0) return null;
    const [mx, my] = InputState.mousePosition();
    const mousePos = new Vec2(mx, my);
    for (let idx = 0; idx < this._menuEntries.length; idx++) {
      const entry = this._menuEntries[idx];
      if (!this._menuEntryEnabled(entry)) continue;
      if (this._menuItemBounds(entry, resources).contains(mousePos)) {
        return idx;
      }
    }
    return null;
  }

  private _updateReadyTimers(dtMs: number): void {
    for (const entry of this._menuEntries) {
      if (entry.readyTimerMs < 0x100) {
        entry.readyTimerMs = Math.min(0x100, entry.readyTimerMs + dtMs);
      }
    }
  }

  private _updateHoverAmounts(dtMs: number): void {
    const hoveredIndex = this._hoveredIndex;
    for (let idx = 0; idx < this._menuEntries.length; idx++) {
      const entry = this._menuEntries[idx];
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

  private _menuEntryEnabled(entry: MenuEntry): boolean {
    return this._timelineMs >= MenuView._menuSlotStartMs(entry.slot);
  }

  static _menuWidescreenYShift(screenW: number): number {
    // ((screen_width / 640.0) * 150.0) - 150.0
    return (screenW * 0.0015625 * 150.0) - 150.0;
  }

  private _menuItemScale(slot: number): [number, number] {
    if (this._menuScreenWidth < 641) {
      return [0.9, slot * 11.0];
    }
    return [1.0, 0.0];
  }

  private _menuItemBounds(entry: MenuEntry, resources: RuntimeResources): Rect {
    // FUN_0044fb50: inset bounds derived from quad0 v0/v2 and pos_x/pos_y.
    const item = getTexture(resources, TextureId.UI_MENU_ITEM);
    const itemW = item.width;
    const itemH = item.height;
    const [itemScale, localYShift] = this._menuItemScale(entry.slot);
    const offsetMin = new Vec2(
      MENU_ITEM_OFFSET_X * itemScale,
      MENU_ITEM_OFFSET_Y * itemScale - localYShift,
    );
    const offsetMax = new Vec2(
      (MENU_ITEM_OFFSET_X + itemW) * itemScale,
      (MENU_ITEM_OFFSET_Y + itemH) * itemScale - localYShift,
    );
    const size = offsetMax.sub(offsetMin);
    const pos = new Vec2(MenuView._menuSlotPosX(entry.slot), entry.y);
    const topLeft = pos.add(new Vec2(
      offsetMin.x + size.x * 0.54,
      offsetMin.y + size.y * 0.28,
    ));
    const bottomRight = pos.add(new Vec2(
      offsetMax.x - size.x * 0.05,
      offsetMax.y - size.y * 0.10,
    ));
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

  private static _menuMaxTimelineMs(
    _fullVersion: boolean,
    modsAvailable: boolean,
    otherGames: boolean,
  ): number {
    let maxMs = 300; // sign element at index 0
    const showTop = modsAvailable;
    const slotActive = [showTop, true, true, true, true, otherGames];
    for (let slot = 0; slot < slotActive.length; slot++) {
      if (!slotActive[slot]) continue;
      maxMs = Math.max(maxMs, (slot + 2) * 100 + 300);
    }
    return maxMs;
  }

  private _uiElementAnim(opts: {
    index: number;
    startMs: number;
    endMs: number;
    width: number;
    directionFlag?: number;
  }): [number, number] {
    return uiElementAnim(this, opts);
  }

  private static _drawUiQuad(
    opts: {
      texture: wgl.Texture;
      src: wgl.Rectangle;
      dst: wgl.Rectangle;
      origin: wgl.Vector2;
      rotationDeg: number;
      tint: wgl.Color;
    },
  ): void {
    wgl.drawTexturePro(opts.texture, opts.src, opts.dst, opts.origin, opts.rotationDeg, opts.tint);
  }

  private static _drawUiQuadShadow(opts: {
    texture: wgl.Texture;
    src: wgl.Rectangle;
    dst: wgl.Rectangle;
    origin: wgl.Vector2;
    rotationDeg: number;
  }): void {
    drawUiQuadShadow(opts);
  }

  private _drawMenuSign(resources: RuntimeResources): void {
    const screenW = this.state.config.display.width;
    const [scale, shiftX] = MenuView._signLayoutScale(int(screenW));
    const signPos = new Vec2(
      screenW + MENU_SIGN_POS_X_PAD,
      screenW > MENU_SCALE_SMALL_THRESHOLD ? MENU_SIGN_POS_Y : MENU_SIGN_POS_Y_SMALL,
    );
    const signW = MENU_SIGN_WIDTH * scale;
    const signH = MENU_SIGN_HEIGHT * scale;
    const signOffsetX = MENU_SIGN_OFFSET_X * scale + shiftX;
    const signOffsetY = MENU_SIGN_OFFSET_Y * scale;
    let rotationDeg = 0.0;
    if (!this.state.menuSignLocked) {
      const [angleRad, _slideX] = this._uiElementAnim({
        index: 0,
        startMs: 300,
        endMs: 0,
        width: signW,
      });
      // slide is ignored for render_mode==0 (transform) elements
      rotationDeg = angleRad * (180.0 / Math.PI);
    }
    const sign = getTexture(resources, TextureId.UI_SIGN_CRIMSON);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const signSrc = wgl.makeRectangle(0.0, 0.0, sign.width, sign.height);
    const signOrigin = wgl.makeVector2(-signOffsetX, -signOffsetY);

    if (fxDetail) {
      MenuView._drawUiQuadShadow({
        texture: sign,
        src: signSrc,
        dst: wgl.makeRectangle(signPos.x + UI_SHADOW_OFFSET, signPos.y + UI_SHADOW_OFFSET, signW, signH),
        origin: signOrigin,
        rotationDeg,
      });
    }
    MenuView._drawUiQuad({
      texture: sign,
      src: signSrc,
      dst: wgl.makeRectangle(signPos.x, signPos.y, signW, signH),
      origin: signOrigin,
      rotationDeg,
      tint: WHITE,
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
