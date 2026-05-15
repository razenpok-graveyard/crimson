// Port of crimson/local_input.py

import { type CrimsonConfig } from '@grim/config.ts';
import { Vec2 } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { _AIM_KEYBOARD_TURN_RATE, _AIM_JOYSTICK_TURN_RATE } from './aim-constants';
import { AimScheme } from './aim-schemes.ts';
import { inputCodeIsDown, inputCodeIsPressed, inputAxisValue } from './input-codes.ts';
import { MovementControlType } from './movement-controls.ts';
import { PlayerInput } from './sim/input.ts';
import type { PlayerState } from './sim/state-types.ts';

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

const _ALT_MOVE_KEY_UP = 0xc8;
const _ALT_MOVE_KEY_DOWN = 0xd0;
const _ALT_MOVE_KEY_LEFT = 0xcb;
const _ALT_MOVE_KEY_RIGHT = 0xcd;
const _AIM_POV_LEFT_CODE = 0x133;
const _AIM_POV_RIGHT_CODE = 0x134;

class PerPlayerInputState {
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

interface ComputerAimCreature {
  active: boolean;
  hp: number;
  pos: Vec2;
}

function isFiniteNum(v: number): boolean {
  return Number.isFinite(v);
}

function clampUnit(v: number): number {
  if (v < -1.0) return -1.0;
  if (v > 1.0) return 1.0;
  return v;
}

function aimPointFromHeading(
  pos: Vec2,
  heading: number,
  opts: { radius?: number } = {},
): Vec2 {
  const radius = opts.radius ?? _AIM_RADIUS_KEYBOARD;
  return pos.add(Vec2.fromHeading(heading).mul(radius));
}

function resolveStaticMoveVector(opts: {
  moveUp: boolean;
  moveDown: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}): Vec2 {
  // Mirror native move-mode 2 key precedence from `player_update`.
  const { moveUp, moveDown, moveLeft, moveRight } = opts;
  let move = new Vec2();
  if (moveLeft) move = new Vec2(-1.0, 0.0);
  if (moveRight) move = new Vec2(1.0, 0.0);

  if (moveUp) {
    if (moveLeft) move = new Vec2(-1.0, -1.0);
    else if (moveRight) move = new Vec2(1.0, -1.0);
    else move = new Vec2(0.0, -1.0);
  }

  // Native checks backward after forward, so it overrides on conflicts.
  if (moveDown) {
    if (moveLeft) move = new Vec2(-1.0, 1.0);
    else if (moveRight) move = new Vec2(1.0, 1.0);
    else move = new Vec2(0.0, 1.0);
  }

  return move;
}

function configPlayerCount(config: CrimsonConfig): number {
  return Math.max(1, int(config.gameplay.playerCount));
}

function singlePlayerAltKeysEnabled(
  config: CrimsonConfig,
  opts: { playerIndex: number },
): boolean {
  const playerIndex = int(opts.playerIndex);
  return playerIndex === 0 && configPlayerCount(config) === 1;
}

function keyDownWithSinglePlayerAlt(
  primaryKey: number,
  opts: {
    altKey: number;
    config: CrimsonConfig;
    playerIndex: number;
  },
): boolean {
  const { altKey, config } = opts;
  const playerIndex = int(opts.playerIndex);
  if (inputCodeIsDown(primaryKey, { playerIndex })) return true;
  if (singlePlayerAltKeysEnabled(config, { playerIndex })) {
    return inputCodeIsDown(altKey, { playerIndex });
  }
  return false;
}

function aimPovLeftActive(opts: { playerIndex: number; preserveBugs: boolean }): boolean {
  // Native input_aim_pov_left_active always reads joystick POV index 0.
  const { preserveBugs } = opts;
  const playerIndex = int(opts.playerIndex);
  const povIndex = preserveBugs ? 0 : playerIndex;
  return inputCodeIsDown(_AIM_POV_LEFT_CODE, { playerIndex: povIndex });
}

function aimPovRightActive(opts: { playerIndex: number; preserveBugs: boolean }): boolean {
  // Native input_aim_pov_right_active always reads joystick POV index 0.
  const { preserveBugs } = opts;
  const playerIndex = int(opts.playerIndex);
  const povIndex = preserveBugs ? 0 : playerIndex;
  return inputCodeIsDown(_AIM_POV_RIGHT_CODE, { playerIndex: povIndex });
}

export function clearInputEdges(inputs: readonly PlayerInput[]): PlayerInput[] {
  return inputs.map(
    (inp) =>
      new PlayerInput({
        move: inp.move,
        aim: inp.aim,
        fireDown: inp.fireDown,
        firePressed: false,
        reloadPressed: false,
        moveToCursorPressed: false,
        moveForwardPressed: inp.moveForwardPressed,
        moveBackwardPressed: inp.moveBackwardPressed,
        turnLeftPressed: inp.turnLeftPressed,
        turnRightPressed: inp.turnRightPressed,
      }),
  );
}

export class LocalInputInterpreter {
  private _states: PerPlayerInputState[];
  private _preserveBugs: boolean;

  constructor(opts: { preserveBugs?: boolean } = {}) {
    this._states = [
      new PerPlayerInputState(),
      new PerPlayerInputState(),
      new PerPlayerInputState(),
      new PerPlayerInputState(),
    ];
    this._preserveBugs = opts.preserveBugs ?? false;
  }

  setPreserveBugs(enabled: boolean): void {
    this._preserveBugs = enabled;
  }

  private static _stateSlotForPlayer(
    opts: {
      playerIndex: number;
      player?: PlayerState | null;
    },
  ): number {
    const { player = null } = opts;
    const playerIndex = int(opts.playerIndex);
    let slot = int(playerIndex);
    if (player != null) slot = int(player.index);
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
    if (players == null) return;
    for (let idx = 0; idx < players.length; idx++) {
      const player = players[idx];
      const slot = LocalInputInterpreter._stateSlotForPlayer({ playerIndex: int(idx), player });
      const candidate = player.aimHeading;
      if (isFiniteNum(candidate)) {
        this._states[slot].aimHeading = candidate;
      }
    }
  }

  private static _nearestLivingCreatureIndex(
    pos: Vec2,
    creatures: readonly ComputerAimCreature[],
  ): number | null {
    let bestIdx: number | null = null;
    let bestDistSq = 0.0;
    for (let idx = 0; idx < creatures.length; idx++) {
      const creature = creatures[idx];
      if (!creature.active) continue;
      if (creature.hp <= 0.0) continue;
      const distSq = Vec2.distanceSq(pos, creature.pos);
      if (bestIdx === null || distSq < bestDistSq) {
        bestIdx = idx;
        bestDistSq = distSq;
      }
    }
    return bestIdx;
  }

  private _selectComputerTarget(
    opts: {
      playerIndex: number;
      player: PlayerState;
      creatures: readonly ComputerAimCreature[];
    },
  ): number | null {
    const { player, creatures } = opts;
    const playerIndex = int(opts.playerIndex);
    const slot = LocalInputInterpreter._stateSlotForPlayer({ playerIndex: int(playerIndex), player });
    const state = this._states[slot];
    const candidate = LocalInputInterpreter._nearestLivingCreatureIndex(
      player.pos,
      creatures,
    );
    const current = int(state.computerTargetCreatureIndex);

    if (candidate === null) {
      state.computerTargetCreatureIndex = -1;
      return null;
    }
    if (current < 0 || current >= creatures.length) {
      state.computerTargetCreatureIndex = candidate;
      return candidate;
    }

    const currentCreature = creatures[current];
    if (!currentCreature.active || currentCreature.hp <= 0.0) {
      state.computerTargetCreatureIndex = candidate;
      return candidate;
    }
    if (candidate === current) return current;

    const candidateCreature = creatures[candidate];
    if (!candidateCreature.active || candidateCreature.hp <= 0.0) {
      return current;
    }

    const currentDist = currentCreature.pos.sub(player.pos).length();
    const candidateDist = candidateCreature.pos.sub(player.pos).length();
    if (
      candidateDist + _COMPUTER_TARGET_SWITCH_HYSTERESIS <
      currentDist
    ) {
      state.computerTargetCreatureIndex = candidate;
      return candidate;
    }
    return current;
  }

  private _stateForPlayer(
    playerIndex: number,
    opts: { player?: PlayerState | null } = {},
  ): PerPlayerInputState {
    const player = opts.player ?? null;
    const slot = LocalInputInterpreter._stateSlotForPlayer({ playerIndex: int(playerIndex), player });
    const state = this._states[slot];
    if (player != null && !isFiniteNum(state.aimHeading)) {
      state.aimHeading = player.aimHeading;
    }
    return state;
  }

  buildPlayerInput(opts: {
    playerIndex: number;
    player: PlayerState;
    config: CrimsonConfig;
    mouseScreen: Vec2;
    mouseWorld: Vec2;
    screenCenter: Vec2;
    dt: number;
    creatures?: readonly ComputerAimCreature[] | null;
  }): PlayerInput {
    const {
      player,
      config,
      mouseScreen,
      mouseWorld,
      screenCenter,
      creatures = null,
    } = opts;
    const dt = opts.dt;
    const idx = Math.max(0, Math.min(3, int(opts.playerIndex)));
    const state = this._stateForPlayer(idx, { player });
    const binds = config.controls.player(idx);
    const aimScheme = binds.aimScheme;
    const moveModeType = binds.movement;
    const reloadKey = config.controls.reloadCode;

    const [moveForwardKey, moveBackwardKey, turnLeftKey, turnRightKey] =
      binds.moveCodes;
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
    const computerMoveActive =
      moveModeType === MovementControlType.COMPUTER ||
      aimScheme === AimScheme.COMPUTER;

    if (computerMoveActive) {
      if (creatures && creatures.length > 0) {
        computerTargetIndex = this._selectComputerTarget(
          {
            playerIndex: idx,
            player,
            creatures,
          },
        );
      }
      const centerDelta = _COMPUTER_ARENA_CENTER.sub(player.pos);
      const centerDist = centerDelta.length();
      let targetPos: Vec2;
      if (
        creatures != null &&
        computerTargetIndex != null &&
        computerTargetIndex >= 0 &&
        computerTargetIndex < creatures.length &&
        centerDist <= _COMPUTER_MOVE_TARGET_RADIUS
      ) {
        const c = creatures[computerTargetIndex];
        targetPos = new Vec2(c.pos.x, c.pos.y);
      } else {
        targetPos = _COMPUTER_ARENA_CENTER;
      }

      const [moveDir, moveDist] = targetPos
        .sub(player.pos)
        .normalizedWithLength();
      if (moveDist > 1e-6) {
        moveVec = moveDir;
      }
    } else if (moveModeType === MovementControlType.RELATIVE) {
      moveForwardPressed = keyDownWithSinglePlayerAlt(
        moveForwardKey,
        {
          altKey: _ALT_MOVE_KEY_UP,
          config,
          playerIndex: idx,
        },
      );
      moveBackwardPressed = keyDownWithSinglePlayerAlt(
        moveBackwardKey,
        {
          altKey: _ALT_MOVE_KEY_DOWN,
          config,
          playerIndex: idx,
        },
      );
      turnLeftPressed = keyDownWithSinglePlayerAlt(
        turnLeftKey,
        {
          altKey: _ALT_MOVE_KEY_LEFT,
          config,
          playerIndex: idx,
        },
      );
      turnRightPressed = keyDownWithSinglePlayerAlt(
        turnRightKey,
        {
          altKey: _ALT_MOVE_KEY_RIGHT,
          config,
          playerIndex: idx,
        },
      );
      moveVec = new Vec2(
        (turnRightPressed ? 1.0 : 0.0) - (turnLeftPressed ? 1.0 : 0.0),
        (moveBackwardPressed ? 1.0 : 0.0) - (moveForwardPressed ? 1.0 : 0.0),
      );
    } else if (moveModeType === MovementControlType.DUAL_ACTION_PAD) {
      const axisY = -inputAxisValue(moveAxisY, { playerIndex: idx });
      const axisX = -inputAxisValue(moveAxisX, { playerIndex: idx });
      moveVec = new Vec2(clampUnit(axisX), clampUnit(axisY));
    } else if (moveModeType === MovementControlType.MOUSE_POINT_CLICK) {
      moveToCursorPressed = inputCodeIsDown(reloadKey, { playerIndex: idx });
      if (moveToCursorPressed) {
        state.moveTarget = mouseWorld;
      }
      if (state.moveTarget.x >= 0.0 && state.moveTarget.y >= 0.0) {
        const delta = state.moveTarget.sub(player.pos);
        const [dir, dist] = delta.normalizedWithLength();
        if (dist > _POINT_CLICK_STOP_RADIUS) {
          moveVec = dir;
        }
      }
    } else if (moveModeType === MovementControlType.STATIC) {
      const moveUpPressed = keyDownWithSinglePlayerAlt(
        moveForwardKey,
        {
          altKey: _ALT_MOVE_KEY_UP,
          config,
          playerIndex: idx,
        },
      );
      const moveDownPressed = keyDownWithSinglePlayerAlt(
        moveBackwardKey,
        {
          altKey: _ALT_MOVE_KEY_DOWN,
          config,
          playerIndex: idx,
        },
      );
      const moveLeftPressed = keyDownWithSinglePlayerAlt(
        turnLeftKey,
        {
          altKey: _ALT_MOVE_KEY_LEFT,
          config,
          playerIndex: idx,
        },
      );
      const moveRightPressed = keyDownWithSinglePlayerAlt(
        turnRightKey,
        {
          altKey: _ALT_MOVE_KEY_RIGHT,
          config,
          playerIndex: idx,
        },
      );
      moveForwardPressed = moveUpPressed;
      moveBackwardPressed = moveDownPressed;
      turnLeftPressed = moveLeftPressed;
      turnRightPressed = moveRightPressed;
      moveVec = resolveStaticMoveVector(
        {
          moveUp: moveUpPressed,
          moveDown: moveDownPressed,
          moveLeft: moveLeftPressed,
          moveRight: moveRightPressed,
        },
      );
    } else {
      moveVec = new Vec2(
        (inputCodeIsDown(turnRightKey, { playerIndex: idx }) ? 1.0 : 0.0) -
          (inputCodeIsDown(turnLeftKey, { playerIndex: idx }) ? 1.0 : 0.0),
        (inputCodeIsDown(moveBackwardKey, { playerIndex: idx }) ? 1.0 : 0.0) -
          (inputCodeIsDown(moveForwardKey, { playerIndex: idx }) ? 1.0 : 0.0),
      );
    }

    let heading = state.aimHeading;
    if (!isFiniteNum(heading)) {
      heading = player.aimHeading;
    }
    let aim = new Vec2(player.aim.x, player.aim.y);
    let computerAutoFire = false;

    if (aimScheme === AimScheme.MOUSE) {
      aim = mouseWorld;
      const delta = aim.sub(player.pos);
      if (delta.lengthSq() > 1e-9) {
        heading = delta.toHeading();
      }
    } else if (aimScheme === AimScheme.KEYBOARD) {
      if (
        moveModeType === MovementControlType.RELATIVE ||
        moveModeType === MovementControlType.STATIC
      ) {
        if (inputCodeIsDown(aimRightKey, { playerIndex: idx })) {
          heading = heading + dt * _AIM_KEYBOARD_TURN_RATE;
        }
        if (inputCodeIsDown(aimLeftKey, { playerIndex: idx })) {
          heading = heading - dt * _AIM_KEYBOARD_TURN_RATE;
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
      const axisY = inputAxisValue(aimAxisY, { playerIndex: idx });
      const axisX = inputAxisValue(aimAxisX, { playerIndex: idx });
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
        heading = heading + dt * _AIM_JOYSTICK_TURN_RATE;
      }
      if (aimPovLeftActive({ playerIndex: idx, preserveBugs: this._preserveBugs })) {
        heading = heading - dt * _AIM_JOYSTICK_TURN_RATE;
      }
      aim = aimPointFromHeading(player.pos, heading);
    } else if (aimScheme === AimScheme.COMPUTER) {
      let targetIndex = computerTargetIndex;
      if (targetIndex === null && creatures && creatures.length > 0) {
        targetIndex = this._selectComputerTarget({
          playerIndex: idx,
          player,
          creatures,
        });
      }
      if (
        creatures != null &&
        targetIndex != null &&
        targetIndex >= 0 &&
        targetIndex < creatures.length
      ) {
        const target = creatures[targetIndex];
        aim = new Vec2(player.aim.x, player.aim.y);
        const toTarget = new Vec2(target.pos.x, target.pos.y).sub(
          aim,
        );
        const [targetDir, targetDist] = toTarget.normalizedWithLength();
        if (targetDist >= _COMPUTER_AIM_SNAP_DISTANCE) {
          aim = aim.add(
            targetDir.mul(targetDist * _COMPUTER_AIM_TRACK_GAIN * dt),
          );
        } else {
          aim = new Vec2(target.pos.x, target.pos.y);
        }
        const delta = aim.sub(player.pos);
        if (delta.lengthSq() > 1e-9) {
          heading = delta.toHeading();
        }
        computerAutoFire = targetDist < _COMPUTER_AUTO_FIRE_DISTANCE;
      } else {
        const [away, awayMag] = player.pos
          .sub(_COMPUTER_ARENA_CENTER)
          .normalizedWithLength();
        const awayDir = awayMag <= 1e-6 ? new Vec2(0.0, -1.0) : away;
        aim = player.pos.add(awayDir.mul(_AIM_RADIUS_KEYBOARD));
        heading = awayDir.toHeading();
      }
    }

    const finalDelta = aim.sub(player.pos);
    if (finalDelta.lengthSq() > 1e-9) {
      heading = finalDelta.toHeading();
    }
    state.aimHeading = heading;

    let fireDown = inputCodeIsDown(fireKey, { playerIndex: idx });
    const firePressed = inputCodeIsPressed(fireKey, { playerIndex: idx });
    if (aimScheme === AimScheme.COMPUTER && computerAutoFire) {
      fireDown = true;
    }
    const reloadPressed = inputCodeIsPressed(reloadKey, { playerIndex: idx });
    const reloadDown = inputCodeIsDown(reloadKey, { playerIndex: idx });

    return new PlayerInput({
      move: moveVec,
      aim,
      moveMode: moveModeType,
      aimScheme,
      fireDown,
      firePressed,
      reloadPressed,
      reloadDown,
      moveToCursorPressed,
      moveForwardPressed,
      moveBackwardPressed,
      turnLeftPressed,
      turnRightPressed,
    });
  }

  buildFrameInputs(opts: {
    players: readonly PlayerState[];
    config: CrimsonConfig;
    mouseScreen: Vec2;
    screenToWorld: (v: Vec2) => Vec2;
    dt: number;
    creatures?: readonly ComputerAimCreature[] | null;
  }): PlayerInput[] {
    const {
      players,
      config,
      mouseScreen,
      screenToWorld,
      dt,
      creatures = null,
    } = opts;
    const mouseWorld = screenToWorld(mouseScreen);
    const screenCenter = new Vec2(
      wgl.getScreenWidth() * 0.5,
      wgl.getScreenHeight() * 0.5,
    );
    const out: PlayerInput[] = [];
    for (let idx = 0; idx < players.length; idx++) {
      out.push(
        this.buildPlayerInput({
          playerIndex: idx,
          player: players[idx],
          config,
          mouseScreen,
          mouseWorld,
          screenCenter,
          dt,
          creatures,
        }),
      );
    }
    return out;
  }
}
