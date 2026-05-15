// Port of crimson/projectiles/runtime/secondary_rules.py

import { SecondaryProjectileTypeId } from '@crimson/projectiles/types.ts';

export type SecondaryProjectileRule = DetonationRule | RocketRule | HomingRocketRule | RocketMinigunRule;

export class DetonationRule {
  readonly tag = 'DetonationRule';
}

export class RocketRule {
  readonly tag = 'RocketRule';
  readonly baseSpeed: number;
  readonly accelFactorScale: number;
  readonly speedCap: number;
  readonly ttlDecayScale: number;
  readonly detonationScale: number;
  readonly damageSpeedMul: number;
  readonly damageBase: number;
  readonly extraDecals: number;
  readonly extraRadius: number;
  readonly burstScale: number | null;
  readonly burstMinDetail: number;
  readonly freezeShardTargetPos: boolean;

  constructor(opts: {
    baseSpeed?: number;
    accelFactorScale?: number;
    speedCap?: number;
    ttlDecayScale?: number;
    detonationScale?: number;
    damageSpeedMul?: number;
    damageBase?: number;
    extraDecals?: number;
    extraRadius?: number;
    burstScale?: number | null;
    burstMinDetail?: number;
    freezeShardTargetPos?: boolean;
  } = {}) {
    this.baseSpeed = opts.baseSpeed ?? 90.0;
    this.accelFactorScale = opts.accelFactorScale ?? 3.0;
    this.speedCap = opts.speedCap ?? 500.0;
    this.ttlDecayScale = opts.ttlDecayScale ?? 1.0;
    this.detonationScale = opts.detonationScale ?? 1.0;
    this.damageSpeedMul = opts.damageSpeedMul ?? 50.0;
    this.damageBase = opts.damageBase ?? 500.0;
    this.extraDecals = opts.extraDecals ?? 0x14;
    this.extraRadius = opts.extraRadius ?? 90.0;
    this.burstScale = opts.burstScale !== undefined ? opts.burstScale : 0.4;
    this.burstMinDetail = opts.burstMinDetail ?? 2;
    this.freezeShardTargetPos = opts.freezeShardTargetPos ?? false;
  }
}

export class HomingRocketRule {
  readonly tag = 'HomingRocketRule';
  readonly baseSpeed: number;
  readonly targetAccel: number;
  readonly maxVelocity: number;
  readonly ttlDecayScale: number;
  readonly detonationScale: number;
  readonly damageSpeedMul: number;
  readonly damageBase: number;
  readonly extraDecals: number;
  readonly extraRadius: number;
  readonly freezeShardTargetPos: boolean;

  constructor(opts: {
    baseSpeed?: number;
    targetAccel?: number;
    maxVelocity?: number;
    ttlDecayScale?: number;
    detonationScale?: number;
    damageSpeedMul?: number;
    damageBase?: number;
    extraDecals?: number;
    extraRadius?: number;
    freezeShardTargetPos?: boolean;
  } = {}) {
    this.baseSpeed = opts.baseSpeed ?? 190.0;
    this.targetAccel = opts.targetAccel ?? 800.0;
    this.maxVelocity = opts.maxVelocity ?? 350.0;
    this.ttlDecayScale = opts.ttlDecayScale ?? 0.5;
    this.detonationScale = opts.detonationScale ?? 0.35;
    this.damageSpeedMul = opts.damageSpeedMul ?? 20.0;
    this.damageBase = opts.damageBase ?? 80.0;
    this.extraDecals = opts.extraDecals ?? 10;
    this.extraRadius = opts.extraRadius ?? 64.0;
    this.freezeShardTargetPos = opts.freezeShardTargetPos ?? false;
  }
}

export class RocketMinigunRule {
  readonly tag = 'RocketMinigunRule';
  readonly baseSpeed: number;
  readonly accelFactorScale: number;
  readonly speedCap: number;
  readonly ttlDecayScale: number;
  readonly detonationScale: number;
  readonly damageSpeedMul: number;
  readonly damageBase: number;
  readonly extraDecals: number;
  readonly extraRadius: number;
  readonly freezeShardTargetPos: boolean;

  constructor(opts: {
    baseSpeed?: number;
    accelFactorScale?: number;
    speedCap?: number;
    ttlDecayScale?: number;
    detonationScale?: number;
    damageSpeedMul?: number;
    damageBase?: number;
    extraDecals?: number;
    extraRadius?: number;
    freezeShardTargetPos?: boolean;
  } = {}) {
    this.baseSpeed = opts.baseSpeed ?? 90.0;
    this.accelFactorScale = opts.accelFactorScale ?? 4.0;
    this.speedCap = opts.speedCap ?? 600.0;
    this.ttlDecayScale = opts.ttlDecayScale ?? 1.0;
    this.detonationScale = opts.detonationScale ?? 0.25;
    this.damageSpeedMul = opts.damageSpeedMul ?? 20.0;
    this.damageBase = opts.damageBase ?? 40.0;
    this.extraDecals = opts.extraDecals ?? 3;
    this.extraRadius = opts.extraRadius ?? 44.0;
    this.freezeShardTargetPos = opts.freezeShardTargetPos ?? true;
  }
}

export const SECONDARY_RULE_BY_TYPE_ID: Map<SecondaryProjectileTypeId, SecondaryProjectileRule> = new Map([
  [SecondaryProjectileTypeId.DETONATION, new DetonationRule()],
  [SecondaryProjectileTypeId.ROCKET, new RocketRule()],
  [SecondaryProjectileTypeId.HOMING_ROCKET, new HomingRocketRule()],
  [SecondaryProjectileTypeId.ROCKET_MINIGUN, new RocketMinigunRule()],
]);
const _DEFAULT_ROCKET_RULE = new RocketRule({
  detonationScale: 0.5,
  damageSpeedMul: 0.0,
  damageBase: 150.0,
  extraDecals: 0,
  extraRadius: 0.0,
  burstScale: null,
});

export function secondaryRuleForTypeId(typeId: SecondaryProjectileTypeId): SecondaryProjectileRule {
  return SECONDARY_RULE_BY_TYPE_ID.get(typeId) ?? _DEFAULT_ROCKET_RULE;
}
