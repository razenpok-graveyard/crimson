// Port of crimson/perks/impl/death_clock.py

import { perkActive, perkCountGet } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { adjustPerkCount } from '@crimson/perks/runtime/counts.ts';
import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyDeathClock(ctx: PerkApplyCtx): void {
  adjustPerkCount(
    ctx.owner,
    PerkId.REGENERATION,
    { amount: -perkCountGet(ctx.owner, PerkId.REGENERATION) },
  );
  adjustPerkCount(
    ctx.owner,
    PerkId.GREATER_REGENERATION,
    { amount: -perkCountGet(ctx.owner, PerkId.GREATER_REGENERATION) },
  );
  for (const player of ctx.players) {
    if (player.health > 0.0) {
      player.health = 100.0;
    }
  }
}

export function updateDeathClock(ctx: PerksUpdateEffectsCtx): void {
  if (ctx.players.length === 0) {
    return;
  }
  if (!perkActive(ctx.players[0], PerkId.DEATH_CLOCK)) {
    return;
  }

  // Native gates this effect on shared/player-0 perk state, then applies health
  // drain to every active local player.
  for (const player of ctx.players) {
    if (player.health <= 0.0) {
      player.health = 0.0;
    } else {
      player.health = player.health - ctx.dt * 3.3333333;
    }
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.DEATH_CLOCK,
  applyHandler: applyDeathClock,
  effectsSteps: [updateDeathClock],
});
