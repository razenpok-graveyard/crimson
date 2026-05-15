// Port of crimson/perks/impl/infernal_contract.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyInfernalContract(ctx: PerkApplyCtx): void {
  ctx.owner.level += 3;
  if (ctx.perkState !== null) {
    ctx.perkState.pendingCount += 3;
    ctx.perkState.choicesDirty = true;
  }
  for (const player of ctx.players) {
    if (player.health > 0.0) {
      player.health = 0.1;
    }
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.INFERNAL_CONTRACT,
  applyHandler: applyInfernalContract,
});
