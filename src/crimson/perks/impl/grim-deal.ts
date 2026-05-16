// Port of crimson/perks/impl/grim_deal.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyGrimDeal(ctx: PerkApplyCtx): void {
  ctx.owner.health = -1.0;
  ctx.owner.experience += Math.trunc(ctx.owner.experience * 0.18);
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.GRIM_DEAL,
  applyHandler: applyGrimDeal,
});
