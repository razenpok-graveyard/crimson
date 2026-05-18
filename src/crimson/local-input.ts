// Port of crimson/local_input.py

import type { CrimsonConfig } from '@grim/config.ts';
import { Vec2 } from '@grim/geom.ts';
import { _AIM_JOYSTICK_TURN_RATE, _AIM_KEYBOARD_TURN_RATE } from '@crimson/aim-constants.ts';
import { AimScheme } from '@crimson/aim-schemes.ts';
import { inputAxisValue, inputCodeIsDown, inputCodeIsPressed } from '@crimson/input-codes.ts';
import { MovementControlType } from '@crimson/movement-controls.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import * as wgl from '@wgl';

export interface ComputerAimCreature {
  active: boolean;
  hp: number;
  pos: Vec2;
}

const _AIM_RADIUS_KEYBOARD = 60.0;
const _AIM_RADIUS_PAD_BASE = 42.0;
// Native uses `cv_padAimDistMul` (default 96).
const _AIM_RADIUS_PAD_SCALE = 96.0;
const _POINT_CLICK_STOP_RADIUS = 20.0;
const _COMPUTER_TARGET_SWITCH_HYSTERESIS = 64.0;
const _COMPUTER_ARENA_CENTER = new Vec2(512.0, 512.0);
const _COMPUTER_MOVE_TARGET_RADIUS = 300.0;
const _COMPUTER_AIM_SNAP_DISTANCE = 4.0;
const _COMPUTER_AIM_TRACK_GAIN = 6.0;
const _COMPUTER_AUTO_FIRE_DISTANCE = 128.0;
const _ALT_MOVE_KEY_UP = 0xC8;
const _ALT_MOVE_KEY_DOWN = 0xD0;
const _ALT_MOVE_KEY_LEFT = 0xCB;
const _ALT_MOVE_KEY_RIGHT = 0xCD;
const _AIM_POV_LEFT_CODE = 0x133;
const _AIM_POV_RIGHT_CODE = 0x134;

export class PerPlayerInputState {
  aimHeading: number;
  moveTarget: Vec2;
  computerTargetCreatureIndex: number;

  constructor(opts: {
    aimHeading?: number;
    moveTarget?: Vec2;
    computerTargetCreatureIndex?: number;
  } = {}) {
    this.aimHeading = opts.aimHeading ?? 0.0;
    this.moveTarget = opts.moveTarget ?? new Vec2(-1.0, -1.0);
    this.computerTargetCreatureIndex = opts.computerTargetCreatureIndex ?? -1;
  }
}

export class LocalInputInterpreter {
  protected _states: PerPlayerInputState[];
  protected _preserveBugs: boolean;

  get states(): PerPlayerInputState[] {
    return this._states;
  }
  get preserveBugs(): boolean {
    return this._preserveBugs;
  }

  constructor(opts: { preserveBugs?: boolean } = {}) {
    const preserveBugs = opts.preserveBugs ?? false;
    this._states = Array.from({ length: Math.max(0, 4) }, (_, i) => i).map((_) => new PerPlayerInputState());
    this._preserveBugs = preserveBugs;
  }

  setPreserveBugs(enabled: boolean): void {
    this._preserveBugs = enabled;
  }

  protected static _stateSlotForPlayer(opts: { playerIndex: number; player?: PlayerState | null }): number {
    const playerIndex = opts.playerIndex;
    const player = opts.player ?? null;
    let slot = int(playerIndex);
    if (player !== null) {
      slot = int(player.index);
    }
    return Math.max(0, Math.min(3, slot));
  }

  reset(opts: { players?: readonly PlayerState[] | null } = {}): void {
    const players = opts.players ?? null;
    for (let idx = 0; idx < 4; idx++) {
      const state = this._states[idx];
      state.moveTarget = new Vec2(-1.0, -1.0);
      state.computerTargetCreatureIndex = -1;
      state.aimHeading = 0.0;
    }
    if (players === null) {
      return;
    }
    for (const [idx, player] of players.entries()) {
      const slot = LocalInputInterpreter._stateSlotForPlayer({ playerIndex: int(idx), player: player });
      const candidate = player.aimHeading;
      if (isFinite(candidate)) {
        this._states[slot].aimHeading = candidate;
      }
    }
  }

  protected static _nearestLivingCreatureIndex(pos: Vec2, creatures: readonly ComputerAimCreature[]): number | null {
    let bestIdx: number | null = null;
    let bestDistSq = 0.0;
    for (const [idx, creature] of creatures.entries()) {
      if (!creature.active) {
        continue;
      }
      if (creature.hp <= 0.0) {
        continue;
      }
      const distSq = Vec2.distanceSq(pos, creature.pos);
      if (bestIdx === null || distSq < bestDistSq) {
        bestIdx = int(idx);
        bestDistSq = distSq;
      }
    }
    return bestIdx;
  }

  protected _selectComputerTarget(opts: { playerIndex: number; player: PlayerState; creatures: readonly ComputerAimCreature[] }): number | null {
    const playerIndex = opts.playerIndex;
    const player = opts.player;
    const creatures = opts.creatures;
    const slot = LocalInputInterpreter._stateSlotForPlayer({ playerIndex: int(playerIndex), player: player });
    const state = this._states[slot];
    const candidate = LocalInputInterpreter._nearestLivingCreatureIndex(player.pos, creatures);
    const current = int(state.computerTargetCreatureIndex);

    if (candidate === null) {
      state.computerTargetCreatureIndex = -1;
      return null;
    }
    if (current < 0 || current >= creatures.length) {
      state.computerTargetCreatureIndex = int(candidate);
      return int(candidate);
    }

    const currentCreature = creatures[current];
    if (!currentCreature.active || currentCreature.hp <= 0.0) {
      state.computerTargetCreatureIndex = int(candidate);
      return int(candidate);
    }
    if (int(candidate) === int(current)) {
      return int(current);
    }

    const candidateCreature = creatures[int(candidate)];
    if (!candidateCreature.active || candidateCreature.hp <= 0.0) {
      return int(current);
    }

    const currentDist = (currentCreature.pos.sub(player.pos)).length();
    const candidateDist = (candidateCreature.pos.sub(player.pos)).length();
    if (candidateDist + _COMPUTER_TARGET_SWITCH_HYSTERESIS < currentDist) {
      state.computerTargetCreatureIndex = int(candidate);
      return int(candidate);
    }
    return int(current);
  }

  protected _stateForPlayer(playerIndex: number, opts: { player?: PlayerState | null } = {}): PerPlayerInputState {
    const player = opts.player ?? null;
    const slot = LocalInputInterpreter._stateSlotForPlayer({ playerIndex: int(playerIndex), player: player });
    const state = this._states[slot];
    if (player !== null && !isFinite(state.aimHeading)) {
      state.aimHeading = player.aimHeading;
    }
    return state;
  }

  buildPlayerInput(opts: { playerIndex: number; player: PlayerState; config: CrimsonConfig; mouseScreen: Vec2; mouseWorld: Vec2; screenCenter: Vec2; dt: number; creatures?: readonly ComputerAimCreature[] | null }): PlayerInput {
    const playerIndex = opts.playerIndex;
    const player = opts.player;
    const config = opts.config;
    const mouseScreen = opts.mouseScreen;
    const mouseWorld = opts.mouseWorld;
    const screenCenter = opts.screenCenter;
    const dt = opts.dt;
    const creatures = opts.creatures ?? null;
    const idx = Math.max(0, Math.min(3, int(playerIndex)));
    const state = this._stateForPlayer(idx, { player: player });
    const binds = config.controls.player(idx);
    const aimScheme = binds.aimScheme;
    const moveModeType = binds.movement;
    const reloadKey = config.controls.reloadCode;

    const [moveForwardKey, moveBackwardKey, turnLeftKey, turnRightKey] = binds.moveCodes;
    const fireKey = binds.fireCode;
    const [aimLeftKey, aimRightKey] = binds.keyboardAimCodes;
    const [aimAxisY, aimAxisX] = binds.aimAxisCodes;
    const [moveAxisY, moveAxisX] = binds.moveAxisCodes;

    let moveVec = new Vec2();
    let moveForwardPressed: boolean | null = null;
    let moveBackwardPressed: boolean | null = null;
    let turnLeftPressed: boolean | null = null;
    let turnRightPressed: boolean | null = null;
    let moveToCursorPressed = false;
    let computerTargetIndex: number | null = null;
    const computerMoveActive = (moveModeType === MovementControlType.COMPUTER || aimScheme === AimScheme.COMPUTER);

    let axisY: any;
    let axisX: any;
    let delta: Vec2;
    if (computerMoveActive) {
      if (creatures !== null && creatures.length > 0) {
        computerTargetIndex = this._selectComputerTarget({ playerIndex: idx, player: player, creatures: creatures });
      }
      const centerDelta = _COMPUTER_ARENA_CENTER.sub(player.pos);
      const centerDist = centerDelta.length();
      let targetPos: Vec2;
      if (creatures !== null && computerTargetIndex !== null && int(computerTargetIndex) >= 0 && int(computerTargetIndex) < creatures.length && centerDist <= _COMPUTER_MOVE_TARGET_RADIUS) {
        targetPos = new Vec2(creatures[int(computerTargetIndex)].pos.x, creatures[int(computerTargetIndex)].pos.y);
      } else {
        targetPos = _COMPUTER_ARENA_CENTER;
      }

      const [moveDir, moveDist] = (targetPos.sub(player.pos)).normalizedWithLength();
      if (moveDist > 1e-6) {
        moveVec = moveDir;
      }
    } else if (moveModeType === MovementControlType.RELATIVE) {
      moveForwardPressed = keyDownWithSinglePlayerAlt(moveForwardKey, { altKey: _ALT_MOVE_KEY_UP, config: config, playerIndex: idx });
      moveBackwardPressed = keyDownWithSinglePlayerAlt(moveBackwardKey, { altKey: _ALT_MOVE_KEY_DOWN, config: config, playerIndex: idx });
      turnLeftPressed = keyDownWithSinglePlayerAlt(turnLeftKey, { altKey: _ALT_MOVE_KEY_LEFT, config: config, playerIndex: idx });
      turnRightPressed = keyDownWithSinglePlayerAlt(turnRightKey, { altKey: _ALT_MOVE_KEY_RIGHT, config: config, playerIndex: idx });
      moveVec = new Vec2((Number((turnRightPressed ? 1 : 0))) - (Number((turnLeftPressed ? 1 : 0))), (Number((moveBackwardPressed ? 1 : 0))) - (Number((moveForwardPressed ? 1 : 0))));
    } else if (moveModeType === MovementControlType.DUAL_ACTION_PAD) {
      axisY = -inputAxisValue(moveAxisY, { playerIndex: idx });
      axisX = -inputAxisValue(moveAxisX, { playerIndex: idx });
      moveVec = new Vec2(clampUnit(axisX), clampUnit(axisY));
    } else if (moveModeType === MovementControlType.MOUSE_POINT_CLICK) {
      moveToCursorPressed = inputCodeIsDown(reloadKey, { playerIndex: idx });
      if (moveToCursorPressed) {
        state.moveTarget = mouseWorld;
      }
      if (state.moveTarget.x >= 0.0 && state.moveTarget.y >= 0.0) {
        delta = state.moveTarget.sub(player.pos);
        const [dir, dist] = delta.normalizedWithLength();
        if (dist > _POINT_CLICK_STOP_RADIUS) {
          moveVec = dir;
        }
      }
    } else if (moveModeType === MovementControlType.STATIC) {
      const moveUpPressed = keyDownWithSinglePlayerAlt(moveForwardKey, { altKey: _ALT_MOVE_KEY_UP, config: config, playerIndex: idx });
      const moveDownPressed = keyDownWithSinglePlayerAlt(moveBackwardKey, { altKey: _ALT_MOVE_KEY_DOWN, config: config, playerIndex: idx });
      const moveLeftPressed = keyDownWithSinglePlayerAlt(turnLeftKey, { altKey: _ALT_MOVE_KEY_LEFT, config: config, playerIndex: idx });
      const moveRightPressed = keyDownWithSinglePlayerAlt(turnRightKey, { altKey: _ALT_MOVE_KEY_RIGHT, config: config, playerIndex: idx });
      moveForwardPressed = moveUpPressed;
      moveBackwardPressed = moveDownPressed;
      turnLeftPressed = moveLeftPressed;
      turnRightPressed = moveRightPressed;
      moveVec = resolveStaticMoveVector({ moveUp: moveUpPressed, moveDown: moveDownPressed, moveLeft: moveLeftPressed, moveRight: moveRightPressed });
    } else {
      moveVec = new Vec2(Number(inputCodeIsDown(turnRightKey, { playerIndex: idx })) - Number(inputCodeIsDown(turnLeftKey, { playerIndex: idx })), Number(inputCodeIsDown(moveBackwardKey, { playerIndex: idx })) - Number(inputCodeIsDown(moveForwardKey, { playerIndex: idx })));
    }

    let heading = state.aimHeading;
    if (!isFinite(heading)) {
      heading = player.aimHeading;
    }
    let aim = new Vec2(player.aim.x, player.aim.y);
    let computerAutoFire = false;
    let targetIndex: number;
    if (aimScheme === AimScheme.MOUSE) {
      aim = mouseWorld;
      delta = aim.sub(player.pos);
      if (delta.lengthSq() > 1e-9) {
        heading = delta.toHeading();
      }
    } else if (aimScheme === AimScheme.KEYBOARD) {
      if (moveModeType === MovementControlType.RELATIVE || moveModeType === MovementControlType.STATIC) {
        if (inputCodeIsDown(aimRightKey, { playerIndex: idx })) {
          heading = (heading + dt * _AIM_KEYBOARD_TURN_RATE);
        }
        if (inputCodeIsDown(aimLeftKey, { playerIndex: idx })) {
          heading = (heading - dt * _AIM_KEYBOARD_TURN_RATE);
        }
        aim = aimPointFromHeading(player.pos, heading);
      }
    } else if (aimScheme === AimScheme.MOUSE_RELATIVE) {
      const rel = mouseScreen.sub(screenCenter);
      if (rel.lengthSq() > 1.0) {
        heading = rel.toHeading();
        aim = aimPointFromHeading(player.pos, heading);
      }
    } else if (aimScheme === AimScheme.DUAL_ACTION_PAD) {
      axisY = inputAxisValue(aimAxisY, { playerIndex: idx });
      axisX = inputAxisValue(aimAxisX, { playerIndex: idx });
      const axisVec = new Vec2(axisX, axisY);
      const magSq = axisVec.lengthSq();
      if (magSq > 1e-9) {
        const [axisDir, mag] = axisVec.normalizedWithLength();
        heading = axisDir.toHeading();
        const radius = _AIM_RADIUS_PAD_BASE + mag * _AIM_RADIUS_PAD_SCALE;
        aim = player.pos.add(axisDir.mul(radius));
      } else {
        aim = aimPointFromHeading(player.pos, heading);
      }
    } else if (aimScheme === AimScheme.JOYSTICK) {
      if (aimPovRightActive({ playerIndex: idx, preserveBugs: this._preserveBugs })) {
        heading = (heading + dt * _AIM_JOYSTICK_TURN_RATE);
      }
      if (aimPovLeftActive({ playerIndex: idx, preserveBugs: this._preserveBugs })) {
        heading = (heading - dt * _AIM_JOYSTICK_TURN_RATE);
      }
      aim = aimPointFromHeading(player.pos, heading);
    } else if (aimScheme === AimScheme.COMPUTER) {
      targetIndex = computerTargetIndex;
      if (targetIndex === null && creatures !== null && creatures.length > 0) {
        targetIndex = this._selectComputerTarget({ playerIndex: idx, player: player, creatures: creatures });
      }
      let away: Vec2;
      if (creatures !== null && targetIndex !== null && int(targetIndex) >= 0 && int(targetIndex) < creatures.length) {
        const target = creatures[int(targetIndex)];
        aim = new Vec2(player.aim.x, player.aim.y);
        const toTarget = new Vec2(target.pos.x, target.pos.y).sub(aim);
        const [targetDir, targetDist] = toTarget.normalizedWithLength();
        if (targetDist >= _COMPUTER_AIM_SNAP_DISTANCE) {
          aim = aim.add(targetDir.mul(targetDist * _COMPUTER_AIM_TRACK_GAIN * dt));
        } else {
          aim = new Vec2(target.pos.x, target.pos.y);
        }
        delta = aim.sub(player.pos);
        if (delta.lengthSq() > 1e-9) {
          heading = delta.toHeading();
        }
        computerAutoFire = targetDist < _COMPUTER_AUTO_FIRE_DISTANCE;
      } else {
        let awayMag: any;
        [away, awayMag] = (player.pos.sub(_COMPUTER_ARENA_CENTER)).normalizedWithLength();
        if (awayMag <= 1e-6) {
          away = new Vec2(0.0, -1.0);
        }
        aim = player.pos.add(away.mul(_AIM_RADIUS_KEYBOARD));
        heading = away.toHeading();
      }
    }

    delta = aim.sub(player.pos);
    if (delta.lengthSq() > 1e-9) {
      heading = delta.toHeading();
    }
    state.aimHeading = heading;

    let fireDown = inputCodeIsDown(fireKey, { playerIndex: idx });
    const firePressed = inputCodeIsPressed(fireKey, { playerIndex: idx });
    if (aimScheme === AimScheme.COMPUTER && computerAutoFire) {
      fireDown = true;
    }
    const reloadPressed = inputCodeIsPressed(reloadKey, { playerIndex: idx });
    const reloadDown = inputCodeIsDown(reloadKey, { playerIndex: idx });

    return new PlayerInput({ move: moveVec, aim: aim, moveMode: moveModeType, aimScheme: aimScheme, fireDown: fireDown, firePressed: firePressed, reloadPressed: reloadPressed, reloadDown: reloadDown, moveToCursorPressed: moveToCursorPressed, moveForwardPressed: moveForwardPressed, moveBackwardPressed: moveBackwardPressed, turnLeftPressed: turnLeftPressed, turnRightPressed: turnRightPressed });
  }

  buildFrameInputs(opts: { players: readonly PlayerState[]; config: CrimsonConfig; mouseScreen: Vec2; screenToWorld: (arg0: Vec2) => Vec2; dt: number; creatures?: readonly ComputerAimCreature[] | null }): PlayerInput[] {
    const players = opts.players;
    const config = opts.config;
    const mouseScreen = opts.mouseScreen;
    const screenToWorld = opts.screenToWorld;
    const dt = opts.dt;
    const creatures = opts.creatures ?? null;
    const mouseWorld = screenToWorld(mouseScreen);
    const screenCenter = new Vec2(wgl.getScreenWidth() * 0.5, wgl.getScreenHeight() * 0.5);
    const out: PlayerInput[] = [];
    for (const [idx, player] of players.entries()) {
      out.push(this.buildPlayerInput({ playerIndex: idx, player: player, config: config, mouseScreen: mouseScreen, mouseWorld: mouseWorld, screenCenter: screenCenter, dt: dt, creatures: creatures }));
    }
    return out;
  }
}

function isFinite(v: number): boolean {
  return Number.isFinite(v);
}

function clampUnit(v: number): number {
  const value = v;
  if (value < -1.0) {
    return -1.0;
  }
  if (value > 1.0) {
    return 1.0;
  }
  return value;
}

function aimPointFromHeading(pos: Vec2, heading: number, opts: { radius?: number } = {}): Vec2 {
  const radius = opts.radius ?? _AIM_RADIUS_KEYBOARD;
  return pos.add(Vec2.fromHeading(heading).mul(radius));
}

function resolveStaticMoveVector(opts: { moveUp: boolean; moveDown: boolean; moveLeft: boolean; moveRight: boolean }): Vec2 {
  // Mirror native move-mode 2 key precedence from `player_update`.

  const moveUp = opts.moveUp;
  const moveDown = opts.moveDown;
  const moveLeft = opts.moveLeft;
  const moveRight = opts.moveRight;
  let move = new Vec2();
  if (moveLeft) {
    move = new Vec2(-1.0, 0.0);
  }
  if (moveRight) {
    move = new Vec2(1.0, 0.0);
  }

  if (moveUp) {
    if (moveLeft) {
      move = new Vec2(-1.0, -1.0);
    } else if (moveRight) {
      move = new Vec2(1.0, -1.0);
    } else {
      move = new Vec2(0.0, -1.0);
    }
  }

  // Native checks backward after forward, so it overrides on conflicts.
  if (moveDown) {
    if (moveLeft) {
      move = new Vec2(-1.0, 1.0);
    } else if (moveRight) {
      move = new Vec2(1.0, 1.0);
    } else {
      move = new Vec2(0.0, 1.0);
    }
  }

  return move;
}

function configPlayerCount(config: CrimsonConfig): number {
  return Math.max(1, int(config.gameplay.playerCount));
}

function singlePlayerAltKeysEnabled(config: CrimsonConfig, opts: { playerIndex: number }): boolean {
  const playerIndex = opts.playerIndex;
  return int(playerIndex) === 0 && configPlayerCount(config) === 1;
}

function keyDownWithSinglePlayerAlt(primaryKey: number, opts: { altKey: number; config: CrimsonConfig; playerIndex: number }): boolean {
  const altKey = opts.altKey;
  const config = opts.config;
  const playerIndex = opts.playerIndex;
  if (inputCodeIsDown(primaryKey, { playerIndex: int(playerIndex) })) {
    return true;
  }
  if (singlePlayerAltKeysEnabled(config, { playerIndex: int(playerIndex) })) {
    return inputCodeIsDown(int(altKey), { playerIndex: int(playerIndex) });
  }
  return false;
}

function aimPovLeftActive(opts: { playerIndex: number; preserveBugs: boolean }): boolean {
  // Native `input_aim_pov_left_active` always reads joystick POV index 0.
  const playerIndex = opts.playerIndex;
  const preserveBugs = opts.preserveBugs;
  const povIndex = preserveBugs ? 0 : int(playerIndex);
  return inputCodeIsDown(_AIM_POV_LEFT_CODE, { playerIndex: povIndex });
}

function aimPovRightActive(opts: { playerIndex: number; preserveBugs: boolean }): boolean {
  // Native `input_aim_pov_right_active` always reads joystick POV index 0.
  const playerIndex = opts.playerIndex;
  const preserveBugs = opts.preserveBugs;
  const povIndex = preserveBugs ? 0 : int(playerIndex);
  return inputCodeIsDown(_AIM_POV_RIGHT_CODE, { playerIndex: povIndex });
}

export function clearInputEdges(inputs: readonly PlayerInput[]): PlayerInput[] {
  return inputs.map((inp) => new PlayerInput({ move: inp.move, aim: inp.aim, fireDown: inp.fireDown, firePressed: false, reloadPressed: false, moveToCursorPressed: false, moveForwardPressed: inp.moveForwardPressed, moveBackwardPressed: inp.moveBackwardPressed, turnLeftPressed: inp.turnLeftPressed, turnRightPressed: inp.turnRightPressed }));
}
