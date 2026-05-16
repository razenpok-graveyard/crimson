// Port of crimson/perks/runtime/effects_context.py

import type { Vec2 } from '@grim/geom.ts';
import { nativeFindSizeMargin } from '@crimson/collision-math.ts';
import { creatureLifecycleIsCollidable } from '@crimson/creatures/lifecycle.ts';
import type { FxQueue } from '@crimson/effects.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

export function creatureFindInRadius(creatures: readonly CreatureState[], opts: { pos: Vec2; radius: number; startIndex: number }): number {
  // Find the first active creature intersecting an aim radius.
  //
  // Port of `creature_find_in_radius` (0x004206a0).

  const pos = opts.pos;
  const radius = opts.radius;
  let startIndex = opts.startIndex;
  startIndex = Math.max(0, int(startIndex));
  const maxIndex = Math.min(creatures.length, 0x180);
  if (startIndex >= maxIndex) {
    return -1;
  }


  for (let idx = startIndex; idx < maxIndex; idx++) {
    const creature = creatures[idx];
    if (!creature.active) {
      continue;
    }

    const dist = creature.pos.sub(pos).length() - radius;
    const threshold = nativeFindSizeMargin(creature.size);
    if (threshold < dist) {
      continue;
    }
    if (!creatureLifecycleIsCollidable(creature.lifecycleStage)) {
      continue;
    }
    return idx;
  }
  return -1;
}

export class PerksUpdateEffectsCtx {
  state: GameplayState;
  players: PlayerState[];
  dt: number;
  creatures: readonly CreatureState[] | null;
  fxQueue: FxQueue | null;
  aimTargetByPlayerIndex: Map<number, number>;

  constructor(opts: {
    state: GameplayState;
    players: PlayerState[];
    dt: number;
    creatures: readonly CreatureState[] | null;
    fxQueue: FxQueue | null;
    aimTargetByPlayerIndex?: Map<number, number>;
  }) {
    this.state = opts.state;
    this.players = opts.players;
    this.dt = opts.dt;
    this.creatures = opts.creatures;
    this.fxQueue = opts.fxQueue;
    this.aimTargetByPlayerIndex = opts.aimTargetByPlayerIndex ?? new Map();
  }

  aimTargetForPlayer(playerIndex: number): number {
    playerIndex = int(playerIndex);
    if (this.aimTargetByPlayerIndex.has(playerIndex)) {
      return int(this.aimTargetByPlayerIndex.get(playerIndex)!);
    }

    let target = -1;
    if (this.creatures === null) {
      this.aimTargetByPlayerIndex.set(playerIndex, int(target));
      return int(target);
    }

    if (this.state.preserveBugs && playerIndex !== 0) {
      this.aimTargetByPlayerIndex.set(playerIndex, int(target));
      return int(target);
    }

    if (!(playerIndex >= 0 && playerIndex < this.players.length)) {
      this.aimTargetByPlayerIndex.set(playerIndex, int(target));
      return int(target);
    }

    const player = this.players[playerIndex];
    if (!this.state.preserveBugs && player.health <= 0.0) {
      this.aimTargetByPlayerIndex.set(playerIndex, int(target));
      return int(target);
    }

    target = creatureFindInRadius(this.creatures, { pos: player.aim, radius: 12.0, startIndex: 0 });
    this.aimTargetByPlayerIndex.set(playerIndex, int(target));
    return int(target);
  }
}
