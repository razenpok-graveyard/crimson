// Port of crimson/sim/input.py

import { Vec2 } from '@grim/geom.ts';
import type { AimScheme } from '@crimson/aim-schemes.ts';
import type { MovementControlType } from '@crimson/movement-controls.ts';

export class PlayerInput {
  readonly move: Vec2;
  readonly aim: Vec2;
  readonly moveMode: MovementControlType | null;
  readonly aimScheme: AimScheme | null;
  readonly fireDown: boolean;
  readonly firePressed: boolean;
  readonly reloadPressed: boolean;
  readonly reloadDown: boolean;
  readonly moveToCursorPressed: boolean;
  readonly moveForwardPressed: boolean | null;
  readonly moveBackwardPressed: boolean | null;
  readonly turnLeftPressed: boolean | null;
  readonly turnRightPressed: boolean | null;

  constructor(opts: {
    move?: Vec2;
    aim?: Vec2;
    moveMode?: MovementControlType | null;
    aimScheme?: AimScheme | null;
    fireDown?: boolean;
    firePressed?: boolean;
    reloadPressed?: boolean;
    reloadDown?: boolean;
    moveToCursorPressed?: boolean;
    moveForwardPressed?: boolean | null;
    moveBackwardPressed?: boolean | null;
    turnLeftPressed?: boolean | null;
    turnRightPressed?: boolean | null;
  } = {}) {
    this.move = opts.move ?? new Vec2();
    this.aim = opts.aim ?? new Vec2();
    this.moveMode = opts.moveMode ?? null;
    this.aimScheme = opts.aimScheme ?? null;
    this.fireDown = opts.fireDown ?? false;
    this.firePressed = opts.firePressed ?? false;
    this.reloadPressed = opts.reloadPressed ?? false;
    this.reloadDown = opts.reloadDown ?? false;
    this.moveToCursorPressed = opts.moveToCursorPressed ?? false;
    this.moveForwardPressed = opts.moveForwardPressed ?? null;
    this.moveBackwardPressed = opts.moveBackwardPressed ?? null;
    this.turnLeftPressed = opts.turnLeftPressed ?? null;
    this.turnRightPressed = opts.turnRightPressed ?? null;
  }
}
