// Port of crimson/perks/impl/evil_eyes_effect.py

import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function updateEvilEyesTarget(ctx: PerksUpdateEffectsCtx): void {
  if (ctx.players.length === 0) {
    return;
  }

  if (ctx.state.preserveBugs) {
    const player0 = ctx.players[0];
    if (!perkActive(player0, PerkId.EVIL_EYES)) {
      player0.evilEyesTargetCreature = -1;
      return;
    }
    player0.evilEyesTargetCreature = ctx.aimTargetForPlayer(0);
    return;
  }

  for (const player of ctx.players) {
    if (player.health <= 0.0) {
      player.evilEyesTargetCreature = -1;
      continue;
    }
    if (!perkActive(player, PerkId.EVIL_EYES)) {
      player.evilEyesTargetCreature = -1;
      continue;
    }
    player.evilEyesTargetCreature = ctx.aimTargetForPlayer(player.index);
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.EVIL_EYES,
  effectsSteps: [updateEvilEyesTarget],
});
