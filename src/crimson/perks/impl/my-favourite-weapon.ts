// Port of crimson/perks/impl/my_favourite_weapon.py

import { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyCtx } from '@crimson/perks/runtime/apply-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function applyMyFavouriteWeapon(ctx: PerkApplyCtx): void {
  for (const player of ctx.players) {
    player.weapon.clipSize += 2;
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.MY_FAVOURITE_WEAPON,
  applyHandler: applyMyFavouriteWeapon,
});
