// Port of crimson/ui/text_input.py

import type { CrimsonConfig } from '@grim/config.ts';
import type { CrandLike } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { INPUT_CODE_UNBOUND, inputCodeIsDown } from '@crimson/input-codes.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';

const _CONTROL_BIND_SLOTS = 5;
export const SINGLE_PLAYER_ALT_MOVE_CODES: readonly number[] = [0xC8, 0xD0, 0xCB, 0xCD];

export function pollTextInput(maxLen: number, opts: { allowSpace?: boolean } = {}): string {
  const allowSpace = opts.allowSpace ?? true;
  let out = '';
  while (true) {
    const value = InputState.getCharPressed();
    if (value === 0) {
      break;
    }
    if (value < 0x20 || value > 0xFF) {
      continue;
    }
    if (!allowSpace && value === 0x20) {
      continue;
    }
    if (Array.from(out).length >= maxLen) {
      continue;
    }
    out += String.fromCodePoint(int(value));
  }
  return out;
}

export function flushTextInputEvents(): void {
  // Native flows call `grim_flush_input()` before entering high-score name input.
  while (InputState.getCharPressed()) {
  }
  while (InputState.getKeyPressed()) {
  }
}

export function updateNameEntryText(text: string, caret: number, opts: { maxLen: number; rng: CrandLike; playSfx?: ((arg0: SfxId) => void) | null }): [string, number] {
  const maxLen = opts.maxLen;
  const rng = opts.rng;
  const playSfx = opts.playSfx ?? null;
  const typed = pollTextInput(maxLen - Array.from(text).length, { allowSpace: true });
  if (typed.length > 0) {
    text = (text.slice(0, caret) + typed + text.slice(caret)).slice(0, maxLen);
    caret = Math.min(Array.from(text).length, caret + Array.from(typed).length);
    if (playSfx !== null) {
      playSfx((rng.rand({ caller: RngCallerStatic.UI_TEXT_INPUT_UPDATE_TYPECLICK }) & 1) === 0 ? SfxId.UI_TYPECLICK_01 : SfxId.UI_TYPECLICK_02);
    }
  }
  if (InputState.wasKeyPressed(8) && caret > 0) {
    text = text.slice(0, caret - 1) + text.slice(caret);
    caret -= 1;
    if (playSfx !== null) {
      playSfx((rng.rand({ caller: RngCallerStatic.UI_TEXT_INPUT_UPDATE_TYPECLICK }) & 1) === 0 ? SfxId.UI_TYPECLICK_01 : SfxId.UI_TYPECLICK_02);
    }
  }
  if (InputState.wasKeyPressed(37)) {
    caret = Math.max(0, caret - 1);
  }
  if (InputState.wasKeyPressed(39)) {
    caret = Math.min(Array.from(text).length, caret + 1);
  }
  if (InputState.wasKeyPressed(36)) {
    caret = 0;
  }
  if (InputState.wasKeyPressed(35)) {
    caret = Array.from(text).length;
  }
  return [text, caret];
}

export function gameplayControlsHeld(config: CrimsonConfig): boolean {
  const playerCount = Math.max(1, Math.min(4, config.gameplay.playerCount));
  for (let playerIndex = 0; playerIndex < playerCount; playerIndex++) {
    const playerControls = config.controls.player(playerIndex);
    const [moveForwardKey, moveBackwardKey, turnLeftKey, turnRightKey] = playerControls.moveCodes;
    for (const code of [
      moveForwardKey,
      moveBackwardKey,
      turnLeftKey,
      turnRightKey,
      playerControls.fireCode,
    ].slice(0, _CONTROL_BIND_SLOTS)) {
      if (code === INPUT_CODE_UNBOUND) {
        continue;
      }
      if (inputCodeIsDown(code, { playerIndex: playerIndex })) {
        return true;
      }
    }
  }

  for (const code of SINGLE_PLAYER_ALT_MOVE_CODES) {
    if (inputCodeIsDown(int(code), { playerIndex: 0 })) {
      return true;
    }
  }
  return false;
}
