// Port of crimson/render/projectile_render_registry.py

import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';

export class PlasmaProjectileRenderConfig {
  readonly rgb: [number, number, number];
  readonly spacing: number;
  readonly segLimit: number;
  readonly tailSize: number;
  readonly headSize: number;
  readonly headAlphaMul: number;
  readonly auraRgb: [number, number, number];
  readonly auraSize: number;
  readonly auraAlphaMul: number;

  constructor(opts: {
    rgb: [number, number, number];
    spacing: number;
    segLimit: number;
    tailSize: number;
    headSize: number;
    headAlphaMul: number;
    auraRgb: [number, number, number];
    auraSize: number;
    auraAlphaMul: number;
  }) {
    this.rgb = opts.rgb;
    this.spacing = opts.spacing;
    this.segLimit = opts.segLimit;
    this.tailSize = opts.tailSize;
    this.headSize = opts.headSize;
    this.headAlphaMul = opts.headAlphaMul;
    this.auraRgb = opts.auraRgb;
    this.auraSize = opts.auraSize;
    this.auraAlphaMul = opts.auraAlphaMul;
  }
}

const _DEFAULT_PLASMA_RENDER_CONFIG = new PlasmaProjectileRenderConfig({
  rgb: [1.0, 1.0, 1.0],
  spacing: 2.1,
  segLimit: 3,
  tailSize: 12.0,
  headSize: 16.0,
  headAlphaMul: 0.45,
  auraRgb: [1.0, 1.0, 1.0],
  auraSize: 120.0,
  auraAlphaMul: 0.15,
});
export const PLASMA_PROJECTILE_RENDER_CONFIG_BY_TYPE_ID: Map<number, PlasmaProjectileRenderConfig> = new Map([
  [ProjectileTemplateId.PLASMA_RIFLE, new PlasmaProjectileRenderConfig({ rgb: [1.0, 1.0, 1.0], spacing: 2.5, segLimit: 8, tailSize: 22.0, headSize: 56.0, headAlphaMul: 0.45, auraRgb: [1.0, 1.0, 1.0], auraSize: 256.0, auraAlphaMul: 0.3 })],
  [ProjectileTemplateId.PLASMA_MINIGUN, _DEFAULT_PLASMA_RENDER_CONFIG],
  [ProjectileTemplateId.PLASMA_CANNON, new PlasmaProjectileRenderConfig({ rgb: [1.0, 1.0, 1.0], spacing: 2.6, segLimit: 18, tailSize: 44.0, headSize: 84.0, headAlphaMul: 0.45, auraRgb: [1.0, 1.0, 1.0], auraSize: 256.0, auraAlphaMul: 0.4 })],
  [ProjectileTemplateId.SPIDER_PLASMA, new PlasmaProjectileRenderConfig({ rgb: [0.3, 1.0, 0.3], spacing: _DEFAULT_PLASMA_RENDER_CONFIG.spacing, segLimit: _DEFAULT_PLASMA_RENDER_CONFIG.segLimit, tailSize: _DEFAULT_PLASMA_RENDER_CONFIG.tailSize, headSize: _DEFAULT_PLASMA_RENDER_CONFIG.headSize, headAlphaMul: _DEFAULT_PLASMA_RENDER_CONFIG.headAlphaMul, auraRgb: [0.3, 1.0, 0.3], auraSize: _DEFAULT_PLASMA_RENDER_CONFIG.auraSize, auraAlphaMul: _DEFAULT_PLASMA_RENDER_CONFIG.auraAlphaMul })],
  [ProjectileTemplateId.SHRINKIFIER, new PlasmaProjectileRenderConfig({ rgb: [0.3, 0.3, 1.0], spacing: _DEFAULT_PLASMA_RENDER_CONFIG.spacing, segLimit: _DEFAULT_PLASMA_RENDER_CONFIG.segLimit, tailSize: _DEFAULT_PLASMA_RENDER_CONFIG.tailSize, headSize: _DEFAULT_PLASMA_RENDER_CONFIG.headSize, headAlphaMul: _DEFAULT_PLASMA_RENDER_CONFIG.headAlphaMul, auraRgb: [0.3, 0.3, 1.0], auraSize: _DEFAULT_PLASMA_RENDER_CONFIG.auraSize, auraAlphaMul: _DEFAULT_PLASMA_RENDER_CONFIG.auraAlphaMul })],
]);

export function plasmaProjectileRenderConfig(typeId: number): PlasmaProjectileRenderConfig {
  return PLASMA_PROJECTILE_RENDER_CONFIG_BY_TYPE_ID.get(Math.trunc(typeId)) ?? _DEFAULT_PLASMA_RENDER_CONFIG;
}

export function beamEffectScale(typeId: number): number {
  return BEAM_EFFECT_SCALE_BY_TYPE_ID.get(Math.trunc(typeId)) ?? 0.8;
}

export function knownProjRgb(typeId: number): [number, number, number] {
  return KNOWN_PROJ_RGB_BY_TYPE_ID.get(Math.trunc(typeId)) ?? [240, 220, 160];
}

export const BEAM_EFFECT_SCALE_BY_TYPE_ID: Map<number, number> = new Map([
  [ProjectileTemplateId.ION_MINIGUN, 1.05],
  [ProjectileTemplateId.ION_RIFLE, 2.2],
  [ProjectileTemplateId.ION_CANNON, 3.5],
]);
export const KNOWN_PROJ_RGB_BY_TYPE_ID: Map<number, [number, number, number]> = new Map([
  [ProjectileTemplateId.ION_RIFLE, [120, 200, 255]],
  [ProjectileTemplateId.ION_MINIGUN, [120, 200, 255]],
  [ProjectileTemplateId.ION_CANNON, [120, 200, 255]],
  [ProjectileTemplateId.FIRE_BULLETS, [255, 170, 90]],
  [ProjectileTemplateId.SHRINKIFIER, [160, 255, 170]],
  [ProjectileTemplateId.BLADE_GUN, [240, 120, 255]],
]);
