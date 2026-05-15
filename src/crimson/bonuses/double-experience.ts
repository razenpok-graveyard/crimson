// Port of crimson/bonuses/double_experience.py

import { f32 } from '@crimson/math-parity.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';
import { bonusApplySeconds } from '@crimson/bonuses/apply-context.ts';

export function applyDoubleExperience(ctx: BonusApplyCtx): void {
  const old = ctx.state.bonuses.doubleExperience;
  if (old <= 0.0) {
    ctx.registerGlobal('double_experience');
  }
  ctx.state.bonuses.doubleExperience = f32(old + bonusApplySeconds(ctx) * ctx.economistMultiplier);
}
