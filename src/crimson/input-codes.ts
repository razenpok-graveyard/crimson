// Port of crimson/input_codes.py

import { InputState } from '@grim/input.ts';
import * as wgl from '@wgl';

export class PressedState {
  prevDown: Map<string, boolean>;
  down: Map<string, boolean>;
  pressedCache: Map<string, boolean>;
  wheelUp: boolean;
  wheelDown: boolean;

  constructor(opts: {
    prevDown?: Map<string, boolean>;
    down?: Map<string, boolean>;
    pressedCache?: Map<string, boolean>;
    wheelUp?: boolean;
    wheelDown?: boolean;
  } = {}) {
    this.prevDown = opts.prevDown ?? new Map();
    this.down = opts.down ?? new Map();
    this.pressedCache = opts.pressedCache ?? new Map();
    this.wheelUp = opts.wheelUp ?? false;
    this.wheelDown = opts.wheelDown ?? false;
  }

  beginFrame(): void {
    // Keep last-known key state for keys that are not polled every frame.
    // This preserves edge semantics across temporary input-query gaps and
    // matches the native latch-style behavior used by input_primary_just_pressed.
    this.prevDown = new Map(this.down);
    this.pressedCache = new Map();
    const wheelMove = InputState.mouseWheelDelta();
    this.wheelUp = wheelMove > 0.0;
    this.wheelDown = wheelMove < 0.0;
  }

  markDown(opts: { playerIndex: number; keyCode: number; isDown: boolean }): boolean {
    const playerIndex = opts.playerIndex;
    const keyCode = opts.keyCode;
    const isDown = opts.isDown;
    const key: [number, number] = [int(playerIndex), int(keyCode)];
    this.down.set(tupleKey(key), isDown);
    return isDown;
  }

  isPressed(opts: { playerIndex: number; keyCode: number; isDown: boolean }): boolean {
    const playerIndex = opts.playerIndex;
    const keyCode = opts.keyCode;
    const isDown = opts.isDown;
    const key: [number, number] = [int(playerIndex), int(keyCode)];
    const cached = this.pressedCache.get(tupleKey(key)) ?? null;
    if (cached !== null) {
      return cached;
    }
    const prev = this.prevDown.get(tupleKey(key)) ?? false;
    const pressed = isDown && !prev;
    this.down.set(tupleKey(key), isDown);
    this.pressedCache.set(tupleKey(key), pressed);
    return pressed;
  }
}

export const INPUT_CODE_UNBOUND = 0x17E;
const _AXIS_DEADZONE = 0.2;
const _AXIS_DOWN_THRESHOLD = 0.5;
export const DIK_TO_RL_KEY: Map<number, number> = new Map([
  [0x01, int(27)],
  [0x02, int(49)],
  [0x03, int(50)],
  [0x04, int(51)],
  [0x05, int(52)],
  [0x06, int(53)],
  [0x07, int(54)],
  [0x08, int(55)],
  [0x09, int(56)],
  [0x0A, int(57)],
  [0x0B, int(48)],
  [0x0C, int(189)],
  [0x0D, int(187)],
  [0x0E, int(8)],
  [0x0F, int(9)],
  [0x10, int(81)],
  [0x11, int(87)],
  [0x12, int(69)],
  [0x13, int(82)],
  [0x14, int(84)],
  [0x15, int(89)],
  [0x16, int(85)],
  [0x17, int(73)],
  [0x18, int(79)],
  [0x19, int(80)],
  [0x1A, int(219)],
  [0x1B, int(221)],
  [0x1C, int(13)],
  [0x1D, int(17)],
  [0x1E, int(65)],
  [0x1F, int(83)],
  [0x20, int(68)],
  [0x21, int(70)],
  [0x22, int(71)],
  [0x23, int(72)],
  [0x24, int(74)],
  [0x25, int(75)],
  [0x26, int(76)],
  [0x27, int(186)],
  [0x28, int(222)],
  [0x29, int(192)],
  [0x2A, int(16)],
  [0x2B, int(220)],
  [0x2C, int(90)],
  [0x2D, int(88)],
  [0x2E, int(67)],
  [0x2F, int(86)],
  [0x30, int(66)],
  [0x31, int(78)],
  [0x32, int(77)],
  [0x33, int(188)],
  [0x34, int(190)],
  [0x35, int(191)],
  [0x36, int(16)],
  [0x38, int(18)],
  [0x39, int(32)],
  [0x3B, int(112)],
  [0x3C, int(113)],
  [0x3D, int(114)],
  [0x3E, int(115)],
  [0x3F, int(116)],
  [0x40, int(117)],
  [0x41, int(118)],
  [0x42, int(119)],
  [0x43, int(120)],
  [0x44, int(121)],
  [0x57, int(122)],
  [0x58, int(123)],
  [0x9D, int(17)],
  [0xC8, int(38)],
  [0xC9, int(33)],
  [0xCB, int(37)],
  [0xCD, int(39)],
  [0xD0, int(40)],
  [0xD1, int(34)],
  [0xD2, int(45)],
  [0xD3, int(46)],
  [0xCF, int(35)],
  [0xC7, int(36)],
]);
export const RL_KEY_TO_DIK: Map<number, number> = new Map(Array.from(DIK_TO_RL_KEY.entries(), ([key, value]) => [value, key] as const));
export const MOUSE_CODE_TO_BUTTON: Map<number, number> = new Map([
  [0x100, int(0)],
  [0x101, int(2)],
  [0x102, int(1)],
  [0x103, int(3)],
  [0x104, int(4)],
]);
export const JOYS_BUTTON_CODES: Map<number, number> = new Map([
  [0x11F, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_DOWN)],
  [0x120, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_RIGHT)],
  [0x121, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_LEFT)],
  [0x122, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_UP)],
  [0x123, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_UP)],
  [0x124, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_RIGHT)],
  [0x125, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_DOWN)],
  [0x126, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_LEFT)],
  [0x127, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_TRIGGER_1)],
  [0x128, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_TRIGGER_1)],
  [0x129, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_TRIGGER_2)],
  [0x12A, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_TRIGGER_2)],
  [0x131, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_UP)],
  [0x132, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_DOWN)],
  [0x133, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_LEFT)],
  [0x134, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_FACE_RIGHT)],
]);
export const AXIS_CODE_TO_AXIS: Map<number, number> = new Map([
  [0x13F, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_X)],
  [0x140, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_Y)],
  // Native Grim maps 0x141 and 0x153 to distinct joystick state fields
  // (lZ vs lRx in grim_get_config_float @ 0x100071b0), so keep them distinct.
  // On raylib backends this is approximated with separate right-stick axes.
  [0x141, int(wgl.GamepadAxis.GAMEPAD_AXIS_RIGHT_Y)],
  [0x153, int(wgl.GamepadAxis.GAMEPAD_AXIS_RIGHT_X)],
  [0x154, int(wgl.GamepadAxis.GAMEPAD_AXIS_RIGHT_Y)],
  [0x155, int(wgl.GamepadAxis.GAMEPAD_AXIS_RIGHT_TRIGGER)],
]);
export const RIM_AXIS_CODES: Map<number, [number, number]> = new Map([
  [0x163, [0, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_X)]],
  [0x164, [1, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_X)]],
  [0x165, [2, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_X)]],
  [0x168, [0, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_Y)]],
  [0x169, [1, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_Y)]],
  [0x16A, [2, int(wgl.GamepadAxis.GAMEPAD_AXIS_LEFT_Y)]],
]);
export const RIM_BUTTON_CODES: Map<number, [number, number]> = new Map([
  [0x16D, [0, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_DOWN)]],
  [0x16E, [0, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_RIGHT)]],
  [0x16F, [0, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_LEFT)]],
  [0x170, [0, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_UP)]],
  [0x171, [0, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_TRIGGER_1)]],
  [0x172, [1, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_DOWN)]],
  [0x173, [1, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_RIGHT)]],
  [0x174, [1, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_LEFT)]],
  [0x175, [1, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_UP)]],
  [0x176, [1, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_TRIGGER_1)]],
  [0x177, [2, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_DOWN)]],
  [0x178, [2, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_RIGHT)]],
  [0x179, [2, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_LEFT)]],
  [0x17A, [2, int(wgl.GamepadButton.GAMEPAD_BUTTON_RIGHT_FACE_UP)]],
  [0x17B, [2, int(wgl.GamepadButton.GAMEPAD_BUTTON_LEFT_TRIGGER_1)]],
]);
const _PRESSED_STATE = new PressedState();
const _PRIMARY_EDGE_SENTINEL_PLAYER = -1;
const _PRIMARY_EDGE_SENTINEL_KEY = -1;

function tupleKey(value: readonly unknown[] | string): string {
  return typeof value === 'string' ? value : value.join(',');
}

function dikToRlKey(dikCode: number): number | null {
  return DIK_TO_RL_KEY.get(int(dikCode)) ?? null;
}

function mouseButtonForCode(keyCode: number): number | null {
  return MOUSE_CODE_TO_BUTTON.get(int(keyCode)) ?? null;
}

function playerGamepadIndex(playerIndex: number): number {
  return Math.max(0, Math.min(3, int(playerIndex)));
}

function axisValueForGamepad(gamepadIndex: number, axis: number): number {
  if (!wgl.isGamepadAvailable(int(gamepadIndex))) {
    return 0.0;
  }
  const value = wgl.getGamepadAxisMovement(int(gamepadIndex), int(axis));
  if (Math.abs(value) < _AXIS_DEADZONE) {
    return 0.0;
  }
  return Math.max(-1.0, Math.min(1.0, value));
}

function axisValueFromCode(keyCode: number, opts: { playerIndex: number }): number {
  const playerIndex = opts.playerIndex;
  const code = int(keyCode);
  const axis = AXIS_CODE_TO_AXIS.get(code) ?? null;
  if (axis !== null) {
    return axisValueForGamepad(playerGamepadIndex(playerIndex), axis);
  }
  const rimAxis = RIM_AXIS_CODES.get(code) ?? null;
  if (rimAxis !== null) {
    const [rimPlayer, rimAxisId] = rimAxis;
    return axisValueForGamepad(rimPlayer, rimAxisId);
  }
  return 0.0;
}

export function inputAxisValue(keyCode: number, opts: { playerIndex?: number } = {}): number {
  const playerIndex = opts.playerIndex ?? 0;
  return axisValueFromCode(int(keyCode), { playerIndex: int(playerIndex) });
}

function digitalDownForPlayer(keyCode: number, opts: { playerIndex: number }): boolean {
  const playerIndex = opts.playerIndex;
  const code = int(keyCode);
  if (code === INPUT_CODE_UNBOUND) {
    return false;
  }

  const mouseButton = mouseButtonForCode(code);
  if (mouseButton !== null) {
    return InputState.isMouseButtonDown(mouseButton);
  }
  if (code < 0x100) {
    const rlKey = dikToRlKey(code);
    if (rlKey === null) {
      return false;
    }
    return InputState.isKeyDown(rlKey);
  }
  const joyButton = JOYS_BUTTON_CODES.get(code) ?? null;
  let gamepad: number;
  if (joyButton !== null) {
    gamepad = playerGamepadIndex(playerIndex);
    return wgl.isGamepadAvailable(gamepad) && wgl.isGamepadButtonDown(gamepad, joyButton);
  }
  const rimButton = RIM_BUTTON_CODES.get(code) ?? null;
  if (rimButton !== null) {
    let button: any;
    [gamepad, button] = rimButton;
    return wgl.isGamepadAvailable(gamepad) && wgl.isGamepadButtonDown(gamepad, button);
  }
  if (AXIS_CODE_TO_AXIS.has(code) || RIM_AXIS_CODES.has(code)) {
    return Math.abs(axisValueFromCode(code, { playerIndex: playerIndex })) >= _AXIS_DOWN_THRESHOLD;
  }
  return false;
}

export function inputBeginFrame(): void {
  // Latch input edge state once per rendered frame.

  _PRESSED_STATE.beginFrame();
}

export function inputCodeName(keyCode: number): string {
  keyCode = int(keyCode);
  if (keyCode === INPUT_CODE_UNBOUND) {
    return 'unbound';
  }
  if (keyCode === 0x100) {
    return 'Mouse1';
  }
  if (keyCode === 0x101) {
    return 'Mouse2';
  }
  if (keyCode === 0x102) {
    return 'Mouse3';
  }
  if (keyCode === 0x103) {
    return 'Mouse4';
  }
  if (keyCode === 0x104) {
    return 'Mouse5';
  }
  if (keyCode === 0x109) {
    return 'MWheelUp';
  }
  if (keyCode === 0x10A) {
    return 'MWheelDown';
  }

  const extendedName = new Map([[0x11F, 'Joys1'], [0x120, 'Joys2'], [0x121, 'Joys3'], [0x122, 'Joys4'], [0x123, 'Joys5'], [0x124, 'Joys6'], [0x125, 'Joys7'], [0x126, 'Joys8'], [0x127, 'Joys9'], [0x128, 'Joys10'], [0x129, 'Joys11'], [0x12A, 'Joys12'], [0x131, 'JoysUp'], [0x132, 'JoysDown'], [0x133, 'JoysLeft'], [0x134, 'JoysRight'], [0x13F, 'JoyAxisX'], [0x140, 'JoyAxisY'], [0x141, 'JoyAxisZ'], [0x153, 'JoyRotX'], [0x154, 'JoyRotY'], [0x155, 'JoyRotZ'], [0x163, 'RIM0XAxis'], [0x164, 'RIM1XAxis'], [0x165, 'RIM2XAxis'], [0x168, 'RIM0YAxis'], [0x169, 'RIM1YAxis'], [0x16A, 'RIM2YAxis'], [0x16D, 'RIM0Btn1'], [0x16E, 'RIM0Btn2'], [0x16F, 'RIM0Btn3'], [0x170, 'RIM0Btn4'], [0x171, 'RIM0Btn5'], [0x172, 'RIM1Btn1'], [0x173, 'RIM1Btn2'], [0x174, 'RIM1Btn3'], [0x175, 'RIM1Btn4'], [0x176, 'RIM1Btn5'], [0x177, 'RIM2Btn1'], [0x178, 'RIM2Btn2'], [0x179, 'RIM2Btn3'], [0x17A, 'RIM2Btn4'], [0x17B, 'RIM2Btn5']]).get(keyCode) ?? null;
  if (extendedName !== null) {
    return extendedName;
  }
  if (keyCode > 0x163) {
    return 'RawInput ?';
  }

  if (keyCode < 0x100) {
    const name = new Map([[0x01, 'Escape'], [0x0F, 'Tab'], [0x10, 'Q'], [0x11, 'W'], [0x12, 'E'], [0x13, 'R'], [0x1C, 'Enter'], [0x1D, 'LControl'], [0x1E, 'A'], [0x1F, 'S'], [0x20, 'D'], [0x2A, 'LShift'], [0x36, 'RShift'], [0x38, 'LAlt'], [0x39, 'Space'], [0x9D, 'RControl'], [0xC8, 'Up'], [0xC9, 'PageUp'], [0xCB, 'Left'], [0xCD, 'Right'], [0xD0, 'Down'], [0xD1, 'PageDown'], [0xD3, 'Delete']]).get(keyCode) ?? null;
    if (name !== null) {
      return name;
    }
    return `DIK_${Math.trunc(keyCode).toString(16).toUpperCase().padStart(2, '0')}`;
  }

  return `KEY_${Math.trunc(keyCode).toString(16).toUpperCase().padStart(4, '0')}`;
}

export function inputCodeIsDown(keyCode: number, opts: { playerIndex?: number } = {}): boolean {
  const playerIndex = opts.playerIndex ?? 0;
  const down = digitalDownForPlayer(int(keyCode), { playerIndex: int(playerIndex) });
  return _PRESSED_STATE.markDown({ playerIndex: int(playerIndex), keyCode: int(keyCode), isDown: down });
}

export function inputCodeIsPressed(keyCode: number, opts: { playerIndex?: number } = {}): boolean {
  const playerIndex = opts.playerIndex ?? 0;
  const code = int(keyCode);
  const playerIdx = int(playerIndex);
  if (code === 0x109) {
    return _PRESSED_STATE.wheelUp;
  }
  if (code === 0x10A) {
    return _PRESSED_STATE.wheelDown;
  }
  const down = digitalDownForPlayer(code, { playerIndex: playerIdx });
  return _PRESSED_STATE.isPressed({ playerIndex: playerIdx, keyCode: code, isDown: down });
}

export function captureFirstPressedInputCode(opts: { playerIndex: number; includeKeyboard?: boolean; includeMouse?: boolean; includeGamepad?: boolean; includeAxes?: boolean; axisThreshold?: number }): number | null {
  const playerIndex = opts.playerIndex;
  const includeKeyboard = opts.includeKeyboard ?? true;
  const includeMouse = opts.includeMouse ?? true;
  const includeGamepad = opts.includeGamepad ?? true;
  const includeAxes = opts.includeAxes ?? true;
  const axisThreshold = opts.axisThreshold ?? 0.5;
  const playerIdx = int(playerIndex);

  if (includeKeyboard) {
    while (true) {
      const key = int(InputState.getKeyPressed());
      if (key <= 0) {
        break;
      }
      const code = RL_KEY_TO_DIK.get(key) ?? null;
      if (code !== null && code !== INPUT_CODE_UNBOUND) {
        return int(code);
      }
    }
  }

  if (includeMouse) {
    for (let [code, button] of MOUSE_CODE_TO_BUTTON.entries()) {
      if (InputState.wasMouseButtonPressed(button)) {
        return int(code);
      }
    }
    const wheel = InputState.mouseWheelDelta();
    if (wheel > 0.0) {
      return 0x109;
    }
    if (wheel < 0.0) {
      return 0x10A;
    }
  }

  let gamepad: number;
  if (includeGamepad) {
    gamepad = playerGamepadIndex(playerIdx);
    if (wgl.isGamepadAvailable(gamepad)) {
      for (let [code, button] of JOYS_BUTTON_CODES.entries()) {
        if (wgl.isGamepadButtonPressed(gamepad, button)) {
          return int(code);
        }
      }
    }
  }

  if (includeAxes) {
    gamepad = playerGamepadIndex(playerIdx);
    if (wgl.isGamepadAvailable(gamepad)) {
      for (let [code, axis] of AXIS_CODE_TO_AXIS.entries()) {
        const value = wgl.getGamepadAxisMovement(gamepad, axis);
        if (Math.abs(value) >= axisThreshold) {
          return int(code);
        }
      }
    }
  }
  return null;
}

function inputPrimaryAnyDown(opts: { fireCodes: readonly number[]; playerCount: number }): boolean {
  const fireCodes = opts.fireCodes;
  const playerCount = opts.playerCount;
  if (inputCodeIsDown(0x100, { playerIndex: 0 })) {
    return true;
  }

  const count = Math.max(1, Math.min(4, int(playerCount)));
  if (fireCodes.length < count) {
    throw new Error(`fire_codes must provide at least ${count} entries, got ${fireCodes.length}`);
  }
  for (let playerIndex = 0; playerIndex < count; playerIndex++) {
    const fireKey = int(fireCodes[playerIndex]);
    if (inputCodeIsDown(fireKey, { playerIndex: playerIndex })) {
      return true;
    }
  }
  return false;
}

export function inputPrimaryIsDown(opts: { fireCodes: readonly number[]; playerCount: number }): boolean {
  const fireCodes = opts.fireCodes;
  const playerCount = opts.playerCount;
  const down = inputPrimaryAnyDown({ fireCodes: fireCodes, playerCount: playerCount });
  _PRESSED_STATE.markDown({
    playerIndex: _PRIMARY_EDGE_SENTINEL_PLAYER,
    keyCode: _PRIMARY_EDGE_SENTINEL_KEY,
    isDown: down,
  });
  return down;
}

export function inputPrimaryJustPressed(opts: { fireCodes: readonly number[]; playerCount: number }): boolean {
  const fireCodes = opts.fireCodes;
  const playerCount = opts.playerCount;
  const down = inputPrimaryAnyDown({ fireCodes: fireCodes, playerCount: playerCount });
  return _PRESSED_STATE.isPressed({ playerIndex: _PRIMARY_EDGE_SENTINEL_PLAYER, keyCode: _PRIMARY_EDGE_SENTINEL_KEY, isDown: down });
}
