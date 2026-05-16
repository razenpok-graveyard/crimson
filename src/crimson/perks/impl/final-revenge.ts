// Port of crimson/perks/impl/final_revenge.py

import { Vec2 } from '@grim/geom.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { CreatureDamageType } from '@crimson/creatures/damage-types.ts';
import type { FxQueue } from '@crimson/effects.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';
import type { CreatureDeath, CreaturePool } from '@crimson/creatures/runtime.ts';
import { creatureApplyDamageWithLethalFollowup } from '@crimson/creatures/damage.ts';

export function applyFinalRevengeOnPlayerDeath(opts: { state: GameplayState; creatures: CreaturePool; players: PlayerState[]; player: PlayerState; dt: number; worldSize: number; detailPreset: number; fxQueue: FxQueue | null; deaths: CreatureDeath[] }): void {
  // Apply Final Revenge perk behavior when a player dies.

  const state = opts.state;
  const creatures = opts.creatures;
  const players = opts.players;
  const player = opts.player;
  const dt = opts.dt;
  const worldSize = opts.worldSize;
  const detailPreset = opts.detailPreset;
  const fxQueue = opts.fxQueue;
  const deaths = opts.deaths;
  if (!perkActive(player, PerkId.FINAL_REVENGE)) {
    return;
  }

  const playerPos = player.pos;
  state.effects.spawnExplosionBurst({
    pos: playerPos,
    scale: 1.8,
    rng: state.rng,
    detailPreset: Math.trunc(detailPreset),
  });

  const prevGuard = state.bonusSpawnGuard;
  state.bonusSpawnGuard = true;
  for (const [creatureIdx, creature] of creatures.entries.entries()) {
    if (!creature.active) {
      continue;
    }

    const delta = creature.pos.sub(playerPos);
    if (Math.abs(delta.x) > 512.0 || Math.abs(delta.y) > 512.0) {
      continue;
    }

    const remaining = 512.0 - delta.length();
    if (remaining <= 0.0) {
      continue;
    }

    const damage = remaining * 5.0;
    const deathCreatureIdx = Math.trunc(creatureIdx);
    creatureApplyDamageWithLethalFollowup(
      creature,
      { damageAmount: damage, damageType: CreatureDamageType.EXPLOSION, impulse: new Vec2(), owner: OwnerRef.fromPlayer(Math.trunc(player.index)), dt: dt, players: players, rng: state.rng, preserveBugs: state.preserveBugs, effects: state.effects, detailPreset: Math.trunc(detailPreset), onLethal: (deathSfx) => { deaths.push(creatures.handleDeath(Math.trunc(deathCreatureIdx), { state: state, players: players, rng: state.rng, dt: dt, detailPreset: Math.trunc(detailPreset), worldWidth: worldSize, worldHeight: worldSize, fxQueue: fxQueue })); state.sfxQueue.push(...deathSfx); } },
    );
  }

  state.bonusSpawnGuard = prevGuard;
  state.sfxQueue.push(SfxId.EXPLOSION_LARGE);
  state.sfxQueue.push(SfxId.SHOCKWAVE);
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.FINAL_REVENGE,
  playerDeathHook: applyFinalRevengeOnPlayerDeath,
});
