// Port of crimson/perks/impl/pyrokinetic_effect.py

import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

export function updatePyrokinetic(ctx: PerksUpdateEffectsCtx): void {
  if (ctx.creatures === null) {
    return;
  }

  const players = ctx.state.preserveBugs ? ctx.players.slice(0, 1) : ctx.players;
  for (const player of players) {
    if (!perkActive(player, PerkId.PYROKINETIC)) {
      continue;
    }
    if (!ctx.state.preserveBugs && player.health <= 0.0) {
      continue;
    }

    const target = ctx.aimTargetForPlayer(player.index);
    if (target === -1) {
      continue;
    }
    const creature = ctx.creatures[target];
    creature.collisionTimer = creature.collisionTimer - ctx.dt;
    if (creature.collisionTimer < 0.0) {
      creature.collisionTimer = 0.5;
      for (const [intensity, caller] of [
        [0.8, RngCallerStatic.PERKS_UPDATE_EFFECTS_PYROKINETIC_ANGLE_0P8],
        [0.6, RngCallerStatic.PERKS_UPDATE_EFFECTS_PYROKINETIC_ANGLE_0P6],
        [0.4, RngCallerStatic.PERKS_UPDATE_EFFECTS_PYROKINETIC_ANGLE_0P4],
        [0.3, RngCallerStatic.PERKS_UPDATE_EFFECTS_PYROKINETIC_ANGLE_0P3],
        [0.2, RngCallerStatic.PERKS_UPDATE_EFFECTS_PYROKINETIC_ANGLE_0P2],
      ]) {
        const angle = ctx.state.rng.rand({ caller: caller }) % 628 * 0.01;
        ctx.state.particles.spawnParticle({ pos: creature.pos, angle: angle, intensity: intensity });
      }
      if (ctx.fxQueue !== null) {
        ctx.fxQueue.addRandom({
          pos: creature.pos,
          rng: ctx.state.rng,
        });
      }
    }
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.PYROKINETIC,
  effectsSteps: [updatePyrokinetic],
});
