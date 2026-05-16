// Port of crimson/camera.py

// Camera helpers recovered from the original crimsonland.exe.
//
// This module currently models the `camera_update` screen shake logic, which is
// global state in the original game.

import { Vec2 } from '@grim/geom.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';

export function cameraShakeStart(state: GameplayState, opts: { pulses: number; timer: number }): void {
  // Start a camera shake sequence.
  //
  // Mirrors the nuke path in `bonus_apply`, which sets:
  //   - `camera_shake_pulses = 0x14`
  //   - `camera_shake_timer = 0.2`

  const pulses = opts.pulses;
  const timer = opts.timer;
  state.cameraShakePulses = Math.trunc(pulses);
  state.cameraShakeTimer = timer;
}

export function cameraShakeUpdate(state: GameplayState, dt: number): void {
  // Update camera shake offsets and timers.
  //
  // Port of `camera_update` (crimsonland.exe @ 0x00409500):
  //   - timer decays at `dt * 3.0`
  //   - when timer drops below 0, a "pulse" happens:
  //     - pulses--
  //     - timer resets to 0.1 (or 0.06 when time scaling is active)
  //     - offsets jump to new RNG-derived values

  if (state.cameraShakeTimer <= 0.0) {
    state.cameraShakeOffset = new Vec2();
    return;
  }

  state.cameraShakeTimer -= dt * 3.0;
  if (state.cameraShakeTimer >= 0.0) {
    return;
  }

  state.cameraShakePulses -= 1;
  if (state.cameraShakePulses < 1) {
    state.cameraShakeTimer = 0.0;
    return;
  }

  const timeScaleActive = state.bonuses.reflexBoost > 0.0;
  state.cameraShakeTimer = timeScaleActive ? 0.06 : 0.1;

  // Decompiled logic:
  //   iVar4 = camera_shake_pulses * 0x3c;
  //   iVar1 = rand() % (iVar4 / 0x14) + rand() % 10;
  // ... where (pulses * 0x3c) / 0x14 == pulses * 3.
  const maxAmp = Math.trunc(state.cameraShakePulses) * 3;
  if (maxAmp <= 0) {
    state.cameraShakeOffset = new Vec2();
    state.cameraShakeTimer = 0.0;
    state.cameraShakePulses = 0;
    return;
  }

  let magX = state.rng.rand({ caller: RngCallerStatic.CAMERA_UPDATE_OFFSET_X_BASE }) % maxAmp + state.rng.rand({ caller: RngCallerStatic.CAMERA_UPDATE_OFFSET_X_SPREAD }) % 10;
  if ((state.rng.rand({ caller: RngCallerStatic.CAMERA_UPDATE_OFFSET_X_SIGN }) & 1) === 0) {
    magX = -magX;
  }
  const offsetX = magX;

  let magY = state.rng.rand({ caller: RngCallerStatic.CAMERA_UPDATE_OFFSET_Y_BASE }) % maxAmp + state.rng.rand({ caller: RngCallerStatic.CAMERA_UPDATE_OFFSET_Y_SPREAD }) % 10;
  if ((state.rng.rand({ caller: RngCallerStatic.CAMERA_UPDATE_OFFSET_Y_SIGN }) & 1) === 0) {
    magY = -magY;
  }
  const offsetY = magY;
  state.cameraShakeOffset = new Vec2(offsetX, offsetY);
}
