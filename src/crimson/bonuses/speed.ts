// Port of crimson/bonuses/speed.py

import { f32 } from '@crimson/math-parity.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applySpeed(ctx: BonusApplyCtx): void {
  let shouldRegister = ctx.player.speedBonusTimer <= 0.0;
  if (ctx.players.length > 1) {
    shouldRegister = (ctx.players[0].speedBonusTimer <= 0.0 && ctx.players[1].speedBonusTimer <= 0.0);
  }
  if (shouldRegister) {
    ctx.registerPlayer('speed_bonus_timer');
  }
  ctx.player.speedBonusTimer = f32(ctx.player.speedBonusTimer + ctx.amount * ctx.economistMultiplier);
}
