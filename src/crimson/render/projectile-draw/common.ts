// Port of crimson/render/projectile_draw/common.py

import type { Vec2 } from '@grim/geom.ts';
import type { Projectile } from '@crimson/projectiles/types.ts';

export const RAD_TO_DEG = 57.29577951308232;

export function projOrigin(proj: Projectile, _fallback: Vec2): Vec2 {
  void _fallback;
  return proj.origin;
}
