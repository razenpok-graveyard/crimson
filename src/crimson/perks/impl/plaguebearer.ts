// Port of crimson/perks/impl/plaguebearer.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyPlaguebearer(ctx: PerkApplyCtx): void {
  for (const player of ctx.players) {
    player.plaguebearerActive = true;
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.PLAGUEBEARER,
  applyHandler: applyPlaguebearer,
});
