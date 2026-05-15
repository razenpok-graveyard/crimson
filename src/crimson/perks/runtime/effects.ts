// Port of crimson/perks/runtime/effects.py

import type { FxQueue } from '@crimson/effects.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { PerksUpdateEffectsCtx, creatureFindInRadius } from '@crimson/perks/runtime/effects-context.ts';
import { PERKS_UPDATE_EFFECT_STEPS } from '@crimson/perks/runtime/manifest.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

// Backward-compatible re-export used by HUD target hover wiring.
const _creatureFindInRadius = creatureFindInRadius;
const _PERKS_UPDATE_EFFECT_STEPS = PERKS_UPDATE_EFFECT_STEPS;

export function perksUpdateEffects(state: GameplayState, players: PlayerState[], dt: number, opts: { creatures?: readonly CreatureState[] | null; fxQueue?: FxQueue | null } = {}): void {
  // Apply frame-based perk effect updates.
  //
  // Port subset of `perks_update_effects` (0x00406b40).

  const creatures = opts.creatures ?? null;
  const fxQueue = opts.fxQueue ?? null;
  if (dt <= 0.0) {
    return;
  }
  const ctx = new PerksUpdateEffectsCtx({ state: state, players: players, dt: dt, creatures: creatures, fxQueue: fxQueue });
  for (const step of _PERKS_UPDATE_EFFECT_STEPS) {
    step(ctx);
  }
}
