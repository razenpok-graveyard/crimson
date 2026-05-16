// Port of crimson/replay/input_codec.py

import { Vec2 } from '@grim/geom.ts';
import { f32 } from '@crimson/math-parity.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import type { InputQuantization, PackedPlayerInput, PackedTickInputs } from '@crimson/replay/types.ts';
import { packInputFlags, unpackInputFlags, unpackInputModeFlags, unpackInputMoveKeyFlags, unpackPackedPlayerInput } from '@crimson/replay/types.ts';

function pythonRepr(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'nan';
    }
    if (value === Infinity) {
      return 'inf';
    }
    if (value === -Infinity) {
      return '-inf';
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === true) {
    return 'True';
  }
  if (value === false) {
    return 'False';
  }
  if (value === null) {
    return 'None';
  }
  return String(value);
}

function quantizeF32(value: number): number {
  return f32(value);
}

export function packPlayerInput(inp: PlayerInput, opts: { quant?: InputQuantization } = {}): PackedPlayerInput {
  const quant = opts.quant ?? 'f32';
  if (String(quant) !== 'f32') {
    throw new Error(`unsupported replay input quantization: ${pythonRepr(quant)}`);
  }
  let mx = inp.move.x;
  let my = inp.move.y;
  let ax = inp.aim.x;
  let ay = inp.aim.y;
  mx = quantizeF32(mx);
  my = quantizeF32(my);
  ax = quantizeF32(ax);
  ay = quantizeF32(ay);
  const flags = packInputFlags({ fireDown: inp.fireDown, firePressed: inp.firePressed, reloadPressed: inp.reloadPressed, reloadDown: inp.reloadDown, moveMode: inp.moveMode, aimScheme: inp.aimScheme, moveForwardPressed: inp.moveForwardPressed, moveBackwardPressed: inp.moveBackwardPressed, turnLeftPressed: inp.turnLeftPressed, turnRightPressed: inp.turnRightPressed });
  return [mx, my, ax, ay, int(flags)];
}

export function unpackPlayerInput(packed: PackedPlayerInput): PlayerInput {
  const [mx, my, ax, ay, flags] = unpackPackedPlayerInput(packed);
  const [fireDown, firePressed, reloadPressed, reloadDown] = unpackInputFlags(int(flags));
  const [moveMode, aimScheme] = unpackInputModeFlags(int(flags));
  const [moveForwardPressed, moveBackwardPressed, turnLeftPressed, turnRightPressed] = unpackInputMoveKeyFlags(int(flags));
  return new PlayerInput({ move: new Vec2(mx, my), aim: new Vec2(ax, ay), moveMode: moveMode, aimScheme: aimScheme, fireDown: fireDown, firePressed: firePressed, reloadPressed: reloadPressed, reloadDown: reloadDown, moveForwardPressed: moveForwardPressed, moveBackwardPressed: moveBackwardPressed, turnLeftPressed: turnLeftPressed, turnRightPressed: turnRightPressed });
}

export function unpackTickInputs(packedTick: PackedTickInputs): PlayerInput[] {
  return packedTick.map((packed) => unpackPlayerInput(packed));
}

export function packTickInputs(inputs: readonly PlayerInput[], opts: { quant?: InputQuantization } = {}): PackedTickInputs {
  const quant = opts.quant ?? 'f32';
  return inputs.map((inp) => packPlayerInput(inp, { quant: quant }));
}
