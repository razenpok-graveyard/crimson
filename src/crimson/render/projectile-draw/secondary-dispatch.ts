// Port of crimson/render/projectile_draw/secondary_dispatch.py

import { SecondaryProjectileTypeId } from '@crimson/projectiles/types.ts';
import { drawSecondaryDetonation } from '@crimson/render/projectile-draw/secondary-detonation.ts';
import { drawSecondaryRocket, drawSecondaryType4Fallback } from '@crimson/render/projectile-draw/secondary-rocket.ts';
import type { SecondaryProjectileDrawCtx } from '@crimson/render/projectile-draw/types.ts';

type SecondaryProjectileDrawHandler = (arg0: SecondaryProjectileDrawCtx) => boolean;

const SECONDARY_PROJECTILE_DRAW_HANDLERS_BY_TYPE: Map<number, readonly SecondaryProjectileDrawHandler[]> = new Map([
  [SecondaryProjectileTypeId.ROCKET, [drawSecondaryRocket]],
  [SecondaryProjectileTypeId.HOMING_ROCKET, [drawSecondaryRocket]],
  [SecondaryProjectileTypeId.DETONATION, [drawSecondaryDetonation]],
  [SecondaryProjectileTypeId.ROCKET_MINIGUN, [drawSecondaryRocket, drawSecondaryType4Fallback]],
]);

export function drawSecondaryProjectileFromRegistry(ctx: SecondaryProjectileDrawCtx): boolean {
  const handlers = SECONDARY_PROJECTILE_DRAW_HANDLERS_BY_TYPE.get(int(ctx.projType)) ?? [];
  for (const handler of handlers) {
    if (handler(ctx)) {
      return true;
    }
  }
  return false;
}
