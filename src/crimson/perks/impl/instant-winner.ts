// Port of crimson/perks/impl/instant_winner.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyInstantWinner(ctx: PerkApplyCtx): void {
  ctx.owner.experience += 2500;
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.INSTANT_WINNER,
  applyHandler: applyInstantWinner,
});
