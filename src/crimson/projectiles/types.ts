// Port of crimson/projectiles/types.py

import { Vec2 } from '@grim/geom.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
export { OwnerRef } from '@crimson/owner-ref.ts';

export type CreatureDamageApplier = (arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void;
export type SecondaryDetonationKillHandler = (arg0: number) => void;

export const MAIN_PROJECTILE_POOL_SIZE = 0x60;
export const SECONDARY_PROJECTILE_POOL_SIZE = 0x40;

export enum ProjectileTemplateId {
  // Values are projectile type ids (not weapon ids). Based on the decompile
  // for `player_fire_weapon` and `projectile_update`.
  PISTOL = 0x01,
  ASSAULT_RIFLE = 0x02,
  SHOTGUN = 0x03,
  SUBMACHINE_GUN = 0x05,
  GAUSS_GUN = 0x06,
  PLASMA_RIFLE = 0x09,
  PLASMA_MINIGUN = 0x0B,
  PULSE_GUN = 0x13,
  ION_RIFLE = 0x15,
  ION_MINIGUN = 0x16,
  ION_CANNON = 0x17,
  SHRINKIFIER = 0x18,
  BLADE_GUN = 0x19,
  SPIDER_PLASMA = 0x1A,
  PLASMA_CANNON = 0x1C,
  SPLITTER_GUN = 0x1D,
  PLAGUE_SPREADER = 0x29,
  RAINBOW_GUN = 0x2B,
  FIRE_BULLETS = 0x2D,
}

export enum SecondaryProjectileTypeId {
  NONE = 0,
  ROCKET = 1,
  HOMING_ROCKET = 2,
  DETONATION = 3,
  ROCKET_MINIGUN = 4,
}

export class ProjectileCollisionProfile {
  readonly hitRadius: number;
  readonly initialDamagePool: number;

  constructor(opts: {
    hitRadius: number;
    initialDamagePool: number;
  }) {
    this.hitRadius = opts.hitRadius;
    this.initialDamagePool = opts.initialDamagePool;
  }
}

export class ProjectileHit {
  readonly typeId: ProjectileTemplateId;
  readonly origin: Vec2;
  readonly hit: Vec2;
  readonly target: Vec2;

  constructor(opts: {
    typeId: ProjectileTemplateId;
    origin: Vec2;
    hit: Vec2;
    target: Vec2;
  }) {
    this.typeId = opts.typeId;
    this.origin = opts.origin;
    this.hit = opts.hit;
    this.target = opts.target;
  }
}

export class Projectile {
  active: boolean;
  angle: number;
  pos: Vec2;
  origin: Vec2;
  vel: Vec2;
  typeId: ProjectileTemplateId;
  lifeTimer: number;
  reserved: number;
  speedScale: number;
  damagePool: number;
  hitRadius: number;
  travelBudget: number;
  owner: OwnerRef;
  hitsPlayers: boolean;

  constructor(opts: {
    active?: boolean;
    angle?: number;
    pos?: Vec2;
    origin?: Vec2;
    vel?: Vec2;
    typeId?: ProjectileTemplateId;
    lifeTimer?: number;
    reserved?: number;
    speedScale?: number;
    damagePool?: number;
    hitRadius?: number;
    travelBudget?: number;
    owner?: OwnerRef;
    hitsPlayers?: boolean;
  } = {}) {
    this.active = opts.active ?? false;
    this.angle = opts.angle ?? 0.0;
    this.pos = opts.pos ?? new Vec2();
    this.origin = opts.origin ?? new Vec2();
    this.vel = opts.vel ?? new Vec2();
    this.typeId = opts.typeId ?? ProjectileTemplateId.PISTOL;
    this.lifeTimer = opts.lifeTimer ?? 0.0;
    this.reserved = opts.reserved ?? 0.0;
    this.speedScale = opts.speedScale ?? 1.0;
    this.damagePool = opts.damagePool ?? 1.0;
    this.hitRadius = opts.hitRadius ?? 1.0;
    this.travelBudget = opts.travelBudget ?? 0.0;
    this.owner = opts.owner ?? OwnerRef.none();
    this.hitsPlayers = opts.hitsPlayers ?? false;
  }
}

export class SecondaryProjectile {
  active: boolean;
  angle: number;
  speed: number;
  pos: Vec2;
  vel: Vec2;
  detonationT: number;
  detonationScale: number;
  typeId: SecondaryProjectileTypeId;
  owner: OwnerRef;
  trailTimer: number;
  targetId: number;

  constructor(opts: {
    active?: boolean;
    angle?: number;
    speed?: number;
    pos?: Vec2;
    vel?: Vec2;
    detonationT?: number;
    detonationScale?: number;
    typeId?: SecondaryProjectileTypeId;
    owner?: OwnerRef;
    trailTimer?: number;
    targetId?: number;
  } = {}) {
    this.active = opts.active ?? false;
    this.angle = opts.angle ?? 0.0;
    this.speed = opts.speed ?? 0.0;
    this.pos = opts.pos ?? new Vec2();
    this.vel = opts.vel ?? new Vec2();
    this.detonationT = opts.detonationT ?? 0.0;
    this.detonationScale = opts.detonationScale ?? 1.0;
    this.typeId = opts.typeId ?? SecondaryProjectileTypeId.NONE;
    this.owner = opts.owner ?? OwnerRef.fromLocalPlayer(0);
    this.trailTimer = opts.trailTimer ?? 0.0;
    this.targetId = opts.targetId ?? -1;
  }
}
