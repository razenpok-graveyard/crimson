// Port of crimson/perks/impl/regeneration_effect.py

import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function updateRegeneration(ctx: PerksUpdateEffectsCtx): void {
  if (ctx.players.length === 0) {
    return;
  }
  if (!perkActive(ctx.players[0], PerkId.REGENERATION)) {
    return;
  }
  if ((ctx.state.rng.rand({ caller: RngCallerStatic.PERKS_UPDATE_EFFECTS_REGENERATION_GATE }) & 1) === 0) {
    return;
  }

  if (ctx.state.preserveBugs) {
    // Native `perks_update_effects` applies the regen tick to player 1 only,
    // and repeats that write loop by `config_player_count`.
    const player0 = ctx.players[0];
    for (let i = 0; i < ctx.players.length; i++) {
      if (!(0.0 < player0.health && player0.health < 100.0)) {
        continue;
      }
      player0.health = player0.health + ctx.dt;
      if (player0.health > 100.0) {
        player0.health = 100.0;
      }
    }
    return;
  }

  let healAmount = ctx.dt;
  // Native no-ops Greater Regeneration. In default rewrite mode we apply the
  // intended upgrade and keep the no-op behind `--preserve-bugs`.
  if (!ctx.state.preserveBugs && perkActive(ctx.players[0], PerkId.GREATER_REGENERATION)) {
    healAmount = ctx.dt * 2.0;
  }

  for (const player of ctx.players) {
    if (!(0.0 < player.health && player.health < 100.0)) {
      continue;
    }
    player.health = player.health + healAmount;
    if (player.health > 100.0) {
      player.health = 100.0;
    }
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.REGENERATION,
  effectsSteps: [updateRegeneration],
});
