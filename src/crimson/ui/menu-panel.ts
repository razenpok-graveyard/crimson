// Port of crimson/ui/menu_panel.py

import { rl } from '@grim/raylib-api.ts';
import { UI_SHADOW_OFFSET, drawUiQuadShadow } from '@crimson/ui/shadow.ts';
import * as wgl from '@wgl';

// Classic menu panel is rendered from the *inset* inner region of ui_menuPanel:
//   - X inset: 1px on each side (uv 1/512 .. 511/512) => 510px wide
//   - Y inset: 1px on each side (uv 1/256 .. 255/256) => 254px tall
//
// When a panel is taller than the base height, the original stretches it using a
// 3-slice: [top][mid][bottom]. The source slice boundaries are at y=130 and y=150
// in the texture (see grim UVs in ui_render_trace).
export const MENU_PANEL_INSET = 1.0;
export const MENU_PANEL_SRC_SLICE_Y1 = 130.0;
export const MENU_PANEL_SRC_SLICE_Y2 = 150.0;
// Destination slice heights observed in the original at scale=1.0 (1024x768).
export const MENU_PANEL_DST_TOP_H = 138.0;
export const MENU_PANEL_DST_BOTTOM_H = 116.0;

export function drawClassicMenuPanel(texture: rl.Texture, opts: { dst: rl.Rectangle; tint?: rl.Color; shadow?: boolean; flipX?: boolean }): void {
  //
  // Draw a classic menu panel (ui_menuPanel) with the same slicing behavior as the original.
  //
  // - Uses inset source rect (1px border skipped) to match the vertex/UV inset.
  // - Uses 3-slice only when dst is taller than (top + bottom); otherwise draws a single quad.

  const dst = opts.dst;
  const tint = opts.tint ?? wgl.makeColor(1, 1, 1, 1);
  const shadow = opts.shadow ?? false;
  const flipX = opts.flipX ?? false;
  const texW = texture.width;
  const texH = texture.height;
  if (texW <= 0.0 || texH <= 0.0) {
    return;
  }

  const inset = MENU_PANEL_INSET;
  const srcX = inset;
  const srcY = inset;
  const srcW = Math.max(0.0, texW - inset * 2.0);
  const srcH = Math.max(0.0, texH - inset * 2.0);

  // Scale slice heights with the panel width (menu panel uses the same scale factor).
  // dst.width is already in our "inset" width space (510 at scale=1.0).
  const scale = dst.w !== 0.0 ? (dst.w / 510.0) : 1.0;
  const topH = MENU_PANEL_DST_TOP_H * scale;
  const bottomH = MENU_PANEL_DST_BOTTOM_H * scale;
  const midH = dst.h - topH - bottomH;

  const origin = wgl.makeVector2(0.0, 0.0);

  const _src = (rect: rl.Rectangle): rl.Rectangle => {
    if (!flipX) {
      return rect;
    }
    // Use negative source width to mirror the panel, but keep src.x in-range.
    //
    // With CLAMP wrap, raylib's DrawTexturePro behaves badly when flipping via
    // src.x=rect.x+rect.width (u near 1.0) and negative widths; it can clamp
    // the UVs to the edge texel and collapse the panel to a transparent strip.
    return wgl.makeRectangle(rect.x, rect.y, -rect.w, rect.h);
  };

  if (midH <= 0.0) {
    const src = _src(wgl.makeRectangle(srcX, srcY, srcW, srcH));
    if (shadow) {
      drawUiQuadShadow({
        texture: texture,
        src: src,
        dst: wgl.makeRectangle(dst.x + UI_SHADOW_OFFSET, dst.y + UI_SHADOW_OFFSET, dst.w, dst.h),
        origin: origin,
        rotationDeg: 0.0,
      });
    }
    wgl.drawTexturePro(texture, src, dst, origin, 0.0, tint);
    return;
  }

  // Source slice rects (in texture pixels, with 1px inset).
  const srcTop = _src(wgl.makeRectangle(srcX, srcY, srcW, Math.max(0.0, MENU_PANEL_SRC_SLICE_Y1 - inset)));
  const srcMid = _src(wgl.makeRectangle(srcX, MENU_PANEL_SRC_SLICE_Y1, srcW, Math.max(0.0, MENU_PANEL_SRC_SLICE_Y2 - MENU_PANEL_SRC_SLICE_Y1)));
  const srcBot = _src(wgl.makeRectangle(srcX, MENU_PANEL_SRC_SLICE_Y2, srcW, Math.max(0.0, (texH - inset) - MENU_PANEL_SRC_SLICE_Y2)));

  // Destination slices.
  const dstTop = wgl.makeRectangle(dst.x, dst.y, dst.w, topH);
  const dstMid = wgl.makeRectangle(dst.x, dst.y + topH, dst.w, midH);
  const dstBot = wgl.makeRectangle(dst.x, dst.y + topH + midH, dst.w, bottomH);

  if (shadow) {
    drawUiQuadShadow({
      texture: texture,
      src: srcTop,
      dst: wgl.makeRectangle(dstTop.x + UI_SHADOW_OFFSET, dstTop.y + UI_SHADOW_OFFSET, dstTop.w, dstTop.h),
      origin: origin,
      rotationDeg: 0.0,
    });
    drawUiQuadShadow({
      texture: texture,
      src: srcMid,
      dst: wgl.makeRectangle(dstMid.x + UI_SHADOW_OFFSET, dstMid.y + UI_SHADOW_OFFSET, dstMid.w, dstMid.h),
      origin: origin,
      rotationDeg: 0.0,
    });
    drawUiQuadShadow({
      texture: texture,
      src: srcBot,
      dst: wgl.makeRectangle(dstBot.x + UI_SHADOW_OFFSET, dstBot.y + UI_SHADOW_OFFSET, dstBot.w, dstBot.h),
      origin: origin,
      rotationDeg: 0.0,
    });
  }

  wgl.drawTexturePro(texture, srcTop, dstTop, origin, 0.0, tint);
  wgl.drawTexturePro(texture, srcMid, dstMid, origin, 0.0, tint);
  wgl.drawTexturePro(texture, srcBot, dstBot, origin, 0.0, tint);
}
