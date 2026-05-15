// Port of crimson/perks/impl/man_bomb.py

import { SfxId } from '@grim/sfx-map.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';
import type { PlayerPerkTickCtx } from '@crimson/perks/runtime/player-tick-context.ts';

export function tickManBomb(ctx: PlayerPerkTickCtx): void {
  if (!perkActive(ctx.player, PerkId.MAN_BOMB)) {
    ctx.player.manBombTimer = 0.0;
    return;
  }

  ctx.player.manBombTimer += ctx.dt;
  if (ctx.player.manBombTimer > ctx.state.perkIntervals.manBomb) {
    const owner = ctx.ownerRefForPlayerProjectiles(ctx.state, ctx.player.index);
    for (let idx = 0; idx < 8; idx++) {
      const typeId = ((idx & 1) === 0) ? ProjectileTemplateId.ION_MINIGUN : ProjectileTemplateId.ION_RIFLE;
      const caller = typeId === ProjectileTemplateId.ION_MINIGUN ? RngCallerStatic.PLAYER_UPDATE_MAN_BOMB_ION_MINIGUN_ANGLE : RngCallerStatic.PLAYER_UPDATE_MAN_BOMB_ION_RIFLE_ANGLE;
      const angle = (ctx.state.rng.rand({ caller: caller }) % 50 * 0.01) + idx * (Math.PI / 4.0) - 0.25;
      ctx.projectileSpawn(
        ctx.state,
        { players: ctx.players, pos: ctx.player.pos, angle: angle, typeId: typeId, owner: owner, ownerPlayerIndex: ctx.player.index },
      );
    }
    ctx.state.sfxQueue.push(SfxId.EXPLOSION_SMALL);

    ctx.player.manBombTimer -= ctx.state.perkIntervals.manBomb;
    ctx.state.perkIntervals.manBomb = 4.0;
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.MAN_BOMB,
  playerTickSteps: [tickManBomb],
});
