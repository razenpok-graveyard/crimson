// Port of crimson/bonuses/reflex_boost.py

// Reflex Boost pickup presentation behavior.

import { RGBA } from '@grim/color.ts';
import { f32 } from '@crimson/math-parity.ts';
import type { BonusPickupEvent, GameplayState } from '@crimson/sim/state-types.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyReflexBoost(ctx: BonusApplyCtx): void {
  const old = ctx.state.bonuses.reflexBoost;
  if (old <= 0.0) {
    ctx.registerGlobal('reflex_boost');
  }
  ctx.state.bonuses.reflexBoost = f32(old + ctx.amount * ctx.economistMultiplier);

  for (const target of ctx.players) {
    target.weapon.ammo = target.weapon.clipSize;
    target.weapon.reloadActive = false;
    target.weapon.reloadTimer = 0.0;
    target.weapon.reloadTimerMax = 0.0;
  }
}

export function applyReflexBoostPickupFx(opts: { state: GameplayState; pickup: BonusPickupEvent; detailPreset: number }): void {
  // Spawn the blue ring used by Reflex Boost bonus pickups.
  const state = opts.state;
  const pickup = opts.pickup;
  const detailPreset = opts.detailPreset;
  state.effects.spawnRing({
    pos: pickup.pos,
    detailPreset: int(detailPreset),
    color: new RGBA(0.6, 0.6, 1.0, 1.0),
  });
}
