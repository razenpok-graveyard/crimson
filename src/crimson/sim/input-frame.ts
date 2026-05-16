// Port of crimson/sim/input_frame.py

// Deterministic per-tick player input frame normalization.

import { PlayerInput } from '@crimson/sim/input.ts';

export class InputFrame {
  readonly players: readonly PlayerInput[];

  constructor(opts: {
    players: readonly PlayerInput[];
  }) {
    this.players = opts.players;
  }

  asList(): PlayerInput[] {
    return Array.from(this.players);
  }
}

export function normalizeInputFrame(inputs: readonly PlayerInput[] | null, opts: { playerCount: number }): InputFrame {
  // Return a fixed-size, player-index-ordered input frame.
  const playerCount = opts.playerCount;
  const count = Math.max(0, Math.trunc(playerCount));
  const frame = Array.from({ length: Math.max(0, count) }, (_, i) => i).map((_) => new PlayerInput());
  if (inputs !== null) {
    const limit = Math.min(inputs.length, count);
    for (let idx = 0; idx < limit; idx++) {
      const inp = inputs[idx];
      frame[idx] = new PlayerInput({ move: inp.move, aim: inp.aim, moveMode: inp.moveMode, aimScheme: inp.aimScheme, fireDown: inp.fireDown, firePressed: inp.firePressed, reloadPressed: inp.reloadPressed, reloadDown: inp.reloadDown, moveToCursorPressed: inp.moveToCursorPressed, moveForwardPressed: inp.moveForwardPressed, moveBackwardPressed: inp.moveBackwardPressed, turnLeftPressed: inp.turnLeftPressed, turnRightPressed: inp.turnRightPressed });
    }
  }
  return new InputFrame({ players: Array.from(frame) });
}
