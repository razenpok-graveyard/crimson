// Port of crimson/bonuses/weapon.py

import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { WeaponSlot } from '@crimson/sim/state-types.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/assign.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyWeapon(ctx: BonusApplyCtx): void {
  const weaponId = ctx.amount;
  if (perkActive(ctx.player, PerkId.ALTERNATE_WEAPON) && ctx.player.altWeapon === null) {
    const primary = ctx.player.weapon;
    ctx.player.altWeapon = new WeaponSlot({ weaponId: primary.weaponId, clipSize: int(primary.clipSize), ammo: primary.ammo, reloadActive: Boolean(primary.reloadActive), reloadTimer: primary.reloadTimer, reloadTimerMax: primary.reloadTimerMax, shotCooldown: primary.shotCooldown });
  }
  weaponAssignPlayer(ctx.player, weaponId, { state: ctx.state });
}
