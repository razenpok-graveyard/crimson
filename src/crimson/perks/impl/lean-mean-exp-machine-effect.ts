// Port of crimson/perks/impl/lean_mean_exp_machine_effect.py

import { perkCountGet } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function updateLeanMeanExpMachine(ctx: PerksUpdateEffectsCtx): void {
  ctx.state.leanMeanExpTimer -= ctx.dt;
  if (ctx.state.leanMeanExpTimer < 0.0) {
    ctx.state.leanMeanExpTimer = 0.25;
    if (ctx.players.length === 0) {
      return;
    }

    // Native `perks_update_effects` uses global `perk_count_get` and awards the
    // periodic XP tick only to player 0 (`player_experience[0]`).
    const player0 = ctx.players[0];
    const perkCount = perkCountGet(player0, PerkId.LEAN_MEAN_EXP_MACHINE);
    if (perkCount > 0) {
      player0.experience += perkCount * 10;
    }
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.LEAN_MEAN_EXP_MACHINE,
  effectsSteps: [updateLeanMeanExpMachine],
});
