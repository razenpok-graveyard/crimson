// Port of crimson/projectiles/runtime/primary_rules.py

import type { Projectile } from '@crimson/projectiles/types.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { lingerDefault, lingerGaussGun, lingerIonCannon, lingerIonMinigun, lingerIonRifle, postHitIonCommon, postHitIonRifle, postHitPlagueSpreader, postHitPlasmaCannon, postHitPulseGun, postHitShrinkifier, preHitSplitter } from '@crimson/projectiles/runtime/behaviors.ts';
import type { ProjectileHitInfo, ProjectileUpdateCtx } from '@crimson/projectiles/runtime/behaviors.ts';

type LingerHandler = (arg0: ProjectileUpdateCtx, arg1: Projectile) => void;
type PreHitHandler = (arg0: ProjectileUpdateCtx, arg1: Projectile, arg2: number) => void;
type PostHitHandler = (arg0: ProjectileUpdateCtx, arg1: ProjectileHitInfo) => void;

export class PrimaryProjectileRule {
  readonly linger: LingerHandler;
  readonly preHit: PreHitHandler;
  readonly postHit: PostHitHandler;
  readonly stopOnHit: boolean;
  readonly emitDefaultFreezeShard: boolean;
  readonly resetShockChainOnLinger: boolean;

  constructor(opts: {
    linger: LingerHandler;
    preHit?: PreHitHandler;
    postHit?: PostHitHandler;
    stopOnHit?: boolean;
    emitDefaultFreezeShard?: boolean;
    resetShockChainOnLinger?: boolean;
  }) {
    this.linger = opts.linger;
    this.preHit = opts.preHit ?? preHitNone;
    this.postHit = opts.postHit ?? postHitNone;
    this.stopOnHit = opts.stopOnHit ?? true;
    this.emitDefaultFreezeShard = opts.emitDefaultFreezeShard ?? true;
    this.resetShockChainOnLinger = opts.resetShockChainOnLinger ?? false;
  }
}

function preHitNone(ctx: ProjectileUpdateCtx, proj: Projectile, hitIdx: number): void {
  return;
}

function postHitNone(ctx: ProjectileUpdateCtx, hit: ProjectileHitInfo): void {
  return;
}

export function primaryRuleForTypeId(typeId: ProjectileTemplateId): PrimaryProjectileRule {
  return PRIMARY_PROJECTILE_RULE_BY_TYPE_ID.get(typeId) ?? _DEFAULT_RULE;
}

const _DEFAULT_RULE = new PrimaryProjectileRule({ linger: lingerDefault });
export const PRIMARY_PROJECTILE_RULE_BY_TYPE_ID: Map<ProjectileTemplateId, PrimaryProjectileRule> = new Map([
  [ProjectileTemplateId.GAUSS_GUN, new PrimaryProjectileRule({ linger: lingerGaussGun, stopOnHit: false, emitDefaultFreezeShard: false })],
  [ProjectileTemplateId.FIRE_BULLETS, new PrimaryProjectileRule({ linger: lingerDefault, stopOnHit: false, emitDefaultFreezeShard: false })],
  [ProjectileTemplateId.BLADE_GUN, new PrimaryProjectileRule({ linger: lingerDefault, stopOnHit: false })],
  [ProjectileTemplateId.PULSE_GUN, new PrimaryProjectileRule({ linger: lingerDefault, postHit: postHitPulseGun })],
  [ProjectileTemplateId.ION_RIFLE, new PrimaryProjectileRule({ linger: lingerIonRifle, postHit: postHitIonRifle, resetShockChainOnLinger: true })],
  [ProjectileTemplateId.ION_MINIGUN, new PrimaryProjectileRule({ linger: lingerIonMinigun, postHit: postHitIonCommon, resetShockChainOnLinger: true })],
  [ProjectileTemplateId.ION_CANNON, new PrimaryProjectileRule({ linger: lingerIonCannon, postHit: postHitIonCommon })],
  [ProjectileTemplateId.SHRINKIFIER, new PrimaryProjectileRule({ linger: lingerDefault, postHit: postHitShrinkifier })],
  [ProjectileTemplateId.PLASMA_CANNON, new PrimaryProjectileRule({ linger: lingerDefault, postHit: postHitPlasmaCannon })],
  [ProjectileTemplateId.SPLITTER_GUN, new PrimaryProjectileRule({ linger: lingerDefault, preHit: preHitSplitter })],
  [ProjectileTemplateId.PLAGUE_SPREADER, new PrimaryProjectileRule({ linger: lingerDefault, postHit: postHitPlagueSpreader })],
]);
