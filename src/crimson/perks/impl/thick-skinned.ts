// Port of crimson/perks/impl/thick_skinned.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyThickSkinned(ctx: PerkApplyCtx): void {
  for (const player of ctx.players) {
    if (player.health > 0.0) {
      player.health = Math.max(1.0, player.health * (2.0 / 3.0));
    }
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.THICK_SKINNED,
  applyHandler: applyThickSkinned,
});
