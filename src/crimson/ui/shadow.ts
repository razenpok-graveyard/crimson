// Port of crimson/ui/shadow.py

import type { rl } from '@grim/raylib-api.ts';
import * as wgl from '@wgl';

// ui_element_render (0x446c40): shadow pass uses offset (7, 7), tint 0x44444444, and
// blend factors (src=ZERO, dst=ONE_MINUS_SRC_ALPHA).
export const UI_SHADOW_OFFSET = 7.0;
export const UI_SHADOW_TINT = wgl.makeColor(0x44 / 255, 0x44 / 255, 0x44 / 255, 0x44 / 255);

export function drawUiQuadShadow(opts: { texture: rl.Texture; src: wgl.Rectangle; dst: wgl.Rectangle; origin: wgl.Vector2; rotationDeg: number }): void {
  // NOTE: raylib/rlgl tracks custom blend factors as state; some backends
  // only apply them when switching the blend mode.
  const texture = opts.texture;
  const src = opts.src;
  const dst = opts.dst;
  const origin = opts.origin;
  const rotationDeg = opts.rotationDeg;
  wgl.rlSetBlendFactorsSeparate(wgl.RL_ZERO, wgl.RL_ONE_MINUS_SRC_ALPHA, wgl.RL_FUNC_ADD, wgl.RL_ZERO, wgl.RL_ONE, wgl.RL_FUNC_ADD);
  wgl.beginBlendMode(wgl.BlendMode.CUSTOM);
  wgl.rlSetBlendFactorsSeparate(wgl.RL_ZERO, wgl.RL_ONE_MINUS_SRC_ALPHA, wgl.RL_FUNC_ADD, wgl.RL_ZERO, wgl.RL_ONE, wgl.RL_FUNC_ADD);
  wgl.drawTexturePro(texture, src, dst, origin, rotationDeg, UI_SHADOW_TINT);
  wgl.endBlendMode();
}
