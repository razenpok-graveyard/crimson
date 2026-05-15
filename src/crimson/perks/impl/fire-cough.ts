// Port of crimson/perks/impl/fire_cough.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';
import type { PlayerPerkTickCtx } from '@crimson/perks/runtime/player-tick-context.ts';

export function tickFireCough(ctx: PlayerPerkTickCtx): void {
  if (!perkActive(ctx.player, PerkId.FIRE_CAUGH)) {
    ctx.player.fireCoughTimer = 0.0;
    return;
  }

  ctx.player.fireCoughTimer += ctx.dt;
  if (ctx.player.fireCoughTimer <= ctx.state.perkIntervals.fireCough) {
    return;
  }

  const owner = ctx.ownerRefForPlayerProjectiles(ctx.state, ctx.player.index);
  ctx.state.sfxQueue.push(SfxId.AUTORIFLE_FIRE);
  ctx.state.sfxQueue.push(SfxId.PLASMAMINIGUN_FIRE);

  const aimHeading = ctx.player.aimHeading;
  const originPos = ctx.playerPosBeforeMove;
  const muzzle = originPos.add(Vec2.fromHeading(aimHeading).rotated(-0.150915).mul(16.0));

  const aim = ctx.player.aim;
  const dist = aim.sub(originPos).length();
  const maxOffset = dist * ctx.player.spreadHeat * 0.5;
  const dirRoll = ctx.state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_FIRE_COUGH_SPREAD_DIR });
  const dirAngle = (dirRoll & 0x1FF) * ((Math.PI * 2.0) / 512.0);
  const magRoll = ctx.state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_FIRE_COUGH_SPREAD_MAG });
  const mag = (magRoll & 0x1FF) * (1.0 / 512.0);
  const offset = maxOffset * mag;
  const jitter = aim.add(Vec2.fromAngle(dirAngle).mul(offset));
  const angle = jitter.sub(originPos).toHeading();
  ctx.projectileSpawn(
    ctx.state,
    { players: [ctx.player], pos: muzzle, angle: angle, typeId: ProjectileTemplateId.FIRE_BULLETS, owner: owner, ownerPlayerIndex: ctx.player.index },
  );

  const vel = Vec2.fromAngle(aimHeading).mul(25.0);
  ctx.state.spriteEffects.spawn({ pos: muzzle, vel: vel, scale: 1.0, color: new RGBA(0.5, 0.5, 0.5, 0.413) });

  ctx.player.fireCoughTimer -= ctx.state.perkIntervals.fireCough;
  const intervalRoll = ctx.state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_FIRE_COUGH_INTERVAL_RESET });
  ctx.state.perkIntervals.fireCough = intervalRoll % 4 + 2.0;
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.FIRE_CAUGH,
  playerTickSteps: [tickFireCough],
});
