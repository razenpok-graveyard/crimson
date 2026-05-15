// Port of crimson/perks/impl/fatal_lottery.py

import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyFatalLottery(ctx: PerkApplyCtx): void {
  if (ctx.state.rng.rand({ caller: RngCallerStatic.PERK_APPLY_FATAL_LOTTERY }) & 1) {
    ctx.owner.health = -1.0;
  } else {
    ctx.owner.experience += 10000;
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.FATAL_LOTTERY,
  applyHandler: applyFatalLottery,
});
