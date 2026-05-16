// Port of crimson/render/world/overlays.py

import { TextureId } from '@grim/assets.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { RAD_TO_DEG } from '@crimson/render/world/constants.ts';
import { WorldRenderCtx } from '@crimson/render/world/context.ts';
import * as wgl from '@wgl';

export function grim2dCircleSegmentsFilled(radius: number): number {
  // grim_draw_circle_filled (grim.dll): segments = trunc(radius * 0.125 + 12.0)
  return Math.max(3, int(radius * 0.125 + 12.0));
}

export function grim2dCircleSegmentsOutline(radius: number): number {
  // grim_draw_circle_outline (grim.dll): segments = trunc(radius * 0.2 + 14.0)
  return Math.max(3, int(radius * 0.2 + 14.0));
}

export function drawAimCircle(renderCtx: WorldRenderCtx, opts: { center: Vec2; radius: number; alpha?: number }): void {
  const center = opts.center;
  const radius = opts.radius;
  let alpha = opts.alpha ?? 1.0;
  if (radius <= 1e-3) {
    return;
  }
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }

  const fillA = int(77 * alpha + 0.5); // ui_render_aim_indicators: rgba(0,0,0.1,0.3)
  const outlineA = int(255 * 0.55 * alpha + 0.5);
  const fill = wgl.makeColor(0 / 255, 0 / 255, 26 / 255, fillA / 255);
  const outline = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, outlineA / 255);

  wgl.beginBlendMode(wgl.BlendMode.ALPHA);

  // The original uses a triangle fan (polygons). Raylib provides circle
  // primitives that still use triangles internally, but allow higher
  // segment counts for a smoother result when scaled.
  let segCount = Math.max(grim2dCircleSegmentsFilled(radius), 64, int(radius));
  const centerRl = center.toRl();
  wgl.drawCircleSector(centerRl, radius, 0.0, 360.0, int(segCount), fill);

  segCount = Math.max(grim2dCircleSegmentsOutline(radius), int(segCount));
  // grim_draw_circle_outline draws a 2px-thick ring (outer radius = r + 2).
  // The exe binds bulletTrail, but that texture is white; the visual intent is
  // a subtle white outline around the filled spread circle.
  wgl.drawRing(centerRl, radius, radius + 2.0, 0.0, 360.0, int(segCount), outline);

  wgl.rlSetTexture(0);
  wgl.endBlendMode();
}

export function drawClockGauge(renderCtx: WorldRenderCtx, opts: { pos: Vec2; ms: number; scale: number; alpha?: number }): void {
  const pos = opts.pos;
  const ms = opts.ms;
  const scale = opts.scale;
  const alpha = opts.alpha ?? 1.0;
  const resources = renderCtx.frame.resources;
  const table = resources.texture(TextureId.UI_CLOCK_TABLE);
  const pointer = resources.texture(TextureId.UI_CLOCK_POINTER);
  const size = 32.0 * scale;
  if (size <= 1e-3) {
    return;
  }
  const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(clamp(alpha, 0.0, 1.0) * 255.0 + 0.5) / 255);
  const half = size * 0.5;

  const tableSrc = wgl.makeRectangle(0.0, 0.0, table.width, table.height);
  const tableDst = wgl.makeRectangle(pos.x, pos.y, size, size);
  wgl.drawTexturePro(table, tableSrc, tableDst, wgl.makeVector2(0.0, 0.0), 0.0, tint);

  const seconds = Math.floor(int(ms) / 1000);
  const pointerSrc = wgl.makeRectangle(0.0, 0.0, pointer.width, pointer.height);
  const pointerDst = wgl.makeRectangle(pos.x + half, pos.y + half, size, size);
  const origin = wgl.makeVector2(half, half);
  const rotationDeg = seconds * 6.0;
  wgl.drawTexturePro(pointer, pointerSrc, pointerDst, origin, rotationDeg, tint);
}

export function directionArrowEnabled(renderCtx: WorldRenderCtx, playerIndex: number): boolean {
  const config = renderCtx.frame.config;
  if (config === null) {
    return true;
  }
  return config.controls.player(playerIndex).showDirectionArrow;
}

export function directionArrowTint(renderCtx: WorldRenderCtx, playerIndex: number, opts: { alpha: number }): rl.Color {
  let alpha = opts.alpha;
  alpha = clamp(alpha, 0.0, 1.0);
  if (renderCtx.frame.players.length === 2) {
    if (int(playerIndex) === 0) {
      return wgl.makeColor(204 / 255, 230 / 255, 255 / 255, int(153.0 * alpha + 0.5) / 255);
    }
    return wgl.makeColor(255 / 255, 230 / 255, 204 / 255, int(153.0 * alpha + 0.5) / 255);
  }
  return wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(77.0 * alpha + 0.5) / 255);
}

export function drawDirectionArrows(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }
  const arrow = renderCtx.frame.resources.texture(TextureId.ARROW);

  const src = wgl.makeRectangle(0.0, 0.0, arrow.width, arrow.height);
  const width = Math.max(1.0, arrow.width * scale);
  const height = Math.max(1.0, arrow.height * scale);
  const origin = wgl.makeVector2(width * 0.5, height * 0.5);

  for (const player of renderCtx.frame.players) {
    if (player.health <= 0.0) {
      continue;
    }
    const index = int(player.index);
    if (!directionArrowEnabled(renderCtx, index)) {
      continue;
    }

    const heading = player.heading;
    const markerPos = player.pos.add(Vec2.fromHeading(heading).mul(60.0));
    const screen = WorldRenderCtx.worldToScreenWith(markerPos, { camera: camera, viewScale: viewScale });
    const dst = wgl.makeRectangle(screen.x, screen.y, width, height);
    const tint = directionArrowTint(renderCtx, index, { alpha: alpha });
    wgl.drawTexturePro(arrow, src, dst, origin, heading * RAD_TO_DEG, tint);
  }
}
