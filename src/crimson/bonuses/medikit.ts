// Port of crimson/bonuses/medikit.py

import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyMedikit(ctx: BonusApplyCtx): void {
  if (ctx.player.health >= 100.0) {
    return;
  }
  ctx.player.health = Math.min(100.0, ctx.player.health + 10.0);
}
