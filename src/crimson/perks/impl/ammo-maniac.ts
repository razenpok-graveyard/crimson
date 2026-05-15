// Port of crimson/perks/impl/ammo_maniac.py

import { weaponAssignPlayer } from '@crimson/weapon-runtime/assign.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyAmmoManiac(ctx: PerkApplyCtx): void {
  if (ctx.players.length > 1) {
    for (const player of ctx.players.slice(1)) {
      player.perkCounts.splice(0, player.perkCounts.length, ...ctx.owner.perkCounts);
    }
  }
  for (const player of ctx.players) {
    weaponAssignPlayer(player, player.weapon.weaponId, { state: ctx.state });
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.AMMO_MANIAC,
  applyHandler: applyAmmoManiac,
});
