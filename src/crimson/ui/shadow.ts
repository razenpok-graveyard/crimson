// Port of crimson/ui/shadow.py

import { rd, rl } from '@grim/raylib-api.ts';

// ui_element_render (0x446c40): shadow pass uses offset (7, 7), tint 0x44444444, and
// blend factors (src=ZERO, dst=ONE_MINUS_SRC_ALPHA).
export const UI_SHADOW_OFFSET = 7.0;
export const UI_SHADOW_TINT = rl.makeColor(0x44 / 255, 0x44 / 255, 0x44 / 255, 0x44 / 255);

export function drawUiQuadShadow(opts: { texture: rl.Texture; src: rl.Rectangle; dst: rl.Rectangle; origin: rl.Vector2; rotationDeg: number }): void {
  // NOTE: raylib/rlgl tracks custom blend factors as state; some backends
  // only apply them when switching the blend mode.
  const texture = opts.texture;
  const src = opts.src;
  const dst = opts.dst;
  const origin = opts.origin;
  const rotationDeg = opts.rotationDeg;
  rl.rlSetBlendFactorsSeparate(rd.RL_ZERO, rd.RL_ONE_MINUS_SRC_ALPHA, rd.RL_FUNC_ADD, rd.RL_ZERO, rd.RL_ONE, rd.RL_FUNC_ADD);
  rl.beginBlendMode(rl.BlendMode.CUSTOM);
  rl.rlSetBlendFactorsSeparate(rd.RL_ZERO, rd.RL_ONE_MINUS_SRC_ALPHA, rd.RL_FUNC_ADD, rd.RL_ZERO, rd.RL_ONE, rd.RL_FUNC_ADD);
  rl.drawTexturePro(texture, src, dst, origin, rotationDeg, UI_SHADOW_TINT);
  rl.endBlendMode();
}
