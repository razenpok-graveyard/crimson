// Port of crimson/perks/runtime/apply_context.py

import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import type { PerkId } from '@crimson/perks/ids.ts';
import type { PerkSelectionState } from '@crimson/perks/state.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

export type PerkApplyHandler = (arg0: PerkApplyCtx) => void;

export class PerkApplyCtx {
  state: GameplayState;
  players: PlayerState[];
  owner: PlayerState;
  perkId: PerkId;
  perkState: PerkSelectionState | null;
  dt: number | null;
  creatures: readonly CreatureState[] | null;

  constructor(opts: {
    state: GameplayState;
    players: PlayerState[];
    owner: PlayerState;
    perkId: PerkId;
    perkState: PerkSelectionState | null;
    dt: number | null;
    creatures: readonly CreatureState[] | null;
  }) {
    this.state = opts.state;
    this.players = opts.players;
    this.owner = opts.owner;
    this.perkId = opts.perkId;
    this.perkState = opts.perkState;
    this.dt = opts.dt;
    this.creatures = opts.creatures;
  }

  frameDt(): number {
    return this.dt !== null ? this.dt : 0.0;
  }
}
