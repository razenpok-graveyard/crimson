// Port of crimson/perks/impl/breathing_room.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyBreathingRoom(ctx: PerkApplyCtx): void {
  for (const player of ctx.players) {
    player.health -= player.health * (2.0 / 3.0);
  }

  const frameDt = ctx.frameDt();
  const creatures = ctx.creatures;
  if (creatures !== null) {
    for (const creature of creatures) {
      if (creature.active) {
        creature.lifecycleStage = creature.lifecycleStage - frameDt;
      }
    }
  }

  ctx.state.bonusSpawnGuard = false;
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.BREATHING_ROOM,
  applyHandler: applyBreathingRoom,
});
