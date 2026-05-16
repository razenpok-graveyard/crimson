// Port of crimson/screens/transitions.py

import type { GameState } from '@crimson/game/types.ts';
import * as wgl from '@wgl';

export const SCREEN_FADE_OUT_RATE = 2.0;
export const SCREEN_FADE_IN_RATE = 10.0;

export function updateScreenFade(state: GameState, dt: number): void {
  if (state.screenFadeRamp) {
    state.screenFadeAlpha += dt * SCREEN_FADE_IN_RATE;
  } else {
    state.screenFadeAlpha -= dt * SCREEN_FADE_OUT_RATE;
  }
  if (state.screenFadeAlpha < 0.0) {
    state.screenFadeAlpha = 0.0;
  } else if (state.screenFadeAlpha > 1.0) {
    state.screenFadeAlpha = 1.0;
  }
}

export function drawScreenFade(state: GameState): void {
  const alpha = state.screenFadeAlpha;
  if (alpha <= 0.0) {
    return;
  }
  const shade = int(Math.max(0.0, Math.min(1.0, alpha)) * 255.0);
  wgl.drawRectangle(0, 0, int(wgl.getScreenWidth()), int(wgl.getScreenHeight()), wgl.makeColor(0 / 255, 0 / 255, 0 / 255, shade / 255));
}
