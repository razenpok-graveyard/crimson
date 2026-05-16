// Port of crimson/ui/demo_trial_overlay.py

import { TextureId, runtimeResourcesFor } from '@grim/assets.ts';
import { drawSmallText, loadSmallFont } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import { InputState } from '@grim/input.ts';
import type { DemoTrialOverlayInfo } from '@crimson/demo-trial.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import * as wgl from '@wgl';

export const DEMO_PURCHASE_URL = 'http://buy.crimsonland.com';
const _DEMO_HEADER_TEXT = 'You\'ve been playing the Demo version of';
const _QUEST_COMPLETED_TEXT = 'You\'ve completed all Quest mode levels available in the Demo version.';
const _QUEST_LIMIT_REMAINING_TEXT = 'However, you still have {remaining} time left to play Survival and Rush game modes.';
const _QUEST_GRACE_USED_UP_TEXT = 'You have used up your play time in this game mode. However, you still';
const _QUEST_GRACE_REMAINING_TEXT = 'have {remaining} time left to play Quest mode levels only.';
const _UPGRADE_ALL_FEATURES_TEXT = 'If you would like to have unlimited play time and access to all features,';
const _UPGRADE_FEATURES_LINE_TEXT = 'The full version features unrestricted access to all 3';
const _UPGRADE_BUY_FULL_TEXT = 'Buy the full version to gain unrestricted access to all 3';
const _UPGRADE_BUY_LINE_TEXT = 'game modes and be able to post your scores on the Internet. Why not buy';
const _UPGRADE_TRAILER_TEXT = 'it now? You\'ll have a great time!';
const _UPGRADE_PLEASE_TEXT = 'please upgrade to the full version of Crimsonland.';
const _UPGRADE_PROCESS_TEXT = 'please upgrade to the full version of Crimsonland.  The process is very easy';
const _UPGRADE_PROCESS_CONT_TEXT = 'and takes just minutes. ';
const _UPGRADE_EASY_TEXT = 'is very easy and takes just minutes.';
const _TIME_UP_TEXT = 'Trial time is up. If you would like to have unlimited play time and access to';
const _TIME_UP_ALL_FEATURES_TEXT = 'all features, please upgrade to the full version of Crimsonland.  The process';

export class DemoTrialOverlayUi {
  private _assetsRoot: string;
  private _font: ReturnType<typeof loadSmallFont>;
  private _resources: ReturnType<typeof runtimeResourcesFor>;
  private _cursorPulseTime: number;
  private _purchaseButton: UiButtonState;
  private _maybeLaterButton: UiButtonState;

  constructor(assetsRoot: string) {
    this._assetsRoot = assetsRoot;

    this._font = loadSmallFont(this._assetsRoot);
    this._resources = runtimeResourcesFor(this._assetsRoot);
    this._cursorPulseTime = 0.0;

    this._purchaseButton = new UiButtonState({ label: 'Purchase', forceWide: true });
    this._maybeLaterButton = new UiButtonState({ label: 'Maybe later', forceWide: true });
  }

  close(): void {
    this._cursorPulseTime = 0.0;
  }

  static _panelXy(opts: { screenW: number; screenH: number }): Vec2 {
    const screenW = opts.screenW;
    const screenH = opts.screenH;
    return new Vec2(screenW * 0.5 - 256.0, screenH * 0.5 - 128.0);
  }

  update(dtMs: number): string | null {
    dtMs = Math.max(0, int(dtMs));
    this._cursorPulseTime += dtMs * 0.001 * 1.1;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    mouse.x = clamp(mouse.x, 0.0, Math.max(0.0, screenW - 1.0));
    mouse.y = clamp(mouse.y, 0.0, Math.max(0.0, screenH - 1.0));

    const click = InputState.wasMouseButtonPressed(0);
    const panelPos = DemoTrialOverlayUi._panelXy({ screenW: screenW, screenH: screenH });

    const scale = 1.0;
    const buttonW = buttonWidth(this._resources, this._purchaseButton.label, { scale: scale, forceWide: true });
    const gap = 20.0;
    const rowW = buttonW * 2.0 + gap;
    const buttonBasePos = panelPos.add(new Vec2(256.0 - rowW * 0.5, 214.0));

    const purchaseClicked = buttonUpdate(this._purchaseButton, { pos: buttonBasePos, width: buttonW, dtMs: dtMs, mouse: mouse, click: click });
    const maybeClicked = buttonUpdate(this._maybeLaterButton, { pos: buttonBasePos.offset({ dx: buttonW + gap }), width: buttonW, dtMs: dtMs, mouse: mouse, click: click });

    if (purchaseClicked) {
      return 'purchase';
    }
    if (maybeClicked) {
      return 'maybe_later';
    }
    return null;
  }

  draw(info: DemoTrialOverlayInfo): void {
    if (!info.visible) {
      return;
    }

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const panelPos = DemoTrialOverlayUi._panelXy({ screenW: screenW, screenH: screenH });

    wgl.drawRectangle(int(panelPos.x), int(panelPos.y), 512, 256, wgl.makeColor(18 / 255, 18 / 255, 22 / 255, 230 / 255));
    wgl.drawRectangleLines(int(panelPos.x), int(panelPos.y), 512, 256, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255));

    const logo = this._resources.texture(TextureId.CL_LOGO);
    const src = wgl.makeRectangle(0.0, 0.0, logo.width, logo.height);
    const dst = wgl.makeRectangle(panelPos.x + 72.0, panelPos.y + 22.0, 371.2, 46.4);
    wgl.drawTexturePro(logo, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    const font = this._font;
    if (font !== null) {
      drawSmallText(font, _DEMO_HEADER_TEXT, new Vec2(panelPos.x + 131.0, panelPos.y + 9.0), wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255));
    } else {
      wgl.drawText(_DEMO_HEADER_TEXT, int(panelPos.x + 131.0), int(panelPos.y + 9.0), 16, wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255));
    }

    const bodyX = panelPos.x + 26.0;
    const bodyColor = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255);
    for (let [yOffset, line] of overlayBodyLines(info)) {
      if (font !== null) {
        drawSmallText(font, line, new Vec2(bodyX, panelPos.y + yOffset), bodyColor);
      } else {
        wgl.drawText(line, int(bodyX), int(panelPos.y + yOffset), 16, bodyColor);
      }
    }

    const scale = 1.0;
    const buttonW = 145.0 * scale;
    const gap = 20.0;
    const rowW = buttonW * 2.0 + gap;
    const buttonBasePos = panelPos.add(new Vec2(256.0 - rowW * 0.5, 214.0));
    buttonDraw(
      this._resources,
      this._purchaseButton,
      { pos: buttonBasePos, width: buttonW, scale: scale },
    );
    buttonDraw(
      this._resources,
      this._maybeLaterButton,
      { pos: buttonBasePos.offset({ dx: buttonW + gap }), width: buttonW, scale: scale },
    );
    drawMenuCursor(
      this._resources.texture(TextureId.PARTICLES),
      this._resources.texture(TextureId.UI_CURSOR),
      { pos: Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })()), pulseTime: this._cursorPulseTime },
    );
  }
}

export function overlayBodyLines(info: DemoTrialOverlayInfo): [number, string][] {
  if (info.kind === 'quest_tier_limit') {
    if (info.showRemainingLine) {
      return [[74.0, _QUEST_COMPLETED_TEXT], [92.0, _QUEST_LIMIT_REMAINING_TEXT.replaceAll('{remaining}', String(info.remainingLabel))], [124.0, _UPGRADE_ALL_FEATURES_TEXT], [142.0, _UPGRADE_PLEASE_TEXT], [164.0, _UPGRADE_FEATURES_LINE_TEXT], [182.0, _UPGRADE_BUY_LINE_TEXT], [200.0, _UPGRADE_TRAILER_TEXT]];
    }
    return [[86.0, _QUEST_COMPLETED_TEXT], [104.0, _UPGRADE_ALL_FEATURES_TEXT], [122.0, _UPGRADE_PLEASE_TEXT], [144.0, _UPGRADE_FEATURES_LINE_TEXT], [162.0, _UPGRADE_BUY_LINE_TEXT], [180.0, _UPGRADE_TRAILER_TEXT]];
  }
  if (info.kind === 'quest_grace_left') {
    return [[73.0, _QUEST_GRACE_USED_UP_TEXT], [89.0, _QUEST_GRACE_REMAINING_TEXT.replaceAll('{remaining}', String(info.remainingLabel))], [111.0, _UPGRADE_ALL_FEATURES_TEXT], [127.0, _UPGRADE_PROCESS_TEXT], [143.0, _UPGRADE_PROCESS_CONT_TEXT], [165.0, _UPGRADE_BUY_FULL_TEXT], [181.0, _UPGRADE_BUY_LINE_TEXT], [197.0, _UPGRADE_TRAILER_TEXT]];
  }
  return [[80.0, _TIME_UP_TEXT], [98.0, _TIME_UP_ALL_FEATURES_TEXT], [116.0, _UPGRADE_EASY_TEXT], [140.0, _UPGRADE_BUY_FULL_TEXT], [158.0, _UPGRADE_BUY_LINE_TEXT], [176.0, _UPGRADE_TRAILER_TEXT]];
}
