// Port of crimson/screens/panels/controls.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import { defaultCrimsonCfg } from '@grim/config.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import type { AimScheme } from '@crimson/aim-schemes.ts';
import type { GameState } from '@crimson/game/types.ts';
import { INPUT_CODE_UNBOUND, captureFirstPressedInputCode, inputCodeName } from '@crimson/input-codes.ts';
import { MovementControlType } from '@crimson/movement-controls.ts';
import { DropdownLayoutBase } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_PANEL_HEIGHT, MENU_PANEL_WIDTH, uiElementAnim } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS, PanelMenuView } from '@crimson/screens/panels/base.ts';
import { RebindRowSpec, RebindTarget, controlsAimMethodDropdownIds, controlsRebindPlan, inputConfigureForLabel, inputSchemeLabel } from '@crimson/screens/panels/controls-labels.ts';
import { mouseInsideRectWithPadding } from '@crimson/screens/panels/hit-test.ts';
import * as wgl from '@wgl';

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
export const CONTROLS_REBIND_ACTIVE_COLOR = wgl.makeColor(255 / 255, 228 / 255, 170 / 255, 255 / 255);

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

export class ControlsDropdownLayout extends DropdownLayoutBase {
  readonly arrowPos: Vec2;
  readonly arrowSize: Vec2;
  readonly textPos: Vec2;
  readonly textScale: number;

  constructor(opts: {
    arrowPos: Vec2;
    arrowSize: Vec2;
    textPos: Vec2;
    textScale: number;
  } & ConstructorParameters<typeof DropdownLayoutBase>[0]) {
    super(opts);
    this.arrowPos = opts.arrowPos;
    this.arrowSize = opts.arrowSize;
    this.textPos = opts.textPos;
    this.textScale = opts.textScale;
  }
}

export class RebindRowLayout {
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
  protected _configPlayer: number;
  protected _moveMethodOpen: boolean;
  protected _aimMethodOpen: boolean;
  protected _playerProfileOpen: boolean;
  protected _dirty: boolean;
  protected _rebindRow: RebindRowSpec | null;
  protected _rebindPlayerIndex: number | null;
  protected _rebindSkipFrames: number;

  get configPlayer(): number {
    return this._configPlayer;
  }
  get moveMethodOpen(): boolean {
    return this._moveMethodOpen;
  }
  get aimMethodOpen(): boolean {
    return this._aimMethodOpen;
  }
  get playerProfileOpen(): boolean {
    return this._playerProfileOpen;
  }
  get dirty(): boolean {
    return this._dirty;
  }
  get rebindRow(): RebindRowSpec | null {
    return this._rebindRow;
  }
  get rebindPlayerIndex(): number | null {
    return this._rebindPlayerIndex;
  }
  get rebindSkipFrames(): number {
    return this._rebindSkipFrames;
  }

  constructor(state: GameState) {
    super(state, { title: 'Controls', backAction: 'open_options', panelPos: new Vec2(CONTROLS_LEFT_PANEL_POS_X, CONTROLS_LEFT_PANEL_POS_Y), backPos: new Vec2(CONTROLS_BACK_POS_X, CONTROLS_BACK_POS_Y) });
    this._configPlayer = 1;
    this._moveMethodOpen = false;
    this._aimMethodOpen = false;
    this._playerProfileOpen = false;
    this._dirty = false;
    this._rebindRow = null;
    this._rebindPlayerIndex = null;
    this._rebindSkipFrames = 0;
  }

  open(): void {
    super.open();
    this._configPlayer = Math.max(1, Math.min(4, int(this._configPlayer)));
    this._moveMethodOpen = false;
    this._aimMethodOpen = false;
    this._playerProfileOpen = false;
    this._dirty = false;
    this._clearRebindCapture();
  }

  update(dt: number): void {
    super.update(dt);
    if (this._closing) {
      return;
    }
    const entry = this._entry;
    if (entry === null || !this._entryEnabled(entry)) {
      return;
    }
    const [panelScale, localYShift] = this._menuItemScale(0);
    const leftTopLeft = this._leftPanelTopLeft(panelScale);
    const rightTopLeft = this._rightPanelTopLeft(panelScale);
    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;
    let clickConsumed = this._updateMethodDropdowns({ leftTopLeft: leftTopLeft, panelScale: panelScale, font: font });
    if (!clickConsumed) {
      clickConsumed = this._updateRebindCapture({ rightTopLeft: rightTopLeft, panelScale: panelScale, font: font });
    }
    if (!clickConsumed && this._updateDirectionArrowCheckbox({ leftTopLeft: leftTopLeft, panelScale: panelScale, enabled: this._checkboxEnabled(), resources: resources, font: font })) {
      this._dirty = true;
    }
  }

  protected _beginCloseTransition(action: string): void {
    if (this._dirty) {
      let _trySucceeded215 = false;
      try {
        this.state.config.save();
        _trySucceeded215 = true;
      } catch (exc) {
        this.state.console.log.log(`config: save failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
      if (_trySucceeded215) {
        this._dirty = false;
      }
    }
    super._beginCloseTransition(action);
  }

  protected _currentPlayerIndex(): number {
    return Math.max(0, Math.min(3, int(this._configPlayer) - 1));
  }

  protected _rebindActive(): boolean {
    return this._rebindRow !== null && this._rebindPlayerIndex !== null;
  }

  protected _clearRebindCapture(): void {
    this._rebindRow = null;
    this._rebindPlayerIndex = null;
    this._rebindSkipFrames = 0;
  }

  protected _startRebindCapture(opts: { row: RebindRowSpec; playerIndex: number }): void {
    const row = opts.row;
    const playerIndex = opts.playerIndex;
    this._rebindRow = row;
    this._rebindPlayerIndex = Math.max(0, Math.min(3, int(playerIndex)));
    this._moveMethodOpen = false;
    this._aimMethodOpen = false;
    this._playerProfileOpen = false;
    // Ignore the click that opened capture so Mouse1 is not rebound accidentally.
    this._rebindSkipFrames = 1;
  }

  protected static _capturePromptForBinding(row: RebindRowSpec): string {
    if (row.axis) {
      return '<press axis>';
    }
    return '<press input>';
  }

  protected _bindingDefaultCode(opts: { playerIndex: number; row: RebindRowSpec }): number {
    const playerIndex = opts.playerIndex;
    const row = opts.row;
    return defaultRowBindingCode(playerIndex, row);
  }

  protected _bindingCode(opts: { playerIndex: number; row: RebindRowSpec }): number {
    const playerIndex = opts.playerIndex;
    const row = opts.row;
    return rowBindingCode(row, { playerIndex: playerIndex, controls: this.state.config.controls });
  }

  protected _setBindingCode(opts: { playerIndex: number; row: RebindRowSpec; code: number }): void {
    const playerIndex = opts.playerIndex;
    const row = opts.row;
    const code = opts.code;
    setRowBindingCode(row, int(code), { playerIndex: playerIndex, controls: this.state.config.controls });
  }

  protected _leftPanelTopLeft(panelScale: number): Vec2 {
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW });
    return new Vec2(controlsLeftPanelPosX(this.state.config.display.width) + slideX, this._panelPos.y + this._widescreenYShift).add(this._panelOffset.mul(panelScale));
  }

  protected _rightPanelTopLeft(panelScale: number): Vec2 {
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [, slideX] = uiElementAnim(this, { index: 3, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW, directionFlag: 1 });
    return new Vec2(controlsRightPanelPosX(this.state.config.display.width) + slideX, controlsRightPanelPosY(this.state.config.display.width) + this._widescreenYShift).add(this._panelOffset.mul(panelScale));
  }

  protected _directionArrowEnabled(): boolean {
    return this.state.config.controls.player(this._currentPlayerIndex()).showDirectionArrow;
  }

  protected _setDirectionArrowEnabled(enabled: boolean): void {
    this.state.config.controls.player(this._currentPlayerIndex()).showDirectionArrow = enabled;
  }

  protected _checkboxEnabled(): boolean {
    return !(this._moveMethodOpen || this._aimMethodOpen || this._rebindActive());
  }

  protected _checkboxHovered(opts: { leftTopLeft: Vec2; panelScale: number; enabled: boolean; resources: RuntimeResources; font: SmallFontData }): boolean {
    const leftTopLeft = opts.leftTopLeft;
    const panelScale = opts.panelScale;
    const enabled = opts.enabled;
    const resources = opts.resources;
    const font = opts.font;
    if (!enabled) {
      return false;
    }
    const checkOn = resources.texture(TextureId.UI_CHECK_ON);
    const textScale = 1.0 * panelScale;
    const label = 'Show direction arrow';
    const checkPos = new Vec2(leftTopLeft.x + 213.0 * panelScale, leftTopLeft.y + 174.0 * panelScale);
    const labelW = measureSmallTextWidth(font, label);
    const rectW = checkOn.width * panelScale + 6.0 * panelScale + labelW;
    const rectH = Math.max(checkOn.height * panelScale, font.cellSize * textScale);
    const mousePos = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    return Rect.fromTopLeft(checkPos, rectW, rectH).contains(mousePos);
  }

  protected _updateDirectionArrowCheckbox(opts: { leftTopLeft: Vec2; panelScale: number; enabled: boolean; resources: RuntimeResources; font: SmallFontData }): boolean {
    const leftTopLeft = opts.leftTopLeft;
    const panelScale = opts.panelScale;
    const enabled = opts.enabled;
    const resources = opts.resources;
    const font = opts.font;
    if (!enabled) {
      return false;
    }
    const hovered = this._checkboxHovered({ leftTopLeft: leftTopLeft, panelScale: panelScale, enabled: enabled, resources: resources, font: font });
    if (hovered && InputState.wasMouseButtonPressed(0)) {
      this._setDirectionArrowEnabled(!this._directionArrowEnabled());
      return true;
    }
    return false;
  }

  protected _rebindSections(opts: { playerIndex: number; aimScheme: AimScheme; moveMode: MovementControlType }): readonly [string, readonly RebindRowSpec[]][] {
    const playerIndex = opts.playerIndex;
    const aimScheme = opts.aimScheme;
    const moveMode = opts.moveMode;
    const [aimRows, moveRows, miscRows] = controlsRebindPlan({ aimScheme: aimScheme, moveMode: moveMode, playerIndex: playerIndex });
    const sections: [string, readonly RebindRowSpec[]][] = [['Aiming', aimRows], ['Moving', moveRows]] as const;
    if (miscRows.length > 0) {
      sections.push(['Misc', miscRows]);
    }
    return Array.from(sections);
  }

  protected _collectRebindRows(opts: { rightTopLeft: Vec2; panelScale: number; playerIndex: number; sections: readonly [string, readonly RebindRowSpec[]][]; font: SmallFontData }): readonly RebindRowLayout[] {
    const rightTopLeft = opts.rightTopLeft;
    const panelScale = opts.panelScale;
    const playerIndex = opts.playerIndex;
    const sections = opts.sections;
    const font = opts.font;
    const rows: RebindRowLayout[] = [];
    let y = rightTopLeft.y + 64.0 * panelScale;
    for (let [sectionTitle, sectionRows] of sections) {
      let rowY = y + 18.0 * panelScale;
      for (const row of sectionRows) {
        const keyCode = int(this._bindingCode({ playerIndex: playerIndex, row: row }));
        const valueText = inputCodeName(keyCode);
        const valuePos = new Vec2(rightTopLeft.x + 180.0 * panelScale, rowY);
        const valueW = Math.max(60.0 * panelScale, measureSmallTextWidth(font, valueText));
        const valueRect = Rect.fromTopLeft(new Vec2(valuePos.x - 2.0 * panelScale, rowY - 2.0 * panelScale), valueW + 4.0 * panelScale, 14.0 * panelScale);
        rows.push(new RebindRowLayout({ row: row, rowY: rowY, valuePos: valuePos, valueRect: valueRect }));
        rowY += 16.0 * panelScale;
      }
      y = rowY + 8.0 * panelScale;
    }
    return Array.from(rows);
  }

  protected _updateRebindCapture(opts: { rightTopLeft: Vec2; panelScale: number; font: SmallFontData }): boolean {
    const rightTopLeft = opts.rightTopLeft;
    const panelScale = opts.panelScale;
    const font = opts.font;
    const playerIdx = this._currentPlayerIndex();
    const playerControls = this.state.config.controls.player(playerIdx);
    const aimScheme = playerControls.aimScheme;
    const moveMode = playerControls.movement;
    const sections = this._rebindSections({ playerIndex: playerIdx, aimScheme: aimScheme, moveMode: moveMode });
    const rows = this._collectRebindRows({ rightTopLeft: rightTopLeft, panelScale: panelScale, playerIndex: playerIdx, sections: sections, font: font });

    if (this._rebindActive()) {
      const activeRow = this._rebindRow || new RebindRowSpec({ label: 'Fire:', target: RebindTarget.PLAYER_FIRE_CODE });
      const activePlayer = int(this._rebindPlayerIndex || 0);
      if (InputState.wasKeyPressed(27) || InputState.wasMouseButtonPressed(2)) {
        this._clearRebindCapture();
        return true;
      }

      if (InputState.wasKeyPressed(8)) {
        this._setBindingCode({
          playerIndex: activePlayer,
          row: activeRow,
          code: this._bindingDefaultCode({ playerIndex: activePlayer, row: activeRow }),
        });
        this._dirty = true;
        this._clearRebindCapture();
        return true;
      }

      if (InputState.wasKeyPressed(46)) {
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
      const captured = captureFirstPressedInputCode({ playerIndex: activePlayer, includeKeyboard: !axisOnly, includeMouse: !axisOnly, includeGamepad: !axisOnly, includeAxes: axisOnly, axisThreshold: 0.5 });
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

    if (!InputState.wasMouseButtonPressed(0)) {
      return false;
    }
    const mouse = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    for (const row of rows) {
      if (row.valueRect.contains(mouse)) {
        this._startRebindCapture({ row: row.row, playerIndex: playerIdx });
        return true;
      }
    }
    return false;
  }

  protected _setPlayerMoveMode(opts: { playerIndex: number; moveMode: MovementControlType }): void {
    const playerIndex = opts.playerIndex;
    const moveMode = opts.moveMode;
    this.state.config.controls.player(playerIndex).movement = moveMode;
  }

  protected _setPlayerAimScheme(opts: { playerIndex: number; aimScheme: AimScheme }): void {
    const playerIndex = opts.playerIndex;
    const aimScheme = opts.aimScheme;
    this.state.config.controls.player(playerIndex).aimScheme = aimScheme;
  }

  protected static _moveMethodIds(opts: { moveMode: MovementControlType }): readonly MovementControlType[] {
    const moveMode = opts.moveMode;
    const items = [MovementControlType.RELATIVE, MovementControlType.STATIC, MovementControlType.DUAL_ACTION_PAD];
    if (moveMode === MovementControlType.MOUSE_POINT_CLICK) {
      items.push(MovementControlType.MOUSE_POINT_CLICK);
    }
    return Array.from(items);
  }

  protected _dropdownLayout(opts: { pos: Vec2; items: readonly string[]; scale: number; font: SmallFontData }): ControlsDropdownLayout {
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
    return new ControlsDropdownLayout({ pos: pos, width: width, headerH: headerH, rowH: rowH, rowsY0: pos.y + 17.0 * scale, fullH: fullH, arrowPos: new Vec2(pos.x + width - arrow - 1.0 * scale, pos.y), arrowSize: new Vec2(arrow, arrow), textPos: pos.add(new Vec2(4.0 * scale, 1.0 * scale)), textScale: textScale });
  }

  protected _updateDropdown(opts: { layout: ControlsDropdownLayout; itemCount: number; isOpen: boolean; enabled: boolean; scale: number }): [boolean, number | null, boolean] {
    const layout = opts.layout;
    const itemCount = opts.itemCount;
    const isOpen = opts.isOpen;
    const enabled = opts.enabled;
    const scale = opts.scale;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
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

  protected _updateMethodDropdowns(opts: { leftTopLeft: Vec2; panelScale: number; font: SmallFontData }): boolean {
    const leftTopLeft = opts.leftTopLeft;
    const panelScale = opts.panelScale;
    const font = opts.font;
    const config = this.state.config;
    const playerIdx = this._currentPlayerIndex();
    const playerControls = config.controls.player(playerIdx);
    const aimScheme = playerControls.aimScheme;
    const moveMode = playerControls.movement;
    const moveModeIds = ControlsMenuView._moveMethodIds({ moveMode: moveMode });
    const moveItems = moveModeIds.map((mode) => inputSchemeLabel(mode));
    const aimItemIds = controlsAimMethodDropdownIds(aimScheme);
    const aimItems = Array.from(aimItemIds).map((scheme) => inputConfigureForLabel(scheme));
    const playerItems: [string, string, string, string] = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

    const moveLayout = this._dropdownLayout({ pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 144.0 * panelScale), items: moveItems, scale: panelScale, font: font });
    const aimLayout = this._dropdownLayout({ pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 102.0 * panelScale), items: aimItems, scale: panelScale, font: font });
    const playerLayout = this._dropdownLayout({ pos: new Vec2(leftTopLeft.x + 340.0 * panelScale, leftTopLeft.y + 56.0 * panelScale), items: playerItems, scale: panelScale, font: font });

    const rebindActive = this._rebindActive();
    const moveEnabled = !(this._aimMethodOpen || this._playerProfileOpen || rebindActive);
    const aimEnabled = !(this._moveMethodOpen || this._playerProfileOpen || rebindActive);
    const playerEnabled = !(this._moveMethodOpen || this._aimMethodOpen || rebindActive);

    let [_selfMoveMethodOpen, moveSelected, consumed] = this._updateDropdown({ layout: moveLayout, itemCount: moveItems.length, isOpen: this._moveMethodOpen, enabled: moveEnabled, scale: panelScale });
    this._moveMethodOpen = _selfMoveMethodOpen;
    let selectedIdx: number;
    if (moveSelected !== null) {
      selectedIdx = Math.max(0, Math.min(int(moveSelected), moveModeIds.length - 1));
      this._setPlayerMoveMode({ playerIndex: playerIdx, moveMode: moveModeIds[selectedIdx] });
      this._dirty = true;
    }
    if (consumed) {
      return true;
    }

    let _selfAimMethodOpen: boolean;
    let aimSelected: number | null;
    [_selfAimMethodOpen, aimSelected, consumed] = this._updateDropdown({ layout: aimLayout, itemCount: aimItems.length, isOpen: this._aimMethodOpen, enabled: aimEnabled, scale: panelScale });
    this._aimMethodOpen = _selfAimMethodOpen;
    if (aimSelected !== null) {
      selectedIdx = Math.max(0, Math.min(int(aimSelected), aimItemIds.length - 1));
      this._setPlayerAimScheme({ playerIndex: playerIdx, aimScheme: aimItemIds[selectedIdx] });
      this._dirty = true;
    }
    if (consumed) {
      return true;
    }

    let _selfPlayerProfileOpen: boolean;
    let playerSelected: number | null;
    [_selfPlayerProfileOpen, playerSelected, consumed] = this._updateDropdown({ layout: playerLayout, itemCount: playerItems.length, isOpen: this._playerProfileOpen, enabled: playerEnabled, scale: panelScale });
    this._playerProfileOpen = _selfPlayerProfileOpen;
    if (playerSelected !== null) {
      this._configPlayer = Math.max(1, Math.min(4, playerSelected + 1));
    }
    if (consumed) {
      return true;
    }

    return false;
  }

  protected _drawPanel(): void {
    const fxDetail = this.state.config.display.fxDetailEnabled({ level: 0, default: false });
    const [panelScale, localYShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const panel = requireRuntimeResources(this.state).texture(TextureId.UI_MENU_PANEL);

    // Left (controls options) panel: standard 254px height => a single quad.
    const leftTopLeft = this._leftPanelTopLeft(panelScale);
    const leftH = MENU_PANEL_HEIGHT * panelScale;
    drawClassicMenuPanel(
      panel,
      { dst: wgl.makeRectangle(leftTopLeft.x, leftTopLeft.y, panelW, leftH), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail },
    );

    // Right (configured bindings) panel: tall 378px panel rendered as 3 vertical slices.
    const rightTopLeft = this._rightPanelTopLeft(panelScale);
    const rightH = CONTROLS_RIGHT_PANEL_HEIGHT * panelScale;
    drawClassicMenuPanel(
      panel,
      { dst: wgl.makeRectangle(rightTopLeft.x, rightTopLeft.y, panelW, rightH), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail, flipX: true },
    );
  }

  protected _drawContents(): void {
    // Positions are expressed relative to the panel top-left corners and scaled with the panel scale.
    const [panelScale, localYShift] = this._menuItemScale(0);

    const leftTopLeft = this._leftPanelTopLeft(panelScale);
    const rightTopLeft = this._rightPanelTopLeft(panelScale);

    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;

    const textColorFull = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255);
    const textColorSoft = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 204 / 255);
    const config = this.state.config;
    const playerIdx = this._currentPlayerIndex();
    const playerControls = config.controls.player(playerIdx);
    const aimScheme = playerControls.aimScheme;
    const moveMode = playerControls.movement;
    const moveModeIds = ControlsMenuView._moveMethodIds({ moveMode: moveMode });
    const moveItems = moveModeIds.map((mode) => inputSchemeLabel(mode));
    const aimItemIds = controlsAimMethodDropdownIds(aimScheme);
    const aimItems = Array.from(aimItemIds).map((scheme) => inputConfigureForLabel(scheme));
    const playerItems: [string, string, string, string] = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
    let moveSelected = moveModeIds.indexOf(moveMode);
    if (moveSelected < 0) {
      moveSelected = 0;
    }
    let aimSelected = aimItemIds.indexOf(aimScheme);
    if (aimSelected < 0) {
      aimSelected = 0;
    }
    const playerSelected = Math.max(0, Math.min(playerItems.length - 1, playerIdx));
    const moveLayout = this._dropdownLayout({ pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 144.0 * panelScale), items: moveItems, scale: panelScale, font: font });
    const aimLayout = this._dropdownLayout({ pos: new Vec2(leftTopLeft.x + 214.0 * panelScale, leftTopLeft.y + 102.0 * panelScale), items: aimItems, scale: panelScale, font: font });
    const playerLayout = this._dropdownLayout({ pos: new Vec2(leftTopLeft.x + 340.0 * panelScale, leftTopLeft.y + 56.0 * panelScale), items: playerItems, scale: panelScale, font: font });

    // --- Left panel: "Configure for" + method selectors (state_3 in trace) ---
    const textControls = resources.texture(TextureId.UI_TEXT_CONTROLS);
    wgl.drawTexturePro(textControls, wgl.makeRectangle(0.0, 0.0, textControls.width, textControls.height), wgl.makeRectangle(leftTopLeft.x + 206.0 * panelScale, leftTopLeft.y + 44.0 * panelScale, 128.0 * panelScale, 32.0 * panelScale), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    drawSmallText(font, 'Configure for:', new Vec2(leftTopLeft.x + 339.0 * panelScale, leftTopLeft.y + 41.0 * panelScale), textColorSoft);

    drawSmallText(font, 'Aiming method:', new Vec2(leftTopLeft.x + 213.0 * panelScale, leftTopLeft.y + 86.0 * panelScale), textColorFull);

    drawSmallText(font, 'Moving method:', new Vec2(leftTopLeft.x + 213.0 * panelScale, leftTopLeft.y + 128.0 * panelScale), textColorFull);

    const checkTex = this._directionArrowEnabled() ? resources.texture(TextureId.UI_CHECK_ON) : resources.texture(TextureId.UI_CHECK_OFF);
    wgl.drawTexturePro(checkTex, wgl.makeRectangle(0.0, 0.0, checkTex.width, checkTex.height), wgl.makeRectangle(leftTopLeft.x + 213.0 * panelScale, leftTopLeft.y + 174.0 * panelScale, 16.0 * panelScale, 16.0 * panelScale), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
    const checkboxHovered = this._checkboxHovered({ leftTopLeft: leftTopLeft, panelScale: panelScale, enabled: this._checkboxEnabled(), resources: resources, font: font });
    const checkboxAlpha = checkboxHovered ? 255 : 178;
    drawSmallText(font, 'Show direction arrow', new Vec2(leftTopLeft.x + 235.0 * panelScale, leftTopLeft.y + 175.0 * panelScale), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, checkboxAlpha / 255));

    const dropdowns: readonly [boolean, ControlsDropdownLayout, readonly string[], number, boolean][] = [[this._playerProfileOpen, playerLayout, playerItems, playerSelected, !(this._moveMethodOpen || this._aimMethodOpen || this._rebindActive())], [this._aimMethodOpen, aimLayout, aimItems, aimSelected, !(this._moveMethodOpen || this._playerProfileOpen || this._rebindActive())], [this._moveMethodOpen, moveLayout, moveItems, moveSelected, !(this._aimMethodOpen || this._playerProfileOpen || this._rebindActive())]];
    // Active list must render last so overlapping widgets don't occlude open options.
    for (let [isOpen, layout, items, selectedIndex, enabled] of dropdowns) {
      if (isOpen) {
        continue;
      }
      this._drawDropdown({
        layout: layout,
        items: items,
        selectedIndex: selectedIndex,
        isOpen: isOpen,
        enabled: enabled,
        scale: panelScale,
        resources: resources,
        font: font,
      });
    }
    for (let [isOpen, layout, items, selectedIndex, enabled] of dropdowns) {
      if (!isOpen) {
        continue;
      }
      this._drawDropdown({
        layout: layout,
        items: items,
        selectedIndex: selectedIndex,
        isOpen: isOpen,
        enabled: enabled,
        scale: panelScale,
        resources: resources,
        font: font,
      });
    }

    // --- Right panel: configured bindings list ---
    const _drawSectionHeading = (title: string, opts: { y: number }): void => {
      const y = opts.y;
      const xHeading = rightTopLeft.x + 44.0 * panelScale;
      drawSmallText(font, title, new Vec2(xHeading, y), textColorFull);
      const line = wgl.makeRectangle(xHeading, y + 13.0 * panelScale, 228.0 * panelScale, Math.max(1.0, panelScale));
      wgl.drawRectangleLinesEx(line, Math.max(1.0, panelScale), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 178 / 255));
    };

    drawSmallText(font, 'Configured controls', new Vec2(rightTopLeft.x + 120.0 * panelScale, rightTopLeft.y + 38.0 * panelScale), textColorFull);
    const headerW = measureSmallTextWidth(font, 'Configured controls');
    const headerLine = wgl.makeRectangle(rightTopLeft.x + 120.0 * panelScale, rightTopLeft.y + 51.0 * panelScale, headerW, Math.max(1.0, panelScale));
    wgl.drawRectangleLinesEx(headerLine, Math.max(1.0, panelScale), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 204 / 255));

    const sections = this._rebindSections({ playerIndex: playerIdx, aimScheme: aimScheme, moveMode: moveMode });
    const rows = this._collectRebindRows({ rightTopLeft: rightTopLeft, panelScale: panelScale, playerIndex: playerIdx, sections: sections, font: font });
    const rowIter = rows[Symbol.iterator]();
    const mouse = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    const dropdownBlocked = this._moveMethodOpen || this._aimMethodOpen || this._playerProfileOpen;
    const rebindActive = this._rebindActive();

    let y = rightTopLeft.y + 64.0 * panelScale;
    for (let [sectionTitle, sectionRows] of sections) {
      _drawSectionHeading(sectionTitle, { y: y });
      let rowY = y + 18.0 * panelScale;
      for (const _ of sectionRows) {
        const row = rowIter.next().value!;
        const activeRow = rebindActive && pythonEquals(this._rebindRow, row.row) && ((int(this._rebindPlayerIndex || -1)) === playerIdx);
        const hoveredRow = !rebindActive && !dropdownBlocked && row.valueRect.contains(mouse);
        const valueText = activeRow ? ControlsMenuView._capturePromptForBinding(row.row) : inputCodeName(this._bindingCode({ playerIndex: playerIdx, row: row.row }));
        const valuePos = row.valuePos;

        drawSmallText(font, row.row.label, new Vec2(rightTopLeft.x + 52.0 * panelScale, rowY), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 178 / 255));
        let valueColor = CONTROLS_REBIND_VALUE_COLOR;
        if (hoveredRow) {
          valueColor = CONTROLS_REBIND_HOVER_COLOR;
        }
        if (activeRow) {
          valueColor = CONTROLS_REBIND_ACTIVE_COLOR;
        }
        drawSmallText(font, valueText, valuePos, valueColor);
        const valueW = measureSmallTextWidth(font, valueText);
        const underlineY = row.rowY + 13.0 * panelScale;
        wgl.drawLine(int(valuePos.x), int(underlineY), int(valuePos.x + valueW), int(underlineY), valueColor);
        rowY += 16.0 * panelScale;
      }
      y = rowY + 8.0 * panelScale;
    }

    if (rebindActive && ((int(this._rebindPlayerIndex || -1)) === playerIdx)) {
      const hintPos = new Vec2(rightTopLeft.x + 48.0 * panelScale, rightTopLeft.y + (CONTROLS_RIGHT_PANEL_HEIGHT - 26.0) * panelScale);
      drawSmallText(font, 'Esc/Right: cancel  Backspace: default  Delete: unbind', hintPos, wgl.makeColor(255 / 255, 226 / 255, 188 / 255, 220 / 255));
    }
  }

  protected _drawDropdown(opts: { layout: ControlsDropdownLayout; items: readonly string[]; selectedIndex: number; isOpen: boolean; enabled: boolean; scale: number; resources: RuntimeResources; font: SmallFontData }): void {
    const layout = opts.layout;
    const items = opts.items;
    const selectedIndex = opts.selectedIndex;
    const isOpen = opts.isOpen;
    const enabled = opts.enabled;
    const scale = opts.scale;
    const resources = opts.resources;
    const font = opts.font;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const hoveredHeader = enabled && mouseInsideRectWithPadding(mouse, { pos: layout.pos, width: layout.width, height: 14.0 * scale });
    const widgetH = isOpen ? layout.fullH : layout.headerH;
    wgl.drawRectangle(int(layout.pos.x), int(layout.pos.y), int(layout.width), int(widgetH), wgl.makeColor(1, 1, 1, 1));
    const innerW = Math.max(0, int(layout.width) - 2);
    const innerH = Math.max(0, int(widgetH) - 2);
    wgl.drawRectangle(int(layout.pos.x) + 1, int(layout.pos.y) + 1, innerW, innerH, wgl.makeColor(0, 0, 0, 1));

    if ((isOpen || hoveredHeader) && enabled) {
      const lineH = Math.max(1, int(1.0 * scale));
      wgl.drawRectangle(int(layout.pos.x), int(layout.pos.y + 15.0 * scale), int(layout.width), lineH, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 128 / 255));
    }
    const arrowTex = ((isOpen || hoveredHeader) && enabled) ? resources.texture(TextureId.UI_DROP_ON) : resources.texture(TextureId.UI_DROP_OFF);
    wgl.drawTexturePro(arrowTex, wgl.makeRectangle(0.0, 0.0, arrowTex.width, arrowTex.height), wgl.makeRectangle(layout.arrowPos.x, layout.arrowPos.y, layout.arrowSize.x, layout.arrowSize.y), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    const idx = items.length > 0 ? Math.max(0, Math.min(items.length - 1, int(selectedIndex))) : 0;
    const headerAlpha = ((isOpen || hoveredHeader) && enabled) ? 242 : 191;
    if (items.length > 0) {
      drawSmallText(font, items[idx], layout.textPos, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, headerAlpha / 255));
    }

    if (!isOpen) {
      return;
    }

    for (const [idx, item] of items.entries()) {
      const itemY = layout.rowsY0 + layout.rowH * idx;
      const hovered = enabled && mouseInsideRectWithPadding(mouse, { pos: new Vec2(layout.pos.x, itemY), width: layout.width, height: 14.0 * scale });
      let alpha = 153;
      if (hovered) {
        alpha = 242;
      }
      if (idx === selectedIndex) {
        alpha = Math.max(alpha, 245);
      }
      drawSmallText(font, item, new Vec2(layout.textPos.x, itemY), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255));
    }
  }
}

export function rowBindingCode(row: RebindRowSpec, opts: { playerIndex: number; controls: any }): number {
  const playerIndex = opts.playerIndex;
  const controls = opts.controls;
  const playerControls = controls.player(playerIndex);
  switch (row.target) {
    case RebindTarget.PLAYER_MOVE_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      return int(playerControls.moveCodes[row.targetIndex]);
    case RebindTarget.PLAYER_FIRE_CODE:
      return int(playerControls.fireCode);
    case RebindTarget.PLAYER_KEYBOARD_AIM_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      return int(playerControls.keyboardAimCodes[row.targetIndex]);
    case RebindTarget.PLAYER_AIM_AXIS_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      return int(playerControls.aimAxisCodes[row.targetIndex]);
    case RebindTarget.PLAYER_MOVE_AXIS_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      return int(playerControls.moveAxisCodes[row.targetIndex]);
    case RebindTarget.GLOBAL_PICK_PERK_CODE:
      return int(controls.pickPerkCode);
    case RebindTarget.GLOBAL_RELOAD_CODE:
      return int(controls.reloadCode);
  }
}

export function setRowBindingCode(row: RebindRowSpec, value: number, opts: { playerIndex: number; controls: any }): void {
  const playerIndex = opts.playerIndex;
  const controls = opts.controls;
  const playerControls = controls.player(playerIndex);
  const code = int(value);
  let values: any;
  switch (row.target) {
    case RebindTarget.PLAYER_MOVE_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      values = Array.from(playerControls.moveCodes);
      values[row.targetIndex] = code;
      playerControls.moveCodes = Array.from(values);
      break;
    case RebindTarget.PLAYER_FIRE_CODE:
      playerControls.fireCode = code;
      break;
    case RebindTarget.PLAYER_KEYBOARD_AIM_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      values = Array.from(playerControls.keyboardAimCodes);
      values[row.targetIndex] = code;
      playerControls.keyboardAimCodes = Array.from(values);
      break;
    case RebindTarget.PLAYER_AIM_AXIS_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      values = Array.from(playerControls.aimAxisCodes);
      values[row.targetIndex] = code;
      playerControls.aimAxisCodes = Array.from(values);
      break;
    case RebindTarget.PLAYER_MOVE_AXIS_CODES:
      if (!(row.targetIndex !== null)) throw new Error();
      values = Array.from(playerControls.moveAxisCodes);
      values[row.targetIndex] = code;
      playerControls.moveAxisCodes = Array.from(values);
      break;
    case RebindTarget.GLOBAL_PICK_PERK_CODE:
      controls.pickPerkCode = code;
      break;
    case RebindTarget.GLOBAL_RELOAD_CODE:
      controls.reloadCode = code;
      break;
  }
}

export function defaultRowBindingCode(playerIndex: number, row: RebindRowSpec): number {
  const controls = defaultCrimsonCfg().controls;
  return rowBindingCode(row, { playerIndex: playerIndex, controls: controls });
}

export function controlsLeftPanelPosX(screenWidth: number): number {
  //
  // Left controls panel X in panel-pos space.
  //
  // Native `ui_menu_layout_init` nudges the controls left panel 18px further left
  // at 640-wide layouts.

  if (int(screenWidth) <= 640) {
    return CONTROLS_LEFT_PANEL_POS_X - 18.0;
  }
  return CONTROLS_LEFT_PANEL_POS_X;
}

export function controlsRightPanelPosX(screenWidth: number): number {
  //
  // Right controls panel X in panel-pos space.
  //
  // Native `ui_menu_layout_init` uses:
  //   slot40_pos_x = screen_width - 350  (+80 at <=640)
  //
  // Our panel-pos abstraction differs by a fixed -84 offset from that slot-space,
  // so this becomes:
  //   x = screen_width - 434  (+80 at <=640).

  const w = int(screenWidth);
  let x = (w - 434);
  if (w <= 640) {
    x += 80.0;
  }
  return x;
}

export function controlsRightPanelPosY(screenWidth: number): number {
  //
  // Right controls panel Y in panel-pos space.
  //
  // Native slot40 y moves from 200 to 186 at <=640. In panel-pos coordinates this
  // is 110 -> 96.

  if (int(screenWidth) <= 640) {
    return CONTROLS_RIGHT_PANEL_POS_Y - 14.0;
  }
  return CONTROLS_RIGHT_PANEL_POS_Y;
}
