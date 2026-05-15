// Port of crimson/render/projectile_draw/types.py

import type { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import type { Projectile, SecondaryProjectile } from '@crimson/projectiles/types.ts';
import type { WorldRenderCtx } from '@crimson/render/world/context.ts';

export class ProjectileDrawCtx {
  readonly renderer: WorldRenderCtx;
  readonly proj: Projectile;
  readonly projIndex: number;
  readonly texture: rl.Texture | null;
  readonly typeId: number;
  readonly pos: Vec2;
  readonly screenPos: Vec2;
  readonly life: number;
  readonly angle: number;
  readonly scale: number;
  readonly alpha: number;

  constructor(opts: {
    renderer: WorldRenderCtx;
    proj: Projectile;
    projIndex: number;
    texture: rl.Texture | null;
    typeId: number;
    pos: Vec2;
    screenPos: Vec2;
    life: number;
    angle: number;
    scale: number;
    alpha: number;
  }) {
    this.renderer = opts.renderer;
    this.proj = opts.proj;
    this.projIndex = opts.projIndex;
    this.texture = opts.texture;
    this.typeId = opts.typeId;
    this.pos = opts.pos;
    this.screenPos = opts.screenPos;
    this.life = opts.life;
    this.angle = opts.angle;
    this.scale = opts.scale;
    this.alpha = opts.alpha;
  }
}

export class SecondaryProjectileDrawCtx {
  readonly renderer: WorldRenderCtx;
  readonly proj: SecondaryProjectile;
  readonly projType: number;
  readonly screenPos: Vec2;
  readonly angle: number;
  readonly scale: number;
  readonly alpha: number;

  constructor(opts: {
    renderer: WorldRenderCtx;
    proj: SecondaryProjectile;
    projType: number;
    screenPos: Vec2;
    angle: number;
    scale: number;
    alpha: number;
  }) {
    this.renderer = opts.renderer;
    this.proj = opts.proj;
    this.projType = opts.projType;
    this.screenPos = opts.screenPos;
    this.angle = opts.angle;
    this.scale = opts.scale;
    this.alpha = opts.alpha;
  }
}
