// Port of crimson/bonuses/weapon_power_up.py

import { f32 } from '@crimson/math-parity.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyWeaponPowerUp(ctx: BonusApplyCtx): void {
  const old = ctx.state.bonuses.weaponPowerUp;
  if (old <= 0.0) {
    ctx.registerGlobal('weapon_power_up');
  }
  ctx.state.bonuses.weaponPowerUp = f32(old + ctx.amount * ctx.economistMultiplier);
  ctx.player.weaponResetLatch = 0;
  ctx.player.weapon.shotCooldown = 0.0;
  ctx.player.weapon.reloadActive = false;
  ctx.player.weapon.reloadTimer = 0.0;
  ctx.player.weapon.reloadTimerMax = 0.0;
  ctx.player.weapon.ammo = ctx.player.weapon.clipSize;
}
