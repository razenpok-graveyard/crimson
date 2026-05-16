// Port of crimson/projectiles/effects.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { EffectPool } from '@crimson/effects.ts';
import { EffectId } from '@crimson/effects-atlas.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';

export function spawnShrinkifierHitEffects(effects: EffectPool | null, opts: { pos: Vec2; rng: CrandLike; detailPreset: number }): void {
  // Port of `effect_spawn_shrinkifier_hit` (0x0042f080).

  const pos = opts.pos;
  const rng = opts.rng;
  const detailPreset = opts.detailPreset;
  if (effects === null) {
    return;
  }

  const detail = int(detailPreset);

  // Core pulse (effect_id=1).
  effects.spawn({
    effectId: int(EffectId.RING),
    pos: pos,
    vel: new Vec2(),
    rotation: 0.0,
    scale: 1.0,
    halfWidth: 36.0,
    halfHeight: 36.0,
    age: 0.0,
    lifetime: 0.3,
    flags: 0x19,
    color: new RGBA(0.3, 0.6, 0.9, 1.0),
    rotationStep: 0.0,
    scaleStep: -4.0,
    detailPreset: detail,
  });

  // Debris puffs (effect_id=0), detail-scaled count.
  const count = detail < 3 ? 2 : 4;
  for (let i = 0; i < count; i++) {
    const rotation = (rng.rand({ caller: RngCallerStatic.SHRINKIFIER_HIT_ROTATION }) & 0x7F) * 0.049087387;
    const velocity = new Vec2(((rng.rand({ caller: RngCallerStatic.SHRINKIFIER_HIT_VEL_X }) & 0x7F) - 0x40) * 1.4, ((rng.rand({ caller: RngCallerStatic.SHRINKIFIER_HIT_VEL_Y }) & 0x7F) - 0x40) * 1.4);
    const scaleStep = rng.rand({ caller: RngCallerStatic.SHRINKIFIER_HIT_SCALE_STEP }) % 100 * 0.01 + 0.1;
    effects.spawn({
      effectId: int(EffectId.BURST),
      pos: pos,
      vel: velocity,
      rotation: rotation,
      scale: 1.0,
      halfWidth: 32.0,
      halfHeight: 32.0,
      age: 0.0,
      lifetime: 0.3,
      flags: 0x1D,
      color: new RGBA(0.4, 0.5, 1.0, 0.5),
      rotationStep: 0.0,
      scaleStep: scaleStep,
      detailPreset: detail,
    });
  }
}

export function spawnIonHitEffects(effects: EffectPool | null, sfxQueue: SfxId[] | null, opts: { typeId: ProjectileTemplateId; pos: Vec2; rng: CrandLike; detailPreset: number }): void {
  const typeId = opts.typeId;
  const pos = opts.pos;
  const rng = opts.rng;
  const detailPreset = opts.detailPreset;
  if (effects === null) {
    return;
  }

  let ringScale = 0.0;
  let ringStrength = 0.0;
  let burstScale = 0.0;
  switch (typeId) {
    case ProjectileTemplateId.ION_MINIGUN:
      ringScale = 1.5;
      ringStrength = 0.1;
      burstScale = 0.8;
      break;
    case ProjectileTemplateId.ION_RIFLE:
      ringScale = 1.2;
      ringStrength = 0.4;
      burstScale = 1.2;
      break;
    case ProjectileTemplateId.ION_CANNON:
      ringScale = 1.0;
      ringStrength = 1.0;
      burstScale = 2.2;
      if (sfxQueue !== null) {
        sfxQueue.push(SfxId.SHOCKWAVE);
      }
      break;
    default:
      return;
  }
  const detail = int(detailPreset);

  // Port of `FUN_0042f270(pos, ring_scale, ring_strength)`: ring burst (effect_id=1).
  effects.spawn({
    effectId: int(EffectId.RING),
    pos: pos,
    vel: new Vec2(),
    rotation: 0.0,
    scale: 1.0,
    halfWidth: 4.0,
    halfHeight: 4.0,
    age: 0.0,
    lifetime: ringStrength * 0.8,
    flags: 0x19,
    color: new RGBA(0.6, 0.6, 0.9, 1.0),
    rotationStep: 0.0,
    scaleStep: ringScale * 45.0,
    detailPreset: detail,
  });

  // Port of `FUN_0042f540(pos, burst_scale)`: burst cloud (effect_id=0).
  const burst = burstScale * 0.8;
  const lifetime = Math.min(burst * 0.7, 1.1);
  const half = burst * 32.0;
  // Native loop count is `__ftol(scale * 5.0)` after the local `scale *= 0.8`.
  let count = int(burst * 5.0);
  if (detail < 3) {
    count = Math.floor(count / 2);
  }

  for (let i = 0; i < Math.max(0, count); i++) {
    const rotation = (rng.rand({ caller: RngCallerStatic.ION_HIT_SPARK_ROTATION }) & 0x7F) * 0.049087387;
    const velocity = new Vec2(((rng.rand({ caller: RngCallerStatic.ION_HIT_SPARK_VEL_X }) & 0x7F) - 0x40) * burst * 1.4, ((rng.rand({ caller: RngCallerStatic.ION_HIT_SPARK_VEL_Y }) & 0x7F) - 0x40) * burst * 1.4);
    const scaleStep = (rng.rand({ caller: RngCallerStatic.ION_HIT_SPARK_SCALE_STEP }) % 100 * 0.01 + 0.1) * burst;
    effects.spawn({
      effectId: int(EffectId.BURST),
      pos: pos,
      vel: velocity,
      rotation: rotation,
      scale: 1.0,
      halfWidth: half,
      halfHeight: half,
      age: 0.0,
      lifetime: lifetime,
      flags: 0x1D,
      color: new RGBA(0.4, 0.5, 1.0, 0.5),
      rotationStep: 0.0,
      scaleStep: scaleStep,
      detailPreset: detail,
    });
  }
}

export function spawnPlasmaCannonHitEffects(effects: EffectPool | null, sfxQueue: SfxId[] | null, opts: { pos: Vec2; detailPreset: number }): void {
  // Port of `projectile_update` Plasma Cannon hit extras.
  //
  // Native does:
  // - `sfx_play_panned(sfx_explosion_medium)`
  // - `sfx_play_panned(sfx_shockwave)`
  // - `FUN_0042f330(pos, 1.5, 1.0)`
  // - `FUN_0042f330(pos, 1.0, 1.0)`

  const pos = opts.pos;
  const detailPreset = opts.detailPreset;
  if (effects === null) {
    return;
  }

  if (sfxQueue !== null) {
    sfxQueue.push(SfxId.EXPLOSION_MEDIUM);
    sfxQueue.push(SfxId.SHOCKWAVE);
  }

  const detail = int(detailPreset);

  const _spawnRing = (opts: { scale: number }): void => {
    const scale = opts.scale;
    effects.spawn({
      effectId: int(EffectId.RING),
      pos: pos,
      vel: new Vec2(),
      rotation: 0.0,
      scale: 1.0,
      halfWidth: 4.0,
      halfHeight: 4.0,
      age: 0.1,
      lifetime: 1.0,
      flags: 0x19,
      color: new RGBA(0.9, 0.6, 0.3, 1.0),
      rotationStep: 0.0,
      scaleStep: scale * 45.0,
      detailPreset: detail,
    });
  };

  _spawnRing({ scale: 1.5 });
  _spawnRing({ scale: 1.0 });
}

export function spawnSplitterHitEffects(effects: EffectPool | null, opts: { pos: Vec2; rng: CrandLike; detailPreset: number }): void {
  // Port of `FUN_0042f3f0(pos, 26.0, 3)` from the Splitter Gun hit branch.

  const pos = opts.pos;
  const rng = opts.rng;
  const detailPreset = opts.detailPreset;
  if (effects === null) {
    return;
  }

  const detail = int(detailPreset);
  for (let i = 0; i < 3; i++) {
    const angle = (rng.rand({ caller: RngCallerStatic.SPLITTER_HIT_ANGLE }) & 0x1FF) * ((Math.PI * 2.0) / 512.0);
    const radius = rng.rand({ caller: RngCallerStatic.SPLITTER_HIT_RADIUS }) % 26;
    const jitterAge = -(rng.rand({ caller: RngCallerStatic.SPLITTER_HIT_AGE }) & 0xFF) * 0.0012;
    const lifetime = 0.1 - jitterAge;

    const offset = Vec2.fromAngle(angle).mul(radius);
    effects.spawn({
      effectId: int(EffectId.BURST),
      pos: pos.add(offset),
      vel: new Vec2(),
      rotation: 0.0,
      scale: 1.0,
      halfWidth: 4.0,
      halfHeight: 4.0,
      age: jitterAge,
      lifetime: lifetime,
      flags: 0x19,
      color: new RGBA(1.0, 0.9, 0.1, 1.0),
      rotationStep: 0.0,
      scaleStep: 55.0,
      detailPreset: detail,
    });
  }
}
