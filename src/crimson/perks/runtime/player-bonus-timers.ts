// Port of crimson/perks/runtime/player_bonus_timers.py

import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';

export function updatePlayerBonusTimers(ctx: PerksUpdateEffectsCtx): void {
  // Native `perks_update_effects` decrements per-player shield/fire-bullets/speed
  // timers before `player_update` reads them for this frame.
  for (const player of ctx.players) {
    if (player.shieldTimer <= 0.0) {
      player.shieldTimer = 0.0;
    } else {
      player.shieldTimer = player.shieldTimer - ctx.dt;
    }

    if (player.fireBulletsTimer <= 0.0) {
      player.fireBulletsTimer = 0.0;
    } else {
      player.fireBulletsTimer = player.fireBulletsTimer - ctx.dt;
    }

    if (player.speedBonusTimer <= 0.0) {
      player.speedBonusTimer = 0.0;
    } else {
      player.speedBonusTimer = player.speedBonusTimer - ctx.dt;
    }
  }
}
