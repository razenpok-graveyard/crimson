// Port of crimson/perks/impl/lifeline_50_50.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyLifeline5050(ctx: PerkApplyCtx): void {
  const creatures = ctx.creatures;
  if (creatures === null) {
    return;
  }

  let killToggle = false;
  for (const creature of creatures) {
    if (killToggle && creature.active && creature.hp <= 500.0 && (int(creature.flags) & 0x04) === 0) {
      creature.active = false;
      ctx.state.effects.spawnBurst({
        pos: creature.pos,
        count: 4,
        rng: ctx.state.rng,
        detailPreset: 5,
      });
    }
    killToggle = !killToggle;
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.LIFELINE_50_50,
  applyHandler: applyLifeline5050,
});
