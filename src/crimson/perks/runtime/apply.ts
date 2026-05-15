// Port of crimson/perks/runtime/apply.py

import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import type { PerkId } from '@crimson/perks/ids.ts';
import type { PerkSelectionState } from '@crimson/perks/state.ts';
import { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { adjustPerkCount } from '@crimson/perks/runtime/counts.ts';
import { PERK_APPLY_HANDLERS } from '@crimson/perks/runtime/manifest.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

export function perkApply(state: GameplayState, players: PlayerState[], perkId: PerkId, opts: { perkState?: PerkSelectionState | null; dt?: number | null; creatures?: readonly CreatureState[] | null } = {}): void {
  // Apply immediate perk effects and increment the perk counter.

  const perkState = opts.perkState ?? null;
  const dt = opts.dt ?? null;
  const creatures = opts.creatures ?? null;
  if (!players.length) {
    return;
  }
  const owner = players[0];
  try {
    adjustPerkCount(owner, perkId);
    const handler = PERK_APPLY_HANDLERS.get(perkId) ?? null;
    if (handler !== null) {
      handler(new PerkApplyCtx({ state: state, players: players, owner: owner, perkId: perkId, perkState: perkState, dt: dt, creatures: creatures }));
    }
  } finally {
    if (players.length > 1) {
      for (const player of players.slice(1)) {
        player.perkCounts.splice(0, player.perkCounts.length, ...owner.perkCounts);
      }
    }
  }
}
