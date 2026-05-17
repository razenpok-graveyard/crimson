// Port of crimson/screens/panels/databases_perks.py

import { playSfx } from '@grim/audio.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GameState } from '@crimson/game/types.ts';
import type { PerkId } from '@crimson/perks/index.ts';
import { perkDisplayName, perkDisplayDescription, PERK_BY_ID } from '@crimson/perks/index.ts';
import { perksDbRightDetailXShift } from '@crimson/screens/high-scores-layout.ts';
import { DatabaseBaseView } from '@crimson/screens/panels/databases-base.ts';
import { buildPerkAvailability } from '@crimson/perks/availability.ts';
import * as wgl from '@wgl';

function tupleKey(value: readonly unknown[] | string): string {
  return typeof value === 'string' ? value : value.join(',');
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

function pyRound(value: number, ndigits = 0): number {
  const factor = 10 ** ndigits;
  const scaled = value * factor;
  const floorValue = Math.floor(scaled);
  const frac = scaled - floorValue;
  if (frac < 0.5) {
    return floorValue / factor;
  }
  if (frac > 0.5) {
    return (floorValue + 1) / factor;
  }
  return (floorValue % 2 === 0 ? floorValue : floorValue + 1) / factor;
}

export class UnlockedPerksDatabaseView extends DatabaseBaseView {
  protected _VISIBLE_ROWS: number = 10;
  protected _LIST_WIDTH: number = 250.0;
  protected _LIST_FRAME_X: number = 212.0;
  protected _LIST_FRAME_Y: number = 126.0;
  protected _LIST_ROW_HEIGHT: number = 16.0;
  protected _LIST_TEXT_X: number = 218.0;
  protected _LIST_TEXT_Y: number = 128.0;
  protected _DESC_WRAP_WIDTH_PX: number = 256.0;
  protected _perkIds: PerkId[];
  protected _listScrollIndex: number;
  protected _selectedRowIndex: number;
  protected _hoveredRowIndex: number;
  protected _navFocusIndex: number;
  protected _scrollDragActive: boolean;
  protected _scrollDragOffset: number;
  protected _wrappedDescCache: Map<string, string>;

  constructor(state: GameState) {
    super(state);
    this._perkIds = [];
    this._listScrollIndex = 0;
    this._selectedRowIndex = 0;
    this._hoveredRowIndex = -1;
    this._navFocusIndex = 0;
    this._scrollDragActive = false;
    this._scrollDragOffset = 0.0;
    this._wrappedDescCache = new Map();
  }

  open(): void {
    super.open();
    this._perkIds = this._buildPerkDatabaseIds();
    this._hoveredRowIndex = -1;
    this._scrollDragActive = false;
    this._scrollDragOffset = 0.0;
    this._wrappedDescCache.clear();
    if (this._perkIds.length === 0) {
      this._listScrollIndex = 0;
      this._selectedRowIndex = 0;
      this._navFocusIndex = 0;
      return;
    }
    const maxScroll = Math.max(0, this._perkIds.length - this._VISIBLE_ROWS);
    this._listScrollIndex = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));
    this._selectedRowIndex = Math.max(0, int(this._selectedRowIndex));
    this._navFocusIndex = Math.max(0, Math.min(1, int(this._navFocusIndex)));
  }

  protected _backButtonPos(): Vec2 {
    // state_16: ui_buttonSm bbox [258,509]..[340,541] => relative to left panel (-98,194): (356, 315)
    return new Vec2(356.0, 315.0);
  }

  protected _drawContents(opts: { leftTopLeft: Vec2; rightTopLeft: Vec2; scale: number; font: SmallFontData }): void {
    const leftTopLeft = opts.leftTopLeft;
    const rightTopLeft = opts.rightTopLeft;
    const scale = opts.scale;
    const font = opts.font;
    const left = leftTopLeft;
    const right = rightTopLeft;
    const textColor = wgl.makeColor(1, 1, 1, 1);
    const dimColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.7) / 255);
    const violenceDisabled = this._violenceDisabled();
    const detailShiftX = perksDbRightDetailXShift(this.state.config.display.width);

    // state_16 title at (163,244) => relative to left panel (-98,194): (261,50)
    const titlePos = left.add(new Vec2(261.0 * scale, 50.0 * scale));
    const titleText = 'Unlocked Perks Database';
    drawSmallText(font, titleText, titlePos, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255));
    const titleW = measureSmallTextWidth(font, titleText);
    // Decompile path draws a 1px outline strip under the title with alpha 0.5.
    wgl.drawRectangleLinesEx(wgl.makeRectangle(titlePos.x, titlePos.y + 13.0 * scale, titleW, Math.max(1.0, 1.0 * scale)), 1.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255));

    const perkIds = this._perkIds;
    const count = perkIds.length;
    const perkLabel = count === 1 ? 'perk' : 'perks';
    drawSmallText(font, `${count} ${perkLabel} in database`, left.add(new Vec2(210.0 * scale, 78.0 * scale)), dimColor);
    drawSmallText(font, 'Perks', left.add(new Vec2(210.0 * scale, 106.0 * scale)), textColor);

    const frameX = left.x + this._LIST_FRAME_X * scale;
    const frameY = left.y + this._LIST_FRAME_Y * scale;
    const frameW = this._LIST_WIDTH * scale;
    const frameH = (this._VISIBLE_ROWS * this._LIST_ROW_HEIGHT + 4.0) * scale;
    wgl.drawRectangle(int(pyRound(frameX)), int(pyRound(frameY)), int(pyRound(frameW)), int(pyRound(frameH)), wgl.makeColor(1, 1, 1, 1));
    wgl.drawRectangle(int(pyRound(frameX + 1.0 * scale)), int(pyRound(frameY + 1.0 * scale)), Math.max(0, int(pyRound(frameW - 2.0 * scale))), Math.max(0, int(pyRound(frameH - 2.0 * scale))), wgl.makeColor(0, 0, 0, 1));

    const maxScroll = Math.max(0, perkIds.length - this._VISIBLE_ROWS);
    const start = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));
    const end = Math.min(perkIds.length, start + this._VISIBLE_ROWS);
    const listTopLeft = left.add(new Vec2(this._LIST_TEXT_X * scale, this._LIST_TEXT_Y * scale));
    const rowStep = this._LIST_ROW_HEIGHT * scale;
    const preserveBugs = this._preserveBugs();
    for (const [row, perkId] of perkIds.slice(start, end).entries()) {
      const listIndex = start + row;
      let rowAlpha: number;
      if (listIndex === this._hoveredRowIndex) {
        rowAlpha = 1.0;
      } else if (listIndex === this._selectedRowIndex) {
        rowAlpha = 0.9;
      } else {
        rowAlpha = 0.7;
      }
      drawSmallText(font, UnlockedPerksDatabaseView._perkName(perkId, { violenceDisabled: violenceDisabled, preserveBugs: preserveBugs }), listTopLeft.offset({ dy: row * rowStep }), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * rowAlpha) / 255));
    }

    if (count > this._VISIBLE_ROWS) {
      // Native list draws a 1px scrollbar strip + draggable thumb.
      const [trackX, trackY, trackH, thumbTop, thumbH, scrollSpan] = this._scrollbarGeometry({ leftTopLeft: left, scale: scale, count: count, start: start });
      wgl.drawRectangle(int(pyRound(trackX)), int(pyRound(trackY)), Math.max(1, int(pyRound(1.0 * scale))), int(pyRound(trackH)), wgl.makeColor(1, 1, 1, 1));
      wgl.drawRectangle(int(pyRound(trackX + 1.0 * scale)), int(pyRound(thumbTop)), Math.max(1, int(pyRound(8.0 * scale))), Math.max(1, int(pyRound(thumbH + 1.0 * scale))), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255));
      wgl.drawRectangle(int(pyRound(trackX + 2.0 * scale)), int(pyRound(thumbTop + 1.0 * scale)), Math.max(1, int(pyRound(6.0 * scale))), Math.max(1, int(pyRound(Math.max(1.0, thumbH - 1.0 * scale)))), wgl.makeColor(51 / 255, 204 / 255, 255 / 255, int(255 * 0.2) / 255));
    }

    const hoveredPerkId = this._hoveredPerkId();
    if (hoveredPerkId === null) {
      return;
    }
    const perkId = hoveredPerkId;
    const perkName = UnlockedPerksDatabaseView._perkName(perkId, { violenceDisabled: violenceDisabled, preserveBugs: preserveBugs });
    const detailAnchor = right.add(new Vec2((34.0 + detailShiftX) * scale, 72.0 * scale));
    const perkNoLabel = preserveBugs ? 'perkno' : 'perk';
    drawSmallText(font, `${perkNoLabel} #${perkId}`, detailAnchor.add(new Vec2(190.0 * scale, -40.0 * scale)), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.4) / 255));
    const nameW = measureSmallTextWidth(font, perkName);
    const perkNamePos = new Vec2(detailAnchor.x + 128.0 * scale - nameW * 0.5, detailAnchor.y - 22.0 * scale);
    drawSmallText(font, perkName, perkNamePos, textColor);
    wgl.drawRectangleLinesEx(wgl.makeRectangle(perkNamePos.x, perkNamePos.y + 13.0 * scale, nameW, Math.max(1.0, 1.0 * scale)), 1.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255));

    let descPos = detailAnchor.add(new Vec2(16.0 * scale, 0.0));
    const prereqName = UnlockedPerksDatabaseView._perkPrereqName(perkId, { violenceDisabled: violenceDisabled, preserveBugs: preserveBugs });
    if (prereqName) {
      drawSmallText(font, `Requires: ${prereqName}`, descPos, wgl.makeColor(255 / 255, 204 / 255, 204 / 255, int(255 * 0.8) / 255));
      descPos = descPos.offset({ dy: 18.0 * scale });
    }

    const wrappedDesc = this._prewrappedPerkDesc(perkId, font, { violenceDisabled: violenceDisabled });
    if (wrappedDesc) {
      drawSmallText(font, wrappedDesc, descPos, dimColor);
    }
  }

  protected _updateContentInteraction(opts: { leftTopLeft: Vec2; scale: number; mouse: wgl.Vector2 }): void {
    const leftTopLeft = opts.leftTopLeft;
    const scale = opts.scale;
    const mouse = opts.mouse;
    const perkIds = this._perkIds;
    const count = perkIds.length;
    this._hoveredRowIndex = -1;
    if (count <= 0) {
      this._listScrollIndex = 0;
      this._selectedRowIndex = 0;
      this._navFocusIndex = 0;
      this._scrollDragActive = false;
      return;
    }

    const maxScroll = Math.max(0, count - this._VISIBLE_ROWS);
    this._listScrollIndex = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));
    this._selectedRowIndex = Math.max(0, int(this._selectedRowIndex));

    if (InputState.wasKeyPressed(37)) {
      this._navFocusIndex = Math.max(0, int(this._navFocusIndex) - 1);
    }
    if (InputState.wasKeyPressed(39)) {
      this._navFocusIndex = Math.min(1, int(this._navFocusIndex) + 1);
    }

    if (this._navFocusIndex === 1) {
      if (InputState.wasKeyPressed(38)) {
        this._listScrollIndex -= 1;
      }
      if (InputState.wasKeyPressed(40)) {
        this._listScrollIndex += 1;
      }
      if (InputState.wasKeyPressed(33)) {
        this._listScrollIndex -= this._VISIBLE_ROWS - 1;
      }
      if (InputState.wasKeyPressed(34)) {
        this._listScrollIndex += this._VISIBLE_ROWS - 1;
      }
    }

    const listHitX = leftTopLeft.x + this._LIST_FRAME_X * scale;
    const listHitY = leftTopLeft.y + this._LIST_FRAME_Y * scale;
    const listHitW = this._LIST_WIDTH * scale;
    const listHitH = (this._VISIBLE_ROWS * this._LIST_ROW_HEIGHT + 4.0) * scale;
    const mouseInList = listHitX <= mouse.x && mouse.x < listHitX + listHitW && listHitY <= mouse.y && mouse.y < listHitY + listHitH;
    if (mouseInList) {
      this._navFocusIndex = 1;
    }

    const wheel = int(InputState.mouseWheelDelta());
    if (wheel && (mouseInList || this._navFocusIndex === 1)) {
      this._listScrollIndex -= wheel;
    }

    let start: any;
    if (count > this._VISIBLE_ROWS) {
      start = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));
      const [trackX, trackY, trackH, thumbTop, thumbH, scrollSpan] = this._scrollbarGeometry({ leftTopLeft: leftTopLeft, scale: scale, count: count, start: start });
      const thumbX = trackX + 1.0 * scale;
      const thumbW = 8.0 * scale;
      const click = InputState.wasMouseButtonPressed(0);
      const down = InputState.isMouseButtonDown(0);
      const inTrack = trackX <= mouse.x && mouse.x < trackX + 10.0 * scale && trackY <= mouse.y && mouse.y < trackY + trackH;
      const inThumb = thumbX <= mouse.x && mouse.x < thumbX + thumbW && thumbTop <= mouse.y && mouse.y < thumbTop + thumbH + 1.0 * scale;

      let travel: number;
      let target: number;
      if (click && inTrack) {
        this._navFocusIndex = 1;
        if (inThumb) {
          this._scrollDragActive = true;
          this._scrollDragOffset = (mouse.y - thumbTop);
        } else {
          travel = Math.max(1.0, trackH - 3.0 * scale - thumbH);
          target = (mouse.y - trackY - 1.0 * scale - thumbH * 0.5);
          target = Math.max(0.0, Math.min(travel, target));
          this._listScrollIndex = int(pyRound((target / travel) * scrollSpan));
          this._scrollDragActive = true;
          this._scrollDragOffset = thumbH * 0.5;
        }
      }

      if (this._scrollDragActive) {
        if (down) {
          travel = Math.max(1.0, trackH - 3.0 * scale - thumbH);
          target = (mouse.y - trackY - 1.0 * scale - this._scrollDragOffset);
          target = Math.max(0.0, Math.min(travel, target));
          this._listScrollIndex = int(pyRound((target / travel) * scrollSpan));
        } else {
          this._scrollDragActive = false;
        }
      }
    } else {
      this._scrollDragActive = false;
    }

    this._listScrollIndex = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));

    start = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));
    const end = Math.min(count, start + this._VISIBLE_ROWS);
    const rowCount = end - start;
    if (rowCount > 0 && mouseInList) {
      const rowStep = this._LIST_ROW_HEIGHT * scale;
      const listTextTop = leftTopLeft.y + this._LIST_TEXT_Y * scale;
      const row = int(Math.floor((mouse.y - listTextTop) / rowStep));
      if (0 <= row && row < rowCount) {
        this._hoveredRowIndex = start + row;
        if (InputState.wasMouseButtonPressed(0)) {
          this._selectedRowIndex = this._hoveredRowIndex;
        }
      }
    }

    if (this._navFocusIndex === 0 && (InputState.wasKeyPressed(13) || InputState.wasKeyPressed(335))) {
      if (this.state.audio !== null) {
        playSfx(this.state.audio, SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('back_to_previous');
    }
  }

  protected _hoveredPerkId(): PerkId | null {
    if (int(this._hoveredRowIndex) >= 0 && int(this._hoveredRowIndex) < this._perkIds.length) {
      return this._perkIds[int(this._hoveredRowIndex)];
    }
    return null;
  }

  protected _selectedPerkId(): PerkId | null {
    if (int(this._selectedRowIndex) >= 0 && int(this._selectedRowIndex) < this._perkIds.length) {
      return this._perkIds[int(this._selectedRowIndex)];
    }
    return null;
  }

  protected _scrollbarGeometry(opts: { leftTopLeft: Vec2; scale: number; count: number; start: number }): [number, number, number, number, number, number] {
    const leftTopLeft = opts.leftTopLeft;
    const scale = opts.scale;
    const count = opts.count;
    const start = opts.start;
    const trackX = leftTopLeft.x + (this._LIST_FRAME_X + 240.0) * scale;
    const trackY = leftTopLeft.y + this._LIST_FRAME_Y * scale;
    const trackH = (this._VISIBLE_ROWS * this._LIST_ROW_HEIGHT + 4.0) * scale;
    const scrollSpan = Math.max(1, int(count) - this._VISIBLE_ROWS);
    let thumbH = (this._VISIBLE_ROWS / count) * trackH;
    thumbH = Math.min(thumbH, trackH - 3.0 * scale);
    const thumbTop = trackY + 1.0 * scale + ((trackH - 3.0 * scale - thumbH) / scrollSpan) * start;
    return [trackX, trackY, trackH, thumbTop, thumbH, scrollSpan];
  }

  protected _buildPerkDatabaseIds(): PerkId[] {

    const available = buildPerkAvailability({ status: this.state.status });
    const perkIds = Array.from(Array.from(available), (item, index) => [index, item] as const).filter(([idx, available]) => available && idx > 0).map(([idx, available]) => idx);
    perkIds.sort((a, b) => a - b);
    return perkIds;
  }

  protected static _perkName(perkId: PerkId, opts: { violenceDisabled?: number; preserveBugs?: boolean } = {}): string {
    const violenceDisabled = opts.violenceDisabled ?? 0;
    const preserveBugs = opts.preserveBugs ?? false;

    return perkDisplayName(perkId, { violenceDisabled: int(violenceDisabled), preserveBugs: preserveBugs });
  }

  protected static _perkDesc(perkId: PerkId, opts: { violenceDisabled?: number; preserveBugs?: boolean } = {}): string {
    const violenceDisabled = opts.violenceDisabled ?? 0;
    const preserveBugs = opts.preserveBugs ?? false;

    return perkDisplayDescription(perkId, { violenceDisabled: int(violenceDisabled), preserveBugs: preserveBugs });
  }

  protected static _perkPrereqName(perkId: PerkId, opts: { violenceDisabled?: number; preserveBugs?: boolean } = {}): string | null {
    const violenceDisabled = opts.violenceDisabled ?? 0;
    const preserveBugs = opts.preserveBugs ?? false;

    const meta = PERK_BY_ID.get(perkId) ?? null;
    if (meta === null) {
      return null;
    }
    const prereq = meta.prereq;
    if (!prereq) {
      return null;
    }
    return perkDisplayName(prereq[0], { violenceDisabled: int(violenceDisabled), preserveBugs: preserveBugs });
  }

  protected _preserveBugs(): boolean {
    return this.state.preserveBugs;
  }

  protected _violenceDisabled(): number {
    return this.state.config.display.violenceDisabled;
  }

  protected _prewrappedPerkDesc(perkId: PerkId, font: SmallFontData, opts: { violenceDisabled: number }): string {
    const violenceDisabled = opts.violenceDisabled;
    const key: [number, number, number] = [int(perkId), int(violenceDisabled), (pythonTruthy(this._preserveBugs()) ? 1 : 0)];
    const cached = this._wrappedDescCache.get(tupleKey(key)) ?? null;
    if (cached !== null) {
      return cached;
    }
    const desc = UnlockedPerksDatabaseView._perkDesc(perkId, { violenceDisabled: violenceDisabled, preserveBugs: this._preserveBugs() });
    const wrapped = UnlockedPerksDatabaseView._wrapSmallTextNative(font, desc, this._DESC_WRAP_WIDTH_PX, { scale: 1.0 });
    this._wrappedDescCache.set(tupleKey(key), wrapped);
    return wrapped;
  }

  protected static _wrapSmallTextNative(font: SmallFontData, text: string, maxWidthPx: number, opts: { scale: number }): string {
    const scale = opts.scale;
    const wrapped = Array.from(text);
    if (wrapped.length === 0) {
      return '';
    }

    const maxWidth = maxWidthPx;
    let remaining = maxWidth;
    let i = 0;
    while (i < wrapped.length) {
      const ch = wrapped[i];
      if (ch === '\r') {
        i += 1;
        continue;
      }
      if (ch === '\n') {
        remaining = maxWidth;
        i += 1;
        continue;
      }

      remaining -= measureSmallTextWidth(font, ch);
      let j: number;
      if (remaining < 0.0) {
        j = i;
        while (j > 0 && wrapped[j] !== ' ' && wrapped[j] !== '\n') {
          j -= 1;
        }
        if (wrapped[j] === ' ') {
          wrapped[j] = '\n';
          i = j;
        }
        remaining = maxWidth;
      }
      i += 1;
    }

    return wrapped.join("");
  }
}
