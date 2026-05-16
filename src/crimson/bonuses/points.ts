// Port of crimson/bonuses/points.py

import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyPoints(ctx: BonusApplyCtx): void {
  // Native adds Points directly to player0 XP (no Double XP multiplier).
  const amount = Math.trunc(ctx.amount);
  if (amount <= 0) {
    return;
  }
  let target = ctx.player;
  if (ctx.players.length > 0) {
    target = ctx.players[0];
  }
  target.experience += Math.trunc(amount);
}
