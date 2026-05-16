// Port of crimson/bonuses/pickup_fx.py

// Bonus pickup presentation hook registry.

import { RGBA } from '@grim/color.ts';
import type { BonusPickupEvent, GameplayState } from '@crimson/sim/state-types.ts';
import { applyFreezePickupFx } from '@crimson/bonuses/freeze.ts';
import { BonusId } from '@crimson/bonuses/ids.ts';
import { applyReflexBoostPickupFx } from '@crimson/bonuses/reflex-boost.ts';

export type BonusPickupFxHook = (arg0: GameplayState, arg1: BonusPickupEvent, arg2: number) => void;

function applyDefaultPickupBurst(opts: { state: GameplayState; pickup: BonusPickupEvent; detailPreset: number }): void {
  const state = opts.state;
  const pickup = opts.pickup;
  const detailPreset = opts.detailPreset;
  if (pickup.bonusId === BonusId.NUKE) {
    return;
  }
  state.effects.spawnBurst({
    pos: pickup.pos,
    count: 12,
    rng: state.rng,
    detailPreset: int(detailPreset),
    lifetime: 0.4,
    scaleStep: 0.1,
    color: new RGBA(0.4, 0.5, 1.0, 0.5),
  });
}

function applyReflexBoostHook(state: GameplayState, pickup: BonusPickupEvent, detailPreset: number): void {
  applyReflexBoostPickupFx({ state: state, pickup: pickup, detailPreset: detailPreset });
}

function applyFreezeHook(state: GameplayState, pickup: BonusPickupEvent, detailPreset: number): void {
  applyFreezePickupFx({ state: state, pickup: pickup, detailPreset: detailPreset });
}

export function emitBonusPickupEffects(opts: { state: GameplayState; pickups: BonusPickupEvent[]; detailPreset: number }): void {
  // Emit deterministic pickup FX for the provided pickup list.
  const state = opts.state;
  const pickups = opts.pickups;
  const detailPreset = opts.detailPreset;
  for (const pickup of pickups) {
    applyDefaultPickupBurst({ state: state, pickup: pickup, detailPreset: int(detailPreset) });
    const hook = BONUS_PICKUP_HOOKS.get(pickup.bonusId) ?? null;
    if (hook !== null) {
      hook(state, pickup, int(detailPreset));
    }
  }
}

export const BONUS_PICKUP_HOOKS: Map<BonusId, BonusPickupFxHook> = new Map([
  [BonusId.REFLEX_BOOST, applyReflexBoostHook],
  [BonusId.FREEZE, applyFreezeHook],
]);
