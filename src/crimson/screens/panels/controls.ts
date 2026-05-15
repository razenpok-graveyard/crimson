// Port of crimson/screens/panels/controls.py

import { type RuntimeResources, TextureId, getTexture } from '@grim/assets.ts';
import { InputState } from '@grim/input.ts';
import { type CrimsonControlsConfig, defaultCrimsonConfig, fxDetailEnabled } from '@grim/config.ts';
import { drawSmallText, measureSmallTextWidth, SmallFontData } from '@grim/fonts/small.ts';
import { Vec2, Rect } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { AimScheme } from '@crimson/aim-schemes.ts';
import { type GameState } from '@crimson/game/types.ts';
import { INPUT_CODE_UNBOUND, captureFirstPressedInputCode, inputCodeName } from '@crimson/input-codes.ts';
import { MovementControlType } from '@crimson/movement-controls.ts';
import { DropdownLayoutBase } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_PANEL_WIDTH, MENU_PANEL_HEIGHT, uiElementAnim } from '@crimson/screens/menu.ts';
import { PanelMenuView, PANEL_TIMELINE_START_MS, PANEL_TIMELINE_END_MS } from './base.ts';
import { RebindRowSpec, RebindTarget, controlsAimMethodDropdownIds, controlsRebindPlan, inputConfigureForLabel, inputSchemeLabel } from './controls-labels.ts';
import { mouseInsideRectWithPadding } from './hit-test.ts';

// Measured from ui_render_trace_oracle_1024x768.json (state_3:Configure for:, timeline=300).
export const CONTROLS_LEFT_PANEL_POS_X = -165.0;
export const CONTROLS_LEFT_PANEL_POS_Y = 200.0;
export const CONTROLS_RIGHT_PANEL_POS_X = 590.0;
export const CONTROLS_RIGHT_PANEL_POS_Y = 110.0;
export const CONTROLS_RIGHT_PANEL_HEIGHT = 378.0;
export const CONTROLS_BACK_POS_X = -155.0;
export const CONTROLS_BACK_POS_Y = 420.0;

// `ui_menu_item_update`: idle rebind value tint (rgb 70,180,240 @ alpha 0.6).
export const CONTROLS_REBIND_VALUE_COLOR = wgl.makeColor(70 / 255, 180 / 255, 240 / 255, 153 / 255);
export const CONTROLS_REBIND_HOVER_COLOR = wgl.makeColor(200 / 255, 230 / 255, 250 / 255, 230 / 255);
export const CONTROLS_REBIND_ACTIVE_COLOR = wgl.makeColor(255 / 255, 228 / 255, 170 / 255, 1.0);

const WHITE = wgl.makeColor(1, 1, 1, 1);
const ORIGIN = wgl.makeVector2(0, 0);

const KEY_ESCAPE = 27;
const KEY_BACKSPACE = 8;
const KEY_DELETE = 46;
const MOUSE_BUTTON_LEFT = 0;
const MOUSE_BUTTON_RIGHT = 2;

function drawRectangleLinesEx(rect: wgl.Rectangle, lineThick: number, color: wgl.Color): void {
  const thick = Math.max(1, int(lineThick));
  const x = int(rect.x);
  const y = int(rect.y);
  const w = int(rect.w);
  const h = int(rect.h);
  wgl.drawRectangle(x, y, w, thick, color);
  wgl.drawRectangle(x, y + h - thick, w, thick, color);
  wgl.drawRectangle(x, y, thick, h, color);
  wgl.drawRectangle(x + w - thick, y, thick, h, color);
}

function rowBindingCode(row: RebindRowSpec, opts: { playerIndex: number; controls: CrimsonControlsConfig }): number {
  const playerIndex = opts.playerIndex;
  const controls = opts.controls;
  const pc = controls.player(playerIndex);
  switch (row.target) {
    case RebindTarget.PLAYER_MOVE_CODES: {
      if (row.targetIndex === null) throw new Error();
      return pc.moveCodes[row.targetIndex];
    }
    case RebindTarget.PLAYER_FIRE_CODE:
      return pc.fireCode;
    case RebindTarget.PLAYER_KEYBOARD_AIM_CODES: {
      if (row.targetIndex === null) throw new Error();
      return pc.keyboardAimCodes[row.targetIndex];
    }
    case RebindTarget.PLAYER_AIM_AXIS_CODES: {
      if (row.targetIndex === null) throw new Error();
      return pc.aimAxisCodes[row.targetIndex];
    }
    case RebindTarget.PLAYER_MOVE_AXIS_CODES: {
      if (row.targetIndex === null) throw new Error();
      return pc.moveAxisCodes[row.targetIndex];
    }
    case RebindTarget.GLOBAL_PICK_PERK_CODE:
      return controls.pickPerkCode;
    case RebindTarget.GLOBAL_RELOAD_CODE:
      return controls.reloadCode;
  }
  return INPUT_CODE_UNBOUND;
}

function setRowBindingCode(
  row: RebindRowSpec,
  value: number,
  opts: { playerIndex: number; controls: CrimsonControlsConfig },
): void {
  const code = int(value);
  const playerIndex = opts.playerIndex;
  const controls = opts.controls;
  const pc = controls.player(playerIndex);
  switch (row.target) {
    case RebindTarget.PLAYER_MOVE_CODES: {
      if (row.targetIndex === null) throw new Error();
      const values: [number, number, number, number] = [...pc.moveCodes];
      values[row.targetIndex] = code;
      pc.moveCodes = values;
      break;
    }
    case RebindTarget.PLAYER_FIRE_CODE:
      pc.fireCode = code;
      break;
    case RebindTarget.PLAYER_KEYBOARD_AIM_CODES: {
      if (row.targetIndex === null) throw new Error();
      const values: [number, number] = [...pc.keyboardAimCodes];
      values[row.targetIndex] = code;
      pc.keyboardAimCodes = values;
      break;
    }
    case RebindTarget.PLAYER_AIM_AXIS_CODES: {
      if (row.targetIndex === null) throw new Error();
      const values: [number, number] = [...pc.aimAxisCodes];
      values[row.targetIndex] = code;
      pc.aimAxisCodes = values;
      break;
    }
    case RebindTarget.PLAYER_MOVE_AXIS_CODES: {
      if (row.targetIndex === null) throw new Error();
      const values: [number, number] = [...pc.moveAxisCodes];
      values[row.targetIndex] = code;
      pc.moveAxisCodes = values;
      break;
    }
    case RebindTarget.GLOBAL_PICK_PERK_CODE:
      controls.pickPerkCode = code;
      break;
    case RebindTarget.GLOBAL_RELOAD_CODE:
      controls.reloadCode = code;
      break;
  }
}

function defaultRowBindingCode(opts: { playerIndex: number; row: RebindRowSpec }): number {
  const controls = defaultCrimsonConfig().controls;
  return rowBindingCode(opts.row, { playerIndex: opts.playerIndex, controls });
}

function controlsLeftPanelPosX(screenWidth: number): number {
  // Left controls panel X in panel-pos space.
  //
  // Native `ui_menu_layout_init` nudges the controls left panel 18px further left
  // at 640-wide layouts.
  if (int(screenWidth) <= 640) {
    return CONTROLS_LEFT_PANEL_POS_X - 18.0;
  }
  return CONTROLS_LEFT_PANEL_POS_X;
}

function controlsRightPanelPosX(screenWidth: number): number {
  // Right controls panel X in panel-pos space.
  //
  // Native `ui_menu_layout_init` uses:
  //   slot40_pos_x = screen_width - 350  (+80 at <=640)
  //
  // Our panel-pos abstraction differs by a fixed -84 offset from that slot-space,
  // so this becomes:
  //   x = screen_width - 434  (+80 at <=640).
  const w = int(screenWidth);
  let x = w - 434;
  if (w <= 640) {
    x += 80.0;
  }
  return x;
}

function controlsRightPanelPosY(screenWidth: number): number {
  // Right controls panel Y in panel-pos space.
  //
  // Native slot40 y moves from 200 to 186 at <=640. In panel-pos coordinates this
  // is 110 -> 96.
  if (int(screenWidth) <= 640) {
    return CONTROLS_RIGHT_PANEL_POS_Y - 14.0;
  }
  return CONTROLS_RIGHT_PANEL_POS_Y;
}

class ControlsDropdownLayout extends DropdownLayoutBase {
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
    super({
      pos: opts.pos,
      width: opts.width,
      headerH: opts.headerH,
      rowH: opts.rowH,
      rowsY0: opts.rowsY0,
      fullH: opts.fullH,
    });
    this.arrowPos = opts.arrowPos;
    this.arrowSize = opts.arrowSize;
    this.textPos = opts.textPos;
    this.textScale = opts.textScale;
  }
}

class RebindRowLayout {
  readonly row: RebindRowSpec;
  readonly rowY: number;
  readonly valuePos: Vec2;
  readonly valueRect: Rect;

  constructor(opts: {
    row: RebindRowSpec;
    rowY: number;
    valuePos: Vec2;
    valueRect: Rect;
  }) {
    this.row = opts.row;
    this.rowY = opts.rowY;
    this.valuePos = opts.valuePos;
    this.valueRect = opts.valueRect;
  }
}

export class ControlsMenuView extends PanelMenuView {
  private _configPlayer: number = 1;
  private _moveMethodOpen: boolean = false;
  private _aimMethodOpen: boolean = false;
  private _playerProfileOpen: boolean = false;
  private _dirty: boolean = false;
  private _rebindRow: RebindRowSpec | null = null;
  private _rebindPlayerIndex: number | null = null;
  private _rebindSkipFrames: number = 0;

  constructor(state: GameState) {
    super(state, {
      title: 'Controls',
      backAction: 'open_options',
      panelPos: new Vec2(CONTROLS_LEFT_PANEL_POS_X, CONTROLS_LEFT_PANEL_POS_Y),
      backPos: new Vec2(CONTROLS_BACK_POS_X, CONTROLS_BACK_POS_Y),
    });
  }

  override open(): void {
    super.open();
    this._configPlayer = Math.max(1, Math.min(4, int(this._configPlayer)));
    this._moveMethodOpen = false;
    this._aimMethodOpen = false;
    this._playerProfileOpen = false;
    this._dirty = false;
    this._clearRebindCapture();
  }

  override update(dt: number): void {
    super.update(dt);
    if (this._closing) {
      return;
    }
    const entry = this._entry;
    if (entry === null || !this._entryEnabled(entry)) {
      return;
    }
    const [panelScale] = this._menuItemScale(0);
    const leftTopLeft = this._leftPanelTopLeft(panelScale);
    const rightTopLeft = this._rightPanelTopLeft(panelScale);
    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;

    let clickConsumed = this._updateMethodDropdowns({ leftTopLeft, panelScale, font });
    if (!clickConsumed) {
      clickConsumed = this._updateRebindCapture({ rightTopLeft, panelScale, font });
    }
    if (!clickConsumed && this._updateDirectionArrowCheckbox({
      leftTopLeft,
      panelScale,
      enabled: this._checkboxEnabled(),
      resources,
      font,
    })) {
      this._dirty = true;
    }
  }

  protected override _beginCloseTransition(action: string): void {
    if (this._dirty) {
      try {
        this.state.config.save();
        this._dirty = false;
      } catch (exc) {
        this.state.console.log.log(`config: save failed: ${exc}`);
      }
    }
    super._beginCloseTransition(action);
  }

  private _currentPlayerIndex(): number {
    return Math.max(0, Math.min(3, int(this._configPlayer) - 1));
  }

  private _rebindActive(): boolean {
    return this._rebindRow !== null && this._rebindPlayerIndex !== null;
  }

  private _clearRebindCapture(): void {
    this._rebindRow = null;
    this._rebindPlayerIndex = null;
    this._rebindSkipFrames = 0;
  }

  private _startRebindCapture(opts: { row: RebindRowSpec; playerIndex: number }): void {
    this._rebindRow = opts.row;
    this._rebindPlayerIndex = Math.max(0, Math.min(3, int(opts.playerIndex)));
    this._moveMethodOpen = false;
    this._aimMethodOpen = false;
    this._playerProfileOpen = false;
    // Ignore the click that opened capture so Mouse1 is not rebound accidentally.
    this._rebindSkipFrames = 1;
  }

  private static _capturePromptForBinding(row: RebindRowSpec): string {
    if (row.axis) return '<press axis>';
    return '<press input>';
  }

  private _bindingDefaultCode(opts: { playerIndex: number; row: RebindRowSpec }): number {
    return defaultRowBindingCode({ playerIndex: opts.playerIndex, row: opts.row });
  }

  private _bindingCode(opts: { playerIndex: number; row: RebindRowSpec }): number {
    return rowBindingCode(opts.row, { playerIndex: opts.playerIndex, controls: this.state.config.controls });
  }

  private _setBindingCode(opts: { playerIndex: number; row: RebindRowSpec; code: number }): void {
    setRowBindingCode(opts.row, int(opts.code), {
      playerIndex: opts.playerIndex,
      controls: this.state.config.controls,
    });
  }

  private _leftPanelTopLeft(panelScale: number): Vec2 {
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [, slideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
    });
    return new Vec2(
      controlsLeftPanelPosX(this.state.config.display.width) + slideX,
      this._panelPos.y + this._widescreenYShift,
    ).add(this._panelOffset.mul(panelScale));
  }

  private _rightPanelTopLeft(panelScale: number): Vec2 {
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [, slideX] = uiElementAnim(this, {
      index: 3,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
      directionFlag: 1,
    });
    const sw = this.state.config.display.width;
    return new Vec2(
      controlsRightPanelPosX(sw) + slideX,
      controlsRightPanelPosY(sw) + this._widescreenYShift,
    ).add(this._panelOffset.mul(panelScale));
  }

  private _directionArrowEnabled(): boolean {
    return this.state.config.controls.player(this._currentPlayerIndex()).showDirectionArrow;
  }

  private _setDirectionArrowEnabled(enabled: boolean): void {
    this.state.config.controls.player(this._currentPlayerIndex()).showDirectionArrow = enabled;
  }

  private _checkboxEnabled(): boolean {
    return !(this._moveMethodOpen || this._aimMethodOpen || this._rebindActive());
  }

  private _checkboxHovered(
    opts: {
      leftTopLeft: Vec2;
      panelScale: number;
      enabled: boolean;
      resources: RuntimeResources;
      font: SmallFontData;
    },
  ): boolean {
    const leftTopLeft = opts.leftTopLeft;
    const panelScale = opts.panelScale;
    const enabled = opts.enabled;
    const resources = opts.resources;
    const font = opts.font;
    if (!enabled) return false;
    const checkOn = getTexture(resources, TextureId.UI_CHECK_ON);
    const textScale = 1.0 * panelScale;
    const label = 'Show direction arrow';
    const checkPos = new Vec2(
      leftTopLeft.x + 213.0 * panelScale,
      leftTopLeft.y + 174.0 * panelScale,
    );
    const labelW = measureSmallTextWidth(font, label);
    const rectW = checkOn.width * panelScale + 6.0 * panelScale + labelW;
    const rectH = Math.max(checkOn.height * panelScale, font.cellSize * textScale);
    const [mx, my] = InputState.mousePosition();
    return Rect.fromTopLeft(checkPos, rectW, rectH).contains(new Vec2(mx, my));
  }

  private _updateDirectionArrowCheckbox(
    opts: {
      leftTopLeft: Vec2;
      panelScale: number;
      enabled: boolean;
      resources: RuntimeResources;
      font: SmallFontData;
    },
  ): boolean {
    const enabled = opts.enabled;
    if (!enabled) return false;
    const hovered = this._checkboxHovered(opts);
    if (hovered && InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
      this._setDirectionArrowEnabled(!this._directionArrowEnabled());
      return true;
    }
    return false;
  }

  private _rebindSections(
    opts: {
      playerIndex: number;
      aimScheme: AimScheme;
      moveMode: MovementControlType;
    },
  ): [string, RebindRowSpec[]][] {
    const playerIndex = opts.playerIndex;
    const aimScheme = opts.aimScheme;
    const moveMode = opts.moveMode;
    const [aimRows, moveRows, miscRows] = controlsRebindPlan({ aimScheme, moveMode, playerIndex });
    const sections: [string, RebindRowSpec[]][] = [['Aiming', aimRows], ['Moving', moveRows]];
    if (miscRows.length > 0) {
      sections.push(['Misc', miscRows]);
    }
    return sections;
  }

  private _collectRebindRows(
    opts: {
      rightTopLeft: Vec2;
      panelScale: number;
      playerIndex: number;
      sections: [string, RebindRowSpec[]][];
      font: SmallFontData;
    },
  ): RebindRowLayout[] {
    const rightTopLeft = opts.rightTopLeft;
    const panelScale = opts.panelScale;
    const playerIndex = opts.playerIndex;
    const sections = opts.sections;
    const font = opts.font;
    const rows: RebindRowLayout[] = [];
    let y = rightTopLeft.y + 64.0 * panelScale;
    for (const [, sectionRows] of sections) {
      let rowY = y + 18.0 * panelScale;
      for (const row of sectionRows) {
        const keyCode = int(this._bindingCode({ playerIndex, row }));
        const valueText = inputCodeName(keyCode);
        const valuePos = new Vec2(rightTopLeft.x + 180.0 * panelScale, rowY);
        const valueW = Math.max(60.0 * panelScale, measureSmallTextWidth(font, valueText));
        const valueRect = Rect.fromTopLeft(
          new Vec2(valuePos.x - 2.0 * panelScale, rowY - 2.0 * panelScale),
          valueW + 4.0 * panelScale,
          14.0 * panelScale,
        );
        rows.push(new RebindRowLayout({
          row,
          rowY,
          valuePos,
          valueRect,
        }));
        rowY += 16.0 * panelScale;
      }
      y = rowY + 8.0 * panelScale;
    }
    return rows;
  }

  private _updateRebindCapture(opts: { rightTopLeft: Vec2; panelScale: number; font: SmallFontData }): boolean {
    const rightTopLeft = opts.rightTopLeft;
    const panelScale = opts.panelScale;
    const font = opts.font;
    const playerIdx = this._currentPlayerIndex();
    const playerControls = this.state.config.controls.player(playerIdx);
    const aimScheme = playerControls.aimScheme;
    const moveMode = playerControls.movement;
    const sections = this._rebindSections({ playerIndex: playerIdx, aimScheme, moveMode });
    const rows = this._collectRebindRows({
      rightTopLeft,
      panelScale,
      playerIndex: playerIdx,
      sections,
      font,
    });

    if (this._rebindActive()) {
      const activeRow = this._rebindRow ?? new RebindRowSpec({ label: 'Fire:', target: RebindTarget.PLAYER_FIRE_CODE });
      const activePlayer = int(this._rebindPlayerIndex ?? 0);

      if (InputState.wasKeyPressed(KEY_ESCAPE) || InputState.wasMouseButtonPressed(MOUSE_BUTTON_RIGHT)) {
        this._clearRebindCapture();
        return true;
      }

      if (InputState.wasKeyPressed(KEY_BACKSPACE)) {
        this._setBindingCode({
          playerIndex: activePlayer,
          row: activeRow,
          code: this._bindingDefaultCode({ playerIndex: activePlayer, row: activeRow }),
        });
        this._dirty = true;
        this._clearRebindCapture();
        return true;
      }

      if (InputState.wasKeyPressed(KEY_DELETE)) {
        this._setBindingCode({ playerIndex: activePlayer, row: activeRow, code: INPUT_CODE_UNBOUND });
        this._dirty = true;
        this._clearRebindCapture();
        return true;
      }

      if (this._rebindSkipFrames > 0) {
        this._rebindSkipFrames = Math.max(0, int(this._rebindSkipFrames) - 1);
        return true;
      }

      const axisOnly = activeRow.axis;
      const captured = captureFirstPressedInputCode({
        playerIndex: activePlayer,
        includeKeyboard: !axisOnly,
        includeMouse: !axisOnly,
        includeGamepad: !axisOnly,
        includeAxes: axisOnly,
        axisThreshold: 0.5,
      });
      if (captured !== null) {
        this._setBindingCode({ playerIndex: activePlayer, row: activeRow, code: int(captured) });
        this._dirty = true;
        this._clearRebindCapture();
      }
      return true;
    }

    if (this._moveMethodOpen || this._aimMethodOpen || this._playerProfileOpen) {
      return false;
    }

    if (!InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
      return false;
    }
    const [mx, my] = InputState.mousePosition();
    const mouse = new Vec2(mx, my);
    for (const row of rows) {
      if (row.valueRect.contains(mouse)) {
        this._startRebindCapture({ row: row.row, playerIndex: playerIdx });
        return true;
      }
    }
    return false;
  }

  private _setPlayerMoveMode(opts: { playerIndex: number; moveMode: MovementControlType }): void {
    this.state.config.controls.player(opts.playerIndex).movement = opts.moveMode;
  }

  private _setPlayerAimScheme(opts: { playerIndex: number; aimScheme: AimScheme }): void {
    this.state.config.controls.player(opts.playerIndex).aimScheme = opts.aimScheme;
  }

  private static _moveMethodIds(opts: { moveMode: MovementControlType }): MovementControlType[] {
    const items: MovementControlType[] = [
      MovementControlType.RELATIVE,
      MovementControlType.STATIC,
      MovementControlType.DUAL_ACTION_PAD,
    ];
    if (opts.moveMode === MovementControlType.MOUSE_POINT_CLICK) {
      items.push(MovementControlType.MOUSE_POINT_CLICK);
    }
    return items;
  }

  private _dropdownLayout(
    opts: { pos: Vec2; items: string[]; scale: number; font: SmallFontData },
  ): ControlsDropdownLayout {
    const pos = opts.pos;
    const items = opts.items;
    const scale = opts.scale;
    const font = opts.font;
    const textScale = 1.0 * scale;
    let maxLabelW = 0.0;
    for (const label of items) {
      maxLabelW = Math.max(maxLabelW, measureSmallTextWidth(font, label));
    }
    const width = maxLabelW + 48.0 * scale;
    const headerH = 16.0 * scale;
    const rowH = 16.0 * scale;
    const fullH = (items.length * 16.0 + 24.0) * scale;
    const arrow = 16.0 * scale;
    return new ControlsDropdownLayout({
      pos,
      width,
      headerH: headerH,
      rowH: rowH,
      rowsY0: pos.y + 17.0 * scale,
      fullH: fullH,
      arrowPos: new Vec2(pos.x + width - arrow - 1.0 * scale, pos.y),
      arrowSize: new Vec2(arrow, arrow),
      textPos: pos.add(new Vec2(4.0 * scale, 1.0 * scale)),
      textScale,
    });
  }

  private _updateDropdown(
    opts: {
      layout: ControlsDropdownLayout;
      itemCount: number;
      isOpen: boolean;
      enabled: boolean;
      scale: number;
    },
  ): [boolean, number | null, boolean] {
    const layout = opts.layout;
    const itemCount = opts.itemCount;
    const isOpen = opts.isOpen;
    const enabled = opts.enabled;
    const scale = opts.scale;
    const [mx, my] = InputState.mousePosition();
    const mouse = { x: mx, y: my };
    const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);

    const hoveredHeader = enabled && mouseInsideRectWithPadding(
      mouse, { pos: layout.pos, width: layout.width, height: 14.0 * scale },
    );
    if (hoveredHeader && click) {
      return [!isOpen, null, true];
    }
    if (!isOpen) {
      return [isOpen, null, false];
    }

    const listHovered = Rect.fromTopLeft(layout.pos, layout.width, layout.fullH).contains(new Vec2(mx, my));
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

  private _updateMethodDropdowns(opts: { leftTopLeft: Vec2; panelScale: number; font: SmallFontData }): boolean {
    const leftTopLeft = opts.leftTopLeft;
    const panelScale = opts.panelScale;
    const font = opts.font;
    const config = this.state.config;
    const playerIdx = this._currentPlayerIndex();
    const playerControls = config.controls.player(playerIdx);
    const aimScheme = playerControls.aimScheme;
    const moveMode = playerControls.movement;
    const moveMethodIds = ControlsMenuView._moveMethodIds({ moveMode });
    const moveItems = moveMethodIds.map(m => inputSchemeLabel(m));
    const aimItemIds = controlsAimMethodDropdownIds(aimScheme);
    const aimItems = aimItemIds.map(a => inputConfigureForLabel(a));
    const playerItems = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

    const moveLayout = this._dropdownLayout({
      pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 144.0 * panelScale),
      items: moveItems, scale: panelScale, font,
    });
    const aimLayout = this._dropdownLayout({
      pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 102.0 * panelScale),
      items: aimItems, scale: panelScale, font,
    });
    const playerLayout = this._dropdownLayout({
      pos: new Vec2(leftTopLeft.x + 340.0 * panelScale, leftTopLeft.y + 56.0 * panelScale),
      items: playerItems, scale: panelScale, font,
    });

    const rebindActive = this._rebindActive();
    const moveEnabled = !(this._aimMethodOpen || this._playerProfileOpen || rebindActive);
    const aimEnabled = !(this._moveMethodOpen || this._playerProfileOpen || rebindActive);
    const playerEnabled = !(this._moveMethodOpen || this._aimMethodOpen || rebindActive);

    {
      const [newOpen, selected, consumed] = this._updateDropdown({
        layout: moveLayout,
        itemCount: moveItems.length,
        isOpen: this._moveMethodOpen,
        enabled: moveEnabled,
        scale: panelScale,
      });
      this._moveMethodOpen = newOpen;
      if (selected !== null) {
        const selectedIdx = Math.max(0, Math.min(int(selected), moveMethodIds.length - 1));
        this._setPlayerMoveMode({ playerIndex: playerIdx, moveMode: moveMethodIds[selectedIdx] });
        this._dirty = true;
      }
      if (consumed) return true;
    }

    {
      const [newOpen, selected, consumed] = this._updateDropdown({
        layout: aimLayout,
        itemCount: aimItems.length,
        isOpen: this._aimMethodOpen,
        enabled: aimEnabled,
        scale: panelScale,
      });
      this._aimMethodOpen = newOpen;
      if (selected !== null) {
        const selectedIdx = Math.max(0, Math.min(int(selected), aimItemIds.length - 1));
        this._setPlayerAimScheme({ playerIndex: playerIdx, aimScheme: aimItemIds[selectedIdx] });
        this._dirty = true;
      }
      if (consumed) return true;
    }

    {
      const [newOpen, selected, consumed] = this._updateDropdown({
        layout: playerLayout,
        itemCount: playerItems.length,
        isOpen: this._playerProfileOpen,
        enabled: playerEnabled,
        scale: panelScale,
      });
      this._playerProfileOpen = newOpen;
      if (selected !== null) {
        this._configPlayer = Math.max(1, Math.min(4, selected + 1));
      }
      if (consumed) return true;
    }

    return false;
  }

  protected override _drawPanel(): void {
    const resources = requireRuntimeResources(this.state);
    const fxDetail = fxDetailEnabled(this.state.config.display, 0);
    const [panelScale] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const panel = getTexture(resources, TextureId.UI_MENU_PANEL);

    // Left (controls options) panel: standard 254px height => a single quad.
    const leftTopLeft = this._leftPanelTopLeft(panelScale);
    const leftH = MENU_PANEL_HEIGHT * panelScale;
    drawClassicMenuPanel(panel, {
      dst: wgl.makeRectangle(leftTopLeft.x, leftTopLeft.y, panelW, leftH),
      tint: WHITE, shadow: fxDetail,
    });

    // Right (configured bindings) panel: tall 378px panel rendered as 3 vertical slices.
    const rightTopLeft = this._rightPanelTopLeft(panelScale);
    const rightH = CONTROLS_RIGHT_PANEL_HEIGHT * panelScale;
    drawClassicMenuPanel(panel, {
      dst: wgl.makeRectangle(rightTopLeft.x, rightTopLeft.y, panelW, rightH),
      // Original ui_element_slot_40 sets direction_flag=1, which mirrors panel UVs.
      tint: WHITE, shadow: fxDetail, flipX: true,
    });
  }

  protected override _drawContents(): void {
    const resources = requireRuntimeResources(this.state);
    // Positions are expressed relative to the panel top-left corners and scaled with the panel scale.
    const [panelScale] = this._menuItemScale(0);
    const leftTopLeft = this._leftPanelTopLeft(panelScale);
    const rightTopLeft = this._rightPanelTopLeft(panelScale);
    const font = resources.smallFont;

    const textColorFull = wgl.makeColor(1, 1, 1, 1);
    const textColorSoft = wgl.makeColor(1, 1, 1, 204 / 255);

    const config = this.state.config;
    const playerIdx = this._currentPlayerIndex();
    const playerControls = config.controls.player(playerIdx);
    const aimScheme = playerControls.aimScheme;
    const moveMode = playerControls.movement;
    const moveMethodIds = ControlsMenuView._moveMethodIds({ moveMode });
    const moveItems = moveMethodIds.map(m => inputSchemeLabel(m));
    const aimItemIds = controlsAimMethodDropdownIds(aimScheme);
    const aimItems = aimItemIds.map(a => inputConfigureForLabel(a));
    const playerItems = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

    let moveSelected = moveMethodIds.indexOf(moveMode);
    if (moveSelected < 0) moveSelected = 0;
    let aimSelected = aimItemIds.indexOf(aimScheme);
    if (aimSelected < 0) aimSelected = 0;
    const playerSelected = Math.max(0, Math.min(playerItems.length - 1, playerIdx));

    const moveLayout = this._dropdownLayout({
      pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 144.0 * panelScale),
      items: moveItems, scale: panelScale, font,
    });
    const aimLayout = this._dropdownLayout({
      pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 102.0 * panelScale),
      items: aimItems, scale: panelScale, font,
    });
    const playerLayout = this._dropdownLayout({
      pos: new Vec2(leftTopLeft.x + 340.0 * panelScale, leftTopLeft.y + 56.0 * panelScale),
      items: playerItems, scale: panelScale, font,
    });

    // --- Left panel: "Configure for" + method selectors (state_3 in trace) ---
    const textControls = getTexture(resources, TextureId.UI_TEXT_CONTROLS);
    wgl.drawTexturePro(
      textControls,
      wgl.makeRectangle(0.0, 0.0, textControls.width, textControls.height),
      wgl.makeRectangle(
        leftTopLeft.x + 206.0 * panelScale,
        leftTopLeft.y + 44.0 * panelScale,
        128.0 * panelScale,
        32.0 * panelScale,
      ),
      ORIGIN, 0.0, WHITE,
    );

    drawSmallText(
      font,'Configure for:',
      new Vec2(leftTopLeft.x + 339.0 * panelScale, leftTopLeft.y + 41.0 * panelScale),
      textColorSoft,
    );

    drawSmallText(
      font,'Aiming method:',
      new Vec2(leftTopLeft.x + 213.0 * panelScale, leftTopLeft.y + 86.0 * panelScale),
      textColorFull,
    );

    drawSmallText(
      font,'Moving method:',
      new Vec2(leftTopLeft.x + 213.0 * panelScale, leftTopLeft.y + 128.0 * panelScale),
      textColorFull,
    );

    const checkTex = this._directionArrowEnabled()
      ? getTexture(resources, TextureId.UI_CHECK_ON)
      : getTexture(resources, TextureId.UI_CHECK_OFF);
    wgl.drawTexturePro(
      checkTex,
      wgl.makeRectangle(0.0, 0.0, checkTex.width, checkTex.height),
      wgl.makeRectangle(
        leftTopLeft.x + 213.0 * panelScale,
        leftTopLeft.y + 174.0 * panelScale,
        16.0 * panelScale,
        16.0 * panelScale,
      ),
      ORIGIN, 0.0, WHITE,
    );
    const checkboxHovered = this._checkboxHovered({
      leftTopLeft,
      panelScale,
      enabled: this._checkboxEnabled(),
      resources,
      font,
    });
    const checkboxAlpha = checkboxHovered ? 1.0 : 178 / 255;
    drawSmallText(
      font,'Show direction arrow',
      new Vec2(leftTopLeft.x + 235.0 * panelScale, leftTopLeft.y + 175.0 * panelScale),
      wgl.makeColor(1, 1, 1, checkboxAlpha),
    );

    type DropdownTuple = [boolean, ControlsDropdownLayout, string[], number, boolean];
    const dropdowns: DropdownTuple[] = [
      [
        this._playerProfileOpen, playerLayout, playerItems, playerSelected,
        !(this._moveMethodOpen || this._aimMethodOpen || this._rebindActive()),
      ],
      [
        this._aimMethodOpen, aimLayout, aimItems, aimSelected,
        !(this._moveMethodOpen || this._playerProfileOpen || this._rebindActive()),
      ],
      [
        this._moveMethodOpen, moveLayout, moveItems, moveSelected,
        !(this._aimMethodOpen || this._playerProfileOpen || this._rebindActive()),
      ],
    ];
    // Active list must render last so overlapping widgets don't occlude open options.
    for (const [isOpen, layout, items, selectedIndex, enabled] of dropdowns) {
      if (isOpen) continue;
      this._drawDropdown({
        layout,
        items,
        selectedIndex,
        isOpen,
        enabled,
        scale: panelScale,
        resources,
        font,
      });
    }
    for (const [isOpen, layout, items, selectedIndex, enabled] of dropdowns) {
      if (!isOpen) continue;
      this._drawDropdown({
        layout,
        items,
        selectedIndex,
        isOpen,
        enabled,
        scale: panelScale,
        resources,
        font,
      });
    }

    // --- Right panel: configured bindings list ---
    const drawSectionHeading = (title: string, opts: { y: number }): void => {
      const y = opts.y;
      const xHeading = rightTopLeft.x + 44.0 * panelScale;
      drawSmallText(font, title, new Vec2(xHeading, y), textColorFull);
      const lineY = y + 13.0 * panelScale;
      const lineH = Math.max(1.0, panelScale);
      const line = wgl.makeRectangle(
        xHeading, lineY,
        228.0 * panelScale, lineH,
      );
      drawRectangleLinesEx(line, Math.max(1.0, panelScale), wgl.makeColor(1, 1, 1, 178 / 255));
    };

    drawSmallText(
      font,'Configured controls',
      new Vec2(rightTopLeft.x + 120.0 * panelScale, rightTopLeft.y + 38.0 * panelScale),
      textColorFull,
    );
    const headerW = measureSmallTextWidth(font, 'Configured controls');
    const headerLineY = rightTopLeft.y + 51.0 * panelScale;
    const headerLineH = Math.max(1.0, panelScale);
    const headerLine = wgl.makeRectangle(
      rightTopLeft.x + 120.0 * panelScale, headerLineY,
      headerW, headerLineH,
    );
    drawRectangleLinesEx(headerLine, Math.max(1.0, panelScale), wgl.makeColor(1, 1, 1, 204 / 255));

    const sections = this._rebindSections({ playerIndex: playerIdx, aimScheme, moveMode });
    const rows = this._collectRebindRows({
      rightTopLeft,
      panelScale,
      playerIndex: playerIdx,
      sections,
      font,
    });
    let rowIter = 0;
    const [mx, my] = InputState.mousePosition();
    const mouse = new Vec2(mx, my);
    const dropdownBlocked = this._moveMethodOpen || this._aimMethodOpen || this._playerProfileOpen;
    const rebindActive = this._rebindActive();

    let y = rightTopLeft.y + 64.0 * panelScale;
    for (const [sectionTitle, sectionRows] of sections) {
      drawSectionHeading(sectionTitle, { y });
      let rowY = y + 18.0 * panelScale;
      for (let i = 0; i < sectionRows.length; i++) {
        const rowLayout = rows[rowIter++];
        const activeRow = rebindActive
          && this._rebindRow !== null
          && this._rebindRow.label === rowLayout.row.label
          && this._rebindRow.target === rowLayout.row.target
          && this._rebindRow.targetIndex === rowLayout.row.targetIndex
          && this._rebindRow.axis === rowLayout.row.axis
          && (this._rebindPlayerIndex ?? -1) === playerIdx;
        const hoveredRow = !rebindActive && !dropdownBlocked && rowLayout.valueRect.contains(mouse);

        const valueText = activeRow
          ? ControlsMenuView._capturePromptForBinding(rowLayout.row)
          : inputCodeName(this._bindingCode({ playerIndex: playerIdx, row: rowLayout.row }));
        const valuePos = rowLayout.valuePos;

        drawSmallText(
          font,rowLayout.row.label,
          new Vec2(rightTopLeft.x + 52.0 * panelScale, rowY),
          wgl.makeColor(1, 1, 1, 178 / 255),
        );

        let valueColor = CONTROLS_REBIND_VALUE_COLOR;
        if (hoveredRow) valueColor = CONTROLS_REBIND_HOVER_COLOR;
        if (activeRow) valueColor = CONTROLS_REBIND_ACTIVE_COLOR;
        drawSmallText(font, valueText, valuePos, valueColor);

        const valueW = measureSmallTextWidth(font, valueText);
        const underlineY = rowLayout.rowY + 13.0 * panelScale;
        wgl.drawRectangle(
          int(valuePos.x), int(underlineY),
          Math.max(0, int(valueW)), 1,
          valueColor,
        );

        rowY += 16.0 * panelScale;
      }
      y = rowY + 8.0 * panelScale;
    }

    if (rebindActive && (this._rebindPlayerIndex ?? -1) === playerIdx) {
      const hintPos = new Vec2(
        rightTopLeft.x + 48.0 * panelScale,
        rightTopLeft.y + (CONTROLS_RIGHT_PANEL_HEIGHT - 26.0) * panelScale,
      );
      drawSmallText(
        font,'Esc/Right: cancel  Backspace: default  Delete: unbind',
        hintPos,
        wgl.makeColor(1, 226 / 255, 188 / 255, 220 / 255),
      );
    }
  }

  private _drawDropdown(
    opts: {
      layout: ControlsDropdownLayout;
      items: string[];
      selectedIndex: number;
      isOpen: boolean;
      enabled: boolean;
      scale: number;
      resources: RuntimeResources;
      font: SmallFontData;
    },
  ): void {
    const layout = opts.layout;
    const items = opts.items;
    const selectedIndex = opts.selectedIndex;
    const isOpen = opts.isOpen;
    const enabled = opts.enabled;
    const scale = opts.scale;
    const resources = opts.resources;
    const font = opts.font;
    const [mx, my] = InputState.mousePosition();
    const mouse = { x: mx, y: my };
    const hoveredHeader = enabled && mouseInsideRectWithPadding(
      mouse, { pos: layout.pos, width: layout.width, height: 14.0 * scale },
    );

    const widgetH = isOpen ? layout.fullH : layout.headerH;

    wgl.drawRectangle(
      int(layout.pos.x), int(layout.pos.y),
      int(layout.width), int(widgetH),
      wgl.makeColor(1, 1, 1, 1),
    );
    const innerW = Math.max(0, int(layout.width) - 2);
    const innerH = Math.max(0, int(widgetH) - 2);
    wgl.drawRectangle(
      int(layout.pos.x) + 1, int(layout.pos.y) + 1,
      innerW, innerH,
      wgl.makeColor(0, 0, 0, 1),
    );

    if ((isOpen || hoveredHeader) && enabled) {
      const lineH = Math.max(1, int(1.0 * scale));
      wgl.drawRectangle(
        int(layout.pos.x),
        int(layout.pos.y + 15.0 * scale),
        int(layout.width), lineH,
        wgl.makeColor(1, 1, 1, 128 / 255),
      );
    }

    const arrowTex = ((isOpen || hoveredHeader) && enabled)
      ? getTexture(resources, TextureId.UI_DROP_ON)
      : getTexture(resources, TextureId.UI_DROP_OFF);
    wgl.drawTexturePro(
      arrowTex,
      wgl.makeRectangle(0.0, 0.0, arrowTex.width, arrowTex.height),
      wgl.makeRectangle(layout.arrowPos.x, layout.arrowPos.y, layout.arrowSize.x, layout.arrowSize.y),
      ORIGIN, 0.0, WHITE,
    );

    const idx = items.length > 0 ? Math.max(0, Math.min(items.length - 1, int(selectedIndex))) : 0;
    const headerAlpha = ((isOpen || hoveredHeader) && enabled) ? 242 / 255 : 191 / 255;
    if (items.length > 0) {
      drawSmallText(font, items[idx], layout.textPos, wgl.makeColor(1, 1, 1, headerAlpha));
    }

    if (!isOpen) return;

    for (let i = 0; i < items.length; i++) {
      const itemY = layout.rowsY0 + layout.rowH * i;
      const hovered = enabled && mouseInsideRectWithPadding(
        mouse, { pos: new Vec2(layout.pos.x, itemY), width: layout.width, height: 14.0 * scale },
      );
      let alpha = 153 / 255;
      if (hovered) alpha = 242 / 255;
      if (i === selectedIndex) alpha = Math.max(alpha, 245 / 255);
      drawSmallText(font, items[i], new Vec2(layout.textPos.x, itemY), wgl.makeColor(1, 1, 1, alpha));
    }
  }
}
