// Port of crimson/perks/impl/bandage.py

import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyBandage(ctx: PerkApplyCtx): void {
  for (const player of ctx.players) {
    if (player.health > 0.0) {
      const amount = ctx.state.rng.rand({ caller: RngCallerStatic.PERK_APPLY_BANDAGE_HEAL }) % 50 + 1;
      if (ctx.state.preserveBugs) {
        // Original exe behavior (likely bug): health multiplier.
        player.health = Math.min(100.0, player.health * amount);
      } else {
        // Intended behavior from in-game text: restore up to 50% HP.
        player.health = Math.min(100.0, player.health + amount);
      }
      ctx.state.effects.spawnBurst({
        pos: player.pos,
        count: 8,
        rng: ctx.state.rng,
        detailPreset: 5,
      });
    }
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.BANDAGE,
  applyHandler: applyBandage,
});
