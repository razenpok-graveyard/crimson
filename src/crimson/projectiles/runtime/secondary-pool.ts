// Port of crimson/projectiles/runtime/secondary_pool.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { Crand } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { CreatureDamageType } from '@crimson/creatures/damage-types.ts';
import { creatureLifecycleIsAlive, creatureLifecycleIsCollidable } from '@crimson/creatures/lifecycle.ts';
import type { EffectPool, FxQueue, SpriteEffectPool } from '@crimson/effects.ts';
import { EffectId } from '@crimson/effects-atlas.ts';
import { f32 } from '@crimson/math-parity.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { SECONDARY_PROJECTILE_POOL_SIZE, SecondaryProjectileTypeId, SecondaryProjectile } from '@crimson/projectiles/types.ts';
import type { CreatureDamageApplier, SecondaryDetonationKillHandler } from '@crimson/projectiles/types.ts';
import { withinNativeFindRadius, creatureFindNearestForSecondary, applyDamageToCreature } from './collision.ts';
import { secondaryRuleForTypeId } from './secondary-rules.ts';
import { CreatureSpatialHash } from './spatial-hash.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import type { GameplayState } from '@crimson/gameplay.ts';

const _SECONDARY_PRE_HIT_DECAL_CALLERS: readonly [number, number][] = [
  [
    RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_PRE_HIT_DECAL_DX_1,
    RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_PRE_HIT_DECAL_DY_1,
  ],
  [
    RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_PRE_HIT_DECAL_DX_2,
    RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_PRE_HIT_DECAL_DY_2,
  ],
  [
    RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_PRE_HIT_DECAL_DX_3,
    RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_PRE_HIT_DECAL_DY_3,
  ],
];


export class SecondarySpawnSpec {
  readonly pos: Vec2;
  readonly angle: number;
  readonly typeId: SecondaryProjectileTypeId;
  readonly owner: OwnerRef;
  readonly timeToLive: number;
  readonly targetHint: Vec2 | null;
  readonly creatures: readonly CreatureState[] | null;
  readonly preserveBugs: boolean;

  constructor(opts: {
    pos: Vec2;
    angle: number;
    typeId: SecondaryProjectileTypeId;
    owner?: OwnerRef;
    timeToLive?: number;
    targetHint?: Vec2 | null;
    creatures?: readonly CreatureState[] | null;
    preserveBugs?: boolean;
  }) {
    this.pos = opts.pos;
    this.angle = opts.angle;
    this.typeId = opts.typeId;
    this.owner = opts.owner ?? OwnerRef.fromLocalPlayer(0);
    this.timeToLive = opts.timeToLive ?? 2.0;
    this.targetHint = opts.targetHint ?? null;
    this.creatures = opts.creatures ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
  }
}

export class SecondaryStepCtx {
  readonly dt: number;
  readonly creatures: readonly CreatureState[];
  readonly runtimeState: GameplayState | null;
  readonly fxQueue: FxQueue | null;
  readonly detailPreset: number;
  readonly onDetonationKill: SecondaryDetonationKillHandler | null;

  constructor(opts: {
    dt: number;
    creatures: readonly CreatureState[];
    runtimeState?: GameplayState | null;
    fxQueue?: FxQueue | null;
    detailPreset?: number;
    onDetonationKill?: SecondaryDetonationKillHandler | null;
  }) {
    this.dt = opts.dt;
    this.creatures = opts.creatures;
    this.runtimeState = opts.runtimeState ?? null;
    this.fxQueue = opts.fxQueue ?? null;
    this.detailPreset = opts.detailPreset ?? 5;
    this.onDetonationKill = opts.onDetonationKill ?? null;
  }
}


export class SecondaryProjectilePool {
  private _entries: SecondaryProjectile[];
  private _creatureDamageApplier: CreatureDamageApplier | null;

  constructor(opts: { size?: number } = {}) {
    const size = opts.size ?? SECONDARY_PROJECTILE_POOL_SIZE;
    this._entries = Array.from({ length: size }, () => new SecondaryProjectile());
    this._creatureDamageApplier = null;
  }

  get entries(): SecondaryProjectile[] {
    return this._entries;
  }

  get creatureDamageApplier(): CreatureDamageApplier | null {
    return this._creatureDamageApplier;
  }

  set creatureDamageApplier(value: CreatureDamageApplier | null) {
    this._creatureDamageApplier = value;
  }

  reset(): void {
    for (const entry of this._entries) {
      entry.active = false;
    }
  }

  spawnFromSpec(spec: SecondarySpawnSpec): number {
    const pos = spec.pos;
    const angle = spec.angle;
    const typeId = spec.typeId;
    const owner = spec.owner ?? OwnerRef.fromLocalPlayer(0);
    const timeToLive = spec.timeToLive ?? 2.0;
    const targetHint = spec.targetHint ?? null;
    const creatures = spec.creatures ?? null;
    const preserveBugs = spec.preserveBugs ?? false;

    let index: number | null = null;
    for (let i = 0; i < this._entries.length; i++) {
      if (!this._entries[i].active) {
        index = i;
        break;
      }
    }
    if (index === null) {
      index = this._entries.length - 1;
    }

    const entry = this._entries[index];
    entry.active = true;
    entry.angle = angle;
    entry.typeId = typeId;
    entry.pos = pos;
    entry.owner = owner;
    entry.targetId = -1;
    entry.trailTimer = 0.0;
    entry.vel = new Vec2();
    entry.detonationT = 0.0;
    entry.detonationScale = 1.0;

    const rule = secondaryRuleForTypeId(typeId);
    if (rule.tag === 'DetonationRule') {
      // Detonation uses explicit timer/scale fields now.
      entry.detonationT = 0.0;
      entry.detonationScale = timeToLive;
      entry.speed = f32(timeToLive);
      return index;
    }

    if (rule.tag === 'RocketRule' || rule.tag === 'HomingRocketRule' || rule.tag === 'RocketMinigunRule') {
      entry.vel = Vec2.fromHeading(angle).mul(rule.baseSpeed);
      entry.speed = f32(timeToLive);
    }

    if (rule.tag === 'HomingRocketRule') {
      // Native `fx_spawn_secondary_projectile` seeds seeker target_id at spawn via
      // `creature_find_nearest(&player_aim_x, -1, 0.0)`.
      if (creatures !== null) {
        const origin = targetHint !== null ? targetHint : pos;
        entry.targetId = creatureFindNearestForSecondary({
          creatures,
          origin,
          preserveBugs,
        });
      }
    }

    return index;
  }

  iterActive(): SecondaryProjectile[] {
    return this._entries.filter((entry) => entry.active);
  }

  step(ctx: SecondaryStepCtx): void {
    // Update the secondary projectile pool subset (types 1/2/4 + detonation type 3).
    const dt = ctx.dt;
    const creatures = ctx.creatures;
    const runtimeState = ctx.runtimeState ?? null;
    const fxQueue = ctx.fxQueue ?? null;
    const detailPreset = int(ctx.detailPreset ?? 5);
    const onDetonationKill = ctx.onDetonationKill ?? null;

    if (dt <= 0.0) return;

    const _applySecondaryDamage = (
      creatureIndex: number,
      damage: number,
      opts: {
        owner: OwnerRef;
        impulse?: Vec2;
      },
    ): void => {
      applyDamageToCreature(
        creatures,
        int(creatureIndex),
        damage,
        {
          damageType: CreatureDamageType.EXPLOSION,
          impulse: opts.impulse ?? new Vec2(),
          owner: opts.owner,
          applyCreatureDamage: this._creatureDamageApplier,
        },
      );
    };

    let rng: CrandLike = new Crand(0);
    let freezeActive = false;
    let effects: EffectPool | null = null;
    let spriteEffects: SpriteEffectPool | null = null;
    let sfxQueue: SfxId[] | null = null;
    if (runtimeState !== null) {
      rng = runtimeState.rng;
      freezeActive = runtimeState.bonuses.freeze > 0.0;
      effects = runtimeState.effects ?? null;
      spriteEffects = runtimeState.spriteEffects ?? null;
      sfxQueue = runtimeState.sfxQueue;
    }

    const _creatureIsCollidable = (creature: CreatureState): boolean => {
      if (!creature.active) return false;
      return creatureLifecycleIsCollidable(creature.lifecycleStage);
    };

    const creatureSpatial = new CreatureSpatialHash({ creatures, isCollidable: _creatureIsCollidable });

    for (const entry of this._entries) {
      if (!entry.active) continue;

      const rule = secondaryRuleForTypeId(entry.typeId);

      if (rule.tag === 'DetonationRule') {
        if (runtimeState !== null) {
          runtimeState.cameraShakePulses = 4;
        }

        entry.detonationT += dt * 3.0;
        const t = entry.detonationT;
        const scale = entry.detonationScale;
        if (t > 1.0) {
          if (fxQueue !== null) {
            fxQueue.add({
              effectId: EffectId.AURA,
              pos: entry.pos,
              width: scale * 256.0,
              height: scale * 256.0,
              rotation: 0.0,
              rgba: new RGBA(0.0, 0.0, 0.0, 0.25),
            });
          }
          entry.active = false;
        }

        const radius = scale * t * 80.0;
        const radiusSq = radius * radius;
        const damage = dt * scale * 700.0;
        for (const creatureIdx of creatureSpatial.candidateIndices({ pos: entry.pos, radius })) {
          const creature = creatures[int(creatureIdx)];
          if (!_creatureIsCollidable(creature)) continue;
          if (creature.hp <= 0.0) continue;
          const dSq = Vec2.distanceSq(entry.pos, creature.pos);
          if (dSq < radiusSq) {
            const hpBefore = creature.hp;
            const impulseDir = entry.pos.directionTo(creature.pos);
            const impulse = impulseDir.mul(0.1);
            _applySecondaryDamage(
              creatureIdx,
              damage,
              { owner: entry.owner, impulse },
            );
            creatureSpatial.syncIndex(int(creatureIdx));
            if (onDetonationKill !== null && hpBefore > 0.0 && creature.hp <= 0.0) {
              // Native detonation AoE does an extra two random decals and a
              // second `creature_handle_death` call after the killing hit.
              if (fxQueue !== null) {
                fxQueue.addRandom({ pos: creature.pos, rng });
                fxQueue.addRandom({ pos: creature.pos, rng });
              }
              onDetonationKill(int(creatureIdx));
            }
          }
        }
        continue;
      }

      if (rule.tag !== 'RocketRule' && rule.tag !== 'HomingRocketRule' && rule.tag !== 'RocketMinigunRule') {
        continue;
      }

      // Move.
      entry.pos = entry.pos.add(entry.vel.mul(dt));

      // Update velocity + countdown.
      const speedMag = entry.vel.length();
      if (rule.tag === 'RocketRule') {
        if (speedMag < rule.speedCap) {
          const factor = 1.0 + dt * rule.accelFactorScale;
          entry.vel = entry.vel.mul(factor);
        }
        entry.speed = f32(entry.speed - dt * rule.ttlDecayScale);
      } else if (rule.tag === 'RocketMinigunRule') {
        if (speedMag < rule.speedCap) {
          const factor = 1.0 + dt * rule.accelFactorScale;
          entry.vel = entry.vel.mul(factor);
        }
        entry.speed = f32(entry.speed - dt * rule.ttlDecayScale);
      } else if (rule.tag === 'HomingRocketRule') {
        // Type 2: homing projectile.
        let targetId = entry.targetId;
        if (!(targetId >= 0 && targetId < creatures.length) || !creatures[targetId].active) {
          entry.targetId = creatureFindNearestForSecondary({
            creatures,
            origin: entry.pos,
            preserveBugs: runtimeState !== null ? runtimeState.preserveBugs : false,
          });
          targetId = entry.targetId;
        }

        if (targetId >= 0 && targetId < creatures.length) {
          const target = creatures[targetId];
          const toTarget = target.pos.sub(entry.pos);
          const [targetDir, dist] = toTarget.normalizedWithLength();
          if (dist > 1e-6) {
            entry.angle = toTarget.toHeading();
            const accel = targetDir.mul(dt * rule.targetAccel);
            const nextVelocity = entry.vel.add(accel);
            if (nextVelocity.length() <= rule.maxVelocity) {
              entry.vel = nextVelocity;
            }
          }
        }

        entry.speed = f32(entry.speed - dt * rule.ttlDecayScale);
      }

      // Rocket smoke trail (`trail_timer` in crimsonland.exe).
      const trailDecay = f32((Math.abs(entry.vel.x) + Math.abs(entry.vel.y)) * dt * 0.01);
      entry.trailTimer = f32(entry.trailTimer - trailDecay);
      if (entry.trailTimer < 0.0) {
        const direction = Vec2.fromHeading(entry.angle);
        const spawnPos = entry.pos.sub(direction.mul(9.0));
        const trailVelocity = Vec2.fromHeading(entry.angle + Math.PI).mul(90.0);
        if (spriteEffects !== null) {
          spriteEffects.spawn({
            pos: spawnPos,
            vel: trailVelocity,
            scale: 14.0,
            color: new RGBA(1.0, 1.0, 1.0, 0.25),
          });
        }
        entry.trailTimer = f32(0.06);
      }

      // projectile_update uses creature_find_in_radius(..., 8.0, ...)
      let hitIdx: number | null = null;
      for (const idx of creatureSpatial.candidateIndices({ pos: entry.pos, radius: 8.0 })) {
        const creature = creatures[int(idx)];
        if (!_creatureIsCollidable(creature)) continue;
        if (withinNativeFindRadius({
          origin: entry.pos,
          target: creature.pos,
          radius: 8.0,
          targetSize: creature.size,
        })) {
          hitIdx = idx;
          break;
        }
      }
      if (hitIdx !== null) {
        if (runtimeState !== null) {
          const ownerPlayerIndex = entry.owner.playerIndexInBounds(
            runtimeState.shotsHit.length,
          );
          if (ownerPlayerIndex !== null && creatureLifecycleIsAlive(
            creatures[int(hitIdx)].lifecycleStage,
          )) {
            const shotsHit: number[] = runtimeState.shotsHit;
            shotsHit[ownerPlayerIndex] += 1;
          }
        }

        if (sfxQueue !== null) {
          sfxQueue.push(SfxId.EXPLOSION_MEDIUM);
        }

        let detScale = 0.5;
        let damageSpeedMul = 0.0;
        let damageBase = 150.0;
        let burstScale: number | null = null;
        let burstMinDetail = 0;
        let extraDecals = 0;
        let extraRadius = 0.0;
        let freezeShardTargetPos = false;
        if (rule.tag === 'RocketRule') {
          detScale = rule.detonationScale;
          damageSpeedMul = rule.damageSpeedMul;
          damageBase = rule.damageBase;
          burstScale = rule.burstScale;
          burstMinDetail = rule.burstMinDetail;
          extraDecals = rule.extraDecals;
          extraRadius = rule.extraRadius;
          freezeShardTargetPos = rule.freezeShardTargetPos;
        } else if (rule.tag === 'HomingRocketRule') {
          detScale = rule.detonationScale;
          damageSpeedMul = rule.damageSpeedMul;
          damageBase = rule.damageBase;
          extraDecals = rule.extraDecals;
          extraRadius = rule.extraRadius;
          freezeShardTargetPos = rule.freezeShardTargetPos;
        } else if (rule.tag === 'RocketMinigunRule') {
          detScale = rule.detonationScale;
          damageSpeedMul = rule.damageSpeedMul;
          damageBase = rule.damageBase;
          extraDecals = rule.extraDecals;
          extraRadius = rule.extraRadius;
          freezeShardTargetPos = rule.freezeShardTargetPos;
        }

        if (freezeActive) {
          if (effects !== null) {
            for (let i = 0; i < 4; i++) {
              const shardAngle = (rng.rand({ caller: RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_PRE_HIT_FREEZE_SHARD_ANGLE }) % 612) * 0.01;
              effects.spawnFreezeShard({
                pos: entry.pos,
                angle: shardAngle,
                rng,
                detailPreset: int(detailPreset),
              });
            }
          }
        } else if (fxQueue !== null) {
          for (const [dxCaller, dyCaller] of _SECONDARY_PRE_HIT_DECAL_CALLERS) {
            const offset = new Vec2(
              (rng.rand({ caller: dxCaller }) % 20 - 10),
              (rng.rand({ caller: dyCaller }) % 20 - 10),
            );
            fxQueue.addRandom({
              pos: creatures[hitIdx].pos.add(offset),
              rng,
            });
          }
        }

        if (burstScale !== null && effects !== null && int(detailPreset) > int(burstMinDetail)) {
          effects.spawnExplosionBurst({
            pos: entry.pos,
            scale: burstScale,
            rng,
            detailPreset: int(detailPreset),
          });
        }

        // Native `projectile_update` applies hit visuals before
        // `creature_apply_damage` for secondary projectiles.
        const damage = entry.speed * damageSpeedMul + damageBase;
        _applySecondaryDamage(
          hitIdx,
          damage,
          { owner: entry.owner, impulse: entry.vel.div(dt) },
        );
        creatureSpatial.syncIndex(int(hitIdx));

        entry.typeId = SecondaryProjectileTypeId.DETONATION;
        entry.vel = new Vec2();
        entry.detonationT = 0.0;
        entry.detonationScale = detScale;
        entry.trailTimer = 0.0;

        // Extra debris/scorch decals (or freeze shards) on detonation.
        if (freezeActive) {
          if (effects !== null) {
            let shardPos = entry.pos;
            let freezeAngleCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_ROCKET_FREEZE_SHARD_ANGLE;
            if (rule.tag === 'HomingRocketRule') {
              freezeAngleCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_SEEKER_ROCKET_FREEZE_SHARD_ANGLE;
            } else if (rule.tag === 'RocketMinigunRule') {
              freezeAngleCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_ROCKET_MINIGUN_FREEZE_SHARD_ANGLE;
            }
            if (freezeShardTargetPos) {
              shardPos = creatures[hitIdx].pos;
            }
            for (let i = 0; i < 8; i++) {
              const shardAngle = (rng.rand({ caller: freezeAngleCaller }) % 612) * 0.01;
              effects.spawnFreezeShard({
                pos: shardPos,
                angle: shardAngle,
                rng,
                detailPreset: int(detailPreset),
              });
            }
          }
        } else {
          if (fxQueue !== null && extraDecals > 0) {
            const center = creatures[hitIdx].pos;
            let angleCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_ROCKET_DECAL_ANGLE;
            let radiusCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_ROCKET_DECAL_RADIUS;
            if (rule.tag === 'HomingRocketRule') {
              angleCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_SEEKER_ROCKET_DECAL_ANGLE;
              radiusCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_SEEKER_ROCKET_DECAL_RADIUS;
            } else if (rule.tag === 'RocketMinigunRule') {
              angleCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_ROCKET_MINIGUN_DECAL_ANGLE;
              radiusCaller = RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_ROCKET_MINIGUN_DECAL_RADIUS;
            }
            for (let i = 0; i < int(extraDecals); i++) {
              const angle = (rng.rand({ caller: angleCaller }) % 628) * 0.01;
              let radius: number;
              if (rule.tag === 'HomingRocketRule') {
                radius = rng.rand({ caller: radiusCaller }) & 0x3F;
              } else {
                radius = rng.rand({ caller: radiusCaller }) % Math.max(1, int(extraRadius));
              }
              fxQueue.addRandom({
                pos: center.add(Vec2.fromAngle(angle).mul(radius)),
                rng,
              });
            }
          }
        }

        if (spriteEffects !== null) {
          const step = Math.PI * 2.0 / 10.0;
          for (let idx = 0; idx < 10; idx++) {
            const mag = (rng.rand({ caller: RngCallerStatic.SECONDARY_PROJECTILE_UPDATE_DETONATION_SPRITE_MAG }) % 800) * 0.1;
            const ang = idx * step;
            const velocity = Vec2.fromAngle(ang).mul(mag);
            spriteEffects.spawn({
              pos: entry.pos,
              vel: velocity,
              scale: 14.0,
              color: new RGBA(1.0, 1.0, 1.0, 0.37),
            });
          }
        }

        continue;
      }

      if (entry.speed < 0.0) {
        entry.typeId = SecondaryProjectileTypeId.DETONATION;
        entry.vel = new Vec2();
        entry.detonationT = 0.0;
        entry.detonationScale = 0.5;
        entry.trailTimer = 0.0;
      }
    }
  }
}
