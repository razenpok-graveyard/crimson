// Port of crimson/bonuses/shock_chain.py

import { Vec2 } from '@grim/geom.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { creatureLifecycleIsAlive } from '@crimson/creatures/lifecycle.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { ownerRefForPlayer, projectileSpawn } from '@crimson/weapon-runtime/spawn.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyShockChain(ctx: BonusApplyCtx): void {
  const creatures = ctx.creatures;
  if (creatures.length === 0) {
    return;
  }

  // Mirrors the `exclude_id == -1` behavior of `creature_find_nearest(origin, -1, 0.0)`:
  // - requires `active != 0`
  // - requires `lifecycle_stage == 16.0` (alive sentinel)
  // - no HP gate
  const origin = ctx.originPos;
  let bestIdx = Boolean(ctx.state.preserveBugs) ? 0 : -1;
  let bestDistSq = 1e12;
  for (const [idx, creature] of creatures.entries()) {
    if (!creature.active) {
      continue;
    }
    if (!creatureLifecycleIsAlive(creature.lifecycleStage)) {
      continue;
    }
    const dSq = Vec2.distanceSq(origin, creature.pos);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestIdx = idx;
    }
  }

  if (bestIdx < 0) {
    return;
  }

  const target = creatures[bestIdx];
  const angle = target.pos.sub(origin).toHeading();
  const owner = ctx.state.friendlyFireEnabled ? ownerRefForPlayer(ctx.player.index) : OwnerRef.fromLocalPlayer(0);

  ctx.state.bonusSpawnGuard = true;
  ctx.state.shockChainLinksLeft = 0x20;
  ctx.state.shockChainProjectileId = projectileSpawn(ctx.state, { players: ctx.players, pos: origin, angle: angle, typeId: ProjectileTemplateId.ION_RIFLE, owner: owner, ownerPlayerIndex: ctx.player.index });
  ctx.state.bonusSpawnGuard = false;
  ctx.state.sfxQueue.push(SfxId.SHOCK_HIT_01);
}
