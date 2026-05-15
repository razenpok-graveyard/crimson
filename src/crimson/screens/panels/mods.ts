// Port of crimson/screens/panels/mods.py

import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { type GameState } from '@crimson/game/types.ts';
import { MENU_PANEL_WIDTH, uiElementAnim } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_START_MS, PANEL_TIMELINE_END_MS, PanelMenuView } from './base.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';

class ModsContentLayout {
  readonly scale: number;
  readonly basePos: Vec2;
  readonly labelPos: Vec2;

  constructor(opts: { scale: number; basePos: Vec2; labelPos: Vec2 }) {
    this.scale = opts.scale;
    this.basePos = opts.basePos;
    this.labelPos = opts.labelPos;
  }
}

export class ModsMenuView extends PanelMenuView {
  private _lines: string[] = [];

  constructor(state: GameState) {
    super(state, { title: 'Mods' });
  }

  open(): void {
    super.open();
    this._lines = this._buildLines();
  }

  private _contentLayout(): ModsContentLayout {
    const [panelScale, _localShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [_angleRad, slideX] = uiElementAnim(this, {
      index: 1,
      startMs: PANEL_TIMELINE_START_MS,
      endMs: PANEL_TIMELINE_END_MS,
      width: panelW,
    });
    const panelTopLeft = new Vec2(
      this._panelPos.x + slideX,
      this._panelPos.y + this._widescreenYShift,
    ).add(this._panelOffset.mul(panelScale));
    const basePos = panelTopLeft.add(new Vec2(212.0 * panelScale, 32.0 * panelScale));
    const labelPos = basePos.offset({ dx: 8.0 * panelScale });
    return new ModsContentLayout({ scale: panelScale, basePos, labelPos });
  }

  private _buildLines(): string[] {
    const modsDir = this.state.baseDir ? `${this.state.baseDir}/mods` : 'mods';
    return [
      'No mod DLLs found.',
      '',
      'Expected location:',
      `  ${modsDir}`,
      '',
      'Mod loading is not implemented yet.',
    ];
  }

  protected _drawContents(): void {
    const resources = requireRuntimeResources(this.state);
    const layout = this._contentLayout();
    const basePos = layout.basePos;
    const labelPos = layout.labelPos;
    const scale = layout.scale;

    const font = resources.smallFont;
    const titleColor = wgl.makeColor(1, 1, 1, 1);
    const textColor = wgl.makeColor(1, 1, 1, int(255 * 0.8) / 255);

    drawSmallText(font, 'MODS', basePos, titleColor);
    let linePos = labelPos.offset({ dy: 44.0 * scale });
    const lineStep = (font.cellSize + 4.0) * scale;
    for (const line of this._lines) {
      drawSmallText(font, line, linePos, textColor);
      linePos = linePos.offset({ dy: lineStep });
    }
  }
}
