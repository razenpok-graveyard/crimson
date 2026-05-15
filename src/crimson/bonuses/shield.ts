// Port of crimson/bonuses/shield.py

import { f32 } from '@crimson/math-parity.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyShield(ctx: BonusApplyCtx): void {
  let shouldRegister = ctx.player.shieldTimer <= 0.0;
  if (ctx.players.length > 1) {
    shouldRegister = ctx.players[0].shieldTimer <= 0.0 && ctx.players[1].shieldTimer <= 0.0;
  }
  if (shouldRegister) {
    ctx.registerPlayer('shield_timer');
  }
  ctx.player.shieldTimer = f32(ctx.player.shieldTimer + ctx.amount * ctx.economistMultiplier);
}
