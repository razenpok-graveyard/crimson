// Port of crimson/bonuses/fireblast.py

import { SfxId } from '@grim/sfx-map.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { ownerRefForPlayer, spawnProjectileRing } from '@crimson/weapon-runtime/spawn.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export function applyFireblast(ctx: BonusApplyCtx): void {
  const origin = ctx.originPos;
  const owner = ctx.state.friendlyFireEnabled ? ownerRefForPlayer(ctx.player.index) : OwnerRef.fromLocalPlayer(0);
  ctx.state.bonusSpawnGuard = true;
  spawnProjectileRing(
    ctx.state,
    origin,
    { count: 16, angleOffset: 0.0, typeId: ProjectileTemplateId.PLASMA_RIFLE, owner: owner, ownerPlayerIndex: ctx.player.index, players: ctx.players },
  );
  ctx.state.bonusSpawnGuard = false;
  ctx.state.sfxQueue.push(SfxId.EXPLOSION_MEDIUM);
}
