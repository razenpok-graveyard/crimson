// Port of crimson/screens/panels/databases_weapons.py

import { TextureId } from '@grim/assets.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import type { GameState } from '@crimson/game/types.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { weaponsDbRightDetailXShift } from '@crimson/screens/high-scores-layout.ts';
import { DatabaseBaseView } from '@crimson/screens/panels/databases-base.ts';
import { Weapon, WEAPON_TABLE, WeaponId, WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { buildWeaponAvailability } from '@crimson/weapon-runtime/availability.ts';
import { weaponUsageSlotForWeaponId } from '@crimson/weapon-usage.ts';
import * as wgl from '@wgl';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
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

export class UnlockedWeaponsDatabaseView extends DatabaseBaseView {
  protected _weaponIds: number[];
  protected _selectedWeaponId: number | null;
  protected _listScrollIndex: number;

  constructor(state: GameState) {
    super(state);
    this._weaponIds = [];
    this._selectedWeaponId = null;
    this._listScrollIndex = 0;
  }

  open(): void {
    super.open();
    this._weaponIds = this._buildWeaponDatabaseIds();
    this._selectedWeaponId = null;
    this._listScrollIndex = 0;
  }

  close(): void {
    this._selectedWeaponId = null;
    super.close();
  }

  protected _backButtonPos(): Vec2 {
    // state_15: ui_buttonSm bbox [270,507]..[352,539] => relative to left panel (-98,194): (368, 313)
    return new Vec2(368.0, 313.0);
  }

  protected _drawContents(opts: { leftTopLeft: Vec2; rightTopLeft: Vec2; scale: number; font: SmallFontData }): void {
    const leftTopLeft = opts.leftTopLeft;
    const rightTopLeft = opts.rightTopLeft;
    const scale = opts.scale;
    const font = opts.font;
    const left = leftTopLeft;
    const right = rightTopLeft;
    const detailShiftX = weaponsDbRightDetailXShift(this.state.config.display.width);
    const detailTopLeft = right.add(new Vec2(detailShiftX * scale, 0.0));
    const dimColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.7) / 255);
    const textColor = wgl.makeColor(1, 1, 1, 1);

    // state_15 title at (153,244) => relative to left panel (-98,194): (251,50)
    const titlePos = left.add(new Vec2(251.0 * scale, 50.0 * scale));
    const titleText = 'Unlocked Weapons Database';
    drawSmallText(font, titleText, titlePos, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255));
    const titleW = measureSmallTextWidth(font, titleText);
    // Decompile path draws a 1px outline strip under the title with alpha 0.5.
    wgl.drawRectangleLinesEx(wgl.makeRectangle(titlePos.x, titlePos.y + 13.0 * scale, titleW, Math.max(1.0, 1.0 * scale)), 1.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255));

    const weaponIds = this._weaponIds;
    const count = weaponIds.length;
    const weaponLabel = count === 1 ? 'weapon' : 'weapons';
    drawSmallText(font, `${count} ${weaponLabel} in database`, left.add(new Vec2(210.0 * scale, 80.0 * scale)), dimColor);
    drawSmallText(font, 'Weapon', left.add(new Vec2(210.0 * scale, 108.0 * scale)), textColor);

    // Oracle frame: outer [114,322]-[364,486], inner [115,323]-[363,485].
    const frameX = left.x + 212.0 * scale;
    const frameY = left.y + 128.0 * scale;
    const frameW = 250.0 * scale;
    const frameH = 164.0 * scale;
    wgl.drawRectangle(int(pyRound(frameX)), int(pyRound(frameY)), int(pyRound(frameW)), int(pyRound(frameH)), wgl.makeColor(1, 1, 1, 1));
    wgl.drawRectangle(int(pyRound(frameX + 1.0 * scale)), int(pyRound(frameY + 1.0 * scale)), Math.max(0, int(pyRound(frameW - 2.0 * scale))), Math.max(0, int(pyRound(frameH - 2.0 * scale))), wgl.makeColor(0, 0, 0, 1));

    // Oracle list widget is 10 rows tall.
    const listTopLeft = left.add(new Vec2(218.0 * scale, 130.0 * scale));
    const rowStep = 16.0 * scale;
    const visibleRows = 10;
    const maxScroll = Math.max(0, weaponIds.length - visibleRows);
    const start = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));
    const end = Math.min(weaponIds.length, start + visibleRows);
    const visibleWeaponIds = weaponIds.slice(start, end);
    for (const [row, weaponId] of visibleWeaponIds.entries()) {
      let [name, icon] = this._weaponLabelAndIcon(weaponId);
      const rowColor = this._selectedWeaponId !== null && int(weaponId) === int(this._selectedWeaponId) ? textColor : dimColor;
      drawSmallText(font, name, listTopLeft.offset({ dy: row * rowStep }), rowColor);
    }

    if (this._selectedWeaponId === null) {
      return;
    }

    const weaponId = int(this._selectedWeaponId);
    let [name, iconIndex] = this._weaponLabelAndIcon(weaponId);
    const weapon = this._weaponEntry(weaponId);
    const preserveBugs = this.state.preserveBugs;
    const weaponNoLabel = preserveBugs ? 'wepno' : 'weapon';
    drawSmallText(font, `${weaponNoLabel} #${weaponId}`, detailTopLeft.add(new Vec2(240.0 * scale, 32.0 * scale)), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.4) / 255));
    drawSmallText(font, name, detailTopLeft.add(new Vec2(50.0 * scale, 50.0 * scale)), textColor);
    if (iconIndex !== null) {
      this._drawWicon(iconIndex, { pos: detailTopLeft.add(new Vec2(82.0 * scale, 82.0 * scale)), scale: scale });
    }

    const reloadTime = weapon.reloadTime;
    const clipSize = weapon.clipSize;
    const ammoClass = int(weapon.ammoClass || 0);
    const firerateLabel = preserveBugs ? 'Firerate' : 'Fire rate';
    let firerateText: string;
    if (ammoClass === 1) {
      firerateText = `${firerateLabel}: n/a`;
    } else {
      firerateText = `${firerateLabel}: ${this._weaponRpm(weapon)} rpm`;
    }
    drawSmallText(font, firerateText, detailTopLeft.add(new Vec2(66.0 * scale, 128.0 * scale)), textColor);
    drawSmallText(font, `Reload time: ${reloadTime.toFixed(1)} secs`, detailTopLeft.add(new Vec2(66.0 * scale, 146.0 * scale)), textColor);
    drawSmallText(font, `Clip size: ${clipSize}`, detailTopLeft.add(new Vec2(66.0 * scale, 164.0 * scale)), textColor);
  }

  protected _updateContentInteraction(opts: { leftTopLeft: Vec2; scale: number; mouse: wgl.Vector2 }): void {
    const leftTopLeft = opts.leftTopLeft;
    const scale = opts.scale;
    const mouse = opts.mouse;
    const weaponIds = this._weaponIds;
    if (weaponIds.length === 0) {
      this._selectedWeaponId = null;
      this._listScrollIndex = 0;
      return;
    }

    const visibleRows = 10;
    const maxScroll = Math.max(0, weaponIds.length - visibleRows);
    const mouseWheel = int(InputState.mouseWheelDelta());
    if (mouseWheel) {
      this._listScrollIndex = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex) - mouseWheel));
    }
    const start = Math.max(0, Math.min(maxScroll, int(this._listScrollIndex)));
    const end = Math.min(weaponIds.length, start + visibleRows);
    const rowCount = end - start;
    if (rowCount <= 0) {
      this._selectedWeaponId = null;
      return;
    }

    const rowStep = 16.0 * scale;
    const listHitX = leftTopLeft.x + 214.0 * scale;
    const listHitY = leftTopLeft.y + 128.0 * scale;
    const listHitW = 246.0 * scale;
    const listHitH = Math.min(160.0 * scale, rowStep * rowCount);
    if (listHitX <= mouse.x && mouse.x < listHitX + listHitW && listHitY <= mouse.y && mouse.y < listHitY + listHitH) {
      const listTextTop = leftTopLeft.y + 130.0 * scale;
      const row = int(Math.floor((mouse.y - listTextTop) / rowStep));
      if (0 <= row && row < rowCount) {
        this._selectedWeaponId = int(weaponIds[start + row]);
        return;
      }
    }
    this._selectedWeaponId = null;
  }

  protected _buildWeaponDatabaseIds(): number[] {

    const available = buildWeaponAvailability({ status: this.state.status, gameMode: (() => { const value = this.state.config.gameplay.mode; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })(), demoModeActive: this.state.demoEnabled });
    const status = this.state.status;
    const used: number[] = [];
    for (const weapon of WEAPON_TABLE) {
      const weaponId = int(weapon.weaponId);
      let include = false;
      if (weaponId >= 0 && weaponId < available.length) {
        include = Boolean(available[weaponId]);
      }
      if (!include) {
        if (weaponId === WeaponId.PISTOL) {
          include = true;
        } else {
          const usageSlot = weaponUsageSlotForWeaponId(weaponId);
          include = status !== null && usageSlot !== null && status.weaponUsageCountSlot(usageSlot) !== 0;
        }
      }
      if (include) {
        used.push(weaponId);
      }
    }
    used.sort((a, b) => a - b);
    return used;
  }

  protected _weaponEntry(weaponId: number): Weapon {

    return mapGetOrThrow(WEAPON_BY_ID, weaponId);
  }

  protected _weaponRpm(weapon: Weapon): number {
    return int(60.0 / weapon.shotCooldown);
  }

  protected _drawWicon(iconIndex: number, opts: { pos: Vec2; scale: number }): void {
    const pos = opts.pos;
    const scale = opts.scale;
    const tex = requireRuntimeResources(this.state).texture(TextureId.UI_WICONS);
    const idx = int(iconIndex);
    if (idx < 0 || idx > 31) {
      return;
    }
    const grid = 8;
    const cellW = tex.width / grid;
    const cellH = tex.height / grid;
    const frame = idx * 2;
    const srcX = frame % grid * cellW;
    const srcY = Math.floor(frame / grid) * cellH;
    const iconW = cellW * 2.0;
    const iconH = cellH;
    wgl.drawTexturePro(tex, wgl.makeRectangle(srcX, srcY, iconW, iconH), wgl.makeRectangle(pos.x, pos.y, iconW * scale, iconH * scale), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
  }

  protected _weaponLabelAndIcon(weaponId: number): [string, number | null] {

    const weapon = mapGetOrThrow(WEAPON_BY_ID, weaponId);
    const name = weaponDisplayName(weapon.weaponId, { preserveBugs: this.state.preserveBugs });
    return [name, weapon.iconIndex];
  }
}
