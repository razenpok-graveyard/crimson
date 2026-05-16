// Port of crimson/weapon_runtime/fire_recipes.py

import { ParticleStyleId } from '@crimson/effects.ts';
import { ProjectileTemplateId, SecondaryProjectileTypeId } from '@crimson/projectiles/types.ts';
import { WeaponId, projectileTypeIdForWeaponId } from '@crimson/weapons.ts';

export type PelletJitterRule = NoJitter | ModuloCenteredJitter | MaskCenteredJitter;
export type SpeedScaleRule = NoSpeedScale | ModuloSpeedScale;
export type SecondaryTargetingPolicy = NoTargetHint | UseAimTargetHint;
export type FireMode = PrimaryPelletsMode | SecondaryShotMode | ParticleStreamMode | MultiPlasmaFanMode | SwarmerDumpMode;

export class NoJitter {
  readonly tag = 'NoJitter';
}

export class ModuloCenteredJitter {
  readonly tag = 'ModuloCenteredJitter';
  readonly modulo: number;
  readonly center: number;
  readonly step: number;

  constructor(opts: {
    modulo: number;
    center: number;
    step: number;
  }) {
    this.modulo = opts.modulo;
    this.center = opts.center;
    this.step = opts.step;
  }
}

export class MaskCenteredJitter {
  readonly tag = 'MaskCenteredJitter';
  readonly mask: number;
  readonly center: number;
  readonly step: number;

  constructor(opts: {
    mask: number;
    center: number;
    step: number;
  }) {
    this.mask = opts.mask;
    this.center = opts.center;
    this.step = opts.step;
  }
}

export class NoSpeedScale {
  readonly tag = 'NoSpeedScale';
}

export class ModuloSpeedScale {
  readonly tag = 'ModuloSpeedScale';
  readonly base: number;
  readonly modulo: number;
  readonly step: number;

  constructor(opts: {
    base: number;
    modulo: number;
    step: number;
  }) {
    this.base = opts.base;
    this.modulo = opts.modulo;
    this.step = opts.step;
  }
}

export class NoTargetHint {
  readonly tag = 'NoTargetHint';
}

export class UseAimTargetHint {
  readonly tag = 'UseAimTargetHint';
}

export class PrimaryPelletsMode {
  readonly tag = 'PrimaryPelletsMode';
  readonly typeId: ProjectileTemplateId | null;
  readonly count: number | null;
  readonly jitter: PelletJitterRule;
  readonly speedScale: SpeedScaleRule;

  constructor(opts: {
    typeId?: ProjectileTemplateId | null;
    count?: number | null;
    jitter?: PelletJitterRule;
    speedScale?: SpeedScaleRule;
  } = {}) {
    this.typeId = opts.typeId ?? null;
    this.count = opts.count ?? null;
    this.jitter = opts.jitter ?? new NoJitter();
    this.speedScale = opts.speedScale ?? new NoSpeedScale();
  }
}

export class SecondaryShotMode {
  readonly tag = 'SecondaryShotMode';
  readonly typeId: SecondaryProjectileTypeId;
  readonly targeting: SecondaryTargetingPolicy;

  constructor(opts: {
    typeId: SecondaryProjectileTypeId;
    targeting?: SecondaryTargetingPolicy;
  }) {
    this.typeId = opts.typeId;
    this.targeting = opts.targeting ?? new NoTargetHint();
  }
}

export class ParticleStreamMode {
  readonly tag = 'ParticleStreamMode';
  readonly style: ParticleStyleId | null;
  readonly slow: boolean;

  constructor(opts: {
    style?: ParticleStyleId | null;
    slow?: boolean;
  } = {}) {
    this.style = opts.style ?? null;
    this.slow = opts.slow ?? false;
  }
}

export class MultiPlasmaFanMode {
  readonly tag = 'MultiPlasmaFanMode';
}

export class SwarmerDumpMode {
  readonly tag = 'SwarmerDumpMode';
}

export class FireRecipe {
  readonly mode: FireMode;
  readonly ammoCost: number;

  constructor(opts: {
    mode: FireMode;
    ammoCost?: number;
  }) {
    this.mode = opts.mode;
    this.ammoCost = opts.ammoCost ?? 1.0;
  }
}

export function pelletJitterStepForWeapon(weaponId: WeaponId): number {
  if (weaponId === WeaponId.SHOTGUN) {
    return 0.0013;
  }
  if (weaponId === WeaponId.SAWED_OFF_SHOTGUN) {
    return 0.004;
  }
  if (weaponId === WeaponId.JACKHAMMER) {
    return 0.0013;
  }
  return 0.0015;
}

export function resolveFireRecipe(weaponId: WeaponId, opts: { pelletCount: number; fireBulletsActive: boolean }): FireRecipe {
  const pelletCount = opts.pelletCount;
  const fireBulletsActive = opts.fireBulletsActive;
  if (fireBulletsActive) {
    return new FireRecipe({ mode: new PrimaryPelletsMode({ typeId: ProjectileTemplateId.FIRE_BULLETS, count: Math.max(0, int(pelletCount)), jitter: _DEFAULT_SPREAD_JITTER, speedScale: new NoSpeedScale() }) });
  }

  const recipe = FIRE_RECIPE_BY_WEAPON.get(weaponId) ?? null;
  if (recipe !== null) {
    return recipe;
  }

  const pellets = Math.max(1, int(pelletCount));
  let jitter: PelletJitterRule = new NoJitter();
  if (pellets > 1) {
    jitter = new ModuloCenteredJitter({ modulo: 200, center: 100, step: pelletJitterStepForWeapon(weaponId) });
  }

  let speedScale: SpeedScaleRule = new NoSpeedScale();
  if (pellets > 1 && (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(_SHOTGUN_SPEED_RANDOMIZE_WEAPONS, weaponId))) {
    speedScale = _DEFAULT_SPEED_SCALE;
  }

  return new FireRecipe({ mode: new PrimaryPelletsMode({ typeId: projectileTypeIdForWeaponId(weaponId), count: pellets, jitter: jitter, speedScale: speedScale }) });
}

const _SHOTGUN_SPEED_RANDOMIZE_WEAPONS: ReadonlySet<WeaponId> = new Set([
  WeaponId.SHOTGUN,
  WeaponId.SAWED_OFF_SHOTGUN,
  WeaponId.JACKHAMMER,
]);
const _DEFAULT_SPREAD_JITTER = new ModuloCenteredJitter({ modulo: 200, center: 100, step: 0.0015 });
const _DEFAULT_SPEED_SCALE = new ModuloSpeedScale({ base: 1.0, modulo: 100, step: 0.01 });
const _GAUSS_ION_SPEED_SCALE = new ModuloSpeedScale({ base: 1.4, modulo: 0x50, step: 0.01 });
export const FIRE_RECIPE_BY_WEAPON: Map<WeaponId, FireRecipe> = new Map([
  [WeaponId.ROCKET_LAUNCHER, new FireRecipe({ mode: new SecondaryShotMode({ typeId: SecondaryProjectileTypeId.ROCKET }) })],
  [WeaponId.SEEKER_ROCKETS, new FireRecipe({ mode: new SecondaryShotMode({ typeId: SecondaryProjectileTypeId.HOMING_ROCKET, targeting: new UseAimTargetHint() }) })],
  [WeaponId.ROCKET_MINIGUN, new FireRecipe({ mode: new SecondaryShotMode({ typeId: SecondaryProjectileTypeId.ROCKET_MINIGUN }) })],
  [WeaponId.FLAMETHROWER, new FireRecipe({ mode: new ParticleStreamMode({ style: null, slow: false }), ammoCost: 0.1 })],
  [WeaponId.BLOW_TORCH, new FireRecipe({ mode: new ParticleStreamMode({ style: ParticleStyleId.BLOW_TORCH, slow: false }), ammoCost: 0.05 })],
  [WeaponId.HR_FLAMER, new FireRecipe({ mode: new ParticleStreamMode({ style: ParticleStyleId.HR_FLAMER, slow: false }), ammoCost: 0.1 })],
  [WeaponId.BUBBLEGUN, new FireRecipe({ mode: new ParticleStreamMode({ style: null, slow: true }), ammoCost: 0.15 })],
  [WeaponId.MULTI_PLASMA, new FireRecipe({ mode: new MultiPlasmaFanMode() })],
  [WeaponId.MINI_ROCKET_SWARMERS, new FireRecipe({ mode: new SwarmerDumpMode() })],
  [WeaponId.PLASMA_SHOTGUN, new FireRecipe({ mode: new PrimaryPelletsMode({ typeId: ProjectileTemplateId.PLASMA_MINIGUN, count: 14, jitter: new MaskCenteredJitter({ mask: 0xFF, center: 0x80, step: 0.002 }), speedScale: _DEFAULT_SPEED_SCALE }) })],
  [WeaponId.GAUSS_SHOTGUN, new FireRecipe({ mode: new PrimaryPelletsMode({ typeId: ProjectileTemplateId.GAUSS_GUN, count: 6, jitter: new ModuloCenteredJitter({ modulo: 200, center: 100, step: 0.002 }), speedScale: _GAUSS_ION_SPEED_SCALE }) })],
  [WeaponId.ION_SHOTGUN, new FireRecipe({ mode: new PrimaryPelletsMode({ typeId: ProjectileTemplateId.ION_MINIGUN, count: 8, jitter: new ModuloCenteredJitter({ modulo: 200, center: 100, step: 0.0026 }), speedScale: _GAUSS_ION_SPEED_SCALE }) })],
]);
