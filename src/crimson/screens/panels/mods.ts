// Port of crimson/screens/panels/mods.py

import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import type { GameState } from '@crimson/game/types.ts';
import { MENU_PANEL_WIDTH, uiElementAnim } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS, PanelMenuView } from '@crimson/screens/panels/base.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { readdirSync } from 'node:fs';
import * as wgl from '@wgl';

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

function _basename(path: string): string {
  const normalized = path.replace(/\/+$/g, '');
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? normalized : normalized.slice(idx + 1);
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

export class ModsContentLayout {
  readonly scale: number;
  readonly basePos: Vec2;
  readonly labelPos: Vec2;

  constructor(opts: {
    scale: number;
    basePos: Vec2;
    labelPos: Vec2;
  }) {
    this.scale = opts.scale;
    this.basePos = opts.basePos;
    this.labelPos = opts.labelPos;
  }
}

export class ModsMenuView extends PanelMenuView {
  private _lines: string[];

  constructor(state: GameState) {
    super(state, { title: 'Mods' });
    this._lines = [];
  }

  open(): void {
    super.open();
    this._lines = this._buildLines();
  }

  _contentLayout(): ModsContentLayout {
    const [panelScale, localShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW });
    const panelTopLeft = (new Vec2(this._panelPos.x + slideX, this._panelPos.y + this._widescreenYShift).add(this._panelOffset.mul(panelScale)));
    const basePos = panelTopLeft.add(new Vec2(212.0 * panelScale, 32.0 * panelScale));
    const labelPos = basePos.offset({ dx: 8.0 * panelScale });
    return new ModsContentLayout({ scale: panelScale, basePos: basePos, labelPos: labelPos });
  }

  _buildLines(): string[] {
    const modsDir = _pathJoin(this.state.baseDir, 'mods');
    let dlls: string[] = [];
    try {
      dlls = Array.from(_globPath(String(modsDir), '*.dll')).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    } catch (exc) {
      dlls = [];
    }

    if (dlls.length === 0) {
      return [
        'No mod DLLs found.',
        '',
        'Expected location:',
        `  ${modsDir}`,
        '',
        'Mod loading is not implemented yet.',
      ];
    }

    const lines = [`Found ${dlls.length} mod DLL(s):`, ''];
    for (const path of dlls.slice(0, 10)) {
      lines.push(`  ${_basename(String(path))}`);
    }
    if (dlls.length > 10) {
      lines.push(`  ... (${dlls.length - 10} more)`);
    }
    lines.push('');
    lines.push('Mod loading is not implemented yet.');
    return lines;
  }

  _drawContents(): void {
    const layout = this._contentLayout();
    const basePos = layout.basePos;
    const labelPos = layout.labelPos;
    const scale = layout.scale;

    const font = requireRuntimeResources(this.state).smallFont;
    const titleColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255);
    const textColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);

    drawSmallText(font, 'MODS', basePos, titleColor);
    let linePos = labelPos.offset({ dy: 44.0 * scale });
    const lineStep = (font.cellSize + 4.0) * scale;
    for (const line of this._lines) {
      drawSmallText(font, line, linePos, textColor);
      linePos = linePos.offset({ dy: lineStep });
    }
  }
}
