// Port of crimson/perks/impl/living_fortress.py

import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';
import type { PlayerPerkTickCtx } from '@crimson/perks/runtime/player-tick-context.ts';

export function tickLivingFortress(ctx: PlayerPerkTickCtx): void {
  if (perkActive(ctx.player, PerkId.LIVING_FORTRESS)) {
    ctx.player.livingFortressTimer = Math.min(30.0, ctx.player.livingFortressTimer + ctx.dt);
  } else {
    ctx.player.livingFortressTimer = 0.0;
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.LIVING_FORTRESS,
  playerTickSteps: [tickLivingFortress],
});
